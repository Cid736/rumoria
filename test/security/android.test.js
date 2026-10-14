// The Android app's safety, read from its sources: what it lets in and out.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const A = path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main');
const read = (p) => fs.readFileSync(path.join(A, p), 'utf8');
const java = (name) => read(`java/com/rumoria/app/${name}.java`);

test('android manifest: no backups, only the launcher exported, cleartext only to the phone itself', () => {
  const m = read('AndroidManifest.xml');
  assert.match(m, /android:allowBackup="false"/);
  assert.match(m, /android:networkSecurityConfig="@xml\/network_security_config"/);
  const exported = [...m.matchAll(/android:exported="true"/g)].length;
  assert.equal(exported, 2, 'only the launcher and the media service (for Android Auto) are exported');
  assert.match(m, /<service\s+android:name="\.PlaybackService"\s+android:exported="true"/);
  // Who may browse the library through the media service: checked by package and uid.
  const svc = java('PlaybackService');
  assert.match(svc, /onGetRoot[\s\S]*allowed\(clientPackageName, clientUid\)[\s\S]*: null;/);
  assert.match(svc, /getPackagesForUid\(uid\)/);
  assert.match(svc, /BROWSERS = new HashSet<>\(Arrays\.asList\(\s*"com\.rumoria\.app", "com\.google\.android\.projection\.gearhead"/);
  assert.match(m, /<provider[\s\S]*?android:exported="false"/);
  const net = read('res/xml/network_security_config.xml');
  assert.match(net, /<base-config cleartextTrafficPermitted="false"/);
  assert.deepEqual([...net.matchAll(/<domain[^>]*>([^<]+)<\/domain>/g)].map((x) => x[1]), ['127.0.0.1']);
  const rules = read('res/xml/data_extraction_rules.xml');
  for (const where of ['cloud-backup', 'device-transfer']) assert.match(rules, new RegExp(`<${where}>[\\s\\S]*<exclude domain="root" />`));
});

test('android WebView: no files, only its own page talks to the app, other links go to the browser (https)', () => {
  const s = java('WebHost');
  assert.match(s, /setAllowFileAccess\(false\)/);
  assert.match(s, /setAllowContentAccess\(false\)/);
  assert.match(s, /MIXED_CONTENT_NEVER_ALLOW/);
  assert.doesNotMatch(s, /addJavascriptInterface/, 'no JavaScript interface open to any page');
  assert.match(s, /addWebMessageListener\(web, "RumoriaAndroid", Collections\.singleton\(origin\)/);
  assert.match(s, /if \(!isMainFrame\) return;/);
  assert.match(s, /!"https"\.equals\(u\.getScheme\(\)\)\) return;/);
  // Debugging the page only in debug builds.
  assert.match(s, /setWebContentsDebuggingEnabled\(\(app\.getApplicationInfo\(\)\.flags & ApplicationInfo\.FLAG_DEBUGGABLE\) != 0\)/);
  // The secret: a cookie only for the local server, HttpOnly.
  assert.match(s, /setCookie\(origin, "rum_t=" \+ NodeRunner\.token\(\) \+ "; Path=\/; HttpOnly; SameSite=Strict"/);
});

test('android server: a fresh 64-hex secret each launch, never a fixed one; the zip cannot write outside', () => {
  const s = java('NodeRunner');
  assert.match(s, /new SecureRandom\(\)\.nextBytes\(b\)/);
  assert.match(s, /byte\[\] b = new byte\[32\]/);
  assert.match(s, /getCanonicalPath\(\)\.startsWith\(root\)/);
});

test('android updates: only from this repository on GitHub, checked against the published SHA-256', () => {
  const s = java('Updater');
  assert.match(s, /api\.github\.com\/repos\/Cid736\/rumoria\/releases\/latest/);
  assert.match(s, /url\.startsWith\("https:\/\/github\.com\/Cid736\/rumoria\/releases\/download\/"\)/);
  assert.match(s, /sha256:\[0-9a-f\]\{64\}/);
  assert.match(s, /sha256\(apk\)\.equalsIgnoreCase\(digest\.substring\(7\)\)/);
  assert.match(s, /startsWith\("https:\/\/"\)\) throw/);
});

test('android updates (v1.12.2): no leftovers — installed or older APKs go on opening, others when a new one is ready', () => {
  const s = java('Updater');
  const sweep = s.slice(s.indexOf('static int sweep('), s.indexOf('static void checkSoon('));
  assert.match(sweep, /if \(m\.matches\(\) && newer\(m\.group\(1\), mine\)\) continue;/, 'a newer one waiting to be installed stays');
  assert.match(sweep, /if \(f\.isFile\(\) && f\.delete\(\)\) gone\+\+;/);
  const soon = s.slice(s.indexOf('static void checkSoon('), s.indexOf('static void checkNow('));
  assert.match(soon, /sweep\(new File\(app\.getCacheDir\(\), "updates"\), mine, null\)/);
  assert.match(soon, /new Thread\(/, 'not on the main thread');
  assert.match(s, /if \(!f\.equals\(apk\)\) f\.delete\(\);/);
});

test('android notification (v1.12.3): aleatorio and repetir everywhere, and closing it closes the player', () => {
  const s = java('PlaybackService');
  // Android 13+ draws its two extra buttons from the session's custom actions; up to 12, the notification's own.
  assert.match(s, /addCustomAction\(new PlaybackStateCompat\.CustomAction\.Builder\("shuffle"/);
  assert.match(s, /addCustomAction\(new PlaybackStateCompat\.CustomAction\.Builder\("repeat"/);
  assert.match(s, /ACTION_SET_SHUFFLE_MODE \| PlaybackStateCompat\.ACTION_SET_REPEAT_MODE/);
  assert.match(s, /addAction\(shuffle \? R\.drawable\.ic_shuffle : R\.drawable\.ic_shuffle_off/);
  assert.match(s, /setShowActionsInCompactView\(1, 2, 3\)/);
  // Only known actions reach the page.
  assert.match(s, /onCustomAction\(String action, Bundle extras\) \{ if \("shuffle"\.equals\(action\) \|\| "repeat"\.equals\(action\)\) send\(action, 0\); \}/);
  // Swiped away → "close" to the page, the notification and the service gone; the page saying nothing plays does the same.
  assert.match(s, /\.setDeleteIntent\(action\("close"\)\)/);
  assert.match(s, /if \("close"\.equals\(a\)\) \{\s+send\("close", 0\);\s+closeNotification\(\);/);
  assert.match(s, /if \(s\.has\("title"\) && title\.isEmpty\(\)\) \{ closeNotification\(\); return; \}/);
  // Android 13+: «Ocultar» on the panel's media player calls stop; only the system's, and only while paused, closes.
  assert.match(s, /if \("com\.android\.systemui"\.equals\(who\) && \(last == null \|\| !last\.optBoolean\("playing"\)\)\) \{ send\("close", 0\); closeNotification\(\); \}\s+else send\("pause", 0\);/);
  // No ACTION_STOP offered: a headset's stop key can't close it by accident.
  assert.doesNotMatch(s, /ACTION_STOP/);
  const close = s.slice(s.indexOf('private void closeNotification()'), s.indexOf('private void closeNotification()') + 700);
  assert.match(close, /STOP_FOREGROUND_REMOVE/);
  assert.match(close, /cancel\(ID\)/);
  assert.match(close, /stopSelf\(\)/);
});

test('android notification covers: only from YouTube\'s image servers', () => {
  const s = java('PlaybackService');
  assert.match(s, /SAFE_IMG = Pattern\.compile\("\^https:\/\/i\\\\d\?\\\\\.ytimg\\\\\.com\//);
  assert.match(s, /setInstanceFollowRedirects\(false\)/);
});

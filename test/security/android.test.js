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

test('android notification covers: only from YouTube\'s image servers', () => {
  const s = java('PlaybackService');
  assert.match(s, /SAFE_IMG = Pattern\.compile\("\^https:\/\/i\\\\d\?\\\\\.ytimg\\\\\.com\//);
  assert.match(s, /setInstanceFollowRedirects\(false\)/);
});

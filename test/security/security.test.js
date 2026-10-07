// Security suite for CLMusic's local server and desktop shell.
// Each block names the class of bug it guards against (OWASP-style).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startApp, rawRequest, VIDEO } = require('../helpers');
const netfetch = require('../../server/lib/netfetch');
const stream = require('../../server/lib/stream');

const ROUTES = [
  ['GET', '/api/lists'], ['GET', '/api/lists/aaaaaaaaaaaaaaaa'], ['POST', '/api/lists'], ['POST', '/api/lists/import'], ['PATCH', '/api/lists/aaaaaaaaaaaaaaaa'],
  ['POST', '/api/lists/aaaaaaaaaaaaaaaa/remove'], ['POST', '/api/lists/aaaaaaaaaaaaaaaa/restore'], ['POST', '/api/lists/aaaaaaaaaaaaaaaa/refresh'], ['DELETE', '/api/lists/aaaaaaaaaaaaaaaa'],
  ['GET', `/api/stream/info?id=${VIDEO}`], ['GET', `/api/stream/audio?id=${VIDEO}`], ['GET', `/api/stream/radio?id=${VIDEO}`], ['GET', `/api/stream/lyrics?id=${VIDEO}`],
  ['GET', '/api/search?q=x'], ['GET', '/api/find?q=x'], ['POST', '/api/history'], ['GET', '/api/history/smart'], ['GET', '/api/history/summary'],
  ['PATCH', '/api/history/settings'], ['DELETE', '/api/history'], ['GET', '/api/likes'], ['POST', '/api/likes'], ['POST', '/api/likes/remove'],
  ['GET', '/api/news'], ['GET', '/api/local'], ['POST', '/api/local/rescan'], ['GET', '/api/local/file?id=x'], ['GET', '/'], ['GET', '/index.html'],
];

// ---------- A01/A07 Broken access control & authentication ----------
test('auth: every route refuses a request without this launch\'s secret', async () => {
  const app = await startApp();
  try {
    for (const [method, url] of ROUTES) {
      const r = await app.call(method, url, { auth: false, body: method === 'GET' ? undefined : {} });
      assert.equal(r.status, 401, `${method} ${url}`);
    }
    assert.equal(app.yt.calls.length, 0, 'nothing reached YouTube');
  } finally { await app.close(); }
});

test('auth: a wrong secret (same length, or not) is refused; the right one by cookie works', async () => {
  const app = await startApp();
  try {
    const wrong = app.token.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
    assert.equal((await app.call('GET', '/api/lists', { auth: false, headers: { 'X-CLMusic-Token': wrong } })).status, 401);
    assert.equal((await app.call('GET', '/api/lists', { auth: false, headers: { 'X-CLMusic-Token': 'short' } })).status, 401);
    assert.equal((await app.call('GET', '/api/lists', { auth: false, headers: { Cookie: `clm_t=${wrong}` } })).status, 401);
    assert.equal((await app.call('GET', '/api/lists', { auth: false, headers: { Cookie: `x=1; clm_t=${app.token}` } })).status, 200);
    assert.equal((await app.call('GET', '/api/lists', { auth: false, headers: { Cookie: `clm_t=${app.token}x` } })).status, 401, 'a longer value is not a prefix match');
  } finally { await app.close(); }
});

test('auth: the server will not start without a strong secret', () => {
  const { createApp } = require('../../server/app');
  for (const token of [undefined, '', 'abc', 'g'.repeat(64), 'a'.repeat(63)]) {
    assert.throws(() => createApp({ token, dataDir: os.tmpdir(), ytEnv: () => ({}), background: false }), /secreto/);
  }
});

// ---------- DNS rebinding ----------
test('dns rebinding: only Host 127.0.0.1 / localhost with this port is answered', async () => {
  const app = await startApp();
  try {
    const h = { 'X-CLMusic-Token': app.token };
    assert.equal((await rawRequest(app.port, { path: '/api/lists', headers: { ...h, Host: `127.0.0.1:${app.port}` } })).status, 200);
    assert.equal((await rawRequest(app.port, { path: '/api/lists', headers: { ...h, Host: `localhost:${app.port}` } })).status, 200);
    for (const host of [`evil.example:${app.port}`, '127.0.0.1', `127.0.0.1:${app.port + 1}`, `127.0.0.1.evil.example:${app.port}`]) {
      assert.equal((await rawRequest(app.port, { path: '/api/lists', headers: { ...h, Host: host } })).status, 421, host);
    }
    // No Host at all (Node's client would add one, so straight over a socket).
    const reply = await new Promise((resolve) => {
      const s = require('net').connect(app.port, '127.0.0.1', () => s.write(`GET /api/lists HTTP/1.1\r\nX-CLMusic-Token: ${app.token}\r\nConnection: close\r\n\r\n`));
      let out = '';
      s.on('data', (c) => { out += c; });
      s.on('close', () => resolve(out));
    });
    assert.match(reply, /^HTTP\/1\.1 4\d\d/, 'refused');
  } finally { await app.close(); }
});

// ---------- CSRF / CORS ----------
test('csrf: changes need the X-CLMusic header, even with the cookie', async () => {
  const app = await startApp();
  try {
    const cookie = { Cookie: `clm_t=${app.token}` };
    // What a hostile page could send: a "simple" cross-site POST (the browser would add the cookie... if SameSite allowed it).
    const r = await app.call('POST', '/api/likes', { auth: false, headers: { ...cookie, 'X-CLMusic': null, 'Content-Type': 'text/plain' }, body: '{"song":{"key":"yt:dQw4w9WgXcQ","title":"x"}}' });
    assert.equal(r.status, 403);
    assert.equal((await app.call('DELETE', '/api/history', { auth: false, headers: { ...cookie, 'X-CLMusic': null } })).status, 403);
    assert.equal((await app.call('GET', '/api/likes')).data.songs.length, 0, 'nothing changed');
  } finally { await app.close(); }
});

test('cors: no other origin is ever allowed to read answers', async () => {
  const app = await startApp();
  try {
    const pre = await rawRequest(app.port, { method: 'OPTIONS', path: '/api/lists', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET', Host: `127.0.0.1:${app.port}` } });
    assert.equal(pre.headers['access-control-allow-origin'], undefined);
    const r = await app.call('GET', '/api/lists', { headers: { Origin: 'https://evil.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  } finally { await app.close(); }
});

// ---------- A03 Injection ----------
test('injection: a video id is 11 safe characters or nothing reaches yt-dlp', async () => {
  const app = await startApp();
  try {
    const evil = ['--exec=calc', 'dQw4w9WgXcQ;rm', '../../../etc', '%00', 'dQw4w9WgXc', `${VIDEO}&id=x`, '$(whoami)xx', '`id`xxxxxxx'];
    for (const id of evil) {
      for (const p of ['info', 'audio', 'radio', 'lyrics']) {
        assert.equal((await app.call('GET', `/api/stream/${p}?id=${encodeURIComponent(id)}`)).status, 400, `${p} ${id}`);
      }
    }
    // The same parameter twice (an array) is refused too.
    assert.equal((await app.call('GET', `/api/stream/info?id=${VIDEO}&id=${VIDEO}`)).status, 400);
    assert.equal(app.yt.calls.length, 0);
  } finally { await app.close(); }
});

test('injection: search text is one line of at most 200 characters', async () => {
  const app = await startApp();
  try {
    await app.call('GET', `/api/search?q=${encodeURIComponent('a\r\nb\u0000c')}`);
    const q = app.yt.calls.find((c) => c[0] === 'search')[1];
    assert.equal(/[\r\n\u0000]/.test(q), false, 'control characters gone');
    assert.equal((await app.call('GET', `/api/find?q=${'x'.repeat(201)}`)).status, 400);
  } finally { await app.close(); }
});

test('injection: list ids are 16 hex characters (no path tricks)', async () => {
  const app = await startApp();
  try {
    for (const id of ['..%2F..%2Fsettings', '__proto__', 'constructor', 'AAAAAAAAAAAAAAAA', 'a'.repeat(17)]) {
      assert.equal((await app.call('GET', `/api/lists/${id}`)).status, 404, id);
      assert.equal((await app.call('PATCH', `/api/lists/${id}`, { body: { name: 'x' } })).status, 404, id);
    }
  } finally { await app.close(); }
});

test('injection: prototype pollution through JSON bodies does nothing', async () => {
  const app = await startApp();
  try {
    await app.call('POST', '/api/lists', { body: '{"name":"x","tracks":[{"title":"a"}],"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}', headers: { 'Content-Type': 'application/json' } });
    await app.call('POST', '/api/likes', { body: '{"song":{"__proto__":{"polluted":true},"key":"yt:dQw4w9WgXcQ","title":"x"}}', headers: { 'Content-Type': 'application/json' } });
    assert.equal({}.polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
  } finally { await app.close(); }
});

test('injection: stored text comes back as JSON data, never as a page', async () => {
  const app = await startApp();
  try {
    const xss = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    const l = await app.call('POST', '/api/lists', { body: { name: xss, tracks: [{ title: xss, artist: xss }] } });
    assert.equal(l.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(l.headers.get('x-content-type-options'), 'nosniff');
  } finally { await app.close(); }
});

// ---------- A10 SSRF ----------
test('ssrf: imported links must be Spotify / Apple Music / YouTube; nothing else is fetched', async () => {
  const app = await startApp();
  try {
    for (const url of ['http://127.0.0.1:22/', 'http://169.254.169.254/latest/meta-data/', 'file:///C:/Windows/win.ini', 'https://open.spotify.com.evil.example/playlist/x', 'http://[::1]/', 'gopher://x']) {
      assert.equal((await app.call('POST', '/api/lists/import', { body: { url } })).status, 400, url);
    }
    assert.equal(app.yt.calls.length, 0, 'no fetch, no yt-dlp');
  } finally { await app.close(); }
});

test('ssrf: the fetcher only talks to public addresses (also after DNS and redirects)', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fc00::1', '0.0.0.0']) {
    assert.equal(netfetch.isPublicIp(ip), false, ip);
  }
  assert.equal(netfetch.isPublicIp('8.8.8.8'), true);
  for (const url of ['http://example.com', 'https://localhost/x', 'https://127.0.0.1/', 'https://user:pw@example.com/', 'https://example.com:22/', 'https://router.lan/']) {
    assert.throws(() => netfetch.checkUrl(url), undefined, url);
  }
  // The audio relay: only YouTube's media servers.
  assert.equal(stream.MEDIA_HOST_RE.test('rr1---sn-x.googlevideo.com'), true);
  assert.equal(stream.MEDIA_HOST_RE.test('googlevideo.com.evil.example'), false);
});

// ---------- Path traversal ----------
test('path traversal: local files only by id, inside your folder; dotfiles never served', async () => {
  const music = fs.mkdtempSync(path.join(os.tmpdir(), 'clm-music-'));
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'clm-dist-'));
  fs.writeFileSync(path.join(music, 'a.mp3'), 'x');
  fs.writeFileSync(path.join(dist, 'index.html'), 'ok');
  fs.writeFileSync(path.join(dist, '.env'), 'SECRET=1');
  const app = await startApp({ musicDir: music, staticDir: dist });
  try {
    for (const id of ['../../Windows/win.ini', '..%5C..%5Cwin.ini', 'C:\\Windows\\win.ini', '/etc/passwd', 'a.mp3']) {
      assert.equal((await app.call('GET', `/api/local/file?id=${encodeURIComponent(id)}`)).status, 404, id);
    }
    for (const p of ['/.env', '/%2e%2e/package.json', '/..%2f..%2fpackage.json', '/../server/app.js']) {
      const r = await rawRequest(app.port, { path: p, headers: { 'X-CLMusic-Token': app.token, Host: `127.0.0.1:${app.port}` } });
      assert.ok([403, 404].includes(r.status), `${p} → ${r.status}`);
      assert.equal(r.body.includes('SECRET'), false);
    }
  } finally {
    await app.close();
    fs.rmSync(music, { recursive: true, force: true });
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

// ---------- A05 Misconfiguration / data exposure ----------
test('exposure: errors are short, never a stack, a path or the secret', async () => {
  const app = await startApp();
  try {
    const bad = await app.call('POST', '/api/lists', { body: '{"name":', headers: { 'Content-Type': 'application/json' } });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.data, { error: 'Petición no válida.' });
    const big = await app.call('POST', '/api/lists', { body: JSON.stringify({ name: 'x'.repeat(300 * 1024) }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(big.status, 413);
    for (const r of [bad, big]) {
      const text = JSON.stringify(r.data);
      assert.equal(/at \w+ \(|node_modules|[A-Z]:\\|\/home\//.test(text), false, text);
      assert.equal(text.includes(app.token), false);
    }
  } finally { await app.close(); }
});

test('exposure: the page never learns YouTube\'s media address (only the relay)', () => {
  const info = { url: 'https://rr1---sn-x.googlevideo.com/videoplayback?sig=SECRET', headers: { 'User-Agent': 'x' }, mime: 'audio/mp4', title: 't', channel: 'c', artist: 'a', track: 't', duration: 1, thumbnail: null };
  const pub = stream.publicInfo(VIDEO, info);
  assert.equal(JSON.stringify(pub).includes('googlevideo'), false);
  assert.equal('headers' in pub, false);
});

test('headers: CSP, no sniffing, no framing, no referrer, no X-Powered-By, rate limits', async () => {
  const app = await startApp();
  try {
    const r = await app.call('GET', '/api/lists');
    const csp = r.headers.get('content-security-policy');
    for (const d of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'"]) assert.ok(csp.includes(d), d);
    assert.equal(csp.includes('unsafe-inline'), false);
    assert.equal(csp.includes('unsafe-eval'), false);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(r.headers.get('x-powered-by'), null);
    const limited = await app.call('GET', '/api/search?q=x');
    assert.ok(limited.headers.get('ratelimit-policy') || limited.headers.get('ratelimit'), 'rate limited');
  } finally { await app.close(); }
});

test('rate limit: a flood of searches is cut off', async () => {
  const app = await startApp();
  try {
    let last = null;
    for (let i = 0; i < 245; i++) last = await app.call('GET', `/api/search?q=s${i}`);
    assert.equal(last.status, 429);
  } finally { await app.close(); }
});

// ---------- Electron hardening (static checks that it stays on) ----------
test('electron: sandboxed page, no Node, navigation and pop-ups locked, no permissions, httpOnly secret', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'preload.js'), 'utf8');
  for (const must of ['contextIsolation: true', 'sandbox: true', 'nodeIntegration: false', 'webSecurity: true', "'will-navigate'", "action: 'deny'", 'setPermissionRequestHandler', 'httpOnly: true', "sameSite: 'strict'", 'requestSingleInstanceLock', "'will-attach-webview'"]) {
    assert.ok(main.includes(must), must);
  }
  assert.equal(/nodeIntegration:\s*true|contextIsolation:\s*false|sandbox:\s*false|webSecurity:\s*false|allowRunningInsecureContent/.test(main), false);
  // Every IPC handler checks who's asking.
  const handlers = main.match(/ipcMain\.handle\([^,]+,\s*(async\s*)?\(event[^)]*\)\s*=>\s*\{?\s*[^\n]*/g) || [];
  assert.ok(handlers.length >= 3);
  for (const h of handlers) assert.ok(h.includes('isTrustedSender(event)'), h);
  // The preload exposes three functions, never ipcRenderer itself.
  assert.equal(/exposeInMainWorld\([^)]*ipcRenderer\s*[,)]/.test(preload), false);
  assert.equal((preload.match(/ipcRenderer\.invoke/g) || []).length, 3);
});

test('electron: yt-dlp is only installed if its SHA-256 matches the published one, from GitHub only', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.js'), 'utf8');
  assert.ok(main.includes('SHA2-256SUMS'));
  assert.ok(main.includes("createHash('sha256')"));
  assert.ok(/ALLOWED_HOSTS = new Set\(\['github\.com'/.test(main));
});

// The updater's decisions, without the network: which file updates this copy,
// newer or not, and that only a GitHub file with a published SHA-256 is taken.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('fs');
const path = require('path');

// updater.js needs electron's app/net only when running; a stand-in is enough here.
const realLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') return { app: { getVersion: () => '1.1.0', isPackaged: true }, net: {} };
  return realLoad.call(this, request, ...rest);
};
const { isNewer, assetName, pickAsset, sweepOld } = require('../../electron/updater');
Module._load = realLoad;

const SHA = 'a'.repeat(64);
const release = (over = {}) => ({
  tag_name: 'v1.2.0',
  assets: [{ name: 'Rumoria-Setup.exe', size: 1000, digest: `sha256:${SHA}`, browser_download_url: 'https://github.com/Cid736/rumoria/releases/download/v1.2.0/Rumoria-Setup.exe' }],
  ...over,
});

test('updater: newer versions only, plain X.Y.Z', () => {
  assert.ok(isNewer('1.2.0', '1.1.9'));
  assert.ok(isNewer('2.0.0', '1.9.9'));
  assert.ok(!isNewer('1.1.0', '1.1.0'));
  assert.ok(!isNewer('1.0.9', '1.1.0'));
});

test('updater: each build updates to its own file', () => {
  assert.equal(assetName({ portable: false, packaged: true, lite: false }), 'Rumoria-Setup.exe');
  assert.equal(assetName({ portable: true, packaged: true, lite: false }), 'Rumoria.exe');
  assert.equal(assetName({ portable: true, packaged: true, lite: true }), 'Rumoria-Lite.exe');
});

test('updater: only a GitHub file with a published SHA-256 and a sane size is taken', () => {
  const ok = pickAsset(release(), 'Rumoria-Setup.exe', '1.1.0');
  assert.deepEqual(ok, { version: '1.2.0', url: 'https://github.com/Cid736/rumoria/releases/download/v1.2.0/Rumoria-Setup.exe', sha256: SHA, size: 1000 });
  assert.deepEqual(pickAsset(release(), 'Rumoria-Setup.exe', '1.2.0'), { upToDate: true, version: '1.2.0' });
  const bad = (r) => pickAsset(release(r), 'Rumoria-Setup.exe', '1.1.0').error;
  assert.ok(bad({ tag_name: 'v1.2.0; calc' }), 'odd version');
  assert.ok(bad({ assets: [] }), 'no file for this build');
  assert.ok(bad({ assets: [{ ...release().assets[0], digest: null }] }), 'no SHA-256: never offered');
  assert.ok(bad({ assets: [{ ...release().assets[0], digest: 'sha1:abc' }] }));
  assert.ok(bad({ assets: [{ ...release().assets[0], browser_download_url: 'https://evil.example/Rumoria-Setup.exe' }] }), 'only GitHub');
  assert.ok(bad({ assets: [{ ...release().assets[0], browser_download_url: 'http://github.com/x.exe' }] }), 'only https');
  assert.ok(bad({ assets: [{ ...release().assets[0], size: 0 }] }));
  assert.ok(bad({ assets: [{ ...release().assets[0], size: 10 * 1024 * 1024 * 1024 }] }), 'not absurdly big');
});

test('updater: the portable swap takes paths from the environment, never from the script text; the page only gets three doors', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'updater.js'), 'utf8');
  assert.match(src, /\$env:RU_SRC/);
  assert.match(src, /RU_SRC: ready/);
  assert.ok(!/\$\{ready\}|\$\{process\.env\.PORTABLE_EXECUTABLE_FILE\}/.test(src), 'no path inside the command text');
  assert.match(src, /flags: 'wx'/, 'downloaded file created exclusively');
  assert.match(src, /mkdtempSync/, 'in a fresh random folder');
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.js'), 'utf8');
  for (const ch of ['rumoria:update:state', 'rumoria:update:check', 'rumoria:update:restart']) {
    const line = main.split('\n').find((l) => l.includes(`'${ch}', (event) =>`));
    assert.ok(line && line.includes('isTrustedSender(event)'), `${ch} checks who asks`);
  }
});

test('updater: old download folders go — only ours, only folders, only when not just made', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rum-sweep-'));
  try {
    const old = Date.now() - 3600_000;
    const mk = (n, { file = false, at = old } = {}) => {
      const p = path.join(tmp, n);
      if (file) fs.writeFileSync(p, 'x'); else { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'Rumoria-Setup.exe'), 'x'); }
      fs.utimesSync(p, at / 1000, at / 1000);
    };
    mk('rumoria-update-aB3dE9');
    mk('rumoria-update-zzzzzz', { at: Date.now() });
    mk('rumoria-update-Qq1234', { file: true });
    mk('rumoria-update-toolongname');
    mk('tubegrab-update-aB3dE9');
    assert.equal(sweepOld({ tmp }), 1);
    assert.deepEqual(fs.readdirSync(tmp).sort(), ['rumoria-update-Qq1234', 'rumoria-update-toolongname', 'rumoria-update-zzzzzz', 'tubegrab-update-aB3dE9']);
    assert.equal(sweepOld({ tmp: path.join(tmp, 'nope') }), 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

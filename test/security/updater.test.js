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

test('updater on a Mac: its zip by processor; only a Rumoria.app it can replace', () => {
  const { assetName, macBundle } = require('../../electron/updater');
  assert.equal(assetName({ platform: 'darwin', arch: 'arm64', packaged: true }), 'Rumoria-mac-arm64.zip');
  assert.equal(assetName({ platform: 'darwin', arch: 'x64', packaged: true }), 'Rumoria-mac-x64.zip');
  const yes = { writable: () => true };
  assert.deepEqual(macBundle('/Applications/Rumoria.app/Contents/MacOS/Rumoria', yes), { bundle: '/Applications/Rumoria.app' });
  assert.match(macBundle('/private/var/folders/x/AppTranslocation/ABC/d/Rumoria.app/Contents/MacOS/Rumoria', yes).error, /Aplicaciones/);
  assert.match(macBundle('/Volumes/Rumoria/Rumoria.app/Contents/MacOS/Rumoria', yes).error, /Aplicaciones/);
  assert.match(macBundle('/Applications/Rumoria.app/Contents/MacOS/Rumoria', { writable: () => false }).error, /no se puede escribir/);
  assert.match(macBundle('/usr/local/bin/rumoria', yes).error, /Rumoria\.app/);
});

test('updater on a Mac: the swap script takes every path from the environment', () => {
  const { MAC_SWAP } = require('../../electron/updater');
  for (const v of ['RU_PID', 'RU_SRC', 'RU_DST', 'RU_NEW', 'RU_OLD', 'RU_RUN']) assert.ok(MAC_SWAP.includes(`"$${v}"`), v);
  assert.ok(!/\/Applications|Users\//.test(MAC_SWAP), 'no path written into the script');
});

// Only where ditto exists (macOS; it runs on GitHub's Mac in the release workflow).
test('updater on a Mac: the swap really replaces Rumoria.app, and puts the old one back if the zip is bad', { skip: process.platform !== 'darwin' }, () => {
  const { MAC_SWAP } = require('../../electron/updater');
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rum-mac-'));
  try {
    const app = path.join(dir, 'Applications', 'Rumoria.app');
    fs.mkdirSync(path.join(app, 'Contents'), { recursive: true });
    fs.writeFileSync(path.join(app, 'Contents', 'version'), 'old');
    const build = path.join(dir, 'build', 'Rumoria.app');
    fs.mkdirSync(path.join(build, 'Contents'), { recursive: true });
    fs.writeFileSync(path.join(build, 'Contents', 'version'), 'new');
    const zip = path.join(dir, 'dl', 'Rumoria-mac-arm64.zip');
    fs.mkdirSync(path.dirname(zip));
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', build, zip]);
    const run = (src) => {
      try {
        execFileSync('/bin/sh', ['-c', MAC_SWAP], { env: { ...process.env, RU_PID: '999999', RU_SRC: src, RU_DST: app, RU_NEW: path.join(dir, 'dl', 'unzipped'), RU_OLD: path.join(dir, 'Applications', 'Rumoria.old.app'), RU_RUN: '0' } });
        return 0;
      } catch (err) { return err.status; }
    };
    assert.equal(run(zip), 0);
    assert.equal(fs.readFileSync(path.join(app, 'Contents', 'version'), 'utf8'), 'new');
    assert.ok(!fs.existsSync(path.join(dir, 'Applications', 'Rumoria.old.app')));
    const bad = path.join(dir, 'dl', 'bad.zip');
    fs.writeFileSync(bad, 'not a zip');
    assert.notEqual(run(bad), 0);
    assert.equal(fs.readFileSync(path.join(app, 'Contents', 'version'), 'utf8'), 'new', 'a bad download leaves Rumoria as it was');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

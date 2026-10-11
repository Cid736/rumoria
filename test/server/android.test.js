// Android: the Node on phones has no Intl. What the build does about it
// (scripts/android-prepare.js) and the shim loaded first (android/node/shim.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { expand, rewriteProps, nfdTable, zip, unzip } = require('../../scripts/android-prepare');

const ROOT = path.join(__dirname, '..', '..');
const ranges = Object.fromEntries(['L', 'N', 'ID_Start', 'ID_Continue'].map((p) => [p, expand(p)]));

test('android: each \\p{…} becomes ranges that match exactly the same characters', () => {
  for (const name of Object.keys(ranges)) {
    const real = new RegExp(`^\\p{${name}}$`, 'u');
    const mine = new RegExp(`^[${ranges[name]}]$`, 'u');
    for (let c = 0; c < 0x30000; c += 7) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const ch = String.fromCodePoint(c);
      assert.equal(mine.test(ch), real.test(ch), `${name} U+${c.toString(16)}`);
    }
  }
});

test('android: the server rewritten has no \\p{…} left, still compiles and folds the same', () => {
  const files = fs.readdirSync(path.join(ROOT, 'server', 'lib')).map((f) => path.join(ROOT, 'server', 'lib', f));
  let seen = 0;
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    if (!code.includes('\\p{')) continue;
    seen += 1;
    const out = rewriteProps(code, file, ranges);
    assert.ok(!out.includes('\\p{'), file);
    assert.doesNotThrow(() => new vm.Script(`(function (require, module, exports) {${out}\n})`, { filename: file }), file);
  }
  assert.ok(seen >= 5, 'the server does use \\p{…}');
  // The same answers, for real: hidden.js's artist key, rewritten, against the original.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rumoria-android-'));
  try {
    fs.writeFileSync(path.join(dir, 'hidden.js'), rewriteProps(fs.readFileSync(path.join(ROOT, 'server', 'lib', 'hidden.js'), 'utf8'), 'hidden.js', ranges));
    fs.copyFileSync(path.join(ROOT, 'server', 'lib', 'atomic.js'), path.join(dir, 'atomic.js'));
    const mine = require(path.join(dir, 'hidden.js'));
    const real = require('../../server/lib/hidden');
    for (const a of ['Rosalía - Topic', 'BTS (방탄소년단) Official', 'Beyoncé VEVO', 'Ñengo Flow & Co.', 'Мумий Тролль']) {
      assert.equal(mine.artistKey(a), real.artistKey(a), a);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('android: a \\p{…} outside [ ] stops the build instead of guessing', () => {
  assert.throws(() => rewriteProps('const r = /\\p{L}+/u;', 'x.js', ranges), /fuera de \[ \]/);
  assert.throws(() => rewriteProps('const r = /[\\p{Script=Greek}]/u;', 'x.js', ranges), /sin traducir/);
  assert.throws(() => rewriteProps('const r = /[\\P{L}]/u;', 'x.js', ranges), /sin traducir/);
});

test('android: the shim gives back accents and a collator to a Node without Intl', () => {
  const table = { nfd: nfdTable() };
  assert.equal(table.nfd['é'], 'é');
  assert.equal(table.nfd['Ñ'], 'Ñ');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rumoria-shim-'));
  try {
    fs.copyFileSync(path.join(ROOT, 'android', 'node', 'shim.js'), path.join(dir, 'shim.js'));
    fs.writeFileSync(path.join(dir, 'shim-data.json'), JSON.stringify(table));
    // A Node like the phone's: normalize does nothing, there is no Intl.
    fs.writeFileSync(path.join(dir, 'break.js'), "String.prototype.normalize = function () { return String(this); }; delete globalThis.Intl;");
    const check = [
      "const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');",
      "const c = new Intl.Collator('es', { sensitivity: 'base', numeric: true });",
      "console.log(JSON.stringify({ fold: fold('Canción Ñoña Über'), sort: ['Tema 10', 'tema 2', 'Álbum', 'zeta'].sort(c.compare), same: c.compare('ÁRBOL', 'arbol') }));",
    ].join('\n');
    const out = JSON.parse(execFileSync(process.execPath, ['-r', path.join(dir, 'break.js'), '-r', path.join(dir, 'shim.js'), '-e', check], { encoding: 'utf8' }));
    assert.equal(out.fold, 'cancion nona uber');
    assert.deepEqual(out.sort, ['Álbum', 'tema 2', 'Tema 10', 'zeta']);
    assert.equal(out.same, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('android: the server zip round-trips (names, contents, nothing outside)', () => {
  const files = [{ name: 'server/main.js', data: Buffer.from('console.log(1)') }, { name: 'dist/ñ.txt', data: Buffer.from('ñ'.repeat(1000)) }];
  const back = unzip(zip(files));
  assert.deepEqual(back.map((f) => f.name), files.map((f) => f.name));
  assert.deepEqual(back.map((f) => f.data.toString()), files.map((f) => f.data.toString()));
});

test('a search you make waits its turn behind what Rumoria does by itself (no "busy")', async () => {
  const { startApp, fakeYouTube } = require('../helpers');
  let running = 0;
  let most = 0;
  const yt = fakeYouTube({
    search: async (q) => {
      running += 1; most = Math.max(most, running);
      await new Promise((r) => { setTimeout(r, 300); });
      running -= 1;
      return [{ id: 'dQw4w9WgXcQ', title: q, channel: 'C', duration: 1, thumbnail: null }];
    },
  });
  const app = await startApp({ yt });
  try {
    const all = await Promise.all([1, 2, 3, 4, 5].map((n) => app.call('GET', `/api/search?q=song${n}`)));
    assert.deepEqual(all.map((r) => r.status), [200, 200, 200, 200, 200]);
    assert.ok(most <= 3, 'never more than three yt-dlp at once');
  } finally {
    await app.close();
  }
});

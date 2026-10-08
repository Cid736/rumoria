// v1.5: «No me recomiendes esto», Historial, «Quitar canciones repetidas»,
// global shortcuts, and what the tray and the mini player may now carry.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Hidden, artistKey } = require('../../server/lib/hidden');
const { ListenLog } = require('../../server/lib/listenlog');
const { StreamLists, duplicatesOf } = require('../../server/lib/streamlists');
const { cleanAccel, cleanShortcuts, createShortcuts, DEFAULT_KEYS } = require('../../electron/shortcuts');
const { startApp, VIDEO } = require('../helpers');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rum-v15-'));

test('hidden: a song by its key, an artist by any of their names; only clean entries; kept on disk', () => {
  const dir = tmp();
  try {
    const h = new Hidden(path.join(dir, 'h.json'));
    assert.equal(h.add({ song: { key: 'evil', title: 'x' } }), null);
    assert.equal(h.add({ artist: '   ' }), null);
    assert.equal(h.add({}), null);
    h.add({ song: { key: 'yt:aaaaaaaaaaa', title: 'Uno', artist: 'Ana' } });
    h.add({ artist: 'Queen' });
    assert.ok(h.hides({ yt: 'aaaaaaaaaaa', title: 'Uno' }));
    assert.ok(h.hides({ id: 'aaaaaaaaaaa', title: 'x' }), 'a YouTube entry, by its id');
    for (const s of [{ title: 'Radio Ga Ga', artist: 'Queen' }, { title: 'X', channel: 'Queen - Topic' }, { title: 'X', channel: 'QueenVEVO' }, { title: 'Queen - Innuendo', channel: 'Some Channel' }, { title: 'X', channel: 'Queen Official' }]) {
      assert.ok(h.hides(s), JSON.stringify(s));
    }
    assert.ok(!h.hides({ title: 'Queens of the Stone Age - No One Knows', artist: 'QOTSA' }), 'another artist that starts alike');
    assert.ok(!h.hides({ title: 'Otra', artist: 'Beto' }));
    assert.equal(artistKey('Queen - Topic'), 'queen');
    const again = new Hidden(path.join(dir, 'h.json'));
    assert.deepEqual(again.list().artists.map((a) => a.name), ['Queen']);
    again.remove({ artist: 'QUEEN' });
    again.remove({ key: 'yt:aaaaaaaaaaa' });
    assert.deepEqual(again.list(), { songs: [], artists: [] });
    // Rubbish on disk is dropped.
    fs.writeFileSync(path.join(dir, 'h.json'), JSON.stringify({ songs: [{ key: '../x' }, 'x'], artists: [{ name: '' }, 5, { name: 'Ok' }] }));
    assert.deepEqual(new Hidden(path.join(dir, 'h.json')).list().artists.map((a) => a.name), ['Ok']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hidden routes: what you hid stays out of radios, Explorar, news and lists that fill themselves', async () => {
  const app = await startApp();
  try {
    assert.equal((await app.call('GET', `/api/stream/radio?id=${VIDEO}`)).data.entries.length, 1);
    assert.equal((await app.call('POST', '/api/hidden', { body: { artist: '<>!?' } })).status, 400, 'only letters and numbers make a name');
    assert.equal((await app.call('POST', '/api/hidden', { body: { artist: ['x'] } })).status, 400);
    const r = await app.call('POST', '/api/hidden', { body: { artist: 'Artista' } }); // the fake channel is "Artista - Topic"
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.artists.map((a) => a.name), ['Artista']);
    assert.equal((await app.call('GET', `/api/stream/radio?id=${VIDEO}`)).data.entries.length, 0);
    assert.equal((await app.call('GET', '/api/browse/exitos')).data.tracks.length, 0);
    const auto = await app.call('POST', '/api/lists/auto', { body: { q: 'rock' } });
    assert.equal(auto.status, 404, 'not even in a list that fills itself (nothing else was found)');
    // Back.
    assert.deepEqual((await app.call('POST', '/api/hidden/remove', { body: { artist: 'artista' } })).data.artists, []);
    assert.equal((await app.call('GET', `/api/stream/radio?id=${VIDEO}`)).data.entries.length, 1);
    assert.equal((await app.call('POST', '/api/hidden/remove', { body: {} })).status, 400);
    // A song: its mix seeds and news go, your own history stays.
    app.state.history.add({ key: `yt:${VIDEO}`, title: 'Uno', artist: 'Beto', yt: VIDEO }, 200);
    await app.call('POST', '/api/hidden', { body: { artist: 'Beto' } });
    const smart = (await app.call('GET', '/api/history/smart')).data;
    assert.equal(smart.artists.length, 0, 'no daily mix of Beto');
    assert.equal(smart.top.length, 1, '"Lo más escuchado" is still what you played');
  } finally { await app.close(); }
});

test('history: what you heard lately, newest first, a song heard twice running is one row; every song\'s plays', () => {
  const dir = tmp();
  try {
    let now = Date.UTC(2026, 9, 8, 12);
    const h = new ListenLog(path.join(dir, 'h.json'), { now: () => now });
    const song = (id, title) => ({ key: `yt:${id}`, title, artist: 'A', yt: id, dur: 200 });
    h.add(song('aaaaaaaaaaa', 'Uno'), 200);
    now += 200_000;
    h.add(song('aaaaaaaaaaa', 'Uno'), 100); // again, right after: the same row
    now += 3600_000;
    h.add(song('bbbbbbbbbbb', 'Dos'), 6); // skipped
    now += 60_000;
    h.add(song('aaaaaaaaaaa', 'Uno'), 200);
    const rows = h.recent({ days: 1 });
    assert.deepEqual(rows.map((r) => [r.title, r.secs, r.played]), [['Uno', 200, true], ['Dos', 6, false], ['Uno', 300, true]]);
    assert.ok(rows[0].at > rows[1].at);
    assert.deepEqual(h.counts(), { 'yt:aaaaaaaaaaa': 3 });
    now += 3 * 86400_000;
    assert.equal(h.recent({ days: 1 }).length, 0);
    assert.equal(h.recent({ days: 7 }).length, 3);
    assert.equal(h.recent({ days: 7, limit: 1 }).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('history routes: recent (days within bounds) and counts', async () => {
  const app = await startApp();
  try {
    app.state.history.add({ key: `yt:${VIDEO}`, title: 'Uno', artist: 'A', yt: VIDEO }, 200);
    assert.equal((await app.call('GET', '/api/history/recent?days=7')).data.items.length, 1);
    assert.equal((await app.call('GET', '/api/history/recent?days=-5')).data.items.length, 1, 'clamped, not an error');
    assert.equal((await app.call('GET', '/api/history/recent?days=abc')).status, 200);
    assert.deepEqual((await app.call('GET', '/api/history/counts')).data.counts, { [`yt:${VIDEO}`]: 1 });
  } finally { await app.close(); }
});

test('repeated songs: the first stays; the same video or the same name once "(Official Video)", "feat." and the channel\'s extras are set aside', () => {
  const t = (title, artist, yt) => ({ title, artist, ...(yt ? { yt } : {}) });
  assert.deepEqual(duplicatesOf([
    t('Bohemian Rhapsody', 'Queen'), t('Queen - Bohemian Rhapsody (Official Video Remastered)', 'Queen Official'),
    t('Bohemian Rhapsody (Live Aid)', 'Queen'), t('X', 'A', 'aaaaaaaaaaa'), t('Y', 'B', 'aaaaaaaaaaa'),
    t('Despacito (feat. Daddy Yankee)', 'Luis Fonsi'), t('Despacito', 'Luis Fonsi, Daddy Yankee'),
    t('Shape of You', 'EdSheeranVEVO'), t('Shape of You', 'Ed Sheeran'), t('Shape of You', 'Other Band'), t('Song (Remix)', 'A'), t('Song', 'A'),
  ]), [1, 4, 6, 8]);
});

test('repeated songs in a list: out with "Deshacer", and the one kept is not remembered as taken out', () => {
  const dir = tmp();
  try {
    const lists = new StreamLists(path.join(dir, 'l.json'));
    const s = (artist, title) => ({ artist, title, query: `${artist} - ${title}` });
    const l = lists.create({ name: 'L', source: 'spotify', url: 'https://open.spotify.com/playlist/37i9dQZF1EIZ4e7Z4XQ4e1', tracks: [s('A', 'Uno'), s('B', 'Dos'), s('A', 'Uno'), s('C', 'Tres')] });
    const r = lists.dedupe(l.id);
    assert.deepEqual(r.removed.map((x) => x.at), [2]);
    assert.deepEqual(r.list.tracks.map((x) => x.title), ['Uno', 'Dos', 'Tres']);
    // Read again from its link: "Uno" stays (once).
    assert.deepEqual(lists.reread(l.id, [s('A', 'Uno'), s('B', 'Dos'), s('C', 'Tres')]).list.tracks.map((x) => x.title), ['Uno', 'Dos', 'Tres']);
    assert.deepEqual(lists.dedupe(l.id).removed, []);
    assert.equal(lists.dedupe('nope'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('dedupe route', async () => {
  const app = await startApp();
  try {
    const l = (await app.call('POST', '/api/lists', { body: { name: 'L', tracks: [{ title: 'Uno', artist: 'A' }, { title: 'Uno (Official Audio)', artist: 'A' }] } })).data;
    const r = await app.call('POST', `/api/lists/${l.id}/dedupe`);
    assert.equal(r.status, 200);
    assert.equal(r.data.list.tracks.length, 1);
    assert.equal(r.data.removed.length, 1);
    assert.equal((await app.call('POST', '/api/lists/aaaaaaaaaaaaaaaa/dedupe')).status, 404);
  } finally { await app.close(); }
});

test('global shortcuts: only combinations with Ctrl, Alt or Win, of known keys, each once', () => {
  assert.equal(cleanAccel('Ctrl+Alt+P'), 'Ctrl+Alt+P');
  assert.equal(cleanAccel('Alt+Ctrl+P'), 'Ctrl+Alt+P', 'in a fixed order');
  assert.equal(cleanAccel('Super+F5'), 'Super+F5');
  for (const bad of ['P', 'Shift+P', 'Ctrl+Ctrl+P', 'Ctrl+Evil', 'Ctrl+Alt+', 'CommandOrControl+Q', '__proto__', 'Ctrl+P+Q', 5, null, `Ctrl+${'A'.repeat(50)}`]) assert.equal(cleanAccel(bad), '', String(bad));
  assert.deepEqual(cleanShortcuts(null), { enabled: true, keys: DEFAULT_KEYS });
  const twice = cleanShortcuts({ keys: { toggle: 'Ctrl+Alt+N', next: 'Ctrl+Alt+N', prev: 'nope' } });
  assert.equal(twice.keys.toggle, 'Ctrl+Alt+N');
  assert.equal(twice.keys.next, '', 'never two actions on one combination');
  assert.equal(twice.keys.prev, '', 'a bad one is none');
});

test('global shortcuts: registered as set, one another app has is reported, off unregisters, a change takes the keys from another action', () => {
  let saved = {};
  const registered = new Map();
  const gs = {
    register: (k, fn) => { if (k === 'Ctrl+Alt+L') return false; registered.set(k, fn); return true; },
    unregisterAll: () => registered.clear(),
  };
  const ran = [];
  const s = createShortcuts({ globalShortcut: gs, read: () => saved, save: (p) => { saved = { ...saved, ...p }; }, run: (a) => ran.push(a) });
  let st = s.apply();
  assert.deepEqual(st.failed, ['like']);
  assert.equal(registered.size, 7);
  registered.get('Ctrl+Alt+P')();
  assert.deepEqual(ran, ['toggle']);
  st = s.set({ keys: { like: 'Ctrl+Alt+P' } });
  assert.equal(st.keys.like, 'Ctrl+Alt+P');
  assert.equal(st.keys.toggle, '', 'toggle let it go');
  st = s.set({ keys: { next: 'Shift+N' } });
  assert.equal(st.keys.next, DEFAULT_KEYS.next, 'a bad combination changes nothing');
  assert.equal(s.set({ enabled: false }).enabled, false);
  assert.equal(registered.size, 0);
  st = s.set({ enabled: true, reset: true });
  assert.deepEqual(st.keys, DEFAULT_KEYS);
  assert.equal(s.set('evil').enabled, true);
});

test('tray: the next five songs (jump to one) and the favourite button', () => {
  const real = Module._load;
  let template = null;
  Module._load = function load(request, ...rest) {
    if (request === 'electron') {
      return {
        Menu: { buildFromTemplate: (t) => { template = t; return t; } },
        Tray: function Tray() { return { on() {}, setToolTip() {}, setContextMenu() {}, destroy() {} }; },
        nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
      };
    }
    return real.call(this, request, ...rest);
  };
  try {
    delete require.cache[require.resolve('../../electron/tray')];
    const { createTray } = require('../../electron/tray');
    const sent = [];
    const tray = createTray({ icon: 'x', main: () => null, now: () => ({ title: 'Uno', artist: 'A', playing: true, liked: false, canLike: true, queue: [{ i: 4, title: 'Dos', artist: 'B' }, { i: 5, title: 'T\u0000res', artist: '' }] }), send: (c) => sent.push(c), quit() {} });
    tray.show();
    const labels = template.map((x) => x.label);
    assert.ok(labels.includes('Añadir a Favoritas'));
    assert.ok(labels.includes('A continuación'));
    const dos = template.find((x) => x.label === 'Dos · B');
    dos.click();
    assert.deepEqual(sent, [{ cmd: 'jump', value: 4 }]);
    assert.ok(template.some((x) => x.label === 'T res'), 'control characters out');
  } finally { Module._load = real; delete require.cache[require.resolve('../../electron/tray')]; }
});

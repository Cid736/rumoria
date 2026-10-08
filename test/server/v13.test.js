// v1.3: lists read again without losing what you did, Spotify's flaky pages,
// looking songs up ahead, forgetting a song that failed, the clip relay and
// the performance profile.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StreamLists } = require('../../server/lib/streamlists');
const { readImport } = require('../../server/lib/importlist');
const { Prefs } = require('../../server/lib/prefs');
const { startApp, VIDEO } = require('../helpers');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rum-v13-'));
const song = (artist, title, extra = {}) => ({ artist, title, query: `${artist} - ${title}`, ...extra });

test('a list read again: never emptied, songs you took out stay out, songs you added stay, videos found are kept', () => {
  const dir = tmp();
  try {
    const lists = new StreamLists(path.join(dir, 'l.json'));
    const l = lists.create({ name: 'Mix', source: 'spotify', url: 'https://open.spotify.com/playlist/37i9dQZF1EIZ4e7Z4XQ4e1', tracks: [song('A', 'Uno'), song('B', 'Dos'), song('C', 'Tres')] });
    lists.remember(l.id, 0, { id: 'aaaaaaaaaaa' }, 'A - Uno');
    lists.removeTracks(l.id, [1]); // "Dos" out
    lists.update(l.id, { add: [{ title: 'Mía', artist: 'Yo', yt: 'bbbbbbbbbbb' }] });
    assert.throws(() => lists.reread(l.id, []), /se queda como estaba/);
    assert.equal(lists.get(l.id).tracks.length, 3, 'an empty read changes nothing');
    const r = lists.reread(l.id, [song('A', 'Uno'), song('B', 'Dos'), song('C', 'Tres'), song('D', 'Cuatro')]);
    assert.deepEqual(r.list.tracks.map((t) => t.title), ['Uno', 'Tres', 'Cuatro', 'Mía']);
    assert.equal(r.list.tracks[0].yt, 'aaaaaaaaaaa', 'the video found is kept');
    assert.equal(r.added, 1);
    assert.equal(r.removed, 0);
    // Put back with "Deshacer": a re-read keeps it.
    lists.update(l.id, { insert: [{ at: 1, track: song('B', 'Dos') }] });
    assert.deepEqual(lists.reread(l.id, [song('A', 'Uno'), song('B', 'Dos')]).list.tracks.map((t) => t.title), ['Uno', 'Dos', 'Mía']);
    // Kept on disk.
    const again = new StreamLists(path.join(dir, 'l.json')).get(l.id);
    assert.ok(again.tracks.some((t) => t.mine));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Spotify: a page without the songs is read again (up to 4 times) before giving up', async () => {
  let n = 0;
  const page = (tracks) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: { name: 'Mix', trackList: tracks } } } } } })}</script>`;
  const flaky = async () => (++n < 3 ? '<html>nothing</html>' : page([{ title: 'Uno', subtitle: 'A', duration: 200000 }]));
  const r = await readImport('https://open.spotify.com/playlist/37i9dQZF1EIZ4e7Z4XQ4e1', { fetchText: flaky, wait: async () => {} });
  assert.equal(n, 3);
  assert.equal(r.tracks.length, 1);
  n = 0;
  await assert.rejects(readImport('https://open.spotify.com/playlist/37i9dQZF1EIZ4e7Z4XQ4e1', { fetchText: async () => { n++; return 'x'; }, wait: async () => {} }), /No se encontraron/);
  assert.equal(n, 4);
});

test('the performance profile: only known values, kept', () => {
  const dir = tmp();
  try {
    const p = new Prefs(path.join(dir, 'p.json'));
    assert.equal(p.get().perf, 'mid');
    assert.equal(p.set({ perf: 'high' }).perf, 'high');
    assert.equal(p.set({ perf: 'turbo' }).perf, 'high');
    assert.equal(new Prefs(path.join(dir, 'p.json')).get().perf, 'high');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('routes: refresh (one at a time, never empties), look ahead, forget, the clip relay, the profile', async () => {
  const calls = [];
  const yt = require('../helpers').fakeYouTube();
  yt.stream.prepare = (id) => { calls.push(['prepare', id]); return true; };
  yt.stream.forget = (id) => { calls.push(['forget', id]); return true; };
  const pipe = yt.stream.pipe;
  yt.stream.pipe = async (id, env, req, res, opts) => { calls.push(['pipe', id, opts && opts.kind, opts && opts.fresh]); return pipe(id, env, req, res); };
  let reads = 0;
  let impl = null;
  yt.readImport = (...a) => impl(...a);
  impl = async () => { reads++; await new Promise((r) => setTimeout(r, 30)); return { title: 'De Spotify', service: 'spotify', tracks: reads > 1 ? [] : [{ title: 'Song', artist: 'Band', duration: 180, query: 'Band - Song' }] }; };
  const app = await startApp({ yt });
  try {
    const made = await app.call('POST', '/api/lists/import', { body: { url: 'https://open.spotify.com/playlist/37i9dQZF1EIZ4e7Z4XQ4e1' } });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    reads = 0;
    impl = async () => { reads++; await new Promise((r) => setTimeout(r, 30)); return { title: 'x', service: 'spotify', tracks: [{ title: 'Song', artist: 'Band', query: 'Band - Song' }, { title: 'Otra', artist: 'Band', query: 'Band - Otra' }] }; };
    const [a, b] = await Promise.all([app.call('POST', `/api/lists/${made.data.id}/refresh`), app.call('POST', `/api/lists/${made.data.id}/refresh`)]);
    assert.equal(reads, 1, 'two clicks, one read');
    assert.equal(a.data.added, 1);
    assert.deepEqual(a.data, b.data);
    impl = async () => { throw new Error('No se encontraron canciones en ese enlace (¿es privado?).'); };
    const bad = await app.call('POST', `/api/lists/${made.data.id}/refresh`);
    assert.equal(bad.status, 400);
    assert.equal((await app.call('GET', `/api/lists/${made.data.id}`)).data.tracks.length, 2, 'the list stays as it was');

    assert.equal((await app.call('POST', `/api/stream/prepare?id=${VIDEO}`)).data.ok, true);
    assert.equal((await app.call('POST', `/api/stream/forget?id=${VIDEO}`)).data.ok, true);
    assert.equal((await app.call('POST', '/api/stream/prepare?id=../../x')).status, 400);
    await app.call('GET', `/api/stream/video?id=${VIDEO}`, { raw: true }).then((r) => r.text());
    await app.call('GET', `/api/stream/audio?id=${VIDEO}&fresh=1`, { raw: true }).then((r) => r.text());
    assert.deepEqual(calls.filter((c) => c[0] === 'pipe').map((c) => [c[2], c[3]]), [['video', false], ['audio', true]]);
    assert.ok(calls.some((c) => c[0] === 'prepare') && calls.some((c) => c[0] === 'forget'));

    assert.equal((await app.call('PATCH', '/api/prefs', { body: { perf: 'min' } })).data.perf, 'min');
    assert.equal((await app.call('POST', `/api/stream/prepare?id=${VIDEO}`)).data.ok, false, 'Recursos mínimos: nothing looked up ahead');
    assert.equal((await app.call('PATCH', '/api/prefs', { body: { perf: '<script>' } })).data.perf, 'min');
  } finally { await app.close(); }
});

test('a fresh look-up (after a failure) runs at most once per song every 10 s', async () => {
  const yt = require('../helpers').fakeYouTube();
  const seen = [];
  const pipe = yt.stream.pipe;
  yt.stream.pipe = async (id, env, req, res, opts) => { seen.push(opts.fresh); return pipe(id, env, req, res); };
  const app = await startApp({ yt });
  try {
    for (let i = 0; i < 3; i++) await app.call('GET', `/api/stream/audio?id=${VIDEO}&fresh=1`, { raw: true }).then((r) => r.text());
    assert.deepEqual(seen, [true, false, false]);
  } finally { await app.close(); }
});

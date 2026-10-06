// The local server end to end (integration): what the page asks, what it gets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startApp, VIDEO } = require('../helpers');

test('search: YouTube results, only real videos, in the page\'s shape', async () => {
  const app = await startApp();
  try {
    const r = await app.call('GET', '/api/search?q=queen');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.results.map((x) => x.id), [VIDEO, 'kJQP7kiw5Fk'], 'the non-video is dropped');
    assert.deepEqual(Object.keys(r.data.results[0]).sort(), ['channel', 'duration', 'id', 'thumbnail', 'title']);
    assert.equal((await app.call('GET', '/api/search?q=')).status, 400);
    assert.equal((await app.call('GET', `/api/search?q=${'x'.repeat(201)}`)).status, 400);
  } finally { await app.close(); }
});

test('playing: info, audio relayed with its Range, radio, lyrics', async () => {
  const app = await startApp();
  try {
    assert.equal((await app.call('GET', `/api/stream/info?id=${VIDEO}`)).data.title, 'Video');
    const res = await app.call('GET', `/api/stream/audio?id=${VIDEO}`, { headers: { Range: 'bytes=0-' }, raw: true });
    assert.equal(res.status, 206);
    assert.equal(await res.text(), 'AUDIO');
    assert.deepEqual(app.yt.calls.find((c) => c[0] === 'pipe'), ['pipe', VIDEO, 'bytes=0-']);
    assert.equal((await app.call('GET', `/api/stream/radio?id=${VIDEO}`)).data.entries[0].id, 'kJQP7kiw5Fk');
    const ly = await app.call('GET', `/api/stream/lyrics?id=${VIDEO}`);
    assert.deepEqual(ly.data.synced, [{ t: 1, text: 'hola' }]);
  } finally { await app.close(); }
});

test('lists: import from Spotify and YouTube, create, edit, find a song\'s video, delete and restore', async () => {
  const app = await startApp();
  try {
    const sp = await app.call('POST', '/api/lists/import', { body: { url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' } });
    assert.equal(sp.status, 200);
    assert.equal(sp.data.source, 'spotify');
    assert.equal(sp.data.tracks[0].query, 'Band - Song');
    const yt = await app.call('POST', '/api/lists/import', { body: { url: 'https://www.youtube.com/playlist?list=PLx' } });
    assert.equal(yt.data.source, 'youtube');
    assert.equal(yt.data.tracks[0].yt, VIDEO);
    assert.match((await app.call('POST', '/api/lists/import', { body: { url: 'https://example.com/list' } })).data.error, /Spotify, Apple Music o YouTube/);

    const own = await app.call('POST', '/api/lists', { body: { name: 'Mía', tracks: [{ title: 'A', artist: 'X' }, { title: 'B', artist: 'Y', yt: VIDEO }] } });
    assert.equal(own.status, 200);
    const id = own.data.id;
    const moved = await app.call('PATCH', `/api/lists/${id}`, { body: { move: { from: 1, to: 0 }, name: 'Renombrada' } });
    assert.deepEqual(moved.data.tracks.map((t) => t.title), ['B', 'A']);
    assert.equal(moved.data.name, 'Renombrada');

    // A song known by name → its video, remembered in its list.
    const found = await app.call('GET', `/api/find?q=${encodeURIComponent('X - A')}&d=200&list=${id}&n=1`);
    assert.equal(found.data.id, VIDEO);
    assert.equal((await app.call('GET', `/api/lists/${id}`)).data.tracks[1].yt, VIDEO);
    const searches = app.yt.calls.filter((c) => c[0] === 'search').length;
    await app.call('GET', `/api/find?q=${encodeURIComponent('X - A')}&d=200`);
    assert.equal(app.yt.calls.filter((c) => c[0] === 'search').length, searches, 'looked up once');

    const rm = await app.call('POST', `/api/lists/${id}/remove`, { body: { ns: [0] } });
    assert.deepEqual(rm.data.removed.map((x) => x.track.title), ['B']);
    assert.equal((await app.call('DELETE', `/api/lists/${id}`)).data.ok, true);
    assert.equal((await app.call('GET', `/api/lists/${id}`)).status, 404);
    assert.equal((await app.call('POST', `/api/lists/${id}/restore`)).data.name, 'Renombrada');
    assert.equal((await app.call('GET', '/api/lists')).data.lists.length, 3);
  } finally { await app.close(); }
});

test('history and favourites: noted, made into lists, paused, wiped', async () => {
  const app = await startApp();
  try {
    const song = { key: `yt:${VIDEO}`, title: 'Never Gonna', artist: 'Rick Astley', dur: 213 };
    assert.equal((await app.call('POST', '/api/history', { body: { song, secs: 120 } })).data.ok, true);
    assert.equal((await app.call('POST', '/api/history', { body: { song, secs: 2 } })).data.ok, false, 'too short');
    const smart = (await app.call('GET', '/api/history/smart')).data;
    assert.equal(smart.top[0].key, `yt:${VIDEO}`);
    assert.equal(smart.artists[0].name, 'Rick Astley');
    assert.equal((await app.call('GET', '/api/history/summary?year=2026&tz=-60')).status, 200);

    assert.equal((await app.call('POST', '/api/likes', { body: { song } })).data.count, 1);
    assert.equal((await app.call('POST', '/api/likes', { body: { song: { key: 'yt:bad', title: 'x' } } })).status, 400);
    assert.equal((await app.call('GET', '/api/likes')).data.songs[0].title, 'Never Gonna');
    assert.equal((await app.call('POST', '/api/likes/remove', { body: { key: song.key } })).data.count, 0);

    await app.call('PATCH', '/api/history/settings', { body: { paused: true } });
    assert.equal((await app.call('POST', '/api/history', { body: { song, secs: 120 } })).data.ok, false, 'paused');
    await app.call('DELETE', '/api/history');
    assert.equal((await app.call('GET', '/api/history/smart')).data.count, 0);
  } finally { await app.close(); }
});

test('your music: listed, served with seeking, nothing else', async () => {
  const music = fs.mkdtempSync(path.join(os.tmpdir(), 'esc-music-'));
  fs.writeFileSync(path.join(music, 'Band - Song.mp3'), Buffer.alloc(1000, 7));
  const app = await startApp({ musicDir: music });
  try {
    const list = (await app.call('GET', '/api/local')).data;
    assert.equal(list.folder, true);
    assert.equal(list.songs.length, 1);
    const res = await app.call('GET', `/api/local/file?id=${list.songs[0].id}`, { headers: { Range: 'bytes=10-19' }, raw: true });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-type'), 'audio/mpeg');
    assert.equal((await res.arrayBuffer()).byteLength, 10);
  } finally {
    await app.close();
    fs.rmSync(music, { recursive: true, force: true });
  }
});

test('the page itself is served (once built), with its security headers', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'esc-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Escuchar</title>');
  const app = await startApp({ staticDir: dist });
  try {
    const r = await app.call('GET', '/');
    assert.equal(r.status, 200);
    assert.match(r.data, /Escuchar/);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal((await app.call('GET', '/api/nope')).status, 404);
  } finally {
    await app.close();
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

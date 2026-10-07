// Your lists (lib/streamlists.js) and the YouTube side of playing (lib/stream.js).
// Carried over from TubeGrab (v3.7, v3.9, v3.11, v3.12) with the modules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const stream = require('../../server/lib/stream');
const { StreamLists, cleanTrack, cleanList, pickVideo, MAX_TRACKS } = require('../../server/lib/streamlists');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rum-lists-'));
const songs = (...names) => names.map((title) => ({ title, artist: 'X' }));

test('stream: only YouTube video ids, only YouTube media servers', () => {
  assert.ok(stream.isId('dQw4w9WgXcQ'));
  for (const bad of ['', 'dQw4w9WgXc', 'dQw4w9WgXcQQ', '../../etc/x', 'dQw4w9WgX&Q', null]) assert.equal(stream.isId(bad), false, String(bad));
  assert.ok(stream.MEDIA_HOST_RE.test('rr3---sn-h5qzen7s.googlevideo.com'));
  for (const bad of ['googlevideo.com.evil.com', 'evil.com', 'xgooglevideo.com', 'localhost', '127.0.0.1', 'rr3.googlevideo.com.']) assert.equal(stream.MEDIA_HOST_RE.test(bad), false, bad);
});

test('stream: "Artist - Title (Official Video)" → artist and song for the lyrics', () => {
  assert.deepEqual(stream.splitTitle('Daft Punk - Get Lucky (Official Audio)', 'Daft Punk'), { artist: 'Daft Punk', track: 'Get Lucky' });
  assert.deepEqual(stream.splitTitle('Yellow [Official Video]', 'Coldplay'), { artist: 'Coldplay', track: 'Yellow' });
  assert.deepEqual(stream.splitTitle('Tití Me Preguntó', 'Bad Bunny - Topic'), { artist: 'Bad Bunny', track: 'Tití Me Preguntó' });
});

test('stream: a bad id never reaches yt-dlp', async () => {
  await assert.rejects(stream.resolve('nope; rm -rf', { ytDlpPath: 'C:/does/not/exist.exe' }), /no válido/);
  assert.deepEqual(await stream.radio('x', {}, () => { throw new Error('should not run'); }), []);
});

test('lists: the YouTube video whose length matches the song (Topic uploads first)', () => {
  const rs = [
    { id: 'aaaaaaaaaaa', duration: 260, channel: 'Artist VEVO' },
    { id: 'bbbbbbbbbbb', duration: 213, channel: 'Somebody' },
    { id: 'ccccccccccc', duration: 212, channel: 'Artist - Topic' },
  ];
  assert.equal(pickVideo(rs, 212).id, 'ccccccccccc');
  assert.equal(pickVideo(rs, 250).id, 'aaaaaaaaaaa', 'near enough');
  assert.equal(pickVideo(rs, 100).id, 'aaaaaaaaaaa', 'none close: the first');
  assert.equal(pickVideo(rs, null).id, 'aaaaaaaaaaa');
  assert.equal(pickVideo([{ id: 'bad' }], 200), null);
});

test('lists: tracks are cleaned (texts, ids, only YouTube thumbnails)', () => {
  const t = cleanTrack({ title: 'Song\u0000\n', artist: 'A, B', duration: 201.6, yt: 'not-an-id', thumbnail: 'https://evil.example/x.jpg' });
  assert.deepEqual(t, { title: 'Song', artist: 'A, B', duration: 202, query: 'A - Song' });
  assert.equal(cleanTrack({ title: 'x', yt: 'dQw4w9WgXcQ', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }).thumbnail, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(cleanTrack({ title: '' }), null);
  assert.equal(cleanTrack('x'), null);
});

test('lists: saved, re-read keeping found videos, remembered, removed; a tampered file read safely', () => {
  const dir = tmp();
  const file = path.join(dir, 'stream-lists.json');
  try {
    const s = new StreamLists(file);
    assert.throws(() => s.create({ name: 'x', tracks: [] }), /no tiene canciones/);
    const l = s.create({ name: 'Top', source: 'spotify', url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', tracks: [{ title: 'One', artist: 'A' }, { title: 'Two', artist: 'B' }] });
    assert.match(l.id, /^[a-f0-9]{16}$/);
    s.remember(l.id, 0, { id: 'dQw4w9WgXcQ', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' });
    s.remember(l.id, 1, { id: 'evil' });
    const again = new StreamLists(file);
    assert.equal(again.get(l.id).tracks[0].yt, 'dQw4w9WgXcQ');
    assert.equal(again.get(l.id).tracks[1].yt, undefined);
    again.update(l.id, { tracks: [{ title: 'Two', artist: 'B' }, { title: 'One', artist: 'A' }, { title: 'Three', artist: 'C' }] });
    assert.equal(again.get(l.id).tracks[1].yt, 'dQw4w9WgXcQ', 'read again from the link: found videos stay');
    again.update(l.id, { name: '  Mi top  ', add: [{ title: 'Four' }] });
    assert.equal(again.get(l.id).name, 'Mi top');
    assert.equal(again.get(l.id).tracks.length, 4);
    const o = again.create({ name: 'o', url: 'javascript:alert(1)', tracks: [{ title: 'x' }] });
    assert.equal(o.url, null, 'only links of those services are kept');
    assert.equal(again.get('../../x'), null);
    const big = again.create({ name: 'big', tracks: Array.from({ length: MAX_TRACKS + 50 }, (_, i) => ({ title: `t${i}` })) });
    assert.equal(big.tracks.length, MAX_TRACKS);
    fs.writeFileSync(file, JSON.stringify([{ id: 'zz', name: 'bad' }, { id: 'aaaaaaaaaaaaaaaa', name: '<b>', source: 'evil', tracks: [{ title: 'ok' }, 5] }]));
    const t = new StreamLists(file);
    assert.equal(t.lists.length, 1);
    assert.equal(t.lists[0].source, 'own');
    assert.equal(t.lists[0].tracks.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('lists: folders, "keep it up to date" only for lists from a link, a mosaic of covers', () => {
  const dir = tmp();
  try {
    const s = new StreamLists(path.join(dir, 'l.json'));
    const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    const fromLink = s.create({ name: 'Top', source: 'spotify', url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', tracks: [{ title: 'One', artist: 'A' }] });
    const mine = s.create({ name: 'Mía', tracks: ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee'].map((id) => ({ title: id, yt: id, thumbnail: thumb(id) })) });
    assert.equal(fromLink.sync, true);
    assert.equal(mine.sync, false);
    s.update(mine.id, { folder: '  Para correr\u0000 ', sync: true });
    assert.equal(s.get(mine.id).folder, 'Para correr');
    assert.equal(s.get(mine.id).sync, false, 'no link, nothing to keep up to date');
    assert.equal(s.summary().find((l) => l.id === mine.id).thumbs.length, 4);
    assert.deepEqual(s.dueForSync(Date.now() + 13 * 3600 * 1000), [fromLink.id]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('lists: moved one or several, removed together and put back, a deleted list comes back for a while', () => {
  const dir = tmp();
  try {
    const s = new StreamLists(path.join(dir, 'l.json'));
    const l = s.create({ name: 'L', url: 'https://open.spotify.com/playlist/x', tracks: songs('A', 'B', 'C', 'D', 'E') });
    const order = () => s.get(l.id).tracks.map((t) => t.title).join('');
    s.update(l.id, { move: { from: 0, to: 2 } });
    assert.equal(order(), 'BCADE');
    for (const move of [{ from: -1, to: 0 }, { from: 0, to: 9 }, { from: 1.5, to: 0 }, { from: '1', to: 0 }, null]) s.update(l.id, { move });
    assert.equal(order(), 'BCADE', 'nonsense moves ignored');
    s.update(l.id, { moveMany: { from: [0, 2], to: 4 } });
    assert.equal(order(), 'CDBAE');
    const r = s.removeTracks(l.id, [4, 0, 0, 9, -1, 'x']);
    assert.deepEqual(r.removed.map((x) => [x.at, x.track.title]), [[0, 'C'], [4, 'E']]);
    s.update(l.id, { insert: r.removed });
    assert.equal(order(), 'CDBAE', 'back where they were');
    assert.equal(s.remove(l.id, 1000), true);
    assert.equal(s.restore(l.id, 2000).url, 'https://open.spotify.com/playlist/x');
    s.remove(l.id, 10000);
    assert.equal(s.restore(l.id, 10000 + 11 * 60 * 1000), null, 'too late');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('lists: the video found for a song goes to that song, even after the list changed', () => {
  const dir = tmp();
  try {
    const s = new StreamLists(path.join(dir, 'l.json'));
    const l = s.create({ name: 'L', tracks: [{ title: 'Uno', artist: 'A' }, { title: 'Dos', artist: 'B' }, { title: 'Tres', artist: 'C' }] });
    const dosQuery = s.get(l.id).tracks[1].query;
    s.removeTrack(l.id, 0);
    s.remember(l.id, 1, { id: 'dQw4w9WgXcQ' }, dosQuery);
    const t = s.get(l.id).tracks;
    assert.equal(t[0].yt, 'dQw4w9WgXcQ', 'the song looked up');
    assert.equal(t[1].yt, undefined, 'not its new neighbour');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('lists: a "keep downloaded" setting from TubeGrab is read safely (and kept, unused)', () => {
  assert.equal(cleanList({ id: 'b'.repeat(16), name: 'L', tracks: songs('a'), keep: { client: 'nope', opts: {} } }).keep, null);
  assert.equal(cleanList({ id: 'b'.repeat(16), name: 'L', tracks: songs('a'), keep: { client: 'a'.repeat(32), opts: { big: 'x'.repeat(4000) } } }).keep, null);
});

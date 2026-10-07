// "Explorar": ready-made lists from fixed searches, songs only, cached.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Browse, CATEGORIES, ALL, RADIOS, songsOf, findSongs, radioSongs, playlistSearchUrl } = require('../../server/lib/browse');
const { startApp, fakeYouTube } = require('../helpers');

const e = (id, title, duration = 200) => ({ id: id.padEnd(11, '0'), title, channel: 'C', duration, thumbnail: `https://i.ytimg.com/vi/${id.padEnd(11, '0')}/hqdefault.jpg` });
// Distinct 11-character ids: the prefix, then the number padded on the left.
const many = (prefix, n) => Array.from({ length: n }, (_, i) => e(`${prefix}${String(i).padStart(10, '0')}`, `${prefix} canción ${i}`));

test('explorar: only songs — no hour-long mixes, lives, compilations, shorts or repeats', () => {
  const got = songsOf([e('a', 'Canción (Official Audio)'), e('b', 'Top 50 Mix 2026', 3600), e('c', 'Tema (Live at X)'), e('d', 'Lo mejor - Álbum completo'),
    e('e', 'Short', 40), e('a', 'Canción (Official Audio)'), { id: 'bad', title: 'x' }, e('f', 'Otra canción'), e('g', 'Remix oficial')]);
  assert.deepEqual(got.map((x) => x.title), ['Canción (Official Audio)', 'Otra canción', 'Remix oficial'], '"Remix" is a song; "Mix" alone is not');
  assert.ok(CATEGORIES.length >= 30);
  assert.equal(new Set(ALL.map((c) => c.id)).size, ALL.length, 'no id twice');
  for (const c of ALL) assert.match(c.id, /^[a-z0-9-]+$/);
  assert.equal(RADIOS.find((r) => r.artist === 'Rosalía').id, 'radio-rosalia');
});

test('radios: one of the artist\'s songs first, then YouTube\'s mix of it (songs only)', async () => {
  const asked = [];
  const flatList = async (t) => {
    asked.push(t);
    if (t.startsWith('ytsearch8:')) return { entries: [e('x', 'Coldplay - Greatest Hits Mix', 4000), e('y', 'Coldplay - Yellow (Official Audio)')] };
    return { entries: [e('y', 'Coldplay - Yellow (Official Audio)'), e('z', 'Keane - Somewhere Only We Know'), e('w', 'Live set', 3000)] };
  };
  const songs = await radioSongs('Coldplay', flatList);
  assert.deepEqual(asked, ['ytsearch8:Coldplay official audio', 'https://www.youtube.com/watch?v=y0000000000&list=RDy0000000000']);
  assert.deepEqual(songs.map((s) => s.title), ['Coldplay - Yellow (Official Audio)', 'Keane - Somewhere Only We Know']);
  assert.deepEqual(await radioSongs('Nadie', async () => ({ entries: [] })), []);
});

test('explorar: the songs of the first playlists found, in turns; a plain search only if there are too few', async () => {
  const asked = [];
  const flatList = async (target) => {
    asked.push(target);
    if (target.startsWith('https://www.youtube.com/results?')) return { entries: [{ id: 'PLaaaaaaaaaaaaaaaa' }, { id: 'UCchannel000000000000000' }, { id: 'PLbbbbbbbbbbbbbbbb' }] };
    if (target.endsWith('PLaaaaaaaaaaaaaaaa')) return { entries: many('a', 12) };
    if (target.endsWith('PLbbbbbbbbbbbbbbbb')) return { entries: many('b', 12) };
    return { entries: [] };
  };
  const songs = await findSongs('rock', flatList);
  assert.equal(asked[0], playlistSearchUrl('rock'));
  assert.deepEqual(asked.slice(1), ['https://www.youtube.com/playlist?list=PLaaaaaaaaaaaaaaaa', 'https://www.youtube.com/playlist?list=PLbbbbbbbbbbbbbbbb'], 'playlists only (not a channel)');
  assert.deepEqual(songs.slice(0, 3).map((s) => s.title), ['a canción 0', 'b canción 0', 'a canción 1']);
  assert.equal(songs.length, 24);
  const few = [];
  await findSongs('x', async (t) => { few.push(t); return { entries: [] }; });
  assert.equal(few[1], 'ytsearch30:x official audio', 'no playlists: a plain search');
});

test('explorar: each list looked up once, kept on disk, old copy if YouTube fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rum-browse-'));
  let now = 1000;
  let calls = 0;
  try {
    const b = new Browse(path.join(dir, 'b.json'), { now: () => now });
    const flatList = async (t) => { calls++; return t.startsWith('ytsearch') ? { entries: many('z', 12) } : { entries: [] }; };
    assert.equal(await b.get('nope', flatList), null);
    const [x, y] = await Promise.all([b.get('exitos', flatList), b.get('exitos', flatList)]);
    assert.equal(calls, 2, 'two at once: one look-up (playlists, then a plain search)');
    assert.equal(x.tracks.length, 12);
    assert.deepEqual(y, x);
    assert.equal(b.list().find((l) => l.id === 'exitos').thumbs.length, 4, 'its covers, once read');
    const again = new Browse(path.join(dir, 'b.json'), { now: () => now });
    await again.get('exitos', flatList);
    assert.equal(calls, 2, 'from disk');
    now += 7 * 3600 * 1000;
    assert.equal((await again.get('exitos', async () => null)).tracks.length, 12, 'stale, but YouTube gave nothing: the old copy');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('explorar: a poor answer never replaces a good list; stale lists are read again; covers only from YouTube', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rum-browse-'));
  let now = 1000;
  try {
    const b = new Browse(path.join(dir, 'b.json'), { now: () => now });
    await b.get('rock', async (t) => (t.startsWith('ytsearch') ? { entries: many('g', 30) } : { entries: [] }));
    assert.equal(b.isFresh('rock'), true);
    assert.equal(b.isFresh('pop'), false, 'never read');
    now += 7 * 3600 * 1000;
    assert.equal(b.isFresh('rock'), false, 'six hours later: worth reading again (in the background)');
    const poor = await b.get('rock', async (t) => (t.startsWith('ytsearch') ? { entries: many('p', 3) } : { entries: [] }));
    assert.equal(poor.tracks.length, 30, 'YouTube half-answered: the good list stays');
    assert.equal(b.cache.rock.tracks[0].title, 'g canción 0');
    assert.deepEqual(songsOf([{ ...e('h', 'Canción'), thumbnail: 'https://evil.example/x.jpg' }, { ...e('i', 'Otra'), thumbnail: 'javascript:alert(1)' }]).map((s) => s.thumbnail), [null, null]);
    fs.writeFileSync(path.join(dir, 'c.json'), JSON.stringify({ rock: { at: now, tracks: [{ ...e('j', 'De disco'), thumbnail: 'http://i.ytimg.com/vi/x' }] } }));
    assert.equal(new Browse(path.join(dir, 'c.json'), { now: () => now }).cache.rock.tracks[0].thumbnail, null, 'what is read back from disk is checked again');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('explorar: the routes — fixed searches per list, never text from the page', async () => {
  const yt = fakeYouTube();
  const app = await startApp({ yt });
  try {
    const all = await app.call('GET', '/api/browse');
    assert.equal(all.data.lists.length, ALL.length);
    assert.equal(all.data.lists.find((l) => l.id === 'radio-coldplay').group, 'radio');
    const l = await app.call('GET', '/api/browse/focus?q=--exec%20calc');
    assert.equal(l.status, 200);
    assert.equal(l.data.name, 'Para concentrarse');
    const targets = yt.calls.filter((c) => c[0] === 'flatList').map((c) => c[1]);
    assert.equal(targets[0], playlistSearchUrl('lofi instrumental'));
    assert.ok(targets.every((t) => !t.includes('calc')), 'nothing from the request');
    for (const id of ['nope', '..%2F..%2Fx', 'EXITOS', '__proto__']) assert.equal((await app.call('GET', `/api/browse/${id}`)).status, 404, id);
  } finally { await app.close(); }
});

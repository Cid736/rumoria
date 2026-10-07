// "Para ti": ready-made lists for everyone, then your genres (from what you
// play) and one predicted genre to discover, rotated every few days. Lists
// you touch are yours; a genre you delete stays away. Nothing is downloaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Curator, scoreGenres, predictNext, plan, artistsByCategory, cleanArtist, sameArtist, unplaced, FOLDER } = require('../../server/lib/curator');
const { StreamLists } = require('../../server/lib/streamlists');
const { CATEGORIES } = require('../../server/lib/browse');
const { splitTitle } = require('../../server/lib/stream');
const { startApp } = require('../helpers');

const DAY = 24 * 3600 * 1000;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rum-cur-'));
let n = 0;
const vid = () => `c${String(++n).padStart(10, '0')}`;
const t = (artist, title) => ({ id: vid(), title: `${artist} - ${title}`, channel: 'Canal' });
// Explorar, read: rock and metal share Metallica and Iron Maiden; pop shares one with punk (chance).
const cache = {
  rock: { at: 1, tracks: [t('Queen', 'Bohemian Rhapsody'), t('AC/DC', 'Back in Black'), t('Metallica', 'Nothing Else Matters'), t('Iron Maiden', 'Run to the Hills')] },
  metal: { at: 1, tracks: [t('Metallica', 'One'), t('Iron Maiden', 'The Trooper'), t('Slayer', 'Raining Blood')] },
  punk: { at: 1, tracks: [t('Green Day', 'Basket Case'), t('AC/DC', 'TNT')] },
  pop: { at: 1, tracks: [t('Dua Lipa', 'Levitating'), t('Green Day', 'Boulevard')] },
};
const songs = (q) => [{ title: `${q} 1`, artist: 'Otro', yt: vid() }, { title: 'Bohemian Rhapsody', artist: 'Queen', yt: vid() }, { title: `${q} 2`, artist: 'Otro', yt: vid() }];
const fill = async (q) => songs(q);

test('genres from what you play, and a prediction of what to discover next', () => {
  const byCat = artistsByCategory(cache, CATEGORIES, splitTitle);
  assert.ok(byCat.get('rock').has('queen'));
  const genres = scoreGenres([{ name: 'Queen', plays: 30 }, { name: 'AC/DC', plays: 10 }, { name: 'Nadie', plays: 99 }], byCat);
  assert.deepEqual(genres.map((g) => g.id), ['rock', 'punk'], 'rock: Queen + AC/DC; punk: AC/DC');
  assert.equal(genres[0].score, 40);
  assert.equal(predictNext(genres, byCat), 'metal', 'shares Metallica and Iron Maiden with rock');
  assert.equal(predictNext(genres, byCat, { exclude: new Set(['metal']) }), null, 'pop shares only Green Day: chance, not a guess');
  const p = plan({ genres, byCat, categories: CATEGORIES });
  assert.deepEqual(p.slice(0, 3), [{ id: 'rock', kind: 'genre' }, { id: 'punk', kind: 'genre' }, { id: 'metal', kind: 'discover' }]);
  assert.equal(p.length, 6, 'filled up with ready-made ones');
  assert.ok(p.slice(3).every((x) => x.kind === 'starter'));
  // Nobody listened to anything yet: the ready-made ones.
  const fresh = plan({ genres: [], byCat, categories: CATEGORIES });
  assert.deepEqual(fresh.map((x) => x.id), CATEGORIES.filter((c) => c.featured).slice(0, 6).map((c) => c.id));
});

test('artist names from YouTube channels are cleaned and matched across spellings', () => {
  assert.equal(cleanArtist('SPYAIR Official YouTube Channel'), 'spyair');
  assert.equal(cleanArtist('Kenshi Yonezu - Topic'), 'kenshi yonezu');
  assert.equal(cleanArtist('ShakiraVEVO'), 'shakira');
  assert.equal(cleanArtist('ROSALÍA'), 'rosalia');
  assert.ok(sameArtist('kenshi yonezu', '米津玄師 kenshi yonezu'));
  assert.ok(!sameArtist('dax', 'daxter'), 'short names only when equal');
  assert.ok(!sameArtist('queen', 'queens of the stone age'), 'whole words only');
  const byCat = artistsByCategory({ jpop: { at: 1, tracks: [{ id: 'a', title: '「アイドル」', channel: 'YOASOBI Official YouTube Channel' }, { id: 'b', title: 'x', channel: '米津玄師 Kenshi Yonezu' }] } }, CATEGORIES, splitTitle);
  assert.deepEqual(scoreGenres([{ name: 'YOASOBI', plays: 2 }, { name: 'Kenshi Yonezu', plays: 1 }], byCat), [{ id: 'jpop', score: 3 }]);
});

test('an artist no category knows: their genre from the artists YouTube plays next to them', async () => {
  const dir = tmp();
  try {
    const lists = new StreamLists(path.join(dir, 'l.json'));
    const cur = new Curator(path.join(dir, 'c.json'));
    const asked = [];
    const similar = async (yt) => { asked.push(yt); return ['Cris Leiva', 'Queen', 'AC/DC', 'Alguien']; };
    const smart = { artists: [{ name: 'Cris Leiva', plays: 100, seed: { yt: 'aaaaaaaaaaa' } }], top: [] };
    assert.deepEqual(unplaced(smart.artists, artistsByCategory(cache, CATEGORIES, splitTitle)).map((a) => a.name), ['Cris Leiva']);
    await cur.run({ lists, smart, browse: { cache }, categories: CATEGORIES, splitTitle, fill, similar, force: true });
    assert.deepEqual(asked, ['aaaaaaaaaaa']);
    assert.equal(cur.state.genres[0].id, 'rock', 'Queen and AC/DC play next to them: rock');
    assert.ok(lists.lists.some((l) => l.name === 'Rock de siempre para ti'));
    // Remembered for a month: not asked again.
    await cur.run({ lists, smart, browse: { cache }, categories: CATEGORIES, splitTitle, fill, similar, force: true });
    assert.equal(asked.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('everyone starts with ready-made lists in "Para ti"; as you listen they become yours, rotated; touched or deleted ones are respected', async () => {
  const dir = tmp();
  let now = 10 * DAY;
  try {
    const lists = new StreamLists(path.join(dir, 'l.json'));
    const cur = new Curator(path.join(dir, 'c.json'), { now: () => now });
    const browse = { cache: {} };
    // A new install: nothing listened, Explorar not read yet.
    let r = await cur.run({ lists, smart: null, browse, categories: CATEGORIES, splitTitle, fill });
    assert.equal(r.made.length, 6);
    const ours = () => lists.lists.filter((l) => l.auto && l.auto.by === 'rumoria');
    assert.ok(ours().every((l) => l.folder === FOLDER && l.source === 'auto' && l.tracks.every((x) => x.yt)), 'lists that fill themselves, nothing downloaded');
    assert.equal((await cur.run({ lists, smart: null, browse, categories: CATEGORIES, splitTitle, fill })).made.length, 0, 'not due: left alone');

    // You listen to Queen; Explorar gets read: your genres can be told, so at once.
    browse.cache = cache;
    const smart = { artists: [{ name: 'Queen', plays: 30 }, { name: 'AC/DC', plays: 5 }], top: [] };
    // You renamed one of ours: it's yours now.
    const keep = ours().find((l) => l.auto.cat === 'chill') || ours()[5];
    lists.update(keep.id, { name: 'Mi lista tranquila' });
    r = await cur.run({ lists, smart, browse, categories: CATEGORIES, splitTitle, fill });
    const names = ours().map((l) => l.name);
    assert.ok(names.includes('Rock de siempre para ti'), names.join(', '));
    assert.ok(names.some((x) => x.startsWith('Descubre: ')), 'one to discover');
    assert.equal(ours().length, 6);
    assert.ok(lists.get(keep.id), 'the renamed list stays');
    assert.equal(lists.get(keep.id).auto.by, undefined);
    const rock = ours().find((l) => l.auto.cat === 'rock');
    assert.equal(rock.tracks[0].artist, 'Queen', 'your artists first');
    assert.deepEqual(cur.view(CATEGORIES).genres.map((g) => g.id).slice(0, 1), ['rock']);

    // You deleted the rock one: next rotation (a week on), rock stays away.
    cur.dismiss('rock');
    lists.remove(rock.id);
    now += 8 * DAY;
    await cur.run({ lists, smart, browse, categories: CATEGORIES, splitTitle, fill });
    assert.ok(!ours().some((l) => l.auto.cat === 'rock'));
    assert.equal(ours().length, 6);

    // Switched off: nothing changes any more.
    cur.set({ enabled: false });
    now += 30 * DAY;
    assert.deepEqual(await cur.run({ lists, smart, browse, categories: CATEGORIES, splitTitle, fill }), { made: [], removed: [] });
    // Read back from disk the same.
    const again = new Curator(path.join(dir, 'c.json'), { now: () => now });
    assert.equal(again.state.enabled, false);
    assert.ok(again.dismissedNow().has('rock'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the routes: see it, switch it, run it; deleting one of ours keeps its genre away', async () => {
  const app = await startApp();
  try {
    let v = await app.call('GET', '/api/curator');
    assert.equal(v.data.enabled, true);
    assert.equal(v.data.every, 7);
    v = await app.call('PATCH', '/api/curator', { body: { every: 3, enabled: true } });
    assert.equal(v.data.every, 3);
    assert.equal((await app.call('PATCH', '/api/curator', { body: { every: 5 } })).data.every, 3, 'only 3, 7 or 14 days');
    const run = await app.call('POST', '/api/curator/run');
    assert.equal(run.status, 200, JSON.stringify(run.data));
    assert.equal(run.data.made, 6);
    const lists = (await app.call('GET', '/api/lists')).data.lists.filter((l) => l.folder === 'Para ti');
    assert.equal(lists.length, 6);
    assert.ok(lists.every((l) => l.auto && l.auto.by === 'rumoria'));
    const cat = app.state.lists.get(lists[0].id).auto.cat;
    await app.call('DELETE', `/api/lists/${lists[0].id}`);
    assert.ok(JSON.parse(fs.readFileSync(path.join(app.dataDir, 'curator.json'), 'utf8')).dismissed[cat] > Date.now());
  } finally { await app.close(); }
});

// v1.4: Inicio's rotating shelves get your genres from the server, and every
// popular radio says which categories it belongs to.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORIES, RADIOS } = require('../../server/lib/browse');
const { startApp } = require('../helpers');

test('every popular radio: a known category for each of its tags, ids once each, the first twelve featured', () => {
  const cats = new Set(CATEGORIES.map((c) => c.id));
  for (const r of RADIOS) {
    assert.ok(r.tags.length > 0, r.artist);
    for (const t of r.tags) assert.ok(cats.has(t), `${r.artist}: ${t}`);
    assert.match(r.id, /^radio-[a-z0-9-]+$/);
  }
  assert.equal(new Set(RADIOS.map((r) => r.id)).size, RADIOS.length);
  assert.equal(RADIOS.filter((r) => r.featured).length, 12);
  assert.ok(RADIOS.length >= 40);
});

test('/api/browse: your genres (from what you play, worked out here) and the radios\' tags', async () => {
  const app = await startApp();
  try {
    const { browse, history } = app.state;
    const songs = [['xxxxxxxxxx1', 'Queen - Bohemian Rhapsody'], ['xxxxxxxxxx2', 'Queen - Somebody to Love'], ['xxxxxxxxxx3', 'AC/DC - Thunderstruck']];
    browse.cache.rock = { at: Date.now(), tracks: songs.map(([id, title]) => ({ id, title, channel: null, duration: 200, thumbnail: null })) };
    let r = await app.call('GET', '/api/browse');
    assert.deepEqual(r.data.taste, [], 'nothing heard yet');
    const radio = r.data.lists.find((l) => l.id === 'radio-queen');
    assert.deepEqual(radio.tags, ['rock', 'ochentas']);
    assert.equal(radio.artist, 'Queen');
    assert.equal(r.data.lists.find((l) => l.id === 'rock').tags, undefined);
    for (let i = 0; i < 3; i++) history.add({ key: 'yt:xxxxxxxxxx1', title: 'Bohemian Rhapsody', artist: 'Queen', yt: 'xxxxxxxxxx1' }, 200);
    app.state.curator._taste = null; // kept a minute; not in a test
    r = await app.call('GET', '/api/browse');
    assert.equal(r.data.taste[0].id, 'rock');
    assert.ok(r.data.taste[0].score > 0);
    // Paused history: no genres.
    history.settings({ paused: true });
    app.state.curator._taste = null;
    assert.deepEqual((await app.call('GET', '/api/browse')).data.taste, []);
  } finally { await app.close(); }
});

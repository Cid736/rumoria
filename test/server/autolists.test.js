// Lists that fill themselves from a topic: titles and YouTube ids only (no
// downloads), new songs first, songs you took out never come back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StreamLists, AUTO_MAX } = require('../../server/lib/streamlists');
const { startApp, VIDEO } = require('../helpers');

const id = (n) => `v${String(n).padStart(10, '0')}`;
const song = (n) => ({ title: `Canción ${n}`, artist: 'Grupo', yt: id(n), thumbnail: `https://i.ytimg.com/vi/${id(n)}/hqdefault.jpg` });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rum-auto-'));

test('fills itself: new songs on top, none twice, the ones you took out never come back, capped', () => {
  const dir = tmp();
  try {
    const lists = new StreamLists(path.join(dir, 'l.json'));
    const l = lists.create({ name: 'Rock de los 80', tracks: [song(1), song(2), song(3)], auto: { q: 'rock de los 80', every: 12 }, folder: 'Rock' });
    assert.equal(l.source, 'auto');
    assert.equal(l.folder, 'Rock');
    assert.deepEqual({ q: l.auto.q, every: l.auto.every }, { q: 'rock de los 80', every: 12 });
    assert.ok(l.tracks.every((t) => !('file' in t) && t.yt), 'titles and ids only — nothing downloaded');

    lists.removeTracks(l.id, [1]); // "Canción 2" out
    const r = lists.autoFill(l.id, [song(2), song(3), song(4), song(4), song(5)]);
    assert.equal(r.added, 2, 'only 4 and 5: 3 is there, 2 was taken out, 4 once');
    assert.deepEqual(r.list.tracks.map((t) => t.title), ['Canción 4', 'Canción 5', 'Canción 1', 'Canción 3']);

    lists.removeTrack(l.id, 0); // "Canción 4" out, the other way
    assert.equal(lists.autoFill(l.id, [song(4)]).added, 0);

    const many = Array.from({ length: AUTO_MAX + 30 }, (_, i) => song(100 + i));
    assert.equal(lists.autoFill(l.id, many).list.tracks.length, AUTO_MAX, 'the oldest fall off');

    // Saved and read back the same.
    const again = new StreamLists(path.join(dir, 'l.json')).get(l.id);
    assert.equal(again.auto.q, 'rock de los 80');
    assert.ok(again.auto.blocked.includes(id(2)) && again.auto.blocked.includes(id(4)));
    assert.equal(lists.summary()[0].auto.every, 12);
    assert.equal(lists.summary()[0].auto.blocked, undefined, 'the summary doesn\'t carry the blocked list');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fills itself: when it is due, how often, and stopping it', () => {
  const dir = tmp();
  try {
    const lists = new StreamLists(path.join(dir, 'l.json'));
    const l = lists.create({ name: 'Lo-fi', tracks: [song(1)], auto: { q: 'lofi', every: 6 } });
    const now = Date.now();
    assert.deepEqual(lists.dueForAuto(now), []);
    assert.deepEqual(lists.dueForAuto(now + 7 * 3600e3), [l.id]);
    lists.update(l.id, { auto: { every: 168 } });
    assert.deepEqual(lists.dueForAuto(now + 7 * 3600e3), [], 'once a week now');
    lists.update(l.id, { auto: { every: 5 } });
    assert.equal(lists.get(l.id).auto.every, 168, 'only 6, 12, 24 or 168 hours');
    lists.update(l.id, { auto: null });
    assert.equal(lists.get(l.id).auto, null);
    assert.equal(lists.get(l.id).source, 'own', 'stays as a list of yours');
    assert.equal(lists.autoFill(l.id, [song(9)]), null);
    // Odd values from disk are cleaned.
    const bad = lists.create({ name: 'x', tracks: [song(1)], auto: { q: '   ', every: 24 } });
    assert.equal(bad.auto, null, 'no topic, not filling itself');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the route: made from the topic now (only fixed YouTube targets, after "--"), refreshed on demand and in the background', async () => {
  const app = await startApp();
  try {
    const r = await app.call('POST', '/api/lists/auto', { body: { q: '  --exec calc\u0000 rock  ', every: 6, folder: 'Rock' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.source, 'auto');
    assert.equal(r.data.auto.q, '--exec calc rock');
    assert.equal(r.data.folder, 'Rock');
    assert.ok(r.data.tracks.length >= 1);
    assert.ok(r.data.tracks.every((t) => /^[A-Za-z0-9_-]{11}$/.test(t.yt)), 'YouTube ids, nothing downloaded');
    const targets = app.yt.calls.filter((c) => c[0] === 'flatList').map((c) => c[1]);
    assert.ok(targets.length && targets.every((t) => t.startsWith('https://www.youtube.com/') || t.startsWith('ytsearch')), 'the topic is never an option');
    assert.ok(!targets.some((t) => t.startsWith('-')));

    // Refreshing: nothing new from the same answers.
    const again = await app.call('POST', `/api/lists/${r.data.id}/refresh`);
    assert.equal(again.status, 200);
    assert.equal(again.data.added, 0);

    // In the background, only when due.
    const gone = app.state.lists.get(r.data.id).tracks[0].yt;
    app.state.lists.removeTracks(r.data.id, [0]);
    let before = app.yt.calls.length;
    await app.run.fillAutoLists();
    assert.equal(app.yt.calls.length, before, 'not due yet: YouTube not asked');
    app.state.lists.get(r.data.id).auto.at = 0;
    before = app.yt.calls.length;
    await app.run.fillAutoLists();
    assert.ok(app.yt.calls.length > before, 'due: looked again');
    assert.ok(app.state.lists.get(r.data.id).auto.at > 0);
    assert.ok(!app.state.lists.get(r.data.id).tracks.some((t) => t.yt === gone), 'the song taken out stays out');
    assert.ok([VIDEO, 'kJQP7kiw5Fk'].includes(gone));

    assert.equal((await app.call('POST', '/api/lists/auto', { body: { q: '   ' } })).status, 400);
    assert.equal((await app.call('PATCH', `/api/lists/${r.data.id}`, { body: { auto: null } })).data.auto, null);
  } finally { await app.close(); }
});

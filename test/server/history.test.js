// What you listen to, favourites and news of your artists (carried over from TubeGrab v3.9, v3.11, v3.13).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ListenLog, cleanSong, mainArtist } = require('../../server/lib/listenlog');
const { Likes } = require('../../server/lib/likes');
const { News, isTheirs } = require('../../server/lib/news');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'clm-history-'));
const song = (id, title, artist, extra = {}) => ({ key: `yt:${id}`, title, artist, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, dur: 200, ...extra });

test('history: only songs we know how to name, cleaned', () => {
  assert.equal(cleanSong({ key: 'yt:short', title: 'x' }), null);
  assert.equal(cleanSong({ key: 'http://evil', title: 'x' }), null);
  assert.equal(cleanSong({ key: 'f:a\u0000b', title: 'x' }), null);
  const c = cleanSong({ key: 'yt:dQw4w9WgXcQ', title: ' Never\nGonna ', artist: 'Rick', thumb: 'https://evil.example/x.jpg', dur: -5 });
  assert.deepEqual(c, { title: 'Never Gonna', artist: 'Rick', yt: 'dQw4w9WgXcQ' });
  assert.equal(mainArtist('Bad Bunny, Jhay Cortez feat. X'), 'Bad Bunny');
});

test('history: plays, smart lists, a yearly summary, kept on disk, paused, wiped', () => {
  const dir = tmp();
  const file = path.join(dir, 'h.json');
  let now = Date.UTC(2026, 2, 10, 20, 0, 0);
  try {
    const log = new ListenLog(file, { now: () => now });
    assert.equal(log.add(song('aaaaaaaaaaa', 'Uno', 'Artista A'), 3), null, 'under 5 s: not kept');
    assert.equal(log.add(song('aaaaaaaaaaa', 'Uno', 'Artista A'), 20), 0, 'heard, not a play yet');
    assert.equal(log.add(song('aaaaaaaaaaa', 'Uno', 'Artista A'), 120), 1);
    for (let i = 0; i < 3; i++) log.add(song('bbbbbbbbbbb', 'Dos', 'Artista B, Otro'), 180);
    now = Date.UTC(2026, 6, 1, 9, 0, 0);
    log.add(song('aaaaaaaaaaa', 'Uno', 'Artista A'), 200);
    const s = log.smart();
    assert.deepEqual(s.top.map((x) => x.title), ['Uno'], 'last 90 days only');
    assert.deepEqual(s.forgotten.map((x) => x.title), ['Dos']);
    assert.equal(s.artists[0].seed.yt, 'aaaaaaaaaaa');
    const y = log.summary(2026, 0);
    assert.equal(y.plays, 5);
    assert.deepEqual(new ListenLog(file, { now: () => now }).summary(2026, 0), y, 'read back the same');
    log.settings({ paused: true });
    assert.equal(log.add(song('ccccccccccc', 'Cuatro', 'D'), 100), null);
    log.clear();
    assert.equal(new ListenLog(file).events.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('history: a tampered file is read safely', () => {
  const dir = tmp();
  const file = path.join(dir, 'h.json');
  try {
    fs.writeFileSync(file, JSON.stringify({
      tracks: { 'yt:aaaaaaaaaaa': { title: 'ok' }, 'yt:../../x': { title: 'evil' }, 'f:x': { title: '' } },
      events: [[1, 'yt:aaaaaaaaaaa', 60], [2, 'yt:../../x', 60], ['3', 'yt:aaaaaaaaaaa', 60], [4, 'yt:aaaaaaaaaaa', 1e9], 'nope'],
    }));
    const log = new ListenLog(file);
    assert.deepEqual([...log.tracks.keys()], ['yt:aaaaaaaaaaa']);
    assert.deepEqual(log.events, [[1, 'yt:aaaaaaaaaaa', 60]]);
    fs.writeFileSync(file, '{broken');
    assert.equal(new ListenLog(file).events.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('favourites: added once, newest first, kept on disk, removed; junk refused', () => {
  const dir = tmp();
  const file = path.join(dir, 'likes.json');
  let now = 1000;
  try {
    const l = new Likes(file, { now: () => now });
    assert.equal(l.add({ key: 'yt:dQw4w9WgXcQ', title: 'Never Gonna', artist: 'Rick' }), 1);
    now = 2000;
    assert.equal(l.add({ key: 'f:Queen - Bohemian.mp3', title: 'Bohemian', artist: 'Queen' }), 2);
    now = 3000;
    assert.equal(l.add({ key: 'yt:dQw4w9WgXcQ', title: 'Never Gonna', artist: 'Rick' }), 2, 'once');
    assert.deepEqual(l.list().map((s) => s.key), ['yt:dQw4w9WgXcQ', 'f:Queen - Bohemian.mp3']);
    for (const bad of [null, {}, { key: 'yt:short', title: 'x' }, { key: 'http://evil', title: 'x' }, { key: 'yt:dQw4w9WgXcQ', title: '' }]) assert.equal(l.add(bad), null);
    assert.equal(new Likes(file).remove('yt:dQw4w9WgXcQ'), 1);
    fs.writeFileSync(file, '{not json');
    assert.equal(new Likes(file).list().length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('news: the first look only notes; later, a new song by them (not a live, a cover…) is news', async () => {
  const dir = tmp();
  try {
    const n = new News(path.join(dir, 'news.json'), { now: () => 1000 });
    const e = (id, title, extra = {}) => ({ id: id.padEnd(11, '0'), title, channel: 'Bad Bunny', duration: 200, ...extra });
    assert.deepEqual(n.take('Bad Bunny', [e('a', 'Old song')]), [], 'first look');
    const found = n.take('Bad Bunny', [e('b', 'NUEVO TEMA'), e('c', 'Show (Live at X)'), e('d', 'Song (Cover)'), e('e', 'Short', { duration: 30 }), e('f', 'Other', { channel: 'Fan Channel' })]);
    assert.deepEqual(found.map((x) => x.title), ['NUEVO TEMA']);
    assert.equal(isTheirs(e('g', 'x', { channel: 'Bad Bunny - Topic' }), 'Bad Bunny'), true);
    await n.check(['Nadie'], { findChannel: async () => 'javascript:alert(1)', newest: async () => { throw new Error('never'); } });
    assert.equal(n.channels.nadie, '', 'a bad channel is never used');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// v1.7: smart lists (rules over your library), the year in numbers
// (Estadísticas), "Tal día como hoy" and translated lyrics.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ListenLog } = require('../../server/lib/listenlog');
const { RuleLists, cleanRules, evaluate } = require('../../server/lib/rulelists');
const stats = require('../../server/lib/stats');
const { translateLines, TranslationCache } = require('../../server/lib/translate');
const { Prefs } = require('../../server/lib/prefs');
const { startApp, fakeYouTube, VIDEO } = require('../helpers');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rum-v17-'));
const DAY = 86400 * 1000;
const song = (id, title, artist, dur = 200) => ({ key: `yt:${id}`, title, artist, dur });
const A = song('aaaaaaaaaaa', 'Uno', 'Ana');
const B = song('bbbbbbbbbbb', 'Dos', 'Beto');
const C = song('ccccccccccc', 'Tres', 'Carla');

/** A history with a clock we move: [[daysAgo, song, secs], …]. */
function historyAt(now, plays) {
  const dir = tmp();
  let t = now;
  const log = new ListenLog(path.join(dir, 'h.json'), { now: () => t });
  for (const [ago, s, secs] of plays) { t = now - ago * DAY; log.add(s, secs); }
  t = now;
  return { log, dir };
}

test('rules: only known rules and values', () => {
  const r = cleanRules({ from: 'everything', minPlays: '20', maxPlays: -1, notHeardDays: 90.5, heardDays: 99999, artist: 'Ana\u0000 ', sort: 'evil', limit: 7, extra: 1 });
  assert.deepEqual(r, { from: 'likes', minPlays: 20, maxPlays: null, notHeardDays: null, heardDays: null, addedDays: null, artist: 'Ana', sort: 'plays', limit: 100 });
  assert.equal(cleanRules(null).from, 'likes');
});

test('rules: favourites not heard lately, most played, added this month, by artist', () => {
  const now = Date.UTC(2026, 9, 11, 12);
  const likes = [{ ...A, yt: 'aaaaaaaaaaa', at: now - 5 * DAY }, { ...B, yt: 'bbbbbbbbbbb', at: now - 200 * DAY }];
  const heard = new Map([
    [A.key, { ...A, plays: 25, last: (now - 2 * DAY) / 1000 }],
    [B.key, { ...B, plays: 3, last: (now - 120 * DAY) / 1000 }],
    [C.key, { ...C, plays: 40, last: (now - 1 * DAY) / 1000 }],
  ]);
  const keys = (rules) => evaluate(rules, { likes, heard, now }).map((s) => s.key);
  assert.deepEqual(keys({ notHeardDays: 90 }), [B.key], 'favourites not heard in 3 months');
  assert.deepEqual(keys({ from: 'all', minPlays: 20 }), [C.key, A.key], 'played 20 times or more, most first');
  assert.deepEqual(keys({ addedDays: 30 }), [A.key], 'favourites added this month');
  assert.deepEqual(keys({ from: 'heard', artist: 'carla' }), [C.key]);
  assert.deepEqual(keys({ from: 'heard', maxPlays: 5 }), [B.key]);
  assert.deepEqual(keys({ from: 'all', sort: 'title' }), [B.key, C.key, A.key]);
  assert.deepEqual(keys({ from: 'all', heardDays: 7, sort: 'recent' }), [C.key, A.key]);
  assert.equal(evaluate({ from: 'all', limit: 25 }, { likes, heard, now }).length, 3);
  // A favourite never heard: 0 plays, and "not heard in N days" holds.
  const never = [{ key: 'yt:ddddddddddd', title: 'Cuatro', artist: 'Dani', at: now }];
  assert.deepEqual(evaluate({ notHeardDays: 30, maxPlays: 0 }, { likes: never, heard, now }).map((s) => s.plays), [0]);
});

test('rule lists: kept on disk, cleaned when read back, at most 50', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'r.json');
    const r = new RuleLists(f);
    assert.throws(() => r.create({ name: '  ' }), /nombre/);
    const l = r.create({ name: 'Olvidadas', rules: { notHeardDays: 90 } });
    assert.match(l.id, /^[a-f0-9]{16}$/);
    r.update(l.id, { name: 'Favoritas olvidadas', rules: { notHeardDays: 60, sort: 'random' } });
    assert.equal(r.update('ffffffffffffffff', { name: 'x' }), null);
    const again = new RuleLists(f);
    assert.equal(again.get(l.id).name, 'Favoritas olvidadas');
    assert.equal(again.get(l.id).rules.notHeardDays, 60);
    fs.writeFileSync(f, JSON.stringify({ lists: [{ id: '../x', name: 'a' }, { id: 'aaaaaaaaaaaaaaaa', name: '' }, { id: 'bbbbbbbbbbbbbbbb', name: 'Ok', rules: { minPlays: 'lots' } }] }));
    assert.deepEqual(new RuleLists(f).list().map((x) => [x.name, x.rules.minPlays]), [['Ok', null]]);
    assert.ok(again.remove(l.id));
    assert.ok(!again.remove(l.id));
    for (let i = 0; i < 50; i++) again.create({ name: `L${i}` });
    assert.throws(() => again.create({ name: 'una más' }), /50/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('stats: minutes per week, by weekday and hour, streaks', () => {
  // Sunday 11 October 2026, noon (UTC; tz 0).
  const now = Date.UTC(2026, 9, 11, 12);
  const { log, dir } = historyAt(now, [[0, A, 200], [1, A, 200], [2, B, 100], [4, C, 200], [5, C, 200], [6, C, 3 * 60]]);
  try {
    const w = stats.weekly(log, { weeks: 4 });
    assert.equal(w.length, 4);
    // This week: Monday 5 Oct to Sunday 11 Oct (days 0..6 ago).
    assert.equal(new Date(w[3].start).toISOString().slice(0, 10), '2026-10-05');
    assert.equal(w[3].secs, 200 + 200 + 100 + 200 + 200 + 180);
    assert.equal(w[3].plays, 6);
    assert.equal(w[2].secs, 0);
    const h = stats.heatmap(log);
    assert.equal(h.length, 7);
    assert.equal(h[6][12], 200, 'Sunday at noon');
    assert.equal(h[0][12], 180, 'Monday at noon');
    const s = stats.streaks(log);
    assert.equal(s.current, 3, 'today, yesterday and the day before (then a day without)');
    assert.equal(s.best, 3);
    assert.equal(s.today, true);
    assert.equal(s.days365, 6);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('stats: a streak still counts until today ends; time zones move the day', () => {
  const now = Date.UTC(2026, 9, 11, 0, 30);
  const { log, dir } = historyAt(now, [[1, A, 200], [2, A, 200]]);
  try {
    const s = stats.streaks(log);
    assert.deepEqual([s.current, s.today], [2, false]);
    // Two hours behind UTC (tz +120): it's still 10 October there, and both plays fall a day earlier.
    assert.deepEqual([stats.streaks(log, { tz: 120 }).current, stats.streaks(log, { tz: 120 }).today], [2, false]);
    assert.equal(stats.streaks(log, { tz: 120 }).best, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('stats: genres by month as shares of what can be told', () => {
  const now = Date.UTC(2026, 9, 11, 12);
  const { log, dir } = historyAt(now, [[0, A, 200], [0, A, 200], [0, B, 200], [40, C, 200]]);
  try {
    const cats = { rock: new Set(['ana']), pop: new Set(['beto', 'carla']) };
    const score = (artists) => Object.entries(cats).map(([id, set]) => ({ id, score: artists.filter((a) => set.has(a.name.toLowerCase())).reduce((n, a) => n + a.plays, 0) })).filter((g) => g.score > 0);
    const g = stats.genresByMonth(log, { months: 3, score });
    assert.deepEqual(g.months.map((m) => [m.year, m.month]), [[2026, 7], [2026, 8], [2026, 9]]);
    assert.deepEqual(g.genres.sort(), ['pop', 'rock']);
    const oct = g.months[2];
    assert.ok(Math.abs(oct.shares.rock - 2 / 3) < 0.01);
    assert.ok(Math.abs(oct.shares.pop - 1 / 3) < 0.01);
    assert.equal(g.months[1].shares.pop, 1);
    assert.equal(g.months[0].known, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('on this day: that very day a year ago, else that week; most heard first', () => {
  const now = Date.UTC(2026, 9, 11, 12);
  const { log, dir } = historyAt(now, [
    [365, A, 200], [365, A, 200], [365, B, 200], [365, C, 200], // 11 Oct 2025
    [365 * 2 + 2, B, 200], // two years ago, two days off
    [365 + 100, C, 200], // another time
  ]);
  try {
    const years = stats.onThisDay(log);
    assert.deepEqual(years.map((y) => [y.yearsAgo, y.exact]), [[1, true], [2, false]]);
    assert.equal(new Date(years[0].day).toISOString().slice(0, 10), '2025-10-11');
    assert.deepEqual(years[0].songs.map((s) => s.key), [A.key, B.key, C.key]);
    assert.equal(years[0].songs[0].plays, 2);
    assert.deepEqual(years[1].songs.map((s) => s.key), [B.key]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('translate: one request, lines back in place; already Spanish says so; only that host', async () => {
  const calls = [];
  const answer = (body) => new Response(JSON.stringify(body), { status: 200 });
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return answer([[['Hola\n', '안녕\n'], ['Adiós', '잘가']], null, 'ko']);
  };
  const r = await translateLines(['안녕', '', '♪', '잘가'], { fetchImpl });
  assert.deepEqual(r, { lines: ['Hola', '', '', 'Adiós'], from: 'ko' });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith('https://translate.googleapis.com/translate_a/single?'));
  assert.match(calls[0].url, /tl=es/);
  assert.equal(calls[0].opts.redirect, 'error');
  assert.equal(new URLSearchParams(calls[0].opts.body).get('q'), '안녕\n잘가');
  assert.deepEqual(await translateLines(['Hola'], { fetchImpl: async () => answer([[['Hola', 'Hola']], null, 'es']) }), { same: true, from: 'es' });
  assert.deepEqual(await translateLines(['♪', ''], { fetchImpl: async () => { throw new Error('not called'); } }), { lines: ['', ''], from: null });
  await assert.rejects(translateLines(['x'], { fetchImpl: async () => new Response('nope', { status: 429 }) }), /429/);
  await assert.rejects(translateLines(['x'], { fetchImpl: async () => answer({ evil: 1 }) }), /traducción/);
  await assert.rejects(translateLines(['x'], { to: '../evil', fetchImpl }), /Idioma/);
});

test('translation cache: kept on disk, cleaned when read back', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 't.json');
    const c = new TranslationCache(f);
    const k = TranslationCache.key(['a', 'b'], 'es');
    assert.match(k, /^[a-f0-9]{40}$/);
    c.put(k, { lines: ['x', 'y'], from: 'en' });
    assert.deepEqual(new TranslationCache(f).get(k), { lines: ['x', 'y'], from: 'en' });
    fs.writeFileSync(f, JSON.stringify({ items: { evil: { lines: ['x'] }, [k]: { lines: 'nope' } } }));
    assert.equal(new TranslationCache(f).get(k), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('prefs: translation off until turned on, kept', () => {
  const dir = tmp();
  try {
    const p = new Prefs(path.join(dir, 'p.json'));
    assert.equal(p.get().translate, false);
    p.set({ translate: 'yes' });
    assert.equal(p.get().translate, false);
    p.set({ translate: true });
    assert.equal(new Prefs(path.join(dir, 'p.json')).get().translate, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('api: smart lists, stats, on this day, translation (only when allowed)', async () => {
  const translated = [];
  const app = await startApp({ yt: fakeYouTube({ translateLines: async (lines) => { translated.push(lines); return { lines: lines.map((l) => `ES ${l}`), from: 'en' }; } }) });
  try {
    await app.call('POST', '/api/likes', { body: { song: { key: `yt:${VIDEO}`, title: 'Uno', artist: 'Ana' } } });
    await app.call('POST', '/api/history', { body: { song: { key: `yt:${VIDEO}`, title: 'Uno', artist: 'Ana', dur: 200 }, secs: 120 } });
    // Smart lists.
    assert.equal((await app.call('POST', '/api/rulelists', { body: { name: '' } })).status, 400);
    const prev = await app.call('POST', '/api/rulelists/preview', { body: { rules: { minPlays: 1 } } });
    assert.equal(prev.data.count, 1);
    const l = (await app.call('POST', '/api/rulelists', { body: { name: 'Más escuchadas', rules: { from: 'all', minPlays: 1 } } })).data;
    const got = await app.call('GET', `/api/rulelists/${l.id}`);
    assert.deepEqual(got.data.songs.map((s) => [s.key, s.plays, s.liked]), [[`yt:${VIDEO}`, 1, true]]);
    assert.equal((await app.call('PATCH', `/api/rulelists/${l.id}`, { body: { rules: { minPlays: 5 } } })).data.rules.minPlays, 5);
    assert.equal((await app.call('GET', `/api/rulelists/${l.id}`)).data.songs.length, 0);
    assert.equal((await app.call('GET', '/api/rulelists/../../x')).status, 404);
    assert.equal((await app.call('GET', '/api/rulelists/ffffffffffffffff')).status, 404);
    assert.equal((await app.call('DELETE', `/api/rulelists/${l.id}`)).data.ok, true);
    assert.equal((await app.call('GET', '/api/rulelists')).data.lists.length, 0);
    // Stats and on this day.
    const s = (await app.call('GET', '/api/history/stats?tz=-120')).data;
    assert.equal(s.weeks.length, 52);
    assert.equal(s.weeks[51].secs, 120);
    assert.equal(s.streak.current, 1);
    assert.equal(s.heatmap.length, 7);
    assert.ok(Array.isArray(s.genres.months));
    assert.deepEqual((await app.call('GET', '/api/history/onthisday?tz=9999')).data, { years: [] });
    // Translation: refused until allowed, then once per song.
    assert.equal((await app.call('GET', `/api/stream/translation?id=${VIDEO}`)).status, 403);
    assert.equal((await app.call('PATCH', '/api/prefs', { body: { translate: true } })).data.translate, true);
    const t = await app.call('GET', `/api/stream/translation?id=${VIDEO}`);
    assert.deepEqual(t.data, { lines: ['ES hola'], from: 'en', synced: true });
    await app.call('GET', `/api/stream/translation?id=${VIDEO}`);
    assert.equal(translated.length, 1, 'kept: asked once');
    assert.equal((await app.call('GET', '/api/stream/translation?id=bad')).status, 400);
  } finally { await app.close(); }
});

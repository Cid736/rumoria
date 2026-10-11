// v1.7, "Estadísticas" and "Tal día como hoy": what the listening history
// says over the whole year, not only in "Tu resumen" — minutes per week, when
// in the week and the day you listen, your genres month by month, your streak
// of days with music, and what you were listening to on this date years ago.
// Worked out on this computer from listen-history.json; nothing is asked of
// anyone. Days and hours are the listener's own (`tz`: the page's
// getTimezoneOffset(), in minutes).
const { isPlay, mainArtist } = require('./listenlog');

const DAY = 86400;
/** Local day number (days since 1 Jan 1970, in the listener's time zone) of a time in seconds. */
const localDay = (at, tz) => Math.floor((at - tz * 60) / DAY);
/** 0 = Monday … 6 = Sunday (day 0 was a Thursday). */
const weekday = (day) => (day + 3) % 7;
const nowSecs = (log) => Math.floor(log.now() / 1000);

/** The last `weeks` weeks (Monday to Sunday), oldest first: { start (ms, local midnight as UTC), secs, plays }. */
function weekly(log, { tz = 0, weeks = 52 } = {}) {
  const today = localDay(nowSecs(log), tz);
  const first = today - weekday(today) - 7 * (weeks - 1);
  const out = Array.from({ length: weeks }, (_, i) => ({ start: (first + 7 * i) * DAY * 1000, secs: 0, plays: 0 }));
  for (const [at, key, secs] of log.events) {
    const i = Math.floor((localDay(at, tz) - first) / 7);
    if (i < 0 || i >= weeks) continue;
    out[i].secs += secs;
    const t = log.tracks.get(key);
    if (isPlay(secs, t && t.dur)) out[i].plays += 1;
  }
  return out;
}

/** Seconds listened by weekday (Monday first) and hour, over the last `days` days: 7 rows of 24. */
function heatmap(log, { tz = 0, days = 365 } = {}) {
  const from = nowSecs(log) - days * DAY;
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const [at, , secs] of log.events) {
    if (at < from) continue;
    const local = at - tz * 60;
    const hour = Math.floor((((local % DAY) + DAY) % DAY) / 3600);
    grid[weekday(Math.floor(local / DAY))][hour] += secs;
  }
  return grid;
}

/**
 * Days in a row with music (at least one song really played). `current` keeps
 * counting while you haven't listened yet today (it ends at yesterday);
 * `today` says whether today already counts.
 */
function streaks(log, { tz = 0 } = {}) {
  const days = new Set();
  for (const [at, key, secs] of log.events) {
    const t = log.tracks.get(key);
    if (isPlay(secs, t && t.dur)) days.add(localDay(at, tz));
  }
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0;
  let bestEnd = null;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    if (run > best) { best = run; bestEnd = sorted[i]; }
  }
  const today = localDay(nowSecs(log), tz);
  let current = 0;
  for (let d = days.has(today) ? today : today - 1; days.has(d); d--) current++;
  const yearAgo = today - 365;
  return { current, best, bestEnd: bestEnd === null ? null : bestEnd * DAY * 1000, today: days.has(today), days365: sorted.filter((d) => d > yearAgo).length };
}

/**
 * Your genres month by month (the last `months`, oldest first), as shares of
 * what Rumoria can tell: each month's artists scored against the artists of
 * each "Explorar" category (the same matching as "Para ti"). `score(artists)`
 * → [{ id, score }]. The `top` genres over the whole span get their own share;
 * the rest go into `other`.
 */
function genresByMonth(log, { tz = 0, months = 12, top = 5, score }) {
  const d = new Date((nowSecs(log) - tz * 60) * 1000);
  const keys = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    keys.push(`${m.getUTCFullYear()}-${m.getUTCMonth()}`);
  }
  const byMonth = new Map(keys.map((k) => [k, new Map()]));
  for (const [at, key, secs] of log.events) {
    const t = log.tracks.get(key);
    if (!t || !isPlay(secs, t.dur)) continue;
    const ld = new Date((at - tz * 60) * 1000);
    const artists = byMonth.get(`${ld.getUTCFullYear()}-${ld.getUTCMonth()}`);
    if (!artists) continue;
    const name = mainArtist(t.artist);
    if (!name) continue;
    const a = artists.get(name.toLowerCase()) || { name, plays: 0 };
    a.plays += 1;
    artists.set(name.toLowerCase(), a);
  }
  const scored = keys.map((k) => {
    const genres = byMonth.get(k).size ? score([...byMonth.get(k).values()]) : [];
    return { k, genres, total: genres.reduce((s, g) => s + g.score, 0) };
  });
  const sums = new Map();
  for (const m of scored) for (const g of m.genres) sums.set(g.id, (sums.get(g.id) || 0) + (m.total ? g.score / m.total : 0));
  const ids = [...sums].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top).map(([id]) => id);
  return {
    genres: ids,
    months: scored.map(({ k, genres, total }) => {
      const [y, m] = k.split('-').map(Number);
      const shares = {};
      let mine = 0;
      for (const id of ids) {
        const g = genres.find((x) => x.id === id);
        shares[id] = total && g ? Math.round((g.score / total) * 1000) / 1000 : 0;
        mine += shares[id];
      }
      return { year: y, month: m, shares, other: total ? Math.max(0, Math.round((1 - mine) * 1000) / 1000) : 0, known: total > 0 };
    }),
  };
}

const pub = ({ key, title, artist, yt, thumb, dur, plays, secs }) => ({ key, title, artist, yt, thumb, dur, plays, secs });

/**
 * "Tal día como hoy": what you listened to on this date 1, 2 and 3 years ago
 * (that very day, or that week when the day itself has little), most heard
 * first. [{ yearsAgo, day (ms), exact, songs }], only the years with something.
 */
function onThisDay(log, { tz = 0, years = 3, max = 40 } = {}) {
  const d = new Date((nowSecs(log) - tz * 60) * 1000);
  const out = [];
  for (let k = 1; k <= years; k++) {
    const target = Math.floor(Date.UTC(d.getUTCFullYear() - k, d.getUTCMonth(), d.getUTCDate()) / (DAY * 1000));
    const pick = (span) => {
      const by = new Map();
      for (const [at, key, secs] of log.events) {
        const day = localDay(at, tz);
        if (day < target - span || day > target + span) continue;
        const t = log.tracks.get(key);
        if (!t) continue;
        const r = by.get(key) || { key, ...t, plays: 0, secs: 0 };
        if (isPlay(secs, t.dur)) r.plays += 1;
        r.secs += secs;
        by.set(key, r);
      }
      return [...by.values()].filter((r) => r.plays > 0).sort((a, b) => b.plays - a.plays || b.secs - a.secs).slice(0, max).map(pub);
    };
    let songs = pick(0);
    let exact = true;
    if (songs.length < 3) { songs = pick(3); exact = false; }
    if (songs.length) out.push({ yearsAgo: k, day: target * DAY * 1000, exact, songs });
  }
  return out;
}

module.exports = { weekly, heatmap, streaks, genresByMonth, onThisDay, localDay, weekday };

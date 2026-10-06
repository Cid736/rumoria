// What you listen to (desktop app): each song heard for a while, with how
// long, so Escuchar can make lists from it (most played, heard lately, to
// rediscover, daily mixes) and Estadísticas a yearly summary. Kept only on
// this computer (listen-history.json); it can be paused or wiped.
const fs = require('fs');

const MAX_EVENTS = 60000;
const MAX_TRACKS = 20000;
const KEEP_MS = 3 * 366 * 24 * 3600 * 1000;
const PLAY_SECS = 30;                    // heard this long = one play (or half of a short song)
const KEY_RE = /^(yt:[A-Za-z0-9_-]{11}|f:[^\u0000-\u001f\u007f]{1,500})$/;
const THUMB_RE = /^https:\/\/i\d?\.ytimg\.com\/[\w\-/.]{1,200}(\?[\w\-=&%.]{0,300})?$/;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** A song as the page describes it → what's kept, or null. */
function cleanSong(s) {
  if (!s || typeof s !== 'object' || !KEY_RE.test(String(s.key || ''))) return null;
  const title = clean(s.title, 300);
  if (!title) return null;
  const out = { title, artist: clean(s.artist, 200) };
  if (s.key.startsWith('yt:')) out.yt = s.key.slice(3);
  if (typeof s.thumb === 'string' && THUMB_RE.test(s.thumb)) out.thumb = s.thumb;
  if (Number.isFinite(s.dur) && s.dur > 0 && s.dur < 86400) out.dur = Math.round(s.dur);
  return out;
}
const isPlay = (secs, dur) => secs >= Math.min(PLAY_SECS, dur ? dur / 2 : PLAY_SECS);
/** The first artist of "A, B & C feat. D" (how songs are grouped by artist). */
const mainArtist = (a) => clean(String(a || '').split(/\s*(?:,|&|;|\bfeat\.?|\bft\.?|\bx\b)\s*/i)[0], 200);

class ListenLog {
  constructor(file, { now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    this.paused = false;
    this.autoSave = false;
    this.tracks = new Map();   // key -> { title, artist, yt?, thumb?, dur?, saved? }
    this.events = [];          // [seconds since 1970, key, seconds heard]
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.paused = raw.paused === true;
      this.autoSave = raw.autoSave === true;
      for (const [key, t] of Object.entries(raw.tracks || {}).slice(-MAX_TRACKS)) {
        const c = cleanSong({ ...t, key });
        if (c) { if (t.saved === true) c.saved = true; this.tracks.set(key, c); }
      }
      this.events = (Array.isArray(raw.events) ? raw.events : []).slice(-MAX_EVENTS)
        .filter((e) => Array.isArray(e) && Number.isInteger(e[0]) && e[0] > 0 && this.tracks.has(e[1]) && Number.isFinite(e[2]) && e[2] > 0 && e[2] <= 86400)
        .map((e) => [e[0], e[1], Math.round(e[2])]);
    } catch { /* none yet */ }
  }

  saveNow() {
    // Old events and songs nobody points to any more go.
    const cut = Math.floor((this.now() - KEEP_MS) / 1000);
    this.events = this.events.filter((e) => e[0] >= cut).slice(-MAX_EVENTS);
    const used = new Set(this.events.map((e) => e[1]));
    for (const k of this.tracks.keys()) if (!used.has(k)) this.tracks.delete(k);
    const tmp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, paused: this.paused, autoSave: this.autoSave, tracks: Object.fromEntries(this.tracks), events: this.events }));
      fs.renameSync(tmp, this.file);
    } catch { /* not fatal */ }
  }

  settings(patch = {}) {
    if (typeof patch.paused === 'boolean') this.paused = patch.paused;
    if (typeof patch.autoSave === 'boolean') this.autoSave = patch.autoSave;
    this.saveNow();
    return { paused: this.paused, autoSave: this.autoSave, count: this.events.length };
  }

  clear() {
    this.events = [];
    this.tracks.clear();
    this.saveNow();
  }

  /**
   * One song heard for `secs` seconds. Returns the song's plays so far (for
   * "keep the ones I play most"), or null when not kept.
   */
  add(song, secs) {
    if (this.paused) return null;
    const c = cleanSong(song);
    const s = Math.round(Number(secs));
    if (!c || !Number.isFinite(s) || s < 5 || s > 86400) return null;
    const old = this.tracks.get(song.key);
    if (old && old.saved) c.saved = true;
    if (old && !c.thumb && old.thumb) c.thumb = old.thumb;
    this.tracks.delete(song.key);
    this.tracks.set(song.key, c);
    this.events.push([Math.floor(this.now() / 1000), song.key, s]);
    // Written at once: the app can be closed at any moment.
    this.saveNow();
    return this.plays(song.key);
  }

  plays(key) {
    const t = this.tracks.get(key);
    return this.events.reduce((n, e) => n + (e[1] === key && isPlay(e[2], t && t.dur) ? 1 : 0), 0);
  }

  markSaved(key) {
    const t = this.tracks.get(key);
    if (t) { t.saved = true; this.saveNow(); }
  }

  /** Per song over the events since `from` (seconds) and before `to`: plays, seconds, last time. */
  tally(from = 0, to = Infinity) {
    const by = new Map();
    for (const [at, key, secs] of this.events) {
      if (at < from || at >= to) continue;
      const t = this.tracks.get(key);
      let r = by.get(key);
      if (!r) { r = { key, ...t, plays: 0, secs: 0, last: 0, first: at }; by.set(key, r); }
      if (isPlay(secs, t && t.dur)) r.plays += 1;
      r.secs += secs;
      r.last = Math.max(r.last, at);
    }
    return [...by.values()];
  }

  /** Lists for Escuchar: most played lately, heard lately, to rediscover, your artists. */
  smart() {
    const now = Math.floor(this.now() / 1000);
    const DAY = 86400;
    const pub = ({ key, title, artist, yt, thumb, dur, plays, secs, last }) => ({ key, title, artist, yt, thumb, dur, plays, secs, last });
    const recent = this.tally(now - 90 * DAY).filter((r) => r.plays > 0);
    const top = recent.slice().sort((a, b) => b.plays - a.plays || b.secs - a.secs).slice(0, 50).map(pub);
    const lately = this.tally(now - 60 * DAY).sort((a, b) => b.last - a.last).slice(0, 50).map(pub);
    const all = this.tally();
    const forgotten = all.filter((r) => r.plays >= 3 && r.last < now - 30 * DAY).sort((a, b) => b.plays - a.plays).slice(0, 50).map(pub);
    // Artists of the last 60 days, each with the song of theirs you play most (a seed for a mix).
    const artists = new Map();
    for (const r of this.tally(now - 60 * DAY)) {
      const name = mainArtist(r.artist);
      if (!name) continue;
      const a = artists.get(name.toLowerCase()) || { name, plays: 0, secs: 0, seed: null, songs: [] };
      a.plays += r.plays;
      a.secs += r.secs;
      a.songs.push(pub(r));
      if (r.yt && (!a.seed || r.plays > a.seed.plays)) a.seed = pub(r);
      artists.set(name.toLowerCase(), a);
    }
    const topArtists = [...artists.values()].filter((a) => a.plays > 0).sort((a, b) => b.plays - a.plays || b.secs - a.secs).slice(0, 8)
      .map((a) => ({ name: a.name, plays: a.plays, seed: a.seed, songs: a.songs.sort((x, y) => y.plays - x.plays).slice(0, 10) }));
    return { top, lately, forgotten, artists: topArtists, count: this.events.length, paused: this.paused, autoSave: this.autoSave };
  }

  /** The summary of a year (or of everything): totals, top songs and artists, by month and by hour. */
  summary(year = null, tzOffsetMin = 0) {
    const years = [...new Set(this.events.map((e) => new Date((e[0] - tzOffsetMin * 60) * 1000).getUTCFullYear()))].sort();
    const from = year ? Math.floor((Date.UTC(year, 0, 1) / 1000) + tzOffsetMin * 60) : 0;
    const to = year ? Math.floor((Date.UTC(year + 1, 0, 1) / 1000) + tzOffsetMin * 60) : Infinity;
    const rows = this.tally(from, to);
    const months = Array(12).fill(0);
    const hours = Array(24).fill(0);
    const days = new Set();
    for (const [at, , secs] of this.events) {
      if (at < from || at >= to) continue;
      const d = new Date((at - tzOffsetMin * 60) * 1000);
      months[d.getUTCMonth()] += secs;
      hours[d.getUTCHours()] += secs;
      days.add(`${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`);
    }
    const artists = new Map();
    for (const r of rows) {
      const name = mainArtist(r.artist);
      if (!name) continue;
      const a = artists.get(name.toLowerCase()) || { name, plays: 0, secs: 0, thumb: null };
      a.plays += r.plays;
      a.secs += r.secs;
      if (!a.thumb && r.thumb) a.thumb = r.thumb;
      artists.set(name.toLowerCase(), a);
    }
    const pub = ({ key, title, artist, yt, thumb, dur, plays, secs }) => ({ key, title, artist, yt, thumb, dur, plays, secs });
    return {
      year, years,
      secs: rows.reduce((a, r) => a + r.secs, 0),
      plays: rows.reduce((a, r) => a + r.plays, 0),
      songs: rows.length,
      artists: artists.size,
      days: days.size,
      topSongs: rows.filter((r) => r.plays > 0).sort((a, b) => b.plays - a.plays || b.secs - a.secs).slice(0, 25).map(pub),
      topArtists: [...artists.values()].sort((a, b) => b.secs - a.secs).slice(0, 10),
      months, hours,
    };
  }
}

module.exports = { ListenLog, cleanSong, mainArtist, isPlay, KEY_RE };

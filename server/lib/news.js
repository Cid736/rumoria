// "Novedades de tus artistas" (desktop app): now and then, the newest uploads
// of the artists you listen to most (YouTube, newest first). The first look
// at an artist only notes what's there; later, a new song by them (on their
// channel or their "- Topic" one, not a live, a cover or a reaction) is news.
// Kept in news.json; only titles and YouTube ids.
const fs = require('fs');
const { writeFileAtomic } = require('./atomic');

const MAX_NEWS = 40;
const CHANNEL_RE = /^https:\/\/www\.youtube\.com\/(channel\/UC[\w-]{22}|@[\w.-]{3,40})$/;
const KEEP_MS = 30 * 24 * 3600 * 1000;
const NOT_A_SONG = /\b(live|en vivo|en directo|directo|reaction|reacci[oó]n|cover|karaoke|lyrics?|letra|tutorial|interview|entrevista|behind the scenes|making of|teaser|trailer|shorts?|8d|slowed|sped up|nightcore|1 hour|1 hora)\b/i;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Is this upload a new song by `artist`? (`own`: it comes from their own channel.) */
function isTheirs(e, artist, own = false) {
  if (!e || !/^[\w-]{11}$/.test(String(e.id))) return false;
  if (own) return !NOT_A_SONG.test(String(e.title || '')) && (!Number.isFinite(e.duration) || (e.duration >= 90 && e.duration <= 600));
  const who = fold(artist);
  const channel = fold(String(e.channel || '').replace(/\s-\sTopic$/, '').replace(/VEVO$/i, ''));
  if (!who || !channel || !(channel === who || channel.startsWith(`${who} `) || who.startsWith(`${channel} `) || channel === `${who}official` || channel === `${who} official`)) return false;
  if (NOT_A_SONG.test(String(e.title || ''))) return false;
  return !Number.isFinite(e.duration) || (e.duration >= 90 && e.duration <= 600);
}

class News {
  constructor(file, { now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    this.seen = {}; // artist (folded) -> [video ids seen]
    this.channels = {}; // artist (folded) -> their YouTube channel ("" if none found)
    this.news = []; // [{ yt, title, artist, channel, thumbnail, duration, at }]
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && raw.seen && typeof raw.seen === 'object') for (const [k, v] of Object.entries(raw.seen).slice(0, 200)) if (Array.isArray(v)) this.seen[k] = v.filter((x) => /^[\w-]{11}$/.test(String(x))).slice(0, 100);
      if (raw && raw.channels && typeof raw.channels === 'object') for (const [k, v] of Object.entries(raw.channels).slice(0, 200)) if (v === '' || CHANNEL_RE.test(String(v))) this.channels[k] = String(v);
      if (raw && Array.isArray(raw.news)) this.news = raw.news.filter((n) => n && /^[\w-]{11}$/.test(String(n.yt))).slice(0, MAX_NEWS);
    } catch { /* none yet */ }
  }

  save() {
    try {
      writeFileAtomic(this.file, JSON.stringify({ seen: this.seen, channels: this.channels, news: this.news }));
    } catch { /* not fatal */ }
  }

  /** What one look at an artist's newest uploads finds (and notes). Returns the new songs. */
  take(artist, entries, own = false) {
    const key = fold(artist);
    if (!key || !Array.isArray(entries)) return [];
    const first = !this.seen[key];
    const known = new Set(this.seen[key] || []);
    const found = [];
    for (const e of entries.slice(0, 20)) {
      if (!e || !/^[\w-]{11}$/.test(String(e.id)) || known.has(e.id)) continue;
      known.add(e.id);
      if (!first && isTheirs(e, artist, own) && !this.news.some((n) => n.yt === e.id)) {
        found.push({
          yt: e.id, title: clean(e.title, 300), artist: clean(artist, 200), channel: clean(e.channel, 120),
          thumbnail: typeof e.thumbnail === 'string' && /^https:\/\/i\d?\.ytimg\.com\//.test(e.thumbnail) ? e.thumbnail : `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
          duration: Number.isFinite(e.duration) ? e.duration : null, at: this.now(),
        });
      }
    }
    this.seen[key] = [...known].slice(-100);
    this.news = [...found, ...this.news].filter((n) => this.now() - n.at < KEEP_MS).slice(0, MAX_NEWS);
    return found;
  }

  /**
   * Looks at each artist in turn: their channel (found once with
   * `findChannel(artist)`), then its newest uploads (`newest(channelUrl)`).
   */
  async check(artists, { findChannel, newest }) {
    const found = [];
    for (const a of artists.slice(0, 8)) {
      const key = fold(a);
      try {
        if (!(key in this.channels)) { const c = await findChannel(a); this.channels[key] = c && CHANNEL_RE.test(c) ? c : ''; }
        if (this.channels[key]) found.push(...this.take(a, await newest(this.channels[key]), true));
      } catch { /* the next one */ }
    }
    this.save();
    return found;
  }

  /** Of search results, the artist's own channel (its name, not "- Topic"). */
  static channelOf(artist, results) {
    const who = fold(artist);
    const names = new Set([who, `${who} official`, `${who}official`, `${who}vevo`, `${who} vevo`]);
    const hit = (results || []).find((r) => r && CHANNEL_RE.test(String(r.url || '')) && names.has(fold(r.title)));
    if (hit) return hit.url;
    // No channel among the results: the channel of one of their own videos.
    const video = (results || []).find((r) => r && CHANNEL_RE.test(String(r.channelUrl || '')) && names.has(fold(r.channel)));
    return video ? video.channelUrl : null;
  }

  list() { return this.news.filter((n) => this.now() - n.at < KEEP_MS); }
}

module.exports = { News, isTheirs, NOT_A_SONG, CHANNEL_RE };

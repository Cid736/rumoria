// v1.13, "Podcasts": the YouTube channels and playlists you follow as
// podcasts, and where you left each episode (so it carries on from there).
// Kept in podcasts.json: names, links, YouTube ids and seconds. Never the
// sound: an episode plays like any song, from YouTube, when you press play.
const fs = require('fs');
const { writeFileAtomic } = require('./atomic');

const MAX_SHOWS = 100;
const MAX_PROGRESS = 1000;
const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;
const SHOW_RE = /^(ch:(UC[\w-]{22}|@[\w.-]{3,40})|pl:[\w-]{10,64})$/;
const IMG_RE = /^https:\/\/i\d?\.ytimg\.com\/[\w\-./]+(\?[\w=&%-]*)?$/;
// The last minute (or the last 3 %) of an episode counts as heard: the outro.
const DONE_TAIL = 60;
const MIN_EPISODE_S = 5 * 60;

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const img = (v) => (typeof v === 'string' && v.length <= 500 && IMG_RE.test(v) ? v : null);

/**
 * A link to a channel or a playlist → { id, url } (what yt-dlp reads), or null.
 * `link` must already be a cleaned YouTube https URL (ytdlp.youTubeUrl).
 */
function showOf(link) {
  let u;
  try { u = new URL(link); } catch { return null; }
  const list = u.searchParams.get('list');
  if (list && /^[\w-]{10,64}$/.test(list) && !/^(RD|UL|LL|WL)/.test(list)) return { id: `pl:${list}`, url: `https://www.youtube.com/playlist?list=${list}` };
  const m = /^\/(channel\/(UC[\w-]{22})|(@[\w.-]{3,40}))(\/(videos|featured|podcasts|streams)?)?\/?$/.exec(u.pathname);
  if (!m) return null;
  const who = m[2] || m[3];
  return { id: `ch:${who}`, url: `https://www.youtube.com/${m[2] ? `channel/${who}` : who}` };
}

/** "Name - Videos" (a channel's videos tab) → "Name". */
const showName = (title) => clean(String(title || '').replace(/\s+-\s+(videos|vídeos|podcasts|en directo|live)$/i, ''), 200);

/** An episode's notes (its YouTube description): the lines kept, nothing that isn't text, capped. */
function cleanNotes(raw) {
  return String(raw ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 5000);
}

/** An episode as the page gets it: only what's needed to show and play it. */
function cleanEpisode(e) {
  if (!e || !VIDEO_RE.test(String(e.id))) return null;
  const title = clean(e.title, 300);
  if (!title) return null;
  const duration = Number.isFinite(e.duration) && e.duration > 0 && e.duration < 86400 ? Math.round(e.duration) : null;
  // A Short or a clip cut from an episode (channels mix them in) is not an episode.
  if (duration !== null && duration < MIN_EPISODE_S) return null;
  return { yt: e.id, title, duration, thumbnail: img(e.thumbnail) || `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg` };
}

class Podcasts {
  constructor(file, { now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    this.shows = [];    // [{ id, name, url, thumb, at }], newest first
    this.progress = {}; // video id -> { t, d, done, at, title, show, thumb }
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const s of Array.isArray(raw.shows) ? raw.shows.slice(0, MAX_SHOWS) : []) {
        const c = this._cleanShow(s);
        if (c && !this.shows.some((x) => x.id === c.id)) this.shows.push(c);
      }
      if (raw.progress && typeof raw.progress === 'object') {
        for (const [yt, p] of Object.entries(raw.progress).slice(0, MAX_PROGRESS)) {
          const c = this._cleanProgress(yt, p);
          if (c) this.progress[yt] = c;
        }
      }
    } catch { /* none yet */ }
  }

  _cleanShow(s) {
    if (!s || !SHOW_RE.test(String(s.id))) return null;
    const name = clean(s.name, 200);
    const url = typeof s.url === 'string' && /^https:\/\/www\.youtube\.com\/(channel\/UC[\w-]{22}|@[\w.-]{3,40}|playlist\?list=[\w-]{10,64})$/.test(s.url) ? s.url : null;
    if (!name || !url) return null;
    return { id: s.id, name, url, thumb: img(s.thumb), at: Number.isFinite(s.at) ? s.at : 0 };
  }

  _cleanProgress(yt, p) {
    if (!VIDEO_RE.test(String(yt)) || !p || typeof p !== 'object') return null;
    const t = Number(p.t);
    const d = Number(p.d);
    if (!Number.isFinite(t) || t < 0 || t > 86400) return null;
    const dur = Number.isFinite(d) && d > 0 && d <= 86400 ? Math.round(d) : null;
    return {
      t: Math.round(t), d: dur, done: p.done === true, at: Number.isFinite(p.at) ? p.at : 0,
      title: clean(p.title, 300), show: SHOW_RE.test(String(p.show)) ? p.show : null, thumb: img(p.thumb),
    };
  }

  save() { writeFileAtomic(this.file, JSON.stringify({ shows: this.shows, progress: this.progress })); }

  has(id) { return this.shows.some((s) => s.id === id); }
  get(id) { return this.shows.find((s) => s.id === id) || null; }

  /** Followed (or its name and cover brought up to date). Returns the show, or null. */
  follow({ id, url, name, thumb }) {
    const c = this._cleanShow({ id, url, name, thumb, at: this.now() });
    if (!c) return null;
    const old = this.get(id);
    this.shows = [old ? { ...c, at: old.at } : c, ...this.shows.filter((s) => s.id !== id)].slice(0, MAX_SHOWS);
    this.save();
    return { ...this.get(id) };
  }

  unfollow(id) {
    const before = this.shows.length;
    this.shows = this.shows.filter((s) => s.id !== id);
    if (this.shows.length !== before) this.save();
    return this.shows.length !== before;
  }

  /**
   * Where you are in an episode. `done` when asked, or when it's in the last
   * minute. Returns the kept entry, or null for anything that isn't one.
   */
  setProgress(yt, { t, d, done, title, show, thumb } = {}) {
    const c = this._cleanProgress(yt, { t, d, done, title, show, thumb, at: this.now() });
    if (!c) return null;
    if (!c.done && c.d && c.t >= Math.min(c.d - DONE_TAIL, c.d * 0.97)) c.done = true;
    const old = this.progress[yt];
    // What you knew of it stays when a save doesn't say (a title, a cover).
    if (old) { c.title = c.title || old.title; c.show = c.show || old.show; c.thumb = c.thumb || old.thumb; c.d = c.d || old.d; }
    delete this.progress[yt];
    this.progress[yt] = c;
    const keys = Object.keys(this.progress);
    if (keys.length > MAX_PROGRESS) {
      for (const k of keys.sort((a, b) => this.progress[a].at - this.progress[b].at).slice(0, keys.length - MAX_PROGRESS)) delete this.progress[k];
    }
    this.save();
    return { ...c };
  }

  forgetProgress(yt) {
    if (!(yt in this.progress)) return false;
    delete this.progress[yt];
    this.save();
    return true;
  }

  list() {
    return { shows: this.shows.map((s) => ({ ...s })), progress: Object.fromEntries(Object.entries(this.progress).map(([k, v]) => [k, { ...v }])) };
  }
}

module.exports = { Podcasts, showOf, showName, cleanEpisode, cleanNotes, SHOW_RE, MAX_SHOWS, MAX_PROGRESS };

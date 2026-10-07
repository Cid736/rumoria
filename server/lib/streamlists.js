// Lists to listen to without downloading (desktop app): your Spotify or
// Apple Music playlists brought in by their link, lists made from search
// results, or what was playing. Only titles, artists and YouTube ids are kept
// (stream-lists.json); each song is looked up on YouTube when it plays, and
// the video found is remembered for next time.
const crypto = require('crypto');
const fs = require('fs');
const { writeFileAtomic } = require('./atomic');

const MAX_LISTS = 100;
const MAX_TRACKS = 500;
const TRASH_MS = 10 * 60 * 1000;
const ID_RE = /^[a-f0-9]{16}$/;
const YT_RE = /^[A-Za-z0-9_-]{11}$/;
const SOURCES = ['spotify', 'apple', 'youtube', 'own', 'auto'];
// Lists that fill themselves from their topic: how often (hours) they look
// for new songs, how long they get, and songs you took out (never back).
const AUTO_EVERY = [6, 12, 24, 168];
const AUTO_MAX = 100;
const AUTO_BLOCKED = 500;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function cleanTrack(t) {
  if (!t || typeof t !== 'object') return null;
  const title = clean(t.title, 300);
  if (!title) return null;
  const out = { title, artist: clean(t.artist, 200) };
  if (Number.isFinite(t.duration) && t.duration > 0 && t.duration < 86400) out.duration = Math.round(t.duration);
  if (YT_RE.test(String(t.yt || ''))) out.yt = String(t.yt);
  const query = clean(t.query, 200);
  if (query) out.query = query;
  if (!out.yt && !out.query) out.query = clean(out.artist ? `${out.artist.split(',')[0]} - ${title}` : title, 200);
  if (typeof t.thumbnail === 'string' && /^https:\/\/i\d?\.ytimg\.com\/[\w\-/.]{1,200}(\?[\w\-=&%.]{0,300})?$/.test(t.thumbnail)) out.thumbnail = t.thumbnail;
  // v3.12: already sent to be downloaded ("keep it downloaded").
  if (t.got === true) out.got = true;
  return out;
}
/** "Keep it downloaded": who asked (their client id) and with which download options (checked again when used). */
function cleanKeep(k) {
  if (!k || typeof k !== 'object' || !/^[a-f0-9]{32}$/.test(String(k.client)) || !k.opts || typeof k.opts !== 'object' || Array.isArray(k.opts)) return null;
  let json;
  try { json = JSON.stringify(k.opts); } catch { return null; }
  return json.length <= 3000 ? { client: String(k.client), opts: JSON.parse(json) } : null;
}

/** "Fills itself": the topic searched, how often, when it last looked, songs you removed. */
function cleanAuto(a) {
  if (!a || typeof a !== 'object') return null;
  const q = clean(a.q, 100);
  if (!q) return null;
  const blocked = [...new Set((Array.isArray(a.blocked) ? a.blocked : []).map(String).filter((id) => YT_RE.test(id)))].slice(-AUTO_BLOCKED);
  const out = { q, every: AUTO_EVERY.includes(a.every) ? a.every : 24, at: Number.isFinite(a.at) ? a.at : 0, blocked };
  // Made by Rumoria for "Para ti" (which category, and why): it may rotate it.
  if (a.by === 'rumoria' && /^[a-z0-9-]{1,40}$/.test(String(a.cat || '')) && ['genre', 'discover', 'starter'].includes(a.kind)) Object.assign(out, { by: 'rumoria', cat: a.cat, kind: a.kind });
  return out;
}

function cleanList(l) {
  if (!l || typeof l !== 'object' || !ID_RE.test(String(l.id))) return null;
  const tracks = (Array.isArray(l.tracks) ? l.tracks : []).slice(0, MAX_TRACKS).map(cleanTrack).filter(Boolean);
  let url = null;
  try { const u = new URL(String(l.url || '')); if (u.protocol === 'https:' && /(^|\.)(spotify\.com|apple\.com|youtube\.com)$/.test(u.hostname)) url = u.toString(); } catch { /* none */ }
  return {
    id: l.id, name: clean(l.name, 150) || 'Lista', source: SOURCES.includes(l.source) ? l.source : 'own', url,
    createdAt: Number.isFinite(l.createdAt) ? l.createdAt : Date.now(), updatedAt: Number.isFinite(l.updatedAt) ? l.updatedAt : Date.now(), tracks,
    // v3.9: a folder of your own, and "keep it up to date" for lists from a link.
    folder: clean(l.folder, 60) || null,
    sync: Boolean(url) && l.sync === true,
    syncedAt: Number.isFinite(l.syncedAt) ? l.syncedAt : null,
    keep: cleanKeep(l.keep),
    // v1.1: fills itself from its topic (titles and YouTube ids only; nothing is downloaded).
    auto: cleanAuto(l.auto),
  };
}

class StreamLists {
  constructor(file) {
    this.file = file;
    this.lists = [];
    this.trash = []; // lists just deleted, for "Deshacer" (only in memory, a few minutes)
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.lists = (Array.isArray(raw) ? raw : []).slice(0, MAX_LISTS).map(cleanList).filter(Boolean);
    } catch { this.lists = []; }
  }

  save() {
    writeFileAtomic(this.file, JSON.stringify(this.lists));
  }

  /** Without the tracks: what the list of lists shows. */
  summary() {
    return this.lists.map((l) => {
      // Up to four different covers, for a mosaic.
      const thumbs = [...new Set(l.tracks.map((t) => t.thumbnail).filter(Boolean))].slice(0, 4);
      return {
        id: l.id, name: l.name, source: l.source, url: l.url, count: l.tracks.length, updatedAt: l.updatedAt,
        thumbnail: thumbs[0] || null, thumbs, folder: l.folder, sync: l.sync, syncedAt: l.syncedAt, keep: Boolean(l.keep),
        auto: l.auto ? { q: l.auto.q, every: l.auto.every, at: l.auto.at, ...(l.auto.by ? { by: l.auto.by, kind: l.auto.kind } : {}) } : null,
      };
    });
  }

  /** Lists that fill themselves and haven't looked for new songs in their time. */
  dueForAuto(now = Date.now()) {
    return this.lists.filter((l) => l.auto && l.auto.at < now - l.auto.every * 3600 * 1000).map((l) => l.id);
  }

  /**
   * New songs for a list that fills itself: the ones it doesn't have and you
   * didn't take out go first; the oldest fall off past AUTO_MAX.
   */
  autoFill(id, songs, now = Date.now()) {
    const l = this.get(id);
    if (!l || !l.auto) return null;
    const have = new Set(l.tracks.map((t) => t.yt).filter(Boolean));
    const blocked = new Set(l.auto.blocked);
    const fresh = [];
    for (const t of (songs || []).map(cleanTrack).filter(Boolean)) {
      if (!t.yt || have.has(t.yt) || blocked.has(t.yt)) continue;
      have.add(t.yt);
      fresh.push(t);
    }
    l.tracks = [...fresh, ...l.tracks].slice(0, AUTO_MAX);
    l.auto.at = now;
    if (fresh.length) l.updatedAt = now;
    this.save();
    return { list: l, added: fresh.length };
  }

  /** Songs taken out of a list that fills itself: never put back by it. */
  _block(l, tracks) {
    if (!l.auto) return;
    l.auto.blocked = [...new Set([...l.auto.blocked, ...tracks.map((t) => t && t.yt).filter(Boolean)])].slice(-AUTO_BLOCKED);
  }

  /** Lists from a link with "keep it up to date" on, not read again for `maxAgeMs`. */
  dueForSync(now = Date.now(), maxAgeMs = 12 * 3600 * 1000) {
    return this.lists.filter((l) => l.url && l.sync && (l.syncedAt || l.createdAt) < now - maxAgeMs).map((l) => l.id);
  }

  get(id) { return this.lists.find((l) => l.id === id) || null; }

  create({ name, source = 'own', url = null, tracks = [], auto = null, folder = null }) {
    if (this.lists.length >= MAX_LISTS) throw new Error('Has llegado al máximo de listas.');
    // From a link: kept up to date by default. From a topic: fills itself.
    const now = Date.now();
    const list = cleanList({
      id: crypto.randomBytes(8).toString('hex'), name, source: auto ? 'auto' : source, url, tracks, createdAt: now, updatedAt: now,
      sync: Boolean(url), syncedAt: url ? now : null, folder, auto: auto ? { ...auto, at: now, blocked: [] } : null,
    });
    if (list.auto) list.tracks = list.tracks.slice(0, AUTO_MAX);
    if (!list.tracks.length) throw new Error('La lista no tiene canciones.');
    this.lists.unshift(list);
    this.save();
    return list;
  }

  update(id, patch) {
    const l = this.get(id);
    if (!l) return null;
    // Renamed or moved by you: one of Rumoria's lists becomes yours (never rotated away).
    const adopt = () => { if (l.auto && l.auto.by) { delete l.auto.by; delete l.auto.cat; delete l.auto.kind; } };
    if (patch.name !== undefined) { const name = clean(patch.name, 150) || l.name; if (name !== l.name) adopt(); l.name = name; }
    if (typeof patch.folder === 'string') { const folder = clean(patch.folder, 60) || null; if (folder !== l.folder) adopt(); l.folder = folder; }
    if (typeof patch.sync === 'boolean') l.sync = Boolean(l.url) && patch.sync;
    // Filling itself: how often, or stop (it stays as a list of yours).
    if (patch.auto === null && l.auto) { l.auto = null; if (l.source === 'auto') l.source = 'own'; }
    if (patch.auto && typeof patch.auto === 'object' && l.auto && AUTO_EVERY.includes(patch.auto.every)) l.auto.every = patch.auto.every;
    if (Array.isArray(patch.tracks)) {
      const tracks = patch.tracks.slice(0, MAX_TRACKS).map(cleanTrack).filter(Boolean);
      // Re-read from Spotify: keep the YouTube videos already found.
      const known = new Map(l.tracks.filter((t) => t.yt || t.got).map((t) => [`${t.artist}|${t.title}`, t]));
      for (const t of tracks) {
        const k = known.get(`${t.artist}|${t.title}`);
        if (k && k.yt && !t.yt) { t.yt = k.yt; if (k.thumbnail) t.thumbnail = k.thumbnail; }
        // Sent to be downloaded once: not again when the list is read again.
        if (k && k.got) t.got = true;
      }
      l.tracks = tracks;
      l.syncedAt = Date.now();
    }
    if (patch.keep === null) l.keep = null;
    else if (patch.keep && typeof patch.keep === 'object') l.keep = cleanKeep(patch.keep);
    // Several songs moved together, to before the song at `to` (places as they were).
    if (patch.moveMany && Array.isArray(patch.moveMany.from) && Number.isInteger(patch.moveMany.to)) {
      const n = l.tracks.length;
      const from = [...new Set(patch.moveMany.from.filter((i) => Number.isInteger(i) && i >= 0 && i < n))].sort((a, b) => a - b);
      const to = Math.max(0, Math.min(n, patch.moveMany.to));
      if (from.length && from.length < n) {
        const picked = new Set(from);
        const moving = from.map((i) => l.tracks[i]);
        const rest = l.tracks.filter((_, i) => !picked.has(i));
        const at = l.tracks.slice(0, to).filter((_, i) => !picked.has(i)).length;
        rest.splice(at, 0, ...moving);
        l.tracks = rest;
      }
    }
    // Songs put back where they were ("Deshacer"): [{ at, track }], in order.
    if (Array.isArray(patch.insert)) {
      for (const it of patch.insert.slice(0, MAX_TRACKS).filter((x) => x && Number.isInteger(x.at)).sort((a, b) => a.at - b.at)) {
        const t = cleanTrack(it.track);
        if (t && l.tracks.length < MAX_TRACKS) l.tracks.splice(Math.max(0, Math.min(l.tracks.length, it.at)), 0, t);
      }
    }
    // A song dragged to another place in the list.
    if (patch.move && Number.isInteger(patch.move.from) && Number.isInteger(patch.move.to)) {
      const { from, to } = patch.move;
      if (from >= 0 && to >= 0 && from < l.tracks.length && to < l.tracks.length && from !== to) l.tracks.splice(to, 0, l.tracks.splice(from, 1)[0]);
    }
    if (Array.isArray(patch.add)) {
      for (const t of patch.add.map(cleanTrack).filter(Boolean)) if (l.tracks.length < MAX_TRACKS) l.tracks.push(t);
    }
    l.updatedAt = Date.now();
    this.save();
    return l;
  }

  /** The video found for track n (so it isn't looked up again). */
  remember(id, n, found, query) {
    const l = this.get(id);
    let t = l && Number.isInteger(n) ? l.tracks[n] : null;
    // The list may have changed since it started playing (a song moved or
    // removed): then it's the song looked up by that name, never its neighbour.
    if (l && typeof query === 'string' && (!t || t.query !== query)) t = l.tracks.find((x) => !x.yt && x.query === query) || null;
    if (!t || !YT_RE.test(String(found.id || ''))) return;
    t.yt = found.id;
    if (found.thumbnail) { const c = cleanTrack({ ...t, thumbnail: found.thumbnail }); if (c && c.thumbnail) t.thumbnail = c.thumbnail; }
    try { this.save(); } catch { /* not fatal */ }
  }

  /** Several songs out at once: the list, and what was removed (to put it back). */
  removeTracks(id, ns) {
    const l = this.get(id);
    if (!l || !Array.isArray(ns)) return null;
    const out = [...new Set(ns.filter((i) => Number.isInteger(i) && i >= 0 && i < l.tracks.length))].sort((a, b) => a - b);
    if (!out.length) return null;
    const removed = out.map((at) => ({ at, track: l.tracks[at] }));
    this._block(l, removed.map((r) => r.track));
    const gone = new Set(out);
    l.tracks = l.tracks.filter((_, i) => !gone.has(i));
    l.updatedAt = Date.now();
    this.save();
    return { list: l, removed };
  }

  /** Marks songs as sent to be downloaded. */
  markGot(id, ns) {
    const l = this.get(id);
    if (!l) return;
    for (const i of ns) if (l.tracks[i]) l.tracks[i].got = true;
    try { this.save(); } catch { /* not fatal */ }
  }

  removeTrack(id, n) {
    const l = this.get(id);
    if (!l || !Number.isInteger(n) || !l.tracks[n]) return null;
    this._block(l, l.tracks.splice(n, 1));
    l.updatedAt = Date.now();
    this.save();
    return l;
  }

  remove(id, now = Date.now()) {
    const gone = this.get(id);
    if (!gone) return false;
    this.lists = this.lists.filter((l) => l.id !== id);
    this.save();
    // Kept a few minutes in memory, for "Deshacer".
    this.trash = [{ list: gone, at: now }, ...this.trash.filter((x) => now - x.at < TRASH_MS)].slice(0, 5);
    return true;
  }

  /** A list deleted a moment ago, back where it was (its link, folder and settings too). */
  restore(id, now = Date.now()) {
    const hit = this.trash.find((x) => x.list.id === id && now - x.at < TRASH_MS);
    if (!hit || this.get(id) || this.lists.length >= MAX_LISTS) return null;
    this.trash = this.trash.filter((x) => x !== hit);
    this.lists.unshift(hit.list);
    this.save();
    return hit.list;
  }
}

/**
 * Of a few YouTube results for "artist - title", the song itself: the one
 * whose length matches (an "- Topic" upload, the album audio, first), so the
 * lyrics line up; else the first.
 */
function pickVideo(results, duration) {
  const rs = (results || []).filter((r) => r && YT_RE.test(String(r.id)));
  if (!rs.length) return null;
  if (duration) {
    const close = rs.filter((r) => Number.isFinite(r.duration) && Math.abs(r.duration - duration) <= 3);
    const topic = close.find((r) => /\s-\sTopic$/.test(r.channel || ''));
    if (topic || close[0]) return topic || close[0];
    const near = rs.filter((r) => Number.isFinite(r.duration) && Math.abs(r.duration - duration) <= 12);
    if (near[0]) return near[0];
  }
  return rs[0];
}

module.exports = { StreamLists, cleanTrack, cleanList, pickVideo, MAX_LISTS, MAX_TRACKS, ID_RE, AUTO_EVERY, AUTO_MAX };

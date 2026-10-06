// One shape for every song, wherever it comes from:
//   { key, yt?, localId?, query?, title, artist, thumbnail?, duration?, list?, n? }
// key is "yt:<video>" or "f:<path in your music folder>" (as in the history
// and favourites), or null for a song only known by name until it's found.

const YT_RE = /^[A-Za-z0-9_-]{11}$/;

export const keyOf = (t) => (t.yt ? `yt:${t.yt}` : t.key && t.key.startsWith('f:') ? t.key : null);

/** What the server keeps of a song (favourites, history). */
export function songOf(t) {
  const key = keyOf(t);
  if (!key) return null;
  const s = { key, title: t.title, artist: t.artist || '' };
  if (t.thumbnail) s.thumb = t.thumbnail;
  if (t.duration) s.dur = Math.round(t.duration);
  return s;
}

/** A favourite or history entry → a song (a local one only if it's still in your folder). */
export function fromSaved(r, localByKey = new Map()) {
  if (r.key && r.key.startsWith('f:')) {
    const f = localByKey.get(r.key);
    return f ? { ...fromLocal(f), title: r.title || f.title, artist: r.artist || f.artist } : null;
  }
  const yt = r.yt || (r.key && r.key.startsWith('yt:') ? r.key.slice(3) : null);
  return yt && YT_RE.test(yt) ? { key: `yt:${yt}`, yt, title: r.title, artist: r.artist || '', thumbnail: r.thumb || null, duration: r.dur || null } : null;
}

/** A YouTube result (search, radio, news). The channel stands in for the artist. */
export const fromYouTube = (e) => ({
  key: `yt:${e.id || e.yt}`, yt: e.id || e.yt, title: e.title, artist: e.artist || (e.channel || '').replace(/\s-\sTopic$/, ''),
  thumbnail: e.thumbnail || null, duration: e.duration || null,
});

/** A song of one of your lists (its place n, so a video found for it is remembered there). */
export const fromList = (listId) => (t, n) => ({
  key: t.yt ? `yt:${t.yt}` : null, yt: t.yt || null, query: t.yt ? null : t.query, title: t.title, artist: t.artist,
  thumbnail: t.thumbnail || null, duration: t.duration || null, list: listId, n,
});

export const fromLocal = (f) => ({ key: f.key, localId: f.id, title: f.title, artist: f.artist, thumbnail: null, duration: null });

/** What a list keeps of a song added to it. */
export const toListTrack = (t) => ({ title: t.title, artist: t.artist || '', ...(t.duration ? { duration: t.duration } : {}), ...(t.yt ? { yt: t.yt } : { query: t.query || `${t.artist ? `${t.artist} - ` : ''}${t.title}` }), ...(t.thumbnail ? { thumbnail: t.thumbnail } : {}) });

export function formatTime(secs) {
  if (!Number.isFinite(secs) || secs < 0) return '–:––';
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function totalTime(tracks) {
  const s = tracks.reduce((a, t) => a + (t.duration || 0), 0);
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function shuffled(a, random = Math.random) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** A daily mix: two of YouTube's similar songs, then one of yours by that artist, no repeats. */
export function mixOf(radio, mine, max = 40) {
  const out = [];
  const seen = new Set();
  const push = (x) => { const id = x && (x.key || x.query || x.title); if (x && !seen.has(id)) { seen.add(id); out.push(x); } };
  let r = 0;
  let m = 0;
  while ((r < radio.length || m < mine.length) && out.length < max) {
    if (r < radio.length) push(radio[r++]);
    if (r < radio.length) push(radio[r++]);
    if (m < mine.length) push(mine[m++]);
  }
  return out.slice(0, max);
}

/** Same text, ignoring case and accents (for filtering). */
export const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

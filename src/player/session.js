// Carrying on where you left off (TubeGrab's): the queue, the song and the
// second are kept as you listen (every few seconds and when the app closes)
// and put back when Rumoria opens — paused, unless you asked it to start
// playing by itself. Only plain song data is kept, each field checked when read.
import { usePlayer } from '../store/player.js';
import { useSound } from '../store/sound.js';

const KEY = 'rumoria_session';
const MAX = 500;
const YT_RE = /^[A-Za-z0-9_-]{11}$/;
const LIST_RE = /^[a-f0-9]{16}$/;
const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

/** One song as kept: only what's needed to play it again. */
export function cleanItem(t) {
  if (!t || typeof t !== 'object' || !text(t.title, 300)) return null;
  const out = { title: text(t.title, 300), artist: text(t.artist, 200) };
  if (YT_RE.test(String(t.yt || ''))) out.yt = t.yt;
  if (typeof t.key === 'string' && t.key.length <= 200) out.key = t.key;
  if (typeof t.query === 'string' && t.query.length <= 200) out.query = t.query;
  if (typeof t.localId === 'string' && /^[\w-]{1,80}$/.test(t.localId)) out.localId = t.localId;
  if (LIST_RE.test(String(t.list || ''))) { out.list = t.list; if (Number.isInteger(t.n) && t.n >= 0) out.n = t.n; }
  if (Number.isFinite(t.duration) && t.duration > 0 && t.duration < 86400) out.duration = t.duration;
  if (typeof t.thumbnail === 'string' && /^https:\/\/i\d?\.ytimg\.com\//.test(t.thumbnail) && t.thumbnail.length <= 500) out.thumbnail = t.thumbnail;
  if (!out.yt && !out.query && !out.localId) return null;
  return out;
}

/** What's kept of the player now (null when nothing plays). */
export function snapshot(p = usePlayer.getState()) {
  const q = p.queue;
  if (!q.items.length || q.index < 0) return null;
  // Around the current song, at most MAX.
  const from = Math.max(0, q.index - 100);
  const items = q.items.slice(from, from + MAX).map(cleanItem);
  const index = q.index - from;
  if (!items[index]) return null;
  const kept = items.filter(Boolean);
  return { v: 1, items: kept, index: kept.indexOf(items[index]), position: Math.max(0, Math.floor(p.position || 0)), repeat: p.repeat, at: Date.now() };
}

/** Read back, every field checked. */
export function readSession(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Array.isArray(raw.items)) return null;
  const items = raw.items.slice(0, MAX).map(cleanItem).filter(Boolean);
  const index = Number.isInteger(raw.index) && raw.index >= 0 && raw.index < items.length ? raw.index : -1;
  if (index < 0) return null;
  return { items, index, position: Number.isFinite(raw.position) && raw.position >= 0 && raw.position < 86400 ? raw.position : 0, repeat: ['off', 'all', 'one'].includes(raw.repeat) ? raw.repeat : 'off' };
}

export function startSession({ store = usePlayer, sound = useSound, storage = typeof localStorage !== 'undefined' ? localStorage : null } = {}) {
  if (!storage) return () => {};
  // Back where you left off.
  if (sound.getState().resume) {
    try {
      const s = readSession(JSON.parse(storage.getItem(KEY)));
      if (s) store.getState().restoreSession(s, { play: sound.getState().autoplay });
    } catch { /* nothing kept */ }
  }
  let last = 0;
  const save = () => {
    if (!sound.getState().resume) { try { storage.removeItem(KEY); } catch { /* fine */ } return; }
    const snap = snapshot(store.getState());
    try { if (snap) storage.setItem(KEY, JSON.stringify(snap)); } catch { /* full: next time */ }
  };
  // On every change of song at once; while playing, every 5 seconds.
  const off = store.subscribe((s, before) => {
    const songChanged = s.queue !== before.queue;
    if (songChanged || Date.now() - last > 5000) { last = Date.now(); save(); }
  });
  const onClose = () => save();
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', onClose);
  return () => { off(); if (typeof window !== 'undefined') window.removeEventListener('beforeunload', onClose); save(); };
}

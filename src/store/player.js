// What's playing, what comes next, and how: the one source of truth for the
// whole page (player bar, lists, queue panel, lyrics). It only holds state and
// intent; src/player/engine.js makes the <audio> follow it.
import { create } from 'zustand';
import { emptyQueue, insert, nextIndex, prevIndex, removeAt, replaceAt, setShuffle, startQueue } from '../lib/queue.js';

const VOLUME_KEY = 'escuchar_volume';
const savedVolume = () => {
  try { const v = Number(localStorage.getItem(VOLUME_KEY)); return Number.isFinite(v) && v >= 0 && v <= 1 && localStorage.getItem(VOLUME_KEY) !== null ? v : 0.8; } catch { return 0.8; }
};

export const usePlayer = create((set, get) => ({
  queue: emptyQueue(),
  wantPlaying: false,   // what the user asked for
  status: 'idle',       // what the <audio> is doing: idle | loading | playing | paused | error
  error: null,
  position: 0,
  duration: 0,
  volume: savedVolume(),
  muted: false,
  repeat: 'off',        // off | all | one
  radio: true,          // when the queue runs out, keep going with similar songs
  seekTo: null,         // { t, nonce } for the engine
  restartNonce: 0,      // "play this one again from the start"

  current: () => { const q = get().queue; return q.items[q.index] || null; },
  shuffle: () => Boolean(get().queue.original),

  /** Plays `tracks` from `start` (a list, search results, a mix…). */
  playTracks(tracks, start = 0, { shuffle = false } = {}) {
    if (!tracks.length) return;
    set({ queue: startQueue(tracks, start, { shuffle: shuffle || get().shuffle() }), wantPlaying: true, position: 0, duration: 0, error: null });
  },
  toggle() {
    if (!get().current()) return;
    set((s) => ({ wantPlaying: !s.wantPlaying }));
  },
  play() { if (get().current()) set({ wantPlaying: true }); },
  pause() { set({ wantPlaying: false }); },
  next(auto = false) {
    const { queue, repeat } = get();
    const r = nextIndex(queue, repeat, auto);
    if (r.end) { set({ wantPlaying: false, status: 'paused' }); return false; }
    if (r.index === queue.index) set((s) => ({ restartNonce: s.restartNonce + 1, position: 0, wantPlaying: true }));
    else set({ queue: { ...queue, index: r.index }, position: 0, duration: 0, wantPlaying: true, error: null });
    return true;
  },
  prev() {
    const { queue, position, repeat } = get();
    const r = prevIndex(queue, position, repeat);
    if (r.index < 0) return;
    if (r.restart) set((s) => ({ restartNonce: s.restartNonce + 1, position: 0 }));
    else set({ queue: { ...queue, index: r.index }, position: 0, duration: 0, wantPlaying: true, error: null });
  },
  jump(i) {
    const { queue } = get();
    if (i >= 0 && i < queue.items.length) set({ queue: { ...queue, index: i }, position: 0, duration: 0, wantPlaying: true, error: null });
  },
  seek(t) {
    const d = get().duration;
    if (!Number.isFinite(t)) return;
    const to = Math.max(0, d ? Math.min(d - 0.5, t) : t);
    set({ seekTo: { t: to, nonce: Math.random() }, position: to });
  },
  setVolume(v) {
    const volume = Math.max(0, Math.min(1, Number(v) || 0));
    try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch { /* only for now */ }
    set({ volume, muted: volume === 0 ? get().muted : false });
  },
  toggleMute() { set((s) => ({ muted: !s.muted })); },
  cycleRepeat() { set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })); },
  toggleShuffle() { set((s) => ({ queue: setShuffle(s.queue, !s.queue.original) })); },
  toggleRadio() { set((s) => ({ radio: !s.radio })); },
  enqueue(tracks, where = 'end') {
    const wasEmpty = !get().queue.items.length;
    set((s) => ({ queue: insert(s.queue, tracks, where), ...(wasEmpty ? { wantPlaying: true } : {}) }));
  },
  removeFromQueue(i) { set((s) => ({ queue: removeAt(s.queue, i) })); },

  // ---- from the engine ----
  _status(status, error = null) { set({ status, error }); },
  _time(position, duration) { set({ position, duration: Number.isFinite(duration) && duration > 0 ? duration : get().duration }); },
  _resolve(uid, patch) {
    const q = get().queue;
    const i = q.items.findIndex((x) => x.uid === uid);
    if (i >= 0) set({ queue: replaceAt(q, i, patch) });
  },
  _append(tracks) { set((s) => ({ queue: insert(s.queue, tracks, 'end') })); },
}));

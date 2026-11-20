// v1.13, Podcasts: the shows you follow, their episodes (YouTube, newest
// first) and where you left each one. The server keeps them (podcasts.json);
// this is the page's copy, and the bit that notes your place as you listen.
import { create } from 'zustand';
import { api, urls } from '../api.js';
import { usePlayer } from './player.js';

const enc = encodeURIComponent;
const SAVE_EVERY_S = 15;

/** An episode → a track the player knows (the show stands in for the artist). */
export const episodeTrack = (e, show) => ({
  key: `yt:${e.yt}`, yt: e.yt, title: e.title, artist: show ? show.name : '', thumbnail: e.thumbnail || null, duration: e.duration || null, episode: show ? show.id : e.show,
});

/** 'new' | 'started' | 'done', and the seconds left, from what's kept of it. */
export function stateOf(e, progress) {
  const p = progress && progress[e.yt];
  if (!p) return { state: 'new', left: e.duration || null, t: 0 };
  if (p.done) return { state: 'done', left: 0, t: 0 };
  const d = p.d || e.duration || 0;
  return { state: p.t > 5 ? 'started' : 'new', left: d ? Math.max(0, d - p.t) : null, t: p.t, d };
}

/** "48 min", "1 h 05 min". */
export function minutes(secs) {
  if (!Number.isFinite(secs) || secs <= 0) return '';
  const m = Math.max(1, Math.round(secs / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

export const usePodcasts = create((set, get) => ({
  loaded: false,
  shows: [],
  progress: {},
  episodes: {}, // show id -> { list, error, loading }
  notes: {},    // video id -> { text, error, loading } (v1.13: asked for when Notas opens)

  async load() {
    try {
      const r = await api.get('/api/podcasts');
      set({ loaded: true, shows: r.shows || [], progress: r.progress || {} });
    } catch { set({ loaded: true }); }
  },

  async loadEpisodes(id, { force = false } = {}) {
    const had = get().episodes[id];
    if (had && (had.loading || (had.list && !force))) return had.list || [];
    set((s) => ({ episodes: { ...s.episodes, [id]: { ...had, loading: true, error: null } } }));
    try {
      const r = await api.get(`/api/podcasts/${enc(id)}/episodes`);
      set((s) => ({ episodes: { ...s.episodes, [id]: { list: r.episodes || [], loading: false, error: null } } }));
      return r.episodes || [];
    } catch (err) {
      set((s) => ({ episodes: { ...s.episodes, [id]: { list: had && had.list, loading: false, error: err.message } } }));
      return [];
    }
  },

  /** Follows a channel or a playlist from its link. Returns the show. */
  async follow(url) {
    const r = await api.post('/api/podcasts', { url });
    set((s) => ({ shows: [r.show, ...s.shows.filter((x) => x.id !== r.show.id)], episodes: { ...s.episodes, [r.show.id]: { list: r.episodes, loading: false, error: null } } }));
    return r.show;
  },

  async unfollow(id) {
    await api.del(`/api/podcasts/${enc(id)}`);
    set((s) => ({ shows: s.shows.filter((x) => x.id !== id) }));
  },

  /** Plays an episode (and the show's next ones after it), from where you left it. */
  play(episode, show, list = [episode]) {
    const start = Math.max(0, list.findIndex((x) => x.yt === episode.yt));
    const st = stateOf(episode, get().progress);
    usePlayer.getState().playTracks(list.map((e) => episodeTrack(e, show)), start, { shuffle: false, resumeAt: st.state === 'started' ? st.t : 0 });
  },

  /** Your place in an episode, here at once and on the server. */
  async saveProgress(track, t, d, { done = false } = {}) {
    if (!track || !track.yt || !track.episode) return;
    const body = { yt: track.yt, t: Math.max(0, Math.floor(t || 0)), d: d ? Math.round(d) : undefined, done, title: track.title, show: track.episode, thumb: track.thumbnail || undefined };
    try {
      const kept = await api.post('/api/podcasts/progress', body);
      set((s) => ({ progress: { ...s.progress, [track.yt]: kept } }));
    } catch { /* next time */ }
  },

  /** An episode's notes (its YouTube description), once per episode. */
  async loadNotes(yt) {
    const had = get().notes[yt];
    if (had && (had.loading || typeof had.text === 'string')) return;
    set((s) => ({ notes: { ...s.notes, [yt]: { loading: true } } }));
    try {
      const r = await api.get(`/api/podcasts/notes/${enc(yt)}`);
      set((s) => ({ notes: { ...s.notes, [yt]: { text: r.notes || '', loading: false } } }));
    } catch (err) {
      set((s) => ({ notes: { ...s.notes, [yt]: { error: err.message, loading: false } } }));
    }
  },

  async markUnheard(yt) {
    try { await api.post('/api/podcasts/progress/remove', { yt }); } catch { return; }
    set((s) => { const progress = { ...s.progress }; delete progress[yt]; return { progress }; });
  },
}));

/**
 * While an episode plays: its place is saved every SAVE_EVERY_S seconds, when
 * it's paused, when another one starts, and when it ends (heard).
 */
export function startPodcastProgress({ store = usePlayer, podcasts = usePodcasts } = {}) {
  let lastSaved = { uid: null, t: 0 };
  const off = store.subscribe((s, prev) => {
    const cur = s.queue.items[s.queue.index] || null;
    const was = prev.queue.items[prev.queue.index] || null;
    // The one that was playing, at the second it was left.
    if (was && was.episode && (!cur || cur.uid !== was.uid) && prev.position > 5) {
      const ended = prev.duration && prev.position >= prev.duration - 2;
      podcasts.getState().saveProgress(was, ended ? prev.duration : prev.position, prev.duration, { done: Boolean(ended) });
    }
    if (!cur || !cur.episode || s.resumeAt) return;
    if (lastSaved.uid !== cur.uid) lastSaved = { uid: cur.uid, t: s.position };
    const paused = prev.wantPlaying && !s.wantPlaying;
    if (s.position > 5 && (paused || Math.abs(s.position - lastSaved.t) >= SAVE_EVERY_S)) {
      lastSaved = { uid: cur.uid, t: s.position };
      podcasts.getState().saveProgress(cur, s.position, s.duration);
    }
  });
  const onClose = () => {
    const s = store.getState();
    const cur = s.queue.items[s.queue.index];
    if (cur && cur.episode && s.position > 5) podcasts.getState().saveProgress(cur, s.position, s.duration);
  };
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', onClose);
  return () => { off(); if (typeof window !== 'undefined') window.removeEventListener('beforeunload', onClose); };
}

export const searchUrl = (q) => urls.search(`${q} podcast`);

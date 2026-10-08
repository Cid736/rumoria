// Makes one <audio> follow the player store: loads the current song (your
// file, a YouTube video, or a song known by name, found first), plays and
// pauses, seeks, keeps going with similar songs when the queue runs out,
// notes what you actually listened to, and answers the keyboard's media keys.
//
// v1.3: a song that won't load is tried again (up to 3 times, the address
// looked up anew each time; one stuck loading for 20 s counts as a failure).
// After the third, in a list of more than 50 songs it's taken out of the list
// (with "Deshacer") and of the cache, so big lists don't keep tripping on it;
// elsewhere it's skipped. The next songs are looked up ahead (how many, by
// the performance profile), and the song kept from last time starts at its second.
import { api, urls } from '../api.js';
import { fromYouTube, songOf } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { PROFILES, usePerf } from '../store/perf.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';
import { startSound } from './sound.js';

export const MAX_ATTEMPTS = 3;
export const STALL_MS = 20_000;
export const BIG_LIST = 50;

let active = null;
/** The running engine's sound chain (for the visualizer), or null. */
export const activeSound = () => (active && active.sound) || null;

export function startEngine({
  audio = new Audio(), store = usePlayer, library = useLibrary, perf = usePerf,
  toast = (t, o) => useUi.getState().toast(t, o), get = api.get, post = api.post,
  media = typeof navigator !== 'undefined' ? navigator.mediaSession : null, sound = null,
} = {}) {
  audio.preload = 'auto';
  let loadedUid = null; // the song being loaded or played
  let srcUid = null;    // the song whose audio is attached
  let loadRun = 0;      // the latest load (an older one that finishes late is ignored)
  let heard = null;     // { track, secs, lastT }
  let skipTimer = null;
  let stallTimer = null;
  const attempts = new Map(); // uid -> failures so far
  const prepared = new Set(); // uids looked up ahead
  const ctl = sound || (typeof AudioContext !== 'undefined' ? startSound({ audio }) : null);

  const state = () => store.getState();

  // ---- what you listened to (5 s or more counts; 30 s is "a play" on the server) ----
  function flushHeard() {
    if (!heard) return;
    const song = songOf(heard.track);
    const secs = Math.round(heard.secs);
    heard = null;
    if (song && secs >= 5) post('/api/history', { song, secs }).catch(() => {});
  }

  function skipSoon(uid) {
    clearTimeout(skipTimer);
    // A moment to read it, then the next one (if this is still the song).
    skipTimer = setTimeout(() => { if (loadedUid === uid) state().next(true); }, 1500);
  }

  /** In a list of more than BIG_LIST songs, the song is taken out of it (with "Deshacer"). */
  async function dropFromList(track) {
    const lib = library.getState();
    const summary = (lib.lists || []).find((l) => l.id === track.list);
    if (!summary || summary.count <= BIG_LIST) return false;
    try {
      const l = await lib.loadList(track.list);
      const same = (t) => (track.yt && t.yt === track.yt) || (track.query && t.query === track.query) || (t.title === track.title && (t.artist || '') === (track.artist || ''));
      const i = Number.isInteger(track.n) && l.tracks[track.n] && same(l.tracks[track.n]) ? track.n : l.tracks.findIndex(same);
      if (i < 0) return false;
      return await lib.removeTracks(track.list, [i], { message: `«${track.title}» no cargó tras ${MAX_ATTEMPTS} intentos: quitada de «${l.name}»` });
    } catch { return false; }
  }

  /** A failure: try again, or give up (taken out of a big list, or skipped). */
  async function failed(track, message) {
    clearTimeout(stallTimer);
    if (loadedUid !== track.uid) return;
    const n = (attempts.get(track.uid) || 0) + 1;
    attempts.set(track.uid, n);
    if (n < MAX_ATTEMPTS) {
      state()._status('loading');
      setTimeout(() => { if (loadedUid === track.uid) load(state().current() || track, n); }, 500 * n);
      return;
    }
    // For good: forgotten by the server, out of a big list, out of the queue.
    state()._status('error', message);
    if (track.yt) post(urls.forget(track.yt)).catch(() => {});
    const out = track.list ? await dropFromList(track) : false;
    if (out) { if (loadedUid === track.uid) state()._drop(track.uid); return; }
    toast(message);
    skipSoon(track.uid);
  }

  function watchStall(track) {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      const s = state();
      if (loadedUid === track.uid && s.wantPlaying && s.status === 'loading') failed(track, 'Esta canción no termina de cargar.');
    }, STALL_MS);
  }

  async function load(track, attempt = 0) {
    const run = ++loadRun;
    if (attempt === 0) flushHeard();
    loadedUid = track.uid;
    srcUid = null;
    clearTimeout(skipTimer);
    audio.pause();
    state()._status('loading');
    let src = null;
    try {
      if (track.localId) src = urls.local(track.localId);
      else if (track.yt) src = urls.audio(track.yt, attempt);
      else if (track.query) {
        const hit = await get(urls.find(track.query, track.duration, track.list, track.n));
        if (run !== loadRun) return;
        state()._resolve(track.uid, { yt: hit.id, key: `yt:${hit.id}`, thumbnail: track.thumbnail || hit.thumbnail || null, duration: track.duration || hit.duration || null });
        src = urls.audio(hit.id, attempt);
      }
    } catch (err) {
      if (run === loadRun) failed(track, err.message || 'No se encontró esta canción.');
      return;
    }
    if (!src) { failed(track, 'No se puede reproducir esta canción.'); return; }
    if (attempt === 0) heard = { track: state().current() || track, secs: 0, lastT: 0 };
    audio.src = src;
    srcUid = track.uid;
    // The song kept from last time starts where it was.
    const r = state().resumeAt;
    if (r && r.uid === track.uid) {
      audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = r.t; } catch { /* not seekable */ } state()._resumed(); }, { once: true });
    }
    if (state().wantPlaying) { watchStall(track); audio.play().catch(() => { /* the error event says why */ }); }
    setMediaInfo(state().current() || track);
  }

  // ---- the next songs, looked up ahead (Medio: one, Alto: two, Mínimo: none) ----
  function prepareNext() {
    const s = state();
    const n = (PROFILES[perf.getState().profile] || PROFILES.mid).prefetch;
    for (const t of s.queue.items.slice(s.queue.index + 1, s.queue.index + 1 + n)) {
      if (prepared.has(t.uid) || t.localId) continue;
      prepared.add(t.uid);
      if (t.yt) post(urls.prepare(t.yt)).catch(() => {});
      else if (t.query) {
        get(urls.find(t.query, t.duration, t.list, t.n)).then((hit) => {
          state()._resolve(t.uid, { yt: hit.id, key: `yt:${hit.id}`, thumbnail: t.thumbnail || hit.thumbnail || null, duration: t.duration || hit.duration || null });
          return post(urls.prepare(hit.id));
        }).catch(() => {});
      }
    }
    if (prepared.size > 2000) prepared.clear();
  }

  // ---- the operating system's media keys and overlay ----
  function setMediaInfo(t) {
    if (typeof document !== 'undefined') document.title = t ? `${t.title}${t.artist ? ` · ${t.artist}` : ''}` : 'Rumoria';
    if (!media || typeof MediaMetadata === 'undefined') return;
    media.metadata = t ? new MediaMetadata({ title: t.title, artist: t.artist || '', artwork: t.thumbnail ? [{ src: t.thumbnail, sizes: '480x360', type: 'image/jpeg' }] : [] }) : null;
  }
  if (media) {
    const handlers = {
      play: () => state().play(), pause: () => state().pause(),
      nexttrack: () => state().next(), previoustrack: () => state().prev(),
      seekto: (d) => state().seek(d.seekTime),
    };
    for (const [k, fn] of Object.entries(handlers)) { try { media.setActionHandler(k, fn); } catch { /* not supported */ } }
  }

  // ---- when the queue runs out: similar songs ("radio") ----
  async function keepGoing() {
    const { queue, radio } = state();
    const seed = [...queue.items].reverse().find((x) => x.yt);
    if (!radio || !seed) return false;
    try {
      const r = await get(urls.radio(seed.yt));
      const known = new Set(queue.items.map((x) => x.key));
      const more = (r.entries || []).map(fromYouTube).filter((x) => !known.has(x.key)).slice(0, 20);
      if (!more.length) return false;
      state()._append(more);
      return state().next(true);
    } catch { return false; }
  }

  // ---- the <audio> tells us ----
  audio.addEventListener('playing', () => {
    clearTimeout(stallTimer);
    if (srcUid) attempts.delete(srcUid);
    state()._status('playing');
    prepareNext();
  });
  audio.addEventListener('pause', () => { if (!audio.ended && state().status !== 'loading') state()._status('paused'); });
  audio.addEventListener('waiting', () => {
    state()._status('loading');
    const cur = state().current();
    if (cur && cur.uid === srcUid && state().wantPlaying) watchStall(cur);
  });
  audio.addEventListener('timeupdate', () => {
    // While the next song is being found, the old one's time is not news.
    if (srcUid !== loadedUid) return;
    const t = audio.currentTime;
    if (heard && !audio.paused) {
      const d = t - heard.lastT;
      // Real seconds heard (at 1.5× a second of song is less of your time).
      if (d > 0 && d < 3) heard.secs += d / (audio.playbackRate || 1);
      heard.lastT = t;
    }
    state()._time(t, audio.duration);
  });
  audio.addEventListener('seeked', () => { if (heard) heard.lastT = audio.currentTime; });
  audio.addEventListener('ended', async () => {
    flushHeard();
    // "Al acabar esta canción": the sleep timer stops here.
    if (ctl && ctl.sleepAtEnd && ctl.sleepAtEnd()) { state().pause(); return; }
    if (!state().next(true)) await keepGoing();
  });
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src') && !audio.src) return;
    const cur = state().current();
    if (cur && cur.uid === srcUid) failed(cur, 'No se puede reproducir esta canción ahora.');
  });

  // ---- the store tells us ----
  const unsubscribe = store.subscribe((s, prev) => {
    const cur = s.queue.items[s.queue.index] || null;
    if (!cur) {
      if (loadedUid !== null) { flushHeard(); loadedUid = null; srcUid = null; clearTimeout(stallTimer); audio.pause(); audio.removeAttribute('src'); setMediaInfo(null); s._status('idle'); }
    } else if (cur.uid !== loadedUid) {
      load(cur);
    } else if (cur !== (prev.queue.items[prev.queue.index] || null)) {
      setMediaInfo(cur); // found its video, cover…
    }
    if (s.queue !== prev.queue && s.status === 'playing') prepareNext();
    if (s.restartNonce !== prev.restartNonce) { audio.currentTime = 0; if (heard) heard.lastT = 0; if (s.wantPlaying) audio.play().catch(() => {}); }
    if (s.wantPlaying !== prev.wantPlaying && cur && cur.uid === srcUid) {
      if (s.wantPlaying) { audio.play().catch(() => {}); if (s.status === 'loading') watchStall(cur); } else { audio.pause(); clearTimeout(stallTimer); }
    }
    if (s.seekTo !== prev.seekTo && s.seekTo) { try { audio.currentTime = s.seekTo.t; } catch { /* not seekable yet */ } }
    if (s.volume !== prev.volume) audio.volume = s.volume;
    if (s.muted !== prev.muted) audio.muted = s.muted;
    if (media) { try { media.playbackState = s.wantPlaying ? 'playing' : 'paused'; } catch { /* ignore */ } }
  });
  audio.volume = state().volume;
  // A queue already there (back where you left off): loaded, paused or playing as asked.
  if (state().current()) load(state().current());

  if (typeof window !== 'undefined') window.addEventListener('beforeunload', flushHeard);

  active = { audio, sound: ctl, stop() { unsubscribe(); flushHeard(); clearTimeout(stallTimer); audio.pause(); if (ctl && ctl.stop) ctl.stop(); active = null; } };
  return active;
}

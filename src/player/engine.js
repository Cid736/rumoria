// Makes one <audio> follow the player store: loads the current song (your
// file, a YouTube video, or a song known by name, found first), plays and
// pauses, seeks, keeps going with similar songs when the queue runs out,
// notes what you actually listened to, and answers the keyboard's media keys.
import { api, urls } from '../api.js';
import { fromYouTube, songOf } from '../lib/tracks.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';

export function startEngine({ audio = new Audio(), store = usePlayer, toast = (t) => useUi.getState().toast(t), get = api.get, post = api.post, media = typeof navigator !== 'undefined' ? navigator.mediaSession : null } = {}) {
  audio.preload = 'auto';
  let loadedUid = null; // the song being loaded or played
  let srcUid = null;    // the song whose audio is attached
  let loadRun = 0;      // the latest load (an older one that finishes late is ignored)
  let heard = null; // { track, secs, lastT }
  let skipTimer = null;

  const state = () => store.getState();

  // ---- what you listened to (5 s or more counts; 30 s is "a play" on the server) ----
  function flushHeard() {
    if (!heard) return;
    const song = songOf(heard.track);
    const secs = Math.round(heard.secs);
    heard = null;
    if (song && secs >= 5) post('/api/history', { song, secs }).catch(() => {});
  }

  function failAndSkip(message) {
    state()._status('error', message);
    toast(message);
    clearTimeout(skipTimer);
    // A moment to read it, then the next one (if this is still the song).
    const uid = loadedUid;
    skipTimer = setTimeout(() => { if (loadedUid === uid) state().next(true); }, 1500);
  }

  async function load(track) {
    const run = ++loadRun;
    flushHeard();
    loadedUid = track.uid;
    srcUid = null;
    clearTimeout(skipTimer);
    audio.pause();
    state()._status('loading');
    let src = null;
    try {
      if (track.localId) src = urls.local(track.localId);
      else if (track.yt) src = urls.audio(track.yt);
      else if (track.query) {
        const hit = await get(urls.find(track.query, track.duration, track.list, track.n));
        if (run !== loadRun) return;
        state()._resolve(track.uid, { yt: hit.id, key: `yt:${hit.id}`, thumbnail: track.thumbnail || hit.thumbnail || null, duration: track.duration || hit.duration || null });
        src = urls.audio(hit.id);
      }
    } catch (err) {
      if (run === loadRun) failAndSkip(err.message || 'No se encontró esta canción.');
      return;
    }
    if (!src) { failAndSkip('No se puede reproducir esta canción.'); return; }
    heard = { track: state().current() || track, secs: 0, lastT: 0 };
    audio.src = src;
    srcUid = track.uid;
    if (state().wantPlaying) audio.play().catch(() => { /* the error event says why */ });
    setMediaInfo(state().current() || track);
  }

  // ---- the operating system's media keys and overlay ----
  function setMediaInfo(t) {
    if (typeof document !== 'undefined') document.title = t ? `${t.title}${t.artist ? ` · ${t.artist}` : ''}` : 'CLMusic';
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
  audio.addEventListener('playing', () => state()._status('playing'));
  audio.addEventListener('pause', () => { if (!audio.ended && state().status !== 'loading') state()._status('paused'); });
  audio.addEventListener('waiting', () => state()._status('loading'));
  audio.addEventListener('timeupdate', () => {
    // While the next song is being found, the old one's time is not news.
    if (srcUid !== loadedUid) return;
    const t = audio.currentTime;
    if (heard && !audio.paused) {
      const d = t - heard.lastT;
      if (d > 0 && d < 2) heard.secs += d;
      heard.lastT = t;
    }
    state()._time(t, audio.duration);
  });
  audio.addEventListener('seeked', () => { if (heard) heard.lastT = audio.currentTime; });
  audio.addEventListener('ended', async () => {
    flushHeard();
    if (!state().next(true)) await keepGoing();
  });
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src') && !audio.src) return;
    failAndSkip('No se puede reproducir esta canción ahora.');
  });

  // ---- the store tells us ----
  const unsubscribe = store.subscribe((s, prev) => {
    const cur = s.queue.items[s.queue.index] || null;
    if (!cur) {
      if (loadedUid !== null) { flushHeard(); loadedUid = null; srcUid = null; audio.pause(); audio.removeAttribute('src'); setMediaInfo(null); s._status('idle'); }
    } else if (cur.uid !== loadedUid) {
      load(cur);
    } else if (cur !== (prev.queue.items[prev.queue.index] || null)) {
      setMediaInfo(cur); // found its video, cover…
    }
    if (s.restartNonce !== prev.restartNonce) { audio.currentTime = 0; if (heard) heard.lastT = 0; if (s.wantPlaying) audio.play().catch(() => {}); }
    if (s.wantPlaying !== prev.wantPlaying && cur && cur.uid === srcUid) {
      if (s.wantPlaying) audio.play().catch(() => {}); else audio.pause();
    }
    if (s.seekTo !== prev.seekTo && s.seekTo) { try { audio.currentTime = s.seekTo.t; } catch { /* not seekable yet */ } }
    if (s.volume !== prev.volume) audio.volume = s.volume;
    if (s.muted !== prev.muted) audio.muted = s.muted;
    if (media) { try { media.playbackState = s.wantPlaying ? 'playing' : 'paused'; } catch { /* ignore */ } }
  });
  audio.volume = state().volume;

  if (typeof window !== 'undefined') window.addEventListener('beforeunload', flushHeard);

  return { audio, stop() { unsubscribe(); flushHeard(); audio.pause(); } };
}

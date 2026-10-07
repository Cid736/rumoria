// The page ↔ the mini player: what's playing goes out (a few times a second at
// most), the mini player's buttons come back and drive the same player.
import { desktop } from '../api.js';
import { keyOf, songOf } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { usePlayer } from '../store/player.js';

/** What the mini player shows, from the player and your favourites. */
export function miniState(p = usePlayer.getState(), lib = useLibrary.getState()) {
  const t = p.current();
  if (!t) return { title: '', artist: '', cover: null, playing: false, time: 0, duration: 0, liked: false, canLike: false, volume: p.volume, shuffle: p.shuffle(), repeat: p.repeat, hasNext: false };
  return {
    title: t.title || '', artist: t.artist || '', cover: t.thumbnail || null,
    playing: p.wantPlaying, loading: p.status === 'loading',
    time: p.position || 0, duration: p.duration || t.duration || 0,
    liked: lib.isLiked(keyOf(t)), canLike: Boolean(songOf(t)),
    volume: p.volume, shuffle: p.shuffle(), repeat: p.repeat,
    hasNext: p.queue.index < p.queue.items.length - 1 || p.radio || p.repeat !== 'off',
  };
}

/** A button pressed in the mini player. */
export function runMiniCommand(c, p = usePlayer.getState(), lib = useLibrary.getState()) {
  if (!c || typeof c !== 'object') return;
  switch (c.cmd) {
    case 'toggle': p.toggle(); break;
    case 'next': p.next(); break;
    case 'prev': p.prev(); break;
    case 'seek': if (Number.isFinite(c.value)) p.seek(c.value); break;
    case 'volume': if (Number.isFinite(c.value)) p.setVolume(c.value); break;
    case 'shuffle': p.toggleShuffle(); break;
    case 'repeat': p.cycleRepeat(); break;
    case 'like': { const t = p.current(); if (t && songOf(t)) lib.setLike(t, !lib.isLiked(keyOf(t))); break; }
    default: break;
  }
}

/** Starts the bridge (desktop only). Returns a way to stop it. */
export function startMiniBridge(bridge = desktop && desktop.mini) {
  if (!bridge) return () => {};
  let last = '';
  let timer = null;
  const send = () => {
    timer = null;
    const s = miniState();
    // Seconds are enough for the bar; nothing sent when nothing changed.
    const key = JSON.stringify({ ...s, time: Math.floor(s.time) });
    if (key === last) return;
    last = key;
    bridge.state(s);
  };
  const soon = () => { if (!timer) timer = setTimeout(send, 250); };
  const offPlayer = usePlayer.subscribe(soon);
  const offLib = useLibrary.subscribe((s, before) => { if (s.likedKeys !== before.likedKeys) soon(); });
  const offCmd = bridge.onCommand((c) => runMiniCommand(c));
  send();
  return () => { offPlayer(); offLib(); offCmd(); clearTimeout(timer); };
}

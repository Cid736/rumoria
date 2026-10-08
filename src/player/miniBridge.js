// The page ↔ the mini player: what's playing goes out (a few times a second at
// most), the mini player's buttons come back and drive the same player.
// v2: also the video's id (for its clip), the next song, and — when the mini
// player shows lyrics — the line being sung and the next one.
import { api, desktop, urls } from '../api.js';
import { keyOf, songOf } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { usePlayer } from '../store/player.js';

/** The line being sung at `t` (and the next), from synced lyrics [{ t, text }]. */
export function lineAt(synced, t) {
  if (!Array.isArray(synced) || !synced.length) return { line: '', nextLine: '' };
  let at = -1;
  for (let i = 0; i < synced.length; i++) if (synced[i].t <= t + 0.25) at = i; else break;
  return { line: at >= 0 ? synced[at].text || '♪' : '', nextLine: synced[at + 1] ? synced[at + 1].text || '' : '' };
}

/** What the mini player shows, from the player, your favourites and the lyrics (if any). */
export function miniState(p = usePlayer.getState(), lib = useLibrary.getState(), lyrics = null) {
  const t = p.current();
  if (!t) return { title: '', artist: '', cover: null, playing: false, time: 0, duration: 0, liked: false, canLike: false, volume: p.volume, muted: p.muted, shuffle: p.shuffle(), repeat: p.repeat, hasNext: false, yt: null, line: '', nextLine: '', upNext: '', queue: [] };
  const next = p.queue.items[p.queue.index + 1];
  const words = lyrics && lyrics.yt === t.yt ? lineAt(lyrics.synced, p.position || 0) : { line: '', nextLine: '' };
  return {
    title: t.title || '', artist: t.artist || '', cover: t.thumbnail || null,
    playing: p.wantPlaying, loading: p.status === 'loading',
    time: p.position || 0, duration: p.duration || t.duration || 0,
    liked: lib.isLiked(keyOf(t)), canLike: Boolean(songOf(t)),
    volume: p.volume, shuffle: p.shuffle(), repeat: p.repeat,
    hasNext: p.queue.index < p.queue.items.length - 1 || p.radio || p.repeat !== 'off',
    yt: t.yt || null, upNext: next ? `${next.title}${next.artist ? ` · ${next.artist}` : ''}` : '',
    // v1.5: muted, and the next five (their place, to jump there from the mini player or the tray).
    muted: p.muted,
    queue: p.queue.items.slice(p.queue.index + 1, p.queue.index + 6).map((x, k) => ({ i: p.queue.index + 1 + k, title: x.title || '', artist: x.artist || '' })),
    ...words,
  };
}

/** A button pressed in the mini player (or the tray). */
export function runMiniCommand(c, p = usePlayer.getState(), lib = useLibrary.getState()) {
  if (!c || typeof c !== 'object') return;
  switch (c.cmd) {
    case 'toggle': p.toggle(); break;
    case 'next': p.next(); break;
    case 'prev': p.prev(); break;
    case 'seek': if (Number.isFinite(c.value)) p.seek(c.value); break;
    case 'volume': if (Number.isFinite(c.value)) p.setVolume(c.value); break;
    // A global shortcut: a little louder or quieter.
    case 'volumeStep': if (Number.isFinite(c.value)) p.setVolume(p.volume + Math.max(-0.2, Math.min(0.2, c.value))); break;
    case 'mute': p.toggleMute(); break;
    case 'jump': if (Number.isInteger(c.value) && c.value > p.queue.index) p.jump(c.value); break;
    case 'shuffle': p.toggleShuffle(); break;
    case 'repeat': p.cycleRepeat(); break;
    case 'like': { const t = p.current(); if (t && songOf(t)) lib.setLike(t, !lib.isLiked(keyOf(t))); break; }
    default: break;
  }
}

/** Starts the bridge (desktop only). Returns a way to stop it. */
export function startMiniBridge(bridge = desktop && desktop.mini, { get = api.get } = {}) {
  if (!bridge) return () => {};
  let last = '';
  let timer = null;
  let lyrics = null; // { yt, synced }
  let lyricsFor = null;

  // The lyrics of the song playing, once per song, only if the mini player shows them.
  async function lyricsOf(t) {
    if (!t || !t.yt || lyricsFor === t.yt) return;
    lyricsFor = t.yt;
    let want = true;
    try { if (bridge.prefs) { const pr = await bridge.prefs(); want = Boolean(pr && pr.lyrics !== false); } } catch { want = false; }
    if (!want) { lyricsFor = null; return; }
    try {
      const known = Boolean(t.list);
      const r = await get(urls.lyrics(t.yt, known ? t.artist : undefined, known ? t.title : undefined, t.duration));
      if (lyricsFor === t.yt) { lyrics = { yt: t.yt, synced: Array.isArray(r.synced) ? r.synced : null }; soon(); }
    } catch { /* no lyrics */ }
  }

  const send = () => {
    timer = null;
    const s = miniState(usePlayer.getState(), useLibrary.getState(), lyrics);
    // Seconds are enough for the bar; nothing sent when nothing changed.
    const key = JSON.stringify({ ...s, time: Math.floor(s.time) });
    if (key === last) return;
    last = key;
    bridge.state(s);
  };
  const soon = () => { if (!timer) timer = setTimeout(send, 250); };
  const offPlayer = usePlayer.subscribe((s, before) => {
    // The songs themselves (the store's current() always reads the state now).
    const t = s.queue.items[s.queue.index];
    if (t && t !== before.queue.items[before.queue.index]) lyricsOf(t);
    soon();
  });
  const offLib = useLibrary.subscribe((s, before) => { if (s.likedKeys !== before.likedKeys) soon(); });
  const offCmd = bridge.onCommand((c) => runMiniCommand(c));
  lyricsOf(usePlayer.getState().current());
  send();
  return () => { offPlayer(); offLib(); offCmd(); clearTimeout(timer); };
}

// The song's video clip, without sound (the song is what sounds), kept in step
// with it: from this app's own relay (only YouTube's media servers), 360p at
// most. Used by the full-screen "Sonando".
import { useEffect, useRef, useState } from 'react';
import { urls } from '../api.js';
import { rateFor, useSound } from '../store/sound.js';

export default function ClipVideo({ yt, position, playing, episode = false, poster = null, className = '' }) {
  const ref = useRef(null);
  // At the sound's speed: a video at 1× under an episode at 1,25× would be put back
  // in step every second, and every jump starts its download again (never a picture).
  const rate = useSound((s) => rateFor({ episode }, s));
  const [failed, setFailed] = useState(null); // the video id that has no clip
  useEffect(() => {
    const v = ref.current;
    if (!v || !yt) return;
    if (v.playbackRate !== rate) { v.defaultPlaybackRate = rate; v.playbackRate = rate; }
    if (v.readyState >= 1 && Number.isFinite(position) && Math.abs(v.currentTime - position) > 0.8) {
      try { v.currentTime = position; } catch { /* not yet */ }
    }
    if (playing && v.paused) v.play().catch(() => {});
    if (!playing && !v.paused) v.pause();
  }, [yt, position, playing, rate]);
  if (!yt) return null;
  if (failed === yt) return <div className={`clip-video clip-none ${className}`}><p>Esta canción no tiene videoclip disponible.</p></div>;
  return (
    <video key={yt} ref={ref} className={`clip-video ${className}`} src={urls.video(yt)} poster={poster || undefined} muted playsInline preload="auto" aria-label="Videoclip (sin sonido: suena la canción)"
      onLoadedMetadata={(e) => { e.currentTarget.defaultPlaybackRate = rate; e.currentTarget.playbackRate = rate; try { e.currentTarget.currentTime = position || 0; } catch { /* fine */ } if (playing) e.currentTarget.play().catch(() => {}); }}
      onError={() => setFailed(yt)} />
  );
}

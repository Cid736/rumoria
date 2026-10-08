// The song's video clip, without sound (the song is what sounds), kept in step
// with it: from this app's own relay (only YouTube's media servers), 360p at
// most. Used by the full-screen "Sonando".
import { useEffect, useRef, useState } from 'react';
import { urls } from '../api.js';

export default function ClipVideo({ yt, position, playing, className = '' }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(null); // the video id that has no clip
  useEffect(() => {
    const v = ref.current;
    if (!v || !yt) return;
    if (v.readyState >= 1 && Number.isFinite(position) && Math.abs(v.currentTime - position) > 0.8) {
      try { v.currentTime = position; } catch { /* not yet */ }
    }
    if (playing && v.paused) v.play().catch(() => {});
    if (!playing && !v.paused) v.pause();
  }, [yt, position, playing]);
  if (!yt) return null;
  if (failed === yt) return <div className={`clip-video clip-none ${className}`}><p>Esta canción no tiene videoclip disponible.</p></div>;
  return (
    <video key={yt} ref={ref} className={`clip-video ${className}`} src={urls.video(yt)} muted playsInline preload="auto" aria-label="Videoclip (sin sonido: suena la canción)"
      onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = position || 0; } catch { /* fine */ } if (playing) e.currentTarget.play().catch(() => {}); }}
      onError={() => setFailed(yt)} />
  );
}

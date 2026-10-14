// A few bars that follow the music, next to the song in the player bar.
// Drawn only while something plays, the window is visible, the visualizer is
// on and the performance profile allows it (never on "Recursos mínimos").
// v1.12.2: 30 frames a second (was the screen's 60) and nothing redrawn when
// the bars didn't move; it was a quarter of a core while playing.
import { useEffect, useRef } from 'react';
import { activeSound } from '../player/engine.js';
import { usePerf } from '../store/perf.js';
import { usePlayer } from '../store/player.js';
import { useSound } from '../store/sound.js';

const BARS = 12;
const FRAME_MS = 1000 / 30;

export default function Visualizer() {
  const canvas = useRef(null);
  const playing = usePlayer((s) => s.status === 'playing');
  const on = useSound((s) => s.visualizer);
  // Never on "Recursos mínimos".
  const allowed = usePerf((s) => s.profile !== 'min');
  const show = on && allowed;

  useEffect(() => {
    if (!show || !playing || !canvas.current) return undefined;
    const c = canvas.current;
    const g = c.getContext('2d');
    if (!g) return undefined;
    const data = new Uint8Array(128);
    const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff7a59';
    let frame = 0;
    let lastAt = 0;
    let last = '';
    const heights = new Array(BARS).fill(0);
    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      if (document.hidden || now - lastAt < FRAME_MS - 2) return;
      lastAt = now;
      const sound = activeSound();
      const got = sound && sound.bars(data);
      for (let i = 0; i < BARS; i++) {
        // Lower bands spread out (where most of the music is).
        heights[i] = got ? Math.max(2, Math.round((data[Math.floor((i / BARS) ** 1.6 * 60) + 1] / 255) * (c.height - 1))) : 0;
      }
      const key = heights.join(',');
      if (key === last) return;
      last = key;
      g.clearRect(0, 0, c.width, c.height);
      if (!got) return;
      const w = c.width / BARS;
      // The shadow (it was a CSS filter, redone every frame), one pixel below each bar.
      g.fillStyle = 'rgba(0, 0, 0, 0.55)';
      for (let i = 0; i < BARS; i++) g.fillRect(i * w + 1, c.height - heights[i], w - 2, heights[i]);
      g.fillStyle = color;
      for (let i = 0; i < BARS; i++) g.fillRect(i * w + 1, c.height - 1 - heights[i], w - 2, heights[i]);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); g.clearRect(0, 0, c.width, c.height); };
  }, [show, playing]);

  if (!show) return null;
  return <canvas ref={canvas} className="viz" width="60" height="28" aria-hidden="true" />;
}

// A few bars that follow the music, next to the song in the player bar.
// Drawn only while something plays, the window is visible, the visualizer is
// on and the performance profile allows it (never on "Recursos mínimos").
import { useEffect, useRef } from 'react';
import { activeSound } from '../player/engine.js';
import { usePerf } from '../store/perf.js';
import { usePlayer } from '../store/player.js';
import { useSound } from '../store/sound.js';

const BARS = 12;

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
    const draw = () => {
      frame = requestAnimationFrame(draw);
      if (document.hidden) return;
      const sound = activeSound();
      const got = sound && sound.bars(data);
      g.clearRect(0, 0, c.width, c.height);
      if (!got) return;
      g.fillStyle = color;
      const w = c.width / BARS;
      for (let i = 0; i < BARS; i++) {
        // Lower bands spread out (where most of the music is).
        const v = data[Math.floor((i / BARS) ** 1.6 * 60) + 1] / 255;
        const h = Math.max(2, v * c.height);
        g.fillRect(i * w + 1, c.height - h, w - 2, h);
      }
    };
    draw();
    return () => { cancelAnimationFrame(frame); g.clearRect(0, 0, c.width, c.height); };
  }, [show, playing]);

  if (!show) return null;
  return <canvas ref={canvas} className="viz" width="60" height="28" aria-hidden="true" />;
}

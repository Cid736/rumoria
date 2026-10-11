// v1.7: the alarm clock running. Every few seconds it looks whether it's
// time; then it puts on what you chose (or what was playing, if that can't be
// had), starting very quiet and rising to its volume over the minutes you
// chose. Touching the volume yourself stops the rise; "Parar" pauses.
import { usePlayer } from '../store/player.js';
import { isDue, useAlarm } from '../store/alarm.js';
import { useUi } from '../store/ui.js';

export const START_VOLUME = 0.03;
const STEP_MS = 2000;

/**
 * `tracksFor(alarm)` → the songs to put on (may be empty). Returns a way to
 * stop it. `now` and `every` are for tests.
 */
export function startAlarm({ tracksFor, alarm = useAlarm, player = usePlayer, toast = (t, o) => useUi.getState().toast(t, o), now = () => new Date(), every = 15_000 } = {}) {
  let ramp = null;
  let ringing = false;

  function stopRamp() { clearInterval(ramp); ramp = null; }

  /** From very quiet to `target` over `minutes` (at once when 0). */
  function rise(target, minutes) {
    stopRamp();
    const p = player.getState();
    if (!minutes) { p.setVolume(target); return; }
    p.setVolume(START_VOLUME); // (a volume above 0 also takes the mute off)
    const steps = Math.max(1, Math.round((minutes * 60_000) / STEP_MS));
    let k = 0;
    let mine = START_VOLUME;
    ramp = setInterval(() => {
      const s = player.getState();
      // You moved the volume (or stopped the music): it's yours again.
      if (Math.abs(s.volume - mine) > 0.011 || !s.wantPlaying) { stopRamp(); return; }
      k += 1;
      mine = Math.min(target, START_VOLUME + ((target - START_VOLUME) * k) / steps);
      s.setVolume(mine);
      if (k >= steps) stopRamp();
    }, STEP_MS);
  }

  async function ring() {
    const a = alarm.getState();
    alarm.getState().rang(now());
    ringing = true;
    try {
      let tracks = [];
      if (a.source !== 'resume') { try { tracks = (await tracksFor(a)) || []; } catch { tracks = []; } }
      const p = player.getState();
      if (tracks.length) p.playTracks(tracks, 0);
      else if (p.current()) p.play();
      else { toast('El despertador no tenía nada que poner (¿sin conexión?).'); return; }
      rise(a.volume, a.ramp);
      toast(`Buenos días: son las ${a.time}`, { action: 'Parar', ms: 60_000, onAction: () => { stopRamp(); player.getState().pause(); } });
    } finally { ringing = false; }
  }

  const check = () => { if (!ringing && isDue(alarm.getState(), now())) ring(); };
  const timer = setInterval(check, every);
  check();
  return () => { clearInterval(timer); stopRamp(); };
}

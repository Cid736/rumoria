// v1.13: the episode's own buttons, in the computer's player bar and in the
// phone's big player: its speed (1× → 1,25× → … a tap each) and the sleep
// timer (a menu: 15 min … or when this episode ends).
import { nextPodSpeed, SLEEPS, speedLabel, useSound } from '../store/sound.js';
import { useUi } from '../store/ui.js';
import { Clock } from './Icons.jsx';

export function SpeedButton({ className = '' }) {
  const speed = useSound((s) => s.podSpeed);
  return (
    <button type="button" className={`icon-btn speed-btn ${speed !== 1 ? 'on' : ''} ${className}`} aria-label={`Velocidad: ${speedLabel(speed)}. Cambiarla`}
      data-tip="Velocidad del episodio" onClick={() => useSound.getState().set({ podSpeed: nextPodSpeed(speed) })}>
      {speedLabel(speed)}
    </button>
  );
}

export function SleepButton({ size = 20, className = '' }) {
  const sleep = useSound((s) => s.sleep);
  const open = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const set = (v) => useSound.getState().setSleep(v);
    useUi.getState().openMenu(r.left, r.top, [
      ...SLEEPS.map(([v, label]) => ({ label: v === 'end' ? 'Al acabar este episodio' : label, onClick: () => set(v) })),
      ...(sleep ? [{ sep: true }, { label: 'Quitar el temporizador', onClick: () => set(null) }] : []),
    ]);
  };
  return (
    <button type="button" className={`icon-btn toggle ${sleep ? 'on' : ''} ${className}`} aria-haspopup="menu" aria-pressed={Boolean(sleep)}
      aria-label={sleep ? 'Temporizador activo: cambiarlo o quitarlo' : 'Temporizador'} data-tip="Temporizador" onClick={open}>
      <Clock size={size} />
    </button>
  );
}

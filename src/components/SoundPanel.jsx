// The "Sonido" panel (right side, next to Cola and Letra): TubeGrab's player
// options — equalizer with presets (and your own), the same volume for every
// song, speed and pitch, karaoke, fades, sleep timer, where it sounds,
// pausing when headphones are unplugged, and the visualizer.
import { useEffect, useState } from 'react';
import { BANDS, FADES, PRESETS, SLEEPS, SPEEDS, useSound } from '../store/sound.js';
import { useUi } from '../store/ui.js';

const hz = (f) => (f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`);
const comma = (n) => String(n).replace('.', ',');

function Switch({ label, hint, checked, onChange }) {
  return (
    <label className="set-row snd-row">
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** The sleep timer: off, minutes, or at the end of this song; what's left. */
export function SleepTimer() {
  const sleep = useSound((s) => s.sleep);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sleep || !sleep.until) return undefined;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [sleep]);
  const left = sleep && sleep.until ? Math.max(0, Math.ceil((sleep.until - now) / 60_000)) : null;
  const value = !sleep ? '' : sleep.end ? 'end' : 'on';
  return (
    <label className="set-row snd-row">
      <span><strong>Temporizador</strong><small>{!sleep ? 'Se para la música sola, con un fundido.' : sleep.end ? 'Se para al acabar esta canción.' : `Se para en ${left} min.`}</small></span>
      <select value={value} aria-label="Temporizador para parar la música" onChange={(e) => {
        const v = e.target.value;
        useSound.getState().setSleep(v === '' ? null : v === 'end' ? 'end' : Number(v));
        if (v) useUi.getState().toast(v === 'end' ? 'Se parará al acabar esta canción' : `Se parará en ${v} minutos`);
      }}>
        <option value="">Apagado</option>
        {value === 'on' && <option value="on" disabled>{left} min</option>}
        {SLEEPS.map(([v, label]) => <option key={v} value={String(v)}>{label}</option>)}
      </select>
    </label>
  );
}

/** Where it sounds: the system's or one of this computer's outputs. */
function Output() {
  const sinkId = useSound((s) => s.sinkId);
  const [devices, setDevices] = useState([]);
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md || !md.enumerateDevices) return undefined;
    const read = () => md.enumerateDevices().then((all) => setDevices(all.filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default')), () => {});
    read();
    md.addEventListener('devicechange', read);
    return () => md.removeEventListener('devicechange', read);
  }, []);
  if (!devices.length) return null;
  return (
    <label className="set-row snd-row">
      <span><strong>Salida de sonido</strong><small>Altavoces, auriculares…</small></span>
      <select value={sinkId} onChange={(e) => useSound.getState().set({ sinkId: e.target.value })} aria-label="Salida de sonido">
        <option value="">La del sistema</option>
        {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Salida ${i + 1}`}</option>)}
      </select>
    </label>
  );
}

export default function SoundPanel() {
  const s = useSound();
  const custom = s.preset === 'custom';
  const askName = () => useUi.getState().openDialog({ kind: 'prompt', title: 'Guardar ecualización', label: 'Nombre', value: '', confirm: 'Guardar', onConfirm: (name) => useSound.getState().saveMine(name) });
  return (
    <div className="sound">
      <h3 className="panel-sub">Ecualizador</h3>
      <div className="eq-presets">
        <select value={s.preset} onChange={(e) => s.applyPreset(e.target.value)} aria-label="Ecualización">
          {Object.entries(PRESETS).map(([k, [name]]) => <option key={k} value={k}>{name}</option>)}
          {s.mine.map((m) => <option key={m.name} value={`mine:${m.name}`}>{m.name}</option>)}
          {custom && <option value="custom">Personalizada</option>}
        </select>
        {custom && <button type="button" className="btn btn-ghost btn-small" onClick={askName}>Guardar</button>}
        {s.preset.startsWith('mine:') && <button type="button" className="btn btn-ghost btn-small" onClick={() => s.deleteMine(s.preset.slice(5))}>Borrar</button>}
      </div>
      <div className="eq-bands" role="group" aria-label="Bandas del ecualizador">
        {BANDS.map((f, i) => (
          <label key={f} className="eq-band">
            <span className="eq-hz">{hz(f)}</span>
            <input type="range" min="-12" max="12" step="0.5" value={s.gains[i]} onChange={(e) => s.setBand(i, Number(e.target.value))} aria-label={`${hz(f)}: ${s.gains[i]} dB`} />
            <span className="eq-db">{s.gains[i] > 0 ? '+' : ''}{comma(s.gains[i])} dB</span>
          </label>
        ))}
      </div>

      <h3 className="panel-sub">Reproducción</h3>
      <label className="set-row snd-row">
        <span><strong>Velocidad</strong></span>
        <select value={String(s.speed)} onChange={(e) => s.set({ speed: Number(e.target.value) })} aria-label="Velocidad">
          {SPEEDS.map((v) => <option key={v} value={String(v)}>{comma(v)}×</option>)}
        </select>
      </label>
      {s.speed !== 1 && <Switch label="Mantener el tono" hint="Más rápido o más lento sin que la voz suene más aguda o más grave." checked={s.pitch} onChange={(v) => s.set({ pitch: v })} />}
      <label className="set-row snd-row">
        <span><strong>Fundido</strong><small>Entra suave al empezar y sale suave antes de acabar.</small></span>
        <select value={String(s.fade)} onChange={(e) => s.set({ fade: Number(e.target.value) })} aria-label="Fundido">
          {FADES.map((v) => <option key={v} value={String(v)}>{v ? `${v} s` : 'Sin fundido'}</option>)}
        </select>
      </label>
      <Switch label="Mismo volumen" hint="Iguala lo fuerte que suena cada canción (se aprende al escucharla)." checked={s.level} onChange={(v) => s.set({ level: v })} />
      <Switch label="Karaoke" hint="Quita la voz principal (lo que suena en el centro)." checked={s.karaoke} onChange={(v) => s.set({ karaoke: v })} />
      <SleepTimer />

      <h3 className="panel-sub">Dispositivo</h3>
      <Output />
      <Switch label="Pausar al desconectar los auriculares" checked={s.unplugPause} onChange={(v) => s.set({ unplugPause: v })} />
      <Switch label="Visualizador" hint="Barras que siguen la música junto a la canción (no con «Recursos mínimos»)." checked={s.visualizer} onChange={(v) => s.set({ visualizer: v })} />
    </div>
  );
}

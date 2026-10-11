// v1.7: the alarm clock's settings (Ajustes and the Sonido panel): on or off,
// the time, the days, what plays, how slowly the volume rises and how loud.
import { DAY_NAMES, nextRing, RAMPS, SOURCES, useAlarm } from '../store/alarm.js';
import { useLibrary } from '../store/library.js';

const DAY_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** "Sonará mañana a las 7:30", "Sonará el lunes a las 7:30". */
export function nextText(a, now = new Date()) {
  const n = nextRing(a, now);
  if (!a.on) return 'Apagado.';
  if (!n) return 'Elige al menos un día.';
  const days = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const when = days === 0 ? 'hoy' : days === 1 ? 'mañana' : `el ${DAY_LONG[(n.getDay() + 6) % 7]}`;
  return `Sonará ${when} a las ${a.time}. Rumoria tiene que estar abierta (vale en la bandeja), y el ordenador, despierto.`;
}

export default function AlarmSettings({ compact = false }) {
  const a = useAlarm();
  const lists = useLibrary((s) => s.lists);
  const set = useAlarm.getState().set;
  const toggleDay = (d) => set({ days: a.days.includes(d) ? a.days.filter((x) => x !== d) : [...a.days, d] });
  return (
    <div className={`alarm ${compact ? 'compact' : ''}`}>
      <label className="set-row snd-row">
        <span><strong>Despertador</strong><small>{nextText(a)}</small></span>
        <input type="checkbox" className="switch" checked={a.on} onChange={(e) => set({ on: e.target.checked, last: null })} aria-label="Despertador" />
      </label>
      {a.on && (
        <>
          <div className="set-row snd-row">
            <span><strong>Hora</strong></span>
            <input type="time" className="alarm-time" value={a.time} onChange={(e) => set({ time: e.target.value, last: null })} aria-label="Hora del despertador" />
          </div>
          <div className="set-row snd-row">
            <span><strong>Días</strong></span>
            <div className="chips alarm-days" role="group" aria-label="Días del despertador">
              {DAY_NAMES.map((n, d) => (
                <button key={n} type="button" className={`chip ${a.days.includes(d) ? 'on' : ''}`} aria-pressed={a.days.includes(d)} aria-label={DAY_LONG[d]} title={DAY_LONG[d]} onClick={() => toggleDay(d)}>{n}</button>
              ))}
            </div>
          </div>
          <label className="set-row snd-row">
            <span><strong>Qué suena</strong></span>
            <select value={a.source} onChange={(e) => set({ source: e.target.value })}>
              {SOURCES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          {a.source === 'list' && (
            <label className="set-row snd-row">
              <span><strong>Lista</strong>{!lists.length && <small>Aún no tienes listas.</small>}</span>
              <select value={a.list || ''} onChange={(e) => set({ list: e.target.value || null })} aria-label="Lista del despertador">
                <option value="">Elige una…</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          )}
          <label className="set-row snd-row">
            <span><strong>Subir el volumen en</strong><small>Empieza casi sin oírse y sube poco a poco.</small></span>
            <select value={String(a.ramp)} onChange={(e) => set({ ramp: Number(e.target.value) })}>
              {RAMPS.map(([m, label]) => <option key={m} value={String(m)}>{label}</option>)}
            </select>
          </label>
          <label className="set-row snd-row">
            <span><strong>Hasta</strong><small>{Math.round(a.volume * 100)} % del volumen</small></span>
            <input type="range" min="0.05" max="1" step="0.05" value={a.volume} onChange={(e) => set({ volume: Number(e.target.value) })} aria-label="Volumen del despertador" />
          </label>
        </>
      )}
    </div>
  );
}

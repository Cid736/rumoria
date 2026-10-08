// v1.5, "Historial": what you heard in the last days, newest first, by day
// (Hoy, Ayer, then the date), with the time. Play any of it again, or search
// it for that song you heard and can't remember. Only on this computer.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { fold, fromSaved } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import TrackTable from '../components/TrackTable.jsx';

const RANGES = [[1, 'Hoy'], [7, '7 días'], [30, '30 días'], [90, '3 meses']];

/** "Hoy", "Ayer", or the day's date. */
export function dayLabel(at, now = new Date()) {
  const d = new Date(at);
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86400000);
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  const s = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Rows (newest first) → [{ label, tracks }], one group per day. */
export function byDay(rows, localByKey = new Map(), now = new Date()) {
  const out = [];
  for (const r of rows) {
    const t = fromSaved(r, localByKey);
    if (!t) continue;
    const label = dayLabel(r.at, now);
    let g = out[out.length - 1];
    if (!g || g.label !== label) { g = { label, tracks: [] }; out.push(g); }
    g.tracks.push({ ...t, at: r.at, uid: `${r.key}@${r.at}`, played: r.played });
  }
  return out;
}

export default function History() {
  const local = useLibrary((s) => s.local);
  const [days, setDays] = useState(7);
  const [got, setGot] = useState({ days: null, rows: [], error: null });
  const [q, setQ] = useState('');
  const [whole, setWhole] = useState(false);
  useEffect(() => {
    let gone = false;
    api.get(`/api/history/recent?days=${days}`).then((r) => { if (!gone) setGot({ days, rows: r.items || [], error: null }); }, (err) => { if (!gone) setGot({ days, rows: [], error: err.message }); });
    return () => { gone = true; };
  }, [days]);
  const groups = useMemo(() => {
    const map = new Map((local.songs || []).map((f) => [f.key, f]));
    const rows = got.rows.filter((r) => (!whole || r.played) && (!q || fold(`${r.title} ${r.artist}`).includes(fold(q))));
    return byDay(rows, map);
  }, [got.rows, local, q, whole]);

  return (
    <div className="history">
      <h1>Historial</h1>
      <p className="muted">Lo que has escuchado, con la hora. Se guarda solo en este ordenador (Ajustes → Historial de escucha).</p>
      <div className="history-tools">
        <div className="chips" role="radiogroup" aria-label="Desde cuándo">
          {RANGES.map(([d, label]) => <button key={d} type="button" role="radio" aria-checked={days === d} className={`chip ${days === d ? 'on' : ''}`} onClick={() => setDays(d)}>{label}</button>)}
        </div>
        <label className="history-whole"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Solo las que escuchaste (no las saltadas)</label>
        <input className="col-filter" type="search" placeholder="Buscar en tu historial" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar en tu historial" />
      </div>
      {got.days !== days ? <p className="muted pad">Cargando…</p>
        : got.error ? <p className="muted pad">{got.error}</p>
          : !groups.length ? <p className="muted pad">{q || whole ? 'Nada coincide.' : 'Todavía no hay nada en estos días. Lo que escuches aparecerá aquí.'}</p>
            : groups.map((g) => (
              <section key={g.label} className="history-day">
                <h2>{g.label} <small>{g.tracks.length === 1 ? '1 canción' : `${g.tracks.length} canciones`}</small></h2>
                <TrackTable tracks={g.tracks} showAdded addedAs="time" />
              </section>
            ))}
    </div>
  );
}

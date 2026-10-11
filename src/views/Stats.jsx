// v1.7, "Estadísticas": the whole year, not only "Tu resumen" — your streak
// of days with music, minutes week by week, when in the week and the day you
// listen, and your genres month by month. From the history kept on this
// computer (GET /api/history/stats); each chart has its numbers as a table too.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useUi } from '../store/ui.js';
import { HERE } from '../lib/android.js';

const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const SHORT_DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2024, i, 1).toLocaleDateString('es-ES', { month: 'short' }).replace('.', ''));
const utcDate = (ms, opts) => new Date(ms).toLocaleDateString('es-ES', { timeZone: 'UTC', ...opts });

/** "3 h 20 min", "45 min". */
export function duration(secs) {
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}
const days = (n) => (n === 1 ? '1 día' : `${n} días`);

/** Minutes per week, the last 52: one series, columns from the baseline, a tooltip on each. */
function WeeksChart({ weeks }) {
  const mins = weeks.map((w) => Math.round(w.secs / 60));
  const max = Math.max(1, ...mins);
  const [tip, setTip] = useState(null);
  // A month's name under its first week.
  const label = (w, i) => { const m = new Date(w.start).getUTCMonth(); return i === 0 || new Date(weeks[i - 1].start).getUTCMonth() !== m ? MONTHS[m] : ''; };
  return (
    <figure className="chart">
      <figcaption className="chart-title">Minutos por semana <span className="muted">· el último año · máximo {max} min</span></figcaption>
      <div className="chart-plot weeks-plot" role="img" aria-label="Minutos escuchados cada semana del último año" onMouseLeave={() => setTip(null)}>
        {weeks.map((w, i) => (
          <div key={w.start} className="chart-col" onMouseEnter={() => setTip(i)}>
            <div className="chart-bar-area">
              {tip === i && (
                <span className={`chart-tip ${i > 40 ? 'right' : i < 8 ? 'left' : ''}`} role="tooltip">
                  Semana del {utcDate(w.start, { day: 'numeric', month: 'short' })} · <strong>{duration(w.secs)}</strong>{w.plays ? ` · ${w.plays} canciones` : ''}
                </span>
              )}
              <span className={`chart-bar ${tip === i ? 'on' : ''}`} style={{ height: `${mins[i] ? Math.max(2, (mins[i] / max) * 100) : 0}%` }} />
            </div>
            <span className="chart-label">{label(w, i)}</span>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>Minutos por semana</caption>
        <tbody>{weeks.map((w, i) => <tr key={w.start}><th scope="row">Semana del {utcDate(w.start, { day: 'numeric', month: 'long', year: 'numeric' })}</th><td>{mins[i]}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** When you listen: weekday by hour, one hue from the surface (nothing) to full (the most). */
function Heatmap({ grid }) {
  const max = Math.max(1, ...grid.flat());
  const [tip, setTip] = useState(null);
  let best = { d: 0, h: 0, v: -1 };
  grid.forEach((row, d) => row.forEach((v, h) => { if (v > best.v) best = { d, h, v }; }));
  return (
    <figure className="chart">
      <figcaption className="chart-title">Cuándo escuchas <span className="muted">· el último año{best.v > 0 ? ` · sobre todo los ${DAYS[best.d]} a las ${best.h}:00` : ''}</span></figcaption>
      <div className="heat" role="img" aria-label="Minutos escuchados por día de la semana y hora" onMouseLeave={() => setTip(null)}>
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={`h${h}`} className="heat-hour">{h % 3 === 0 ? h : ''}</span>)}
        {grid.map((row, d) => [
          <span key={`d${d}`} className="heat-day">{SHORT_DAYS[d]}</span>,
          ...row.map((v, h) => (
            <span key={`${d}-${h}`} className={`heat-cell ${tip && tip.d === d && tip.h === h ? 'on' : ''}`} onMouseEnter={() => setTip({ d, h, v })}
              style={{ '--heat': `${v ? Math.round(12 + (v / max) * 88) : 0}%` }} />
          )),
        ])}
      </div>
      <p className="heat-tip" aria-hidden="true">{tip ? <>Los {DAYS[tip.d]} de {tip.h}:00 a {(tip.h + 1) % 24}:00 · <strong>{duration(tip.v)}</strong> en el año</> : 'Pasa el ratón por una casilla para ver los minutos.'}</p>
      <div className="heat-scale" aria-hidden="true"><span>Menos</span><i style={{ '--heat': '12%' }} /><i style={{ '--heat': '41%' }} /><i style={{ '--heat': '70%' }} /><i style={{ '--heat': '100%' }} /><span>Más</span></div>
      <table className="sr-only">
        <caption>Minutos por día y hora</caption>
        <thead><tr><th>Día</th>{Array.from({ length: 24 }, (_, h) => <th key={h}>{h}:00</th>)}</tr></thead>
        <tbody>{grid.map((row, d) => <tr key={DAYS[d]}><th scope="row">{DAYS[d]}</th>{row.map((v, h) => <td key={h}>{Math.round(v / 60)}</td>)}</tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Your genres month by month: each month's column split into your top genres (+ the rest), with a legend and a table. */
function GenresChart({ genres }) {
  const [tip, setTip] = useState(null);
  const [table, setTable] = useState(false);
  const ids = genres.genres;
  const pct = (x) => `${Math.round(x * 100)} %`;
  const segs = (m) => [...ids.map((id, k) => ({ key: id, slot: k + 1, name: genres.names[id], v: m.shares[id] || 0 })), { key: 'other', slot: 'other', name: 'Otros', v: m.other }].filter((s) => s.v > 0);
  if (!ids.length) {
    return (
      <figure className="chart">
        <figcaption className="chart-title">Tus géneros mes a mes</figcaption>
        <p className="muted">Aún no se pueden deducir: Rumoria reconoce tus géneros cruzando tus artistas con los de cada categoría de Explorar. Escucha un poco más (y abre alguna categoría) y aparecerán aquí.</p>
      </figure>
    );
  }
  return (
    <figure className="chart genre-chart">
      <figcaption className="chart-title">
        Tus géneros mes a mes <span className="muted">· de lo que se puede reconocer</span>
        <button type="button" className="btn btn-ghost btn-small chart-switch" onClick={() => setTable(!table)} aria-pressed={table}>{table ? 'Ver el gráfico' : 'Ver como tabla'}</button>
      </figcaption>
      <ul className="legend">
        {ids.map((id, k) => <li key={id}><i className="swatch-key" data-slot={k + 1} />{genres.names[id]}</li>)}
        <li><i className="swatch-key" data-slot="other" />Otros</li>
      </ul>
      {table ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Mes</th>{ids.map((id) => <th key={id}>{genres.names[id]}</th>)}<th>Otros</th></tr></thead>
            <tbody>
              {genres.months.map((m) => (
                <tr key={`${m.year}-${m.month}`}>
                  <th scope="row">{MONTHS[m.month]} {m.year}</th>
                  {m.known ? <>{ids.map((id) => <td key={id}>{pct(m.shares[id] || 0)}</td>)}<td>{pct(m.other)}</td></> : <td colSpan={ids.length + 1} className="muted">Sin datos</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-plot genre-plot" role="img" aria-label="Reparto de tus géneros cada mes del último año" onMouseLeave={() => setTip(null)}>
          {genres.months.map((m, i) => (
            <div key={`${m.year}-${m.month}`} className="chart-col" onMouseEnter={() => setTip(i)}>
              <div className="chart-bar-area">
                {tip === i && (
                  <span className={`chart-tip stack-tip ${i > 8 ? 'right' : i < 3 ? 'left' : ''}`} role="tooltip">
                    <strong>{MONTHS[m.month]} {m.year}</strong>
                    {m.known ? segs(m).map((s) => <span key={s.key} className="tip-row"><i className="swatch-key" data-slot={s.slot} />{s.name} · {pct(s.v)}</span>) : <span className="tip-row">Sin datos</span>}
                  </span>
                )}
                {m.known && (
                  <span className={`stack ${tip === i ? 'on' : ''}`}>
                    {segs(m).reverse().map((s) => <span key={s.key} className="stack-seg" data-slot={s.slot} style={{ flexGrow: s.v }} />)}
                  </span>
                )}
              </div>
              <span className="chart-label">{MONTHS[m.month]}</span>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

export default function Stats() {
  const [got, setGot] = useState({ s: null, error: null });
  const tz = new Date().getTimezoneOffset();
  useEffect(() => {
    let gone = false;
    api.get(`/api/history/stats?tz=${tz}`).then((s) => { if (!gone) setGot({ s, error: null }); }, (err) => { if (!gone) setGot({ s: null, error: err.message }); });
    return () => { gone = true; };
  }, [tz]);
  const s = got.s;
  if (got.error) return <div className="summary"><h1>Estadísticas</h1><p className="error">{got.error}</p></div>;
  if (!s) return <div className="summary"><h1>Estadísticas</h1><p className="muted">Cargando…</p></div>;
  const week = s.weeks[s.weeks.length - 1];
  const before = s.weeks[s.weeks.length - 2];
  const change = before && before.secs ? Math.round(((week.secs - before.secs) / before.secs) * 100) : null;
  const yearSecs = s.weeks.reduce((a, w) => a + w.secs, 0);
  return (
    <div className="summary stats">
      <div className="summary-head">
        <h1>Estadísticas</h1>
        <button type="button" className="btn btn-ghost" onClick={() => useUi.getState().go({ name: 'summary' })}>Tu resumen del año</button>
      </div>
      {!s.count ? (
        <p className="muted">Aún no hay nada: lo que escuches irá llenando estas gráficas. Se guarda solo en {HERE}.{s.paused ? ' (El historial está en pausa: Ajustes → Historial de escucha.)' : ''}</p>
      ) : (
        <>
          <div className="stat-tiles">
            {[
              ['Racha', days(s.streak.current), s.streak.current ? (s.streak.today ? 'hoy ya cuenta' : 'escucha algo hoy para no perderla') : 'pon una canción y empieza una'],
              ['Tu mejor racha', days(s.streak.best), s.streak.bestEnd ? `hasta el ${utcDate(s.streak.bestEnd, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''],
              ['Esta semana', duration(week.secs), change === null ? '' : change === 0 ? 'como la semana pasada' : `${change > 0 ? '+' : '−'}${Math.abs(change)} % que la semana pasada`],
              ['Días con música', String(s.streak.days365), `en el último año · ${duration(yearSecs)}`],
            ].map(([label, value, sub]) => (
              <div key={label} className="stat-tile"><span className="stat-label">{label}</span><span className="stat-value">{value}</span><span className="stat-sub">{sub}</span></div>
            ))}
          </div>
          <WeeksChart weeks={s.weeks} />
          <Heatmap grid={s.heatmap} />
          <GenresChart genres={s.genres} />
        </>
      )}
    </div>
  );
}

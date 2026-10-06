// Tu resumen: a year of what you listened to (or everything) — the song of the
// year, the numbers, your artists and songs, and minutes per month. Built from
// the history kept on this computer (it came over from TubeGrab's Estadísticas).
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fromSaved } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { usePlayer } from '../store/player.js';
import Cover from '../components/Cover.jsx';
import { Play } from '../components/Icons.jsx';
import TrackTable from '../components/TrackTable.jsx';

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2024, i, 1).toLocaleDateString('es-ES', { month: 'short' }).replace('.', ''));
const plays = (n) => (n === 1 ? '1 vez' : `${n} veces`);

/** Minutes per month: one series, bars from the baseline, a tooltip on each. */
function MonthsChart({ months, year }) {
  const mins = months.map((s) => Math.round(s / 60));
  const max = Math.max(1, ...mins);
  const [tip, setTip] = useState(null);
  return (
    <figure className="chart">
      <figcaption className="chart-title">Minutos por mes <span className="muted">· máximo {max} min</span></figcaption>
      <div className="chart-plot" role="img" aria-label={`Minutos escuchados por mes${year ? ` en ${year}` : ''}`} onMouseLeave={() => setTip(null)}>
        {mins.map((v, i) => (
          <div key={MONTHS[i]} className="chart-col" tabIndex={0}
            onMouseEnter={() => setTip(i)} onFocus={() => setTip(i)} onBlur={() => setTip(null)}
            aria-label={`${MONTHS[i]}: ${v} minutos`}>
            <div className="chart-bar-area">
              {tip === i && <span className="chart-tip" role="tooltip">{MONTHS[i]}{year ? ` ${year}` : ''} · <strong>{v} min</strong></span>}
              <span className={`chart-bar ${tip === i ? 'on' : ''}`} style={{ height: `${v ? Math.max(2, (v / max) * 100) : 0}%` }} />
            </div>
            <span className="chart-label">{MONTHS[i]}</span>
          </div>
        ))}
      </div>
      {/* The same numbers as a table, for screen readers. */}
      <table className="sr-only">
        <caption>Minutos por mes</caption>
        <tbody>{mins.map((v, i) => <tr key={MONTHS[i]}><th scope="row">{MONTHS[i]}</th><td>{v}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

export default function Summary() {
  const local = useLibrary((s) => s.local);
  const [year, setYear] = useState(null); // null: not chosen yet; 'all': everything
  const [data, setData] = useState({ key: null, s: null, error: null });
  const tz = new Date().getTimezoneOffset();
  const key = String(year);

  useEffect(() => {
    let gone = false;
    const q = year && year !== 'all' ? `&year=${year}` : '';
    api.get(`/api/history/summary?tz=${tz}${q}`)
      .then((s) => {
        if (gone) return;
        // First time: the current year if there's something, else the latest one.
        if (year === null && s.years.length) {
          const now = new Date().getFullYear();
          setYear(s.years.includes(now) ? now : s.years[s.years.length - 1]);
          return;
        }
        setData({ key, s, error: null });
      })
      .catch((err) => { if (!gone) setData({ key, s: null, error: err.message }); });
    return () => { gone = true; };
  }, [year, key, tz]);

  if (data.key !== key) return <div className="summary"><h1>Tu resumen</h1><p className="muted">Cargando…</p></div>;
  if (data.error) return <div className="summary"><h1>Tu resumen</h1><p className="error">{data.error}</p></div>;
  const s = data.s;
  const map = new Map((local.songs || []).map((f) => [f.key, f]));
  const songs = s.topSongs.map((r) => fromSaved(r, map)).filter(Boolean);
  const best = s.topSongs[0];
  const mins = Math.round(s.secs / 60);
  const hour = s.hours.indexOf(Math.max(...s.hours));

  return (
    <div className="summary">
      <div className="summary-head">
        <h1>Tu resumen</h1>
        {s.years.length > 0 && (
          <select value={key} onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))} aria-label="Año">
            {[...s.years].reverse().map((y) => <option key={y} value={String(y)}>{y}</option>)}
            <option value="all">Desde siempre</option>
          </select>
        )}
      </div>
      {!s.secs ? (
        <p className="muted">Aún no hay nada: lo que escuches irá apareciendo aquí, con tus canciones y artistas del año. Se guarda solo en este ordenador.</p>
      ) : (
        <>
          <section className="summary-hero">
            <Cover src={best && best.thumb} name={best ? best.title : ''} size={140} />
            <div>
              <span className="col-kind">{s.year ? `Tu canción de ${s.year}` : 'Tu canción más escuchada'}</span>
              <h2 className="summary-song">{best ? best.title : '—'}</h2>
              <span className="muted">{best ? [best.artist, plays(best.plays)].filter(Boolean).join(' · ') : ''}</span>
              {songs.length > 0 && (
                <div><button type="button" className="btn btn-accent summary-play" onClick={() => usePlayer.getState().playTracks(songs, 0)}><Play size={16} /> Reproducir tu top</button></div>
              )}
            </div>
          </section>
          <div className="stat-tiles">
            {[
              ['Minutos escuchados', mins.toLocaleString('es-ES'), mins >= 120 ? `unas ${Math.round(mins / 60)} horas` : ''],
              ['Canciones', s.plays.toLocaleString('es-ES'), `${s.songs} distintas`],
              ['Artistas', String(s.artists), ''],
              ['Días con música', String(s.days), `tu hora: ${hour}:00–${(hour + 1) % 24}:00`],
            ].map(([label, value, sub]) => (
              <div key={label} className="stat-tile"><span className="stat-label">{label}</span><span className="stat-value">{value}</span><span className="stat-sub">{sub}</span></div>
            ))}
          </div>
          <MonthsChart months={s.months} year={s.year} />
          <div className="summary-cols">
            <section>
              <h2 className="shelf-title">Tus artistas</h2>
              <ol className="rank">
                {s.topArtists.map((a) => (
                  <li key={a.name}><span className="rank-name">{a.name}</span><span className="muted">{Math.max(1, Math.round(a.secs / 60))} min</span></li>
                ))}
              </ol>
            </section>
            <section className="summary-songs">
              <h2 className="shelf-title">Tus canciones</h2>
              <TrackTable tracks={songs.slice(0, 25)} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

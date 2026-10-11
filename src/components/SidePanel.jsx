// Right: the queue (what's playing and what comes next), or the lyrics
// following the song (click a line to jump there).
import { useEffect, useRef, useState } from 'react';
import { MODES, planSession } from '../player/dj.js';
import { lineIndex, useLyrics } from '../player/useLyrics.js';
import { useLyricsExtra } from '../player/useLyricsExtra.js';
import { chooseExtra, EXTRAS } from '../store/lyrics.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';
import Cover from './Cover.jsx';
import SoundPanel from './SoundPanel.jsx';
import { Close, Wand } from './Icons.jsx';

function QueueRow({ t, i, now, onPlay, onRemove }) {
  return (
    <div className={`q-row ${now ? 'now' : ''}`} onDoubleClick={() => onPlay(i)}>
      <Cover src={t.thumbnail} name={t.title} size={40} />
      <div className="q-text">
        <span className="q-title">{t.title}</span>
        <span className="q-artist">{t.artist || '—'}</span>
      </div>
      {!now && <button type="button" className="icon-btn q-remove" aria-label={`Quitar ${t.title} de la cola`} title="Quitar de la cola" onClick={() => onRemove(i)}><Close size={16} /></button>}
    </div>
  );
}

/**
 * v1.7, "Modo sesión": the songs after this one put in an order that flows.
 * Each is listened to first (a few seconds each, two at a time).
 */
function SessionButton({ count }) {
  const [run, setRun] = useState(null); // { done, total }
  const stop = useRef(false);
  useEffect(() => () => { stop.current = true; }, []);
  const start = async (mode) => {
    const s = usePlayer.getState();
    const upcoming = s.queue.items.slice(s.queue.index + 1);
    stop.current = false;
    setRun({ done: 0, total: Math.min(upcoming.length, 30) });
    const plan = await planSession(upcoming, s.current(), mode, { onProgress: (done, total) => { if (!stop.current) setRun({ done, total }); }, stopped: () => stop.current });
    if (stop.current || !plan) return;
    setRun(null);
    // The queue may have moved on meanwhile: only the songs still after the current one move.
    usePlayer.getState().setUpcoming(plan.uids);
    const label = (MODES.find(([k]) => k === mode) || MODES[0])[1].toLowerCase();
    useUi.getState().toast(`Cola ordenada: ${label}${plan.guessed ? ` (${plan.guessed} sin poder escucharse: a ojo)` : ''}`);
  };
  const menu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    useUi.getState().openMenu(r.left, r.bottom, MODES.map(([k, label, hint]) => ({ label: `${label} · ${hint}`, onClick: () => start(k) })));
  };
  if (run) {
    return (
      <div className="session-run" role="status">
        <span>Escuchando las canciones… {run.done}/{run.total}</span>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => { stop.current = true; setRun(null); }}>Cancelar</button>
      </div>
    );
  }
  return (
    <button type="button" className="btn btn-ghost btn-small session-btn" disabled={count < 3} onClick={menu} aria-haspopup="menu"
      title={count < 3 ? 'Hacen falta al menos 3 canciones en la cola' : 'Ordenar lo que viene por ritmo y energía'}>
      <Wand size={16} /> Modo sesión
    </button>
  );
}

function QueuePanel() {
  const q = usePlayer((s) => s.queue);
  const p = usePlayer.getState();
  const cur = q.items[q.index];
  const next = q.items.slice(q.index + 1, q.index + 81);
  return (
    <>
      <h2 className="panel-title">Cola</h2>
      {cur && <SessionButton count={q.items.length - q.index - 1} />}
      {!cur && <p className="muted">La cola está vacía.</p>}
      {cur && (
        <>
          <h3 className="panel-sub">Sonando</h3>
          <QueueRow t={cur} i={q.index} now onPlay={p.jump} onRemove={p.removeFromQueue} />
          <h3 className="panel-sub">A continuación</h3>
          {!next.length && <p className="muted">Nada más. {usePlayer.getState().radio ? 'Seguirán canciones parecidas.' : ''}</p>}
          {next.map((t, k) => <QueueRow key={t.uid} t={t} i={q.index + 1 + k} onPlay={p.jump} onRemove={p.removeFromQueue} />)}
        </>
      )}
    </>
  );
}

/** v1.7: what goes under each line: nothing, Latin letters (when the lyrics need them) or Spanish. */
export function LyricsModes({ extra, script }) {
  const shown = EXTRAS.filter(([k]) => k !== 'roman' || script || extra === 'roman');
  return (
    <div className="chips lyrics-modes" role="radiogroup" aria-label="Debajo de cada línea">
      {shown.map(([k, label]) => (
        <button key={k} type="button" role="radio" aria-checked={extra === k} className={`chip ${extra === k ? 'on' : ''}`}
          onClick={() => chooseExtra(k, (d) => useUi.getState().openDialog(d))}>{label}</button>
      ))}
    </div>
  );
}

function LyricsPanel() {
  const cur = usePlayer((s) => s.queue.items[s.queue.index] || null);
  const position = usePlayer((s) => s.position);
  const box = useRef(null);
  const yt = cur && cur.yt;
  const lyrics = useLyrics(cur);
  const more = useLyricsExtra(cur, lyrics);
  const line = lineIndex(lyrics.synced, position);
  useEffect(() => {
    const el = box.current && box.current.querySelector('.lyric.on');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [line]);

  if (!cur) return <p className="muted">Pon una canción para ver su letra.</p>;
  if (!yt) return <p className="muted">La letra solo está para canciones de YouTube.</p>;
  if (lyrics.loading) return <p className="muted">Buscando la letra…</p>;
  const modes = <><LyricsModes extra={more.extra} script={more.script} />{more.note && <p className="muted lyrics-note">{more.note}</p>}</>;
  const credit = <p className="lyrics-credit">Letra: LRCLIB{more.lines && more.extra === 'trans' ? ' · Traducción: Google Translate' : ''}</p>;
  if (lyrics.synced) {
    return (
      <div className="lyrics" ref={box}>
        {modes}
        {lyrics.synced.map((l, i) => (
          <button key={`${l.t}-${i}`} type="button" className={`lyric ${i === line ? 'on' : i < line ? 'past' : ''}`} onClick={() => usePlayer.getState().seek(l.t)}>
            {l.text || '♪'}
            {more.lines && more.lines[i] && <span className="lyric-sub">{more.lines[i]}</span>}
          </button>
        ))}
        {credit}
      </div>
    );
  }
  if (lyrics.plain) {
    if (!more.lines) return <div className="lyrics plain">{modes}{lyrics.plain}{credit}</div>;
    return (
      <div className="lyrics plain with-sub">
        {modes}
        {lyrics.plain.split('\n').map((l, i) => (
          <p key={i} className="plain-line">{l || '\u00a0'}{more.lines[i] && <span className="lyric-sub">{more.lines[i]}</span>}</p>
        ))}
        {credit}
      </div>
    );
  }
  return <p className="muted">No se encontró la letra de esta canción.</p>;
}

export default function SidePanel() {
  const panel = useUi((s) => s.panel);
  if (!panel) return null;
  return (
    <aside className="sidepanel" aria-label={panel === 'queue' ? 'Cola' : panel === 'sound' ? 'Sonido' : 'Letra'}>
      <button type="button" className="icon-btn panel-close" aria-label="Cerrar" onClick={() => useUi.getState().togglePanel(panel)}><Close size={18} /></button>
      {panel === 'queue' ? <QueuePanel /> : panel === 'sound' ? (<><h2 className="panel-title">Sonido</h2><SoundPanel /></>) : (<><h2 className="panel-title">Letra</h2><LyricsPanel /></>)}
    </aside>
  );
}

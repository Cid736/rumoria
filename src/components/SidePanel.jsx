// Right: the queue (what's playing and what comes next), or the lyrics
// following the song (click a line to jump there).
import { useEffect, useRef, useState } from 'react';
import { api, urls } from '../api.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';
import Cover from './Cover.jsx';
import SoundPanel from './SoundPanel.jsx';
import { Close } from './Icons.jsx';

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

function QueuePanel() {
  const q = usePlayer((s) => s.queue);
  const p = usePlayer.getState();
  const cur = q.items[q.index];
  const next = q.items.slice(q.index + 1, q.index + 81);
  return (
    <>
      <h2 className="panel-title">Cola</h2>
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

function LyricsPanel() {
  const cur = usePlayer((s) => s.queue.items[s.queue.index] || null);
  const position = usePlayer((s) => s.position);
  // The lyrics found, and for which video (anything else is still loading).
  const [found, setFound] = useState({ for: null, synced: null, plain: null });
  const box = useRef(null);
  const yt = cur && cur.yt;

  useEffect(() => {
    if (!yt) return undefined;
    let gone = false;
    // A song from one of your lists knows its real artist and title; for a
    // video, the server reads them from it better than its channel's name.
    const known = Boolean(cur.list);
    api.get(urls.lyrics(yt, known ? cur.artist : undefined, known ? cur.title : undefined, cur.duration))
      .then((r) => { if (!gone) setFound({ for: yt, synced: r.synced, plain: r.plain }); })
      .catch(() => { if (!gone) setFound({ for: yt, synced: null, plain: null }); });
    return () => { gone = true; };
    // Only when the song changes (not its title being filled in).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yt]);

  const lyrics = found.for === yt ? found : { synced: null, plain: null, loading: true };
  const line = lyrics.synced ? lyrics.synced.reduce((at, l, i) => (l.t <= position + 0.25 ? i : at), -1) : -1;
  useEffect(() => {
    const el = box.current && box.current.querySelector('.lyric.on');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [line]);

  if (!cur) return <p className="muted">Pon una canción para ver su letra.</p>;
  if (!yt) return <p className="muted">La letra solo está para canciones de YouTube.</p>;
  if (lyrics.loading) return <p className="muted">Buscando la letra…</p>;
  if (lyrics.synced) {
    return (
      <div className="lyrics" ref={box}>
        {lyrics.synced.map((l, i) => (
          <button key={`${l.t}-${i}`} type="button" className={`lyric ${i === line ? 'on' : i < line ? 'past' : ''}`} onClick={() => usePlayer.getState().seek(l.t)}>{l.text || '♪'}</button>
        ))}
        <p className="lyrics-credit">Letra: LRCLIB</p>
      </div>
    );
  }
  if (lyrics.plain) return <div className="lyrics plain">{lyrics.plain}<p className="lyrics-credit">Letra: LRCLIB</p></div>;
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

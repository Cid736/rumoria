// The songs of a list, a search, your favourites… One click selects (Ctrl / Shift
// for more), a double click or Enter plays from there, right click for more.
// In a list of yours, songs can be dragged to another place.
import { useRef, useState } from 'react';
import { formatTime } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';
import Cover from './Cover.jsx';
import { Clock, Heart, More, Play } from './Icons.jsx';
import { trackMenu } from './trackMenu.js';

/** Is this row the song playing? (Same place in the same list, or the same song.) */
function isCurrent(cur, t, listId) {
  if (!cur) return false;
  if (listId && cur.list === listId && Number.isInteger(t.n)) return cur.n === t.n;
  return Boolean(t.key) && cur.key === t.key;
}

export default function TrackTable({ tracks, listId = null, showCover = true, showAdded = false, reorder = null, startShuffle = false }) {
  const [sel, setSel] = useState(() => new Set());
  const anchor = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const cur = usePlayer((s) => s.queue.items[s.queue.index] || null);
  const playing = usePlayer((s) => s.wantPlaying);
  const likedKeys = useLibrary((s) => s.likedKeys);

  const play = (i) => {
    const p = usePlayer.getState();
    if (isCurrent(cur, tracks[i], listId)) { p.toggle(); return; }
    p.playTracks(tracks, i, { shuffle: startShuffle });
  };
  const select = (i, e) => {
    const next = new Set(e.ctrlKey || e.metaKey ? sel : []);
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [anchor.current, i].sort((x, y) => x - y);
      for (let k = a; k <= b; k++) next.add(k);
    } else if ((e.ctrlKey || e.metaKey) && next.has(i)) next.delete(i);
    else { next.add(i); anchor.current = i; }
    setSel(next);
  };
  const openMenu = (i, x, y) => {
    const picked = sel.has(i) ? [...sel].sort((a, b) => a - b) : [i];
    if (!sel.has(i)) { setSel(new Set([i])); anchor.current = i; }
    const songs = picked.map((k) => tracks[k]);
    useUi.getState().openMenu(x, y, trackMenu(songs, listId ? { listId, ns: picked.map((k) => tracks[k].n) } : null));
  };

  if (!tracks.length) return <p className="empty">No hay canciones aquí todavía.</p>;

  return (
    <div className="tracks" role="grid" aria-rowcount={tracks.length}>
      <div className={`tracks-row tracks-head ${showAdded ? 'with-added' : ''}`} role="row">
        <span className="t-n">#</span>
        <span>Título</span>
        {showAdded && <span className="t-added">Añadida</span>}
        <span className="t-dur" aria-label="Duración"><Clock size={16} /></span>
      </div>
      {tracks.map((t, i) => {
        const now = isCurrent(cur, t, listId);
        const liked = t.key && likedKeys.has(t.key);
        return (
          <div
            key={t.uid || `${t.key || t.query}-${i}`}
            role="row"
            tabIndex={0}
            aria-selected={sel.has(i)}
            className={`tracks-row ${showAdded ? 'with-added' : ''} ${sel.has(i) ? 'selected' : ''} ${now ? 'now' : ''} ${dragOver === i ? 'drop-here' : ''}`}
            onClick={(e) => select(i, e)}
            onDoubleClick={() => play(i)}
            onKeyDown={(e) => { if (e.key === 'Enter') play(i); }}
            onContextMenu={(e) => { e.preventDefault(); openMenu(i, e.clientX, e.clientY); }}
            draggable={Boolean(reorder)}
            onDragStart={(e) => { e.dataTransfer.setData('text/x-escuchar-row', String(i)); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { if (reorder) { e.preventDefault(); setDragOver(i); } }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const from = Number(e.dataTransfer.getData('text/x-escuchar-row'));
              if (reorder && Number.isInteger(from) && from !== i) reorder(from, i);
            }}
          >
            <span className="t-n">
              <span className="t-num">{now && playing ? <span className="eq" aria-label="Sonando"><i /><i /><i /></span> : i + 1}</span>
              <button type="button" className="t-play" aria-label={`Reproducir ${t.title}`} onClick={(e) => { e.stopPropagation(); play(i); }}><Play size={16} /></button>
            </span>
            <span className="t-title">
              {showCover && <Cover src={t.thumbnail} name={t.title} size={40} />}
              <span className="t-text">
                <span className="t-name">{t.title}</span>
                <span className="t-artist">{t.artist || '—'}</span>
              </span>
            </span>
            {showAdded && <span className="t-added">{t.at ? new Date(t.at).toLocaleDateString() : ''}</span>}
            <span className="t-dur">
              <button type="button" className={`t-like ${liked ? 'on' : ''}`} aria-label={liked ? 'Quitar de Favoritas' : 'Añadir a Favoritas'} aria-pressed={Boolean(liked)}
                onClick={(e) => { e.stopPropagation(); useLibrary.getState().setLike(t, !liked); }} disabled={!t.key}>
                <Heart filled={liked} size={16} />
              </button>
              <span className="t-time">{t.duration ? formatTime(t.duration) : ''}</span>
              <button type="button" className="t-more" aria-label="Más opciones" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openMenu(i, r.left, r.bottom); }}>
                <More size={16} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

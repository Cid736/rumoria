// The page of anything with songs: a header (cover, kind, name, details,
// tinted from the cover), the big play button, a few actions and the songs.
import { useState } from 'react';
import { fold, totalTime } from '../lib/tracks.js';
import { usePlayer } from '../store/player.js';
import Cover, { gradientOf } from '../components/Cover.jsx';
import { Pause, Play, Shuffle } from '../components/Icons.jsx';
import TrackTable from '../components/TrackTable.jsx';

export default function Collection({ kind, name, sub, cover, tracks, listId = null, actions = null, reorder = null, showAdded = false, loading = false, empty = null }) {
  const [filter, setFilter] = useState('');
  const playingHere = usePlayer((s) => {
    const c = s.queue.items[s.queue.index];
    return Boolean(c) && (listId ? c.list === listId : s.queue.items.length === tracks.length && tracks.length > 0 && s.queue.items[0].key === tracks[0].key);
  });
  const want = usePlayer((s) => s.wantPlaying);
  const shown = filter ? tracks.filter((t) => fold(`${t.title} ${t.artist}`).includes(fold(filter))) : tracks;
  const playAll = (shuffle) => {
    const p = usePlayer.getState();
    if (playingHere && !shuffle) { p.toggle(); return; }
    p.playTracks(tracks, shuffle ? Math.floor(Math.random() * tracks.length) : 0, { shuffle });
  };
  const details = [sub, tracks.length ? `${tracks.length} canciones` : null, totalTime(tracks)].filter(Boolean).join(' · ');

  return (
    <div className="collection">
      <header className="col-head" style={{ '--tint': gradientOf(name) }}>
        {cover}
        <div className="col-head-text">
          <span className="col-kind">{kind}</span>
          <h1 className={`col-name ${name.length > 28 ? 'long' : ''}`}>{name}</h1>
          <span className="col-sub">{details}</span>
        </div>
      </header>
      <div className="col-actions">
        <button type="button" className="big-play" onClick={() => playAll(false)} disabled={!tracks.length} aria-label={playingHere && want ? 'Pausa' : `Reproducir ${name}`}>
          {playingHere && want ? <Pause size={24} /> : <Play size={24} />}
        </button>
        <button type="button" className="icon-btn big" onClick={() => playAll(true)} disabled={!tracks.length} aria-label="Reproducir en orden aleatorio" title="Reproducir en orden aleatorio"><Shuffle size={24} /></button>
        {actions}
        {tracks.length > 8 && <input className="col-filter" type="search" placeholder="Buscar en esta lista" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Buscar en esta lista" />}
      </div>
      {loading ? <p className="muted pad">Cargando…</p> : !tracks.length && empty ? empty : (
        <TrackTable tracks={shown} listId={listId} showAdded={showAdded} reorder={filter ? null : reorder} />
      )}
    </div>
  );
}

export const BigCover = (props) => <Cover size={200} className="col-cover" {...props} />;

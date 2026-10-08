// The page of anything with songs: a header (cover, kind, name, details,
// tinted from the cover), the big play button, a few actions and the songs.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { readSort, saveSort, SORTS, sortTracks } from '../lib/sorting.js';
import { fold, totalTime } from '../lib/tracks.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';
import Cover, { gradientOf } from '../components/Cover.jsx';
import { Pause, Play, Shuffle } from '../components/Icons.jsx';
import TrackTable from '../components/TrackTable.jsx';

// Every song's plays (for "Más escuchadas"), asked once a minute at most.
let countsCache = { at: 0, counts: null };
async function playCounts() {
  if (countsCache.counts && Date.now() - countsCache.at < 60_000) return countsCache.counts;
  const r = await api.get('/api/history/counts');
  countsCache = { at: Date.now(), counts: (r && r.counts) || {} };
  return countsCache.counts;
}

/**
 * `recent`: what this page is, for "Recientes" ({ kind, id, name, sub, payload }), once something plays from it.
 * `sortKey`: where the order chosen for this page is remembered (none: no sorting).
 */
export default function Collection({ kind, name, sub, cover, tracks, listId = null, actions = null, reorder = null, showAdded = false, loading = false, empty = null, recent = null, sortKey = null }) {
  const [filter, setFilter] = useState('');
  const [sort, setSortState] = useState(() => readSort(sortKey));
  const [counts, setCounts] = useState(null);
  useEffect(() => { if (sort === 'plays' && !counts) playCounts().then(setCounts, () => setCounts({})); }, [sort, counts]);
  const setSort = (v) => { setSortState(v); saveSort(sortKey, v); };
  const sorts = SORTS.filter(([k]) => k !== 'added' || tracks.some((t) => t.at));
  const playingHere = usePlayer((s) => {
    const c = s.queue.items[s.queue.index];
    return Boolean(c) && (listId ? c.list === listId : s.queue.items.length === tracks.length && tracks.length > 0 && s.queue.items[0].key === tracks[0].key);
  });
  const want = usePlayer((s) => s.wantPlaying);
  const ordered = sortKey ? sortTracks(tracks, sort, counts || {}) : tracks;
  const shown = filter ? ordered.filter((t) => fold(`${t.title} ${t.artist}`).includes(fold(filter))) : ordered;
  const played = () => {
    if (recent) useUi.getState().addRecent({ ...recent, thumbs: [...new Set(tracks.map((t) => t.thumbnail).filter(Boolean))].slice(0, 4) });
  };
  const playAll = (shuffle) => {
    const p = usePlayer.getState();
    if (playingHere && !shuffle) { p.toggle(); return; }
    p.playTracks(ordered, shuffle ? Math.floor(Math.random() * ordered.length) : 0, { shuffle });
    played();
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
        {sortKey && tracks.length > 1 && (
          <label className="col-sort">
            <span>Ordenar</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar la lista">
              {sorts.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
        )}
        {tracks.length > 8 && <input className="col-filter" type="search" placeholder="Buscar en esta lista" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Buscar en esta lista" />}
      </div>
      {loading ? <p className="muted pad">Cargando…</p> : !tracks.length && empty ? empty : (
        <TrackTable tracks={shown} listId={listId} showAdded={showAdded} reorder={filter || sort !== 'custom' ? null : reorder} onPlay={played} />
      )}
    </div>
  );
}

export const BigCover = (props) => <Cover size={200} className="col-cover" {...props} />;

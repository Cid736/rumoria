// Buscar: YouTube, as you type (after a short pause), plus what matches in
// your lists and favourites. The first result gets a big card.
import { useEffect, useMemo, useState } from 'react';
import { api, urls } from '../api.js';
import { fold, fromYouTube } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';
import Cover from '../components/Cover.jsx';
import { Play } from '../components/Icons.jsx';
import TrackTable from '../components/TrackTable.jsx';

export default function Search() {
  const text = useUi((s) => s.searchText);
  const lists = useLibrary((s) => s.lists);
  // The answer for the last search sent; while the text differs, it's loading.
  const [answer, setAnswer] = useState({ q: '', results: [], error: null });
  const q = text.trim();

  useEffect(() => {
    if (q.length < 2) return undefined;
    let gone = false;
    const timer = setTimeout(() => {
      api.get(urls.search(q))
        .then((r) => { if (!gone) setAnswer({ q, results: (r.results || []).map(fromYouTube), error: null }); })
        .catch((err) => { if (!gone) setAnswer({ q, results: [], error: err.message }); });
    }, 450);
    return () => { gone = true; clearTimeout(timer); };
  }, [q]);

  const state = q.length < 2 ? { q: '', results: [], error: null, loading: false } : { ...answer, loading: answer.q !== q };
  const myLists = useMemo(() => (q.length >= 2 ? lists.filter((l) => fold(l.name).includes(fold(q))).slice(0, 6) : []), [lists, q]);
  const top = state.results[0];

  if (!text.trim()) {
    return (
      <div className="search-empty">
        <h1>Buscar</h1>
        <p className="muted">Escribe una canción, un artista o un álbum. Se escucha directamente de YouTube, sin descargar nada.</p>
      </div>
    );
  }
  return (
    <div className="search">
      {state.error && <p className="error pad">{state.error}</p>}
      {state.loading && !state.results.length && <p className="muted pad">Buscando…</p>}
      {top && (
        <div className="search-top">
          <section>
            <h2 className="shelf-title">Mejor resultado</h2>
            <div className="top-card">
              <Cover src={top.thumbnail} name={top.title} size={96} />
              <div className="top-text"><span className="top-title">{top.title}</span><span className="top-sub">Canción · {top.artist}</span></div>
              <button type="button" className="card-play visible" aria-label={`Reproducir ${top.title}`} onClick={() => usePlayer.getState().playTracks(state.results, 0)}><Play size={22} /></button>
            </div>
          </section>
          <section className="search-songs">
            <h2 className="shelf-title">Canciones</h2>
            <TrackTable tracks={state.results} showCover />
          </section>
        </div>
      )}
      {myLists.length > 0 && (
        <section className="shelf">
          <h2 className="shelf-title">En tu biblioteca</h2>
          <div className="shelf-row">
            {myLists.map((l) => (
              <div key={l.id} className="card">
                <button type="button" className="card-main" onClick={() => useUi.getState().go({ name: 'list', id: l.id })}>
                  <span className="card-art"><Cover src={l.thumbnail} thumbs={l.thumbs} name={l.name} size={160} /></span>
                  <span className="card-title">{l.name}</span>
                  <span className="card-sub">{l.count} canciones</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {!state.loading && state.q && !state.results.length && !state.error && <p className="muted pad">No hay resultados para «{state.q}».</p>}
    </div>
  );
}

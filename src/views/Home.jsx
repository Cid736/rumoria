// Inicio: a greeting, quick tiles for what you play most, "Hecho para ti",
// news from your artists and your lists.
import { useEffect } from 'react';
import { fromList, fromSaved, fromYouTube } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';
import Cover from '../components/Cover.jsx';
import { Play } from '../components/Icons.jsx';
import { buildMix, mixCards, SMART, smartTracks } from './mixes.js';

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
}

function Card({ title, sub, cover, onOpen, onPlay, round = false }) {
  return (
    <div className="card" role="group" aria-label={title}>
      <button type="button" className="card-main" onClick={onOpen}>
        <span className="card-art">{cover}</span>
        <span className={`card-title ${round ? 'center' : ''}`}>{title}</span>
        <span className={`card-sub ${round ? 'center' : ''}`}>{sub}</span>
      </button>
      {onPlay && <button type="button" className="card-play" aria-label={`Reproducir ${title}`} onClick={onPlay}><Play size={20} /></button>}
    </div>
  );
}

function Tile({ title, cover, onOpen, onPlay }) {
  return (
    <div className="tile">
      <button type="button" className="tile-main" onClick={onOpen}>{cover}<span className="tile-title">{title}</span></button>
      {onPlay && <button type="button" className="tile-play" aria-label={`Reproducir ${title}`} onClick={onPlay}><Play size={18} /></button>}
    </div>
  );
}

function Shelf({ title, children }) {
  return (
    <section className="shelf">
      <h2 className="shelf-title">{title}</h2>
      <div className="shelf-row">{children}</div>
    </section>
  );
}

export default function Home() {
  const { lists, likes, smart, news, local, loaded } = useLibrary();
  const go = useUi((s) => s.go);
  useEffect(() => { useLibrary.getState().refreshSmart(); }, []);

  const map = new Map((local.songs || []).map((f) => [f.key, f]));
  const likedTracks = () => likes.map((s) => fromSaved(s, map)).filter(Boolean);
  const play = (tracks) => { if (tracks.length) usePlayer.getState().playTracks(tracks, 0); };
  const playList = async (id) => { try { const l = await useLibrary.getState().loadList(id); play(l.tracks.map(fromList(l.id))); } catch (err) { useUi.getState().toast(err.message); } };
  const mixes = mixCards(smart);
  const smartCards = Object.entries(SMART).map(([k, v]) => ({ k, ...v, tracks: smartTracks(k, smart, local) })).filter((c) => c.tracks.length);

  const tiles = [
    likes.length ? { key: 'liked', title: 'Favoritas', cover: <Cover liked size={56} />, onOpen: () => go({ name: 'liked' }), onPlay: () => play(likedTracks()) } : null,
    ...lists.slice(0, 5).map((l) => ({ key: l.id, title: l.name, cover: <Cover src={l.thumbnail} thumbs={l.thumbs} name={l.name} size={56} />, onOpen: () => go({ name: 'list', id: l.id }), onPlay: () => playList(l.id) })),
  ].filter(Boolean).slice(0, 6);

  return (
    <div className="home">
      <h1 className="greeting">{greeting()}</h1>
      {tiles.length > 0 && <div className="tiles">{tiles.map(({ key, ...t }) => <Tile key={key} {...t} />)}</div>}

      {(mixes.length > 0 || smartCards.length > 0) && (
        <Shelf title="Hecho para ti">
          {mixes.map((m) => (
            <Card key={m.id} title={m.name} sub={m.sub} cover={<Cover src={m.thumb} name={m.sub} size={160} />}
              onOpen={() => go({ name: 'mix', id: m.id })}
              onPlay={async () => play(await buildMix(m.artist, local))} />
          ))}
          {smartCards.map((c) => (
            <Card key={c.k} title={c.name} sub={c.sub} cover={<Cover thumbs={c.tracks.map((t) => t.thumbnail).filter(Boolean)} src={c.tracks[0].thumbnail} name={c.name} size={160} />}
              onOpen={() => go({ name: 'mix', id: c.k })} onPlay={() => play(c.tracks)} />
          ))}
        </Shelf>
      )}

      {news.length > 0 && (
        <Shelf title="Novedades de tus artistas">
          {news.slice(0, 12).map((n) => {
            const t = fromYouTube({ ...n, id: n.yt });
            return <Card key={n.yt} title={n.title} sub={n.artist} cover={<Cover src={n.thumbnail} name={n.title} size={160} />} onOpen={() => play([t])} onPlay={() => play([t])} />;
          })}
        </Shelf>
      )}

      {lists.length > 0 && (
        <Shelf title="Tus listas">
          {lists.slice(0, 12).map((l) => (
            <Card key={l.id} title={l.name} sub={`${l.count} canciones`} cover={<Cover src={l.thumbnail} thumbs={l.thumbs} name={l.name} size={160} />}
              onOpen={() => go({ name: 'list', id: l.id })} onPlay={() => playList(l.id)} />
          ))}
        </Shelf>
      )}

      {loaded && !lists.length && !likes.length && !mixes.length && (
        <section className="welcome">
          <h2>Empieza por tu música</h2>
          <p>Trae una playlist de Spotify, Apple Music o YouTube, busca una canción, o abre tu carpeta de música en Ajustes. Lo que escuches irá llenando «Hecho para ti».</p>
          <div className="welcome-actions">
            <button type="button" className="btn btn-accent" onClick={() => useUi.getState().openDialog({ kind: 'import' })}>Importar una lista</button>
            <button type="button" className="btn btn-ghost" onClick={() => go({ name: 'search' })}>Buscar</button>
          </div>
        </section>
      )}
    </div>
  );
}

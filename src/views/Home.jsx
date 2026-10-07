// Inicio: a greeting with quick tiles, then shelves — made for you, what you
// keep coming back to, recent things, radios for you and popular ones, "if you
// like…", ready-made lists and every category. Everything plays straight from
// YouTube without downloading; the shelves fill in as you listen.
import { useEffect, useState } from 'react';
import { api, urls } from '../api.js';
import { fold, fromList, fromLocal, fromSaved, fromYouTube } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';
import Cover, { gradientOf } from '../components/Cover.jsx';
import { Play } from '../components/Icons.jsx';
import { buildMix, mixCards, SMART, smartTracks } from './mixes.js';
import { discoverOf, radioOf, seedsOf } from './recommend.js';

const SIMILAR_KEY = 'rumoria_similar';

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
}

const toast = (t) => useUi.getState().toast(t);
const play = (tracks) => { if (tracks.length) usePlayer.getState().playTracks(tracks, 0); else toast('No hay canciones que poner ahora mismo.'); };
/** Plays what `load()` gives, noting it in "Recientes" if `recent` says what it is. */
const playFrom = (load, recent = null) => async () => {
  try {
    const tracks = await load();
    play(tracks);
    if (tracks.length && recent) useUi.getState().addRecent({ ...recent, thumbs: [...new Set(tracks.map((t) => t.thumbnail).filter(Boolean))].slice(0, 4) });
  } catch (err) { toast(err.message); }
};

function Card({ title, sub, cover, onOpen, onPlay, round = false }) {
  return (
    <div className={`card ${round ? 'card-round' : ''}`} role="group" aria-label={title}>
      <button type="button" className="card-main" onClick={onOpen}>
        <span className="card-art">{cover}</span>
        <span className="card-title">{title}</span>
        <span className="card-sub">{sub}</span>
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

const CARD_MIN = 176; // the shelf's column width (see .shelf-row)
const GAP = 8;

/**
 * How many cards fit in one row of the element (6 until it can be measured).
 * Returns [per, ref]: the ref is a callback, so it follows the element even
 * when it only appears later (a shelf is empty until its data arrives).
 */
function usePerRow() {
  const [per, setPer] = useState(6);
  const [el, setEl] = useState(null);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setPer(Math.max(1, Math.floor((e.contentRect.width + GAP) / (CARD_MIN + GAP)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [per, setEl];
}

/** A shelf: one row at first (as many as fit), "Mostrar todo" for the rest. */
export function Shelf({ title, kicker = null, children }) {
  const [all, setAll] = useState(false);
  const [per, row] = usePerRow();
  const items = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  if (!items.length) return null;
  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2 className="shelf-title">{kicker && <small className="shelf-kicker">{kicker}</small>}{title}</h2>
        {items.length > per && <button type="button" className="shelf-more" onClick={() => setAll(!all)}>{all ? 'Mostrar menos' : 'Mostrar todo'}</button>}
      </div>
      <div className="shelf-row" ref={row}>{all ? items : items.slice(0, per)}</div>
    </section>
  );
}

// ---- what a thing in "Recientes" opens and plays ----
function viewOf(item) {
  if (item.kind === 'radio') return { name: 'radio', id: item.id, payload: item.payload };
  return item.id ? { name: item.kind, id: item.id } : { name: item.kind };
}
async function tracksOf(item) {
  const lib = useLibrary.getState();
  const map = new Map((lib.local.songs || []).map((f) => [f.key, f]));
  switch (item.kind) {
    case 'list': { const l = await lib.loadList(item.id); return l.tracks.map(fromList(l.id)); }
    case 'browse': return (await lib.loadBrowse(item.id)).tracks.map(fromYouTube);
    case 'radio': {
      // Its song first, as when it was put on from its shelf.
      const p = item.payload || {};
      return [{ key: `yt:${item.id}`, yt: item.id, title: p.title || item.name, artist: p.artist || '', thumbnail: p.thumb || null }, ...await radioOf({ yt: item.id })];
    }
    case 'discover': return discoverOf(lib.smart);
    case 'liked': return lib.likes.map((s) => fromSaved(s, map)).filter(Boolean);
    case 'local': return lib.local.songs.map(fromLocal);
    case 'news': return lib.news.map((n) => fromYouTube({ ...n, id: n.yt }));
    case 'mix': {
      if (SMART[item.id]) return smartTracks(item.id, lib.smart, lib.local);
      const card = mixCards(lib.smart).find((m) => m.id === item.id);
      return card ? buildMix(card.artist, lib.local) : [];
    }
    default: return [];
  }
}
function coverOf(item, size) {
  if (item.kind === 'liked') return <Cover liked size={size} />;
  return <Cover thumbs={item.thumbs} src={item.thumbs && item.thumbs[0]} name={item.name} size={size} round={item.kind === 'radio'} />;
}
function ItemCard({ item }) {
  return <Card title={item.name} sub={item.sub} cover={coverOf(item, 160)} round={item.kind === 'radio'}
    onOpen={() => useUi.getState().go(viewOf(item))} onPlay={playFrom(() => tracksOf(item), item)} />;
}

/** "Explorar": ready-made lists (the featured ones), to open or play straight away. */
export function ExploreShelf({ title = 'Explorar', group = 'genre', kicker = null }) {
  const browse = useLibrary((s) => s.browse);
  const go = useUi((s) => s.go);
  const shown = browse.filter((b) => (b.group || 'genre') === group && b.featured !== false);
  const load = (id) => async () => (await useLibrary.getState().loadBrowse(id)).tracks.map(fromYouTube);
  return (
    <Shelf title={title} kicker={kicker}>
      {shown.map((b) => (
        <Card key={b.id} title={b.name} sub={b.sub} round={group === 'radio'}
          cover={<Cover thumbs={b.thumbs} src={b.thumbs[0]} name={b.name} size={160} round={group === 'radio'} />}
          onOpen={() => go({ name: 'browse', id: b.id })} onPlay={playFrom(load(b.id), { kind: 'browse', id: b.id, name: b.name, sub: b.sub })} />
      ))}
    </Shelf>
  );
}

/** Every category, as coloured tiles (in Buscar and at the end of Inicio). */
export function CategoryGrid({ title = 'Todas las categorías' }) {
  const browse = useLibrary((s) => s.browse);
  const go = useUi((s) => s.go);
  const all = browse.filter((b) => (b.group || 'genre') === 'genre');
  if (!all.length) return null;
  return (
    <section className="shelf">
      <div className="shelf-head"><h2 className="shelf-title">{title}</h2></div>
      <div className="cat-grid">
        {all.map((b) => (
          <button key={b.id} type="button" className="cat-tile" style={{ background: gradientOf(b.name) }} onClick={() => go({ name: 'browse', id: b.id })}>
            <span className="cat-name">{b.name}</span>
            {b.thumbs[0] && <img className="cat-pic" src={b.thumbs[0]} alt="" loading="lazy" draggable="false" />}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * "Si te gusta …": radios of artists like your favourite one — the artists
 * YouTube puts in the mix of their song, one radio each. The same all day.
 */
function LikeArtistShelf({ smart }) {
  const top = ((smart && smart.artists) || []).find((a) => a.seed && a.seed.yt);
  const [similar, setSimilar] = useState({ for: null, items: [] });
  const seed = top ? top.seed.yt : null;
  useEffect(() => {
    if (!seed) return undefined;
    let gone = false;
    const day = new Date().toDateString();
    try {
      const c = JSON.parse(localStorage.getItem(SIMILAR_KEY));
      if (c && c.day === day && c.seed === seed && Array.isArray(c.items)) { setTimeout(() => { if (!gone) setSimilar({ for: seed, items: c.items }); }, 0); return () => { gone = true; }; }
    } catch { /* look it up */ }
    api.get(urls.radio(seed)).then((r) => {
      const me = fold(top.name);
      const seen = new Set([me]);
      const items = [];
      for (const t of (r.entries || []).map(fromYouTube)) {
        const who = fold(t.artist);
        if (!who || seen.has(who) || (me && who.includes(me)) || items.length >= 8) continue;
        seen.add(who);
        items.push({ yt: t.yt, title: t.title, artist: t.artist, thumb: t.thumbnail });
      }
      try { localStorage.setItem(SIMILAR_KEY, JSON.stringify({ day, seed, items })); } catch { /* only for now */ }
      if (!gone) setSimilar({ for: seed, items });
    }).catch(() => {});
    return () => { gone = true; };
    // Once per favourite artist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);
  if (!top || similar.for !== seed) return null;
  return (
    <Shelf kicker="Si te gusta" title={top.name}>
      {similar.items.map((s) => {
        const payload = { title: s.title, artist: s.artist, thumb: s.thumb, name: `Radio de ${s.artist}` };
        return (
          <Card key={s.yt} round title={`Radio de ${s.artist}`} sub={`Empieza con «${s.title}»`} cover={<Cover src={s.thumb} name={s.artist} size={160} round />}
            onOpen={() => useUi.getState().go({ name: 'radio', id: s.yt, payload })}
            onPlay={playFrom(async () => [{ key: `yt:${s.yt}`, yt: s.yt, title: s.title, artist: s.artist, thumbnail: s.thumb }, ...await radioOf(s)],
              { kind: 'radio', id: s.yt, name: payload.name, sub: `${s.artist} y parecidos`, payload })} />
        );
      })}
    </Shelf>
  );
}

export default function Home() {
  const { lists, likes, smart, news, local, loaded } = useLibrary();
  const recent = useUi((s) => s.recent);
  const go = useUi((s) => s.go);
  useEffect(() => {
    useLibrary.getState().refreshSmart();
    // Covers of ready-made lists appear as the server reads them ahead.
    const t = setInterval(() => useLibrary.getState().refreshBrowse(), 120_000);
    return () => clearInterval(t);
  }, []);

  const map = new Map((local.songs || []).map((f) => [f.key, f]));
  const likedTracks = () => likes.map((s) => fromSaved(s, map)).filter(Boolean);
  const listTracks = (id) => async () => { const l = await useLibrary.getState().loadList(id); return l.tracks.map(fromList(l.id)); };
  const mixes = mixCards(smart);
  const smartCards = Object.entries(SMART).map(([k, v]) => ({ k, ...v, tracks: smartTracks(k, smart, local) })).filter((c) => c.tracks.length);
  const seeds = seedsOf(smart, 8);
  const again = recent.filter((r) => r.plays >= 2).sort((a, b) => b.plays - a.plays || b.at - a.at).slice(0, 12);

  const tiles = [
    likes.length ? { key: 'liked', title: 'Favoritas', cover: <Cover liked size={56} />, onOpen: () => go({ name: 'liked' }), onPlay: playFrom(async () => likedTracks(), { kind: 'liked', name: 'Favoritas' }) } : null,
    ...recent.filter((r) => r.kind !== 'liked').slice(0, 5).map((r) => ({ key: `${r.kind}:${r.id}`, title: r.name, cover: coverOf(r, 56), onOpen: () => go(viewOf(r)), onPlay: playFrom(() => tracksOf(r), r) })),
    ...lists.slice(0, 5).map((l) => ({ key: `list:${l.id}`, title: l.name, cover: <Cover src={l.thumbnail} thumbs={l.thumbs} name={l.name} size={56} />, onOpen: () => go({ name: 'list', id: l.id }), onPlay: playFrom(listTracks(l.id), { kind: 'list', id: l.id, name: l.name, sub: 'Lista' }) })),
  ].filter(Boolean).filter((t, i, a) => a.findIndex((x) => x.key === t.key) === i).slice(0, 8);

  return (
    <div className="home">
      <h1 className="greeting">{greeting()}</h1>
      {tiles.length > 0 && <div className="tiles">{tiles.map(({ key, ...t }) => <Tile key={key} {...t} />)}</div>}

      <Shelf title="Hecho para ti">
        {smart && smart.count > 0 && (
          <Card key="discover" title="Descubre algo nuevo" sub="Canciones que aún no has escuchado · cambia cada semana" cover={<Cover name="Descubre algo nuevo" size={160} />}
            onOpen={() => go({ name: 'discover' })} onPlay={playFrom(() => discoverOf(smart), { kind: 'discover', name: 'Descubre algo nuevo', sub: 'Cambia cada semana' })} />
        )}
        {mixes.map((m) => (
          <Card key={m.id} title={m.name} sub={`${m.sub} y más`} cover={<Cover src={m.thumb} name={m.sub} size={160} />}
            onOpen={() => go({ name: 'mix', id: m.id })} onPlay={playFrom(() => buildMix(m.artist, local), { kind: 'mix', id: m.id, name: m.name, sub: `${m.sub} y más` })} />
        ))}
        {news.length > 0 && (
          <Card key="news" title="Novedades de tus artistas" sub={`${news.length} canciones nuevas de los que más escuchas`} cover={<Cover thumbs={news.map((n) => n.thumbnail)} src={news[0].thumbnail} name="Novedades" size={160} />}
            onOpen={() => go({ name: 'news' })} onPlay={playFrom(async () => news.map((n) => fromYouTube({ ...n, id: n.yt })), { kind: 'news', name: 'Novedades de tus artistas', sub: 'Hecho para ti' })} />
        )}
        {smartCards.map((c) => (
          <Card key={c.k} title={c.name} sub={c.sub} cover={<Cover thumbs={c.tracks.map((t) => t.thumbnail).filter(Boolean)} src={c.tracks[0].thumbnail} name={c.name} size={160} />}
            onOpen={() => go({ name: 'mix', id: c.k })} onPlay={playFrom(async () => c.tracks, { kind: 'mix', id: c.k, name: c.name, sub: 'Hecho para ti' })} />
        ))}
      </Shelf>

      <Shelf title="Lo que más vuelves a poner">{again.map((r) => <ItemCard key={`${r.kind}:${r.id}`} item={r} />)}</Shelf>
      <Shelf title="Recientes">{recent.slice(0, 16).map((r) => <ItemCard key={`${r.kind}:${r.id}`} item={r} />)}</Shelf>

      <Shelf title="Radios para ti">
        {seeds.map((s) => {
          const payload = { title: s.title, artist: s.artist, thumb: s.thumb, name: `Radio de ${s.artist || s.title}` };
          return (
            <Card key={s.yt} round title={payload.name} sub={`Empieza con «${s.title}»`} cover={<Cover src={s.thumb} name={s.artist} size={160} round />}
              onOpen={() => go({ name: 'radio', id: s.yt, payload })}
              onPlay={playFrom(async () => [{ key: `yt:${s.yt}`, yt: s.yt, title: s.title, artist: s.artist, thumbnail: s.thumb }, ...await radioOf(s)],
                { kind: 'radio', id: s.yt, name: payload.name, sub: `${s.artist} y parecidos`, payload })} />
          );
        })}
      </Shelf>

      <ExploreShelf title="Radios populares" group="radio" />
      <LikeArtistShelf smart={smart} />
      <ExploreShelf title="Explorar" />

      {lists.length > 0 && (
        <Shelf title="Tus listas">
          {lists.map((l) => (
            <Card key={l.id} title={l.name} sub={`${l.count} canciones`} cover={<Cover src={l.thumbnail} thumbs={l.thumbs} name={l.name} size={160} />}
              onOpen={() => go({ name: 'list', id: l.id })} onPlay={playFrom(listTracks(l.id), { kind: 'list', id: l.id, name: l.name, sub: 'Lista' })} />
          ))}
        </Shelf>
      )}

      {loaded && !lists.length && !likes.length && !mixes.length && !recent.length && (
        <section className="welcome">
          <h2>Empieza por donde quieras</h2>
          <p>Pon cualquier lista de «Explorar» o una radio, trae una playlist de Spotify, Apple Music o YouTube, o busca una canción. Todo suena sin descargar nada, y lo que escuches irá llenando «Hecho para ti».</p>
          <div className="welcome-actions">
            <button type="button" className="btn btn-accent" onClick={() => useUi.getState().openDialog({ kind: 'import' })}>Importar una lista</button>
            <button type="button" className="btn btn-ghost" onClick={() => go({ name: 'search' })}>Buscar</button>
          </div>
        </section>
      )}

      <CategoryGrid />
    </div>
  );
}

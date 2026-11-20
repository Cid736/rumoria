// v1.13, "Podcasts": what you were listening to, the shows you follow (a
// YouTube channel or playlist each) and their newest episodes. Each episode
// carries on where you left it, with −15 / +30 in the player. Nothing is
// downloaded: an episode plays from YouTube like any song.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import Cover from '../components/Cover.jsx';
import { Check, ChevronRight, Link, Pause, Play, Plus, Podcast, Search } from '../components/Icons.jsx';
import { isPhone } from '../lib/android.js';
import { usePlayer } from '../store/player.js';
import { followersText, minutes, searchUrl, stateOf, usePodcasts } from '../store/podcasts.js';
import { useUi } from '../store/ui.js';

const DATE = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });

function addByLink() {
  const ui = useUi.getState();
  ui.openDialog({
    kind: 'prompt', title: 'Seguir un podcast', label: 'Enlace de un canal o de una lista de YouTube', value: '', confirm: 'Seguir',
    onConfirm: (url) => usePodcasts.getState().follow(url).then((show) => { ui.toast(`Sigues «${show.name}»`); ui.go({ name: 'podcast', id: show.id }); }, (err) => ui.toast(err.message)),
  });
}

function episodeMenu(e, ep, show) {
  e.preventDefault();
  const pods = usePodcasts.getState();
  const st = stateOf(ep, pods.progress);
  const ui = useUi.getState();
  const track = { yt: ep.yt, title: ep.title, thumbnail: ep.thumbnail, episode: show ? show.id : ep.show };
  ui.openMenu(e.clientX, e.clientY, [
    st.state === 'done'
      ? { label: 'Marcar como no escuchado', onClick: () => pods.markUnheard(ep.yt) }
      : { label: 'Marcar como escuchado', onClick: () => pods.saveProgress(track, ep.duration || 0, ep.duration, { done: true }) },
    ...(show ? [{ label: `Ir a «${show.name}»`, onClick: () => ui.go({ name: 'podcast', id: show.id }) }] : []),
  ]);
}

/** One episode: cover, show · date, title, and new / how much is left / heard. */
export function EpisodeRow({ ep, show, sub }) {
  const progress = usePodcasts((s) => s.progress);
  const playingYt = usePlayer((s) => { const c = s.queue.items[s.queue.index]; return c && c.episode ? c.yt : null; });
  const want = usePlayer((s) => s.wantPlaying);
  const st = stateOf(ep, progress);
  const here = playingYt === ep.yt;
  const play = () => (here ? usePlayer.getState().toggle() : usePodcasts.getState().play(ep, show));
  const pct = st.state === 'started' && st.d ? Math.min(100, (st.t / st.d) * 100) : 0;
  return (
    <div className={`ep-row ep-${st.state} ${here ? 'playing' : ''}`} onContextMenu={(e) => episodeMenu(e, ep, show)}>
      <button type="button" className="ep-main" onClick={play} aria-label={`${here && want ? 'Pausa' : 'Reproducir'}: ${ep.title}`}>
        <Cover src={ep.thumbnail} name={ep.title} size={72} className="ep-cover" />
        <span className="ep-text">
          <span className="ep-show">{sub || (show ? show.name : '')}</span>
          <span className="ep-title">{ep.title}</span>
          <span className="ep-state">
            {st.state === 'new' && <><i className="ep-dot" aria-hidden="true" />{minutes(ep.duration) || 'Nuevo'}</>}
            {st.state === 'started' && <><span className="ep-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>{st.left ? `Quedan ${minutes(st.left)}` : 'Empezado'}</>}
            {st.state === 'done' && <><Check size={14} /> Escuchado</>}
          </span>
        </span>
      </button>
      <button type="button" className="play-btn ep-play" onClick={play} aria-label={here && want ? 'Pausa' : 'Reproducir'} tabIndex={-1}>
        {here && want ? <Pause size={18} /> : <Play size={18} />}
      </button>
    </div>
  );
}

function ShowCard({ show }) {
  const list = usePodcasts((s) => (s.episodes[show.id] || {}).list);
  const progress = usePodcasts((s) => s.progress);
  const fresh = (list || []).slice(0, 3).filter((e) => !progress[e.yt]).length;
  return (
    <button type="button" className="pod-card" onClick={() => useUi.getState().go({ name: 'podcast', id: show.id })}>
      <span className="pod-art">
        <Cover src={show.thumb} name={show.name} size={160} />
        {fresh > 0 && <i className="pod-new" aria-label={`${fresh} episodios sin escuchar`} />}
      </span>
      <span className="pod-name">{show.name}</span>
      <span className="pod-sub">{fresh > 0 ? `${fresh} ${fresh === 1 ? 'episodio nuevo' : 'episodios nuevos'}` : 'Al día'}</span>
    </button>
  );
}

/** "Tus podcasts": a row that slides sideways (on the computer, an arrow moves it on). */
function ShowRow({ shows }) {
  const ref = useRef(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const check = () => setMore(el.scrollWidth - el.scrollLeft - el.clientWidth > 4);
    check();
    el.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => { el.removeEventListener('scroll', check); window.removeEventListener('resize', check); };
  }, [shows.length]);
  return (
    <div className="pod-row">
      <div className="pod-grid" ref={ref}>{shows.map((s) => <ShowCard key={s.id} show={s} />)}</div>
      {more && !isPhone && (
        <button type="button" className="round-btn pod-more" aria-label="Más podcasts"
          onClick={() => ref.current.scrollBy({ left: ref.current.clientWidth * 0.8, behavior: 'smooth' })}><ChevronRight size={18} /></button>
      )}
    </div>
  );
}

/** Search: YouTube's channels for those words, each one a show to follow. */
function useFindShows() {
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ q: '', shows: [], loading: false, error: null });
  const search = async (e) => {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    setFound({ q: text, shows: [], loading: true, error: null });
    try {
      const r = await api.get(searchUrl(text));
      // A channel says its subscribers; a playlist whose it is (often its whole episodes).
      const shows = (r.shows || []).map((c) => ({ ...c, sample: c.kind === 'playlist' ? ['Lista', c.by].filter(Boolean).join(' · ') : followersText(c.followers) }));
      setFound({ q: text, shows, loading: false, error: null });
    } catch (err) { setFound({ q: text, shows: [], loading: false, error: err.message }); }
  };
  return { q, setQ, found, search };
}

function FindForm({ find, autoFocus = false }) {
  return (
    <form className="searchbox" onSubmit={find.search} role="search">
      <Search size={18} />
      <input type="search" value={find.q} onChange={(e) => find.setQ(e.target.value)} placeholder="Busca un podcast en YouTube" aria-label="Buscar podcasts" autoFocus={autoFocus} />
    </form>
  );
}

/** What the search found (and, on the phone, the box itself above it). */
function FindResults({ find, children }) {
  const { found } = find;
  const shows = usePodcasts((s) => s.shows);
  if (!children && !found.q) return null;
  const followed = new Set(shows.map((s) => s.url));
  const follow = (c) => usePodcasts.getState().follow(c.url).then((show) => useUi.getState().toast(`Sigues «${show.name}»`), (err) => useUi.getState().toast(err.message));
  return (
    <section className="pod-find">
      {children}
      {found.loading && <p className="muted">Buscando «{found.q}»…</p>}
      {found.error && <p className="muted">{found.error}</p>}
      {!found.loading && found.q && !found.error && !found.shows.length && <p className="muted">No hay canales para «{found.q}».</p>}
      {found.shows.length > 0 && (
        <div className="pod-results">
          {found.shows.map((c) => (
            <div key={c.url} className={`pod-result ${c.kind === 'playlist' ? 'pod-result-list' : ''}`}>
              <Cover src={c.thumb} name={c.name} size={56} />
              <span className="pod-result-text"><strong>{c.name}</strong><span className="muted">{c.sample}</span></span>
              {followed.has(c.url)
                ? <span className="pod-following"><Check size={16} /> Lo sigues</span>
                : <button type="button" className="btn btn-accent btn-small" onClick={() => follow(c)}>Seguir</button>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function PodcastsPage() {
  const loaded = usePodcasts((s) => s.loaded);
  const shows = usePodcasts((s) => s.shows);
  const progress = usePodcasts((s) => s.progress);
  const episodes = usePodcasts((s) => s.episodes);
  useEffect(() => { usePodcasts.getState().load(); }, []);
  // The newest of each show (a few shows at a time, they're one yt-dlp run each).
  useEffect(() => { for (const s of shows.slice(0, 8)) usePodcasts.getState().loadEpisodes(s.id); }, [shows]);

  const showById = useMemo(() => new Map(shows.map((s) => [s.id, s])), [shows]);
  const going = useMemo(() => Object.entries(progress)
    .filter(([, p]) => !p.done && p.t > 5 && p.title)
    .sort(([, a], [, b]) => b.at - a.at).slice(0, 3)
    .map(([yt, p]) => ({ ep: { yt, title: p.title, thumbnail: p.thumb, duration: p.d, show: p.show }, show: showById.get(p.show) || null })), [progress, showById]);
  const latest = useMemo(() => {
    const lists = shows.slice(0, 8).map((s) => ({ show: s, list: ((episodes[s.id] || {}).list || []).slice(0, 3) }));
    const out = [];
    for (let i = 0; i < 3; i++) for (const { show, list } of lists) if (list[i] && !going.some((g) => g.ep.yt === list[i].yt)) out.push({ ep: list[i], show });
    return out.slice(0, 10);
  }, [shows, episodes, going]);
  const anyLoading = shows.slice(0, 8).some((s) => (episodes[s.id] || {}).loading);
  const find = useFindShows();
  // The phone: a magnifier and a "+" in the head; the box opens under it (and stays open while you follow nothing).
  const [finding, setFinding] = useState(false);
  const boxOnPhone = finding || (loaded && !shows.length);

  return (
    <div className="podcasts">
      {isPhone ? (
        <header className="pod-head">
          <h1>Podcasts</h1>
          <span className="pod-head-actions">
            <button type="button" className={`icon-btn ${boxOnPhone ? 'on' : ''}`} aria-label="Buscar podcasts" aria-expanded={boxOnPhone} onClick={() => setFinding(!finding)}><Search size={24} /></button>
            <button type="button" className="icon-btn" aria-label="Seguir por enlace" onClick={addByLink}><Plus size={24} /></button>
          </span>
        </header>
      ) : (
        <header className="pod-head">
          <h1>Podcasts</h1>
          <span className="pod-head-actions">
            <FindForm find={find} />
            <button type="button" className="btn btn-ghost" onClick={addByLink}><Link size={16} /> Seguir por enlace</button>
          </span>
        </header>
      )}
      <FindResults find={find}>{isPhone && boxOnPhone ? <FindForm find={find} autoFocus={finding} /> : null}</FindResults>
      {going.length > 0 && (
        <section className="pod-section">
          <h2>Seguir escuchando</h2>
          <div className="pod-eps">{going.map(({ ep, show }) => <EpisodeRow key={ep.yt} ep={ep} show={show} />)}</div>
        </section>
      )}
      {shows.length > 0 && (
        <section className="pod-section">
          <h2>Tus podcasts</h2>
          <ShowRow shows={shows} />
        </section>
      )}
      {shows.length > 0 && (
        <section className="pod-section">
          <h2>Episodios nuevos</h2>
          <div className="pod-eps">{latest.map(({ ep, show }) => <EpisodeRow key={ep.yt} ep={ep} show={show} />)}</div>
          {!latest.length && <p className="muted">{anyLoading ? 'Buscando los episodios…' : 'Aún no hay episodios.'}</p>}
        </section>
      )}
      {loaded && !shows.length && (
        <div className="pod-empty">
          <Podcast size={40} />
          <p><strong>Sigue tus podcasts</strong></p>
          <p className="muted">Búscalo o pega el enlace de su canal o de su lista de YouTube. Rumoria recuerda dónde te quedaste en cada episodio; no descarga nada.</p>
        </div>
      )}
    </div>
  );
}

/** One show: its episodes, newest first. */
export function PodcastShowPage({ id }) {
  const show = usePodcasts((s) => s.shows.find((x) => x.id === id) || null);
  const loaded = usePodcasts((s) => s.loaded);
  const got = usePodcasts((s) => s.episodes[id]) || {};
  useEffect(() => { if (!usePodcasts.getState().loaded) usePodcasts.getState().load(); }, []);
  useEffect(() => { if (show) usePodcasts.getState().loadEpisodes(id); }, [id, show]);
  if (!show) return <div className="podcasts"><p className="muted">{loaded ? 'Ya no sigues este podcast.' : 'Cargando…'}</p></div>;
  const list = got.list || [];
  const unfollow = () => usePodcasts.getState().unfollow(id).then(() => { useUi.getState().toast(`Has dejado de seguir «${show.name}»`); useUi.getState().go({ name: 'podcasts' }); }, (err) => useUi.getState().toast(err.message));
  return (
    <div className="podcasts pod-show">
      <header className="pod-show-head">
        <Cover src={show.thumb} name={show.name} size={160} className="pod-show-cover" />
        <div className="pod-show-text">
          <span className="pod-kicker">Podcast</span>
          <h1>{show.name}</h1>
          <p className="muted">{[list.length ? `${list.length} episodios recientes` : '', show.at ? `lo sigues desde el ${DATE.format(new Date(show.at))}` : ''].filter(Boolean).join(' · ')}</p>
          <div className="pod-show-actions">
            {list[0] && <button type="button" className="btn btn-accent" onClick={() => usePodcasts.getState().play(list[0], show)}><Play size={16} /> El más reciente</button>}
            <button type="button" className="btn btn-ghost" onClick={unfollow}>Dejar de seguir</button>
          </div>
        </div>
      </header>
      <section className="pod-section">
        {list.map((ep) => <EpisodeRow key={ep.yt} ep={ep} show={show} />)}
        {got.loading && !list.length && <p className="muted">Buscando los episodios…</p>}
        {got.error && !list.length && <p className="muted">{got.error}</p>}
      </section>
    </div>
  );
}

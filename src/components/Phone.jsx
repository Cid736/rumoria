// The phone layout (Android app): the page on top, a small player above a bar
// of four tabs (Inicio, Buscar, Biblioteca, Ajustes); tapping the small player
// opens it big, with the cover, the position and every button, a thumb's size.
import { useState } from 'react';
import { formatTime } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';
import Cover from './Cover.jsx';
import { Slider } from './PlayerBar.jsx';
import { ChevronLeft, Gear, Heart, Home, Library, Mic, Next, Pause, Play, Prev, Queue, Radio, Repeat, RepeatOne, Search, Shuffle, Sliders } from './Icons.jsx';

// Which tab a page belongs to (the rest belong to the one you came from).
const TAB_OF = { home: 'home', search: 'search', library: 'library', settings: 'settings', liked: 'library', list: 'library', rules: 'library', local: 'library', summary: 'library', stats: 'library', history: 'library' };
export const TABS = [['home', 'Inicio', Home], ['search', 'Buscar', Search], ['library', 'Biblioteca', Library], ['settings', 'Ajustes', Gear]];

export function TabBar() {
  const view = useUi((s) => s.history[s.at]);
  const tab = TAB_OF[view.name] || 'home';
  return (
    <nav className="tabbar" aria-label="Secciones">
      {TABS.map(([name, label, Icon]) => (
        <button key={name} type="button" className={`tab ${tab === name ? 'on' : ''}`} aria-current={tab === name ? 'page' : undefined}
          onClick={() => { const ui = useUi.getState(); ui.setNowPlaying(false); if (ui.panel) ui.togglePanel(ui.panel); ui.goTab({ name }); }}>
          <Icon size={24} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

/** Above the tabs: what's playing, play / pause, and a thin line with the position. Tap: the big player. */
export function MiniBar() {
  const cur = usePlayer((s) => s.queue.items[s.queue.index] || null);
  const want = usePlayer((s) => s.wantPlaying);
  const status = usePlayer((s) => s.status);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration || (cur && cur.duration) || 0);
  const liked = useLibrary((s) => Boolean(cur && cur.key && s.likedKeys.has(cur.key)));
  if (!cur) return null;
  const pct = duration ? Math.min(100, (position / duration) * 100) : 0;
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div className="minibar" role="button" tabIndex={0} aria-label={`Sonando: ${cur.title}. Abrir el reproductor`}
      onClick={() => useUi.getState().setNowPlaying(true)} onKeyDown={(e) => { if (e.key === 'Enter') useUi.getState().setNowPlaying(true); }}>
      <Cover src={cur.thumbnail} name={cur.title} size={44} />
      <span className="minibar-text">
        <span className="minibar-title">{cur.title}</span>
        <span className="minibar-artist">{status === 'loading' && want ? 'Cargando…' : cur.artist || '—'}</span>
      </span>
      <button type="button" className={`icon-btn minibar-like ${liked ? 'on' : ''}`} disabled={!cur.key} aria-pressed={liked} aria-label={liked ? 'Quitar de Favoritas' : 'Añadir a Favoritas'}
        onClick={stop(() => useLibrary.getState().setLike(cur, !liked))}><Heart filled={liked} size={22} /></button>
      <button type="button" className={`icon-btn minibar-play ${status === 'loading' && want ? 'loading' : ''}`} aria-label={want ? 'Pausa' : 'Reproducir'}
        onClick={stop(() => usePlayer.getState().toggle())}>{want ? <Pause size={26} /> : <Play size={26} />}</button>
      <span className="minibar-line" style={{ width: `${pct}%` }} aria-hidden="true" />
    </div>
  );
}

/** The big player: cover, title, the position, the controls, and lyrics / queue / sound / radio. */
export function PhonePlayer() {
  const open = useUi((s) => s.nowPlaying);
  const cur = usePlayer((s) => s.queue.items[s.queue.index] || null);
  if (!open || !cur) return null;
  return <PhonePlayerView cur={cur} />;
}

function PhonePlayerView({ cur }) {
  const want = usePlayer((s) => s.wantPlaying);
  const status = usePlayer((s) => s.status);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration || (cur && cur.duration) || 0);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => Boolean(s.queue.original));
  const radio = usePlayer((s) => s.radio);
  const panel = useUi((s) => s.panel);
  const liked = useLibrary((s) => Boolean(cur.key && s.likedKeys.has(cur.key)));
  const [dragPos, setDragPos] = useState(null);
  const p = usePlayer.getState();
  const ui = useUi.getState();
  // A bigger cover than the list's (YouTube's high quality one).
  const big = typeof cur.thumbnail === 'string' ? cur.thumbnail.replace(/\/(mq|default)default\.jpg/, '/hqdefault.jpg') : null;
  return (
    <section className="phone-player" aria-label="Reproductor">
      <header className="pp-head">
        <button type="button" className="icon-btn" aria-label="Cerrar el reproductor" onClick={() => ui.setNowPlaying(false)}><ChevronLeft size={28} className="pp-down" /></button>
        <span className="pp-head-title">Sonando</span>
        <span className="pp-head-gap" />
      </header>
      <div className="pp-art"><Cover src={big} name={cur.title} size={1000} /></div>
      <div className="pp-info">
        <span className="pp-text">
          <span className="pp-title">{cur.title}</span>
          <span className="pp-artist">{cur.artist || '—'}</span>
        </span>
        <button type="button" className={`icon-btn pp-like ${liked ? 'on' : ''}`} disabled={!cur.key} aria-pressed={liked} aria-label={liked ? 'Quitar de Favoritas' : 'Añadir a Favoritas'}
          onClick={() => useLibrary.getState().setLike(cur, !liked)}><Heart filled={liked} size={28} /></button>
      </div>
      <div className="pp-progress">
        <Slider value={position} max={duration} label="Posición" step={5} format={formatTime} onChange={setDragPos} onCommit={(v) => { setDragPos(null); p.seek(v); }} />
        <div className="pp-times"><span>{formatTime(dragPos ?? position)}</span><span>{duration ? formatTime(duration) : '–:––'}</span></div>
      </div>
      <div className="pp-controls">
        <button type="button" className={`icon-btn toggle ${shuffle ? 'on' : ''}`} aria-pressed={shuffle} aria-label="Aleatorio" onClick={p.toggleShuffle}><Shuffle size={24} /></button>
        <button type="button" className="icon-btn" aria-label="Anterior" onClick={p.prev}><Prev size={34} /></button>
        <button type="button" className={`play-btn pp-play ${status === 'loading' && want ? 'loading' : ''}`} aria-label={want ? 'Pausa' : 'Reproducir'} onClick={p.toggle}>
          {want ? <Pause size={32} /> : <Play size={32} />}
        </button>
        <button type="button" className="icon-btn" aria-label="Siguiente" onClick={() => p.next()}><Next size={34} /></button>
        <button type="button" className={`icon-btn toggle ${repeat !== 'off' ? 'on' : ''}`} aria-label={`Repetir: ${repeat === 'off' ? 'no' : repeat === 'all' ? 'todo' : 'esta canción'}`} onClick={p.cycleRepeat}>
          {repeat === 'one' ? <RepeatOne size={24} /> : <Repeat size={24} />}
        </button>
      </div>
      <div className="pp-more">
        <button type="button" className={`pp-chip ${panel === 'lyrics' ? 'on' : ''}`} onClick={() => ui.togglePanel('lyrics')}><Mic size={20} /> Letra</button>
        <button type="button" className={`pp-chip ${panel === 'queue' ? 'on' : ''}`} onClick={() => ui.togglePanel('queue')}><Queue size={20} /> Cola</button>
        <button type="button" className={`pp-chip ${radio ? 'on' : ''}`} aria-pressed={radio} onClick={p.toggleRadio}><Radio size={20} /> Parecidas</button>
        <button type="button" className={`pp-chip ${panel === 'sound' ? 'on' : ''}`} onClick={() => ui.togglePanel('sound')}><Sliders size={20} /> Sonido</button>
      </div>
    </section>
  );
}

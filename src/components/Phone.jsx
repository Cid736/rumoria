// The phone layout (Android app): the page on top, a small player above a bar
// of five tabs (Inicio, Buscar, Podcasts, Biblioteca, Ajustes); tapping the small player
// opens it big, with the cover, the position and every button, a thumb's size.
import { useState } from 'react';
import { audioQuality } from '../lib/network.js';
import { formatTime } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';
import ClipVideo from './ClipVideo.jsx';
import Cover from './Cover.jsx';
import { Slider } from './PlayerBar.jsx';
import { Back15, ChevronLeft, Close, Film, Forward30, Gear, Heart, Home, Library, Mic, Next, Notes, Pause, Play, Podcast, Prev, Queue, Radio, Repeat, RepeatOne, Search, Shuffle, Sliders } from './Icons.jsx';
import { SleepButton, SpeedButton } from './PodControls.jsx';

// Which tab a page belongs to (the rest belong to the one you came from).
const TAB_OF = { home: 'home', search: 'search', podcasts: 'podcasts', podcast: 'podcasts', library: 'library', settings: 'settings', liked: 'library', list: 'library', rules: 'library', local: 'library', summary: 'library', stats: 'library', history: 'library' };
export const TABS = [['home', 'Inicio', Home], ['search', 'Buscar', Search], ['podcasts', 'Podcasts', Podcast], ['library', 'Biblioteca', Library], ['settings', 'Ajustes', Gear]];

export function TabBar() {
  const view = useUi((s) => s.history[s.at]);
  const update = useUi((s) => s.appUpdate);
  const tab = TAB_OF[view.name] || 'home';
  return (
    <nav className="tabbar" aria-label="Secciones">
      {TABS.map(([name, label, Icon]) => (
        <button key={name} type="button" className={`tab ${tab === name ? 'on' : ''}`} aria-current={tab === name ? 'page' : undefined}
          onClick={() => { const ui = useUi.getState(); ui.setNowPlaying(false); if (ui.panel) ui.togglePanel(ui.panel); ui.goTab({ name }); }}>
          <span className="tab-icon"><Icon size={24} />{name === 'settings' && update && <i className="tab-dot" aria-label={`Rumoria ${update.version} está lista`} />}</span>
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
        <span className="minibar-artist">{status === 'loading' && want ? 'Cargando…' : cur.episode && duration ? `Quedan ${formatTime(Math.max(0, duration - position))}` : cur.artist || '—'}</span>
      </span>
      {cur.episode
        ? <button type="button" className="icon-btn minibar-like" aria-label="Adelante 30 segundos" onClick={stop(() => usePlayer.getState().skip(30))}><Forward30 size={24} /></button>
        : <button type="button" className={`icon-btn minibar-like ${liked ? 'on' : ''}`} disabled={!cur.key} aria-pressed={liked} aria-label={liked ? 'Quitar de Favoritas' : 'Añadir a Favoritas'}
          onClick={stop(() => useLibrary.getState().setLike(cur, !liked))}><Heart filled={liked} size={22} /></button>}
      <button type="button" className={`icon-btn minibar-play ${status === 'loading' && want ? 'loading' : ''}`} aria-label={want ? 'Pausa' : 'Reproducir'}
        onClick={stop(() => usePlayer.getState().toggle())}>{want ? <Pause size={26} /> : <Play size={26} />}</button>
      {/* v1.12.3: closing it stops the music (and the notification goes with it). */}
      <button type="button" className="icon-btn minibar-close" aria-label="Cerrar el reproductor"
        onClick={stop(() => usePlayer.getState().close())}><Close size={20} /></button>
      <span className="minibar-track" aria-hidden="true" />
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

// The video (muted, in step with the sound) instead of the cover: remembered on this phone.
const VIDEO_KEY = 'rumoria.phoneVideo';
function readVideoPref() { try { return localStorage.getItem(VIDEO_KEY) === '1'; } catch { return false; } }
function saveVideoPref(on) { try { localStorage.setItem(VIDEO_KEY, on ? '1' : '0'); } catch { /* only for now */ } }

function PhonePlayerView({ cur }) {
  const [video, setVideo] = useState(readVideoPref);
  const toggleVideo = () => {
    const on = !video;
    setVideo(on);
    saveVideoPref(on);
    // 360p at most, but still far more than the sound alone.
    if (on && audioQuality() === 'lite') useUi.getState().toast('El vídeo gasta bastantes más datos que el sonido solo.');
  };
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
        {cur.yt
          ? <button type="button" className={`icon-btn toggle ${video ? 'on' : ''}`} aria-pressed={video} aria-label="Vídeo (sin sonido: sigue al sonido)" onClick={toggleVideo}><Film size={24} /></button>
          : <span className="pp-head-gap" />}
      </header>
      {/* An episode's picture is YouTube's 16:9 frame: shown whole, not cut to a square. */}
      <div className={`pp-art ${cur.episode || (video && cur.yt) ? 'pp-art-wide' : ''}`}>
        {video && cur.yt
          ? <ClipVideo yt={cur.yt} position={position} playing={want} episode={Boolean(cur.episode)} poster={big} className="pp-video" />
          : <Cover src={big} name={cur.title} size={1000} />}
      </div>
      <div className="pp-info">
        <span className="pp-text">
          <span className="pp-title">{cur.title}</span>
          <span className="pp-artist">{cur.artist || '—'}</span>
        </span>
        {/* An episode isn't a song for Favoritas (as on the computer). */}
        {!cur.episode && (
          <button type="button" className={`icon-btn pp-like ${liked ? 'on' : ''}`} disabled={!cur.key} aria-pressed={liked} aria-label={liked ? 'Quitar de Favoritas' : 'Añadir a Favoritas'}
            onClick={() => useLibrary.getState().setLike(cur, !liked)}><Heart filled={liked} size={28} /></button>
        )}
      </div>
      <div className="pp-progress">
        <Slider value={position} max={duration} label="Posición" step={5} format={formatTime} onChange={setDragPos} onCommit={(v) => { setDragPos(null); p.seek(v); }} />
        <div className="pp-times"><span>{formatTime(dragPos ?? position)}</span><span>{!duration ? '–:––' : cur.episode ? `−${formatTime(Math.max(0, duration - (dragPos ?? position)))}` : formatTime(duration)}</span></div>
      </div>
      <div className="pp-controls">
        {cur.episode
          ? <><SpeedButton /><button type="button" className="icon-btn" aria-label="Atrás 15 segundos" onClick={() => p.skip(-15)}><Back15 size={34} /></button></>
          : <><button type="button" className={`icon-btn toggle ${shuffle ? 'on' : ''}`} aria-pressed={shuffle} aria-label="Aleatorio" onClick={p.toggleShuffle}><Shuffle size={24} /></button>
            <button type="button" className="icon-btn" aria-label="Anterior" onClick={p.prev}><Prev size={34} /></button></>}
        <button type="button" className={`play-btn pp-play ${status === 'loading' && want ? 'loading' : ''}`} aria-label={want ? 'Pausa' : 'Reproducir'} onClick={p.toggle}>
          {want ? <Pause size={32} /> : <Play size={32} />}
        </button>
        {cur.episode
          ? <><button type="button" className="icon-btn" aria-label="Adelante 30 segundos" onClick={() => p.skip(30)}><Forward30 size={34} /></button><SleepButton size={24} /></>
          : <><button type="button" className="icon-btn" aria-label="Siguiente" onClick={() => p.next()}><Next size={34} /></button>
            <button type="button" className={`icon-btn toggle ${repeat !== 'off' ? 'on' : ''}`} aria-label={`Repetir: ${repeat === 'off' ? 'no' : repeat === 'all' ? 'todo' : 'esta canción'}`} onClick={p.cycleRepeat}>
              {repeat === 'one' ? <RepeatOne size={24} /> : <Repeat size={24} />}
            </button></>}
      </div>
      {cur.episode ? (
        // v1.13: an episode's own: the show's episodes, its notes, and the sound.
        <div className="pp-more pp-more-3">
          <button type="button" className="pp-chip" onClick={() => { ui.setNowPlaying(false); ui.go({ name: 'podcast', id: cur.episode }); }}><Queue size={20} /> Episodios</button>
          <button type="button" className={`pp-chip ${panel === 'notes' ? 'on' : ''}`} onClick={() => ui.togglePanel('notes')}><Notes size={20} /> Notas</button>
          <button type="button" className={`pp-chip ${panel === 'sound' ? 'on' : ''}`} onClick={() => ui.togglePanel('sound')}><Sliders size={20} /> Sonido</button>
        </div>
      ) : (
        <div className="pp-more">
          <button type="button" className={`pp-chip ${panel === 'lyrics' ? 'on' : ''}`} onClick={() => ui.togglePanel('lyrics')}><Mic size={20} /> Letra</button>
          <button type="button" className={`pp-chip ${panel === 'queue' ? 'on' : ''}`} onClick={() => ui.togglePanel('queue')}><Queue size={20} /> Cola</button>
          <button type="button" className={`pp-chip ${radio ? 'on' : ''}`} aria-pressed={radio} onClick={p.toggleRadio}><Radio size={20} /> Parecidas</button>
          <button type="button" className={`pp-chip ${panel === 'sound' ? 'on' : ''}`} onClick={() => ui.togglePanel('sound')}><Sliders size={20} /> Sonido</button>
        </div>
      )}
    </section>
  );
}

// Bottom: what's playing (with the star), the controls and the position, and
// on the right lyrics, the queue and the volume.
import { useRef, useState } from 'react';
import { desktop } from '../api.js';
import { formatTime } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';
import Cover from './Cover.jsx';
import { Heart, Mic, MiniPlayer, Next, Pause, Play, Prev, Queue, Radio, Repeat, RepeatOne, Shuffle, Volume } from './Icons.jsx';

/** A bar you can click or drag (position, volume), and move with the arrow keys. */
export function Slider({ value, max, onChange, onCommit, label, step, format }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);
  const shown = drag ?? value;
  const pct = max > 0 ? Math.max(0, Math.min(100, (shown / max) * 100)) : 0;
  const at = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * max;
  };
  const down = (e) => {
    if (!max) return;
    e.preventDefault();
    const v = at(e.clientX);
    setDrag(v);
    if (onChange) onChange(v);
    const move = (ev) => { const nv = at(ev.clientX); setDrag(nv); if (onChange) onChange(nv); };
    const up = (ev) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setDrag(null); onCommit(at(ev.clientX)); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div ref={ref} className={`slider ${drag !== null ? 'dragging' : ''}`} role="slider" tabIndex={max ? 0 : -1}
      aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(shown)} aria-valuetext={format ? format(shown) : undefined}
      onPointerDown={down}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onCommit(Math.min(max, value + step)); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onCommit(Math.max(0, value - step)); }
      }}>
      <div className="slider-track"><div className="slider-fill" style={{ width: `${pct}%` }} /><div className="slider-thumb" style={{ left: `${pct}%` }} /></div>
    </div>
  );
}

export default function PlayerBar() {
  const cur = usePlayer((s) => s.queue.items[s.queue.index] || null);
  const want = usePlayer((s) => s.wantPlaying);
  const status = usePlayer((s) => s.status);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration || (cur && cur.duration) || 0);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => Boolean(s.queue.original));
  const radio = usePlayer((s) => s.radio);
  const panel = useUi((s) => s.panel);
  const liked = useLibrary((s) => Boolean(cur && cur.key && s.likedKeys.has(cur.key)));
  const [dragPos, setDragPos] = useState(null);
  const p = usePlayer.getState();
  const vol = muted ? 0 : volume;

  return (
    <footer className="playerbar" aria-label="Reproductor">
      <div className="pb-now">
        {cur ? (
          <>
            <Cover src={cur.thumbnail} name={cur.title} size={56} />
            <div className="pb-text">
              <span className="pb-title" title={cur.title}>{cur.title}</span>
              <span className="pb-artist" title={cur.artist}>{cur.artist || '—'}</span>
            </div>
            <button type="button" className={`icon-btn pb-like ${liked ? 'on' : ''}`} disabled={!cur.key} aria-pressed={liked}
              aria-label={liked ? 'Quitar de Favoritas' : 'Añadir a Favoritas'} title={liked ? 'Quitar de Favoritas' : 'Añadir a Favoritas'}
              onClick={() => useLibrary.getState().setLike(cur, !liked)}><Heart filled={liked} size={18} /></button>
          </>
        ) : <span className="pb-idle">Elige algo que escuchar</span>}
      </div>

      <div className="pb-center">
        <div className="pb-controls">
          <button type="button" className={`icon-btn toggle ${shuffle ? 'on' : ''}`} aria-pressed={shuffle} aria-label="Aleatorio" title="Aleatorio (Ctrl+S)" onClick={p.toggleShuffle}><Shuffle size={18} /></button>
          <button type="button" className="icon-btn" aria-label="Anterior" title="Anterior (Ctrl+←)" onClick={p.prev} disabled={!cur}><Prev size={20} /></button>
          <button type="button" className={`play-btn ${status === 'loading' && want ? 'loading' : ''}`} aria-label={want ? 'Pausa' : 'Reproducir'} title={want ? 'Pausa (Espacio)' : 'Reproducir (Espacio)'} onClick={p.toggle} disabled={!cur}>
            {want ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button type="button" className="icon-btn" aria-label="Siguiente" title="Siguiente (Ctrl+→)" onClick={() => p.next()} disabled={!cur}><Next size={20} /></button>
          <button type="button" className={`icon-btn toggle ${repeat !== 'off' ? 'on' : ''}`} aria-label={`Repetir: ${repeat === 'off' ? 'no' : repeat === 'all' ? 'todo' : 'esta canción'}`} title="Repetir (Ctrl+R)" onClick={p.cycleRepeat}>
            {repeat === 'one' ? <RepeatOne size={18} /> : <Repeat size={18} />}
          </button>
        </div>
        <div className="pb-progress">
          <span className="pb-time">{formatTime(dragPos ?? position)}</span>
          <Slider value={position} max={duration} label="Posición" step={5} format={formatTime} onChange={setDragPos} onCommit={(v) => { setDragPos(null); p.seek(v); }} />
          <span className="pb-time">{duration ? formatTime(duration) : '–:––'}</span>
        </div>
      </div>

      <div className="pb-side">
        <button type="button" className={`icon-btn toggle ${radio ? 'on' : ''}`} aria-pressed={radio} aria-label="Seguir con canciones parecidas" title="Al acabar, seguir con canciones parecidas" onClick={p.toggleRadio}><Radio size={18} /></button>
        <button type="button" className={`icon-btn toggle ${panel === 'lyrics' ? 'on' : ''}`} aria-pressed={panel === 'lyrics'} aria-label="Letra" title="Letra" onClick={() => useUi.getState().togglePanel('lyrics')}><Mic size={18} /></button>
        {desktop && desktop.mini && <button type="button" className="icon-btn" aria-label="Mini reproductor" title="Mini reproductor (Ctrl+M)" onClick={() => desktop.mini.open()}><MiniPlayer size={18} /></button>}
        <button type="button" className={`icon-btn toggle ${panel === 'queue' ? 'on' : ''}`} aria-pressed={panel === 'queue'} aria-label="Cola" title="Cola" onClick={() => useUi.getState().togglePanel('queue')}><Queue size={18} /></button>
        <button type="button" className="icon-btn" aria-label={muted ? 'Activar sonido' : 'Silenciar'} title={muted ? 'Activar sonido' : 'Silenciar'} onClick={p.toggleMute}><Volume level={vol} size={18} /></button>
        <div className="pb-volume"><Slider value={vol} max={1} label="Volumen" step={0.05} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => p.setVolume(v)} onCommit={(v) => p.setVolume(v)} /></div>
      </div>
    </footer>
  );
}

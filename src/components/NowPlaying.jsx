// v1.5, "Sonando" a pantalla completa: the cover big (or the video clip),
// the lyrics following the song, what comes next, and the controls — for a
// TV or a second screen. The pointer and controls hide after a few seconds
// still; Esc (or the button) goes back.
import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../lib/tracks.js';
import { lineIndex, useLyrics } from '../player/useLyrics.js';
import { useLibrary } from '../store/library.js';
import { usePerf } from '../store/perf.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';
import ClipVideo from './ClipVideo.jsx';
import Cover from './Cover.jsx';
import { Collapse, Film, Heart, Mic, Next, Pause, Play, Prev, Repeat, RepeatOne, Shuffle } from './Icons.jsx';
import { Slider } from './PlayerBar.jsx';

const SAFE_IMG = /^https:\/\/i\d?\.ytimg\.com\/[\w\-/.]+(\?[\w\-=&%.]*)?$/;
const PREFS_KEY = 'rumoria_nowplaying';
const IDLE_MS = 3000;

function readPrefs() {
  try { const p = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; return { video: p.video === true, lyrics: p.lyrics !== false }; } catch { return { video: false, lyrics: true }; }
}
function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ video: Boolean(p.video), lyrics: Boolean(p.lyrics) })); } catch { /* only for now */ } }

export default function NowPlaying() {
  const open = useUi((s) => s.nowPlaying);
  return open ? <NowPlayingView /> : null;
}

function NowPlayingView() {
  const cur = usePlayer((s) => s.queue.items[s.queue.index] || null);
  const want = usePlayer((s) => s.wantPlaying);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration || (cur && cur.duration) || 0);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => Boolean(s.queue.original));
  const queue = usePlayer((s) => s.queue);
  const upcoming = queue.items.slice(queue.index + 1, queue.index + 4);
  const liked = useLibrary((s) => Boolean(cur && cur.key && s.likedKeys.has(cur.key)));
  const low = usePerf((s) => s.profile === 'min');
  const [prefs, setPrefs] = useState(readPrefs);
  const [idle, setIdle] = useState(false);
  const [dragPos, setDragPos] = useState(null);
  const root = useRef(null);
  const box = useRef(null);
  const lyrics = useLyrics(prefs.lyrics ? cur : null);
  const line = lineIndex(lyrics.synced, position);
  const p = usePlayer.getState();
  const close = () => useUi.getState().setNowPlaying(false);
  const change = (patch) => { const next = { ...prefs, ...patch }; setPrefs(next); savePrefs(next); };

  // The whole screen while it's open; leaving full screen (Esc, F11) closes it.
  useEffect(() => {
    const el = root.current;
    let asked = false;
    if (el && el.requestFullscreen && !document.fullscreenElement) { el.requestFullscreen().then(() => { asked = true; }, () => {}); }
    const onChange = () => { if (asked && !document.fullscreenElement) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    };
  }, []);
  // Still for a few seconds: the pointer and the controls fade away.
  useEffect(() => {
    let t = null;
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), IDLE_MS); };
    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', wake);
    return () => { clearTimeout(t); window.removeEventListener('pointermove', wake); window.removeEventListener('keydown', wake); };
  }, []);
  useEffect(() => {
    const el = box.current && box.current.querySelector('.np-line.on');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: low ? 'auto' : 'smooth' });
  }, [line, low]);

  const cover = cur && typeof cur.thumbnail === 'string' && SAFE_IMG.test(cur.thumbnail) ? cur.thumbnail : null;
  const big = cover ? cover.replace(/\/(mq|sd)default\.jpg/, '/hqdefault.jpg') : null;
  const showVideo = prefs.video && cur && cur.yt;

  return (
    <div ref={root} className={`nowplaying ${idle ? 'idle' : ''}`} role="dialog" aria-modal="true" aria-label="Sonando">
      {big && <div className="np-backdrop" style={{ '--np-cover': `url("${big}")` }} aria-hidden="true" />}
      <div className="np-body">
        <div className="np-art">
          {!cur ? <div className="np-empty">Nada sonando</div>
            : showVideo ? <ClipVideo yt={cur.yt} position={position} playing={want} className="np-video" />
              : <Cover src={big} name={cur.title} size={480} className="np-cover" />}
        </div>
        <div className="np-side">
          {prefs.lyrics && cur && (
            lyrics.synced ? (
              <div className="np-lyrics" ref={box}>
                {lyrics.synced.map((l, i) => (
                  <button key={`${l.t}-${i}`} type="button" className={`np-line ${i === line ? 'on' : i < line ? 'past' : ''}`} onClick={() => p.seek(l.t)}>{l.text || '♪'}</button>
                ))}
              </div>
            ) : lyrics.plain ? <div className="np-lyrics plain">{lyrics.plain}</div>
              : <p className="np-nolyrics">{lyrics.loading ? 'Buscando la letra…' : cur.yt ? 'No se encontró la letra de esta canción.' : ''}</p>
          )}
          {upcoming.length > 0 && (
            <div className="np-next">
              <h3>A continuación</h3>
              {upcoming.map((t, k) => (
                <button key={t.uid} type="button" className="np-next-row" onClick={() => p.jump(queue.index + 1 + k)}>
                  <Cover src={t.thumbnail} name={t.title} size={40} />
                  <span><strong>{t.title}</strong><small>{t.artist || '—'}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="np-bar">
        <div className="np-title">
          <strong>{cur ? cur.title : ''}</strong>
          <span>{cur ? cur.artist : ''}</span>
        </div>
        <div className="np-progress">
          <span>{formatTime(dragPos ?? position)}</span>
          <Slider value={position} max={duration} label="Posición" step={5} format={formatTime} onChange={setDragPos} onCommit={(v) => { setDragPos(null); p.seek(v); }} />
          <span>{duration ? formatTime(duration) : '–:––'}</span>
        </div>
        <div className="np-controls">
          <button type="button" className={`icon-btn toggle ${liked ? 'on' : ''}`} disabled={!cur || !cur.key} aria-pressed={liked} aria-label={liked ? 'Quitar de Favoritas' : 'Añadir a Favoritas'} onClick={() => useLibrary.getState().setLike(cur, !liked)}><Heart filled={liked} size={22} /></button>
          <button type="button" className={`icon-btn toggle ${shuffle ? 'on' : ''}`} aria-pressed={shuffle} aria-label="Aleatorio" onClick={p.toggleShuffle}><Shuffle size={22} /></button>
          <button type="button" className="icon-btn" aria-label="Anterior" onClick={p.prev} disabled={!cur}><Prev size={26} /></button>
          <button type="button" className="play-btn np-play" aria-label={want ? 'Pausa' : 'Reproducir'} onClick={p.toggle} disabled={!cur}>{want ? <Pause size={28} /> : <Play size={28} />}</button>
          <button type="button" className="icon-btn" aria-label="Siguiente" onClick={() => p.next()} disabled={!cur}><Next size={26} /></button>
          <button type="button" className={`icon-btn toggle ${repeat !== 'off' ? 'on' : ''}`} aria-label={`Repetir: ${repeat === 'off' ? 'no' : repeat === 'all' ? 'todo' : 'esta canción'}`} onClick={p.cycleRepeat}>{repeat === 'one' ? <RepeatOne size={22} /> : <Repeat size={22} />}</button>
          <button type="button" className={`icon-btn toggle ${prefs.video ? 'on' : ''}`} aria-pressed={prefs.video} aria-label="Videoclip" title="Videoclip (sin sonido, sigue a la canción)" onClick={() => change({ video: !prefs.video })}><Film size={22} /></button>
          <button type="button" className={`icon-btn toggle ${prefs.lyrics ? 'on' : ''}`} aria-pressed={prefs.lyrics} aria-label="Letra" title="Letra" onClick={() => change({ lyrics: !prefs.lyrics })}><Mic size={22} /></button>
          <button type="button" className="icon-btn" aria-label="Salir de Sonando" title="Salir (Esc)" onClick={close}><Collapse size={22} /></button>
        </div>
      </div>
    </div>
  );
}

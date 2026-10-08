// Ajustes → Personalizar: your colour, text size, density, corners, motion,
// the library's covers, which shelves Inicio shows, and the mini player.
// Every change shows at once.
import { useEffect, useState } from 'react';
import { desktop } from '../api.js';
import { ACCENTS, CORNERS, DENSITIES, FONTS, SECTIONS, SIDEBARS, SIZES, STARTS, useLook } from '../store/look.js';
import { CHOICES, PROFILES, usePerf } from '../store/perf.js';
import { useSound } from '../store/sound.js';
import { useUi } from '../store/ui.js';

const ON = (v) => (v ? 'sí' : 'no');

/** Rendimiento: the profile (or Automático) and what it switches. */
export function PerfSettings() {
  const choice = usePerf((s) => s.choice);
  const detected = usePerf((s) => s.detected);
  const profile = usePerf((s) => s.profile);
  const p = PROFILES[profile];
  return (
    <section className="set-group">
      <h2>Rendimiento</h2>
      <p className="muted">Ajusta cuánto trabaja Rumoria para que vaya fluida en cualquier ordenador, sin bajar la calidad del sonido.</p>
      <label className="set-row">
        <span><strong>Perfil</strong><small>{choice === 'auto' ? `Automático: este ordenador va con «${PROFILES[detected].label}».` : 'Elegido a mano.'}</small></span>
        <select value={choice} onChange={(e) => usePerf.getState().setChoice(e.target.value)} aria-label="Perfil de rendimiento">
          {CHOICES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </label>
      <p className="muted perf-what">
        Ahora: animaciones y desenfoques: {ON(p.motion)} · visualizador: {ON(profile !== 'min')} · canciones buscadas por adelantado: {p.prefetch} ·
        portadas: {p.coverSize === 'mq' ? 'pequeñas' : 'normales'} · Explorar leído por adelantado: {profile === 'min' ? 'no' : profile === 'mid' ? 'las destacadas' : 'todas'}.
      </p>
    </section>
  );
}

/** Reproducción: carry on where you left off, start playing on open, the tray. */
export function PlaybackSettings() {
  const resume = useSound((s) => s.resume);
  const autoplay = useSound((s) => s.autoplay);
  const [tray, setTray] = useState(null);
  useEffect(() => { if (desktop) desktop.settings().then((s) => setTray(Boolean(s && s.closeToTray)), () => {}); }, []);
  return (
    <section className="set-group">
      <h2>Reproducción</h2>
      <label className="set-row">
        <span><strong>Seguir donde lo dejaste</strong><small>Al abrir Rumoria vuelven la cola, la canción y el segundo en que estabas.</small></span>
        <input type="checkbox" className="switch" checked={resume} onChange={(e) => useSound.getState().set({ resume: e.target.checked })} />
      </label>
      {resume && (
        <label className="set-row">
          <span><strong>Empezar a sonar al abrir</strong><small>Si no, se queda en pausa hasta que le des a reproducir.</small></span>
          <input type="checkbox" className="switch" checked={autoplay} onChange={(e) => useSound.getState().set({ autoplay: e.target.checked })} />
        </label>
      )}
      {desktop && tray !== null && (
        <label className="set-row">
          <span><strong>Al cerrar, seguir sonando en la bandeja</strong><small>La ventana se oculta y la música sigue; desde el icono de la bandeja la manejas o sales.</small></span>
          <input type="checkbox" className="switch" checked={tray} onChange={async (e) => { const v = e.target.checked; setTray(v); await desktop.setCloseToTray(v); }} />
        </label>
      )}
      <p className="muted">Ecualizador, velocidad, fundido, karaoke, temporizador y salida de sonido: en el botón <strong>Sonido</strong> de la barra del reproductor.</p>
    </section>
  );
}

function Choice({ label, hint, value, options, onChange }) {
  return (
    <label className="set-row">
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => <option key={String(v)} value={String(v)}>{text}</option>)}
      </select>
    </label>
  );
}

export function Customize() {
  const look = useLook((s) => s.look);
  const set = useLook((s) => s.set);
  return (
    <section className="set-group">
      <h2>Personalizar</h2>
      <p className="muted">Cambia Rumoria a tu gusto. Se guarda en este ordenador y se ve al momento.</p>
      <div className="set-row set-row-wrap">
        <span><strong>Color</strong><small>Botones, barra de progreso y lo que suena. Cada uno se adapta al tema claro y al oscuro.</small></span>
        <div className="swatches" role="radiogroup" aria-label="Color">
          {ACCENTS.map(([k, name, hex]) => (
            <button key={k} type="button" role="radio" aria-checked={look.accent === k} aria-label={name} title={name}
              className={`swatch ${look.accent === k ? 'on' : ''}`} data-swatch={k} onClick={() => set({ accent: k })}>
              <span className="swatch-dot" style={{ background: hex }} />
            </button>
          ))}
        </div>
      </div>
      <Choice label="Tamaño del texto" hint="Toda la ventana, más grande o más pequeña." value={look.size} options={SIZES} onChange={(v) => set({ size: Number(v) })} />
      <Choice label="Densidad de las listas" hint="Cuánto espacio ocupa cada canción." value={look.density} options={DENSITIES} onChange={(v) => set({ density: v })} />
      <Choice label="Esquinas" value={look.corners} options={CORNERS} onChange={(v) => set({ corners: v })} />
      <Choice label="Tipo de letra" hint="De las que ya tiene Windows." value={look.font} options={FONTS} onChange={(v) => set({ font: v })} />
      <Choice label="Ancho de la biblioteca" value={look.sidebar} options={SIDEBARS} onChange={(v) => set({ sidebar: v })} />
      <Choice label="Al abrir Rumoria" value={look.start} options={STARTS} onChange={(v) => set({ start: v })} />
      <label className="set-row">
        <span><strong>Portada detrás del reproductor</strong><small>La barra de abajo toma los colores de lo que suena.</small></span>
        <input type="checkbox" className="switch" checked={look.playerCover} onChange={(e) => set({ playerCover: e.target.checked })} />
      </label>
      <label className="set-row">
        <span><strong>Menos animaciones</strong><small>Sin transiciones ni movimientos.</small></span>
        <input type="checkbox" className="switch" checked={look.motion === 'reduce'} onChange={(e) => set({ motion: e.target.checked ? 'reduce' : 'auto' })} />
      </label>
      <label className="set-row">
        <span><strong>Portadas en la biblioteca</strong><small>Apagado, cada lista ocupa una sola línea.</small></span>
        <input type="checkbox" className="switch" checked={look.sideCovers} onChange={(e) => set({ sideCovers: e.target.checked })} />
      </label>
      <div className="set-row set-row-wrap">
        <span><strong>Qué sale en Inicio</strong><small>Elige las estanterías que quieres ver.</small></span>
        <div className="chips chips-wrap">
          {SECTIONS.map(([k, name]) => {
            const on = !look.hidden.includes(k);
            return <button key={k} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => useLook.getState().toggleSection(k)}>{name}</button>;
          })}
        </div>
      </div>
      <div className="set-row">
        <span><strong>Volver a lo de siempre</strong><small>Color, tamaño y lo demás, como venían.</small></span>
        <button type="button" className="btn btn-ghost" onClick={() => { useLook.getState().reset(); useUi.getState().toast('Aspecto como venía'); }}>Restablecer</button>
      </div>
    </section>
  );
}

/** The mini player's settings (the same as in its own ⋯ menu). */
export function MiniSettings() {
  const [p, setP] = useState(null);
  useEffect(() => { if (desktop && desktop.mini) desktop.mini.prefs().then(setP, () => {}); }, []);
  if (!desktop || !desktop.mini || !p) return null;
  const set = async (patch) => { const next = await desktop.mini.setPrefs(patch); if (next) setP(next); };
  const sw = (k, label, hint) => (
    <label className="set-row" key={k}>
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" className="switch" checked={Boolean(p[k])} onChange={(e) => set({ [k]: e.target.checked })} />
    </label>
  );
  return (
    <section className="set-group">
      <h2>Mini reproductor</h2>
      <p className="muted">Una ventana pequeña encima de las demás con lo que suena (Ctrl+M o el botón junto al volumen). Si cierras la ventana grande con él abierto, la música sigue.</p>
      <div className="set-row"><span><strong>Abrirlo ahora</strong></span><button type="button" className="btn btn-ghost" onClick={() => desktop.mini.open()}>Abrir</button></div>
      {sw('compact', 'Compacto', 'Una sola línea, más pequeño.')}
      {sw('showCover', 'Portada')}
      {sw('onTop', 'Siempre encima', 'Por encima de las demás ventanas.')}
      {sw('locked', 'Fijo', 'No se mueve al arrastrarlo.')}
      {sw('hoverFull', 'Opaco al pasar el ratón')}
      <label className="set-row">
        <span><strong>Transparencia</strong><small>{Math.round(p.opacity * 100)} %</small></span>
        <input type="range" min="0.3" max="1" step="0.05" value={p.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} aria-label="Opacidad del mini reproductor" />
      </label>
    </section>
  );
}

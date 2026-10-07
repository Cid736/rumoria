// Ajustes → Personalizar: your colour, text size, density, corners, motion,
// the library's covers, which shelves Inicio shows, and the mini player.
// Every change shows at once.
import { useEffect, useState } from 'react';
import { desktop } from '../api.js';
import { ACCENTS, CORNERS, DENSITIES, SECTIONS, SIZES, useLook } from '../store/look.js';
import { useUi } from '../store/ui.js';

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

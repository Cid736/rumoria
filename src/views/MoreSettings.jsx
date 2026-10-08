// v1.5 settings: global shortcuts (from anywhere, also with Rumoria in the
// tray) and what you asked not to be recommended.
import { useEffect, useState } from 'react';
import { desktop } from '../api.js';
import { useHidden } from '../store/hidden.js';
import { useUi } from '../store/ui.js';

const LABELS = {
  toggle: 'Reproducir / pausa', next: 'Siguiente', prev: 'Anterior', like: 'Añadir o quitar de Favoritas',
  volUp: 'Subir volumen', volDown: 'Bajar volumen', mini: 'Mini reproductor', show: 'Mostrar u ocultar Rumoria',
};
const KEYS = { Space: 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete', Equal: 'Plus', Minus: 'Minus', NumpadAdd: 'Plus', NumpadSubtract: 'Minus' };

/** A key press → "Ctrl+Alt+P" (as Electron takes it), or null if it isn't a combination we accept. */
export function accelOf(e) {
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  const c = String(e.code || '');
  const key = /^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit[0-9]$/.test(c) ? c.slice(5) : /^F([1-9]|1[0-9]|2[0-4])$/.test(c) ? c : KEYS[c] || null;
  if (!key || !mods.some((m) => m !== 'Shift')) return null;
  return [...mods, key].join('+');
}
/** How a combination is shown. */
export const showAccel = (a) => (a ? a.split('+').map((k) => ({ Super: 'Win', Shift: 'Mayús', Left: '←', Right: '→', Up: '↑', Down: '↓', Space: 'Espacio', Plus: '+', Minus: '−' }[k] || k)).join(' + ') : '—');

function KeyCatcher({ value, onPick, failed }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return undefined;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setListening(false); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { setListening(false); onPick(''); return; }
      const a = accelOf(e);
      if (a) { setListening(false); onPick(a); }
    };
    // Before the page's own keys (Space would play).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, onPick]);
  return (
    <button type="button" className={`btn btn-ghost key-catch ${listening ? 'listening' : ''} ${failed ? 'failed' : ''}`} onClick={() => setListening(!listening)}
      title={failed ? 'Otra aplicación ya usa esta combinación' : 'Pulsa para cambiarla'} aria-label={listening ? 'Pulsa la combinación (Esc: cancelar, Retroceso: ninguna)' : `Cambiar: ${showAccel(value)}`}>
      {listening ? 'Pulsa la combinación…' : showAccel(value)}{failed && !listening ? ' ⚠' : ''}
    </button>
  );
}

export function ShortcutSettings() {
  const [s, setS] = useState(null);
  useEffect(() => { if (desktop && desktop.shortcuts) desktop.shortcuts.get().then(setS, () => {}); }, []);
  if (!desktop || !desktop.shortcuts || !s) return null;
  const set = async (patch) => {
    try {
      const next = await desktop.shortcuts.set(patch);
      if (next) { setS(next); if (next.failed.length) useUi.getState().toast(`${next.failed.length === 1 ? 'Un atajo no se pudo usar' : `${next.failed.length} atajos no se pudieron usar`}: otra aplicación ya los tiene.`); }
    } catch (err) { useUi.getState().toast(err.message); }
  };
  return (
    <section className="set-group">
      <h2>Atajos globales</h2>
      <p className="muted">Funcionan desde cualquier sitio, también con Rumoria minimizada o en la bandeja. Pulsa uno para cambiarlo (Esc cancela, Retroceso lo quita).</p>
      <label className="set-row">
        <span><strong>Usar atajos globales</strong><small>Apagado, solo funcionan dentro de la ventana.</small></span>
        <input type="checkbox" className="switch" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
      </label>
      {s.enabled && Object.keys(LABELS).map((a) => (
        <div key={a} className="set-row">
          <span><strong>{LABELS[a]}</strong>{s.failed.includes(a) && <small className="warn">Otra aplicación ya usa esta combinación: elige otra.</small>}</span>
          <KeyCatcher value={s.keys[a]} failed={s.failed.includes(a)} onPick={(k) => set({ keys: { [a]: k } })} />
        </div>
      ))}
      {s.enabled && (
        <div className="set-row">
          <span><strong>Volver a los de siempre</strong><small>Ctrl + Alt + P, ← → ↑ ↓, L y R; el mini reproductor, Ctrl + Alt + Mayús + M.</small></span>
          <button type="button" className="btn btn-ghost" onClick={() => set({ reset: true })}>Restablecer</button>
        </div>
      )}
    </section>
  );
}

export function HiddenSettings() {
  const { songs, artists } = useHidden();
  useEffect(() => { useHidden.getState().load(); }, []);
  const h = useHidden.getState();
  return (
    <section className="set-group">
      <h2>No me recomiendes</h2>
      <p className="muted">Canciones y artistas que no salen en las recomendaciones, las radios, «Para ti» ni las listas que se llenan solas. Puedes seguir buscándolos y poniéndolos tú. Se añaden desde el menú de cualquier canción (clic derecho → «No me recomiendes…»).</p>
      {!songs.length && !artists.length && <p className="muted">Nada por ahora.</p>}
      {artists.map((a) => (
        <div key={`a:${a.name}`} className="set-row">
          <span><strong>{a.name}</strong><small>Artista</small></span>
          <button type="button" className="btn btn-ghost" onClick={() => h.showArtist(a.name)}>Volver a recomendar</button>
        </div>
      ))}
      {songs.map((s) => (
        <div key={`s:${s.key}`} className="set-row">
          <span><strong>{s.title}</strong><small>{s.artist ? `Canción · ${s.artist}` : 'Canción'}</small></span>
          <button type="button" className="btn btn-ghost" onClick={() => h.showSong(s.key)}>Volver a recomendar</button>
        </div>
      ))}
    </section>
  );
}

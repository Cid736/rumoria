// v1.6: a short welcome guide, as in TubeGrab: five steps (choose the look,
// listening, your lists, what Rumoria makes for you, the controls). It opens
// on its own for someone new; "No volver a mostrarla" (on by default) or the
// switch in Ajustes stop it, and Ajustes can open it again any time.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { UIS, useLook } from '../store/look.js';
import { useUi } from '../store/ui.js';
import { Library, MiniPlayer, Search, Sparkle } from './Icons.jsx';

const KEY = 'rumoria_guide';
// Someone who already used Rumoria (before the guide existed) isn't new.
const USED_KEYS = ['rumoria_look', 'rumoria_recent', 'rumoria_session', 'rumoria_volume'];

/** Whether it opens by itself: what was chosen, else only for someone new. */
export function readGuide(store = localStorage) {
  try {
    const raw = JSON.parse(store.getItem(KEY));
    if (raw && typeof raw.show === 'boolean') return { show: raw.show };
  } catch { /* first time */ }
  let used = false;
  try { used = USED_KEYS.some((k) => store.getItem(k) !== null); } catch { /* no storage */ }
  return { show: !used };
}
function saveGuide(show) { try { localStorage.setItem(KEY, JSON.stringify({ show: Boolean(show) })); } catch { /* only for now */ } }

export const useGuide = create((set) => ({
  open: false,
  show: readGuide().show,
  openGuide() { set({ open: true }); },
  close(again) { saveGuide(again); set({ open: false, show: again }); },
  setShow(show) { saveGuide(show); set({ show }); },
}));

const THEMES = [['dark', 'Oscuro'], ['light', 'Claro'], ['system', 'Del sistema']];

const STEPS = [
  {
    icon: <Sparkle size={30} />, title: 'Bienvenido a Rumoria',
    text: 'Música de YouTube sin descargar nada: suena al momento. Primero, elige cómo quieres verla (se cambia cuando quieras en Ajustes → Personalizar).',
    look: true,
  },
  {
    icon: <Search size={30} />, title: 'Buscar y escuchar',
    text: 'Busca una canción o un artista en «Buscar», o pon cualquier lista de «Explorar» o una radio. También puedes arrastrar un enlace de YouTube a la ventana y suena al momento. Lo que buscas se guarda para repetirlo, y lo borras cuando quieras.',
  },
  {
    icon: <Library size={30} />, title: 'Tus listas',
    text: 'Con el botón del enlace, en «Tu biblioteca», traes listas de Spotify, Apple Music o YouTube. Con «+» creas una vacía o una que se llena sola con un estilo o un artista. Clic derecho en cualquier canción para añadirla a una lista o a Favoritas.',
  },
  {
    icon: <Sparkle size={30} />, title: 'Hecho para ti',
    text: 'Cuanto más escuchas, mejor te conoce: «Para hoy», «Descubre algo nuevo», mezclas del día y la carpeta «Para ti». Si algo no te gusta, clic derecho → «No me recomiendes…». Lo que escuchas está en «Historial», y solo en este ordenador.',
  },
  {
    icon: <MiniPlayer size={30} />, title: 'Controles a mano',
    text: 'El mini reproductor (Ctrl + M) se queda encima de todo. «Sonando» a pantalla completa con F11. Desde cualquier sitio: Ctrl + Alt + P para pausar y Ctrl + Alt + ← → para cambiar de canción (Ajustes → Atajos globales). En Ajustes también: sonido, rendimiento y seguir sonando en la bandeja.',
  },
];

function LookChoice() {
  const ui = useLook((s) => s.look.ui);
  const theme = useUi((s) => s.theme);
  return (
    <div className="guide-choices">
      <div role="radiogroup" aria-label="Estilo de la interfaz" className="chips">
        {UIS.map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={ui === k} className={`chip ${ui === k ? 'on' : ''}`} onClick={() => useLook.getState().set({ ui: k })}>{label}</button>)}
      </div>
      <div role="radiogroup" aria-label="Tema" className="chips">
        {THEMES.map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={theme === k} className={`chip ${theme === k ? 'on' : ''}`} onClick={() => useUi.getState().setTheme(k)}>{label}</button>)}
      </div>
    </div>
  );
}

export default function Guide() {
  const open = useGuide((s) => s.open);
  // Opens by itself once, at start, for whoever should see it.
  useEffect(() => { if (useGuide.getState().show) useGuide.getState().openGuide(); }, []);
  return open ? <GuideCard /> : null;
}

function GuideCard() {
  const [i, setI] = useState(0);
  const [again, setAgain] = useState(false);
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  const close = () => useGuide.getState().close(again);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'ArrowRight' && !last) setI(i + 1);
      if (e.key === 'ArrowLeft' && i > 0) setI(i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="dialog-backdrop guide-backdrop">
      <div className="dialog guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <div className="guide-icon" aria-hidden="true">{s.icon}</div>
        <h2 id="guide-title">{s.title}</h2>
        <p className="guide-text">{s.text}</p>
        {s.look && <LookChoice />}
        <div className="guide-dots" aria-label={`Paso ${i + 1} de ${STEPS.length}`}>
          {STEPS.map((x, n) => <span key={x.title} className={n === i ? 'on' : ''} />)}
        </div>
        <label className="guide-again">
          <input type="checkbox" checked={!again} onChange={(e) => setAgain(!e.target.checked)} /> No volver a mostrarla al abrir
        </label>
        <div className="dialog-actions">
          {!last && <button type="button" className="btn btn-ghost guide-skip" onClick={close}>Saltar</button>}
          {i > 0 && <button type="button" className="btn btn-ghost" onClick={() => setI(i - 1)}>Atrás</button>}
          <button type="button" className="btn btn-accent" autoFocus onClick={() => (last ? close() : setI(i + 1))}>{last ? 'Empezar' : 'Siguiente'}</button>
        </div>
      </div>
    </div>
  );
}

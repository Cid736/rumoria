// Your look: accent colour, text size, density, corners, motion, the library's
// covers and which shelves Inicio shows. Kept in this computer's browser
// storage (the app keeps the same address between runs) and applied at once.
import { create } from 'zustand';
import { ROTATIONS } from '../views/rotation.js';

const KEY = 'rumoria_look';

export const ACCENTS = [
  ['coral', 'Coral', '#ff7a59'], ['azul', 'Azul', '#6ea8ff'], ['verde', 'Verde', '#3ecf8e'], ['violeta', 'Violeta', '#b18cff'],
  ['rosa', 'Rosa', '#ff6fae'], ['ambar', 'Ámbar', '#ffbf3c'], ['turquesa', 'Turquesa', '#2ed3c9'], ['rojo', 'Rojo', '#ff6b6b'],
];
export const SIZES = [[0.9, 'Pequeño'], [1, 'Normal'], [1.1, 'Grande'], [1.25, 'Muy grande']];
export const DENSITIES = [['compact', 'Compacta'], ['normal', 'Normal'], ['comfy', 'Amplia']];
export const CORNERS = [['square', 'Rectas'], ['normal', 'Normales'], ['round', 'Muy redondeadas']];
// Inicio's shelves, in the order they appear.
export const SECTIONS = [
  ['tiles', 'Accesos rápidos'], ['made', 'Hecho para ti'], ['again', 'Lo que más vuelves a poner'], ['recent', 'Recientes'],
  ['radios', 'Radios para ti'], ['popular', 'Radios populares'], ['like', 'Si te gusta…'], ['explore', 'Explorar'],
  ['lists', 'Tus listas'], ['categories', 'Todas las categorías'],
];

// v1.3: the letters (only fonts already on Windows: nothing is downloaded), the
// library's width, the page Rumoria opens on, the cover behind the player bar.
export const FONTS = [['system', 'Del sistema'], ['trebuchet', 'Trebuchet'], ['serif', 'Clásica (Georgia)'], ['mono', 'Monoespaciada']];
export const SIDEBARS = [['narrow', 'Estrecha'], ['normal', 'Normal'], ['wide', 'Ancha']];
export const STARTS = [['home', 'Inicio'], ['last', 'Lo último que viste']];

export const DEFAULT_LOOK = { accent: 'coral', size: 1, density: 'normal', corners: 'normal', motion: 'auto', sideCovers: true, hidden: [], font: 'system', sidebar: 'normal', start: 'home', playerCover: true, rotate: '3h' };

/** Only known values: what's read back from storage can't set anything else. */
export function cleanLook(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const one = (v, list, d) => (list.some(([k]) => k === v) ? v : d);
  return {
    accent: one(r.accent, ACCENTS, DEFAULT_LOOK.accent),
    size: one(r.size, SIZES, DEFAULT_LOOK.size),
    density: one(r.density, DENSITIES, DEFAULT_LOOK.density),
    corners: one(r.corners, CORNERS, DEFAULT_LOOK.corners),
    motion: ['auto', 'reduce'].includes(r.motion) ? r.motion : DEFAULT_LOOK.motion,
    sideCovers: r.sideCovers !== false,
    hidden: Array.isArray(r.hidden) ? [...new Set(r.hidden.filter((k) => SECTIONS.some(([s]) => s === k)))] : [],
    font: one(r.font, FONTS, DEFAULT_LOOK.font),
    sidebar: one(r.sidebar, SIDEBARS, DEFAULT_LOOK.sidebar),
    start: one(r.start, STARTS, DEFAULT_LOOK.start),
    playerCover: r.playerCover !== false,
    rotate: one(r.rotate, ROTATIONS, DEFAULT_LOOK.rotate),
  };
}

function saved() { try { return cleanLook(JSON.parse(localStorage.getItem(KEY))); } catch { return { ...DEFAULT_LOOK }; } }

/** Puts a look on the page: attributes the stylesheets read, and the zoom. */
export function applyLook(look, doc = document, zoom = (f) => { if (window.rumoria && window.rumoria.look) window.rumoria.look.zoom(f); else doc.documentElement.style.zoom = String(f); }) {
  const d = doc.documentElement.dataset;
  if (look.accent === 'coral') delete d.accent; else d.accent = look.accent;
  d.density = look.density;
  d.corners = look.corners;
  d.motion = look.motion;
  d.sideCovers = look.sideCovers ? 'on' : 'off';
  d.font = look.font;
  d.sidebar = look.sidebar;
  d.playerCover = look.playerCover ? 'on' : 'off';
  try { zoom(look.size); } catch { /* not where it can zoom */ }
}

// ---- "Lo último que viste": the page you were on, opened again next time ----
const LAST_KEY = 'rumoria_lastview';
const VIEWS = ['home', 'search', 'list', 'liked', 'local', 'mix', 'browse', 'discover', 'today', 'news', 'summary', 'settings'];
/** Only plain views (a name and, for some, an id) are kept and read back. */
export function cleanView(v) {
  if (!v || typeof v !== 'object' || !VIEWS.includes(v.name)) return null;
  const id = typeof v.id === 'string' && /^[\w-]{1,40}$/.test(v.id) ? v.id : undefined;
  return id ? { name: v.name, id } : { name: v.name };
}
export function rememberView(v) { const c = cleanView(v); if (c) { try { localStorage.setItem(LAST_KEY, JSON.stringify(c)); } catch { /* only for now */ } } }
export function lastView() { try { return cleanView(JSON.parse(localStorage.getItem(LAST_KEY))); } catch { return null; } }

export const useLook = create((set, get) => ({
  look: saved(),
  set(patch) {
    const look = cleanLook({ ...get().look, ...patch });
    try { localStorage.setItem(KEY, JSON.stringify(look)); } catch { /* only for now */ }
    set({ look });
    applyLook(look);
  },
  toggleSection(key) {
    const hidden = new Set(get().look.hidden);
    if (hidden.has(key)) hidden.delete(key); else hidden.add(key);
    get().set({ hidden: [...hidden] });
  },
  reset() { get().set({ ...DEFAULT_LOOK }); },
}));

/** Shown on Inicio? */
export const useShows = () => {
  const hidden = useLook((s) => s.look.hidden);
  return (key) => !hidden.includes(key);
};

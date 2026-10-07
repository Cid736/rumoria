// Where you are (with back / forward), the side panel, toasts and menus.
import { create } from 'zustand';

const THEME_KEY = 'rumoria_theme';
const savedTheme = () => { try { return ['dark', 'light', 'system'].includes(localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : 'dark'; } catch { return 'dark'; } };

let toastId = 1;

// What you put on lately (lists, mixes, radios…), and how often: "Recientes"
// and "Lo que más vuelves a poner". Only on this computer.
const RECENT_KEY = 'rumoria_recent';
const KINDS = ['list', 'liked', 'local', 'mix', 'browse', 'radio', 'discover', 'news'];
const YT_IMG = /^https:\/\/i\d?\.ytimg\.com\//;
// A radio's song (what it starts with and what it's called): only those texts.
const cleanPayload = (p) => {
  if (!p || typeof p !== 'object') return null;
  const s = (v) => (typeof v === 'string' ? v.slice(0, 150) : '');
  return { title: s(p.title), artist: s(p.artist), name: s(p.name) || null, thumb: typeof p.thumb === 'string' && YT_IMG.test(p.thumb) ? p.thumb : null };
};
const cleanItem = (x) => (x && KINDS.includes(x.kind) && typeof x.name === 'string' && x.name ? {
  kind: x.kind, id: typeof x.id === 'string' ? x.id.slice(0, 80) : null, name: x.name.slice(0, 150), sub: typeof x.sub === 'string' ? x.sub.slice(0, 150) : '',
  thumbs: Array.isArray(x.thumbs) ? x.thumbs.filter((t) => typeof t === 'string' && /^https:\/\/i\d?\.ytimg\.com\//.test(t)).slice(0, 4) : [],
  payload: cleanPayload(x.payload),
  plays: Number.isInteger(x.plays) && x.plays > 0 ? x.plays : 1, at: Number.isFinite(x.at) ? x.at : Date.now(),
} : null);
const savedRecent = () => { try { return (JSON.parse(localStorage.getItem(RECENT_KEY)) || []).map(cleanItem).filter(Boolean).slice(0, 30); } catch { return []; } };
const sameItem = (a, b) => a.kind === b.kind && a.id === b.id;

export const useUi = create((set, get) => ({
  // A view: { name: 'home' | 'search' | 'list' | 'liked' | 'local' | 'mix' | 'browse' | 'radio' | 'discover' | 'news' | 'summary' | 'settings', id?, payload? }
  history: [{ name: 'home' }],
  at: 0,
  panel: null,          // null | 'queue' | 'lyrics'
  toasts: [],
  menu: null,           // { x, y, items: [{ label, onClick, danger?, sub? }] }
  dialog: null,         // { kind: 'prompt' | 'import', ... }
  theme: savedTheme(),
  searchText: '',
  recent: savedRecent(), // [{ kind, id, name, sub, thumbs, payload, plays, at }], newest first

  /** Something was put on: to the front of "Recientes", one more play. */
  addRecent(item) {
    const c = cleanItem(item);
    if (!c) return;
    const old = get().recent.find((x) => sameItem(x, c));
    const recent = [{ ...c, plays: old ? old.plays + 1 : 1, at: Date.now(), thumbs: c.thumbs.length ? c.thumbs : old ? old.thumbs : [] },
      ...get().recent.filter((x) => !sameItem(x, c))].slice(0, 30);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { /* only for now */ }
    set({ recent });
  },

  view: () => get().history[get().at],
  go(view) {
    const cur = get().view();
    if (cur && cur.name === view.name && cur.id === view.id) return;
    const history = [...get().history.slice(0, get().at + 1), view].slice(-50);
    set({ history, at: history.length - 1 });
  },
  back() { if (get().at > 0) set((s) => ({ at: s.at - 1 })); },
  forward() { if (get().at < get().history.length - 1) set((s) => ({ at: s.at + 1 })); },
  canBack: () => get().at > 0,
  canForward: () => get().at < get().history.length - 1,

  togglePanel(p) { set((s) => ({ panel: s.panel === p ? null : p })); },
  setSearchText(searchText) { set({ searchText }); },

  toast(text, { action, onAction, ms = 4500 } = {}) {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, action, onAction }] }));
    setTimeout(() => get().dismiss(id), ms);
  },
  dismiss(id) { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); },

  openMenu(x, y, items) { set({ menu: { x, y, items } }); },
  closeMenu() { set({ menu: null }); },
  openDialog(dialog) { set({ dialog: { ...dialog, seq: toastId++ } }); },
  closeDialog() { set({ dialog: null }); },

  setTheme(theme) {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* only for now */ }
    set({ theme });
  },
}));

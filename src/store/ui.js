// Where you are (with back / forward), the side panel, toasts and menus.
import { create } from 'zustand';

const THEME_KEY = 'clmusic_theme';
const savedTheme = () => { try { return ['dark', 'light', 'system'].includes(localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : 'dark'; } catch { return 'dark'; } };

let toastId = 1;

export const useUi = create((set, get) => ({
  // A view: { name: 'home' | 'search' | 'list' | 'liked' | 'local' | 'mix' | 'settings', id?, payload? }
  history: [{ name: 'home' }],
  at: 0,
  panel: null,          // null | 'queue' | 'lyrics'
  toasts: [],
  menu: null,           // { x, y, items: [{ label, onClick, danger?, sub? }] }
  dialog: null,         // { kind: 'prompt' | 'import', ... }
  theme: savedTheme(),
  searchText: '',

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

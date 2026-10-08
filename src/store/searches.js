// v1.6: what you searched for (Buscar), to search it again with one click.
// Kept only in this computer's browser storage, newest first, at most 30;
// each one can be removed, all of them at once, or none kept at all.
import { create } from 'zustand';

const KEY = 'rumoria_searches';
export const MAX_SEARCHES = 30;
const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** A search as kept: one line, trimmed, 2-200 characters. */
export function cleanQuery(q) {
  const s = String(q ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length >= 2 && s.length <= 200 ? s : null;
}
/** Only what this module writes is read back: strings, once each (ignoring case and accents). */
export function cleanSearches(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const items = [];
  for (const x of Array.isArray(r.items) ? r.items : []) {
    const q = cleanQuery(x);
    if (!q || seen.has(fold(q))) continue;
    seen.add(fold(q));
    items.push(q);
    if (items.length >= MAX_SEARCHES) break;
  }
  return { items, off: r.off === true };
}

function load() { try { return cleanSearches(JSON.parse(localStorage.getItem(KEY))); } catch { return cleanSearches(null); } }
function save(s) { try { localStorage.setItem(KEY, JSON.stringify({ items: s.items, off: s.off })); } catch { /* only for now */ } }

export const useSearches = create((set, get) => ({
  ...load(),
  /** A search done: to the top (once). Nothing if you chose not to keep them. */
  add(q) {
    const c = cleanQuery(q);
    if (!c || get().off) return;
    const items = [c, ...get().items.filter((x) => fold(x) !== fold(c))].slice(0, MAX_SEARCHES);
    if (items.join('\n') === get().items.join('\n')) return;
    set({ items });
    save(get());
  },
  remove(q) { set({ items: get().items.filter((x) => x !== q) }); save(get()); },
  /** All of them out; returns what was there (for "Deshacer"). */
  clear() { const was = get().items; set({ items: [] }); save(get()); return was; },
  restore(items) { set({ items: cleanSearches({ items }).items }); save(get()); },
  /** Don't keep searches (what's kept goes too). */
  setOff(off) { set({ off: Boolean(off), ...(off ? { items: [] } : {}) }); save(get()); },
}));

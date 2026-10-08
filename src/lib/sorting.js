// v1.5: a list in another order — title, artist, when it was added, the ones
// you play most, length — without changing the list itself. The order chosen
// for each list is remembered on this computer.
const KEY = 'rumoria_sorts';
const MAX_KEPT = 200;

export const SORTS = [['custom', 'Tu orden'], ['title', 'Título'], ['artist', 'Artista'], ['added', 'Añadida'], ['plays', 'Más escuchadas'], ['duration', 'Duración']];
const IDS = SORTS.map(([k]) => k);
const SORT_KEY_RE = /^[\w:-]{1,60}$/;

function readAll(store) {
  try {
    const raw = JSON.parse(store.getItem(KEY));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([k, v]) => SORT_KEY_RE.test(k) && IDS.includes(v)).slice(-MAX_KEPT));
  } catch { return {}; }
}
const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);

/** The order chosen for this page ('custom' if none). */
export function readSort(key, store = storage()) {
  if (!key || !store) return 'custom';
  return readAll(store)[key] || 'custom';
}
export function saveSort(key, sort, store = storage()) {
  if (!key || !store || !SORT_KEY_RE.test(key) || !IDS.includes(sort)) return;
  const all = readAll(store);
  delete all[key];
  if (sort !== 'custom') all[key] = sort;
  try { store.setItem(KEY, JSON.stringify(all)); } catch { /* only for now */ }
}

const text = (s) => String(s || '').trim();
const collator = typeof Intl !== 'undefined' ? new Intl.Collator('es', { sensitivity: 'base', numeric: true }) : null;
const cmpText = (a, b) => (collator ? collator.compare(a, b) : a.localeCompare(b));

/**
 * The songs in that order (a copy; each keeps its place `n` in the list, so
 * removing or the "now playing" mark still work). `counts`: { key: plays }.
 * Songs without what's compared go last; equals keep their order.
 */
export function sortTracks(tracks, sort, counts = {}) {
  if (!sort || sort === 'custom') return tracks;
  const rows = tracks.map((t, i) => ({ t, i }));
  const by = {
    title: (a, b) => cmpText(text(a.t.title), text(b.t.title)),
    artist: (a, b) => (!text(a.t.artist) - !text(b.t.artist)) || cmpText(text(a.t.artist), text(b.t.artist)) || cmpText(text(a.t.title), text(b.t.title)),
    added: (a, b) => (Number(b.t.at) || 0) - (Number(a.t.at) || 0),
    plays: (a, b) => ((counts[b.t.key] || 0) - (counts[a.t.key] || 0)),
    duration: (a, b) => (!a.t.duration - !b.t.duration) || ((a.t.duration || 0) - (b.t.duration || 0)),
  }[sort];
  if (!by) return tracks;
  return rows.sort((a, b) => by(a, b) || a.i - b.i).map((r) => r.t);
}

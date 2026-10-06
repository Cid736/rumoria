// The play queue as plain data, so its rules are easy to test:
//   { items: [song + uid], index, original: items before shuffling | null }
import { shuffled } from './tracks.js';

let nextUid = 1;
export const withUid = (t) => ({ ...t, uid: nextUid++ });

export const emptyQueue = () => ({ items: [], index: -1, original: null });

/** A new queue from `tracks`, starting at `start`; shuffled (the chosen one first) if asked. */
export function startQueue(tracks, start = 0, { shuffle = false, random } = {}) {
  const items = tracks.map(withUid);
  if (!items.length) return emptyQueue();
  const at = Math.max(0, Math.min(items.length - 1, start));
  if (!shuffle) return { items, index: at, original: null };
  const first = items[at];
  return { items: [first, ...shuffled(items.filter((_, i) => i !== at), random)], index: 0, original: items };
}

/** Shuffle on: what comes after the current song is shuffled. Off: back to the original order. */
export function setShuffle(q, on, random) {
  if (!q.items.length) return { ...q, original: on ? [] : null };
  const current = q.items[q.index];
  if (on) {
    if (q.original) return q;
    const rest = q.items.filter((_, i) => i !== q.index);
    return { items: [...q.items.slice(0, q.index), current, ...shuffled(rest.slice(q.index), random)], index: q.index, original: q.items };
  }
  if (!q.original) return q;
  // Songs added while shuffled are kept, at the end.
  const known = new Set(q.original.map((x) => x.uid));
  const items = [...q.original.filter((x) => q.items.some((y) => y.uid === x.uid)), ...q.items.filter((x) => !known.has(x.uid))];
  return { items, index: Math.max(0, items.findIndex((x) => x.uid === current.uid)), original: null };
}

/**
 * Where "next" goes: { index } or { end: true } when the queue is over.
 * `auto`: the song ended by itself (repeat "one" plays it again; a button press skips).
 */
export function nextIndex(q, repeat, auto = false) {
  if (!q.items.length) return { end: true };
  if (auto && repeat === 'one') return { index: q.index };
  if (q.index + 1 < q.items.length) return { index: q.index + 1 };
  if (repeat === 'all' || repeat === 'one') return { index: 0 };
  return { end: true };
}

/** "Previous": after 3 seconds, back to the start of this song; else the one before. */
export function prevIndex(q, position, repeat) {
  if (!q.items.length) return { index: -1 };
  if (position > 3 || q.index === 0 && repeat !== 'all') return { restart: true, index: q.index };
  return { index: q.index > 0 ? q.index - 1 : q.items.length - 1 };
}

/** "Play next" (right after the current one) or "add to queue" (at the end). */
export function insert(q, tracks, where) {
  const add = tracks.map(withUid);
  if (!q.items.length) return { items: add, index: add.length ? 0 : -1, original: null };
  const items = where === 'next' ? [...q.items.slice(0, q.index + 1), ...add, ...q.items.slice(q.index + 1)] : [...q.items, ...add];
  return { ...q, items, original: q.original ? [...q.original, ...add] : null };
}

export function removeAt(q, i) {
  if (i < 0 || i >= q.items.length || i === q.index) return q;
  const gone = q.items[i].uid;
  return {
    items: q.items.filter((_, k) => k !== i),
    index: i < q.index ? q.index - 1 : q.index,
    original: q.original ? q.original.filter((x) => x.uid !== gone) : null,
  };
}

/** A song of the queue replaced (once its YouTube video is found). */
export const replaceAt = (q, i, patch) => ({ ...q, items: q.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) });

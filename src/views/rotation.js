// Inicio's rotating shelves ("Explorar", "Radios populares", "Si te gusta"):
// a semi-random pick that leans on your taste. It stays the same for a while
// (so the page doesn't jump on every visit) and then changes; what was shown
// last time weighs less, so the next pick really is different. Your genres
// come from the server (worked out on this computer from what you play).
const KEY = 'rumoria_rotation';
const KINDS = ['explore', 'popular', 'like'];
const HOUR = 3600 * 1000;
// How often they change (Ajustes → Personalizar).
export const ROTATIONS = [['open', 'Cada vez que abres Rumoria'], ['3h', 'Cada 3 horas'], ['day', 'Cada día']];
export const SHOWN_BEFORE = 0.35; // weight left to what was shown last time
const LAUNCH = Math.floor(Math.random() * 2 ** 31);

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** A number from text (FNV-1a), to seed the picks. */
export function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** Random numbers in [0, 1) that are always the same for a seed (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Which stretch of time we are in: the same name means the same pick. */
export function slotOf(every, now = Date.now(), launch = LAUNCH) {
  if (every === 'day') return `day:${new Date(now).toDateString()}`;
  if (every === 'open') return `open:${launch}`;
  return `3h:${Math.floor(now / (3 * HOUR))}`;
}

const ids = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.length <= 120).slice(0, 40) : []);
function kinds(o) {
  const out = {};
  for (const k of KINDS) if (o && Array.isArray(o[k])) out[k] = ids(o[k]);
  return out;
}
/** Only what this module writes is read back from storage. */
export function cleanRotation(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    slot: typeof r.slot === 'string' && r.slot.length <= 80 ? r.slot : '',
    salt: Number.isInteger(r.salt) ? r.salt >>> 0 : 0,
    shown: kinds(r.shown),
    prev: kinds(r.prev),
    // "Otras" pressed on a shelf this time: how many times (its own new pick).
    turns: Object.fromEntries(KINDS.filter((k) => r.turns && Number.isInteger(r.turns[k]) && r.turns[k] > 0).map((k) => [k, Math.min(r.turns[k], 1e6)])),
  };
}

const newSalt = () => Math.floor(Math.random() * 2 ** 31);
function load(store) { try { return cleanRotation(JSON.parse(store.getItem(KEY))); } catch { return cleanRotation(null); } }
function save(store, s) { try { store.setItem(KEY, JSON.stringify(s)); } catch { /* only for now */ } }
const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);
const memory = { getItem: () => null, setItem: () => {} };

/** The rotation now: a new one (and what was shown, as "before") when its time is up. */
export function readRotation(every, now = Date.now(), store = storage() || memory) {
  const s = load(store);
  const slot = slotOf(every, now);
  if (s.slot === slot) return s;
  const next = { slot, salt: newSalt(), shown: {}, prev: { ...s.prev, ...s.shown }, turns: {} };
  save(store, next);
  return next;
}

/** Another pick for one shelf now ("Otras"), whatever the time. */
export function reshuffle(kind, every, now = Date.now(), store = storage() || memory) {
  const s = readRotation(every, now, store);
  if (!KINDS.includes(kind)) return s;
  const shown = { ...s.shown };
  const prev = { ...s.prev };
  if (shown[kind]) { prev[kind] = shown[kind]; delete shown[kind]; }
  const next = { ...s, shown, prev, turns: { ...s.turns, [kind]: (s.turns[kind] || 0) + 1 } };
  save(store, next);
  return next;
}

const samePick = (s, rot, kind) => s.slot === rot.slot && s.salt === rot.salt && (s.turns[kind] || 0) === ((rot.turns && rot.turns[kind]) || 0);

/** Notes what a shelf is showing for this pick (it weighs less next time). */
export function noteShown(kind, rot, list, store = storage() || memory) {
  if (!KINDS.includes(kind)) return;
  const s = load(store);
  if (!samePick(s, rot, kind)) return;
  const now = ids(list);
  if ((s.shown[kind] || []).join('\n') === now.join('\n')) return;
  save(store, { ...s, shown: { ...s.shown, [kind]: now } });
}

/**
 * What a shelf showed for this same pick, if it can still be shown — so the
 * shelf doesn't change while you look at it (when your genres or covers
 * update) — else the fresh pick. `byId`: id → item.
 */
export function settled(kind, rot, fresh, byId, store = storage() || memory) {
  const s = load(store);
  const was = samePick(s, rot, kind) ? s.shown[kind] : null;
  return was && was.length && was.every((id) => byId.has(id)) ? was.map((id) => byId.get(id)) : fresh;
}

/** How "Si te gusta" names an artist in what it notes. */
export const artistId = (a) => fold(a && a.name);

/**
 * `n` items, at random but each as likely as its weight (Efraimidis–Spirakis):
 * the heaviest tend to come first. The same seed gives the same pick.
 */
export function pick(items, weightOf, n, rand) {
  return items
    .map((it) => ({ it, k: rand() ** (1 / Math.max(1e-6, weightOf(it))) }))
    .sort((a, b) => b.k - a.k)
    .slice(0, Math.max(0, n))
    .map((x) => x.it);
}

/**
 * A pick where the items you like (`isYours`) get `seats` places for sure —
 * taking turns among them when there are more — and the other places are open
 * to everything. Shown one of yours, one of the rest, and so on.
 */
export function pickLeaning(items, weightOf, n, rand, isYours, seats) {
  const yours = pick(items.filter(isYours), weightOf, Math.min(seats, n), rand);
  const taken = new Set(yours);
  const rest = pick(items.filter((x) => !taken.has(x)), weightOf, n - yours.length, rand);
  const out = [];
  for (let i = 0; out.length < yours.length + rest.length; i++) { if (yours[i]) out.push(yours[i]); if (rest[i]) out.push(rest[i]); }
  return out;
}

const randFor = (rot, kind, turn = kind) => rng(hash(`${rot.salt}:${kind}:${(rot.turns && rot.turns[turn]) || 0}`));
/** Your genres → id → 0..1 (the most played genre is 1). */
export function tasteMap(taste) {
  const list = Array.isArray(taste) ? taste.filter((g) => g && typeof g.id === 'string' && Number.isFinite(g.score) && g.score > 0) : [];
  const top = Math.max(0, ...list.map((g) => g.score));
  return new Map(list.map((g) => [g.id, top ? g.score / top : 0]));
}

/** "Explorar": a third of it your genres (in turns), the rest any category, more likely the more you play it. */
export function exploreOf(browse, taste, rot, n = 12) {
  const t = tasteMap(taste);
  const before = new Set(rot.prev.explore || []);
  const all = (browse || []).filter((b) => (b.group || 'genre') === 'genre');
  const weight = (b) => (1 + (b.featured ? 1 : 0) + 6 * (t.get(b.id) || 0)) * (before.has(b.id) ? SHOWN_BEFORE : 1);
  return pickLeaning(all, weight, n, randFor(rot, 'explore'), (b) => t.has(b.id), Math.ceil(n / 3));
}

/** "Radios populares": half of it artists in your genres (or that you play), the rest any, those more likely too. */
export function popularOf(browse, taste, smart, rot, n = 10) {
  const t = tasteMap(taste);
  const before = new Set(rot.prev.popular || []);
  const mine = new Set(((smart && smart.artists) || []).map((a) => fold(a.name)).filter(Boolean));
  const all = (browse || []).filter((b) => b.group === 'radio');
  const near = (b) => Math.max(0, ...(b.tags || []).map((x) => t.get(x) || 0));
  const weight = (b) => (1 + (b.featured ? 0.5 : 0) + 4 * near(b) + (mine.has(fold(b.artist)) ? 2 : 0)) * (before.has(b.id) ? SHOWN_BEFORE : 1);
  return pickLeaning(all, weight, n, randFor(rot, 'popular'), (b) => near(b) > 0 || mine.has(fold(b.artist)), Math.ceil(n / 2));
}

/** "Si te gusta …": one of your artists (the more you play them, the likelier), with a song to start from. */
export function likeSeedOf(smart, rot) {
  const artists = ((smart && smart.artists) || []).filter((a) => a.seed && a.seed.yt).slice(0, 8);
  const before = new Set(rot.prev.like || []);
  return pick(artists, (a) => Math.max(1, Number(a.plays) || 1) * (before.has(artistId(a)) ? 0.3 : 1), 1, randFor(rot, 'like'))[0] || null;
}

/** Which of an artist's neighbours to show: the closest ones (first in the mix) more likely. */
export function similarOf(candidates, rot, n = 8) {
  const list = candidates || [];
  const at = new Map(list.map((c, i) => [c, i]));
  return pick(list, (c) => 1 / (1 + 0.2 * at.get(c)), n, randFor(rot, 'similar', 'like'));
}

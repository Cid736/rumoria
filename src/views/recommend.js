// Recommendations from what you listen to, all built from YouTube's own mixes
// of your songs; your history never leaves this computer.
//  - "Descubre algo nuevo" (weekly): songs like the ones you play most.
//  - "Para hoy" (v1.3): songs like the ones you've just been listening to,
//    worked out again when you listen to other things.
// v1.3, a better guess: a song that turns up in the mixes of several of your
// songs counts more (and nearer the top of a mix counts more); songs you
// skip are left out; artists you mostly skip go to the back; at most two
// songs per artist, so a list isn't one artist all over.
// v1.5: nothing you asked not to be recommended (songs or artists), not even as a seed.
import { api, urls } from '../api.js';
import { fromYouTube } from '../lib/tracks.js';
import { notHidden, useHidden } from '../store/hidden.js';

const DISCOVER_KEY = 'rumoria_discover';
const TODAY_KEY = 'rumoria_today';
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const PER_ARTIST = 2;
/**
 * Who a song is by, comparable: from its title when it says ("Queen - Radio
 * Ga Ga"), else its channel without "Official", "VEVO" or "- Topic" — YouTube
 * gives one artist many channels ("Queen", "Queen Official", "Live Aid").
 */
export function artistKey(t) {
  const m = /^(.{1,80}?)\s+[-–—]\s+/.exec(String((t && t.title) || ''));
  const raw = m ? m[1] : (t && t.artist) || '';
  return fold(raw).replace(/\s*-\s*topic$/, '').replace(/vevo$/, '').replace(/\b(official|oficial)\b/g, '').replace(/\s+/g, ' ').trim();
}

/** Up to `max` songs to start from: what you play most, then what you played lately, one per artist. */
export function seedsOf(smart, max = 4) {
  if (!smart) return [];
  const out = [];
  const artists = new Set();
  for (const r of [...(smart.top || []), ...(smart.lately || [])]) {
    if (!r.yt || artists.has(fold(r.artist)) || out.length >= max || useHidden.getState().hides(r)) continue;
    artists.add(fold(r.artist));
    out.push({ yt: r.yt, key: r.key, title: r.title, artist: r.artist, thumb: r.thumb || null, weight: Math.max(1, Number(r.plays) || 1) });
  }
  return out;
}

/** The songs you've just been listening to (newest first), one per artist. */
export function latestSeeds(smart, max = 6) {
  if (!smart) return [];
  const out = [];
  const artists = new Set();
  const lately = (smart.lately || []).slice().sort((a, b) => (b.last || 0) - (a.last || 0));
  for (const r of lately) {
    if (!r.yt || artists.has(fold(r.artist)) || out.length >= max || useHidden.getState().hides(r)) continue;
    artists.add(fold(r.artist));
    // The newest weighs most.
    out.push({ yt: r.yt, key: r.key, title: r.title, artist: r.artist, thumb: r.thumb || null, weight: max - out.length });
  }
  return out;
}

/** Every song your history knows (to recommend only new ones). */
export function heardKeys(smart) {
  const keys = new Set();
  if (!smart) return keys;
  for (const r of [...(smart.top || []), ...(smart.lately || []), ...(smart.forgotten || [])]) keys.add(r.key);
  for (const a of smart.artists || []) for (const s of a.songs || []) keys.add(s.key);
  return keys;
}

/** Songs like this one (YouTube's mix of it), without it. */
export async function radioOf(seed, { get = api.get } = {}) {
  const r = await get(urls.radio(seed.yt));
  return notHidden((r.entries || []).map(fromYouTube).filter((t) => t.yt && t.yt !== seed.yt));
}

/**
 * The best of several mixes: each song scores by its seed's weight, more
 * near the top of a mix, added up across mixes; songs to leave out (heard,
 * skipped) don't count; artists you skip go last; at most PER_ARTIST each.
 */
export function rank(radios, { exclude = new Set(), cold = [], max = 30 } = {}) {
  const coldSet = new Set(cold.map(fold));
  const by = new Map();
  let order = 0;
  for (const { weight = 1, tracks } of radios) {
    tracks.forEach((t, i) => {
      if (!t || !t.key || exclude.has(t.key)) return;
      const r = by.get(t.key) || { t, score: 0, first: order++ };
      r.score += weight * (1 - (i / Math.max(1, tracks.length)) * 0.5);
      by.set(t.key, r);
    });
  }
  const ranked = [...by.values()].map((r) => ({ ...r, score: coldSet.has(artistKey(r.t)) || coldSet.has(fold(r.t.artist)) ? r.score * 0.25 : r.score }))
    .sort((a, b) => b.score - a.score || a.first - b.first);
  const per = new Map();
  const out = [];
  for (const { t } of ranked) {
    const a = artistKey(t);
    if (a && (per.get(a) || 0) >= PER_ARTIST) continue;
    if (a) per.set(a, (per.get(a) || 0) + 1);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

async function mixesOf(seeds, get) {
  const radios = [];
  for (const s of seeds) { try { radios.push({ weight: s.weight || 1, tracks: await radioOf(s, { get }) }); } catch { radios.push({ weight: 0, tracks: [] }); } }
  return radios;
}

/** Monday of this week, as a key (the list changes once a week). */
export function weekOf(d = new Date()) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return m.toDateString();
}

/** "Descubre algo nuevo": like the songs you play most, none you've heard or skipped, at most 30. The same all week. */
export async function discoverOf(smart, { get = api.get, storage = globalThis.localStorage, now = new Date() } = {}) {
  const week = weekOf(now);
  try {
    const cached = JSON.parse(storage.getItem(DISCOVER_KEY));
    if (cached && cached.week === week && Array.isArray(cached.tracks) && cached.tracks.length) return notHidden(cached.tracks);
  } catch { /* build it */ }
  const exclude = new Set([...heardKeys(smart), ...((smart && smart.skipped) || [])]);
  const out = rank(await mixesOf(seedsOf(smart, 5), get), { exclude, cold: (smart && smart.cold) || [], max: 30 });
  if (out.length) { try { storage.setItem(DISCOVER_KEY, JSON.stringify({ week, tracks: out })); } catch { /* only for now */ } }
  return notHidden(out);
}

/** What "Para hoy" is built from: today's date and the songs you've just listened to. */
export function todaySignature(smart, now = new Date()) {
  return `${now.toDateString()}|${latestSeeds(smart, 6).map((s) => s.yt).join(',')}`;
}

/**
 * "Para hoy": like the songs you've just been listening to, mostly ones you
 * haven't heard (and none you skip), at most 25. Worked out again when you
 * listen to other things (at most every two hours) and every day.
 */
export async function dailyOf(smart, { get = api.get, storage = globalThis.localStorage, now = new Date() } = {}) {
  const sig = todaySignature(smart, now);
  const day = now.toDateString();
  try {
    const c = JSON.parse(storage.getItem(TODAY_KEY));
    const fresh = c && c.day === day && Array.isArray(c.tracks) && c.tracks.length && (c.sig === sig || now.getTime() - c.at < 2 * 3600_000);
    if (fresh) return notHidden(c.tracks);
  } catch { /* build it */ }
  const seeds = latestSeeds(smart, 6);
  if (!seeds.length) return [];
  const exclude = new Set([...(smart.skipped || []), ...seeds.map((s) => s.key)]);
  const heard = heardKeys(smart);
  const ranked = rank(await mixesOf(seeds, get), { exclude, cold: smart.cold || [], max: 60 });
  // Mostly new; a few you know, for company.
  const fresh = ranked.filter((t) => !heard.has(t.key));
  const known = ranked.filter((t) => heard.has(t.key)).slice(0, 5);
  const out = [...fresh.slice(0, 25 - Math.min(5, known.length)), ...known].slice(0, 25);
  if (out.length) { try { storage.setItem(TODAY_KEY, JSON.stringify({ day, sig, at: now.getTime(), tracks: out })); } catch { /* only for now */ } }
  return notHidden(out);
}

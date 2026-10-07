// Recommendations from what you listen to: "Porque escuchaste «…»" (similar
// songs to one you play a lot) and "Descubre algo nuevo" (a weekly list of
// similar songs you haven't heard yet). All built from YouTube's own mixes of
// your songs; your history never leaves this computer.
import { api, urls } from '../api.js';
import { fromYouTube } from '../lib/tracks.js';

const DISCOVER_KEY = 'rumoria_discover';
const fold = (s) => String(s || '').toLowerCase().trim();

/** Up to `max` songs to start from: what you play most, then what you played lately, one per artist. */
export function seedsOf(smart, max = 4) {
  if (!smart) return [];
  const out = [];
  const artists = new Set();
  for (const r of [...(smart.top || []), ...(smart.lately || [])]) {
    if (!r.yt || artists.has(fold(r.artist)) || out.length >= max) continue;
    artists.add(fold(r.artist));
    out.push({ yt: r.yt, key: r.key, title: r.title, artist: r.artist, thumb: r.thumb || null });
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
  return (r.entries || []).map(fromYouTube).filter((t) => t.yt && t.yt !== seed.yt);
}

/** Monday of this week, as a key (the list changes once a week). */
export function weekOf(d = new Date()) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return m.toDateString();
}

/**
 * "Descubre algo nuevo": the mixes of your top songs, taken in turns, without
 * anything you've heard, at most 30. The same all week.
 */
export async function discoverOf(smart, { get = api.get, storage = globalThis.localStorage, now = new Date() } = {}) {
  const week = weekOf(now);
  try {
    const cached = JSON.parse(storage.getItem(DISCOVER_KEY));
    if (cached && cached.week === week && Array.isArray(cached.tracks) && cached.tracks.length) return cached.tracks;
  } catch { /* build it */ }
  const seeds = seedsOf(smart, 5);
  const heard = heardKeys(smart);
  const radios = [];
  for (const s of seeds) { try { radios.push(await radioOf(s, { get })); } catch { radios.push([]); } }
  const out = [];
  const seen = new Set();
  for (let i = 0; out.length < 30 && radios.some((r) => i < r.length); i++) {
    for (const r of radios) {
      const t = r[i];
      if (t && !heard.has(t.key) && !seen.has(t.key) && out.length < 30) { seen.add(t.key); out.push(t); }
    }
  }
  if (out.length) { try { storage.setItem(DISCOVER_KEY, JSON.stringify({ week, tracks: out })); } catch { /* only for now */ } }
  return out;
}

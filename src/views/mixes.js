// "Made for you": lists built from what you listen to. A daily mix mixes
// YouTube's similar songs with yours by that artist, and stays the same all day.
import { api, urls } from '../api.js';
import { fromSaved, fromYouTube, mixOf, shuffled } from '../lib/tracks.js';

const CACHE_KEY = 'clmusic_mixes';

export const SMART = {
  top: { name: 'Lo más escuchado', sub: 'Lo que más suena estos tres meses' },
  lately: { name: 'Escuchado hace poco', sub: 'Lo último que has puesto' },
  forgotten: { name: 'Para redescubrir', sub: 'Te gustaban y hace tiempo que no suenan' },
};

const localMap = (local) => new Map((local.songs || []).map((f) => [f.key, f]));

/** A smart list (top, lately, forgotten) → its songs. */
export function smartTracks(kind, smart, local) {
  const rows = (smart && smart[kind]) || [];
  const map = localMap(local);
  return rows.map((r) => fromSaved(r, map)).filter(Boolean);
}

/** Your top artists → one mix each (up to three). */
export function mixCards(smart) {
  return ((smart && smart.artists) || []).filter((a) => a.seed && a.seed.yt).slice(0, 3).map((a, i) => ({ id: `mix${i}`, name: `Mix diario ${i + 1}`, sub: a.name, artist: a, thumb: a.seed.thumb || null }));
}

export async function buildMix(artist, local, { storage = globalThis.localStorage, get = api.get } = {}) {
  const today = new Date().toDateString();
  let cache;
  try { cache = JSON.parse(storage.getItem(CACHE_KEY)) || {}; } catch { cache = {}; }
  if (cache.day !== today) cache = { day: today };
  const seed = artist.seed.yt;
  let radio = Array.isArray(cache[seed]) ? cache[seed] : null;
  if (!radio) {
    try { radio = ((await get(urls.radio(seed))).entries || []).map(fromYouTube).filter((x) => /^[\w-]{11}$/.test(x.yt)); } catch { radio = []; }
    if (radio.length) { cache[seed] = radio.slice(0, 40); try { storage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* only for now */ } }
  }
  const map = localMap(local);
  return mixOf(radio, shuffled(artist.songs.map((r) => fromSaved(r, map)).filter(Boolean)));
}

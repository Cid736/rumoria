// v1.7, "Modo sesión": the queue put in an order that flows — rising little
// by little, winding down, a wave, or each song close to the one before
// (tempo and energy) so a ballad doesn't jump into reggaeton. Each song is
// listened to here, without asking anyone: the first two minutes or so of its
// audio (through the app's own relay, as when it plays) are decoded and
// measured — tempo from the beats' regularity, energy from loudness and how
// busy it is. What's measured is kept on this computer, so a song is measured
// once. A song that can't be measured gets a guess from its title.
import { api, urls } from '../api.js';

const KEY = 'rumoria_dj';
const MAX_KEPT = 1500;
const RATE = 11025;              // decoded at a low rate: enough for beats and loudness
const BYTES = 1_600_000;         // about 100 s of YouTube's 128 kbps audio
const FRAME = 512;
export const MODES = [
  ['smooth', 'Sin saltos', 'Cada canción parecida a la anterior en ritmo y energía'],
  ['rise', 'Subiendo', 'De tranquila a movida, para calentar'],
  ['fall', 'Bajando', 'De movida a tranquila, para relajarse'],
  ['wave', 'En ola', 'Sube hasta la mitad y vuelve a bajar'],
];

// ---- measuring ----
/** Tempo (beats per minute, folded into 70–180) from an onset curve sampled `fps` times a second. */
export function tempoOf(onsets, fps) {
  const n = onsets.length;
  if (n < fps * 6) return null;
  const mean = onsets.reduce((a, b) => a + b, 0) / n;
  const x = onsets.map((v) => v - mean);
  let best = null;
  for (let bpm = 60; bpm <= 200; bpm += 1) {
    const lag = (60 * fps) / bpm;
    const l0 = Math.floor(lag);
    const f = lag - l0;
    let sum = 0;
    for (let i = 0; i + l0 + 1 < n; i++) sum += x[i] * (x[i + l0] * (1 - f) + x[i + l0 + 1] * f);
    // A gentle preference for the tempos songs usually have (around 120).
    const score = (sum / (n - l0)) * Math.exp(-((Math.log2(bpm / 120)) ** 2) / 1.5);
    if (!best || score > best.score) best = { bpm, score };
  }
  if (!best || best.score <= 0) return null;
  let bpm = best.bpm;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm);
}

/**
 * Samples (mono, `rate` per second) → { bpm, energy (0–1), loud (dBFS) }.
 * The intro is skipped when there's enough after it.
 */
export function measure(samples, rate) {
  const skip = samples.length > rate * 45 ? Math.floor(rate * 15) : 0;
  const frames = Math.floor((samples.length - skip) / FRAME);
  if (frames < 20) return null;
  const power = new Float64Array(frames);
  let total = 0;
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const at = skip + f * FRAME;
    for (let i = 0; i < FRAME; i++) { const v = samples[at + i]; s += v * v; }
    power[f] = s / FRAME;
    total += power[f];
  }
  const meanPower = total / frames;
  if (meanPower < 1e-7) return null; // silence
  const loud = 10 * Math.log10(meanPower);
  // Onsets: how much louder each frame is than the one before (log scale), only rises.
  const onsets = [];
  let flux = 0;
  for (let f = 1; f < frames; f++) {
    const d = Math.max(0, Math.log10(power[f] + 1e-9) - Math.log10(power[f - 1] + 1e-9));
    onsets.push(d);
    flux += d;
  }
  const busy = flux / onsets.length;
  const bpm = tempoOf(onsets, rate / FRAME);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const energy = clamp(0.5 * clamp((loud + 28) / 20) + 0.3 * clamp(busy / 0.25) + 0.2 * clamp(((bpm || 110) - 70) / 110));
  return { bpm, energy: Math.round(energy * 1000) / 1000, loud: Math.round(loud * 10) / 10 };
}

/** A guess from the title and artist, for a song that couldn't be listened to. */
export function guess(t) {
  const s = `${t.title || ''} ${t.artist || ''}`.toLowerCase();
  let e = 0.55;
  if (/(acoustic|ac[uú]stic|piano|ballad|balada|lofi|lo-fi|sleep|dormir|relax|chill|unplugged|lullaby|nana|ambient)/.test(s)) e = 0.25;
  else if (/(remix|edm|techno|house|reggaet|dembow|trap|drill|phonk|hardstyle|metal|punk|workout|gym|party|fiesta|dance)/.test(s)) e = 0.8;
  return { bpm: null, energy: e, guessed: true };
}

// ---- kept on this computer ----
const keyOf = (t) => (t.yt ? `yt:${t.yt}` : t.localId ? `f:${t.localId}` : null);
function readKept(store) {
  try {
    const o = JSON.parse(store.getItem(KEY));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}
const okFeature = (f) => f && Number.isFinite(f.energy) && f.energy >= 0 && f.energy <= 1 && (f.bpm === null || (Number.isFinite(f.bpm) && f.bpm >= 50 && f.bpm <= 220));
export function keptFeature(t, store = globalThis.localStorage) {
  const k = keyOf(t);
  if (!k || !store) return null;
  const f = readKept(store)[k];
  return okFeature(f) ? { bpm: f.bpm, energy: f.energy } : null;
}
function keep(t, f, store = globalThis.localStorage) {
  const k = keyOf(t);
  if (!k || !store || !okFeature(f)) return;
  const all = readKept(store);
  delete all[k];
  all[k] = { bpm: f.bpm, energy: f.energy };
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_KEPT))) delete all[old];
  try { store.setItem(KEY, JSON.stringify(all)); } catch { /* only for now */ }
}

/** Listens to one song (its first minutes) → { bpm, energy } (a guess when it can't). */
export async function analyze(t, { get = api.get, fetchImpl = (...a) => fetch(...a), Ctx = globalThis.OfflineAudioContext, store = globalThis.localStorage } = {}) {
  const kept = keptFeature(t, store);
  if (kept) return kept;
  try {
    let yt = t.yt;
    if (!yt && !t.localId && t.query) yt = (await get(urls.find(t.query, t.duration, t.list, t.n))).id;
    const src = t.localId ? urls.local(t.localId) : yt ? urls.audio(yt) : null;
    if (!src || !Ctx) return guess(t);
    const res = await fetchImpl(src, { headers: { Range: `bytes=0-${BYTES - 1}` }, credentials: 'same-origin' });
    if (!res.ok) return guess(t);
    const buf = await res.arrayBuffer();
    const ctx = new Ctx(1, RATE, RATE);
    const audio = await ctx.decodeAudioData(buf);
    const f = measure(audio.getChannelData(0), audio.sampleRate);
    if (!f) return guess(t);
    keep(t, f, store);
    return { bpm: f.bpm, energy: f.energy };
  } catch { return guess(t); }
}

// ---- the order ----
/** How far apart two songs feel: tempo (half and double count as close) and energy. */
export function distance(a, b) {
  const e = Math.abs(a.energy - b.energy);
  if (!a.bpm || !b.bpm) return e * 2;
  const ratio = Math.min(...[a.bpm / b.bpm, (2 * a.bpm) / b.bpm, a.bpm / (2 * b.bpm)].map((r) => Math.abs(Math.log2(r))));
  return e * 2 + ratio * 3;
}

/**
 * Songs ({ uid, f: { bpm, energy } }) → their uids in the order of `mode`.
 * `from`: the song playing now (where "smooth" starts from).
 */
export function orderFor(songs, mode, from = null) {
  const by = (s) => s.f.energy + (s.f.bpm ? (s.f.bpm - 120) / 2000 : 0);
  const up = [...songs].sort((a, b) => by(a) - by(b));
  if (mode === 'rise') return up.map((s) => s.uid);
  if (mode === 'fall') return up.reverse().map((s) => s.uid);
  if (mode === 'wave') {
    // Every other one going up, the rest coming down.
    const climb = up.filter((_, i) => i % 2 === 0);
    const down = up.filter((_, i) => i % 2 === 1).reverse();
    return [...climb, ...down].map((s) => s.uid);
  }
  // "smooth": always the closest one left to the last one.
  const left = [...songs];
  const out = [];
  let last = from;
  if (!last) { last = up[Math.floor(up.length / 2)] ? up[Math.floor(up.length / 2)].f : null; }
  while (left.length) {
    let k = 0;
    if (last) { let best = Infinity; left.forEach((s, i) => { const d = distance(last, s.f); if (d < best) { best = d; k = i; } }); }
    const [s] = left.splice(k, 1);
    out.push(s.uid);
    last = s.f;
  }
  return out;
}

/**
 * Listens to the next `max` songs (about 4 s each, mostly finding them on YouTube) (two at a time; `onProgress(done, total)`),
 * then gives their new order. `stopped()` → true to give up.
 */
export async function planSession(items, current, mode, { max = 30, onProgress = () => {}, stopped = () => false, analyzeImpl = analyze } = {}) {
  const todo = items.slice(0, max);
  const songs = [];
  let done = 0;
  let next = 0;
  async function worker() {
    while (next < todo.length && !stopped()) {
      const t = todo[next++];
      const f = await analyzeImpl(t);
      songs.push({ uid: t.uid, f, guessed: Boolean(f.guessed) });
      onProgress(++done, todo.length);
    }
  }
  await Promise.all([worker(), worker()]);
  if (stopped()) return null;
  const from = current ? await analyzeImpl(current) : null;
  return { uids: orderFor(songs, mode, from), guessed: songs.filter((s) => s.guessed).length, total: songs.length };
}

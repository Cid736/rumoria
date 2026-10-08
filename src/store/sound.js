// How it sounds and how the player behaves — TubeGrab's player options, back:
// a 5-band equalizer with presets (and your own), the same volume for every
// song, speed (keeping the voice's pitch or not), karaoke, fades between
// songs, where it sounds, pausing when headphones are unplugged, a sleep
// timer, and carrying on where you left off. Kept in this computer's browser
// storage; the sleep timer is never kept.
import { create } from 'zustand';

const KEY = 'rumoria_sound';
export const BANDS = [60, 230, 910, 3600, 14000];
export const PRESETS = {
  flat: ['Plano', [0, 0, 0, 0, 0]], bass: ['Más graves', [6, 4, 0, -1, -1]], vocal: ['Voz', [-2, -1, 3, 4, 1]], rock: ['Rock', [4, 2, -1, 2, 4]],
  pop: ['Pop', [-1, 2, 4, 2, -1]], classical: ['Clásica', [3, 1, -1, 1, 3]], electronic: ['Electrónica', [5, 3, 0, 2, 4]], night: ['Noche (suave)', [-4, -1, 1, 1, -2]],
};
export const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const FADES = [0, 2, 4, 6, 10];
export const SLEEPS = [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hora'], [90, '1 h 30'], ['end', 'Al acabar esta canción']];

export const DEFAULT_SOUND = {
  preset: 'flat', gains: [0, 0, 0, 0, 0], mine: [], level: false, speed: 1, pitch: true, karaoke: false, fade: 0,
  sinkId: '', unplugPause: true, visualizer: true, resume: true, autoplay: false,
};

const okGains = (g) => Array.isArray(g) && g.length === BANDS.length && g.every((x) => Number.isFinite(x) && x >= -12 && x <= 12);
/** Only known values (what's read back from storage can't set anything else). */
export function cleanSound(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const mine = (Array.isArray(r.mine) ? r.mine : []).filter((p) => p && typeof p.name === 'string' && p.name.trim() && okGains(p.gains))
    .slice(0, 20).map((p) => ({ name: p.name.trim().slice(0, 40), gains: p.gains.map(Number) }));
  const preset = Object.hasOwn(PRESETS, r.preset) || r.preset === 'custom' || (typeof r.preset === 'string' && mine.some((p) => `mine:${p.name}` === r.preset)) ? r.preset : 'flat';
  return {
    preset, gains: okGains(r.gains) ? r.gains.map(Number) : [0, 0, 0, 0, 0], mine,
    level: r.level === true, speed: SPEEDS.includes(r.speed) ? r.speed : 1, pitch: r.pitch !== false, karaoke: r.karaoke === true,
    fade: FADES.includes(r.fade) ? r.fade : 0, sinkId: typeof r.sinkId === 'string' && r.sinkId.length <= 200 ? r.sinkId : '',
    unplugPause: r.unplugPause !== false, visualizer: r.visualizer !== false, resume: r.resume !== false, autoplay: r.autoplay === true,
  };
}

function saved() { try { return cleanSound(JSON.parse(localStorage.getItem(KEY))); } catch { return { ...DEFAULT_SOUND }; } }

export const useSound = create((set, get) => ({
  ...saved(),
  sleep: null, // { until: ms } | { end: true } — this run only

  set(patch) {
    const next = cleanSound({ ...get(), ...patch });
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* only for now */ }
    set(next);
  },
  /** A preset (or one of yours): its bands. */
  applyPreset(key) {
    if (Object.hasOwn(PRESETS, key)) { get().set({ preset: key, gains: PRESETS[key][1].slice() }); return; }
    const m = get().mine.find((p) => `mine:${p.name}` === key);
    if (m) get().set({ preset: key, gains: m.gains.slice() });
  },
  setBand(i, db) {
    const gains = get().gains.slice();
    gains[i] = Math.max(-12, Math.min(12, Math.round(Number(db) * 2) / 2));
    get().set({ gains, preset: 'custom' });
  },
  saveMine(name) {
    const n = String(name || '').trim().slice(0, 40);
    if (!n) return;
    const mine = [...get().mine.filter((p) => p.name !== n), { name: n, gains: get().gains.slice() }].slice(-20);
    get().set({ mine, preset: `mine:${n}` });
  },
  deleteMine(name) { get().set({ mine: get().mine.filter((p) => p.name !== name), preset: get().preset === `mine:${name}` ? 'custom' : get().preset }); },
  /** Minutes from now, or "end" (when this song ends), or null (off). */
  setSleep(v, now = Date.now()) {
    if (v === null) set({ sleep: null });
    else if (v === 'end') set({ sleep: { end: true } });
    else if (Number.isFinite(v) && v > 0 && v <= 600) set({ sleep: { until: now + v * 60_000 } });
  },
}));

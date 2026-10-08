// Performance profiles: Mínimo, Medio, Alto (or Automático, from this PC's
// processor cores and memory). Each one switches heavy things on or off:
// animations and blur, the visualizer, looking up the next songs ahead, cover
// sizes, how often lists are checked, and (on the server) how much of
// Explorar is read ahead.
import { create } from 'zustand';
import { api } from '../api.js';

const KEY = 'rumoria_perf';
export const CHOICES = [['auto', 'Automático'], ['min', 'Recursos mínimos'], ['mid', 'Recursos medios'], ['high', 'Recursos altos']];

/** What each profile allows. */
export const PROFILES = {
  min: { label: 'Mínimo', motion: false, blur: false, visualizer: false, prefetch: 0, coverSize: 'mq', listsEveryMs: 5 * 60_000, browseEveryMs: 10 * 60_000 },
  mid: { label: 'Medio', motion: true, blur: true, visualizer: false, prefetch: 1, coverSize: 'hq', listsEveryMs: 60_000, browseEveryMs: 2 * 60_000 },
  high: { label: 'Alto', motion: true, blur: true, visualizer: true, prefetch: 2, coverSize: 'hq', listsEveryMs: 60_000, browseEveryMs: 2 * 60_000 },
};

/**
 * Automático: modest PCs (2 cores or fewer, or under 6 GB) get Mínimo,
 * strong ones (8 cores or more and 12 GB or more) Alto, the rest Medio.
 */
export function detect({ cores, memGB } = {}) {
  const c = Number(cores) || 4;
  const m = Number(memGB) || 8;
  if (c <= 2 || m < 6) return 'min';
  if (c >= 8 && m >= 12) return 'high';
  return 'mid';
}

const cleanChoice = (v) => (CHOICES.some(([k]) => k === v) ? v : 'auto');
const savedChoice = () => { try { return cleanChoice(localStorage.getItem(KEY)); } catch { return 'auto'; } };
const browserGuess = () => detect({
  cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
  // Chromium rounds this and caps it at 8 GB; the desktop app tells the real figure.
  memGB: typeof navigator !== 'undefined' && navigator.deviceMemory ? navigator.deviceMemory : undefined,
});

export const usePerf = create((set, get) => ({
  choice: savedChoice(),
  detected: browserGuess(),
  profile: 'mid',
  /** The profile in use: the one chosen, or the one detected. */
  effective() { const { choice, detected } = get(); return choice === 'auto' ? detected : choice; },
  settings() { return PROFILES[get().effective()]; },
  setChoice(choice) {
    const c = cleanChoice(choice);
    try { localStorage.setItem(KEY, c); } catch { /* only for now */ }
    set({ choice: c });
    get().apply();
  },
  /** The desktop app's real figures (cores, total memory). */
  setHardware({ cores, memGB }) { set({ detected: detect({ cores, memGB }) }); get().apply(); },
  /** On the page (data-perf for the stylesheets) and on the server (how much it reads ahead). */
  apply(doc = typeof document !== 'undefined' ? document : null, send = (perf) => api.patch('/api/prefs', { perf }).catch(() => {})) {
    const p = get().effective();
    set({ profile: p });
    if (doc) doc.documentElement.dataset.perf = p;
    send(p);
  },
}));

/** A cover at the size the profile wants (YouTube's smaller one on Mínimo). */
export function coverAt(url, size = PROFILES[usePerf.getState().profile]?.coverSize || 'hq') {
  if (typeof url !== 'string' || size !== 'mq') return url;
  return url.replace(/\/(hq|sd|maxres)default\.jpg/, '/mqdefault.jpg');
}

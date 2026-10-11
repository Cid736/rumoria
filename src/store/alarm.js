// v1.7, the alarm clock: a list or radio starts at a time, on the days you
// choose, with the volume rising little by little — the sleep timer's other
// half. Rumoria has to be open (the window, the mini player or the tray); a
// computer asleep can't be woken by it. Kept in this computer's browser storage.
import { create } from 'zustand';

const KEY = 'rumoria_alarm';
export const RAMPS = [[0, 'De golpe'], [1, '1 minuto'], [3, '3 minutos'], [5, '5 minutos'], [10, '10 minutos'], [15, '15 minutos']];
export const SOURCES = [['today', 'Para hoy'], ['liked', 'Favoritas'], ['top', 'Lo más escuchado'], ['discover', 'Descubre algo nuevo'], ['list', 'Una de tus listas'], ['resume', 'Lo que estaba sonando']];
export const DAY_NAMES = ['L', 'M', 'X', 'J', 'V', 'S', 'D']; // Monday first
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const LIST_RE = /^[a-f0-9]{16}$/;

export const DEFAULT_ALARM = { on: false, time: '07:30', days: [0, 1, 2, 3, 4], source: 'today', list: null, ramp: 5, volume: 0.6, last: null };

/** Only known values (what's read back from storage can't set anything else). */
export function cleanAlarm(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const days = Array.isArray(r.days) ? [...new Set(r.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : DEFAULT_ALARM.days;
  return {
    on: r.on === true,
    time: TIME_RE.test(String(r.time)) ? r.time : DEFAULT_ALARM.time,
    days,
    source: SOURCES.some(([k]) => k === r.source) ? r.source : DEFAULT_ALARM.source,
    list: LIST_RE.test(String(r.list || '')) ? r.list : null,
    ramp: RAMPS.some(([m]) => m === r.ramp) ? r.ramp : DEFAULT_ALARM.ramp,
    volume: Number.isFinite(r.volume) && r.volume >= 0.05 && r.volume <= 1 ? Math.round(r.volume * 100) / 100 : DEFAULT_ALARM.volume,
    // The day it last rang ("2026-10-11"), so it rings once.
    last: typeof r.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.last) ? r.last : null,
  };
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mondayFirst = (d) => (d.getDay() + 6) % 7;

/** Should it ring now? On, one of its days, its minute passed less than 10 minutes ago, not rung today yet. */
export function isDue(a, now = new Date()) {
  if (!a.on || !a.days.includes(mondayFirst(now)) || a.last === dayKey(now)) return false;
  const [h, m] = a.time.split(':').map(Number);
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
  return now.getTime() >= at && now.getTime() - at < 10 * 60_000;
}

/** The next time it will ring (a Date), or null when it's off or has no days. */
export function nextRing(a, now = new Date()) {
  if (!a.on || !a.days.length) return null;
  const [h, m] = a.time.split(':').map(Number);
  for (let k = 0; k < 8; k++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, h, m);
    if (a.days.includes(mondayFirst(d)) && d.getTime() > now.getTime() && !(k === 0 && a.last === dayKey(now))) return d;
  }
  return null;
}

function saved() { try { return cleanAlarm(JSON.parse(localStorage.getItem(KEY))); } catch { return { ...DEFAULT_ALARM }; } }

export const useAlarm = create((set, get) => ({
  ...saved(),
  set(patch) {
    const next = cleanAlarm({ ...get(), ...patch });
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* only for now */ }
    set(next);
  },
  /** It rang today. */
  rang(now = new Date()) { get().set({ last: dayKey(now) }); },
}));

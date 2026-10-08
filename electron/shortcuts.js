// Global shortcuts: play / pause, next, previous, favourite, volume, the mini
// player and showing Rumoria, from anywhere — also with Rumoria hidden in the
// tray. Yours to change or switch off (Ajustes → Atajos de teclado). Each
// combination is checked (it must have Ctrl, Alt or Win, so typing elsewhere
// is never taken), and one another app already uses is reported, not forced.
const ACTIONS = ['toggle', 'next', 'prev', 'like', 'volUp', 'volDown', 'mini', 'show'];
const DEFAULT_KEYS = {
  toggle: 'Ctrl+Alt+P', next: 'Ctrl+Alt+Right', prev: 'Ctrl+Alt+Left', like: 'Ctrl+Alt+L',
  volUp: 'Ctrl+Alt+Up', volDown: 'Ctrl+Alt+Down', mini: 'Ctrl+Alt+Shift+M', show: 'Ctrl+Alt+R',
};
const MODS = ['Ctrl', 'Alt', 'Shift', 'Super'];
const KEY_RE = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Left|Right|Up|Down|Home|End|PageUp|PageDown|Insert|Delete|Plus|Minus)$/;

/** "Ctrl+Alt+P" as Electron takes it, or '' if it isn't one we accept. */
function cleanAccel(raw) {
  if (typeof raw !== 'string' || raw.length > 40) return '';
  const parts = raw.split('+');
  const key = parts.pop();
  if (!KEY_RE.test(key || '')) return '';
  const mods = [...new Set(parts)];
  if (mods.length !== parts.length || !mods.every((m) => MODS.includes(m))) return '';
  // Shift alone would take ordinary typing (Shift+A is "A").
  if (!mods.some((m) => m !== 'Shift')) return '';
  return [...MODS.filter((m) => mods.includes(m)), key].join('+');
}

/** The saved settings, each checked: on/off and one combination (or none) per action, never one twice. */
function cleanShortcuts(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const keys = {};
  const used = new Set();
  for (const a of ACTIONS) {
    const want = r.keys && Object.prototype.hasOwnProperty.call(r.keys, a) ? cleanAccel(r.keys[a]) : DEFAULT_KEYS[a];
    keys[a] = want && !used.has(want) ? want : '';
    if (keys[a]) used.add(keys[a]);
  }
  return { enabled: r.enabled !== false, keys };
}

/**
 * `globalShortcut`: Electron's; `read()` / `save(patch)`: the settings file;
 * `run(action)`: what each does.
 */
function createShortcuts({ globalShortcut, read, save, run }) {
  let failed = [];
  const current = () => cleanShortcuts(read().shortcuts);

  function apply() {
    globalShortcut.unregisterAll();
    failed = [];
    const s = current();
    if (!s.enabled) return state();
    for (const a of ACTIONS) {
      const k = s.keys[a];
      if (!k) continue;
      let ok;
      try { ok = globalShortcut.register(k, () => run(a)); } catch { ok = false; }
      if (!ok) failed.push(a);
    }
    return state();
  }

  function state() { return { ...current(), failed: failed.slice(), defaults: { ...DEFAULT_KEYS } }; }

  /** A change from Ajustes: { enabled?, keys?: { action: accel | '' }, reset? }. */
  function set(patch) {
    const p = patch && typeof patch === 'object' ? patch : {};
    const before = current();
    const next = {
      enabled: typeof p.enabled === 'boolean' ? p.enabled : before.enabled,
      keys: p.reset === true ? { ...DEFAULT_KEYS } : { ...before.keys },
    };
    if (p.reset !== true && p.keys && typeof p.keys === 'object') {
      for (const a of ACTIONS) {
        if (!Object.prototype.hasOwnProperty.call(p.keys, a)) continue;
        const k = p.keys[a] === '' ? '' : cleanAccel(p.keys[a]);
        if (p.keys[a] !== '' && !k) continue;
        // Taken by another action here: that one lets it go.
        if (k) for (const b of ACTIONS) if (b !== a && next.keys[b] === k) next.keys[b] = '';
        next.keys[a] = k;
      }
    }
    try { save({ shortcuts: cleanShortcuts(next) }); } catch { /* not fatal */ }
    return apply();
  }

  return { apply, set, state, stop: () => globalShortcut.unregisterAll() };
}

module.exports = { createShortcuts, cleanShortcuts, cleanAccel, ACTIONS, DEFAULT_KEYS };

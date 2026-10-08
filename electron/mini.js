// The mini player: a small window over the others (like TubeGrab's), with the
// song, its cover, play/pause, next, previous, favourite and a progress bar
// you can click. The music keeps playing in the main window (hidden or not);
// this one only shows it and sends the buttons back. Moved by dragging it
// anywhere but its buttons; opens where it was left. Its look and behaviour
// (compact, see-through, always on top, fixed in place, cover) are yours to
// choose, from the mini player itself or from Ajustes.
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// v2: a bit larger, and with the video clip (16:9 on top) taller still.
// v3 (Rumoria 1.5): "Tarjeta", upright with a big cover (or the clip) on top.
const SIZES = { normal: { width: 380, height: 164 }, compact: { width: 320, height: 64 }, video: { width: 380, height: 378 }, card: { width: 300, height: 470 } };
const DEFAULTS = { compact: false, opacity: 1, hoverFull: true, onTop: true, locked: false, showCover: true, video: false, lyrics: true, card: false };
const BOOLS = ['compact', 'hoverFull', 'onTop', 'locked', 'showCover', 'video', 'lyrics', 'card'];
const COMMANDS = ['toggle', 'next', 'prev', 'like', 'seek', 'volume', 'shuffle', 'repeat', 'mute', 'jump'];
const SNAP = 24; // let go this near a screen's edge: it sticks to it

/** The mini player's settings, each checked (they drive window calls). */
function cleanPrefs(raw) {
  const out = { ...DEFAULTS };
  if (raw && Number.isFinite(raw.opacity)) out.opacity = Math.min(1, Math.max(0.3, Math.round(raw.opacity * 20) / 20));
  for (const k of BOOLS) if (raw && typeof raw[k] === 'boolean') out[k] = raw[k];
  return out;
}

const text = (v, n) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);
/** What the page says is playing, as the mini window may show it. */
function cleanState(s) {
  if (!s || typeof s !== 'object') return null;
  // Covers only from YouTube's image hosts (your own files have none).
  const cover = typeof s.cover === 'string' && /^https:\/\/i\d?\.ytimg\.com\/[\w\-/.]{1,200}(\?[\w\-=&%.]{0,300})?$/.test(s.cover) ? s.cover : null;
  const num = (v, max) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(0, Number(v))) : 0);
  return {
    title: text(s.title, 300), artist: text(s.artist, 200), cover,
    playing: s.playing === true, loading: s.loading === true, time: num(s.time, 86400), duration: num(s.duration, 86400),
    liked: s.liked === true, canLike: s.canLike === true, volume: num(s.volume, 1), shuffle: s.shuffle === true,
    repeat: ['off', 'all', 'one'].includes(s.repeat) ? s.repeat : 'off', hasNext: s.hasNext === true,
    // v2: the video's id (its clip comes from this app's own relay), the lyric
    // line now and the next one, and the next song's title.
    yt: /^[A-Za-z0-9_-]{11}$/.test(String(s.yt || '')) ? s.yt : null,
    line: text(s.line, 300), nextLine: text(s.nextLine, 300), upNext: text(s.upNext, 200),
    // v3: muted, and the next five songs (their place in the queue, to jump there).
    muted: s.muted === true,
    queue: (Array.isArray(s.queue) ? s.queue : []).slice(0, 5).filter((q) => q && Number.isInteger(q.i) && q.i >= 0 && q.i <= 100000)
      .map((q) => ({ i: q.i, title: text(q.title, 200), artist: text(q.artist, 120) })),
  };
}

/** A command from the mini window's buttons, checked before the page gets it. */
function cleanCommand(cmd, value) {
  if (!COMMANDS.includes(cmd)) return null;
  if (cmd === 'seek') return Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 86400 ? { cmd, value: Number(value) } : null;
  if (cmd === 'volume') return Number.isFinite(Number(value)) ? { cmd, value: Math.min(1, Math.max(0, Number(value))) } : null;
  if (cmd === 'jump') return Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 100000 ? { cmd, value: Number(value) } : null;
  return { cmd };
}

/**
 * `origin()`: the app's origin; `main()`: the main window; settings read/save;
 * `onClosed()`: the mini window went away.
 */
function createMini({ origin, main, readSettings, saveSettings, icon, onClosed, onState = () => {} }) {
  let win = null;
  let hovered = false;
  let last = null; // what's playing, for a window that opens now
  let saveTimer = null;
  const prefs = () => cleanPrefs(readSettings().miniPrefs);
  const sizeOf = (p) => SIZES[p.compact ? 'compact' : p.card ? 'card' : p.video ? 'video' : 'normal'];
  const size = () => sizeOf(prefs());
  const alive = () => win && !win.isDestroyed();
  const fromMini = (event) => alive() && event.sender === win.webContents && String(event.senderFrame && event.senderFrame.url).startsWith(`${origin()}/mini.html`);
  const fromMain = (event) => { const m = main(); return m && !m.isDestroyed() && event.sender === m.webContents && String(event.senderFrame && event.senderFrame.url).startsWith(`${origin()}/`); };

  function position() {
    const saved = readSettings().miniPos;
    const s = size();
    if (saved && Number.isInteger(saved.x) && Number.isInteger(saved.y)) {
      // Only if it's still on a screen (a monitor may have been unplugged).
      const fits = screen.getAllDisplays().some(({ workArea: w }) => saved.x >= w.x - 40 && saved.y >= w.y - 10 && saved.x + 80 <= w.x + w.width && saved.y + 40 <= w.y + w.height);
      if (fits) return saved;
    }
    const { workArea: w } = screen.getPrimaryDisplay();
    return { x: w.x + w.width - s.width - 20, y: w.y + w.height - s.height - 20 };
  }
  function savePosSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (alive()) { const [x, y] = win.getPosition(); try { saveSettings({ miniPos: { x, y } }); } catch { /* not fatal */ } } }, 400);
  }
  /** See-through, on top, size: what the settings say, now. */
  function apply() {
    if (!alive()) return;
    const p = prefs();
    win.setOpacity(p.hoverFull && hovered ? 1 : p.opacity);
    win.setAlwaysOnTop(p.onTop, p.onTop ? 'floating' : 'normal');
    win.webContents.send('mini:prefs', p);
  }
  function setPrefs(patch) {
    const before = prefs();
    const next = cleanPrefs({ ...before, ...(patch && typeof patch === 'object' ? patch : {}) });
    try { saveSettings({ miniPrefs: next }); } catch { /* not fatal */ }
    // Compact, normal or with the clip: another size, growing or shrinking
    // from its bottom-right corner, always inside its screen.
    const a = sizeOf(before);
    const s = sizeOf(next);
    if (alive() && (s.height !== a.height || s.width !== a.width)) {
      const [x, y] = win.getPosition();
      const { workArea: w } = screen.getDisplayMatching({ x, y, width: s.width, height: s.height });
      const nx = Math.max(w.x, Math.min(x + a.width - s.width, w.x + w.width - s.width));
      const ny = Math.max(w.y, Math.min(y + a.height - s.height, w.y + w.height - s.height));
      win.setBounds({ x: nx, y: ny, ...s });
    }
    apply();
    return next;
  }

  function open() {
    if (alive()) { win.show(); win.focus(); return; }
    win = new BrowserWindow({
      ...size(), ...position(),
      frame: false, resizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: false,
      title: 'Rumoria', icon, backgroundColor: '#14121c', show: false,
      webPreferences: { preload: path.join(__dirname, 'mini-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
    });
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('will-attach-webview', (e) => e.preventDefault());
    win.webContents.on('did-finish-load', () => { apply(); if (last) win.webContents.send('mini:state', last); });
    win.once('ready-to-show', () => win.show());
    win.on('moved', savePosSoon);
    win.on('closed', () => { win = null; hovered = false; onClosed(); });
    win.loadURL(`${origin()}/mini.html`);
    apply();
  }

  // The main page: open it; what's playing (forwarded, checked).
  ipcMain.on('rumoria:mini:open', (event) => { if (fromMain(event)) open(); });
  ipcMain.on('rumoria:player:state', (event, s) => {
    if (!fromMain(event)) return;
    const clean = cleanState(s);
    if (!clean) return;
    last = clean;
    if (alive()) win.webContents.send('mini:state', clean);
    onState(clean);
  });
  ipcMain.handle('rumoria:mini:prefs', (event) => (fromMain(event) || fromMini(event) ? prefs() : null));
  ipcMain.handle('rumoria:mini:setPrefs', (event, patch) => (fromMain(event) || fromMini(event) ? setPrefs(patch) : null));
  // The mini window: its buttons (to the main page), moving it, hovering, closing it, the main window.
  ipcMain.on('mini:command', (event, cmd, value) => {
    if (!fromMini(event)) return;
    const c = cleanCommand(cmd, value);
    const m = main();
    if (c && m && !m.isDestroyed()) m.webContents.send('rumoria:player:command', c);
  });
  ipcMain.on('mini:move', (event, dx, dy) => {
    if (!fromMini(event) || prefs().locked) return;
    const x = Math.round(Number(dx));
    const y = Math.round(Number(dy));
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 4000 || Math.abs(y) > 4000) return;
    const [px, py] = win.getPosition();
    win.setPosition(px + x, py + y);
    savePosSoon();
  });
  // Let go near a screen's edge: it sticks to it.
  ipcMain.on('mini:dragEnd', (event) => {
    if (!fromMini(event) || prefs().locked) return;
    const b = win.getBounds();
    const { workArea: w } = screen.getDisplayMatching(b);
    let { x, y } = b;
    if (Math.abs(x - w.x) <= SNAP) x = w.x;
    if (Math.abs(w.x + w.width - (x + b.width)) <= SNAP) x = w.x + w.width - b.width;
    if (Math.abs(y - w.y) <= SNAP) y = w.y;
    if (Math.abs(w.y + w.height - (y + b.height)) <= SNAP) y = w.y + w.height - b.height;
    if (x !== b.x || y !== b.y) { win.setPosition(x, y); savePosSoon(); }
  });
  ipcMain.on('mini:hover', (event, on) => { if (fromMini(event)) { hovered = on === true; apply(); } });
  ipcMain.on('mini:close', (event) => { if (fromMini(event)) win.close(); });
  ipcMain.on('mini:showMain', (event) => {
    if (!fromMini(event)) return;
    const m = main();
    if (m && !m.isDestroyed()) { m.show(); if (m.isMinimized()) m.restore(); m.focus(); }
  });

  return { open, isOpen: alive, close: () => { if (alive()) win.close(); }, now: () => last };
}

module.exports = { createMini, cleanPrefs, cleanState, cleanCommand, SIZES };

// The Android app's side of the page: one channel (RumoriaAndroid, open only
// to this page) to tell the phone what's playing (its notification and lock
// screen), the theme's colour (the status bar), and to hear back the
// notification's buttons and the back button. Absent everywhere else.
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';

export const android = typeof window !== 'undefined' && window.RumoriaAndroid ? window.RumoriaAndroid : null;

// A phone: the Android app, or (to try the layout in a browser) ?phone in the address.
export const isPhone = Boolean(android) || (typeof location !== 'undefined' && /[?&]phone\b/.test(location.search));

const send = (m) => { try { android.postMessage(JSON.stringify(m)); } catch { /* the app is closing */ } };

/** Ask the app for something: 'update' (look for a new Rumoria) or 'ytdlp' (a new yt-dlp). */
export function askApp(t) { if (android) send({ t }); }

/** Back: whatever is open closes first, then the page before; with nothing left, the app goes to the background. */
export function goBack() {
  const ui = useUi.getState();
  if (ui.menu) { ui.closeMenu(); return true; }
  if (ui.dialog) { ui.closeDialog(); return true; }
  if (ui.panel) { ui.togglePanel(ui.panel); return true; }
  if (ui.nowPlaying) { ui.setNowPlaying(false); return true; }
  if (ui.at > 0) { ui.back(); return true; }
  // On another tab's first page: back to Inicio, and from there out.
  if (ui.view().name !== 'home') { ui.goTab({ name: 'home' }); return true; }
  return false;
}

function onNative(e) {
  let m;
  try { m = JSON.parse(e.data); } catch { return; }
  const p = usePlayer.getState();
  if (m.t === 'back') { if (!goBack()) send({ t: 'exit' }); return; }
  if (m.t !== 'cmd') return;
  if (m.a === 'play') { if (!p.wantPlaying) p.toggle(); }
  else if (m.a === 'pause') { if (p.wantPlaying) p.toggle(); }
  else if (m.a === 'next') p.next();
  else if (m.a === 'prev') p.prev();
  else if (m.a === 'seek' && Number.isFinite(m.pos)) p.seek(m.pos);
}

/** Starts the channel; returns a function that stops it. */
export function startAndroid() {
  if (!android) return () => {};
  android.onmessage = onNative;
  let last = '';
  let lastAt = 0;
  const report = (force) => {
    const s = usePlayer.getState();
    const cur = s.queue.items[s.queue.index] || null;
    const state = {
      t: 'state',
      title: cur ? cur.title || '' : '',
      artist: cur ? cur.artist || '' : '',
      art: cur && typeof cur.thumbnail === 'string' ? cur.thumbnail : '',
      playing: Boolean(cur && s.wantPlaying),
      pos: Math.round((s.position || 0) * 10) / 10,
      dur: s.duration || (cur && cur.duration) || 0,
    };
    // The phone moves the position on by itself: told again on a change, or every 15 s.
    const key = `${state.title}|${state.artist}|${state.art}|${state.playing}|${Math.round(state.dur)}`;
    if (!force && key === last && Date.now() - lastAt < 15_000) return;
    last = key;
    lastAt = Date.now();
    send(state);
  };
  let pos = 0;
  const offPlayer = usePlayer.subscribe((s) => {
    // A jump in position (a seek) is told at once.
    const jumped = Math.abs((s.position || 0) - pos) > 3;
    pos = s.position || 0;
    report(jumped);
  });
  // The page's background, for the status bar and the navigation bar.
  const theme = () => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    send({ t: 'theme', dark: document.documentElement.dataset.theme !== 'light', bg: /^#[0-9a-f]{6}$/i.test(bg) ? bg : '' });
  };
  const watch = new MutationObserver(theme);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  theme();
  report(true);
  return () => { offPlayer(); watch.disconnect(); android.onmessage = null; };
}

/** Where your things are kept, in words: "este móvil" or "este ordenador". */
export const HERE = isPhone ? 'este móvil' : 'este ordenador';

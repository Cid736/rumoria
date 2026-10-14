// The layout: library on the left, the page in the middle, queue or lyrics
// on the right (when open), and the player along the bottom.
import { useEffect } from 'react';
import { desktop } from './api.js';
import { startMiniBridge } from './player/miniBridge.js';
import { startAlarm } from './player/alarm.js';
import { applyLook, lastView, rememberView, useLook } from './store/look.js';
import { PROFILES, usePerf } from './store/perf.js';
import { useHidden } from './store/hidden.js';
import { useLibrary } from './store/library.js';
import { usePlayer } from './store/player.js';
import { useUi } from './store/ui.js';
import DropLink from './components/DropLink.jsx';
import Guide from './components/Guide.jsx';
import NowPlaying from './components/NowPlaying.jsx';
import Overlays from './components/Overlays.jsx';
import PlayerBar from './components/PlayerBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import TitleBar from './components/TitleBar.jsx';
import SidePanel from './components/SidePanel.jsx';
import TopBar from './components/TopBar.jsx';
import YouTubeNotice from './components/YouTubeNotice.jsx';
import { MiniBar, PhonePlayer, TabBar } from './components/Phone.jsx';
import { isPhone, startAndroid } from './lib/android.js';
import { startSyncWatch } from './lib/syncWatch.js';
import Home, { tracksOf } from './views/Home.jsx';
import { LikedPage, ListPage, LocalPage, MixPage, NewsPage, RulePage } from './views/Pages.jsx';
import Search from './views/Search.jsx';
import Settings from './views/Settings.jsx';
import Summary from './views/Summary.jsx';
import History from './views/History.jsx';
import Stats from './views/Stats.jsx';
import { OnThisDayPage } from './views/OnThisDay.jsx';
import { BrowsePage, DiscoverPage, RadioPage, TodayPage } from './views/Discover.jsx';

function Page({ view }) {
  switch (view.name) {
    case 'search': return <Search />;
    case 'list': return <ListPage id={view.id} />;
    case 'rules': return <RulePage id={view.id} />;
    case 'liked': return <LikedPage />;
    case 'local': return <LocalPage />;
    case 'mix': return <MixPage id={view.id} />;
    case 'settings': return <Settings />;
    case 'summary': return <Summary />;
    case 'history': return <History />;
    case 'stats': return <Stats />;
    case 'onthisday': return <OnThisDayPage id={view.id} />;
    case 'browse': return <BrowsePage id={view.id} />;
    case 'radio': return <RadioPage id={view.id} payload={view.payload} />;
    case 'discover': return <DiscoverPage />;
    case 'today': return <TodayPage />;
    // The phone's Biblioteca tab: your lists (on a computer they're always on the left).
    case 'library': return <div className="phone-library"><h1>Tu biblioteca</h1><Sidebar /></div>;
    case 'news': return <NewsPage />;
    default: return <Home />;
  }
}

/** What the alarm clock puts on. */
export function alarmTracks(a) {
  if (a.source === 'list') return a.list ? tracksOf({ kind: 'list', id: a.list }) : [];
  if (a.source === 'top') return tracksOf({ kind: 'mix', id: 'top' });
  return tracksOf({ kind: a.source });
}

const typing = (e) => e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');

/** Keys for the player and for moving around (not while typing). */
export function onKey(e) {
  const p = usePlayer.getState();
  const ui = useUi.getState();
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); ui.back(); return; }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); ui.forward(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); ui.go({ name: 'search' }); return; }
  // "Sonando" a pantalla completa.
  if (e.key === 'F11' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f')) { e.preventDefault(); ui.setNowPlaying(!ui.nowPlaying); return; }
  if (typing(e)) return;
  if (e.key === ' ' && !e.target.closest('button, [role="slider"]')) { e.preventDefault(); p.toggle(); return; }
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  const actions = {
    arrowright: () => p.next(), arrowleft: () => p.prev(),
    arrowup: () => p.setVolume(p.volume + 0.1), arrowdown: () => p.setVolume(p.volume - 0.1),
    s: () => p.toggleShuffle(), r: () => p.cycleRepeat(),
    m: () => { if (desktop && desktop.mini) desktop.mini.open(); },
  };
  if (actions[k]) { e.preventDefault(); actions[k](); }
}

export default function App() {
  const view = useUi((s) => s.history[s.at]);
  const panel = useUi((s) => s.panel);
  const theme = useUi((s) => s.theme);

  useEffect(() => {
    useLibrary.getState().loadAll();
    useHidden.getState().load();
    // This PC's real cores and memory (for the "Automático" performance profile).
    if (desktop) desktop.settings().then((s) => { if (s && s.cores) usePerf.getState().setHardware({ cores: s.cores, memGB: s.memGB }); }, () => {});
    // "Al abrir Rumoria: lo último que viste".
    if (useLook.getState().look.start === 'last') { const v = lastView(); if (v && v.name !== 'home') useUi.getState().go(v); }
  }, []);
  // v1.12, Modo juego: a game full screen (the desktop app watches) → Recursos mínimos until it ends.
  useEffect(() => {
    if (!desktop || !desktop.game) return undefined;
    desktop.game.get().then((g) => usePerf.getState().setGame(Boolean(g && g.active)), () => {});
    return desktop.game.onState((g) => usePerf.getState().setGame(Boolean(g && g.active)));
  }, []);
  // Lists made or filled in the background ("Para ti", lists that fill themselves) show up by
  // themselves; less often on "Recursos mínimos", and not during a game.
  const profile = usePerf((s) => s.profile);
  useEffect(() => {
    const t = setInterval(() => { if (!usePerf.getState().game) useLibrary.getState().refreshLists(); }, (PROFILES[profile] || PROFILES.mid).listsEveryMs);
    return () => clearInterval(t);
  }, [profile]);
  // The page you're on, for next time.
  useEffect(() => { rememberView(view); }, [view]);
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The mini player sees what plays here and its buttons drive this player.
  useEffect(() => startMiniBridge(), []);
  // v1.7: the alarm clock (what it puts on: the same as those cards on Inicio).
  useEffect(() => startAlarm({ tracksFor: alarmTracks }), []);
  // Your look (Ajustes → Personalizar), from the start.
  useEffect(() => { applyLook(useLook.getState().look); }, []);
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    if (theme !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  // The Android app: its notification and back button, and the phone layout.
  useEffect(() => startAndroid(), []);
  // v1.10: what another device synced shows up here by itself.
  useEffect(() => startSyncWatch(), []);
  useEffect(() => {
    if (!isPhone) return undefined;
    document.documentElement.dataset.device = 'phone';
    return () => { delete document.documentElement.dataset.device; };
  }, []);

  if (isPhone) {
    return (
      <div className="app phone">
        <main className="main" key={`${view.name}-${view.id || ''}`}>
          <TopBar />
          <YouTubeNotice />
          <div className="page"><Page view={view} /></div>
        </main>
        <MiniBar />
        <TabBar />
        <PhonePlayer />
        <SidePanel />
        <Overlays />
      </div>
    );
  }

  return (
    <>
    <TitleBar />
    <div className={`app ${panel ? 'with-panel' : ''}`}>
      <Sidebar />
      <main className="main" key={`${view.name}-${view.id || ''}`}>
        <TopBar />
        <YouTubeNotice />
        <div className="page"><Page view={view} /></div>
      </main>
      <SidePanel />
      <PlayerBar />
      <NowPlaying />
      <DropLink />
      <Guide />
      <Overlays />
    </div>
    </>
  );
}

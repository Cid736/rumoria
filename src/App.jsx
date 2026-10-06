// The layout: library on the left, the page in the middle, queue or lyrics
// on the right (when open), and the player along the bottom.
import { useEffect } from 'react';
import { useLibrary } from './store/library.js';
import { usePlayer } from './store/player.js';
import { useUi } from './store/ui.js';
import Overlays from './components/Overlays.jsx';
import PlayerBar from './components/PlayerBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import SidePanel from './components/SidePanel.jsx';
import TopBar from './components/TopBar.jsx';
import Home from './views/Home.jsx';
import { LikedPage, ListPage, LocalPage, MixPage } from './views/Pages.jsx';
import Search from './views/Search.jsx';
import Settings from './views/Settings.jsx';
import Summary from './views/Summary.jsx';

function Page({ view }) {
  switch (view.name) {
    case 'search': return <Search />;
    case 'list': return <ListPage id={view.id} />;
    case 'liked': return <LikedPage />;
    case 'local': return <LocalPage />;
    case 'mix': return <MixPage id={view.id} />;
    case 'settings': return <Settings />;
    case 'summary': return <Summary />;
    default: return <Home />;
  }
}

const typing = (e) => e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');

/** Keys for the player and for moving around (not while typing). */
export function onKey(e) {
  const p = usePlayer.getState();
  const ui = useUi.getState();
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); ui.back(); return; }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); ui.forward(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); ui.go({ name: 'search' }); return; }
  if (typing(e)) return;
  if (e.key === ' ' && !e.target.closest('button, [role="slider"]')) { e.preventDefault(); p.toggle(); return; }
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  const actions = {
    arrowright: () => p.next(), arrowleft: () => p.prev(),
    arrowup: () => p.setVolume(p.volume + 0.1), arrowdown: () => p.setVolume(p.volume - 0.1),
    s: () => p.toggleShuffle(), r: () => p.cycleRepeat(),
  };
  if (actions[k]) { e.preventDefault(); actions[k](); }
}

export default function App() {
  const view = useUi((s) => s.history[s.at]);
  const panel = useUi((s) => s.panel);
  const theme = useUi((s) => s.theme);

  useEffect(() => { useLibrary.getState().loadAll(); }, []);
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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

  return (
    <div className={`app ${panel ? 'with-panel' : ''}`}>
      <Sidebar />
      <main className="main" key={`${view.name}-${view.id || ''}`}>
        <TopBar />
        <div className="page"><Page view={view} /></div>
      </main>
      <SidePanel />
      <PlayerBar />
      <Overlays />
    </div>
  );
}

// Back / forward, (on Buscar) the search box, and an update ready to install.
import { useEffect, useRef } from 'react';
import { desktop } from '../api.js';
import { useUpdate } from '../lib/useUpdate.js';
import { useSearches } from '../store/searches.js';
import { useUi } from '../store/ui.js';
import { ChevronLeft, ChevronRight, Gear, Search } from './Icons.jsx';

export default function TopBar() {
  const view = useUi((s) => s.history[s.at]);
  const canBack = useUi((s) => s.at > 0);
  const canForward = useUi((s) => s.at < s.history.length - 1);
  const text = useUi((s) => s.searchText);
  const input = useRef(null);
  const update = useUpdate();
  useEffect(() => { if (view.name === 'search' && input.current) input.current.focus(); }, [view.name]);

  return (
    <header className="topbar">
      <div className="topbar-nav">
        <button type="button" className="round-btn" onClick={() => useUi.getState().back()} disabled={!canBack} aria-label="Atrás" title="Atrás (Alt+←)"><ChevronLeft /></button>
        <button type="button" className="round-btn" onClick={() => useUi.getState().forward()} disabled={!canForward} aria-label="Adelante" title="Adelante (Alt+→)"><ChevronRight /></button>
      </div>
      {view.name === 'search' && (
        <label className="searchbox">
          <Search size={18} />
          <input ref={input} type="search" placeholder="¿Qué quieres escuchar?" value={text} maxLength={200}
            onChange={(e) => useUi.getState().setSearchText(e.target.value)} aria-label="Buscar canciones"
            onKeyDown={(e) => { if (e.key === 'Enter') useSearches.getState().add(e.currentTarget.value); }} />
        </label>
      )}
      <div className="topbar-end">
        {update && update.status === 'ready' && (
          <button type="button" className="update-pill" onClick={() => desktop.update.restart()} title={`Rumoria ${update.latest} está lista. También se instala sola al cerrar la app.`}>
            Actualizar a {update.latest}
          </button>
        )}
        <button type="button" className="round-btn" onClick={() => useUi.getState().go({ name: 'settings' })} aria-label="Ajustes" title="Ajustes"><Gear size={18} /></button>
      </div>
    </header>
  );
}

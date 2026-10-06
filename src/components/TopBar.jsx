// Back / forward, and (on Buscar) the search box.
import { useEffect, useRef } from 'react';
import { useUi } from '../store/ui.js';
import { ChevronLeft, ChevronRight, Gear, Search } from './Icons.jsx';

export default function TopBar() {
  const view = useUi((s) => s.history[s.at]);
  const canBack = useUi((s) => s.at > 0);
  const canForward = useUi((s) => s.at < s.history.length - 1);
  const text = useUi((s) => s.searchText);
  const input = useRef(null);
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
            onChange={(e) => useUi.getState().setSearchText(e.target.value)} aria-label="Buscar canciones" />
        </label>
      )}
      <div className="topbar-end">
        <button type="button" className="round-btn" onClick={() => useUi.getState().go({ name: 'settings' })} aria-label="Ajustes" title="Ajustes"><Gear size={18} /></button>
      </div>
    </header>
  );
}

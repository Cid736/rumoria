// v1.6: the window's own title bar (the native one is hidden). You drag the
// window by it and a double click maximises it (Windows does both). Its
// buttons follow the style chosen in Personalizar: Windows' caption buttons
// on the right (also for Rumoria's own style), or Mac's three lights on the
// left. It goes away in full screen.
import { useEffect, useState } from 'react';
import { desktop } from '../api.js';
import { useLook } from '../store/look.js';

export default function TitleBar() {
  const ui = useLook((s) => s.look.ui);
  const [state, setState] = useState({ maximized: false, fullscreen: false });
  const [blurred, setBlurred] = useState(false);
  const win = desktop && desktop.window;
  useEffect(() => {
    if (!win) return undefined;
    const off = win.onState((s) => setState({ maximized: Boolean(s && s.maximized), fullscreen: Boolean(s && s.fullscreen) }));
    const blur = () => setBlurred(true);
    const focus = () => setBlurred(false);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    return () => { off(); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); };
  }, [win]);
  // Room for the bar (none in a plain browser, or in full screen).
  const shown = Boolean(win) && !state.fullscreen;
  useEffect(() => {
    document.documentElement.dataset.titlebar = shown ? 'on' : 'off';
    return () => { delete document.documentElement.dataset.titlebar; };
  }, [shown]);
  if (!shown) return null;
  const act = (a) => () => win.control(a);
  const mac = ui === 'mac';
  return (
    <header className={`titlebar ${blurred ? 'blurred' : ''} ${state.maximized ? 'maximized' : ''}`}>
      {mac && (
        <div className="traffic" role="group" aria-label="Ventana">
          <button type="button" className="tl tl-close" onClick={act('close')} aria-label="Cerrar" title="Cerrar"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3.5l5 5m0-5l-5 5" /></svg></button>
          <button type="button" className="tl tl-min" onClick={act('minimize')} aria-label="Minimizar" title="Minimizar"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.8 6h6.4" /></svg></button>
          <button type="button" className="tl tl-max" onClick={act('maximize')} aria-label={state.maximized ? 'Restaurar' : 'Maximizar'} title={state.maximized ? 'Restaurar' : 'Maximizar'}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.2 8.8V5.2l3.6 3.6H3.2zM8.8 3.2v3.6L5.2 3.2h3.6z" /></svg></button>
        </div>
      )}
      {!mac && <span className="titlebar-icon" aria-hidden="true" />}
      <span className="titlebar-title">Rumoria</span>
      {!mac && (
        <div className="caption" role="group" aria-label="Ventana">
          <button type="button" className="caption-btn" onClick={act('minimize')} aria-label="Minimizar" title="Minimizar"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" /></svg></button>
          <button type="button" className="caption-btn" onClick={act('maximize')} aria-label={state.maximized ? 'Restaurar' : 'Maximizar'} title={state.maximized ? 'Restaurar' : 'Maximizar'}>
            {state.maximized
              ? <svg viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="2.5" width="7" height="7" rx="1" /><path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" /></svg>
              : <svg viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" rx="1" /></svg>}
          </button>
          <button type="button" className="caption-btn caption-close" onClick={act('close')} aria-label="Cerrar" title="Cerrar"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0.5 0.5l9 9m0-9l-9 9" /></svg></button>
        </div>
      )}
    </header>
  );
}

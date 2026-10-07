// What floats over the page: the right-click menu, dialogs and toasts.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EVERY } from '../lib/autoLists.js';
import { useLibrary } from '../store/library.js';
import { useUi } from '../store/ui.js';

function MenuList({ items, x, y, onDone, level = 0 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [openSub, setOpenSub] = useState(null);
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
  }, [x, y]);
  useEffect(() => { if (level === 0 && ref.current) { const b = ref.current.querySelector('button'); if (b) b.focus(); } }, [level]);
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos.left, top: pos.top }}
      onKeyDown={(e) => {
        const btns = [...ref.current.querySelectorAll(':scope > button')];
        const i = btns.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
      }}>
      {items.map((it, i) => (it.sep ? <hr key={`sep-${i}`} /> : (
        <button key={it.label} type="button" role="menuitem" className={`menu-item ${it.danger ? 'danger' : ''}`}
          aria-haspopup={it.sub ? 'menu' : undefined}
          onMouseEnter={(e) => setOpenSub(it.sub ? { items: it.sub, rect: e.currentTarget.getBoundingClientRect() } : null)}
          onClick={(e) => {
            if (it.sub) { setOpenSub({ items: it.sub, rect: e.currentTarget.getBoundingClientRect() }); return; }
            onDone();
            it.onClick();
          }}>
          {it.label}{it.sub && <span className="menu-arrow">›</span>}
        </button>
      )))}
      {openSub && <MenuList items={openSub.items} x={openSub.rect.right - 4} y={openSub.rect.top - 6} onDone={onDone} level={level + 1} />}
    </div>
  );
}

function ContextMenu() {
  const menu = useUi((s) => s.menu);
  const close = useUi((s) => s.closeMenu);
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => { if (!e.target.closest('.menu')) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); window.removeEventListener('blur', close); window.removeEventListener('resize', close); };
  }, [menu, close]);
  if (!menu) return null;
  return <MenuList items={menu.items} x={menu.x} y={menu.y} onDone={close} />;
}

function Dialog() {
  const d = useUi((s) => s.dialog);
  // A new dialog is a new form (fresh text, not busy, no error).
  return d ? <DialogForm key={d.seq} d={d} /> : null;
}

function DialogForm({ d }) {
  const close = useUi((s) => s.closeDialog);
  const [value, setValue] = useState(d.value || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [every, setEvery] = useState(24);
  const isImport = d.kind === 'import';
  const isAuto = d.kind === 'auto';
  const submit = async (e) => {
    e.preventDefault();
    const v = value.trim();
    if (!v && !d.allowEmpty) return;
    if (isImport || isAuto) {
      setBusy(true);
      setError(null);
      try {
        const r = isImport ? await useLibrary.getState().importList(v) : await useLibrary.getState().createAutoList(v, every, d.folder || null);
        close();
        if (r.id) useUi.getState().go({ name: 'list', id: r.id });
      } catch (err) { setError(err.message); setBusy(false); }
      return;
    }
    close();
    d.onConfirm(v);
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close(); }}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape' && !busy) close(); }}>
        <h2 id="dlg-title">{isImport ? 'Importar una lista' : isAuto ? 'Una lista que se llena sola' : d.title}</h2>
        {isImport && <p className="muted">Pega el enlace de una playlist de Spotify, Apple Music o YouTube, o de un perfil de Spotify (todas sus listas públicas). Solo se guardan títulos y artistas: cada canción se busca en YouTube al sonar.</p>}
        {isAuto && <p className="muted">Escribe un estilo, un artista o un momento. Rumoria busca canciones que encajen, la llena ahora y le añade las nuevas que vaya encontrando. No se descarga nada: todo suena al momento. Si quitas una canción, no vuelve.{d.folder ? ` Irá en la carpeta «${d.folder}».` : ''}</p>}
        <label className="field">
          <span>{isImport ? 'Enlace' : isAuto ? 'De qué' : d.label}</span>
          <input autoFocus type={isImport ? 'url' : 'text'} value={value} maxLength={isImport ? 2048 : isAuto ? 100 : 150} onChange={(e) => setValue(e.target.value)}
            placeholder={isImport ? 'https://open.spotify.com/playlist/…' : isAuto ? 'Rock de los 80, Bad Bunny, lo-fi para estudiar…' : ''} disabled={busy} />
        </label>
        {isAuto && (
          <label className="field">
            <span>Buscar canciones nuevas</span>
            <select value={every} onChange={(e) => setEvery(Number(e.target.value))} disabled={busy}>
              {EVERY.map(([h, label]) => <option key={h} value={h}>{label}</option>)}
            </select>
          </label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn btn-accent" disabled={busy || (!value.trim() && !d.allowEmpty)}>{busy ? (isAuto ? 'Buscando canciones…' : 'Leyendo…') : isImport ? 'Importar' : isAuto ? 'Crear' : d.confirm}</button>
        </div>
      </form>
    </div>
  );
}

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.text}</span>
          {t.action && <button type="button" className="toast-action" onClick={() => { dismiss(t.id); t.onAction(); }}>{t.action}</button>}
        </div>
      ))}
    </div>
  );
}

export default function Overlays() {
  return (<><ContextMenu /><Dialog /><Toasts /></>);
}

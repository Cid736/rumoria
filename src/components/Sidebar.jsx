// Left: where to go, and your library (Favoritas, your music, your lists by folder).
import { useMemo, useState } from 'react';
import { autoMenuItems, newAutoList } from '../lib/autoLists.js';
import { fold } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';
import Cover from './Cover.jsx';
import { Clock, Folder, Home, Library, Link, Plus, Search, Sparkle } from './Icons.jsx';

const SOURCE = { spotify: 'Spotify', apple: 'Apple Music', youtube: 'YouTube', own: 'Tu lista', auto: 'Se llena sola' };

/** "+": an empty list of yours, or one that fills itself. */
function newListMenu(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const ui = useUi.getState();
  ui.openMenu(r.left, r.bottom, [
    { label: 'Lista que se llena sola…', onClick: () => newAutoList() },
    {
      label: 'Lista vacía…',
      onClick: () => ui.openDialog({ kind: 'prompt', title: 'Lista nueva', label: 'Nombre', value: '', confirm: 'Crear', onConfirm: (name) => useLibrary.getState().createList(name, []).then((l) => ui.go({ name: 'list', id: l.id }), (err) => ui.toast(err.message)) }),
    },
  ]);
}
const FILTERS = [['all', 'Todo'], ['own', 'Tuyas'], ['link', 'De un enlace']];

function Item({ active, onClick, onContextMenu, cover, title, sub, playing }) {
  return (
    <button type="button" className={`side-item ${active ? 'active' : ''}`} onClick={onClick} onContextMenu={onContextMenu} aria-current={active ? 'page' : undefined}>
      {cover}
      <span className="side-text">
        <span className={`side-title ${playing ? 'playing' : ''}`}>{title}</span>
        <span className="side-sub">{sub}</span>
      </span>
    </button>
  );
}

export default function Sidebar() {
  const view = useUi((s) => s.history[s.at]);
  const go = useUi((s) => s.go);
  const lists = useLibrary((s) => s.lists);
  const likes = useLibrary((s) => s.likes);
  const local = useLibrary((s) => s.local);
  const playingList = usePlayer((s) => (s.queue.items[s.queue.index] || {}).list);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    const shown = lists.filter((l) => (filter === 'all' || (filter === 'own' ? !l.url : Boolean(l.url))) && (!q || fold(l.name).includes(fold(q))));
    const byFolder = new Map();
    for (const l of shown) {
      const k = l.folder || '';
      if (!byFolder.has(k)) byFolder.set(k, []);
      byFolder.get(k).push(l);
    }
    return [...byFolder.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  }, [lists, filter, q]);

  const listMenu = (l) => (e) => {
    e.preventDefault();
    const ui = useUi.getState();
    const lib = useLibrary.getState();
    ui.openMenu(e.clientX, e.clientY, [
      { label: 'Cambiar nombre…', onClick: () => ui.openDialog({ kind: 'prompt', title: 'Cambiar nombre', label: 'Nombre', value: l.name, confirm: 'Guardar', onConfirm: (name) => lib.patchList(l.id, { name }) }) },
      { label: 'Mover a una carpeta…', onClick: () => ui.openDialog({ kind: 'prompt', title: 'Carpeta', label: 'Nombre de la carpeta (vacío: ninguna)', value: l.folder || '', confirm: 'Guardar', allowEmpty: true, onConfirm: (folder) => lib.patchList(l.id, { folder }) }) },
      ...(l.url ? [{ label: 'Leer de nuevo', onClick: () => lib.refreshList(l.id) }, { label: l.sync ? 'No mantener al día' : 'Mantener al día', onClick: () => lib.patchList(l.id, { sync: !l.sync }) }] : []),
      ...autoMenuItems(l),
      { sep: true },
      { label: 'Eliminar', danger: true, onClick: () => lib.deleteList(l.id) },
    ]);
  };

  return (
    <nav className="sidebar" aria-label="Navegación">
      <div className="side-card side-nav">
        <button type="button" className={`nav-btn ${view.name === 'home' ? 'active' : ''}`} onClick={() => go({ name: 'home' })}><Home /> Inicio</button>
        <button type="button" className={`nav-btn ${view.name === 'search' ? 'active' : ''}`} onClick={() => go({ name: 'search' })}><Search /> Buscar</button>
        <button type="button" className={`nav-btn ${view.name === 'summary' ? 'active' : ''}`} onClick={() => go({ name: 'summary' })}><Sparkle /> Tu resumen</button>
        <button type="button" className={`nav-btn ${view.name === 'history' ? 'active' : ''}`} onClick={() => go({ name: 'history' })}><Clock /> Historial</button>
      </div>
      <div className="side-card side-library">
        <div className="side-head">
          <span className="side-head-title"><Library /> Tu biblioteca</span>
          <span className="side-head-actions">
            <button type="button" className="icon-btn" title="Importar una lista (Spotify, Apple Music, YouTube)" aria-label="Importar una lista" onClick={() => useUi.getState().openDialog({ kind: 'import' })}><Link size={18} /></button>
            <button type="button" className="icon-btn" title="Crear una lista" aria-label="Crear una lista" aria-haspopup="menu" onClick={newListMenu}><Plus size={18} /></button>
          </span>
        </div>
        <div className="chips" role="radiogroup" aria-label="Filtrar">
          {FILTERS.map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={filter === k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label}</button>)}
        </div>
        {lists.length > 6 && <input className="side-search" type="search" placeholder="Buscar en tu biblioteca" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar en tu biblioteca" />}
        <div className="side-scroll">
          <Item active={view.name === 'liked'} onClick={() => go({ name: 'liked' })} cover={<Cover liked size={44} />} title="Favoritas" sub={`Lista · ${likes.length} canciones`} />
          {local.folder && <Item active={view.name === 'local'} onClick={() => go({ name: 'local' })} cover={<Cover name="Tu música" size={44} />} title="Tu música" sub={`Carpeta · ${local.songs.length} canciones`} />}
          {groups.map(([folder, ls]) => (
            <div key={folder || '-'} className="side-group">
              {folder && (
                <div className="side-folder">
                  <Folder size={16} /> <span className="side-folder-name">{folder}</span>
                  <button type="button" className="icon-btn side-folder-add" title={`Añadir una lista que se llena sola con «${folder}»`} aria-label={`Añadir a «${folder}» una lista que se llena sola`}
                    onClick={() => newAutoList({ topic: folder, folder })}><Sparkle size={14} /></button>
                </div>
              )}
              {ls.map((l) => (
                <Item key={l.id} active={view.name === 'list' && view.id === l.id} playing={playingList === l.id}
                  onClick={() => go({ name: 'list', id: l.id })} onContextMenu={listMenu(l)}
                  cover={<Cover src={l.thumbnail} thumbs={l.thumbs} name={l.name} size={44} />}
                  title={l.name} sub={`${SOURCE[l.source] || 'Lista'} · ${l.count} canciones`} />
              ))}
            </div>
          ))}
          {!lists.length && (
            <div className="side-empty">
              <p><strong>Trae tus listas</strong></p>
              <p>Pega el enlace de una playlist de Spotify, Apple Music o YouTube, o crea una que se llene sola con lo que te guste.</p>
              <button type="button" className="btn btn-light" onClick={() => useUi.getState().openDialog({ kind: 'import' })}>Importar una lista</button>
              <button type="button" className="btn btn-ghost" onClick={() => newAutoList()}>Lista que se llena sola</button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

// The pages with songs: one of your lists, Favoritas, Tu música, a mix.
import { useEffect, useState } from 'react';
import { desktop } from '../api.js';
import { autoMenuItems, autoSub } from '../lib/autoLists.js';
import { fromList, fromLocal, fromSaved, fromYouTube } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { useUi } from '../store/ui.js';
import Cover from '../components/Cover.jsx';
import { Folder, More, Refresh } from '../components/Icons.jsx';
import Collection, { BigCover } from './Collection.jsx';
import { buildMix, mixCards, SMART, smartTracks } from './mixes.js';

const SOURCE = { spotify: 'Lista de Spotify', apple: 'Lista de Apple Music', youtube: 'Lista de YouTube', own: 'Lista', auto: 'Lista que se llena sola' };

export function ListPage({ id }) {
  const list = useLibrary((s) => s.open[id]);
  const summary = useLibrary((s) => s.lists.find((l) => l.id === id));
  const [failed, setFailed] = useState({ id: null, message: null });
  useEffect(() => { useLibrary.getState().loadList(id).catch((err) => setFailed({ id, message: err.message })); }, [id]);
  if (failed.id === id) return <p className="muted pad">{failed.message}</p>;
  if (!list) return <Collection kind="Lista" name={(summary && summary.name) || ''} tracks={[]} loading />;

  const tracks = list.tracks.map(fromList(list.id));
  const lib = useLibrary.getState();
  const more = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const ui = useUi.getState();
    ui.openMenu(r.left, r.bottom, [
      { label: 'Cambiar nombre…', onClick: () => ui.openDialog({ kind: 'prompt', title: 'Cambiar nombre', label: 'Nombre', value: list.name, confirm: 'Guardar', onConfirm: (name) => lib.patchList(id, { name }) }) },
      { label: 'Mover a una carpeta…', onClick: () => ui.openDialog({ kind: 'prompt', title: 'Carpeta', label: 'Nombre de la carpeta (vacío: ninguna)', value: list.folder || '', confirm: 'Guardar', allowEmpty: true, onConfirm: (folder) => lib.patchList(id, { folder }) }) },
      ...(list.url ? [{ label: list.sync ? 'No mantener al día' : 'Mantener al día (se lee de nuevo cada pocas horas)', onClick: () => lib.patchList(id, { sync: !list.sync }) }] : []),
      ...autoMenuItems(list),
      { label: 'Quitar canciones repetidas', onClick: () => lib.dedupeList(id) },
      { sep: true },
      { label: 'Eliminar lista', danger: true, onClick: () => { lib.deleteList(id); ui.go({ name: 'home' }); } },
    ]);
  };
  const thumbs = [...new Set(list.tracks.map((t) => t.thumbnail).filter(Boolean))].slice(0, 4);
  return (
    <Collection
      kind={SOURCE[list.source] || 'Lista'} name={list.name} sub={[autoSub(list.auto), list.folder ? `Carpeta ${list.folder}` : null].filter(Boolean).join(' · ') || null}
      cover={<BigCover thumbs={thumbs} src={thumbs[0]} name={list.name} />}
      tracks={tracks} listId={list.id} sortKey={`list:${list.id}`} recent={{ kind: 'list', id: list.id, name: list.name, sub: SOURCE[list.source] || 'Lista' }}
      reorder={(from, to) => lib.patchList(id, { move: { from, to } })}
      actions={(
        <>
          {list.url && <button type="button" className="icon-btn big" onClick={() => lib.refreshList(id)} aria-label="Leer de nuevo" title="Leer de nuevo desde el enlace"><Refresh size={22} /></button>}
          {list.auto && <button type="button" className="icon-btn big" onClick={() => lib.refreshList(id)} aria-label="Buscar canciones nuevas ahora" title="Buscar canciones nuevas ahora"><Refresh size={22} /></button>}
          <button type="button" className="icon-btn big" onClick={more} aria-label="Más opciones de la lista" title="Más opciones"><More size={24} /></button>
        </>
      )}
      empty={<p className="muted pad">Esta lista está vacía. Añade canciones con el botón derecho en cualquier canción.</p>}
    />
  );
}

export function LikedPage() {
  const likes = useLibrary((s) => s.likes);
  const local = useLibrary((s) => s.local);
  const map = new Map((local.songs || []).map((f) => [f.key, f]));
  const tracks = likes.map((s) => ({ ...fromSaved(s, map), at: s.at })).filter((t) => t.key);
  return (
    <Collection kind="Lista" name="Favoritas" cover={<Cover liked size={200} className="col-cover" />} tracks={tracks} showAdded sortKey="liked"
      recent={{ kind: 'liked', name: 'Favoritas', sub: 'Tus canciones con corazón' }}
      empty={<p className="muted pad">Las canciones que marques con el corazón aparecerán aquí.</p>} />
  );
}

export function LocalPage() {
  const local = useLibrary((s) => s.local);
  const tracks = local.songs.map(fromLocal);
  const pick = async () => { if (desktop && await desktop.pickMusicDir()) useLibrary.getState().rescanLocal(); };
  return (
    <Collection kind="Carpeta" name="Tu música" sub="Tus archivos, en este ordenador" cover={<BigCover name="Tu música" />} tracks={tracks} sortKey="local"
      recent={{ kind: 'local', name: 'Tu música', sub: 'Tus archivos' }}
      actions={(
        <>
          <button type="button" className="icon-btn big" onClick={() => useLibrary.getState().rescanLocal()} aria-label="Volver a leer la carpeta" title="Volver a leer la carpeta"><Refresh size={22} /></button>
          {desktop && <button type="button" className="icon-btn big" onClick={pick} aria-label="Elegir otra carpeta" title="Elegir otra carpeta"><Folder size={22} /></button>}
        </>
      )}
      empty={<p className="muted pad">No hay canciones en tu carpeta de música.</p>} />
  );
}

export function MixPage({ id }) {
  const smart = useLibrary((s) => s.smart);
  const local = useLibrary((s) => s.local);
  const [built, setBuilt] = useState({ id: null, tracks: null });
  const card = mixCards(smart).find((m) => m.id === id);
  useEffect(() => {
    let gone = false;
    if (card) buildMix(card.artist, local).then((tracks) => { if (!gone) setBuilt({ id, tracks }); });
    return () => { gone = true; };
    // Built once per mix opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, Boolean(card)]);
  const mix = built.id === id ? built.tracks : null;
  if (SMART[id]) {
    const tracks = smartTracks(id, smart, local);
    return <Collection kind="Hecho para ti" name={SMART[id].name} sub={SMART[id].sub} cover={<BigCover thumbs={tracks.map((t) => t.thumbnail).filter(Boolean)} name={SMART[id].name} />} tracks={tracks}
      recent={{ kind: 'mix', id, name: SMART[id].name, sub: 'Hecho para ti' }} />;
  }
  if (!card) return <p className="muted pad">Esta mezcla ya no está.</p>;
  return <Collection kind="Hecho para ti" name={card.name} sub={`${card.sub} y parecidos`} cover={<BigCover src={card.thumb} name={card.sub} />} tracks={mix || []} loading={!mix}
    recent={{ kind: 'mix', id, name: card.name, sub: `${card.sub} y más` }} />;
}

export function NewsPage() {
  const news = useLibrary((s) => s.news);
  const tracks = news.map((n) => fromYouTube({ ...n, id: n.yt }));
  return (
    <Collection kind="Hecho para ti" name="Novedades de tus artistas" sub="Lo último de los que más escuchas"
      cover={<BigCover thumbs={tracks.map((t) => t.thumbnail).filter(Boolean)} name="Novedades de tus artistas" />} tracks={tracks}
      recent={{ kind: 'news', name: 'Novedades de tus artistas', sub: 'Hecho para ti' }}
      empty={<p className="muted pad">Cuando tus artistas saquen algo nuevo, aparecerá aquí (se mira cada 12 horas).</p>} />
  );
}

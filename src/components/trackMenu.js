// What a song's right-click (or "…") offers, wherever it's shown.
import { api, desktop, urls } from '../api.js';
import { fromYouTube, toListTrack } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';

/** `tracks`: the songs it's for (one, or the selected ones). `from`: { listId, ns } when they're in one of your lists. */
export function trackMenu(tracks, from = null) {
  const lib = useLibrary.getState();
  const player = usePlayer.getState();
  const ui = useUi.getState();
  const one = tracks.length === 1 ? tracks[0] : null;
  const own = lib.lists.filter((l) => l.source === 'own' || !l.url);
  const items = [
    { label: 'Reproducir a continuación', onClick: () => { player.enqueue(tracks, 'next'); ui.toast('Se reproducirá a continuación'); } },
    { label: 'Añadir a la cola', onClick: () => { player.enqueue(tracks, 'end'); ui.toast(tracks.length === 1 ? 'Añadida a la cola' : `${tracks.length} canciones añadidas a la cola`); } },
    { sep: true },
    {
      label: 'Añadir a una lista',
      sub: [
        {
          label: 'Lista nueva…',
          onClick: () => ui.openDialog({
            kind: 'prompt', title: 'Lista nueva', label: 'Nombre', value: one ? one.title : '', confirm: 'Crear',
            onConfirm: (name) => lib.createList(name, tracks.map(toListTrack)).then((l) => ui.toast(`«${l.name}» creada`), (err) => ui.toast(err.message)),
          }),
        },
        ...(own.length ? [{ sep: true }] : []),
        ...own.slice(0, 30).map((l) => ({ label: l.name, onClick: () => lib.addToList(l.id, tracks.map(toListTrack)) })),
      ],
    },
  ];
  if (one && one.key) {
    const liked = lib.isLiked(one.key);
    items.push({ label: liked ? 'Quitar de Favoritas' : 'Añadir a Favoritas', onClick: () => lib.setLike(one, !liked) });
  }
  if (one && one.yt) {
    items.push({ sep: true });
    items.push({ label: 'Radio de esta canción', onClick: () => startRadio(one) });
    if (desktop) items.push({ label: 'Descargar con TubeGrab', onClick: () => desktop.downloadInTubeGrab(one.yt) });
    items.push({ label: 'Copiar enlace de YouTube', onClick: () => copy(`https://www.youtube.com/watch?v=${one.yt}`) });
  }
  if (from && from.listId) {
    items.push({ sep: true });
    items.push({ label: tracks.length === 1 ? 'Quitar de esta lista' : `Quitar ${tracks.length} canciones de esta lista`, danger: true, onClick: () => lib.removeTracks(from.listId, from.ns) });
  }
  return items;
}

async function startRadio(track) {
  try {
    const r = await api.get(urls.radio(track.yt));
    usePlayer.getState().playTracks([track, ...(r.entries || []).map(fromYouTube)], 0);
  } catch (err) { useUi.getState().toast(err.message); }
}

function copy(text) {
  navigator.clipboard.writeText(text).then(() => useUi.getState().toast('Enlace copiado'), () => useUi.getState().toast('No se pudo copiar'));
}

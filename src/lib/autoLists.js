// Lists that fill themselves from a topic: how often they look for new songs,
// how that reads, and the menu entries to manage one. Nothing is downloaded:
// a list keeps titles and YouTube ids, and every song plays straight away.
import { useLibrary } from '../store/library.js';
import { useUi } from '../store/ui.js';

export const EVERY = [[6, 'Cada 6 horas'], [12, 'Cada 12 horas'], [24, 'Cada día'], [168, 'Cada semana']];

export const everyLabel = (h) => (EVERY.find(([v]) => v === h) || [24, 'Cada día'])[1].toLowerCase();

/** "Se llena sola con «rock de los 80» · cada día". */
export const autoSub = (auto) => (auto ? `Se llena sola con «${auto.q}» · ${everyLabel(auto.every)}` : null);

/** Opens the dialog to make one (inside `folder`, about `topic`, if given). */
export function newAutoList({ topic = '', folder = null } = {}) {
  useUi.getState().openDialog({ kind: 'auto', value: topic, folder });
}

/** Menu entries for a list that fills itself. */
export function autoMenuItems(list) {
  if (!list || !list.auto) return [];
  const lib = useLibrary.getState();
  return [
    { label: 'Buscar canciones nuevas ahora', onClick: () => lib.refreshList(list.id) },
    {
      label: 'Buscar canciones nuevas…',
      sub: EVERY.map(([h, label]) => ({ label: `${list.auto.every === h ? '✓ ' : ''}${label}`, onClick: () => lib.patchList(list.id, { auto: { every: h } }) })),
    },
    { label: 'Dejar de llenarse sola', onClick: () => lib.patchList(list.id, { auto: null }) },
  ];
}

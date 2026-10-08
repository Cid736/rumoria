// Your music: lists, favourites, what you listen to, news, your own folder.
// Loaded from the server once and kept in step after each change.
import { create } from 'zustand';
import { api, urls } from '../api.js';
import { songOf, toListTrack } from '../lib/tracks.js';
import { useUi } from './ui.js';

const toast = (...a) => useUi.getState().toast(...a);

export const useLibrary = create((set, get) => ({
  lists: [],            // summaries (no tracks)
  open: {},             // id -> full list (with tracks), once opened
  likes: [],            // favourites, newest first
  likedKeys: new Set(),
  smart: null,          // most played, heard lately, to rediscover, your artists
  news: [],
  local: { folder: false, songs: [] },
  browse: [],           // "Explorar": ready-made lists (their covers once read)
  taste: [],            // your genres ({ id, score }), for Inicio's rotating shelves
  loaded: false,

  async loadAll() {
    const [l, k, s, n, f, b] = await Promise.allSettled([api.get('/api/lists'), api.get('/api/likes'), api.get('/api/history/smart'), api.get('/api/news'), api.get('/api/local'), api.get('/api/browse')]);
    const ok = (r, fallback) => (r.status === 'fulfilled' ? r.value : fallback);
    const likes = ok(k, { songs: [] }).songs || [];
    set({
      lists: ok(l, { lists: [] }).lists || [],
      likes,
      likedKeys: new Set(likes.map((x) => x.key)),
      smart: ok(s, null),
      news: ok(n, { news: [] }).news || [],
      local: ok(f, { folder: false, songs: [] }),
      browse: ok(b, { lists: [] }).lists || [],
      taste: ok(b, {}).taste || [],
      loaded: true,
    });
  },
  /** The "Explorar" lists again (covers read ahead since). */
  async refreshBrowse() { try { const b = await api.get('/api/browse'); set({ browse: b.lists || get().browse, taste: b.taste || get().taste }); } catch { /* keep */ } },
  /** One "Explorar" list's songs (and its cover, now known, on the home page). */
  async loadBrowse(id) {
    const l = await api.get(`/api/browse/${encodeURIComponent(id)}`);
    await get().refreshBrowse();
    return l;
  },
  /** Anything playable kept as a list of yours. */
  async saveAsList(name, tracks) {
    try {
      const l = await get().createList(name, tracks.map(toListTrack));
      toast(`Guardada como «${l.name}»`);
      return l;
    } catch (err) { toast(err.message); return null; }
  },
  async refreshLists() { try { set({ lists: (await api.get('/api/lists')).lists || [] }); } catch { /* keep what's shown */ } },
  async refreshSmart() { try { set({ smart: await api.get('/api/history/smart') }); } catch { /* keep */ } },
  async loadList(id) {
    const l = await api.get(urls.list(id));
    set((s) => ({ open: { ...s.open, [id]: l } }));
    return l;
  },
  _putList(l) {
    set((s) => ({ open: { ...s.open, [l.id]: l } }));
    get().refreshLists();
  },

  // ---- favourites ----
  isLiked: (key) => Boolean(key) && get().likedKeys.has(key),
  async setLike(track, on) {
    const song = songOf(track);
    if (!song) { toast('Esta canción aún no se puede guardar en Favoritas.'); return; }
    // At once on screen; put back if the server says no.
    const before = { likes: get().likes, likedKeys: get().likedKeys };
    const likes = on ? [{ ...song, at: Date.now() }, ...before.likes.filter((s) => s.key !== song.key)] : before.likes.filter((s) => s.key !== song.key);
    set({ likes, likedKeys: new Set(likes.map((x) => x.key)) });
    try {
      if (on) await api.post('/api/likes', { song });
      else await api.post('/api/likes/remove', { key: song.key });
      if (on) toast('Añadida a Favoritas');
      else toast('Quitada de Favoritas', { action: 'Deshacer', onAction: () => get().setLike(track, true) });
    } catch (err) {
      set(before);
      toast(err.message);
    }
  },

  // ---- lists ----
  async importList(url) {
    const r = await api.post('/api/lists/import', { url });
    await get().refreshLists();
    if (r.profile) toast(`${r.created.length} listas de ${r.profile.name}${r.skipped ? ` (${r.skipped} ya estaban)` : ''}`);
    else toast(`«${r.name}» añadida (${r.tracks.length} canciones)`);
    return r;
  },
  async createList(name, tracks = []) {
    const l = await api.post('/api/lists', { name, tracks });
    get()._putList(l);
    return l;
  },
  /** A list that fills itself from `q` (looked up now, then every `every` hours). */
  async createAutoList(q, every = 24, folder = null) {
    const l = await api.post('/api/lists/auto', { q, every, folder });
    get()._putList(l);
    toast(`«${l.name}»: ${l.tracks.length} canciones, sin descargar nada`);
    return l;
  },
  async addToList(id, tracks) {
    try {
      const l = await api.patch(urls.list(id), { add: tracks });
      get()._putList(l);
      toast(tracks.length === 1 ? `Añadida a «${l.name}»` : `${tracks.length} canciones añadidas a «${l.name}»`);
    } catch (err) { toast(err.message); }
  },
  async patchList(id, patch) {
    try { get()._putList(await api.patch(urls.list(id), patch)); } catch (err) { toast(err.message); }
  },
  /** Songs out of a list (with "Deshacer"); true when done. `message`: what the notice says instead. */
  async removeTracks(id, ns, { message = null } = {}) {
    try {
      const r = await api.post(`${urls.list(id)}/remove`, { ns });
      get()._putList(r.list);
      toast(message || (ns.length === 1 ? 'Quitada de la lista' : `${ns.length} canciones quitadas`), { action: 'Deshacer', onAction: () => get().patchList(id, { insert: r.removed }) });
      return true;
    } catch (err) { toast(err.message); return false; }
  },
  /** «Quitar duplicadas»: the same song again further down goes (with "Deshacer"). */
  async dedupeList(id) {
    try {
      const r = await api.post(`${urls.list(id)}/dedupe`);
      get()._putList(r.list);
      const n = r.removed.length;
      if (!n) toast('No hay canciones repetidas');
      else toast(n === 1 ? '1 canción repetida quitada' : `${n} canciones repetidas quitadas`, { action: 'Deshacer', onAction: () => get().patchList(id, { insert: r.removed }) });
    } catch (err) { toast(err.message); }
  },
  async refreshList(id) {
    try {
      const l = await api.post(`${urls.list(id)}/refresh`);
      get()._putList(l);
      // A list that fills itself says how many it found.
      if (Number.isInteger(l.added)) toast(l.added ? `${l.added === 1 ? '1 canción nueva' : `${l.added} canciones nuevas`} en «${l.name}»` : 'No hay canciones nuevas por ahora');
      else toast('Lista actualizada');
    } catch (err) { toast(err.message); }
  },
  async deleteList(id) {
    const name = (get().lists.find((l) => l.id === id) || {}).name || 'la lista';
    try {
      await api.del(urls.list(id));
      set((s) => ({ lists: s.lists.filter((l) => l.id !== id) }));
      toast(`«${name}» eliminada`, {
        action: 'Deshacer',
        onAction: async () => { try { get()._putList(await api.post(`${urls.list(id)}/restore`)); } catch (err) { toast(err.message); } },
      });
    } catch (err) { toast(err.message); }
  },

  // ---- your folder ----
  async rescanLocal() {
    try { set({ local: await api.post('/api/local/rescan') }); } catch (err) { toast(err.message); }
  },
}));

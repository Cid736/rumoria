// «No me recomiendes esto»: songs and artists you don't want suggested. The
// server leaves them out of radios, Explorar, news and the lists that fill
// themselves; here they also stay out of what the page puts together itself
// ("Para hoy", "Descubre", radios for you, "Si te gusta", daily mixes).
import { create } from 'zustand';
import { api } from '../api.js';
import { keyOf } from '../lib/tracks.js';
import { useUi } from './ui.js';

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
/** An artist's name, comparable (as the server does it): no "- Topic", "VEVO", "Official" or symbols. */
export function artistKey(name) {
  return fold(name).replace(/ ?- ?topic$/, '').replace(/vevo$/, '').replace(/(?<![\p{L}\p{N}])(official|oficial)(?![\p{L}\p{N}])/gu, ' ')
    .replace(/[^\p{L}\p{N}&' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** Who a song is by: "Artist - Title" when its title says so, and its artist (or channel). */
export function artistsOf(t) {
  const m = /^(.{1,80}?) [-–—] /.exec(String((t && t.title) || '').slice(0, 300));
  return [m ? artistKey(m[1]) : '', artistKey(t && t.artist)].filter(Boolean);
}
/** The artist to offer hiding for a song: its first one, as shown. */
export function mainArtistOf(t) {
  // Spaces made single first, so the split needs no "\s*" (that could backtrack).
  const all = String((t && t.artist) || '').slice(0, 300).replace(/\s+/g, ' ');
  const cut = all.search(/,|&|;| feat\.? | ft\.? /i);
  return (cut >= 0 ? all.slice(0, cut) : all).replace(/ - Topic$/, '').trim().slice(0, 120);
}

const index = (songs, artists) => ({ songKeys: new Set(songs.map((s) => s.key)), artistKeys: new Set(artists.map((a) => artistKey(a.name))) });

export const useHidden = create((set, get) => ({
  songs: [],
  artists: [],
  songKeys: new Set(),
  artistKeys: new Set(),

  async load() {
    try { const r = await api.get('/api/hidden'); set({ songs: r.songs || [], artists: r.artists || [], ...index(r.songs || [], r.artists || []) }); } catch { /* none */ }
  },
  _put(r) { set({ songs: r.songs || [], artists: r.artists || [], ...index(r.songs || [], r.artists || []) }); },

  /** Is this song not to be suggested? */
  hides(t) {
    if (!t) return false;
    const { songKeys, artistKeys } = get();
    const k = keyOf(t);
    if (k && songKeys.has(k)) return true;
    return artistKeys.size > 0 && artistsOf(t).some((a) => artistKeys.has(a));
  },

  async hideSong(t) {
    const key = keyOf(t);
    if (!key) return;
    try {
      get()._put(await api.post('/api/hidden', { song: { key, title: t.title, artist: t.artist || '' } }));
      useUi.getState().toast('No te la recomendaremos más', { action: 'Deshacer', onAction: () => get().showSong(key) });
    } catch (err) { useUi.getState().toast(err.message); }
  },
  async hideArtist(name) {
    if (!name) return;
    try {
      get()._put(await api.post('/api/hidden', { artist: name }));
      useUi.getState().toast(`No te recomendaremos más a ${name}`, { action: 'Deshacer', onAction: () => get().showArtist(name) });
    } catch (err) { useUi.getState().toast(err.message); }
  },
  async showSong(key) { try { get()._put(await api.post('/api/hidden/remove', { key })); } catch (err) { useUi.getState().toast(err.message); } },
  async showArtist(name) { try { get()._put(await api.post('/api/hidden/remove', { artist: name })); } catch (err) { useUi.getState().toast(err.message); } },
}));

/** Only the songs that may be suggested. */
export const notHidden = (tracks) => { const h = useHidden.getState(); return (tracks || []).filter((t) => !h.hides(t)); };

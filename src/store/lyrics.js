// v1.7: what goes under each line of the lyrics — nothing, the line in Latin
// letters (Korean, Japanese kana, Cyrillic, Greek; worked out here) or in
// Spanish (sent to the translator, only once you allow it, which the server
// also checks). The choice is kept in this computer's browser storage; the
// permission to translate lives in the server's prefs.
import { create } from 'zustand';
import { api } from '../api.js';

const KEY = 'rumoria_lyrics';
export const EXTRAS = [['none', 'Solo la letra'], ['roman', 'En letras latinas'], ['trans', 'En español']];
const savedExtra = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return EXTRAS.some(([k]) => k === (v && v.extra)) ? v.extra : 'none'; } catch { return 'none'; } };

export const useLyricsPrefs = create((set, get) => ({
  extra: savedExtra(),
  translate: null, // may lyrics be sent to the translator? (null: not asked yet)

  async load() {
    try { const p = await api.get('/api/prefs'); set({ translate: p.translate === true }); } catch { /* keep */ }
  },
  setExtra(extra) {
    if (!EXTRAS.some(([k]) => k === extra)) return;
    try { localStorage.setItem(KEY, JSON.stringify({ extra })); } catch { /* only for now */ }
    set({ extra });
  },
  async allowTranslate(on) {
    const p = await api.patch('/api/prefs', { translate: Boolean(on) });
    set({ translate: p.translate === true });
    if (!p.translate && get().extra === 'trans') get().setExtra('none');
    return p.translate === true;
  },
}));

/**
 * "En español" chosen: straight away if allowed, else a question first (the
 * lyrics leave this computer). `ask(dialog)` opens it.
 */
export async function chooseExtra(extra, ask) {
  const s = useLyricsPrefs.getState();
  if (extra !== 'trans') { s.setExtra(extra); return; }
  if (s.translate === null) await s.load();
  if (useLyricsPrefs.getState().translate) { s.setExtra('trans'); return; }
  ask({
    kind: 'confirm', title: 'Traducir las letras',
    text: 'Para traducirla, la letra de la canción que suena se envía a Google Translate (solo la letra, nada sobre ti). Cada traducción se guarda en este ordenador y no se vuelve a pedir. Se apaga cuando quieras en Ajustes → Letras.',
    confirm: 'Traducir',
    onConfirm: async () => { if (await useLyricsPrefs.getState().allowTranslate(true)) useLyricsPrefs.getState().setExtra('trans'); },
  });
}

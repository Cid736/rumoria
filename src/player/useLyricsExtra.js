// v1.7: the line to show under each line of the lyrics (Letra panel and
// "Sonando"): in Latin letters, worked out here, or in Spanish, asked of the
// server once per song. Lines line up with the lyrics' own: the synced ones,
// or the plain text split by line.
import { useEffect, useMemo, useState } from 'react';
import { api, urls } from '../api.js';
import { romanize, scriptOf } from '../lib/romanize.js';
import { useLyricsPrefs } from '../store/lyrics.js';

/** The lyrics' lines, as the extra lines follow them. */
export const linesOf = (lyrics) => (lyrics.synced ? lyrics.synced.map((l) => l.text || '') : lyrics.plain ? lyrics.plain.split('\n') : null);

/**
 * → { extra, script, lines (one per lyrics line, '' when there's nothing to
 * add) | null, note (why there are none, or what's going on) | null }.
 */
export function useLyricsExtra(cur, lyrics) {
  const extra = useLyricsPrefs((s) => s.extra);
  const allowed = useLyricsPrefs((s) => s.translate);
  const yt = cur && cur.yt;
  const base = useMemo(() => linesOf(lyrics), [lyrics]);
  const script = useMemo(() => (base ? scriptOf(base) : null), [base]);
  const roman = useMemo(() => (extra === 'roman' && script && base ? base.map((l) => { const r = romanize(l); return r === l.trim() ? '' : r; }) : null), [extra, script, base]);
  const [tr, setTr] = useState({ for: null, lines: null, note: null });
  const want = extra === 'trans' && allowed && Boolean(yt) && Boolean(base);

  useEffect(() => { if (extra === 'trans' && allowed === null) useLyricsPrefs.getState().load(); }, [extra, allowed]);
  useEffect(() => {
    if (!want) return undefined;
    let gone = false;
    const known = Boolean(cur.list);
    api.get(urls.translation(yt, known ? cur.artist : undefined, known ? cur.title : undefined, cur.duration))
      .then((r) => {
        if (gone) return;
        if (r.same) setTr({ for: yt, lines: null, note: 'La letra ya está en español.' });
        else if (!Array.isArray(r.lines) || r.lines.length !== base.length) setTr({ for: yt, lines: null, note: 'No se pudo traducir esta letra.' });
        else setTr({ for: yt, lines: r.lines.map((l, i) => (l && l !== base[i].trim() ? l : '')), note: null });
      })
      .catch((err) => { if (!gone) setTr({ for: yt, lines: null, note: err.message || 'No se pudo traducir esta letra.' }); });
    return () => { gone = true; };
    // Once per song (and when it's allowed or chosen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want, yt]);

  if (!base || extra === 'none') return { extra, script, lines: null, note: null };
  if (extra === 'roman') return { extra, script, lines: roman, note: script ? null : 'Esta letra ya está en letras latinas.' };
  if (!allowed) return { extra, script, lines: null, note: null };
  if (tr.for !== yt) return { extra, script, lines: null, note: 'Traduciendo…' };
  return { extra, script, lines: tr.lines, note: tr.note };
}

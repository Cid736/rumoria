// The lyrics of the song playing (LRCLIB, through the server), for the
// Letra panel and the full-screen "Sonando": synced lines when there are,
// else the plain text. Looked up once per song.
import { useEffect, useState } from 'react';
import { api, urls } from '../api.js';

/** → { synced, plain, loading } for `cur` (a song, or null). */
export function useLyrics(cur) {
  const [found, setFound] = useState({ for: null, synced: null, plain: null });
  const yt = cur && cur.yt;
  useEffect(() => {
    if (!yt) return undefined;
    let gone = false;
    // A song from one of your lists knows its real artist and title; for a
    // video, the server reads them from it better than its channel's name.
    const known = Boolean(cur.list);
    api.get(urls.lyrics(yt, known ? cur.artist : undefined, known ? cur.title : undefined, cur.duration))
      .then((r) => { if (!gone) setFound({ for: yt, synced: r.synced, plain: r.plain }); })
      .catch(() => { if (!gone) setFound({ for: yt, synced: null, plain: null }); });
    return () => { gone = true; };
    // Only when the song changes (not its title being filled in).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yt]);
  return found.for === yt ? { synced: found.synced, plain: found.plain, loading: false } : { synced: null, plain: null, loading: Boolean(yt) };
}

/** The line being sung at `position` (-1 before the first). */
export const lineIndex = (synced, position) => (synced ? synced.reduce((at, l, i) => (l.t <= position + 0.25 ? i : at), -1) : -1);

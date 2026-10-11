// v1.7: yt-dlp's state as the desktop app tells it (version, updating, the
// last look, and whether songs are failing as when YouTube changes something).
import { useEffect, useState } from 'react';
import { desktop } from '../api.js';

export function useYtDlp() {
  const [s, setS] = useState(null);
  useEffect(() => {
    if (!desktop || !desktop.ytdlp) return undefined;
    let gone = false;
    desktop.ytdlp.state().then((x) => { if (!gone && x) setS(x); }, () => {});
    const off = desktop.ytdlp.onState((x) => { if (!gone) setS(x); });
    return () => { gone = true; off(); };
  }, []);
  return s;
}

/** What to say about it, in a line. */
export function ytDlpText(s) {
  if (!s) return '';
  if (s.updating) return 'Buscando una versión nueva…';
  const when = s.lastAt || s.checkedAt;
  const ago = when ? `, mirado ${new Date(when).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '';
  if (s.last === 'updated') return `Actualizado a la ${s.version || 'última versión'}${ago}.`;
  if (s.last === 'failed') return `No se pudo buscar una versión nueva (¿sin conexión?)${ago}.`;
  return `${s.version ? `Versión ${s.version}` : 'Versión desconocida'}${ago}.`;
}

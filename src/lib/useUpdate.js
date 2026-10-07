// The desktop app's update state, live: checking, downloading (with %), ready
// to restart. null in a plain browser (development).
import { useEffect, useState } from 'react';
import { desktop } from '../api.js';

export function useUpdate() {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!desktop || !desktop.update) return undefined;
    let gone = false;
    desktop.update.state().then((s) => { if (!gone && s) setState(s); }, () => {});
    const stop = desktop.update.onState((s) => { if (!gone) setState(s); });
    return () => { gone = true; stop(); };
  }, []);
  return state;
}

/** What to say about it in Ajustes. */
export function updateText(s) {
  if (!s) return '';
  switch (s.status) {
    case 'dev': return 'Versión de desarrollo: no se actualiza.';
    case 'checking': return 'Buscando actualizaciones…';
    case 'up-to-date': return 'Tienes la última versión.';
    case 'downloading': return `Descargando la versión ${s.latest}${Number.isInteger(s.percent) ? ` (${s.percent} %)` : ''}…`;
    case 'ready': return `La versión ${s.latest} está lista. Se instala al reiniciar o al cerrar Rumoria.`;
    case 'error': return `No se pudo comprobar: ${s.error}. Se reintentará sola.`;
    default: return 'Se busca sola al abrir Rumoria y cada 6 horas.';
  }
}

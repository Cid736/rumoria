// v1.7: a clear notice when songs from YouTube keep failing (as when YouTube
// changes something): what Rumoria is doing about it (updating yt-dlp at
// once) and how that went. Goes away by itself when songs play again.
import { useState } from 'react';
import { useYtDlp } from '../lib/useYtDlp.js';
import { Close } from './Icons.jsx';

/** What the notice says for this state, or null (no notice). */
export function noticeText(s) {
  if (!s || !s.trouble) return null;
  if (s.updating) return 'YouTube no está dejando poner canciones. Rumoria está actualizando yt-dlp, lo que las encuentra; tarda un momento.';
  if (s.last === 'updated') return `yt-dlp actualizado${s.version ? ` a la ${s.version}` : ''}: vuelve a poner la canción.`;
  if (s.last === 'current') return 'Las canciones de YouTube no cargan y ya tienes el yt-dlp más nuevo: puede que YouTube esté fallando ahora o que aún no haya arreglo. Prueba en un rato; tu música local sí suena.';
  if (s.last === 'failed') return 'Las canciones de YouTube no cargan y no se pudo actualizar yt-dlp. ¿Hay conexión a Internet?';
  return 'Las canciones de YouTube no están cargando.';
}

export default function YouTubeNotice() {
  const s = useYtDlp();
  const [closed, setClosed] = useState(null);
  const text = noticeText(s);
  if (!text || closed === text) return null;
  return (
    <div className={`yt-notice ${s.updating ? 'busy' : ''}`} role="status" aria-live="polite">
      <span>{text}</span>
      <button type="button" className="icon-btn" aria-label="Cerrar el aviso" onClick={() => setClosed(text)}><Close size={16} /></button>
    </div>
  );
}

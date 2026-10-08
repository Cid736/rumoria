// v1.5: drop a link anywhere on the window. A YouTube video plays at once
// (with similar songs after); a Spotify, Apple Music or YouTube list is
// imported and opened. While a link is over the window, a note says so.
import { useEffect, useState } from 'react';
import { api, urls } from '../api.js';
import { carriesLink, classifyLink, linkOf } from '../lib/links.js';
import { fromYouTube } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { usePlayer } from '../store/player.js';
import { useUi } from '../store/ui.js';
import { radioOf } from '../views/recommend.js';

const toast = (t) => useUi.getState().toast(t);

/** What a dropped (or pasted) link does. */
export async function openLink(raw) {
  const l = classifyLink(raw);
  if (!l) { toast('Ese enlace no es de una canción o lista de YouTube, Spotify o Apple Music.'); return false; }
  if (l.kind === 'song') {
    try {
      const info = await api.get(urls.info(l.yt));
      const t = fromYouTube({ ...info, id: l.yt, artist: info.artist || undefined, title: info.track && info.artist ? info.track : info.title });
      usePlayer.getState().playTracks([t], 0);
      toast(`Sonando «${t.title}»`);
      // Similar songs after it, as "Radio de esta canción".
      radioOf({ yt: l.yt }).then((more) => { const p = usePlayer.getState(); if (p.current() && p.current().yt === l.yt && more.length) p.enqueue(more.slice(0, 30), 'end'); }, () => {});
    } catch (err) { toast(err.message); return false; }
    return true;
  }
  toast('Importando la lista…');
  try {
    const r = await useLibrary.getState().importList(l.url);
    if (r && r.id) useUi.getState().go({ name: 'list', id: r.id });
    return true;
  } catch (err) { toast(err.message); return false; }
}

export default function DropLink() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const enter = (e) => { if (!carriesLink(e.dataTransfer)) return; e.preventDefault(); depth++; setOver(true); };
    const overFn = (e) => { if (!carriesLink(e.dataTransfer)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
    const leave = (e) => { if (!carriesLink(e.dataTransfer)) return; depth = Math.max(0, depth - 1); if (!depth) setOver(false); };
    const drop = (e) => {
      if (!carriesLink(e.dataTransfer)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      openLink(linkOf(e.dataTransfer));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', overFn);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', overFn); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, []);
  if (!over) return null;
  return (
    <div className="droplink" aria-live="polite">
      <div className="droplink-card">
        <strong>Suelta el enlace</strong>
        <span>Una canción de YouTube suena al momento; una lista de Spotify, Apple Music o YouTube se importa.</span>
      </div>
    </div>
  );
}

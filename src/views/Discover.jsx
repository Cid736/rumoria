// Lists you don't have to make: "Explorar" (ready-made), songs like one you
// play ("Parecidas a…") and "Descubre algo nuevo" (weekly, only new to you).
import { useEffect, useState } from 'react';
import { fromYouTube } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { useUi } from '../store/ui.js';
import { Plus } from '../components/Icons.jsx';
import Collection, { BigCover } from './Collection.jsx';
import { discoverOf, radioOf, seedsOf } from './recommend.js';

/** "Guardar como lista": these songs become a list of yours. */
function SaveButton({ name, tracks }) {
  const [saved, setSaved] = useState(false);
  return (
    <button type="button" className="btn btn-ghost save-list" disabled={!tracks.length || saved}
      onClick={async () => { const l = await useLibrary.getState().saveAsList(name, tracks); if (l) { setSaved(true); useUi.getState().go({ name: 'list', id: l.id }); } }}>
      <Plus size={16} /> {saved ? 'Guardada' : 'Guardar como lista'}
    </button>
  );
}

/** Loads something once per `key`; `{ key, value, error }` (the rest is still loading). */
function useLoad(key, load) {
  const [got, setGot] = useState({ key: null, value: null, error: null });
  useEffect(() => {
    let gone = false;
    load().then((value) => { if (!gone) setGot({ key, value, error: null }); }, (err) => { if (!gone) setGot({ key, value: null, error: err.message }); });
    return () => { gone = true; };
    // Once per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return got.key === key ? got : { key, value: null, error: null, loading: true };
}

export function BrowsePage({ id }) {
  const summary = useLibrary((s) => s.browse.find((b) => b.id === id));
  const got = useLoad(id, () => useLibrary.getState().loadBrowse(id));
  const tracks = got.value ? got.value.tracks.map(fromYouTube) : [];
  const name = (got.value && got.value.name) || (summary && summary.name) || 'Explorar';
  if (got.error) return <p className="muted pad">{got.error}</p>;
  return (
    <Collection kind={summary && summary.group === 'radio' ? 'Radio' : 'Explorar'} name={name} sub={(got.value && got.value.sub) || (summary && summary.sub)}
      cover={<BigCover thumbs={tracks.map((t) => t.thumbnail).filter(Boolean)} name={name} />}
      tracks={tracks} loading={!got.value}
      recent={{ kind: 'browse', id, name, sub: (summary && summary.sub) || 'Explorar' }}
      actions={<SaveButton name={name} tracks={tracks} />}
      empty={<p className="muted pad">YouTube no ha devuelto canciones ahora mismo. Prueba en un rato.</p>} />
  );
}

/**
 * A radio: songs like one. `payload` says which song and what to call it
 * ({ title, artist, thumb, name? }); without it, the song is looked up in your history.
 */
export function RadioPage({ id, payload = null }) {
  const smart = useLibrary((s) => s.smart);
  const known = [...((smart && smart.top) || []), ...((smart && smart.lately) || [])].find((r) => r.yt === id);
  const seed = { yt: id, title: 'esta canción', artist: '', thumb: null, ...(known || {}), ...(payload || {}) };
  const got = useLoad(id, () => radioOf(seed));
  const name = seed.name || (seed.artist ? `Radio de ${seed.artist}` : `Parecidas a «${seed.title}»`);
  const tracks = got.value ? [{ ...seed, key: `yt:${id}`, thumbnail: seed.thumb, duration: null }, ...got.value].filter((t, i) => i > 0 || t.title !== 'esta canción') : [];
  if (got.error) return <p className="muted pad">{got.error}</p>;
  return (
    <Collection kind="Radio" name={name} sub={`Empieza con «${seed.title}»${seed.artist ? `, de ${seed.artist}` : ''}`}
      cover={<BigCover src={seed.thumb} name={seed.artist || seed.title} />} tracks={tracks} loading={!got.value}
      recent={{ kind: 'radio', id, name, sub: seed.artist ? `${seed.artist} y parecidos` : 'Radio', payload: { title: seed.title, artist: seed.artist, thumb: seed.thumb, name: seed.name || null } }}
      actions={<SaveButton name={name} tracks={tracks} />} />
  );
}

export function DiscoverPage() {
  const smart = useLibrary((s) => s.smart);
  const got = useLoad(smart ? 'discover' : 'discover-wait', () => (smart ? discoverOf(smart) : new Promise(() => {})));
  const tracks = got.value || [];
  const name = 'Descubre algo nuevo';
  if (got.error) return <p className="muted pad">{got.error}</p>;
  return (
    <Collection kind="Recomendado para ti" name={name} sub="Canciones que aún no has escuchado · cambia cada semana"
      cover={<BigCover name={name} thumbs={tracks.map((t) => t.thumbnail).filter(Boolean)} />} tracks={tracks} loading={!got.value}
      recent={{ kind: 'discover', name, sub: 'Cambia cada semana' }}
      actions={<SaveButton name={`${name} (${new Date().toLocaleDateString()})`} tracks={tracks} />}
      empty={<p className="muted pad">Escucha unas cuantas canciones y aquí aparecerán otras nuevas parecidas.</p>} />
  );
}

export { seedsOf };

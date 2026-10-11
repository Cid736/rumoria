// Ajustes → Sincronizar (v1.10): your lists, Favoritas and smart lists the
// same on your PC, Mac and phone. No account: a code of 6 words joins them.
// Make it on one device, type it on the other. The code stays on your
// devices; the cloud only gets your library encrypted with it.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { HERE } from '../lib/android.js';
import { useLibrary } from '../store/library.js';
import { useUi } from '../store/ui.js';

/** "hace 3 min" */
export function agoText(at, now = Date.now()) {
  if (!at) return 'aún no';
  const m = Math.round((now - at) / 60_000);
  if (m < 1) return 'ahora mismo';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(at).toLocaleDateString();
}

export default function SyncSettings() {
  const [s, setS] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null); // what's going on: 'create' | 'join' | 'now' | 'leave'
  const toast = useUi.getState().toast;
  useEffect(() => { api.get('/api/sync').then(setS, () => {}); }, []);
  // While it's working on its own (or just after), what it says is kept fresh.
  useEffect(() => {
    if (!s || !s.syncing) return undefined;
    const t = setTimeout(() => api.get('/api/sync').then(setS, () => {}), 1500);
    return () => clearTimeout(t);
  }, [s]);

  const run = async (what, call, done) => {
    setBusy(what);
    try {
      const next = await call();
      setS(next);
      await useLibrary.getState().loadAll();
      if (done) toast(done(next));
    } catch (err) { toast(err.message); } finally { setBusy(null); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(s.code); toast('Código copiado'); } catch { toast('No se pudo copiar: escríbelo a mano'); }
  };
  const leave = (wipe) => useUi.getState().openDialog({
    kind: 'confirm',
    title: wipe ? 'Borrar de la nube' : 'Dejar de sincronizar aquí',
    text: wipe
      ? `Se borra la copia cifrada de la nube y ${HERE} deja de sincronizar. Tus listas se quedan en cada dispositivo, pero los demás ya no recibirán cambios.`
      : `${HERE[0].toUpperCase()}${HERE.slice(1)} deja de sincronizar; tus listas se quedan aquí. Los demás dispositivos siguen con el código.`,
    confirm: wipe ? 'Borrar' : 'Dejar de sincronizar',
    onConfirm: () => run('leave', () => api.post('/api/sync/leave', { wipe }), () => (wipe ? 'Borrado de la nube' : 'Ya no se sincroniza aquí')),
  });

  if (!s) return null;
  return (
    <section className="set-group sync">
      <h2>Sincronizar</h2>
      <p className="muted">
        Tus listas, Favoritas y listas inteligentes, iguales en tu PC, tu Mac y tu móvil. Sin cuenta: un código de 6 palabras los une.
        No hace falta tenerlos encendidos a la vez. Se guardan cifradas con tu código, y el código no sale de tus dispositivos: nadie más puede leerlas, ni nosotros.
      </p>
      {!s.available && <p className="muted"><strong>Aún no está disponible en esta versión.</strong></p>}

      {s.available && !s.enabled && (
        <>
          <div className="set-row">
            <span><strong>Empezar en {HERE}</strong><small>Crea un código; luego lo escribes en tus otros dispositivos.</small></span>
            <button type="button" className="btn btn-accent" disabled={Boolean(busy)} onClick={() => run('create', () => api.post('/api/sync/create'), () => 'Listo: escribe el código en tu otro dispositivo')}>
              {busy === 'create' ? 'Creando…' : 'Crear código'}
            </button>
          </div>
          <form className="set-row sync-join" onSubmit={(e) => { e.preventDefault(); if (code.trim()) run('join', () => api.post('/api/sync/join', { code }), () => 'Unido: tus listas ya están aquí'); }}>
            <span><strong>Ya tengo un código</strong><small>Escribe las 6 palabras de tu otro dispositivo (da igual con mayúsculas o sin tildes). Lo que tengas aquí se junta con lo de allí.</small></span>
            <span className="sync-join-box">
              <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="palabra palabra palabra…" aria-label="Código de sincronización"
                autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={200} />
              <button type="submit" className="btn btn-ghost" disabled={Boolean(busy) || !code.trim()}>{busy === 'join' ? 'Uniendo…' : 'Unir'}</button>
            </span>
          </form>
        </>
      )}

      {s.enabled && (
        <>
          <div className="sync-code" aria-label="Tu código">
            {s.code.split('-').map((w, i) => <span key={`${w}-${i}`} className="sync-word"><small>{i + 1}</small>{w}</span>)}
          </div>
          <p className="muted sync-hint">
            En tu otro dispositivo: Ajustes → Sincronizar → «Ya tengo un código», y escribe estas palabras.
            <strong> Guárdalo como una contraseña:</strong> quien lo tenga puede ver y cambiar tus listas.
          </p>
          <div className="set-row">
            <span>
              <strong>{s.syncing || busy === 'now' ? 'Sincronizando…' : s.error ? 'No se pudo sincronizar' : `Sincronizado ${agoText(s.lastAt)}`}</strong>
              <small>{s.error || 'Se pone al día al abrir Rumoria, cada 5 minutos y cuando cambias algo.'}</small>
            </span>
            <span className="sync-actions">
              <button type="button" className="btn btn-ghost" onClick={copy}>Copiar código</button>
              <button type="button" className="btn btn-ghost" disabled={Boolean(busy) || s.syncing} onClick={() => run('now', () => api.post('/api/sync/now'), (n) => (n.error ? n.error : 'Sincronizado'))}>Sincronizar ahora</button>
            </span>
          </div>
          <div className="set-row">
            <span><strong>Dejar de sincronizar</strong><small>Aquí solo, o borrando también la copia de la nube.</small></span>
            <span className="sync-actions">
              <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => leave(false)}>Solo aquí</button>
              <button type="button" className="btn btn-danger" disabled={Boolean(busy)} onClick={() => leave(true)}>Borrar de la nube</button>
            </span>
          </div>
        </>
      )}
    </section>
  );
}

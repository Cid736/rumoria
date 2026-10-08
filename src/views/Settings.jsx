// Ajustes: the look and how to customise it, the mini player, your music folder, "Para ti", the listening history (pause, wipe).
import { useEffect, useState } from 'react';
import { api, desktop } from '../api.js';
import { updateText, useUpdate } from '../lib/useUpdate.js';
import { useLibrary } from '../store/library.js';
import { useUi } from '../store/ui.js';
import { HiddenSettings, ShortcutSettings } from './MoreSettings.jsx';
import { Customize, MiniSettings, PerfSettings, PlaybackSettings } from './Customize.jsx';

const ROTATE = [[3, 'Cada 3 días'], [7, 'Cada semana'], [14, 'Cada 2 semanas']];

/** Updates: which version, what's going on, look now, restart when one is ready. */
function Updates() {
  const u = useUpdate();
  if (!u) return null;
  const busy = u.status === 'checking' || u.status === 'downloading';
  return (
    <section className="set-group">
      <h2>Actualizaciones</h2>
      <p className="muted">Rumoria se actualiza sola desde GitHub: descarga la versión nueva en segundo plano y solo la usa si su huella SHA-256 coincide con la publicada. Tus listas y tu historial no se tocan.</p>
      <div className="set-row">
        <span><strong>Versión {u.current}</strong><small>{updateText(u)}</small></span>
        {u.status === 'ready'
          ? <button type="button" className="btn btn-accent" onClick={() => desktop.update.restart()}>Reiniciar y actualizar</button>
          : <button type="button" className="btn btn-ghost" onClick={() => desktop.update.check()} disabled={busy || u.status === 'dev'}>{busy ? 'Buscando…' : 'Buscar ahora'}</button>}
      </div>
    </section>
  );
}

/** "Para ti": the lists Rumoria makes and rotates (your genres, one to discover). */
function ParaTi() {
  const [cur, setCur] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useUi.getState().toast;
  useEffect(() => { api.get('/api/curator').then(setCur, () => {}); }, []);
  const set = async (patch) => { try { setCur(await api.patch('/api/curator', patch)); } catch (err) { toast(err.message); } };
  const now = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/curator/run');
      setCur(r);
      await useLibrary.getState().refreshLists();
      toast(r.made || r.removed ? `«Para ti» renovada: ${r.made} listas nuevas` : '«Para ti» ya estaba al día');
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  };
  if (!cur) return null;
  return (
    <section className="set-group">
      <h2>Para ti</h2>
      <p className="muted">
        Listas que Rumoria crea y llena sola en la carpeta «Para ti»: al principio, unas de los estilos más populares (las mismas para todos; Rumoria no recoge datos de nadie); después, las de tus géneros
        y una para descubrir lo que más se parece a lo tuyo. No se descarga nada. Si cambias el nombre o la carpeta de una, pasa a ser tuya; si la borras, ese género no vuelve en un tiempo.
      </p>
      {cur.genres.length > 0 && <p className="muted"><strong>Tus géneros:</strong> {cur.genres.map((g) => g.name).join(', ')}</p>}
      <label className="set-row">
        <span><strong>Crear listas para mí</strong><small>Apagado, las que ya hay se quedan como están.</small></span>
        <input type="checkbox" className="switch" checked={cur.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
      </label>
      <label className="set-row">
        <span><strong>Renovar las listas</strong><small>{cur.next ? `Próxima vez: ${new Date(cur.next).toLocaleDateString()}` : 'Pronto'}</small></span>
        <select value={cur.every} onChange={(e) => set({ every: Number(e.target.value) })} disabled={!cur.enabled}>
          {ROTATE.map(([d, label]) => <option key={d} value={d}>{label}</option>)}
        </select>
      </label>
      <div className="set-row">
        <span><strong>Renovar ahora</strong><small>Vuelve a calcular tus géneros y cambia las listas que ya no encajan.</small></span>
        <button type="button" className="btn btn-ghost" onClick={now} disabled={busy || !cur.enabled}>{busy ? 'Buscando…' : 'Renovar'}</button>
      </div>
    </section>
  );
}

export default function Settings() {
  const theme = useUi((s) => s.theme);
  const smart = useLibrary((s) => s.smart);
  const [folder, setFolder] = useState(null);
  useEffect(() => { if (desktop) desktop.settings().then((s) => setFolder(s && s.musicDir)); }, []);
  const paused = Boolean(smart && smart.paused);
  const toast = useUi.getState().toast;

  const pick = async () => {
    const dir = await desktop.pickMusicDir();
    if (dir) { setFolder(dir); await useLibrary.getState().rescanLocal(); toast('Carpeta de música cambiada'); }
  };
  const setPaused = async (on) => {
    try { await api.patch('/api/history/settings', { paused: on }); await useLibrary.getState().refreshSmart(); } catch (err) { toast(err.message); }
  };
  const wipe = () => useUi.getState().openDialog({
    kind: 'prompt', title: 'Borrar el historial', label: 'Escribe BORRAR para confirmar', value: '', confirm: 'Borrar',
    onConfirm: async (v) => {
      if (v !== 'BORRAR') { toast('No se ha borrado nada'); return; }
      try { await api.del('/api/history'); await useLibrary.getState().refreshSmart(); toast('Historial borrado'); } catch (err) { toast(err.message); }
    },
  });

  return (
    <div className="settings">
      <h1>Ajustes</h1>
      <section className="set-group">
        <h2>Aspecto</h2>
        <label className="set-row">
          <span><strong>Tema</strong><small>Oscuro, claro o el de tu sistema.</small></span>
          <select value={theme} onChange={(e) => useUi.getState().setTheme(e.target.value)}>
            <option value="dark">Oscuro</option>
            <option value="light">Claro</option>
            <option value="system">El del sistema</option>
          </select>
        </label>
      </section>
      <Customize />
      <PlaybackSettings />
      <MiniSettings />
      <PerfSettings />
      {desktop && (
        <section className="set-group">
          <h2>Tu música</h2>
          <div className="set-row">
            <span><strong>Carpeta de música</strong><small>{folder || '—'}</small></span>
            <button type="button" className="btn btn-ghost" onClick={pick}>Cambiar…</button>
          </div>
        </section>
      )}
      <ParaTi />
      <HiddenSettings />
      <section className="set-group">
        <h2>Historial de escucha</h2>
        <p className="muted">Se guarda solo en este ordenador y alimenta «Hecho para ti» y las novedades de tus artistas.</p>
        <label className="set-row">
          <span><strong>Pausar el historial</strong><small>Mientras esté en pausa, no se anota lo que escuchas.</small></span>
          <input type="checkbox" className="switch" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
        </label>
        <div className="set-row">
          <span><strong>Borrar el historial</strong><small>{smart ? `${smart.count} escuchas guardadas` : ''}</small></span>
          <button type="button" className="btn btn-danger" onClick={wipe}>Borrar…</button>
        </div>
      </section>
      <Updates />
      <ShortcutSettings />
      <section className="set-group">
        <h2>Atajos de teclado (en la ventana)</h2>
        <dl className="keys">
          <dt>Espacio</dt><dd>Reproducir / pausa</dd>
          <dt>Ctrl + → / ←</dt><dd>Siguiente / anterior</dd>
          <dt>Ctrl + ↑ / ↓</dt><dd>Volumen</dd>
          <dt>Ctrl + S</dt><dd>Aleatorio</dd>
          <dt>Ctrl + R</dt><dd>Repetir</dd>
          <dt>Ctrl + M</dt><dd>Mini reproductor</dd>
          <dt>Ctrl + L</dt><dd>Buscar</dd>
          <dt>F11 o Ctrl + Mayús + F</dt><dd>Sonando a pantalla completa</dd>
          <dt>Alt + ← / →</dt><dd>Atrás / adelante</dd>
        </dl>
      </section>
    </div>
  );
}

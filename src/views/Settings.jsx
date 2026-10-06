// Ajustes: the look, your music folder, the listening history (pause, wipe).
import { useEffect, useState } from 'react';
import { api, desktop } from '../api.js';
import { useLibrary } from '../store/library.js';
import { useUi } from '../store/ui.js';

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
      {desktop && (
        <section className="set-group">
          <h2>Tu música</h2>
          <div className="set-row">
            <span><strong>Carpeta de música</strong><small>{folder || '—'}</small></span>
            <button type="button" className="btn btn-ghost" onClick={pick}>Cambiar…</button>
          </div>
        </section>
      )}
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
      <section className="set-group">
        <h2>Atajos de teclado</h2>
        <dl className="keys">
          <dt>Espacio</dt><dd>Reproducir / pausa</dd>
          <dt>Ctrl + → / ←</dt><dd>Siguiente / anterior</dd>
          <dt>Ctrl + ↑ / ↓</dt><dd>Volumen</dd>
          <dt>Ctrl + S</dt><dd>Aleatorio</dd>
          <dt>Ctrl + R</dt><dd>Repetir</dd>
          <dt>Ctrl + L</dt><dd>Buscar</dd>
          <dt>Alt + ← / →</dt><dd>Atrás / adelante</dd>
        </dl>
      </section>
    </div>
  );
}

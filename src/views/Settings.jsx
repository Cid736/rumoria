// Ajustes, by topic: a menu on the left (Aspecto, Reproducción,
// Recomendaciones, Privacidad, Mini reproductor, Atajos, Sistema) shows one
// topic at a time, and the search box above finds any setting by its name or
// what it's about, whatever topic it's in. The topic you were on is
// remembered on this computer.
import { useEffect, useMemo, useState } from 'react';
import { api, desktop } from '../api.js';
import { updateText, useUpdate } from '../lib/useUpdate.js';
import { fold } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import { useUi } from '../store/ui.js';
import { DiscordSettings, GuideSettings, HiddenSettings, LyricsSettings, SearchSettings, ShortcutSettings, YouTubeSettings } from './MoreSettings.jsx';
import { Customize, MiniSettings, PerfSettings, PlaybackSettings } from './Customize.jsx';
import AlarmSettings from '../components/AlarmSettings.jsx';
import { Gear, Keyboard, MiniPlayer, Moon, Play, Search, Shield, Sparkle } from '../components/Icons.jsx';

const ROTATE = [[3, 'Cada 3 días'], [7, 'Cada semana'], [14, 'Cada 2 semanas']];
const TAB_KEY = 'rumoria_settings_tab';

/** Updates: which version, what's going on, look now, restart when one is ready. */
function Updates() {
  const u = useUpdate();
  if (!u) return null;
  const busy = u.status === 'checking' || u.status === 'downloading';
  return (
    <section className="set-group">
      <h2>Actualizaciones</h2>
      <p className="muted">Rumoria se actualiza sola desde GitHub y solo instala una versión cuya huella SHA-256 coincide con la publicada. Tus listas y tu historial no se tocan.</p>
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
        Listas que Rumoria crea y llena sola en la carpeta «Para ti», según los géneros que escuchas, más una para descubrir algo parecido. No se descarga nada.
        Si cambias el nombre o la carpeta de una, pasa a ser tuya; si la borras, ese género no vuelve en un tiempo.
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

/** Listening history: pause it, wipe it, and the searches kept. */
function HistorySettings() {
  const smart = useLibrary((s) => s.smart);
  const paused = Boolean(smart && smart.paused);
  const toast = useUi.getState().toast;
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
    <section className="set-group">
      <h2>Historial de escucha</h2>
      <p className="muted">Se guarda solo en este ordenador y alimenta «Hecho para ti», tus estadísticas y las novedades de tus artistas.</p>
      <label className="set-row">
        <span><strong>Pausar el historial</strong><small>Mientras esté en pausa, no se anota lo que escuchas.</small></span>
        <input type="checkbox" className="switch" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
      </label>
      <div className="set-row">
        <span><strong>Borrar el historial</strong><small>{smart ? `${smart.count} escuchas guardadas` : ''}</small></span>
        <button type="button" className="btn btn-danger" onClick={wipe}>Borrar…</button>
      </div>
      <SearchSettings />
    </section>
  );
}

function MusicFolder() {
  const [folder, setFolder] = useState(null);
  useEffect(() => { if (desktop) desktop.settings().then((s) => setFolder(s && s.musicDir)); }, []);
  if (!desktop) return null;
  const pick = async () => {
    const dir = await desktop.pickMusicDir();
    if (dir) { setFolder(dir); await useLibrary.getState().rescanLocal(); useUi.getState().toast('Carpeta de música cambiada'); }
  };
  return (
    <section className="set-group">
      <h2>Tu música</h2>
      <div className="set-row">
        <span><strong>Carpeta de música</strong><small>{folder || '—'}</small></span>
        <button type="button" className="btn btn-ghost" onClick={pick}>Cambiar…</button>
      </div>
    </section>
  );
}

function AlarmSection() {
  return (
    <section className="set-group">
      <h2>Despertador</h2>
      <p className="muted">Una lista o una radio empieza a sonar a la hora que elijas, con el volumen subiendo poco a poco.</p>
      <AlarmSettings />
    </section>
  );
}

function WindowKeys() {
  return (
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
  );
}

// The topics, in the menu's order.
export const TABS = [
  ['look', 'Aspecto', Moon, 'Tema, colores y estilo'],
  ['play', 'Reproducción', Play, 'Al abrir, despertador, letras'],
  ['foryou', 'Recomendaciones', Sparkle, 'Para ti y lo que no quieres'],
  ['privacy', 'Privacidad', Shield, 'Historial, búsquedas, Discord'],
  ['mini', 'Mini reproductor', MiniPlayer, 'La ventana pequeña'],
  ['keys', 'Atajos', Keyboard, 'Teclas, también desde fuera'],
  ['system', 'Sistema', Gear, 'Carpeta, rendimiento, versiones'],
];

// Every section: its topic, and the words it can be found by (its own and what people would type).
export const SECTIONS = [
  { tab: 'look', id: 'customize', title: 'Personalizar', words: 'tema oscuro claro estilo windows mac color acento fondo tamaño texto letra densidad esquinas tipo de letra fuente biblioteca ancho portada animaciones inicio estanterías explorar radios rotación restablecer', C: Customize },
  { tab: 'look', id: 'guide', title: 'Guía de bienvenida', words: 'guía ayuda tutorial primeros pasos', C: GuideSettings },
  { tab: 'play', id: 'playback', title: 'Reproducción', words: 'seguir donde lo dejaste cola empezar a sonar al abrir bandeja cerrar segundo plano sonido ecualizador', C: PlaybackSettings },
  { tab: 'play', id: 'alarm', title: 'Despertador', words: 'despertador alarma hora días volumen subir mañana', C: AlarmSection },
  { tab: 'play', id: 'lyrics', title: 'Letras', words: 'letra letras traducir traducción español romanizar latinas coreano japonés karaoke', C: LyricsSettings },
  { tab: 'foryou', id: 'parati', title: 'Para ti', words: 'para ti listas géneros renovar recomendaciones', C: ParaTi },
  { tab: 'foryou', id: 'hidden', title: 'No me recomiendes', words: 'no me recomiendes ocultar artista canción recomendaciones', C: HiddenSettings },
  { tab: 'privacy', id: 'history', title: 'Historial de escucha', words: 'historial pausar borrar escuchas búsquedas recientes guardar privacidad', C: HistorySettings },
  { tab: 'privacy', id: 'discord', title: 'Discord', words: 'discord escuchando perfil rich presence estado', C: DiscordSettings },
  { tab: 'mini', id: 'mini', title: 'Mini reproductor', words: 'mini reproductor ventana pequeña compacto transparencia encima fijo portada', C: MiniSettings },
  { tab: 'keys', id: 'shortcuts', title: 'Atajos globales', words: 'atajos globales teclas combinación teclado', C: ShortcutSettings },
  { tab: 'keys', id: 'windowkeys', title: 'Atajos de teclado', words: 'atajos teclado teclas espacio ctrl', C: WindowKeys },
  { tab: 'system', id: 'music', title: 'Tu música', words: 'carpeta música archivos locales', C: MusicFolder },
  { tab: 'system', id: 'perf', title: 'Rendimiento', words: 'rendimiento perfil rápido lento ordenador animaciones visualizador', C: PerfSettings },
  { tab: 'system', id: 'updates', title: 'Actualizaciones', words: 'actualizaciones versión actualizar github', C: Updates },
  { tab: 'system', id: 'youtube', title: 'Reproducción desde YouTube', words: 'youtube yt-dlp no carga canciones fallan actualizar', C: YouTubeSettings },
];

/** The sections a search finds (every word typed must appear in its title or words). */
export function findSections(q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return SECTIONS.filter((s) => { const hay = fold(`${s.title} ${s.words}`); return words.every((w) => hay.includes(w)); });
}

function savedTab() { try { const t = localStorage.getItem(TAB_KEY); return TABS.some(([k]) => k === t) ? t : 'look'; } catch { return 'look'; } }

export default function Settings() {
  const [tab, setTabState] = useState(savedTab);
  const [q, setQ] = useState('');
  const setTab = (t) => { setTabState(t); setQ(''); try { localStorage.setItem(TAB_KEY, t); } catch { /* only for now */ } };
  const found = useMemo(() => findSections(q), [q]);
  const searching = q.trim().length > 0;
  const shown = searching ? found : SECTIONS.filter((s) => s.tab === tab);
  const label = (t) => (TABS.find(([k]) => k === t) || [])[1];

  return (
    <div className="settings">
      <div className="settings-head">
        <h1>Ajustes</h1>
        <label className="settings-search">
          <Search size={16} />
          <input type="search" placeholder="Buscar un ajuste (tema, despertador, Discord…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar en los ajustes"
            onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }} />
        </label>
      </div>
      <div className="settings-body">
        <nav className="settings-nav" aria-label="Temas de los ajustes">
          {TABS.map(([k, name, Icon, hint]) => (
            <button key={k} type="button" className={`settings-tab ${!searching && tab === k ? 'on' : ''}`} aria-current={!searching && tab === k ? 'page' : undefined} onClick={() => setTab(k)}>
              <Icon size={18} />
              <span><strong>{name}</strong><small>{hint}</small></span>
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {searching && (
            <p className="muted settings-found">
              {found.length ? `${found.length === 1 ? '1 sección' : `${found.length} secciones`} con «${q.trim()}»` : `Nada con «${q.trim()}». Prueba con otra palabra, como «tema», «letra» o «historial».`}
            </p>
          )}
          {shown.map(({ id, tab: t, C }) => (
            <div key={id} className="settings-section">
              {searching && <button type="button" className="settings-where" onClick={() => setTab(t)}>{label(t)} ›</button>}
              <C />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

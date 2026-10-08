// Playing in the background: an icon in the taskbar's tray while Rumoria is
// hidden there (if you chose "Al cerrar, seguir sonando en la bandeja"), with
// the song and its buttons — play/pause, next, previous, favourite — the next
// five songs (click one to jump to it), and "Abrir Rumoria" / "Salir". Its
// buttons go to the main window's player, like the mini player's.
const { Menu, Tray, nativeImage } = require('electron');

function createTray({ icon, main, now, send, quit }) {
  let tray = null;
  const label = (s, n) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);

  function showMain() {
    const m = main();
    if (!m || m.isDestroyed()) return;
    m.show();
    if (m.isMinimized()) m.restore();
    m.focus();
  }

  function menu() {
    const s = now() || {};
    const has = Boolean(s.title);
    const upcoming = (Array.isArray(s.queue) ? s.queue : []).slice(0, 5).map((q) => ({
      label: label(`${q.title}${q.artist ? ` · ${q.artist}` : ''}`, 60), click: () => send({ cmd: 'jump', value: q.i }),
    }));
    return Menu.buildFromTemplate([
      { label: has ? label(`${s.title}${s.artist ? ` · ${s.artist}` : ''}`, 60) : 'Nada sonando', enabled: false },
      { type: 'separator' },
      { label: s.playing ? 'Pausa' : 'Reproducir', enabled: has, click: () => send({ cmd: 'toggle' }) },
      { label: 'Siguiente', enabled: has, click: () => send({ cmd: 'next' }) },
      { label: 'Anterior', enabled: has, click: () => send({ cmd: 'prev' }) },
      { label: s.liked ? 'Quitar de Favoritas' : 'Añadir a Favoritas', enabled: has && s.canLike === true, click: () => send({ cmd: 'like' }) },
      ...(has && upcoming.length ? [{ type: 'separator' }, { label: 'A continuación', enabled: false }, ...upcoming] : []),
      { type: 'separator' },
      { label: 'Abrir Rumoria', click: showMain },
      { label: 'Salir', click: quit },
    ]);
  }

  function refresh() {
    if (!tray) return;
    const s = now() || {};
    tray.setToolTip(s.title ? label(`Rumoria · ${s.title}${s.artist ? ` · ${s.artist}` : ''}`, 120) : 'Rumoria');
    tray.setContextMenu(menu());
  }

  return {
    show() {
      if (tray) { refresh(); return; }
      const img = nativeImage.createFromPath(icon);
      tray = new Tray(img.isEmpty() ? img : img.resize({ width: 16, height: 16 }));
      tray.on('click', showMain);
      tray.on('double-click', showMain);
      refresh();
    },
    hide() { if (tray) { tray.destroy(); tray = null; } },
    refresh,
    isShown: () => Boolean(tray),
  };
}

module.exports = { createTray };

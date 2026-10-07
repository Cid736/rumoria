// The mini player's page: shows what the main window plays and sends its
// buttons back. Everything shown is text (textContent) or a YouTube cover
// already checked by the desktop app; nothing here can reach the disk.
(() => {
  const api = window.mini;
  const $ = (id) => document.getElementById(id);
  const root = $('mini');
  let state = null;
  let prefs = {};

  // Your look (theme and accent), the same as the main window's — also when
  // you change it there while this one is open (the browser tells every
  // window of the app when its storage changes).
  function applyLook() {
    const d = document.documentElement.dataset;
    try {
      const look = JSON.parse(localStorage.getItem('rumoria_look') || '{}');
      if (look && /^[a-z]{2,12}$/.test(look.accent || '') && look.accent !== 'coral') d.accent = look.accent; else delete d.accent;
      const theme = localStorage.getItem('rumoria_theme');
      d.theme = ['dark', 'light', 'system'].includes(theme) ? theme : 'dark';
    } catch { d.theme = 'dark'; }
  }
  applyLook();
  window.addEventListener('storage', (e) => { if (e.key === 'rumoria_look' || e.key === 'rumoria_theme' || e.key === null) applyLook(); });

  const clock = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function render() {
    const s = state;
    const has = Boolean(s && s.title);
    $('title').textContent = has ? s.title : 'Nada sonando';
    $('artist').textContent = has ? (s.artist || '') : 'Pon algo en Rumoria';
    document.title = has ? `${s.title} · Rumoria` : 'Rumoria · mini';
    const art = $('art');
    if (has && s.cover && prefs.showCover !== false) {
      if (art.getAttribute('src') !== s.cover) art.src = s.cover;
      art.hidden = false;
      $('artEmpty').hidden = true;
    } else {
      art.hidden = true;
      art.removeAttribute('src');
      $('artEmpty').hidden = false;
    }
    const play = $('play');
    play.textContent = has && s.playing ? '⏸' : '▶';
    play.setAttribute('aria-label', has && s.playing ? 'Pausa' : 'Reproducir');
    for (const id of ['play', 'prev']) $(id).disabled = !has;
    $('next').disabled = !has || !s.hasNext;
    const like = $('like');
    like.disabled = !has || !s.canLike;
    like.textContent = has && s.liked ? '♥' : '♡';
    like.classList.toggle('on', Boolean(has && s.liked));
    like.setAttribute('aria-pressed', String(Boolean(has && s.liked)));
    like.setAttribute('aria-label', has && s.liked ? 'Quitar de Favoritas' : 'Añadir a Favoritas');
    const d = has ? s.duration : 0;
    const t = has ? Math.min(s.time, d || s.time) : 0;
    $('fill').style.width = d ? `${(t / d) * 100}%` : '0%';
    const bar = $('bar');
    bar.setAttribute('aria-valuemax', String(Math.round(d)));
    bar.setAttribute('aria-valuenow', String(Math.round(t)));
    bar.setAttribute('aria-valuetext', `${clock(t)} de ${clock(d)}`);
    $('time').textContent = d ? `${clock(t)} / ${clock(d)}` : clock(t);
  }

  function applyPrefs(p) {
    prefs = p || {};
    root.classList.toggle('compact', Boolean(prefs.compact));
    root.classList.toggle('no-cover', prefs.showCover === false);
    for (const el of document.querySelectorAll('[data-pref]')) {
      const k = el.dataset.pref;
      if (el.type === 'checkbox') el.checked = Boolean(prefs[k]);
      else if (Number.isFinite(prefs[k])) el.value = String(prefs[k]);
    }
    render();
  }

  api.onState((s) => { state = s; render(); });
  api.onPrefs(applyPrefs);

  // Buttons.
  $('play').addEventListener('click', () => api.command('toggle'));
  $('next').addEventListener('click', () => api.command('next'));
  $('prev').addEventListener('click', () => api.command('prev'));
  $('like').addEventListener('click', () => api.command('like'));
  $('close').addEventListener('click', () => api.close());
  $('main').addEventListener('click', () => api.showMain());
  const panel = $('menuPanel');
  $('menu').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    $('menu').setAttribute('aria-expanded', String(!panel.hidden));
  });
  for (const el of document.querySelectorAll('[data-pref]')) {
    el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
      api.setPrefs({ [el.dataset.pref]: el.type === 'checkbox' ? el.checked : Number(el.value) });
    });
  }

  // The bar: click (or arrows) to jump.
  const bar = $('bar');
  const seekAt = (clientX) => {
    if (!state || !state.duration) return;
    const r = bar.getBoundingClientRect();
    api.command('seek', Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * state.duration);
  };
  bar.addEventListener('pointerdown', (e) => { e.stopPropagation(); seekAt(e.clientX); });
  bar.addEventListener('keydown', (e) => {
    if (!state || !state.duration || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    api.command('seek', Math.max(0, Math.min(state.duration, state.time + (e.key === 'ArrowRight' ? 5 : -5))));
  });
  // Keys: Space plays / pauses; Esc closes the options.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) { panel.hidden = true; $('menu').setAttribute('aria-expanded', 'false'); }
    if (e.key === ' ' && e.target === document.body) { e.preventDefault(); api.command('toggle'); }
  });

  // Moved by dragging anywhere but its buttons, bar and options.
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, label, .bar, .menu')) return;
    drag = { x: e.screenX, y: e.screenY };
    root.setPointerCapture(e.pointerId);
    root.classList.add('dragging');
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.screenX - drag.x;
    const dy = e.screenY - drag.y;
    if (dx || dy) { api.move(dx, dy); drag = { x: e.screenX, y: e.screenY }; }
  });
  const stop = () => { drag = null; root.classList.remove('dragging'); };
  root.addEventListener('pointerup', stop);
  root.addEventListener('pointercancel', stop);
  // See-through until the pointer is over it (if so chosen).
  document.addEventListener('mouseenter', () => api.hover(true));
  document.addEventListener('mouseleave', () => api.hover(false));

  render();
})();

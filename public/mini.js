// The mini player v3's page: shows what the main window plays and sends its
// buttons back. Everything shown is text (textContent) or a YouTube cover
// already checked by the desktop app. The video clip (when it's on) comes
// from this app's own relay, without sound, kept in step with the song.
// v3: smooth bar (moves between updates), the next five songs to jump to,
// mute, the mouse wheel for volume (or, over the bar, to move in the song),
// keys, "Tarjeta" shape, snapping to the screen's edges, a long title that
// slides across.
(() => {
  const api = window.mini;
  const $ = (id) => document.getElementById(id);
  const root = $('mini');
  const video = $('video');
  let state = null;
  let prefs = {};
  let videoFor = null; // the video id whose clip is loaded
  let anchor = { t: 0, at: 0 }; // the time last told, and when (to move the bar in between)
  let lastLine = '';

  // Your look (theme and accent), the same as the main window's — also when
  // you change it there while this one is open.
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
  const COVER_RE = /^https:\/\/i\d?\.ytimg\.com\/[\w\-/.]+(\?[\w\-=&%.]*)?$/;
  const press = (el, on, label) => { el.classList.toggle('on', Boolean(on)); el.setAttribute('aria-pressed', String(Boolean(on))); if (label) el.setAttribute('aria-label', label); };
  const has = () => Boolean(state && state.title);
  const isCard = () => Boolean(prefs.card && !prefs.compact);

  // A short note in the middle (volume, a jump in the song).
  let flashTimer = null;
  function flash(text) {
    const el = $('flash');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.hidden = true; }, 900);
  }

  // ---- the clip: loaded for the song playing, muted, following its time ----
  function syncVideo() {
    const s = state;
    const on = Boolean(prefs.video && !prefs.compact);
    const want = Boolean(on && s && s.yt);
    $('clip').hidden = !on;
    root.classList.toggle('video', on);
    if (!want) {
      if (videoFor) { video.pause(); video.removeAttribute('src'); video.load(); videoFor = null; }
      return;
    }
    if (videoFor !== s.yt) {
      videoFor = s.yt;
      $('clipNote').hidden = true;
      video.src = `/api/stream/video?id=${encodeURIComponent(s.yt)}`;
    }
    if (Number.isFinite(s.time) && video.readyState >= 1 && Math.abs(video.currentTime - s.time) > 0.8) {
      try { video.currentTime = s.time; } catch { /* not yet */ }
    }
    if (s.playing && video.paused) video.play().catch(() => {});
    if (!s.playing && !video.paused) video.pause();
  }
  video.addEventListener('error', () => { if (videoFor) $('clipNote').hidden = false; });
  video.addEventListener('loadedmetadata', () => { if (state && Number.isFinite(state.time)) { try { video.currentTime = state.time; } catch { /* fine */ } } });

  // ---- the bar: where the song is now (moving smoothly while it plays) ----
  function timeNow() {
    if (!has()) return 0;
    const d = state.duration || 0;
    const t = state.playing && !state.loading ? anchor.t + (performance.now() - anchor.at) / 1000 : anchor.t;
    return d ? Math.min(t, d) : t;
  }
  function drawBar() {
    const d = has() ? state.duration : 0;
    const t = timeNow();
    $('fill').style.width = d ? `${(t / d) * 100}%` : '0%';
    $('now').textContent = clock(t);
    const bar = $('bar');
    bar.setAttribute('aria-valuemax', String(Math.round(d)));
    bar.setAttribute('aria-valuenow', String(Math.round(t)));
    bar.setAttribute('aria-valuetext', `${clock(t)} de ${clock(d)}`);
  }
  function tick() {
    if (has() && state.playing && !document.hidden) drawBar();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // A long title slides across (how far: what doesn't fit).
  function fitTitle() {
    const wrap = document.querySelector('.title-wrap');
    const t = $('title');
    wrap.classList.remove('long');
    const extra = t.scrollWidth - wrap.clientWidth;
    if (extra > 4) {
      wrap.classList.add('long');
      root.style.setProperty('--marquee', `-${extra + 8}px`);
      root.style.setProperty('--marquee-s', `${Math.max(4, extra / 30)}s`);
    }
  }

  function showLyric(line, next) {
    const el = $('lyric');
    const text = line ? `♪ ${line}` : '';
    if (text === lastLine) return;
    lastLine = text;
    // A soft change from one line to the next.
    el.classList.add('fade');
    setTimeout(() => { el.textContent = text; $('lyricNext').textContent = next || ''; el.classList.remove('fade'); }, 120);
  }

  function renderQueue() {
    const list = $('queueList');
    const items = (state && state.queue) || [];
    list.replaceChildren(...items.map((q) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const strong = document.createElement('strong');
      strong.textContent = q.title;
      const small = document.createElement('small');
      small.textContent = q.artist || '—';
      b.append(strong, small);
      b.setAttribute('aria-label', `Poner ${q.title}`);
      b.addEventListener('click', () => { api.command('jump', q.i); toggleQueue(false); });
      li.append(b);
      return li;
    }));
    $('queueEmpty').hidden = items.length > 0;
  }

  function render() {
    const s = state;
    const on = has();
    const titleText = on ? s.title : 'Nada sonando';
    if ($('title').textContent !== titleText) { $('title').textContent = titleText; requestAnimationFrame(fitTitle); }
    $('artist').textContent = on ? (s.artist || '') : 'Pon algo en Rumoria';
    const lyricsOn = on && prefs.lyrics !== false;
    showLyric(lyricsOn ? s.line : '', lyricsOn && isCard() ? s.nextLine : '');
    $('upnext').textContent = on && s.upNext ? `A continuación: ${s.upNext}` : '';
    document.title = on ? `${s.title} · Rumoria` : 'Rumoria · mini';
    root.classList.toggle('playing', Boolean(on && s.playing && !s.loading));
    const art = $('art');
    const cover = on && s.cover && COVER_RE.test(s.cover) ? s.cover : null;
    if (cover && prefs.showCover !== false) {
      // The bigger cover for "Tarjeta".
      const want = isCard() ? cover.replace(/\/(mq|sd)default\.jpg/, '/hqdefault.jpg') : cover;
      if (art.getAttribute('src') !== want) art.src = want;
      art.hidden = false;
      $('artEmpty').hidden = true;
      root.style.setProperty('--cover', `url("${cover}")`);
    } else {
      art.hidden = true;
      art.removeAttribute('src');
      $('artEmpty').hidden = false;
      root.style.setProperty('--cover', 'none');
    }
    const playing = on && s.playing;
    $('playIcon').hidden = playing;
    $('pauseIcon').hidden = !playing;
    $('spinner').hidden = !(on && s.playing && s.loading);
    $('play').setAttribute('aria-label', playing ? 'Pausa' : 'Reproducir');
    for (const id of ['play', 'prev']) $(id).disabled = !on;
    $('next').disabled = !on || !s.hasNext;
    const like = $('like');
    like.disabled = !on || !s.canLike;
    press(like, on && s.liked, on && s.liked ? 'Quitar de Favoritas' : 'Añadir a Favoritas');
    press($('shuffle'), s && s.shuffle);
    press($('repeat'), s && s.repeat !== 'off', `Repetir: ${!s || s.repeat === 'off' ? 'no' : s.repeat === 'all' ? 'todo' : 'esta canción'}`);
    $('repeatOne').hidden = !(s && s.repeat === 'one');
    press($('videoBtn'), prefs.video);
    press($('lyricsBtn'), prefs.lyrics !== false);
    press($('pin'), prefs.onTop !== false, prefs.onTop !== false ? 'Siempre encima: sí' : 'Siempre encima: no');
    const muted = Boolean(s && (s.muted || s.volume === 0));
    press($('mute'), muted, muted ? 'Activar sonido' : 'Silenciar');
    $('volOn').hidden = muted;
    $('volOff').hidden = !muted;
    const vol = $('volume');
    if (s && document.activeElement !== vol) vol.value = String(s.muted ? 0 : s.volume);
    $('total').textContent = on && s.duration ? clock(s.duration) : '–:––';
    renderQueue();
    drawBar();
    syncVideo();
  }

  function applyPrefs(p) {
    prefs = p || {};
    root.classList.toggle('compact', Boolean(prefs.compact));
    root.classList.toggle('card', isCard());
    root.classList.toggle('no-cover', prefs.showCover === false);
    for (const el of document.querySelectorAll('[data-pref]')) {
      const k = el.dataset.pref;
      if (el.type === 'checkbox') el.checked = Boolean(prefs[k]);
      else if (Number.isFinite(prefs[k])) el.value = String(prefs[k]);
    }
    const layout = prefs.compact ? 'compact' : prefs.card ? 'card' : 'normal';
    for (const el of document.querySelectorAll('[data-layout]')) el.checked = el.value === layout;
    lastLine = null;
    render();
    requestAnimationFrame(fitTitle);
  }

  api.onState((s) => {
    state = s;
    anchor = { t: s && Number.isFinite(s.time) ? s.time : 0, at: performance.now() };
    render();
  });
  api.onPrefs(applyPrefs);

  // ---- buttons ----
  const vol = () => (state ? (state.muted ? 0 : state.volume) : 0);
  const setVolume = (v) => { const x = Math.round(Math.max(0, Math.min(1, v)) * 20) / 20; api.command('volume', x); flash(`Volumen ${Math.round(x * 100)} %`); };
  const seekBy = (d) => { if (!has() || !state.duration) return; const t = Math.max(0, Math.min(state.duration, timeNow() + d)); api.command('seek', t); anchor = { t, at: performance.now() }; drawBar(); flash(`${d > 0 ? '+' : '−'}${Math.abs(d)} s · ${clock(t)}`); };
  const queuePanel = $('queuePanel');
  const menuPanel = $('menuPanel');
  function toggleQueue(open = queuePanel.hidden) {
    queuePanel.hidden = !open;
    $('queueBtn').setAttribute('aria-expanded', String(open));
    if (open) { menuPanel.hidden = true; $('menu').setAttribute('aria-expanded', 'false'); }
  }
  function toggleMenu(open = menuPanel.hidden) {
    menuPanel.hidden = !open;
    $('menu').setAttribute('aria-expanded', String(open));
    if (open) toggleQueue(false);
  }

  $('play').addEventListener('click', () => api.command('toggle'));
  $('next').addEventListener('click', () => api.command('next'));
  $('prev').addEventListener('click', () => api.command('prev'));
  $('like').addEventListener('click', () => api.command('like'));
  $('shuffle').addEventListener('click', () => api.command('shuffle'));
  $('repeat').addEventListener('click', () => api.command('repeat'));
  $('mute').addEventListener('click', () => api.command('mute'));
  $('queueBtn').addEventListener('click', () => toggleQueue());
  $('videoBtn').addEventListener('click', () => api.setPrefs({ video: !prefs.video }));
  $('lyricsBtn').addEventListener('click', () => api.setPrefs({ lyrics: prefs.lyrics === false }));
  $('pin').addEventListener('click', () => api.setPrefs({ onTop: prefs.onTop === false }));
  $('volume').addEventListener('input', (e) => api.command('volume', Number(e.target.value)));
  $('close').addEventListener('click', () => api.close());
  $('main').addEventListener('click', () => api.showMain());
  $('artWrap').addEventListener('dblclick', () => api.showMain());
  $('menu').addEventListener('click', () => toggleMenu());
  for (const el of document.querySelectorAll('[data-pref]')) {
    el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
      api.setPrefs({ [el.dataset.pref]: el.type === 'checkbox' ? el.checked : Number(el.value) });
    });
  }
  for (const el of document.querySelectorAll('[data-layout]')) {
    el.addEventListener('change', () => { if (el.checked) api.setPrefs({ compact: el.value === 'compact', card: el.value === 'card' }); });
  }

  // ---- the bar: click (or arrows) to jump; the time under the pointer ----
  const bar = $('bar');
  const atX = (clientX) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - r.left) / r.width)); };
  bar.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (!has() || !state.duration) return;
    const t = atX(e.clientX) * state.duration;
    api.command('seek', t);
    anchor = { t, at: performance.now() };
    drawBar();
  });
  bar.addEventListener('pointermove', (e) => {
    if (!has() || !state.duration) return;
    const f = atX(e.clientX);
    const tip = $('tip');
    tip.textContent = clock(f * state.duration);
    tip.style.left = `${f * 100}%`;
    tip.hidden = false;
  });
  bar.addEventListener('pointerleave', () => { $('tip').hidden = true; });
  bar.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    seekBy(e.key === 'ArrowRight' ? 5 : -5);
  });

  // ---- the wheel: volume; over the bar, move in the song ----
  root.addEventListener('wheel', (e) => {
    if (e.target.closest('.menu, .popover')) return;
    e.preventDefault();
    const up = e.deltaY < 0;
    if (e.target.closest('.bar-row')) seekBy(up ? 5 : -5);
    else if (state) setVolume(vol() + (up ? 0.05 : -0.05));
  }, { passive: false });

  // ---- keys ----
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { toggleMenu(false); toggleQueue(false); return; }
    if (e.target.closest && e.target.closest('input, .menu')) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    const act = {
      ' ': () => api.command('toggle'),
      arrowright: () => seekBy(5), arrowleft: () => seekBy(-5),
      arrowup: () => state && setVolume(vol() + 0.05), arrowdown: () => state && setVolume(vol() - 0.05),
      n: () => api.command('next'), p: () => api.command('prev'), l: () => api.command('like'),
      m: () => api.command('mute'), v: () => api.setPrefs({ video: !prefs.video }), q: () => toggleQueue(),
    }[k];
    if (!act) return;
    // Space on a button presses it: let it.
    if (k === ' ' && e.target.closest && e.target.closest('button')) return;
    e.preventDefault();
    act();
  });

  // ---- moved by dragging anywhere but its buttons, bar, video and panels; sticks to the screen's edges ----
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, label, .bar, .menu, .popover')) return;
    drag = { x: e.screenX, y: e.screenY, moved: false };
    root.setPointerCapture(e.pointerId);
    root.classList.add('dragging');
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.screenX - drag.x;
    const dy = e.screenY - drag.y;
    if (dx || dy) { api.move(dx, dy); drag = { x: e.screenX, y: e.screenY, moved: true }; }
  });
  const stop = () => {
    if (drag && drag.moved) api.dragEnd();
    drag = null;
    root.classList.remove('dragging');
  };
  root.addEventListener('pointerup', stop);
  root.addEventListener('pointercancel', stop);
  // Panels close when clicking elsewhere.
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#queuePanel, #queueBtn')) toggleQueue(false);
    if (!e.target.closest('#menuPanel, #menu')) toggleMenu(false);
  });
  // See-through until the pointer is over it (if so chosen).
  document.addEventListener('mouseenter', () => api.hover(true));
  document.addEventListener('mouseleave', () => api.hover(false));
  window.addEventListener('resize', () => requestAnimationFrame(fitTitle));

  render();
})();

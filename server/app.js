// CLMusic's local server: the page's only way to YouTube, your lists and
// your history. It listens on 127.0.0.1 only and answers nobody but the app:
//  - the Host must be this computer and this port (no DNS rebinding);
//  - every request carries this launch's secret (a cookie the desktop app
//    sets, httpOnly, or a header in development), compared in constant time;
//  - anything that changes something also needs the X-CLMusic header, which
//    a page from elsewhere can't send without a CORS preflight we never allow.
// Inputs are checked here; the modules in lib/ clean every field again.
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const ytdlp = require('./lib/ytdlp');
const streamLib = require('./lib/stream');
const { StreamLists, pickVideo, ID_RE: LIST_ID_RE } = require('./lib/streamlists');
const { ListenLog } = require('./lib/listenlog');
const { Likes } = require('./lib/likes');
const { News } = require('./lib/news');
const { LocalMusic } = require('./lib/localmusic');
const { Browse } = require('./lib/browse');
const importlist = require('./lib/importlist');
const { findLyrics } = require('./lib/lyrics');
const { parseLrc } = require('./lib/lrc');

const TOKEN_RE = /^[a-f0-9]{64}$/;
const COOKIE = 'clm_t';
const BUSY = { error: 'Hay mucho en marcha; inténtalo en unos segundos.' };

/** A few things at once at most (yt-dlp runs are heavy). */
function slots(max) {
  let used = 0;
  return { take: () => (used < max ? (used += 1, true) : false), release: () => { used = Math.max(0, used - 1); } };
}

const sameSecret = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function tokenFrom(req) {
  const h = req.get('x-clmusic-token');
  if (h) return h;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})(?:;|$)`).exec(String(req.headers.cookie || ''));
  return m ? m[1] : null;
}

/** Only this app, on this computer, with this launch's secret. */
function guard(token) {
  return (req, res, next) => {
    const port = req.socket.localPort;
    const host = String(req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return res.status(421).json({ error: 'Host no permitido.' });
    const given = tokenFrom(req);
    if (!given || !sameSecret(given, token)) return res.status(401).json({ error: 'No autorizado.' });
    if (!['GET', 'HEAD'].includes(req.method) && req.get('x-clmusic') !== '1') return res.status(403).json({ error: 'Petición no permitida.' });
    return next();
  };
}

const text = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : null);
const shortError = (err, fallback) => (err && err.message && err.message.length < 200 ? err.message : fallback);

/**
 * The app. `dataDir`: where lists, history, favourites and news live.
 * `ytEnv()`: { ytDlpPath, jsRuntime, cookiesPath } for each run.
 * `deps` replaces the YouTube side in tests (search, flatList, latestEntries, stream).
 */
function createApp({ token, dataDir, ytEnv, musicDir = null, staticDir = null, background = true, deps = {} }) {
  if (!TOKEN_RE.test(String(token || ''))) throw new Error('Se necesita un secreto de 64 caracteres hexadecimales.');
  const yt = { search: ytdlp.search, flatList: ytdlp.flatList, latestEntries: ytdlp.latestEntries, ...deps };
  const stream = deps.stream || streamLib;
  const lyricsFinder = deps.findLyrics || findLyrics;
  const readImport = deps.readImport || importlist.readImport;
  const readProfile = deps.readProfile || importlist.readProfile;

  const lists = new StreamLists(path.join(dataDir, 'stream-lists.json'));
  const history = new ListenLog(path.join(dataDir, 'listen-history.json'));
  const likes = new Likes(path.join(dataDir, 'likes.json'));
  const news = new News(path.join(dataDir, 'news.json'));
  const local = new LocalMusic(musicDir);
  if (musicDir) local.scan();
  const browse = new Browse(path.join(dataDir, 'browse-cache.json'));

  const ytSlots = slots(3);
  const listSlots = slots(2);
  const found = new Map(); // "query|seconds" -> video (so a song is looked up once)

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://*.ytimg.com'],
        mediaSrc: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  }));
  app.use(guard(token));
  app.use(express.json({ limit: '256kb' }));
  const limiter = (max) => rateLimit({ windowMs: 60_000, limit: max, standardHeaders: 'draft-7', legacyHeaders: false, message: BUSY });
  const ytLimiter = limiter(240);
  const writeLimiter = limiter(600);

  const needId = (req, res, next) => (stream.isId(req.query.id) ? next() : res.status(400).json({ error: 'Vídeo no válido.' }));

  // ---- playing from YouTube (nothing is saved) ----
  app.get('/api/stream/info', ytLimiter, needId, async (req, res) => {
    if (!ytSlots.take()) return res.status(429).json(BUSY);
    try { res.json(stream.publicInfo(req.query.id, await stream.resolve(req.query.id, ytEnv()))); } catch (err) { res.status(502).json({ error: shortError(err, 'YouTube no respondió.') }); } finally { ytSlots.release(); }
  });
  app.get('/api/stream/audio', needId, async (req, res) => {
    try { await stream.pipe(req.query.id, ytEnv(), req, res); } catch (err) { if (!res.headersSent) res.status(502).json({ error: shortError(err, 'YouTube no respondió.') }); else res.destroy(); }
  });
  app.get('/api/stream/radio', ytLimiter, needId, async (req, res) => {
    if (!listSlots.take()) return res.status(429).json(BUSY);
    try { res.json({ entries: await stream.radio(req.query.id, ytEnv(), yt.flatList) }); } catch { res.json({ entries: [] }); } finally { listSlots.release(); }
  });
  app.get('/api/stream/lyrics', ytLimiter, needId, async (req, res) => {
    try {
      const info = await stream.resolve(req.query.id, ytEnv());
      const artist = text(req.query.a, 200) || info.artist;
      const title = text(req.query.t, 200) || info.track;
      const d = Number(req.query.d) > 0 && Number(req.query.d) < 7200 ? Number(req.query.d) : info.duration;
      const hit = await lyricsFinder({ artist, title, duration: d }) || await lyricsFinder({ artist, title });
      if (!hit) return res.json({ synced: null, plain: null });
      const synced = hit.synced ? parseLrc(hit.synced) : null;
      return res.json({ synced: synced && synced.length ? synced : null, plain: hit.plain || null });
    } catch {
      return res.json({ synced: null, plain: null });
    }
  });

  // ---- search, and a song known by name → its video ----
  app.get('/api/search', ytLimiter, async (req, res) => {
    const q = text(req.query.q, 200);
    if (!q) return res.status(400).json({ error: 'Falta qué buscar.' });
    if (!ytSlots.take()) return res.status(429).json(BUSY);
    try {
      const r = await yt.search(q, ytEnv(), 20);
      if (!r) return res.status(502).json({ error: 'YouTube no respondió.' });
      res.json({ results: r.filter((e) => stream.isId(e.id)).map(({ id, title, channel, duration, thumbnail }) => ({ id, title, channel, duration, thumbnail })) });
    } finally { ytSlots.release(); }
  });
  app.get('/api/find', ytLimiter, async (req, res) => {
    const q = text(req.query.q, 200);
    if (!q) return res.status(400).json({ error: 'Falta qué buscar.' });
    const d = Number(req.query.d) > 0 && Number(req.query.d) < 7200 ? Math.round(Number(req.query.d)) : null;
    const key = `${q}|${d || ''}`;
    let hit = found.get(key);
    if (!hit) {
      if (!ytSlots.take()) return res.status(429).json(BUSY);
      try { hit = pickVideo(await yt.search(q, ytEnv(), 6), d); } finally { ytSlots.release(); }
      if (!hit) return res.status(404).json({ error: 'No se encontró esta canción en YouTube.' });
      found.set(key, hit);
      if (found.size > 2000) found.delete(found.keys().next().value);
    }
    const n = Number(req.query.n);
    if (LIST_ID_RE.test(String(req.query.list || '')) && Number.isInteger(n)) lists.remember(String(req.query.list), n, hit, q);
    return res.json({ id: hit.id, title: hit.title, channel: hit.channel, duration: hit.duration, thumbnail: hit.thumbnail });
  });

  // ---- your lists (from Spotify, Apple Music, YouTube, or your own) ----
  async function readListLink(raw) {
    const url = String(raw || '').trim();
    if (importlist.isImportUrl(url)) {
      const full = url.startsWith('http') ? url : `https://${url}`;
      const r = await readImport(full);
      return { name: r.title, source: r.service === 'spotify' ? 'spotify' : 'apple', url: full, tracks: r.tracks.map((t) => ({ title: t.title, artist: t.artist, duration: t.duration, query: t.query })) };
    }
    const ytUrl = ytdlp.youTubeUrl(url);
    if (ytUrl && /[?&]list=/.test(ytUrl)) {
      if (!listSlots.take()) throw new Error(BUSY.error);
      try {
        const list = await yt.flatList(ytUrl, ytEnv(), 500);
        if (!list || !list.entries.length) throw new Error('Esa playlist está vacía o no se puede leer.');
        return { name: list.title, source: 'youtube', url: ytUrl, tracks: list.entries.filter((e) => stream.isId(e.id)).map((e) => ({ title: e.title, artist: e.channel || '', duration: e.duration, yt: e.id, thumbnail: e.thumbnail })) };
      } finally { listSlots.release(); }
    }
    throw new Error('Pega el enlace de una playlist de Spotify, Apple Music o YouTube.');
  }
  const listFor = (req, res) => {
    const l = LIST_ID_RE.test(String(req.params.id)) ? lists.get(String(req.params.id)) : null;
    if (!l) res.status(404).json({ error: 'No se encuentra esa lista.' });
    return l;
  };
  app.get('/api/lists', (req, res) => res.json({ lists: lists.summary() }));
  app.get('/api/lists/:id', (req, res) => { const l = listFor(req, res); if (l) res.json(l); });
  app.post('/api/lists', writeLimiter, (req, res) => {
    const b = req.body || {};
    try { res.json(lists.create({ name: b.name, tracks: Array.isArray(b.tracks) ? b.tracks : [] })); } catch (err) { res.status(400).json({ error: shortError(err, 'No se pudo crear la lista.') }); }
  });
  app.post('/api/lists/import', ytLimiter, async (req, res) => {
    const link = String((req.body || {}).url || '').trim().slice(0, 2048);
    try {
      // A Spotify profile: each of its public playlists, in a folder of its own.
      if (importlist.isProfileUrl(link)) {
        const p = await readProfile(link);
        const have = new Set(lists.summary().map((l) => l.url).filter(Boolean));
        const folder = `Spotify · ${p.name}`.slice(0, 60);
        const created = [];
        let skipped = 0;
        let failed = 0;
        for (const pl of p.playlists) {
          if (have.has(pl.url)) { skipped++; continue; }
          try { const l = lists.create(await readListLink(pl.url)); lists.update(l.id, { folder }); created.push({ id: l.id, name: l.name, count: l.tracks.length }); } catch { failed++; }
        }
        return res.json({ profile: { name: p.name, folder }, created, skipped, failed });
      }
      return res.json(lists.create(await readListLink(link)));
    } catch (err) {
      return res.status(400).json({ error: shortError(err, 'No se pudo leer esa lista.') });
    }
  });
  app.patch('/api/lists/:id', writeLimiter, (req, res) => {
    if (!listFor(req, res)) return;
    const b = req.body || {};
    const pair = (v) => (v && typeof v === 'object' ? { from: v.from, to: v.to } : undefined);
    res.json(lists.update(String(req.params.id), {
      name: typeof b.name === 'string' ? b.name : undefined,
      folder: typeof b.folder === 'string' ? b.folder : undefined,
      sync: typeof b.sync === 'boolean' ? b.sync : undefined,
      add: Array.isArray(b.add) ? b.add : undefined,
      insert: Array.isArray(b.insert) ? b.insert : undefined,
      move: pair(b.move),
      moveMany: pair(b.moveMany),
    }));
  });
  app.post('/api/lists/:id/remove', writeLimiter, (req, res) => {
    if (!listFor(req, res)) return;
    const r = lists.removeTracks(String(req.params.id), (req.body || {}).ns);
    if (!r) return res.status(400).json({ error: 'No se encuentran esas canciones.' });
    return res.json(r);
  });
  app.post('/api/lists/:id/restore', writeLimiter, (req, res) => {
    const l = LIST_ID_RE.test(String(req.params.id)) ? lists.restore(String(req.params.id)) : null;
    if (!l) return res.status(404).json({ error: 'Ya no se puede recuperar esa lista.' });
    return res.json(l);
  });
  app.post('/api/lists/:id/refresh', ytLimiter, async (req, res) => {
    const l = listFor(req, res);
    if (!l) return;
    if (!l.url) return res.status(400).json({ error: 'Esta lista no viene de un enlace.' });
    try { res.json(lists.update(l.id, { tracks: (await readListLink(l.url)).tracks })); } catch (err) { res.status(400).json({ error: shortError(err, 'No se pudo leer esa lista.') }); }
  });
  app.delete('/api/lists/:id', writeLimiter, (req, res) => {
    if (!listFor(req, res)) return;
    res.json({ ok: lists.remove(String(req.params.id)) });
  });

  // ---- what you listen to (only on this computer) ----
  app.post('/api/history', writeLimiter, (req, res) => {
    const b = req.body || {};
    res.json({ ok: history.add(b.song, b.secs) !== null });
  });
  app.get('/api/history/smart', (req, res) => res.json(history.smart()));
  app.get('/api/history/summary', (req, res) => {
    const year = /^\d{4}$/.test(String(req.query.year || '')) ? Number(req.query.year) : null;
    const tz = Number.isInteger(Number(req.query.tz)) && Math.abs(Number(req.query.tz)) <= 840 ? Number(req.query.tz) : 0;
    res.json(history.summary(year, tz));
  });
  app.patch('/api/history/settings', writeLimiter, (req, res) => {
    const b = req.body || {};
    res.json(history.settings({ paused: typeof b.paused === 'boolean' ? b.paused : undefined }));
  });
  app.delete('/api/history', writeLimiter, (req, res) => { history.clear(); res.json({ ok: true }); });

  // ---- favourites ----
  app.get('/api/likes', (req, res) => res.json({ songs: likes.list() }));
  app.post('/api/likes', writeLimiter, (req, res) => {
    const n = likes.add((req.body || {}).song);
    if (n === null) return res.status(400).json({ error: 'Esa canción no se puede guardar.' });
    return res.json({ ok: true, count: n });
  });
  app.post('/api/likes/remove', writeLimiter, (req, res) => {
    const key = String((req.body || {}).key || '');
    if (!key || key.length > 520) return res.status(400).json({ error: 'Esa canción no se puede quitar.' });
    return res.json({ ok: true, count: likes.remove(key) });
  });

  // ---- "Explorar": ready-made lists (fixed searches, never text from the page) ----
  app.get('/api/browse', (req, res) => res.json({ lists: browse.list() }));
  app.get('/api/browse/:id', ytLimiter, async (req, res) => {
    if (!browse.has(req.params.id)) return res.status(404).json({ error: 'No existe esa lista.' });
    if (!ytSlots.take()) return res.status(429).json(BUSY);
    try {
      const l = await browse.get(req.params.id, (target, limit) => yt.flatList(target, ytEnv(), limit));
      return res.json(l);
    } catch {
      return res.status(502).json({ error: 'YouTube no respondió.' });
    } finally { ytSlots.release(); }
  });

  // ---- news of your artists ----
  app.get('/api/news', (req, res) => res.json({ news: news.list() }));

  // ---- your own music folder ----
  app.get('/api/local', (req, res) => res.json({ folder: Boolean(local.root), songs: local.list() }));
  app.post('/api/local/rescan', writeLimiter, (req, res) => res.json({ folder: Boolean(local.root), songs: local.scan() }));
  app.get('/api/local/file', (req, res) => {
    const hit = local.resolve(String(req.query.id || ''));
    if (!hit) return res.status(404).json({ error: 'No se encuentra esa canción.' });
    return res.sendFile(hit.file, { dotfiles: 'deny', headers: { 'Content-Type': hit.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  });

  if (staticDir) app.use(express.static(staticDir, { index: 'index.html', dotfiles: 'deny', fallthrough: true }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'No existe.' }));
  // Broken JSON, too big, anything unexpected: a short answer, never a stack.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err && (err.status || err.statusCode);
    res.status(status >= 400 && status < 500 ? status : 500).json({ error: status >= 400 && status < 500 ? 'Petición no válida.' : 'Error interno.' });
  });

  // ---- now and then, by itself ----
  async function syncLists() {
    for (const id of lists.dueForSync()) {
      const l = lists.get(id);
      if (!l) continue;
      try { const fresh = await readListLink(l.url); if (fresh.tracks.length) lists.update(id, { tracks: fresh.tracks }); } catch { /* next round */ }
    }
  }
  async function lookForNews() {
    if (history.paused) return;
    const artists = (history.smart().artists || []).map((a) => a.name).filter(Boolean).slice(0, 8);
    if (!artists.length || !ytSlots.take()) return;
    try {
      await news.check(artists, {
        findChannel: async (a) => News.channelOf(a, await yt.search(a, ytEnv(), 12)),
        newest: async (url) => { const r = await yt.latestEntries(url, ytEnv(), 12); return r ? r.entries : []; },
      });
    } finally { ytSlots.release(); }
  }
  // The featured "Explorar" lists and radios, read ahead one at a time (so their
  // covers show on the home page), only those not read lately; a list being
  // listened to always comes first (this one waits for a free slot or skips).
  async function warmBrowse() {
    for (const b of browse.list().filter((x) => x.featured && !x.count)) {
      if (!ytSlots.take()) return;
      try { await browse.get(b.id, (target, limit) => yt.flatList(target, ytEnv(), limit)); } catch { /* next time */ } finally { ytSlots.release(); }
      await new Promise((r) => { const t = setTimeout(r, 4000); t.unref(); });
    }
  }
  const timers = [];
  if (background) {
    timers.push(setTimeout(() => { warmBrowse().catch(() => {}); }, 90_000));
    timers.push(setInterval(() => { warmBrowse().catch(() => {}); }, 6 * 3600_000));
    timers.push(setTimeout(() => { syncLists().catch(() => {}); }, 3 * 60_000));
    timers.push(setInterval(() => { syncLists().catch(() => {}); }, 3 * 3600_000));
    timers.push(setTimeout(() => { lookForNews().catch(() => {}); }, 5 * 60_000));
    timers.push(setInterval(() => { lookForNews().catch(() => {}); }, 12 * 3600_000));
    timers.forEach((t) => t.unref());
  }

  return {
    app,
    setMusicDir(dir) { local.setRoot(dir); local.scan(); },
    stop() { timers.forEach((t) => clearTimeout(t)); },
    _state: { lists, history, likes, news, local, browse },
  };
}

module.exports = { createApp, guard, tokenFrom, COOKIE, TOKEN_RE };

// Listening without downloading (desktop app): a YouTube video's audio,
// played straight from YouTube like a music app does, never saved to disk.
// yt-dlp finds the audio's address (kept for a while, it lasts hours); the
// app's server then relays it to the player in pieces (so you can seek), only
// ever to YouTube's own media servers. "Radio" is YouTube's own mix of
// similar songs for that video.
const { execFile } = require('child_process');
const netfetch = require('./netfetch');

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
// Where YouTube serves media from: nothing else is ever fetched.
const MEDIA_HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.googlevideo\.com$/i;
// YouTube's media addresses last about six hours: kept four (a 403 looks again).
const CACHE_MS = 4 * 60 * 60 * 1000;
const MAX_CACHE = 400;
// What each kind asks yt-dlp for: the audio, or (for the mini player) a light
// video without sound, 360p at most, that the browser plays natively.
const FORMATS = {
  audio: 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio[ext=webm]/bestaudio',
  video: 'bestvideo[height<=360][ext=mp4][vcodec^=avc1]/bestvideo[height<=360][ext=mp4]/best[height<=360][ext=mp4]',
};
// Headers yt-dlp says the media server wants (nothing else goes upstream).
const PASS_HEADERS = ['user-agent', 'accept-language', 'referer', 'origin'];
const clean = (v, max = 300) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

const cache = new Map(); // id -> { at, info }
const pending = new Map(); // id -> Promise (one yt-dlp per song at a time)

function isId(id) { return ID_RE.test(String(id || '')); }

const MAX_RUNNING = 3;
const MAX_WAITING = 30;
let running = 0;
const turns = [];
function inTurn(fn) {
  return new Promise((resolve, reject) => {
    const go = () => {
      running += 1;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { running -= 1; if (turns.length) turns.shift()(); });
    };
    if (running < MAX_RUNNING) go(); else turns.push(go);
  });
}

/** "Artist - Title" → its two parts, for lyrics and scrobbling. */
function splitTitle(title, channel) {
  const t = clean(title).replace(/\s*[([](official|oficial|lyric|lyrics|letra|audio|video|vídeo|videoclip|visualizer|hd|4k|mv)[^)\]]*[)\]]/gi, '').trim();
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(t);
  if (m) return { artist: m[1].trim(), track: m[2].trim() };
  return { artist: clean(channel).replace(/\s*-\s*topic$/i, '').replace(/VEVO$/i, '').trim(), track: t };
}

/** One yt-dlp run → { url, headers, mime, title, channel, artist, track, duration, thumbnail }. */
function lookUp(id, env, kind = 'audio') {
  return new Promise((resolve, reject) => {
    const args = ['--ignore-config', '--encoding', 'utf-8', '-J', '--no-playlist', '--no-warnings', '--ies', 'youtube',
      '-f', Object.hasOwn(FORMATS, kind) ? FORMATS[kind] : FORMATS.audio];
    if (env.jsRuntime) args.push('--js-runtimes', `node:${env.jsRuntime}`);
    if (env.cookiesPath) args.push('--cookies', env.cookiesPath);
    args.push('--', `https://www.youtube.com/watch?v=${id}`);
    execFile(env.ytDlpPath, args, { windowsHide: true, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error('No se puede escuchar este vídeo (puede ser privado, tener límite de edad o no estar en tu país).'));
      let d;
      try { d = JSON.parse(stdout); } catch { return reject(new Error('YouTube no respondió bien.')); }
      const fmt = (d.requested_formats && d.requested_formats[0]) || d;
      let u;
      try { u = new URL(fmt.url); } catch { return reject(new Error('YouTube no dio el sonido de este vídeo.')); }
      if (u.protocol !== 'https:' || !MEDIA_HOST_RE.test(u.hostname)) return reject(new Error('YouTube no dio el sonido de este vídeo.'));
      const headers = {};
      for (const [k, v] of Object.entries(fmt.http_headers || d.http_headers || {})) {
        if (PASS_HEADERS.includes(k.toLowerCase()) && typeof v === 'string' && v.length < 500 && !/[\r\n]/.test(v)) headers[k] = v;
      }
      const ext = String(fmt.ext || '');
      const mime = kind === 'video' ? (ext === 'webm' ? 'video/webm' : 'video/mp4') : ext === 'webm' ? 'audio/webm' : ext === 'm4a' || ext === 'mp4' ? 'audio/mp4' : 'audio/mpeg';
      const title = clean(d.track || d.title);
      const artist = clean(d.artist || d.creator || '') || null;
      const parts = artist ? { artist, track: title } : splitTitle(d.title, d.channel || d.uploader);
      const thumb = typeof d.thumbnail === 'string' && /^https:\/\/i\d?\.ytimg\.com\//.test(d.thumbnail) ? d.thumbnail : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      resolve({
        url: u.toString(), headers, mime,
        title: clean(d.title), channel: clean(d.channel || d.uploader, 120), artist: clean(parts.artist, 200), track: clean(parts.track, 200),
        duration: Number.isFinite(d.duration) ? d.duration : null, thumbnail: thumb,
        chapters: require('./chapters').fromYouTube(d.chapters),
      });
    });
  });
}

/** The audio's address for a video (cached; yt-dlp only when needed). */
async function resolve(id, env, { fresh = false, kind = 'audio' } = {}) {
  if (!isId(id)) throw new Error('Vídeo no válido.');
  if (!Object.hasOwn(FORMATS, kind)) throw new Error('Tipo no válido.');
  const key = kind === 'audio' ? id : `${kind}:${id}`;
  const hit = cache.get(key);
  if (hit && !fresh && Date.now() - hit.at < CACHE_MS) return hit.info;
  if (pending.has(key)) return pending.get(key);
  // A few yt-dlp at once; a burst of songs waits its turn, and too many is "busy".
  if (pending.size >= MAX_WAITING) throw new Error('Hay demasiadas canciones esperando; inténtalo en unos segundos.');
  const p = inTurn(() => lookUp(id, env, kind)).then((info) => {
    cache.set(key, { at: Date.now(), info });
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return info;
  }).finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

/** Looked up ahead (the next song in the queue), so it starts at once; errors are for later. */
function prepare(id, env) {
  if (!isId(id)) return false;
  resolve(id, env).catch(() => {});
  return true;
}

/** A song that wouldn't play: its addresses forgotten (looked up afresh next time). */
function forget(id) {
  if (!isId(id)) return false;
  for (const k of [id, `video:${id}`]) cache.delete(k);
  return true;
}

/** What the player shows (never the media address). */
function publicInfo(id, info) {
  return { id, title: info.title, channel: info.channel, artist: info.artist, track: info.track, duration: info.duration, thumbnail: info.thumbnail, chapters: info.chapters || [] };
}

/**
 * Relays the audio to `res`, honouring the player's Range (seeking). An
 * expired address is looked up again once.
 */
async function pipe(id, env, req, res, { kind = 'audio', fresh = false } = {}) {
  const range = /^bytes=\d{0,15}-\d{0,15}$/.test(String(req.headers.range || '')) ? req.headers.range : null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const info = await resolve(id, env, { fresh: fresh || attempt > 0, kind });
    let up;
    try {
      up = await netfetch.get(info.url, { headers: { ...info.headers, ...(range ? { Range: range } : {}) }, timeoutMs: 30000, redirects: 3 });
    } catch (err) {
      if (attempt === 0) continue;
      throw err;
    }
    // A redirect may move it to another of YouTube's media servers, never elsewhere.
    if (!MEDIA_HOST_RE.test(new URL(up.url).hostname)) { up.stream.destroy(); throw new Error('YouTube no dio el sonido de este vídeo.'); }
    if ((up.status === 403 || up.status === 404 || up.status === 410) && attempt === 0) { up.stream.resume(); continue; }
    if (up.status !== 200 && up.status !== 206) { up.stream.resume(); throw new Error('YouTube no dejó escuchar este vídeo ahora mismo.'); }
    const out = { 'Content-Type': info.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (/^\d+$/.test(String(up.headers['content-length'] || ''))) out['Content-Length'] = up.headers['content-length'];
    if (/^bytes \d+-\d+\/(\d+|\*)$/.test(String(up.headers['content-range'] || ''))) out['Content-Range'] = up.headers['content-range'];
    res.writeHead(up.status, out);
    up.stream.pipe(res);
    const stop = () => up.stream.destroy();
    res.on('close', stop);
    up.stream.on('error', () => res.destroy());
    return;
  }
}

/** YouTube's own mix for a video: similar songs to keep playing (radio). */
async function radio(id, env, flatList, limit = 25) {
  if (!isId(id)) return [];
  const list = await flatList(`https://www.youtube.com/watch?v=${id}&list=RD${id}`, env, limit + 1);
  return ((list && list.entries) || []).filter((e) => isId(e.id) && e.id !== id).slice(0, limit);
}

module.exports = { resolve, prepare, forget, publicInfo, pipe, radio, isId, splitTitle, MEDIA_HOST_RE, FORMATS, _cache: cache };

// Listening without downloading (desktop app): a YouTube video's audio,
// played straight from YouTube like a music app does, never saved to disk.
// yt-dlp finds the audio's address (kept for a while, it lasts hours); the
// app's server then relays it to the player in pieces (so you can seek), only
// ever to YouTube's own media servers. "Radio" is YouTube's own mix of
// similar songs for that video.
//
// v1.13, starting sooner on mobile data:
// - one yt-dlp run gives two addresses: the usual audio and a light one
//   (the lowest bitrate YouTube has, ~50–70 kb/s Opus), which the player asks
//   for on a phone's data connection (`quality: 'lite'`). Same run, no extra wait;
// - yt-dlp doesn't fetch the HLS/DASH manifests (the app never plays them):
//   fewer round trips before the address is known. If a video only has those,
//   it's looked up again the old way;
// - the addresses (never the sound) are kept on disk until YouTube says they
//   expire, so a song played before the app was closed starts without yt-dlp.
const fs = require('fs');
const { run } = require('./ytdlp');
const netfetch = require('./netfetch');
const { writeFileAtomic } = require('./atomic');

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const KEY_RE = /^(video:)?[A-Za-z0-9_-]{11}$/;
// Where YouTube serves media from: nothing else is ever fetched.
const MEDIA_HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.googlevideo\.com$/i;
// YouTube's media addresses last about six hours (their `expire`): kept until
// 20 min before that, or four hours when they don't say (a 403 looks again).
const CACHE_MS = 4 * 60 * 60 * 1000;
const MAX_KEEP_MS = 6 * 60 * 60 * 1000;
const EXPIRE_MARGIN_MS = 20 * 60 * 1000;
const MAX_CACHE = 400;
// What each kind asks yt-dlp for: the audio, or (for the mini player) a light
// video without sound, 360p at most, that the browser plays natively.
const FORMATS = {
  audio: 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio[ext=webm]/bestaudio',
  video: 'bestvideo[height<=360][ext=mp4][vcodec^=avc1]/bestvideo[height<=360][ext=mp4]/best[height<=360][ext=mp4]',
};
// The manifests the app never plays: skipping them saves yt-dlp a request or two.
const LEAN_ARGS = ['--extractor-args', 'youtube:skip=hls,dash,translated_subs'];
const NO_FORMAT_RE = /requested format is not available|no video formats found/i;
// The light address: only when it's clearly lighter than the usual one, and never below 40 kb/s.
const LITE_MIN_ABR = 40;
const LITE_MAX_SHARE = 0.8;
// Headers yt-dlp says the media server wants (nothing else goes upstream).
const PASS_HEADERS = ['user-agent', 'accept-language', 'referer', 'origin'];
const clean = (v, max = 300) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

const cache = new Map(); // key -> { until, info }
const pending = new Map(); // key -> Promise (one yt-dlp per song at a time)

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

/** An https address on YouTube's media servers, or null. */
function mediaUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  return u.protocol === 'https:' && MEDIA_HOST_RE.test(u.hostname) ? u.toString() : null;
}

/** Only the headers the media server needs, each a short single line. */
function passHeaders(src) {
  const headers = {};
  for (const [k, v] of Object.entries(src && typeof src === 'object' ? src : {})) {
    if (PASS_HEADERS.includes(k.toLowerCase()) && typeof v === 'string' && v.length < 500 && !/[\r\n]/.test(v)) headers[k] = v;
  }
  return headers;
}

const audioMime = (ext) => (ext === 'webm' ? 'audio/webm' : ext === 'm4a' || ext === 'mp4' ? 'audio/mp4' : 'audio/mpeg');

/**
 * The lightest audio-only format of the video's own language (dubbed tracks
 * and YouTube's "-drc" versions aside), when it's clearly lighter than `chosen`.
 */
function liteFormat(formats, chosen, fallbackHeaders) {
  const audio = (Array.isArray(formats) ? formats : []).filter((f) => f && typeof f === 'object'
    && f.vcodec === 'none' && f.acodec && f.acodec !== 'none'
    && (!f.protocol || f.protocol === 'https') && !/drc/i.test(String(f.format_id || ''))
    && Number(f.abr) >= LITE_MIN_ABR && mediaUrl(f.url));
  if (!audio.length) return null;
  const lang = (f) => (Number.isFinite(f.language_preference) ? f.language_preference : 0);
  const top = Math.max(...audio.map(lang));
  const pick = audio.filter((f) => lang(f) === top).sort((a, b) => Number(a.abr) - Number(b.abr))[0];
  const chosenAbr = Number(chosen && chosen.abr);
  if (Number.isFinite(chosenAbr) && chosenAbr > 0 && Number(pick.abr) > chosenAbr * LITE_MAX_SHARE) return null;
  if (chosen && pick.url === chosen.url) return null;
  return { url: mediaUrl(pick.url), headers: passHeaders(pick.http_headers || fallbackHeaders), mime: audioMime(String(pick.ext || '')), abr: Math.round(Number(pick.abr)) };
}

/** Until when an address can be used: its own `expire`, less a margin (or CACHE_MS). */
function keepUntil(url, now = Date.now()) {
  let expire = NaN;
  try { expire = Number(new URL(url).searchParams.get('expire')) * 1000; } catch { /* no expiry */ }
  if (!Number.isFinite(expire) || expire <= now) return now + CACHE_MS;
  return Math.min(expire - EXPIRE_MARGIN_MS, now + MAX_KEEP_MS);
}

/** yt-dlp's -J for one video → what the player needs (throws a friendly error). */
function parseInfo(id, stdout, kind) {
  let d;
  try { d = JSON.parse(stdout); } catch { throw new Error('YouTube no respondió bien.'); }
  const fmt = (d.requested_formats && d.requested_formats[0]) || d;
  const url = mediaUrl(fmt.url);
  if (!url) throw new Error('YouTube no dio el sonido de este vídeo.');
  const headers = passHeaders(fmt.http_headers || d.http_headers);
  const ext = String(fmt.ext || '');
  const mime = kind === 'video' ? (ext === 'webm' ? 'video/webm' : 'video/mp4') : audioMime(ext);
  const title = clean(d.track || d.title);
  const artist = clean(d.artist || d.creator || '') || null;
  const parts = artist ? { artist, track: title } : splitTitle(d.title, d.channel || d.uploader);
  const thumb = typeof d.thumbnail === 'string' && /^https:\/\/i\d?\.ytimg\.com\//.test(d.thumbnail) ? d.thumbnail : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  return {
    url, headers, mime,
    lite: kind === 'audio' ? liteFormat(d.formats, fmt, fmt.http_headers || d.http_headers) : null,
    title: clean(d.title), channel: clean(d.channel || d.uploader, 120), artist: clean(parts.artist, 200), track: clean(parts.track, 200),
    duration: Number.isFinite(d.duration) ? d.duration : null, thumbnail: thumb,
    chapters: require('./chapters').fromYouTube(d.chapters),
  };
}

/** One yt-dlp run → { url, headers, mime, lite, title, channel, artist, track, duration, thumbnail, chapters }. */
function lookUp(id, env, kind = 'audio', lean = true) {
  return new Promise((resolve, reject) => {
    const args = ['--ignore-config', '--encoding', 'utf-8', '-J', '--no-playlist', '--no-warnings', '--ies', 'youtube',
      ...(lean ? LEAN_ARGS : []), '-f', Object.hasOwn(FORMATS, kind) ? FORMATS[kind] : FORMATS.audio];
    // A phone works YouTube's challenge out more slowly than a PC.
    run(env, args, `https://www.youtube.com/watch?v=${id}`, { timeout: env.ytDlpPrefix ? 120_000 : 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // Only the manifests had it: the old way, once.
        if (lean && NO_FORMAT_RE.test(String(stderr || ''))) return lookUp(id, env, kind, false).then(resolve, reject);
        return reject(new Error('No se puede escuchar este vídeo (puede ser privado, tener límite de edad o no estar en tu país).'));
      }
      try { resolve(parseInfo(id, stdout, kind)); } catch (e) { reject(e); }
    });
  });
}

// ---- the addresses kept on disk (v1.13) ----
let diskFile = null;
let saveTimer = null;

/** What's read back from disk, checked again like anything from outside (or null). */
function infoFromDisk(info) {
  if (!info || typeof info !== 'object') return null;
  const url = mediaUrl(info.url);
  if (!url || typeof info.mime !== 'string' || !/^(audio|video)\/(mp4|webm|mpeg)$/.test(info.mime)) return null;
  let lite = null;
  if (info.lite && typeof info.lite === 'object') {
    const lu = mediaUrl(info.lite.url);
    if (lu && /^audio\/(mp4|webm|mpeg)$/.test(String(info.lite.mime))) lite = { url: lu, headers: passHeaders(info.lite.headers), mime: info.lite.mime, abr: Number(info.lite.abr) || null };
  }
  const thumb = typeof info.thumbnail === 'string' && /^https:\/\/i\d?\.ytimg\.com\//.test(info.thumbnail) ? info.thumbnail : null;
  return {
    url, headers: passHeaders(info.headers), mime: info.mime, lite,
    title: clean(info.title), channel: clean(info.channel, 120), artist: clean(info.artist, 200), track: clean(info.track, 200),
    duration: Number.isFinite(info.duration) ? info.duration : null, thumbnail: thumb,
    chapters: require('./chapters').cleanChapters(Array.isArray(info.chapters) ? info.chapters : []),
  };
}

function saveSoon() {
  if (!diskFile || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const now = Date.now();
    const items = [...cache].filter(([, v]) => v.until > now).map(([k, v]) => [k, v.until, v.info]);
    try { writeFileAtomic(diskFile, JSON.stringify({ v: 1, items })); } catch { /* only in memory this time */ }
  }, 2000);
  if (saveTimer.unref) saveTimer.unref();
}

/** Keeps the addresses in `file` (and reads back the ones still valid). */
function persist(file) {
  diskFile = file;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
  if (!raw || raw.v !== 1 || !Array.isArray(raw.items)) return;
  const now = Date.now();
  for (const item of raw.items.slice(-MAX_CACHE)) {
    if (!Array.isArray(item)) continue;
    const [key, until, info] = item;
    if (!KEY_RE.test(String(key)) || !Number.isFinite(until) || until <= now || until > now + MAX_KEEP_MS || cache.has(key)) continue;
    const ok = infoFromDisk(info);
    if (ok) cache.set(key, { until, info: ok });
  }
}

function remember(key, info) {
  cache.delete(key);
  cache.set(key, { until: keepUntil(info.url), info });
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  saveSoon();
}

/** The audio's address for a video (cached; yt-dlp only when needed). */
async function resolve(id, env, { fresh = false, kind = 'audio' } = {}) {
  if (!isId(id)) throw new Error('Vídeo no válido.');
  if (!Object.hasOwn(FORMATS, kind)) throw new Error('Tipo no válido.');
  const key = kind === 'audio' ? id : `${kind}:${id}`;
  const hit = cache.get(key);
  if (hit && !fresh && Date.now() < hit.until) return hit.info;
  if (pending.has(key)) return pending.get(key);
  // A few yt-dlp at once; a burst of songs waits its turn, and too many is "busy".
  if (pending.size >= MAX_WAITING) throw new Error('Hay demasiadas canciones esperando; inténtalo en unos segundos.');
  const p = inTurn(() => lookUp(id, env, kind)).then((info) => {
    remember(key, info);
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
  saveSoon();
  return true;
}

/** What the player shows (never the media address). */
function publicInfo(id, info) {
  return { id, title: info.title, channel: info.channel, artist: info.artist, track: info.track, duration: info.duration, thumbnail: info.thumbnail, chapters: info.chapters || [] };
}

/**
 * Relays the audio to `res`, honouring the player's Range (seeking). An
 * expired address is looked up again once. `quality: 'lite'`: the light
 * address when the video has one (a phone on mobile data).
 */
async function pipe(id, env, req, res, { kind = 'audio', fresh = false, quality = 'normal' } = {}) {
  const range = /^bytes=\d{0,15}-\d{0,15}$/.test(String(req.headers.range || '')) ? req.headers.range : null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const info = await resolve(id, env, { fresh: fresh || attempt > 0, kind });
    const src = quality === 'lite' && info.lite ? info.lite : info;
    let up;
    try {
      up = await netfetch.get(src.url, { headers: { ...src.headers, ...(range ? { Range: range } : {}) }, timeoutMs: 30000, redirects: 3 });
    } catch (err) {
      if (attempt === 0) continue;
      throw err;
    }
    // A redirect may move it to another of YouTube's media servers, never elsewhere.
    if (!MEDIA_HOST_RE.test(new URL(up.url).hostname)) { up.stream.destroy(); throw new Error('YouTube no dio el sonido de este vídeo.'); }
    if ((up.status === 403 || up.status === 404 || up.status === 410) && attempt === 0) { up.stream.resume(); continue; }
    if (up.status !== 200 && up.status !== 206) { up.stream.resume(); throw new Error('YouTube no dejó escuchar este vídeo ahora mismo.'); }
    const out = { 'Content-Type': src.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
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

module.exports = {
  resolve, prepare, forget, publicInfo, pipe, radio, persist, isId, splitTitle,
  MEDIA_HOST_RE, FORMATS, _cache: cache, _parseInfo: parseInfo, _liteFormat: liteFormat, _keepUntil: keepUntil, _infoFromDisk: infoFromDisk,
};

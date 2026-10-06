// Chapters of a long file or video (audiobooks, courses, DJ sets, podcasts):
// from ffmpeg's description of a file, or from YouTube's video information.
// Only times and short titles leave here.
const { spawn } = require('child_process');

const MAX = 300;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** [{ start, end, title }] in seconds, in order, sane only. */
function cleanChapters(list) {
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const start = Number(c && c.start);
    const end = Number(c && c.end);
    if (!Number.isFinite(start) || start < 0 || start > 7 * 86400) continue;
    out.push({ start: Math.round(start * 10) / 10, end: Number.isFinite(end) && end > start ? Math.round(end * 10) / 10 : null, title: clean(c.title, 150) });
    if (out.length >= MAX) break;
  }
  out.sort((a, b) => a.start - b.start);
  return out.length > 1 ? out : [];
}

/**
 * ffmpeg -i writes, for each chapter:
 *   Chapter #0:3: start 912.000000, end 1404.500000
 *     Metadata:
 *       title           : Capítulo 4
 */
function parseChapters(stderr) {
  const lines = String(stderr || '').split(/\r?\n/);
  const out = [];
  let cur = null;
  for (const line of lines) {
    const m = /^\s*Chapter #\d+:\d+: start (-?[\d.]+), end (-?[\d.]+)/.exec(line);
    if (m) { cur = { start: Number(m[1]), end: Number(m[2]), title: '' }; out.push(cur); continue; }
    const tm = /^\s+title\s*:\s(.*)$/.exec(line);
    if (cur && tm && !cur.title) cur.title = tm[1];
    if (/^\s*Stream #/.test(line)) cur = null;
  }
  return cleanChapters(out.map((c, i) => ({ ...c, title: c.title || `${i + 1}` })));
}

/** Reads a file's chapters with ffmpeg (local files only, nothing written). */
function readChapters(ffmpegPath, file, safeInput) {
  return new Promise((resolve) => {
    let err = '';
    let p;
    try { p = spawn(ffmpegPath, ['-hide_banner', ...safeInput, '-i', file], { windowsHide: true }); } catch { resolve([]); return; }
    const timer = setTimeout(() => p.kill(), 15000);
    p.stderr.on('data', (c) => { err = (err + c.toString('utf8')).slice(-400000); });
    p.on('error', () => { clearTimeout(timer); resolve([]); });
    p.on('close', () => { clearTimeout(timer); resolve(parseChapters(err)); });
  });
}

/** YouTube's chapters (yt-dlp: [{ start_time, end_time, title }]). */
const fromYouTube = (list) => cleanChapters((Array.isArray(list) ? list : []).map((c) => ({ start: c && c.start_time, end: c && c.end_time, title: c && c.title })));

module.exports = { parseChapters, readChapters, cleanChapters, fromYouTube };

// Shared bits for the server tests: the real app on a free port, with the
// YouTube side replaced (no network, no yt-dlp needed).
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server/app');

const VIDEO = 'dQw4w9WgXcQ';

/** A pretend YouTube: search results, playlists, the stream relay. */
function fakeYouTube(overrides = {}) {
  const calls = [];
  const entry = (id, title, extra = {}) => ({ id, title, channel: 'Artista - Topic', duration: 200, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, ...extra });
  return {
    calls,
    search: async (q, env, n) => { calls.push(['search', q, n]); return [entry(VIDEO, `${q} (Official Audio)`), entry('kJQP7kiw5Fk', 'Otra'), { id: 'channel/UCxyz', title: 'a channel, not a video' }]; },
    flatList: async (target, env, limit) => { calls.push(['flatList', target, limit]); return { title: 'Mi playlist', entries: [entry(VIDEO, 'Uno'), entry('kJQP7kiw5Fk', 'Dos')] }; },
    latestEntries: async () => ({ entries: [] }),
    findLyrics: async () => ({ synced: '[00:01.00] hola', plain: 'hola' }),
    readImport: async (url) => { calls.push(['readImport', url]); return { title: 'De Spotify', service: 'spotify', tracks: [{ title: 'Song', artist: 'Band', duration: 180, query: 'Band - Song' }] }; },
    stream: {
      isId: (id) => /^[A-Za-z0-9_-]{11}$/.test(String(id || '')),
      resolve: async (id) => { calls.push(['resolve', id]); return { title: 'Video', channel: 'C', artist: 'A', track: 'T', duration: 200, thumbnail: null, chapters: [] }; },
      publicInfo: (id, info) => ({ id, title: info.title, artist: info.artist }),
      pipe: async (id, env, req, res) => { calls.push(['pipe', id, req.headers.range || null]); res.writeHead(206, { 'Content-Type': 'audio/mp4' }); res.end('AUDIO'); },
      radio: async () => [entry('kJQP7kiw5Fk', 'Parecida')],
    },
    ...overrides,
  };
}

/** Starts the app; returns { base, token, port, call, dataDir, musicDir, yt, close }. */
async function startApp({ musicDir = null, staticDir = null, yt = fakeYouTube() } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rum-app-'));
  const token = crypto.randomBytes(32).toString('hex');
  const server = createApp({ token, dataDir, ytEnv: () => ({ ytDlpPath: 'yt-dlp' }), musicDir, staticDir, background: false, deps: yt });
  const http = await new Promise((resolve) => { const h = server.app.listen(0, '127.0.0.1', () => resolve(h)); });
  const { port } = http.address();
  const base = `http://127.0.0.1:${port}`;
  /** A request as the app makes it (secret + X-Rumoria), unless `headers` says otherwise. */
  async function call(method, url, { body, headers = {}, auth = true, raw = false } = {}) {
    const h = { ...(auth ? { 'X-Rumoria-Token': token } : {}), ...(method !== 'GET' ? { 'X-Rumoria': '1' } : {}), ...headers };
    if (body !== undefined && typeof body !== 'string') h['Content-Type'] = 'application/json';
    for (const [k, v] of Object.entries(h)) if (v === null) delete h[k];
    const res = await fetch(`${base}${url}`, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    if (raw) return res;
    let data;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    base, token, port, call, dataDir, musicDir, yt: yt, state: server._state,
    close: () => new Promise((resolve) => { server.stop(); http.close(() => { fs.rmSync(dataDir, { recursive: true, force: true }); resolve(); }); http.closeAllConnections(); }),
  };
}

/** A raw HTTP request (to send headers fetch won't let us forge, like Host). */
function rawRequest(port, { method = 'GET', path: p = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = require('http').request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = { startApp, fakeYouTube, rawRequest, VIDEO };

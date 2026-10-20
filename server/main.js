// The server process. The desktop app starts it (Electron acting as Node,
// so yt-dlp can use it as its JavaScript runtime) with:
//   RUMORIA_TOKEN     this launch's secret (64 hex characters)
//   RUMORIA_DATA_DIR  where your lists and history live
//   RUMORIA_YTDLP     the yt-dlp to use
//   RUMORIA_MUSIC_DIR your music folder (optional; changed later by message)
//   RUMORIA_STATIC    the built page (dist/), if this server serves it
//   RUMORIA_BACKGROUND "0": nothing done by itself in the background (end-to-end tests)
//   RUMORIA_PORT_FILE where to write the port once listening (Android: no parent process to tell)
//   Android only (yt-dlp is a Python script there, and YouTube's challenges use QuickJS):
//   RUMORIA_YTDLP_PREFIX JSON list of arguments before yt-dlp's own (the script)
//   RUMORIA_YTDLP_ENV    JSON object added to yt-dlp's environment
//   RUMORIA_JS_RUNTIMES  yt-dlp's --js-runtimes (instead of this Node)
//   RUMORIA_YTDLP_CACHE  yt-dlp's cache folder
//   RUMORIA_PORT      the port to use (the desktop app keeps the same one between
//                     runs, so what the page keeps in the browser survives);
//                     if it's taken, any free one
// It tells its parent the port once it's listening.
const fs = require('fs');
const path = require('path');
const { createApp } = require('./app');

const env = process.env;
const abs = (p) => (p && path.isAbsolute(p) ? p : null);
const dataDir = abs(env.RUMORIA_DATA_DIR) || path.join(__dirname, '..', '.data');
fs.mkdirSync(dataDir, { recursive: true });

function ytDlpPath() {
  if (env.RUMORIA_YTDLP && fs.existsSync(env.RUMORIA_YTDLP)) return env.RUMORIA_YTDLP;
  const local = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  return fs.existsSync(local) ? local : 'yt-dlp';
}
const cookiesPath = path.join(dataDir, 'cookies.txt');
const json = (v, ok) => { try { const x = JSON.parse(v); return ok(x) ? x : null; } catch { return null; } };
const ytPrefix = json(env.RUMORIA_YTDLP_PREFIX, (x) => Array.isArray(x) && x.every((a) => typeof a === 'string' && path.isAbsolute(a)));
const ytExtraEnv = json(env.RUMORIA_YTDLP_ENV, (x) => x && typeof x === 'object' && !Array.isArray(x) && Object.values(x).every((v) => typeof v === 'string'));
const ytEnv = () => ({
  ytDlpPath: ytDlpPath(),
  ytDlpPrefix: ytPrefix || undefined,
  ytDlpEnv: ytExtraEnv || undefined,
  jsRuntimes: env.RUMORIA_JS_RUNTIMES || undefined,
  jsRuntime: env.RUMORIA_JS_RUNTIMES ? undefined : process.execPath,
  cacheDir: abs(env.RUMORIA_YTDLP_CACHE) || undefined,
  cookiesPath: fs.existsSync(cookiesPath) ? cookiesPath : null,
});

const server = createApp({
  token: env.RUMORIA_TOKEN,
  dataDir,
  ytEnv,
  musicDir: abs(env.RUMORIA_MUSIC_DIR),
  staticDir: abs(env.RUMORIA_STATIC),
  background: env.RUMORIA_BACKGROUND !== '0',
});

const wanted = /^\d{2,5}$/.test(String(env.RUMORIA_PORT || '')) && Number(env.RUMORIA_PORT) <= 65535 ? Number(env.RUMORIA_PORT) : 0;
function listen(port) {
  // Express 5 calls this with the error too, when the port can't be had.
  const http = server.app.listen(port, '127.0.0.1', (err) => {
    // Taken by another program, or reserved by Windows (Hyper-V/WSL keep
    // ranges, and they move on each reboot): any free one this time.
    if (err) { if (port && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) { listen(0); return; } throw err; }
    const { port: real } = http.address();
    if (abs(env.RUMORIA_PORT_FILE)) fs.writeFileSync(env.RUMORIA_PORT_FILE, String(real));
    if (process.send) process.send({ type: 'ready', port: real });
    else console.log(`Rumoria: servidor en http://127.0.0.1:${real}`);
  });
}
listen(wanted);

// The desktop app picks the music folder (a native dialog), never the page.
process.on('message', (m) => {
  if (m && m.type === 'musicDir' && (m.dir === null || abs(m.dir))) server.setMusicDir(m.dir);
  // v1.12, Modo juego: a game full screen puts the background work off.
  if (m && m.type === 'game' && typeof m.on === 'boolean') server.setGame(m.on);
});
process.on('disconnect', () => process.exit(0));

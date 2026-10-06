// The server process. The desktop app starts it (Electron acting as Node,
// so yt-dlp can use it as its JavaScript runtime) with:
//   ESCUCHAR_TOKEN     this launch's secret (64 hex characters)
//   ESCUCHAR_DATA_DIR  where your lists and history live
//   ESCUCHAR_YTDLP     the yt-dlp to use
//   ESCUCHAR_MUSIC_DIR your music folder (optional; changed later by message)
//   ESCUCHAR_STATIC    the built page (dist/), if this server serves it
//   ESCUCHAR_PORT      a fixed port (development); else any free one
// It tells its parent the port once it's listening.
const fs = require('fs');
const path = require('path');
const { createApp } = require('./app');

const env = process.env;
const abs = (p) => (p && path.isAbsolute(p) ? p : null);
const dataDir = abs(env.ESCUCHAR_DATA_DIR) || path.join(__dirname, '..', '.data');
fs.mkdirSync(dataDir, { recursive: true });

function ytDlpPath() {
  if (env.ESCUCHAR_YTDLP && fs.existsSync(env.ESCUCHAR_YTDLP)) return env.ESCUCHAR_YTDLP;
  const local = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  return fs.existsSync(local) ? local : 'yt-dlp';
}
const cookiesPath = path.join(dataDir, 'cookies.txt');
const ytEnv = () => ({ ytDlpPath: ytDlpPath(), jsRuntime: process.execPath, cookiesPath: fs.existsSync(cookiesPath) ? cookiesPath : null });

const server = createApp({
  token: env.ESCUCHAR_TOKEN,
  dataDir,
  ytEnv,
  musicDir: abs(env.ESCUCHAR_MUSIC_DIR),
  staticDir: abs(env.ESCUCHAR_STATIC),
});

const port = /^\d{2,5}$/.test(String(env.ESCUCHAR_PORT || '')) ? Number(env.ESCUCHAR_PORT) : 0;
const http = server.app.listen(port, '127.0.0.1', () => {
  const { port: real } = http.address();
  if (process.send) process.send({ type: 'ready', port: real });
  else console.log(`Escuchar: servidor en http://127.0.0.1:${real}`);
});

// The desktop app picks the music folder (a native dialog), never the page.
process.on('message', (m) => {
  if (m && m.type === 'musicDir' && (m.dir === null || abs(m.dir))) server.setMusicDir(m.dir);
});
process.on('disconnect', () => process.exit(0));

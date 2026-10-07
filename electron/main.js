// Rumoria's desktop shell: one window, a local server only it can talk to,
// and yt-dlp kept up to date. The page runs sandboxed with no Node access;
// the few things it may ask for (pick the music folder, send a song to
// TubeGrab) go through preload.js and are checked again here.
const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { fork, execFile } = require('child_process');
const { migrateFromTubeGrab } = require('../server/lib/migrate');

// Isolated runs (tests, a second profile): their own data folder.
if (process.env.RUMORIA_USER_DATA && path.isAbsolute(process.env.RUMORIA_USER_DATA)) app.setPath('userData', process.env.RUMORIA_USER_DATA);
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const userData = () => app.getPath('userData');
const TUBEGRAB_DATA = path.join(app.getPath('appData'), 'tubegrab');

let mainWindow = null;
let serverProcess = null;
let appOrigin = null;
const token = crypto.randomBytes(32).toString('hex');

// === Settings (userData/settings.json) ===
function readSettings() {
  try { return JSON.parse(fs.readFileSync(path.join(userData(), 'settings.json'), 'utf8')) || {}; } catch { return {}; }
}
function saveSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.writeFileSync(path.join(userData(), 'settings.json'), JSON.stringify(next, null, 2));
  return next;
}
/** Your music folder: the one chosen here, else TubeGrab's download folder, else Music. */
function musicDir() {
  const s = readSettings();
  if (typeof s.musicDir === 'string' && path.isAbsolute(s.musicDir)) return s.musicDir;
  try {
    const tg = JSON.parse(fs.readFileSync(path.join(TUBEGRAB_DATA, 'settings.json'), 'utf8'));
    if (typeof tg.downloadDir === 'string' && path.isAbsolute(tg.downloadDir) && fs.existsSync(tg.downloadDir)) return tg.downloadDir;
  } catch { /* no TubeGrab here */ }
  return app.getPath('music');
}

// === yt-dlp: our own copy in userData/bin, kept current by `yt-dlp -U` ===
const YTDLP_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const ytDlpPath = () => path.join(userData(), 'bin', YTDLP_NAME);
const ALLOWED_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
function fetchBuffer(u, redirects = 5) {
  return new Promise((resolve, reject) => {
    const url = new URL(u);
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) return reject(new Error(`Origen no permitido: ${url.hostname}`));
    https.get(url, { headers: { 'User-Agent': 'rumoria' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return fetchBuffer(new URL(res.headers.location, url).toString(), redirects - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}
/** The latest release, installed only if its SHA-256 matches the published sums. */
async function downloadYtDlp(dest) {
  const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
  const [bin, sums] = await Promise.all([fetchBuffer(`${base}/${YTDLP_NAME}`), fetchBuffer(`${base}/SHA2-256SUMS`)]);
  const line = sums.toString('utf8').split('\n').find((l) => l.trim().endsWith(` ${YTDLP_NAME}`));
  const expected = line && line.trim().split(/\s+/)[0].toLowerCase();
  if (!expected || crypto.createHash('sha256').update(bin).digest('hex') !== expected) throw new Error('yt-dlp no coincide con su huella SHA-256');
  fs.writeFileSync(dest, bin, { mode: 0o755 });
}
async function ensureYtDlp() {
  const dest = ytDlpPath();
  if (fs.existsSync(dest)) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // One shipped with the app, or TubeGrab's (already verified by it), else the latest release.
  for (const seed of [path.join(ROOT, 'bin', YTDLP_NAME), path.join(TUBEGRAB_DATA, 'bin', YTDLP_NAME)]) {
    try { if (fs.statSync(seed).isFile()) { fs.copyFileSync(seed, dest); return dest; } } catch { /* next */ }
  }
  await downloadYtDlp(dest);
  return dest;
}
function updateYtDlpSoon() {
  const s = readSettings();
  if (s.ytDlpCheckedAt && Date.now() - s.ytDlpCheckedAt < 24 * 3600_000) return;
  setTimeout(() => {
    execFile(ytDlpPath(), ['-U'], { windowsHide: true, timeout: 120_000 }, () => saveSettings({ ytDlpCheckedAt: Date.now() }));
  }, 60_000).unref();
}

// === The server (Electron acting as Node, so yt-dlp can use it to solve YouTube's challenges) ===
function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = fork(path.join(ROOT, 'server', 'main.js'), [], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        RUMORIA_TOKEN: token,
        RUMORIA_DATA_DIR: userData(),
        RUMORIA_YTDLP: ytDlpPath(),
        RUMORIA_MUSIC_DIR: musicDir(),
        RUMORIA_STATIC: DIST,
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      windowsHide: true,
    });
    const timer = setTimeout(() => reject(new Error('El servidor no arrancó.')), 20_000);
    serverProcess.once('message', (m) => {
      clearTimeout(timer);
      if (m && m.type === 'ready' && Number.isInteger(m.port)) resolve(m.port); else reject(new Error('El servidor no arrancó.'));
    });
    serverProcess.once('exit', (code) => { if (!app.isQuitting) dialog.showErrorBox('Rumoria', `El servidor se detuvo (código ${code}).`); });
  });
}

// === Security for the page ===
const isAppUrl = (u) => { try { return new URL(u).origin === appOrigin; } catch { return false; } };
const isTrustedSender = (event) => Boolean(event.senderFrame) && isAppUrl(event.senderFrame.url) && mainWindow && event.sender === mainWindow.webContents;
// Links that may open in the browser: YouTube, Spotify, Apple Music; nothing else.
const EXTERNAL_RE = /^https:\/\/(www\.|music\.)?(youtube\.com|youtu\.be|open\.spotify\.com|music\.apple\.com)\//;

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e, url) => { if (!isAppUrl(url)) e.preventDefault(); });
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL_RE.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
});

function createWindow(port) {
  const s = readSettings();
  const b = s.bounds && Number.isFinite(s.bounds.width) ? s.bounds : { width: 1280, height: 820 };
  mainWindow = new BrowserWindow({
    ...b,
    minWidth: 900,
    minHeight: 600,
    title: 'Rumoria',
    icon: path.join(ROOT, 'build', 'icon.png'),
    backgroundColor: '#0f0e17',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', () => { try { saveSettings({ bounds: mainWindow.getNormalBounds() }); } catch { /* not fatal */ } });
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

// === What the page may ask for ===
ipcMain.handle('rumoria:settings', (event) => (isTrustedSender(event) ? { musicDir: musicDir(), tubegrab: fs.existsSync(TUBEGRAB_DATA) } : null));
ipcMain.handle('rumoria:pickMusicDir', async (event) => {
  if (!isTrustedSender(event)) return null;
  const r = await dialog.showOpenDialog(mainWindow, { title: 'Tu carpeta de música', defaultPath: musicDir(), properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  saveSettings({ musicDir: r.filePaths[0] });
  if (serverProcess && serverProcess.connected) serverProcess.send({ type: 'musicDir', dir: r.filePaths[0] });
  return r.filePaths[0];
});
// "Descargar con TubeGrab": TubeGrab opens with the song in its download box (it asks before downloading).
ipcMain.handle('rumoria:downloadInTubeGrab', (event, id) => {
  if (!isTrustedSender(event) || !/^[A-Za-z0-9_-]{11}$/.test(String(id))) return false;
  shell.openExternal(`tubegrab://download?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
  return true;
});

app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
app.on('before-quit', () => { app.isQuitting = true; });
app.on('window-all-closed', () => app.quit());
app.on('quit', () => { if (serverProcess) serverProcess.kill(); });

app.whenReady().then(async () => {
  // No camera, microphone, notifications…: nothing is ever granted.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const copied = migrateFromTubeGrab(TUBEGRAB_DATA, userData());
  if (copied.length) console.log(`Rumoria: copiado de TubeGrab: ${copied.join(', ')}`);
  try { await ensureYtDlp(); updateYtDlpSoon(); } catch (err) {
    dialog.showErrorBox('Rumoria', `No se pudo preparar yt-dlp (${err.message}). Sin él no se puede escuchar de YouTube; tu música local sí funciona.`);
  }
  const port = await startServer();
  appOrigin = `http://127.0.0.1:${port}`;
  await session.defaultSession.cookies.set({ url: appOrigin, name: 'clm_t', value: token, httpOnly: true, sameSite: 'strict', secure: false });
  createWindow(port);
}).catch((err) => {
  dialog.showErrorBox('Rumoria', err.message);
  app.quit();
});

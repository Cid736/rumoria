// Rumoria updates itself from its GitHub releases, like TubeGrab: it checks
// the latest release, downloads the file for this build in the background
// (only from GitHub, only over HTTPS, redirects checked too), and keeps it only
// if its SHA-256 and size match what GitHub publishes for it. Then "Reiniciar
// y actualizar" — or simply closing Rumoria — puts it in place:
//  - installed (Rumoria-Setup.exe): the new installer runs silently over it;
//  - portable (Rumoria.exe / Rumoria-Lite.exe): a small PowerShell step waits
//    for Rumoria to close, swaps the .exe and (when asked) opens it again;
//  - Mac (Rumoria-mac-arm64.zip / -x64.zip, the app zipped): a small shell step
//    waits for Rumoria to close, unzips the new Rumoria.app next to this one and
//    swaps them (the old one is put back if anything fails).
// Your lists and history live in your user folder (%APPDATA%\rumoria,
// ~/Library/Application Support/rumoria) and are never touched.
const { app, net } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = 'Cid736/rumoria';
const ALLOWED_HOSTS = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const MAX_REDIRECTS = 5;
const FIRST_CHECK_MS = 15_000;
const RETRY_MS = 10 * 60_000;
const PERIOD_MS = 6 * 3600_000;
// v1.12: while a game is on, another look this often (a manual "Buscar" still goes at once).
const PAUSED_RETRY_MS = 5 * 60_000;
const MAX_SIZE = 400 * 1024 * 1024;

/** "1.2.0" newer than "1.1.9"? Plain X.Y.Z only. */
function isNewer(remote, local) {
  const r = String(remote).split('.').map((n) => parseInt(n, 10) || 0);
  const l = String(local).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((r[i] || 0) !== (l[i] || 0)) return (r[i] || 0) > (l[i] || 0);
  return false;
}

/** Which file of a release updates this copy. */
function assetName({ portable, packaged, lite, platform = 'win32', arch = 'x64' }) {
  if (platform === 'darwin') return `Rumoria-mac-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`;
  if (!portable && packaged) return 'Rumoria-Setup.exe';
  return lite ? 'Rumoria-Lite.exe' : 'Rumoria.exe';
}

const canWrite = (dir) => { try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; } };

/**
 * The Rumoria.app this copy runs from (…/Rumoria.app/Contents/MacOS/Rumoria),
 * or why it can't update itself: run from the disk image or from a place
 * macOS moved it to (App Translocation), or a folder it can't write to.
 */
function macBundle(execPath, { writable = canWrite } = {}) {
  const bundle = path.posix.resolve(execPath, '..', '..', '..');
  if (!bundle.endsWith('.app')) return { error: 'no se encontró Rumoria.app' };
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) return { error: 'mueve Rumoria a la carpeta Aplicaciones para que se actualice sola' };
  if (!writable(path.posix.dirname(bundle))) return { error: `no se puede escribir en ${path.posix.dirname(bundle)}` };
  return { bundle };
}

// The Mac swap: every path comes in through the environment, never into the script text.
const MAC_SWAP = [
  'while kill -0 "$RU_PID" 2>/dev/null; do sleep 0.5; done',
  'rm -rf "$RU_NEW" && mkdir -p "$RU_NEW" && /usr/bin/ditto -x -k "$RU_SRC" "$RU_NEW" || exit 1',
  '[ -d "$RU_NEW/Rumoria.app" ] || exit 1',
  'rm -rf "$RU_OLD" && mv "$RU_DST" "$RU_OLD" || exit 1',
  'if mv "$RU_NEW/Rumoria.app" "$RU_DST"; then rm -rf "$RU_OLD" "$RU_NEW"; else mv "$RU_OLD" "$RU_DST"; exit 1; fi',
  'if [ "$RU_RUN" = 1 ]; then /usr/bin/open "$RU_DST"; fi',
].join('\n');

/** The release's file for this build, with its published SHA-256, or a reason why not. */
function pickAsset(release, name, current) {
  const version = String((release && release.tag_name) || '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) return { error: 'versión publicada no válida' };
  if (!isNewer(version, current)) return { upToDate: true, version };
  const asset = ((release && release.assets) || []).find((a) => a && a.name === name);
  const digest = asset && /^sha256:([0-9a-f]{64})$/i.exec(String(asset.digest || ''));
  if (!asset || !digest || !Number.isInteger(asset.size) || asset.size <= 0 || asset.size > MAX_SIZE) return { error: `la versión ${version} no tiene un archivo verificable` };
  let url;
  try { url = new URL(asset.browser_download_url); } catch { return { error: 'enlace de descarga no válido' }; }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) return { error: 'enlace de descarga no permitido' };
  return { version, url: url.toString(), sha256: digest[1].toLowerCase(), size: asset.size };
}

function allowed(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) throw new Error(`Origen no permitido: ${u.hostname}`);
  return u.toString();
}

/**
 * GET through Chromium's network stack (Windows certificates, system proxy),
 * every redirect checked against GitHub's hosts; 30 s without data = give up.
 */
function get(raw, onResponse, onError) {
  let url;
  try { url = allowed(raw); } catch (err) { onError(err); return; }
  let left = MAX_REDIRECTS;
  let done = false;
  let idle = null;
  const fail = (err) => { if (done) return; done = true; clearTimeout(idle); try { req.abort(); } catch { /* finished */ } onError(err instanceof Error ? err : new Error(String(err))); };
  const touch = () => { clearTimeout(idle); idle = setTimeout(() => fail(new Error('Tiempo de espera agotado')), 30_000); };
  const req = net.request({ url, redirect: 'manual', useSessionCookies: false, cache: 'no-cache' });
  req.setHeader('User-Agent', 'Rumoria-Updater');
  req.setHeader('Accept', 'application/json, application/octet-stream');
  req.on('redirect', (_status, _method, to) => {
    if (left-- <= 0) return fail(new Error('Demasiadas redirecciones'));
    try { allowed(to); } catch (err) { return fail(err); }
    touch();
    req.followRedirect();
  });
  req.on('response', (res) => {
    if (res.statusCode !== 200) return fail(new Error(res.statusCode === 403 || res.statusCode === 429 ? 'GitHub limita las consultas; se reintentará' : `GitHub respondió ${res.statusCode}`));
    res.on('data', touch);
    res.on('end', () => clearTimeout(idle));
    onResponse(res);
  });
  req.on('error', (err) => fail(new Error(/INTERNET_DISCONNECTED|NAME_NOT_RESOLVED/.test(String(err && err.message)) ? 'Sin conexión' : String(err && err.message))));
  touch();
  req.end();
}

const getJson = (url) => new Promise((resolve, reject) => {
  get(url, (res) => {
    let data = '';
    res.on('data', (c) => { data += c; if (data.length > 2_000_000) reject(new Error('Respuesta demasiado grande')); });
    res.on('end', () => { try { resolve(JSON.parse(data)); } catch (err) { reject(err); } });
    res.on('error', reject);
  }, reject);
});

/** Streams to `dest` (created exclusively) → { sha256, size }. */
const download = (url, dest, onProgress) => new Promise((resolve, reject) => {
  get(url, (res) => {
    const total = parseInt(res.headers['content-length'] || '0', 10);
    const hash = crypto.createHash('sha256');
    let size = 0;
    const file = fs.createWriteStream(dest, { flags: 'wx' });
    res.on('data', (c) => {
      size += c.length;
      hash.update(c);
      if (size > MAX_SIZE) { res.destroy(); file.destroy(); reject(new Error('Archivo demasiado grande')); return; }
      if (total > 0) onProgress(Math.round((size / total) * 100));
    });
    res.on('error', reject);
    res.pipe(file);
    file.on('finish', () => file.close(() => resolve({ sha256: hash.digest('hex'), size })));
    file.on('error', reject);
  }, reject);
});

// What mkdtemp makes for a download (the prefix and six random characters).
const UPDATE_DIR = /^rumoria-update-[A-Za-z0-9]{6}$/;
const SWEEP_AFTER_MS = 10 * 60_000;

/**
 * Removes the folders earlier updates left in the temp folder (the new
 * version is in place by then; an installer may still sit in one). Only real
 * folders of ours, last changed over 10 minutes ago (one in use is left alone).
 * Returns how many went.
 */
function sweepOld({ tmp = os.tmpdir(), now = Date.now() } = {}) {
  let gone = 0;
  let names;
  try { names = fs.readdirSync(tmp); } catch { return 0; }
  for (const n of names) {
    if (!UPDATE_DIR.test(n)) continue;
    const p = path.join(tmp, n);
    try {
      const st = fs.lstatSync(p);
      if (!st.isDirectory() || st.isSymbolicLink() || now - st.mtimeMs < SWEEP_AFTER_MS) continue;
      fs.rmSync(p, { recursive: true, force: true });
      gone++;
    } catch { /* in use: next time */ }
  }
  return gone;
}

/**
 * The updater. `send(state)` tells the page; `quit()` closes Rumoria;
 * `paused()`: v1.12, a game is on (Modo juego): looking and downloading wait.
 * State: { status: 'idle'|'dev'|'checking'|'up-to-date'|'downloading'|'ready'|'error', current, latest, percent, error }
 */
function createUpdater({ root, send, quit, paused = () => false }) {
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
  const mac = process.platform === 'darwin';
  const name = assetName({ portable, packaged: app.isPackaged, lite: !fs.existsSync(path.join(root, 'bin', 'yt-dlp.exe')), platform: process.platform, arch: process.arch });
  let state = { status: 'idle', current: app.getVersion(), latest: null, percent: null, error: null };
  let ready = null; // the verified file, waiting to be put in place
  let busy = false;
  let timer = null;
  let installing = false;
  const set = (patch) => { state = { ...state, ...patch }; send(state); };

  async function check() {
    if (!app.isPackaged) { set({ status: 'dev' }); return; }
    if (busy || ready) return;
    // On a Mac, only a Rumoria.app it can replace.
    const where = mac ? macBundle(process.execPath) : null;
    if (where && where.error) { set({ status: 'error', error: where.error }); return; }
    busy = true;
    set({ status: 'checking', error: null });
    let dir = null;
    try {
      const pick = pickAsset(await getJson(`https://api.github.com/repos/${REPO}/releases/latest`), name, app.getVersion());
      if (pick.error) throw new Error(pick.error);
      if (pick.upToDate) { set({ status: 'up-to-date', latest: pick.version }); return; }
      // Downloaded on its own, into a fresh random folder.
      set({ status: 'downloading', latest: pick.version, percent: 0 });
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rumoria-update-'));
      const dest = path.join(dir, name);
      const got = await download(pick.url, dest, (percent) => { if (percent !== state.percent) set({ percent }); });
      if (got.sha256 !== pick.sha256 || got.size !== pick.size) throw new Error('el archivo descargado no coincide con su huella SHA-256 publicada');
      ready = dest;
      set({ status: 'ready', percent: 100 });
    } catch (err) {
      if (dir) fs.rm(dir, { recursive: true, force: true }, () => {});
      set({ status: 'error', error: err.message, percent: null });
      schedule(RETRY_MS);
    } finally { busy = false; }
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (paused()) { schedule(PAUSED_RETRY_MS); return; }
      check().finally(() => { if (state.status !== 'error' && !ready) schedule(PERIOD_MS); });
    }, ms);
    timer.unref?.();
  }

  /** Puts the new version in place; `relaunch`: open Rumoria again after. */
  function install(relaunch) {
    if (!ready || installing) return false;
    installing = true;
    if (mac) {
      const { bundle } = macBundle(process.execPath);
      spawn('/bin/sh', ['-c', MAC_SWAP], {
        detached: true, stdio: 'ignore',
        env: { ...process.env, RU_PID: String(process.pid), RU_SRC: ready, RU_DST: bundle, RU_NEW: path.join(path.dirname(ready), 'unzipped'), RU_OLD: path.posix.join(path.posix.dirname(bundle), 'Rumoria.old.app'), RU_RUN: relaunch ? '1' : '0' },
      }).unref();
    } else if (!portable) {
      // The verified installer, silent, over this install (per-user, no admin).
      spawn(ready, relaunch ? ['/S', '--force-run'] : ['/S'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      // The real portable .exe (not the unpacked copy this process runs from).
      // Paths go in through the environment, never into the script text.
      const script = [
        'Wait-Process -Id ([int]$env:RU_PID) -ErrorAction SilentlyContinue',
        'for ($i = 0; $i -lt 30; $i++) { try { Move-Item -LiteralPath $env:RU_SRC -Destination $env:RU_DST -Force -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 500 } }',
        'if ($env:RU_RUN -eq [string]1) { Start-Process -FilePath $env:RU_DST }',
      ].join('; ');
      spawn('cmd.exe', [`/d /c start "" /min powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "${script}"`], {
        detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
        env: { ...process.env, RU_PID: String(process.pid), RU_SRC: ready, RU_DST: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, RU_RUN: relaunch ? '1' : '0' },
      }).unref();
    }
    return true;
  }

  return {
    start() { setTimeout(() => sweepOld(), FIRST_CHECK_MS).unref?.(); schedule(FIRST_CHECK_MS); },
    state: () => state,
    check,
    /** "Reiniciar y actualizar". */
    restart() { if (install(true)) quit(); },
    /** Closing Rumoria with an update ready: it's put in place on the way out. */
    onQuit() { if (ready && !installing) install(false); },
  };
}

module.exports = { createUpdater, isNewer, assetName, macBundle, MAC_SWAP, pickAsset, sweepOld };

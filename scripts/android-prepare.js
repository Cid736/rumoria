// `npm run android:prepare`: what the Android app carries, ready for Gradle.
//  1. nodejs-mobile's libnode (Node for Android) into android/app/libnode/,
//     only if its SHA-256 matches the one pinned here.
//  2. The server, the built page (dist/, from `vite build`) and the server's
//     production dependencies, in one zip: android/app/src/main/assets/nodejs-project.zip
//     (the app unpacks it on first launch after each install or update).
//  3. That Node is built without Intl (no \p{…} in regular expressions, no
//     normalize, no Intl.Collator): every \p{…} class in the server and its
//     dependencies is rewritten as the code point ranges it stands for, and
//     android/node/shim.js (loaded first) gets the accent table it needs.
//     Both are worked out here, with this computer's full Node.
// No dependencies: zip and unzip with Node's zlib.
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'android', 'app');
const NODE_MOBILE = {
  url: 'https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v18.20.4/nodejs-mobile-v18.20.4-android.zip',
  sha256: 'bd7321eaa1a7602fbe0bb87302df2d79d87835cf4363fbdd17c350dbb485c2af',
};
const ALLOWED_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
// What the server needs at run time (nothing of the desktop app or the tests).
const SERVER_FILES = ['server', 'dist', 'package.json', 'package-lock.json', 'LICENSE', 'LEGAL.md'];

function get(u, redirects = 5) {
  return new Promise((resolve, reject) => {
    const url = new URL(u);
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) return reject(new Error(`origen no permitido: ${url.hostname}`));
    https.get(url, { headers: { 'User-Agent': 'rumoria-android' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return get(new URL(res.headers.location, url).toString(), redirects - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** Every entry of a zip: [{ name, data }] (stored or deflated). */
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error('zip no válido');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('zip no válido');
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    out.push({ name, data: method === 0 ? raw : zlib.inflateRawSync(raw) });
  }
  return out;
}

/** A zip of `files` ([{ name, data }]), deflated. */
function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = zlib.deflateRawSync(f.data, { level: 9 });
    const crc = zlib.crc32(f.data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(0, 10); head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(f.data.length, 22);
    head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
    locals.push(head, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

// ---- Unicode for a Node without Intl ----
const PROPS = ['L', 'N', 'ID_Start', 'ID_Continue'];
const hex = (c) => (c < 0x10000 ? `\\u${c.toString(16).padStart(4, '0')}` : `\\u{${c.toString(16)}}`);

/** "\p{Name}" → the same characters as ranges, to go inside [ ] in a /u regular expression. */
function expand(name) {
  const re = new RegExp(`^\\p{${name}}$`, 'u');
  const parts = [];
  let start = -1;
  for (let c = 0; c <= 0x110000; c++) {
    const inside = c < 0x110000 && !(c >= 0xd800 && c <= 0xdfff) && re.test(String.fromCodePoint(c));
    if (inside && start < 0) start = c;
    if (!inside && start >= 0) { parts.push(start === c - 1 ? hex(start) : `${hex(start)}-${hex(c - 1)}`); start = -1; }
  }
  return parts.join('');
}

/**
 * Every \p{…} in `code` replaced by its ranges. They must all be inside a
 * character class ([…]) of a /u expression (true for the server and for
 * path-to-regexp); anything else stops the build instead of guessing.
 */
function rewriteProps(code, file, ranges) {
  return code.replace(/\\([pP])\{([^}\n]*)\}/g, (m, kind, name, at) => {
    if (kind === 'P' || !Object.hasOwn(ranges, name)) throw new Error(`${file}: ${m} sin traducir`);
    const before = code.slice(code.lastIndexOf('\n', at) + 1, at);
    const open = before.lastIndexOf('[');
    if (open < 0 || before.lastIndexOf(']') > open) throw new Error(`${file}: \\p{${name}} fuera de [ ]`);
    return ranges[name];
  });
}

/** What String.prototype.normalize('NFD') does, for every character it changes (not Hangul). */
function nfdTable() {
  const nfd = {};
  for (let c = 0xa0; c < 0x30000; c++) {
    if ((c >= 0xd800 && c <= 0xdfff) || (c >= 0xac00 && c <= 0xd7a3)) continue;
    const ch = String.fromCodePoint(c);
    const d = ch.normalize('NFD');
    if (d !== ch) nfd[ch] = d;
  }
  return nfd;
}

function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else if (e.isFile()) out.push({ name: path.relative(base, p).split(path.sep).join('/'), data: fs.readFileSync(p) });
  }
  return out;
}

async function libnode() {
  const marker = path.join(APP, 'libnode', 'bin', 'arm64-v8a', 'libnode.so');
  if (fs.existsSync(marker) && !process.argv.includes('--force')) { console.log('libnode ya está'); return; }
  const buf = await get(NODE_MOBILE.url);
  const actual = crypto.createHash('sha256').update(buf).digest('hex');
  if (actual !== NODE_MOBILE.sha256) throw new Error('la huella SHA-256 de nodejs-mobile no coincide');
  const dest = path.join(APP, 'libnode');
  for (const f of unzip(buf)) {
    const to = path.join(dest, f.name);
    if (!path.resolve(to).startsWith(path.resolve(dest) + path.sep)) throw new Error(`entrada no válida: ${f.name}`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, f.data);
  }
  console.log('libnode descargado y verificado (SHA-256)');
}

function serverZip() {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('falta dist/: ejecuta antes «vite build»');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'rumoria-android-'));
  try {
    for (const f of SERVER_FILES) fs.cpSync(path.join(ROOT, f), path.join(stage, f), { recursive: true });
    // Only the server's own dependencies (express, helmet, express-rate-limit), no install scripts.
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
    fs.rmSync(path.join(stage, 'package-lock.json'));
    const ranges = Object.fromEntries(PROPS.map((p) => [p, expand(p)]));
    let rewritten = 0;
    for (const f of walk(stage)) {
      // The page (dist/) runs in the WebView, which has all of Unicode: only what Node runs.
      if (f.name.startsWith('dist/') || !f.name.endsWith('.js') ||!/\\[pP]\{/.test(f.data.toString('latin1'))) continue;
      const code = f.data.toString('utf8');
      fs.writeFileSync(path.join(stage, f.name), rewriteProps(code, f.name, ranges));
      rewritten += 1;
    }
    fs.copyFileSync(path.join(ROOT, 'android', 'node', 'shim.js'), path.join(stage, 'shim.js'));
    fs.writeFileSync(path.join(stage, 'shim-data.json'), JSON.stringify({ nfd: nfdTable() }));
    console.log(`Sin Intl: ${rewritten} archivos con \\p{…} reescritos; tabla de acentos lista`);
    const files = walk(stage);
    const out = path.join(APP, 'src', 'main', 'assets', 'nodejs-project.zip');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, zip(files));
    console.log(`Servidor y página: ${files.length} archivos, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB → ${path.relative(ROOT, out)}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (require.main === module) {
  (async () => {
    await libnode();
    serverZip();
  })().catch((err) => { console.error(`android:prepare: ${err.message}`); process.exit(1); });
}

module.exports = { expand, rewriteProps, nfdTable, zip, unzip };

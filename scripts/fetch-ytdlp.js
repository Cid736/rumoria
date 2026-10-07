// `npm run fetch-ytdlp`: the latest yt-dlp into bin/, for development and
// for the installer to ship. Installed only if its SHA-256 matches the sums
// published with the release (the same check `yt-dlp -U` does).
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const ALLOWED_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const dest = path.join(__dirname, '..', 'bin', NAME);

function get(u, redirects = 5) {
  return new Promise((resolve, reject) => {
    const url = new URL(u);
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) return reject(new Error(`origen no permitido: ${url.hostname}`));
    https.get(url, { headers: { 'User-Agent': 'rumoria-fetch' } }, (res) => {
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

(async () => {
  if (fs.existsSync(dest) && !process.argv.includes('--force')) { console.log(`yt-dlp ya está en ${dest}`); return; }
  const [bin, sums] = await Promise.all([get(`${BASE}/${NAME}`), get(`${BASE}/SHA2-256SUMS`)]);
  const line = sums.toString('utf8').split('\n').find((l) => l.trim().endsWith(` ${NAME}`));
  const expected = line && line.trim().split(/\s+/)[0].toLowerCase();
  const actual = crypto.createHash('sha256').update(bin).digest('hex');
  if (!expected || expected !== actual) throw new Error('la huella SHA-256 no coincide con la publicada');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // Without --force, never over a copy that appeared meanwhile.
  fs.writeFileSync(dest, bin, { mode: 0o755, flag: process.argv.includes('--force') ? 'w' : 'wx' });
  console.log(`yt-dlp descargado y verificado (SHA-256) en ${dest}`);
})().catch((err) => { console.error(`No se pudo descargar yt-dlp: ${err.message}`); process.exit(1); });

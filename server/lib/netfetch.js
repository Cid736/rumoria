// Fetching from the Internet on the user's behalf (Spotify / Apple Music
// pages, YouTube's media servers): public addresses only.
// The address a name resolves to is checked by the connection itself (a
// custom DNS lookup), so a feed can never point the app at this computer or
// the local network — not even by a redirect or a DNS answer that changes.
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');

const UA = 'Escuchar/1.0 (+https://github.com/Cid736/escuchar)';
const MAX_REDIRECTS = 5;

/** Loopback, private, link-local, CGNAT, multicast, reserved… (IPv4 and IPv6). */
function isPublicIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (net.isIPv6(ip)) {
    const w = ipv6Words(ip);
    if (!w) return false;
    // ::, ::1, and IPv4 inside IPv6 (::ffff:a.b.c.d, ::a.b.c.d, also written in hex).
    if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0 || w[5] === 0xffff)) {
      if (w[5] === 0 && w[6] === 0 && w[7] <= 1) return false;
      return isPublicIp(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`);
    }
    if ((w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xff00) === 0xff00) return false; // unique local, link-local, multicast
    if (w[0] === 0x64 && w[1] === 0xff9b) return false; // NAT64
    if (w[0] === 0x2001 && w[1] === 0x0db8) return false; // documentation
    if (w[0] === 0x2002) return false; // 6to4 (wraps an IPv4 address)
    if (w[0] === 0x0100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return false; // discard
    return true;
  }
  return false;
}

/** An IPv6 address → its eight 16-bit words, or null. */
function ipv6Words(ip) {
  let v = String(ip).toLowerCase().split('%')[0];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (v4) {
    const p = v4[1].split('.').map(Number);
    if (p.some((n) => n > 255)) return null;
    v = v.slice(0, -v4[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = v.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const words = [...head, ...Array(Math.max(0, fill)).fill('0'), ...tail].map((x) => parseInt(x, 16));
  return words.length === 8 && words.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? words : null;
}

/** dns.lookup that only ever hands public addresses to the socket. */
function publicLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    if (err) return cb(err);
    const ok = (list || []).filter((a) => isPublicIp(a.address));
    if (!ok.length) return cb(Object.assign(new Error('Esa dirección no es pública.'), { code: 'EPRIVATE' }));
    if (options && options.all) return cb(null, ok);
    return cb(null, ok[0].address, ok[0].family);
  });
}

function checkUrl(raw, { allowHttp = false } = {}) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new Error('Dirección no válida.'); }
  if (!(u.protocol === 'https:' || (allowHttp && u.protocol === 'http:'))) throw new Error('Solo se admiten direcciones https://');
  if (u.username || u.password) throw new Error('Dirección no válida.');
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) throw new Error('Puerto no permitido.');
  // A literal address must be public too (the lookup isn't used for those).
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicIp(host)) throw new Error('Esa dirección no es pública.');
  if (/^(localhost|.*\.local|.*\.internal|.*\.lan|.*\.home)$/i.test(host)) throw new Error('Esa dirección no es pública.');
  return u;
}

/**
 * GET `url`, following up to 5 redirects (each checked again). Resolves with
 * { status, headers, url, stream } once the answer starts; the body is the
 * caller's to read (or destroy). `timeoutMs`: no bytes for that long = fail.
 */
function get(rawUrl, { allowHttp = false, timeoutMs = 20000, headers = {}, redirects = MAX_REDIRECTS, method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = checkUrl(rawUrl, { allowHttp }); } catch (err) { reject(err); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method,
      lookup: publicLookup,
      headers: { 'User-Agent': UA, Accept: '*/*', ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
      timeout: timeoutMs,
    }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Demasiadas redirecciones.'));
        let next;
        try { next = new URL(loc, u).toString(); } catch { return reject(new Error('Redirección no válida.')); }
        return get(next, { allowHttp, timeoutMs, headers, redirects: redirects - 1 }).then(resolve, reject);
      }
      res.setTimeout(timeoutMs, () => res.destroy(new Error('Tiempo de espera agotado.')));
      resolve({ status: res.statusCode, headers: res.headers, url: u.toString(), stream: res });
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado.')));
    req.on('error', (err) => reject(err.code === 'EPRIVATE' ? err : new Error(friendly(err))));
    req.end(body || undefined);
  });
}

const friendly = (err) => {
  const c = err && err.code;
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'No se encuentra el servidor (¿sin conexión?).';
  if (c === 'ECONNREFUSED' || c === 'ECONNRESET') return 'El servidor no respondió.';
  if (c && /CERT|SSL|TLS/.test(c)) return 'Conexión segura rechazada.';
  return (err && err.message) || 'No se pudo conectar.';
};

/** The whole body as text (up to `maxBytes`), for 2xx answers; rejects otherwise. */
async function text(url, { maxBytes = 5 * 1024 * 1024, ...opts } = {}) {
  const res = await get(url, opts);
  if (res.status < 200 || res.status >= 300) { res.stream.resume(); throw new Error(`El servidor respondió ${res.status}.`); }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    res.stream.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { res.stream.destroy(); reject(new Error('La respuesta es demasiado grande.')); return; }
      chunks.push(c);
    });
    res.stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.stream.on('error', reject);
  });
}

async function json(url, opts = {}) {
  const body = await text(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  try { return JSON.parse(body); } catch { throw new Error('Respuesta no válida.'); }
}

module.exports = { get, text, json, isPublicIp, checkUrl, publicLookup, UA };

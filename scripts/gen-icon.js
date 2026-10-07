// `node scripts/gen-icon.js`: draws Rumoria's icon (no image editor, no
// dependencies): an ink rounded square with four coral equalizer bars, the
// app's own colours. Writes build/icon.ico (16–256 px), build/icon.png (512 px,
// for the window) and public/icon.png (the page's favicon).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SS = 4; // supersampling, for smooth edges
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const INK_TOP = hex('#2a2638');
const INK_BOTTOM = hex('#0b0a10');
const CORAL_TOP = hex('#ffa086');
const CORAL_BOTTOM = hex('#e8502c');
// Bars: centre x, height (fractions of the icon).
const BARS = [[0.29, 0.30], [0.43, 0.52], [0.57, 0.40], [0.71, 0.22]];
const BAR_W = 0.095;
const BASE = 0.73; // bars stand on this line

/** Inside a rounded rectangle (x0,y0)-(x1,y1) with corner radius r? */
function inRound(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function pixel(u, v) {
  if (!inRound(u, v, 0, 0, 1, 1, 0.22)) return [0, 0, 0, 0];
  for (const [cx, h] of BARS) {
    if (inRound(u, v, cx - BAR_W / 2, BASE - h, cx + BAR_W / 2, BASE, BAR_W / 2)) {
      const t = (v - (BASE - h)) / h;
      return [...CORAL_TOP.map((c, i) => lerp(c, CORAL_BOTTOM[i], t)), 255];
    }
  }
  // A thin coral line under the bars (the "floor" of the sound).
  if (inRound(u, v, 0.22, BASE + 0.045, 0.78, BASE + 0.075, 0.015)) return [...CORAL_BOTTOM, 200];
  const t = v * 0.85 + u * 0.15;
  return [...INK_TOP.map((c, i) => lerp(c, INK_BOTTOM[i], t)), 255];
}

function render(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // PNG row filter: none
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const p = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          // Colours weighted by their opacity, so edges don't go dark.
          acc[0] += p[0] * p[3]; acc[1] += p[1] * p[3]; acc[2] += p[2] * p[3]; acc[3] += p[3];
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const a = acc[3] / (SS * SS);
      raw[o] = acc[3] ? Math.round(acc[0] / acc[3]) : 0;
      raw[o + 1] = acc[3] ? Math.round(acc[1] / acc[3]) : 0;
      raw[o + 2] = acc[3] ? Math.round(acc[2] / acc[3]) : 0;
      raw[o + 3] = Math.round(a);
    }
  }
  return png(size, raw);
}

// ---- a minimal PNG writer (RGBA, 8 bits) ----
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- an ICO with PNG entries (Windows Vista and later read them) ----
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((x) => x.data)]);
}

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.mkdirSync(path.join(root, 'public'), { recursive: true });
const images = [16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: render(size) }));
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(images));
fs.writeFileSync(path.join(root, 'build', 'icon.png'), render(512));
fs.writeFileSync(path.join(root, 'public', 'icon.png'), render(64));
console.log('build/icon.ico, build/icon.png, public/icon.png');

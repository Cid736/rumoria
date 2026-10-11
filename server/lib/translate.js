// v1.7: a song's lyrics translated into Spanish, line by line, to show under
// the original. Only when you turn it on (Ajustes or the Letra panel): the
// lyrics' text — never anything about you — goes to Google Translate
// (translate.googleapis.com, the same free service its web widget uses). Only
// ever that one host, with a timeout and a size cap; what comes back is
// cleaned, and each song's translation is kept so it's asked for once.
const crypto = require('crypto');
const fs = require('fs');
const { writeFileAtomic } = require('./atomic');

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const TIMEOUT_MS = 12000;
const MAX_BYTES = 1024 * 1024;
const MAX_LINES = 250;
const MAX_CHARS = 9000;
const MAX_KEPT = 300;
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const line = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);

async function readCapped(res) {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('Respuesta demasiado grande');
  const chunks = [];
  let total = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) { reader.cancel().catch(() => {}); throw new Error('Respuesta demasiado grande'); }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * Lines (an empty one stays empty) → { lines (same count), from } in `to`, or
 * { same: true, from } when they are already in that language. Throws on
 * network trouble or an answer that isn't a translation.
 */
async function translateLines(input, { to = 'es', fetchImpl = fetch } = {}) {
  if (!LANG_RE.test(to)) throw new Error('Idioma no válido');
  const all = (Array.isArray(input) ? input : []).slice(0, MAX_LINES).map(line);
  // Only lines with words go; the rest (blank, "♪") come back as they were.
  const idx = [];
  const text = [];
  let chars = 0;
  all.forEach((l, i) => {
    if (!/[\p{L}]/u.test(l) || chars + l.length > MAX_CHARS) return;
    idx.push(i);
    text.push(l);
    chars += l.length + 1;
  });
  if (!text.length) return { lines: all.map(() => ''), from: null };
  const url = new URL(ENDPOINT);
  for (const [k, v] of [['client', 'gtx'], ['sl', 'auto'], ['tl', to], ['dt', 't']]) url.searchParams.set(k, v);
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
    body: new URLSearchParams({ q: text.join('\n') }).toString(),
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`El traductor respondió ${res.status}`);
  const data = JSON.parse(await readCapped(res));
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('El traductor no devolvió una traducción');
  const from = typeof data[2] === 'string' && LANG_RE.test(data[2]) ? data[2] : null;
  if (from && from.split('-')[0] === to.split('-')[0]) return { same: true, from };
  const joined = data[0].map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : '')).join('');
  const back = joined.split('\n');
  const lines = all.map(() => '');
  idx.forEach((i, k) => { lines[i] = line(back[k]); });
  return { lines, from };
}

/** Translations kept on disk (translations.json), by the lyrics' text and language; the newest MAX_KEPT. */
class TranslationCache {
  constructor(file) {
    this.file = file;
    this.items = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [k, v] of Object.entries(raw.items || {}).slice(-MAX_KEPT)) {
        if (!/^[a-f0-9]{40}$/.test(k) || !v || typeof v !== 'object') continue;
        if (v.same === true) this.items.set(k, { same: true, from: LANG_RE.test(String(v.from)) ? v.from : null });
        else if (Array.isArray(v.lines) && v.lines.length <= MAX_LINES) this.items.set(k, { lines: v.lines.map(line), from: LANG_RE.test(String(v.from)) ? v.from : null });
      }
    } catch { /* none yet */ }
  }

  static key(lines, to) { return crypto.createHash('sha1').update(`${to}\n${lines.join('\n')}`).digest('hex'); }
  get(key) { return this.items.get(key) || null; }
  put(key, value) {
    this.items.delete(key);
    this.items.set(key, value);
    while (this.items.size > MAX_KEPT) this.items.delete(this.items.keys().next().value);
    try { writeFileAtomic(this.file, JSON.stringify({ v: 1, items: Object.fromEntries(this.items) })); } catch { /* not fatal */ }
  }
}

module.exports = { translateLines, TranslationCache, ENDPOINT };

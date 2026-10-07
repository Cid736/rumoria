// Song lyrics from LRCLIB (https://lrclib.net): free, no account, no key.
// Only ever talks to that one host, with a timeout and a size cap, and
// everything that comes back is cleaned before it goes near a file.
const LRCLIB = 'https://lrclib.net';
const TIMEOUT_MS = 10000;
const MAX_BYTES = 512 * 1024;
const MAX_LYRICS = 20000;
const { version } = require('../../package.json');

const USER_AGENT = `CLMusic/${version} (https://github.com/Cid736/clmusic)`;

// "(Official Video)", "[Lyrics]", "ft. X"… don't help finding the song.
const NOISE = /\s*[([][^)\]]*(official|video|audio|lyric|letra|visualizer|remaster|hd|4k|mv)[^)\]]*[)\]]/gi;

/** Printable text only: keeps line breaks, drops other control characters, caps the length. */
function cleanText(value, max = MAX_LYRICS) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
}

const cleanTitle = (title) => cleanText(title, 300).replace(NOISE, '').replace(/\s+(ft\.?|feat\.?)\s.*$/i, '').trim();

/** `LRC` lines only ("[mm:ss.xx] text"), so a stray answer can't write anything else into the .lrc file. */
function cleanSynced(lrc) {
  return cleanText(lrc).split('\n').filter((l) => /^\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(l)).join('\n');
}

async function getJson(path, params, fetchImpl) {
  const url = new URL(path, LRCLIB);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB respondió ${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('Respuesta demasiado grande');
  // Read chunk by chunk and stop at the cap (a missing or false length can't
  // make us hold more than MAX_BYTES).
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
  return JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'));
}

/** Real lyrics: a few lines of words at least (or an instrumental, which has none). */
function plausible(x) {
  if (!x || typeof x !== 'object') return false;
  if (x.instrumental) return true;
  const plain = cleanText(x.plainLyrics);
  const synced = cleanSynced(x.syncedLyrics);
  const lines = (plain || synced).split('\n').filter((l) => /[\p{L}]{2}/u.test(l));
  return lines.length >= 3 || (plain || synced).replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim().length >= 10;
}

/**
 * { artist, title, album?, duration? } → { plain, synced } (either may be ''),
 * or null when there are none. Throws only on network trouble.
 */
async function findLyrics({ artist, title, album, duration }, { fetchImpl = fetch } = {}) {
  const track = cleanTitle(title);
  const who = cleanText(artist, 300);
  if (!track || !who) return null;
  const secs = Number.isFinite(Number(duration)) && Number(duration) > 0 ? Math.round(Number(duration)) : null;
  let hit = await getJson('/api/get', { artist_name: who, track_name: track, album_name: cleanText(album, 300), duration: secs }, fetchImpl);
  // Anyone can add lyrics to LRCLIB: an entry that's only a word or two
  // ("probe", "test") isn't the song's — then the best of the search.
  if (!plausible(hit)) {
    const list = await getJson('/api/search', { artist_name: who, track_name: track }, fetchImpl);
    hit = null;
    if (Array.isArray(list)) {
      const ok = list.filter((x) => plausible(x) && !x.instrumental && (secs === null || !Number.isFinite(x.duration) || Math.abs(x.duration - secs) <= 5));
      hit = ok.find((x) => x.syncedLyrics) || ok[0] || null;
    }
  }
  if (!hit || typeof hit !== 'object' || hit.instrumental) return null;
  const plain = cleanText(hit.plainLyrics);
  const synced = cleanSynced(hit.syncedLyrics);
  if (!plain && !synced) return null;
  // Players that only read plain lyrics get the synced text without the times.
  return { plain: plain || synced.replace(/^\[[^\]]+\]\s?/gm, ''), synced, ...(Number.isFinite(hit.duration) && hit.duration > 0 ? { duration: hit.duration } : {}) };
}

module.exports = { findLyrics, cleanText, cleanTitle, cleanSynced, USER_AGENT };

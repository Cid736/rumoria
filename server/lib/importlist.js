// Playlists from Spotify and Apple Music: their public pages list the songs
// (title, artist, length); each one is then looked for on YouTube and
// downloaded like a search result. Nothing is downloaded from those services.
const netfetch = require('./netfetch');

const MAX_TRACKS = 300;
const clean = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** A Spotify or Apple Music link → { service, kind, id, url } (the page we read), or null. */
function parseImportUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (host === 'open.spotify.com') {
    // /playlist/<id>, /album/<id>, /track/<id>, also with /intl-xx/ in front.
    const m = /^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album|track)\/([A-Za-z0-9]{10,40})\/?$/.exec(u.pathname);
    return m ? { service: 'spotify', kind: m[1], id: m[2], url: `https://open.spotify.com/embed/${m[1]}/${m[2]}` } : null;
  }
  if (host === 'music.apple.com' || host === 'embed.music.apple.com') {
    const m = /^\/([a-z]{2})\/(playlist|album|song)\/[^/]{0,200}\/?([A-Za-z0-9.\-_]{1,80})$/.exec(u.pathname)
      || /^\/([a-z]{2})\/(playlist|album|song)\/([A-Za-z0-9.\-_]{1,80})$/.exec(u.pathname);
    return m ? { service: 'apple', kind: m[2], id: m[3], url: `https://music.apple.com${u.pathname}` } : null;
  }
  return null;
}

const isImportUrl = (raw) => Boolean(parseImportUrl(raw));

/** The JSON of a <script id="…"> block, or null. */
function scriptJson(html, id) {
  const re = new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`);
  const m = re.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function parseSpotify(html) {
  const data = scriptJson(html, '__NEXT_DATA__');
  const e = data && data.props && data.props.pageProps && data.props.pageProps.state && data.props.pageProps.state.data && data.props.pageProps.state.data.entity;
  if (!e || typeof e !== 'object') return null;
  const list = Array.isArray(e.trackList) ? e.trackList : (e.type === 'track' ? [{ title: e.name || e.title, subtitle: (e.artists || []).map((a) => a && a.name).filter(Boolean).join(', ') || e.subtitle, duration: e.duration && e.duration.totalMilliseconds }] : []);
  const tracks = list.slice(0, MAX_TRACKS).map((t) => ({
    title: clean(t && t.title),
    artist: clean(t && t.subtitle, 120),
    duration: Number.isFinite(Number(t && t.duration)) && Number(t.duration) > 0 ? Math.round(Number(t.duration) / 1000) : null,
  })).filter((t) => t.title);
  return { title: clean(e.name || e.title || 'Spotify', 150), tracks };
}

function parseApple(html) {
  const data = scriptJson(html, 'serialized-server-data');
  const out = [];
  const seen = new Set();
  let nodes = 0;
  (function walk(o, depth) {
    if (!o || typeof o !== 'object' || depth > 40 || out.length >= MAX_TRACKS || ++nodes > 200000) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    if (typeof o.title === 'string' && typeof o.artistName === 'string' && (!o.contentDescriptor || o.contentDescriptor.kind === 'song')) {
      const key = String(o.id || `${o.title}|${o.artistName}`);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ title: clean(o.title), artist: clean(o.artistName, 120), duration: Number(o.duration) > 0 ? Math.round(Number(o.duration) / 1000) : null });
      }
      return;
    }
    for (const k of Object.keys(o)) walk(o[k], depth + 1);
  })(data, 0);
  const t = /<meta property="og:title" content="([^"]*)"/.exec(html);
  const title = t ? clean(t[1].replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/ on Apple Music$| en Apple Music$/i, ''), 150) : 'Apple Music';
  return { title, tracks: out.filter((x) => x.title) };
}

/** Reads the list behind a link: { service, title, tracks: [{ title, artist, duration, query }] }. */
async function readImport(raw, { fetchText = netfetch.text } = {}) {
  const ref = parseImportUrl(raw);
  if (!ref) throw new Error('Pega un enlace de una playlist, un álbum o una canción de Spotify o Apple Music.');
  const html = await fetchText(ref.url, { headers: { Accept: 'text/html', 'Accept-Language': 'en' }, maxBytes: 8 * 1024 * 1024 });
  const list = ref.service === 'spotify' ? parseSpotify(html) : parseApple(html);
  if (!list || !list.tracks.length) throw new Error('No se encontraron canciones en ese enlace (¿es privado?).');
  return {
    service: ref.service,
    title: list.title,
    tracks: list.tracks.map((x) => ({ ...x, query: searchQuery(x) })),
  };
}

/** A Spotify profile link (open.spotify.com/user/<id>) → { id, url }, or null. */
function parseProfileUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hostname.toLowerCase() !== 'open.spotify.com') return null;
  const m = /^\/(?:intl-[a-z-]+\/)?user\/([A-Za-z0-9._-]{1,64})\/?$/.exec(u.pathname);
  return m ? { id: m[1], url: `https://open.spotify.com/user/${m[1]}` } : null;
}
const isProfileUrl = (raw) => Boolean(parseProfileUrl(raw));

const MAX_PROFILE_LISTS = 50;
/**
 * The public playlists shown on a Spotify profile (its page, read without an
 * account: Spotify shows the first ones and says how many there are in all).
 * → { name, total, playlists: [{ name, url }] }
 */
function parseProfile(html, id) {
  const m = /<script[^>]*id="initialState"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  let state = null;
  if (m) {
    const raw = m[1].trim();
    try { state = JSON.parse(raw); } catch { try { state = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch { state = null; } }
  }
  const items = state && state.entities && state.entities.items;
  const user = items && typeof items === 'object' ? items[`spotify:user:${id}`] || Object.values(items).find((x) => x && x.__typename === 'User') : null;
  const out = [];
  const seen = new Set();
  const add = (pid, name) => {
    if (!/^[A-Za-z0-9]{22}$/.test(pid) || seen.has(pid) || out.length >= MAX_PROFILE_LISTS) return;
    seen.add(pid);
    out.push({ name: clean(name, 150) || 'Spotify', url: `https://open.spotify.com/playlist/${pid}` });
  };
  const lists = user && user.publicPlaylistsV2 && Array.isArray(user.publicPlaylistsV2.items) ? user.publicPlaylistsV2.items : [];
  for (const x of lists) {
    const uri = String((x && (x._uri || (x.data && x.data.uri))) || '');
    const pm = /^spotify:playlist:([A-Za-z0-9]{22})$/.exec(uri);
    if (pm) add(pm[1], x.data && x.data.name);
  }
  // No data block (the page changed): the links on it.
  if (!out.length) for (const lm of html.matchAll(/href="\/playlist\/([A-Za-z0-9]{22})"/g)) add(lm[1], '');
  const total = user && user.publicPlaylistsV2 && Number.isInteger(user.publicPlaylistsV2.totalCount) ? user.publicPlaylistsV2.totalCount : out.length;
  return { name: clean(user && user.name, 100) || id, total: Math.max(total, out.length), playlists: out };
}
async function readProfile(raw, { fetchText = netfetch.text } = {}) {
  const ref = parseProfileUrl(raw);
  if (!ref) throw new Error('Pega el enlace de un perfil de Spotify.');
  const html = await fetchText(ref.url, { headers: { Accept: 'text/html', 'Accept-Language': 'en' }, maxBytes: 8 * 1024 * 1024 });
  const p = parseProfile(html, ref.id);
  if (!p.playlists.length) throw new Error('Ese perfil no enseña ninguna lista pública (en Spotify: la lista → ⋯ → «Añadir al perfil»).');
  return { ...p, url: ref.url };
}

/** What to look for on YouTube for one song: "Artist - Title" (official audio first). */
function searchQuery({ title, artist }) {
  const q = clean(`${artist ? `${artist.split(',')[0]} - ` : ''}${title}`, 180);
  return q;
}

module.exports = { parseImportUrl, isImportUrl, parseSpotify, parseApple, readImport, searchQuery, MAX_TRACKS, parseProfileUrl, isProfileUrl, parseProfile, readProfile };

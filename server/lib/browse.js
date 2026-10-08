// "Explorar": ready-made lists to play without adding anything. Each one is a
// fixed search (never text from the page) for YouTube playlists on a theme; the
// songs of the first few playlists found make the list (a plain video search
// would bring mostly hour-long compilations). Only songs stay (no mixes, lives
// or compilations), and the result is kept a few hours on disk.
const fs = require('fs');
const { writeFileAtomic } = require('./atomic');
const { isUnavailable } = require('./ytdlp');

const year = () => new Date().getFullYear();
// id → what it's called and what's searched. Names are ours (no other service's).
// "featured" ones show on the home page; all of them in "Todas las categorías".
const g = (id, name, sub, q, featured = false) => ({ id, name, sub, q: typeof q === 'function' ? q : () => q, group: 'genre', featured });
const CATEGORIES = [
  g('exitos', 'Éxitos del momento', 'Lo que más suena ahora', () => `éxitos ${year()}`, true),
  g('pop-es', 'Pop en español', 'Lo nuevo y lo que no cansa', () => `pop en español ${year()}`, true),
  g('urbano', 'Urbano latino', 'Reggaetón, trap y dembow', () => `reggaeton ${year()}`, true),
  g('rap-es', 'Rap en español', 'Barras y beats', 'rap en español', true),
  g('rock', 'Rock de siempre', 'Himnos de guitarra', 'classic rock hits', true),
  g('indie', 'Indie', 'Guitarras y voces de aquí y de fuera', 'indie music', true),
  g('electronica', 'Electrónica', 'House, techno y más', () => `electronic music ${year()}`, true),
  g('chill', 'Para relajarse', 'Suave, sin prisa', 'chill music', true),
  g('focus', 'Para concentrarse', 'Instrumental, sin letra', 'lofi instrumental', true),
  g('gym', 'Para entrenar', 'Ritmo para moverse', 'workout music', true),
  g('ochentas', 'Clásicos de los 80', 'Los que siempre vuelven', '80s hits', true),
  g('noventas', 'Años 90 y 2000', 'Para cantar a gritos', '90s 2000s hits', true),
  g('dosmil10', 'Años 2010', 'La década del streaming', '2010s hits'),
  g('pop', 'Pop internacional', 'Los grandes del pop', () => `pop hits ${year()}`),
  g('kpop', 'K-pop', 'Lo que suena en Seúl', () => `kpop ${year()}`),
  g('jpop', 'J-pop', 'De Tokio para el mundo', 'jpop hits'),
  g('anime', 'Anime', 'Openings y endings', 'anime openings'),
  g('rnb', 'R&B', 'Voces suaves y ritmo', 'r&b hits'),
  g('soul', 'Soul y funk', 'Para mover los hombros', 'soul funk classics'),
  g('hiphop', 'Hip hop', 'Del Bronx a hoy', 'hip hop hits'),
  g('metal', 'Metal', 'Distorsión al máximo', 'metal hits'),
  g('punk', 'Punk', 'Rápido y sin pedir permiso', 'punk rock hits'),
  g('alternativa', 'Alternativa', 'Lo que no cabe en otro sitio', 'alternative rock hits'),
  g('jazz', 'Jazz', 'Clásicos y nuevos', 'jazz classics'),
  g('blues', 'Blues', 'Guitarras con alma', 'blues classics'),
  g('clasica', 'Clásica', 'Los compositores de siempre', 'classical music essentials'),
  g('piano', 'Piano', 'Solo piano', 'piano instrumental'),
  g('flamenco', 'Flamenco', 'Del cante al flamenquito', 'flamenco'),
  g('rumba', 'Rumba y canción española', 'Para cantar en la sobremesa', 'rumba española'),
  g('salsa', 'Salsa', 'A bailar', 'salsa clásica'),
  g('bachata', 'Bachata', 'Para bailar pegados', 'bachata'),
  g('cumbia', 'Cumbia', 'De Colombia a Argentina', 'cumbia'),
  g('regional', 'Regional mexicano', 'Corridos, banda y mariachi', () => `regional mexicano ${year()}`),
  g('reggae', 'Reggae', 'Buen rollo', 'reggae classics'),
  g('afro', 'Afrobeats', 'Ritmos de África', 'afrobeats'),
  g('country', 'Country', 'Guitarra, carretera y botas', 'country hits'),
  g('folk', 'Folk y acústica', 'Voces y guitarras', 'acoustic folk'),
  g('fiesta', 'Fiesta', 'Para que nadie se siente', 'party music'),
  g('amor', 'Amor', 'Canciones para alguien', 'love songs'),
  g('dormir', 'Para dormir', 'Calma para cerrar los ojos', 'calm songs to fall asleep'),
  g('cocinar', 'Para cocinar', 'Con buen ritmo y sin prisas', 'cooking music'),
  g('coche', 'En el coche', 'Ventanilla bajada', 'road trip songs'),
  g('gaming', 'Para jugar', 'Energía para la partida', 'gaming music'),
  g('cine', 'Bandas sonoras', 'Cine y series', 'movie soundtracks'),
  g('infantil', 'Para peques', 'Canciones infantiles', 'canciones infantiles'),
];
// Popular artists' radios: one of their songs and YouTube's mix of it. Each
// says which categories it belongs to, so Inicio can lean on your genres when
// it picks which radios to show (it rotates them). The first ones are
// "featured": read ahead for everyone; the rest when they are shown or opened.
const r = (artist, ...tags) => [artist, tags];
const FEATURED_RADIOS = 12;
const POPULAR_ARTISTS = [
  r('Bad Bunny', 'urbano', 'exitos'), r('KAROL G', 'urbano', 'exitos'), r('Rosalía', 'pop-es', 'flamenco', 'urbano'), r('Shakira', 'pop-es', 'pop'),
  r('Bruno Mars', 'pop', 'soul', 'rnb'), r('Coldplay', 'pop', 'indie', 'rock'), r('Dua Lipa', 'pop', 'electronica', 'fiesta'), r('The Weeknd', 'pop', 'rnb'),
  r('Ed Sheeran', 'pop', 'folk', 'amor'), r('Taylor Swift', 'pop', 'country'), r('Quevedo', 'urbano', 'pop-es'), r('Peso Pluma', 'regional', 'urbano'),
  r('Feid', 'urbano'), r('Rauw Alejandro', 'urbano', 'pop-es'), r('Myke Towers', 'urbano'), r('Ozuna', 'urbano'), r('J Balvin', 'urbano', 'fiesta'),
  r('Daddy Yankee', 'urbano', 'fiesta', 'noventas'), r('Young Miko', 'urbano', 'rap-es'), r('Bizarrap', 'rap-es', 'urbano'), r('Duki', 'rap-es', 'urbano'),
  r('Trueno', 'rap-es'), r('Natos y Waor', 'rap-es'), r('Mora', 'urbano'), r('Aitana', 'pop-es'), r('Sebastián Yatra', 'pop-es', 'amor'),
  r('Pablo Alborán', 'pop-es', 'amor'), r('Morat', 'pop-es', 'folk'), r('Camilo', 'pop-es', 'amor'), r('Melendi', 'pop-es', 'rumba'),
  r('Estopa', 'rumba', 'rock'), r('Grupo Frontera', 'regional'), r('Natanael Cano', 'regional'), r('Romeo Santos', 'bachata', 'amor'),
  r('Prince Royce', 'bachata'), r('Marc Anthony', 'salsa'), r('Billie Eilish', 'pop', 'alternativa'), r('Harry Styles', 'pop'),
  r('Sabrina Carpenter', 'pop'), r('Olivia Rodrigo', 'pop', 'punk'), r('Ariana Grande', 'pop', 'rnb'), r('SZA', 'rnb'),
  r('Drake', 'hiphop', 'rnb'), r('Kendrick Lamar', 'hiphop'), r('Travis Scott', 'hiphop'), r('Eminem', 'hiphop', 'dosmil10'),
  r('Arctic Monkeys', 'indie', 'alternativa'), r('Imagine Dragons', 'alternativa', 'pop', 'gym'), r('Linkin Park', 'alternativa', 'metal', 'noventas'),
  r('Queen', 'rock', 'ochentas'), r('Måneskin', 'rock'), r('Calvin Harris', 'electronica', 'fiesta'), r('David Guetta', 'electronica', 'fiesta', 'gym'),
  r('Avicii', 'electronica', 'dosmil10'), r('BTS', 'kpop'), r('BLACKPINK', 'kpop'), r('Stray Kids', 'kpop'), r('Burna Boy', 'afro'), r('Rema', 'afro'),
  r('Bob Marley', 'reggae'), r('Metallica', 'metal', 'rock'),
];
const RADIOS = POPULAR_ARTISTS.map(([artist, tags], i) => ({
  id: `radio-${artist.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}`,
  name: `Radio de ${artist}`, sub: `${artist} y artistas parecidos`, artist, tags, group: 'radio', featured: i < FEATURED_RADIOS,
}));
const ALL = [...CATEGORIES, ...RADIOS];
const BY_ID = new Map(ALL.map((c) => [c.id, c]));
const CACHE_MS = 6 * 3600 * 1000;
const MAX = 40;
const PLAYLIST_ID = /^(PL|OLAK5uy_)[A-Za-z0-9_-]{10,60}$/;
// Whole words, accents included (\b doesn't see "Á" as part of a word).
const NOT_A_SONG = /(?<![\p{L}\p{N}])(full album|álbum completo|album completo|mix|megamix|playlist|compilation|recopilaci[oó]n|1 hour|1 hora|live|en vivo|en directo|reaction|karaoke|8d|slowed|sped up|nightcore|tutorial|shorts?)(?![\p{L}\p{N}])/iu;

/** Search results → the songs worth listing (ids, sane length, no mixes), once each. */
function songsOf(results) {
  const seen = new Set();
  return (results || []).filter((e) => {
    if (!e || !/^[A-Za-z0-9_-]{11}$/.test(String(e.id)) || seen.has(e.id)) return false;
    if (NOT_A_SONG.test(String(e.title || ''))) return false;
    // v1.6.3: a video YouTube no longer serves (also in lists kept on disk from before).
    if (isUnavailable(e)) return false;
    if (Number.isFinite(e.duration) && (e.duration < 90 || e.duration > 600)) return false;
    seen.add(e.id);
    return true;
  }).slice(0, MAX).map(({ id, title, channel, duration, thumbnail }) => ({
    id, title: String(title || '').slice(0, 300), channel: channel ? String(channel).slice(0, 120) : null,
    duration: Number.isFinite(duration) ? duration : null,
    // Only YouTube's own image hosts (the cache file is read back from disk).
    thumbnail: typeof thumbnail === 'string' && /^https:\/\/i\d?\.ytimg\.com\//.test(thumbnail) ? thumbnail : null,
  }));
}

/** YouTube's search for playlists (its own filter), for a fixed text of ours. */
const playlistSearchUrl = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAw%3D%3D`;

/**
 * The songs for a search: the first playlists found, in turns, else (none)
 * a plain video search. `flatList(target, limit)` → { entries } or null.
 */
async function findSongs(q, flatList) {
  const found = await flatList(playlistSearchUrl(q), 10);
  const ids = ((found && found.entries) || []).map((e) => String(e.id)).filter((id) => PLAYLIST_ID.test(id)).slice(0, 3);
  const lists = [];
  for (const id of ids) {
    const l = await flatList(`https://www.youtube.com/playlist?list=${id}`, 80);
    if (l && l.entries.length) lists.push(songsOf(l.entries));
  }
  const merged = [];
  for (let i = 0; merged.length < MAX * 2 && lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i]) merged.push(l[i]);
  let songs = songsOf(merged);
  if (songs.length < 10) {
    const plain = await flatList(`ytsearch30:${q} official audio`, 30);
    songs = songsOf([...songs, ...((plain && plain.entries) || [])]);
  }
  return songs;
}

/** An artist's radio: one of their songs first, then YouTube's mix of it. */
async function radioSongs(artist, flatList) {
  const found = await flatList(`ytsearch8:${artist} official audio`, 8);
  const seed = songsOf((found && found.entries) || [])[0];
  if (!seed) return [];
  const mix = await flatList(`https://www.youtube.com/watch?v=${seed.id}&list=RD${seed.id}`, 50);
  return songsOf([seed, ...((mix && mix.entries) || [])]);
}

/** What a list is made from: its search, or its radio's artist. */
const searchOf = (c) => (c.group === 'radio' ? `radio:${c.artist}` : c.q());

class Browse {
  constructor(file, { now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    this.cache = {}; // id -> { at, tracks }
    this.pending = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const c of ALL) {
        const hit = raw && raw[c.id];
        if (hit && Number.isFinite(hit.at) && Array.isArray(hit.tracks)) this.cache[c.id] = { at: hit.at, q: typeof hit.q === 'string' ? hit.q.slice(0, 200) : null, tracks: songsOf(hit.tracks) };
      }
    } catch { /* none yet */ }
  }

  save() {
    try { writeFileAtomic(this.file, JSON.stringify(this.cache)); } catch { /* not fatal */ }
  }

  /** The lists, with covers once a list has been read. */
  list() {
    return ALL.map((c) => {
      const hit = this.cache[c.id];
      const thumbs = hit ? [...new Set(hit.tracks.map((t) => t.thumbnail).filter(Boolean))].slice(0, 4) : [];
      const out = { id: c.id, name: c.name, sub: c.sub, group: c.group, featured: c.featured, thumbs, count: hit ? hit.tracks.length : null };
      return c.group === 'radio' ? { ...out, artist: c.artist, tags: c.tags } : out;
    });
  }

  has(id) { return BY_ID.has(String(id)); }

  /** Read less than `ms` ago (six hours by default; else worth reading again). */
  isFresh(id, ms = CACHE_MS) {
    const c = BY_ID.get(String(id));
    return Boolean(c && this.fresh(c, this.cache[c.id], ms));
  }

  /** Read less than `ms` ago, and with the search it has now (a changed search is read again at once). */
  fresh(c, hit, ms = CACHE_MS) {
    return Boolean(hit && hit.tracks.length && hit.q === searchOf(c) && this.now() - hit.at < ms);
  }

  /** One list's songs: from the cache while fresh, else looked up (once at a time). */
  async get(id, flatList) {
    const c = BY_ID.get(String(id));
    if (!c) return null;
    const hit = this.cache[c.id];
    if (this.fresh(c, hit)) return { id: c.id, name: c.name, sub: c.sub, tracks: hit.tracks };
    if (!this.pending.has(c.id)) {
      this.pending.set(c.id, (async () => {
        const tracks = c.group === 'radio' ? await radioSongs(c.artist, flatList) : await findSongs(c.q(), flatList);
        // A poor answer (YouTube half-answering) never replaces a good list.
        const old = this.cache[c.id];
        // (A list made with another search, from an older version, is replaced whatever its size.)
        if (tracks.length && (!old || old.q !== searchOf(c) || tracks.length >= Math.min(10, old.tracks.length))) { this.cache[c.id] = { at: this.now(), q: searchOf(c), tracks }; this.save(); }
        return tracks;
      })().finally(() => this.pending.delete(c.id)));
    }
    let tracks = await this.pending.get(c.id);
    // YouTube didn't answer (or barely): what we had, even if old.
    const kept = this.cache[c.id];
    if (kept && kept.tracks.length > tracks.length) tracks = kept.tracks;
    return { id: c.id, name: c.name, sub: c.sub, tracks };
  }
}

module.exports = { Browse, CATEGORIES, RADIOS, ALL, songsOf, findSongs, radioSongs, playlistSearchUrl, NOT_A_SONG };

// "No me recomiendes esto": songs and artists you don't want suggested. They
// stay out of recommendations, radios, "Para ti" and the lists that fill
// themselves (you can still search them and play them yourself). hidden.json,
// only on this computer, only known shapes.
const fs = require('fs');
const { writeFileAtomic } = require('./atomic');

const MAX_SONGS = 500;
const MAX_ARTISTS = 200;
const KEY_RE = /^(yt:[A-Za-z0-9_-]{11}|f:[^\u0000-\u001f\u007f]{1,500})$/;
const text = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * How an artist is compared: folded, without "- Topic", "VEVO", "Official"
 * and symbols — YouTube gives one artist many channel names.
 */
function artistKey(name) {
  return fold(name).replace(/ ?- ?topic$/, '').replace(/vevo$/, '').replace(/(?<![\p{L}\p{N}])(official|oficial)(?![\p{L}\p{N}])/gu, ' ')
    .replace(/[^\p{L}\p{N}&' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** Who a song is by: "Artist - Title" in its title when it says so, else its artist (or channel). */
function artistOfSong(s) {
  const m = /^(.{1,80}?) [-–—] /.exec(text(s && s.title, 300));
  return [m ? artistKey(m[1]) : '', artistKey(s && s.artist)].filter(Boolean);
}

const cleanSong = (s) => (s && KEY_RE.test(String(s.key || '')) ? { key: String(s.key), title: text(s.title, 300), artist: text(s.artist, 200), at: Number.isFinite(s.at) ? s.at : Date.now() } : null);
const cleanArtist = (a) => {
  if (!a || typeof a !== 'object' || typeof a.name !== 'string') return null;
  const name = text(a.name, 120);
  return name && artistKey(name) ? { name, at: Number.isFinite(a && a.at) ? a.at : Date.now() } : null;
};

class Hidden {
  constructor(file, { now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    this.songs = [];
    this.artists = [];
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.songs = (Array.isArray(raw.songs) ? raw.songs : []).map(cleanSong).filter(Boolean).slice(0, MAX_SONGS);
      this.artists = (Array.isArray(raw.artists) ? raw.artists : []).map(cleanArtist).filter(Boolean).slice(0, MAX_ARTISTS);
    } catch { /* none yet */ }
    this.index();
  }

  index() {
    this.songKeys = new Set(this.songs.map((s) => s.key));
    this.artistKeys = new Set(this.artists.map((a) => artistKey(a.name)));
  }

  save() {
    this.index();
    try { writeFileAtomic(this.file, JSON.stringify({ songs: this.songs, artists: this.artists })); } catch { /* not fatal */ }
  }

  list() { return { songs: this.songs.slice(), artists: this.artists.slice() }; }

  /** Hides a song ({ key, title, artist }) or an artist (a name). Returns the list, or null if it isn't valid. */
  add({ song, artist } = {}) {
    if (song) {
      const s = cleanSong({ ...song, at: this.now() });
      if (!s) return null;
      this.songs = [s, ...this.songs.filter((x) => x.key !== s.key)].slice(0, MAX_SONGS);
    } else if (artist) {
      const a = cleanArtist({ name: String(artist), at: this.now() });
      if (!a) return null;
      const k = artistKey(a.name);
      this.artists = [a, ...this.artists.filter((x) => artistKey(x.name) !== k)].slice(0, MAX_ARTISTS);
    } else return null;
    this.save();
    return this.list();
  }

  /** Shows a song (by key) or an artist (by name) again. */
  remove({ key, artist } = {}) {
    if (typeof key === 'string') this.songs = this.songs.filter((s) => s.key !== key);
    else if (typeof artist === 'string') { const k = artistKey(artist); this.artists = this.artists.filter((a) => artistKey(a.name) !== k); } else return null;
    this.save();
    return this.list();
  }

  /** Is this song (a key, a title, an artist or a channel) not to be suggested? */
  hides(s) {
    if (!s) return false;
    const key = s.key || (s.yt ? `yt:${s.yt}` : s.id && /^[A-Za-z0-9_-]{11}$/.test(String(s.id)) ? `yt:${s.id}` : null);
    if (key && this.songKeys.has(key)) return true;
    if (!this.artistKeys.size) return false;
    return artistOfSong({ title: s.title, artist: s.artist || s.channel }).some((a) => this.artistKeys.has(a));
  }

  /** Only the songs that may be suggested. */
  filter(songs) { return (songs || []).filter((s) => !this.hides(s)); }
}

module.exports = { Hidden, artistKey, artistOfSong, MAX_SONGS, MAX_ARTISTS };

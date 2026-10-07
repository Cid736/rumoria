// "Favoritas" (desktop app): the songs you mark with the star,
// newest first, kept only on this computer (likes.json). A song is its key,
// as in the listening history: yt:<video> or f:<path in your library>.
const fs = require('fs');
const { writeFileAtomic } = require('./atomic');
const { cleanSong } = require('./listenlog');

const MAX = 5000;

class Likes {
  constructor(file, { now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    this.songs = []; // [{ key, title, artist, yt?, thumb?, dur?, at }]
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const seen = new Set();
      for (const s of Array.isArray(raw.songs) ? raw.songs : []) {
        const c = cleanSong(s);
        if (!c || seen.has(s.key)) continue;
        seen.add(s.key);
        this.songs.push({ key: s.key, ...c, at: Number.isFinite(s.at) ? s.at : 0 });
        if (this.songs.length >= MAX) break;
      }
    } catch { /* none yet */ }
  }

  save() {
    writeFileAtomic(this.file, JSON.stringify({ songs: this.songs }));
  }

  has(key) { return this.songs.some((s) => s.key === key); }

  /** Liked: to the top (once). Returns how many there are, or null if it isn't a song. */
  add(song) {
    const c = cleanSong(song);
    if (!c) return null;
    this.songs = this.songs.filter((s) => s.key !== song.key);
    this.songs.unshift({ key: song.key, ...c, at: this.now() });
    if (this.songs.length > MAX) this.songs.length = MAX;
    this.save();
    return this.songs.length;
  }

  remove(key) {
    const before = this.songs.length;
    this.songs = this.songs.filter((s) => s.key !== key);
    if (this.songs.length !== before) this.save();
    return this.songs.length;
  }

  list() { return this.songs.map((s) => ({ ...s })); }
}

module.exports = { Likes, MAX_LIKES: MAX };

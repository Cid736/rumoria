// "Tu música": the songs in a folder of yours (by default the one TubeGrab
// downloads to), read-only. Each file is known by an id (a hash of its path
// inside the folder), never by a path the page sends, and is only ever served
// if it still resolves to a file inside that folder (no "..", no links out).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.opus', '.ogg', '.flac', '.wav', '.webm']);
const MAX_FILES = 10000;
const MAX_DEPTH = 4;
const ID_RE = /^[a-f0-9]{32}$/;
const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.opus': 'audio/ogg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.webm': 'audio/webm' };

const idOf = (rel) => crypto.createHash('sha256').update(rel).digest('hex').slice(0, 32);

/** "Artist - Title.mp3" → its two parts (else the name is the title). */
function nameParts(file) {
  const base = path.basename(file, path.extname(file)).replace(/^\d{1,3}\s*[-.]\s+/, '').trim();
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base };
}

/** Is `child` inside `root` (both absolute, already real paths)? */
function isInside(root, child) {
  const rel = path.relative(root, child);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

class LocalMusic {
  constructor(root) {
    this.setRoot(root);
  }

  setRoot(root) {
    this.root = typeof root === 'string' && path.isAbsolute(root) ? root : null;
    this.files = new Map(); // id -> { id, rel, title, artist, size, mtime }
    this.scannedAt = 0;
  }

  /** Walks the folder (not following links), up to a few levels and files. */
  scan() {
    this.files = new Map();
    this.scannedAt = Date.now();
    if (!this.root) return [];
    let real;
    try { real = fs.realpathSync(this.root); } catch { return []; }
    const walk = (dir, depth) => {
      if (depth > MAX_DEPTH || this.files.size >= MAX_FILES) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (this.files.size >= MAX_FILES) return;
        if (e.name.startsWith('.')) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs, depth + 1);
        else if (e.isFile() && AUDIO_EXT.has(path.extname(e.name).toLowerCase())) {
          let st;
          try { st = fs.statSync(abs); } catch { continue; }
          const rel = path.relative(real, abs).split(path.sep).join('/');
          const id = idOf(rel);
          this.files.set(id, { id, rel, ...nameParts(e.name), size: st.size, mtime: st.mtimeMs });
        }
      }
    };
    walk(real, 0);
    return this.list();
  }

  list() {
    return [...this.files.values()].sort((a, b) => b.mtime - a.mtime).map((f) => ({ ...f, key: `f:${f.rel}` }));
  }

  /** An id → the file's absolute path and type, if it's still inside the folder; else null. */
  resolve(id) {
    if (!ID_RE.test(String(id || '')) || !this.root) return null;
    const f = this.files.get(id);
    if (!f) return null;
    try {
      const root = fs.realpathSync(this.root);
      const abs = fs.realpathSync(path.join(root, ...f.rel.split('/')));
      if (!isInside(root, abs) || !fs.statSync(abs).isFile()) return null;
      return { file: abs, mime: MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' };
    } catch {
      return null;
    }
  }
}

module.exports = { LocalMusic, nameParts, isInside, idOf, AUDIO_EXT };

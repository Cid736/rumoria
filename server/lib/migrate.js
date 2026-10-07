// First run after the split from TubeGrab: your lists, favourites, listening
// history and news are copied (never moved) from TubeGrab's data folder, once.
// Each file is only taken if it's a reasonable size and valid JSON; the
// modules that read them clean every field again anyway.
const fs = require('fs');
const path = require('path');

const FILES = ['stream-lists.json', 'likes.json', 'listen-history.json', 'news.json'];
const MAX_BYTES = 20 * 1024 * 1024;
const MARK = '.migrated-from-tubegrab';

/** Copies what's missing here from `fromDir`. Returns the names copied. */
function migrateFromTubeGrab(fromDir, toDir) {
  if (!fromDir || !toDir || !path.isAbsolute(fromDir) || !path.isAbsolute(toDir)) return [];
  const mark = path.join(toDir, MARK);
  if (fs.existsSync(mark)) return [];
  const copied = [];
  for (const name of FILES) {
    const src = path.join(fromDir, name);
    const dest = path.join(toDir, name);
    let fd = null;
    try {
      const seen = fs.lstatSync(src, { bigint: true });
      if (seen.isSymbolicLink()) continue;
      fd = fs.openSync(src, 'r');
      const st = fs.fstatSync(fd, { bigint: true });
      // What was opened must be the very file looked at, not one swapped in between
      // (same file id; Windows reports no device number through lstat).
      if (!st.isFile() || st.ino !== seen.ino || st.size > BigInt(MAX_BYTES)) continue;
      const text = fs.readFileSync(fd, 'utf8');
      JSON.parse(text);
      fs.writeFileSync(dest, text, { flag: 'wx', mode: 0o600 }); // never over one already there
      copied.push(name);
    } catch { /* not there, already there, or not valid: skipped */ } finally { if (fd !== null) fs.closeSync(fd); }
  }
  try { fs.writeFileSync(mark, JSON.stringify({ at: Date.now(), copied })); } catch { /* tried again next time */ }
  return copied;
}

module.exports = { migrateFromTubeGrab, FILES };

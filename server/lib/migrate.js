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
    try {
      if (fs.existsSync(dest)) continue;
      const st = fs.lstatSync(src);
      if (!st.isFile() || st.size > MAX_BYTES) continue;
      JSON.parse(fs.readFileSync(src, 'utf8'));
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
      copied.push(name);
    } catch { /* not there, or not valid: skipped */ }
  }
  try { fs.writeFileSync(mark, JSON.stringify({ at: Date.now(), copied })); } catch { /* tried again next time */ }
  return copied;
}

module.exports = { migrateFromTubeGrab, FILES };

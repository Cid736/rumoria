// Saving a file whole or not at all: write a fresh temporary file next to it
// (random name, created exclusively, so nothing planted there can be
// followed or reused), then rename it over the real one.
const crypto = require('crypto');
const fs = require('fs');

function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* never made */ }
    throw err;
  }
}

module.exports = { writeFileAtomic };

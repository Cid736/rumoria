// What the server needs to know of your settings: the performance profile
// (how much it does in the background). prefs.json, only known values.
const fs = require('fs');
const { writeFileAtomic } = require('./atomic');

const PERF = ['min', 'mid', 'high'];
const DEFAULTS = { perf: 'mid' };

class Prefs {
  constructor(file) {
    this.file = file;
    this.data = { ...DEFAULTS };
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && PERF.includes(raw.perf)) this.data.perf = raw.perf;
    } catch { /* defaults */ }
  }

  get() { return { ...this.data }; }

  set(patch) {
    if (patch && PERF.includes(patch.perf)) this.data.perf = patch.perf;
    try { writeFileAtomic(this.file, JSON.stringify(this.data)); } catch { /* not fatal */ }
    return this.get();
  }
}

module.exports = { Prefs, PERF };

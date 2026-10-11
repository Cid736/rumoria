// What the server needs to know of your settings: the performance profile
// (how much it does in the background) and, v1.7, whether lyrics may be sent
// to be translated (off until you turn it on). prefs.json, only known values.
const fs = require('fs');
const { writeFileAtomic } = require('./atomic');

const PERF = ['min', 'mid', 'high'];
const DEFAULTS = { perf: 'mid', translate: false };

class Prefs {
  constructor(file) {
    this.file = file;
    this.data = { ...DEFAULTS };
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && PERF.includes(raw.perf)) this.data.perf = raw.perf;
      if (raw && raw.translate === true) this.data.translate = true;
    } catch { /* defaults */ }
  }

  get() { return { ...this.data }; }

  set(patch) {
    if (patch && PERF.includes(patch.perf)) this.data.perf = patch.perf;
    if (patch && typeof patch.translate === 'boolean') this.data.translate = patch.translate;
    try { writeFileAtomic(this.file, JSON.stringify(this.data)); } catch { /* not fatal */ }
    return this.get();
  }
}

module.exports = { Prefs, PERF };

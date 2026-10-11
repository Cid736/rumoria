// Loaded first on Android (`node -r shim.js server/main.js`). The Node that
// runs on phones (nodejs-mobile) is built without Intl: no Intl.Collator, and
// String.prototype.normalize gives the text back unchanged, so "canción"
// would never match "cancion". This puts back the two pieces the server uses:
//  - normalize('NFD'/'NFKD'): accented letters split into letter + accent
//    (the table, shim-data.json, comes from a full Node when the app is built);
//  - Intl.Collator(...).compare: case and accents ignored, numbers in order.
// (The regular expressions with \p{L} etc. are rewritten when the app is built.)
'use strict';
const path = require('path');

if ('é'.normalize('NFD').length === 1) {
  const table = require(path.join(__dirname, 'shim-data.json')).nfd;
  const map = new Map(Object.entries(table));
  const plain = String.prototype.normalize;
  // eslint-disable-next-line no-extend-native
  String.prototype.normalize = function normalize(form = 'NFC') {
    const s = String(this);
    if (form !== 'NFD' && form !== 'NFKD') return plain.call(s, form);
    let out = '';
    for (const ch of s) out += map.get(ch) || ch;
    return out;
  };
}

if (typeof Intl === 'undefined') {
  const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const chunks = (s) => s.match(/\d+|\D+/g) || [];
  class Collator {
    constructor(locales, options = {}) {
      this.numeric = Boolean(options.numeric);
      this.compare = this.compare.bind(this);
    }
    compare(a, b) {
      const x = fold(a);
      const y = fold(b);
      if (!this.numeric) return x < y ? -1 : x > y ? 1 : 0;
      const p = chunks(x);
      const q = chunks(y);
      for (let i = 0; i < Math.min(p.length, q.length); i++) {
        if (p[i] === q[i]) continue;
        const n = /^\d/.test(p[i]) && /^\d/.test(q[i]) ? Number(p[i]) - Number(q[i]) : 0;
        if (n) return n < 0 ? -1 : 1;
        return p[i] < q[i] ? -1 : 1;
      }
      return p.length - q.length;
    }
    resolvedOptions() { return { locale: 'und', numeric: this.numeric }; }
  }
  globalThis.Intl = { Collator };
}

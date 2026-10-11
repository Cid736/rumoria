// Sincronizar (v1.10): your lists, Favoritas and smart lists, the same on
// your PC, Mac and phone, through the cloud, with no account and nothing the
// cloud can read. The two devices never need to be on at the same time: the
// cloud keeps the latest copy, each device looks at it when it opens, every
// few minutes and after you change something, and merges.
//
// - The code: 6 words out of 2048 (Spanish BIP-39 list): ~7·10^19 codes.
//   It never leaves the device; nor does anything that would let someone try codes quickly.
// - From the code, slowly (PBKDF2-SHA256, 600 000 rounds), three things:
//   the row's id, the encryption key and a write key. The cloud only ever
//   sees the id, the encrypted library and a SHA-256 of the write key.
// - The library: JSON → gzip → AES-256-GCM (the id as associated data, a
//   fresh 12-byte nonce each time) → "v1:" + base64.
// - The cloud (Supabase): no table access at all; two functions only,
//   rumoria_get (a row by its id) and rumoria_put (only with the write key,
//   and only over the version it was based on: otherwise "conflict", and the
//   device merges again). See supabase/rumoria-sync.sql.
// - Merging: three-way, against what both had the last time they agreed
//   (only each item's hash is kept). A list, favourite or smart list changed
//   on one side wins; changed on both, the newer one; deleted on one side and
//   untouched on the other, it goes; "Para ti" (made per device) stays out.
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');
const { writeFileAtomic } = require('./atomic');
const WORDS = require('./sync-words.json');

const SALT = 'rumoria-sync-v1';
const ROUNDS = 600_000;
const CODE_WORDS = 6;
const MAX_TEXT = 10_000_000; // the encrypted library, as stored (the cloud refuses more)
const ID_RE = /^[0-9a-f]{64}$/;
const EVERY_MS = 5 * 60_000;
const QUIET_MS = 15_000;

// ---- the code ----
const plain = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const BY_PLAIN = new Map(WORDS.map((w) => [plain(w), w]));

/** A new code: 6 random words, joined by "-". */
function newCode(random = crypto.randomInt) {
  return Array.from({ length: CODE_WORDS }, () => WORDS[random(WORDS.length)]).join('-');
}

/** What someone typed → the code, written one way only ("Ábaco Abeja…" = "ábaco-abeja-…"); null if it isn't one. */
function normalizeCode(input) {
  const parts = plain(String(input || '').slice(0, 300)).split(/[^a-z]+/).filter(Boolean);
  if (parts.length !== CODE_WORDS) return null;
  const words = parts.map((p) => BY_PLAIN.get(p));
  return words.every(Boolean) ? words.join('-') : null;
}

// ---- the keys ----
const derived = new Map(); // code -> Promise<keys> (600 000 rounds once per code and run)
/** The code → { id, key (32 bytes), write (64 hex) }; slow on purpose. */
function deriveKeys(code) {
  if (!derived.has(code)) {
    derived.set(code, new Promise((resolve, reject) => {
      crypto.pbkdf2(plain(code), SALT, ROUNDS, 32, 'sha256', (err, master) => {
        if (err) { derived.delete(code); reject(err); return; }
        const part = (label) => crypto.createHmac('sha256', master).update(label).digest();
        resolve({ id: part('id').toString('hex'), key: part('encrypt'), write: part('write').toString('hex') });
      });
    }));
  }
  return derived.get(code);
}

// ---- the library, sealed ----
function seal(data, keys) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keys.key, iv);
  c.setAAD(Buffer.from(keys.id));
  const body = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(data)))), c.final()]);
  return `v1:${Buffer.concat([iv, body, c.getAuthTag()]).toString('base64')}`;
}

/** The sealed text → the library; throws if the code is wrong or anything was changed. */
function open(text, keys) {
  const m = /^v1:([A-Za-z0-9+/=]+)$/.exec(String(text || ''));
  if (!m) throw new Error('Formato de la nube desconocido (¿una versión más nueva de Rumoria?).');
  const raw = Buffer.from(m[1], 'base64');
  if (raw.length < 12 + 16 + 1) throw new Error('Datos de la nube incompletos.');
  const d = crypto.createDecipheriv('aes-256-gcm', keys.key, raw.subarray(0, 12));
  d.setAAD(Buffer.from(keys.id));
  d.setAuthTag(raw.subarray(raw.length - 16));
  let body;
  try { body = Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]); } catch { throw new Error('No se pudo descifrar: el código no es el de estos datos.'); }
  return JSON.parse(zlib.gunzipSync(body, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8'));
}

// ---- merging ----
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v));
const hashOf = (item) => crypto.createHash('sha256').update(stable(item)).digest('hex').slice(0, 32);
const COLLECTIONS = {
  lists: { key: (l) => l.id, when: (l) => l.updatedAt || 0 },
  likes: { key: (s) => s.key, when: (s) => s.at || 0 },
  rules: { key: (l) => l.id, when: (l) => l.at || 0 },
};

/** Each item's hash, by collection: what's kept as "the last time both agreed". */
function baseOf(snap) {
  const out = {};
  for (const [c, { key }] of Object.entries(COLLECTIONS)) out[c] = Object.fromEntries((snap[c] || []).map((x) => [key(x), hashOf(x)]));
  return out;
}

/** Three-way merge of one collection; `base`: { key: hash } (or {}). Local order first, new remote items in front. */
function mergeItems(base, local, remote, { key, when }) {
  const L = new Map(local.map((x) => [key(x), x]));
  const R = new Map(remote.map((x) => [key(x), x]));
  const pick = (k) => {
    const l = L.get(k);
    const r = R.get(k);
    const b = Object.hasOwn(base, k) ? base[k] : null;
    if (l && r) {
      const hl = hashOf(l);
      const hr = hashOf(r);
      if (hl === hr || hr === b) return l; // the same, or only changed here
      if (hl === b) return r; // only changed there
      return when(r) > when(l) ? r : l; // changed on both: the newer one
    }
    if (l) return b === null || hashOf(l) !== b ? l : null; // new here, or changed here after being deleted there
    if (r) return b === null || hashOf(r) !== b ? r : null; // new there, or changed there after being deleted here
    return null;
  };
  const fresh = remote.filter((x) => !L.has(key(x))).map((x) => pick(key(x))).filter(Boolean);
  const kept = local.map((x) => pick(key(x))).filter(Boolean);
  return [...fresh, ...kept];
}

/** The two libraries merged against what they had in common. */
function merge(base, local, remote) {
  const out = {};
  for (const [c, how] of Object.entries(COLLECTIONS)) out[c] = mergeItems((base && base[c]) || {}, local[c] || [], remote[c] || [], how);
  out.likes.sort((a, b) => (b.at || 0) - (a.at || 0));
  return out;
}

const sameLib = (a, b) => stable(baseOf(a)) === stable(baseOf(b));

// ---- the cloud ----
/** The two functions of supabase/rumoria-sync.sql, over HTTPS, with the publishable key. */
function createCloud({ url, key, fetchImpl = globalThis.fetch, timeoutMs = 30_000 }) {
  const base = String(url || '').replace(/\/+$/, '');
  const ready = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) && /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(String(key || ''));
  async function rpc(name, body) {
    if (!ready) throw new Error('La sincronización no está configurada en esta versión.');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${base}/rest/v1/rpc/${name}`, {
        method: 'POST', signal: ctl.signal, redirect: 'error',
        headers: { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Sin conexión con la nube.');
    } finally { clearTimeout(t); }
    const text = await res.text();
    if (!res.ok) {
      if (/forbidden/.test(text)) throw new Error('La nube no aceptó el cambio (la clave de escritura no coincide).');
      throw new Error(`La nube respondió ${res.status}.`);
    }
    try { return JSON.parse(text); } catch { throw new Error('La nube respondió algo raro.'); }
  }
  const one = (rows) => (Array.isArray(rows) ? rows[0] : rows) || null;
  return {
    ready,
    /** → { data, rev } or null (nothing saved with that id). */
    async get(id) {
      const r = one(await rpc('rumoria_get', { p_id: id }));
      return r && typeof r.encrypted_data === 'string' ? { data: r.encrypted_data, rev: Number(r.rev) || 0 } : null;
    },
    /** → { ok, rev }: ok false when someone saved in between (rev is theirs). */
    async put(id, data, write, baseRev) {
      const r = one(await rpc('rumoria_put', { p_id: id, p_data: data, p_write_key: write, p_base_rev: baseRev }));
      if (!r) throw new Error('La nube no respondió bien.');
      return { ok: r.ok === true, rev: Number(r.rev) || 0 };
    },
    /** Everything saved with that id, gone (with the write key). */
    async remove(id, write) { await rpc('rumoria_delete', { p_id: id, p_write_key: write }); },
  };
}

// ---- the whole thing, for one device ----
/**
 * `stores`: { read() → { lists, likes, rules }, write({ lists, likes, rules }), files: [paths it changes] }.
 * `file`: where this device keeps its code and what both had last time (sync.json).
 */
class CloudSync {
  constructor({ file, stores, cloud, now = () => Date.now(), background = true }) {
    this.file = file;
    this.stores = stores;
    this.cloud = cloud;
    this.now = now;
    this.background = background;
    this.state = { code: null, rev: 0, base: null, lastAt: null, appliedAt: null, mtimes: null };
    this.running = null;
    this.error = null;
    this.timers = [];
    try {
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      const code = normalizeCode(s.code);
      if (code) this.state = { ...this.state, code, rev: Number(s.rev) || 0, base: s.base && typeof s.base === 'object' ? s.base : null, lastAt: Number(s.lastAt) || null };
    } catch { /* not set up */ }
  }

  save() {
    const { code, rev, base, lastAt } = this.state;
    if (!code) { try { fs.rmSync(this.file, { force: true }); } catch { /* fine */ } return; }
    writeFileAtomic(this.file, JSON.stringify({ code, rev, base, lastAt }));
  }

  /** What Ajustes shows. */
  status() {
    return { available: this.cloud.ready, enabled: Boolean(this.state.code), code: this.state.code, lastAt: this.state.lastAt, appliedAt: this.state.appliedAt, syncing: Boolean(this.running), error: this.error };
  }

  /** A new code for this device; its library goes up. */
  async create() {
    this.state = { ...this.state, code: newCode(), rev: 0, base: null, lastAt: null };
    this.save();
    await this.syncNow();
    return this.status();
  }

  /** The code from another device: only if there's something saved with it; both libraries are joined. */
  async join(input) {
    const code = normalizeCode(input);
    if (!code) throw new Error('Ese código no es válido: son 6 palabras, como en el otro dispositivo.');
    const keys = await deriveKeys(code);
    const row = await this.cloud.get(keys.id);
    if (!row) throw new Error('No hay nada guardado con ese código. Revisa las palabras.');
    open(row.data, keys); // a wrong code can't get this far, but a broken copy is told now
    this.state = { ...this.state, code, rev: 0, base: null, lastAt: null };
    this.save();
    await this.syncNow();
    return this.status();
  }

  /** This device stops syncing; with `wipe`, the copy in the cloud goes too (for every device). */
  async leave({ wipe = false } = {}) {
    const code = this.state.code;
    if (wipe && code) {
      const keys = await deriveKeys(code);
      await this.cloud.remove(keys.id, keys.write);
    }
    this.state = { code: null, rev: 0, base: null, lastAt: null, appliedAt: null, mtimes: null };
    this.error = null;
    this.save();
    return this.status();
  }

  /** Pull, merge, apply here, push; again if another device saved in between. One at a time. */
  syncNow() {
    if (!this.state.code) return Promise.resolve(this.status());
    if (!this.running) {
      this.running = this.cycle().then(() => { this.error = null; }, (err) => { this.error = err.message || 'No se pudo sincronizar.'; })
        .finally(() => { this.running = null; });
    }
    return this.running.then(() => this.status());
  }

  async cycle() {
    const code = this.state.code;
    const keys = await deriveKeys(code);
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await this.cloud.get(keys.id);
      if (this.state.code !== code) return; // left meanwhile
      const remote = row ? open(row.data, keys) : null;
      // What's here right now (taken after the network, so nothing changed meanwhile is lost).
      const local = this.stores.read();
      const merged = remote ? merge(this.state.base, local, remote) : local;
      if (!sameLib(merged, local)) { this.stores.write(merged); this.state.appliedAt = this.now(); }
      if (row && sameLib(merged, remote)) { this.done(row.rev, merged); return; }
      const sealed = seal({ v: 1, ...merged }, keys);
      if (sealed.length > MAX_TEXT) throw new Error('Tu biblioteca es demasiado grande para sincronizarla.');
      const r = await this.cloud.put(keys.id, sealed, keys.write, row ? row.rev : 0);
      if (r.ok) { this.done(r.rev, merged); return; }
    }
    throw new Error('Otro dispositivo está guardando a la vez; se volverá a intentar.');
  }

  done(rev, lib) {
    this.state = { ...this.state, rev, base: baseOf(lib), lastAt: this.now(), mtimes: this.mtimes() };
    this.save();
  }

  mtimes() {
    return this.stores.files.map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }).join(',');
  }

  /** On opening, every 5 minutes, and a few seconds after something changes here. */
  start() {
    if (!this.background) return;
    const at = (ms, fn) => { const t = setTimeout(fn, ms); t.unref?.(); this.timers.push(t); };
    at(5000, () => this.syncNow());
    const every = setInterval(() => this.syncNow(), EVERY_MS);
    every.unref?.();
    let changedAt = null;
    const watch = setInterval(() => {
      if (!this.state.code || this.running || !this.state.mtimes) return;
      if (this.mtimes() === this.state.mtimes) { changedAt = null; return; }
      if (!changedAt) { changedAt = this.now(); return; }
      if (this.now() - changedAt >= QUIET_MS) { changedAt = null; this.syncNow(); }
    }, 5000);
    watch.unref?.();
    this.timers.push(every, watch);
  }

  stop() { for (const t of this.timers) { clearTimeout(t); clearInterval(t); } this.timers = []; }
}

module.exports = { CloudSync, createCloud, newCode, normalizeCode, deriveKeys, seal, open, merge, mergeItems, baseOf, hashOf, WORDS, ROUNDS, ID_RE };

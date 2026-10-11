// v1.7, smart lists: lists made of rules over your own library instead of
// songs — "favourites I haven't heard in 3 months", "played more than 20
// times", "added this month". Only the rules are kept (rule-lists.json); the
// songs are worked out each time the list is opened, from your favourites and
// your listening history, so they are always up to date. Nothing is looked
// up anywhere: it's your library seen another way.
const crypto = require('crypto');
const fs = require('fs');
const { writeFileAtomic } = require('./atomic');

const MAX_LISTS = 50;
const ID_RE = /^[a-f0-9]{16}$/;
const FROM = ['likes', 'heard', 'all'];
const SORTS = ['plays', 'recent', 'added', 'oldest', 'title', 'random'];
const LIMITS = [25, 50, 100, 200, 500];
const DAY_MS = 24 * 3600 * 1000;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** A whole number within [min, max], or null (the rule is off). */
const intIn = (v, min, max) => (v === null || v === undefined || v === '' ? null : Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : null);

/** Only known rules and values (what's read back from disk or sent by the page can't set anything else). */
function cleanRules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    from: FROM.includes(r.from) ? r.from : 'likes',
    minPlays: intIn(r.minPlays, 0, 10000),
    maxPlays: intIn(r.maxPlays, 0, 10000),
    notHeardDays: intIn(r.notHeardDays, 1, 3650),
    heardDays: intIn(r.heardDays, 1, 3650),
    addedDays: intIn(r.addedDays, 1, 3650),
    artist: clean(r.artist, 100),
    sort: SORTS.includes(r.sort) ? r.sort : 'plays',
    limit: LIMITS.includes(Number(r.limit)) ? Number(r.limit) : 100,
  };
}

/**
 * The songs that follow `rules` right now. `likes`: your favourites
 * ([{ key, title, artist, yt?, thumb?, dur?, at }]); `heard`: the history's
 * songs (Map key -> { title, artist, yt?, thumb?, dur?, plays, last (s) }).
 * Every rule must hold; a song never heard has 0 plays and was never heard.
 */
function evaluate(rawRules, { likes = [], heard = new Map(), now = Date.now(), random = Math.random } = {}) {
  const rules = cleanRules(rawRules);
  const pool = new Map();
  const liked = new Map(likes.map((s) => [s.key, s]));
  if (rules.from !== 'heard') for (const s of likes) pool.set(s.key, s);
  if (rules.from !== 'likes') for (const [k, s] of heard) if (!pool.has(k)) pool.set(k, s);
  const who = fold(rules.artist);
  const out = [];
  for (const [key, s] of pool) {
    const h = heard.get(key);
    const plays = h ? h.plays : 0;
    const last = h && h.last ? h.last * 1000 : 0;
    const like = liked.get(key);
    const at = like && Number.isFinite(like.at) && like.at > 0 ? like.at : 0;
    if (rules.minPlays !== null && plays < rules.minPlays) continue;
    if (rules.maxPlays !== null && plays > rules.maxPlays) continue;
    if (rules.notHeardDays !== null && last && last > now - rules.notHeardDays * DAY_MS) continue;
    if (rules.heardDays !== null && (!last || last < now - rules.heardDays * DAY_MS)) continue;
    if (rules.addedDays !== null && (!at || at < now - rules.addedDays * DAY_MS)) continue;
    if (who && !fold(`${s.artist || ''} ${s.title || ''}`).includes(who)) continue;
    out.push({ key, title: s.title, artist: s.artist || '', yt: s.yt || (key.startsWith('yt:') ? key.slice(3) : undefined), thumb: s.thumb, dur: s.dur, plays, last: last || null, at: at || null, liked: Boolean(like) });
  }
  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const by = {
    plays: (a, b) => b.plays - a.plays || (b.last || 0) - (a.last || 0),
    recent: (a, b) => (b.last || 0) - (a.last || 0),
    added: (a, b) => (b.at || 0) - (a.at || 0),
    oldest: (a, b) => (a.last || 0) - (b.last || 0),
    title: (a, b) => collator.compare(a.title, b.title),
  }[rules.sort];
  if (by) out.sort(by);
  else for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out.slice(0, rules.limit);
}

class RuleLists {
  constructor(file) {
    this.file = file;
    this.lists = []; // [{ id, name, rules, at }]
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const l of Array.isArray(raw.lists) ? raw.lists : []) {
        const name = clean(l && l.name, 100);
        if (!l || !ID_RE.test(String(l.id)) || !name || this.lists.some((x) => x.id === l.id)) continue;
        this.lists.push({ id: l.id, name, rules: cleanRules(l.rules), at: Number.isFinite(l.at) ? l.at : 0 });
        if (this.lists.length >= MAX_LISTS) break;
      }
    } catch { /* none yet */ }
  }

  save() { writeFileAtomic(this.file, JSON.stringify({ v: 1, lists: this.lists })); }
  list() { return this.lists.map((l) => ({ ...l, rules: { ...l.rules } })); }
  get(id) { const l = this.lists.find((x) => x.id === id); return l ? { ...l, rules: { ...l.rules } } : null; }

  create({ name, rules }) {
    const n = clean(name, 100);
    if (!n) throw new Error('Ponle un nombre a la lista.');
    if (this.lists.length >= MAX_LISTS) throw new Error(`Ya tienes ${MAX_LISTS} listas inteligentes: borra alguna antes.`);
    const l = { id: crypto.randomBytes(8).toString('hex'), name: n, rules: cleanRules(rules), at: Date.now() };
    this.lists.unshift(l);
    this.save();
    return this.get(l.id);
  }

  update(id, { name, rules } = {}) {
    const l = this.lists.find((x) => x.id === id);
    if (!l) return null;
    if (typeof name === 'string' && clean(name, 100)) l.name = clean(name, 100);
    if (rules && typeof rules === 'object') l.rules = cleanRules(rules);
    this.save();
    return this.get(id);
  }

  remove(id) {
    const before = this.lists.length;
    this.lists = this.lists.filter((x) => x.id !== id);
    if (this.lists.length !== before) this.save();
    return this.lists.length !== before;
  }
}

module.exports = { RuleLists, cleanRules, evaluate, ID_RE, SORTS, LIMITS, FROM };

// "Para ti": lists Rumoria makes and keeps for you, in a folder of their own.
// Everyone starts with a few ready-made ones; as you listen, the genres you
// play most (worked out by matching your artists against the artists in each
// "Explorar" category) get lists of their own, and one genre you don't play
// yet but that sits closest to yours is suggested to discover. Every so often
// the set is worked out again: lists that no longer fit go, new ones come.
// Lists you rename or move become yours and are never touched again; a genre
// whose list you delete doesn't come back for a while. Nothing is downloaded:
// they are lists that fill themselves (titles and YouTube ids).
const fs = require('fs');
const { writeFileAtomic } = require('./atomic');

const FOLDER = 'Para ti';
const MAX_LISTS = 6;
const MAX_GENRES = 4;
const EVERY_DAYS = [3, 7, 14];
const DISMISS_MS = 60 * 24 * 3600 * 1000;
const SIMILAR_MS = 30 * 24 * 3600 * 1000; // an artist's neighbours, asked again after a month
const SIMILAR_ASK = 3; // at most this many artists looked up per run
const SIMILAR_KEEP = 30;
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// Channel words that aren't the artist ("SPYAIR Official YouTube Channel", "… - Topic", "…VEVO").
const NOT_ARTIST = /(?<![\p{L}\p{N}])(official|oficial|youtube|channel|canal|vevo)(?![\p{L}\p{N}])/gu;
/** An artist's name, comparable: folded, without channel words or symbols. */
function cleanArtist(s) {
  // fold() leaves single spaces, so " ?" is enough (and can't backtrack).
  return fold(s).replace(/ ?- ?topic$/, '').replace(/vevo$/, '').replace(NOT_ARTIST, ' ').replace(/[^\p{L}\p{N}&' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** Same artist: equal, or one name inside the other as whole words ("kenshi yonezu" in "米津玄師 kenshi yonezu"). */
function sameArtist(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return ` ${b} `.includes(` ${a} `) || ` ${a} `.includes(` ${b} `);
}
function hasArtist(set, a) {
  if (set.has(a)) return true;
  for (const b of set) if (sameArtist(a, b)) return true;
  return false;
}

/** Artist of a song from Explorar (its "Artist - Title" or its channel). */
function artistOf(t, splitTitle) {
  return cleanArtist(splitTitle(t.title || '', t.channel || '').artist);
}

/** Category id → the artists in its songs (cleaned). */
function artistsByCategory(cache, categories, splitTitle) {
  const out = new Map();
  for (const c of categories) {
    const hit = cache[c.id];
    if (!hit || !hit.tracks || !hit.tracks.length) continue;
    out.set(c.id, new Set(hit.tracks.map((t) => artistOf(t, splitTitle)).filter((a) => a.length > 1)));
  }
  return out;
}

/**
 * Your genres: for each category, how much of what you play is by its
 * artists (weighted by plays). [{ id, score }], best first, score > 0 only.
 */
function scoreGenres(yourArtists, byCat) {
  const mine = (yourArtists || []).map((a) => ({ name: cleanArtist(a.name), w: Math.max(0.1, Number(a.plays) || 1) })).filter((a) => a.name.length > 1);
  const out = [];
  for (const [id, artists] of byCat) {
    let score = 0;
    for (const a of mine) if (hasArtist(artists, a.name)) score += a.w;
    if (score > 0) out.push({ id, score: Math.round(score * 10) / 10 });
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Your artists no category knows (their genre is guessed from similar ones). */
function unplaced(yourArtists, byCat) {
  const all = [...byCat.values()];
  return (yourArtists || []).filter((a) => { const n = cleanArtist(a.name); return n.length > 1 && !all.some((s) => hasArtist(s, n)); });
}

/**
 * The genre to discover: of the ones you don't play, those sharing at least
 * two artists with your genres (one could be chance), the most first, taking
 * turns week by week among the best three — a guess at what you'd like next.
 */
function predictNext(genres, byCat, { exclude = new Set(), week = 0 } = {}) {
  const yours = new Set(genres.map((g) => g.id));
  const near = new Set();
  for (const g of genres) for (const a of byCat.get(g.id) || []) near.add(a);
  const ranked = [];
  for (const [id, artists] of byCat) {
    if (yours.has(id) || exclude.has(id)) continue;
    let shared = 0;
    for (const a of artists) if (hasArtist(near, a)) shared++;
    if (shared >= 2) ranked.push({ id, shared });
  }
  ranked.sort((a, b) => b.shared - a.shared || a.id.localeCompare(b.id));
  const pool = ranked.slice(0, 3);
  return pool.length ? pool[week % pool.length].id : null;
}

/**
 * What "Para ti" should hold now: your genres first, one to discover, then
 * ready-made favourites to fill up. [{ id, kind: 'genre' | 'discover' | 'starter' }]
 */
function plan({ genres, byCat, categories, dismissed = new Set(), week = 0, max = MAX_LISTS }) {
  const out = [];
  const taken = new Set(dismissed);
  for (const g of genres.slice(0, MAX_GENRES)) {
    if (taken.has(g.id)) continue;
    out.push({ id: g.id, kind: 'genre' });
    taken.add(g.id);
  }
  if (out.length) {
    const next = predictNext(genres, byCat, { exclude: taken, week });
    if (next) { out.push({ id: next, kind: 'discover' }); taken.add(next); }
  }
  for (const c of categories.filter((x) => x.featured)) {
    if (out.length >= max) break;
    if (!taken.has(c.id)) { out.push({ id: c.id, kind: 'starter' }); taken.add(c.id); }
  }
  return out.slice(0, max);
}

const nameFor = (cat, kind) => (kind === 'genre' ? `${cat.name} para ti` : kind === 'discover' ? `Descubre: ${cat.name}` : cat.name);

class Curator {
  constructor(file, { now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    // similar: artist → artists YouTube plays next to them ({ at, names }), for artists no category knows.
    this.state = { enabled: true, every: 7, at: 0, dismissed: {}, genres: [], similar: {} };
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && typeof raw === 'object') {
        this.state.enabled = raw.enabled !== false;
        this.state.every = EVERY_DAYS.includes(raw.every) ? raw.every : 7;
        this.state.at = Number.isFinite(raw.at) ? raw.at : 0;
        for (const [k, v] of Object.entries(raw.dismissed || {})) if (/^[a-z0-9-]{1,40}$/.test(k) && Number.isFinite(v)) this.state.dismissed[k] = v;
        this.state.genres = (Array.isArray(raw.genres) ? raw.genres : []).filter((g) => g && /^[a-z0-9-]{1,40}$/.test(g.id) && Number.isFinite(g.score)).slice(0, 10);
        for (const [k, v] of Object.entries(raw.similar || {}).slice(0, SIMILAR_KEEP)) {
          if (k.length <= 100 && v && Number.isFinite(v.at) && Array.isArray(v.names)) this.state.similar[k] = { at: v.at, names: v.names.map((n) => String(n).slice(0, 100)).slice(0, 30) };
        }
      }
    } catch { /* first time */ }
  }

  save() { try { writeFileAtomic(this.file, JSON.stringify(this.state)); } catch { /* not fatal */ } }

  set({ enabled, every }) {
    if (typeof enabled === 'boolean') this.state.enabled = enabled;
    if (EVERY_DAYS.includes(every)) this.state.every = every;
    this.save();
  }

  /** A list of ours you deleted: that genre stays away for a while. */
  dismiss(catId) {
    if (!/^[a-z0-9-]{1,40}$/.test(String(catId))) return;
    this.state.dismissed[catId] = this.now() + DISMISS_MS;
    this.save();
  }

  dismissedNow() {
    const now = this.now();
    return new Set(Object.entries(this.state.dismissed).filter(([, until]) => until > now).map(([id]) => id));
  }

  /** Time to work the set out again (or never done yet). */
  due() { return this.state.enabled && this.now() - this.state.at >= this.state.every * 24 * 3600 * 1000; }

  /**
   * Works out "Para ti" and brings the lists in line: makes what's missing
   * (one at a time, `fill(q)` → songs), removes ours that no longer fit.
   * `lists`: the StreamLists; `smart`: the listening summary; `browse`: the
   * Explorar catalogue and cache. Returns { made, removed }.
   */
  /**
   * Your genres from what you play (and, for artists no category knows, the
   * artists YouTube plays next to them, already looked up by `run`).
   */
  genresOf(smart, byCat, lost = unplaced((smart && smart.artists) || [], byCat)) {
    const yourArtists = [...((smart && smart.artists) || []), ...((smart && smart.top) || []).map((s) => ({ name: s.artist, plays: 1 }))];
    const borrowed = lost.flatMap((a) => {
      const me = cleanArtist(a.name);
      const others = ((this.state.similar[me] || {}).names || []).filter((n) => !sameArtist(cleanArtist(n), me));
      return others.map((name) => ({ name, plays: (Number(a.plays) || 1) / others.length }));
    });
    return scoreGenres([...yourArtists, ...borrowed], byCat);
  }

  /**
   * Your genres right now, for Inicio's rotating shelves: worked out on this
   * computer, without asking anyone (whether "Para ti" is on or not), kept a
   * minute. [{ id, score }], best first.
   */
  taste({ smart, browse, categories, splitTitle }) {
    if (this._taste && this.now() - this._taste.at < 60_000) return this._taste.genres;
    const genres = smart ? this.genresOf(smart, artistsByCategory(browse.cache, categories, splitTitle)).slice(0, 10) : [];
    this._taste = { at: this.now(), genres };
    return genres;
  }

  async run({ lists, smart, browse, categories, splitTitle, fill, similar = null, force = false }) {
    if (!this.state.enabled) return { made: [], removed: [] };
    const byCat = artistsByCategory(browse.cache, categories, splitTitle);
    // Artists no category knows: their genre from the artists YouTube plays
    // next to them (the mix of one of their songs), each sharing their plays.
    const lost = unplaced((smart && smart.artists) || [], byCat).filter((a) => a.seed && a.seed.yt);
    let asked = 0;
    for (const a of lost) {
      const k = cleanArtist(a.name);
      const hit = this.state.similar[k];
      if ((hit && this.now() - hit.at < SIMILAR_MS) || !similar || asked >= SIMILAR_ASK || !byCat.size) continue;
      asked++;
      try {
        // Each other artist once; the artist themselves left out.
        const names = [...new Set(((await similar(a.seed.yt, a.name)) || []).map((n) => String(n).slice(0, 100)))].filter((n) => !sameArtist(cleanArtist(n), k));
        this.state.similar[k] = { at: this.now(), names: names.slice(0, 30) };
      } catch {
        this.state.similar[k] = { at: this.now() - SIMILAR_MS + 24 * 3600 * 1000, names: [] }; // tried again tomorrow
      }
    }
    this.state.similar = Object.fromEntries(Object.entries(this.state.similar).sort((x, y) => y[1].at - x[1].at).slice(0, SIMILAR_KEEP));
    const genres = this.genresOf(smart, byCat, lost);
    // Early: last time your genres couldn't be told yet, and now they can.
    const early = !this.state.genres.length && genres.length > 0;
    if (!force && !this.due() && !early) return { made: [], removed: [] };
    const week = Math.floor(this.now() / (7 * 24 * 3600 * 1000));
    const want = plan({ genres, byCat, categories, dismissed: this.dismissedNow(), week });
    const ours = lists.lists.filter((l) => l.auto && l.auto.by === 'rumoria');
    const wanted = new Map(want.map((w) => [w.id, w]));
    const removed = [];
    for (const l of ours) {
      const w = wanted.get(l.auto.cat);
      if (!w || w.kind !== l.auto.kind) { lists.remove(l.id); removed.push(l.auto.cat); }
    }
    const have = new Set(lists.lists.filter((l) => l.auto && l.auto.by === 'rumoria').map((l) => l.auto.cat));
    const yourArtists = [...((smart && smart.artists) || []), ...((smart && smart.top) || []).map((s) => ({ name: s.artist, plays: 1 }))];
    const mine = new Set(yourArtists.map((a) => cleanArtist(a.name)).filter((n) => n.length > 1));
    const isMine = (s) => hasArtist(mine, cleanArtist(s.artist));
    const made = [];
    // Made last-first: each new list goes on top, so they read in order (your genres first).
    for (const w of [...want].reverse()) {
      if (have.has(w.id)) continue;
      const cat = categories.find((c) => c.id === w.id);
      if (!cat) continue;
      let songs = await fill(cat.q());
      if (!songs || !songs.length) continue;
      // In a genre of yours, your artists first.
      if (w.kind === 'genre') songs = [...songs.filter(isMine), ...songs.filter((s) => !isMine(s))];
      try {
        lists.create({ name: nameFor(cat, w.kind), tracks: songs, folder: FOLDER, auto: { q: cat.q(), every: 24, by: 'rumoria', cat: cat.id, kind: w.kind } });
        made.push(cat.id);
      } catch { break; } // no room for more lists
    }
    this.state.genres = genres.slice(0, 10);
    // Done only once everything wanted is there (else tried again soon).
    const complete = want.every((w) => made.includes(w.id) || have.has(w.id));
    if (complete) this.state.at = this.now();
    this.save();
    return { made, removed, complete };
  }

  view(categories) {
    const name = (id) => (categories.find((c) => c.id === id) || {}).name || id;
    return {
      enabled: this.state.enabled, every: this.state.every, at: this.state.at || null,
      next: this.state.at ? this.state.at + this.state.every * 24 * 3600 * 1000 : null,
      genres: this.state.genres.slice(0, 5).map((g) => ({ id: g.id, name: name(g.id) })),
    };
  }
}

module.exports = { Curator, scoreGenres, predictNext, plan, artistsByCategory, cleanArtist, sameArtist, unplaced, FOLDER, EVERY_DAYS };

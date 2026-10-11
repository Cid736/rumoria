// v1.7, a plan B for when YouTube changes something: yt-dlp (what finds each
// song's audio) is kept up to date on its own, apart from Rumoria's updates —
// looked at every 6 hours (it was once a day), and at once when songs start
// failing one after another (3 different ones in 10 minutes), which is what
// a change on YouTube's side looks like. The page shows what's going on, and
// Ajustes says which version there is and can look for a new one now.
// `yt-dlp -U` replaces itself only with an official release whose SHA-256
// matches the published sums (yt-dlp checks it).

const CHECK_EVERY_MS = 6 * 3600_000;
const TROUBLE_FAILS = 3;
const TROUBLE_WINDOW_MS = 10 * 60_000;
const AUTO_GAP_MS = 30 * 60_000;     // a failure-triggered update at most this often
const TROUBLE_CLEARS_MS = 20 * 60_000;
const VERSION_RE = /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;

/** What `yt-dlp -U` said: 'updated' (to `version`), 'current', or 'failed'. */
function readUpdate(out) {
  const s = String(out || '');
  const to = /Updated yt-dlp to (?:\w+@)?(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)/i.exec(s);
  if (to) return { result: 'updated', version: to[1] };
  if (/is up to date/i.test(s)) return { result: 'current', version: (/\((?:\w+@)?(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)/.exec(s) || [])[1] || null };
  return { result: 'failed', version: null };
}

/**
 * `bin()`: yt-dlp's path; `run(file, args, cb)`: execFile-like; `read()` /
 * `save(patch)`: the settings (`ytDlpCheckedAt`); `send(state)`: to the page.
 */
function createYtDlpKeeper({ bin, run, read, save, send = () => {}, now = () => Date.now() }) {
  const state = { version: null, updating: false, last: null, lastAt: null, trouble: false, troubleAt: null };
  const fails = new Map(); // song -> time of its failure
  let lastAuto = -Infinity;
  let timers = [];
  const pub = () => ({ ...state, checkedAt: read().ytDlpCheckedAt || null });
  const tell = () => { try { send(pub()); } catch { /* the window is gone */ } };

  function readVersion() {
    return new Promise((resolve) => {
      run(bin(), ['--version'], { windowsHide: true, timeout: 30_000 }, (err, out) => {
        const v = String(out || '').trim();
        if (!err && VERSION_RE.test(v)) state.version = v;
        resolve(state.version);
      });
    });
  }

  /** Looks for a new yt-dlp now (one at a time). `why`: 'schedule', 'trouble' or 'manual'. */
  function update(why = 'manual') {
    if (state.updating) return Promise.resolve(pub());
    state.updating = true;
    tell();
    return new Promise((resolve) => {
      run(bin(), ['-U'], { windowsHide: true, timeout: 180_000 }, (err, out, errOut) => {
        const r = err && !out ? { result: 'failed', version: null } : readUpdate(`${out || ''}\n${errOut || ''}`);
        state.updating = false;
        state.last = r.result;
        state.lastAt = now();
        try { save({ ytDlpCheckedAt: now() }); } catch { /* next time */ }
        readVersion().then(() => {
          if (r.version && !state.version) state.version = r.version;
          // A schedule that found nothing new says nothing to the page.
          if (why !== 'schedule' || r.result === 'updated') tell();
          resolve(pub());
        });
      });
    });
  }

  /**
   * The page says how a song went: `fail` (it gave up on a YouTube song after
   * its retries) or `ok` (a YouTube song started). Several different songs
   * failing in a row looks like YouTube changed: yt-dlp is updated at once.
   */
  function report(kind, song) {
    const t = now();
    if (kind === 'ok') {
      fails.clear();
      if (state.trouble) { state.trouble = false; state.troubleAt = null; tell(); }
      return;
    }
    if (kind !== 'fail' || typeof song !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(song)) return;
    fails.set(song, t);
    for (const [k, at] of fails) if (t - at > TROUBLE_WINDOW_MS) fails.delete(k);
    if (fails.size < TROUBLE_FAILS) return;
    if (!state.trouble) { state.trouble = true; state.troubleAt = t; }
    if (t - lastAuto >= AUTO_GAP_MS) { lastAuto = t; fails.clear(); update('trouble'); } else tell();
  }

  /** Every 6 hours (and soon after starting, if it's been that long); the trouble notice goes away by itself in a while. */
  function start() {
    readVersion().then(tell);
    const due = () => now() - (read().ytDlpCheckedAt || 0) >= CHECK_EVERY_MS;
    timers.push(setTimeout(() => { if (due()) update('schedule'); }, 60_000));
    timers.push(setInterval(() => {
      if (due()) update('schedule');
      if (state.trouble && now() - state.troubleAt > TROUBLE_CLEARS_MS) { state.trouble = false; tell(); }
    }, 10 * 60_000));
    timers.forEach((x) => x.unref && x.unref());
  }

  return { start, stop: () => { timers.forEach((x) => { clearTimeout(x); clearInterval(x); }); timers = []; }, update, report, state: pub, readVersion };
}

module.exports = { createYtDlpKeeper, readUpdate, TROUBLE_FAILS };

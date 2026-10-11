// v1.7, Discord Rich Presence: "Escuchando <canción> · <artista>" on your
// Discord profile while Rumoria plays, if you turn it on (Ajustes). It talks
// only to the Discord app on this computer, through its local pipe (no
// network, no library): a handshake with Rumoria's application id, then
// SET_ACTIVITY whenever the song or its state changes (at most every few
// seconds; Discord limits it). Nothing is sent when it's off, Discord isn't
// open, or nothing plays; the activity is cleared on pause and on quit.
const net = require('net');
const path = require('path');
const crypto = require('crypto');

// Rumoria's application on discord.com/developers ("Rumoria", type: Listening).
// Empty: Rich Presence isn't offered (an id can also come from RUMORIA_DISCORD_ID).
const CLIENT_ID = '1558642511898218596';
const ID_RE = /^\d{17,20}$/;
const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const MIN_GAP_MS = 4000;
const RETRY_MS = 30_000;
const YT_RE = /^[A-Za-z0-9_-]{11}$/;
const COVER_RE = /^https:\/\/i\d?\.ytimg\.com\/[\w\-/.]{1,200}(\?[\w\-=&%.]{0,300})?$/;

const clientId = () => (ID_RE.test(String(process.env.RUMORIA_DISCORD_ID || '')) ? process.env.RUMORIA_DISCORD_ID : ID_RE.test(CLIENT_ID) ? CLIENT_ID : null);

/** Where the Discord app listens: `\\?\pipe\discord-ipc-N` on Windows, a socket elsewhere. */
function pipePath(n, platform = process.platform, env = process.env) {
  if (platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${n}`;
  const dir = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || '/tmp';
  return path.join(dir.replace(/\/$/, ''), `discord-ipc-${n}`);
}

/** One message as the pipe takes it: opcode and length (little endian), then the JSON. */
function encode(op, data) {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Whole messages out of what arrived so far → { messages: [{ op, data }], rest }. */
function decode(buf) {
  const messages = [];
  let at = 0;
  while (buf.length - at >= 8) {
    const op = buf.readInt32LE(at);
    const len = buf.readInt32LE(at + 4);
    if (len < 0 || len > 1024 * 1024) return { messages, rest: Buffer.alloc(0), broken: true };
    if (buf.length - at - 8 < len) break;
    let data = null;
    try { data = JSON.parse(buf.slice(at + 8, at + 8 + len).toString('utf8')); } catch { /* not JSON: skipped */ }
    messages.push({ op, data });
    at += 8 + len;
  }
  return { messages, rest: buf.slice(at) };
}

const text = (v, max) => {
  const s = String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return s.length >= 2 ? s : s ? `${s} ` : '';
};

/**
 * What's playing (the mini player's state, already checked) → Discord's
 * activity, or null (nothing to show: paused, or no song).
 */
function activityOf(s, now = Date.now()) {
  if (!s || !s.playing || !s.title) return null;
  const a = {
    type: 2, // "Escuchando"
    details: text(s.title, 128),
    state: text(s.artist, 128) || undefined,
    assets: { large_image: COVER_RE.test(String(s.cover || '')) ? s.cover : 'rumoria', large_text: 'Rumoria' },
  };
  if (Number.isFinite(s.duration) && s.duration > 0 && Number.isFinite(s.time)) {
    const start = Math.round(now - s.time * 1000);
    a.timestamps = { start, end: Math.round(start + s.duration * 1000) };
  }
  if (YT_RE.test(String(s.yt || ''))) a.buttons = [{ label: 'Escuchar en YouTube', url: `https://www.youtube.com/watch?v=${s.yt}` }];
  return a;
}

/** What makes a new activity worth sending (a seek of more than a few seconds counts). */
const signature = (a) => (a ? JSON.stringify({ ...a, timestamps: a.timestamps ? Math.round(a.timestamps.start / 5000) : null }) : 'none');

/**
 * `read()` / `save(patch)`: the settings (`discord: true|false`).
 * `connect(path)`: a net-like socket (tests pass their own).
 */
function createDiscord({ read, save, connect = (p) => net.createConnection(p), pid = process.pid, id = clientId() } = {}) {
  let sock = null;
  let ready = false;
  let wanted = null;   // the activity we want Discord to show
  let shown = 'none';  // the signature of what it shows
  let lastSent = 0;
  let timer = null;
  let retry = null;
  let tryN = 0;
  const enabled = () => Boolean(id) && read().discord === true;

  function close() {
    if (sock) { try { sock.destroy(); } catch { /* gone */ } }
    sock = null;
    ready = false;
    shown = 'none';
  }

  function send(op, data) {
    if (!sock) return;
    try { sock.write(encode(op, data)); } catch { close(); }
  }

  function flush() {
    timer = null;
    if (!ready) return;
    const sig = signature(wanted);
    if (sig === shown) return;
    const wait = MIN_GAP_MS - (Date.now() - lastSent);
    if (wait > 0) { timer = setTimeout(flush, wait); return; }
    send(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid, ...(wanted ? { activity: wanted } : {}) }, nonce: crypto.randomUUID() });
    shown = sig;
    lastSent = Date.now();
  }
  const soon = () => { if (!timer) timer = setTimeout(flush, 300); };

  /** Tries discord-ipc-0 … 9 until one answers. */
  function open() {
    if (sock || !enabled()) return;
    clearTimeout(retry);
    retry = null;
    const n = tryN;
    const s = connect(pipePath(n));
    sock = s;
    let buf = Buffer.alloc(0);
    s.on('connect', () => send(OP.HANDSHAKE, { v: 1, client_id: id }));
    s.on('data', (chunk) => {
      const r = decode(Buffer.concat([buf, chunk]));
      buf = r.rest;
      if (r.broken) { close(); return; }
      for (const m of r.messages) {
        if (m.op === OP.PING) send(OP.PONG, m.data);
        else if (m.op === OP.CLOSE) close();
        else if (m.op === OP.FRAME && m.data && m.data.evt === 'READY') { ready = true; tryN = 0; soon(); }
      }
    });
    const gone = () => {
      if (sock !== s) return;
      close();
      // The next pipe at once; after the tenth, again in a while (Discord may open later).
      tryN = (n + 1) % 10;
      if (enabled()) retry = setTimeout(open, tryN === 0 ? RETRY_MS : 50);
    };
    s.on('error', gone);
    s.on('close', gone);
  }

  return {
    available: () => Boolean(id),
    state: () => ({ available: Boolean(id), enabled: enabled(), connected: ready }),
    set(on) {
      if (!id || typeof on !== 'boolean') return this.state();
      save({ discord: on });
      if (on) { tryN = 0; open(); } else { clearTimeout(retry); if (ready) { wanted = null; shown = 'x'; lastSent = 0; flush(); } setTimeout(close, 200); }
      return this.state();
    },
    /** What's playing changed (the mini player's checked state). */
    update(s) {
      if (!enabled()) return;
      wanted = activityOf(s);
      if (!sock) open();
      soon();
    },
    stop() {
      clearTimeout(timer);
      clearTimeout(retry);
      if (ready) send(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid }, nonce: crypto.randomUUID() });
      close();
    },
  };
}

module.exports = { createDiscord, activityOf, encode, decode, pipePath, CLIENT_ID };

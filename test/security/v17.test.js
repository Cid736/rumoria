// v1.7, the desktop side: Discord Rich Presence (only the local pipe, only
// checked text, nothing when it's off) and yt-dlp kept up to date apart from
// Rumoria (every 6 h, and at once when songs keep failing).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { activityOf, createDiscord, decode, encode, pipePath } = require('../../electron/discord');
const { createYtDlpKeeper, readUpdate, TROUBLE_FAILS } = require('../../electron/ytdlp');

test('discord: messages framed as the pipe wants them, and read back whole', () => {
  const a = encode(1, { cmd: 'X' });
  assert.equal(a.readInt32LE(0), 1);
  assert.equal(a.readInt32LE(4), a.length - 8);
  const b = encode(3, { n: 1 });
  const both = Buffer.concat([a, b]);
  const r = decode(both.slice(0, a.length + 3));
  assert.deepEqual(r.messages, [{ op: 1, data: { cmd: 'X' } }]);
  assert.equal(r.rest.length, 3);
  assert.deepEqual(decode(Buffer.concat([r.rest, both.slice(a.length + 3)])).messages, [{ op: 3, data: { n: 1 } }]);
  const evil = Buffer.alloc(8);
  evil.writeInt32LE(1, 0);
  evil.writeInt32LE(50 * 1024 * 1024, 4);
  assert.equal(decode(evil).broken, true);
  assert.equal(pipePath(0, 'win32'), '\\\\?\\pipe\\discord-ipc-0');
  assert.match(pipePath(2, 'linux', { XDG_RUNTIME_DIR: '/run/user/1000' }), /discord-ipc-2$/);
});

test('discord: the activity from what plays — paused or nothing is none; covers only from YouTube', () => {
  assert.equal(activityOf(null), null);
  assert.equal(activityOf({ title: 'Uno', playing: false }), null);
  const a = activityOf({ title: 'U', artist: 'Ana\u0000', cover: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg', playing: true, time: 10, duration: 200, yt: 'aaaaaaaaaaa' }, 1_000_000);
  assert.equal(a.type, 2);
  assert.equal(a.details.length >= 2, true, 'Discord wants at least 2 characters');
  assert.equal(a.state, 'Ana');
  assert.equal(a.assets.large_image, 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg');
  assert.deepEqual(a.timestamps, { start: 990_000, end: 1_190_000 });
  assert.deepEqual(a.buttons, [{ label: 'Escuchar en YouTube', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }]);
  const b = activityOf({ title: 'Dos', playing: true, cover: 'https://evil.example/x.png', yt: '../x' });
  assert.equal(b.assets.large_image, 'rumoria');
  assert.equal(b.buttons, undefined);
});

/** A pretend Discord on the other end of the pipe. */
function fakePipe() {
  const opened = [];
  const connect = (p) => {
    const s = new EventEmitter();
    s.path = p;
    s.sent = [];
    s.write = (buf) => { s.sent.push(...decode(buf).messages); };
    s.destroy = () => {};
    opened.push(s);
    setImmediate(() => s.emit('connect'));
    return s;
  };
  return { opened, connect };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('discord: off or without an app id, nothing is opened; on: handshake, then the song', async () => {
  let settings = {};
  const pipe = fakePipe();
  const none = createDiscord({ read: () => settings, save: (p) => { settings = { ...settings, ...p }; }, connect: pipe.connect, id: null });
  assert.equal(none.available(), false);
  none.set(true);
  none.update({ title: 'Uno', playing: true });
  assert.equal(pipe.opened.length, 0);

  const d = createDiscord({ read: () => settings, save: (p) => { settings = { ...settings, ...p }; }, connect: pipe.connect, id: '123456789012345678', pid: 42 });
  d.update({ title: 'Uno', playing: true });
  assert.equal(pipe.opened.length, 0, 'off: nothing');
  d.set(true);
  assert.equal(settings.discord, true);
  await wait(10);
  const s = pipe.opened[0];
  assert.deepEqual(s.sent[0], { op: 0, data: { v: 1, client_id: '123456789012345678' } });
  s.emit('data', encode(1, { evt: 'READY' }));
  d.update({ title: 'Uno', artist: 'Ana', playing: true });
  await wait(400);
  const act = s.sent.find((m) => m.data && m.data.cmd === 'SET_ACTIVITY');
  assert.equal(act.data.args.pid, 42);
  assert.equal(act.data.args.activity.details, 'Uno');
  // Discord's ping is answered.
  s.emit('data', encode(3, { x: 1 }));
  assert.deepEqual(s.sent[s.sent.length - 1], { op: 4, data: { x: 1 } });
  // Off: the activity is cleared.
  d.set(false);
  await wait(10);
  const last = s.sent[s.sent.length - 1];
  assert.equal(last.data.cmd, 'SET_ACTIVITY');
  assert.equal(last.data.args.activity, undefined);
  d.stop();
});

test('yt-dlp: what -U says', () => {
  assert.deepEqual(readUpdate('Latest version: stable@2026.10.10\nUpdating to stable@2026.10.10 …\nUpdated yt-dlp to stable@2026.10.10'), { result: 'updated', version: '2026.10.10' });
  assert.deepEqual(readUpdate('yt-dlp is up to date (stable@2026.09.30 from yt-dlp/yt-dlp)'), { result: 'current', version: '2026.09.30' });
  assert.deepEqual(readUpdate('ERROR: unable to download'), { result: 'failed', version: null });
});

test('yt-dlp: several different songs failing looks like YouTube changed: updated at once, once in a while; a song playing clears it', async () => {
  let t = 1_000_000;
  const runs = [];
  const sent = [];
  let settings = {};
  const run = (file, args, opts, cb) => {
    runs.push(args.join(' '));
    setImmediate(() => cb(null, args[0] === '--version' ? '2026.10.10\n' : 'Updated yt-dlp to stable@2026.10.10', ''));
  };
  const k = createYtDlpKeeper({ bin: () => 'yt-dlp', run, read: () => settings, save: (p) => { settings = { ...settings, ...p }; }, send: (s) => sent.push(s), now: () => t });
  k.report('fail', 'aaaaaaaaaaa');
  k.report('fail', 'aaaaaaaaaaa'); // the same song again doesn't count twice
  k.report('fail', 'bbbbbbbbbbb');
  k.report('fail', '../evil');
  assert.equal(runs.length, 0);
  k.report('fail', 'ccccccccccc');
  assert.equal(TROUBLE_FAILS, 3);
  assert.equal(runs[0], '-U');
  assert.equal(k.state().trouble, true);
  await wait(20);
  assert.equal(k.state().last, 'updated');
  assert.equal(k.state().version, '2026.10.10');
  assert.equal(settings.ytDlpCheckedAt, t);
  assert.ok(sent.some((s) => s.updating) && sent.some((s) => s.last === 'updated'));
  // More failures soon after: no second update for a while (the notice stays).
  for (const id of ['ddddddddddd', 'eeeeeeeeeee', 'fffffffffff']) k.report('fail', id);
  assert.equal(runs.filter((r) => r === '-U').length, 1);
  // Failures spread out over more than 10 minutes don't add up.
  t += 31 * 60_000;
  k.report('fail', 'ggggggggggg');
  t += 11 * 60_000;
  k.report('fail', 'hhhhhhhhhhh');
  t += 11 * 60_000;
  k.report('fail', 'iiiiiiiiiii');
  assert.equal(runs.filter((r) => r === '-U').length, 1);
  // A song plays: the trouble is over.
  k.report('ok');
  assert.equal(k.state().trouble, false);
  // By hand, any time (one at a time).
  const a = k.update('manual');
  const b = k.update('manual');
  await Promise.all([a, b]);
  assert.equal(runs.filter((r) => r === '-U').length, 2);
});

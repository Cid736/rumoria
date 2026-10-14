// v1.12, Modo juego: a game full screen (Windows) puts Rumoria's own work
// off — the PowerShell loop that looks, how "playing" is told from a quick
// Alt+Tab, and what the server stops doing meanwhile.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { createGameWatch, step, SCRIPT, LEAVE_AFTER_MS } = require('../../electron/game');
const { startApp } = require('../helpers');

/** A stand-in for child_process.spawn: the loop's output is ours to write. */
function fakeSpawn() {
  const runs = [];
  const spawn = (file, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; child.emit('exit', null); };
    runs.push({ file, args, opts, child });
    return child;
  };
  return { spawn, runs };
}

test('game: into it at once, out of it only after a minute without anything full screen', () => {
  let s = { active: false, clearAt: null };
  s = step(s, true, 0);
  assert.equal(s.active, true);
  s = step(s, false, 1000); // Alt+Tab to Rumoria
  assert.equal(s.active, true);
  s = step(s, true, 20_000); // back in the game: the minute starts again
  s = step(s, false, 30_000);
  s = step(s, false, 30_000 + LEAVE_AFTER_MS - 1);
  assert.equal(s.active, true);
  s = step(s, false, 30_000 + LEAVE_AFTER_MS);
  assert.deepEqual(s, { active: false, clearAt: null });
  assert.equal(LEAVE_AFTER_MS, 60_000);
});

test('game: the loop is PowerShell, hidden, with our pid by the environment; its lines become news', () => {
  const { spawn, runs } = fakeSpawn();
  const seen = [];
  let t = 0;
  const w = createGameWatch({ spawn, platform: 'win32', pid: 4242, read: () => ({}), save: () => {}, onChange: (a) => seen.push(a), now: () => t });
  w.start();
  assert.equal(runs.length, 1);
  const { file, args, opts, child } = runs[0];
  assert.equal(file, 'powershell.exe');
  assert.ok(args.includes('-NoProfile') && args.includes('-NonInteractive') && args.includes('-EncodedCommand'));
  assert.equal(Buffer.from(args[args.length - 1], 'base64').toString('utf16le'), SCRIPT);
  assert.equal(opts.windowsHide, true);
  assert.equal(opts.env.RU_PID, '4242');
  assert.ok(!SCRIPT.includes('4242'), 'the pid never goes into the script text');
  assert.equal(opts.shell, undefined);
  child.stdout.emit('data', '0\r\n');
  assert.deepEqual(seen, []);
  child.stdout.emit('data', '1');
  child.stdout.emit('data', '\r\n'); // a line split in two pieces
  assert.deepEqual(seen, [true]);
  assert.deepEqual(w.state(), { available: true, enabled: true, active: true });
  child.stdout.emit('data', 'garbage\r\n0\r\n');
  t = LEAVE_AFTER_MS;
  child.stdout.emit('data', '0\r\n');
  assert.deepEqual(seen, [true, false]);
  w.stop();
  assert.equal(child.killed, true);
});

test('game: Rumoria\'s own windows, the desktop and the taskbar never count; the loop ends with Rumoria', () => {
  assert.match(SCRIPT, /if \(pid == ours\) return 0;/);
  assert.match(SCRIPT, /"Progman" \|\| k == "WorkerW" \|\| k == "Shell_TrayWnd"/);
  assert.match(SCRIPT, /PriorityClass = 'Idle'/);
  assert.match(SCRIPT, /Get-Process -Id \$ours -ErrorAction SilentlyContinue\)\) \{ exit \}/);
  assert.match(SCRIPT, /\$ours = \[uint32\]\$env:RU_PID/);
});

test('game: only on Windows, not when turned off, and turning it off ends a game at once', () => {
  const mac = fakeSpawn();
  const m = createGameWatch({ spawn: mac.spawn, platform: 'darwin', read: () => ({}), save: () => {} });
  m.start();
  assert.equal(mac.runs.length, 0);
  assert.equal(m.state().available, false);

  let settings = { gameMode: false };
  const off = fakeSpawn();
  const seen = [];
  const w = createGameWatch({ spawn: off.spawn, platform: 'win32', read: () => settings, save: (p) => { settings = { ...settings, ...p }; }, onChange: (a) => seen.push(a) });
  w.start();
  assert.equal(off.runs.length, 0);
  assert.deepEqual(w.set(true), { available: true, enabled: true, active: false });
  assert.equal(settings.gameMode, true);
  assert.equal(off.runs.length, 1);
  off.runs[0].child.stdout.emit('data', '1\n');
  assert.deepEqual(seen, [true]);
  assert.deepEqual(w.set(false), { available: true, enabled: false, active: false });
  assert.deepEqual(seen, [true, false]);
  assert.equal(off.runs[0].child.killed, true);
});

test('game: a loop that dies by itself is no game, and is tried again only a few times', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { spawn, runs } = fakeSpawn();
  const seen = [];
  const w = createGameWatch({ spawn, platform: 'win32', read: () => ({}), save: () => {}, onChange: (a) => seen.push(a), leaveAfterMs: 0 });
  w.start();
  runs[0].child.stdout.emit('data', '1\n');
  runs[0].child.emit('exit', 1);
  assert.deepEqual(seen, [true, false]);
  for (let i = 0; i < 5; i++) { t.mock.timers.tick(30_000); if (runs.at(-1).child.listenerCount('exit')) runs.at(-1).child.emit('exit', 1); }
  assert.equal(runs.length, 4, 'the first run and 3 more');
  w.stop();
});

test('game: the desktop side puts off updates, yt-dlp\'s schedule, and asks only from the trusted page', () => {
  const root = path.join(__dirname, '..', '..');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const updater = fs.readFileSync(path.join(root, 'electron', 'updater.js'), 'utf8');
  const ytdlp = fs.readFileSync(path.join(root, 'electron', 'ytdlp.js'), 'utf8');
  assert.match(main, /ipcMain\.handle\('rumoria:setGame', \(event, on\) => \(isTrustedSender\(event\) && typeof on === 'boolean'/);
  assert.equal((main.match(/paused: \(\) => game\.active\(\)/g) || []).length, 2);
  assert.match(main, /serverProcess\.send\(\{ type: 'game', on: active \}\)/);
  assert.match(updater, /if \(paused\(\)\) \{ schedule\(PAUSED_RETRY_MS\); return; \}/);
  assert.match(ytdlp, /const due = \(\) => !paused\(\) &&/);
});

test('game: the server starts none of its background work while a game is on', async () => {
  const app = await startApp();
  try {
    app.setGame(true);
    await app.run.warmBrowse();
    await app.run.fillAutoLists();
    assert.equal(await app.run.curate(), null);
    assert.deepEqual(app.yt.calls, []);
    assert.equal(app.state.cloudSync.paused, true);
    app.setGame(false);
    assert.equal(app.state.cloudSync.paused, false);
    // Over: Explorar is read again (the first list is enough to tell).
    const run = app.run.warmBrowse();
    while (!app.yt.calls.length) await new Promise((r) => setTimeout(r, 10));
    assert.equal(app.yt.calls[0][0], 'flatList');
    app.setGame(true); // a game again: the round stops after this list
    await run;
    // That one list (its search and its playlist), no other after it.
    assert.ok(app.yt.calls.length <= 2, JSON.stringify(app.yt.calls));
    assert.ok(app.state.browse.list().filter((b) => b.featured).length > 1);
  } finally { await app.close(); }
});

// ---- v1.12.2: the look as a tiny program of its own (12 MB instead of PowerShell's 66) ----
const os = require('os');
const { COMPILE, PROBE } = require('../../electron/game');

/** What Add-Type would write: a Windows program (or, `dll`, a library). */
const pe = (dll = false) => {
  const b = Buffer.alloc(0x80);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(0x40, 0x3c);
  b.write('PE\0\0', 0x40, 'latin1');
  b.writeUInt16LE(dll ? 0x2102 : 0x0102, 0x40 + 22);
  return b;
};
/** spawn as Rumoria calls it: the compile step writes `out` where RU_OUT says and ends with `code`. */
function fakeMaker({ out = pe(), code = 0 } = {}) {
  const f = fakeSpawn();
  const spawn = (file, args, opts) => {
    const child = f.spawn(file, args, opts);
    if (opts.env && opts.env.RU_OUT) setImmediate(() => { if (out) fs.writeFileSync(opts.env.RU_OUT, out); child.emit('exit', code); });
    return child;
  };
  return { spawn, runs: f.runs };
}
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rum-game-'));
const tick = () => new Promise((r) => setImmediate(r));

test('game probe: made once by Add-Type (where it goes only by RU_OUT), checked by SHA-256, then run itself', async () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'rumoria-game-000000000000.exe'), 'an older Rumoria\'s');
    let settings = {};
    const m = fakeMaker();
    const w = createGameWatch({ spawn: m.spawn, platform: 'win32', pid: 7, dir, read: () => settings, save: (p) => { settings = { ...settings, ...p }; } });
    w.start();
    await tick(); await tick();
    assert.equal(m.runs[0].file, 'powershell.exe');
    assert.equal(Buffer.from(m.runs[0].args.at(-1), 'base64').toString('utf16le'), COMPILE);
    assert.match(COMPILE, /-OutputAssembly \$env:RU_OUT -OutputType ConsoleApplication/);
    assert.ok(m.runs[0].opts.env.RU_OUT.endsWith('.tmp.exe'), 'Add-Type makes a DLL unless the name ends in .exe');
    assert.ok(!COMPILE.includes(dir), 'no path inside the script text');
    assert.equal(m.runs[1].file, path.join(dir, PROBE));
    assert.deepEqual(m.runs[1].args, []);
    assert.equal(m.runs[1].opts.env.RU_PID, '7');
    assert.equal(m.runs[1].opts.shell, undefined);
    assert.deepEqual(fs.readdirSync(dir), [PROBE], 'the old one and the temporary file are gone');
    assert.match(settings.gameProbe[PROBE], /^[0-9a-f]{64}$/);
    m.runs[1].child.stdout.emit('data', '1\r\n');
    assert.equal(w.active(), true);
    w.stop();

    // Next time: straight to it.
    const again = fakeMaker();
    const w2 = createGameWatch({ spawn: again.spawn, platform: 'win32', dir, read: () => settings, save: (p) => { settings = { ...settings, ...p }; } });
    w2.start();
    assert.equal(again.runs.length, 1);
    assert.equal(again.runs[0].file, path.join(dir, PROBE));
    w2.stop();

    // Changed by someone: not run; made again.
    fs.appendFileSync(path.join(dir, PROBE), 'x');
    const third = fakeMaker();
    const w3 = createGameWatch({ spawn: third.spawn, platform: 'win32', dir, read: () => settings, save: (p) => { settings = { ...settings, ...p }; } });
    w3.start();
    assert.equal(third.runs[0].file, 'powershell.exe');
    assert.ok(third.runs[0].opts.env.RU_OUT);
    await tick(); await tick();
    assert.equal(third.runs[1].file, path.join(dir, PROBE));
    w3.stop();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('game probe: a library instead of a program, or a failed compile → the PowerShell loop, as before', async () => {
  for (const how of [{ out: pe(true) }, { out: null, code: 1 }]) {
    const dir = tmpDir();
    try {
      let settings = {};
      const m = fakeMaker(how);
      const w = createGameWatch({ spawn: m.spawn, platform: 'win32', dir, read: () => settings, save: (p) => { settings = { ...settings, ...p }; } });
      w.start();
      await tick(); await tick();
      assert.equal(m.runs.length, 2);
      assert.equal(m.runs[1].file, 'powershell.exe');
      assert.equal(Buffer.from(m.runs[1].args.at(-1), 'base64').toString('utf16le'), SCRIPT);
      assert.equal(settings.gameProbe, undefined);
      assert.deepEqual(fs.readdirSync(dir), []);
      w.stop();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

// v1.12, Modo juego (Windows): while a game (or any app) fills the screen,
// Rumoria asks for as little as it can — Recursos mínimos on the page, the
// server's background work and Rumoria's own updates put off, the server at
// low priority — and the music goes on. A small PowerShell loop (idle
// priority, one look every 5 s; v1.12.2: a tiny program of its own) says whether the window in front fills its
// monitor or runs Direct3D full screen; Rumoria's own windows never count.
// Into a game at once; out of it only after a minute without one, so a quick
// Alt+Tab (to change song) doesn't wake everything up.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const POLL_S = 5;
const LEAVE_AFTER_MS = 60_000;
const MAX_RESTARTS = 3;

// The look, in C#. v1.12.2: compiled once into a tiny program of its own
// (rumoria-game-<hash>.exe in Rumoria's data folder, about 9 MB in use instead
// of PowerShell's 66), checked by its SHA-256 before each start; if that can't
// be done, the same code runs inside PowerShell as before. Our pid comes in by
// the environment (RU_PID), never inside any text that runs; the loop ends by
// itself if Rumoria is gone.
const SOURCE = `using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class RumoriaGame {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool SetProcessWorkingSetSize(IntPtr p, IntPtr min, IntPtr max);
  public static void Trim() { GC.Collect(); GC.WaitForPendingFinalizers(); SetProcessWorkingSetSize(GetCurrentProcess(), (IntPtr)(-1), (IntPtr)(-1)); }
  public static int Look(uint ours) {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return 0;
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (pid == ours) return 0;
    StringBuilder c = new StringBuilder(64); GetClassName(h, c, 64);
    string k = c.ToString();
    if (k == "Progman" || k == "WorkerW" || k == "Shell_TrayWnd") return 0;
    int q; if (SHQueryUserNotificationState(out q) == 0 && q == 3) return 1;
    RECT r; if (!GetWindowRect(h, out r)) return 0;
    MONITORINFO mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return 0;
    RECT m = mi.rcMonitor;
    return (r.L <= m.L && r.T <= m.T && r.R >= m.R && r.B >= m.B) ? 1 : 0;
  }
  // The program on its own: the same loop as the PowerShell one below.
  public static void Main() {
    uint ours;
    if (!uint.TryParse(Environment.GetEnvironmentVariable("RU_PID"), out ours)) return;
    try { Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.Idle; } catch { }
    int last = -1;
    while (true) {
      try { Process.GetProcessById((int)ours).Dispose(); } catch { return; }
      int s = Look(ours);
      if (s != last) { try { Console.WriteLine(s); Console.Out.Flush(); } catch { return; } last = s; }
      Thread.Sleep(${POLL_S * 1000});
    }
  }
}
`;

// Inside PowerShell (when the program can't be made): the same code, the same loop.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'Idle'
Add-Type -TypeDefinition @'
${SOURCE}'@
$ours = [uint32]$env:RU_PID
$last = -1
$n = 0
while ($true) {
  if (-not (Get-Process -Id $ours -ErrorAction SilentlyContinue)) { exit }
  $s = [RumoriaGame]::Look($ours)
  if ($s -ne $last) { [Console]::Out.WriteLine($s); [Console]::Out.Flush(); $last = $s }
  # What compiling took is given back (once at the start, then now and then).
  if ($n % 120 -eq 0) { [RumoriaGame]::Trim() }
  $n++
  Start-Sleep -Seconds ${POLL_S}
}
`;

// Making the program: where it goes comes by the environment (RU_OUT).
const COMPILE = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${SOURCE}'@ -OutputAssembly $env:RU_OUT -OutputType ConsoleApplication
`;

/** The program's name: it changes with the code, so a new Rumoria makes it again. */
const PROBE = `rumoria-game-${crypto.createHash('sha256').update(SOURCE).digest('hex').slice(0, 12)}.exe`;
const PROBE_RE = /^rumoria-game-[0-9a-f]{12}(\.tmp)?\.exe$/;

/** PowerShell's -EncodedCommand: the script as UTF-16LE in base64. */
const encoded = (script = SCRIPT) => Buffer.from(script, 'utf16le').toString('base64');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/** A Windows program (MZ, PE, not a DLL): Add-Type makes a DLL unless the name ends in .exe. */
function isProgram(file) {
  const b = fs.readFileSync(file);
  if (b.length < 0x40 || b.toString('latin1', 0, 2) !== 'MZ') return false;
  const pe = b.readUInt32LE(0x3c);
  return pe + 24 <= b.length && b.toString('latin1', pe, pe + 4) === 'PE\0\0' && (b.readUInt16LE(pe + 22) & 0x2000) === 0;
}

/**
 * What the screen says (`raw`: something fills it) turned into "playing":
 * on at once, off after `leaveAfterMs` without anything full screen.
 * Returns the new `{ active, clearAt }`.
 */
function step({ active, clearAt }, raw, t, leaveAfterMs = LEAVE_AFTER_MS) {
  if (raw) return { active: true, clearAt: null };
  if (!active) return { active: false, clearAt: null };
  const at = clearAt === null ? t : clearAt;
  return t - at >= leaveAfterMs ? { active: false, clearAt: null } : { active: true, clearAt: at };
}

/**
 * `spawn`: child_process.spawn; `read()` / `save(patch)`: the settings
 * (`gameMode`, on unless turned off; `gameProbe`, the program's SHA-256);
 * `dir`: where the program is made (none: always PowerShell);
 * `onChange(active)`: news of it.
 */
function createGameWatch({ spawn, platform = process.platform, pid = process.pid, read, save, dir = null, onChange = () => {}, now = () => Date.now(), leaveAfterMs = LEAVE_AFTER_MS }) {
  const available = platform === 'win32';
  let s = { active: false, clearAt: null };
  let child = null;
  let tick = null;
  let raw = false;
  let restarts = 0;
  let stopped = true;
  let making = null;
  let madeTried = false;
  const enabled = () => read().gameMode !== false;
  const probe = dir ? path.join(dir, PROBE) : null;

  /** The program, if it's there and still the one made here (its SHA-256); else null. */
  function ready() {
    if (!probe) return null;
    try {
      const want = (read().gameProbe || {})[PROBE];
      return want && fs.statSync(probe).isFile() && sha256(probe) === want ? probe : null;
    } catch { return null; }
  }

  /** Makes the program once (PowerShell's Add-Type), then `done()`. Old ones, of an earlier Rumoria, go. */
  function make(done) {
    madeTried = true;
    const tmp = probe.replace(/\.exe$/, '.tmp.exe');
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const n of fs.readdirSync(dir)) if (PROBE_RE.test(n) && n !== PROBE) fs.rmSync(path.join(dir, n), { force: true });
      fs.rmSync(probe, { force: true });
      making = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded(COMPILE)], {
        stdio: 'ignore', windowsHide: true, env: { ...process.env, RU_OUT: tmp },
      });
    } catch { making = null; done(); return; }
    const timer = setTimeout(() => { try { making.kill(); } catch { /* gone */ } }, 60_000);
    timer.unref?.();
    let once = false;
    const end = (code) => {
      if (once) return;
      once = true;
      clearTimeout(timer);
      making = null;
      try {
        if (code === 0 && fs.statSync(tmp).isFile() && isProgram(tmp)) {
          fs.renameSync(tmp, probe);
          save({ gameProbe: { [PROBE]: sha256(probe) } });
        }
      } catch { /* PowerShell, then */ }
      try { fs.rmSync(tmp, { force: true }); } catch { /* not there */ }
      done();
    };
    making.on('exit', end);
    making.on('error', () => end(null));
  }

  function update() {
    const next = step(s, raw, now(), leaveAfterMs);
    const changed = next.active !== s.active;
    s = next;
    if (changed) { try { onChange(s.active); } catch { /* not fatal */ } }
  }

  function launch() {
    if (child || making || stopped) return;
    const exe = ready();
    // Not made yet (or changed since): made once, then this again.
    if (!exe && probe && !madeTried) { make(launch); return; }
    const [file, args] = exe ? [exe, []] : ['powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded()]];
    try {
      child = spawn(file, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, env: { ...process.env, RU_PID: String(pid) } });
    } catch { child = null; return; }
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += String(d);
      const lines = buf.split(/\r?\n/);
      buf = lines.pop().slice(-16);
      for (const l of lines) { if (l.trim() === '1') raw = true; else if (l.trim() === '0') raw = false; }
      update();
    });
    const gone = () => {
      if (!child) return;
      child = null;
      raw = false;
      update();
      // It stopped by itself (not by us): try again a few times, then without it.
      if (!stopped && restarts < MAX_RESTARTS) { restarts += 1; setTimeout(launch, 30_000).unref?.(); }
    };
    child.on('exit', gone);
    child.on('error', gone);
  }

  function start() {
    if (!available || !enabled() || !stopped) return;
    stopped = false;
    launch();
    // Leaving the game is noticed even without news from the loop.
    tick = setInterval(update, 10_000);
    tick.unref?.();
  }

  function stop() {
    stopped = true;
    clearInterval(tick);
    tick = null;
    if (child) { try { child.kill(); } catch { /* already gone */ } child = null; }
    if (making) { try { making.kill(); } catch { /* already gone */ } }
    raw = false;
    s = { ...s, clearAt: null };
    if (s.active) { s = { active: false, clearAt: null }; try { onChange(false); } catch { /* not fatal */ } }
  }

  return {
    start,
    stop,
    active: () => s.active,
    state: () => ({ available, enabled: enabled(), active: s.active }),
    /** On or off (kept in the settings); off ends a game in progress at once. */
    set(on) {
      save({ gameMode: on === true });
      if (on === true) { restarts = 0; start(); } else stop();
      return this.state();
    },
  };
}

module.exports = { createGameWatch, step, SCRIPT, SOURCE, COMPILE, PROBE, LEAVE_AFTER_MS };

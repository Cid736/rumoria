// v1.12, Modo juego (Windows): while a game (or any app) fills the screen,
// Rumoria asks for as little as it can — Recursos mínimos on the page, the
// server's background work and Rumoria's own updates put off, the server at
// low priority — and the music goes on. A small PowerShell loop (idle
// priority, one look every 5 s) says whether the window in front fills its
// monitor or runs Direct3D full screen; Rumoria's own windows never count.
// Into a game at once; out of it only after a minute without one, so a quick
// Alt+Tab (to change song) doesn't wake everything up.

const POLL_S = 5;
const LEAVE_AFTER_MS = 60_000;
const MAX_RESTARTS = 3;

// The look, in C# compiled once by Add-Type (the memory that took is given back). Our pid comes in by the
// environment (RU_PID), never inside the script text; the loop ends by itself
// if Rumoria is gone.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'Idle'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
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
}
'@
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

/** PowerShell's -EncodedCommand: the script as UTF-16LE in base64. */
const encoded = () => Buffer.from(SCRIPT, 'utf16le').toString('base64');

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
 * (`gameMode`, on unless turned off); `onChange(active)`: news of it.
 */
function createGameWatch({ spawn, platform = process.platform, pid = process.pid, read, save, onChange = () => {}, now = () => Date.now(), leaveAfterMs = LEAVE_AFTER_MS }) {
  const available = platform === 'win32';
  let s = { active: false, clearAt: null };
  let child = null;
  let tick = null;
  let raw = false;
  let restarts = 0;
  let stopped = true;
  const enabled = () => read().gameMode !== false;

  function update() {
    const next = step(s, raw, now(), leaveAfterMs);
    const changed = next.active !== s.active;
    s = next;
    if (changed) { try { onChange(s.active); } catch { /* not fatal */ } }
  }

  function launch() {
    if (child || stopped) return;
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded()], {
        stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, env: { ...process.env, RU_PID: String(pid) },
      });
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

module.exports = { createGameWatch, step, SCRIPT, LEAVE_AFTER_MS };

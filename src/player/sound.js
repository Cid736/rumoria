// The sound between the <audio> and your speakers (Web Audio), like
// TubeGrab's: karaoke → 5-band equalizer → limiter → same volume → fade →
// sleep fade → output, plus what the visualizer reads. Built only when
// something needs it (equalizer, same volume, karaoke, fades or the
// visualizer); until then the <audio> plays straight, at no cost.
import { usePerf } from '../store/perf.js';
import { usePlayer } from '../store/player.js';
import { BANDS, useSound } from '../store/sound.js';

const LEVELS_KEY = 'rumoria_levels';
const TARGET_DB = -16;
const isFlat = (g) => g.every((x) => x === 0);
/** Does anything need the Web Audio chain? */
export const needsGraph = (s, perf = 'mid') => !isFlat(s.gains) || s.level || s.karaoke || s.fade > 0 || (s.visualizer && perf !== 'min');

export function startSound({ audio, sound = useSound, player = usePlayer, perf = usePerf, AudioCtx = typeof AudioContext !== 'undefined' ? AudioContext : null } = {}) {
  let ctx = null;
  let nodes = null;
  let sleepTimer = null;
  let measureTimer = null;
  const memo = (() => { try { const o = JSON.parse(localStorage.getItem(LEVELS_KEY)); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } })();
  const meter = { key: null, power: 0, n: 0, want: null };
  const s = () => sound.getState();

  function build() {
    if (ctx || !AudioCtx) return;
    try {
      ctx = new AudioCtx();
      const src = ctx.createMediaElementSource(audio);
      // Karaoke: left minus right takes out what's in the middle (the voice);
      // the bass, also in the middle, comes back through a low-pass.
      const vin = ctx.createGain();
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const split = ctx.createChannelSplitter(2);
      const left = ctx.createGain();
      const right = ctx.createGain();
      right.gain.value = -1;
      const side = ctx.createGain();
      side.channelCount = 1;
      side.channelCountMode = 'explicit';
      side.gain.value = 1.3;
      const bass = ctx.createBiquadFilter();
      bass.type = 'lowpass';
      bass.frequency.value = 150;
      const filters = BANDS.map((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f;
        b.Q.value = 1;
        return b;
      });
      const limiter = ctx.createDynamicsCompressor();
      const level = ctx.createGain();
      const fade = ctx.createGain();
      const master = ctx.createGain();
      const scope = ctx.createAnalyser();
      scope.fftSize = 256;
      scope.smoothingTimeConstant = 0.8;
      const probe = ctx.createAnalyser();
      probe.fftSize = 2048;
      src.connect(vin);
      src.connect(probe);
      vin.connect(dry).connect(filters[0]);
      vin.connect(split);
      split.connect(left, 0);
      split.connect(right, 1);
      left.connect(side);
      right.connect(side);
      side.connect(wet);
      vin.connect(bass).connect(wet);
      wet.connect(filters[0]);
      filters.reduce((a, b) => { a.connect(b); return b; }).connect(limiter).connect(level).connect(fade).connect(master).connect(ctx.destination);
      master.connect(scope);
      nodes = { dry, wet, filters, limiter, level, fade, master, scope, probe };
      apply();
      setSink();
    } catch { ctx = null; nodes = null; }
  }

  /** The settings, now: bands, karaoke, limiter, speed. */
  function apply() {
    const v = s();
    audio.preservesPitch = v.pitch;
    audio.defaultPlaybackRate = v.speed;
    audio.playbackRate = v.speed;
    if (!nodes && needsGraph(v, perf.getState().profile)) build();
    if (!nodes) return;
    v.gains.forEach((g, i) => { nodes.filters[i].gain.value = g; });
    nodes.dry.gain.value = v.karaoke ? 0 : 1;
    nodes.wet.gain.value = v.karaoke ? 1 : 0;
    // Only when something could push the sound over the top.
    const on = v.level || v.gains.some((g) => g > 0);
    nodes.limiter.threshold.value = on ? -1.5 : 0;
    nodes.limiter.ratio.value = on ? 20 : 1;
    nodes.limiter.knee.value = 0;
    nodes.limiter.attack.value = 0.003;
    nodes.limiter.release.value = 0.25;
    if (!v.level) nodes.level.gain.value = 1;
  }

  /** Where it sounds (a device chosen in Ajustes, or the system's). */
  async function setSink() {
    const id = s().sinkId || '';
    try {
      if (ctx && typeof ctx.setSinkId === 'function') await ctx.setSinkId(id);
      else if (typeof audio.setSinkId === 'function') await audio.setSinkId(id);
    } catch { /* that device is gone: the system's */ }
  }

  // ---- same volume: how loud a song really is, measured while it plays,
  // pulled gently towards one level; remembered per song ----
  const songKey = () => { const t = player.getState().current(); return t && (t.yt ? `yt:${t.yt}` : t.key) || null; };
  function remember() {
    if (!meter.key || meter.want === null || meter.n < 40) return;
    delete memo[meter.key];
    memo[meter.key] = Math.round(meter.want * 10) / 10;
    const keys = Object.keys(memo);
    if (keys.length > 800) delete memo[keys[0]];
    try { localStorage.setItem(LEVELS_KEY, JSON.stringify(memo)); } catch { /* only for now */ }
  }
  const buf = new Float32Array(2048);
  function measure() {
    if (!nodes || !s().level || audio.paused) return;
    const key = songKey();
    if (!key) return;
    if (meter.key !== key) {
      remember();
      Object.assign(meter, { key, power: 0, n: 0, want: null });
      const known = memo[key];
      nodes.level.gain.value = Number.isFinite(known) && Math.abs(known) <= 12 ? 10 ** (known / 20) : 1;
    }
    // The page's volume is applied before this point: measured without it.
    const vol = audio.muted ? 0 : audio.volume;
    if (vol < 0.05) return;
    nodes.probe.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const p = sum / buf.length / (vol * vol);
    if (p < 3e-5) return; // a pause, a fade: not the song's loudness
    meter.n = Math.min(meter.n + 1, 240);
    meter.power += (p - meter.power) / meter.n;
    if (meter.n < 8) return;
    meter.want = Math.max(-12, Math.min(8, TARGET_DB - 10 * Math.log10(meter.power)));
    nodes.level.gain.setTargetAtTime(10 ** (meter.want / 20), ctx.currentTime, 1.5);
  }

  // ---- fades: in at the start of each song, out before its end ----
  let fadingOut = false;
  function onTime() {
    const f = s().fade;
    if (!nodes || !f || !Number.isFinite(audio.duration)) return;
    const left = audio.duration - audio.currentTime;
    if (!fadingOut && left > 0 && left <= f && audio.duration > f * 3) {
      fadingOut = true;
      nodes.fade.gain.setTargetAtTime(0.0001, ctx.currentTime, Math.max(0.2, left / 4));
    }
  }
  function onStart() {
    fadingOut = false;
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (!nodes) return;
    const f = s().fade;
    nodes.fade.gain.cancelScheduledValues(ctx.currentTime);
    if (f && audio.currentTime < 1) { nodes.fade.gain.setValueAtTime(0.0001, ctx.currentTime); nodes.fade.gain.setTargetAtTime(1, ctx.currentTime, Math.min(f, 4) / 3); } else nodes.fade.gain.value = 1;
  }

  // ---- sleep timer: a gentle fade, then pause ----
  function goToSleep() {
    const done = () => { player.getState().pause(); sound.getState().setSleep(null); if (nodes) nodes.master.gain.setTargetAtTime(1, ctx.currentTime, 0.05); };
    if (!nodes) { done(); return; }
    nodes.master.gain.setTargetAtTime(0.0001, ctx.currentTime, 3);
    setTimeout(done, 10_000);
  }
  function armSleep() {
    clearTimeout(sleepTimer);
    const z = s().sleep;
    if (z && z.until) sleepTimer = setTimeout(goToSleep, Math.max(0, z.until - Date.now()));
  }

  // ---- headphones unplugged: pause (an output device went away) ----
  let outputs = null;
  async function countOutputs() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput').length; } catch { return null; }
  }
  async function onDevices() {
    const n = await countOutputs();
    if (outputs !== null && n !== null && n < outputs && s().unplugPause && player.getState().wantPlaying) player.getState().pause();
    outputs = n;
    if (s().sinkId) setSink();
  }
  const md = typeof navigator !== 'undefined' && navigator.mediaDevices;
  if (md && md.addEventListener) { md.addEventListener('devicechange', onDevices); countOutputs().then((n) => { outputs = n; }); }

  audio.addEventListener('playing', onStart);
  audio.addEventListener('timeupdate', onTime);
  measureTimer = setInterval(measure, 250);
  const offSound = sound.subscribe((v, before) => {
    if (v.sinkId !== before.sinkId) setSink();
    if (v.sleep !== before.sleep) armSleep();
    apply();
  });
  const offPerf = perf.subscribe((v, before) => { if (v.profile !== before.profile) apply(); });
  apply();
  armSleep();

  return {
    /** For the visualizer: frequency bars (0-255), or null when there's no chain. */
    bars(out) { if (!nodes) return null; nodes.scope.getByteFrequencyData(out); return out; },
    /** "Al acabar esta canción": the engine asks before going on. */
    sleepAtEnd() { if (s().sleep && s().sleep.end) { sound.getState().setSleep(null); return true; } return false; },
    stop() { offSound(); offPerf(); clearInterval(measureTimer); clearTimeout(sleepTimer); remember(); if (md && md.removeEventListener) md.removeEventListener('devicechange', onDevices); },
  };
}

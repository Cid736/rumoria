// The player store and the engine that drives <audio> (a fake one here).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayer } from '../../src/store/player.js';
import { emptyQueue } from '../../src/lib/queue.js';
import { startEngine } from '../../src/player/engine.js';

const yt = (id, title) => ({ key: `yt:${id}`, yt: id, title, artist: 'A', duration: 200 });
const A = yt('aaaaaaaaaaa', 'A');
const B = yt('bbbbbbbbbbb', 'B');

/** Enough of an <audio> for the engine: records what it's told, fires what we say. */
class FakeAudio extends EventTarget {
  constructor() { super(); this.src = ''; this.paused = true; this.currentTime = 0; this.duration = NaN; this.volume = 1; this.muted = false; this.ended = false; this.calls = []; }
  play() { this.calls.push('play'); this.paused = false; this.dispatchEvent(new Event('playing')); return Promise.resolve(); }
  pause() { this.calls.push('pause'); this.paused = true; this.dispatchEvent(new Event('pause')); }
  getAttribute(k) { return k === 'src' ? this.src : null; }
  removeAttribute() { this.src = ''; }
  emit(type) { this.dispatchEvent(new Event(type)); }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  usePlayer.setState({ queue: emptyQueue(), wantPlaying: false, status: 'idle', position: 0, duration: 0, repeat: 'off', radio: false, muted: false, volume: 0.8 });
});

describe('player store', () => {
  it('plays a list, toggles, moves on, and stops at the end', () => {
    const p = usePlayer.getState();
    p.playTracks([A, B], 0);
    expect(usePlayer.getState().current().title).toBe('A');
    expect(usePlayer.getState().wantPlaying).toBe(true);
    p.toggle();
    expect(usePlayer.getState().wantPlaying).toBe(false);
    expect(p.next()).toBe(true);
    expect(usePlayer.getState().current().title).toBe('B');
    expect(usePlayer.getState().next()).toBe(false);
    expect(usePlayer.getState().wantPlaying).toBe(false);
  });

  it('repeat cycles off → all → one; volume is kept between 0 and 1 and remembered', () => {
    const p = usePlayer.getState();
    p.cycleRepeat(); expect(usePlayer.getState().repeat).toBe('all');
    p.cycleRepeat(); expect(usePlayer.getState().repeat).toBe('one');
    p.cycleRepeat(); expect(usePlayer.getState().repeat).toBe('off');
    p.setVolume(7); expect(usePlayer.getState().volume).toBe(1);
    p.setVolume(-1); expect(usePlayer.getState().volume).toBe(0);
    p.setVolume(0.3);
    expect(localStorage.getItem('rumoria_volume')).toBe('0.3');
  });

  it('shuffle stays on for the next thing you play', () => {
    const p = usePlayer.getState();
    p.playTracks([A, B], 0);
    p.toggleShuffle();
    expect(usePlayer.getState().shuffle()).toBe(true);
    p.playTracks([B, A], 0);
    expect(usePlayer.getState().shuffle()).toBe(true);
  });
});

describe('engine', () => {
  it('loads YouTube songs through the relay, plays, pauses, seeks, sets the volume', async () => {
    const audio = new FakeAudio();
    const engine = startEngine({ audio, toast: () => {}, get: vi.fn(), post: vi.fn(async () => ({})), media: null });
    usePlayer.getState().playTracks([A, B], 0);
    await flush();
    expect(audio.src).toBe('/api/stream/audio?id=aaaaaaaaaaa');
    expect(audio.calls).toContain('play');
    expect(usePlayer.getState().status).toBe('playing');
    usePlayer.getState().pause();
    expect(audio.calls.at(-1)).toBe('pause');
    usePlayer.getState().seek(42);
    expect(audio.currentTime).toBe(42);
    usePlayer.getState().setVolume(0.25);
    expect(audio.volume).toBe(0.25);
    engine.stop();
  });

  it('a song only known by name is found first (and remembered in the queue)', async () => {
    const audio = new FakeAudio();
    const get = vi.fn(async () => ({ id: 'ccccccccccc', title: 'Found', duration: 199, thumbnail: 'https://i.ytimg.com/vi/ccccccccccc/hqdefault.jpg' }));
    const engine = startEngine({ audio, toast: () => {}, get, post: vi.fn(async () => ({})), media: null });
    usePlayer.getState().playTracks([{ key: null, query: 'Band - Song', title: 'Song', artist: 'Band', list: 'abcdefabcdefabcd', n: 3 }], 0);
    await flush();
    expect(get.mock.calls[0][0]).toBe('/api/find?q=Band+-+Song&list=abcdefabcdefabcd&n=3');
    expect(audio.src).toBe('/api/stream/audio?id=ccccccccccc');
    expect(usePlayer.getState().current()).toMatchObject({ yt: 'ccccccccccc', key: 'yt:ccccccccccc', title: 'Song' });
    engine.stop();
  });

  it('notes what you heard (only real listening) when the song changes', async () => {
    const audio = new FakeAudio();
    const post = vi.fn(async () => ({}));
    const engine = startEngine({ audio, toast: () => {}, get: vi.fn(), post, media: null });
    usePlayer.getState().playTracks([A, B], 0);
    await flush();
    for (let t = 1; t <= 12; t++) { audio.currentTime = t; audio.emit('timeupdate'); }
    audio.currentTime = 150; audio.emit('timeupdate'); // a jump is not listening
    usePlayer.getState().next();
    await flush();
    expect(post).toHaveBeenCalledWith('/api/history', { song: { key: 'yt:aaaaaaaaaaa', title: 'A', artist: 'A', dur: 200 }, secs: 12 });
    engine.stop();
  });

  it('at the end: the next song, then (radio on) similar ones', async () => {
    const audio = new FakeAudio();
    const get = vi.fn(async () => ({ entries: [{ id: 'ddddddddddd', title: 'Parecida', channel: 'X - Topic' }] }));
    const engine = startEngine({ audio, toast: () => {}, get, post: vi.fn(async () => ({})), media: null });
    usePlayer.setState({ radio: true });
    usePlayer.getState().playTracks([A], 0);
    await flush();
    audio.emit('ended');
    await flush();
    await flush();
    expect(get).toHaveBeenCalledWith('/api/stream/radio?id=aaaaaaaaaaa');
    expect(usePlayer.getState().current()).toMatchObject({ yt: 'ddddddddddd', artist: 'X' });
    engine.stop();
  });

  it('a song that can\'t play: says so and skips to the next', async () => {
    vi.useFakeTimers();
    const audio = new FakeAudio();
    const toast = vi.fn();
    const engine = startEngine({ audio, toast, get: vi.fn(), post: vi.fn(async () => ({})), media: null });
    usePlayer.getState().playTracks([A, B], 0);
    await vi.advanceTimersByTimeAsync(0);
    audio.emit('error');
    expect(toast).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600);
    expect(usePlayer.getState().current().title).toBe('B');
    engine.stop();
    vi.useRealTimers();
  });
});

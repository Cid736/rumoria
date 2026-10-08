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
  usePlayer.setState({ queue: emptyQueue(), wantPlaying: false, status: 'idle', position: 0, duration: 0, repeat: 'off', radio: false, muted: false, volume: 0.8, resumeAt: null });
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

  it('a song that can\'t play: tried again twice (a fresh address each time), then says so and skips', async () => {
    vi.useFakeTimers();
    const audio = new FakeAudio();
    audio.play = function play() { this.paused = false; return Promise.resolve(); }; // never really starts
    const toast = vi.fn();
    const post = vi.fn(async () => ({}));
    const engine = startEngine({ audio, toast, get: vi.fn(), post, media: null });
    usePlayer.getState().playTracks([A, B], 0);
    await vi.advanceTimersByTimeAsync(0);
    const srcs = [audio.src];
    audio.emit('error');
    await vi.advanceTimersByTimeAsync(600);
    srcs.push(audio.src);
    audio.emit('error');
    await vi.advanceTimersByTimeAsync(1100);
    srcs.push(audio.src);
    expect(toast).not.toHaveBeenCalled();
    expect(srcs[1]).toContain('fresh=1');
    expect(srcs[2]).toContain('a=2');
    audio.emit('error');
    await vi.advanceTimersByTimeAsync(0);
    expect(toast).toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(expect.stringContaining('/api/stream/forget?id='));
    await vi.advanceTimersByTimeAsync(1600);
    expect(usePlayer.getState().current().title).toBe('B');
    engine.stop();
    vi.useRealTimers();
  });

  it('a song stuck loading for 20 s counts as a failure', async () => {
    vi.useFakeTimers();
    const audio = new FakeAudio();
    audio.play = function play() { this.paused = false; return Promise.resolve(); };
    const engine = startEngine({ audio, toast: vi.fn(), get: vi.fn(), post: vi.fn(async () => ({})), media: null });
    usePlayer.getState().playTracks([A, B], 0);
    await vi.advanceTimersByTimeAsync(0);
    const first = audio.src;
    await vi.advanceTimersByTimeAsync(20_600);
    expect(audio.src).not.toBe(first);
    expect(audio.src).toContain('fresh=1');
    engine.stop();
    vi.useRealTimers();
  });

  it('in a list of more than 50 songs, one that fails 3 times is taken out of the list and the queue', async () => {
    vi.useFakeTimers();
    const audio = new FakeAudio();
    audio.play = function play() { this.paused = false; return Promise.resolve(); };
    const LIST = 'aaaaaaaaaaaaaaaa';
    const songs = Array.from({ length: 60 }, (_, n) => ({ title: `S${n}`, artist: 'X', yt: `vid${String(n).padStart(8, '0')}` }));
    const removeTracks = vi.fn(async () => true);
    const library = { getState: () => ({ lists: [{ id: LIST, count: 60 }], loadList: async () => ({ id: LIST, name: 'Grande', tracks: songs }), removeTracks }) };
    const toast = vi.fn();
    const engine = startEngine({ audio, library, toast, get: vi.fn(), post: vi.fn(async () => ({})), media: null });
    usePlayer.getState().playTracks(songs.map((t, n) => ({ ...t, key: `yt:${t.yt}`, list: LIST, n })), 3);
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 3; i++) { audio.emit('error'); await vi.advanceTimersByTimeAsync(1600); }
    expect(removeTracks).toHaveBeenCalledWith(LIST, [3], expect.objectContaining({ message: expect.stringContaining('no cargó tras 3 intentos') }));
    expect(usePlayer.getState().current().title).toBe('S4');
    expect(usePlayer.getState().queue.items.some((t) => t.title === 'S3')).toBe(false);
    expect(toast).not.toHaveBeenCalled(); // the list's own notice (with "Deshacer") says it
    engine.stop();
    vi.useRealTimers();
  });

  it('looks the next song up ahead once it plays, and starts the kept song at its second', async () => {
    const audio = new FakeAudio();
    const post = vi.fn(async () => ({}));
    usePlayer.getState().restoreSession({ items: [A, B], index: 0, position: 42 }, { play: false });
    const engine = startEngine({ audio, toast: vi.fn(), get: vi.fn(), post, media: null });
    await flush();
    expect(audio.src).toContain('/api/stream/audio');
    expect(usePlayer.getState().wantPlaying).toBe(false);
    audio.emit('loadedmetadata');
    expect(audio.currentTime).toBe(42);
    expect(usePlayer.getState().resumeAt).toBe(null);
    usePlayer.getState().play();
    await flush();
    expect(post).toHaveBeenCalledWith(expect.stringContaining(`/api/stream/prepare?id=${B.yt}`));
    engine.stop();
  });
});

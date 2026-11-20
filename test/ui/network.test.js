// v1.13: the light audio on mobile data, "Ahorro de datos" or a slow connection.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audioQuality } from '../../src/lib/network.js';
import { urls } from '../../src/api.js';
import { usePlayer } from '../../src/store/player.js';
import { emptyQueue } from '../../src/lib/queue.js';
import { startEngine } from '../../src/player/engine.js';

class FakeAudio extends EventTarget {
  constructor() { super(); this.src = ''; this.paused = true; this.currentTime = 0; this.volume = 1; }
  play() { this.paused = false; this.dispatchEvent(new Event('playing')); return Promise.resolve(); }
  pause() { this.paused = true; }
  getAttribute(k) { return k === 'src' ? this.src : null; }
  removeAttribute() { this.src = ''; }
}

beforeEach(() => {
  usePlayer.setState({ queue: emptyQueue(), wantPlaying: false, status: 'idle', radio: false, resumeAt: null });
});

describe('audio quality', () => {
  it('light on mobile data, with data saving, or below 4G; the usual one otherwise (or when the browser doesn\'t say)', () => {
    expect(audioQuality(null)).toBe('normal');
    expect(audioQuality({ type: 'wifi', effectiveType: '4g' })).toBe('normal');
    expect(audioQuality({ type: 'cellular', effectiveType: '4g' })).toBe('lite');
    expect(audioQuality({ effectiveType: '3g' })).toBe('lite');
    expect(audioQuality({ type: 'wifi', effectiveType: '4g', saveData: true })).toBe('lite');
  });

  it('the relay address says so only for the light one', () => {
    expect(urls.audio('aaaaaaaaaaa')).toBe('/api/stream/audio?id=aaaaaaaaaaa');
    expect(urls.audio('aaaaaaaaaaa', 0, 'lite')).toBe('/api/stream/audio?id=aaaaaaaaaaa&q=lite');
    expect(urls.audio('aaaaaaaaaaa', 2, 'lite')).toBe('/api/stream/audio?id=aaaaaaaaaaa&fresh=1&a=2&q=lite');
  });

  it('the engine asks for the quality of the moment each time a song loads', async () => {
    const audio = new FakeAudio();
    let q = 'lite';
    const engine = startEngine({ audio, toast: () => {}, get: vi.fn(), post: vi.fn(async () => ({})), media: null, quality: () => q });
    usePlayer.getState().playTracks([{ key: 'yt:aaaaaaaaaaa', yt: 'aaaaaaaaaaa', title: 'A' }, { key: 'yt:bbbbbbbbbbb', yt: 'bbbbbbbbbbb', title: 'B' }], 0);
    await new Promise((r) => setTimeout(r, 0));
    expect(audio.src).toBe('/api/stream/audio?id=aaaaaaaaaaa&q=lite');
    q = 'normal';
    usePlayer.getState().next();
    await new Promise((r) => setTimeout(r, 0));
    expect(audio.src).toBe('/api/stream/audio?id=bbbbbbbbbbb');
    engine.stop();
  });
});

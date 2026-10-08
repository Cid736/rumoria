// v1.3 on the page: back where you left off, performance profiles, the sound
// settings, better recommendations and "Para hoy", the mini player's lyric line.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanItem, readSession, snapshot, startSession } from '../../src/player/session.js';
import { coverAt, detect, usePerf } from '../../src/store/perf.js';
import { cleanSound, DEFAULT_SOUND, useSound } from '../../src/store/sound.js';
import { needsGraph } from '../../src/player/sound.js';
import { dailyOf, latestSeeds, rank } from '../../src/views/recommend.js';
import { lineAt, miniState } from '../../src/player/miniBridge.js';
import { emptyQueue } from '../../src/lib/queue.js';
import { usePlayer } from '../../src/store/player.js';
import { useLibrary } from '../../src/store/library.js';
import SoundPanel from '../../src/components/SoundPanel.jsx';
import Overlays from '../../src/components/Overlays.jsx';
import { useUi } from '../../src/store/ui.js';

const yt = (id, title, artist = 'A') => ({ key: `yt:${id}`, yt: id, title, artist, duration: 200, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
const A = yt('aaaaaaaaaaa', 'Uno');
const B = yt('bbbbbbbbbbb', 'Dos');

beforeEach(() => {
  localStorage.clear();
  usePlayer.setState({ queue: emptyQueue(), wantPlaying: false, status: 'idle', position: 0, duration: 0, repeat: 'off', radio: false, volume: 0.8, resumeAt: null });
  useSound.setState({ ...DEFAULT_SOUND, sleep: null });
  useUi.setState({ dialog: null, toasts: [] });
});

describe('back where you left off', () => {
  it('keeps the queue, the song and its second; reads back only clean songs', () => {
    usePlayer.getState().playTracks([A, B], 1);
    usePlayer.setState({ position: 73.6, repeat: 'all' });
    const snap = snapshot();
    expect(snap).toMatchObject({ v: 1, index: 1, position: 73, repeat: 'all' });
    expect(snap.items.map((t) => t.title)).toEqual(['Uno', 'Dos']);
    expect(cleanItem({ title: 'x', yt: 'bad id', thumbnail: 'javascript:alert(1)' })).toBe(null);
    expect(cleanItem({ title: 'x', query: 'a - x', thumbnail: 'https://evil.example/a.jpg' })).toEqual({ title: 'x', artist: '', query: 'a - x' });
    expect(readSession({ v: 1, items: [A], index: 5 })).toBe(null);
    expect(readSession({ v: 2 })).toBe(null);
  });

  it('opens paused at the second it was left (or playing, if asked)', () => {
    const storage = new Map();
    const store = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
    storage.set('rumoria_session', JSON.stringify({ v: 1, items: [A, B], index: 1, position: 95, repeat: 'one' }));
    const stop = startSession({ storage: store });
    const p = usePlayer.getState();
    expect(p.current().title).toBe('Dos');
    expect(p.wantPlaying).toBe(false);
    expect(p.repeat).toBe('one');
    expect(p.resumeAt).toEqual({ uid: p.current().uid, t: 95 });
    usePlayer.getState().seek(30);
    stop();
    expect(JSON.parse(storage.get('rumoria_session')).index).toBe(1);
    // Asked to start playing on open.
    useSound.getState().set({ autoplay: true });
    startSession({ storage: store })();
    expect(usePlayer.getState().wantPlaying).toBe(true);
    // Switched off: nothing kept.
    useSound.getState().set({ resume: false });
    usePlayer.getState().playTracks([A], 0);
    startSession({ storage: store })();
    expect(storage.has('rumoria_session')).toBe(false);
  });
});

describe('performance profiles', () => {
  it('Automático from cores and memory; Mínimo uses smaller covers; applied to the page and the server', () => {
    expect(detect({ cores: 2, memGB: 16 })).toBe('min');
    expect(detect({ cores: 8, memGB: 4 })).toBe('min');
    expect(detect({ cores: 4, memGB: 8 })).toBe('mid');
    expect(detect({ cores: 16, memGB: 32 })).toBe('high');
    const sent = [];
    usePerf.setState({ choice: 'min' });
    usePerf.getState().apply(document, (p) => sent.push(p));
    expect(document.documentElement.dataset.perf).toBe('min');
    expect(sent).toEqual(['min']);
    expect(coverAt('https://i.ytimg.com/vi/x/hqdefault.jpg')).toBe('https://i.ytimg.com/vi/x/mqdefault.jpg');
    usePerf.setState({ choice: 'auto', detected: 'high' });
    usePerf.getState().apply(document, () => {});
    expect(usePerf.getState().profile).toBe('high');
    expect(coverAt('https://i.ytimg.com/vi/x/hqdefault.jpg')).toBe('https://i.ytimg.com/vi/x/hqdefault.jpg');
  });
});

describe('sound settings', () => {
  it('only known values; presets, your own, the sleep timer', () => {
    expect(cleanSound({ gains: [99, 0, 0, 0, 0], speed: 7, fade: 3, preset: '__proto__', sinkId: 'x'.repeat(500) })).toEqual(DEFAULT_SOUND);
    const s = useSound.getState();
    s.applyPreset('bass');
    expect(useSound.getState().gains).toEqual([6, 4, 0, -1, -1]);
    s.setBand(2, 30);
    expect(useSound.getState().gains[2]).toBe(12);
    expect(useSound.getState().preset).toBe('custom');
    s.saveMine('Mía');
    expect(useSound.getState().preset).toBe('mine:Mía');
    expect(JSON.parse(localStorage.getItem('rumoria_sound')).mine[0].name).toBe('Mía');
    s.setSleep(30, 1000);
    expect(useSound.getState().sleep).toEqual({ until: 1000 + 30 * 60_000 });
    expect(JSON.parse(localStorage.getItem('rumoria_sound')).sleep).toBeUndefined();
    expect(needsGraph(DEFAULT_SOUND, 'min')).toBe(false);
    expect(needsGraph({ ...DEFAULT_SOUND, visualizer: false })).toBe(false);
    expect(needsGraph({ ...DEFAULT_SOUND, visualizer: false, karaoke: true })).toBe(true);
  });

  it('the Sonido panel: equalizer, speed, sleep timer, saving your own', () => {
    render(<><SoundPanel /><Overlays /></>);
    fireEvent.change(screen.getByLabelText('Ecualización'), { target: { value: 'rock' } });
    expect(useSound.getState().gains).toEqual([4, 2, -1, 2, 4]);
    fireEvent.change(screen.getByLabelText('Velocidad'), { target: { value: '1.25' } });
    expect(useSound.getState().speed).toBe(1.25);
    expect(screen.getByText('Mantener el tono')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Temporizador para parar la música'), { target: { value: 'end' } });
    expect(useSound.getState().sleep).toEqual({ end: true });
    fireEvent.change(screen.getByLabelText(/^60 Hz/), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Coche' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }));
    expect(useSound.getState().mine.map((m) => m.name)).toEqual(['Coche']);
  });
});

describe('recommendations', () => {
  const t = (id, artist) => ({ key: `yt:${id}`, yt: id, title: id, artist });
  it('songs in several of your mixes count more; skipped ones out; artists you skip last; two per artist at most', () => {
    const radios = [
      { weight: 1, tracks: [t('s1', 'X'), t('s2', 'Y'), t('s3', 'Z'), t('s4', 'X'), t('s5', 'X')] },
      { weight: 1, tracks: [t('s3', 'Z'), t('s6', 'Cold'), t('s7', 'W')] },
    ];
    const out = rank(radios, { exclude: new Set(['yt:s2']), cold: ['Cold'] });
    expect(out[0].yt).toBe('s3');
    expect(out.map((x) => x.yt)).not.toContain('s2');
    expect(out.filter((x) => x.artist === 'X')).toHaveLength(2);
    expect(out[out.length - 1].yt).toBe('s6');
  });

  it('"Para hoy": like your latest songs, mostly new, the same until you listen to other things', async () => {
    const smart = { lately: [{ ...yt('aaaaaaaaaaa', 'Uno', 'Ana'), last: 200 }, { ...yt('bbbbbbbbbbb', 'Dos', 'Beto'), last: 100 }], top: [], forgotten: [], artists: [], skipped: [], cold: [] };
    expect(latestSeeds(smart).map((s) => s.title)).toEqual(['Uno', 'Dos']);
    const get = vi.fn(async (url) => {
      const seed = new URL(url, 'http://x').searchParams.get('id');
      return { entries: [{ id: `${seed.slice(0, 9)}n1`, title: 'Nueva', channel: `C${seed[0]}` }, { id: 'bbbbbbbbbbb', title: 'Dos' }] };
    });
    const storage = new Map();
    const store = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
    const now = new Date(2026, 9, 8, 10);
    const list = await dailyOf(smart, { get, storage: store, now });
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((x) => x.yt === 'bbbbbbbbbbb')).toBe(false); // a seed itself is not recommended
    const calls = get.mock.calls.length;
    await dailyOf(smart, { get, storage: store, now: new Date(2026, 9, 8, 11) });
    expect(get.mock.calls.length).toBe(calls);
    await dailyOf({ ...smart, lately: [{ ...yt('ccccccccccc', 'Tres', 'Carla'), last: 300 }, ...smart.lately] }, { get, storage: store, now: new Date(2026, 9, 8, 13) });
    expect(get.mock.calls.length).toBeGreaterThan(calls);
  });
});

describe('mini player v2', () => {
  it('the lyric line being sung, the next song and the video id', () => {
    const synced = [{ t: 0, text: 'Hola' }, { t: 10, text: 'Mundo' }, { t: 20, text: '' }];
    expect(lineAt(synced, 12)).toEqual({ line: 'Mundo', nextLine: '' });
    expect(lineAt(synced, 25)).toEqual({ line: '♪', nextLine: '' });
    expect(lineAt(null, 3)).toEqual({ line: '', nextLine: '' });
    usePlayer.getState().playTracks([A, B], 0);
    usePlayer.setState({ position: 11 });
    const s = miniState(usePlayer.getState(), useLibrary.getState(), { yt: A.yt, synced });
    expect(s).toMatchObject({ yt: A.yt, line: 'Mundo', upNext: 'Dos · A' });
  });
});

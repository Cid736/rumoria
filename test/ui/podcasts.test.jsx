// v1.13, Podcasts: an episode's state, carrying on where you left it, your
// place saved as you listen, −15 / +30, and an episode never feeding the
// listening history or the "similar songs" radio.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { emptyQueue } from '../../src/lib/queue.js';
import { cleanItem } from '../../src/player/session.js';
import { startEngine } from '../../src/player/engine.js';
import { usePlayer } from '../../src/store/player.js';
import { episodeTrack, minutes, startPodcastProgress, stateOf, usePodcasts } from '../../src/store/podcasts.js';
import PodcastsPage from '../../src/views/Podcasts.jsx';
import PlayerBar from '../../src/components/PlayerBar.jsx';
import { cleanSound, nextPodSpeed, speedLabel, useSound } from '../../src/store/sound.js';
import { startSound } from '../../src/player/sound.js';

const SHOW = { id: 'ch:@ondaslentas', name: 'Ondas Lentas', url: 'https://www.youtube.com/@ondaslentas', thumb: null, at: 0 };
const EP = { yt: 'aaaaaaaaaaa', title: 'Cómo suena una ciudad', duration: 2400, thumbnail: null };
const tick = () => new Promise((r) => { setTimeout(r, 0); });

class FakeAudio extends EventTarget {
  constructor() { super(); this.src = ''; this.paused = true; this.currentTime = 0; this.volume = 1; this.duration = NaN; }
  play() { this.paused = false; this.dispatchEvent(new Event('playing')); return Promise.resolve(); }
  pause() { this.paused = true; }
  getAttribute(k) { return k === 'src' ? this.src : null; }
  removeAttribute() { this.src = ''; }
}

const answer = (routes) => { globalThis.fetch = vi.fn(async (url, opts = {}) => { const key = `${opts.method || 'GET'} ${String(url).split('?')[0]}`; const body = routes[key] ? routes[key](opts.body && JSON.parse(opts.body)) : {}; return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }); }); };

beforeEach(() => {
  usePlayer.setState({ queue: emptyQueue(), wantPlaying: false, status: 'idle', radio: true, resumeAt: null, position: 0, duration: 0 });
  usePodcasts.setState({ loaded: false, shows: [], progress: {}, episodes: {}, notes: {} });
  useSound.setState({ speed: 1, podSpeed: 1, sleep: null });
});

describe('an episode', () => {
  it('is new, started (with what is left) or heard', () => {
    expect(stateOf(EP, {}).state).toBe('new');
    expect(stateOf(EP, { [EP.yt]: { t: 600, d: 2400 } })).toMatchObject({ state: 'started', left: 1800, t: 600 });
    expect(stateOf(EP, { [EP.yt]: { t: 2400, d: 2400, done: true } }).state).toBe('done');
    expect(minutes(2400)).toBe('40 min');
    expect(minutes(3900)).toBe('1 h 05 min');
  });

  it('carries on from where you left it, and keeps being an episode after a restart', () => {
    usePodcasts.setState({ progress: { [EP.yt]: { t: 600, d: 2400 } } });
    usePodcasts.getState().play(EP, SHOW);
    const p = usePlayer.getState();
    expect(p.current()).toMatchObject({ yt: EP.yt, artist: 'Ondas Lentas', episode: SHOW.id });
    expect(p.resumeAt).toEqual({ uid: p.current().uid, t: 600 });
    expect(cleanItem(p.current()).episode).toBe(SHOW.id);
    expect(cleanItem({ ...p.current(), episode: '../evil' }).episode).toBeUndefined();
  });

  it('saves your place as you listen and when you pause', async () => {
    const posts = [];
    answer({ 'POST /api/podcasts/progress': (b) => { posts.push(b); return { t: b.t, d: b.d, done: false }; } });
    const stop = startPodcastProgress();
    usePlayer.getState().playTracks([episodeTrack(EP, SHOW)]);
    usePlayer.getState()._time(10, 2400);
    usePlayer.getState()._time(30, 2400);
    usePlayer.getState().pause();
    await tick();
    stop();
    expect(posts.map((b) => b.t)).toEqual([30, 30]);
    expect(posts[0]).toMatchObject({ yt: EP.yt, show: SHOW.id, title: EP.title, d: 2400 });
    expect(usePodcasts.getState().progress[EP.yt].t).toBe(30);
  });

  it('−15 / +30 move inside it', () => {
    usePlayer.getState().playTracks([episodeTrack(EP, SHOW)]);
    usePlayer.setState({ position: 100, duration: 2400 });
    usePlayer.getState().skip(30);
    expect(usePlayer.getState().position).toBe(130);
    usePlayer.getState().skip(-15);
    expect(usePlayer.getState().position).toBe(115);
    usePlayer.getState().skip(-500);
    expect(usePlayer.getState().position).toBe(0);
  });

  it('is not music: no listening history, no similar songs after it', async () => {
    const audio = new FakeAudio();
    const get = vi.fn(async () => ({ entries: [] }));
    const post = vi.fn(async () => ({}));
    const engine = startEngine({ audio, toast: () => {}, get, post, media: null, quality: () => 'normal' });
    usePlayer.getState().playTracks([episodeTrack(EP, SHOW)]);
    await tick();
    audio.currentTime = 2; audio.dispatchEvent(new Event('timeupdate'));
    audio.currentTime = 4; audio.dispatchEvent(new Event('timeupdate'));
    audio.currentTime = 6; audio.dispatchEvent(new Event('timeupdate'));
    audio.dispatchEvent(new Event('ended'));
    await tick();
    expect(post.mock.calls.filter(([u]) => u === '/api/history')).toEqual([]);
    expect(get.mock.calls.filter(([u]) => String(u).startsWith('/api/stream/radio'))).toEqual([]);
    engine.stop();
  });
});

describe('the page and the player bar', () => {
  it('shows what you were listening to, your shows and their newest episodes', async () => {
    answer({
      'GET /api/podcasts': () => ({ shows: [SHOW], progress: { bbbbbbbbbbb: { t: 900, d: 2400, title: 'A medias', show: SHOW.id, at: 1 } } }),
      [`GET /api/podcasts/${encodeURIComponent(SHOW.id)}/episodes`]: () => ({ episodes: [EP, { yt: 'ccccccccccc', title: 'Otro', duration: 1800 }] }),
    });
    render(<PodcastsPage />);
    expect(await screen.findByText('Seguir escuchando')).toBeInTheDocument();
    expect(screen.getByText('Quedan 25 min')).toBeInTheDocument();
    expect(await screen.findByText('Cómo suena una ciudad')).toBeInTheDocument();
    expect(screen.getAllByText('Ondas Lentas').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Reproducir: Cómo suena una ciudad' }));
    expect(usePlayer.getState().current()).toMatchObject({ yt: EP.yt, episode: SHOW.id });
  });

  it('an episode gets −15 / +30 instead of shuffle and repeat, and no star', () => {
    usePlayer.getState().playTracks([episodeTrack(EP, SHOW)]);
    render(<PlayerBar />);
    expect(screen.getByRole('button', { name: 'Atrás 15 segundos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adelante 30 segundos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aleatorio' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Añadir a Favoritas' })).toBeNull();
  });
});

describe('the episode\'s own buttons (v1.13 design)', () => {
  it('the player bar: its speed (1× → 1,25× …) and the sleep timer', () => {
    usePlayer.getState().playTracks([episodeTrack(EP, SHOW)]);
    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Velocidad: 1×. Cambiarla' }));
    expect(useSound.getState().podSpeed).toBe(1.25);
    expect(screen.getByRole('button', { name: 'Velocidad: 1,25×. Cambiarla' })).toBeInTheDocument();
    expect(useSound.getState().speed).toBe(1);
    expect(screen.getByRole('button', { name: 'Temporizador' })).toBeInTheDocument();
  });

  it('a song has neither (shuffle and repeat instead)', () => {
    usePlayer.getState().playTracks([{ yt: 'dQw4w9WgXcQ', key: 'yt:dQw4w9WgXcQ', title: 'Una canción', artist: 'Alguien' }]);
    render(<PlayerBar />);
    expect(screen.queryByRole('button', { name: /^Velocidad/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Aleatorio' })).toBeInTheDocument();
  });

  it('speeds: a cycle, only known values kept, and "1,5×"', () => {
    expect([1, 1.25, 1.5, 1.75, 2, 0.75].map(nextPodSpeed)).toEqual([1.25, 1.5, 1.75, 2, 0.75, 1]);
    expect(nextPodSpeed(3)).toBe(1);
    expect(cleanSound({ podSpeed: 1.5 }).podSpeed).toBe(1.5);
    expect(cleanSound({ podSpeed: 16 }).podSpeed).toBe(1);
    expect(speedLabel(1.5)).toBe('1,5×');
  });

  it('an episode plays at its speed, a song at Sonido\'s', () => {
    useSound.getState().set({ speed: 1, podSpeed: 1.5 });
    const audio = new FakeAudio();
    const ctl = startSound({ audio, AudioCtx: null });
    usePlayer.getState().playTracks([{ yt: 'dQw4w9WgXcQ', key: 'yt:dQw4w9WgXcQ', title: 'Una canción', artist: 'Alguien' }]);
    expect(audio.playbackRate).toBe(1);
    usePlayer.getState().playTracks([episodeTrack(EP, SHOW)]);
    expect(audio.playbackRate).toBe(1.5);
    ctl.stop();
  });

  it('Notas: asked for once per episode, when the panel opens', async () => {
    const calls = [];
    answer({ [`GET /api/podcasts/notes/${EP.yt}`]: () => { calls.push(1); return { notes: 'Hoy hablamos del ruido.' }; } });
    await usePodcasts.getState().loadNotes(EP.yt);
    await usePodcasts.getState().loadNotes(EP.yt);
    expect(usePodcasts.getState().notes[EP.yt]).toEqual({ text: 'Hoy hablamos del ruido.', loading: false });
    expect(calls).toHaveLength(1);
  });
});

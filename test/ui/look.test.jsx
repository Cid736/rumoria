// Your look (colour, size, density, shelves) and the mini player's bridge.
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLook, cleanLook, DEFAULT_LOOK, useLook } from '../../src/store/look.js';
import { Customize } from '../../src/views/Customize.jsx';
import Home from '../../src/views/Home.jsx';
import { miniState, runMiniCommand, startMiniBridge } from '../../src/player/miniBridge.js';
import { emptyQueue } from '../../src/lib/queue.js';
import { useLibrary } from '../../src/store/library.js';
import { usePlayer } from '../../src/store/player.js';
import { useUi } from '../../src/store/ui.js';

const A = { key: 'yt:aaaaaaaaaaa', yt: 'aaaaaaaaaaa', title: 'Primera', artist: 'Grupo', duration: 125, thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg' };
const B = { key: 'yt:bbbbbbbbbbb', yt: 'bbbbbbbbbbb', title: 'Segunda', artist: 'Otro', duration: 61 };

beforeEach(() => {
  localStorage.clear();
  useLook.setState({ look: { ...DEFAULT_LOOK } });
  applyLook(DEFAULT_LOOK, document, () => {});
  usePlayer.setState({ queue: emptyQueue(), wantPlaying: false, status: 'idle', position: 0, duration: 0, repeat: 'off', radio: false, volume: 0.8 });
  useLibrary.setState({ lists: [], likes: [], likedKeys: new Set(), local: { folder: false, songs: [] }, smart: null, news: [], browse: [], loaded: true });
  useUi.setState({ history: [{ name: 'home' }], at: 0, recent: [], toasts: [] });
});

describe('your look', () => {
  it('only known values survive (from storage too)', () => {
    expect(cleanLook({ accent: 'url(javascript:x)', size: 9, density: 'x', corners: 'round', motion: 'reduce', hidden: ['made', '__proto__', 'made'] }))
      .toEqual({ ...DEFAULT_LOOK, corners: 'round', motion: 'reduce', hidden: ['made'] });
    expect(cleanLook(null)).toEqual(DEFAULT_LOOK);
  });

  it('applies at once: attributes the stylesheets read, the zoom, and it is remembered', () => {
    const zoom = vi.fn();
    applyLook({ ...DEFAULT_LOOK, accent: 'azul', size: 1.25, density: 'compact', sideCovers: false }, document, zoom);
    const d = document.documentElement.dataset;
    expect([d.accent, d.density, d.sideCovers]).toEqual(['azul', 'compact', 'off']);
    expect(zoom).toHaveBeenCalledWith(1.25);
    applyLook(DEFAULT_LOOK, document, () => {});
    expect(document.documentElement.dataset.accent).toBeUndefined();
  });

  it('Personalizar: colour, text size and the shelves of Inicio', () => {
    render(<Customize />);
    fireEvent.click(screen.getByRole('radio', { name: 'Verde' }));
    expect(useLook.getState().look.accent).toBe('verde');
    expect(document.documentElement.dataset.accent).toBe('verde');
    expect(JSON.parse(localStorage.getItem('rumoria_look')).accent).toBe('verde');
    fireEvent.change(screen.getByLabelText(/Tamaño del texto/), { target: { value: '1.1' } });
    expect(useLook.getState().look.size).toBe(1.1);
    fireEvent.click(screen.getByRole('button', { name: 'Todas las categorías' }));
    expect(useLook.getState().look.hidden).toEqual(['categories']);
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer' }));
    expect(useLook.getState().look).toEqual(DEFAULT_LOOK);
  });

  it('Inicio hides the shelves you turned off', () => {
    useLibrary.setState({ browse: [{ id: 'rock', name: 'Rock de siempre', sub: 'x', group: 'genre', featured: true, thumbs: [] }] });
    const { unmount } = render(<Home />);
    expect(screen.getByRole('heading', { name: 'Todas las categorías' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Explorar' })).toBeInTheDocument();
    unmount();
    useLook.getState().set({ hidden: ['categories', 'explore'] });
    render(<Home />);
    expect(screen.queryByRole('heading', { name: 'Todas las categorías' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Explorar' })).toBeNull();
  });
});

describe('mini player bridge', () => {
  it('says what plays, and its buttons drive the same player', () => {
    usePlayer.getState().playTracks([A, B], 0);
    usePlayer.setState({ position: 30, duration: 125 });
    const s = miniState();
    expect(s).toMatchObject({ title: 'Primera', artist: 'Grupo', cover: A.thumbnail, playing: true, time: 30, duration: 125, canLike: true, liked: false, hasNext: true });
    runMiniCommand({ cmd: 'toggle' });
    expect(usePlayer.getState().wantPlaying).toBe(false);
    runMiniCommand({ cmd: 'next' });
    expect(usePlayer.getState().current().title).toBe('Segunda');
    runMiniCommand({ cmd: 'seek', value: 10 });
    expect(usePlayer.getState().seekTo.t).toBe(10);
    const setLike = vi.fn();
    useLibrary.setState({ setLike });
    runMiniCommand({ cmd: 'like' });
    expect(setLike).toHaveBeenCalledWith(expect.objectContaining({ title: 'Segunda' }), true);
    runMiniCommand({ cmd: 'nonsense' });
    runMiniCommand(null);
  });

  it('sends the state when it changes, not more', async () => {
    vi.useFakeTimers();
    const sent = [];
    let onCmd = null;
    const stop = startMiniBridge({ state: (s) => sent.push(s), onCommand: (cb) => { onCmd = cb; return () => {}; } });
    expect(sent).toHaveLength(1);
    usePlayer.getState().playTracks([A], 0);
    usePlayer.setState({ position: 1.2 });
    usePlayer.setState({ position: 1.4 });
    vi.advanceTimersByTime(300);
    expect(sent).toHaveLength(2);
    expect(sent[1].title).toBe('Primera');
    usePlayer.setState({ position: 1.9 }); // same second: nothing new
    vi.advanceTimersByTime(300);
    expect(sent).toHaveLength(2);
    onCmd({ cmd: 'toggle' });
    expect(usePlayer.getState().wantPlaying).toBe(false);
    stop();
    vi.useRealTimers();
  });
});

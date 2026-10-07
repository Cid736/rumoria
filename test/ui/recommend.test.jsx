// Recommendations and "Explorar" on the home page.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverOf, heardKeys, seedsOf, weekOf } from '../../src/views/recommend.js';
import Home from '../../src/views/Home.jsx';
import { useLibrary } from '../../src/store/library.js';
import { useUi } from '../../src/store/ui.js';

const row = (id, title, artist) => ({ key: `yt:${id}`, yt: id, title, artist, thumb: null });
const smart = {
  top: [row('aaaaaaaaaaa', 'Uno', 'Ana'), row('bbbbbbbbbbb', 'Dos', 'Ana'), row('ccccccccccc', 'Tres', 'Beto')],
  lately: [row('ddddddddddd', 'Cuatro', 'Carla')],
  forgotten: [], artists: [{ name: 'Ana', songs: [row('eeeeeeeeeee', 'Cinco', 'Ana')] }],
};

/** A pretend radio: three songs per seed, one of them already heard. */
const radio = vi.fn(async (url) => {
  const seed = new URL(url, 'http://x').searchParams.get('id');
  return { entries: [{ id: `${seed.slice(0, 9)}r1`, title: 'Nueva 1' }, { id: 'eeeeeeeeeee', title: 'Cinco (ya oída)' }, { id: `${seed.slice(0, 9)}r2`, title: 'Nueva 2' }] };
});

beforeEach(() => { radio.mockClear(); });

describe('recommendations', () => {
  it('seeds: what you play most first, one per artist, YouTube songs only', () => {
    expect(seedsOf(smart).map((s) => s.title)).toEqual(['Uno', 'Tres', 'Cuatro']);
    expect(seedsOf(null)).toEqual([]);
    expect(heardKeys(smart).has('yt:eeeeeeeeeee')).toBe(true);
  });

  it('"Descubre algo nuevo": only songs you have not heard, taken in turns, the same all week', async () => {
    const storage = new Map();
    const store = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
    const monday = new Date(2026, 9, 5);
    const list = await discoverOf(smart, { get: radio, storage: store, now: monday });
    expect(list.map((t) => t.title)).toEqual(['Nueva 1', 'Nueva 1', 'Nueva 1', 'Nueva 2', 'Nueva 2', 'Nueva 2']);
    expect(list.some((t) => t.yt === 'eeeeeeeeeee')).toBe(false);
    const calls = radio.mock.calls.length;
    await discoverOf(smart, { get: radio, storage: store, now: new Date(2026, 9, 9) });
    expect(radio.mock.calls.length).toBe(calls);
    await discoverOf(smart, { get: radio, storage: store, now: new Date(2026, 9, 12) });
    expect(radio.mock.calls.length).toBeGreaterThan(calls);
    expect(weekOf(new Date(2026, 9, 11))).toBe(weekOf(monday));
  });
});

const BROWSE = [
  { id: 'exitos', name: 'Éxitos del momento', sub: 'Lo que más suena ahora', group: 'genre', featured: true, thumbs: [] },
  { id: 'jazz', name: 'Jazz', sub: 'Clásicos y nuevos', group: 'genre', featured: false, thumbs: [] },
  { id: 'radio-coldplay', name: 'Radio de Coldplay', sub: 'Coldplay y artistas parecidos', group: 'radio', featured: true, thumbs: [] },
];
const base = { lists: [], likes: [], news: [], local: { folder: false, songs: [] }, loaded: true, browse: BROWSE };

describe('home', () => {
  beforeEach(() => { useUi.setState({ recent: [] }); });

  it('without any list or history: ready-made lists, popular radios and every category, to play straight away', () => {
    useLibrary.setState({ ...base, smart: null });
    render(<Home />);
    expect(screen.getByRole('heading', { name: 'Explorar' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Radios populares' })).toBeInTheDocument();
    expect(screen.getByText('Radio de Coldplay')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Todas las categorías' })).toBeInTheDocument();
    expect(screen.getAllByText('Éxitos del momento')).toHaveLength(2); // shelf and grid
    expect(screen.getAllByText('Jazz')).toHaveLength(1); // not featured: only in the grid
    expect(screen.queryByText('Descubre algo nuevo')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Recientes' })).toBeNull();
  });

  it('with history: made for you (weekly, a mix per favourite artist) and radios for you', () => {
    const artists = [{ name: 'Ana', plays: 9, seed: row('aaaaaaaaaaa', 'Uno', 'Ana'), songs: [] }, { name: 'Beto', plays: 3, seed: row('ccccccccccc', 'Tres', 'Beto'), songs: [] }];
    useLibrary.setState({ ...base, smart: { ...smart, artists, count: 4 } });
    render(<Home />);
    expect(screen.getByText('Descubre algo nuevo')).toBeInTheDocument();
    expect(screen.getByText('Mezcla del día 1')).toBeInTheDocument();
    expect(screen.getByText('Mezcla del día 2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Radios para ti' })).toBeInTheDocument();
    expect(screen.getByText('Radio de Carla')).toBeInTheDocument();
  });

  it('recent things, and what you keep coming back to (played twice or more)', () => {
    useLibrary.setState({ ...base, smart: null });
    const ui = useUi.getState();
    ui.addRecent({ kind: 'browse', id: 'exitos', name: 'Éxitos del momento', sub: 'Explorar' });
    ui.addRecent({ kind: 'radio', id: 'aaaaaaaaaaa', name: 'Radio de Ana', sub: 'Ana y parecidos', payload: { title: 'Uno', artist: 'Ana' } });
    ui.addRecent({ kind: 'browse', id: 'exitos', name: 'Éxitos del momento', sub: 'Explorar' });
    ui.addRecent({ kind: 'evil', id: 'x', name: 'x' });
    expect(useUi.getState().recent.map((r) => [r.id, r.plays])).toEqual([['exitos', 2], ['aaaaaaaaaaa', 1]]);
    render(<Home />);
    expect(screen.getByRole('heading', { name: 'Recientes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lo que más vuelves a poner' })).toBeInTheDocument();
    expect(screen.getAllByText('Radio de Ana').length).toBeGreaterThan(0);
  });
});

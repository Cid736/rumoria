// The parts of the page, rendered: player bar, song table, sidebar, keys, API client.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/api.js';
import { onKey } from '../../src/App.jsx';
import PlayerBar from '../../src/components/PlayerBar.jsx';
import Sidebar from '../../src/components/Sidebar.jsx';
import TrackTable from '../../src/components/TrackTable.jsx';
import Overlays from '../../src/components/Overlays.jsx';
import { emptyQueue } from '../../src/lib/queue.js';
import { useLibrary } from '../../src/store/library.js';
import { usePlayer } from '../../src/store/player.js';
import { useUi } from '../../src/store/ui.js';

const A = { key: 'yt:aaaaaaaaaaa', yt: 'aaaaaaaaaaa', title: 'Primera', artist: 'Grupo', duration: 125 };
const B = { key: 'yt:bbbbbbbbbbb', yt: 'bbbbbbbbbbb', title: 'Segunda', artist: 'Otro', duration: 61 };

beforeEach(() => {
  usePlayer.setState({ queue: emptyQueue(), wantPlaying: false, status: 'idle', position: 0, duration: 0, repeat: 'off', muted: false, volume: 0.8 });
  useLibrary.setState({ lists: [], likes: [], likedKeys: new Set(), local: { folder: false, songs: [] }, smart: null, news: [] });
  useUi.setState({ history: [{ name: 'home' }], at: 0, menu: null, dialog: null, toasts: [] });
});

describe('PlayerBar', () => {
  it('idle: nothing to play, controls off', () => {
    render(<PlayerBar />);
    expect(screen.getByText('Elige algo que escuchar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reproducir' })).toBeDisabled();
  });

  it('shows the song and drives the player', () => {
    usePlayer.getState().playTracks([A, B], 0);
    render(<PlayerBar />);
    expect(screen.getByText('Primera')).toBeInTheDocument();
    expect(screen.getByText('Grupo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pausa' }));
    expect(usePlayer.getState().wantPlaying).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('Segunda')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Repetir/ }));
    expect(usePlayer.getState().repeat).toBe('all');
    const pos = screen.getByRole('slider', { name: 'Posición' });
    expect(pos).toHaveAttribute('aria-valuemax', '61');
  });

  it('the heart saves to Favoritas (and the server is asked, with the anti-CSRF header)', async () => {
    usePlayer.getState().playTracks([A], 0);
    render(<PlayerBar />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Añadir a Favoritas' })); });
    expect(useLibrary.getState().likedKeys.has(A.key)).toBe(true);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/likes');
    expect(init.headers['X-Escuchar']).toBe('1');
    expect(JSON.parse(init.body).song).toEqual({ key: A.key, title: 'Primera', artist: 'Grupo', dur: 125 });
  });

  it('if the server refuses, the heart goes back', async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'No' }), { status: 400 }));
    usePlayer.getState().playTracks([A], 0);
    render(<PlayerBar />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Añadir a Favoritas' })); });
    expect(useLibrary.getState().likedKeys.has(A.key)).toBe(false);
  });
});

describe('TrackTable', () => {
  it('double click plays from that song; the playing one is marked', () => {
    render(<TrackTable tracks={[A, B]} />);
    const rows = screen.getAllByRole('row').slice(1);
    fireEvent.doubleClick(rows[1]);
    expect(usePlayer.getState().current().title).toBe('Segunda');
    expect(screen.getAllByRole('row')[2]).toHaveClass('now');
    expect(screen.getByText('1:01')).toBeInTheDocument();
  });

  it('Ctrl / Shift click select several; right click offers them together', () => {
    render(<><TrackTable tracks={[A, B, { ...A, key: 'yt:ccccccccccc', yt: 'ccccccccccc', title: 'Tercera' }]} listId="abcdefabcdefabcd" /><Overlays /></>);
    const rows = screen.getAllByRole('row').slice(1);
    fireEvent.click(rows[0]);
    fireEvent.click(rows[2], { shiftKey: true });
    expect(rows.filter((r) => r.getAttribute('aria-selected') === 'true')).toHaveLength(3);
    fireEvent.contextMenu(rows[1], { clientX: 10, clientY: 10 });
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Quitar 3 canciones de esta lista')).toBeInTheDocument();
    fireEvent.click(within(menu).getByText('Añadir a la cola'));
    expect(usePlayer.getState().queue.items).toHaveLength(3);
  });

  it('titles are text, never HTML', () => {
    const evil = { ...A, title: '<img src=x onerror="window.__pwned=1">', artist: '<script>window.__pwned=1</script>' };
    const { container } = render(<TrackTable tracks={[evil]} />);
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(evil.title)).toBeInTheDocument();
    expect(window.__pwned).toBeUndefined();
  });
});

describe('Sidebar', () => {
  it('lists your lists by folder, and opens one', () => {
    useLibrary.setState({ lists: [
      { id: 'a'.repeat(16), name: 'Correr', source: 'own', count: 3, thumbs: [], folder: 'Deporte' },
      { id: 'b'.repeat(16), name: 'Top 50', source: 'spotify', url: 'https://open.spotify.com/playlist/x', count: 50, thumbs: [] },
    ] });
    render(<Sidebar />);
    expect(screen.getByText('Deporte')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Top 50'));
    expect(useUi.getState().view()).toEqual({ name: 'list', id: 'b'.repeat(16) });
    fireEvent.click(screen.getByRole('radio', { name: 'Tuyas' }));
    expect(screen.queryByText('Top 50')).toBeNull();
    expect(screen.getByText('Correr')).toBeInTheDocument();
  });

  it('back and forward through what you opened', () => {
    const ui = useUi.getState();
    ui.go({ name: 'search' });
    ui.go({ name: 'liked' });
    ui.back();
    expect(useUi.getState().view().name).toBe('search');
    ui.forward();
    expect(useUi.getState().view().name).toBe('liked');
  });
});

describe('Summary', () => {
  it('opens on this year, shows the song of the year, the numbers and minutes per month (also as a table)', async () => {
    const year = new Date().getFullYear();
    const months = Array(12).fill(0);
    months[2] = 600;
    const s = {
      year, years: [year - 1, year], secs: 3600, plays: 12, songs: 3, artists: 2, days: 4, months, hours: Array.from({ length: 24 }, (_, h) => (h === 21 ? 9 : 0)),
      topSongs: [{ key: 'yt:aaaaaaaaaaa', yt: 'aaaaaaaaaaa', title: '<b>Primera</b>', artist: 'Grupo', plays: 7, secs: 1400 }],
      topArtists: [{ name: 'Grupo', plays: 7, secs: 1400 }],
    };
    fetch.mockImplementation(async (url) => new Response(JSON.stringify(url.includes('year=') ? s : { ...s, year: null }), { status: 200 }));
    const { default: Summary } = await import('../../src/views/Summary.jsx');
    render(<Summary />);
    expect(await screen.findByText(`Tu canción de ${year}`)).toBeInTheDocument();
    expect(fetch.mock.calls.at(-1)[0]).toContain(`year=${year}`);
    expect(screen.getAllByText('<b>Primera</b>').length).toBeGreaterThan(0);
    expect(screen.getByText('60')).toBeInTheDocument(); // minutes
    expect(screen.getByText('tu hora: 21:00–22:00')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: `Minutos escuchados por mes en ${year}` })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('10'); // March: 600 s = 10 min
    fireEvent.click(screen.getByRole('button', { name: /Reproducir tu top/ }));
    expect(usePlayer.getState().current().yt).toBe('aaaaaaaaaaa');
  });
});

describe('keyboard', () => {
  it('Space plays / pauses, Ctrl+→ next, Ctrl+S shuffle; not while typing', () => {
    usePlayer.getState().playTracks([A, B], 0);
    const key = (k, extra = {}, target = document.body) => onKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, preventDefault: vi.fn(), target, ...extra });
    key(' ');
    expect(usePlayer.getState().wantPlaying).toBe(false);
    key('ArrowRight', { ctrlKey: true });
    expect(usePlayer.getState().current().title).toBe('Segunda');
    key('s', { ctrlKey: true });
    expect(usePlayer.getState().shuffle()).toBe(true);
    const input = document.createElement('input');
    document.body.append(input);
    key(' ', {}, input);
    expect(usePlayer.getState().wantPlaying).toBe(true);
    input.remove();
  });
});

describe('api client', () => {
  it('reads send no extra headers; changes send X-Escuchar and JSON; errors carry the server\'s message', async () => {
    await api.get('/api/lists');
    expect(fetch.mock.calls[0][1].headers['X-Escuchar']).toBeUndefined();
    expect(fetch.mock.calls[0][1].credentials).toBe('same-origin');
    await api.patch('/api/lists/x', { name: 'y' });
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: '{"name":"y"}', headers: { 'X-Escuchar': '1', 'Content-Type': 'application/json' } });
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Vídeo no válido.' }), { status: 400 }));
    await expect(api.get('/api/stream/info?id=x')).rejects.toThrow('Vídeo no válido.');
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.get('/api/lists')).rejects.toThrow('Sin conexión');
  });
});

// The phone (Android app): the tabs, the small and big player, the back
// button, what the notification is told and its buttons, and Ajustes without
// what's only for a computer. The Android channel is faked on window.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const song = { uid: 'u1', yt: 'dQw4w9WgXcQ', key: 'yt:dQw4w9WgXcQ', title: 'Never Gonna Give You Up', artist: 'Rick Astley', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', duration: 213 };

let bridge;
async function load() {
  vi.resetModules();
  bridge = { sent: [], postMessage(m) { this.sent.push(JSON.parse(m)); }, onmessage: null };
  window.RumoriaAndroid = bridge;
  const android = await import('../../src/lib/android.js');
  const { usePlayer } = await import('../../src/store/player.js');
  const { useUi } = await import('../../src/store/ui.js');
  const phone = await import('../../src/components/Phone.jsx');
  useUi.setState({ history: [{ name: 'home' }], at: 0, panel: null, nowPlaying: false, menu: null, dialog: null, toasts: [] });
  usePlayer.setState({ queue: { items: [], index: -1, original: null }, wantPlaying: false, position: 0, duration: 0 });
  return { android, usePlayer, useUi, phone };
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { delete window.RumoriaAndroid; });

describe('the phone layout', () => {
  it('knows it is a phone only inside the Android app', async () => {
    const { android } = await load();
    expect(android.isPhone).toBe(true);
    expect(android.HERE).toBe('este móvil');
    delete window.RumoriaAndroid;
    vi.resetModules();
    const plain = await import('../../src/lib/android.js');
    expect(plain.isPhone).toBe(false);
    expect(plain.HERE).toBe('este ordenador');
  });

  it('tabs: four, the current one marked; a tab starts over (nothing to go back to)', async () => {
    const { useUi, phone } = await load();
    render(<phone.TabBar />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Inicio', 'Buscar', 'Biblioteca', 'Ajustes']);
    act(() => useUi.getState().go({ name: 'list', id: 'x' }));
    expect(screen.getByRole('button', { name: 'Biblioteca' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
    expect(useUi.getState().history).toEqual([{ name: 'settings' }]);
    expect(useUi.getState().at).toBe(0);
  });

  it('the small player: nothing without a song; tap opens the big one; its buttons do not', async () => {
    const { usePlayer, useUi, phone } = await load();
    const { container } = render(<><phone.MiniBar /><phone.PhonePlayer /></>);
    expect(container.querySelector('.minibar')).toBe(null);
    act(() => usePlayer.setState({ queue: { items: [song], index: 0, original: null }, wantPlaying: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Pausa' }));
    expect(usePlayer.getState().wantPlaying).toBe(false);
    expect(useUi.getState().nowPlaying).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Abrir el reproductor/ }));
    expect(useUi.getState().nowPlaying).toBe(true);
    expect(screen.getByRole('region', { name: 'Reproductor' })).toHaveTextContent('Rick Astley');
    fireEvent.click(screen.getByRole('button', { name: /Cola/ }));
    expect(useUi.getState().panel).toBe('queue');
  });

  it('back: closes what is open, then the page before, then Inicio, then out', async () => {
    const { usePlayer, useUi } = await load();
    const { startAndroid } = await import('../../src/lib/android.js');
    const stop = startAndroid();
    const back = () => bridge.onmessage({ data: JSON.stringify({ t: 'back' }) });
    act(() => usePlayer.setState({ queue: { items: [song], index: 0, original: null } }));
    useUi.setState({ history: [{ name: 'search' }, { name: 'list', id: 'a' }], at: 1, nowPlaying: true, panel: 'lyrics' });
    back(); expect(useUi.getState().panel).toBe(null);
    back(); expect(useUi.getState().nowPlaying).toBe(false);
    back(); expect(useUi.getState().view().name).toBe('search');
    back(); expect(useUi.getState().view().name).toBe('home');
    bridge.sent = [];
    back(); expect(bridge.sent).toEqual([{ t: 'exit' }]);
    stop();
  });

  it('the notification: told what plays (not every second), and its buttons drive the player', async () => {
    const { usePlayer } = await load();
    const { startAndroid } = await import('../../src/lib/android.js');
    const stop = startAndroid();
    expect(bridge.sent.some((m) => m.t === 'theme')).toBe(true);
    bridge.sent = [];
    act(() => usePlayer.setState({ queue: { items: [song], index: 0, original: null }, wantPlaying: true, duration: 213 }));
    const state = bridge.sent.filter((m) => m.t === 'state').pop();
    expect(state).toMatchObject({ title: song.title, artist: 'Rick Astley', art: song.thumbnail, playing: true, dur: 213 });
    const n = bridge.sent.length;
    act(() => usePlayer.setState({ position: 1 }));
    act(() => usePlayer.setState({ position: 2 }));
    expect(bridge.sent.length).toBe(n);
    act(() => usePlayer.setState({ position: 90 }));
    expect(bridge.sent.length).toBe(n + 1);
    const cmd = (a, pos) => bridge.onmessage({ data: JSON.stringify({ t: 'cmd', a, pos }) });
    cmd('pause'); expect(usePlayer.getState().wantPlaying).toBe(false);
    cmd('pause'); expect(usePlayer.getState().wantPlaying).toBe(false);
    cmd('play'); expect(usePlayer.getState().wantPlaying).toBe(true);
    const seek = vi.spyOn(usePlayer.getState(), 'seek');
    cmd('seek', 42);
    expect(seek).toHaveBeenCalledWith(42);
    bridge.onmessage({ data: 'not json' });
    stop();
  });

  it('song rows: one tap plays on the phone (a computer selects, and plays on a double click)', async () => {
    const { usePlayer } = await load();
    const { default: TrackTable } = await import('../../src/components/TrackTable.jsx');
    const other = { ...song, uid: 'u2', yt: 'kJQP7kiw5Fk', key: 'yt:kJQP7kiw5Fk', title: 'Despacito' };
    render(<TrackTable tracks={[song, other]} />);
    fireEvent.click(screen.getByText('Despacito'));
    expect(usePlayer.getState().queue.items[usePlayer.getState().queue.index].title).toBe('Despacito');
    expect(usePlayer.getState().wantPlaying).toBe(true);
  });

  it('Ajustes on the phone: no mini player, keys or music folder; its own updates', async () => {
    await load();
    const { default: Settings } = await import('../../src/views/Settings.jsx');
    render(<Settings />);
    const topics = screen.getAllByRole('button').map((b) => b.textContent);
    expect(topics.some((t) => t.startsWith('Mini reproductor'))).toBe(false);
    expect(topics.some((t) => t.startsWith('Atajos'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Sistema/ }));
    expect(screen.getByRole('heading', { name: 'Actualizaciones' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Buscar ahora' })[0]);
    expect(bridge.sent).toContainEqual({ t: 'update' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Buscar ahora' })[1]);
    expect(bridge.sent).toContainEqual({ t: 'ytdlp' });
  });
});

describe('Android Auto and the Assistant', () => {
  const song2 = { ...song, uid: 'u2', yt: 'kJQP7kiw5Fk', key: 'yt:kJQP7kiw5Fk', title: 'Despacito', artist: 'Luis Fonsi' };
  it('a list or Favoritas from a song; a search plays what it finds; nothing said: Favoritas', async () => {
    const { usePlayer } = await load();
    const { playFromCar } = await import('../../src/lib/android.js');
    const { useLibrary } = await import('../../src/store/library.js');
    useLibrary.setState({ likes: [{ key: song.key, title: song.title, artist: song.artist, yt: song.yt, at: 2 }, { key: song2.key, title: song2.title, artist: song2.artist, yt: song2.yt, at: 1 }], local: { songs: [] } });
    await playFromCar({ a: 'playFrom', kind: 'liked', index: 1 });
    const cur = () => usePlayer.getState().queue.items[usePlayer.getState().queue.index];
    expect(cur().title).toBe('Despacito');
    expect(usePlayer.getState().wantPlaying).toBe(true);
    useLibrary.setState({ open: {} });
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'aaaaaaaaaaaaaaaa', name: 'L', tracks: [{ title: 'Uno', artist: 'A', yt: 'dQw4w9WgXcQ' }, { title: 'Dos', artist: 'B', yt: 'kJQP7kiw5Fk' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await playFromCar({ a: 'playFrom', kind: 'list', id: 'aaaaaaaaaaaaaaaa', index: 1 });
    expect(cur().title).toBe('Dos');
    await playFromCar({ a: 'playSearch', q: 'bohemian rhapsody' }, { search: async (q) => ({ results: [{ id: 'fJ9rUzIMcZQ', title: `Queen - ${q}`, channel: 'Queen Official' }] }) });
    expect(cur().title).toBe('Queen - bohemian rhapsody');
    usePlayer.setState({ queue: { items: [], index: -1, original: null }, wantPlaying: false });
    await playFromCar({ a: 'playSearch', q: '' });
    expect(cur().title).toBe(song.title);
  });
});

describe('a new version, quietly', () => {
  it('a dot on Ajustes, «Instalar» in Ajustes → Sistema, and a short notice only once per version', async () => {
    const { useUi, phone } = await load();
    const { updateReady } = await import('../../src/lib/android.js');
    useUi.setState({ toasts: [], appUpdate: null });
    localStorage.clear();
    render(<phone.TabBar />);
    expect(screen.queryByLabelText(/está lista/)).toBe(null);
    act(() => updateReady('1.11.0'));
    expect(screen.getByLabelText('Rumoria 1.11.0 está lista')).toBeInTheDocument();
    expect(useUi.getState().toasts).toHaveLength(1);
    act(() => updateReady('1.11.0'));
    expect(useUi.getState().toasts).toHaveLength(1);
    act(() => updateReady('nada'));
    expect(useUi.getState().appUpdate).toEqual({ version: '1.11.0' });
    const { default: Settings } = await import('../../src/views/Settings.jsx');
    render(<Settings />);
    fireEvent.click(screen.getByRole('button', { name: /Sistema/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Instalar' }));
    expect(bridge.sent).toContainEqual({ t: 'install' });
  });
});

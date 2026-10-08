// v1.5 on the page: dropped links, sorting a list, Historial by day, global
// shortcut keys, «No me recomiendes», the full-screen "Sonando", and what the
// mini player and the tray get.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { carriesLink, classifyLink, linkOf } from '../../src/lib/links.js';
import { readSort, saveSort, sortTracks } from '../../src/lib/sorting.js';
import { byDay, dayLabel } from '../../src/views/History.jsx';
import { accelOf, showAccel } from '../../src/views/MoreSettings.jsx';
import { artistKey, artistsOf, mainArtistOf, notHidden, useHidden } from '../../src/store/hidden.js';
import { seedsOf } from '../../src/views/recommend.js';
import { miniState, runMiniCommand } from '../../src/player/miniBridge.js';
import { trackMenu } from '../../src/components/trackMenu.js';
import { emptyQueue } from '../../src/lib/queue.js';
import { usePlayer } from '../../src/store/player.js';
import { useLibrary } from '../../src/store/library.js';
import { useUi } from '../../src/store/ui.js';
import Collection from '../../src/views/Collection.jsx';
import NowPlaying from '../../src/components/NowPlaying.jsx';

const yt = (id, title, artist = 'A', extra = {}) => ({ key: `yt:${id}`, yt: id, title, artist, duration: 200, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, ...extra });

beforeEach(() => {
  localStorage.clear();
  usePlayer.setState({ queue: emptyQueue(), wantPlaying: false, status: 'idle', position: 0, duration: 0, repeat: 'off', radio: false, volume: 0.5, muted: false });
  useHidden.setState({ songs: [], artists: [], songKeys: new Set(), artistKeys: new Set() });
  useUi.setState({ dialog: null, toasts: [], nowPlaying: false, menu: null });
});

describe('a dropped link', () => {
  it('a YouTube video plays; a list (YouTube, Spotify, Apple Music) is imported; anything else is refused', () => {
    expect(classifyLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ kind: 'song', yt: 'dQw4w9WgXcQ' });
    expect(classifyLink('https://youtu.be/dQw4w9WgXcQ?t=10')).toEqual({ kind: 'song', yt: 'dQw4w9WgXcQ' });
    expect(classifyLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVMdQw4w9WgXcQ')).toEqual({ kind: 'song', yt: 'dQw4w9WgXcQ' }, 'a YouTube mix is not a list');
    expect(classifyLink('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toEqual({ kind: 'song', yt: 'dQw4w9WgXcQ' });
    expect(classifyLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG')).toEqual({ kind: 'list', url: 'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG' });
    expect(classifyLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc')).toEqual({ kind: 'list', url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' });
    expect(classifyLink('https://music.apple.com/es/playlist/x/pl.123')).toEqual({ kind: 'list', url: 'https://music.apple.com/es/playlist/x/pl.123' });
    for (const bad of ['javascript:alert(1)', 'file:///C:/x', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'https://user:pw@youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'nada', '', null]) {
      expect(classifyLink(bad)).toBe(null);
    }
    const dt = (types, data) => ({ types, getData: (t) => data[t] || '' });
    expect(linkOf(dt(['text/uri-list'], { 'text/uri-list': '# comment\r\nhttps://youtu.be/dQw4w9WgXcQ' }))).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(carriesLink(dt(['text/uri-list', 'text/plain'], {}))).toBe(true);
    expect(carriesLink(dt(['text/x-rumoria-row', 'text/plain'], {}))).toBe(false, 'a row of a list being moved');
    expect(carriesLink(dt(['Files'], {}))).toBe(false);
  });
});

describe('sorting a list', () => {
  const tracks = [
    { key: 'yt:a', title: 'beta', artist: 'Zeta', duration: 300, at: 1, n: 0 },
    { key: 'yt:b', title: 'Álamo', artist: '', duration: null, at: 3, n: 1 },
    { key: 'yt:c', title: 'Canción 10', artist: 'ana', duration: 100, at: 2, n: 2 },
    { key: 'yt:d', title: 'Canción 9', artist: 'ana', duration: 200, at: 2, n: 3 },
  ];
  const titles = (s, c) => sortTracks(tracks, s, c).map((t) => t.title);
  it('by title (accents and case don\'t count, numbers as numbers), artist, added, plays, length; yours by default', () => {
    expect(titles('custom')).toEqual(['beta', 'Álamo', 'Canción 10', 'Canción 9']);
    expect(titles('title')).toEqual(['Álamo', 'beta', 'Canción 9', 'Canción 10']);
    expect(titles('artist')).toEqual(['Canción 9', 'Canción 10', 'beta', 'Álamo'], 'no artist last');
    expect(titles('added')).toEqual(['Álamo', 'Canción 10', 'Canción 9', 'beta']);
    expect(titles('plays', { 'yt:d': 5, 'yt:a': 2 })).toEqual(['Canción 9', 'beta', 'Álamo', 'Canción 10']);
    expect(titles('duration')).toEqual(['Canción 10', 'Canción 9', 'beta', 'Álamo']);
    expect(sortTracks(tracks, 'title').map((t) => t.n)).toEqual([1, 0, 3, 2], 'each keeps its place in the list');
    expect(titles('evil')).toEqual(titles('custom'));
  });
  it('remembered per list; only known orders read back', () => {
    saveSort('list:abc', 'title');
    expect(readSort('list:abc')).toBe('title');
    expect(readSort('list:other')).toBe('custom');
    saveSort('list:abc', 'evil');
    expect(readSort('list:abc')).toBe('title');
    localStorage.setItem('rumoria_sorts', JSON.stringify({ 'list:x': '<script>', '../y': 'title' }));
    expect(readSort('list:x')).toBe('custom');
    expect(readSort('../y')).toBe('custom');
  });
  it('the page: choosing an order shows the songs in it; dragging is off meanwhile', () => {
    render(<Collection kind="Lista" name="L" tracks={tracks.map((t, i) => ({ ...t, yt: `aaaaaaaaaa${i}`, key: `yt:aaaaaaaaaa${i}` }))} listId="l1" sortKey="list:l1" reorder={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Ordenar la lista' }), { target: { value: 'title' } });
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByText(/beta|Álamo|Canción/).textContent)).toEqual(['Álamo', 'beta', 'Canción 9', 'Canción 10']);
    expect(rows[0].getAttribute('draggable')).toBe('false');
    expect(readSort('list:l1')).toBe('title');
  });
});

describe('Historial', () => {
  it('by day: Hoy, Ayer, then the date; local songs only if still there', () => {
    const now = new Date(2026, 9, 8, 20);
    expect(dayLabel(new Date(2026, 9, 8, 1).getTime(), now)).toBe('Hoy');
    expect(dayLabel(new Date(2026, 9, 7, 23).getTime(), now)).toBe('Ayer');
    expect(dayLabel(new Date(2026, 9, 5, 12).getTime(), now)).toMatch(/^[A-ZÁÉÍÓÚ].*5.*octubre/i);
    const rows = [
      { at: new Date(2026, 9, 8, 19).getTime(), key: 'yt:aaaaaaaaaaa', title: 'Uno', artist: 'A', yt: 'aaaaaaaaaaa', played: true },
      { at: new Date(2026, 9, 8, 18).getTime(), key: 'f:gone.mp3', title: 'Borrada', artist: '', played: true },
      { at: new Date(2026, 9, 7, 18).getTime(), key: 'yt:bbbbbbbbbbb', title: 'Dos', artist: 'B', yt: 'bbbbbbbbbbb', played: false },
    ];
    const g = byDay(rows, new Map(), now);
    expect(g.map((x) => [x.label, x.tracks.map((t) => t.title)])).toEqual([['Hoy', ['Uno']], ['Ayer', ['Dos']]]);
    expect(g[1].tracks[0].played).toBe(false);
    expect(new Set(g.flatMap((x) => x.tracks.map((t) => t.uid))).size).toBe(2);
  });
});

describe('global shortcuts (the page side)', () => {
  it('a key press → a combination Electron takes; Shift alone or odd keys are not one', () => {
    expect(accelOf({ ctrlKey: true, altKey: true, code: 'KeyP' })).toBe('Ctrl+Alt+P');
    expect(accelOf({ ctrlKey: true, shiftKey: true, code: 'ArrowRight' })).toBe('Ctrl+Shift+Right');
    expect(accelOf({ metaKey: true, code: 'F5' })).toBe('Super+F5');
    expect(accelOf({ altKey: true, code: 'Digit3' })).toBe('Alt+3');
    expect(accelOf({ shiftKey: true, code: 'KeyP' })).toBe(null);
    expect(accelOf({ code: 'KeyP' })).toBe(null);
    expect(accelOf({ ctrlKey: true, code: 'IntlBackslash' })).toBe(null);
    expect(showAccel('Ctrl+Super+Left')).toBe('Ctrl + Win + ←');
    expect(showAccel('')).toBe('—');
  });
  it('the player answers them (and the tray, and the mini player): volume steps, mute, jump ahead', () => {
    const p = usePlayer.getState();
    p.playTracks([yt('aaaaaaaaaaa', 'Uno'), yt('bbbbbbbbbbb', 'Dos'), yt('ccccccccccc', 'Tres')], 0);
    runMiniCommand({ cmd: 'volumeStep', value: 0.05 });
    expect(usePlayer.getState().volume).toBeCloseTo(0.55);
    runMiniCommand({ cmd: 'volumeStep', value: 5 });
    expect(usePlayer.getState().volume).toBeCloseTo(0.75); // at most a small step
    runMiniCommand({ cmd: 'mute' });
    expect(usePlayer.getState().muted).toBe(true);
    runMiniCommand({ cmd: 'jump', value: 2 });
    expect(usePlayer.getState().current().title).toBe('Tres');
    runMiniCommand({ cmd: 'jump', value: 0 });
    expect(usePlayer.getState().current().title).toBe('Tres', 'only ahead');
    usePlayer.getState().jump(0);
    const s = miniState();
    expect(s.queue).toEqual([{ i: 1, title: 'Dos', artist: 'A' }, { i: 2, title: 'Tres', artist: 'A' }]);
    expect(s.muted).toBe(true);
  });
});

describe('«No me recomiendes»', () => {
  it('an artist by any of their names; a song by its key; out of seeds and suggestions', () => {
    expect(artistKey('QueenVEVO')).toBe('queen');
    expect(artistsOf({ title: 'Queen - Innuendo', artist: 'Some Channel' })).toEqual(['queen', 'some channel']);
    expect(mainArtistOf({ artist: 'Bad Bunny, Feid feat. X' })).toBe('Bad Bunny');
    useHidden.getState()._put({ songs: [{ key: 'yt:aaaaaaaaaaa', title: 'Uno' }], artists: [{ name: 'Queen' }] });
    const list = [yt('aaaaaaaaaaa', 'Uno', 'Ana'), yt('bbbbbbbbbbb', 'Radio Ga Ga', 'Queen Official'), yt('ccccccccccc', 'Otra', 'Beto')];
    expect(notHidden(list).map((t) => t.title)).toEqual(['Otra']);
    const smart = { top: [{ key: 'yt:aaaaaaaaaaa', yt: 'aaaaaaaaaaa', title: 'Uno', artist: 'Ana' }, { key: 'yt:ddddddddddd', yt: 'ddddddddddd', title: 'X', artist: 'Queen' }, { key: 'yt:eeeeeeeeeee', yt: 'eeeeeeeeeee', title: 'Y', artist: 'Beto' }], lately: [] };
    expect(seedsOf(smart).map((s) => s.title)).toEqual(['Y']);
  });
  it('the song menu offers it (this song, or nothing of the artist)', () => {
    const items = trackMenu([yt('aaaaaaaaaaa', 'Uno', 'Bad Bunny, Feid')]);
    const no = items.find((i) => i.label === 'No me recomiendes…');
    expect(no.sub.map((s) => s.label)).toEqual(['Esta canción', 'Nada de Bad Bunny']);
  });
});

describe('Sonando a pantalla completa', () => {
  it('the song, the controls and what comes next; Esc or the button go back', () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ synced: null, plain: null }) }));
    usePlayer.getState().playTracks([yt('aaaaaaaaaaa', 'Uno', 'Ana'), yt('bbbbbbbbbbb', 'Dos', 'Beto')], 0);
    useLibrary.setState({ likedKeys: new Set() });
    act(() => useUi.getState().setNowPlaying(true));
    render(<NowPlaying />);
    const dlg = screen.getByRole('dialog', { name: 'Sonando' });
    expect(within(dlg).getAllByText('Uno').length).toBeGreaterThan(0);
    expect(within(dlg).getByText('A continuación')).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Pausa' }));
    expect(usePlayer.getState().wantPlaying).toBe(false);
    expect(within(dlg).getByRole('button', { name: 'Reproducir' })).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Videoclip' }));
    expect(JSON.parse(localStorage.getItem('rumoria_nowplaying')).video).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUi.getState().nowPlaying).toBe(false);
  });
});

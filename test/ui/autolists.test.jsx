// Lists that fill themselves, on screen: making one (from "+" or a folder),
// what it says about itself, and its menu.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/api.js';
import Overlays from '../../src/components/Overlays.jsx';
import Settings from '../../src/views/Settings.jsx';
import Sidebar from '../../src/components/Sidebar.jsx';
import { autoMenuItems, autoSub, everyLabel } from '../../src/lib/autoLists.js';
import { useLibrary } from '../../src/store/library.js';
import { useUi } from '../../src/store/ui.js';

const AUTO = { id: 'aaaaaaaaaaaaaaaa', name: 'Rock de los 80', source: 'auto', count: 40, folder: 'Rock', thumbs: [], auto: { q: 'rock de los 80', every: 24, at: 1 } };

beforeEach(() => {
  useLibrary.setState({ lists: [], likes: [], likedKeys: new Set(), local: { folder: false, songs: [] }, smart: null, news: [], open: {} });
  useUi.setState({ history: [{ name: 'home' }], at: 0, menu: null, dialog: null, toasts: [] });
});

describe('lists that fill themselves', () => {
  it('"+" offers one; the dialog asks what about and how often, and makes it', async () => {
    const createAutoList = vi.fn(async () => ({ id: 'bbbbbbbbbbbbbbbb' }));
    useLibrary.setState({ createAutoList });
    render(<><Sidebar /><Overlays /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Crear una lista' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Lista que se llena sola…' }));
    expect(screen.getByRole('dialog', { name: 'Una lista que se llena sola' })).toBeInTheDocument();
    expect(screen.getByText(/No se descarga nada/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('De qué'), { target: { value: 'Bad Bunny' } });
    fireEvent.change(screen.getByLabelText('Buscar canciones nuevas'), { target: { value: '168' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(createAutoList).toHaveBeenCalledWith('Bad Bunny', 168, null));
    await waitFor(() => expect(useUi.getState().history.at(-1)).toEqual({ name: 'list', id: 'bbbbbbbbbbbbbbbb' }));
  });

  it('from a folder: its title is the topic and the list goes inside it', async () => {
    const createAutoList = vi.fn(async () => ({ id: 'cccccccccccccccc' }));
    useLibrary.setState({ lists: [AUTO], createAutoList });
    render(<><Sidebar /><Overlays /></>);
    expect(screen.getByText('Se llena sola · 40 canciones')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Añadir a «Rock» una lista que se llena sola' }));
    expect(screen.getByLabelText('De qué')).toHaveValue('Rock');
    expect(screen.getByText(/Irá en la carpeta «Rock»/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(createAutoList).toHaveBeenCalledWith('Rock', 24, 'Rock'));
  });

  it('says what it is and offers to look now, change how often, or stop', () => {
    expect(autoSub(AUTO.auto)).toBe('Se llena sola con «rock de los 80» · cada día');
    expect(everyLabel(168)).toBe('cada semana');
    expect(autoSub(null)).toBe(null);
    const patchList = vi.fn();
    const refreshList = vi.fn();
    useLibrary.setState({ patchList, refreshList });
    const items = autoMenuItems(AUTO);
    expect(items.map((i) => i.label)).toEqual(['Buscar canciones nuevas ahora', 'Buscar canciones nuevas…', 'Dejar de llenarse sola']);
    items[0].onClick();
    expect(refreshList).toHaveBeenCalledWith(AUTO.id);
    expect(items[1].sub.find((s) => s.label.startsWith('✓')).label).toBe('✓ Cada día');
    items[1].sub.find((s) => s.label === 'Cada semana').onClick();
    expect(patchList).toHaveBeenCalledWith(AUTO.id, { auto: { every: 168 } });
    items[2].onClick();
    expect(patchList).toHaveBeenCalledWith(AUTO.id, { auto: null });
    expect(autoMenuItems({ ...AUTO, auto: null })).toEqual([]);
  });
});

describe('"Para ti" in Ajustes', () => {
  it('shows your genres, switches it, changes how often and renews now', async () => {
    const view = { enabled: true, every: 7, at: 1, next: Date.now() + 86400000, genres: [{ id: 'rock', name: 'Rock de siempre' }, { id: 'indie', name: 'Indie' }] };
    const get = vi.spyOn(api, 'get').mockResolvedValue(view);
    const patch = vi.spyOn(api, 'patch').mockImplementation(async (url, body) => ({ ...view, ...body }));
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ...view, made: 2, removed: 1 });
    const refreshLists = vi.fn(async () => {});
    useLibrary.setState({ refreshLists });
    render(<><Settings /><Overlays /></>);
    expect(await screen.findByText('Rock de siempre, Indie')).toBeInTheDocument();
    expect(screen.getByText(/No se descarga nada/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Renovar las listas/), { target: { value: '14' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/curator', { every: 14 }));
    fireEvent.click(screen.getByRole('button', { name: 'Renovar' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/curator/run'));
    await waitFor(() => expect(refreshLists).toHaveBeenCalled());
    expect(useUi.getState().toasts.at(-1).text).toBe('«Para ti» renovada: 2 listas nuevas');
    fireEvent.click(screen.getByLabelText(/Crear listas para mí/));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/curator', { enabled: false }));
    get.mockRestore(); patch.mockRestore(); post.mockRestore();
  });
});

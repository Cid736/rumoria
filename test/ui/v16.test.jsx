// v1.6: the interface as Rumoria's, Windows' or Mac's (with the window's own
// title bar), and what you searched kept to search again — each one or all
// can be removed, or none kept.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLook, cleanLook, DEFAULT_LOOK } from '../../src/store/look.js';
import { cleanQuery, cleanSearches, MAX_SEARCHES, useSearches } from '../../src/store/searches.js';
import { RecentSearches } from '../../src/views/Search.jsx';
import { SearchSettings } from '../../src/views/MoreSettings.jsx';
import { useUi } from '../../src/store/ui.js';

beforeEach(() => {
  localStorage.clear();
  useSearches.setState({ items: [], off: false });
  useUi.setState({ toasts: [], searchText: '' });
});

describe('interface style', () => {
  it('Rumoria by default; Windows or Mac; anything else is Rumoria; put on the page', () => {
    expect(DEFAULT_LOOK.ui).toBe('rumoria');
    expect(cleanLook({ ui: 'mac' }).ui).toBe('mac');
    expect(cleanLook({ ui: 'windows' }).ui).toBe('windows');
    expect(cleanLook({ ui: 'linux' }).ui).toBe('rumoria');
    const doc = document.implementation.createHTMLDocument('x');
    applyLook({ ...DEFAULT_LOOK, ui: 'mac' }, doc, () => {});
    expect(doc.documentElement.dataset.ui).toBe('mac');
  });
});

describe('the title bar', () => {
  let TitleBar;
  let control;
  let emit;
  beforeEach(async () => {
    control = vi.fn();
    window.rumoria = { window: { control, onState: (cb) => { emit = cb; return () => {}; } } };
    vi.resetModules();
    ({ default: TitleBar } = await import('../../src/components/TitleBar.jsx'));
    ({ useLook: lookStore } = await import('../../src/store/look.js'));
  });
  afterEach(() => { delete window.rumoria; });
  let lookStore;

  it('Windows-like buttons on the right (Rumoria and Windows), three lights on the left (Mac); they drive the window', () => {
    lookStore.setState({ look: { ...lookStore.getState().look, ui: 'windows' } });
    const { container } = render(<TitleBar />);
    expect(container.querySelector('.caption')).not.toBe(null);
    expect(container.querySelector('.traffic')).toBe(null);
    fireEvent.click(screen.getByRole('button', { name: 'Minimizar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Maximizar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(control.mock.calls.map((c) => c[0])).toEqual(['minimize', 'maximize', 'close']);
    act(() => emit({ maximized: true }));
    expect(screen.getByRole('button', { name: 'Restaurar' })).toBeInTheDocument();
    expect(document.documentElement.dataset.titlebar).toBe('on');
    act(() => lookStore.setState({ look: { ...lookStore.getState().look, ui: 'mac' } }));
    expect(container.querySelector('.traffic')).not.toBe(null);
    expect(container.querySelector('.caption')).toBe(null);
    // Full screen: no bar, no room for it.
    act(() => emit({ maximized: false, fullscreen: true }));
    expect(container.querySelector('.titlebar')).toBe(null);
    expect(document.documentElement.dataset.titlebar).toBe('off');
  });
});

describe('recent searches', () => {
  it('kept clean: one line, 2-200 characters, once each (case and accents aside), newest first, at most 30', () => {
    expect(cleanQuery('  bad\n bunny ')).toBe('bad bunny');
    expect(cleanQuery('a')).toBe(null);
    expect(cleanQuery('x'.repeat(201))).toBe(null);
    const s = useSearches.getState();
    s.add('Rosalía');
    s.add('queen');
    s.add('ROSALIA');
    expect(useSearches.getState().items).toEqual(['ROSALIA', 'queen']);
    for (let i = 0; i < 40; i++) s.add(`busqueda ${i}`);
    expect(useSearches.getState().items).toHaveLength(MAX_SEARCHES);
    expect(JSON.parse(localStorage.getItem('rumoria_searches')).items[0]).toBe('busqueda 39');
    expect(cleanSearches({ items: ['ok', 5, '<b>', 'ok', null, 'x'], off: 'yes' })).toEqual({ items: ['ok', '<b>'], off: false });
  });

  it('off: nothing kept (and what was kept goes)', () => {
    useSearches.getState().add('queen');
    useSearches.getState().setOff(true);
    expect(useSearches.getState().items).toEqual([]);
    useSearches.getState().add('abba');
    expect(useSearches.getState().items).toEqual([]);
  });

  it('Buscar shows them: click one to search it again, ✕ removes it, "Borrar todo" (with Deshacer)', () => {
    for (const q of ['abba', 'queen', 'rosalía']) useSearches.getState().add(q);
    render(<RecentSearches />);
    const list = screen.getByRole('region', { name: 'Búsquedas recientes' });
    fireEvent.click(within(list).getByRole('button', { name: 'queen' }));
    expect(useUi.getState().searchText).toBe('queen');
    fireEvent.click(within(list).getByRole('button', { name: 'Quitar «abba» de las búsquedas recientes' }));
    expect(useSearches.getState().items).toEqual(['rosalía', 'queen']);
    fireEvent.click(within(list).getByRole('button', { name: 'Borrar todo' }));
    expect(useSearches.getState().items).toEqual([]);
    const toast = useUi.getState().toasts.at(-1);
    expect(toast.text).toBe('Búsquedas borradas');
    act(() => toast.onAction());
    expect(useSearches.getState().items).toEqual(['rosalía', 'queen']);
  });

  it('Ajustes: keep them or not, and wipe them', () => {
    useSearches.getState().add('queen');
    render(<SearchSettings />);
    expect(screen.getByText('1 búsqueda guardada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Borrar todo' }));
    expect(useSearches.getState().items).toEqual([]);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(useSearches.getState().off).toBe(true);
  });
});


describe('the welcome guide', () => {
  it('opens by itself for someone new, not for someone who already used Rumoria; what you choose wins', async () => {
    const { readGuide } = await import('../../src/components/Guide.jsx');
    const mem = (o) => ({ getItem: (k) => (k in o ? o[k] : null) });
    expect(readGuide(mem({}))).toEqual({ show: true });
    expect(readGuide(mem({ rumoria_volume: '0.5' }))).toEqual({ show: false });
    expect(readGuide(mem({ rumoria_volume: '0.5', rumoria_guide: '{"show":true}' }))).toEqual({ show: true });
    expect(readGuide(mem({ rumoria_guide: '{"show":"yes"}' }))).toEqual({ show: true });
  });

  it('five steps; "No volver a mostrarla" (on by default) stops it opening; Ajustes turns it back on and opens it', async () => {
    const { default: Guide, useGuide } = await import('../../src/components/Guide.jsx');
    const { GuideSettings } = await import('../../src/views/MoreSettings.jsx');
    useGuide.setState({ open: false, show: true });
    const { unmount } = render(<Guide />);
    const dlg = screen.getByRole('dialog', { name: 'Bienvenido a Rumoria' });
    fireEvent.click(within(dlg).getByRole('radio', { name: 'Mac' }));
    expect(document.documentElement.dataset.ui).toBe('mac');
    for (let n = 0; n < 4; n++) fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByRole('dialog', { name: 'Controles a mano' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /No volver a mostrarla/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Empezar' }));
    expect(screen.queryByRole('dialog')).toBe(null);
    expect(JSON.parse(localStorage.getItem('rumoria_guide'))).toEqual({ show: false });
    unmount();
    render(<><GuideSettings /><Guide /></>);
    const sw = screen.getByRole('checkbox', { name: /Mostrar la guía al abrir Rumoria/ });
    expect(sw).not.toBeChecked();
    fireEvent.click(sw);
    expect(useGuide.getState().show).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Ver la guía' }));
    expect(screen.getByRole('dialog', { name: 'Bienvenido a Rumoria' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBe(null);
  });
});

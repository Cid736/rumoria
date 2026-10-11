// Ajustes → Sincronizar, and the watch that reads the library again when another device synced.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SyncSettings, { agoText } from '../../src/views/SyncSettings.jsx';
import { startSyncWatch } from '../../src/lib/syncWatch.js';
import { findSections } from '../../src/views/Settings.jsx';
import { useUi } from '../../src/store/ui.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const CODE = 'ábaco-abdomen-abeja-abierto-abogado-abono';

/** A pretend server: answers by method and path. */
function server(routes) {
  globalThis.fetch = vi.fn(async (url, o = {}) => {
    const k = `${o.method || 'GET'} ${String(url).split('?')[0]}`;
    if (routes[k]) return json(...[].concat(routes[k](o.body ? JSON.parse(o.body) : null)));
    return json({ lists: [], songs: [], keys: [] });
  });
}

describe('Sincronizar', () => {
  it('found by the settings search', () => {
    expect(findSections('sincronizar').map((s) => s.id)).toEqual(['sync']);
    expect(findSections('movil').map((s) => s.id)).toContain('sync');
  });

  it('"hace…"', () => {
    const now = 1_000_000_000;
    expect(agoText(null, now)).toBe('aún no');
    expect(agoText(now - 20_000, now)).toBe('ahora mismo');
    expect(agoText(now - 5 * 60_000, now)).toBe('hace 5 min');
    expect(agoText(now - 3 * 3600_000, now)).toBe('hace 3 h');
  });

  it('off: make a code here → the 6 words, numbered, with what to do on the other device', async () => {
    server({
      'GET /api/sync': () => ({ available: true, enabled: false }),
      'POST /api/sync/create': () => ({ available: true, enabled: true, code: CODE, lastAt: Date.now(), error: null }),
    });
    render(<SyncSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Crear código' }));
    expect(await screen.findByText('abono')).toBeInTheDocument();
    expect(screen.getByLabelText('Tu código').querySelectorAll('.sync-word')).toHaveLength(6);
    expect(screen.getByText(/Ya tengo un código/)).toBeInTheDocument();
    expect(screen.getByText(/Sincronizado ahora mismo/)).toBeInTheDocument();
  });

  it('joining: the typed code goes to this app\'s server (only); an error is shown as it comes', async () => {
    useUi.setState({ toasts: [] });
    server({
      'GET /api/sync': () => ({ available: true, enabled: false }),
      'POST /api/sync/join': (b) => (b.code === 'mal' ? [{ error: 'Ese código no es válido: son 6 palabras, como en el otro dispositivo.' }, 400] : { available: true, enabled: true, code: CODE }),
    });
    render(<SyncSettings />);
    const box = await screen.findByLabelText('Código de sincronización');
    fireEvent.change(box, { target: { value: 'mal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unir' }));
    await waitFor(() => expect(useUi.getState().toasts.map((t) => t.text)).toContain('Ese código no es válido: son 6 palabras, como en el otro dispositivo.'));
    fireEvent.change(box, { target: { value: CODE.toUpperCase() } });
    fireEvent.click(screen.getByRole('button', { name: 'Unir' }));
    expect(await screen.findByText('abono')).toBeInTheDocument();
    const urls = globalThis.fetch.mock.calls.map(([u]) => String(u));
    expect(urls.every((u) => u.startsWith('/api/'))).toBe(true);
  });

  it('on: leaving asks first, and "Borrar de la nube" says what it does', async () => {
    useUi.setState({ dialog: null });
    server({ 'GET /api/sync': () => ({ available: true, enabled: true, code: CODE, lastAt: Date.now() - 120_000 }) });
    render(<SyncSettings />);
    expect(await screen.findByText(/Sincronizado hace 2 min/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Borrar de la nube' }));
    expect(useUi.getState().dialog.kind).toBe('confirm');
    expect(useUi.getState().dialog.text).toMatch(/Se borra la copia cifrada de la nube/);
  });

  it('not in this version: says so, nothing to press', async () => {
    server({ 'GET /api/sync': () => ({ available: false, enabled: false }) });
    render(<SyncSettings />);
    expect(await screen.findByText(/Aún no está disponible/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear código' })).toBe(null);
  });

  it('watch: the library is read again only when another device brought something in', async () => {
    vi.useFakeTimers();
    try {
      const answers = [{ enabled: true, appliedAt: null }, { enabled: true, appliedAt: null }, { enabled: true, appliedAt: 5 }, { enabled: true, appliedAt: 5 }];
      const get = vi.fn(async () => answers.shift() || { enabled: true, appliedAt: 5 });
      const reload = vi.fn();
      const stop = startSyncWatch({ get, reload, every: 1000 });
      await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
      expect(reload).toHaveBeenCalledTimes(1);
      stop();
    } finally { vi.useRealTimers(); }
  });
});

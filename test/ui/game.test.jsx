// v1.12, Modo juego on the page: Mínimo while a game is on (whatever was
// chosen), back to yours after; its switch in Ajustes → Rendimiento.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePerf } from '../../src/store/perf.js';

describe('performance during a game', () => {
  afterEach(() => { usePerf.setState({ game: false, choice: 'auto', detected: 'mid' }); });

  it('Mínimo while a game is on, whatever was chosen; yours again after; the server told each time', () => {
    const sent = [];
    const send = (p) => sent.push(p);
    usePerf.setState({ choice: 'high', game: false });
    usePerf.getState().apply(document, send);
    expect(usePerf.getState().profile).toBe('high');
    usePerf.setState({ game: true });
    usePerf.getState().apply(document, send);
    expect(usePerf.getState().profile).toBe('min');
    expect(document.documentElement.dataset.perf).toBe('min');
    usePerf.setState({ game: false });
    usePerf.getState().apply(document, send);
    expect(usePerf.getState().profile).toBe('high');
    expect(sent).toEqual(['high', 'min', 'high']);
    expect(usePerf.getState().choice).toBe('high'); // your choice is never changed
  });
});

describe('the Modo juego switch', () => {
  let PerfSettings;
  let perf;
  let emit;
  let set;
  beforeEach(async () => {
    set = vi.fn(async (on) => ({ available: true, enabled: on, active: false }));
    window.rumoria = { game: { get: async () => ({ available: true, enabled: true, active: false }), set, onState: (cb) => { emit = cb; return () => {}; } } };
    vi.resetModules();
    ({ PerfSettings } = await import('../../src/views/Customize.jsx'));
    ({ usePerf: perf } = await import('../../src/store/perf.js'));
    globalThis.fetch = vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  });
  afterEach(() => { delete window.rumoria; });

  it('shows on the desktop app, says when a game is on, and turns off', async () => {
    render(<PerfSettings />);
    const box = await screen.findByLabelText('Modo juego');
    expect(box.checked).toBe(true);
    expect(screen.getByText(/Ahora: sin juego/)).toBeTruthy();
    act(() => { emit({ available: true, enabled: true, active: true }); perf.getState().setGame(true); });
    expect(screen.getByText(/Ahora: jugando/)).toBeTruthy();
    expect(screen.getByText(/por el modo juego/)).toBeTruthy();
    fireEvent.click(box);
    expect(set).toHaveBeenCalledWith(false);
    await vi.waitFor(() => expect(screen.getByLabelText('Modo juego').checked).toBe(false));
  });

  it('not there where there is no way to tell (a Mac, the phone)', async () => {
    window.rumoria.game.get = async () => ({ available: false, enabled: true, active: false });
    render(<PerfSettings />);
    await act(async () => {});
    expect(screen.queryByLabelText('Modo juego')).toBe(null);
  });
});

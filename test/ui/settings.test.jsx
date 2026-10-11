// Ajustes by topic, with a search box that finds any setting wherever it is.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Settings, { findSections, SECTIONS, TABS } from '../../src/views/Settings.jsx';

describe('Ajustes', () => {
  it('every section belongs to a topic, and every topic has something', () => {
    const tabs = TABS.map(([k]) => k);
    expect(SECTIONS.every((s) => tabs.includes(s.tab))).toBe(true);
    expect(tabs.every((t) => SECTIONS.some((s) => s.tab === t))).toBe(true);
  });
  it('search: by name or what it is about, ignoring accents and case; every word must match', () => {
    expect(findSections('DESPERTADOR').map((s) => s.id)).toEqual(['alarm']);
    expect(findSections('traduccion').map((s) => s.id)).toEqual(['lyrics']);
    expect(findSections('tema').map((s) => s.id)).toContain('customize');
    expect(findSections('borrar historial').map((s) => s.id)).toEqual(['history']);
    expect(findSections('zzzz')).toEqual([]);
    expect(findSections('   ')).toEqual([]);
  });
  it('one topic at a time; the search shows matches from any topic, with where they live', () => {
    localStorage.clear();
    render(<Settings />);
    expect(screen.getByRole('heading', { name: 'Personalizar' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Atajos de teclado (en la ventana)' })).toBe(null);
    fireEvent.click(screen.getByRole('button', { name: /Atajos/ }));
    expect(screen.getByRole('heading', { name: 'Atajos de teclado (en la ventana)' })).toBeInTheDocument();
    expect(localStorage.getItem('rumoria_settings_tab')).toBe('keys');
    fireEvent.change(screen.getByLabelText('Buscar en los ajustes'), { target: { value: 'despertador' } });
    expect(screen.getByText('1 sección con «despertador»')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reproducción ›' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar en los ajustes'), { target: { value: 'qwerty' } });
    expect(screen.getByText(/Nada con «qwerty»/)).toBeInTheDocument();
  });
});

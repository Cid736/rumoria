// v1.4: "Explorar", "Radios populares" and "Si te gusta" rotate — semi-random,
// leaning on your taste, steady for a while, and «Otras» changes one shelf now.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  cleanRotation, exploreOf, hash, likeSeedOf, noteShown, pick, popularOf, readRotation, reshuffle, rng, settled, similarOf, slotOf,
} from '../../src/views/rotation.js';
import Home from '../../src/views/Home.jsx';
import { useLibrary } from '../../src/store/library.js';
import { useUi } from '../../src/store/ui.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };
const g = (id, featured = false) => ({ id, name: id, sub: '', group: 'genre', featured, thumbs: [] });
const radio = (artist, tags, featured = false) => ({ id: `radio-${artist}`, name: `Radio de ${artist}`, sub: '', group: 'radio', artist, tags, featured, thumbs: [] });
const GENRES = ['rock', 'jazz', 'pop', 'metal', 'salsa', 'kpop', 'indie', 'rap', 'folk', 'blues', 'soul', 'punk', 'reggae', 'afro', 'country', 'anime', 'piano', 'cine'].map((id, i) => g(id, i < 4));
const rot = (salt, extra = {}) => ({ slot: 's', salt, shown: {}, prev: {}, turns: {}, ...extra });
/** How often `id` is in the pick, over many different rotations. */
const often = (fn, id, runs = 300) => { let n = 0; for (let s = 1; s <= runs; s++) if (fn(rot(s)).some((x) => x.id === id)) n++; return n / runs; };

describe('the pick', () => {
  it('the same seed gives the same numbers and the same pick; another seed, another one', () => {
    expect([rng(7)(), rng(7)()]).toEqual([rng(7)(), rng(7)()]);
    expect(hash('a')).not.toBe(hash('b'));
    const items = [...Array(20).keys()];
    expect(pick(items, () => 1, 5, rng(1))).toEqual(pick(items, () => 1, 5, rng(1)));
    expect(pick(items, () => 1, 5, rng(1))).not.toEqual(pick(items, () => 1, 5, rng(2)));
    expect(pick(items, () => 1, 50, rng(1))).toHaveLength(20);
  });

  it('heavier items come up more often, lighter ones still now and then', () => {
    let heavy = 0;
    let light = 0;
    for (let s = 1; s <= 400; s++) {
      const [first] = pick(['heavy', 'light'], (x) => (x === 'heavy' ? 9 : 1), 1, rng(s));
      if (first === 'heavy') heavy++; else light++;
    }
    expect(heavy).toBeGreaterThan(300);
    expect(light).toBeGreaterThan(10);
  });

  it('"Explorar": a genre you play shows far more often; what was shown last time less', () => {
    const plain = often((r) => exploreOf(GENRES, [], r, 6), 'salsa');
    const yours = often((r) => exploreOf(GENRES, [{ id: 'salsa', score: 12 }, { id: 'rock', score: 3 }], r, 6), 'salsa');
    expect(yours).toBeGreaterThan(plain + 0.3);
    const again = often((r) => exploreOf(GENRES, [], { ...r, prev: { explore: ['salsa'] } }, 6), 'salsa');
    expect(again).toBeLessThan(plain);
    expect(exploreOf([...GENRES, radio('X', ['rock'])], [], rot(1), 50).every((b) => b.group === 'genre')).toBe(true);
    // Your genres always have their places: a third, taking turns, one of yours first.
    const taste = [{ id: 'salsa', score: 9 }, { id: 'jazz', score: 5 }, { id: 'kpop', score: 4 }, { id: 'afro', score: 3 }, { id: 'cine', score: 1 }];
    const seen = new Set();
    for (let s = 1; s <= 100; s++) {
      const p = exploreOf(GENRES, taste, rot(s), 12);
      expect(p).toHaveLength(12);
      expect(new Set(p).size).toBe(12);
      expect(taste.some((x) => x.id === p[0].id)).toBe(true);
      expect(p.filter((b) => taste.some((x) => x.id === b.id)).length).toBeGreaterThanOrEqual(4);
      for (const b of p.slice(0, 6)) seen.add(b.id);
    }
    expect(seen.has('cine')).toBe(true); // the least of yours too, now and then
    expect(GENRES.filter((b) => !taste.some((x) => x.id === b.id)).every((b) => seen.has(b.id))).toBe(true);
  });

  it('"Radios populares": artists in your genres, and artists you play, come up more', () => {
    const radios = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map((a, i) => radio(a, i === 9 ? ['salsa'] : ['pop'], i < 3));
    const base = often((r) => popularOf(radios, [], null, r, 3), 'radio-J');
    expect(often((r) => popularOf(radios, [{ id: 'salsa', score: 5 }], null, r, 3), 'radio-J')).toBeGreaterThan(base + 0.3);
    expect(often((r) => popularOf(radios, [], { artists: [{ name: 'J' }] }, r, 3), 'radio-J')).toBe(1); // half the places are for yours: J is the only one
    expect(popularOf(radios, [{ id: 'salsa', score: 5 }], null, rot(3), 4)[0].id).toBe('radio-J');
  });

  it('"Si te gusta": one of your artists (the more you play them, the likelier); its neighbours, the closest more often', () => {
    const smart = { artists: [{ name: 'Ana', plays: 30, seed: { yt: 'aaaaaaaaaaa' } }, { name: 'Beto', plays: 1, seed: { yt: 'bbbbbbbbbbb' } }, { name: 'Sin', plays: 50, seed: null }] };
    const names = [...Array(200).keys()].map((s) => likeSeedOf(smart, rot(s + 1)).name);
    expect(names.filter((n) => n === 'Ana').length).toBeGreaterThan(150);
    expect(names).toContain('Beto');
    expect(names).not.toContain('Sin');
    expect(likeSeedOf(null, rot(1))).toBeNull();
    const cands = [...Array(20).keys()].map((i) => `n${i}`);
    let first = 0;
    let last = 0;
    for (let s = 1; s <= 300; s++) { const p = similarOf(cands, rot(s)); if (p.includes('n0')) first++; if (p.includes('n19')) last++; }
    expect(first).toBeGreaterThan(last);
    expect(similarOf(cands, rot(1))).toHaveLength(8);
  });
});

describe('when it changes', () => {
  it('the same while its time lasts; then a new one, with what was shown as "before"', () => {
    const store = mem();
    const h = 3600 * 1000;
    const a = readRotation('3h', 10 * 3 * h, store);
    expect(readRotation('3h', 10 * 3 * h + 2 * h, store).salt).toBe(a.salt);
    noteShown('explore', a, ['rock', 'jazz'], store);
    expect(readRotation('3h', 10 * 3 * h, store).shown.explore).toEqual(['rock', 'jazz']);
    const b = readRotation('3h', 11 * 3 * h, store);
    expect(b.slot).not.toBe(a.slot);
    expect(b.prev.explore).toEqual(['rock', 'jazz']);
    expect(b.shown).toEqual({});
    // A pick from a rotation that's over isn't noted.
    noteShown('explore', a, ['pop'], store);
    expect(readRotation('3h', 11 * 3 * h, store).shown.explore).toBeUndefined();
    expect(slotOf('day', new Date(2026, 9, 8, 1).getTime())).toBe(slotOf('day', new Date(2026, 9, 8, 23).getTime()));
    expect(slotOf('open', 0, 1)).not.toBe(slotOf('open', 0, 2));
  });

  it('«Otras» changes only its shelf; what it showed weighs less', () => {
    const store = mem();
    const r = readRotation('3h', 0, store);
    noteShown('explore', r, ['rock'], store);
    noteShown('popular', r, ['radio-A'], store);
    const n = reshuffle('explore', '3h', 0, store);
    expect(n.salt).toBe(r.salt);
    expect(n.turns).toEqual({ explore: 1 });
    expect(n.prev.explore).toEqual(['rock']);
    expect(n.shown).toEqual({ popular: ['radio-A'] });
    expect(exploreOf(GENRES, [], n, 6)).not.toEqual(exploreOf(GENRES, [], r, 6));
    expect(popularOf([radio('A', ['pop']), radio('B', ['pop'])], [], null, n, 1)).toEqual(popularOf([radio('A', ['pop']), radio('B', ['pop'])], [], null, r, 1));
  });

  it('a shelf keeps what it showed for the same pick, even if your genres changed meanwhile', () => {
    const store = mem();
    const r = readRotation('3h', 0, store);
    const byId = new Map(GENRES.map((b) => [b.id, b]));
    noteShown('explore', r, ['jazz', 'rock'], store);
    expect(settled('explore', r, [byId.get('pop')], byId, store).map((b) => b.id)).toEqual(['jazz', 'rock']);
    // One of them no longer exists: the fresh pick.
    noteShown('explore', r, ['gone'], store);
    expect(settled('explore', r, [byId.get('pop')], byId, store).map((b) => b.id)).toEqual(['pop']);
  });

  it('only what it writes is read back', () => {
    expect(cleanRotation({ slot: 'x'.repeat(200), salt: 'a', shown: { explore: ['ok', 5, 'y'.repeat(500)], evil: ['z'] }, turns: { like: 2, explore: -1, x: 3 } }))
      .toEqual({ slot: '', salt: 0, shown: { explore: ['ok'] }, prev: {}, turns: { like: 2 } });
    expect(cleanRotation('nope')).toEqual({ slot: '', salt: 0, shown: {}, prev: {}, turns: {} });
  });
});

describe('Inicio', () => {
  beforeEach(() => { localStorage.clear(); useUi.setState({ recent: [] }); });

  it('Explorar and Radios populares show a pick of all the categories and radios, and «Otras» brings others', () => {
    const radios = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'].map((a) => radio(a, ['pop'], a < 'D'));
    useLibrary.setState({ lists: [], likes: [], news: [], local: { folder: false, songs: [] }, loaded: true, smart: null, taste: [{ id: 'salsa', score: 4 }], browse: [...GENRES, ...radios] });
    render(<Home />);
    const shelf = (name) => screen.getByRole('heading', { name }).closest('section');
    const titles = (name) => within(shelf(name)).getAllByRole('group').map((c) => c.getAttribute('aria-label'));
    const explore = titles('Explorar');
    expect(explore.length).toBe(6); // one row until «Mostrar todo»
    expect(new Set(explore).size).toBe(6);
    act(() => { fireEvent.click(within(shelf('Explorar')).getByRole('button', { name: 'Mostrar todo' })); });
    expect(titles('Explorar')).toHaveLength(12);
    expect(titles('Explorar').slice(0, 6)).toEqual(explore);
    act(() => { fireEvent.click(within(shelf('Radios populares')).getByRole('button', { name: 'Mostrar todo' })); });
    expect(titles('Radios populares')).toHaveLength(10);
    const popular = titles('Radios populares');
    act(() => { fireEvent.click(within(shelf('Explorar')).getByRole('button', { name: /Otras/ })); });
    expect(titles('Explorar').slice(0, 6)).not.toEqual(explore);
    expect(titles('Radios populares')).toEqual(popular);
  });
});

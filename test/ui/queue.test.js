import { describe, expect, it } from 'vitest';
import { insert, nextIndex, prevIndex, removeAt, setShuffle, startQueue } from '../../src/lib/queue.js';
import { formatTime, fromList, fromSaved, mixOf, songOf, toListTrack, totalTime } from '../../src/lib/tracks.js';

const songs = (...names) => names.map((title) => ({ key: `yt:${title.padEnd(11, '0')}`, yt: title.padEnd(11, '0'), title }));
const titles = (q) => q.items.map((x) => x.title).join('');
// A "random" that always picks the last place: the order is reversed, predictably.
const notRandom = () => 0.999;

describe('queue', () => {
  it('starts where asked, each entry with its own id (the same song can be twice)', () => {
    const q = startQueue([...songs('A', 'B'), ...songs('A')], 1);
    expect(q.index).toBe(1);
    expect(new Set(q.items.map((x) => x.uid)).size).toBe(3);
  });

  it('shuffled from a song: that one first, the rest mixed', () => {
    const q = startQueue(songs('A', 'B', 'C', 'D'), 2, { shuffle: true, random: () => 0 });
    expect(q.items[0].title).toBe('C');
    expect(q.index).toBe(0);
    expect(titles(q).split('').sort().join('')).toBe('ABCD');
    expect(q.original).not.toBeNull();
  });

  it('shuffle on keeps what was played and the current song; off goes back to the order (keeping additions)', () => {
    let q = startQueue(songs('A', 'B', 'C', 'D', 'E'), 1);
    q = setShuffle(q, true, notRandom);
    expect(titles(q).slice(0, 2)).toBe('AB');
    expect(q.items[q.index].title).toBe('B');
    q = insert(q, songs('Z'), 'end');
    q = { ...q, index: 3 };
    const playing = q.items[3].title;
    q = setShuffle(q, false);
    expect(titles(q)).toBe('ABCDEZ');
    expect(q.items[q.index].title).toBe(playing);
  });

  it('next: in order, then stops; repeat all wraps; repeat one only replays when the song ends by itself', () => {
    const q = { ...startQueue(songs('A', 'B')), index: 1 };
    expect(nextIndex(q, 'off')).toEqual({ end: true });
    expect(nextIndex(q, 'all')).toEqual({ index: 0 });
    expect(nextIndex(q, 'one', true)).toEqual({ index: 1 });
    expect(nextIndex(q, 'one', false)).toEqual({ index: 0 });
    expect(nextIndex(startQueue([]), 'all')).toEqual({ end: true });
  });

  it('previous: after 3 s back to the start of the song; else the one before', () => {
    const q = { ...startQueue(songs('A', 'B', 'C')), index: 1 };
    expect(prevIndex(q, 10, 'off')).toEqual({ restart: true, index: 1 });
    expect(prevIndex(q, 1, 'off')).toEqual({ index: 0 });
    expect(prevIndex({ ...q, index: 0 }, 1, 'off')).toEqual({ restart: true, index: 0 });
    expect(prevIndex({ ...q, index: 0 }, 1, 'all')).toEqual({ index: 2 });
  });

  it('play next / add to queue / remove (never the one playing)', () => {
    let q = startQueue(songs('A', 'B', 'C'), 0);
    q = insert(q, songs('X'), 'next');
    q = insert(q, songs('Y'), 'end');
    expect(titles(q)).toBe('AXBCY');
    q = removeAt(q, 0);
    expect(titles(q)).toBe('AXBCY');
    q = { ...q, index: 3 };
    q = removeAt(q, 1);
    expect(titles(q)).toBe('ABCY');
    expect(q.items[q.index].title).toBe('C');
    expect(insert(startQueue([]), songs('A'), 'end').index).toBe(0);
  });
});

describe('tracks', () => {
  it('a song from a list knows its place; one only known by name has no key until found', () => {
    const [a, b] = [{ title: 'A', artist: 'X', yt: 'dQw4w9WgXcQ' }, { title: 'B', artist: 'Y', query: 'Y - B' }].map(fromList('L1'));
    expect(a).toMatchObject({ key: 'yt:dQw4w9WgXcQ', list: 'L1', n: 0 });
    expect(b).toMatchObject({ key: null, query: 'Y - B', n: 1 });
    expect(songOf(b)).toBeNull();
    expect(songOf(a)).toEqual({ key: 'yt:dQw4w9WgXcQ', title: 'A', artist: 'X' });
  });

  it('saved songs: YouTube ones always, local ones only if still in your folder', () => {
    expect(fromSaved({ key: 'yt:dQw4w9WgXcQ', title: 'T', thumb: 'x' })).toMatchObject({ yt: 'dQw4w9WgXcQ', thumbnail: 'x' });
    expect(fromSaved({ key: 'f:a.mp3', title: 'T' })).toBeNull();
    const local = new Map([['f:a.mp3', { key: 'f:a.mp3', id: 'i'.repeat(32), title: 'a', artist: '' }]]);
    expect(fromSaved({ key: 'f:a.mp3', title: 'T' }, local)).toMatchObject({ localId: 'i'.repeat(32), title: 'T' });
    expect(fromSaved({ key: 'yt:bad', title: 'T' })).toBeNull();
  });

  it('what a list keeps of a song: its video, or how to find it', () => {
    expect(toListTrack({ title: 'A', artist: 'X', yt: 'dQw4w9WgXcQ', duration: 200 })).toEqual({ title: 'A', artist: 'X', duration: 200, yt: 'dQw4w9WgXcQ' });
    expect(toListTrack({ title: 'A', artist: 'X' })).toEqual({ title: 'A', artist: 'X', query: 'X - A' });
  });

  it('a mix: two similar, one of yours, no repeats, at most 40', () => {
    const radio = songs('a', 'b', 'c', 'd');
    const mine = [...songs('X', 'Y'), ...songs('a')];
    expect(mixOf(radio, mine).map((x) => x.title).join('')).toBe('abXcdY');
    expect(mixOf(songs(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP'.split('')), []).length).toBe(40);
  });

  it('times', () => {
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(NaN)).toBe('–:––');
    expect(totalTime([{ duration: 3600 }, { duration: 1500 }])).toBe('1 h 25 min');
    expect(totalTime([{}])).toBe('');
  });
});

// v1.7: lyrics in Latin letters or Spanish, smart lists, Estadísticas, the
// alarm clock, "Modo sesión" and the YouTube notice.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { romanize, scriptOf } from '../../src/lib/romanize.js';
import { cleanAlarm, DEFAULT_ALARM, isDue, nextRing, useAlarm } from '../../src/store/alarm.js';
import { START_VOLUME, startAlarm } from '../../src/player/alarm.js';
import { distance, guess, measure, orderFor, planSession, tempoOf } from '../../src/player/dj.js';
import { reorderUpcoming, startQueue } from '../../src/lib/queue.js';
import { describeRules, EMPTY_RULES } from '../../src/lib/ruleLists.js';
import { noticeText } from '../../src/components/YouTubeNotice.jsx';
import { chooseExtra, useLyricsPrefs } from '../../src/store/lyrics.js';
import { usePlayer } from '../../src/store/player.js';
import { useUi } from '../../src/store/ui.js';
import { LyricsModes } from '../../src/components/SidePanel.jsx';
import Stats, { duration } from '../../src/views/Stats.jsx';
import { nextText } from '../../src/components/AlarmSettings.jsx';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  useUi.setState({ toasts: [], dialog: null, menu: null });
  useLyricsPrefs.setState({ extra: 'none', translate: null });
});

describe('lyrics in Latin letters', () => {
  it('Korean, with a final linked to the next syllable', () => {
    expect(romanize('사랑해요')).toBe('saranghaeyo');
    expect(romanize('먹어')).toBe('meogeo');
    expect(romanize('안녕하세요 친구')).toBe('annyeonghaseyo chingu');
  });
  it('Japanese kana (small tsu, small ya/yu/yo, long vowels); kanji stay', () => {
    expect(romanize('きみのなまえは')).toBe('kiminonamaeha');
    expect(romanize('ちょっと')).toBe('chotto');
    expect(romanize('コーヒー')).toBe('koohii');
    expect(romanize('ファイト')).toBe('faito');
    expect(romanize('君の名は')).toBe('君 no 名 ha');
  });
  it('Cyrillic and Greek, keeping capitals; Latin text untouched', () => {
    expect(romanize('Я тебя люблю')).toBe('Ya tebya lyublyu');
    expect(romanize('Καλημέρα')).toBe('Kalimera');
    expect(romanize('BTS 방탄소년단 Dynamite')).toBe('BTS bangtansonyeondan Dynamite');
    expect(romanize('hello world')).toBe('hello world');
  });
  it('the script worth showing in Latin letters, or none', () => {
    expect(scriptOf(['사랑해요 너를', 'oh yeah'])).toBe('ko');
    expect(scriptOf(['君の名は。', 'きみのなまえは'])).toBe('ja');
    expect(scriptOf(['Я тебя люблю'])).toBe('ru');
    expect(scriptOf(['hello world baby'])).toBe(null);
    expect(scriptOf(['a long english song with one 사 in it, really long text here'])).toBe(null);
    expect(scriptOf([])).toBe(null);
  });
});

describe('what goes under each line', () => {
  it('Latin letters only when the lyrics need them; Spanish asks before sending anything', async () => {
    render(<LyricsModes extra="none" script={null} />);
    expect(screen.queryByRole('radio', { name: 'En letras latinas' })).toBe(null);
    globalThis.fetch = vi.fn(async () => json({ perf: 'mid', translate: false }));
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'En español' })); });
    const d = useUi.getState().dialog;
    expect(d.kind).toBe('confirm');
    expect(d.text).toMatch(/Google Translate/);
    expect(useLyricsPrefs.getState().extra).toBe('none');
    // Yes: allowed on the server, then chosen.
    globalThis.fetch = vi.fn(async () => json({ perf: 'mid', translate: true }));
    await act(async () => { await d.onConfirm(); });
    expect(globalThis.fetch.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ translate: true });
    expect(useLyricsPrefs.getState().extra).toBe('trans');
  });
  it('once allowed, straight away; anything unknown is ignored', async () => {
    useLyricsPrefs.setState({ translate: true });
    const ask = vi.fn();
    await chooseExtra('trans', ask);
    expect(ask).not.toHaveBeenCalled();
    expect(useLyricsPrefs.getState().extra).toBe('trans');
    await chooseExtra('evil', ask);
    expect(useLyricsPrefs.getState().extra).toBe('trans');
    expect(JSON.parse(localStorage.getItem('rumoria_lyrics'))).toEqual({ extra: 'trans' });
  });
});

describe('smart lists', () => {
  it('how their rules read', () => {
    expect(describeRules({ ...EMPTY_RULES, notHeardDays: 90 })).toBe('Tus favoritas · sin escuchar en 90 días');
    expect(describeRules({ ...EMPTY_RULES, from: 'all', minPlays: 1, artist: 'Ana' })).toBe('Favoritas y lo que has escuchado · al menos 1 vez · con «Ana»');
    expect(describeRules(null)).toBe('');
  });
});

describe('the alarm clock', () => {
  const at = (d, h, m) => new Date(2026, 9, d, h, m); // October 2026: the 12th is a Monday
  it('only known values', () => {
    expect(cleanAlarm({ on: 'yes', time: '25:00', days: [0, 0, 9, 2], source: 'evil', list: '../x', ramp: 7, volume: 3, last: 'x' }))
      .toEqual({ ...DEFAULT_ALARM, days: [0, 2] });
  });
  it('rings on its days, within 10 minutes of its time, once a day', () => {
    const a = { ...DEFAULT_ALARM, on: true, time: '07:30', days: [0] };
    expect(isDue(a, at(12, 7, 29))).toBe(false);
    expect(isDue(a, at(12, 7, 30))).toBe(true);
    expect(isDue(a, at(12, 7, 39))).toBe(true);
    expect(isDue(a, at(12, 7, 41))).toBe(false);
    expect(isDue(a, at(13, 7, 30))).toBe(false, 'Tuesday is not one of its days');
    expect(isDue({ ...a, last: '2026-10-12' }, at(12, 7, 31))).toBe(false);
    expect(isDue({ ...a, on: false }, at(12, 7, 31))).toBe(false);
  });
  it('says when it will ring next', () => {
    const a = { ...DEFAULT_ALARM, on: true, time: '07:30', days: [0, 1, 2, 3, 4] };
    expect(nextRing(a, at(11, 12, 0)).getDate()).toBe(12); // Sunday → Monday
    expect(nextText(a, at(11, 12, 0))).toMatch(/^Sonará mañana a las 07:30/);
    expect(nextText(a, at(10, 12, 0))).toMatch(/^Sonará el lunes/);
    expect(nextText({ ...a, days: [] }, at(10, 12, 0))).toBe('Elige al menos un día.');
  });
  it('puts on what was chosen and raises the volume little by little; your own change stops it', async () => {
    vi.useFakeTimers();
    try {
      let now = at(12, 7, 30);
      useAlarm.setState({ ...DEFAULT_ALARM, on: true, days: [0], ramp: 1, volume: 0.6 });
      usePlayer.setState({ volume: 0.9, queue: startQueue([]), wantPlaying: false });
      const tracksFor = vi.fn(async () => [{ key: 'yt:aaaaaaaaaaa', yt: 'aaaaaaaaaaa', title: 'Uno' }]);
      const stop = startAlarm({ tracksFor, now: () => now, every: 1000 });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(tracksFor).toHaveBeenCalledTimes(1);
      expect(usePlayer.getState().current().title).toBe('Uno');
      expect(usePlayer.getState().volume).toBe(START_VOLUME);
      expect(useAlarm.getState().last).toBe('2026-10-12');
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      const mid = usePlayer.getState().volume;
      expect(mid).toBeGreaterThan(0.2);
      expect(mid).toBeLessThan(0.6);
      await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
      expect(usePlayer.getState().volume).toBeCloseTo(0.6);
      // Once a day.
      now = at(12, 7, 35);
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(tracksFor).toHaveBeenCalledTimes(1);
      stop();
    } finally { vi.useRealTimers(); }
  });
});

describe('"Modo sesión"', () => {
  /** A click every `beat` seconds over a little noise, at `rate` samples per second. */
  function clicks(bpm, secs, rate = 11025, loud = 0.5) {
    const out = new Float32Array(Math.floor(secs * rate));
    const every = Math.round((60 / bpm) * rate);
    let seed = 1;
    for (let i = 0; i < out.length; i++) {
      seed = (seed * 16807) % 2147483647;
      out[i] = ((seed / 2147483647) - 0.5) * 0.02;
      if (i % every < 300) out[i] += loud * Math.sin(i / 3) * (1 - (i % every) / 300);
    }
    return out;
  }
  it('finds the tempo of a steady beat', () => {
    expect(Math.abs(measure(clicks(120, 30), 11025).bpm - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(measure(clicks(90, 30), 11025).bpm - 90)).toBeLessThanOrEqual(2);
    expect(tempoOf([1, 0, 1], 20)).toBe(null);
  });
  it('louder and faster is more energy; silence is nothing', () => {
    const calm = measure(clicks(80, 30, 11025, 0.05), 11025);
    const busy = measure(clicks(150, 30, 11025, 0.9), 11025);
    expect(busy.energy).toBeGreaterThan(calm.energy);
    expect(measure(new Float32Array(11025 * 10), 11025)).toBe(null);
  });
  it('a guess from the title when it cannot listen', () => {
    expect(guess({ title: 'Canción (Acoustic)' }).energy).toBeLessThan(guess({ title: 'Canción (Remix)' }).energy);
    expect(guess({ title: 'x' }).guessed).toBe(true);
  });
  it('orders: rising, falling, a wave, and without jumps', () => {
    const s = (uid, energy, bpm = 120) => ({ uid, f: { energy, bpm } });
    const songs = [s(1, 0.9), s(2, 0.1), s(3, 0.5), s(4, 0.7), s(5, 0.3)];
    expect(orderFor(songs, 'rise')).toEqual([2, 5, 3, 4, 1]);
    expect(orderFor(songs, 'fall')).toEqual([1, 4, 3, 5, 2]);
    expect(orderFor(songs, 'wave')).toEqual([2, 3, 1, 4, 5]);
    expect(orderFor(songs, 'smooth', { energy: 0.1, bpm: 120 })).toEqual([2, 5, 3, 4, 1]);
    // Half and double tempo are close.
    expect(distance({ energy: 0.5, bpm: 70 }, { energy: 0.5, bpm: 140 })).toBe(0);
    expect(distance({ energy: 0.5, bpm: 70 }, { energy: 0.5, bpm: 100 })).toBeGreaterThan(1);
  });
  it('listens to the next songs and plans; the queue takes the new order after the current one', async () => {
    const items = startQueue([{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }], 0).items;
    const energy = { a: 0.5, b: 0.9, c: 0.1, d: 0.6 };
    const progress = [];
    const plan = await planSession(items.slice(1), items[0], 'rise', { analyzeImpl: async (t) => ({ energy: energy[t.title], bpm: null }), onProgress: (d, n) => progress.push(`${d}/${n}`) });
    expect(progress).toEqual(['1/3', '2/3', '3/3']);
    const q = reorderUpcoming({ items, index: 0, original: [...items] }, plan.uids);
    expect(q.items.map((t) => t.title)).toEqual(['a', 'c', 'd', 'b']);
    expect(q.original).toBe(null);
    expect(await planSession(items, null, 'rise', { stopped: () => true, analyzeImpl: async () => ({ energy: 0 }) })).toBe(null);
  });
});

describe('the YouTube notice', () => {
  it('says what is going on, only when songs are failing', () => {
    expect(noticeText(null)).toBe(null);
    expect(noticeText({ trouble: false, updating: true })).toBe(null);
    expect(noticeText({ trouble: true, updating: true })).toMatch(/actualizando yt-dlp/);
    expect(noticeText({ trouble: true, last: 'updated', version: '2026.10.10' })).toMatch(/2026\.10\.10/);
    expect(noticeText({ trouble: true, last: 'current' })).toMatch(/más nuevo/);
    expect(noticeText({ trouble: true, last: 'failed' })).toMatch(/conexión/);
  });
});

describe('Estadísticas', () => {
  afterEach(() => { delete window.rumoria; });
  it('the streak, this week, the charts, and the genres as a table', async () => {
    const weeks = Array.from({ length: 52 }, (_, i) => ({ start: Date.UTC(2025, 9, 13) + i * 7 * 86400000, secs: i === 51 ? 3600 : i === 50 ? 1800 : 0, plays: i === 51 ? 12 : 0 }));
    const heatmap = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (__, h) => (d === 4 && h === 22 ? 900 : 0)));
    globalThis.fetch = vi.fn(async () => json({
      weeks, heatmap, count: 10, paused: false,
      streak: { current: 3, best: 9, bestEnd: Date.UTC(2026, 5, 1), today: false, days365: 40 },
      genres: { genres: ['rock'], names: { rock: 'Rock de siempre' }, months: [{ year: 2026, month: 9, shares: { rock: 0.75 }, other: 0.25, known: true }] },
    }));
    render(<Stats />);
    expect(await screen.findByText('3 días')).toBeInTheDocument();
    expect(screen.getByText('escucha algo hoy para no perderla')).toBeInTheDocument();
    expect(screen.getByText('+100 % que la semana pasada')).toBeInTheDocument();
    expect(screen.getByText(/sobre todo los viernes a las 22:00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver como tabla' }));
    expect(screen.getByRole('columnheader', { name: 'Rock de siempre' })).toBeInTheDocument();
    expect(screen.getByText('75 %')).toBeInTheDocument();
    expect(duration(3600 * 3 + 20 * 60)).toBe('3 h 20 min');
    expect(duration(120)).toBe('2 min');
  });
});

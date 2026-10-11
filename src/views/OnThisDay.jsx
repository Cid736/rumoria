// v1.7, "Tal día como hoy": what you were listening to on this date one, two
// and three years ago (that very day, or that week when the day itself had
// little) — a shelf on Inicio and a page per year.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fromSaved } from '../lib/tracks.js';
import { useLibrary } from '../store/library.js';
import Collection, { BigCover } from './Collection.jsx';

const tz = () => new Date().getTimezoneOffset();
let kept = { at: 0, day: '', years: null };

/** This date's years (kept a few minutes, and only for today). */
export async function onThisDay(get = api.get) {
  const day = new Date().toDateString();
  if (kept.years && kept.day === day && Date.now() - kept.at < 10 * 60_000) return kept.years;
  const r = await get(`/api/history/onthisday?tz=${tz()}`);
  kept = { at: Date.now(), day, years: Array.isArray(r.years) ? r.years : [] };
  return kept.years;
}

export const yearsAgo = (n) => (n === 1 ? 'Hace 1 año' : `Hace ${n} años`);
export const whenOf = (y) => `${new Date(y.day).toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })}${y.exact ? '' : ' (esa semana)'}`;

/** A year's songs, as the player takes them (your files only if they're still in your folder). */
export function tracksOfYear(y, local) {
  const map = new Map(((local && local.songs) || []).map((f) => [f.key, f]));
  return y.songs.map((s) => fromSaved(s, map)).filter(Boolean);
}

/** The years with something on this date (for the shelf), or [] until they're known. */
export function useOnThisDay() {
  const [years, setYears] = useState(kept.day === new Date().toDateString() && kept.years ? kept.years : []);
  useEffect(() => {
    let gone = false;
    onThisDay().then((y) => { if (!gone) setYears(y); }, () => {});
    return () => { gone = true; };
  }, []);
  return years;
}

export function OnThisDayPage({ id }) {
  const local = useLibrary((s) => s.local);
  const [years, setYears] = useState(null);
  useEffect(() => {
    let gone = false;
    onThisDay().then((y) => { if (!gone) setYears(y); }, () => { if (!gone) setYears([]); });
    return () => { gone = true; };
  }, []);
  const y = years && years.find((x) => String(x.yearsAgo) === String(id));
  if (!years) return <Collection kind="Tal día como hoy" name={yearsAgo(Number(id) || 1)} tracks={[]} loading />;
  if (!y) return <p className="muted pad">Ese día no hay nada en tu historial.</p>;
  const tracks = tracksOfYear(y, local);
  const thumbs = [...new Set(tracks.map((t) => t.thumbnail).filter(Boolean))].slice(0, 4);
  return (
    <Collection kind="Tal día como hoy" name={yearsAgo(y.yearsAgo)} sub={`Lo que escuchabas el ${whenOf(y)}`} cover={<BigCover thumbs={thumbs} src={thumbs[0]} name={yearsAgo(y.yearsAgo)} />}
      tracks={tracks} recent={{ kind: 'onthisday', id: String(y.yearsAgo), name: `Tal día como hoy · ${yearsAgo(y.yearsAgo).toLowerCase()}`, sub: whenOf(y) }} />
  );
}

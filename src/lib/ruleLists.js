// v1.7, smart lists: the rules a list is made of, how they read, and a few
// ready to use. The server keeps only the rules and works the songs out from
// your favourites and history each time (server/lib/rulelists.js).
export const FROM = [['likes', 'Tus favoritas'], ['heard', 'Lo que has escuchado'], ['all', 'Favoritas y lo que has escuchado']];
export const SORTS = [['plays', 'Las más escuchadas primero'], ['recent', 'Escuchadas hace menos primero'], ['oldest', 'Escuchadas hace más primero'], ['added', 'Añadidas a Favoritas hace menos primero'], ['title', 'Por título'], ['random', 'Al azar (cambia cada vez)']];
export const LIMITS = [25, 50, 100, 200, 500];
// [rule, label before the number, label after it, default value]
export const NUMBER_RULES = [
  ['minPlays', 'Escuchada al menos', 'veces', 20],
  ['maxPlays', 'Escuchada como mucho', 'veces', 1],
  ['notHeardDays', 'Sin escuchar en los últimos', 'días', 90],
  ['heardDays', 'Escuchada en los últimos', 'días', 30],
  ['addedDays', 'Añadida a Favoritas en los últimos', 'días', 30],
];

export const EMPTY_RULES = { from: 'likes', minPlays: null, maxPlays: null, notHeardDays: null, heardDays: null, addedDays: null, artist: '', sort: 'plays', limit: 100 };

export const PRESETS = [
  { name: 'Favoritas olvidadas', hint: 'Favoritas que no oyes desde hace 3 meses', rules: { ...EMPTY_RULES, notHeardDays: 90, sort: 'random' } },
  { name: 'Más de 20 reproducciones', hint: 'Las que más has puesto', rules: { ...EMPTY_RULES, from: 'all', minPlays: 20, sort: 'plays' } },
  { name: 'Añadidas este mes', hint: 'Favoritas de los últimos 30 días', rules: { ...EMPTY_RULES, addedDays: 30, sort: 'added' } },
  { name: 'Oídas una vez', hint: 'Sonaron una vez y no han vuelto', rules: { ...EMPTY_RULES, from: 'heard', maxPlays: 1, notHeardDays: 14, sort: 'oldest' } },
  { name: 'En bucle', hint: 'Lo que más suena estas dos semanas', rules: { ...EMPTY_RULES, from: 'all', minPlays: 3, heardDays: 14, sort: 'plays', limit: 50 } },
];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "Tus favoritas · sin escuchar en 90 días · al menos 3 veces". */
export function describeRules(r) {
  if (!r) return '';
  const parts = [(FROM.find(([k]) => k === r.from) || FROM[0])[1]];
  if (Number.isInteger(r.minPlays)) parts.push(`al menos ${plural(r.minPlays, 'vez', 'veces')}`);
  if (Number.isInteger(r.maxPlays)) parts.push(`como mucho ${plural(r.maxPlays, 'vez', 'veces')}`);
  if (Number.isInteger(r.notHeardDays)) parts.push(`sin escuchar en ${plural(r.notHeardDays, 'día', 'días')}`);
  if (Number.isInteger(r.heardDays)) parts.push(`escuchadas en ${plural(r.heardDays, 'día', 'días')}`);
  if (Number.isInteger(r.addedDays)) parts.push(`añadidas en ${plural(r.addedDays, 'día', 'días')}`);
  if (r.artist) parts.push(`con «${r.artist}»`);
  return parts.join(' · ');
}

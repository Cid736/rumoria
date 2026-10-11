// v1.7: lyrics in Latin letters, to sing along with K-pop, J-pop, anime or a
// Russian song: Korean (Hangul, Revised Romanization), Japanese kana
// (Hepburn), Cyrillic and Greek. Worked out here, without asking anyone. It's
// an approximation: Japanese kanji need a dictionary to be read, so they stay
// as they are, and Korean sound changes beyond the basic linking aren't applied.

// ---- Korean: a syllable block is initial + vowel + final ----
const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const VOWELS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const FINALS = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
// A final before a silent initial (ㅇ) is sounded as the next syllable's start: 먹어 → meogeo.
const LINKED = { 1: 'g', 2: 'kk', 4: 'n', 7: 'd', 8: 'r', 16: 'm', 17: 'b', 19: 's', 20: 'ss', 22: 'j', 23: 'ch', 24: 'k', 25: 't', 26: 'p', 27: '' };
const SILENT = 11;
const isHangul = (c) => c >= 0xac00 && c <= 0xd7a3;

function hangul(text) {
  const chars = [...text];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i].codePointAt(0);
    if (!isHangul(c)) { out += chars[i]; continue; }
    const s = c - 0xac00;
    const ini = Math.floor(s / 588);
    const vow = Math.floor((s % 588) / 28);
    const fin = s % 28;
    const head = INITIALS[ini];
    const next = i + 1 < chars.length ? chars[i + 1].codePointAt(0) : 0;
    const nextSilent = isHangul(next) && Math.floor((next - 0xac00) / 588) === SILENT;
    if (fin && nextSilent && Object.hasOwn(LINKED, fin)) out += `${head}${VOWELS[vow]}${LINKED[fin]}`;
    else if (fin === 8 && isHangul(next) && Math.floor((next - 0xac00) / 588) === 5) out += `${head}${VOWELS[vow]}l`; // ㄹ+ㄹ → ll
    else out += `${head}${VOWELS[vow]}${FINALS[fin]}`;
  }
  return out;
}

// ---- Japanese kana (katakana read as hiragana) ----
const KANA = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko', さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to', な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo', ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo', だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo', ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゎ: 'wa', ゃ: 'ya', ゅ: 'yu', ょ: 'yo',
};
const SMALL_Y = { ゃ: 'a', ゅ: 'u', ょ: 'o' };
const SMALL_V = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' };
const toHira = (ch) => { const c = ch.codePointAt(0); return c >= 0x30a1 && c <= 0x30f6 ? String.fromCodePoint(c - 0x60) : ch; };
const isKana = (ch) => /[ぁ-ゖァ-ヺー]/u.test(ch);

function kana(text) {
  const chars = [...text].map(toHira);
  let out = '';
  let double = false; // っ: the next consonant twice
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === 'っ') { double = true; continue; }
    if (ch === 'ー') { const v = /[aeiou]$/.exec(out); if (v) out += v[0]; continue; }
    let r = KANA[ch];
    if (r === undefined) { out += ch; double = false; continue; }
    const next = chars[i + 1];
    // きゃ → kya, しゃ → sha, ちょ → cho, じゅ → ju.
    if (next && SMALL_Y[next] && r.endsWith('i') && r.length > 1) {
      r = /^(sh|ch|j)i$/.test(r) ? r.slice(0, -1) + SMALL_Y[next] : `${r.slice(0, -1)}y${SMALL_Y[next]}`;
      i++;
    } else if (next && SMALL_V[next]) {
      // ファ → fa, ティ → ti, チェ → che, ウィ → wi (katakana for foreign sounds).
      r = r === 'u' ? `w${SMALL_V[next]}` : r.slice(0, -1) + SMALL_V[next];
      i++;
    }
    if (double) { out += r.startsWith('ch') ? 't' : r[0]; double = false; }
    out += r;
  }
  return out;
}

// ---- Cyrillic (Russian, Ukrainian, Belarusian, Bulgarian) and Greek ----
const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
  т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'w',
};
const GREEK = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's',
  τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};
function letters(text, table) {
  let out = '';
  for (const ch of text) {
    const low = ch.toLowerCase();
    // Greek accents (ά, ή…) are the plain letter plus a mark.
    const base = Object.hasOwn(table, low) ? low : low.normalize('NFD')[0];
    const r = Object.hasOwn(table, base) ? table[base] : null;
    if (r === null) { out += ch; continue; }
    out += ch !== low && r ? r[0].toUpperCase() + r.slice(1) : r;
  }
  return out;
}

const SCRIPTS = {
  ko: /[가-힣]/gu,
  ja: /[ぁ-ゖァ-ヺ]/gu,
  ru: /[Ѐ-ӿ]/gu,
  el: /[Ͱ-Ͽ]/gu,
};

/**
 * The script of these lines that can be shown in Latin letters ('ko', 'ja',
 * 'ru' or 'el'), or null when there's none worth it (Latin letters already,
 * or only a stray word).
 */
export function scriptOf(lines) {
  const text = (Array.isArray(lines) ? lines.join(' ') : String(lines || ''));
  const all = (text.match(/\p{L}/gu) || []).length;
  if (!all) return null;
  let best = null;
  let most = 0;
  for (const [k, re] of Object.entries(SCRIPTS)) {
    const n = (text.match(re) || []).length;
    if (n > most) { most = n; best = k; }
  }
  return most >= 4 && most / all >= 0.15 ? best : null;
}

/** One line in Latin letters (whatever of it can be: kanji and the rest stay). */
export function romanize(line) {
  let s = String(line || '');
  if (/[가-힣]/u.test(s)) s = hangul(s);
  if (/[ぁ-ゖァ-ヺー]/u.test(s)) s = spacedKana(s);
  s = letters(s, CYRILLIC);
  s = letters(s, GREEK);
  return s.replace(/\s+/g, ' ').trim();
}

/** Kana runs read, with a space where they meet other writing (kanji, Latin). */
function spacedKana(s) {
  const parts = [];
  let run = '';
  let kanaRun = null;
  for (const ch of s) {
    const k = isKana(ch) || ch === 'っ' || ch === 'ッ';
    if (kanaRun === null || k === kanaRun) { run += ch; kanaRun = k; continue; }
    parts.push(kanaRun ? kana(run) : run);
    run = ch;
    kanaRun = k;
  }
  if (run) parts.push(kanaRun ? kana(run) : run);
  return parts.reduce((acc, p) => (!acc ? p : /[\s]$/.test(acc) || /^[\s.,!?、。！？]/.test(p) ? acc + p : `${acc} ${p}`), '');
}

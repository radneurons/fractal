// Syllables (SPEC §5, §5A.1): counting, splitting (Liang patterns + heuristic) and timing inside a word.
import hyphenEn from 'hyphen/en-us/index.js';
import type { Analysis, Syllable, Word } from '../types.ts';
import { pitchPlateaus } from '../analysis/pitch.ts';
import { lowerBound } from '../analysis/dsp.ts';

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;
const CYRILLIC = /[Ѐ-ӿ]/;
const LATIN = /[a-zÀ-ɏ]/i;

const EXCEPTIONS: Record<string, number> = {
  fire: 1, fires: 1, hour: 1, hours: 1, our: 1, every: 2, everything: 3, everyone: 3, heaven: 2, even: 2, evening: 2,
  being: 2, seeing: 2, going: 2, doing: 2, idea: 3, area: 3, real: 1, really: 2, people: 2, little: 2, middle: 2,
  different: 2, family: 3, beautiful: 3, business: 2, chocolate: 2, comfortable: 3, favorite: 3, interesting: 3,
  camera: 3, memory: 3, history: 3, mystery: 3, wednesday: 2, sometimes: 2, something: 2, someone: 2, somewhere: 2,
  lonely: 2, lovely: 2, quiet: 2, science: 2, poem: 2, poet: 2, lion: 2, riot: 2, giant: 2, diamond: 2, violet: 2,
  create: 2, created: 3, ocean: 2, once: 1, one: 1, eye: 1, eyes: 1, are: 1, were: 1, where: 1, there: 1, here: 1,
  the: 1, me: 1, he: 1, she: 1, we: 1, be: 1, maybe: 2, recipe: 3, simile: 3, cafe: 2, fiance: 3, yeah: 1, ooh: 1, aah: 1, ahh: 1,
  tired: 1, wired: 1, desire: 2, higher: 2, flower: 2, power: 2, tower: 2, prayer: 1, world: 1, girl: 1, rhythm: 2,
  trying: 2, crying: 2, flying: 2, dying: 2, lying: 2, waiting: 2, breathe: 1, breathed: 1, loved: 1, lived: 1, moved: 1,
  used: 1, closed: 1, hoped: 1, named: 1, changed: 1, called: 1, turned: 1, burned: 1, learned: 1, seemed: 1,
  wanted: 2, needed: 2, started: 2, ended: 2, waited: 2, faded: 2, hundred: 2, naked: 2, wicked: 2, sacred: 2, blessed: 1,
  again: 2, against: 2, away: 2, alive: 2, alone: 2, above: 2, around: 2, eyed: 1, fuel: 2, cruel: 2, jewel: 2, poetry: 3,
};

/** Heuristic syllable count for a normalised word. */
export function countSyllables(text: string): number {
  if (!text) return 1;
  const chars = Array.from(text);
  if (CJK.test(text)) return Math.max(1, chars.filter((c) => CJK.test(c)).length);
  if (CYRILLIC.test(text)) return Math.max(1, (text.match(/[аеёиоуыэюяіїєў]/gi) ?? []).length);
  if (!LATIN.test(text)) return Math.max(1, Math.round(chars.filter((c) => /\p{L}/u.test(c)).length / 2.5));
  const w = text.toLowerCase().replace(/[^a-zÀ-ɏ']/g, '');
  if (!w) return 1;
  // hyphenated compounds
  if (EXCEPTIONS[w] !== undefined) return EXCEPTIONS[w];
  const base = w.replace(/'s$/, '').replace(/'/g, '');
  if (EXCEPTIONS[base] !== undefined) return EXCEPTIONS[base];
  if (base.length <= 2) return 1;
  let s = base.normalize('NFD').replace(/[̀-ͯ]/g, '');
  let n = (s.match(/[aeiouy]+/g) ?? []).length;
  // silent final e ("gate", "broke") but not "-le" after a consonant ("little") or "ee"
  if (/[^aeiouy]e$/.test(s) && !/[^aeiouy]le$/.test(s) && n > 1) n--;
  // "-ed" is silent unless after t/d; "-es" silent unless after a sibilant
  if (/[^aeiouytd]ed$/.test(s) && n > 1) n--;
  if (/[^aeiouysxzh]es$/.test(s) && n > 1 && !/[^aeiouy]les$/.test(s)) n--;
  // common hiatus
  if (/(ia|io|iu|eo|ua|uo)/.test(s) && !/(tion|sion|cial|tial|cious|tious|gion|quo|qua|gua)/.test(s)) n++;
  if (/[^aeiou]y[aeiou]/.test(s)) n += 0;
  return Math.max(1, n);
}

const DIGRAPH = /^(th|sh|ch|ph|ng|ck|qu|wh|gh)/;

/** Split a display word into K syllable pieces (covering all its characters). */
export function splitSyllables(display: string, k?: number): string[] {
  const core = display.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const lead = display.slice(0, display.indexOf(core)), trail = display.slice(display.indexOf(core) + core.length);
  const wrap = (parts: string[]) => {
    if (!parts.length) return [display];
    parts[0] = lead + parts[0];
    parts[parts.length - 1] += trail;
    return parts;
  };
  if (!core) return [display];
  if (CJK.test(core)) return wrap(Array.from(core));
  const K = k ?? countSyllables(core);
  if (K <= 1 || !LATIN.test(core)) return [display];
  // 1) TeX hyphenation patterns
  let parts: string[] = [];
  try {
    parts = hyphenEn.hyphenateSync(core, { hyphenChar: '\u0001', minWordLength: 3 }).split('\u0001').filter(Boolean);
  } catch { parts = [core]; }
  if (parts.length === K) return wrap(parts);
  // 2) vowel-group heuristic: V-CV, VC-CV, keeping digraphs together
  const lower = core.toLowerCase();
  const isV = (c: string) => /[aeiouyà-öø-ÿ]/.test(c);
  const groups: [number, number][] = [];
  for (let i = 0; i < lower.length;) {
    if (isV(lower[i])) { let j = i; while (j < lower.length && isV(lower[j])) j++; groups.push([i, j]); i = j; } else i++;
  }
  // drop a silent final e as a nucleus
  if (groups.length > K && /[^aeiouy]e$/.test(lower)) groups.pop();
  while (groups.length > K) {
    // merge the two closest nuclei
    let bi = 0, bd = Infinity;
    for (let i = 0; i + 1 < groups.length; i++) { const d = groups[i + 1][0] - groups[i][1]; if (d < bd) { bd = d; bi = i; } }
    groups.splice(bi, 2, [groups[bi][0], groups[bi + 1][1]]);
  }
  if (groups.length < K) {
    // fewer vowel groups than syllables (hiatus like "quiet"): fall back to an even split
    const out: string[] = [];
    const per = core.length / K;
    for (let i = 0; i < K; i++) out.push(core.slice(Math.round(i * per), Math.round((i + 1) * per)));
    return wrap(out.filter(Boolean));
  }
  const cuts: number[] = [];
  for (let i = 0; i + 1 < groups.length; i++) {
    const a = groups[i][1], b = groups[i + 1][0];
    const cons = b - a;
    let cut: number;
    if (cons <= 0) cut = a;
    else if (cons === 1) cut = a;
    else if (DIGRAPH.test(lower.slice(a, b)) && cons === 2) cut = a;
    else cut = a + 1;
    cuts.push(cut);
  }
  const out: string[] = [];
  let prev = 0;
  for (const c of cuts) { out.push(core.slice(prev, c)); prev = c; }
  out.push(core.slice(prev));
  return wrap(out.filter(Boolean));
}

/** Relative vowel length: long vowels / diphthongs / open syllables 1.5, closed short syllables 1. */
function vowelWeight(piece: string): number {
  const p = piece.toLowerCase().replace(/[^a-z]/g, '');
  if (/(ee|ea|oo|ai|ay|ou|ow|oi|oy|ie|igh|au|aw|ue|ui)/.test(p)) return 1.5;
  if (/[aeiouy]$/.test(p)) return 1.5;
  if (/[aeiou][^aeiou]e$/.test(p)) return 1.5;
  return 1;
}

/**
 * Time K syllables inside [start, end]. Boundary candidates are vocal onsets and pitch-plateau
 * changes; K−1 are chosen by dynamic programming against a vowel-length prior.
 */
export function timeSyllables(pieces: string[], start: number, end: number, candidates: number[], melisma = false): Syllable[] {
  const K = pieces.length;
  const dur = Math.max(0.03, end - start);
  if (K <= 1) return [{ text: pieces[0] ?? '', start, end }];
  const w = pieces.map(vowelWeight);
  const prior: number[] = [];
  if (melisma) {
    // the last syllable takes the remaining span
    const each = Math.min(0.24, (dur * 0.6) / (K - 1));
    for (let i = 1; i < K; i++) prior.push(start + each * i);
  } else {
    const tot = w.reduce((a, c) => a + c, 0);
    let acc = 0;
    for (let i = 0; i < K - 1; i++) { acc += w[i]; prior.push(start + (dur * acc) / tot); }
  }
  const cand = candidates.filter((t) => t > start + 0.04 && t < end - 0.04).sort((a, b) => a - b);
  const NB = K - 1, NC = cand.length;
  const avg = dur / K;
  const maxDev = Math.max(0.06, 0.45 * avg);
  const noCandCost = 0.4 * maxDev; // using the prior itself
  // dp[b][c] = best cost with boundary b at option c (c = NC means "prior")
  const INF = 1e9;
  const optTime = (b: number, c: number) => (c === NC ? prior[b] : cand[c]);
  const optCost = (b: number, c: number) => (c === NC ? noCandCost : Math.abs(cand[c] - prior[b]) > maxDev ? INF : Math.abs(cand[c] - prior[b]));
  let dp = new Float64Array(NC + 1), nx = new Float64Array(NC + 1);
  const back: Int32Array[] = [];
  for (let c = 0; c <= NC; c++) dp[c] = optCost(0, c);
  for (let b = 1; b < NB; b++) {
    const bk = new Int32Array(NC + 1).fill(-1);
    for (let c = 0; c <= NC; c++) {
      const tc = optTime(b, c), cc = optCost(b, c);
      let best = INF, bi = -1;
      if (cc < INF) {
        for (let p = 0; p <= NC; p++) {
          if (dp[p] >= INF) continue;
          if (tc - optTime(b - 1, p) < 0.05) continue; // strictly increasing, ≥ 50 ms apart
          if (dp[p] < best) { best = dp[p]; bi = p; }
        }
      }
      nx[c] = bi >= 0 ? best + cc : INF;
      bk[c] = bi;
    }
    back.push(bk);
    [dp, nx] = [nx, dp];
  }
  let ci = NC;
  for (let c = 0; c <= NC; c++) if (dp[c] < dp[ci]) ci = c;
  const bounds = new Array<number>(NB);
  if (dp[ci] >= INF) for (let b = 0; b < NB; b++) bounds[b] = prior[b];
  else for (let b = NB - 1; b >= 0; b--) { bounds[b] = optTime(b, ci); if (b > 0) ci = back[b - 1][ci]; }
  const out: Syllable[] = [];
  for (let i = 0; i < K; i++) out.push({ text: pieces[i], start: i === 0 ? start : bounds[i - 1], end: i === K - 1 ? end : bounds[i] });
  return out;
}

/** Candidate syllable boundaries inside a span: vocal onsets + pitch-plateau changes (≥ 80 cents). */
export function syllableCandidates(a: Analysis | null, start: number, end: number): number[] {
  if (!a) return [];
  const out: number[] = [];
  const on = a.vocalOnsets;
  for (let i = lowerBound(on, start); i < on.length && on[i] < end; i++) out.push(on[i]);
  const pl = pitchPlateaus(a.f0, start, end);
  for (let i = 1; i < pl.length; i++) if (Math.abs(pl[i].midi - pl[i - 1].midi) >= 0.8) out.push(0.5 * (pl[i - 1].end + pl[i].start));
  out.sort((x, y) => x - y);
  // merge candidates closer than 40 ms
  const merged: number[] = [];
  for (const t of out) { if (merged.length && t - merged[merged.length - 1] < 0.04) continue; merged.push(t); }
  return merged;
}

/** Fill `syllableTimes` for a word (tags win). */
export function assignSyllables(w: Word, a: Analysis | null): void {
  if (w.syllablesLocked && w.syllableTimes?.length) {
    // keep tagged starts, re-derive ends
    const s = w.syllableTimes;
    for (let i = 0; i < s.length; i++) s[i].end = i + 1 < s.length ? s[i + 1].start : w.end;
    return;
  }
  const pieces = splitSyllables(w.display, w.syllables);
  w.syllableTimes = timeSyllables(pieces, w.start, w.end, syllableCandidates(a, w.start, w.end), !!w.melisma);
}

// Key, key changes and chords (SPEC §4A.4).
import type { Chord } from '../types.ts';
import { clamp, nearest } from './dsp.ts';
import { timeToFrameEnergy } from './rhythm.ts';

// Krumhansl–Kessler probe-tone profiles
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a: ArrayLike<number>, b: ArrayLike<number>, shift: number): number {
  let ma = 0, mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
  ma /= 12; mb /= 12;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[(i + shift) % 12] - ma, y = b[i] - mb;
    ab += x * y; aa += x * x; bb += y * y;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

export interface KeyEstimate { tonic: number; mode: 'major' | 'minor'; confidence: number }

export function keyFromChroma(ch: ArrayLike<number>): KeyEstimate {
  let best = -2, second = -2, tonic = 0, mode: 'major' | 'minor' = 'major';
  for (let t = 0; t < 12; t++) {
    for (const m of ['major', 'minor'] as const) {
      const r = pearson(ch, m === 'major' ? KK_MAJOR : KK_MINOR, t);
      if (r > best) { second = best; best = r; tonic = t; mode = m; }
      else if (r > second) second = r;
    }
  }
  return { tonic, mode, confidence: clamp(best - second, 0, 1) };
}

/** Sum chroma over [f0, f1) weighted by harmonic energy. */
function sumChroma(chroma: Float32Array, harm: Float32Array, f0: number, f1: number): Float64Array {
  const out = new Float64Array(12);
  for (let i = Math.max(0, f0); i < Math.min(harm.length, f1); i++) {
    const w = harm[i];
    for (let c = 0; c < 12; c++) out[c] += chroma[i * 12 + c] * w;
  }
  return out;
}

export function estimateKey(
  chroma: Float32Array, harm: Float32Array, downbeats: number[], chords: Chord[] = [],
): { key: KeyEstimate; keyChanges: { t: number; tonic: number; mode: 'major' | 'minor' }[] } {
  const nF = harm.length;
  // a tonic is also where the harmony rests: bias the profile sum with chord-root durations
  const withRoots = (ch: Float64Array, a: number, b: number) => {
    if (!chords.length) return ch;
    let tot = 0;
    for (let c = 0; c < 12; c++) tot += ch[c];
    const out = Float64Array.from(ch);
    const roots = new Float64Array(12);
    let dur = 0;
    for (const c of chords) {
      if (c.quality === 'N') continue;
      const o = Math.min(b, c.end) - Math.max(a, c.start);
      if (o > 0) { roots[c.root] += o; dur += o; }
    }
    if (dur > 0) for (let c = 0; c < 12; c++) out[c] += 0.25 * tot * (roots[c] / dur);
    return out;
  };
  const dur = (nF * 256 + 1024) / 22050;
  const key = keyFromChroma(withRoots(sumChroma(chroma, harm, 0, nF), 0, dur));
  const keyChanges: { t: number; tonic: number; mode: 'major' | 'minor' }[] = [];
  const nBars = downbeats.length;
  if (nBars >= 24) {
    const fr = (t: number) => Math.round(timeToFrameEnergy(t));
    const prof = (m: string) => (m === 'major' ? KK_MAJOR : KK_MINOR);
    const local: KeyEstimate[] = [];
    for (let b = 0; b < nBars; b++) {
      const a = Math.max(0, b - 8), e = Math.min(nBars - 1, b + 8);
      local.push(keyFromChroma(withRoots(sumChroma(chroma, harm, fr(downbeats[a]), fr(downbeats[e])), downbeats[a], downbeats[e])));
    }
    // runs of the same tonic that persist ≥ 8 bars (a mode flip on one tonic is detection noise, not a modulation)
    const runs: { a: number; b: number; tonic: number; mode: 'major' | 'minor' }[] = [];
    for (let b = 0; b < nBars;) {
      let e = b, maj = 0;
      while (e < nBars && local[e].tonic === local[b].tonic) { if (local[e].mode === 'major') maj++; e++; }
      if (e - b >= 8) {
        const mode = maj * 2 >= e - b ? 'major' : 'minor';
        const last = runs[runs.length - 1];
        if (last && last.tonic === local[b].tonic) last.b = e;
        else runs.push({ a: b, b: e, tonic: local[b].tonic, mode });
      }
      b = e;
    }
    if (runs.length > 1) {
      let cur = runs[0];
      const first = cur;
      for (let r = 1; r < runs.length; r++) {
        const nx = runs[r];
        // locate the bar where 4 bars after fit the new key and 4 bars before fit the old one
        let at = nx.a, bestDiff = -Infinity;
        for (let c = Math.max(1, cur.b - 9); c <= Math.min(nBars - 2, nx.a + 9); c++) {
          const pre = sumChroma(chroma, harm, fr(downbeats[Math.max(0, c - 4)]), fr(downbeats[c]));
          const post = sumChroma(chroma, harm, fr(downbeats[c]), fr(downbeats[Math.min(nBars - 1, c + 4)]));
          const d = pearson(post, prof(nx.mode), nx.tonic) - pearson(post, prof(cur.mode), cur.tonic)
            + pearson(pre, prof(cur.mode), cur.tonic) - pearson(pre, prof(nx.mode), nx.tonic);
          if (d > bestDiff) { bestDiff = d; at = c; }
        }
        // the new key must clearly beat the old one over its own run
        const span = sumChroma(chroma, harm, fr(downbeats[at]), fr(downbeats[Math.min(nBars - 1, nx.b)]));
        const margin = pearson(span, prof(nx.mode), nx.tonic) - pearson(span, prof(cur.mode), cur.tonic);
        if (margin < 0.08) continue;
        keyChanges.push({ t: nearest(downbeats, downbeats[at]), tonic: nx.tonic, mode: nx.mode });
        cur = nx;
      }
      if (keyChanges.length) return { key: { tonic: first.tonic, mode: first.mode, confidence: key.confidence }, keyChanges };
    }
  }
  return { key, keyChanges };
}

const QUAL: { q: Chord['quality']; iv: number[]; extra: boolean }[] = [
  { q: 'maj', iv: [0, 4, 7], extra: false },
  { q: 'min', iv: [0, 3, 7], extra: false },
  { q: 'dim', iv: [0, 3, 6], extra: true },
  { q: 'aug', iv: [0, 4, 8], extra: true },
  { q: 'sus', iv: [0, 5, 7], extra: true },
];

/** Beat-synchronous chroma (median over each beat's frames). */
export function beatChromaMedian(chroma: Float32Array, nF: number, beats: number[], duration: number): Float32Array {
  const nB = beats.length;
  const out = new Float32Array(nB * 12);
  for (let b = 0; b < nB; b++) {
    const t0 = beats[b], t1 = b + 1 < nB ? beats[b + 1] : duration;
    const a0 = clamp(Math.round(timeToFrameEnergy(t0)), 0, nF - 1), a1 = clamp(Math.round(timeToFrameEnergy(t1)), a0 + 1, nF);
    const m = a1 - a0;
    const tmp = new Float32Array(m);
    for (let c = 0; c < 12; c++) {
      for (let i = 0; i < m; i++) tmp[i] = chroma[(a0 + i) * 12 + c];
      tmp.sort();
      out[b * 12 + c] = m % 2 ? tmp[(m - 1) / 2] : 0.5 * (tmp[m / 2 - 1] + tmp[m / 2]);
    }
  }
  return out;
}

export function estimateChords(beatChroma: Float32Array, beats: number[], duration: number): Chord[] {
  const nB = beats.length;
  if (!nB) return [];
  // states: 12 maj, 12 min, N
  const NS = 25;
  const emit = new Float32Array(nB * NS);
  const extraBest: (null | { q: Chord['quality']; root: number })[] = [];
  const tmpl = (root: number, iv: number[]) => {
    const t = new Float32Array(12);
    t[(root + iv[0]) % 12] = 1; t[(root + iv[1]) % 12] = 0.8; t[(root + iv[2]) % 12] = 0.9;
    return t;
  };
  const templates: Float32Array[] = [];
  for (const q of QUAL) for (let r = 0; r < 12; r++) templates.push(tmpl(r, q.iv));
  const cosT = (v: Float32Array, o: number, t: Float32Array) => {
    let ab = 0, aa = 0, bb = 0;
    for (let c = 0; c < 12; c++) { const x = v[o + c]; ab += x * t[c]; aa += x * x; bb += t[c] * t[c]; }
    return aa > 0 ? ab / Math.sqrt(aa * bb) : 0;
  };
  const flat = new Float32Array(12).fill(1);
  for (let b = 0; b < nB; b++) {
    // remove the chroma floor so sustained noise does not mask the triad
    const v = new Float32Array(12);
    let mn = Infinity, tot = 0;
    for (let c = 0; c < 12; c++) mn = Math.min(mn, beatChroma[b * 12 + c]);
    for (let c = 0; c < 12; c++) { v[c] = beatChroma[b * 12 + c] - 0.8 * mn; tot += v[c]; }
    let bestTri = 0;
    for (let s = 0; s < 24; s++) { const e = cosT(v, 0, templates[s]); emit[b * NS + s] = e; if (e > bestTri) bestTri = e; }
    emit[b * NS + 24] = tot < 1e-6 ? 1 : Math.min(0.5, cosT(v, 0, flat) * 0.6);
    let xb: null | { q: Chord['quality']; root: number } = null, xs = bestTri * 1.15;
    for (let qi = 2; qi < QUAL.length; qi++) for (let r = 0; r < 12; r++) {
      const e = cosT(v, 0, templates[qi * 12 + r]);
      if (e > xs) { xs = e; xb = { q: QUAL[qi].q, root: r }; }
    }
    extraBest.push(xb);
  }
  // Viterbi, self-transition 0.9
  const K = 14;
  const stay = Math.log(0.9), move = Math.log(0.1 / (NS - 1));
  let cost = new Float64Array(NS), next = new Float64Array(NS);
  const back = new Int8Array(nB * NS);
  for (let s = 0; s < NS; s++) cost[s] = K * emit[s];
  for (let b = 1; b < nB; b++) {
    let bi = 0;
    for (let s = 1; s < NS; s++) if (cost[s] > cost[bi]) bi = s;
    const bestMove = cost[bi] + move;
    for (let s = 0; s < NS; s++) {
      const st = cost[s] + stay;
      if (st >= bestMove || bi === s) { next[s] = st; back[b * NS + s] = s; }
      else { next[s] = bestMove; back[b * NS + s] = bi; }
      next[s] += K * emit[b * NS + s];
    }
    [cost, next] = [next, cost];
  }
  let s = 0;
  for (let k = 1; k < NS; k++) if (cost[k] > cost[s]) s = k;
  const path = new Int8Array(nB);
  for (let b = nB - 1; b >= 0; b--) { path[b] = s; s = back[b * NS + s]; }
  const chords: Chord[] = [];
  for (let b = 0; b < nB; b++) {
    const st = path[b];
    let root = st % 12, quality: Chord['quality'] = st === 24 ? 'N' : st < 12 ? 'maj' : 'min';
    const x = extraBest[b];
    if (x && st !== 24 && x.root === root) quality = x.q;
    if (st === 24) root = 0;
    const start = beats[b], end = b + 1 < nB ? beats[b + 1] : duration;
    const last = chords[chords.length - 1];
    if (last && last.root === root && last.quality === quality) last.end = end;
    else chords.push({ start, end, root, quality });
  }
  return chords;
}

/** distance of a chord root from the tonic on the circle of fifths, 0..1 */
export function tensionOf(root: number, tonic: number): number {
  const steps = (((root - tonic) * 7) % 12 + 12) % 12;
  return Math.min(steps, 12 - steps) / 6;
}

const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export function noteName(pc: number): string { return NOTE[((pc % 12) + 12) % 12]; }
export function chordName(c: Chord): string {
  if (c.quality === 'N') return '—';
  return noteName(c.root) + ({ maj: '', min: 'm', dim: '°', aug: '+', sus: 'sus', N: '' } as const)[c.quality];
}
export function keyName(k: { tonic: number; mode: string }): string { return `${noteName(k.tonic)} ${k.mode === 'major' ? 'maj' : 'min'}`; }

/** hue (degrees) = position on the circle of fifths × 30° */
export function keyHue(tonic: number): number { return ((((tonic * 7) % 12) + 12) % 12) * 30; }

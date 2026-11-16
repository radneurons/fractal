// Sections (Foote novelty + clustering), repetition stripes, labels and drops (SPEC §4, §4A.6).
import type { Section, SectionLabel } from '../types.ts';
import { clamp, mean, nearest, sample, lowerBound, FRAME_RATE, percentile } from './dsp.ts';
import type { BeatFeatures } from './rhythm.ts';

function l2rows(m: Float32Array, n: number, d: number): Float32Array {
  const out = new Float32Array(m.length);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < d; c++) s += m[i * d + c] ** 2;
    s = Math.sqrt(s) || 1;
    for (let c = 0; c < d; c++) out[i * d + c] = m[i * d + c] / s;
  }
  return out;
}

function zscoreCols(m: Float32Array, n: number, d: number): Float32Array {
  const out = new Float32Array(m.length);
  for (let c = 0; c < d; c++) {
    let mu = 0;
    for (let i = 0; i < n; i++) mu += m[i * d + c];
    mu /= n || 1;
    let sd = 0;
    for (let i = 0; i < n; i++) sd += (m[i * d + c] - mu) ** 2;
    sd = Math.sqrt(sd / (n || 1)) || 1;
    for (let i = 0; i < n; i++) out[i * d + c] = (m[i * d + c] - mu) / sd;
  }
  return out;
}

export interface Repeat { a: number; b: number; len: number }

export interface StructureInput {
  beats: number[];
  downbeats: number[];
  bf: BeatFeatures;
  duration: number;
  /** normalised loudness at 60 fps */
  loud: Float32Array;
  perBar: number;
}

export function footeBoundaries(inp: StructureInput): number[] {
  const { beats, bf } = inp;
  const nB = beats.length;
  if (nB < 24) return [];
  const C = l2rows(bf.chroma, nB, 12);
  const T = l2rows(zscoreCols(bf.timbre, nB, 12), nB, 12);
  // bar-smoothed band levels: arrangement density (a chorus is often the verse's instruments, denser)
  const D = new Float32Array(nB * 7);
  for (let i = 0; i < nB; i++) {
    const a0 = Math.max(0, i - 1), a1 = Math.min(nB - 1, i + 2);
    for (let q = 0; q < 7; q++) {
      let s = 0;
      for (let k = a0; k <= a1; k++) s += bf.bandDb[k * 7 + q];
      D[i * 7 + q] = s / (a1 - a0 + 1);
    }
  }
  const sim = (i: number, j: number) => {
    let a = 0, b = 0, d = 0;
    const io = i * 12, jo = j * 12;
    for (let c = 0; c < 12; c++) { a += C[io + c] * C[jo + c]; b += T[io + c] * T[jo + c]; }
    for (let q = 0; q < 7; q++) d += Math.abs(D[i * 7 + q] - D[j * 7 + q]);
    return (a + b + Math.exp(-d / 7 / 5)) / 3;
  };
  const K = clamp(Math.round(nB / 16), 4, 8);
  const g = new Float32Array(2 * K);
  for (let a = -K; a < K; a++) g[a + K] = Math.exp(-0.5 * (((a + 0.5) / (K * 0.5)) ** 2));
  const nov = new Float32Array(nB);
  for (let i = K; i < nB - K; i++) {
    let s = 0;
    for (let a = -K; a < K; a++) {
      for (let b = -K; b < K; b++) {
        const sign = (a < 0) === (b < 0) ? 1 : -1;
        s += sign * g[a + K] * g[b + K] * sim(i + a, i + b);
      }
    }
    nov[i] = Math.max(0, s);
  }
  const mx = Math.max(...nov) || 1;
  if (typeof process !== 'undefined' && process.env?.LE_DEBUG) {
    let row = '  [novelty] ';
    for (let i = 0; i < nB; i += 2) row += `${beats[i].toFixed(0)}:${(nov[i] / mx * 99).toFixed(0)} `;
    console.log(row);
  }
  const minDist = nB < 240 ? 16 : 32;
  // greedy peak picking by height
  const cand: number[] = [];
  for (let i = 1; i < nB - 1; i++) if (nov[i] > nov[i - 1] && nov[i] >= nov[i + 1] && nov[i] > 0.12 * mx) cand.push(i);
  cand.sort((a, b) => nov[b] - nov[a]);
  const picked: number[] = [];
  for (const c of cand) if (picked.every((p) => Math.abs(p - c) >= minDist)) picked.push(c);
  picked.sort((a, b) => a - b);
  const out: number[] = [];
  for (const p of picked) {
    let t = beats[p];
    const d = nearest(inp.downbeats, t);
    if (!Number.isNaN(d) && Math.abs(d - t) <= 2.5) t = d;
    if (t > 1 && t < inp.duration - 1 && (!out.length || t - out[out.length - 1] > 2)) out.push(t);
  }
  return out;
}

/** Split speech at pauses ≥ 1.2 s, at least 6 s apart. */
export function speechBoundaries(rms: Float32Array, duration: number): number[] {
  const ref = percentile(rms, 0.95) || 1e-9;
  const thr = ref * 10 ** (-30 / 20);
  const out: number[] = [];
  let runStart = -1;
  const toT = (f: number) => (f / FRAME_RATE);
  for (let i = 0; i <= rms.length; i++) {
    const quiet = i < rms.length && rms[i] < thr;
    if (quiet && runStart < 0) runStart = i;
    if (!quiet && runStart >= 0) {
      const a = toT(runStart), b = toT(i);
      if (b - a >= 1.2 && a > 0.5 && b < duration - 0.5) {
        const t = b - 0.15; // cut just before speech resumes
        if (!out.length ? t >= 6 : t - out[out.length - 1] >= 6) out.push(t);
      }
      runStart = -1;
    }
  }
  return out;
}

interface Seg { start: number; end: number; energy: number; vec: Float32Array; cluster: number }

function segFeatures(bounds: number[], inp: StructureInput): Seg[] {
  const { beats, bf } = inp;
  const nB = beats.length;
  const C = l2rows(bf.chroma, nB, 12);
  const T = l2rows(zscoreCols(bf.timbre, nB, 12), nB, 12);
  const segs: Seg[] = [];
  for (let s = 0; s + 1 < bounds.length; s++) {
    const start = bounds[s], end = bounds[s + 1];
    const vec = new Float32Array(24);
    let c = 0;
    for (let b = 0; b < nB; b++) {
      if (beats[b] < start - 1e-3 || beats[b] >= end - 1e-3) continue;
      for (let k = 0; k < 12; k++) { vec[k] += C[b * 12 + k]; vec[12 + k] += T[b * 12 + k]; }
      c++;
    }
    for (const half of [0, 12]) {
      let n = 0;
      for (let k = 0; k < 12; k++) n += vec[half + k] ** 2;
      n = Math.sqrt(n) || 1;
      for (let k = 0; k < 12; k++) vec[half + k] /= n;
    }
    let e = 0, m = 0;
    for (let i = Math.floor(start * 60); i < Math.min(inp.loud.length, Math.floor(end * 60)); i++) { e += inp.loud[i]; m++; }
    segs.push({ start, end, energy: m ? e / m : 0, vec, cluster: -1 });
    void c;
  }
  return segs;
}

function segSim(a: Seg, b: Seg): number {
  let s = 0;
  for (let k = 0; k < 24; k++) s += a.vec[k] * b.vec[k];
  return s / 2;
}

/**
 * Repetition stripes from a key-invariant (12 circular shifts) beat-synchronous chroma SSM.
 * Returns passages ≥ 8 bars that occur twice.
 */
export function findRepeats(inp: StructureInput): Repeat[] {
  const { beats, bf, perBar } = inp;
  const nB = beats.length;
  const minLen = 8 * perBar;
  if (nB < minLen * 2) return [];
  const C = l2rows(bf.chroma, nB, 12);
  const stripes: { i: number; d: number; len: number; q: number }[] = [];
  const row = new Float32Array(nB);
  const medW = 16;
  const tmp = new Float32Array(medW);
  for (let shift = 0; shift < 12; shift++) {
    for (let d = minLen; d < nB - minLen; d++) {
      const m = nB - d;
      for (let i = 0; i < m; i++) {
        let s = 0;
        const io = i * 12, jo = (i + d) * 12;
        for (let c = 0; c < 12; c++) s += C[io + c] * C[jo + ((c + shift) % 12)];
        row[i] = s;
      }
      // diagonal median (16 beats) then runs above threshold
      let run = -1, acc = 0;
      for (let i = 0; i <= m - medW + 1; i++) {
        let v = 0;
        if (i <= m - medW) {
          for (let k = 0; k < medW; k++) tmp[k] = row[i + k];
          tmp.sort();
          v = 0.5 * (tmp[medW / 2 - 1] + tmp[medW / 2]);
        }
        const ok = i <= m - medW && v > 0.93;
        if (ok) { if (run < 0) { run = i; acc = 0; } acc += v; }
        else if (run >= 0) {
          const len = i - run + medW - 1;
          if (len >= minLen) stripes.push({ i: run, d, len, q: acc / (i - run) });
          run = -1;
        }
      }
    }
  }
  // keep the best stripe among overlapping near-duplicates
  stripes.sort((a, b) => b.q * b.len - a.q * a.len);
  const kept: typeof stripes = [];
  for (const s of stripes) {
    const dup = kept.some((k) => Math.abs(k.d - s.d) <= 4 && Math.min(k.i + k.len, s.i + s.len) - Math.max(k.i, s.i) > 0.5 * Math.min(k.len, s.len));
    if (!dup) kept.push(s);
    if (kept.length >= 48) break;
  }
  const tb = (b: number) => beats[clamp(b, 0, nB - 1)];
  return kept.map((s) => ({ a: tb(s.i), b: tb(s.i + s.d), len: tb(s.i + s.len) - tb(s.i) })).sort((x, y) => x.a - y.a);
}

export function clusterAndLabel(
  bounds: number[], inp: StructureInput, repeats: Repeat[], drops: number[], speech: boolean,
): Section[] {
  const all = [0, ...bounds.filter((t) => t > 0.5 && t < inp.duration - 0.5), inp.duration];
  let segs = segFeatures(all, inp);
  if (speech) return segs.map((s, i) => ({ start: s.start, end: s.end, label: 'speech' as SectionLabel, energy: s.energy, cluster: i }));
  // cluster: cosine similarity > 0.975 and energy difference < 0.12, plus repetition stripes
  const parent = segs.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++)
      if (segSim(segs[i], segs[j]) > 0.975 && Math.abs(segs[i].energy - segs[j].energy) < 0.12) union(i, j);
  const overlap = (s: Seg, a: number, len: number) => Math.max(0, Math.min(s.end, a + len) - Math.max(s.start, a));
  for (const r of repeats) {
    for (let i = 0; i < segs.length; i++) {
      const oi = overlap(segs[i], r.a, r.len);
      if (oi < 0.6 * (segs[i].end - segs[i].start)) continue;
      for (let j = 0; j < segs.length; j++) {
        if (i === j) continue;
        const oj = overlap(segs[j], r.b, r.len);
        if (oj >= 0.6 * (segs[j].end - segs[j].start) && Math.abs(segs[i].energy - segs[j].energy) < 0.12) union(i, j);
      }
    }
  }
  if (typeof process !== 'undefined' && process.env?.LE_DEBUG) {
    console.log('  [structure] segments', segs.map((s) => `${s.start.toFixed(1)}:${s.energy.toFixed(2)}`).join(' '));
    for (let i = 0; i < segs.length; i++) console.log('   sim', segs.map((_, j) => segSim(segs[i], segs[j]).toFixed(3)).join(' '));
  }
  segs.forEach((s, i) => { s.cluster = find(i); });
  // merge adjacent segments in the same cluster
  const merged: Seg[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && last.cluster === s.cluster) {
      const d0 = last.end - last.start, d1 = s.end - s.start;
      last.energy = (last.energy * d0 + s.energy * d1) / (d0 + d1);
      last.end = s.end;
    } else merged.push({ ...s });
  }
  segs = merged;
  // renumber clusters in order of appearance
  const ids = new Map<number, number>();
  for (const s of segs) { if (!ids.has(s.cluster)) ids.set(s.cluster, ids.size); s.cluster = ids.get(s.cluster)!; }
  return labelSections(segs.map((s) => ({ start: s.start, end: s.end, energy: s.energy, cluster: s.cluster, label: 'verse' as SectionLabel })), drops, inp.duration);
}

/** Label rules of §4; exported so lyric evidence can re-run them after clusters change. */
export function labelSections(secs: Section[], drops: number[], duration: number): Section[] {
  const n = secs.length;
  if (!n) return secs;
  let tot = 0, wsum = 0;
  for (const s of secs) { tot += s.energy * (s.end - s.start); wsum += s.end - s.start; }
  const meanE = wsum ? tot / wsum : 0;
  const count = new Map<number, number>();
  const cE = new Map<number, number>();
  const cD = new Map<number, number>();
  for (const s of secs) {
    count.set(s.cluster, (count.get(s.cluster) ?? 0) + 1);
    cE.set(s.cluster, (cE.get(s.cluster) ?? 0) + s.energy * (s.end - s.start));
    cD.set(s.cluster, (cD.get(s.cluster) ?? 0) + (s.end - s.start));
  }
  let chorus = -1, best = -1;
  for (const [c, k] of count) {
    if (k < 2) continue;
    const e = cE.get(c)! / cD.get(c)!;
    if (e > best && e >= meanE * 0.95) { best = e; chorus = c; }
  }
  return secs.map((s, i) => {
    let label: SectionLabel = 'verse';
    const quiet = s.energy < 0.6 * meanE;
    if (s.cluster === chorus) label = 'chorus';
    else if (i === 0 && (quiet || (s.energy < 0.8 * meanE && n > 2)) && s.end - s.start < 0.35 * duration) label = 'intro';
    else if (i === n - 1 && n > 1 && (quiet || s.energy < 0.8 * meanE) && s.end - s.start < 0.35 * duration) label = 'outro';
    else if (quiet && i > 0 && i < n - 1) label = 'breakdown';
    else if (count.get(s.cluster) === 1 && s.start > duration * 0.5 && i < n - 1 && chorus >= 0) label = 'bridge';
    if (label !== 'chorus' && label !== 'intro' && label !== 'outro' && drops.some((d) => Math.abs(d - s.start) < 1.0) && s.energy > meanE) label = 'drop';
    return { ...s, label };
  });
}

/**
 * Drops: a bar-to-bar rise with bass > 0.28 and loudness > 0.18, preceded by a build
 * (rising highs over the previous bars) or a breakdown; at least 8 s apart.
 */
export function findDrops(downbeats: number[], loud: Float32Array, bass: Float32Array, highs: Float32Array, duration: number): number[] {
  const n = downbeats.length;
  if (n < 6) return [];
  const barMean = (arr: Float32Array, i: number) => {
    const a = downbeats[i], b = i + 1 < n ? downbeats[i + 1] : Math.min(duration, a + (downbeats[i] - downbeats[i - 1]));
    let s = 0, c = 0;
    for (let k = Math.floor(a * 60); k < Math.min(arr.length, Math.floor(b * 60)); k++) { s += arr[k]; c++; }
    return c ? s / c : 0;
  };
  const L: number[] = [], B: number[] = [], H: number[] = [];
  for (let i = 0; i < n; i++) { L.push(barMean(loud, i)); B.push(barMean(bass, i)); H.push(barMean(highs, i)); }
  const cands: { t: number; s: number }[] = [];
  for (let i = 2; i < n - 1; i++) {
    const after = 0.5 * (L[i] + L[Math.min(n - 1, i + 1)]);
    const bassAfter = 0.5 * (B[i] + B[Math.min(n - 1, i + 1)]);
    const before = 0.5 * (L[i - 1] + L[i - 2]);
    const bassBefore = 0.5 * (B[i - 1] + B[i - 2]);
    const rise = after - before, bassRise = bassAfter - bassBefore;
    if (!(bassAfter > 0.28 && after > 0.18)) continue;
    if (!(rise > 0.12 || bassRise > 0.25)) continue;
    // the bar before must still be part of the quiet/build passage (the drop is the FIRST loud bar)
    if (L[i - 1] > 0.78 * after) continue;
    // build: highs rising over the previous 4 bars
    const k0 = Math.max(0, i - 4);
    const build = H[i - 1] - H[k0] > 0.12 && H[i - 1] > H[k0] * 1.25;
    // breakdown: the bars before are quiet, and the song was loud earlier
    let earlier = 0;
    for (let k = Math.max(0, i - 24); k < i - 2; k++) earlier = Math.max(earlier, L[k]);
    const breakdown = before < 0.62 * after && earlier > 0.8 * after;
    if (!(build || breakdown)) continue;
    cands.push({ t: downbeats[i], s: rise + bassRise + (build ? 0.2 : 0) + (breakdown ? 0.2 : 0) });
  }
  cands.sort((a, b) => b.s - a.s);
  const out: number[] = [];
  for (const c of cands) if (out.every((t) => Math.abs(t - c.t) >= 8)) out.push(c.t);
  return out.sort((a, b) => a - b);
}

/** section index containing t */
export function sectionAt(sections: Section[], t: number): number {
  for (let i = 0; i < sections.length; i++) if (t < sections[i].end) return i;
  return Math.max(0, sections.length - 1);
}

export function sectionEnergyAt(sections: Section[], t: number): number {
  return sections.length ? sections[sectionAt(sections, t)].energy : 0;
}

export { sample, lowerBound, mean };

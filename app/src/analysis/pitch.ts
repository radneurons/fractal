// Vocal pitch (SPEC §4A.3): "pYIN-lite" — Viterbi over the 3 best YIN candidates per frame.
import type { Frames } from './frames.ts';
import { N_CAND } from './frames.ts';
import { FPS, clamp } from './dsp.ts';

const hzToMidi = (f: number) => 69 + 12 * Math.log2(f / 440);

export function trackPitch(f: Frames, activity: Float32Array): { f0: Float32Array; conf: Float32Array } {
  const n = f.nF, NS = N_CAND + 1, U = N_CAND;
  const f0 = new Float32Array(n).fill(NaN), conf = new Float32Array(n);
  if (!n) return { f0, conf };
  const midi = new Float32Array(n * N_CAND);
  for (let i = 0; i < n * N_CAND; i++) midi[i] = f.candF[i] > 0 ? hzToMidi(f.candF[i]) : NaN;
  const E = 10, SWITCH = 2, JUMP = 0.45;
  let cost = new Float64Array(NS), next = new Float64Array(NS);
  const back = new Int8Array(n * NS);
  const emit = (i: number, s: number) => {
    if (s === U) return E * (0.16 + 0.3 * activity[i]);
    const c = f.candC[i * N_CAND + s];
    return f.candF[i * N_CAND + s] > 0 ? E * c : 1e6;
  };
  for (let s = 0; s < NS; s++) cost[s] = emit(0, s);
  for (let i = 1; i < n; i++) {
    for (let s = 0; s < NS; s++) {
      let best = Infinity, bi = 0;
      for (let p = 0; p < NS; p++) {
        let tr: number;
        if (s === U && p === U) tr = 0;
        else if (s === U || p === U) tr = SWITCH;
        else tr = Math.min(8, Math.abs(midi[i * N_CAND + s] - midi[(i - 1) * N_CAND + p])) * JUMP;
        const v = cost[p] + tr;
        if (v < best) { best = v; bi = p; }
      }
      next[s] = best + emit(i, s);
      back[i * NS + s] = bi;
    }
    [cost, next] = [next, cost];
  }
  let s = 0;
  for (let k = 1; k < NS; k++) if (cost[k] < cost[s]) s = k;
  for (let i = n - 1; i >= 0; i--) {
    if (s !== U) { f0[i] = midi[i * N_CAND + s]; conf[i] = clamp(1 - f.candC[i * N_CAND + s], 0, 1); }
    s = back[i * NS + s];
  }
  return { f0, conf };
}

/** median f0 (MIDI) over [start, end) of a 60 fps contour; NaN if under 20 % voiced */
export function medianPitch(f0: Float32Array, start: number, end: number): number {
  const a = Math.max(0, Math.floor(start * FPS)), b = Math.min(f0.length, Math.ceil(end * FPS));
  const v: number[] = [];
  for (let i = a; i < b; i++) if (!Number.isNaN(f0[i])) v.push(f0[i]);
  if (v.length < Math.max(1, 0.2 * (b - a))) return NaN;
  v.sort((x, y) => x - y);
  return v[v.length >> 1];
}

/** semitone plateaus (≥ 120 ms) inside a span */
export function pitchPlateaus(f0: Float32Array, start: number, end: number): { start: number; end: number; midi: number }[] {
  const a = Math.max(0, Math.floor(start * FPS)), b = Math.min(f0.length, Math.ceil(end * FPS));
  const out: { start: number; end: number; midi: number }[] = [];
  let i = a;
  while (i < b) {
    if (Number.isNaN(f0[i])) { i++; continue; }
    let sum = f0[i], cnt = 1, j = i + 1, gap = 0;
    while (j < b) {
      if (Number.isNaN(f0[j])) { if (++gap > 3) break; j++; continue; }
      if (Math.abs(f0[j] - sum / cnt) > 0.75) {
        // tolerate a brief excursion (vibrato peaks, scoops)
        let back = false;
        for (let k = j + 1; k < Math.min(b, j + 4); k++) if (!Number.isNaN(f0[k]) && Math.abs(f0[k] - sum / cnt) <= 0.75) { back = true; break; }
        if (!back) break;
        j++; continue;
      }
      gap = 0; sum += f0[j]; cnt++; j++;
    }
    if ((j - i) / FPS >= 0.12 && cnt >= 5) out.push({ start: i / FPS, end: j / FPS, midi: sum / cnt });
    i = Math.max(j, i + 1);
  }
  // merge neighbours on the same semitone
  const merged: typeof out = [];
  for (const p of out) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.midi - p.midi) < 0.6 && p.start - last.end < 0.1) { last.midi = (last.midi + p.midi) / 2; last.end = p.end; }
    else merged.push({ ...p });
  }
  return merged;
}

/** one word spanning more than 2 distinct semitone plateaus */
export function isMelisma(f0: Float32Array, start: number, end: number): boolean {
  const p = pitchPlateaus(f0, start, end);
  const levels = new Set(p.map((x) => Math.round(x.midi)));
  return levels.size > 2;
}

/** 4.5–7.5 Hz oscillation of ≥ 30 cents for ≥ 400 ms; returns the rate (Hz) or 0 */
export function vibratoRate(f0: Float32Array, start: number, end: number): number {
  const a = Math.max(0, Math.floor(start * FPS)), b = Math.min(f0.length, Math.ceil(end * FPS));
  const n = b - a;
  if (n < 0.4 * FPS) return 0;
  // detrend with a ±125 ms running median (a mean would smear pitch jumps into the vibrato)
  const h = Math.round(0.125 * FPS);
  const d = new Float32Array(n).fill(NaN);
  const buf: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(f0[a + i])) continue;
    buf.length = 0;
    for (let k = Math.max(0, i - h); k <= Math.min(n - 1, i + h); k++) if (!Number.isNaN(f0[a + k])) buf.push(f0[a + k]);
    if (buf.length <= h) continue;
    buf.sort((x, y) => x - y);
    const dev = (f0[a + i] - buf[buf.length >> 1]) * 100; // cents
    if (Math.abs(dev) < 150) d[i] = dev;
  }
  // longest run of valid samples whose zero crossings are regular
  let best = 0, bestRate = 0;
  let i = 0;
  while (i < n) {
    if (Number.isNaN(d[i])) { i++; continue; }
    let j = i;
    while (j < n && !Number.isNaN(d[j])) j++;
    // zero-crossing times (interpolated) inside [i, j)
    const zc: number[] = [];
    for (let k = i + 1; k < j; k++) if (d[k - 1] * d[k] < 0) zc.push(k - 1 + d[k - 1] / (d[k - 1] - d[k]));
    // slide over runs of crossings whose half-periods stay inside 4.5–7.5 Hz
    let a0 = 0;
    for (let q = 1; q <= zc.length; q++) {
      const half = q < zc.length ? (zc[q] - zc[q - 1]) / FPS : Infinity;
      const ok = half >= 1 / 15 - 0.012 && half <= 1 / 9 + 0.012;
      if (!ok) {
        const core = (zc[q - 1] - zc[a0]) / FPS;
        const nHalf = q - 1 - a0;
        // the oscillation extends about half a period beyond the outer crossings (inside the valid run)
        const hp = nHalf > 0 ? (zc[q - 1] - zc[a0]) / nHalf : 0;
        const span = (Math.min(j - 1, zc[q - 1] + hp) - Math.max(i, zc[a0] - hp)) / FPS;
        if (span >= 0.4 && nHalf >= 3) {
          let sq = 0, cnt = 0;
          for (let k = Math.floor(zc[a0]); k <= Math.ceil(zc[q - 1]); k++) { sq += d[k] * d[k]; cnt++; }
          const p2p = 2 * Math.SQRT2 * Math.sqrt(sq / cnt);
          if (p2p >= 30 && span > best) { best = span; bestRate = nHalf / (2 * core); }
        }
        a0 = q;
      }
    }
    i = j;
  }
  return bestRate;
}

// Onsets, tempo, beats, downbeats, meter and tempo drift (SPEC §4, §4A.5).
import { SR, HOP, WIN, FRAME_RATE, LEAD_FLUX, LEAD_ENERGY, percentile, runningMedian, median, mean, clamp } from './dsp.ts';

export const frameToTimeFlux = (f: number) => (f * HOP + LEAD_FLUX) / SR;
export const timeToFrameFlux = (t: number) => (t * SR - LEAD_FLUX) / HOP;
export const timeToFrameEnergy = (t: number) => (t * SR - LEAD_ENERGY) / HOP;

export function normaliseFlux(flux: Float32Array): Float32Array {
  const p = percentile(flux, 0.98) || 1;
  const out = new Float32Array(flux.length);
  for (let i = 0; i < flux.length; i++) out[i] = flux[i] / p;
  return out;
}

/** Local maxima above 1.4 × median(±0.25 s) + 0.07, at least 50 ms apart. */
export function detectOnsets(fluxNorm: Float32Array, k = 1.4, delta = 0.07): { times: number[]; strength: number[] } {
  const n = fluxNorm.length;
  const med = runningMedian(fluxNorm, Math.round(0.25 * FRAME_RATE));
  const times: number[] = [], strength: number[] = [];
  const minGap = 0.05;
  for (let i = 1; i < n - 1; i++) {
    const v = fluxNorm[i];
    if (v <= k * med[i] + delta) continue;
    if (v < fluxNorm[i - 1] || v <= fluxNorm[i + 1]) continue;
    if (i > 1 && v < fluxNorm[i - 2]) continue;
    if (i < n - 2 && v < fluxNorm[i + 2]) continue;
    // parabolic refinement of the peak position
    const a = fluxNorm[i - 1], c = fluxNorm[i + 1];
    const den = a - 2 * v + c;
    const sh = Math.abs(den) > 1e-9 ? clamp((0.5 * (a - c)) / den, -0.5, 0.5) : 0;
    const t = frameToTimeFlux(i + sh);
    if (times.length && t - times[times.length - 1] < minGap) {
      if (v > strength[strength.length - 1]) { times[times.length - 1] = t; strength[strength.length - 1] = v; }
      continue;
    }
    times.push(Math.max(0, t));
    strength.push(v);
  }
  return { times, strength };
}

function autocorr(env: Float32Array, start: number, end: number, maxLag: number): Float64Array {
  const ac = new Float64Array(maxLag + 1);
  let m = 0;
  for (let i = start; i < end; i++) m += env[i];
  m /= Math.max(1, end - start);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = start; i + lag < end; i++) s += (env[i] - m) * (env[i + lag] - m);
    ac[lag] = s / Math.max(1, end - start - lag);
  }
  return ac;
}

const LAG_MIN = Math.floor((FRAME_RATE * 60) / 220);
const LAG_MAX = Math.ceil((FRAME_RATE * 60) / 40);

function prior(bpm: number): number {
  const o = Math.log2(bpm / 120);
  return Math.exp(-0.5 * (o / 0.9) ** 2);
}

export interface Tempo { bpm: number; confidence: number; period: number }

export function estimateTempo(env: Float32Array, start = 0, end = env.length): Tempo & { score: Float64Array } {
  const ac = autocorr(env, start, end, LAG_MAX * 2 + 2);
  const ac0 = ac[0] > 1e-12 ? ac[0] : 1;
  const score = new Float64Array(LAG_MAX + 1);
  let best = -Infinity, bestLag = -1; // start at −∞: a fixed fallback lag silently returns 120 BPM
  for (let lag = LAG_MIN; lag <= LAG_MAX; lag++) {
    const bpm = (60 * FRAME_RATE) / lag;
    // a real beat period also correlates at its double
    const s = (ac[lag] + 0.5 * ac[2 * lag]) / ac0 * prior(bpm);
    score[lag] = s;
    if (s > best) { best = s; bestLag = lag; }
  }
  if (bestLag < 0) return { bpm: 120, confidence: 0, period: (FRAME_RATE * 60) / 120, score };
  // parabolic refinement on the raw autocorrelation
  let lagF = bestLag;
  if (bestLag > LAG_MIN && bestLag < LAG_MAX) {
    const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
    const den = a - 2 * b + c;
    if (Math.abs(den) > 1e-12) lagF = bestLag + clamp((0.5 * (a - c)) / den, -0.5, 0.5);
  }
  const vals: number[] = [];
  for (let lag = LAG_MIN; lag <= LAG_MAX; lag++) vals.push(ac[lag] / ac0);
  const prominence = ac[bestLag] / ac0 - median(vals);
  return { bpm: (60 * FRAME_RATE) / lagF, confidence: clamp(prominence * 2.2, 0, 1), period: lagF, score };
}

/** Local tempo (period in frames) every second from 8 s windows, smoothed with a Viterbi path. */
export function tempogram(env: Float32Array, globalPeriod: number): { periods: Float32Array; variation: number } {
  const hop = Math.round(FRAME_RATE), half = Math.round(4 * FRAME_RATE);
  const nW = Math.max(1, Math.floor(env.length / hop));
  const lo = Math.max(LAG_MIN, Math.floor(globalPeriod * 0.8)), hi = Math.min(LAG_MAX, Math.ceil(globalPeriod * 1.25));
  const nL = hi - lo + 1;
  const obs: Float64Array[] = [];
  for (let w = 0; w < nW; w++) {
    const c = w * hop;
    const s = Math.max(0, c - half), e = Math.min(env.length, c + half);
    const ac = autocorr(env, s, e, hi + 1);
    const ac0 = ac[0] > 1e-12 ? ac[0] : 1;
    const o = new Float64Array(nL);
    for (let l = 0; l < nL; l++) o[l] = ac[lo + l] / ac0;
    obs.push(o);
  }
  // Viterbi: stay close in lag
  const cost = new Float64Array(nL), next = new Float64Array(nL);
  const back: Int16Array[] = [];
  for (let l = 0; l < nL; l++) cost[l] = obs[0][l];
  for (let w = 1; w < nW; w++) {
    const b = new Int16Array(nL);
    for (let l = 0; l < nL; l++) {
      let bestV = -Infinity, bi = l;
      for (let p = Math.max(0, l - 3); p <= Math.min(nL - 1, l + 3); p++) {
        const v = cost[p] - 0.08 * Math.abs(p - l);
        if (v > bestV) { bestV = v; bi = p; }
      }
      next[l] = bestV + obs[w][l];
      b[l] = bi;
    }
    cost.set(next);
    back.push(b);
  }
  let li = 0;
  for (let l = 1; l < nL; l++) if (cost[l] > cost[li]) li = l;
  const path = new Int16Array(nW);
  path[nW - 1] = li;
  for (let w = nW - 1; w > 0; w--) { li = back[w - 1][li]; path[w - 1] = li; }
  const periods = new Float32Array(nW);
  for (let w = 0; w < nW; w++) {
    const l = path[w];
    let lagF = lo + l;
    const o = obs[w];
    if (l > 0 && l < nL - 1) {
      const den = o[l - 1] - 2 * o[l] + o[l + 1];
      if (Math.abs(den) > 1e-12) lagF += clamp((0.5 * (o[l - 1] - o[l + 1])) / den, -0.5, 0.5);
    }
    periods[w] = lagF;
  }
  // variation over windows with a clear pulse
  const strong: number[] = [];
  for (let w = 0; w < nW; w++) if (obs[w][path[w]] > 0.15) strong.push(periods[w]);
  const variation = strong.length > 4 ? (percentile(strong, 0.95) - percentile(strong, 0.05)) / median(strong) : 0;
  return { periods, variation };
}

/** Dynamic-programming beat tracker (Ellis 2007). `periodAt(frame)` allows a time-varying tempo. */
export function trackBeats(env: Float32Array, periodAt: (f: number) => number, alpha = 100): number[] {
  const n = env.length;
  if (n < 8) return [];
  let sd = 0;
  const mu = mean(env);
  for (let i = 0; i < n; i++) sd += (env[i] - mu) ** 2;
  sd = Math.sqrt(sd / n) || 1;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    const P = periodAt(t);
    const local = env[t] / sd;
    const lo = Math.max(0, Math.round(t - 2 * P)), hi = Math.round(t - P / 2);
    let best = -Infinity, bi = -1;
    for (let p = lo; p <= hi && p < t; p++) {
      const lg = Math.log((t - p) / P);
      const v = score[p] - alpha * lg * lg;
      if (v > best) { best = v; bi = p; }
    }
    if (bi >= 0 && best > 0) { score[t] = local + best; back[t] = bi; }
    else score[t] = local;
  }
  // best ending in the last two periods
  const Pend = periodAt(n - 1);
  let end = n - 1;
  for (let t = Math.max(0, n - Math.round(2 * Pend)); t < n; t++) if (score[t] > score[end]) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]) { beats.push(t); if (back[t] < 0) break; }
  beats.reverse();
  // refine each beat to the local envelope peak (±1 frame, parabolic)
  const refined = beats.map((b) => {
    if (b <= 0 || b >= n - 1) return b;
    const a = env[b - 1], v = env[b], c = env[b + 1];
    if (v < a || v < c) return b;
    const den = a - 2 * v + c;
    return b + (Math.abs(den) > 1e-9 ? clamp((0.5 * (a - c)) / den, -0.5, 0.5) : 0);
  });
  return refined;
}

/** Extend a beat list to cover [0, duration] at the local period. */
export function extendBeats(beats: number[], duration: number, fallbackPeriod: number): number[] {
  if (!beats.length) {
    const out: number[] = [];
    for (let t = 0; t < duration; t += fallbackPeriod) out.push(t);
    return out;
  }
  const out = beats.slice();
  const head = out.length > 4 ? (out[4] - out[0]) / 4 : fallbackPeriod;
  while (out[0] - head > -1e-6) out.unshift(out[0] - head);
  const m = out.length;
  const tail = m > 4 ? (out[m - 1] - out[m - 5]) / 4 : fallbackPeriod;
  while (out[out.length - 1] + tail < duration) out.push(out[out.length - 1] + tail);
  return out.filter((t) => t >= -1e-6).map((t) => Math.max(0, t));
}

/**
 * Smooth frame-quantised beat times: where the tempo is steady, replace each beat by a local
 * linear fit (±8 beats). Keeps real tempo changes, removes ±6 ms frame jitter.
 */
export function regulariseBeats(beats: number[]): number[] {
  const n = beats.length;
  if (n < 9) return beats;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 8), b = Math.min(n - 1, i + 8);
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const m = b - a + 1;
    for (let k = a; k <= b; k++) { sx += k; sy += beats[k]; sxx += k * k; sxy += k * beats[k]; }
    const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx);
    const icpt = (sy - slope * sx) / m;
    const fit = slope * i + icpt;
    // only trust the fit when the window is locally regular
    let maxDev = 0;
    for (let k = a; k <= b; k++) maxDev = Math.max(maxDev, Math.abs(beats[k] - (slope * k + icpt)));
    out[i] = maxDev < 0.03 ? fit : beats[i];
  }
  return out;
}

export interface BeatFeatures {
  bass: Float32Array;
  flux: Float32Array;
  harmChange: Float32Array;
  score: Float32Array;
  /** beat-synchronous chroma (nBeats × 12) and timbre (nBeats × 12) */
  chroma: Float32Array;
  timbre: Float32Array;
  energy: Float32Array;
  /** beat-synchronous band levels in dB (nBeats × 7): arrangement density */
  bandDb: Float32Array;
}

export function beatFeatures(
  beats: number[], duration: number,
  f: { bands: Float32Array[]; env: Float32Array; chroma: Float32Array; mfcc: Float32Array; rms: Float32Array; nF: number },
): BeatFeatures {
  const nB = beats.length;
  const bass = new Float32Array(nB), flux = new Float32Array(nB), hc = new Float32Array(nB), score = new Float32Array(nB);
  const chroma = new Float32Array(nB * 12), timbre = new Float32Array(nB * 12), energy = new Float32Array(nB);
  const bandDb = new Float32Array(nB * 7);
  const nF = f.nF;
  for (let b = 0; b < nB; b++) {
    const t0 = beats[b], t1 = b + 1 < nB ? beats[b + 1] : Math.min(duration, t0 + (b > 0 ? t0 - beats[b - 1] : 0.5));
    // bass energy right after the beat (first 30 % of the interval)
    const e0 = clamp(Math.round(timeToFrameEnergy(t0)), 0, nF - 1);
    const e1 = clamp(Math.round(timeToFrameEnergy(t0 + (t1 - t0) * 0.3)), e0 + 1, nF);
    let s = 0;
    for (let i = e0; i < e1; i++) s += f.bands[0][i] + f.bands[1][i];
    bass[b] = s / (e1 - e0);
    const ff = clamp(Math.round(timeToFrameFlux(t0)), 0, nF - 1);
    let mx = 0;
    for (let i = Math.max(0, ff - 2); i <= Math.min(nF - 1, ff + 2); i++) if (f.env[i] > mx) mx = f.env[i];
    flux[b] = mx;
    // beat-synchronous means
    const a0 = clamp(Math.round(timeToFrameEnergy(t0)), 0, nF - 1);
    const a1 = clamp(Math.round(timeToFrameEnergy(t1)), a0 + 1, nF);
    let en = 0;
    for (let i = a0; i < a1; i++) {
      for (let c = 0; c < 12; c++) { chroma[b * 12 + c] += f.chroma[i * 12 + c]; timbre[b * 12 + c] += f.mfcc[i * 13 + c + 1]; }
      en += f.rms[i];
      for (let q = 0; q < 7; q++) bandDb[b * 7 + q] += f.bands[q][i];
    }
    const m = a1 - a0;
    for (let q = 0; q < 7; q++) bandDb[b * 7 + q] = 20 * Math.log10(bandDb[b * 7 + q] / m + 1e-5);
    for (let c = 0; c < 12; c++) { chroma[b * 12 + c] /= m; timbre[b * 12 + c] /= m; }
    energy[b] = en / m;
  }
  for (let b = 1; b < nB; b++) {
    let ab = 0, aa = 0, bb = 0;
    for (let c = 0; c < 12; c++) { const x = chroma[b * 12 + c], y = chroma[(b - 1) * 12 + c]; ab += x * y; aa += x * x; bb += y * y; }
    hc[b] = aa > 0 && bb > 0 ? 1 - ab / Math.sqrt(aa * bb) : 0;
  }
  const mb = mean(bass) || 1, mf = mean(flux) || 1, mh = mean(hc) || 1;
  for (let b = 0; b < nB; b++) score[b] = bass[b] / mb + 0.5 * (flux[b] / mf) + 1.2 * (hc[b] / mh);
  return { bass, flux, harmChange: hc, score, chroma, timbre, energy, bandDb };
}

/** 3 vs 4 from the periodicity of the per-beat downbeat score; 6 = compound (beats subdivide in threes). */
export function detectMeter(bf: BeatFeatures, beats: number[], env: Float32Array, bpm: number): 3 | 4 | 6 {
  const s = bf.score, n = s.length;
  if (n < 24) return 4;
  const mu = mean(s);
  const ac = (lag: number) => {
    let a = 0;
    for (let i = 0; i + lag < n; i++) a += (s[i] - mu) * (s[i + lag] - mu);
    return a / (n - lag);
  };
  const a0 = ac(0) || 1;
  const three = (ac(3) + 0.5 * ac(6)) / a0, four = (ac(4) + 0.5 * ac(8)) / a0, two = ac(2) / a0;
  // subdivision: onset energy at 1/3 & 2/3 of the beat vs 1/2
  let tri = 0, dup = 0;
  const at = (t: number) => {
    const f = Math.round(timeToFrameFlux(t));
    let m = 0;
    for (let i = Math.max(0, f - 1); i <= Math.min(env.length - 1, f + 1); i++) if (env[i] > m) m = env[i];
    return m;
  };
  for (let b = 0; b + 1 < n; b++) {
    const t0 = beats[b], d = beats[b + 1] - t0;
    tri += 0.5 * (at(t0 + d / 3) + at(t0 + (2 * d) / 3));
    dup += at(t0 + d / 2);
  }
  if (tri > 1.5 * dup && bpm < 110 && three <= Math.max(four, two) + 0.05) return 6;
  return three > four + 0.04 && three > two ? 3 : 4;
}

/** Phase (mod beats-per-bar) with the highest summed downbeat score. */
export function pickDownbeats(beats: number[], score: Float32Array, perBar: number): { downbeats: number[]; phase: number } {
  let best = -Infinity, phase = 0;
  for (let p = 0; p < perBar; p++) {
    let s = 0, c = 0;
    for (let b = p; b < beats.length; b += perBar) { s += score[b]; c++; }
    s = c ? s / c : -Infinity;
    if (s > best) { best = s; phase = p; }
  }
  const downbeats: number[] = [];
  for (let b = phase; b < beats.length; b += perBar) downbeats.push(beats[b]);
  return { downbeats, phase };
}

/** Pulse clarity (flux on the beat grid ÷ mean flux) and silence ratio — used for speech detection. */
export function speechCues(env: Float32Array, beats: number[], rms: Float32Array): { pulse: number; silence: number } {
  let on = 0;
  for (const t of beats) {
    const f = Math.round(timeToFrameFlux(t));
    let m = 0;
    for (let i = Math.max(0, f - 1); i <= Math.min(env.length - 1, f + 1); i++) if (env[i] > m) m = env[i];
    on += m;
  }
  const mu = mean(env) || 1e-9;
  const pulse = beats.length ? on / beats.length / mu : 0;
  const ref = percentile(rms, 0.95) || 1e-9;
  const thr = ref * 10 ** (-30 / 20);
  let quiet = 0;
  for (let i = 0; i < rms.length; i++) if (rms[i] < thr) quiet++;
  return { pulse, silence: rms.length ? quiet / rms.length : 0 };
}

export { WIN };

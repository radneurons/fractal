// Hand-written DSP primitives (SPEC §4). Pure TypeScript: runs in a Web Worker and in Node tests.

export const SR = 22050;
export const WIN = 2048;
export const HOP = 256;
export const NB = WIN / 2 + 1;
export const FPS = 60;
export const FRAME_RATE = SR / HOP; // ≈ 86.13 analysis frames per second
/** time (s) a frame's energy-like features represent */
export const LEAD_ENERGY = WIN / 2;
/** time a flux peak represents: the transient is ~0.82·WIN into the window when the Hann² slope peaks */
export const LEAD_FLUX = WIN * 0.82;

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Radix-2 complex FFT with precomputed tables. */
export class FFT {
  readonly n: number;
  private cos: Float64Array;
  private sin: Float64Array;
  private rev: Uint32Array;
  constructor(n: number) {
    this.n = n;
    const bits = Math.round(Math.log2(n));
    if (1 << bits !== n) throw new Error('FFT size must be a power of two');
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
  }
  /** in-place forward transform (e^{-iωt}) */
  forward(re: Float64Array, im: Float64Array): void {
    const n = this.n, rev = this.rev, cos = this.cos, sin = this.sin;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = cos[k], wi = -sin[k];
          const a = i + j, b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }
  /** in-place inverse transform, scaled by 1/n */
  inverse(re: Float64Array, im: Float64Array): void {
    const n = this.n;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    this.forward(re, im);
    const s = 1 / n;
    for (let i = 0; i < n; i++) { re[i] *= s; im[i] = -im[i] * s; }
  }
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

function gcd(a: number, b: number): number { while (b) { const t = a % b; a = b; b = t; } return a; }

/** Windowed-sinc polyphase resampler. Deterministic across platforms (unlike OfflineAudioContext). */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const ratio = from / to; // input samples per output sample
  const fc = Math.min(1, to / from) * 0.93; // cutoff relative to input Nyquist
  const half = Math.ceil(8 / fc);
  const taps = half * 2;
  const g = gcd(Math.round(from), Math.round(to));
  let phases = Math.round(to) / g;
  let exact = Number.isInteger(from) && Number.isInteger(to) && phases <= 1024;
  if (!exact) phases = 1024;
  // kernel table: phases × taps
  const table = new Float32Array(phases * taps);
  for (let p = 0; p < phases; p++) {
    const frac = p / phases;
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const d = k - half + 1 - frac; // distance from the output position, in input samples
      const xx = d * fc;
      const s = Math.abs(xx) < 1e-9 ? 1 : Math.sin(Math.PI * xx) / (Math.PI * xx);
      const wpos = d / half;
      // Blackman window
      const w = Math.abs(wpos) >= 1 ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * wpos) + 0.08 * Math.cos(2 * Math.PI * wpos);
      const v = s * w;
      table[p * taps + k] = v;
      sum += v;
    }
    for (let k = 0; k < taps; k++) table[p * taps + k] /= sum;
  }
  const nOut = Math.floor(x.length / ratio);
  const out = new Float32Array(nOut);
  const nIn = x.length;
  for (let i = 0; i < nOut; i++) {
    const pos = i * ratio;
    const ip = Math.floor(pos);
    let p = Math.round((pos - ip) * phases);
    let base = ip - half + 1;
    if (p >= phases) { p = 0; base += 1; }
    const off = p * taps;
    let acc = 0;
    if (base >= 0 && base + taps <= nIn) {
      for (let k = 0; k < taps; k++) acc += x[base + k] * table[off + k];
    } else {
      for (let k = 0; k < taps; k++) {
        const j = base + k;
        if (j >= 0 && j < nIn) acc += x[j] * table[off + k];
      }
    }
    out[i] = acc;
  }
  return out;
}

export function percentile(arr: ArrayLike<number>, p: number): number {
  const n = arr.length;
  if (!n) return 0;
  const a = Float64Array.from(arr as ArrayLike<number>).filter((v) => !Number.isNaN(v));
  if (!a.length) return 0;
  a.sort();
  const idx = clamp(p * (a.length - 1), 0, a.length - 1);
  const i0 = Math.floor(idx), i1 = Math.min(a.length - 1, i0 + 1);
  return a[i0] + (a[i1] - a[i0]) * (idx - i0);
}

export function median(arr: ArrayLike<number>): number { return percentile(arr, 0.5); }

export function mean(arr: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return arr.length ? s / arr.length : 0;
}

/** 5th percentile → 0, 95th → 1, clamped. */
export function percentileNormalise(arr: Float32Array, lo = 0.05, hi = 0.95): Float32Array {
  const a = percentile(arr, lo), b = percentile(arr, hi);
  const d = b - a > 1e-12 ? b - a : 1;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = clamp((arr[i] - a) / d, 0, 1);
  return out;
}

/** Asymmetric one-pole smoothing at `fps` (attack / release in ms). */
export function smoothAR(arr: Float32Array, fps: number, attackMs: number, releaseMs: number): Float32Array {
  const out = new Float32Array(arr.length);
  const ka = attackMs <= 0 ? 0 : Math.exp(-1000 / (attackMs * fps));
  const kr = releaseMs <= 0 ? 0 : Math.exp(-1000 / (releaseMs * fps));
  let y = arr.length ? arr[0] : 0;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    const k = x > y ? ka : kr;
    y = x + (y - x) * k;
    out[i] = y;
  }
  return out;
}

/** Resample a frame-rate feature to 60 fps; frame i represents (i·HOP + lead)/SR. */
export function toFps(arr: Float32Array, lead: number, nOut: number, fps = FPS): Float32Array {
  const out = new Float32Array(nOut);
  const n = arr.length;
  if (!n) return out;
  for (let k = 0; k < nOut; k++) {
    const idx = ((k / fps) * SR - lead) / HOP;
    if (idx <= 0) { out[k] = arr[0]; continue; }
    if (idx >= n - 1) { out[k] = arr[n - 1]; continue; }
    const i0 = Math.floor(idx);
    out[k] = arr[i0] + (arr[i0 + 1] - arr[i0]) * (idx - i0);
  }
  return out;
}

/** Sample a 60 fps array at time t with linear interpolation. */
export function sample(arr: ArrayLike<number> | undefined, t: number, fps = FPS): number {
  if (!arr || !arr.length) return 0;
  const x = t * fps;
  if (x <= 0) return arr[0];
  const n = arr.length;
  if (x >= n - 1) return arr[n - 1];
  const i = Math.floor(x);
  const a = arr[i], b = arr[i + 1];
  return a + (b - a) * (x - i);
}

/** Deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash → 0..1 (stateless; for per-entity seeded values). */
export function hash01(a: number, b = 0, c = 0): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b) ^ Math.imul((c | 0) + 0x165667b1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Sliding-window median of width 2·half+1 (edges replicate). O(n·w) with a sorted window. */
export function runningMedian(x: Float32Array | Float64Array, half: number): Float32Array {
  const n = x.length, w = 2 * half + 1;
  const out = new Float32Array(n);
  if (!n) return out;
  const win = new Float64Array(w);
  const at = (i: number) => x[i < 0 ? 0 : i >= n ? n - 1 : i];
  for (let k = 0; k < w; k++) win[k] = at(k - half);
  win.sort();
  out[0] = win[half];
  for (let i = 1; i < n; i++) {
    const rem = at(i - 1 - half), add = at(i + half);
    if (rem !== add) {
      // remove `rem`
      let j = 0;
      while (j < w - 1 && win[j] !== rem) j++;
      // shift to insert `add`
      if (add > rem) {
        while (j < w - 1 && win[j + 1] < add) { win[j] = win[j + 1]; j++; }
      } else {
        while (j > 0 && win[j - 1] > add) { win[j] = win[j - 1]; j--; }
      }
      win[j] = add;
    }
    out[i] = win[half];
  }
  return out;
}

export function hzToMel(f: number): number { return 2595 * Math.log10(1 + f / 700); }
export function melToHz(m: number): number { return 700 * (10 ** (m / 2595) - 1); }

export interface SparseBank { start: Int32Array; len: Int32Array; weights: Float32Array[] }

/** Triangular mel filterbank over an NB-bin magnitude spectrum. */
export function melBank(nBands: number, fLo: number, fHi: number): SparseBank {
  const mLo = hzToMel(fLo), mHi = hzToMel(fHi);
  const pts: number[] = [];
  for (let i = 0; i < nBands + 2; i++) pts.push(melToHz(mLo + ((mHi - mLo) * i) / (nBands + 1)));
  const binHz = SR / WIN;
  const start = new Int32Array(nBands), len = new Int32Array(nBands);
  const weights: Float32Array[] = [];
  for (let b = 0; b < nBands; b++) {
    const f0 = pts[b], f1 = pts[b + 1], f2 = pts[b + 2];
    const k0 = Math.max(1, Math.ceil(f0 / binHz)), k1 = Math.min(NB - 1, Math.floor(f2 / binHz));
    const w: number[] = [];
    for (let k = k0; k <= k1; k++) {
      const f = k * binHz;
      w.push(Math.max(0, f <= f1 ? (f - f0) / (f1 - f0) : (f2 - f) / (f2 - f1)));
    }
    if (!w.length) { // very narrow low band: take the nearest bin
      const k = clamp(Math.round(f1 / binHz), 1, NB - 1);
      start[b] = k; len[b] = 1; weights.push(Float32Array.of(1));
      continue;
    }
    const s = w.reduce((a, c) => a + c, 0) || 1;
    start[b] = k0; len[b] = w.length;
    weights.push(Float32Array.from(w.map((v) => v / s)));
  }
  return { start, len, weights };
}

/** DCT-II basis (rows = coefficients). */
export function dctBasis(nCoef: number, nIn: number): Float32Array {
  const m = new Float32Array(nCoef * nIn);
  for (let c = 0; c < nCoef; c++)
    for (let i = 0; i < nIn; i++) m[c * nIn + i] = Math.cos((Math.PI * c * (i + 0.5)) / nIn) * Math.sqrt(2 / nIn);
  return m;
}

/** Per-bin chroma mapping (55–5000 Hz, A = 440): two neighbouring pitch classes with linear weights. */
export function chromaMap(): { pc0: Int8Array; pc1: Int8Array; w0: Float32Array; w1: Float32Array } {
  const pc0 = new Int8Array(NB).fill(-1), pc1 = new Int8Array(NB).fill(-1);
  const w0 = new Float32Array(NB), w1 = new Float32Array(NB);
  const binHz = SR / WIN;
  for (let k = 1; k < NB; k++) {
    const f = k * binHz;
    if (f < 55 || f > 5000) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    const fl = Math.floor(midi), fr = midi - fl;
    // bins narrower than a semitone are trusted more; gentle roll-off above 2 kHz
    const semisPerBin = 12 * Math.log2((f + binHz) / f);
    const conf = clamp(1.2 / semisPerBin, 0.15, 1) * (f > 2000 ? 2000 / f : 1);
    pc0[k] = ((fl % 12) + 12) % 12;
    pc1[k] = (((fl + 1) % 12) + 12) % 12;
    w0[k] = (1 - fr) * conf;
    w1[k] = fr * conf;
  }
  return { pc0, pc1, w0, w1 };
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>, n = a.length, ao = 0, bo = 0): number {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { const x = a[ao + i], y = b[bo + i]; ab += x * y; aa += x * x; bb += y * y; }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/** index of the first element ≥ v in a sorted array */
export function lowerBound(arr: ArrayLike<number>, v: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
  return lo;
}

/** nearest element of a sorted array (or NaN when empty) */
export function nearest(arr: ArrayLike<number>, v: number): number {
  if (!arr.length) return NaN;
  const i = lowerBound(arr, v);
  if (i <= 0) return arr[0];
  if (i >= arr.length) return arr[arr.length - 1];
  return v - arr[i - 1] <= arr[i] - v ? arr[i - 1] : arr[i];
}

/** e^(−k·(t − last event ≤ t)); 0 before the first event. */
export function pulse(events: ArrayLike<number>, t: number, k = 7): number {
  const i = lowerBound(events, t + 1e-9) - 1;
  if (i < 0) return 0;
  return Math.exp(-k * (t - events[i]));
}

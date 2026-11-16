// Photosensitivity guard (SPEC §10.3), after WCAG 2.3.1 / ITU-R BT.1702.
// Pure analysis over a pre-pass of the timeline measured on a 4×4 grid — testable without a GPU.

export const GRID = 4;
export const CELLS = GRID * GRID;

export interface GuardFrame { lum: Float32Array; red: Float32Array }
export interface FlashReport {
  fps: number;
  /** global luminance transitions (frame indices) and red transitions */
  transitions: number[];
  redTransitions: number[];
  /** 1 s windows holding more than 3 flashes: [startFrame, endFrame] */
  violations: [number, number][];
  maxFlashesPerSecond: number;
}

/** relative luminance of an sRGB colour (0..1) */
export function relLum(r: number, g: number, b: number): number {
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** "saturated red" measure used for red flashes (R/(R+G+B) ≥ 0.8 → (R−G−B)·320 in WCAG terms, normalised to 0..1) */
export function redness(r: number, g: number, b: number): number {
  const s = r + g + b;
  return s > 1e-4 && r / s >= 0.8 ? Math.max(0, r - g - b) : 0;
}

/** Reduce a bottom-up RGBA byte grid (w×h) to the 4×4 measurement cells. */
export function measure(px: Uint8Array, w: number, h: number): GuardFrame {
  const lum = new Float32Array(CELLS), red = new Float32Array(CELLS), cnt = new Float32Array(CELLS);
  for (let y = 0; y < h; y++) {
    const cy = Math.min(GRID - 1, Math.floor((y / h) * GRID));
    for (let x = 0; x < w; x++) {
      const cx = Math.min(GRID - 1, Math.floor((x / w) * GRID));
      const i = (y * w + x) * 4, c = cy * GRID + cx;
      const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
      lum[c] += relLum(r, g, b); red[c] += redness(r, g, b); cnt[c]++;
    }
  }
  for (let c = 0; c < CELLS; c++) { lum[c] /= cnt[c] || 1; red[c] /= cnt[c] || 1; }
  return { lum, red };
}

/** Transitions of one series: a change ≥ `delta` between extrema where the darker state is < `darkMax`. */
function cellTransitions(series: Float32Array, n: number, stride: number, off: number, delta: number, darkMax: number): Int8Array {
  const out = new Int8Array(n);
  let ext = series[off], dir = 0;
  for (let f = 1; f < n; f++) {
    const v = series[f * stride + off];
    if (dir >= 0 && v > ext) { if (dir > 0) ext = v; }
    if (dir <= 0 && v < ext) { if (dir < 0) ext = v; }
    const d = v - ext;
    if (Math.abs(d) >= delta && Math.min(v, ext) < darkMax) {
      const sgn = d > 0 ? 1 : -1;
      if (sgn !== dir) { out[f] = sgn; dir = sgn; }
      ext = v;
    } else if ((dir > 0 && v > ext) || (dir < 0 && v < ext)) ext = v;
  }
  return out;
}

function globalTransitions(frames: GuardFrame[], key: 'lum' | 'red', delta: number, darkMax: number): number[] {
  const n = frames.length;
  const flat = new Float32Array(n * CELLS);
  for (let f = 0; f < n; f++) flat.set(frames[f][key], f * CELLS);
  const up = new Int16Array(n), down = new Int16Array(n);
  for (let c = 0; c < CELLS; c++) {
    const tr = cellTransitions(flat, n, CELLS, c, delta, darkMax);
    for (let f = 0; f < n; f++) { if (tr[f] > 0) up[f]++; else if (tr[f] < 0) down[f]++; }
  }
  // a transition is global when ≥ 25 % of the cells change the same way within 2 frames
  const need = Math.ceil(CELLS * 0.25);
  const out: number[] = [];
  let lastSign = 0, lastF = -10;
  for (let f = 0; f < n; f++) {
    const u = up[f] + (f > 0 ? up[f - 1] : 0), d = down[f] + (f > 0 ? down[f - 1] : 0);
    const sgn = u >= need && u >= d ? 1 : d >= need ? -1 : 0;
    if (!sgn) continue;
    if (sgn === lastSign && f - lastF <= 2) { lastF = f; continue; } // the same transition, still arriving
    out.push(f); lastSign = sgn; lastF = f;
  }
  return out;
}

/** Count flashes (pairs of opposing transitions) in every sliding 1 s window. */
export function analyseFlashes(frames: GuardFrame[], fps: number): FlashReport {
  const transitions = globalTransitions(frames, 'lum', 0.1, 0.8);
  const redTransitions = globalTransitions(frames, 'red', 0.1, 0.8);
  const win = Math.round(fps);
  const violations: [number, number][] = [];
  let maxFlashes = 0;
  for (const list of [transitions, redTransitions]) {
    let lo = 0;
    for (let hi = 0; hi < list.length; hi++) {
      while (list[hi] - list[lo] >= win) lo++;
      const count = hi - lo + 1;
      const flashes = Math.floor(count / 2);
      if (flashes > maxFlashes) maxFlashes = flashes;
      if (flashes > 3) {
        const a = list[lo], b = list[hi];
        const last = violations[violations.length - 1];
        if (last && a <= last[1] + win) last[1] = Math.max(last[1], b); else violations.push([a, b]);
      }
    }
  }
  violations.sort((x, y) => x[0] - y[0]);
  return { fps, transitions, redTransitions, violations, maxFlashesPerSecond: maxFlashes };
}

/** Attenuation curve a(t) per frame: `level` inside violating windows, eased over 3 frames. */
export function buildAttenuation(n: number, fps: number, report: FlashReport, level: number, prev?: Float32Array): Float32Array {
  const a = prev ? Float32Array.from(prev) : new Float32Array(n).fill(1);
  const pad = Math.round(fps * 0.5);
  for (const [s, e] of report.violations) {
    for (let f = Math.max(0, s - pad); f <= Math.min(n - 1, e + pad); f++) a[f] = Math.min(a[f], level);
  }
  // ease over 3 frames (min-filter keeps the floor, then a short triangular smooth)
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0, w = 0;
    for (let k = -3; k <= 3; k++) { const j = Math.min(n - 1, Math.max(0, f + k)); const ww = 4 - Math.abs(k); s += a[j] * ww; w += ww; }
    out[f] = Math.min(a[f] < 1 ? Math.max(a[f], s / w) : s / w, 1);
    if (a[f] < 1) out[f] = Math.min(out[f], Math.max(a[f], s / w));
  }
  return out;
}

/** Smoothed mean colour per frame (for the contrast compression in post). */
export function meanCurve(frames: GuardFrame[], fps: number): Float32Array {
  const n = frames.length;
  const raw = new Float32Array(n);
  for (let f = 0; f < n; f++) { let s = 0; for (let c = 0; c < CELLS; c++) s += frames[f].lum[c]; raw[f] = s / CELLS; }
  const out = new Float32Array(n);
  const k = Math.exp(-1 / (0.5 * fps));
  let y = raw[0] ?? 0;
  for (let f = 0; f < n; f++) { y = raw[f] + (y - raw[f]) * k; out[f] = y; }
  y = out[n - 1] ?? 0;
  for (let f = n - 1; f >= 0; f--) { y = out[f] + (y - out[f]) * k; out[f] = y; }
  return out;
}

export interface GuardState {
  fps: number;
  attenuation: Float32Array;
  mean: Float32Array;
  report: FlashReport;
  /** times (s) of the windows that were fixed */
  fixed: [number, number][];
  verified: boolean;
  key: string;
}

// Deterministic music/speech analysis. Pure functions over PCM; runs in a worker.
import type { Analysis, Section, SectionLabel } from '../types';

const OUT_FPS = 60;
const SR = 22050;
const WIN = 2048;
const HOP = 256;   // ≈ 86 frames / s
// Spectral flux responds when an attack enters the analysis window; calibrated on the fixture,
// the perceptual onset sits at ≈ 0.82 of the window, not its centre.
const ONSET_POS = 0.82;
const onsetTime = (i: number) => (i * HOP + WIN * ONSET_POS) / SR;

// ───────────────────────── basics ─────────────────────────
export function resampleTo(pcm: Float32Array, srIn: number, srOut: number): Float32Array {
  if (srIn === srOut) return pcm;
  const ratio = srIn / srOut, n = Math.floor(pcm.length / ratio), out = new Float32Array(n);
  // simple windowed-average decimation (anti-alias) + linear interpolation
  const span = Math.max(1, Math.round(ratio));
  for (let i = 0; i < n; i++) {
    const x = i * ratio, i0 = Math.floor(x);
    let acc = 0, c = 0;
    for (let k = 0; k < span; k++) { const j = i0 + k; if (j < pcm.length) { acc += pcm[j]; c++; } }
    out[i] = c ? acc / c : 0;
  }
  return out;
}

class FFT {
  n: number; rev: Uint32Array; cos: Float32Array; sin: Float32Array;
  constructor(n: number) {
    this.n = n; const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }
    this.cos = new Float32Array(n / 2); this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) { this.cos[i] = Math.cos(-2 * Math.PI * i / n); this.sin[i] = Math.sin(-2 * Math.PI * i / n); }
  }
  /** in-place complex FFT */
  run(re: Float32Array, im: Float32Array) {
    const n = this.n;
    for (let i = 0; i < n; i++) { const j = this.rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) for (let j = 0; j < half; j++) {
        const k = j * step, wr = this.cos[k], wi = this.sin[k];
        const a = i + j, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}

function percentileNorm(a: Float32Array, lo = 0.05, hi = 0.95): Float32Array {
  const s = Float32Array.from(a).sort();
  const vlo = s[Math.floor(lo * (s.length - 1))], vhi = s[Math.floor(hi * (s.length - 1))];
  const d = Math.max(1e-9, vhi - vlo), out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.min(1, Math.max(0, (a[i] - vlo) / d));
  return out;
}
function smooth(a: Float32Array, fps: number, attackMs = 15, releaseMs = 120): Float32Array {
  const ga = Math.exp(-1 / (fps * attackMs / 1000)), gr = Math.exp(-1 / (fps * releaseMs / 1000));
  const out = new Float32Array(a.length); let y = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i]; const g = x > y ? ga : gr; y = g * y + (1 - g) * x; out[i] = y; }
  return out;
}
function toFps(a: Float32Array, srcFps: number, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / OUT_FPS * srcFps, i0 = Math.min(a.length - 1, Math.floor(x)), i1 = Math.min(a.length - 1, i0 + 1), f = x - i0;
    out[i] = a[i0] * (1 - f) + a[i1] * f;
  }
  return out;
}
function median(arr: number[]): number { const s = [...arr].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; }

// ───────────────────────── main ─────────────────────────
export type Progress = (stage: string, p: number) => void;

export function analyze(monoIn: Float32Array, srIn: number, progress: Progress = () => {}): Analysis {
  const duration = monoIn.length / srIn;
  const x = resampleTo(monoIn, srIn, SR);
  const nFrames = Math.max(1, Math.floor((x.length - WIN) / HOP) + 1);
  const srcFps = SR / HOP;
  const fft = new FFT(WIN);
  const hann = new Float32Array(WIN); for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (WIN - 1));
  const nb = WIN / 2;
  const binHz = SR / WIN;
  const bandEdges = [20, 60, 250, 500, 2000, 4000, 8000, 11025];
  const bandIdx = bandEdges.map(f => Math.min(nb, Math.max(1, Math.round(f / binHz))));
  // mel filterbank (40) for MFCC + flux
  const NMEL = 40;
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700), imel = (m: number) => 700 * (10 ** (m / 2595) - 1);
  const melPts: number[] = []; for (let i = 0; i < NMEL + 2; i++) melPts.push(imel(mel(30) + (mel(8000) - mel(30)) * i / (NMEL + 1)));
  const melBins = melPts.map(f => Math.floor(f / binHz));

  const rms = new Float32Array(nFrames), cent = new Float32Array(nFrames), flux = new Float32Array(nFrames);
  const bandRaw = Array.from({ length: 7 }, () => new Float32Array(nFrames));
  const chroma = new Float32Array(nFrames * 12), mfcc = new Float32Array(nFrames * 13);
  const re = new Float32Array(WIN), im = new Float32Array(WIN), mag = new Float32Array(nb);
  let prevMel = new Float32Array(NMEL), curMel = new Float32Array(NMEL);
  const pcBin = new Int8Array(nb); for (let k = 1; k < nb; k++) { const f = k * binHz; pcBin[k] = f < 55 || f > 5000 ? -1 : ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12; }

  for (let fi = 0; fi < nFrames; fi++) {
    const off = fi * HOP;
    let e = 0;
    for (let i = 0; i < WIN; i++) { const v = x[off + i] || 0; re[i] = v * hann[i]; im[i] = 0; e += v * v; }
    rms[fi] = Math.sqrt(e / WIN);
    fft.run(re, im);
    let num = 0, den = 0;
    for (let k = 0; k < nb; k++) { const m = Math.hypot(re[k], im[k]); mag[k] = m; num += k * m; den += m; }
    cent[fi] = den > 0 ? num / den / nb : 0;
    for (let b = 0; b < 7; b++) { let s = 0; for (let k = bandIdx[b]; k < bandIdx[b + 1]; k++) s += mag[k] * mag[k]; bandRaw[b][fi] = Math.sqrt(s / Math.max(1, bandIdx[b + 1] - bandIdx[b])); }
    // mel energies (log)
    for (let m = 0; m < NMEL; m++) {
      let s = 0; const a = melBins[m], c = melBins[m + 1], d = melBins[m + 2];
      for (let k = a; k < d; k++) { const w = k < c ? (k - a) / Math.max(1, c - a) : (d - k) / Math.max(1, d - c); s += w * mag[k] * mag[k]; }
      curMel[m] = Math.log(1e-6 + s);
    }
    let fl = 0; for (let m = 0; m < NMEL; m++) { const dd = curMel[m] - prevMel[m]; if (dd > 0) fl += dd; }
    flux[fi] = fi ? fl : 0;
    for (let c = 0; c < 13; c++) { let s = 0; for (let m = 0; m < NMEL; m++) s += curMel[m] * Math.cos(Math.PI * c * (m + 0.5) / NMEL); mfcc[fi * 13 + c] = s; }
    for (let k = 1; k < nb; k++) { const p = pcBin[k]; if (p >= 0) chroma[fi * 12 + p] += mag[k]; }
    const t = prevMel; prevMel = curMel; curMel = t;
    if (fi % 2000 === 0) progress('spectrum', fi / nFrames);
  }
  progress('spectrum', 1);

  // ── onsets (on source frame rate) ──
  const fluxN = percentileNorm(flux, 0.05, 0.98);
  const onsetsIdx: number[] = [], onsetStr: number[] = [];
  const W = Math.round(0.25 * srcFps), minGap = Math.round(0.05 * srcFps);
  for (let i = 1; i < nFrames - 1; i++) {
    if (fluxN[i] < fluxN[i - 1] || fluxN[i] < fluxN[i + 1]) continue;
    const loc: number[] = []; for (let k = Math.max(0, i - W); k < Math.min(nFrames, i + W); k++) loc.push(fluxN[k]);
    if (fluxN[i] > median(loc) * 1.4 + 0.07 && (!onsetsIdx.length || i - onsetsIdx[onsetsIdx.length - 1] >= minGap)) { onsetsIdx.push(i); onsetStr.push(fluxN[i]); }
  }
  progress('onsets', 1);

  // ── tempo: autocorrelation of onset envelope with a log-gaussian prior around 120 BPM ──
  const env = fluxN;
  const minLag = Math.round(srcFps * 60 / 200), maxLag = Math.round(srcFps * 60 / 60);
  let bestLag = Math.round(srcFps * 0.5), bestScore = -1;
  const scores: number[] = [];
  const meanEnv = env.reduce((a, b) => a + b, 0) / env.length;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0; for (let i = lag; i < nFrames; i++) s += (env[i] - meanEnv) * (env[i - lag] - meanEnv);
    const bpm = 60 * srcFps / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const sc = s * prior; scores.push(sc);
    if (sc > bestScore) { bestScore = sc; bestLag = lag; }
  }
  const sortedScores = [...scores].sort((a, b) => b - a);
  const bpmConfidence = sortedScores.length > 4 && sortedScores[0] > 0 ? Math.min(1, Math.max(0, (sortedScores[0] - median(scores.map(Math.abs))) / (sortedScores[0] + 1e-9))) : 0;
  // refine to fractional lag by parabolic interpolation
  const li = bestLag - minLag;
  let lagF = bestLag;
  if (li > 0 && li < scores.length - 1) { const a = scores[li - 1], b = scores[li], c = scores[li + 1]; const den = a - 2 * b + c; if (Math.abs(den) > 1e-12) lagF = bestLag + 0.5 * (a - c) / den; }
  const bpm = 60 * srcFps / lagF;

  // ── beat tracking (dynamic programming, Ellis 2007) ──
  const period = lagF;
  const C = new Float32Array(nFrames), back = new Int32Array(nFrames).fill(-1);
  const alpha = 100;
  for (let i = 0; i < nFrames; i++) {
    let best = 0, bi = -1;
    const lo = Math.max(0, Math.round(i - 2 * period)), hi = Math.max(0, Math.round(i - period / 2));
    for (let j = lo; j < hi; j++) { const pen = -alpha * Math.log((i - j) / period) ** 2; const v = C[j] + pen; if (v > best || bi < 0) { best = v; bi = j; } }
    C[i] = env[i] + (bi >= 0 ? Math.max(0, best) : 0); back[i] = bi >= 0 && best > 0 ? bi : -1;
  }
  let end = 0; { let mx = -1; for (let i = Math.max(0, nFrames - Math.round(period * 2)); i < nFrames; i++) if (C[i] > mx) { mx = C[i]; end = i; } }
  const beatIdx: number[] = []; for (let i = end; i >= 0; i = back[i]) { beatIdx.push(i); if (back[i] < 0) break; }
  beatIdx.reverse();
  // extend the grid backward/forward with the period where the DP chain stopped
  while (beatIdx.length && beatIdx[0] - period > 0) beatIdx.unshift(Math.round(beatIdx[0] - period));
  while (beatIdx.length && beatIdx[beatIdx.length - 1] + period < nFrames) beatIdx.push(Math.round(beatIdx[beatIdx.length - 1] + period));
  const beats = beatIdx.map(onsetTime);
  progress('beats', 1);

  // ── downbeats: choose the phase (mod meter) with the strongest bass + flux ──
  const meter = 4;
  const bassRaw = bandRaw[1];
  let bestPhase = 0, bestPh = -1;
  for (let ph = 0; ph < meter; ph++) {
    let s = 0; for (let b = ph; b < beatIdx.length; b += meter) { const i = beatIdx[b]; s += (bassRaw[i] || 0) * 1 + (fluxN[i] || 0) * 0.5; }
    s /= Math.max(1, Math.ceil((beatIdx.length - ph) / meter));
    if (s > bestPh) { bestPh = s; bestPhase = ph; }
  }
  const downbeats = beats.filter((_, i) => i % meter === bestPhase);

  // ── output arrays at 60 fps ──
  const n = Math.max(1, Math.ceil(duration * OUT_FPS));
  const rmsDb = new Float32Array(nFrames); for (let i = 0; i < nFrames; i++) rmsDb[i] = 20 * Math.log10(rms[i] + 1e-6);
  const loud = smooth(toFps(percentileNorm(rmsDb), srcFps, n), OUT_FPS);
  const bandNames = ['sub', 'bass', 'lowMid', 'mid', 'highMid', 'high', 'air'] as const;
  const bands: Record<string, Float32Array> = {};
  bandNames.forEach((nm, b) => { const db = new Float32Array(nFrames); for (let i = 0; i < nFrames; i++) db[i] = 20 * Math.log10(bandRaw[b][i] + 1e-7); bands[nm] = smooth(toFps(percentileNorm(db), srcFps, n), OUT_FPS); });
  const centroid = smooth(toFps(percentileNorm(cent), srcFps, n), OUT_FPS, 40, 200);
  const flux60 = toFps(fluxN, srcFps, n);
  progress('features', 1);

  // ── sections (beat-synchronous chroma+mfcc, self-similarity novelty) ──
  const sections = findSections(beatIdx, chroma, mfcc, nFrames, beats, downbeats, loud, duration, bpmConfidence, onsetsIdx.map(onsetTime));
  progress('sections', 1);

  // ── drops: big bar-to-bar rise in bass and loudness ──
  const drops: number[] = [];
  const at = (a: Float32Array, t: number) => a[Math.min(a.length - 1, Math.max(0, Math.round(t * OUT_FPS)))];
  const barMean = (a: Float32Array, t0: number, t1: number) => { let s = 0, c = 0; for (let t = t0; t < t1; t += 1 / 30) { s += at(a, t); c++; } return c ? s / c : 0; };
  for (let i = 2; i < downbeats.length - 1; i++) {
    const t0 = downbeats[i - 1], t1 = downbeats[i], t2 = downbeats[i + 1];
    const dB = barMean(bands.bass, t1, t2) - barMean(bands.bass, t0, t1), dL = barMean(loud, t1, t2) - barMean(loud, t0, t1);
    const tb4 = downbeats[Math.max(0, i - 4)];
    const build = i >= 5 && barMean(bands.high, t0, t1) - barMean(bands.high, tb4, downbeats[Math.max(0, i - 3)]) > 0.08;
    const sec = sections.find(s => s.start <= t1 - 0.01 && s.end > t1 - 0.01);
    const afterBreak = !!sec && (sec.label === 'breakdown' || sec.label === 'bridge');
    if (dB > 0.28 && dL > 0.18 && (build || afterBreak) && (!drops.length || t1 - drops[drops.length - 1] > 8)) drops.push(t1);
  }

  // ── waveform peaks ──
  const peakBuckets = 2000, peaks = new Float32Array(peakBuckets * 2), per = monoIn.length / peakBuckets;
  for (let b = 0; b < peakBuckets; b++) {
    let mn = 1, mx = -1; const a = Math.floor(b * per), z = Math.floor((b + 1) * per);
    for (let i = a; i < z; i += 4) { const v = monoIn[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    peaks[b * 2] = mn; peaks[b * 2 + 1] = mx;
  }
  const onsets = onsetsIdx.map(onsetTime);
  progress('done', 1);
  return {
    fps: OUT_FPS, n, duration, loud, rmsDb: toFps(rmsDb, srcFps, n), bands: bands as unknown as Analysis['bands'], centroid, flux: flux60,
    onsets, onsetStrength: onsetStr, bpm, bpmConfidence, beats, downbeats, meter, sections, drops, peaks, peakBuckets
  };
}

function findSections(beatIdx: number[], chroma: Float32Array, mfcc: Float32Array, nFrames: number, beats: number[], downbeats: number[],
  loud: Float32Array, duration: number, bpmConf: number, onsets: number[]): Section[] {
  const nB = beatIdx.length;
  const mk = (s: number, e: number, label: SectionLabel, cluster = 0): Section => ({ start: s, end: e, label, energy: meanLoud(loud, s, e), cluster });
  if (nB < 24 || bpmConf < 0.08) {
    // speech or ambient: split at long pauses (no onsets for ≥ 1.2 s), at least 6 s apart
    const cuts = [0];
    for (let i = 1; i < onsets.length; i++) if (onsets[i] - onsets[i - 1] > 1.2 && onsets[i - 1] - cuts[cuts.length - 1] > 6) cuts.push((onsets[i] + onsets[i - 1]) / 2);
    cuts.push(duration);
    return cuts.slice(0, -1).map((c, i) => mk(c, cuts[i + 1], 'speech', i));
  }
  // beat-synchronous feature vectors (12 chroma + 13 mfcc), each block L2-normalised
  const D = 25, F = new Float32Array(nB * D);
  for (let b = 0; b < nB; b++) {
    const a = beatIdx[b], z = b + 1 < nB ? beatIdx[b + 1] : Math.min(nFrames, a + 20);
    for (let i = a; i < z; i++) { for (let c = 0; c < 12; c++) F[b * D + c] += chroma[i * 12 + c]; for (let c = 1; c < 13; c++) F[b * D + 12 + c] += mfcc[i * 13 + c]; }
    let n1 = 0, n2 = 0; for (let c = 0; c < 12; c++) n1 += F[b * D + c] ** 2; for (let c = 12; c < D; c++) n2 += F[b * D + c] ** 2;
    n1 = Math.sqrt(n1) || 1; n2 = Math.sqrt(n2) || 1;
    for (let c = 0; c < 12; c++) F[b * D + c] /= n1; for (let c = 12; c < D; c++) F[b * D + c] /= n2;
  }
  const sim = (i: number, j: number) => { let s = 0; for (let c = 0; c < D; c++) s += F[i * D + c] * F[j * D + c]; return s / 2; };
  const K = Math.min(16, Math.max(4, Math.floor(nB / 12)));
  const nov = new Float32Array(nB);
  for (let i = K; i < nB - K; i++) {
    let s = 0;
    for (let a = -K; a < K; a++) for (let b = -K; b < K; b++) {
      const sign = (a < 0) === (b < 0) ? 1 : -1;
      const g = Math.exp(-((a + 0.5) ** 2 + (b + 0.5) ** 2) / (2 * (K / 2) ** 2));
      s += sign * g * sim(i + a, i + b);
    }
    nov[i] = s;
  }
  // peaks snapped to downbeats, ≥ 8 bars apart (4 if the track is short)
  const minBeats = beats.length > 200 ? 32 : 16;
  const cand: { i: number; v: number }[] = [];
  for (let i = 1; i < nB - 1; i++) if (nov[i] > nov[i - 1] && nov[i] >= nov[i + 1] && nov[i] > 0) cand.push({ i, v: nov[i] });
  cand.sort((a, b) => b.v - a.v);
  const chosen: number[] = [];
  for (const c of cand) { if (chosen.every(j => Math.abs(j - c.i) >= minBeats)) chosen.push(c.i); }
  chosen.sort((a, b) => a - b);
  const snap = (t: number) => { let best = t, d = 1e9; for (const db of downbeats) { const dd = Math.abs(db - t); if (dd < d) { d = dd; best = db; } } return d < 2.5 ? best : t; };
  const bounds = [0, ...chosen.map(i => snap(beats[i])).filter(t => t > 4 && t < duration - 4), duration];
  const uniq = bounds.filter((t, i) => i === 0 || t - bounds[i - 1] > 3);
  if (uniq[uniq.length - 1] !== duration) uniq.push(duration);
  const segs = uniq.slice(0, -1).map((s, i) => ({ s, e: uniq[i + 1] }));
  // cluster segments by mean feature vector
  const beatOf = (t: number) => { let k = 0; while (k < beats.length - 1 && beats[k + 1] <= t) k++; return k; };
  const means = segs.map(sg => { const a = beatOf(sg.s), z = Math.max(a + 1, beatOf(sg.e)); const m = new Float32Array(D); for (let b = a; b < z; b++) for (let c = 0; c < D; c++) m[c] += F[b * D + c]; let nn = 0; for (let c = 0; c < D; c++) nn += m[c] ** 2; nn = Math.sqrt(nn) || 1; for (let c = 0; c < D; c++) m[c] /= nn; return m; });
  const segE = segs.map(sg => meanLoud(loud, sg.s, sg.e));
  const cluster: number[] = []; let next = 0;
  for (let i = 0; i < segs.length; i++) {
    let found = -1;
    for (let j = 0; j < i; j++) { let s = 0; for (let c = 0; c < D; c++) s += means[i][c] * means[j][c]; if (s > 0.975 && Math.abs(segE[i] - segE[j]) < 0.12) { found = cluster[j]; break; } }
    cluster.push(found >= 0 ? found : next++);
  }
  // merge neighbours that are the same material
  const merged: { s: number; e: number; c: number }[] = [];
  segs.forEach((sg, i) => { const last = merged[merged.length - 1]; if (last && last.c === cluster[i]) last.e = sg.e; else merged.push({ s: sg.s, e: sg.e, c: cluster[i] }); });
  const sections = merged.map(m => mk(m.s, m.e, 'verse', m.c));
  cluster.length = 0; merged.forEach(m => cluster.push(m.c));
  // label: the most energetic repeated cluster is the chorus
  const byCluster = new Map<number, number[]>(); cluster.forEach((c, i) => { if (!byCluster.has(c)) byCluster.set(c, []); byCluster.get(c)!.push(i); });
  if (![...byCluster.values()].some(v => v.length > 1)) { // nothing repeats: the loudest section plays the chorus role
    let bi = 0; sections.forEach((s, i) => { if (s.energy > sections[bi].energy) bi = i; }); byCluster.set(-99, [bi]); cluster[bi] = -99; }
  let chorusC = -1, bestE = -1;
  for (const [c, idx] of byCluster) { if (idx.length < 2 && c !== -99) continue; const e = idx.reduce((a, i) => a + sections[i].energy, 0) / idx.length; if (e > bestE) { bestE = e; chorusC = c; } }
  const meanE = sections.reduce((a, s) => a + s.energy, 0) / sections.length;
  sections.forEach((s, i) => {
    if (cluster[i] === chorusC) s.label = 'chorus';
    else if (s.energy < meanE * 0.6 && i > 0 && i < sections.length - 1) s.label = 'breakdown';
  });
  if (sections.length > 2 && sections[0].energy < meanE * 0.8 && sections[0].label !== 'chorus') sections[0].label = 'intro';
  const last = sections[sections.length - 1];
  if (sections.length > 2 && last.energy < meanE * 0.8 && last.label !== 'chorus') last.label = 'outro';
  // a one-off section between choruses late in the song is the bridge
  for (let i = 1; i < sections.length - 1; i++) if (sections[i].label === 'verse' && byCluster.get(cluster[i])!.length === 1 && i > sections.length / 2) { sections[i].label = 'bridge'; break; }
  return sections;
}

function meanLoud(loud: Float32Array, a: number, b: number): number {
  const i0 = Math.max(0, Math.floor(a * OUT_FPS)), i1 = Math.min(loud.length, Math.ceil(b * OUT_FPS));
  let s = 0; for (let i = i0; i < i1; i++) s += loud[i]; return i1 > i0 ? s / (i1 - i0) : 0;
}

/** Sample a per-frame feature array at time t (seconds). */
export function sample(a: Float32Array, t: number, fps = OUT_FPS): number {
  if (!a.length) return 0;
  const x = t * fps, i0 = Math.floor(x), f = x - i0;
  const a0 = a[Math.min(a.length - 1, Math.max(0, i0))], a1 = a[Math.min(a.length - 1, Math.max(0, i0 + 1))];
  return a0 + (a1 - a0) * f;
}

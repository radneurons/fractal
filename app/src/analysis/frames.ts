// Single streaming STFT pass (SPEC §4, §4A.1–4A.3): v2 features, HPSS, vocal estimate and pitch candidates.
// Memory stays O(17 frames): the HPSS medians run over ring buffers.
import { FFT, hann, melBank, dctBasis, SR, WIN, HOP, NB } from './dsp.ts';

export const N_MEL = 40;
export const N_MFCC = 13;
export const HPSS_HALF = 8; // 17-frame / 17-bin medians
export const N_CAND = 3;
/** YIN takes the FIRST dip: longer lags (sub-harmonics) pay this much per octave */
export const OCTAVE_BIAS = 0.07;
export const BAND_EDGES = [20, 60, 250, 500, 2000, 4000, 8000, 11025];
// pitch lags are measured at half rate (11 025 Hz): the vocal power spectrum is only used up to 4 kHz
export const PSR = SR / 2;
export const PFFT = WIN / 2;
export const TAU_MIN = Math.floor(PSR / 1100);
export const TAU_MAX = Math.ceil(PSR / 70);

export interface Frames {
  nF: number;
  rms: Float32Array;
  centroid: Float32Array;
  bands: Float32Array[];
  flux: Float32Array;
  pflux: Float32Array;
  vflux: Float32Array;
  mfcc: Float32Array;
  chroma: Float32Array;
  harm: Float32Array;
  perc: Float32Array;
  vRatio: Float32Array;
  vFlat: Float32Array;
  vEnergy: Float32Array;
  yin: Float32Array;
  candF: Float32Array;
  candC: Float32Array;
}

export interface FrameInput {
  left: Float32Array;
  right: Float32Array | null;
  /** optional user vocal stem (mono, 22 050 Hz): replaces the centre/harmonic estimate */
  vocalStem?: Float32Array | null;
  onProgress?: (p: number) => void;
}

export function computeFrames(inp: FrameInput): Frames {
  const { left, right } = inp;
  const stem = inp.vocalStem ?? null;
  const len = left.length;
  const nF = Math.max(1, Math.ceil(len / HOP));
  const W = 2 * HPSS_HALF + 1;
  const fft = new FFT(WIN);
  const win = hann(WIN);
  let wsum = 0;
  for (let i = 0; i < WIN; i++) wsum += win[i];
  const magScale = 2 / wsum;
  const binHz = SR / WIN;

  const out: Frames = {
    nF,
    rms: new Float32Array(nF), centroid: new Float32Array(nF),
    bands: BAND_EDGES.slice(1).map(() => new Float32Array(nF)),
    flux: new Float32Array(nF), pflux: new Float32Array(nF), vflux: new Float32Array(nF),
    mfcc: new Float32Array(nF * N_MFCC), chroma: new Float32Array(nF * 12),
    harm: new Float32Array(nF), perc: new Float32Array(nF),
    vRatio: new Float32Array(nF), vFlat: new Float32Array(nF), vEnergy: new Float32Array(nF),
    yin: new Float32Array(nF).fill(1), candF: new Float32Array(nF * N_CAND), candC: new Float32Array(nF * N_CAND).fill(9),
  };

  const mel = melBank(N_MEL, 30, 8000);
  const dct = dctBasis(N_MFCC, N_MEL);
  // chroma range 55–5000 Hz; low bins (wider than a semitone) and high overtones count less
  const cLo = Math.max(2, Math.ceil(55 / binHz)), cHi = Math.min(NB - 2, Math.floor(5000 / binHz));
  // pitch spectrum weight: fades in 150 → 400 Hz so bass harmonics do not set the period
  // (a voice's period is still carried by its harmonics above 400 Hz)
  const pw = new Float32Array(NB);
  for (let k = 0; k < NB; k++) { const x = Math.min(1, Math.max(0, (k * binHz - 150) / 250)); pw[k] = x * x; }
  const cw8 = new Float32Array(NB);
  const cSide = right ? Math.round(200 / binHz) : NB;
  for (let k = cLo; k < cHi; k++) {
    const f = k * binHz;
    const semisPerBin = 12 * Math.log2((f + binHz) / f);
    // (a 5th harmonic is a major third: upper partials would invent thirds, so they roll off fast)
    cw8[k] = Math.min(1, Math.max(0.2, 1.5 / semisPerBin)) * (f > 700 ? (700 / f) ** 2 : 1);
  }
  const bandBin = BAND_EDGES.map((f) => Math.min(NB - 1, Math.max(1, Math.round(f / binHz))));
  const vLo = Math.ceil(120 / binHz), vHi = Math.min(NB - 1, Math.floor(8000 / binHz));
  const pHi = Math.floor(4000 / binHz);
  /** HPSS runs on bins [0, NH): everything above 8.2 kHz is counted as percussive */
  const NH = Math.min(NB, Math.ceil(8200 / binHz));

  // window autocorrelation for the YIN normalisation
  const wr = new Float64Array(TAU_MAX + 2);
  for (let tau = 0; tau <= TAU_MAX + 1; tau++) {
    let s = 0;
    for (let n = 0; n + 2 * tau < WIN; n++) s += win[n] * win[n + 2 * tau];
    wr[tau] = s;
  }

  const re = new Float64Array(WIN), im = new Float64Array(WIN);
  const fftP = new FFT(PFFT);
  const re2 = new Float64Array(PFFT), im2 = new Float64Array(PFFT);
  const mag = new Float32Array(NB);
  const lm = new Float32Array(N_MEL), lmPrev = new Float32Array(N_MEL);
  const plm = new Float32Array(N_MEL), plmPrev = new Float32Array(N_MEL);
  const vlm = new Float32Array(N_MEL), vlmPrev = new Float32Array(N_MEL);
  let havePrev = false, havePrevP = false;

  // HPSS rings
  const ringMag = new Float32Array(W * NB);
  const ringCw = new Float32Array(W * NB);
  const ringStem = stem ? new Float32Array(W * NB) : null;
  const sorted = new Float32Array(NB * W);
  const fsort = new Float32Array(W);
  const Pmed = new Float32Array(NB);
  const hmag = new Float32Array(NB), pmag = new Float32Array(NB), vmag = new Float32Array(NB);
  const dprime = new Float32Array(TAU_MAX + 2);

  const analyseFrame = (i: number, m: Float32Array, cw: Float32Array | null, sm: Float32Array | null) => {
    const base = i * HOP;
    // ---- FFT (stereo in one complex transform) ----
    let sq = 0;
    if (right) {
      for (let n = 0; n < WIN; n++) {
        const j = base + n;
        const l = j < len ? left[j] : 0, r = j < len ? right[j] : 0;
        re[n] = l * win[n]; im[n] = r * win[n];
        const mono = 0.5 * (l + r);
        sq += mono * mono;
      }
    } else {
      for (let n = 0; n < WIN; n++) {
        const j = base + n;
        const l = j < len ? left[j] : 0;
        re[n] = l * win[n]; im[n] = 0;
        sq += l * l;
      }
    }
    fft.forward(re, im);
    if (right && cw) {
      for (let k = 0; k < NB; k++) {
        const k2 = (WIN - k) & (WIN - 1);
        const lr = 0.5 * (re[k] + re[k2]), li = 0.5 * (im[k] - im[k2]);
        const rr = 0.5 * (im[k] + im[k2]), ri = -0.5 * (re[k] - re[k2]);
        const ml = Math.sqrt(lr * lr + li * li), mr = Math.sqrt(rr * rr + ri * ri);
        const dr = lr - rr, di = li - ri, sr = lr + rr, si = li + ri;
        const md = Math.sqrt(dr * dr + di * di);
        m[k] = 0.5 * Math.sqrt(sr * sr + si * si) * magScale;
        const c = 1 - md / (ml + mr + 1e-9);
        const c2 = c * c;
        cw[k] = c2 * c2;
      }
    } else {
      for (let k = 0; k < NB; k++) m[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * magScale;
      if (cw) cw.fill(1);
    }
    if (stem && sm) {
      for (let n = 0; n < WIN; n++) {
        const j = base + n;
        re[n] = (j < stem.length ? stem[j] : 0) * win[n]; im[n] = 0;
      }
      fft.forward(re, im);
      for (let k = 0; k < NB; k++) sm[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * magScale;
    }
    // ---- v2 features ----
    out.rms[i] = Math.sqrt(sq / WIN);
    let num = 0, den = 0;
    for (let k = 1; k < NB; k++) { num += k * m[k]; den += m[k]; }
    out.centroid[i] = den > 1e-9 ? num / den / (NB - 1) : 0;
    for (let b = 0; b < 7; b++) {
      const k0 = bandBin[b], k1 = Math.max(k0 + 1, bandBin[b + 1]);
      let s = 0;
      for (let k = k0; k < k1; k++) s += m[k] * m[k];
      out.bands[b][i] = Math.sqrt(s / (k1 - k0));
    }
    let fl = 0;
    for (let b = 0; b < N_MEL; b++) {
      const w = mel.weights[b], s0 = mel.start[b];
      let s = 0;
      for (let q = 0; q < w.length; q++) s += w[q] * m[s0 + q];
      const v = Math.log(1 + 1000 * s);
      lm[b] = v;
      if (havePrev) { const d = v - lmPrev[b]; if (d > 0) fl += d; }
    }
    out.flux[i] = fl;
    for (let c = 0; c < N_MFCC; c++) {
      let s = 0;
      const o = c * N_MEL;
      for (let b = 0; b < N_MEL; b++) s += dct[o + b] * lm[b];
      out.mfcc[i * N_MFCC + c] = s;
    }
    lmPrev.set(lm);
    havePrev = true;
  };

  // centre frame j: HPSS masks, harmonic chroma, vocal spectrum and pitch
  const analyseCentre = (j: number, slot: number) => {
    const o = slot * NB;
    // frequency median (percussive estimate) for this frame
    {
      for (let q = 0; q < W; q++) { const k = q - HPSS_HALF; fsort[q] = ringMag[o + (k < 0 ? 0 : k)]; }
      fsort.sort();
      Pmed[0] = fsort[HPSS_HALF];
      for (let k = 1; k < NH; k++) {
        const kr = k - 1 - HPSS_HALF, ka = k + HPSS_HALF;
        const rem = ringMag[o + (kr < 0 ? 0 : kr)], add = ringMag[o + (ka >= NH ? NH - 1 : ka)];
        if (rem !== add) {
          // binary search for `rem`, then shift towards the insertion point
          let lo = 0, hi = W - 1;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (fsort[mid] < rem) lo = mid + 1; else hi = mid; }
          let q = lo;
          if (add > rem) { while (q < W - 1 && fsort[q + 1] < add) { fsort[q] = fsort[q + 1]; q++; } }
          else { while (q > 0 && fsort[q - 1] > add) { fsort[q] = fsort[q - 1]; q--; } }
          fsort[q] = add;
        }
        Pmed[k] = fsort[HPSS_HALF];
      }
    }
    let he = 0, pe = 0, tot = 0;
    for (let k = 0; k < NH; k++) {
      const H = sorted[k * W + HPSS_HALF], P = Pmed[k];
      const h2 = H * H, p2 = P * P;
      const mh = h2 / (h2 + p2 + 1e-12);
      const x = ringMag[o + k];
      const hm = mh * x, pm = x - hm;
      hmag[k] = hm; pmag[k] = pm;
      he += hm * hm; pe += pm * pm; tot += x * x;
    }
    for (let k = NH; k < NB; k++) { const x = ringMag[o + k]; pmag[k] = x; pe += x * x; tot += x * x; }
    out.harm[j] = Math.sqrt(he / NB);
    out.perc[j] = Math.sqrt(pe / NB);
    // percussive mel flux
    let pf = 0;
    for (let b = 0; b < N_MEL; b++) {
      const w = mel.weights[b], s0 = mel.start[b];
      let s = 0;
      for (let q = 0; q < w.length; q++) s += w[q] * pmag[s0 + q];
      const v = Math.log(1 + 1000 * s);
      plm[b] = v;
      if (havePrevP) { const d = v - plmPrev[b]; if (d > 0) pf += d; }
    }
    out.pflux[j] = pf;
    plmPrev.set(plm);
    // peak chroma: only spectral peaks that stand above the local floor (the 17-bin frequency median)
    // contribute, at their interpolated frequency. Broadband content would flatten the chroma.
    const co = j * 12;
    for (let k = cLo; k < cHi; k++) {
      const x = hmag[k];
      if (x <= hmag[k - 1] || x < hmag[k + 1]) continue;
      const above = x - 1.6 * Pmed[k];
      if (above <= 0) continue;
      const a = hmag[k - 1], c = hmag[k + 1];
      const den = a - 2 * x + c;
      const sh = den < -1e-12 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
      const midi = 69 + 12 * Math.log2(((k + sh) * binHz) / 440);
      const fl = Math.floor(midi), fr = midi - fl;
      // lead vocals sit in the centre; chordal instruments are usually spread: favour the sides above 200 Hz
      const v = Math.sqrt(above) * cw8[k] * (k > cSide ? 1 - 0.7 * ringCw[o + k] : 1);
      out.chroma[co + (((fl % 12) + 12) % 12)] += v * (1 - fr);
      out.chroma[co + ((((fl + 1) % 12) + 12) % 12)] += v * fr;
    }
    // vocal spectrum
    let ve = 0, logSum = 0, linSum = 0, nFlat = 0;
    vmag.fill(0);
    for (let k = vLo; k <= vHi; k++) {
      const v = ringStem ? ringStem[o + k] : ringCw[o + k] * hmag[k];
      vmag[k] = v;
      const p = v * v;
      ve += p;
      if ((k & 3) === 0) { logSum += Math.log(p + 1e-12); linSum += p + 1e-12; nFlat++; }
    }
    const nv = vHi - vLo + 1;
    out.vEnergy[j] = Math.sqrt(ve / nv);
    out.vRatio[j] = tot > 1e-12 ? Math.min(1, ve / tot) : 0;
    out.vFlat[j] = Math.exp(logSum / nFlat) / (linSum / nFlat);
    let vf = 0;
    for (let b = 0; b < N_MEL; b++) {
      const w = mel.weights[b], s0 = mel.start[b];
      let s = 0;
      for (let q = 0; q < w.length; q++) s += w[q] * vmag[s0 + q];
      const v = Math.log(1 + 1000 * s);
      vlm[b] = v;
      if (havePrevP) { const d = v - vlmPrev[b]; if (d > 0) vf += d; }
    }
    out.vflux[j] = vf;
    vlmPrev.set(vlm);
    havePrevP = true;
    // ---- pitch: autocorrelation = inverse FFT of the vocal power spectrum (≤ 4 kHz) ----
    if (ve / nv < 1e-10) return;
    re2.fill(0); im2.fill(0);
    for (let k = vLo; k <= pHi; k++) {
      const p = vmag[k] * vmag[k] * pw[k];
      re2[k] = p; re2[PFFT - k] = p;
    }
    fftP.forward(re2, im2); // real & symmetric → the forward transform is the (unscaled) inverse
    const r0 = re2[0];
    if (r0 <= 0) return;
    let cum = 0;
    dprime[0] = 1;
    for (let tau = 1; tau <= TAU_MAX + 1; tau++) {
      const rho = (re2[tau] / r0) / (wr[tau] / wr[0]);
      const d = Math.max(0, 1 - rho);
      cum += d;
      dprime[tau] = cum > 1e-12 ? (d * tau) / cum : 1;
    }
    // local minima → best 3 candidates
    let n = 0;
    const cF = out.candF, cC = out.candC, b3 = j * N_CAND;
    let best = 1;
    for (let tau = TAU_MIN; tau <= TAU_MAX; tau++) {
      const d = dprime[tau];
      if (d < dprime[tau - 1] && d <= dprime[tau + 1] && d < 0.6) {
        const a = dprime[tau - 1], c = dprime[tau + 1];
        const denom = a - 2 * d + c;
        const shift = Math.abs(denom) > 1e-12 ? (0.5 * (a - c)) / denom : 0;
        const tt = tau + Math.max(-0.5, Math.min(0.5, shift));
        const dv = d - 0.25 * (a - c) * shift;
        const cost = dv + OCTAVE_BIAS * Math.log2(tt / TAU_MIN);
        if (dv < best) best = dv;
        // insert into the sorted top-3
        let pos = n < N_CAND ? n : -1;
        for (let q = 0; q < Math.min(n, N_CAND); q++) if (cost < cC[b3 + q]) { pos = q; break; }
        if (pos >= 0) {
          for (let q = Math.min(n, N_CAND - 1); q > pos; q--) { cF[b3 + q] = cF[b3 + q - 1]; cC[b3 + q] = cC[b3 + q - 1]; }
          cF[b3 + pos] = PSR / tt; cC[b3 + pos] = cost;
          if (n < N_CAND) n++;
        }
      }
    }
    out.yin[j] = Math.max(0, Math.min(1, best));
  };

  const total = nF + HPSS_HALF;
  const tmpMag = new Float32Array(NB), tmpCw = new Float32Array(NB), tmpStem = stem ? new Float32Array(NB) : null;
  for (let i = 0; i < total; i++) {
    const slot = i % W;
    const o = slot * NB;
    if (i < nF) {
      analyseFrame(i, tmpMag, tmpCw, tmpStem);
    } // else: flush with the last frame replicated (tmp buffers keep the last frame)
    // update the per-bin sorted windows (time median)
    if (i === 0) {
      for (let k = 0; k < NH; k++) {
        const v = tmpMag[k];
        const so = k * W;
        for (let q = 0; q < W; q++) sorted[so + q] = v;
      }
      for (let s = 0; s < W; s++) ringMag.set(tmpMag, s * NB);
    } else {
      for (let k = 0; k < NH; k++) {
        const rem = ringMag[o + k], add = tmpMag[k];
        if (rem === add) continue;
        const so = k * W;
        let lo = 0, hi = W - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[so + mid] < rem) lo = mid + 1; else hi = mid; }
        let q = lo;
        if (add > rem) { while (q < W - 1 && sorted[so + q + 1] < add) { sorted[so + q] = sorted[so + q + 1]; q++; } }
        else { while (q > 0 && sorted[so + q - 1] > add) { sorted[so + q] = sorted[so + q - 1]; q--; } }
        sorted[so + q] = add;
      }
    }
    ringMag.set(tmpMag, o);
    ringCw.set(tmpCw, o);
    if (ringStem && tmpStem) ringStem.set(tmpStem, o);
    const j = i - HPSS_HALF;
    if (j >= 0) analyseCentre(j, ((j % W) + W) % W);
    if (inp.onProgress && (i & 511) === 0) inp.onProgress(i / total);
  }
  return out;
}

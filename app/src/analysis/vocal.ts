// Vocal activity (SPEC §4A.2): a logistic combination of per-frame cues from the vocal estimate.
import type { Frames } from './frames.ts';
import { FRAME_RATE, percentile, smoothAR, clamp } from './dsp.ts';
import { detectOnsets, normaliseFlux } from './rhythm.ts';

/** weights tuned on the fixtures and checked against Whisper-aligned real songs */
export const VOCAL_WEIGHTS = { bias: -5.2, energy: 2.2, tonal: 1.0, voicing: 2.6, modulation: 3.4, ratio: 0.5, release: 400, outRelease: 120 };

export function vocalActivity(f: Frames): Float32Array {
  const n = f.nF;
  // vocal-band level, normalised in dB between the 10th and 95th percentiles
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) db[i] = 20 * Math.log10(f.vEnergy[i] + 1e-7);
  const hiDb = percentile(db, 0.95), loDb = Math.max(percentile(db, 0.1), hiDb - 40);
  // 4–8 Hz modulation of the vocal-band envelope (syllable rate): difference of two one-poles
  const k8 = Math.exp((-2 * Math.PI * 8) / FRAME_RATE), k4 = Math.exp((-2 * Math.PI * 3) / FRAME_RATE);
  const mod = new Float32Array(n);
  let a = db[0] ?? 0, b = db[0] ?? 0;
  for (let i = 0; i < n; i++) {
    const x = Math.max(db[i], loDb);
    a = x + (a - x) * k8; b = x + (b - x) * k4;
    mod[i] = Math.abs(a - b);
  }
  // syllable-rate modulation with a long memory, so held notes after sung syllables stay active
  const modS = smoothAR(mod, FRAME_RATE, 40, VOCAL_WEIGHTS.release);
  const modRef = Math.max(percentile(modS, 0.9), 1e-3);
  const w = VOCAL_WEIGHTS;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const e = clamp((db[i] - loDb) / Math.max(6, hiDb - loDb), 0, 1);
    const ratio = clamp(f.vRatio[i] * 2.5, 0, 1);
    const tonal = 1 - clamp(Math.sqrt(f.vFlat[i]) * 2, 0, 1);
    const voicing = clamp(1 - f.yin[i] * 1.6, 0, 1);
    const m = clamp(modS[i] / modRef, 0, 1);
    const z = w.bias + w.energy * e * (1 - w.ratio + w.ratio * ratio) + w.tonal * tonal + w.voicing * voicing + w.modulation * m;
    raw[i] = e < 0.08 ? 0 : 1 / (1 + Math.exp(-z));
  }
  return smoothAR(raw, FRAME_RATE, 30, VOCAL_WEIGHTS.outRelease);
}

/** Onsets of the vocal estimate (syllable boundary candidates). */
export function vocalOnsets(f: Frames, activity: Float32Array): number[] {
  const { times } = detectOnsets(normaliseFlux(f.vflux), 1.3, 0.05);
  return times.filter((t) => {
    const i = clamp(Math.round(t * FRAME_RATE), 0, activity.length - 1);
    let m = 0;
    for (let k = i; k <= Math.min(activity.length - 1, i + 8); k++) if (activity[k] > m) m = activity[k];
    return m > 0.3;
  });
}

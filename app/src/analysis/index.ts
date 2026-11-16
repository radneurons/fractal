// Analysis pipeline (SPEC §4 + §4A). Pure function of the audio: deterministic, DOM-free.
import type { Analysis, Bands, Section } from '../types.ts';
import {
  SR, HOP, FPS, FRAME_RATE, LEAD_ENERGY, LEAD_FLUX, resample, percentileNormalise, smoothAR, toFps, clamp, median,
} from './dsp.ts';
import { computeFrames } from './frames.ts';
import {
  normaliseFlux, detectOnsets, estimateTempo, tempogram, trackBeats, extendBeats, regulariseBeats,
  beatFeatures, detectMeter, pickDownbeats, speechCues, frameToTimeFlux,
} from './rhythm.ts';
import { footeBoundaries, speechBoundaries, findRepeats, clusterAndLabel, findDrops } from './structure.ts';
import { estimateKey, estimateChords, beatChromaMedian } from './harmony.ts';
import { vocalActivity, vocalOnsets } from './vocal.ts';
import { trackPitch } from './pitch.ts';
import { audioMood } from './mood.ts';
import { integratedLufs } from './loudness.ts';

export const ANALYSIS_VERSION = 7;

export interface AudioInput {
  sampleRate: number;
  channels: Float32Array[];
  /** optional user stems (mono or stereo arrays at their own sample rate) */
  stems?: { vocals?: { sampleRate: number; channels: Float32Array[] } };
}

export type Progress = (stage: string, p: number) => void;

function mono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length, out = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) out[i] += c[i];
  const k = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

function stereoIsWide(l: Float32Array, r: Float32Array): boolean {
  let d = 0, s = 0;
  for (let i = 0; i < l.length; i += 7) { d += (l[i] - r[i]) ** 2; s += (l[i] + r[i]) ** 2; }
  return d > 1e-5 * (s + 1e-12);
}

export function analyze(input: AudioInput, onProgress: Progress = () => {}): Analysis {
  const srIn = input.sampleRate;
  const duration = input.channels[0].length / srIn;
  onProgress('resample', 0);
  let left: Float32Array, right: Float32Array | null = null;
  if (input.channels.length >= 2 && stereoIsWide(input.channels[0], input.channels[1])) {
    left = resample(input.channels[0], srIn, SR);
    right = resample(input.channels[1], srIn, SR);
  } else {
    left = resample(mono(input.channels.slice(0, 2)), srIn, SR);
  }
  let vocalStem: Float32Array | null = null;
  if (input.stems?.vocals) vocalStem = resample(mono(input.stems.vocals.channels), input.stems.vocals.sampleRate, SR);

  onProgress('spectrum', 0.05);
  const F = computeFrames({ left, right, vocalStem, onProgress: (p) => onProgress('spectrum', 0.05 + 0.6 * p) });
  const nF = F.nF;
  const n = Math.max(1, Math.ceil(duration * FPS));

  // ---- 60 fps features ----
  const norm = (arr: Float32Array, lead: number) => smoothAR(percentileNormalise(toFps(arr, lead, n)), FPS, 15, 120);
  const rmsDbF = new Float32Array(nF);
  for (let i = 0; i < nF; i++) rmsDbF[i] = 20 * Math.log10(F.rms[i] + 1e-6);
  const loud = norm(F.rms, LEAD_ENERGY);
  const rmsDb = toFps(rmsDbF, LEAD_ENERGY, n);
  const centroid = norm(F.centroid, LEAD_ENERGY);
  const flux = norm(F.flux, LEAD_FLUX);
  const b = F.bands.map((x) => norm(x, LEAD_ENERGY));
  const bands: Bands = { sub: b[0], bass: b[1], lowMid: b[2], mid: b[3], highMid: b[4], high: b[5], air: b[6] };
  const harmonic = norm(F.harm, LEAD_ENERGY);
  const percussive = norm(F.perc, LEAD_ENERGY);

  // ---- onsets (full mix: word snapping) ----
  onProgress('tempo', 0.68);
  const fluxN = normaliseFlux(F.flux);
  const on = detectOnsets(fluxN);

  // ---- tempo & beats from the percussive part ----
  let pfluxN = normaliseFlux(F.pflux);
  // drumless material: fall back to the full-mix flux
  {
    let pm = 0, fm = 0;
    for (let i = 0; i < nF; i++) { pm += F.perc[i]; fm += F.harm[i]; }
    if (pm < 0.02 * fm) pfluxN = fluxN;
  }
  // blend: percussive flux keeps beats on drums, full-mix flux helps drumless passages
  const env = new Float32Array(nF);
  for (let i = 0; i < nF; i++) env[i] = 0.7 * pfluxN[i] + 0.3 * fluxN[i];
  const tempo = estimateTempo(env);
  let bpmConfidence = tempo.confidence;
  const tg = tempogram(env, tempo.period);
  const drift = tg.variation > 0.04 && bpmConfidence > 0.3;
  const periodAt = drift
    ? (f: number) => tg.periods[clamp(Math.round(f / Math.round(FRAME_RATE)), 0, tg.periods.length - 1)]
    : () => tempo.period;
  let beatFrames = trackBeats(env, periodAt);
  let beats = beatFrames.map(frameToTimeFlux).filter((t) => t >= 0 && t <= duration);
  if (!drift) beats = regulariseBeats(beats);
  beats = extendBeats(beats, duration, (tempo.period * HOP) / SR);
  let bpm = tempo.bpm;
  if (beats.length > 8) {
    const d: number[] = [];
    for (let i = 1; i < beats.length; i++) d.push(beats[i] - beats[i - 1]);
    const md = median(d);
    if (md > 0) {
      // regression slope over the regular beats = mean period
      const reg = d.filter((x) => Math.abs(x - md) < 0.08 * md);
      const mp = reg.reduce((a, c) => a + c, 0) / (reg.length || 1);
      if (mp > 0) bpm = 60 / mp;
    }
  }

  // ---- speech detection ----
  const cues = speechCues(env, beats, F.rms);
  let isSpeech = false;
  if (cues.silence > 0.15 && (cues.pulse < 2.2 || bpmConfidence < 0.7)) { bpmConfidence = Math.min(bpmConfidence, 0.05); isSpeech = true; }
  if (bpmConfidence < 0.1 && cues.pulse < 1.6) isSpeech = true;
  const shortClip = beats.length < 24;

  // ---- beat features, meter, downbeats ----
  onProgress('harmony', 0.76);
  let bf = beatFeatures(beats, duration, { bands: F.bands, env, chroma: F.chroma, mfcc: F.mfcc, rms: F.rms, nF });
  const meter = isSpeech ? 4 : detectMeter(bf, beats, env, bpm);
  const perBar = meter === 6 ? 2 : meter;
  const { downbeats } = pickDownbeats(beats, bf.score, perBar);

  // ---- harmony ----
  const bc = beatChromaMedian(F.chroma, nF, beats, duration);
  const chords = isSpeech ? [] : estimateChords(bc, beats, duration);
  const { key, keyChanges } = isSpeech
    ? { key: { tonic: 0, mode: 'major' as const, confidence: 0 }, keyChanges: [] }
    : estimateKey(F.chroma, F.harm, downbeats, chords);

  // ---- vocals & pitch ----
  onProgress('vocals', 0.82);
  const act = vocalActivity(F);
  const vOn = vocalOnsets(F, act);
  const pt = trackPitch(F, act);
  const vocal = toFps(act, LEAD_ENERGY, n);
  const f0 = new Float32Array(n), f0Conf = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const idx = clamp(Math.round(((k / FPS) * SR - LEAD_ENERGY) / HOP), 0, nF - 1);
    f0[k] = pt.f0[idx]; f0Conf[k] = pt.conf[idx];
  }

  // ---- drops, sections ----
  onProgress('structure', 0.88);
  const highs = new Float32Array(n);
  for (let i = 0; i < n; i++) highs[i] = 0.5 * (bands.high[i] + bands.air[i]);
  const bassSub = new Float32Array(n);
  for (let i = 0; i < n; i++) bassSub[i] = Math.max(bands.bass[i], bands.sub[i]);
  const drops = isSpeech ? [] : findDrops(downbeats, loud, bassSub, highs, duration);
  const sin = { beats, downbeats, bf, duration, loud, perBar };
  let sections: Section[];
  let repeats: { a: number; b: number; len: number }[] = [];
  if (isSpeech) {
    sections = clusterAndLabel(speechBoundaries(F.rms, duration), sin, [], [], true);
  } else if (shortClip) {
    sections = clusterAndLabel([], sin, [], drops, false);
  } else {
    repeats = findRepeats(sin);
    sections = clusterAndLabel(footeBoundaries(sin), sin, repeats, drops, false);
  }

  // ---- tempo curve ----
  const tempoCurve = new Float32Array(n);
  if (drift) {
    for (let k = 0; k < n; k++) {
      const w = clamp(Math.round(k / FPS), 0, tg.periods.length - 1);
      tempoCurve[k] = (60 * FRAME_RATE) / tg.periods[w];
    }
  } else tempoCurve.fill(bpm);

  // ---- mood, loudness, waveform ----
  onProgress('mood', 0.94);
  const mood = audioMood({ n, loud, flux, centroid, bpm, key, chords, sections });
  const lufs = integratedLufs(input.channels.slice(0, 2), srIn);
  const peakBuckets = 2000;
  const peaks = new Float32Array(peakBuckets * 2);
  {
    const m = mono(input.channels.slice(0, 2));
    const per = m.length / peakBuckets;
    for (let bkt = 0; bkt < peakBuckets; bkt++) {
      let mn = 0, mx = 0;
      const a = Math.floor(bkt * per), e = Math.min(m.length, Math.floor((bkt + 1) * per) + 1);
      const step = Math.max(1, Math.floor((e - a) / 256));
      for (let i = a; i < e; i += step) { const v = m[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      peaks[bkt * 2] = mn; peaks[bkt * 2 + 1] = mx;
    }
  }
  onProgress('done', 1);
  void bf;
  return {
    version: ANALYSIS_VERSION, fps: FPS, n, duration,
    loud, rmsDb, centroid, flux, bands,
    onsets: on.times.filter((t) => t <= duration), onsetStrength: on.strength,
    bpm, bpmConfidence, beats, downbeats, meter,
    sections, drops, peaks, peakBuckets,
    harmonic, percussive, vocal, vocalOnsets: vOn, f0, f0Conf,
    key, keyChanges, chords, tempoCurve, repeats, mood, lufs, isSpeech,
  };
}

/** Transferable list for postMessage. */
export function analysisTransferables(a: Analysis): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const add = (x: Float32Array) => out.push(x.buffer as ArrayBuffer);
  [a.loud, a.rmsDb, a.centroid, a.flux, a.peaks, a.harmonic, a.percussive, a.vocal, a.f0, a.f0Conf, a.tempoCurve, a.mood.valence, a.mood.arousal].forEach(add);
  Object.values(a.bands).forEach(add);
  return out;
}

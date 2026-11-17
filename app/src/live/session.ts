// Live session (SPEC §14): a rolling Analysis the live-capable effects read exactly as they read an offline one.
// Its 60 fps arrays are preallocated for the session's capacity and filled as the online analyser reports; beats,
// downbeats, onsets and drops are appended as they are predicted/detected. Nothing here is deterministic.
import type { Analysis, Bands, Section } from '../types.ts';
import type { OnlineState } from './types.ts';
import { ANALYSIS_VERSION } from '../analysis/index.ts';

const FPS = 60;

/** New events since the last report (worker → main thread). */
export interface OnlineDelta { onsets: number[]; beats: number[]; downbeats: number[]; drops: number[] }

export class LiveAnalysis {
  readonly a: Analysis;
  private written = 0; // frames written so far
  private nBeats = 0; private nDown = 0; // confirmed counts; anything after them is the projected tail
  constructor(readonly capacitySec = 3 * 3600) {
    const n = Math.ceil(capacitySec * FPS);
    const f = () => new Float32Array(n);
    const bands: Bands = { sub: f(), bass: f(), lowMid: f(), mid: f(), highMid: f(), high: f(), air: f() };
    const section: Section = { start: 0, end: capacitySec, label: 'verse', energy: 0.6, cluster: 0 };
    this.a = {
      version: ANALYSIS_VERSION, fps: FPS, n, duration: capacitySec,
      loud: f(), rmsDb: f(), centroid: f(), flux: f(), bands,
      onsets: [], onsetStrength: [], bpm: 120, bpmConfidence: 0, beats: [], downbeats: [], meter: 4,
      sections: [section], drops: [], peaks: new Float32Array(0), peakBuckets: 0,
      harmonic: f(), percussive: f(), vocal: f(), vocalOnsets: [], f0: new Float32Array(n).fill(NaN), f0Conf: f(),
      key: { tonic: 9, mode: 'minor', confidence: 0 }, keyChanges: [], chords: [], tempoCurve: f(), repeats: [],
      mood: { valence: f(), arousal: f() }, lufs: -14, isSpeech: false,
    };
  }

  /** Write the analyser's latest state up to s.t and append new events. */
  ingest(s: OnlineState, d: OnlineDelta): void {
    const a = this.a;
    const upto = Math.min(a.n, Math.floor(s.t * FPS) + 1);
    const B = a.bands, keys: (keyof Bands)[] = ['sub', 'bass', 'lowMid', 'mid', 'highMid', 'high', 'air'];
    for (let i = this.written; i < upto; i++) {
      for (let b = 0; b < 7; b++) B[keys[b]][i] = s.bands[b] ?? 0;
      a.loud[i] = s.loudness; a.rmsDb[i] = -60 + 60 * s.loudness; a.centroid[i] = s.centroid; a.flux[i] = s.onset;
      a.vocal[i] = s.vocal; a.harmonic[i] = s.mid; a.percussive[i] = s.onset;
      a.tempoCurve[i] = s.bpm || a.bpm;
      a.mood.arousal[i] = s.loudness * 2 - 1; a.mood.valence[i] = 0;
    }
    this.written = Math.max(this.written, upto);
    if (s.bpm > 0) { a.bpm = s.bpm; a.bpmConfidence = s.tempoConfidence; }
    a.meter = s.meter === 3 ? 3 : 4;
    for (const t of d.onsets) { a.onsets.push(t); a.onsetStrength.push(1); }
    // confirmed events, then a projected tail of the next 8 beats from the PLL so effects can anticipate
    a.beats.length = this.nBeats; a.downbeats.length = this.nDown;
    for (const t of d.beats) a.beats.push(t);
    for (const t of d.downbeats) a.downbeats.push(t);
    this.nBeats = a.beats.length; this.nDown = a.downbeats.length;
    if (s.bpm > 0 && s.nextBeat > 0) {
      const P = 60 / s.bpm, last = a.beats[a.beats.length - 1] ?? -Infinity;
      for (let k = 0; k < 8; k++) {
        const t = s.nextBeat + k * P;
        if (t <= last + P * 0.5) continue;
        a.beats.push(t);
        if ((s.beatInBar + 1 + k) % s.meter === 0) a.downbeats.push(t);
      }
    }
    for (const t of d.drops) {
      a.drops.push(t);
      // a drop starts a new high-energy section (effects key their big moments off section labels and drops)
      const last = a.sections[a.sections.length - 1];
      last.end = t;
      a.sections.push({ start: t, end: this.capacitySec, label: 'drop', energy: 0.95, cluster: a.sections.length });
    }
    // keep event arrays bounded (effects only look near t)
    const trim = (arr: number[], keep = 4096) => { if (arr.length > keep * 1.25) arr.splice(0, arr.length - keep); };
    trim(a.onsets); trim(a.onsetStrength);
    const cut = (arr: number[], n: number) => { const k = n - 4096; if (k > 1024) { arr.splice(0, k); return k; } return 0; };
    this.nBeats -= cut(a.beats, this.nBeats); this.nDown -= cut(a.downbeats, this.nDown);
  }
}

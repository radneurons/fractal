// Shared data model for Lyric Engine.

export type Seconds = number;

export type SectionLabel = 'intro' | 'verse' | 'chorus' | 'bridge' | 'drop' | 'breakdown' | 'outro' | 'speech';

export interface Section {
  start: Seconds;
  end: Seconds;
  label: SectionLabel;
  energy: number;      // 0..1 mean loudness
  cluster: number;     // repeated material shares a cluster id
}

export interface Bands {
  sub: Float32Array; bass: Float32Array; lowMid: Float32Array; mid: Float32Array;
  highMid: Float32Array; high: Float32Array; air: Float32Array;
}

/** Every per-frame array is sampled at `fps` (60 Hz): index = round(t * fps). */
export interface Analysis {
  fps: number;
  n: number;
  duration: Seconds;
  loud: Float32Array;        // 0..1 percentile-normalised loudness (smoothed)
  rmsDb: Float32Array;
  bands: Bands;              // each 0..1, smoothed
  centroid: Float32Array;    // 0..1
  flux: Float32Array;        // 0..1 onset strength
  onsets: Seconds[];
  onsetStrength: number[];   // 0..1 per onset
  bpm: number;
  bpmConfidence: number;
  beats: Seconds[];
  downbeats: Seconds[];
  meter: number;
  sections: Section[];
  drops: Seconds[];
  peaks: Float32Array;       // waveform envelope, 2 values (min,max) per bucket
  peakBuckets: number;
}

export type Role = 'hero' | 'support' | 'connective';

export type ElementKind =
  | 'none' | 'light' | 'fire' | 'water' | 'shock' | 'wind' | 'vortex' | 'quake' | 'ice' | 'smoke';

export interface Word {
  id: number;
  text: string;          // normalised for matching
  display: string;       // as shown (with punctuation)
  line: number;
  start: Seconds;        // onset (lands fully readable here)
  end: Seconds;
  confidence: number;    // 0..1 timing confidence
  syllables: number;
  stress: number;        // 0..1
  role: Role;
  roleLocked?: boolean;  // user override
  concept?: string;
  element?: ElementKind;
  elementLocked?: boolean; // user override
}

export interface Line {
  idx: number;
  words: number[];       // word ids
  start: Seconds;
  end: Seconds;
  section: number;
  text: string;
  repeatOf?: number;     // earlier line with the same text (chorus repeats)
}

export interface Lyrics {
  words: Word[];
  lines: Line[];
  source: 'lrc' | 'enhanced-lrc' | 'srt' | 'vtt' | 'plain' | 'tap' | 'demo';
}

export interface Song {
  name: string;
  audio: AudioBuffer;
  analysis: Analysis;
  lyrics: Lyrics;
}

export type ParamType = 'range' | 'toggle' | 'select' | 'color' | 'text';

export interface ParamSpec {
  key: string;
  label: string;
  group: string;
  type: ParamType;
  min?: number; max?: number; step?: number;
  options?: string[];
  default: number | boolean | string;
  help: string;
  /** true: changes apply instantly; false: the effect re-prepares (debounced). */
  live: boolean;
}

export type Params = Record<string, number | boolean | string>;

export interface GlobalSettings {
  aspect: '16:9' | '9:16' | '1:1';
  syncOffsetMs: number;
  anticipationMs: number;
  minReadMs: number;
  intensity: number;     // master %, 100 = as designed
  cameraEnergy: number;  // master %
  reactivity: number;    // master %
  caseMode: 'as-is' | 'upper' | 'lower';
  seed: number;
  endCard: boolean;
  title: string;
  artist: string;
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  aspect: '16:9', syncOffsetMs: 0, anticipationMs: 90, minReadMs: 600,
  intensity: 100, cameraEnergy: 100, reactivity: 100, caseMode: 'upper', seed: 1776,
  endCard: true, title: '', artist: ''
};

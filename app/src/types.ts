// Lyric Engine Pro — shared data model (SPEC §3).

export type SectionLabel = 'intro' | 'verse' | 'chorus' | 'bridge' | 'drop' | 'breakdown' | 'outro' | 'speech';

export interface Section {
  start: number;
  end: number;
  label: SectionLabel;
  /** 0..1 */
  energy: number;
  /** repeated material shares an id */
  cluster: number;
}

export interface Chord {
  start: number;
  end: number;
  /** 0–11, C = 0 */
  root: number;
  quality: 'maj' | 'min' | 'dim' | 'aug' | 'sus' | 'N';
}

export interface Bands {
  sub: Float32Array;
  bass: Float32Array;
  lowMid: Float32Array;
  mid: Float32Array;
  highMid: Float32Array;
  high: Float32Array;
  air: Float32Array;
}

export interface Analysis {
  version: number;
  fps: number;
  n: number;
  duration: number;
  loud: Float32Array;
  rmsDb: Float32Array;
  centroid: Float32Array;
  flux: Float32Array;
  bands: Bands;
  onsets: number[];
  onsetStrength: number[];
  bpm: number;
  bpmConfidence: number;
  beats: number[];
  downbeats: number[];
  meter: 3 | 4 | 6;
  sections: Section[];
  drops: number[];
  peaks: Float32Array;
  peakBuckets: number;
  // ---- v3 ----
  harmonic: Float32Array;
  percussive: Float32Array;
  vocal: Float32Array;
  /** vocal-band onsets (seconds) used for syllable timing */
  vocalOnsets: number[];
  f0: Float32Array;
  f0Conf: Float32Array;
  key: { tonic: number; mode: 'major' | 'minor'; confidence: number };
  keyChanges: { t: number; tonic: number; mode: 'major' | 'minor' }[];
  chords: Chord[];
  tempoCurve: Float32Array;
  repeats: { a: number; b: number; len: number }[];
  mood: { valence: Float32Array; arousal: Float32Array };
  lufs: number;
  isSpeech: boolean;
}

export type Role = 'hero' | 'support' | 'connective';
export type ElementKind = 'none' | 'light' | 'fire' | 'water' | 'shock' | 'wind' | 'vortex' | 'quake' | 'ice' | 'smoke';

export interface Syllable {
  text: string;
  start: number;
  end: number;
  vowelStart?: number;
}

export interface Word {
  id: number;
  /** normalised */
  text: string;
  display: string;
  line: number;
  start: number;
  end: number;
  confidence: number;
  syllables: number;
  /** 0..1 */
  stress: number;
  role: Role;
  roleLocked?: boolean;
  concept?: string;
  element?: ElementKind;
  elementLocked?: boolean;
  syllableTimes?: Syllable[];
  /** true when the syllable times came from tags (exact) */
  syllablesLocked?: boolean;
  voice?: string;
  backing?: boolean;
  /** mean MIDI pitch */
  pitch?: number;
  melisma?: boolean;
  vibrato?: boolean;
}

export interface Line {
  idx: number;
  words: number[];
  start: number;
  end: number;
  /** index into analysis.sections */
  section: number;
  text: string;
  repeatOf?: number;
  translation?: string;
  voice?: string;
  mood?: { valence: number; arousal: number };
  dir?: 'ltr' | 'rtl';
  hook?: boolean;
  /** section hint parsed from "[Chorus]"-style headers in plain lyrics */
  hint?: SectionLabel;
  pitchRange?: [number, number];
}

export type LyricsSource = 'lrc' | 'enhanced-lrc' | 'srt' | 'vtt' | 'plain' | 'tap' | 'demo' | 'auto';

export interface Lyrics {
  words: Word[];
  lines: Line[];
  source: LyricsSource;
  meta?: { title?: string; artist?: string };
}

export interface Song {
  name: string;
  audio: AudioBuffer;
  analysis: Analysis;
  lyrics: Lyrics;
  /** changes whenever lyrics or analysis change (prepare key) */
  stamp: number;
  artwork?: ImageBitmap | HTMLImageElement | null;
}

export interface ParamSpec {
  key: string;
  label: string;
  group: string;
  type: 'range' | 'toggle' | 'select' | 'color' | 'text';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  default: number | boolean | string;
  help?: string;
  live: boolean;
}

export type ParamValue = number | boolean | string;
export type Params = Record<string, ParamValue>;

export type Aspect = '16:9' | '9:16' | '1:1' | '4:5' | '21:9';

export interface GlobalSettings {
  aspect: Aspect;
  syncOffsetMs: number;
  anticipationMs: number;
  minReadMs: number;
  /** master %, 100 = as designed */
  intensity: number;
  cameraEnergy: number;
  reactivity: number;
  caseMode: 'upper' | 'as-is' | 'lower';
  seed: number;
  /** Auto-Director: how many different effects a plan may use (2–16) */
  variety: number;
  endCard: boolean;
  title: string;
  artist: string;
  // v3
  reduceMotion: boolean;
  flashGuard: boolean;
  transparentBackground: boolean;
  voicePalette: boolean;
  showTranslation: 'off' | 'under' | 'alternate';
  paletteSource: 'effect' | 'key' | 'artwork';
  fontOverrides: Record<string, string>;
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  aspect: '16:9',
  syncOffsetMs: 0,
  anticipationMs: 90,
  minReadMs: 600,
  intensity: 100,
  cameraEnergy: 100,
  reactivity: 100,
  caseMode: 'upper',
  seed: 1776,
  variety: 5,
  endCard: false,
  title: '',
  artist: '',
  reduceMotion: false,
  flashGuard: true,
  transparentBackground: false,
  voicePalette: true,
  showTranslation: 'off',
  paletteSource: 'effect',
  fontOverrides: {},
};

// ---------- compositor / modulation / project (v3) ----------

export type BlendMode =
  | 'normal' | 'screen' | 'add' | 'multiply' | 'overlay' | 'soft-light' | 'difference' | 'color-dodge' | 'luminosity';
export const BLEND_MODES: BlendMode[] = ['normal', 'screen', 'add', 'multiply', 'overlay', 'soft-light', 'difference', 'color-dodge', 'luminosity'];

export type MaterialKind =
  | 'none' | 'chrome' | 'fire' | 'engraving' | 'neon' | 'halftone' | 'stardust'
  | 'glass' | 'goldleaf' | 'frost' | 'holo' | 'lava' | 'embroidery';
export const MATERIALS: MaterialKind[] = ['none', 'chrome', 'fire', 'engraving', 'neon', 'halftone', 'stardust', 'glass', 'goldleaf', 'frost', 'holo', 'lava', 'embroidery'];

export interface MaterialSettings {
  kind: MaterialKind;
  /** 0..1.5 (× master intensity) */
  strength: number;
  backdrop: 'layout' | 'material';
  tint: string;
}

export type LayerKind = 'plan' | 'effect' | 'media' | 'solid';
export type LayerMask = 'none' | 'inside-words' | 'outside-words' | 'luma' | 'inv-luma';

export interface Layer {
  id: string;
  kind: LayerKind;
  effect?: string;
  instanceId: string;
  enabled: boolean;
  blend: BlendMode;
  opacity: number;
  mask: LayerMask;
  material?: MaterialSettings;
  start?: number;
  end?: number;
  /** restrict to sections with this label */
  sectionOnly?: SectionLabel | '';
  solo?: boolean;
  locked?: boolean;
  /** solid layers */
  color?: string;
  color2?: string;
  /** media layers: key into project media */
  mediaId?: string;
  mediaFit?: 'cover' | 'contain';
  mediaMotion?: 'kenburns' | 'hold';
  mediaBlur?: number;
  mediaDim?: number;
}

export type ModSource =
  | 'loud' | 'sub' | 'bass' | 'lowMid' | 'mid' | 'highMid' | 'high' | 'air' | 'flux' | 'centroid' | 'harmonic' | 'percussive'
  | 'beatPulse' | 'downbeatPulse' | 'onsetPulse'
  | 'barPhase' | 'songProgress' | 'lineProgress' | 'wordProgress'
  | 'sectionEnergy' | 'vocal' | 'pitch' | 'pitchVelocity' | 'chordChange' | 'tension' | 'valence' | 'arousal'
  | 'lfo' | 'sampleHold' | 'constant';

export interface ModRoute {
  id: string;
  source: ModSource;
  target: { instanceId: string; key: string };
  /** -1..1 of the target's range */
  amount: number;
  curve: 'lin' | 'exp' | 'log' | 'step' | 'smooth';
  attackMs: number;
  releaseMs: number;
  lo: number;
  hi: number;
  invert: boolean;
  enabled: boolean;
  /** lfo */
  shape?: 'sine' | 'triangle' | 'saw' | 'square';
  /** lfo period in bars (0.25..8); sampleHold: 'beat' | 'bar' | 'onset' */
  bars?: number;
  hold?: 'beat' | 'bar' | 'onset';
  label?: string;
}

export interface AutoKey {
  t: number;
  v: number;
  ease: 'hold' | 'linear' | 'ease' | 'bezier';
  c1?: number;
  c2?: number;
}

export interface Lane {
  target: { instanceId: string; key: string };
  keys: AutoKey[];
  snap: 'none' | 'beat' | 'bar';
}

export interface Post {
  bloom: number;
  grain: number;
  chroma: number;
  vignette: number;
  distortion: number;
  halation: number;
  /** ratio or 0 */
  letterbox: number;
  lift: number;
  gamma: number;
  gain: number;
  saturation: number;
  temperature: number;
  tint: number;
  lut?: string;
  lutMix: number;
  /** shutter degrees; 0 = off */
  motionBlur: number;
  motionBlurSamples: number;
}

export const DEFAULT_POST: Post = {
  bloom: 0, grain: 0, chroma: 0, vignette: 0, distortion: 0, halation: 0, letterbox: 0,
  lift: 0, gamma: 1, gain: 1, saturation: 1, temperature: 0, tint: 0, lut: '', lutMix: 1,
  motionBlur: 0, motionBlurSamples: 8,
};

export type TransitionKind = 'cut' | 'flash' | 'wipe' | 'dissolve' | 'match' | 'mask' | 'zoom' | 'glitch' | 'auto';

export interface PlanSegment {
  start: number;
  end: number;
  effect: string;
  /** transition INTO this segment; undefined = plan default */
  transition?: TransitionKind;
}

export interface PlanState {
  mode: 'single' | 'director' | 'custom';
  effect: string;
  transition: TransitionKind;
  map: Record<SectionLabel, string>;
  segments: PlanSegment[];
}

export interface Instance { effect: string; params: Params }

export interface MediaItem { id: string; name: string; kind: 'image' | 'video'; hash: string; inPoint?: number }

export interface Project {
  id: string;
  name: string;
  created: number;
  modified: number;
  audio: Blob | null;
  audioName: string;
  stems?: Record<string, Blob>;
  lyricsText: string;
  translationText?: string;
  lyrics: Lyrics | null;
  layers: Layer[];
  instances: Record<string, Instance>;
  plan: PlanState;
  post: Post;
  routes: ModRoute[];
  lanes: Lane[];
  settings: GlobalSettings;
  media?: MediaItem[];
  midi?: Record<string, { instanceId: string; key: string }>;
  thumbnail?: Blob;
  version: 3;
}

export interface Affinity {
  energyHigh: number;
  energyLow: number;
  speech: number;
  denseLyrics: number;
  sparseLyrics: number;
  darkMood: number;
  brightMood: number;
  fastTempo: number;
}

export const NEUTRAL_AFFINITY: Affinity = {
  energyHigh: 0.5, energyLow: 0.5, speech: 0.5, denseLyrics: 0.5, sparseLyrics: 0.5, darkMood: 0.5, brightMood: 0.5, fastTempo: 0.5,
};

// Live mode shared types (SPEC §14). Live mode is explicitly non-deterministic: the clock is the audio input's.

/** What the online analyser knows right now (all times on the live audio clock, seconds). */
export interface OnlineState {
  t: number;
  /** current frame features, 0..1; `bands` = sub, bass, lowMid, mid, highMid, high, air (the offline bands) */
  bands: number[];
  low: number; mid: number; high: number;
  loudness: number; centroid: number;
  vocal: number;
  /** decaying 0..1 pulse at the latest detected onset */
  onset: number;
  bpm: number;
  tempoConfidence: number;
  /** the PLL's predicted next beat, and the one before it */
  nextBeat: number; lastBeat: number;
  /** 0..1 through the current beat */
  beatPhase: number;
  /** beat index within the bar (0 = downbeat), and beats per bar */
  beatInBar: number; meter: number;
  /** last detected drop (big energy rise after a quiet stretch); -Infinity when none */
  dropAt: number;
  /** 0..1 novelty over the last 16 bars */
  novelty: number;
  /** recent history at 60 fps, oldest first (length ≤ 4 s) */
  history: { low: Float32Array; mid: Float32Array; high: Float32Array; loudness: Float32Array };
}

/** One word as the follower reveals it. */
export interface LiveWord { id: number; text: string; line: number; shownAt: number; role: string }

export interface FollowState {
  mode: 'cue' | 'word' | 'auto';
  /** cued line index (−1 before the first cue) and the one-line look-ahead */
  line: number; next: number;
  /** words of the current line with reveal times (Infinity = not yet) */
  words: LiveWord[];
  /** auto-follow confidence 0..1 (cumulative match of the current line) */
  match: number;
}

/** Handed to an effect's renderLive. */
export interface LiveFeatures extends OnlineState {
  follow: FollowState;
  /** pulse at the predicted beats, closed form on the PLL grid */
  beatPulse(t: number, k?: number): number;
  /** reveal progress 0..1 of a word (by id) at time t */
  wordReveal(id: number, t: number, entrance?: number): number;
}

// Audio mood curves (SPEC §4A.7). Lyric mood is combined in director/moodlex.ts.
import type { Chord, Section } from '../types.ts';
import { FPS, clamp } from './dsp.ts';

export function audioMood(a: {
  n: number; loud: Float32Array; flux: Float32Array; centroid: Float32Array; bpm: number;
  key: { mode: 'major' | 'minor' }; chords: Chord[]; sections: Section[];
}): { valence: Float32Array; arousal: Float32Array } {
  const n = a.n;
  const valence = new Float32Array(n), arousal = new Float32Array(n);
  // chord-quality share (major − minor) per section
  const share = a.sections.map((s) => {
    let maj = 0, min = 0;
    for (const c of a.chords) {
      const o = Math.min(c.end, s.end) - Math.max(c.start, s.start);
      if (o <= 0) continue;
      if (c.quality === 'maj' || c.quality === 'aug' || c.quality === 'sus') maj += o;
      else if (c.quality === 'min' || c.quality === 'dim') min += o;
    }
    return maj + min > 0 ? (maj - min) / (maj + min) : 0;
  });
  const tempo = clamp(a.bpm / 180, 0, 1);
  let si = 0;
  for (let i = 0; i < n; i++) {
    const t = i / FPS;
    while (si + 1 < a.sections.length && t >= a.sections[si].end) si++;
    const bright = a.centroid[i];
    arousal[i] = clamp(0.45 * a.loud[i] + 0.25 * a.flux[i] + 0.15 * tempo + 0.15 * bright, 0, 1);
    valence[i] = clamp((a.key.mode === 'major' ? 0.3 : -0.3) + 0.2 * (bright - 0.5) + 0.25 * (share[si] ?? 0), -1, 1);
  }
  return { valence: smooth2s(valence), arousal: smooth2s(arousal) };
}

/** symmetric 2 s smoothing (forward + backward one-pole → zero phase) */
export function smooth2s(x: Float32Array): Float32Array {
  const k = Math.exp(-1 / (1.0 * FPS));
  const y = new Float32Array(x.length);
  let s = x[0] ?? 0;
  for (let i = 0; i < x.length; i++) { s = x[i] + (s - x[i]) * k; y[i] = s; }
  s = y[y.length - 1] ?? 0;
  for (let i = x.length - 1; i >= 0; i--) { s = y[i] + (s - y[i]) * k; y[i] = s; }
  return y;
}

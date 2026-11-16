/** Audio analysis for the timeline: waveform peaks and onset/beat detection (spectral-flux style, on energy in short frames). */
export function peaks(samples: Float32Array, buckets: number): number[] {
  const out: number[] = [], step = Math.max(1, Math.floor(samples.length / buckets));
  for (let b = 0; b < buckets; b++) { let m = 0; for (let i = b * step, e = Math.min(samples.length, i + step); i < e; i++) m = Math.max(m, Math.abs(samples[i])); out.push(Math.round(m * 1000) / 1000); }
  return out;
}
export interface BeatResult { onsets: number[]; bpm: number | null; beats: number[] }
/** Onsets = peaks of positive energy flux over an adaptive threshold; BPM from the autocorrelation of the onset envelope;
 *  beats = a grid at that tempo phase-aligned to the strongest onsets. */
export function detectBeats(samples: Float32Array, sampleRate: number, o: { minBpm?: number; maxBpm?: number } = {}): BeatResult {
  const hop = Math.round(sampleRate / 100), n = Math.floor(samples.length / hop); if (n < 8) return { onsets: [], bpm: null, beats: [] };
  const env = new Float32Array(n); for (let f = 0; f < n; f++) { let e = 0; for (let i = f * hop; i < (f + 1) * hop; i++) e += samples[i] * samples[i]; env[f] = Math.log1p(1000 * e / hop); }
  const flux = new Float32Array(n); for (let f = 1; f < n; f++) flux[f] = Math.max(0, env[f] - env[f - 1]);
  const onsets: number[] = [], W = 10;
  for (let f = 1; f < n - 1; f++) { let mean = 0, c = 0; for (let k = Math.max(0, f - W); k <= Math.min(n - 1, f + W); k++) { mean += flux[k]; c++; } mean /= c; if (flux[f] > mean * 1.6 + 0.05 && flux[f] >= flux[f - 1] && flux[f] > flux[f + 1] && (!onsets.length || f / 100 - onsets[onsets.length - 1] > 0.1)) onsets.push(Math.round(f) / 100); }
  const minLag = Math.round(6000 / (o.maxBpm ?? 180)), maxLag = Math.round(6000 / (o.minBpm ?? 60)); let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= Math.min(maxLag, n - 1); lag++) { let s = 0; for (let f = lag; f < n; f++) s += flux[f] * flux[f - lag]; s /= n - lag; if (s > best) { best = s; bestLag = lag; } }
  if (!bestLag || onsets.length < 3) return { onsets, bpm: null, beats: onsets };
  // refine: parabolic interpolation around the best lag
  const ac = (lag: number) => { let s = 0; for (let f = lag; f < n; f++) s += flux[f] * flux[f - lag]; return s / (n - lag); }, a = ac(bestLag - 1), b = ac(bestLag), c = ac(bestLag + 1), shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  const period = (bestLag + Math.max(-0.5, Math.min(0.5, shift))) / 100, bpm = Math.round((60 / period) * 10) / 10;
  let bestPhase = 0, bestScore = -1; for (let ph = 0; ph < period; ph += 0.01) { let s = 0; for (const t of onsets) { const d = Math.abs(((t - ph) / period) - Math.round((t - ph) / period)) * period; s += Math.max(0, 0.05 - d); } if (s > bestScore) { bestScore = s; bestPhase = ph; } }
  const beats: number[] = []; for (let t = bestPhase; t < n / 100; t += period) beats.push(Math.round(t * 1000) / 1000);
  return { onsets, bpm, beats };
}

// Modulation matrix (SPEC §9.4): any audio/song feature → any live range parameter.
// Determinism: smoothed sources are precomputed into 60 fps arrays; render time only samples them.
import type { Analysis, Lane, Lyrics, ModRoute, ModSource, ParamSpec, Params } from '../types.ts';
import { FPS, sample, pulse, lowerBound, hash01, clamp } from '../analysis/dsp.ts';
import { tensionOf } from '../analysis/harmony.ts';
import { laneValue } from './automation.ts';

export const MOD_SOURCES: { id: ModSource; group: string; label: string }[] = [
  ...(['loud', 'sub', 'bass', 'lowMid', 'mid', 'highMid', 'high', 'air', 'flux', 'centroid', 'harmonic', 'percussive'] as ModSource[]).map((id) => ({ id, group: 'Levels', label: id })),
  { id: 'beatPulse', group: 'Pulses', label: 'beat pulse' }, { id: 'downbeatPulse', group: 'Pulses', label: 'downbeat pulse' }, { id: 'onsetPulse', group: 'Pulses', label: 'onset pulse' },
  { id: 'barPhase', group: 'Phases', label: 'bar phase' }, { id: 'songProgress', group: 'Phases', label: 'song progress' }, { id: 'lineProgress', group: 'Phases', label: 'line progress' }, { id: 'wordProgress', group: 'Phases', label: 'word progress' },
  { id: 'sectionEnergy', group: 'Song', label: 'section energy' }, { id: 'vocal', group: 'Song', label: 'vocal activity' }, { id: 'pitch', group: 'Song', label: 'vocal pitch' }, { id: 'pitchVelocity', group: 'Song', label: 'pitch velocity' },
  { id: 'chordChange', group: 'Song', label: 'chord change' }, { id: 'tension', group: 'Song', label: 'harmonic tension' }, { id: 'valence', group: 'Song', label: 'valence' }, { id: 'arousal', group: 'Song', label: 'arousal' },
  { id: 'lfo', group: 'Generators', label: 'LFO' }, { id: 'sampleHold', group: 'Generators', label: 'sample & hold' }, { id: 'constant', group: 'Generators', label: 'constant' },
];

const CLOSED_FORM = new Set<ModSource>(['beatPulse', 'downbeatPulse', 'onsetPulse', 'barPhase', 'songProgress', 'lineProgress', 'wordProgress', 'lfo', 'sampleHold', 'constant']);

/** Asymmetric one-pole run once over the whole array (the reference the tests compare against). */
export function onePole(x: ArrayLike<number>, attackMs: number, releaseMs: number, fps = FPS): Float32Array {
  const out = new Float32Array(x.length);
  const ka = attackMs <= 0 ? 0 : Math.exp(-1000 / (attackMs * fps));
  const kr = releaseMs <= 0 ? 0 : Math.exp(-1000 / (releaseMs * fps));
  let y = x.length ? x[0] : 0;
  for (let i = 0; i < x.length; i++) { const v = x[i]; y = v + (y - v) * (v > y ? ka : kr); out[i] = y; }
  return out;
}

export function shapeCurve(x: number, curve: ModRoute['curve']): number {
  x = clamp(x, 0, 1);
  switch (curve) {
    case 'exp': return x * x;
    case 'log': return Math.sqrt(x);
    case 'step': return Math.min(3, Math.floor(x * 4)) / 3;
    case 'smooth': return x * x * (3 - 2 * x);
    default: return x;
  }
}

export class Modulation {
  private raw = new Map<ModSource, Float32Array>();
  private smoothed = new Map<string, Float32Array>();
  private barStarts: number[] = [];
  constructor(private a: Analysis | null, private ly: Lyrics | null, private seed = 1) {
    this.barStarts = a ? a.downbeats : [];
  }

  /** raw 60 fps array of an array-type source (0..1) */
  private rawOf(src: ModSource): Float32Array | null {
    const a = this.a;
    if (!a) return null;
    const hit = this.raw.get(src);
    if (hit) return hit;
    let arr: Float32Array | null = null;
    const n = a.n;
    switch (src) {
      case 'loud': arr = a.loud; break;
      case 'flux': arr = a.flux; break;
      case 'centroid': arr = a.centroid; break;
      case 'harmonic': arr = a.harmonic; break;
      case 'percussive': arr = a.percussive; break;
      case 'vocal': arr = a.vocal; break;
      case 'sub': case 'bass': case 'lowMid': case 'mid': case 'highMid': case 'high': case 'air': arr = a.bands[src]; break;
      case 'arousal': arr = a.mood.arousal; break;
      case 'valence': arr = Float32Array.from(a.mood.valence, (v) => 0.5 + 0.5 * v); break;
      case 'sectionEnergy': {
        arr = new Float32Array(n);
        let si = 0;
        for (let i = 0; i < n; i++) { const t = i / FPS; while (si + 1 < a.sections.length && t >= a.sections[si].end) si++; arr[i] = a.sections[si]?.energy ?? 0; }
        break;
      }
      case 'pitch': case 'pitchVelocity': {
        // normalised over the song's vocal range; unvoiced frames hold the last value
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < n; i++) { const v = a.f0[i]; if (!Number.isNaN(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
        const p = new Float32Array(n);
        let last = 0.5;
        for (let i = 0; i < n; i++) { const v = a.f0[i]; if (!Number.isNaN(v) && hi > lo) last = (v - lo) / (hi - lo); p[i] = last; }
        if (src === 'pitch') arr = p;
        else { arr = new Float32Array(n); for (let i = 1; i < n; i++) arr[i] = clamp(Math.abs(p[i] - p[i - 1]) * 12, 0, 1); }
        break;
      }
      case 'chordChange': {
        arr = new Float32Array(n);
        const times = a.chords.map((c) => c.start);
        for (let i = 0; i < n; i++) arr[i] = pulse(times, i / FPS, 6);
        break;
      }
      case 'tension': {
        arr = new Float32Array(n);
        let ci = 0;
        for (let i = 0; i < n; i++) {
          const t = i / FPS;
          while (ci + 1 < a.chords.length && t >= a.chords[ci].end) ci++;
          const c = a.chords[ci];
          arr[i] = c && c.quality !== 'N' ? tensionOf(c.root, a.key.tonic) : 0;
        }
        break;
      }
      default: arr = null;
    }
    if (arr) this.raw.set(src, arr);
    return arr;
  }

  /** Source value at t (0..1) with the route's smoothing. Order-independent: arrays are precomputed. */
  source(r: Pick<ModRoute, 'source' | 'attackMs' | 'releaseMs' | 'shape' | 'bars' | 'hold'>, t: number): number {
    const a = this.a;
    const src = r.source;
    if (CLOSED_FORM.has(src)) {
      if (!a && src !== 'lfo' && src !== 'constant') return 0;
      switch (src) {
        case 'beatPulse': return pulse(a!.beats, t, 7);
        case 'downbeatPulse': return pulse(a!.downbeats, t, 5);
        case 'onsetPulse': return pulse(a!.onsets, t, 12);
        case 'songProgress': return clamp(t / (a!.duration || 1), 0, 1);
        case 'barPhase': return this.barPhase(t);
        case 'lineProgress': {
          const ly = this.ly; if (!ly) return 0;
          for (const l of ly.lines) if (t >= l.start && t < l.end) return (t - l.start) / Math.max(0.05, l.end - l.start);
          return 0;
        }
        case 'wordProgress': {
          const ly = this.ly; if (!ly) return 0;
          for (const w of ly.words) if (t >= w.start && t < w.end) return (t - w.start) / Math.max(0.05, w.end - w.start);
          return 0;
        }
        case 'lfo': {
          const bars = r.bars ?? 1;
          const ph = (((this.barCount(t) / bars) % 1) + 1) % 1;
          switch (r.shape ?? 'sine') {
            case 'triangle': return ph < 0.5 ? ph * 2 : 2 - ph * 2;
            case 'saw': return ph;
            case 'square': return ph < 0.5 ? 1 : 0;
            default: return 0.5 - 0.5 * Math.cos(2 * Math.PI * ph);
          }
        }
        case 'sampleHold': {
          const grid = r.hold === 'bar' ? a!.downbeats : r.hold === 'onset' ? a!.onsets : a!.beats;
          const i = lowerBound(grid, t + 1e-9) - 1;
          return hash01(i + 7, this.seed, grid.length);
        }
        default: return 1; // constant
      }
    }
    const raw = this.rawOf(src);
    if (!raw) return 0;
    if (r.attackMs <= 0 && r.releaseMs <= 0) return sample(raw, t);
    const key = `${src}|${r.attackMs}|${r.releaseMs}`;
    let sm = this.smoothed.get(key);
    if (!sm) { sm = onePole(raw, r.attackMs, r.releaseMs); this.smoothed.set(key, sm); }
    return sample(sm, t);
  }

  /** continuous bar count at t (fractional) */
  barCount(t: number): number {
    const d = this.barStarts;
    if (d.length < 2) return t / 2;
    const i = clamp(lowerBound(d, t + 1e-9) - 1, 0, d.length - 2);
    return i + (t - d[i]) / (d[i + 1] - d[i]);
  }
  barPhase(t: number): number { const b = this.barCount(t); return ((b % 1) + 1) % 1; }

  /** Contribution of one route in units of the target's range (−1..1). */
  routeValue(r: ModRoute, t: number): number {
    if (!r.enabled) return 0;
    let x = this.source(r, t);
    const lo = r.lo ?? 0, hi = r.hi ?? 1;
    x = hi > lo ? clamp((x - lo) / (hi - lo), 0, 1) : x >= hi ? 1 : 0;
    x = shapeCurve(x, r.curve);
    if (r.invert) x = 1 - x;
    return x * r.amount;
  }

  /**
   * final = clamp(base + Σ routes, min, max); an automation lane REPLACES base when it exists.
   * Returns only the keys that changed.
   */
  apply(instanceId: string, base: Params, specs: ParamSpec[], routes: ModRoute[], lanes: Lane[], t: number): Params | null {
    let out: Params | null = null;
    for (const spec of specs) {
      if (spec.type !== 'range') continue;
      let v: number | null = null;
      for (const lane of lanes) if (lane.target.instanceId === instanceId && lane.target.key === spec.key) { const lv = laneValue(lane, t); if (lv !== null) v = lv; }
      let touched = v !== null;
      let val = v ?? Number(base[spec.key] ?? spec.default);
      const span = (spec.max ?? 1) - (spec.min ?? 0);
      for (const r of routes) {
        if (r.target.instanceId !== instanceId || r.target.key !== spec.key || !r.enabled) continue;
        val += this.routeValue(r, t) * span;
        touched = true;
      }
      if (touched) { (out ??= {})[spec.key] = clamp(val, spec.min ?? 0, spec.max ?? 1); }
    }
    return out;
  }
}

/** Pre-wired (disabled) suggestions. */
export function defaultRoutes(): ModRoute[] {
  const mk = (label: string, source: ModSource, instanceId: string, key: string, amount: number, x: Partial<ModRoute> = {}): ModRoute => ({
    id: `sug_${label.replace(/\W+/g, '_')}`, label, source, target: { instanceId, key }, amount, curve: 'lin', attackMs: 20, releaseMs: 160, lo: 0, hi: 1, invert: false, enabled: false, ...x,
  });
  return [
    mk('Bass → Swarm breath', 'bass', 'plan:swarm', 'breath', 0.5),
    mk('Vocal → Press weight', 'vocal', 'plan:press', 'wMax', 0.4, { releaseMs: 300 }),
    mk('Tension → Mandala hue', 'tension', 'plan:mandala', 'hueShift', 0.5, { releaseMs: 600 }),
    mk('Beat → Bloom', 'beatPulse', 'post', 'bloom', 0.25),
    mk('Percussive → Chrome spikes', 'percussive', 'plan:chrome', 'spike', 0.5),
    mk('Arousal → Camera energy', 'arousal', 'global', 'cameraEnergy', 0.3, { releaseMs: 800 }),
    mk('Pitch → Neon glow', 'pitch', 'plan:neon', 'glow', 0.35, { releaseMs: 200 }),
    mk('Air → Film grain', 'air', 'post', 'grain', 0.3),
    mk('Downbeat → Vignette', 'downbeatPulse', 'post', 'vignette', 0.2),
    mk('LFO (4 bars) → Chromatic aberration', 'lfo', 'post', 'chroma', 0.25, { bars: 4, shape: 'sine' }),
  ];
}

import type { GlobalSettings, ParamSpec, Params, Song } from '../types';

export interface EffectContext {
  song: Song;
  settings: GlobalSettings;
  params: Params;
  width: number;
  height: number;
}

/** Every effect renders a full frame for time t; render() must be a pure function of t. */
export interface Effect {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly params: ParamSpec[];
  /** true if the effect draws its own title card (the stage then skips its generic one) */
  readonly ownsTitle?: boolean;
  prepare(ctx: EffectContext): Promise<void>;
  /** live parameter updates (no re-prepare) */
  setParams(p: Params): void;
  render(t: number, out: CanvasRenderingContext2D): void;
  dispose(): void;
}

export interface EffectFactory {
  id: string;
  name: string;
  description: string;
  params: ParamSpec[];
  create(): Effect;
}

export function defaults(specs: ParamSpec[]): Params {
  const p: Params = {}; for (const s of specs) p[s.key] = s.default; return p;
}

// ── shared helpers ──
export const clamp = (x: number, a = 0, b = 1) => x < a ? a : x > b ? b : x;
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
export const prog = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const eIO = (p: number) => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
export const eOut = (p: number) => 1 - Math.pow(1 - p, 3);
export const eOut5 = (p: number) => 1 - Math.pow(1 - p, 5);
export const eIn = (p: number) => p * p * p;
export const eBack = (p: number, s = 1.7) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2);
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface CamKey { t: number; cx: number; cy: number; z: number; r: number }
export function camAt(keys: CamKey[], t: number): CamKey {
  if (!keys.length) return { t, cx: 0, cy: 0, z: 1, r: 0 };
  if (t <= keys[0].t) return keys[0];
  // binary search
  let lo = 0, hi = keys.length - 1;
  if (t >= keys[hi].t) return keys[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (keys[m].t <= t) lo = m; else hi = m; }
  const a = keys[lo], b = keys[hi], q = eIO((t - a.t) / Math.max(1e-6, b.t - a.t));
  return { t, cx: lerp(a.cx, b.cx, q), cy: lerp(a.cy, b.cy, q), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), q)), r: lerp(a.r, b.r, q) };
}

/** Find the last index with value ≤ t in a sorted array (or -1). */
export function lastIndexLE(arr: number[], t: number): number {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

/** Apply global sync offset/case to a song's words (returns a shallow-cloned word timing view). */
export function displayText(s: string, mode: GlobalSettings['caseMode']) { return mode === 'upper' ? s.toUpperCase() : mode === 'lower' ? s.toLowerCase() : s; }

// 2D camera key system (SPEC §7.4), generalised from BROADSIDE.
import { easeInOutQuad, easeOutCubic, easeInCubic, smooth, clamp01 } from './textkit.ts';

export interface CamKey { t: number; x: number; y: number; zoom: number; roll: number; level?: number; ease?: 'linear' | 'inout' | 'out' | 'in' | 'smooth' | 'hold' }
export interface CamState { x: number; y: number; zoom: number; roll: number; level: number; u: number; a: CamKey; b: CamKey }

const EASE = { linear: (t: number) => t, inout: easeInOutQuad, out: easeOutCubic, in: easeInCubic, smooth, hold: () => 0 };

/** Sort and collapse keys closer than 0.18 s (the later key wins). */
export function buildKeys(keys: CamKey[], minGap = 0.18): CamKey[] {
  const s = keys.slice().sort((a, b) => a.t - b.t);
  const out: CamKey[] = [];
  for (const k of s) {
    const last = out[out.length - 1];
    if (last && k.t - last.t < minGap) out[out.length - 1] = { ...k, t: last.t };
    else out.push(k);
  }
  return out;
}

export function sampleCamera(keys: CamKey[], t: number): CamState {
  if (!keys.length) return { x: 0, y: 0, zoom: 1, roll: 0, level: 0, u: 0, a: { t: 0, x: 0, y: 0, zoom: 1, roll: 0 }, b: { t: 0, x: 0, y: 0, zoom: 1, roll: 0 } };
  let lo = 0, hi = keys.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (keys[m].t <= t) lo = m; else hi = m - 1; }
  const a = keys[lo], b = keys[Math.min(keys.length - 1, lo + 1)];
  if (a === b || t <= a.t) return { x: a.x, y: a.y, zoom: a.zoom, roll: a.roll, level: a.level ?? 0, u: 0, a, b: a };
  const u = EASE[b.ease ?? 'inout'](clamp01((t - a.t) / (b.t - a.t)));
  // zoom interpolates geometrically
  const zoom = a.zoom * (b.zoom / a.zoom) ** u;
  let dr = b.roll - a.roll;
  while (dr > Math.PI) dr -= 2 * Math.PI;
  while (dr < -Math.PI) dr += 2 * Math.PI;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, zoom, roll: a.roll + dr * u, level: a.level ?? 0, u, a, b };
}

export interface CamExtras { breathing?: number; shake?: number; shakeT?: number; pulse?: number; reduceMotion?: boolean; seed?: number }

/** Additive layers: breathing (±0.6° roll, ±1.5 % zoom), impact shake and a beat zoom pulse. */
export function withExtras(c: CamState, t: number, e: CamExtras): CamState {
  const rm = !!e.reduceMotion;
  let { x, y, zoom, roll } = c;
  const br = rm ? 0 : e.breathing ?? 0;
  if (br) {
    roll += br * (0.6 * Math.PI / 180) * Math.sin(t * 0.61 + 1.3);
    zoom *= 1 + br * 0.015 * Math.sin(t * 0.43);
  }
  const sh = rm ? 0 : e.shake ?? 0;
  if (sh > 0 && e.shakeT !== undefined) {
    const k = Math.floor(e.shakeT * 60), s = (e.seed ?? 1) * 0.7;
    x += (sh * Math.sin(k * 12.9898 + s) * 43758.5453 % 1) / zoom;
    y += (sh * Math.sin(k * 78.233 + s) * 12543.123 % 1) / zoom;
  }
  if (e.pulse) zoom *= 1 + Math.min(rm ? 0.02 : 1, e.pulse);
  if (rm) roll = Math.max(-3 * Math.PI / 180, Math.min(3 * Math.PI / 180, roll));
  return { ...c, x, y, zoom, roll };
}

/** Apply a camera to a 2D context: world point (cam.x, cam.y) lands at the screen centre. */
export function applyCamera(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, c: { x: number; y: number; zoom: number; roll: number }, W: number, H: number): void {
  g.translate(W / 2, H / 2);
  g.rotate(-c.roll);
  g.scale(c.zoom, c.zoom);
  g.translate(-c.x, -c.y);
}

/** Zoom that fits a world rectangle into the frame with a margin. */
export function fitZoom(w: number, h: number, W: number, H: number, margin = 0.86): number {
  return Math.min((W * margin) / Math.max(1, w), (H * margin) / Math.max(1, h));
}

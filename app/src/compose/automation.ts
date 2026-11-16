// Automation lanes (SPEC §9.4, §11.2): keyed curves per parameter.
import type { AutoKey, Lane } from '../types.ts';

function bez(t: number, c1: number, c2: number): number {
  // cubic-bezier(c1, 0, c2, 1) timing: solve x(s) = t by bisection, return y(s)
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const s = (lo + hi) / 2;
    const x = 3 * (1 - s) * (1 - s) * s * c1 + 3 * (1 - s) * s * s * c2 + s * s * s;
    if (x < t) lo = s; else hi = s;
  }
  const s = (lo + hi) / 2;
  return 3 * (1 - s) * s * s + s * s * s;
}

/** Value of a lane at time t (null when the lane has no keys). The key's `ease` shapes the segment that ENDS at it. */
export function laneValue(lane: Lane, t: number): number | null {
  const k = lane.keys;
  if (!k.length) return null;
  if (t <= k[0].t) return k[0].v;
  if (t >= k[k.length - 1].t) return k[k.length - 1].v;
  let lo = 0, hi = k.length - 1;
  while (lo < hi - 1) { const m = (lo + hi) >> 1; if (k[m].t <= t) lo = m; else hi = m; }
  const a = k[lo], b = k[hi];
  let u = (t - a.t) / Math.max(1e-9, b.t - a.t);
  switch (b.ease) {
    case 'hold': return a.v;
    case 'ease': u = u * u * (3 - 2 * u); break;
    case 'bezier': u = bez(u, b.c1 ?? 0.42, b.c2 ?? 0.58); break;
    default: break;
  }
  return a.v + (b.v - a.v) * u;
}

export function sortKeys(keys: AutoKey[]): AutoKey[] { return keys.slice().sort((a, b) => a.t - b.t); }

/** Snap a time to the beat or bar grid. */
export function snapTime(t: number, snap: Lane['snap'], beats: number[], downbeats: number[]): number {
  const grid = snap === 'beat' ? beats : snap === 'bar' ? downbeats : null;
  if (!grid || !grid.length) return t;
  let best = grid[0];
  for (const g of grid) if (Math.abs(g - t) < Math.abs(best - t)) best = g;
  return best;
}

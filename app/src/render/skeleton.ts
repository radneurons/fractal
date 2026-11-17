// Glyph centrelines (SPEC §7.2), used by NEON, SUMI and the "trace" entrance.
// Rasterise at cap 160 → distance field → Zhang–Suen thinning → trace 8-connected chains (split at
// junctions) → drop spurs < 0.25 cap → Ramer–Douglas–Peucker (ε 1.2 px) → 2 Chaikin passes.
// Each point keeps its local half-width; strokes are ordered letter by letter, then top-to-bottom,
// left-to-right, and run from their upper or left end.
import { makeCanvas, font, sizeForCap, insideDistance } from './sdf.ts';
import { graphemes } from './textkit.ts';

export const SKEL_CAP = 160;
export interface Stroke { pts: Float32Array; cum: Float32Array; len: number; letter: number }
export interface Skeleton { strokes: Stroke[]; width: number; cap: number; total: number }

const mem = new Map<string, Skeleton>();

function thin(img: Uint8Array, w: number, h: number): void {
  const del: number[] = [];
  let changed = true;
  const P = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]);
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        if (!img[y * w + x]) continue;
        const p2 = P(x, y - 1), p3 = P(x + 1, y - 1), p4 = P(x + 1, y), p5 = P(x + 1, y + 1), p6 = P(x, y + 1), p7 = P(x - 1, y + 1), p8 = P(x - 1, y), p9 = P(x - 1, y - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0;
        for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) A++;
        if (A !== 1) continue;
        if (step === 0 ? p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0 : p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0) del.push(y * w + x);
      }
      if (del.length) { changed = true; for (const i of del) img[i] = 0; }
    }
  }
}

function rdp(pts: number[][], eps: number): number[][] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
  let best = -1, bd = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > bd) { bd = d; best = i; } }
  if (bd <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, best + 1), eps).slice(0, -1), ...rdp(pts.slice(best), eps)];
}
function chaikin(pts: number[][], closed: boolean): number[][] {
  if (pts.length < 3) return pts;
  const out: number[][] = closed ? [] : [pts[0]];
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    out.push(a.map((v, k) => 0.75 * v + 0.25 * b[k]), a.map((v, k) => 0.25 * v + 0.75 * b[k]));
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

export function skeletonize(text: string, fontKey: string): Skeleton {
  const key = `${fontKey}|${text}|${SKEL_CAP}`;
  const hit = mem.get(key);
  if (hit) return hit;
  const cap = SKEL_CAP, pad = 24;
  const px = sizeForCap(fontKey, cap);
  const c0 = makeCanvas(8, 8).getContext('2d') as CanvasRenderingContext2D;
  c0.font = font(fontKey, px);
  const m = c0.measureText(text);
  const left = Math.ceil(m.actualBoundingBoxLeft || 0), right = Math.ceil(m.actualBoundingBoxRight || m.width);
  const asc = Math.ceil(m.actualBoundingBoxAscent || cap), desc = Math.ceil(m.actualBoundingBoxDescent || 0);
  const w = left + right + pad * 2, h = asc + desc + pad * 2;
  const ox = left + pad, oy = asc + pad;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  g.font = font(fontKey, px); g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
  g.fillText(text, ox, oy);
  const data = g.getImageData(0, 0, w, h).data;
  const dist = insideDistance(data, w, h);
  const img = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) img[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  thin(img, w, h);
  // letter boundaries (x, in canvas px)
  const gs = graphemes(text);
  const bounds: number[] = [];
  let acc = '';
  for (const ch of gs) { acc += ch; bounds.push(ox + c0.measureText(acc).width); }
  const letterOf = (x: number) => { for (let i = 0; i < bounds.length; i++) if (x < bounds[i]) return i; return bounds.length - 1; };
  // ---- trace chains ----
  const N8 = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  // crossing number (0→1 transitions around the pixel): 1 = end, 2 = path, ≥ 3 = junction.
  // Unlike a neighbour count it treats diagonal staircases as plain path pixels.
  const deg = new Uint8Array(w * h);
  const RING = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (!img[y * w + x]) continue;
    let cn = 0, any = 0;
    for (let k = 0; k < 8; k++) {
      const a0 = img[(y + RING[k][1]) * w + x + RING[k][0]], a1 = img[(y + RING[(k + 1) % 8][1]) * w + x + RING[(k + 1) % 8][0]];
      if (!a0 && a1) cn++;
      any += a0;
    }
    deg[y * w + x] = any ? Math.max(1, cn) : 0;
  }
  const visited = new Uint8Array(w * h);
  const paths: { p: number[]; ends: [boolean, boolean] }[] = [];
  const isNode = (i: number) => img[i] === 1 && deg[i] !== 2;
  const nbrs = (i: number) => { const x = i % w, y = (i / w) | 0; const out: number[] = []; for (const [dx, dy] of N8) { const j = (y + dy) * w + x + dx; if (img[j]) out.push(j); } return out; };
  const walk = (start: number, first: number) => {
    const p = [start, first];
    visited[first] = 1;
    let prev = start, cur = first;
    for (let guard = 0; guard < 100000; guard++) {
      if (isNode(cur)) break;
      const nx = nbrs(cur).filter((j) => j !== prev && !p.includes(j) && (isNode(j) || !visited[j]));
      if (!nx.length) break;
      // prefer the 4-neighbour (so staircase pixels are visited, not skipped), then a node
      const four = (j: number) => Math.abs(j - cur) === 1 || Math.abs(j - cur) === w;
      const nn = nx.find((j) => four(j) && !isNode(j)) ?? nx.find((j) => isNode(j) && j !== start) ?? nx[0];
      if (!isNode(nn)) visited[nn] = 1;
      p.push(nn); prev = cur; cur = nn;
      if (nn === start) break;
    }
    return p;
  };
  for (let i = 0; i < w * h; i++) {
    if (!isNode(i)) continue;
    if (deg[i] === 0) continue;
    for (const j of nbrs(i)) {
      if (isNode(j) || visited[j]) continue;
      const p = walk(i, j);
      paths.push({ p, ends: [deg[p[0]] === 1, deg[p[p.length - 1]] === 1] });
    }
  }
  // staircase pixels skipped by a walk are covered by it: mark them so they do not start new strokes
  for (let i = 0; i < w * h; i++) {
    if (!img[i] || isNode(i) || visited[i]) continue;
    const nb = nbrs(i);
    if (nb.filter((j) => visited[j] || isNode(j)).length >= 2) visited[i] = 1;
  }
  for (let i = 0; i < w * h; i++) { // loops (O, 0, …)
    if (!img[i] || isNode(i) || visited[i]) continue;
    visited[i] = 1;
    const nb = nbrs(i);
    if (!nb.length) continue;
    const p = walk(i, nb[0]);
    paths.push({ p, ends: [false, false] });
  }
  // ---- spurs, simplification, smoothing ----
  const strokes: Stroke[] = [];
  for (const { p, ends } of paths) {
    const len = p.length;
    // a spur: one free end, the other on a junction, shorter than 0.18 cap (counted in 8-connected steps)
    if (ends[0] !== ends[1] && len < 0.18 * cap && paths.length > 1) continue;
    if (len < Math.max(3, 0.05 * cap) && paths.length > 2) continue;
    if (len < 3) continue;
    let pts = p.map((i) => [i % w, (i / w) | 0, Math.max(1, dist[i])]);
    const closed = p[0] === p[p.length - 1];
    pts = rdp(pts, 1.2);
    pts = chaikin(chaikin(pts, false), false);
    // a stroke runs from its upper or left end
    const a = pts[0], b = pts[pts.length - 1];
    if (!closed && (b[1] < a[1] - 3 || (Math.abs(b[1] - a[1]) <= 3 && b[0] < a[0]))) pts.reverse();
    const arr = new Float32Array(pts.length * 3);
    const cum = new Float32Array(pts.length);
    pts.forEach((q, k) => { arr[k * 3] = q[0] - ox; arr[k * 3 + 1] = q[1] - oy; arr[k * 3 + 2] = q[2]; if (k) cum[k] = cum[k - 1] + Math.hypot(q[0] - pts[k - 1][0], q[1] - pts[k - 1][1]); });
    strokes.push({ pts: arr, cum, len: cum[cum.length - 1], letter: letterOf(pts[0][0]) });
  }
  strokes.sort((s1, s2) => s1.letter - s2.letter || Math.round(s1.pts[1] / 24) - Math.round(s2.pts[1] / 24) || s1.pts[0] - s2.pts[0]);
  const sk: Skeleton = { strokes, width: m.width, cap, total: strokes.reduce((s, x) => s + x.len, 0) };
  mem.set(key, sk);
  return sk;
}

/** Point at arc length s along a stroke: [x, y, halfWidth, tangentX, tangentY]. */
export function strokeAt(st: Stroke, s: number): [number, number, number, number, number] {
  const { pts, cum } = st;
  const n = cum.length;
  if (s <= 0) return [pts[0], pts[1], pts[2], pts[3] - pts[0], pts[4] - pts[1]];
  let lo = 0, hi = n - 1;
  while (lo < hi - 1) { const m2 = (lo + hi) >> 1; if (cum[m2] <= s) lo = m2; else hi = m2; }
  const u = cum[hi] > cum[lo] ? Math.min(1, (s - cum[lo]) / (cum[hi] - cum[lo])) : 0;
  const a = lo * 3, b = hi * 3;
  return [pts[a] + (pts[b] - pts[a]) * u, pts[a + 1] + (pts[b + 1] - pts[a + 1]) * u, pts[a + 2] + (pts[b + 2] - pts[a + 2]) * u, pts[b] - pts[a], pts[b + 1] - pts[a + 1]];
}

/** Trace a stroke path into the current 2D path, up to arc length `upTo`, at scale k. */
export function strokePath(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, st: Stroke, k: number, upTo = Infinity): void {
  const { pts, cum } = st;
  g.moveTo(pts[0] * k, pts[1] * k);
  for (let i = 1; i < cum.length; i++) {
    if (cum[i] > upTo) { const [x, y] = strokeAt(st, upTo); g.lineTo(x * k, y * k); return; }
    g.lineTo(pts[i * 3] * k, pts[i * 3 + 1] * k);
  }
}

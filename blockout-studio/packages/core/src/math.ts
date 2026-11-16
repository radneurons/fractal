/** Minimal deterministic math: vectors, quaternions, matrices, splines, easing, seeded noise. No DOM, no three. */
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x y z w
export type Mat4 = number[]; // column-major, length 16

export const DEG = Math.PI / 180;
export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3) => len(sub(a, b));
export const norm = (a: Vec3): Vec3 => { const l = len(a); return l < 1e-9 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const round = (x: number, d = 3) => { const p = 10 ** d; return Math.round(x * p) / p; };
export const wrapAngle = (a: number) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
export const lerpAngle = (a: number, b: number, t: number) => a + wrapAngle(b - a) * t;

// ---------- quaternions ----------
export const qIdent = (): Quat => [0, 0, 0, 1];
export function qFromEuler(x: number, y: number, z: number): Quat { // XYZ intrinsic order (three.js default)
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
export function qFromAxisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2), a = norm(axis);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}
export function qMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
export function qRotate(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]], s = q[3];
  return add(add(scale(u, 2 * dot(u, v)), scale(v, s * s - dot(u, u))), scale(cross(u, v), 2 * s));
}
export function qSlerp(a: Quat, b: Quat, t: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) { const r: Quat = [lerp(a[0], bb[0], t), lerp(a[1], bb[1], t), lerp(a[2], bb[2], t), lerp(a[3], bb[3], t)]; const l = Math.hypot(...r); return [r[0] / l, r[1] / l, r[2] / l, r[3] / l]; }
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
}
/** Shortest rotation taking unit vector a to unit vector b. */
export function qBetween(a: Vec3, b: Vec3): Quat {
  const d = dot(a, b);
  if (d > 0.999999) return qIdent();
  if (d < -0.999999) { let ax = cross([1, 0, 0], a); if (len(ax) < 1e-6) ax = cross([0, 1, 0], a); return qFromAxisAngle(ax, Math.PI); }
  const c = cross(a, b); const q: Quat = [c[0], c[1], c[2], 1 + d]; const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
/** Camera-style orientation: -Z looks along dir, +Y up, then roll about the view axis. */
export function qLookAt(eye: Vec3, target: Vec3, roll = 0): Quat {
  let f = norm(sub(target, eye)); if (len(f) < 1e-9) f = [0, 0, -1];
  let r = cross(f, [0, 1, 0]); if (len(r) < 1e-6) r = [1, 0, 0]; r = norm(r);
  const u = cross(r, f);
  const q = qFromBasis(r, u, scale(f, -1));
  return roll ? qMul(q, qFromAxisAngle([0, 0, 1], roll)) : q;
}
export function qFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]; }
  if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11); return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

// ---------- matrices ----------
export function mCompose(p: Vec3, q: Quat, s: Vec3 = [1, 1, 1]): Mat4 {
  const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, p[0], p[1], p[2], 1];
}
export function mMul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
export const mPoint = (m: Mat4, v: Vec3): Vec3 => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
export const mDir = (m: Mat4, v: Vec3): Vec3 => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
export const mPos = (m: Mat4): Vec3 => [m[12], m[13], m[14]];
/** Inverse of a rigid (rotation+translation, unit scale) transform. */
export function mInvRigid(m: Mat4): Mat4 {
  const t: Vec3 = [m[12], m[13], m[14]];
  const o = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  o[12] = -(o[0] * t[0] + o[4] * t[1] + o[8] * t[2]); o[13] = -(o[1] * t[0] + o[5] * t[1] + o[9] * t[2]); o[14] = -(o[2] * t[0] + o[6] * t[1] + o[10] * t[2]);
  return o;
}
export function mPerspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}

// ---------- easing ----------
export const EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'] as const;
export type Easing = (typeof EASINGS)[number];
export function ease(e: Easing, t: number): number {
  t = clamp(t);
  switch (e) {
    case 'easeIn': return t * t * t;
    case 'easeOut': return 1 - (1 - t) ** 3;
    case 'easeInOut': return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    case 'hold': return t >= 1 ? 1 : 0;
    default: return t;
  }
}

// ---------- splines ----------
/** Catmull-Rom through points (Hermite form); u in [0, n-1]. Tangents are zeroed at keys adjacent to a
 *  hold (repeated point) so stationary segments stay perfectly still and never overshoot. */
export function catmullRom(pts: Vec3[], u: number): Vec3 {
  const n = pts.length; if (n === 0) return [0, 0, 0]; if (n === 1) return [...pts[0]] as Vec3;
  u = clamp(u, 0, n - 1); const i = Math.min(Math.floor(u), n - 2), t = u - i, p1 = pts[i], p2 = pts[i + 1];
  const same = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-9;
  const tan = (k: number, c: number): number => {
    const prev = pts[k - 1], next = pts[k + 1];
    if ((prev && same(prev, pts[k])) || (next && same(next, pts[k]))) return 0;
    return ((next ?? pts[k])[c] - (prev ?? pts[k])[c]) / (prev && next ? 2 : 1) * (prev && next ? 1 : 0.5);
  };
  const t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2, o: Vec3 = [0, 0, 0];
  for (let c = 0; c < 3; c++) o[c] = h00 * p1[c] + h10 * tan(i, c) + h01 * p2[c] + h11 * tan(i + 1, c);
  return o;
}
export function bezier(p0: Vec3, c0: Vec3, c1: Vec3, p1: Vec3, t: number): Vec3 {
  const m = 1 - t, a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
  return [a * p0[0] + b * c0[0] + c * c1[0] + d * p1[0], a * p0[1] + b * c0[1] + c * c1[1] + d * p1[1], a * p0[2] + b * c0[2] + c * c1[2] + d * p1[2]];
}
/** Arc-length table for a parametric curve so it can be sampled at constant speed. */
export class ArcTable {
  readonly lengths: number[] = [0]; readonly total: number;
  constructor(readonly fn: (u: number) => Vec3, readonly u0: number, readonly u1: number, readonly steps = 64) {
    let prev = fn(u0), acc = 0;
    for (let i = 1; i <= steps; i++) { const p = fn(lerp(u0, u1, i / steps)); acc += dist(prev, p); this.lengths.push(acc); prev = p; }
    this.total = acc;
  }
  /** Map distance s in [0,total] to parameter u. */
  uAt(s: number): number {
    const L = this.lengths; s = clamp(s, 0, this.total);
    let lo = 0, hi = L.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (L[mid] <= s) lo = mid; else hi = mid; }
    const seg = L[hi] - L[lo], f = seg < 1e-12 ? 0 : (s - L[lo]) / seg;
    return lerp(this.u0, this.u1, (lo + f) / this.steps);
  }
  at(s: number): Vec3 { return this.fn(this.uAt(s)); }
}

// ---------- deterministic randomness ----------
export function hash32(str: string): number { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const h1 = (i: number, seed: number) => { let x = Math.imul(i ^ seed, 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x ^= x >>> 16; return ((x >>> 0) / 4294967296) * 2 - 1; };
/** Smooth 1D value noise in [-1,1], seeded. */
export function noise1(x: number, seed = 1): number { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(h1(i, seed), h1(i + 1, seed), u); }
export function fbm1(x: number, seed = 1, oct = 3): number { let a = 0, amp = 0.5, fr = 1; for (let o = 0; o < oct; o++) { a += amp * noise1(x * fr, seed + o * 101); amp *= 0.5; fr *= 2; } return a; }
/** Stable stringify (sorted keys) + FNV hash -> short hex id; used for fact hashes and determinism checks. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}
export const hashOf = (v: unknown) => hash32(stableStringify(v)).toString(16).padStart(8, '0');
export function hexToRgb(hex: string): Vec3 { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export const rgbToHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('');

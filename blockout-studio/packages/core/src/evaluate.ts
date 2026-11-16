/** Time evaluation of characters, cameras, lighting and terrain. Pure functions of (project, t). */
import type { Camera, Character, Facing, Lighting, PathKey, Project, Terrain } from './schema';
import { ASPECTS } from './schema';
import { ArcTable, type Quat, type Vec3, DEG, add, sub, scale, norm, len, cross, catmullRom, bezier, clamp, ease, lerp, lerp3, lerpAngle, fbm1, qLookAt, qRotate } from './math';
import { CLIP_DEFS, blendPose, sampleCustomClip, solveSkeleton, type Pose, type Skeleton } from './rig';

// ---------- terrain ----------
export function terrainHeight(t: Terrain, x: number, z: number): number {
  const n = t.res; if (t.heights.length !== n * n) return 0;
  const fx = clamp((x / t.size + 0.5) * (n - 1), 0, n - 1), fz = clamp((z / t.size + 0.5) * (n - 1), 0, n - 1);
  const i = Math.min(Math.floor(fx), n - 2), j = Math.min(Math.floor(fz), n - 2), u = fx - i, v = fz - j, H = t.heights;
  return lerp(lerp(H[j * n + i], H[j * n + i + 1], u), lerp(H[(j + 1) * n + i], H[(j + 1) * n + i + 1], u), v);
}

// ---------- character paths ----------
interface PathCache { tables: ArcTable[]; cum: number[] }
const pathCache = new WeakMap<PathKey[], Map<string, PathCache>>();
function pathTables(c: Character): PathCache {
  let m = pathCache.get(c.keys); if (!m) { m = new Map(); pathCache.set(c.keys, m); }
  let pc = m.get(c.interp); if (pc) return pc;
  const pts = c.keys.map((k) => k.pos as Vec3), tables: ArcTable[] = [], cum = [0];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    let fn: (u: number) => Vec3;
    if (c.interp === 'linear') fn = (u) => lerp3(a, b, u);
    else if (c.interp === 'bezier') {
      const tan = (k: number): Vec3 => scale(sub(pts[Math.min(k + 1, pts.length - 1)], pts[Math.max(k - 1, 0)]), 1 / 6);
      const c0 = add(a, (c.keys[i].hOut as Vec3 | undefined) ?? tan(i)), c1 = add(b, (c.keys[i + 1].hIn as Vec3 | undefined) ?? scale(tan(i + 1), -1));
      fn = (u) => bezier(a, c0, c1, b, u);
    } else fn = (u) => catmullRom(pts, i + u);
    const tb = new ArcTable(fn, 0, 1, 48); tables.push(tb); cum.push(cum[i] + tb.total);
  }
  pc = { tables, cum }; m.set(c.interp, pc); return pc;
}
export function pathLength(c: Character): number { return c.keys.length < 2 ? 0 : pathTables(c).cum[c.keys.length - 1]; }
/** Polyline of the whole path (for overlays / ghosts). */
export function samplePath(c: Character, perSeg = 16): Vec3[] {
  if (c.keys.length < 2) return c.keys.map((k) => k.pos as Vec3);
  const { tables } = pathTables(c), out: Vec3[] = [];
  tables.forEach((tb, i) => { for (let s = i === 0 ? 0 : 1; s <= perSeg; s++) out.push(tb.at((s / perSeg) * tb.total)); });
  return out;
}
function segIndex(keys: { t: number }[], t: number): number { let i = 0; while (i < keys.length - 1 && keys[i + 1].t <= t) i++; return i; }
interface PathSample { pos: Vec3; dist: number; i: number; tangent: Vec3 }
function pathAt(c: Character, t: number): PathSample {
  const ks = c.keys;
  if (!ks.length) return { pos: [0, 0, 0], dist: 0, i: -1, tangent: [0, 0, 1] };
  if (ks.length === 1 || t <= ks[0].t) return { pos: ks[0].pos as Vec3, dist: 0, i: 0, tangent: ks.length > 1 ? tangentAt(c, 0, 0) : [0, 0, 1] };
  const { tables, cum } = pathTables(c), last = ks.length - 1;
  if (t >= ks[last].t) return { pos: ks[last].pos as Vec3, dist: cum[last], i: last, tangent: tangentAt(c, last - 1, 1) };
  const i = segIndex(ks, t), span = ks[i + 1].t - ks[i].t, f = span > 1e-9 ? ease(ks[i].ease, (t - ks[i].t) / span) : 1, tb = tables[i];
  return { pos: tb.at(f * tb.total), dist: cum[i] + f * tb.total, i, tangent: tangentAt(c, i, f) };
}
function tangentAt(c: Character, seg: number, f: number): Vec3 {
  const { tables } = pathTables(c);
  for (let s = seg; s >= 0; s--) { // walk back to the last segment that actually moves
    const tb = tables[s]; if (!tb || tb.total < 1e-4) continue;
    const ff = s === seg ? f : 1, a = tb.at(clamp(ff - 0.02) * tb.total), b = tb.at(clamp(ff + 0.02) * tb.total), d = sub(b, a);
    if (len(d) > 1e-6) return norm(d);
  }
  for (let s = seg + 1; s < tables.length; s++) { const tb = tables[s]; if (tb.total > 1e-4) return norm(sub(tb.at(0.02 * tb.total), tb.at(0))); }
  return [0, 0, 1];
}
export function characterPosition(p: Project, c: Character, t: number): Vec3 {
  const s = pathAt(c, t).pos; return [s[0], s[1] + terrainHeight(p.terrain, s[0], s[2]), s[2]];
}

export interface CharState { pos: Vec3; yaw: number; speed: number; dist: number; clip: string; pose: Pose; keyIndex: number }
const BLEND = 0.22;
function yawFor(p: Project, c: Character, facing: Facing, ps: PathSample, t: number): number {
  if (facing.mode === 'fixed') return facing.yaw;
  if (facing.mode === 'target') {
    const o = p.characters[facing.targetId]; if (o && o !== c) { const tp = pathAt(o, t).pos, d = sub(tp, ps.pos); if (Math.hypot(d[0], d[2]) > 1e-4) return Math.atan2(d[0], d[2]); }
  }
  return Math.atan2(ps.tangent[0], ps.tangent[2]);
}
function clipPose(p: Project, c: Character, key: PathKey, t: number, dist: number, speed: number): Pose {
  const def = CLIP_DEFS[key.clip], custom = p.clips[key.clip];
  const tau = Math.max(0, t - key.t) * key.speed;
  if (custom) return sampleCustomClip(custom, tau);
  if (!def) return CLIP_DEFS.idle.fn(0);
  if (def.stride) { // locomotion: phase from distance so feet match ground speed
    const h = c.height / 1.75, pose = def.fn((dist / (def.stride * h)) % 1);
    const w = clamp(speed / 0.35); return w >= 1 ? pose : blendPose(CLIP_DEFS.idle.fn(((t / CLIP_DEFS.idle.dur) % 1 + 1) % 1), pose, w);
  }
  return def.fn(def.loop ? (tau / def.dur) % 1 : clamp(tau / def.dur));
}
export function evalCharacter(p: Project, c: Character, t: number): CharState {
  const ps = pathAt(c, t), ks = c.keys;
  const pos: Vec3 = [ps.pos[0], ps.pos[1] + terrainHeight(p.terrain, ps.pos[0], ps.pos[2]), ps.pos[2]];
  if (!ks.length) return { pos, yaw: 0, speed: 0, dist: 0, clip: 'idle', pose: CLIP_DEFS.idle.fn((t / 3.2) % 1), keyIndex: -1 };
  const dt = 1 / 120, speed = len(sub(pathAt(c, t + dt).pos, pathAt(c, Math.max(0, t - dt)).pos)) / (t < dt ? dt : 2 * dt);
  const i = t < ks[0].t ? 0 : segIndex(ks, t), key = ks[i];
  let yaw = yawFor(p, c, key.facing, ps, t), pose = clipPose(p, c, key, t, ps.dist, speed);
  if (i > 0 && t - key.t < BLEND) { // crossfade from the previous key's clip / facing
    const w = (t - key.t) / BLEND, sw = w * w * (3 - 2 * w), prev = ks[i - 1];
    pose = blendPose(clipPose(p, c, prev, t, ps.dist, speed), pose, sw);
    yaw = lerpAngle(yawFor(p, c, prev.facing, ps, t), yaw, sw);
  }
  // additive pose layers
  if (c.poseKeys.length) {
    const r = { ...pose.r };
    const byJoint = new Map<string, typeof c.poseKeys>();
    for (const k of c.poseKeys) { let a = byJoint.get(k.joint); if (!a) byJoint.set(k.joint, (a = [])); a.push(k); }
    for (const [joint, keys] of byJoint) {
      let add3: Vec3;
      if (t <= keys[0].t) add3 = keys[0].rot as Vec3; else if (t >= keys[keys.length - 1].t) add3 = keys[keys.length - 1].rot as Vec3;
      else { const j = segIndex(keys, t), a = keys[j], b = keys[j + 1]; add3 = lerp3(a.rot as Vec3, b.rot as Vec3, ease(a.ease, (t - a.t) / (b.t - a.t))); }
      const base = r[joint as keyof typeof r] ?? [0, 0, 0]; r[joint as keyof typeof r] = add(base, add3);
    }
    pose = { r, root: pose.root };
  }
  return { pos, yaw, speed, dist: ps.dist, clip: key.clip, pose, keyIndex: i };
}
export function characterSkeleton(p: Project, c: Character, t: number, state = evalCharacter(p, c, t)): Skeleton {
  const flat = p.terrain.heights.length === 0;
  return solveSkeleton(state.pose, state.pos, state.yaw, c.height, c.build, flat ? (() => state.pos[1]) : (x, z) => terrainHeight(p.terrain, x, z));
}

// ---------- cameras ----------
export interface CamState { pos: Vec3; target: Vec3; quat: Quat; focal: number; focus: number; fstop: number; roll: number; fovY: number; aspect: number; near: number; far: number }
const SHAKE = { none: [0, 0, 0], handheld: [0.012, 0.35, 1.1], runAndGun: [0.05, 1.4, 2.8], earthquake: [0.11, 2.8, 8] } as const; // [metres, degrees, Hz]
export function fovYFor(focal: number, sensorWidth: number, aspect: number): number {
  const sensorH = aspect >= 1 ? sensorWidth / aspect : sensorWidth; return 2 * Math.atan(sensorH / 2 / focal);
}
export function evalCamera(p: Project, cam: Camera, t: number): CamState {
  const ks = cam.keys, aspect = ASPECTS[p.aspect];
  let pos: Vec3, target: Vec3, focal: number, focus: number, fstop: number, roll: number;
  if (ks.length === 1 || t <= ks[0].t) { const k = ks[0]; pos = k.pos as Vec3; target = k.target as Vec3; ({ focal, focus, fstop, roll } = k); }
  else if (t >= ks[ks.length - 1].t) { const k = ks[ks.length - 1]; pos = k.pos as Vec3; target = k.target as Vec3; ({ focal, focus, fstop, roll } = k); }
  else {
    const i = segIndex(ks, t), a = ks[i], b = ks[i + 1], f = ease(a.ease, (t - a.t) / (b.t - a.t));
    pos = catmullRom(ks.map((k) => k.pos as Vec3), i + f); target = catmullRom(ks.map((k) => k.target as Vec3), i + f);
    focal = Math.exp(lerp(Math.log(a.focal), Math.log(b.focal), f)); focus = lerp(a.focus, b.focus, f); fstop = lerp(a.fstop, b.fstop, f); roll = lerp(a.roll, b.roll, f);
  }
  const att = cam.attach && p.characters[cam.attach.characterId];
  if (att) pos = add(characterPosition(p, att, Math.max(0, t - cam.attach!.lag)), pos);
  const look = cam.lookAt && p.characters[cam.lookAt.characterId];
  if (look) { const o = cam.lookAt!.offset as Vec3, h = look.height / 1.75; target = add(characterPosition(p, look, t), [o[0] * h, o[1] * h, o[2] * h]); focus = len(sub(target, pos)); }
  else if (att) target = add(characterPosition(p, att, Math.max(0, t - cam.attach!.lag)), target);
  const [amp, deg, hz] = SHAKE[cam.shake.profile];
  if (amp) {
    const a = cam.shake.amount, s = cam.shake.seed * 7919, x = t * hz, d = Math.max(0.5, len(sub(target, pos)));
    const fwd = norm(sub(target, pos)); let right = cross(fwd, [0, 1, 0]); right = len(right) < 1e-5 ? [1, 0, 0] : norm(right); const up = cross(right, fwd);
    pos = add(pos, [fbm1(x, s + 1) * amp * a, fbm1(x, s + 2) * amp * a, fbm1(x, s + 3) * amp * a]);
    target = add(target, add(scale(right, fbm1(x * 1.3, s + 4) * deg * DEG * a * d), scale(up, fbm1(x * 1.3, s + 5) * deg * DEG * a * d)));
    roll += fbm1(x * 0.9, s + 6) * deg * 0.5 * DEG * a;
  }
  return { pos, target, quat: qLookAt(pos, target, roll), focal, focus, fstop, roll, fovY: fovYFor(focal, cam.sensorWidth, aspect), aspect, near: 0.1, far: 1000 };
}
/** Project a world point to normalized screen coords: x,y in [0,1] (y down), z = view depth (m, >0 in front). */
export function projectPoint(cs: CamState, w: Vec3): Vec3 {
  const d = sub(w, cs.pos), inv: Quat = [-cs.quat[0], -cs.quat[1], -cs.quat[2], cs.quat[3]], v = qRotate(inv, d), z = -v[2];
  const f = 1 / Math.tan(cs.fovY / 2), zz = Math.abs(z) < 1e-6 ? 1e-6 : z;
  return [0.5 + (v[0] * f) / cs.aspect / zz / 2, 0.5 - (v[1] * f) / zz / 2, z];
}

// ---------- lighting ----------
export interface SunState { dir: Vec3; elevation: number; azimuth: number; color: Vec3; intensity: number; ambient: number }
/** Solar position from time of day / latitude / day of year. World: +X east, -Z north (rotated by lighting.north). `dir` points from the scene toward the sun. */
export function sunState(l: Lighting): SunState {
  const phi = l.latitude * DEG, decl = 23.44 * DEG * Math.sin((2 * Math.PI * (284 + l.dayOfYear)) / 365), H = 15 * DEG * (l.timeOfDay - 12);
  const el = Math.asin(clamp(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H), -1, 1));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + l.north * DEG; // from south, west positive
  const dir: Vec3 = [-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const warm = clamp(1 - el / (35 * DEG)); // 1 near the horizon
  const day = clamp(el / (6 * DEG) + 0.5);
  return { dir: el > 0.02 ? dir : norm([dir[0], 0.05, dir[2]]), elevation: el / DEG, azimuth: az / DEG, color: [1, lerp(0.97, 0.72, warm), lerp(0.92, 0.42, warm)], intensity: l.sunIntensity * lerp(0.15, 1, day), ambient: lerp(0.12, 0.38, day) };
}
export const lightDir = (azimuth: number, elevation: number): Vec3 => [Math.sin(azimuth * DEG) * Math.cos(elevation * DEG), Math.sin(elevation * DEG), Math.cos(azimuth * DEG) * Math.cos(elevation * DEG)];

export const frameTime = (p: Project, frame: number) => frame / p.fps;
export const shotFrames = (p: Project, shot: { start: number; end: number }) => Math.max(1, Math.round((shot.end - shot.start) * p.fps));

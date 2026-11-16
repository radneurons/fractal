/** Scene compiler: (project, t) -> flat list of primitive drawables. Both render backends (WebGL and the
 *  pure-TS software rasterizer) and the editor viewport consume this one list, so they can never disagree. */
import type { Character, Fx, Project, Prop, Scatter, Terrain } from './schema';
import { type Mat4, type Quat, type Vec3, add, sub, scale, len, lerp3, mCompose, mMul, mDir, mPos, mulberry32, qFromEuler, qFromBasis, norm, cross, hash32 } from './math';
import { characterPosition, characterSkeleton, evalCharacter, terrainHeight, type CharState } from './evaluate';
import { segmentQuat, type Skeleton } from './rig';
import type { Joint } from './schema';

export type MeshKind = 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane';
export type Layer = 'entity' | 'set' | 'fx';
export interface Drawable { key: string; entityId: string; kind: MeshKind; matrix: Mat4; idColor: string; layer: Layer }
export interface InstanceSet { key: string; entityId: string; kind: MeshKind; idColor: string; matrices: Mat4[] }
export interface FrameScene { t: number; drawables: Drawable[]; instances: InstanceSet[]; terrain: Terrain; skeletons: Record<string, Skeleton>; states: Record<string, CharState> }

export const GROUND_ID = '#1b1b1b';
export const SCATTER_ID: Record<Scatter['kind'], string> = { grass: '#3b5d2a', rock: '#6b6b6b', tree: '#1f4d3a' };
const Y: Vec3 = [0, 1, 0];

const LIMBS: [Joint, Joint, number][] = [
  ['upperArmL', 'foreArmL', 0.048], ['foreArmL', 'handL', 0.04], ['upperArmR', 'foreArmR', 0.048], ['foreArmR', 'handR', 0.04],
  ['upLegL', 'legL', 0.075], ['legL', 'footL', 0.055], ['upLegR', 'legR', 0.075], ['legR', 'footR', 0.055], ['neck', 'head', 0.045],
];
function rot(m: Mat4): Quat { return qFromBasis(norm([m[0], m[1], m[2]]), norm([m[4], m[5], m[6]]), norm([m[8], m[9], m[10]])); }

export function characterDrawables(c: Character, sk: Skeleton, out: Drawable[] = []): Drawable[] {
  const h = sk.scale, b = c.build, P = sk.pos, M = sk.mat;
  const push = (part: string, kind: MeshKind, matrix: Mat4) => out.push({ key: `${c.id}:${part}`, entityId: c.id, kind, matrix, idColor: c.idColor, layer: 'entity' });
  push('pelvis', 'box', mMul(M.hips, mCompose([0, 0.02 * h, 0], [0, 0, 0, 1], [0.3 * h * b, 0.2 * h, 0.19 * h * b])));
  const torsoMid = lerp3(P.spine, P.neck, 0.5), tl = len(sub(P.neck, P.spine));
  push('torso', 'box', mCompose(torsoMid, segmentQuat(P.spine, P.neck, mDir(M.chest, [0, 0, 1])), [0.36 * h * b, tl + 0.06 * h, 0.21 * h * b]));
  push('head', 'sphere', mMul(M.head, mCompose([0, 0.115 * h, 0.01 * h], [0, 0, 0, 1], [0.2 * h, 0.245 * h, 0.22 * h])));
  push('nose', 'box', mMul(M.head, mCompose([0, 0.1 * h, 0.115 * h], [0, 0, 0, 1], [0.03 * h, 0.05 * h, 0.04 * h])));
  for (const [a, bb, r] of LIMBS) {
    const A = P[a], B = P[bb], l = len(sub(B, A)); if (l < 1e-5) continue;
    const thick = r * 2 * h * (a === 'neck' ? 1 : b);
    push(a, 'cylinder', mCompose(lerp3(A, B, 0.5), segmentQuat(A, B, sk.forward), [thick, l + thick * 0.35, thick]));
  }
  for (const s of ['L', 'R'] as const) {
    push(`hand${s}`, 'sphere', mMul(M[`hand${s}`], mCompose([0, -0.04 * h, 0], [0, 0, 0, 1], [0.085 * h, 0.11 * h, 0.06 * h])));
    push(`foot${s}`, 'box', mMul(M[`foot${s}`], mCompose([0, -0.02 * h, 0.07 * h], [0, 0, 0, 1], [0.095 * h * b, 0.07 * h, 0.25 * h])));
  }
  if (c.held.kind !== 'none') {
    const hm = M[`hand${c.held.hand}`];
    // grip frame: prop extends along the forearm's "forward" (hand local +Z tilted up)
    const grip = mMul(hm, mCompose([0, -0.06 * h, 0], qFromEuler(-0.25, 0, 0)));
    const part = (name: string, kind: MeshKind, p: Vec3, s: Vec3, q: Quat = [0, 0, 0, 1]) => push(`held:${name}`, kind, mMul(grip, mCompose(scale(p, h), q, scale(s, h))));
    switch (c.held.kind) {
      case 'sword': part('blade', 'box', [0, 0, 0.5], [0.012, 0.045, 0.85]); part('guard', 'box', [0, 0, 0.07], [0.03, 0.12, 0.02]); part('hilt', 'cylinder', [0, 0, -0.05], [0.03, 0.22, 0.03], qFromEuler(Math.PI / 2, 0, 0)); break;
      case 'staff': part('staff', 'cylinder', [0, 0, 0.25], [0.035, 1.8, 0.035], qFromEuler(Math.PI / 2, 0, 0)); break;
      case 'pistol': part('barrel', 'box', [0, 0.03, 0.1], [0.03, 0.04, 0.2]); part('grip', 'box', [0, -0.03, 0.01], [0.03, 0.1, 0.04]); break;
      case 'rifle': part('body', 'box', [0, 0.02, 0.3], [0.04, 0.07, 0.9]); part('stock', 'box', [0, -0.03, -0.2], [0.04, 0.12, 0.25]); break;
      case 'shield': part('shield', 'cylinder', [0.06, 0, 0.05], [0.6, 0.04, 0.6], qFromEuler(0, 0, Math.PI / 2)); break;
      case 'lantern': part('lantern', 'box', [0, -0.25, 0.02], [0.12, 0.2, 0.12]); part('handle', 'box', [0, -0.08, 0.02], [0.01, 0.16, 0.01]); break;
    }
  }
  return out;
}

export function propDrawables(p: Prop, ground: number, out: Drawable[] = []): Drawable[] {
  const base = mCompose([p.pos[0], p.pos[1] + ground, p.pos[2]], qFromEuler(p.rot[0], p.rot[1], p.rot[2]), p.scale as Vec3);
  const push = (part: string, kind: MeshKind, local: Mat4) => out.push({ key: `${p.id}:${part}`, entityId: p.id, kind, matrix: mMul(base, local), idColor: p.idColor, layer: 'set' });
  const T = (pos: Vec3, s: Vec3, q: Quat = [0, 0, 0, 1]) => mCompose(pos, q, s);
  switch (p.kind) {
    case 'box': case 'glb': push('m', 'box', T([0, 0.5, 0], [1, 1, 1])); break;
    case 'sphere': push('m', 'sphere', T([0, 0.5, 0], [1, 1, 1])); break;
    case 'cylinder': push('m', 'cylinder', T([0, 0.5, 0], [1, 1, 1])); break;
    case 'cone': push('m', 'cone', T([0, 0.5, 0], [1, 1, 1])); break;
    case 'plane': push('m', 'plane', T([0, 0.01, 0], [1, 1, 1])); break;
    case 'rock': push('m', 'sphere', T([0, 0.3, 0], [1, 0.7, 0.85])); break;
    case 'tree': push('trunk', 'cylinder', T([0, 1, 0], [0.3, 2, 0.3])); push('crown', 'cone', T([0, 3.6, 0], [2.4, 3.6, 2.4])); push('crown2', 'cone', T([0, 5, 0], [1.7, 2.6, 1.7])); break;
    case 'building': {
      const plan = p.plan ?? { points: [[-3, -2], [3, -2], [3, 2], [-3, 2]] as [number, number][], height: 3, roof: true };
      const pts = plan.points, n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); if (l < 1e-4 || (n === 2 && i === 1)) continue;
        push(`wall${i}`, 'box', T([(a[0] + b[0]) / 2, plan.height / 2, (a[1] + b[1]) / 2], [l + 0.2, plan.height, 0.2], qFromEuler(0, -Math.atan2(dz, dx), 0)));
      }
      if (plan.roof && n > 2) { const xs = pts.map((q) => q[0]), zs = pts.map((q) => q[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs); push('roof', 'box', T([(x0 + x1) / 2, plan.height + 0.1, (z0 + z1) / 2], [x1 - x0 + 0.4, 0.2, z1 - z0 + 0.4])); }
      break;
    }
  }
  return out;
}

function fxDrawables(p: Project, f: Fx, t: number, out: Drawable[]): void {
  if (t < f.start || t > f.end) return;
  const frame = Math.round(t * p.fps), seed = hash32(f.id);
  const push = (i: number, kind: MeshKind, m: Mat4) => out.push({ key: `${f.id}:${i}`, entityId: f.id, kind, matrix: m, idColor: f.idColor, layer: 'fx' });
  const host = f.attachTo ? p.characters[f.attachTo] : undefined;
  const origin = (tt: number): Vec3 => (host ? add(characterPosition(p, host, tt), f.pos as Vec3) : [f.pos[0], f.pos[1] + terrainHeight(p.terrain, f.pos[0], f.pos[2]), f.pos[2]]);
  const s = f.size as Vec3;
  switch (f.kind) {
    case 'dust': { // puffs left along the host's recent path; only where it was actually moving
      const N = 10; for (let i = 0; i < N; i++) {
        const age = (i / N) * f.trail, tt = t - age; if (tt < f.start) break;
        const a = origin(tt), moving = host ? len(sub(origin(Math.max(0, tt - 0.05)), a)) / 0.05 : 1; if (moving < 1.2) continue;
        const g = 0.35 + age * 0.9; push(i, 'sphere', mCompose(add(a, [0, 0.25 * s[1] * g, 0]), [0, 0, 0, 1], [s[0] * g, s[1] * g * 0.7, s[2] * g]));
      } break;
    }
    case 'smoke': { const o = origin(t); for (let i = 0; i < 6; i++) { const ph = ((t * 0.35 + i / 6) % 1), r = mulberry32(seed + i); push(i, 'sphere', mCompose(add(o, [(r() - 0.5) * s[0] * 0.6 * ph, ph * s[1] * 3, (r() - 0.5) * s[2] * 0.6 * ph]), [0, 0, 0, 1], scale(s, 0.5 + ph))); } break; }
    case 'sparks': { const o = origin(t), r = mulberry32(seed + frame); for (let i = 0; i < 14; i++) push(i, 'box', mCompose(add(o, [(r() - 0.5) * s[0], r() * s[1], (r() - 0.5) * s[2]]), qFromEuler(r() * 3, r() * 3, 0), [0.03, 0.03, 0.18])); break; }
    case 'rain': { const o = origin(t), r = mulberry32(seed); for (let i = 0; i < 60; i++) { const x = (r() - 0.5) * s[0], z = (r() - 0.5) * s[2], ph = (r() + t * 1.7) % 1; push(i, 'box', mCompose(add(o, [x, (1 - ph) * s[1], z]), qFromEuler(0.12, 0, 0), [0.015, 0.5, 0.015])); } break; }
    case 'slash': { // sweeping arc in front of the host
      const o = origin(t), yaw = host ? evalCharacter(p, host, t).yaw : 0, dur = Math.max(0.05, Math.min(f.end, f.start + 0.5) - f.start), ph = Math.min(1, (t - f.start) / dur);
      for (let i = 0; i < 7; i++) { const a = yaw + (-1 + 2 * ph) * 1.1 - i * 0.14, R = 1.15 * s[0]; push(i, 'box', mCompose(add(o, [Math.sin(a) * R, 1.15 * s[1] + (0.5 - ph) * 0.5, Math.cos(a) * R]), qFromEuler(0, a, 0.5), [0.34 * (1 - i / 9), 0.04, 0.08])); }
      break;
    }
  }
}

const scatterCache = new WeakMap<Scatter, { terrain: Terrain; set: InstanceSet[] }>();
function scatterInstances(p: Project, sc: Scatter): InstanceSet[] {
  const hit = scatterCache.get(sc); if (hit && hit.terrain === p.terrain) return hit.set;
  const r = mulberry32(sc.seed), a: Mat4[] = [], b: Mat4[] = [];
  for (let i = 0; i < sc.count; i++) {
    const ang = r() * Math.PI * 2, rad = Math.sqrt(r()) * sc.radius, x = sc.center[0] + Math.cos(ang) * rad, z = sc.center[2] + Math.sin(ang) * rad, y = terrainHeight(p.terrain, x, z), k = 0.7 + r() * 0.7, q = qFromEuler(0, r() * 6.283, 0);
    if (sc.kind === 'grass') a.push(mCompose([x, y + 0.2 * k, z], qFromEuler((r() - 0.5) * 0.5, r() * 6.283, (r() - 0.5) * 0.5), [0.16 * k, 0.45 * k, 0.16 * k]));
    else if (sc.kind === 'rock') a.push(mCompose([x, y + 0.12 * k, z], q, [0.6 * k, 0.4 * k, 0.5 * k]));
    else { a.push(mCompose([x, y + 1.1 * k, z], q, [0.3 * k, 2.2 * k, 0.3 * k])); b.push(mCompose([x, y + 3.8 * k, z], q, [2.3 * k, 3.6 * k, 2.3 * k])); }
  }
  const id = SCATTER_ID[sc.kind];
  const set: InstanceSet[] = sc.kind === 'tree'
    ? [{ key: sc.id + ':trunk', entityId: sc.id, kind: 'cylinder', idColor: id, matrices: a }, { key: sc.id + ':crown', entityId: sc.id, kind: 'cone', idColor: id, matrices: b }]
    : [{ key: sc.id, entityId: sc.id, kind: sc.kind === 'grass' ? 'cone' : 'sphere', idColor: id, matrices: a }];
  scatterCache.set(sc, { terrain: p.terrain, set }); return set;
}

export function compileFrame(p: Project, t: number): FrameScene {
  const drawables: Drawable[] = [], skeletons: Record<string, Skeleton> = {}, states: Record<string, CharState> = {};
  for (const id of Object.keys(p.characters).sort()) {
    const c = p.characters[id], st = evalCharacter(p, c, t), sk = characterSkeleton(p, c, t, st);
    states[id] = st; skeletons[id] = sk; characterDrawables(c, sk, drawables);
  }
  for (const id of Object.keys(p.props).sort()) { const pr = p.props[id]; propDrawables(pr, terrainHeight(p.terrain, pr.pos[0], pr.pos[2]), drawables); }
  for (const id of Object.keys(p.fx).sort()) fxDrawables(p, p.fx[id], t, drawables);
  const instances = Object.keys(p.scatter).sort().flatMap((id) => scatterInstances(p, p.scatter[id]));
  return { t, drawables, instances, terrain: p.terrain, skeletons, states };
}

// ---------- unit meshes (shared by the software rasterizer; GL uses equivalent three geometries) ----------
export interface UnitMesh { pos: number[]; idx: number[] }
const meshCache: Partial<Record<MeshKind, UnitMesh>> = {};
export function unitMesh(kind: MeshKind): UnitMesh {
  const hit = meshCache[kind]; if (hit) return hit;
  const pos: number[] = [], idx: number[] = [];
  const v = (x: number, y: number, z: number) => { pos.push(x, y, z); return pos.length / 3 - 1; };
  if (kind === 'box') {
    for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) v(x, y, z);
    idx.push(0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3);
  } else if (kind === 'plane') { v(-0.5, 0, -0.5); v(0.5, 0, -0.5); v(0.5, 0, 0.5); v(-0.5, 0, 0.5); idx.push(0, 2, 1, 0, 3, 2); }
  else if (kind === 'sphere') {
    const R = 8, S = 12;
    for (let i = 0; i <= R; i++) for (let j = 0; j < S; j++) { const th = (i / R) * Math.PI, ph = (j / S) * 2 * Math.PI; v(0.5 * Math.sin(th) * Math.cos(ph), 0.5 * Math.cos(th), 0.5 * Math.sin(th) * Math.sin(ph)); }
    for (let i = 0; i < R; i++) for (let j = 0; j < S; j++) { const a = i * S + j, b = i * S + ((j + 1) % S), c = a + S, d = b + S; if (i > 0) idx.push(a, b, c); if (i < R - 1) idx.push(b, d, c); }
  } else { // cylinder / cone
    const S = 12, top = kind === 'cone' ? 0.001 : 0.5;
    for (let j = 0; j < S; j++) { const ph = (j / S) * 2 * Math.PI; v(0.5 * Math.cos(ph), -0.5, 0.5 * Math.sin(ph)); v(top * Math.cos(ph), 0.5, top * Math.sin(ph)); }
    const cb = v(0, -0.5, 0), ct = v(0, 0.5, 0);
    for (let j = 0; j < S; j++) { const a = j * 2, b = ((j + 1) % S) * 2; idx.push(a, a + 1, b, b, a + 1, b + 1, cb, a, b, ct, b + 1, a + 1); }
  }
  return (meshCache[kind] = { pos, idx });
}
export function terrainMesh(t: Terrain): UnitMesh {
  const n = t.heights.length === t.res * t.res ? t.res : 2, pos: number[] = [], idx: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.push((i / (n - 1) - 0.5) * t.size, n === 2 ? 0 : t.heights[j * n + i], (j / (n - 1) - 0.5) * t.size);
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
  return { pos, idx };
}
export { mPos, cross };

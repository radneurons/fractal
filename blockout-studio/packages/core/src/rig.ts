/** Procedural humanoid mannequin: skeleton, parametric clips, blending, FK and two-bone leg IK.
 *  Everything is a pure function of (clip, phase) so playback and export are frame-exact and deterministic. */
import { JOINTS, type Joint, type CustomClip } from './schema';
import { type Vec3, type Quat, type Mat4, add, sub, scale, norm, len, cross, dot, clamp, lerp, mCompose, mMul, mPos, mDir, qFromEuler, qFromBasis } from './math';

export const SKELETON: Record<Joint, { parent: Joint | null; off: Vec3 }> = {
  hips: { parent: null, off: [0, 0.95, 0] }, spine: { parent: 'hips', off: [0, 0.12, 0] }, chest: { parent: 'spine', off: [0, 0.16, 0] },
  neck: { parent: 'chest', off: [0, 0.22, 0] }, head: { parent: 'neck', off: [0, 0.09, 0] },
  upperArmL: { parent: 'chest', off: [0.19, 0.17, 0] }, foreArmL: { parent: 'upperArmL', off: [0, -0.28, 0] }, handL: { parent: 'foreArmL', off: [0, -0.26, 0] },
  upperArmR: { parent: 'chest', off: [-0.19, 0.17, 0] }, foreArmR: { parent: 'upperArmR', off: [0, -0.28, 0] }, handR: { parent: 'foreArmR', off: [0, -0.26, 0] },
  upLegL: { parent: 'hips', off: [0.095, -0.03, 0] }, legL: { parent: 'upLegL', off: [0, -0.44, 0] }, footL: { parent: 'legL', off: [0, -0.43, 0] },
  upLegR: { parent: 'hips', off: [-0.095, -0.03, 0] }, legR: { parent: 'upLegR', off: [0, -0.44, 0] }, footR: { parent: 'legR', off: [0, -0.43, 0] },
};
export const ANKLE_H = 0.05; // rest height of the foot joint above ground (model units, 1.75 m tall)
export const MODEL_HEIGHT = 1.75;

export interface Pose { r: Partial<Record<Joint, Vec3>>; root?: Vec3 }
export interface ClipDef { loop: boolean; dur: number; stride?: number; fn: (p: number) => Pose }

const TAU = Math.PI * 2;
const gait = (g: { swing: number; knee: number; arm: number; elbow: number; lean: number; bounce: number }) => (p: number): Pose => {
  const s = Math.sin(TAU * p), c = Math.cos(TAU * p);
  return {
    root: [0, g.bounce * Math.cos(2 * TAU * p) - g.bounce - g.lean * 0.12, 0],
    r: {
      hips: [g.lean * 0.4, 0.12 * g.swing * s, 0], spine: [g.lean * 0.6, 0, 0], chest: [0, -0.22 * g.swing * s, 0], head: [-g.lean * 0.7, 0, 0],
      upLegL: [-g.swing * s - g.lean * 0.3, 0, 0], upLegR: [g.swing * s - g.lean * 0.3, 0, 0],
      legL: [g.knee * Math.max(0, c) ** 1.5 + 0.08, 0, 0], legR: [g.knee * Math.max(0, -c) ** 1.5 + 0.08, 0, 0],
      footL: [0.25 * g.swing * Math.max(0, -s), 0, 0], footR: [0.25 * g.swing * Math.max(0, s), 0, 0],
      upperArmL: [g.arm * s, 0, 0.07], upperArmR: [-g.arm * s, 0, -0.07], foreArmL: [-g.elbow - 0.2 * g.arm * Math.max(0, -s), 0, 0], foreArmR: [-g.elbow - 0.2 * g.arm * Math.max(0, s), 0, 0],
    },
  };
};
/** Key-pose clip: linear interpolation between sparse poses over phase. */
const keyed = (keys: [number, Pose][]) => (p: number): Pose => {
  let i = 0; while (i < keys.length - 2 && p > keys[i + 1][0]) i++;
  const [pa, a] = keys[i], [pb, b] = keys[Math.min(i + 1, keys.length - 1)];
  return blendPose(a, b, pb > pa ? clamp((p - pa) / (pb - pa)) : 0);
};
const N: Pose = { r: { upperArmL: [0, 0, 0.07], upperArmR: [0, 0, -0.07], foreArmL: [-0.12, 0, 0], foreArmR: [-0.12, 0, 0] } };
const GUARD: Pose = { root: [0, -0.08, 0], r: { upLegL: [-0.35, 0, 0.05], legL: [0.45, 0, 0], upLegR: [0.2, 0, -0.05], legR: [0.35, 0, 0], upperArmR: [-0.7, 0, -0.15], foreArmR: [-1.1, 0, 0], upperArmL: [-0.3, 0, 0.2], foreArmL: [-0.9, 0, 0], spine: [0.1, 0, 0] } };

export const CLIP_DEFS: Record<string, ClipDef> = {
  idle: { loop: true, dur: 3.2, fn: (p) => { const s = Math.sin(TAU * p); return { root: [0, -0.004 + 0.004 * s, 0], r: { ...N.r, chest: [0.015 * s, 0, 0], head: [0, 0.04 * Math.sin(TAU * p * 0.5), 0], upperArmL: [0.02 * s, 0, 0.08], upperArmR: [-0.02 * s, 0, -0.08] } }; } },
  walk: { loop: true, dur: 1.05, stride: 1.45, fn: gait({ swing: 0.5, knee: 0.9, arm: 0.4, elbow: 0.25, lean: 0.04, bounce: 0.015 }) },
  run: { loop: true, dur: 0.72, stride: 2.7, fn: gait({ swing: 0.85, knee: 1.5, arm: 0.9, elbow: 1.3, lean: 0.22, bounce: 0.035 }) },
  sprint: { loop: true, dur: 0.5, stride: 3.9, fn: gait({ swing: 1.1, knee: 1.9, arm: 1.25, elbow: 1.5, lean: 0.42, bounce: 0.045 }) },
  crouch: { loop: true, dur: 3, fn: (p) => ({ root: [0, -0.36 + 0.005 * Math.sin(TAU * p), 0.02], r: { upLegL: [-1.25, 0, 0.12], legL: [1.75, 0, 0], footL: [-0.5, 0, 0], upLegR: [-0.75, 0, -0.12], legR: [1.9, 0, 0], footR: [-0.3, 0, 0], spine: [0.35, 0, 0], head: [-0.3, 0, 0], upperArmL: [-0.5, 0, 0.15], foreArmL: [-0.9, 0, 0], upperArmR: [-0.5, 0, -0.15], foreArmR: [-0.9, 0, 0] } }) },
  jump: { loop: false, dur: 1.0, fn: keyed([
    [0, N], [0.22, { root: [0, -0.28, 0], r: { upLegL: [-0.9, 0, 0], legL: [1.5, 0, 0], footL: [-0.5, 0, 0], upLegR: [-0.9, 0, 0], legR: [1.5, 0, 0], footR: [-0.5, 0, 0], spine: [0.4, 0, 0], upperArmL: [0.9, 0, 0.1], upperArmR: [0.9, 0, -0.1] } }],
    [0.38, { root: [0, 0.3, 0], r: { upperArmL: [-2.6, 0, 0.2], upperArmR: [-2.6, 0, -0.2], footL: [0.6, 0, 0], footR: [0.6, 0, 0] } }],
    [0.55, { root: [0, 0.62, 0], r: { upLegL: [-0.9, 0, 0], legL: [1.3, 0, 0], upLegR: [-0.5, 0, 0], legR: [1.1, 0, 0], upperArmL: [-1.6, 0, 0.5], upperArmR: [-1.6, 0, -0.5] } }],
    [0.8, { root: [0, -0.22, 0], r: { upLegL: [-0.8, 0, 0], legL: [1.3, 0, 0], footL: [-0.4, 0, 0], upLegR: [-0.8, 0, 0], legR: [1.3, 0, 0], footR: [-0.4, 0, 0], spine: [0.35, 0, 0], upperArmL: [0.3, 0, 0.3], upperArmR: [0.3, 0, -0.3] } }], [1, N]]) },
  slash: { loop: false, dur: 0.75, fn: keyed([
    [0, GUARD], [0.3, { root: [0, -0.05, 0], r: { chest: [-0.1, -0.55, 0], spine: [-0.08, -0.2, 0], upperArmR: [-2.7, 0, -0.5], foreArmR: [-0.9, 0, 0], upperArmL: [-1.9, 0, 0.5], foreArmL: [-1.2, 0, 0], upLegL: [-0.3, 0, 0], legL: [0.4, 0, 0], upLegR: [0.25, 0, 0], legR: [0.3, 0, 0] } }],
    [0.52, { root: [0, -0.2, 0], r: { chest: [0.3, 0.7, 0], spine: [0.3, 0.3, 0], upperArmR: [-0.75, 0, 0.75], foreArmR: [-0.15, 0, 0], upperArmL: [-0.4, 0, -0.3], foreArmL: [-0.8, 0, 0], upLegL: [-0.95, 0, 0], legL: [1.0, 0, 0], upLegR: [0.55, 0, 0], legR: [0.25, 0, 0], head: [-0.2, -0.3, 0] } }],
    [0.7, { root: [0, -0.2, 0], r: { chest: [0.3, 0.8, 0], spine: [0.3, 0.3, 0], upperArmR: [-0.4, 0, 0.9], foreArmR: [-0.1, 0, 0], upperArmL: [-0.4, 0, -0.3], foreArmL: [-0.8, 0, 0], upLegL: [-0.95, 0, 0], legL: [1.0, 0, 0], upLegR: [0.55, 0, 0], legR: [0.25, 0, 0], head: [-0.2, -0.3, 0] } }], [1, GUARD]]) },
  thrust: { loop: false, dur: 0.6, fn: keyed([
    [0, GUARD], [0.3, { root: [0, -0.1, -0.05], r: { chest: [0, -0.5, 0], upperArmR: [0.5, 0, -0.25], foreArmR: [-1.9, 0, 0], upperArmL: [-0.9, 0, 0.3], foreArmL: [-0.6, 0, 0], upLegL: [-0.3, 0, 0], legL: [0.5, 0, 0], upLegR: [0.1, 0, 0], legR: [0.4, 0, 0] } }],
    [0.55, { root: [0, -0.24, 0.12], r: { spine: [0.35, 0, 0], chest: [0.1, 0.55, 0], head: [-0.4, -0.35, 0], upperArmR: [-1.5, 0, 0.1], foreArmR: [-0.05, 0, 0], upperArmL: [0.6, 0, 0.3], foreArmL: [-0.3, 0, 0], upLegL: [-1.15, 0, 0], legL: [1.15, 0, 0], upLegR: [0.6, 0, 0], legR: [0.15, 0, 0] } }], [1, GUARD]]) },
  block: { loop: false, dur: 0.35, fn: keyed([[0, GUARD], [1, { root: [0, -0.14, -0.04], r: { spine: [-0.08, 0, 0], upperArmR: [-1.45, 0, 0.75], foreArmR: [-1.5, 0, 0], upperArmL: [-1.2, 0, -0.5], foreArmL: [-1.3, 0, 0], upLegL: [-0.5, 0, 0.1], legL: [0.7, 0, 0], upLegR: [0.25, 0, -0.1], legR: [0.5, 0, 0], head: [0.1, 0, 0] } }]]) },
  dodge: { loop: false, dur: 0.6, fn: keyed([[0, GUARD], [0.45, { root: [0.32, -0.34, -0.1], r: { spine: [0.3, 0, -0.5], head: [0, 0, 0.3], upLegL: [-1.0, 0, 0.5], legL: [1.5, 0, 0], upLegR: [-0.2, 0, 0.3], legR: [0.9, 0, 0], upperArmL: [-0.4, 0, 0.9], upperArmR: [-0.6, 0, 0.3], foreArmR: [-1, 0, 0] } }], [1, GUARD]]) },
  hitReact: { loop: false, dur: 0.7, fn: keyed([[0, N], [0.25, { root: [0, -0.06, -0.16], r: { spine: [-0.3, 0.2, 0], chest: [-0.35, 0.3, 0], head: [-0.45, 0.2, 0], upperArmL: [-0.6, 0, 0.9], foreArmL: [-0.7, 0, 0], upperArmR: [0.5, 0, -0.7], foreArmR: [-0.5, 0, 0], upLegR: [0.45, 0, 0], legR: [0.5, 0, 0], upLegL: [-0.2, 0, 0], legL: [0.4, 0, 0] } }], [1, N]]) },
  fall: { loop: false, dur: 1.2, fn: keyed([[0, N], [0.35, { root: [0, -0.25, -0.2], r: { hips: [-0.5, 0, 0], spine: [-0.2, 0, 0], upLegL: [-0.3, 0, 0], legL: [1.1, 0, 0], upLegR: [0.1, 0, 0], legR: [0.9, 0, 0], upperArmL: [-0.8, 0, 1.0], upperArmR: [-0.8, 0, -1.0] } }],
    [0.8, { root: [0, -0.8, -0.55], r: { hips: [-1.45, 0, 0], head: [0.2, 0, 0], upLegL: [-0.3, 0, 0.15], legL: [0.5, 0, 0], upLegR: [-0.05, 0, -0.15], legR: [0.2, 0, 0], upperArmL: [0, 0, 1.2], upperArmR: [0, 0, -1.0] } }],
    [1, { root: [0, -0.82, -0.55], r: { hips: [-1.5, 0, 0], head: [0.1, 0.4, 0], upLegL: [-0.2, 0, 0.15], legL: [0.3, 0, 0], upLegR: [0, 0, -0.15], legR: [0.1, 0, 0], upperArmL: [0, 0, 1.3], upperArmR: [0, 0, -0.9] } }]]) },
  sit: { loop: false, dur: 0.9, fn: keyed([[0, N], [1, { root: [0, -0.46, -0.1], r: { upLegL: [-1.5, 0, 0.08], legL: [1.5, 0, 0], upLegR: [-1.5, 0, -0.08], legR: [1.5, 0, 0], spine: [0.06, 0, 0], upperArmL: [-0.35, 0, 0.1], foreArmL: [-0.8, 0, 0], upperArmR: [-0.35, 0, -0.1], foreArmR: [-0.8, 0, 0] } }]]) },
  point: { loop: false, dur: 0.5, fn: keyed([[0, N], [1, { r: { upperArmR: [-1.5, 0, -0.08], foreArmR: [-0.05, 0, 0], chest: [0, 0.2, 0], head: [-0.05, 0.1, 0], upperArmL: [0, 0, 0.07], foreArmL: [-0.12, 0, 0] } }]]) },
  talk: { loop: true, dur: 2.4, fn: (p) => { const s = Math.sin(TAU * p), s2 = Math.sin(2 * TAU * p + 0.6); return { r: { head: [0.05 * s2, 0.12 * s, 0], chest: [0.02 * s2, 0.05 * s, 0], upperArmR: [-0.35 + 0.15 * s2, 0, -0.12], foreArmR: [-1.1 + 0.35 * s, 0, 0], upperArmL: [-0.2 - 0.1 * s2, 0, 0.1], foreArmL: [-0.8 - 0.25 * s, 0, 0] } }; } },
};

export function blendPose(a: Pose, b: Pose, w: number): Pose {
  if (w <= 0) return a; if (w >= 1) return b;
  const r: Partial<Record<Joint, Vec3>> = {};
  for (const j of JOINTS) { const x = a.r[j], y = b.r[j]; if (!x && !y) continue; const p = x ?? [0, 0, 0], q = y ?? [0, 0, 0]; r[j] = [lerp(p[0], q[0], w), lerp(p[1], q[1], w), lerp(p[2], q[2], w)]; }
  const ra = a.root ?? [0, 0, 0], rb = b.root ?? [0, 0, 0];
  return { r, root: [lerp(ra[0], rb[0], w), lerp(ra[1], rb[1], w), lerp(ra[2], rb[2], w)] };
}
export function sampleCustomClip(c: CustomClip, time: number): Pose {
  const n = c.frames.length; if (!n) return { r: {} };
  let f = time * c.fps; f = c.loop ? ((f % n) + n) % n : clamp(f, 0, n - 1);
  const i = Math.floor(f), j = c.loop ? (i + 1) % n : Math.min(i + 1, n - 1);
  const root = (fr: Record<string, Vec3>) => fr._root;
  return blendPose({ r: c.frames[i] as Pose['r'], root: root(c.frames[i]) }, { r: c.frames[j] as Pose['r'], root: root(c.frames[j]) }, f - i);
}

export interface Skeleton { pos: Record<Joint, Vec3>; mat: Record<Joint, Mat4>; headTop: Vec3; forward: Vec3; scale: number }
/** Forward kinematics. `ground(x,z)` returns terrain height; legs are IK-corrected so feet never sink and stay planted on slopes. */
export function solveSkeleton(pose: Pose, rootPos: Vec3, yaw: number, height: number, build: number, ground?: (x: number, z: number) => number): Skeleton {
  const h = height / MODEL_HEIGHT, mat = {} as Record<Joint, Mat4>, pos = {} as Record<Joint, Vec3>;
  const ro = pose.root ?? [0, 0, 0];
  const rootM = mCompose(rootPos, qFromEuler(0, yaw, 0));
  for (const j of JOINTS) {
    const s = SKELETON[j], e = pose.r[j] ?? [0, 0, 0];
    let off: Vec3 = [s.off[0] * h * (j.startsWith('upLeg') ? Math.sqrt(build) : build), s.off[1] * h, s.off[2] * h];
    if (j === 'hips') off = add(off, scale(ro, h));
    mat[j] = mMul(s.parent ? mat[s.parent] : rootM, mCompose(off, qFromEuler(e[0], e[1], e[2])));
    pos[j] = mPos(mat[j]);
  }
  const forward = mDir(rootM, [0, 0, 1]);
  if (ground) for (const side of ['L', 'R'] as const) {
    const hip = pos[`upLeg${side}`], foot = pos[`foot${side}`];
    const g = ground(foot[0], foot[2]) + ANKLE_H * h, flat = rootPos[1] + ANKLE_H * h;
    const planted = foot[1] - flat < 0.04 * h;
    const targetY = planted ? g + Math.max(0, foot[1] - flat) : Math.max(foot[1], g);
    if (Math.abs(targetY - foot[1]) < 1e-5) continue;
    const target: Vec3 = [foot[0], targetY, foot[2]];
    const a = len(sub(pos[`leg${side}`], hip)), b = len(sub(foot, pos[`leg${side}`]));
    let d = len(sub(target, hip)); const dir = norm(sub(target, hip));
    if (d > a + b - 1e-4) { d = a + b - 1e-4; }
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    // knee bends toward the pose's existing knee direction (falls back to character forward)
    let pole = sub(pos[`leg${side}`], add(hip, scale(dir, dot(sub(pos[`leg${side}`], hip), dir))));
    if (len(pole) < 1e-4) pole = sub(forward, scale(dir, dot(forward, dir)));
    pole = norm(pole);
    const knee = add(hip, add(scale(dir, a * cosA), scale(pole, a * sinA)));
    pos[`leg${side}`] = knee; pos[`foot${side}`] = add(hip, scale(dir, d));
    const delta = sub(pos[`foot${side}`], foot);
    mat[`leg${side}`] = [...mat[`leg${side}`]]; mat[`leg${side}`][12] = knee[0]; mat[`leg${side}`][13] = knee[1]; mat[`leg${side}`][14] = knee[2];
    mat[`foot${side}`] = [...mat[`foot${side}`]]; mat[`foot${side}`][12] += delta[0]; mat[`foot${side}`][13] += delta[1]; mat[`foot${side}`][14] += delta[2];
  }
  const headTop = add(pos.head, mDir(mat.head, [0, 0.23 * h, 0]));
  return { pos, mat, headTop, forward, scale: h };
}
/** Orientation with +Y along a→b; used to lay limb segments between joints. */
export function segmentQuat(a: Vec3, b: Vec3, hint: Vec3): Quat {
  const y = norm(sub(b, a)); let x = cross(hint, y); if (len(x) < 1e-5) x = cross([1, 0, 0], y); if (len(x) < 1e-5) x = [0, 0, 1]; x = norm(x);
  return qFromBasis(x, y, cross(x, y));
}

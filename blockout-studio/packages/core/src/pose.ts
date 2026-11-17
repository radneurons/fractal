/** Pose mode maths: turn a joint's desired world orientation into an additive pose-layer rotation at time t. */
import type { Character, Joint, Project } from './schema';
import { qConj, qMul, qFromBasis, norm, type Quat, type Vec3, type Mat4 } from './math';
import { characterSkeleton, evalCharacter } from './evaluate';
import { SKELETON } from './rig';
import { eulerXYZ } from './mocap';

export const matQuat = (m: Mat4): Quat => qFromBasis(norm([m[0], m[1], m[2]]), norm([m[4], m[5], m[6]]), norm([m[8], m[9], m[10]]));
/** World orientation of every joint at t (for the rotate gizmo). */
export function jointFrames(p: Project, c: Character, t: number): Record<Joint, { pos: Vec3; quat: Quat }> {
  const sk = characterSkeleton(p, c, t), out = {} as Record<Joint, { pos: Vec3; quat: Quat }>;
  for (const j of Object.keys(SKELETON) as Joint[]) out[j] = { pos: sk.pos[j], quat: matQuat(sk.mat[j]) }; return out;
}
/** The additive rotation to key so that `joint` ends up with world orientation `world` at time t
 *  (relative to the clip pose without this joint's existing layer). */
export function poseKeyFor(p: Project, c: Character, t: number, joint: Joint, world: Quat): Vec3 {
  const parent = SKELETON[joint].parent, sk = characterSkeleton(p, c, t);
  const parentQ: Quat = parent ? matQuat(sk.mat[parent]) : [0, Math.sin(evalCharacter(p, c, t).yaw / 2), 0, Math.cos(evalCharacter(p, c, t).yaw / 2)];
  const local = eulerXYZ(qMul(qConj(parentQ), world)), bare = { ...c, poseKeys: c.poseKeys.filter((k) => k.joint !== joint) }, base = evalCharacter(p, bare, t).pose.r[joint] ?? [0, 0, 0];
  return [local[0] - base[0], local[1] - base[1], local[2] - base[2]].map((v) => Math.round(v * 1e4) / 1e4) as Vec3;
}

/** Retarget body landmarks (MediaPipe Pose world landmarks, or any 33-point BlazePose layout) onto the mannequin rig.
 *  Solves per-joint local eulers by aligning each bone's rest direction with the observed one, hierarchically.
 *  Cleanup: One-Euro-style smoothing and foot locking (feet that are slow and low are pinned to the ground). */
import { JOINTS, type Joint, type CustomClip } from './schema';
import { SKELETON, MODEL_HEIGHT } from './rig';
import { type Vec3, type Quat, add, sub, scale, norm, len, cross, dot, qMul, qConj, qRotate, qBetween, qFromBasis, round } from './math';

export const LM = { nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28, lHeel: 29, rHeel: 30, lToe: 31, rToe: 32 } as const;
const mid = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);
/** Joint world positions implied by the landmarks (mannequin naming). Landmarks: x right(of image), y up, z toward camera, metres. */
export function landmarksToJoints(lm: Vec3[]): Partial<Record<Joint, Vec3>> {
  const hips = mid(lm[LM.lHip], lm[LM.rHip]), sh = mid(lm[LM.lShoulder], lm[LM.rShoulder]), ear = lm[LM.nose];
  return { hips, chest: add(hips, scale(sub(sh, hips), 0.62)), neck: sh, head: add(sh, scale(sub(ear, sh), 0.55)), upperArmL: lm[LM.lShoulder], foreArmL: lm[LM.lElbow], handL: lm[LM.lWrist], upperArmR: lm[LM.rShoulder], foreArmR: lm[LM.rElbow], handR: lm[LM.rWrist], upLegL: lm[LM.lHip], legL: lm[LM.lKnee], footL: lm[LM.lAnkle], upLegR: lm[LM.rHip], legR: lm[LM.rKnee], footR: lm[LM.rAnkle] };
}
const CHILD: Partial<Record<Joint, Joint>> = { neck: 'head', upperArmL: 'foreArmL', foreArmL: 'handL', upperArmR: 'foreArmR', foreArmR: 'handR', upLegL: 'legL', legL: 'footL', upLegR: 'legR', legR: 'footR' };
export function eulerXYZ(q: Quat): Vec3 { // inverse of qFromEuler (XYZ)
  const [x, y, z, w] = q, m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - w * z), m13 = 2 * (x * z + w * y), m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - w * x), m32 = 2 * (y * z + w * x), m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13))); return Math.abs(m13) < 0.9999999 ? [Math.atan2(-m23, m33), ey, Math.atan2(-m12, m11)] : [Math.atan2(m32, m22), ey, 0];
}
export interface RetargetFrame { r: Partial<Record<Joint, Vec3>>; root: Vec3; yaw: number; hipsPos: Vec3 }
/** One frame: returns local eulers per joint (root yaw factored out) and the hips offset in model units. */
export function retargetFrame(lm: Vec3[], heightM = MODEL_HEIGHT): RetargetFrame {
  const P = landmarksToJoints(lm), right = norm(sub(P.upLegL!, P.upLegR!)), up0 = norm(sub(P.neck!, P.hips!));
  const fwd = norm(cross(right, up0)), yaw = Math.atan2(fwd[0], fwd[2]); // character faces +Z at yaw 0, left side is +X
  const world: Partial<Record<Joint, Quat>> = {}, r: Partial<Record<Joint, Vec3>> = {}, rootQ: Quat = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  // hips: full orientation from the pelvis frame
  const hx = right, hy = norm(sub(up0, scale(hx, dot(up0, hx)))), hipsW = qFromBasis(hx, hy, cross(hx, hy)); world.hips = hipsW;
  for (const j of JOINTS) {
    if (j === 'hips') { r.hips = eulerXYZ(qMul(qConj(rootQ), hipsW)); continue; }
    const parentW = world[SKELETON[j].parent!] ?? hipsW, child = CHILD[j];
    let local: Quat = [0, 0, 0, 1];
    if (j === 'spine' || j === 'chest') { const a = P[j === 'spine' ? 'hips' : 'chest']!, b = P[j === 'spine' ? 'chest' : 'neck']!, restDir = qRotate(parentW, norm(SKELETON[j === 'spine' ? 'chest' : 'neck'].off)); local = qMul(qMul(qConj(parentW), qBetween(restDir, norm(sub(b, a)))), parentW); }
    else if (child && P[j] && P[child]) { const restDir = qRotate(parentW, norm(SKELETON[child].off)), obs = norm(sub(P[child]!, P[j]!)); if (len(obs) > 1e-6) local = qMul(qMul(qConj(parentW), qBetween(restDir, obs)), parentW); }
    world[j] = qMul(parentW, local); r[j] = eulerXYZ(local).map((v) => round(v, 4)) as Vec3;
  }
  const scaleK = MODEL_HEIGHT / heightM, hipsPos = P.hips!, footY = Math.min(P.footL![1], P.footR![1]);
  return { r, yaw, hipsPos, root: [0, round((hipsPos[1] - footY) * scaleK - (SKELETON.hips.off[1] - 0.86), 4), 0] };
}
/** Smoothing: exponential with speed-adaptive cutoff (One-Euro flavour) per scalar channel. */
export function smoothFrames(frames: Record<string, Vec3>[], fps: number, minCutoff = 1.5, beta = 0.3): Record<string, Vec3>[] {
  if (!frames.length) return frames; const out: Record<string, Vec3>[] = [frames[0]], dx: Record<string, Vec3> = {}, dt = 1 / fps, alpha = (fc: number) => 1 / (1 + 1 / (2 * Math.PI * fc * dt));
  for (let f = 1; f < frames.length; f++) { const prev = out[f - 1], o: Record<string, Vec3> = {}; for (const k of Object.keys(frames[f])) { const x = frames[f][k], p = prev[k] ?? x, d = dx[k] ?? [0, 0, 0], nd = x.map((v, i) => v - p[i]).map((v) => v / dt) as Vec3, ad = alpha(1), sd = nd.map((v, i) => d[i] + ad * (v - d[i])) as Vec3; dx[k] = sd; o[k] = x.map((v, i) => { const a = alpha(minCutoff + beta * Math.abs(sd[i])); return p[i] + a * (v - p[i]); }) as Vec3; } out.push(o); }
  return out;
}
/** Build a clip from recorded landmark frames. Foot locking keeps the lowest ankle at ground height when it is nearly still. */
export function buildMocapClip(id: string, name: string, lmFrames: Vec3[][], fps: number, heightM = 1.75): CustomClip {
  const frames = lmFrames.map((lm) => retargetFrame(lm, heightM)), raw = frames.map((f) => ({ ...f.r, _root: f.root } as Record<string, Vec3>)), sm = smoothFrames(raw, fps);
  for (let f = 1; f < lmFrames.length; f++) { const a = lmFrames[f], b = lmFrames[f - 1], vL = len(sub(a[LM.lAnkle], b[LM.lAnkle])) * fps, vR = len(sub(a[LM.rAnkle], b[LM.rAnkle])) * fps; if (Math.min(vL, vR) < 0.15) sm[f]._root = [0, Math.max(sm[f]._root[1], raw[f]._root[1]), 0]; }
  return { id, name, fps, loop: false, frames: sm };
}

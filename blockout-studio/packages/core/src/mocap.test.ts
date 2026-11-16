import { describe, expect, it } from 'vitest';
import { solveSkeleton, CLIP_DEFS, retargetFrame, LM, buildMocapClip, type Vec3, type Joint } from './index';

/** Make 33 BlazePose-style landmarks from our own FK, then retarget them back: a round trip. */
function landmarksFromPose(r: Partial<Record<Joint, Vec3>>, yaw = 0): Vec3[] {
  const sk = solveSkeleton({ r }, [0, 0, 0], yaw, 1.75, 1), lm: Vec3[] = Array.from({ length: 33 }, () => [0, 0, 0] as Vec3), P = sk.pos;
  const set: [number, Vec3][] = [[LM.lShoulder, P.upperArmL], [LM.rShoulder, P.upperArmR], [LM.lElbow, P.foreArmL], [LM.rElbow, P.foreArmR], [LM.lWrist, P.handL], [LM.rWrist, P.handR], [LM.lHip, P.upLegL], [LM.rHip, P.upLegR], [LM.lKnee, P.legL], [LM.rKnee, P.legR], [LM.lAnkle, P.footL], [LM.rAnkle, P.footR]];
  for (const [i, v] of set) lm[i] = v; lm[LM.nose] = [P.head[0] + (P.head[0] - P.neck[0]) * 0.8, P.head[1] + (P.head[1] - P.neck[1]) * 0.8, P.head[2] + (P.head[2] - P.neck[2]) * 0.8]; return lm;
}
const limbErr = (a: Partial<Record<Joint, Vec3>>, b: Partial<Record<Joint, Vec3>>) => { const A = solveSkeleton({ r: a }, [0, 0, 0], 0, 1.75, 1).pos, B = solveSkeleton({ r: b }, [0, 0, 0], 0, 1.75, 1).pos; let m = 0; for (const j of ['handL', 'handR', 'footL', 'footR', 'foreArmL', 'legR'] as Joint[]) m = Math.max(m, Math.hypot(A[j][0] - B[j][0], A[j][1] - B[j][1], A[j][2] - B[j][2])); return m; };

describe('mocap retargeting', () => {
  it.each(['walk', 'run', 'slash', 'point', 'crouch'])('round-trips the %s pose within 5 cm at the extremities (landmarks carry no bone twist; chest is estimated)', (clip) => {
    const pose = CLIP_DEFS[clip].fn(0.4), lm = landmarksFromPose(pose.r), rt = retargetFrame(lm);
    expect(limbErr(pose.r, rt.r)).toBeLessThan(0.05);
  });
  it('recovers facing as root yaw', () => { const lm = landmarksFromPose(CLIP_DEFS.idle.fn(0).r, 1.1); expect(retargetFrame(lm).yaw).toBeCloseTo(1.1, 1); });
  it('builds a smoothed clip that samples like any other', () => {
    const frames = Array.from({ length: 24 }, (_, i) => landmarksFromPose(CLIP_DEFS.walk.fn(i / 24).r).map((v) => [v[0] + (i % 2 ? 0.004 : -0.004), v[1], v[2]] as Vec3));
    const clip = buildMocapClip('m1', 'test', frames, 24); expect(clip.frames).toHaveLength(24); expect(clip.frames[5].upLegL).toBeDefined(); expect(clip.frames[5]._root).toBeDefined();
  });
});

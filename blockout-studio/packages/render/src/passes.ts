import type { CamState, Project, Shot } from '@blockout/core';
import { evalCamera, mCompose, mInvRigid, qRotate } from '@blockout/core';

export const PASSES = ['clay', 'depth', 'depthMetric', 'normals', 'id', 'pose', 'canny', 'flow', 'fx'] as const;
export type PassName = (typeof PASSES)[number];
export const PASS_INFO: Record<PassName, { purpose: string; encoding: string }> = {
  clay: { purpose: 'neutral matte with blockout lighting and shadows', encoding: 'sRGB' },
  depth: { purpose: 'normalized depth preview (near = white)', encoding: 'grey = 255 * (1 - log(z/near)/log(far/near)), near/far in manifest' },
  depthMetric: { purpose: 'metric depth', encoding: 'RGB24 big-endian millimetres from the camera plane; 0 = sky' },
  normals: { purpose: 'view-space normals', encoding: 'rgb = n * 0.5 + 0.5 (x right, y up, z toward camera)' },
  id: { purpose: 'flat colour per entity (palette in manifest)', encoding: 'exact sRGB bytes, no anti-aliasing' },
  pose: { purpose: 'OpenPose-style skeleton (body 18, hands 21 each, face points) from the rig', encoding: 'OpenPose limb colours on black; keypoints also in pose.json' },
  canny: { purpose: 'structure / line-art guide', encoding: 'white edges on black from depth, normal and id discontinuities' },
  flow: { purpose: 'optical flow (motion vectors to the previous frame)', encoding: 'r,g = 128 + 127 * clamp(d / maxDisp); maxDisp px in manifest; b = 128 where valid' },
  fx: { purpose: 'effects proxy mask (dust, smoke, sparks, rain, slash arcs)', encoding: 'flat fx colour on black, occluded by scene geometry' },
};
export const DEPTH_NEAR = 0.3, DEPTH_FAR = 300;
export const flowMaxDisp = (width: number) => Math.max(4, Math.round(width * 0.05));
export interface PassRenderer {
  readonly kind: 'soft' | 'webgl'; readonly info: string;
  render(project: Project, shot: Shot, frame: number, pass: PassName, width: number, height: number): Uint8ClampedArray;
}
/** Absolute scene time of a shot-relative frame index. Frame-stepped: never wall-clock. */
export const shotTime = (p: Project, shot: Shot, frame: number) => shot.start + frame / p.fps;
export function shotCamera(p: Project, shot: Shot, frame: number): CamState { return evalCamera(p, p.cameras[shot.cameraId], shotTime(p, shot, frame)); }
/** Per-frame camera data: pinhole intrinsics in pixels + extrinsics (camera-to-world, OpenGL convention: -Z forward, +Y up). */
export function cameraData(p: Project, shot: Shot, frame: number, width: number, height: number) {
  const c = shotCamera(p, shot, frame), fy = height / 2 / Math.tan(c.fovY / 2), c2w = mCompose(c.pos, c.quat), r = (x: number) => Math.round(x * 1e6) / 1e6;
  return { frame, t: r(frame / p.fps), intrinsics: { fx: r(fy), fy: r(fy), cx: width / 2, cy: height / 2, width, height, focalMm: r(c.focal), fovYDeg: r((c.fovY * 180) / Math.PI) },
    extrinsics: { cameraToWorld: c2w.map(r), worldToCamera: mInvRigid(c2w).map(r), position: c.pos.map(r), forward: qRotate(c.quat, [0, 0, -1]).map(r), quaternion: c.quat.map(r) }, focusDistance: r(c.focus), fStop: r(c.fstop), rollDeg: r((c.roll * 180) / Math.PI) };
}
export function passSize(p: Project, height: number): [number, number] { const a = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '2.39:1': 2.39, '4:3': 4 / 3 }[p.aspect]; const w = Math.round((height * a) / 2) * 2; return [w, Math.round(height / 2) * 2]; }

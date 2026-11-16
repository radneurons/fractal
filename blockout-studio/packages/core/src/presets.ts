/** Camera presets: each returns a ready Camera for a time range around a subject. */
import type { Camera, CamKey, Project } from './schema';
import { type Vec3, add, sub, norm, scale, len, DEG, clamp } from './math';
import { characterPosition, fovYFor } from './evaluate';
import { ASPECTS } from './schema';

export const CAMERA_PRESETS = ['static', 'dolly', 'truck', 'crane', 'orbit', 'pushIn', 'pullOut', 'whipPan', 'vertigo', 'topDown', 'follow'] as const;
export type CameraPreset = (typeof CAMERA_PRESETS)[number];
export interface PresetOpts { id: string; name?: string; start: number; end: number; subjectId?: string; subject?: Vec3; from?: Vec3; focal?: number; distance?: number; height?: number; degrees?: number; whipTo?: Vec3; side?: 1 | -1 }

export function makeCamera(p: Project, preset: CameraPreset, o: PresetOpts): Camera {
  const ch = o.subjectId ? p.characters[o.subjectId] : undefined;
  const s0: Vec3 = ch ? characterPosition(p, ch, o.start) : (o.subject ?? [0, 0, 0]), s1: Vec3 = ch ? characterPosition(p, ch, o.end) : s0;
  const eye = (ch?.height ?? 1.75) * 0.85, focal = o.focal ?? 35, dist = o.distance ?? 4.5, h = o.height ?? eye, side = o.side ?? 1;
  const aim0 = add(s0, [0, eye, 0]), aim1 = add(s1, [0, eye, 0]);
  let dir = o.from ? sub(o.from, s0) : ([0.35 * side, 0, 1] as Vec3); dir = norm([dir[0], 0, dir[2]]); const right: Vec3 = [dir[2], 0, -dir[0]];
  let n = 0; const key = (t: number, pos: Vec3, target: Vec3, f = focal, extra: Partial<CamKey> = {}): CamKey => ({ id: `${o.id}_k${n++}`, t, pos, target, focal: f, focus: len(sub(target, pos)), fstop: 2.8, roll: 0, ease: 'easeInOut', ...extra });
  const base = (d: number, hh = h): Vec3 => add(s0, add(scale(dir, d), [0, hh, 0]));
  const cam = (keys: CamKey[], extra: Partial<Camera> = {}): Camera => ({ id: o.id, name: o.name ?? preset, sensorWidth: 36, shake: { profile: 'none', amount: 1, seed: 1 }, keys, ...extra });
  const mid = (o.start + o.end) / 2;
  switch (preset) {
    case 'static': return cam([key(o.start, base(dist), aim0)]);
    case 'dolly': case 'pushIn': return cam([key(o.start, base(dist), aim0), key(o.end, base(dist * 0.55), aim1)]);
    case 'pullOut': return cam([key(o.start, base(dist * 0.55), aim0), key(o.end, base(dist * 1.3), aim1)]);
    case 'truck': return cam([key(o.start, add(base(dist), scale(right, -2.5)), add(aim0, scale(right, -2.5)), focal, { ease: 'linear' }), key(o.end, add(base(dist), scale(right, 2.5)), add(aim0, scale(right, 2.5)))]);
    case 'crane': return cam([key(o.start, base(dist, 0.6), aim0), key(o.end, base(dist * 1.2, 5.5), aim1)]);
    case 'orbit': {
      const deg = (o.degrees ?? 120) * DEG, a0 = Math.atan2(dir[0], dir[2]), N = clamp(Math.ceil(Math.abs(deg) / (30 * DEG)), 2, 12), keys: CamKey[] = [];
      for (let i = 0; i <= N; i++) { const f = i / N, a = a0 + deg * f, c = add(s0, scale(sub(s1, s0), f)); keys.push(key(o.start + (o.end - o.start) * f, add(c, [Math.sin(a) * dist, h, Math.cos(a) * dist]), add(c, [0, eye * 0.9, 0]), focal, { ease: 'linear' })); }
      return cam(keys);
    }
    case 'whipPan': { const to = o.whipTo ?? add(aim0, scale(right, 6)), pos = base(dist), t0 = mid - 0.18, t1 = mid + 0.18; return cam([key(o.start, pos, aim0, focal, { ease: 'linear' }), key(t0, pos, aim0, focal, { ease: 'easeInOut' }), key(t1, pos, to, focal, { ease: 'linear' }), key(o.end, pos, to)]); }
    case 'vertigo': { // dolly in while zooming out so the subject keeps its size
      const d0 = dist * 1.6, d1 = dist * 0.6, tanH = Math.tan(fovYFor(focal, 36, ASPECTS[p.aspect]) / 2), f1 = (focal * d1) / d0; void tanH;
      return cam([key(o.start, base(d0), aim0, focal, { ease: 'linear' }), key(o.end, base(d1), aim0, f1)]);
    }
    case 'topDown': return cam([key(o.start, [0, o.height ?? 14, 0.02], [0, 0, 0], focal, { ease: 'linear' })], { attach: ch ? { characterId: ch.id, lag: 0 } : undefined, lookAt: ch ? { characterId: ch.id, offset: [0, 0, 0] } : undefined, keys: ch ? [key(o.start, [0, o.height ?? 14, 0.02], [0, 0, 0])] : [key(o.start, add(s0, [0, o.height ?? 14, 0.02]), s0)] });
    case 'follow': return cam([key(o.start, add(scale(dir, dist), [0, h, 0]), [0, eye, 0])], { attach: ch ? { characterId: ch.id, lag: 0.25 } : undefined, lookAt: ch ? { characterId: ch.id, offset: [0, 1.4, 0] } : undefined, shake: { profile: 'handheld', amount: 1, seed: 3 } });
  }
}

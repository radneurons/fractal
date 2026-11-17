// Renders a performer (the mannequin doing a walk-in-place + point) as a 640x480 Y4M for Chromium's fake webcam.
import { writeFileSync } from 'node:fs';
import { ProjectS, evalCamera, characterSkeleton, projectPoint } from '../packages/core/src/index';
import { softRenderer } from '../packages/render/src/index';
const p = ProjectS.parse({ id: 'm', name: 'mocap fixture', fps: 24, duration: 4, aspect: '4:3', lighting: { timeOfDay: 12, skyColor: '#d8d8d8' },
  characters: { a: { id: 'a', name: 'Performer', idColor: '#56b4e9', keys: [{ id: 'k0', t: 0, pos: [0, 0, 0], clip: 'talk', facing: { mode: 'fixed', yaw: 0 } }, { id: 'k1', t: 2, pos: [0, 0, 0], clip: 'point', facing: { mode: 'fixed', yaw: 0 } }] } },
  cameras: { c: { id: 'c', name: 'webcam', keys: [{ id: 'k', t: 0, pos: [0, 1.0, 3.6], target: [0, 0.95, 0], focal: 28 }] } }, shots: [{ id: 's', name: 's', cameraId: 'c', start: 0, end: 4 }] });
const W = 640, H = 480, n = 96, frames: Buffer[] = [];
for (let f = 0; f < n; f++) {
  const rgb = softRenderer.render(p, p.shots[0], f, 'clay', W, H), t = f / p.fps, cs = evalCamera(p, p.cameras.c, t), sk = characterSkeleton(p, p.characters.a, t), M = sk.mat.head;
  // paint skin + a simple face on the head so a face-first person detector can find the performer
  const hp = (x: number, y: number, z: number) => { const w = [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]] as [number, number, number], q = projectPoint(cs, w); return [q[0] * W, q[1] * H]; };
  const c0 = hp(0, 0.115, 0.02), top = hp(0, 0.24, 0.02), R = Math.abs(c0[1] - top[1]);
  const disc = (cx: number, cy: number, rx: number, ry: number, col: number[]) => { for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (x >= 0 && y >= 0 && x < W && y < H && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) { const i = (y * W + x) * 4; rgb[i] = col[0]; rgb[i + 1] = col[1]; rgb[i + 2] = col[2]; } };
  disc(c0[0], c0[1], R * 0.82, R, [224, 172, 140]); disc(c0[0] - R * 0.3, c0[1] - R * 0.15, R * 0.13, R * 0.09, [40, 30, 30]); disc(c0[0] + R * 0.3, c0[1] - R * 0.15, R * 0.13, R * 0.09, [40, 30, 30]);
  disc(c0[0], c0[1] + R * 0.12, R * 0.07, R * 0.16, [190, 130, 110]); disc(c0[0], c0[1] + R * 0.45, R * 0.25, R * 0.07, [150, 60, 60]); disc(c0[0], c0[1] - R * 0.85, R * 0.75, R * 0.3, [50, 35, 30]);
  const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2)), V = Buffer.alloc((W / 2) * (H / 2));
  for (let i = 0; i < W * H; i++) { const r = rgb[i * 4], g = rgb[i * 4 + 1], b = rgb[i * 4 + 2]; Y[i] = Math.max(0, Math.min(255, 0.257 * r + 0.504 * g + 0.098 * b + 16)); }
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) { const i = (y * 2 * W + x * 2) * 4, r = rgb[i], g = rgb[i + 1], b = rgb[i + 2]; U[y * (W / 2) + x] = -0.148 * r - 0.291 * g + 0.439 * b + 128; V[y * (W / 2) + x] = 0.439 * r - 0.368 * g - 0.071 * b + 128; }
  frames.push(Buffer.from('FRAME\n'), Y, U, V);
}
void evalCamera;
writeFileSync(process.argv[2], Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F24:1 Ip A1:1 C420jpeg\n`), ...frames])); console.log('wrote', process.argv[2]);

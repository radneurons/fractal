/** Pure-TypeScript software rasterizer. No DOM, no GPU: byte-identical on every machine, runs in Node.
 *  Used for the reference/golden renders, MCP previews, Claude vision frames, IoU scoring, and as the
 *  export fallback when WebGL is unavailable. The pose pass is always drawn here (also for WebGL exports). */
import {
  compileFrame, evalCamera, unitMesh, terrainMesh, sunState, lightDir, hexToRgb, mMul, mCompose, mInvRigid, qRotate, GROUND_ID, clamp,
  type CamState, type FrameScene, type Mat4, type Project, type Quat, type Shot, type UnitMesh, type Vec3, type Skeleton,
} from '@blockout/core';
import { DEPTH_FAR, DEPTH_NEAR, flowMaxDisp, shotTime, type PassName, type PassRenderer } from './passes';

interface Obj { id: Vec3; entityId: string; ground: boolean }
export interface GBuffer { w: number; h: number; depth: Float32Array; obj: Int32Array; nrm: Float32Array; flow: Float32Array | null; fxObj: Int32Array; objs: Obj[] }
const NEAR = 0.05;

function viewOf(cam: CamState): Mat4 { return mInvRigid(mCompose(cam.pos, cam.quat)); }

export function rasterize(scene: FrameScene, cam: CamState, w: number, h: number, prev?: { scene: FrameScene; cam: CamState }): GBuffer {
  const n = w * h, depth = new Float32Array(n).fill(Infinity), obj = new Int32Array(n).fill(-1), nrm = new Float32Array(n * 3), flow = prev ? new Float32Array(n * 2) : null;
  const fxObj = new Int32Array(n).fill(-1), fxDepth = new Float32Array(n).fill(Infinity), objs: Obj[] = [];
  const V = viewOf(cam), Vp = prev ? viewOf(prev.cam) : V, f = 1 / Math.tan(cam.fovY / 2), fp = prev ? 1 / Math.tan(prev.cam.fovY / 2) : f, asp = cam.aspect;
  const prevMat = new Map<string, Mat4>(); if (prev) for (const d of prev.scene.drawables) prevMat.set(d.key, d.matrix);
  const vb: number[] = []; // per-vertex: view xyz, prev-view xyz
  const draw = (mesh: UnitMesh, model: Mat4 | null, modelPrev: Mat4 | null, oi: number, fx: boolean) => {
    const MV = model ? mMul(V, model) : V, MVp = modelPrev ? mMul(Vp, modelPrev) : model ? mMul(Vp, model) : Vp, P = mesh.pos, nv = P.length / 3;
    vb.length = nv * 6;
    for (let i = 0; i < nv; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      vb[i * 6] = MV[0] * x + MV[4] * y + MV[8] * z + MV[12]; vb[i * 6 + 1] = MV[1] * x + MV[5] * y + MV[9] * z + MV[13]; vb[i * 6 + 2] = MV[2] * x + MV[6] * y + MV[10] * z + MV[14];
      vb[i * 6 + 3] = MVp[0] * x + MVp[4] * y + MVp[8] * z + MVp[12]; vb[i * 6 + 4] = MVp[1] * x + MVp[5] * y + MVp[9] * z + MVp[13]; vb[i * 6 + 5] = MVp[2] * x + MVp[6] * y + MVp[10] * z + MVp[14];
    }
    const I = mesh.idx, dBuf = fx ? fxDepth : depth, oBuf = fx ? fxObj : obj;
    for (let t = 0; t < I.length; t += 3) {
      // near-plane clip (Sutherland–Hodgman) in view space, carrying prev-view attributes
      let poly: number[][] = [];
      for (let k = 0; k < 3; k++) { const b = I[t + k] * 6; poly.push([vb[b], vb[b + 1], vb[b + 2], vb[b + 3], vb[b + 4], vb[b + 5]]); }
      if (poly[0][2] > -NEAR && poly[1][2] > -NEAR && poly[2][2] > -NEAR) continue;
      if (poly[0][2] > -NEAR || poly[1][2] > -NEAR || poly[2][2] > -NEAR) {
        const out: number[][] = [];
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k], b = poly[(k + 1) % poly.length], ia = a[2] <= -NEAR, ib = b[2] <= -NEAR;
          if (ia) out.push(a);
          if (ia !== ib) { const s = (-NEAR - a[2]) / (b[2] - a[2]); out.push(a.map((v, q) => v + (b[q] - a[q]) * s)); }
        }
        poly = out; if (poly.length < 3) continue;
      }
      // face normal (view space), oriented toward the camera
      const p0 = poly[0], p1 = poly[1], p2 = poly[2];
      let nx = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]), ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]), nz = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
      const nl = Math.hypot(nx, ny, nz); if (nl < 1e-12) continue; nx /= nl; ny /= nl; nz /= nl;
      if (nx * p0[0] + ny * p0[1] + nz * p0[2] > 0) { nx = -nx; ny = -ny; nz = -nz; }
      for (let k = 1; k + 1 < poly.length; k++) {
        const A = poly[0], B = poly[k], C = poly[k + 1];
        const da = -A[2], db = -B[2], dc = -C[2];
        const ax = (0.5 + (A[0] * f) / asp / da / 2) * w, ay = (0.5 - (A[1] * f) / da / 2) * h, bx = (0.5 + (B[0] * f) / asp / db / 2) * w, by = (0.5 - (B[1] * f) / db / 2) * h, cx = (0.5 + (C[0] * f) / asp / dc / 2) * w, cy = (0.5 - (C[1] * f) / dc / 2) * h;
        const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); if (Math.abs(area) < 1e-9) continue;
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx))), y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
        const ia = 1 / da, ib = 1 / db, ic = 1 / dc, inv = 1 / area;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv, w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv, w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const iz = w0 * ia + w1 * ib + w2 * ic, z = 1 / iz, i = y * w + x;
          if (z >= dBuf[i] || (fx && z >= depth[i])) continue;
          dBuf[i] = z; oBuf[i] = oi;
          if (fx) continue;
          nrm[i * 3] = nx; nrm[i * 3 + 1] = ny; nrm[i * 3 + 2] = nz;
          if (flow) {
            const qx = (w0 * A[3] * ia + w1 * B[3] * ib + w2 * C[3] * ic) * z, qy = (w0 * A[4] * ia + w1 * B[4] * ib + w2 * C[4] * ic) * z, qz = -(w0 * A[5] * ia + w1 * B[5] * ib + w2 * C[5] * ic) * z;
            if (qz > NEAR) { flow[i * 2] = px - (0.5 + (qx * fp) / asp / qz / 2) * w; flow[i * 2 + 1] = py - (0.5 - (qy * fp) / qz / 2) * h; }
          }
        }
      }
    }
  };
  objs.push({ id: hexToRgb(GROUND_ID), entityId: 'ground', ground: true });
  draw(terrainMesh(scene.terrain), null, null, 0, false);
  const index = new Map<string, number>();
  const oiFor = (entityId: string, idColor: string) => { let i = index.get(entityId); if (i === undefined) { i = objs.length; objs.push({ id: hexToRgb(idColor), entityId, ground: false }); index.set(entityId, i); } return i; };
  for (const d of scene.drawables) if (d.layer !== 'fx') draw(unitMesh(d.kind), d.matrix, prevMat.get(d.key) ?? null, oiFor(d.entityId, d.idColor), false);
  for (const s of scene.instances) { const m = unitMesh(s.kind), oi = oiFor(s.entityId, s.idColor); for (const mat of s.matrices) draw(m, mat, null, oi, false); }
  for (const d of scene.drawables) if (d.layer === 'fx') draw(unitMesh(d.kind), d.matrix, null, oiFor(d.entityId, d.idColor), true);
  return { w, h, depth, obj, nrm, flow, fxObj, objs };
}

export function shade(g: GBuffer, pass: Exclude<PassName, 'pose'>, project: Project, cam: CamState): Uint8ClampedArray {
  const { w, h } = g, n = w * h, out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) out[i * 4 + 3] = 255;
  switch (pass) {
    case 'id': for (let i = 0; i < n; i++) { const o = g.obj[i]; if (o >= 0) { const c = g.objs[o].id; out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; } } break;
    case 'fx': for (let i = 0; i < n; i++) { const o = g.fxObj[i]; if (o >= 0) { const c = g.objs[o].id; out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; } } break;
    case 'depth': { const k = 1 / Math.log(DEPTH_FAR / DEPTH_NEAR); for (let i = 0; i < n; i++) { const z = g.depth[i]; const v = z === Infinity ? 0 : Math.round(255 * clamp(1 - Math.log(z / DEPTH_NEAR) * k)); out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; } break; }
    case 'depthMetric': for (let i = 0; i < n; i++) { const z = g.depth[i]; if (z === Infinity) continue; const mm = Math.min(16777215, Math.round(z * 1000)); out[i * 4] = mm >> 16; out[i * 4 + 1] = (mm >> 8) & 255; out[i * 4 + 2] = mm & 255; } break;
    case 'normals': for (let i = 0; i < n; i++) { if (g.obj[i] < 0) { out[i * 4] = 128; out[i * 4 + 1] = 128; out[i * 4 + 2] = 255; continue; } out[i * 4] = Math.round((g.nrm[i * 3] * 0.5 + 0.5) * 255); out[i * 4 + 1] = Math.round((g.nrm[i * 3 + 1] * 0.5 + 0.5) * 255); out[i * 4 + 2] = Math.round((g.nrm[i * 3 + 2] * 0.5 + 0.5) * 255); } break;
    case 'flow': { const m = flowMaxDisp(w), F = g.flow; for (let i = 0; i < n; i++) { if (g.obj[i] < 0 || !F) { out[i * 4] = 128; out[i * 4 + 1] = 128; continue; } out[i * 4] = Math.round(128 + 127 * clamp(F[i * 2] / m, -1, 1)); out[i * 4 + 1] = Math.round(128 + 127 * clamp(F[i * 2 + 1] / m, -1, 1)); out[i * 4 + 2] = 128; } break; }
    case 'canny': {
      const edge = new Uint8Array(n), r = Math.max(0, Math.round(h / 540) - 0);
      for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
        const i = y * w + x;
        for (const j of [i + 1, i + w]) {
          if (g.obj[i] !== g.obj[j]) { edge[i] = 1; break; }
          if (g.obj[i] < 0) continue;
          const za = g.depth[i], zb = g.depth[j];
          if (Math.abs(za - zb) / Math.min(za, zb) > 0.06 && !g.objs[g.obj[i]].ground) { edge[i] = 1; break; }
          if (g.nrm[i * 3] * g.nrm[j * 3] + g.nrm[i * 3 + 1] * g.nrm[j * 3 + 1] + g.nrm[i * 3 + 2] * g.nrm[j * 3 + 2] < 0.8 && !g.objs[g.obj[i]].ground) { edge[i] = 1; break; }
        }
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let e = 0; for (let dy = -r; dy <= r && !e; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && edge[yy * w + xx]) { e = 1; break; } }
        if (e) { const i = (y * w + x) * 4; out[i] = out[i + 1] = out[i + 2] = 255; }
      }
      break;
    }
    case 'clay': {
      const inv: Quat = [-cam.quat[0], -cam.quat[1], -cam.quat[2], cam.quat[3]], L = project.lighting, sun = sunState(L), sky = hexToRgb(L.skyColor);
      const lights: { d: Vec3; c: Vec3 }[] = [{ d: qRotate(inv, sun.dir), c: [sun.color[0] * sun.intensity, sun.color[1] * sun.intensity, sun.color[2] * sun.intensity] }];
      for (const k of ['key', 'fill', 'rim'] as const) { const l = L[k]; if (!l.on) continue; const c = hexToRgb(l.color); lights.push({ d: qRotate(inv, lightDir(l.azimuth, l.elevation)), c: [(c[0] / 255) * l.intensity, (c[1] / 255) * l.intensity, (c[2] / 255) * l.intensity] }); }
      const amb: Vec3 = [sun.ambient * (0.6 + 0.4 * sky[0] / 255), sun.ambient * (0.6 + 0.4 * sky[1] / 255), sun.ambient * (0.6 + 0.4 * sky[2] / 255)];
      for (let i = 0; i < n; i++) {
        const o = g.obj[i]; if (o < 0) { out[i * 4] = sky[0]; out[i * 4 + 1] = sky[1]; out[i * 4 + 2] = sky[2]; continue; }
        const alb = g.objs[o].ground ? 0.62 : 0.8, nx = g.nrm[i * 3], ny = g.nrm[i * 3 + 1], nz = g.nrm[i * 3 + 2]; let r = amb[0], gg = amb[1], b = amb[2];
        for (const l of lights) { const d = Math.max(0, nx * l.d[0] + ny * l.d[1] + nz * l.d[2]) * 0.75; r += d * l.c[0]; gg += d * l.c[1]; b += d * l.c[2]; }
        out[i * 4] = Math.round(255 * Math.min(1, alb * r)); out[i * 4 + 1] = Math.round(255 * Math.min(1, alb * gg)); out[i * 4 + 2] = Math.round(255 * Math.min(1, alb * b));
      }
      break;
    }
  }
  return out;
}

// ---------- pose (OpenPose-style) ----------
const LIMB_COLORS: Vec3[] = [[255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0], [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85]];
const LIMBS = [[1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17]];
const mp = (m: Mat4, v: Vec3): Vec3 => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
export interface PosePerson { id: string; name: string; body: Vec3[]; handL: Vec3[]; handR: Vec3[]; face: Vec3[] }
function rigPoints(sk: Skeleton): Omit<PosePerson, 'id' | 'name'> {
  const P = sk.pos, M = sk.mat, h = sk.scale, H = (x: number, y: number, z: number) => mp(M.head, [x * h, y * h, z * h]);
  const body: Vec3[] = [H(0, 0.1, 0.125), P.neck, P.upperArmR, P.foreArmR, P.handR, P.upperArmL, P.foreArmL, P.handL, P.upLegR, P.legR, P.footR, P.upLegL, P.legL, P.footL, H(-0.035, 0.135, 0.105), H(0.035, 0.135, 0.105), H(-0.1, 0.115, 0), H(0.1, 0.115, 0)];
  const hand = (m: Mat4, s: number): Vec3[] => { const pts: Vec3[] = [mp(m, [0, 0, 0])]; for (let f = 0; f < 5; f++) for (let j = 1; j <= 4; j++) pts.push(f === 0 ? mp(m, [s * (0.03 + j * 0.012) * h, (-0.03 - j * 0.012) * h, 0.02 * h]) : mp(m, [s * (f - 2.5) * -0.016 * h, (-0.05 - j * (0.02 - Math.abs(f - 2.5) * 0.002)) * h, 0.005 * h])); return pts; };
  const face: Vec3[] = []; for (let i = 0; i < 9; i++) { const a = (-0.5 + i / 8) * Math.PI; face.push(H(Math.sin(a) * 0.085, 0.1 - Math.cos(a) * 0.1, 0.07 + Math.cos(a) * 0.045)); }
  for (const s of [-1, 1]) face.push(H(s * 0.05, 0.135, 0.105), H(s * 0.02, 0.135, 0.11), H(s * 0.055, 0.16, 0.1), H(s * 0.02, 0.165, 0.11), H(s * 0.025, 0.055, 0.115));
  face.push(H(0, 0.1, 0.125), H(0, 0.08, 0.12));
  return { body, handL: hand(M.handL, 1), handR: hand(M.handR, -1), face };
}
function toScreen(cam: CamState, V: Mat4, p: Vec3, w: number, h: number): Vec3 { const v = mp(V, p), d = -v[2], f = 1 / Math.tan(cam.fovY / 2); return d <= NEAR ? [0, 0, 0] : [(0.5 + (v[0] * f) / cam.aspect / d / 2) * w, (0.5 - (v[1] * f) / d / 2) * h, 1]; }
/** 2D keypoints (pixels, confidence) per character: the data behind the pose pass, exported as OpenPose-style JSON. */
export function poseKeypoints(project: Project, scene: FrameScene, cam: CamState, w: number, h: number): PosePerson[] {
  const V = viewOf(cam);
  return Object.keys(scene.skeletons).sort().map((id) => { const r = rigPoints(scene.skeletons[id]), S = (a: Vec3[]) => a.map((p) => toScreen(cam, V, p, w, h)); return { id, name: project.characters[id]?.name ?? id, body: S(r.body), handL: S(r.handL), handR: S(r.handR), face: S(r.face) }; });
}
function disc(o: Uint8ClampedArray, w: number, h: number, x: number, y: number, r: number, c: Vec3) { for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(h - 1, Math.ceil(y + r)); yy++) for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(w - 1, Math.ceil(x + r)); xx++) if ((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= r * r) { const i = (yy * w + xx) * 4; o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2]; } }
function line(o: Uint8ClampedArray, w: number, h: number, a: Vec3, b: Vec3, r: number, c: Vec3) {
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r)), x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0]) + r)), y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r)), y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1]) + r));
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const t = clamp(((x + 0.5 - a[0]) * dx + (y + 0.5 - a[1]) * dy) / l2), ex = a[0] + t * dx - x - 0.5, ey = a[1] + t * dy - y - 0.5; if (ex * ex + ey * ey <= r * r) { const i = (y * w + x) * 4; o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2]; } }
}
export function drawPose(people: PosePerson[], w: number, h: number): Uint8ClampedArray {
  const o = new Uint8ClampedArray(w * h * 4); for (let i = 3; i < o.length; i += 4) o[i] = 255;
  const r = Math.max(1, h / 135), dim = (c: Vec3): Vec3 => [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6];
  for (const p of people) {
    LIMBS.forEach(([a, b], i) => { if (p.body[a][2] && p.body[b][2]) line(o, w, h, p.body[a], p.body[b], r, dim(LIMB_COLORS[i])); });
    p.body.forEach((k, i) => { if (k[2]) disc(o, w, h, k[0], k[1], r * 1.15, LIMB_COLORS[i]); });
    for (const hand of [p.handL, p.handR]) for (let f = 0; f < 5; f++) { let prev = hand[0]; for (let j = 1; j <= 4; j++) { const k = hand[1 + f * 4 + j - 1], hue = (f * 4 + j) / 20, c: Vec3 = [255 * clamp(Math.abs(hue * 6 - 3) - 1), 255 * clamp(2 - Math.abs(hue * 6 - 2)), 255 * clamp(2 - Math.abs(hue * 6 - 4))]; if (prev[2] && k[2]) { line(o, w, h, prev, k, r * 0.35, c); disc(o, w, h, k[0], k[1], r * 0.5, [0, 0, 255]); } prev = k; } }
    for (const k of p.face) if (k[2]) disc(o, w, h, k[0], k[1], Math.max(0.8, r * 0.3), [255, 255, 255]);
  }
  return o;
}
export function openPoseJSON(people: PosePerson[], w: number, h: number) {
  const flat = (a: Vec3[]) => a.flatMap((k) => [Math.round(k[0] * 100) / 100, Math.round(k[1] * 100) / 100, k[2]]);
  return { canvas_width: w, canvas_height: h, people: people.map((p) => ({ person_id: p.id, name: p.name, pose_keypoints_2d: flat(p.body), hand_left_keypoints_2d: flat(p.handL), hand_right_keypoints_2d: flat(p.handR), face_keypoints_2d: flat(p.face) })) };
}

// ---------- renderer ----------
let cache: { key: string; project: Project; g: GBuffer; scene: FrameScene } | null = null;
export function renderSoftAt(project: Project, t: number, cam: CamState, pass: PassName, w: number, h: number, prev?: { t: number; cam: CamState }): Uint8ClampedArray {
  const key = `${t}|${w}|${h}|${cam.pos}|${cam.quat}|${cam.fovY}|${pass === 'flow' ? 'f' : ''}`;
  if (!cache || cache.project !== project || cache.key !== key) { const scene = compileFrame(project, t); cache = { key, project, scene, g: rasterize(scene, cam, w, h, pass === 'flow' && prev ? { scene: compileFrame(project, prev.t), cam: prev.cam } : undefined) }; }
  if (pass === 'pose') return drawPose(poseKeypoints(project, cache.scene, cam, w, h), w, h);
  return shade(cache.g, pass, project, cam);
}
export const softRenderer: PassRenderer = {
  kind: 'soft', info: 'blockout-soft/1 (pure TypeScript rasterizer)',
  render(project: Project, shot: Shot, frame: number, pass: PassName, w: number, h: number) {
    const c = project.cameras[shot.cameraId], t = shotTime(project, shot, frame), tp = shotTime(project, shot, Math.max(0, frame - 1));
    return renderSoftAt(project, t, evalCamera(project, c, t), pass, w, h, { t: tp, cam: evalCamera(project, c, tp) });
  },
};

// MONOLITH — words as architecture (SPEC §8.12). GPU raymarching.
// Words rise out of the ground as extruded stone slabs: d3 = round(max(d2, |z| − depth/2), bevel), with d2 read from
// a shared 2D SDF atlas. A sun crosses the sky over the song; soft shadows (k = 8), 5-sample AO, height fog.
// Each line gets a seeded shot (orbit, dolly-in, crane-up, low hero angle, top-down) cut on a downbeat; drops fly
// low through a canyon of the line's words. Preview marches at half resolution; export at full. No temporal accumulation.
// Reduce motion calms: orbit and crane moves (slower, smaller), the canyon fly-through (becomes a static avenue view).
import type { Target } from '../render/glhost.ts';
import { GLEffect, type EffectContext, type EffectMeta, range, toggle, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { FS_HEAD, GLSL_NOISE } from '../render/gl.ts';
import { makeSDF, ShelfPacker } from '../render/sdf.ts';
import { cleanDisplay, clamp01, easeOutBack, smooth, subtitle, lineAt } from '../render/textkit.ts';
import { hash01, lowerBound, sample } from '../analysis/dsp.ts';
import { norm, cross } from '../render/mat4.ts';
import type { Word } from '../types.ts';

const MAXW = 16;
const CAPPX = 64, SPREAD = 12;

const FS = FS_HEAD + GLSL_NOISE + `
uniform sampler2D uAtlas; uniform vec2 uAtlasSize, uRes;
uniform vec3 uEye, uFwd, uRight, uUp, uSun, uSky0, uSky1, uSunCol;
uniform float uFov, uT, uNight, uFog, uAO, uMat, uDepth, uTransparent, uFar;
uniform int uN;
uniform vec4 uPos[${MAXW}];    // x, y (rise), z, yaw
uniform vec4 uRect[${MAXW}];   // atlas rect px: x, y, w, h
uniform vec4 uOrg[${MAXW}];    // origin ox, oy (px in rect), scale (world size of 1 cap), glow
float d2(int i, vec2 q){ // q in cap units, y up, origin on the baseline-left
  vec4 r = uRect[i], g = uOrg[i];
  vec2 px = vec2(g.x + q.x * ${CAPPX}.0, g.y - q.y * ${CAPPX}.0);
  vec2 lo = vec2(1.0), hi = r.zw - 1.0;
  vec2 cl = clamp(px, lo, hi);
  float v = texture(uAtlas, (r.xy + cl) / uAtlasSize).r;
  float d = -(v * 255.0 - 128.0) / 127.0 * ${SPREAD}.0;
  float outside = length(px - cl);
  return (outside > 0.0 ? max(d, ${SPREAD}.0 * 0.5) + outside : d) / ${CAPPX}.0;
}
vec3 toLocal(int i, vec3 p){ vec4 P = uPos[i]; vec3 q = p - P.xyz; float c = cos(P.w), s = sin(P.w); return vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z) / uOrg[i].z; }
float word(int i, vec3 p){
  vec3 q = toLocal(i, p);
  float a = d2(i, q.xy), b = abs(q.z) - uDepth * 0.5;
  vec2 w = vec2(a, b);
  float bevel = 0.03;
  return (min(max(w.x, w.y), 0.0) + length(max(w + bevel, 0.0)) - bevel) * uOrg[i].z;
}
// ray / word box intersection (local box: x in [-0.2, w+0.2], y in [-0.4, 1.4], z ±depth)
vec2 box(int i, vec3 ro, vec3 rd){
  vec3 o = toLocal(i, ro); vec4 P = uPos[i]; float c = cos(P.w), s = sin(P.w);
  vec3 d = vec3(c * rd.x + s * rd.z, rd.y, -s * rd.x + c * rd.z) / uOrg[i].z;
  vec3 lo = vec3(-0.5, -0.5, -uDepth), hi = vec3(uRect[i].z / ${CAPPX}.0 + 0.2, 1.5, uDepth);
  vec3 inv = 1.0 / (d + 1e-6 * sign(d) + 1e-9);
  vec3 t0 = (lo - o) * inv, t1 = (hi - o) * inv;
  vec3 tmn = min(t0, t1), tmx = max(t0, t1);
  return vec2(max(max(tmn.x, tmn.y), tmn.z), min(min(tmx.x, tmx.y), tmx.z));
}
int gMask = 0;
float scene(vec3 p, out int id){
  float d = 1e9; id = -1;
  for(int i=0;i<${MAXW};i++){ if(i >= uN) break; if((gMask & (1 << i)) == 0) continue; float w = word(i, p); if(w < d){ d = w; id = i; } }
  return d;
}
float sceneD(vec3 p){ int id; return scene(p, id); }
vec3 normalAt(vec3 p){ vec2 e = vec2(0.003, -0.003); return normalize(e.xyy * sceneD(p + e.xyy) + e.yyx * sceneD(p + e.yyx) + e.yxy * sceneD(p + e.yxy) + e.xxx * sceneD(p + e.xxx)); }
vec3 sky(vec3 rd){
  float h = clamp(rd.y, -0.2, 1.0);
  vec3 c = mix(uSky0, uSky1, smoothstep(-0.05, 0.6, h));
  float sd = max(dot(rd, uSun), 0.0);
  c += uSunCol * (pow(sd, 600.0) * 6.0 + pow(sd, 12.0) * 0.35);
  if(uNight > 0.5) c += step(0.996, hash21(floor(rd.xz / max(rd.y, 0.05) * 140.0))) * 0.5 * smoothstep(0.05, 0.3, rd.y);
  return c;
}
float shadow(vec3 ro, vec3 rd){
  float res = 1.0, t = 0.04;
  int saved = gMask; gMask = 0;
  for(int i=0;i<${MAXW};i++){ if(i >= uN) break; vec2 b = box(i, ro, rd); if(b.y > max(b.x, 0.0)) gMask |= (1 << i); }
  if(gMask == 0){ gMask = saved; return 1.0; }
  for(int k=0;k<28;k++){ float h = sceneD(ro + rd * t); res = min(res, 8.0 * h / t); t += clamp(h, 0.03, 0.6); if(res < 0.02 || t > 30.0) break; }
  gMask = saved;
  return clamp(res, 0.0, 1.0);
}
float ao(vec3 p, vec3 n){ float o = 0.0, s = 1.0; for(int i=1;i<=5;i++){ float h = 0.06 * float(i); o += (h - sceneD(p + n * h)) * s; s *= 0.6; } return clamp(1.0 - 2.4 * o * uAO, 0.0, 1.0); }
vec3 material(int id, vec3 p, vec3 n, vec3 rd, float glow){
  vec3 q = toLocal(id, p);
  vec3 base; float spec = 0.1; vec3 emit = vec3(0.0);
  if(uMat < 0.5){ base = vec3(0.62, 0.6, 0.57) * (0.85 + 0.15 * vnoise(q.xy * vec2(2.0, 40.0))) - 0.05 * step(0.92, fract(q.y * 3.2)); }                // board-form concrete
  else if(uMat < 1.5){ float v = fbm(q.xy * 2.2 + q.z); base = mix(vec3(0.93, 0.92, 0.9), vec3(0.55, 0.56, 0.6), smoothstep(0.48, 0.52, v) * 0.6 + 0.2 * smoothstep(0.6, 0.62, fbm(q.xy * 5.0))); spec = 0.6; } // marble
  else if(uMat < 2.5){ base = vec3(0.04, 0.035, 0.05); spec = 0.8; float seam = smoothstep(0.02, 0.0, abs(fbm(q.xy * 3.0 + q.z) - 0.5)); emit = vec3(1.0, 0.42, 0.08) * seam * 2.2; } // obsidian
  else { base = vec3(0.78, 0.6, 0.42) * (0.85 + 0.15 * sin(q.y * 24.0 + fbm(q.xy * 3.0) * 4.0)); }                                                    // sandstone
  emit += vec3(1.0, 0.85, 0.6) * glow * 1.4 * smoothstep(0.2, 1.0, 1.0 - abs(dot(n, -rd)));                                                   // rim glow on the onset
  return base + emit * 0.0 + vec3(spec) * 0.0 + emit;
}
void main(){
  vec2 uv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec3 rd = normalize(uFwd + (uv.x * uRight + uv.y * uUp) * tan(uFov * 0.5) * 2.0);
  vec3 ro = uEye;
  // candidate words: those whose boxes the ray crosses
  float tmin = 1e9, tmax = 0.0; gMask = 0;
  for(int i=0;i<${MAXW};i++){ if(i >= uN) break; vec2 b = box(i, ro, rd); if(b.y > max(b.x, 0.0)){ gMask |= (1 << i); tmin = min(tmin, max(b.x, 0.0)); tmax = max(tmax, b.y); } }
  float tg = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
  float t = tmin; int id = -1; bool hit = false;
  if(gMask != 0){
    for(int k=0;k<64;k++){ vec3 p = ro + rd * t; float d = scene(p, id); if(d < 0.0015 * t){ hit = true; break; } t += d * 0.92; if(t > tmax || t > tg) break; }
  }
  vec3 col; float depth = uFar;
  vec3 sunCol = uSunCol;
  float fogK = uFog * 0.012;
  if(hit && t < tg){
    vec3 p = ro + rd * t; vec3 n = normalAt(p);
    vec3 base = material(id, p, n, rd, uOrg[id].w);
    float dif = max(dot(n, uSun), 0.0) * shadow(p + n * 0.01, uSun);
    float occ = ao(p, n);
    vec3 amb = mix(uSky0, uSky1, 0.5 + 0.5 * n.y) * 0.55;
    col = base * (amb * occ * 0.8 + sunCol * dif * 1.6);
    if(uMat > 0.5 && uMat < 2.5){ vec3 r = reflect(rd, n); float fr = 0.04 + 0.96 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0); col = mix(col, sky(r), fr * (uMat < 1.5 ? 0.55 : 0.85)); }
    if(uMat > 1.5 && uMat < 2.5) col += material(id, p, n, rd, 0.0) * 0.0 + (base - vec3(0.04, 0.035, 0.05)) * 0.0;
    depth = t;
  } else if(tg < 1e8){
    vec3 p = ro + rd * tg;
    vec2 g = p.xz;
    vec3 base = mix(vec3(0.32, 0.29, 0.25), vec3(0.4, 0.36, 0.3), fbm(g * 0.35)) * (0.9 + 0.1 * vnoise(g * 6.0));
    if(uMat > 1.5 && uMat < 2.5) base *= 0.35;
    float sh = shadow(p + vec3(0.0, 0.01, 0.0), uSun);
    // contact occlusion near the slabs
    float occ = clamp(0.35 + sceneD(p + vec3(0.0, 0.05, 0.0)) * 2.5, 0.35, 1.0);
    col = base * (mix(uSky0, uSky1, 0.7) * 0.45 * occ + sunCol * max(uSun.y, 0.0) * 1.2 * sh);
    depth = tg;
  } else col = sky(rd);
  // exponential height fog
  if(depth < uFar){ float f = 1.0 - exp(-depth * fogK * exp(-max(ro.y, 0.0) * 0.08)); col = mix(col, mix(uSky0, uSky1, 0.4) * 1.05, clamp(f, 0.0, 1.0)); }
  col = col / (1.0 + col * 0.35);
  col = pow(col, vec3(0.92));
  o = vec4(col, uTransparent > 0.5 ? (depth < uFar ? 1.0 : 0.0) : clamp(depth / uFar, 0.0, 1.0) * 0.0 + 1.0);
  o.a = uTransparent > 0.5 ? o.a : 1.0;
  // depth goes into a separate target pass (see FS_DEPTH)
}`;
const FS_UP = FS_HEAD + `uniform sampler2D uTex; uniform float uFocus, uDof; void main(){ o = texture(uTex, vUv); }`;
const FS_MASK = FS_HEAD + `uniform sampler2D uTex; void main(){ vec4 c = texture(uTex, vUv); float m = step(0.5, c.a); o = vec4(vec3(m), 1.0); }`;

type Shot = 'orbit' | 'dolly-in' | 'crane-up' | 'low' | 'top-down' | 'canyon';
interface MW { w: Word; rect: [number, number, number, number]; ox: number; oy: number; width: number; x: number; z: number; yaw: number; scale: number; hero: boolean }
interface ML { words: MW[]; cx: number; cz: number; width: number; start: number; end: number; shot: Shot; cut: number; seed: number; canyon: boolean; mat: number }

export class Monolith extends GLEffect {
  static meta: EffectMeta = {
    id: 'monolith', name: 'Monolith', kind: 'gl',
    description: 'Words rise from the ground as huge stone slabs in an empty landscape, lit by a sun that crosses the sky over the song.',
    affinity: aff(0.7, 0.65, 0.5, 0.25, 0.85, 0.6, 0.6, 0.4),
    supportsTransparent: false,
    params: [
      select('material', 'Materials', 'Look', 'by section', ['by section', 'concrete', 'marble', 'obsidian'], true),
      range('depth', 'Extrusion depth', 'Look', 0.35, 0.1, 1, 0.01),
      select('sun', 'Sun path', 'Light', 'song', ['song', 'fixed noon', 'night with moon']),
      range('fog', 'Fog', 'Light', 1, 0, 3, 0.01),
      select('shots', 'Shot style', 'Camera', 'cinematic', ['cinematic', 'static', 'orbit'], false),
      toggle('cut', 'Cut on downbeats', 'Camera', true, false),
      range('ao', 'AO quality', 'Light', 1, 0, 1.5, 0.01),
      toggle('halfRes', 'Half-res preview', 'Quality', true, false),
    ],
  };
  readonly meta = Monolith.meta;
  private lines: ML[] = [];
  private atlas: WebGLTexture | null = null;
  private atlasSize: [number, number] = [2048, 2048];
  private rt: Target | null = null;

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const gl = this.scope.gl, ly = this.ly, a = this.a, { W, H } = this;
    // SDF atlas of every word
    const pack = new ShelfPacker(2048);
    const items: { data: Uint8Array; w: number; h: number; x: number; y: number }[] = [];
    const lines: ML[] = [];
    const shots: Shot[] = this.str('shots') === 'static' ? ['dolly-in'] : this.str('shots') === 'orbit' ? ['orbit'] : ['orbit', 'dolly-in', 'crane-up', 'low', 'top-down'];
    const bar = a.downbeats.length > 1 ? (a.downbeats[a.downbeats.length - 1] - a.downbeats[0]) / (a.downbeats.length - 1) : 2;
    ly.lines.forEach((line, li) => {
      const ws = line.words.map((i) => ly.words[i]).filter((w) => !w.backing);
      const sec = a.sections[line.section];
      const canyon = !this.s.reduceMotion && a.drops.some((d) => line.start >= d - 0.5 && line.start < d + 8 * bar);
      const mws: MW[] = [];
      let x = 0;
      for (const w of ws) {
        const hero = w.role === 'hero';
        const text = cleanDisplay(w, 'upper');
        const sdf = makeSDF(text, hero ? 'oswald' : 'bebas', CAPPX, SPREAD);
        const pos = pack.add(sdf.w + 2, sdf.h + 2);
        items.push({ data: sdf.data, w: sdf.w, h: sdf.h, x: pos.x, y: pos.y });
        const scale = hero ? 1.25 : w.role === 'connective' ? 0.55 : 0.85;
        const width = (sdf.w / CAPPX) * scale;
        mws.push({ w, rect: [pos.x, pos.y, sdf.w, sdf.h], ox: sdf.ox, oy: sdf.oy, width, x, z: 0, yaw: 0, scale, hero });
        x += width - (2 * SPREAD / CAPPX) * scale + 0.3;
      }
      const width = Math.max(1, x - 0.3);
      const cz = 0, cx = li * 60;                              // lines stand far apart sideways
      if (canyon) { // words placed along both sides of an avenue, facing inward
        mws.forEach((m, i) => { const side = i % 2 ? 1 : -1; m.yaw = side * Math.PI / 2; m.x = cx + side * 1.45; m.z = cz - i * 2.4 + (side < 0 ? 0 : m.width) * 0; });
      } else for (const m of mws) { m.x = cx + m.x - width / 2; m.z = cz; }
      const dbi = lowerBound(a.downbeats, line.start + 0.01) - 1;
      const db = dbi >= 0 ? a.downbeats[dbi] : -1;
      const cutT = this.bool('cut') && db >= line.start - 1.0 ? db : line.start - 0.6;
      const seed = Math.floor(hash01(li, this.seed, 4) * 1e6);
      const label = sec?.label;
      const mat = label === 'chorus' ? 1 : label === 'drop' ? 2 : label === 'bridge' ? 3 : 0;
      lines.push({ words: mws, cx, cz, width, start: line.start, end: line.end, shot: canyon ? 'canyon' : shots[Math.floor(hash01(seed, 1) * shots.length)], cut: Math.min(cutT, line.start - 0.35), seed, canyon, mat });
    });
    this.lines = lines;
    const ah = Math.max(16, Math.min(this.scope.host.maxTex, 1 << Math.ceil(Math.log2(pack.height + 2))));
    const buf = new Uint8Array(2048 * ah);
    for (const it of items) for (let y = 0; y < it.h && it.y + y < ah; y++) buf.set(it.data.subarray(y * it.w, (y + 1) * it.w), (it.y + y) * 2048 + it.x);
    this.atlas = this.scope.texture({ w: 2048, h: ah, internal: gl.R8, format: gl.RED, data: buf });
    this.atlasSize = [2048, ah];
    const half = this.bool('halfRes') && ctx.quality !== 'export';
    this.rt = this.scope.target(half ? Math.max(2, W >> 1) : W, half ? Math.max(2, H >> 1) : H);
  }

  /** The active line, the previous (sinking) and the next (rising) line's words, as uniforms. */
  private scene(t: number): { pos: Float32Array; rect: Float32Array; org: Float32Array; n: number; line: ML | undefined } {
    const antic = this.s.anticipationMs / 1000;
    const pos = new Float32Array(MAXW * 4), rect = new Float32Array(MAXW * 4), org = new Float32Array(MAXW * 4);
    let n = 0;
    let li = -1;
    for (let i = 0; i < this.lines.length; i++) if (this.lines[i].cut <= t) li = i;
    const line = this.lines[Math.max(0, li)];
    for (const L of [this.lines[li - 1], this.lines[li], this.lines[li + 1]]) {
      if (!L) continue;
      for (const m of L.words) {
        if (n >= MAXW) break;
        const land = m.w.start - antic;
        // rising: fully up at the onset (back-ease); sinking 1.5 s after the line ends
        const r0 = Math.max(L.cut, land - 0.9);
        const up = easeOutBack(clamp01((t - r0) / Math.max(0.2, land - r0)));
        const down = smooth(clamp01((t - (L.end + 1.5)) / 1.2));
        const h = Math.max(0, up * (1 - down));
        if (h <= 0.001) continue;
        const sizeY = m.scale * 1.4;
        pos.set([m.x, -sizeY * (1 - h), m.z, m.yaw], n * 4);
        rect.set(m.rect, n * 4);
        const glow = m.hero && t >= land ? Math.exp(-(t - land) / 0.25) * clamp01(1 - (t - land) / 0.6) : 0;
        org.set([m.ox, m.oy, m.scale, glow * this.flash(t)], n * 4);
        n++;
      }
    }
    return { pos, rect, org, n, line };
  }

  private camera(t: number, L: ML | undefined): { eye: number[]; at: number[]; fov: number } {
    const { W, H } = this;
    if (!L) return { eye: [0, 1.5, 10], at: [0, 0.6, 0], fov: 0.7 };
    const u = clamp01((t - L.cut) / Math.max(1, L.end + 1.5 - L.cut));
    const rm = this.s.reduceMotion ? 0.35 : 1;
    const fovOf = (mm: number) => 2 * Math.atan(12 / mm);
    if (L.shot === 'canyon') {
      const zs = L.words.map((m) => m.z);
      const z0 = Math.max(...zs) + 9, z1 = Math.min(...zs) + 5;
      const z = z0 + (z1 - z0) * smooth(u) * rm;
      return { eye: [L.cx, 0.7, z], at: [L.cx, 0.95, z - 7], fov: fovOf(30) };
    }
    // follow the sung word along the line: its centre, eased over 0.45 s from the previous one
    const antic = this.s.anticipationMs / 1000;
    const order = L.words.slice().sort((p, q) => p.w.start - q.w.start);
    let fx = order.length ? order[0].x + order[0].width / 2 : L.cx;
    for (let i = 0; i < order.length; i++) {
      const m = order[i], land = m.w.start - antic;
      if (t < land - 0.45) break;
      const k = smooth(clamp01((t - (land - 0.45)) / 0.45));
      fx = fx + (m.x + m.width / 2 - fx) * k;
    }
    const lo = Math.min(...L.words.map((m) => m.x)), hi = Math.max(...L.words.map((m) => m.x + m.width));
    const frameW = Math.min(hi - lo + 1, Math.max(L.width * 0.55, 6));
    fx = Math.max(lo + frameW / 2 - 0.5, Math.min(hi - frameW / 2 + 0.5, fx));
    const c = [fx, 0.6, L.cz];
    const fov = fovOf(L.shot === 'low' ? 35 : L.shot === 'crane-up' ? 40 : L.shot === 'top-down' ? 45 : L.shot === 'orbit' ? 50 : 55);
    const D = (frameW / 2) / (Math.tan(fov / 2) * (W / H)) * 1.05 + 1.0;
    let eye: number[], at = c;
    switch (L.shot) {
      case 'orbit': { const ang = (-0.3 + 0.6 * u) * rm * (hash01(L.seed, 2) < 0.5 ? 1 : -1); eye = [c[0] + Math.sin(ang) * D, 0.95, c[2] + Math.cos(ang) * D]; break; }
      case 'dolly-in': eye = [c[0], 0.85 - 0.2 * u, c[2] + D * (1.25 - 0.28 * u * rm)]; break;
      case 'crane-up': eye = [c[0], 0.35 + 1.7 * smooth(u) * rm, c[2] + D * 1.05]; break;
      case 'low': eye = [c[0], 0.2, c[2] + D * 0.9]; at = [c[0], 0.75, c[2]]; break;
      default: eye = [c[0], D * 0.72, c[2] + D * 0.78]; at = [c[0], 0.35, c[2]]; break;   // a high three-quarter angle (straight down would hide the faces)
    }
    // never inside a slab: keep the eye above or in front of every word box
    for (const m of L.words) if (Math.abs(eye[2] - m.z) < 0.6 && eye[0] > m.x - 0.3 && eye[0] < m.x + m.width + 0.3 && eye[1] < m.scale * 1.5) eye[2] = m.z + 0.8;
    return { eye, at, fov };
  }

  protected drawGL(t: number, target: Target, mask: boolean): void {
    const { W, H } = this, a = this.a;
    const sc = this.scene(t);
    const cam = this.camera(t, sc.line);
    const fwd = norm([cam.at[0] - cam.eye[0], cam.at[1] - cam.eye[1], cam.at[2] - cam.eye[2]]);
    const right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
    // the sun: dawn → noon → dusk across the song
    const mode = this.str('sun');
    const u = mode === 'fixed noon' ? 0.5 : clamp01(t / Math.max(1, a.duration));
    const night = mode === 'night with moon';
    const el = night ? 0.55 : Math.sin(Math.PI * (0.06 + 0.88 * u)) * 1.0;
    const az = -1.2 + 2.4 * u;
    const sun = norm([Math.sin(az) * Math.cos(el), Math.max(0.05, Math.sin(el) * 0.9), -Math.cos(az) * Math.cos(el) * 0.6 - 0.4]);
    const warm = 1 - clamp01(sun[1] * 1.6);
    const sky0 = night ? [0.05, 0.07, 0.14] : [0.62 + 0.3 * warm, 0.6 - 0.05 * warm, 0.62 - 0.35 * warm];
    const sky1 = night ? [0.01, 0.015, 0.04] : [0.22 + 0.15 * warm, 0.38 - 0.12 * warm, 0.68 - 0.3 * warm];
    const sunCol = night ? [0.35, 0.42, 0.6] : [1.2, 1.0 - 0.3 * warm, 0.82 - 0.5 * warm];
    const matSel = this.str('material');
    const mat = matSel === 'concrete' ? 0 : matSel === 'marble' ? 1 : matSel === 'obsidian' ? 2 : sc.line?.mat ?? 0;
    const prog = this.scope.program(FS);
    const rt = this.rt!;
    this.scope.host.bind(rt);
    const gl = this.scope.gl;
    gl.useProgram(prog.program);
    gl.uniform4fv(prog.uniforms.get('uPos') ?? null, sc.pos);
    gl.uniform4fv(prog.uniforms.get('uRect') ?? null, sc.rect);
    gl.uniform4fv(prog.uniforms.get('uOrg') ?? null, sc.org);
    gl.uniform1i(prog.uniforms.get('uN') ?? null, sc.n);
    this.scope.pass(prog, rt, {
      uAtlas: this.atlas!, uAtlasSize: this.atlasSize, uRes: [rt.w, rt.h], uEye: cam.eye, uFwd: fwd, uRight: right, uUp: up, uSun: sun,
      uSky0: sky0, uSky1: sky1, uSunCol: sunCol, uFov: cam.fov, uT: t, uNight: night ? 1 : 0, uFog: this.num('fog'), uAO: this.num('ao'),
      uMat: mat, uDepth: this.num('depth'), uTransparent: mask ? 1 : 0, uFar: 80,
    });
    if (mask) { this.scope.pass(this.scope.program(FS_MASK), target, { uTex: rt.tex }); return; }
    this.scope.pass(this.scope.program(FS_UP), target, { uTex: rt.tex, uFocus: 0, uDof: 0 });
    if (this.s.showTranslation !== 'off') {
      const ov = this.layer('sub');
      ov.g.clearRect(0, 0, W, H);
      subtitle(ov.g, this.ly.lines[lineAt(this.ly, t)], t, this.s, W, H, '#fff');
      this.scope.pass(this.scope.program(FS_HEAD + `uniform sampler2D uTex; void main(){ o = texture(uTex, vUv); }`), target, { uTex: this.scope.upload('sub', ov.c as HTMLCanvasElement) }, { blend: 'alpha' });
    }
    void sample;
  }
}
registerEffect(Monolith);

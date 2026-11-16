// Layer compositor (SPEC §9.1): premultiplied-alpha blend formulas written in the shader, so preview
// and export match exactly. Runs in the shared GL context.
import type { BlendMode, LayerMask, TransitionKind } from '../types.ts';
import { BLEND_MODES } from '../types.ts';
import type { GLHost, GLScope, Target } from '../render/glhost.ts';
import { FS_HEAD, GLSL_NOISE } from '../render/gl.ts';
import type { Frame } from '../effects/types.ts';

const FS_COPY = FS_HEAD + `uniform sampler2D uTex; uniform float uOpaque; uniform vec4 uBg;
void main(){ vec4 c = texture(uTex, vUv); if(uOpaque > 0.5){ c = vec4(c.rgb + uBg.rgb * (1.0 - c.a), 1.0); } o = c; }`;

const FS_BLEND = FS_HEAD + `
uniform sampler2D uDst, uSrc, uMask;
uniform float uOpacity; uniform int uMode; uniform int uMaskMode;
vec3 lum3 = vec3(0.2126, 0.7152, 0.0722);
vec3 softLight(vec3 s, vec3 d){
  vec3 g = mix(((16.0*d - 12.0)*d + 4.0)*d, sqrt(d), step(0.25, d));
  return mix(d - (1.0 - 2.0*s)*d*(1.0 - d), d + (2.0*s - 1.0)*(g - d), step(0.5, s));
}
vec3 blendFn(vec3 s, vec3 d){
  if(uMode == 1) return s + d - s*d;                                   // screen
  if(uMode == 2) return min(vec3(1.0), s + d);                         // add
  if(uMode == 3) return s * d;                                         // multiply
  if(uMode == 4) return mix(2.0*s*d, 1.0 - 2.0*(1.0-s)*(1.0-d), step(0.5, d)); // overlay
  if(uMode == 5) return softLight(s, d);                               // soft light
  if(uMode == 6) return abs(s - d);                                    // difference
  if(uMode == 7) return min(vec3(1.0), d / max(vec3(1e-4), 1.0 - s));  // colour dodge
  if(uMode == 8) { float dl = dot(d, lum3), sl = dot(s, lum3); vec3 c = d + (sl - dl);    // luminosity
    float l = dot(c, lum3), n = min(c.r, min(c.g, c.b)), x = max(c.r, max(c.g, c.b));
    if(n < 0.0) c = l + (c - l) * l / max(1e-5, l - n);
    if(x > 1.0) c = l + (c - l) * (1.0 - l) / max(1e-5, x - l);
    return c; }
  return s;                                                             // normal
}
void main(){
  vec4 D = texture(uDst, vUv), S = texture(uSrc, vUv);
  float m = 1.0;
  if(uMaskMode > 0){
    vec4 M = texture(uMask, vUv);
    float w = uMaskMode <= 2 ? M.r : dot(M.rgb, lum3);
    m = (uMaskMode == 2 || uMaskMode == 4) ? 1.0 - w : w;
  }
  S *= uOpacity * m;
  vec3 s = S.a > 1e-5 ? S.rgb / S.a : vec3(0.0);
  vec3 d = D.a > 1e-5 ? D.rgb / D.a : vec3(0.0);
  vec3 c = S.rgb * (1.0 - D.a) + D.rgb * (1.0 - S.a) + S.a * D.a * blendFn(s, d);
  if(uMode == 2) c = D.rgb + S.rgb;   // additive light is not occluded by coverage
  float a = S.a + D.a - S.a * D.a;
  o = vec4(c, a);
}`;

const FS_TRANS = FS_HEAD + GLSL_NOISE + `
uniform sampler2D uA, uB, uMaskA;
uniform float uU, uSeed, uFlash, uAspect; uniform int uKind;
uniform vec2 uCa, uCb; uniform float uSa;
void main(){
  vec2 uv = vUv;
  vec4 A = texture(uA, uv), B = texture(uB, uv);
  if(uKind == 1){ // white flash, quadratic falloff
    float f = (1.0 - uU) * (1.0 - uU) * uFlash;
    o = vec4(mix(B.rgb, vec3(1.0), f), max(B.a, f)); return; }
  if(uKind == 2){ // ink wipe: ragged diagonal edge
    float d = (uv.x * uAspect + (1.0 - uv.y)) / (uAspect + 1.0);
    float n = fbm(uv * vec2(uAspect, 1.0) * 5.0 + uSeed) * 0.22 + vnoise(uv * vec2(uAspect, 1.0) * 60.0) * 0.03;
    float e = smoothstep(0.0, 0.012, uU * 1.3 - 0.02 - d - n + 0.1);
    float edge = smoothstep(0.0, 0.03, uU * 1.3 - d - n + 0.1) - e;
    vec4 c = mix(A, B, e); c.rgb *= 1.0 - 0.6 * edge; o = c; return; }
  if(uKind == 3){ o = mix(A, B, smoothstep(0.0, 1.0, uU)); return; } // dissolve
  if(uKind == 4){ // match cut: B slides from where A's last hero stood
    float k = 1.0 - smoothstep(0.0, 1.0, uU);
    k = k * k;
    float sc = mix(1.0, uSa, k);
    vec2 uvb = uCb + (uv - (uCa - uCb) * k - uCb) / sc;
    vec4 Bm = (uvb.x < 0.0 || uvb.x > 1.0 || uvb.y < 0.0 || uvb.y > 1.0) ? vec4(0.0, 0.0, 0.0, B.a) : texture(uB, uvb);
    o = Bm; return; }
  if(uKind == 5){ // mask reveal: B shows through A's words, growing
    float m = textureLod(uMaskA, uv, 2.0 + 4.0 * uU).r + textureLod(uMaskA, uv, 6.0).r * uU * 3.0;
    float e = smoothstep(1.0 - uU * 1.25, 1.02 - uU * 1.1, m + uU * uU);
    o = mix(A, B, clamp(e, 0.0, 1.0)); return; }
  if(uKind == 6){ // zoom-through A's brightest letter
    float z = exp(-4.2 * uU * uU);
    vec2 ua = uCa + (uv - uCa) * z;
    vec4 Az = texture(uA, ua);
    o = mix(Az, B, smoothstep(0.55, 1.0, uU)); return; }
  if(uKind == 7){ // glitch: block displacement
    float fr = floor(uU * 4.0);
    vec2 cell = floor(uv * vec2(6.0, 14.0));
    float r = hash21(cell + fr * 7.13 + uSeed);
    float sh = (r > 0.55 ? (hash21(cell.yx + fr) - 0.5) * 0.25 : 0.0) * (1.0 - uU);
    vec2 u2 = vec2(fract(uv.x + sh), uv.y);
    bool useB = hash21(cell * 1.7 + fr * 3.1) < uU * 1.2;
    vec4 c = useB ? texture(uB, u2) : texture(uA, u2);
    float split = 0.006 * (1.0 - uU);
    c.r = (useB ? texture(uB, u2 + vec2(split, 0.0)) : texture(uA, u2 + vec2(split, 0.0))).r;
    o = c; return; }
  o = uU < 0.5 ? A : B;
}`;

const FS_SOLID = FS_HEAD + `uniform vec3 uC1, uC2; uniform float uGrad;
void main(){ vec3 c = mix(uC1, uC2, uGrad > 0.5 ? smoothstep(0.0, 1.0, 1.0 - vUv.y) : 0.0); o = vec4(c, 1.0); }`;

export const TRANSITION_DURATION: Record<TransitionKind, number> = { cut: 0, flash: 0.3, wipe: 0.55, dissolve: 0.8, match: 0.55, mask: 0.6, zoom: 0.5, glitch: 4 / 30, auto: 0 };
/** where the boundary sits inside the transition window (0 = starts at the boundary, 1 = ends there) */
export const TRANSITION_ANCHOR: Record<TransitionKind, number> = { cut: 0, flash: 0, wipe: 0.5, dissolve: 0.5, match: 0, mask: 0.35, zoom: 0.75, glitch: 0.5, auto: 0 };
const KIND: Record<TransitionKind, number> = { cut: 0, flash: 1, wipe: 2, dissolve: 3, match: 4, mask: 5, zoom: 6, glitch: 7, auto: 0 };
const MASK_MODE: Record<LayerMask, number> = { none: 0, 'inside-words': 1, 'outside-words': 2, luma: 3, 'inv-luma': 4 };

export class Compositor {
  private scope: GLScope;
  private acc: Target[] = [];
  private tmp: Target[] = [];
  private w = 0; private h = 0;
  private flip = 0;
  private nTmp = 0;
  constructor(readonly host: GLHost) { this.scope = host.scope(); }

  resize(w: number, h: number): void {
    if (w === this.w && h === this.h && this.acc.length) return;
    this.acc.forEach((t) => this.scope.freeTarget(t));
    this.tmp.forEach((t) => this.scope.freeTarget(t));
    this.acc = [this.scope.target(w, h), this.scope.target(w, h)];
    this.tmp = [];
    this.w = w; this.h = h;
  }
  get width(): number { return this.w; }
  get height(): number { return this.h; }

  /** scratch target valid until the next begin() */
  scratch(mip = false): Target {
    const i = this.nTmp++;
    if (!this.tmp[i] || this.tmp[i].mip !== mip) { this.scope.freeTarget(this.tmp[i]); this.tmp[i] = this.scope.target(this.w, this.h, { mip }); }
    return this.tmp[i];
  }

  /** Texture for a frame (uploads 2D canvases). `slot` must be unique per frame within one composite. */
  tex(frame: Frame, slot: string, mip = false): WebGLTexture {
    if (frame.tex) { if (mip) this.scope.mips(frame.tex); return frame.tex; }
    return this.scope.upload(slot, frame.canvas as HTMLCanvasElement, { mip });
  }

  begin(transparent: boolean): void {
    this.host.resetState();
    this.nTmp = 0;
    this.flip = 0;
    this.host.bind(this.acc[0]);
    this.host.clear(0, 0, 0, transparent ? 0 : 1);
  }

  solidTex(c1: [number, number, number], c2: [number, number, number] | null): WebGLTexture {
    const t = this.scratch();
    this.host.pass(this.scope.program(FS_SOLID), t, { uC1: c1, uC2: c2 ?? c1, uGrad: c2 ? 1 : 0 });
    return t.tex;
  }

  /** Mix two frames for a transition; returns a texture. */
  transition(a: WebGLTexture, b: WebGLTexture, kind: TransitionKind, u: number, x: { seed: number; flash: number; maskA?: WebGLTexture | null; ca?: [number, number]; cb?: [number, number]; scale?: number }): WebGLTexture {
    const t = this.scratch();
    this.host.pass(this.scope.program(FS_TRANS), t, {
      uA: a, uB: b, uMaskA: x.maskA ?? a, uU: u, uSeed: x.seed % 97, uFlash: x.flash, uAspect: this.w / this.h,
      uKind: { i: KIND[kind] }, uCa: x.ca ?? [0.5, 0.5], uCb: x.cb ?? [0.5, 0.5], uSa: x.scale ?? 1,
    });
    return t.tex;
  }

  /** Blend `src` over the accumulator. */
  blend(src: WebGLTexture, mode: BlendMode, opacity: number, mask: WebGLTexture | null = null, maskMode: LayerMask = 'none'): void {
    const dst = this.acc[this.flip], out = this.acc[1 - this.flip];
    this.host.pass(this.scope.program(FS_BLEND), out, {
      uDst: dst.tex, uSrc: src, uMask: mask ?? src, uOpacity: opacity,
      uMode: { i: Math.max(0, BLEND_MODES.indexOf(mode)) }, uMaskMode: { i: mask ? MASK_MODE[maskMode] : 0 },
    });
    this.flip = 1 - this.flip;
  }

  result(): Target { return this.acc[this.flip]; }

  /** Draw a texture to the host canvas (the stage then copies it to its 2D canvas). */
  present(tex: WebGLTexture, opaque: boolean): void {
    this.host.resize(this.w, this.h);
    this.host.pass(this.scope.program(FS_COPY), null, { uTex: tex, uOpaque: opaque ? 1 : 0, uBg: [0, 0, 0, 1] });
    this.host.gl.flush();
  }

  /** Copy a texture into a scratch target (optionally with mips) — e.g. to blur a mask. */
  copy(tex: WebGLTexture, mip = false): Target {
    const t = this.scratch(mip);
    this.host.pass(this.scope.program(FS_COPY), t, { uTex: tex, uOpaque: 0, uBg: [0, 0, 0, 0] });
    if (mip) this.scope.mips(t);
    return t;
  }

  /** Read a small luminance grid of a texture (flash guard, mask bounds). Returns RGBA bytes, bottom row first. */
  private small: Target | null = null;
  readSmall(tex: WebGLTexture, w = 64, h = 36): Uint8Array {
    if (!this.small || this.small.w !== w || this.small.h !== h) { this.scope.freeTarget(this.small); this.small = this.scope.target(w, h); }
    // sample a blurred level so thin text is not missed
    this.host.pass(this.scope.program(FS_COPY), this.small, { uTex: tex, uOpaque: 0, uBg: [0, 0, 0, 0] });
    const px = new Uint8Array(w * h * 4);
    const gl = this.host.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.small.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px;
  }

  dispose(): void { this.scope.dispose(); }
}

/** Bounding box (uv, y up) of the bright pixels of a small RGBA grid; null when empty. */
export function maskBounds(px: Uint8Array, w: number, h: number): { cx: number; cy: number; w: number; h: number } | null {
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4] > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  return { cx: (x0 + x1 + 1) / 2 / w, cy: (y0 + y1 + 1) / 2 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h };
}

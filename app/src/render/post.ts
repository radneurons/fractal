// Post stack (SPEC §10.1): halation → bloom (dual-filter, 5 levels) → lens → grade + 3D LUT → vignette →
// grain (seeded by the frame index) → letterbox. Skipped entirely when every amount is neutral.
import type { Post } from '../types.ts';
import type { GLHost, GLScope, Target } from './glhost.ts';
import { FS_HEAD, GLSL_NOISE } from './gl.ts';
import { parseCube, lutTexture } from './lut.ts';

const FS_PRE = FS_HEAD + `uniform sampler2D uTex; uniform float uThr, uKnee;
void main(){ vec4 c = texture(uTex, vUv); float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - uThr + uKnee, 0.0, 2.0 * uKnee); soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, l - uThr) / max(l, 1e-4); o = vec4(c.rgb * max(w, 0.0), 1.0); }`;
const FS_DOWN = FS_HEAD + `uniform sampler2D uTex; uniform vec2 uTexel;
void main(){ vec2 h = uTexel * 0.5; vec4 s = texture(uTex, vUv) * 4.0;
  s += texture(uTex, vUv - h); s += texture(uTex, vUv + h); s += texture(uTex, vUv + vec2(h.x, -h.y)); s += texture(uTex, vUv - vec2(h.x, -h.y)); o = s / 8.0; }`;
const FS_UP = FS_HEAD + `uniform sampler2D uTex, uAdd; uniform vec2 uTexel;
void main(){ vec2 h = uTexel * 0.5; vec4 s = texture(uTex, vUv + vec2(-h.x * 2.0, 0.0)); s += texture(uTex, vUv + vec2(-h.x, h.y)) * 2.0;
  s += texture(uTex, vUv + vec2(0.0, h.y * 2.0)); s += texture(uTex, vUv + vec2(h.x, h.y)) * 2.0; s += texture(uTex, vUv + vec2(h.x * 2.0, 0.0));
  s += texture(uTex, vUv + vec2(h.x, -h.y)) * 2.0; s += texture(uTex, vUv + vec2(0.0, -h.y * 2.0)); s += texture(uTex, vUv + vec2(-h.x, -h.y)) * 2.0;
  o = s / 12.0 + texture(uAdd, vUv); }`;
const FS_FINAL = FS_HEAD + GLSL_NOISE + `
uniform sampler2D uScene, uBloom, uHal; uniform highp sampler3D uLut;
uniform vec2 uRes; uniform float uBloomAmt, uHalAmt, uChroma, uDist, uVig, uGrain, uFrameIdx, uLetterbox;
uniform float uLift, uGamma, uGain, uSat, uTemp, uTint, uLutMix, uLutSize, uGuardMix; uniform vec3 uGuardMean;
vec2 distort(vec2 uv, float k){ vec2 c = uv - 0.5; c.x *= uRes.x / uRes.y; float r2 = dot(c, c); c *= 1.0 + k * r2; c.x /= uRes.x / uRes.y; return c + 0.5; }
void main(){
  vec2 uv = distort(vUv, uDist * 0.35);
  vec2 d = (uv - 0.5); float r = length(d * vec2(uRes.x / uRes.y, 1.0));
  vec2 ca = d * uChroma * 0.012 * (0.4 + r);
  vec4 s = texture(uScene, uv);
  vec3 c = vec3(texture(uScene, uv + ca).r, s.g, texture(uScene, uv - ca).b);
  float inb = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  c *= inb; float alpha = s.a * inb;
  vec3 bl = texture(uBloom, uv).rgb;
  c += bl * uBloomAmt * 0.9;
  vec3 hal = texture(uHal, uv).rgb;
  c += vec3(1.0, 0.28, 0.12) * dot(hal, vec3(0.6, 0.3, 0.1)) * uHalAmt * 0.9;
  // grade: lift / gamma / gain, temperature / tint, saturation
  c = c * uGain + uLift * (1.0 - c);
  c = pow(max(c, 0.0), vec3(1.0 / max(uGamma, 0.05)));
  c *= vec3(1.0 + 0.18 * uTemp, 1.0 + 0.08 * uTint, 1.0 - 0.18 * uTemp);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  if(uLutMix > 0.0){ vec3 q = clamp(c, 0.0, 1.0); vec3 g = texture(uLut, (q * (uLutSize - 1.0) + 0.5) / uLutSize).rgb; c = mix(c, g, uLutMix); }
  c *= 1.0 - uVig * smoothstep(0.35, 1.05, r);
  if(uGrain > 0.0){ float n = hash21(vUv * uRes + uFrameIdx * vec2(17.0, 31.0)) - 0.5;
    float ll = dot(c, vec3(0.3333)); c += n * uGrain * 0.22 * (0.35 + 0.65 * (1.0 - abs(ll * 2.0 - 1.0))); }
  // photosensitivity guard: compress contrast toward the precomputed mean
  c = mix(uGuardMean, c, uGuardMix);
  if(uLetterbox > 0.0){ float target = (uRes.x / uRes.y) / uLetterbox; float bar = max(0.0, (1.0 - target) * 0.5);
    float in2 = step(bar, vUv.y) * step(vUv.y, 1.0 - bar); c *= in2; alpha = max(alpha, 1.0 - in2); }
  o = vec4(clamp(c, 0.0, 1.0), alpha);
}`;

export function postIsNeutral(p: Post): boolean {
  return p.bloom <= 0 && p.grain <= 0 && p.chroma <= 0 && p.vignette <= 0 && p.distortion === 0 && p.halation <= 0 && !(p.letterbox > 0)
    && p.lift === 0 && p.gamma === 1 && p.gain === 1 && p.saturation === 1 && p.temperature === 0 && p.tint === 0 && !(p.lut && p.lutMix > 0);
}

export class PostStack {
  private scope: GLScope;
  private chain: Target[] = [];
  private ups: Target[] = [];
  private out: Target | null = null;
  private w = 0; private h = 0;
  private luts = new Map<string, { tex: WebGLTexture; size: number }>();
  private pending = new Set<string>();
  private black: WebGLTexture;
  private idLut: WebGLTexture;
  onLutLoaded: (() => void) | null = null;
  constructor(readonly host: GLHost) {
    this.scope = host.scope();
    this.black = this.scope.texture({ w: 1, h: 1, data: new Uint8Array([0, 0, 0, 255]) });
    const gl = host.gl;
    this.idLut = this.scope.track(lutTexture(gl, { size: 2, title: 'id', data: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1]) }));
  }

  private resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    [...this.chain, ...this.ups].forEach((t) => this.scope.freeTarget(t));
    this.scope.freeTarget(this.out);
    this.chain = []; this.ups = [];
    let cw = w, ch = h;
    for (let i = 0; i < 5; i++) { cw = Math.max(2, cw >> 1); ch = Math.max(2, ch >> 1); this.chain.push(this.scope.target(cw, ch)); }
    for (let i = 0; i < 4; i++) this.ups.push(this.scope.target(this.chain[3 - i].w, this.chain[3 - i].h));
    this.out = this.scope.target(w, h);
    this.w = w; this.h = h;
  }

  /** Register LUT text under a name (built-ins are fetched by the stage; user LUTs come from files). */
  addLut(name: string, cubeText: string): void {
    const lut = parseCube(cubeText);
    const old = this.luts.get(name);
    if (old) this.host.gl.deleteTexture(old.tex);
    this.luts.set(name, { tex: this.scope.track(lutTexture(this.host.gl, lut)), size: lut.size });
  }
  hasLut(name: string): boolean { return this.luts.has(name); }
  async loadBuiltin(name: string, base = './luts/'): Promise<void> {
    if (this.luts.has(name) || this.pending.has(name)) return;
    this.pending.add(name);
    try { const r = await fetch(`${base}${name}.cube`); if (r.ok) { this.addLut(name, await r.text()); this.onLutLoaded?.(); } }
    catch { /* offline: the LUT is skipped */ } finally { this.pending.delete(name); }
  }

  /** Apply the stack; returns the input texture untouched when everything is neutral. */
  apply(scene: WebGLTexture, w: number, h: number, p: Post, frameIdx: number, guard: { mix: number; mean: [number, number, number] } = { mix: 1, mean: [0, 0, 0] }, bloomGain = 1): WebGLTexture {
    if (postIsNeutral(p) && guard.mix >= 0.999) return scene;
    this.resize(w, h);
    const s = this.scope;
    let bloomTex = this.black, halTex = this.black;
    if (p.bloom > 0 || p.halation > 0) {
      s.pass(s.program(FS_PRE), this.chain[0], { uTex: scene, uThr: 0.62, uKnee: 0.25 });
      for (let i = 1; i < 5; i++) s.pass(s.program(FS_DOWN), this.chain[i], { uTex: this.chain[i - 1].tex, uTexel: [1 / this.chain[i - 1].w, 1 / this.chain[i - 1].h] });
      let src = this.chain[4];
      for (let i = 0; i < 4; i++) {
        s.pass(s.program(FS_UP), this.ups[i], { uTex: src.tex, uAdd: this.chain[3 - i].tex, uTexel: [1 / src.w, 1 / src.h] });
        src = this.ups[i];
      }
      bloomTex = this.ups[3].tex;
      halTex = this.ups[1].tex; // a wider level for the red-weighted halation
    }
    const lut = p.lut && p.lutMix > 0 ? this.luts.get(p.lut) : undefined;
    if (p.lut && p.lutMix > 0 && !lut) void this.loadBuiltin(p.lut);
    s.pass(s.program(FS_FINAL), this.out, {
      uScene: scene, uBloom: bloomTex, uHal: halTex, uLut: { tex3d: lut?.tex ?? this.idLut }, uRes: [w, h],
      uBloomAmt: p.bloom * bloomGain, uHalAmt: p.halation * bloomGain, uChroma: p.chroma, uDist: p.distortion, uVig: p.vignette, uGrain: p.grain,
      uFrameIdx: frameIdx % 4096, uLetterbox: p.letterbox > 0 ? p.letterbox : 0,
      uLift: p.lift, uGamma: p.gamma, uGain: p.gain, uSat: p.saturation, uTemp: p.temperature, uTint: p.tint,
      uLutMix: lut ? p.lutMix : 0, uLutSize: lut?.size ?? 2, uGuardMix: guard.mix, uGuardMean: guard.mean,
    });
    return this.out!.tex;
  }
  dispose(): void { this.scope.dispose(); }
}

// ELEMENTS — text as material. Generalised from "Not Light, But Fire".
// Every hero word becomes an element (fire, light, water, shock, wind, vortex, quake, ice, smoke),
// chosen from its meaning or from the music, plays it out, and leaves a residue in the world.
import type { ParamSpec, Params, Word, ElementKind } from '../types';
import { type Effect, type EffectContext, type EffectFactory, type CamKey, camAt, clamp, lerp, prog, eOut, eIO, defaults, lastIndexLE } from './types';
import { makeSDF, packAtlas, measureCap, type SDFGlyphs, type FontKey } from '../render/sdf';
import { compile, tex, fullscreenTriangle, VS_FULL, GLSL_NOISE } from '../render/gl';
import { sample } from '../analysis/dsp';

const PARAMS: ParamSpec[] = [
  { key: 'palette', label: 'Palette', group: 'Look', type: 'select', options: ['soot', 'midnight', 'ember', 'ash'], default: 'soot', help: 'Background and type colours', live: true },
  { key: 'intensity', label: 'Element intensity', group: 'Look', type: 'range', min: 0, max: 1.5, step: 0.01, default: 1, help: 'Scales flames, rays, rain, waves and quakes', live: true },
  { key: 'persistence', label: 'Persistence', group: 'Look', type: 'range', min: 0, max: 1, step: 0.01, default: 1, help: 'How much of each element’s residue (ash, glass, embers) stays in the world', live: true },
  { key: 'heroSize', label: 'Hero size', group: 'Layout', type: 'range', min: 140, max: 360, step: 1, default: 240, help: 'Cap height of hero words (world units)', live: false },
  { key: 'connScale', label: 'Connective size', group: 'Layout', type: 'range', min: 0.18, max: 0.5, step: 0.01, default: 0.3, help: 'Connective words relative to heroes', live: false },
  { key: 'rowWidth', label: 'Line width', group: 'Layout', type: 'range', min: 1400, max: 3600, step: 10, default: 2400, help: 'Maximum width of a lyric line before it wraps', live: false },
  { key: 'useLexicon', label: 'Meaning picks the element', group: 'Elements', type: 'toggle', default: true, help: 'Off: the music alone decides each element', live: false },
  { key: 'shockFlash', label: 'Shock white flash', group: 'Elements', type: 'toggle', default: true, help: 'Four-frame white-out on SHOCK words', live: true },
  { key: 'rain', label: 'Rain density', group: 'Elements', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55, help: 'Rain for WATER words (also follows the hi-hats)', live: true },
  { key: 'sparks', label: 'Sparks', group: 'Elements', type: 'range', min: 0, max: 400, step: 1, default: 160, help: 'Ember sparks above FIRE words', live: true },
  { key: 'reactivity', label: 'Beat reactivity', group: 'Music', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6, help: 'How strongly bass/hats/loudness modulate the elements', live: true },
  { key: 'camEnergy', label: 'Camera energy', group: 'Camera', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, help: 'Drift and section pull-backs', live: false },
  { key: 'recordPullback', label: 'Section pull-backs', group: 'Camera', type: 'toggle', default: true, help: 'At section breaks, pull back to show what the elements left behind', live: false }
];

const EL: Record<ElementKind, number> = { none: 0, light: 1, fire: 2, water: 3, shock: 4, wind: 5, vortex: 6, quake: 7, ice: 8, smoke: 9 };
const MAXW = 255;   // tiles store word index+1 in a byte

const PALETTES: Record<string, { bg0: number[]; bg1: number[]; paper: number[]; cold: number[]; slate: number[] }> = {
  soot: { bg0: [.043, .039, .035], bg1: [.09, .078, .066], paper: [.937, .902, .824], cold: [.749, .843, .902], slate: [.235, .275, .314] },
  midnight: { bg0: [.024, .035, .062], bg1: [.055, .075, .12], paper: [.90, .92, .95], cold: [.70, .85, 1.0], slate: [.22, .28, .38] },
  ember: { bg0: [.06, .025, .02], bg1: [.12, .05, .035], paper: [.97, .88, .76], cold: [.95, .82, .62], slate: [.32, .22, .2] },
  ash: { bg0: [.10, .10, .10], bg1: [.16, .16, .155], paper: [.96, .95, .92], cold: [.82, .88, .92], slate: [.34, .36, .38] }
};

const FS = `#version 300 es
precision highp float;
uniform sampler2D uA; uniform vec2 uAS;
uniform sampler2D uT0, uT1; uniform vec2 uTN; uniform vec2 uRes;
uniform vec4 uCam;                 // cx, cy, zoom, t
// per-word data texture (RGBA32F, MAXW x 5): rows R, U, S, E, X
//  R world rect of the SDF bitmap · U atlas px rect · S style(0 conn,1 support,2 hero), reveal, k, cap
//  E element, act, residue, baseline y · X seed, time since onset, rise(dy), alpha
uniform highp sampler2D uD;
#define WR(i) texelFetch(uD, ivec2(i, 0), 0)
#define WU(i) texelFetch(uD, ivec2(i, 1), 0)
#define WS(i) texelFetch(uD, ivec2(i, 2), 0)
#define WE(i) texelFetch(uD, ivec2(i, 3), 0)
#define WX(i) texelFetch(uD, ivec2(i, 4), 0)
uniform vec4 uAud;                 // bass, mid, high, loud
uniform vec4 uAud2;                // beat pulse, flux, centroid, reactivity
uniform vec4 uLight; uniform int uLightW;
uniform vec4 uRain;                // amount, time, angle, intensity
uniform vec4 uWave[3];             // cx, cy, radius, amp
uniform vec4 uVort[2];             // cx, cy, R, strength
uniform vec4 uQk[3];               // cx, cy, R, shake
uniform vec4 uQk2[3];              // lock, seed, glow, _
uniform vec4 uMisc;                // wind, flash, fade, erode
uniform vec3 uBg0, uBg1, uPaper, uCold, uSlate;
uniform float uPersist, uInt;
out vec4 o;
const float SPREAD = 22.0;
${GLSL_NOISE}
float sdW(int i, vec2 p){
  vec4 r = WR(i); float k = WS(i).z;
  vec2 dq = max(max(r.xy - p, p - r.zw), 0.);
  if (dq.x > 0. || dq.y > 0.) return SPREAD * k + length(dq);   // outside the bitmap: a true lower bound
  vec4 u = WU(i);
  vec2 f = (p - r.xy) / (r.zw - r.xy);
  float v = texture(uA, mix(u.xy, u.zw, f) / uAS).r;
  return (v - .5) * 2. * SPREAD * k;
}
vec3 ramp(float h){
  vec3 a=vec3(.227,.039,.016), b=vec3(.62,.165,.043), c=vec3(.91,.38,.10), d=vec3(1.,.757,.37), e=vec3(1.,.957,.84);
  h = clamp(h,0.,1.);
  if (h < .25) return mix(vec3(0.), a, h/.25);
  if (h < .45) return mix(a, b, (h-.25)/.2);
  if (h < .65) return mix(b, c, (h-.45)/.2);
  if (h < .85) return mix(c, d, (h-.65)/.2);
  return mix(d, e, (h-.85)/.15);
}
float rainField(vec2 p, float tt, float ang, float density){
  vec2 r = rot(ang) * p; float colW = 11.; float ci = floor(r.x / colW);
  if (h11(ci) > density) return 0.;
  float speed = 1300. + 700.*h11(ci+3.1), len = 70. + 90.*h11(ci+7.3), period = 420. + 380.*h11(ci+5.7);
  float seg = mod(r.y - tt*speed - h11(ci+11.9)*4000., period);
  float streak = smoothstep(len, len*.2, seg) * smoothstep(0., 6., seg);
  float x = fract(r.x / colW) - .5 - (h11(ci+13.)-.5)*.5;
  return streak * smoothstep(.16, .0, abs(x));
}
void main(){
  vec2 s = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float z = uCam.z, t = uCam.w, aa = 1. / z;
  vec2 p0 = uCam.xy + (s - uRes * .5) / z;
  vec2 p = p0;
  // quakes: Voronoi plates around each event, offsets persist once locked
  float fault = 0.;
  for (int q = 0; q < 3; q++) {
    vec4 Q = uQk[q], Q2 = uQk2[q]; if (Q.z <= 0.) continue;
    float dc = distance(p0, Q.xy); if (dc > Q.z * 1.4) continue;
    float cell = Q.z * .45; vec2 g = floor(p0 / cell);
    float d1 = 1e9, d2 = 1e9; vec2 id = vec2(0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 c = g + vec2(i, j); vec2 sp = (c + h22(c + Q2.y)) * cell; float d = distance(p0, sp); if (d < d1) { d2 = d1; d1 = d; id = c; } else if (d < d2) d2 = d; }
    float fall = smoothstep(Q.z * 1.4, Q.z * .8, dc);
    vec2 hh = h22(id + Q2.y * 3.1) - .5;
    vec2 off = hh * Q.z * .07 * Q2.x * fall + vec2(sin(t * 23. + id.x), cos(t * 31. + id.y)) * 16. * Q.w * fall;
    p -= off;
    fault = max(fault, smoothstep(8. / max(z, .2), 0., d2 - d1) * Q2.z * fall);
  }
  vec2 pq = p;
  for (int v = 0; v < 2; v++) {
    vec4 V = uVort[v]; if (V.w == 0.) continue;
    vec2 d = p - V.xy; float r = length(d);
    float a = V.w * (V.z * .4) / (r + V.z * .18) * smoothstep(V.z * 1.3, V.z * .1, r);
    p = V.xy + rot(a) * d;
  }
  vec2 pw = p; float waveBright = 0.;
  for (int k = 0; k < 3; k++) {
    vec4 W = uWave[k]; if (W.w <= 0.) continue;
    vec2 d = p - W.xy; float r = length(d) + 1e-3; float x = (r - W.z) / 90.;
    pw -= d / r * W.w * x * exp(-x * x);
    waveBright += W.w / 60. * exp(-x * x);
  }
  // background
  vec3 col = mix(uBg0, uBg1, vnoise(p0 / 340.) * .7 + vnoise(p0 / 70.) * .25);
  col *= 1. + .08 * uAud2.x * uAud2.w;
  // light rays from the active LIGHT word
  if (uLight.w > 0. && uLightW >= 0) {
    vec2 c = uLight.xy; float R = uLight.z; float dist = length(pw - c);
    if (dist < R * 2.2) {
      float acc = 0., jit = h21(gl_FragCoord.xy) / 26.;
      for (int k = 0; k < 26; k++) {
        float f = float(k) / 26. + jit; vec2 q = mix(pw, c, f);
        vec2 dq = (q - c) / vec2(R * .8, R * .3);
        acc += exp(-dot(dq, dq)) * smoothstep(-2., 2., sdW(uLightW, q)) * (1. - f * .5);
      }
      acc = acc / 26. * smoothstep(R * 2.2, R * 1.4, dist);
      col += uCold * acc * 1.6 * uLight.w;
    }
  }
  float rain = 0.;
  if (uRain.x > 0.) rain = rainField(pw, uRain.y, uRain.z, .55 * uRain.w) * uRain.x;
  // words (tile-culled)
  ivec2 tc = ivec2(clamp(floor(s / 32.), vec2(0.), uTN - 1.));
  vec4 ta = texelFetch(uT0, tc, 0) * 255., tb = texelFetch(uT1, tc, 0) * 255.;
  for (int kk = 0; kk < 8; kk++) {
    float fi = kk < 4 ? ta[kk] : tb[kk - 4];
    if (fi < .5) break;
    int i = int(fi + .5) - 1;
    vec4 S = WS(i), E = WE(i), X = WX(i), Rr = WR(i);
    float rev = S.y; if (rev <= 0.) continue;
    int st = int(S.x + .5), el = int(E.x + .5);
    float cap = S.w, act = E.y, res = E.z * uPersist;
    vec2 q = pw + vec2(0., X.z);
    // a vortex word keeps a little twist
    if (el == 6) { vec2 cc = vec2((Rr.x + Rr.z) * .5, E.w - cap * .5); vec2 d = q - cc; float r = length(d); q = cc + rot((act * .9 + res * .22) * smoothstep(cap * 3., 0., r)) * d; }
    float d = sdW(i, q);
    // wind smears the type downwind
    float streak = 0.;
    if (uMisc.x > 0. && el != 5) {
      float ws = 0.;
      for (int k = 1; k < 7; k++) { float fk = float(k); float dk = sdW(i, q - vec2(fk * 13. * uMisc.x, sin(q.x * .013 + fk * .7) * 3. * uMisc.x)); float wk = 1. - fk / 7.; streak += smoothstep(aa * 2., -aa * 2., dk) * wk; ws += wk; }
      streak = streak / ws * min(uMisc.x * 1.6, 1.) * .7;
    }
    if (el == 5) { float ws = 0.; float amt = act + res * .45; for (int k = 1; k < 7; k++) { float fk = float(k); float dk = sdW(i, q - vec2(fk * 12. * amt, 0.)); float wk = 1. - fk / 7.; streak += smoothstep(aa * 2., -aa * 2., dk) * wk; ws += wk; } streak = streak / ws * .6 * min(amt, 1.); }
    d += uMisc.w;
    float cov = max(smoothstep(aa, -aa, d), streak);
    float yN = (E.w - q.y) / cap;
    vec2 ln = (q - Rr.xy) / cap;
    float alpha = rev * X.w;
    if (el == 0) {
      vec3 c = st == 0 ? uPaper : uPaper * .93;
      col = mix(col, c, cov * alpha * (st == 0 ? .9 : .95));
    } else if (el == 1) {              // LIGHT
      vec3 cold = uCold * (.8 + .2 * clamp(yN, 0., 1.));
      vec3 c = mix(cold, mix(uCold, uPaper, .5) * .7, res * .6);
      col += uCold * exp(-max(d, 0.) / (.05 * cap)) * .22 * act * step(0., d) * uInt;
      col = mix(col, c, cov * alpha);
    } else if (el == 2) {              // FIRE → embers
      vec2 w = vec2(fbm3(ln * 2.2 + vec2(0., t * 1.3)), fbm3(ln * 2.2 + vec2(5.2, t * 1.1)));
      float n = fbm(vec2(ln.x * 3.4, ln.y * 2.6 + t * 2.4) + w * 1.3);
      float fl = act * uInt * (1. + .35 * uAud.y * uAud2.w);
      float dUp = sdW(i, q + vec2(0., n * cap * .30 * min(fl, 1.2)));
      float heatOut = smoothstep(.10 * cap, -.05 * cap, dUp - (n - .45) * .2 * cap) * min(fl, 1.);
      float core = smoothstep(0., -.06 * cap, d) * min(fl, 1.);
      float heat = max(heatOut * (.55 + .5 * n), core * (.78 + .22 * n));
      col += ramp(heat) * heat * 1.25 * alpha;
      float rimE = smoothstep(.022 * cap, 0., abs(d + .012 * cap)) * res;
      float flick = .65 + .35 * fbm(vec2(ln.x * 9., t * 1.7)) + .2 * uAud2.x * uAud2.w;
      col = mix(col, vec3(.16,.05,.03), smoothstep(aa, -aa, d) * res * .8 * alpha);
      col += ramp(.62 + .2 * flick) * rimE * flick * 1.1 * alpha;
      if (fl < .05 && res < .05) col = mix(col, uPaper, cov * alpha);
    } else if (el == 3) {              // WATER → glass
      float fill = clamp(max(act * 1.15, res), 0., 1.);
      float lvl = clamp(fill * 1.35 - clamp(ln.x / max(1., (Rr.z - Rr.x) / cap), 0., 1.) * .35, 0., 1.);
      float filled = step(yN, lvl * 1.08 - .02);
      vec2 e = vec2(2., 0.);
      vec2 g = vec2(sdW(i, q + e.xy) - sdW(i, q - e.xy), sdW(i, q + e.yx) - sdW(i, q - e.yx));
      float bev = smoothstep(-.09 * cap, 0., d);
      vec3 nrm = normalize(vec3(-g * 1.6 * bev, 1.));
      float spec = pow(max(dot(reflect(-normalize(vec3(-.5, -.7, .6)), nrm), vec3(0,0,1)), 0.), 36.);
      vec2 rq = q + nrm.xy * 40.;
      vec3 behind = mix(uBg0, uBg1, vnoise(rq / 340.) * .7 + vnoise(rq / 70.) * .25);
      vec3 glass = behind * .7 + mix(uCold, vec3(.58,.71,.81), .5) * (.34 + .3 * bev) + spec * .9;
      glass += smoothstep(.55, .9, vnoise(q / 7.)) * smoothstep(-.05 * cap, -.01 * cap, d) * .6 * vec3(.8,.9,1.);
      col = mix(col, glass, cov * filled * alpha);
      col += uCold * cov * (1. - filled) * alpha * .14;
    } else if (el == 4) {              // SHOCK
      col = mix(col, vec3(.97,.94,.88), cov * alpha);
    } else if (el == 5) {              // WIND → slate streaks
      col = mix(col, mix(uSlate * 2.6, uPaper, .25), cov * alpha);
    } else if (el == 6) {              // VORTEX
      col = mix(col, mix(uPaper, uCold, .25), cov * alpha);
    } else if (el == 7) {              // QUAKE
      col = mix(col, vec3(.95,.92,.86), cov * alpha);
    } else if (el == 8) {              // ICE: frost grows from the edges inward into facets
      float grow = clamp(max(act, res) * 1.2, 0., 1.);
      vec2 g = floor(q / (cap * .16)); float f1 = 1e9, f2 = 1e9;
      for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) { vec2 c = g + vec2(k, j); vec2 sp = (c + h22(c + X.x)) * cap * .16; float dd = distance(q, sp); if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd; }
      float edge = smoothstep(cap * .012, 0., f2 - f1);
      float frost = smoothstep(-grow * .25 * cap, -grow * .25 * cap + 2. * aa, -d) ;
      vec3 icec = mix(vec3(.62,.80,.92), vec3(.95,.98,1.), .45 + .55 * vnoise(q / (cap * .2))) + edge * .25;
      vec3 c = mix(uPaper * .9, icec, 1. - frost);
      col = mix(col, c, cov * alpha);
      col += vec3(.7,.85,1.) * exp(-max(d, 0.) / (.04 * cap)) * .12 * act * step(0., d);
    } else if (el == 9) {              // SMOKE: wisps rise, the word thins from the top
      float sm = fbm(vec2(ln.x * 2.5, ln.y * 2. + t * .9));
      float dissolve = clamp(res * .7, 0., .7);
      float keep = smoothstep(dissolve * 1.3 - .2, dissolve * 1.3, (1. - yN) + sm * .35);
      col = mix(col, mix(uPaper, vec3(.6,.6,.62), res * .6), cov * alpha * mix(1., keep, step(.01, dissolve)));
      float dUp = sdW(i, q + vec2(0., sm * cap * .9 * act));
      float wisp = smoothstep(.25 * cap, -.05 * cap, dUp - (sm - .45) * .5 * cap) * act * (1. - cov);
      col = mix(col, vec3(.55,.55,.58), wisp * .45 * alpha * uInt);
    }
  }
  col += vec3(.62,.72,.80) * rain * .55;
  col += ramp(.7) * fault * .9; col = mix(col, ramp(.55), fault * .35);
  col += vec3(.95,.93,.88) * clamp(waveBright, 0., 1.) * .08;
  col = mix(col, vec3(1.,.975,.93), uMisc.y);
  col *= 1. - uMisc.z;
  o = vec4(col, 1.);
}`;

const VS_SP = `#version 300 es
precision highp float;
layout(location=0) in float aP;
uniform vec4 uCam; uniform vec2 uRes; uniform vec4 uBox; uniform float uAmt;
out float vA;
float h11(float n){ return fract(sin(n*127.1)*43758.5453); }
void main(){
  float id = aP, t = uCam.w;
  float life = .9 + .8 * h11(id + 1.), ph = h11(id + 2.) * life, age = mod(t + ph, life) / life;
  float x0 = mix(uBox.x, uBox.z, h11(id + 3.)), y0 = mix(uBox.y, uBox.w, .55 + .45 * h11(id + 4.));
  float rise = (uBox.w - uBox.y) * (1.6 + 1.6 * h11(id + 5.));
  vec2 w = vec2(x0 + sin(t * (1.2 + h11(id + 6.) * 2.) + id) * 40. * age, y0 - rise * age);
  vec2 s = (w - uCam.xy) * uCam.z;
  gl_Position = vec4(s.x / (uRes.x * .5), -s.y / (uRes.y * .5), 0., 1.);
  gl_PointSize = (2. + 3.5 * h11(id + 7.)) * (1. - age * .6) * max(uCam.z, .5) * uRes.y / 1080.;
  vA = (1. - age) * smoothstep(0., .1, age) * uAmt;
}`;
const FS_SP = `#version 300 es
precision highp float; in float vA; out vec4 o;
void main(){ vec2 c = gl_PointCoord - .5; float a = smoothstep(.5, .1, length(c)) * vA; o = vec4(vec3(1., .72, .32) * a, a); }`;

interface Item { w: Word | null; text: string; font: FontKey; cap: number; x: number; y: number; adv: number; sdf: SDFGlyphs; k: number; wx0: number; wy0: number; ww: number; wh: number; style: number; el: number; line: number; actStart: number; actEnd: number; seed: number }

class ElementsEffect implements Effect {
  readonly id = 'elements'; readonly name = 'Elements'; readonly description = 'Each hero word becomes the element it names — fire, light, water, thunder, wind, vortex, quake, ice, smoke — and leaves its mark.';
  readonly params = PARAMS;
  private p: Params = defaults(PARAMS);
  private ctx!: EffectContext;
  private cv!: HTMLCanvasElement; private gl!: WebGL2RenderingContext;
  private prog!: ReturnType<typeof compile>; private progSp!: ReturnType<typeof compile>;
  private vao!: WebGLVertexArrayObject; private spVao!: WebGLVertexArrayObject;
  private atlas!: WebGLTexture; private atlasW = 4096; private atlasH = 1;
  private tiles: WebGLTexture[] = []; private tilesN = [1, 1];
  private items: Item[] = []; private keys: CamKey[] = [];
  private shocks: { t: number; x: number; y: number; strong: boolean }[] = [];
  private quakes: { t: number; x: number; y: number; R: number; seed: number }[] = [];
  private world = { w: 1, h: 1 };
  private tileBuf0 = new Uint8Array(0); private tileBuf1 = new Uint8Array(0);
  private dataTex!: WebGLTexture; private dataBuf = new Float32Array(MAXW * 5 * 4);

  async prepare(ctx: EffectContext) {
    this.ctx = ctx; this.p = { ...defaults(PARAMS), ...ctx.params };
    if (!this.cv) {
      this.cv = document.createElement('canvas');
      const gl = this.cv.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
      if (!gl) throw new Error('WebGL2 is not available');
      this.gl = gl;
      this.prog = compile(gl, VS_FULL, FS); this.progSp = compile(gl, VS_SP, FS_SP);
      this.vao = fullscreenTriangle(gl);
      this.spVao = gl.createVertexArray()!; gl.bindVertexArray(this.spVao);
      const b = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Array.from({ length: 400 }, (_, i) => i)), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
      this.dataTex = tex(gl, MAXW, 5, null, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    }
    this.cv.width = ctx.width; this.cv.height = ctx.height;
    this.layout();
    this.buildCamera();
  }

  setParams(p: Params) { this.p = { ...this.p, ...p }; }

  private layout() {
    const { song, settings } = this.ctx;
    const ly = song.lyrics, a = song.analysis;
    const HC = Number(this.p.heroSize), conn = Number(this.p.connScale), RW = Number(this.p.rowWidth) * Math.min(1, Math.max(.5, this.ctx.width / this.ctx.height));
    const useLex = Boolean(this.p.useLexicon);
    const items: Item[] = [];
    const sizes = { hero: HC, support: HC * .5, connective: HC * conn };
    const off = settings.syncOffsetMs / 1000;
    // column per section, block per line, rows inside a block
    let colX = 0, colW = 0, y = 0, curSec = -1;
    const lineBlocks: { line: number; x0: number; y0: number; x1: number; y1: number; sec: number; colX: number }[] = [];
    for (const L of ly.lines) {
      if (L.section !== curSec) { if (curSec >= 0) { colX += colW + HC * 3; colW = 0; y = 0; } curSec = L.section; }
      const ws = L.words.map(id => ly.words[id]);
      let rowX = 0, rowY = y, rowCap = 0; const row: Item[] = []; let blockW = 0;
      const flush = () => { for (const it of row) { it.y = rowY + rowCap; } blockW = Math.max(blockW, rowX); rowY += rowCap * 1.32; rowX = 0; rowCap = 0; row.length = 0; };
      for (const w of ws) {
        const cap = sizes[w.role];
        const font: FontKey = w.role === 'connective' ? 'serif' : 'cond';
        const text = w.role === 'connective' ? w.display : w.display.toUpperCase();
        const adv = measureCap(font, cap, text);
        const gap = cap * .3 + (rowX ? HC * .06 : 0);
        if (rowX && rowX + gap + adv > RW) flush();
        const x = rowX ? rowX + gap : 0;
        let el = 0;
        if (w.role === 'hero') { const ek = (useLex ? w.element : audioElement(w, a)) ?? 'none'; el = EL[ek] ?? 0; }
        const it = { w, text, font, cap, x: colX + x, y: 0, adv, sdf: null as unknown as SDFGlyphs, k: 1, wx0: 0, wy0: 0, ww: 0, wh: 0, style: w.role === 'hero' ? 2 : w.role === 'support' ? 1 : 0, el, line: L.idx, actStart: 0, actEnd: 0, seed: (w.id * 7.31) % 97 } as Item;
        row.push(it); items.push(it);
        rowX = x + adv; rowCap = Math.max(rowCap, cap);
      }
      if (row.length) flush();
      lineBlocks.push({ line: L.idx, x0: colX, y0: y, x1: colX + blockW, y1: rowY, sec: L.section, colX });
      colW = Math.max(colW, blockW);
      y = rowY + HC * .9;
    }
    // element activity windows: from just before onset until the next hero lands (or a minimum hold)
    const heroes = items.filter(i => i.style === 2);
    heroes.forEach((h, k) => {
      const s = h.w!.start + off, next = heroes[k + 1]?.w!.start;
      h.actStart = s - (h.el === 2 ? .7 : h.el === 3 ? 1.0 : h.el === 5 || h.el === 9 ? .9 : h.el === 4 ? 0 : .6);
      h.actEnd = Math.max(s + 1.4, Math.min((next ?? s + 3) + off, s + 4));
    });
    // SDFs at an atlas cap that fits a 4096-wide atlas within the GPU limit
    const maxTex = Math.min(8192, this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE));
    let acapH = 120, packed: ReturnType<typeof packAtlas> = null;
    while (!packed) {
      for (const it of items) {
        const ac = Math.max(28, Math.round(acapH * Math.min(1, it.cap / HC) * (it.style === 0 ? 1.5 : 1)));
        let acap = ac; const estW = it.adv / it.cap * acap; if (estW > 3900) acap = Math.floor(acap * 3900 / estW);
        it.sdf = makeSDF(it.text, it.font, acap, 22);
      }
      packed = packAtlas(items.map(i => i.sdf), maxTex);
      if (!packed) acapH = Math.floor(acapH * .8);
      if (acapH < 30) throw new Error('lyrics too long for the texture atlas');
    }
    for (const it of items) { it.k = it.cap / it.sdf.acap; it.wx0 = it.x - it.sdf.x0 * it.k; it.wy0 = it.y - it.sdf.base * it.k; it.ww = it.sdf.w * it.k; it.wh = it.sdf.h * it.k; }
    const gl = this.gl;
    if (this.atlas) gl.deleteTexture(this.atlas);
    this.atlas = tex(gl, packed.w, packed.h, packed.data, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR);
    this.atlasW = packed.w; this.atlasH = packed.h;
    this.items = items;
    this.blocks = lineBlocks;
    this.world = { w: Math.max(1, ...items.map(i => i.x + i.adv)), h: Math.max(1, ...items.map(i => i.y)) };
    // global events
    this.shocks = heroes.filter(h => h.el === 4).map(h => ({ t: h.w!.start + off, x: h.x + h.adv / 2, y: h.y - h.cap / 2, strong: sample(a.flux, h.w!.start) > .4 }));
    this.quakes = heroes.filter(h => h.el === 7).map((h, k) => ({ t: h.w!.start + off, x: h.x + h.adv / 2, y: h.y - h.cap / 2, R: Math.max(h.adv * .9, HC * 4), seed: 3.7 * (k + 1) }));
    // tiles
    const [W, H] = [this.ctx.width, this.ctx.height];
    this.tilesN = [Math.ceil(W / 32), Math.ceil(H / 32)];
    this.tileBuf0 = new Uint8Array(this.tilesN[0] * this.tilesN[1] * 4); this.tileBuf1 = new Uint8Array(this.tileBuf0.length);
    this.tiles.forEach(t => gl.deleteTexture(t));
    this.tiles = [0, 1].map(() => tex(gl, this.tilesN[0], this.tilesN[1], null, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST));
  }
  private blocks: { line: number; x0: number; y0: number; x1: number; y1: number; sec: number; colX: number }[] = [];

  private buildCamera() {
    const { song, settings, width: W, height: H } = this.ctx;
    const off = settings.syncOffsetMs / 1000;
    const keys: CamKey[] = [];
    const HC = Number(this.p.heroSize), energy = Number(this.p.camEnergy) * settings.cameraEnergy / 100;
    const frame = (x0: number, y0: number, x1: number, y1: number, fill = .78): CamKey => {
      const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
      let z = Math.min(W * fill / w, H * .72 / h);
      z = Math.min(z, H * .30 / HC);                // never closer than a hero at 30% of frame height
      return { t: 0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, z, r: 0 };
    };
    const ly = song.lyrics;
    const blocks = this.blocks;
    if (!blocks.length) { this.keys = [{ t: 0, cx: 0, cy: 0, z: 1, r: 0 }]; return; }
    const first = frame(blocks[0].x0, blocks[0].y0, blocks[0].x1, blocks[0].y1);
    keys.push({ ...first, t: 0, z: first.z * .82 });
    blocks.forEach((b, i) => {
      const L = ly.lines[b.line];
      const start = L.start + off;
      // too small to read when framed whole? frame each row separately
      const k = frame(b.x0, b.y0, b.x1, b.y1);
      const heroPx = HC * k.z;
      const prev = blocks[i - 1];
      if (prev && prev.sec !== b.sec && this.p.recordPullback) {
        const gapT = start - (ly.lines[prev.line].end + off);
        const col = blocks.filter(o => o.sec === prev.sec);
        const rec = frame(Math.min(...col.map(c => c.x0)), Math.min(...col.map(c => c.y0)), Math.max(...col.map(c => c.x1)), Math.max(...col.map(c => c.y1)), .9);
        rec.z = Math.min(rec.z, k.z * .6);
        const tRec = ly.lines[prev.line].end + off + Math.min(.9, Math.max(.3, gapT * .4));
        if (tRec < start - .5) { keys.push({ ...rec, t: tRec }); keys.push({ ...rec, t: Math.max(tRec + .2, start - .9), z: rec.z * 1.02 }); }
      }
      if (heroPx < H * .085) {
        const rows = new Map<number, Item[]>();
        for (const it of this.items) if (it.line === b.line) { if (!rows.has(it.y)) rows.set(it.y, []); rows.get(it.y)!.push(it); }
        for (const [, row] of rows) {
          const r0 = row[0].w!.start + off;
          const kk = frame(b.x0, row[0].y - Math.max(...row.map(r => r.cap)) * 1.3, b.x1, row[0].y + HC * .2, .86);
          keys.push({ ...kk, t: r0 - .3 });
        }
      } else keys.push({ ...k, t: start - .32 });
      const drift = energy * .04;
      const last = keys[keys.length - 1];
      keys.push({ ...last, t: Math.max(last.t + .3, L.end + off - .1), z: last.z * (1 + drift), cx: last.cx + (i % 2 ? 1 : -1) * drift * 400 });
    });
    // ending: the whole record
    const endT = (ly.lines[ly.lines.length - 1]?.end ?? 0) + off;
    const all = frame(0, -HC, this.world.w, this.world.h + HC * .3, .92);
    const dur = song.analysis.duration;
    if (endT + .8 < dur) { keys.push({ ...all, t: Math.min(dur - .5, endT + .8 + Math.min(2.2, (dur - endT) * .4)) }); keys.push({ ...all, t: dur, z: all.z * 1.03 }); }
    keys.sort((x, y) => x.t - y.t);
    // de-duplicate keys closer than 1 frame
    this.keys = keys.filter((k, i) => i === 0 || k.t - keys[i - 1].t > 1 / 120);
  }

  render(t: number, out: CanvasRenderingContext2D) {
    const gl = this.gl, { width: W, height: H, song } = this.ctx, a = song.analysis;
    const cam = camAt(this.keys, t);
    const pal = PALETTES[String(this.p.palette)] ?? PALETTES.soot;
    const gs = this.ctx.settings;
    const inten = Number(this.p.intensity) * gs.intensity / 100, react = Number(this.p.reactivity) * gs.reactivity / 100;
    const fade = clamp((t - (a.duration - 0.6)) / 0.55);
    // visible items
    const vx0 = cam.cx - W / 2 / cam.z, vx1 = cam.cx + W / 2 / cam.z, vy0 = cam.cy - H / 2 / cam.z, vy1 = cam.cy + H / 2 / cam.z;
    const vis: Item[] = [];
    for (const it of this.items) {
      if (it.wx0 > vx1 + 200 || it.wx0 + it.ww < vx0 - 200 || it.wy0 > vy1 + 200 || it.wy0 + it.wh < vy0 - 200) continue;
      vis.push(it); if (vis.length >= MAXW) break;
    }
    const D = this.dataBuf; D.fill(0);
    const row = (r: number) => D.subarray(r * MAXW * 4, (r + 1) * MAXW * 4);
    const R = row(0), U = row(1), S = row(2), E = row(3), X = row(4);
    const off = this.ctx.settings.syncOffsetMs / 1000, ant = this.ctx.settings.anticipationMs / 1000;
    let light: Item | null = null, lightAmt = 0, windAmt = 0, rainAmt = 0; const vorts: number[][] = []; const fires: Item[] = [];
    vis.forEach((it, i) => {
      const w = it.w!; const s0 = w.start + off;
      let rev: number, rise = 0, alpha = 1;
      if (it.style === 2) {
        rev = it.el === 4 ? (t >= s0 ? 1 : 0) : it.el === 2 || it.el === 3 || it.el === 8 || it.el === 9 ? (t >= it.actStart ? 1 : 0) : eOut(prog(t, s0 - ant - .5, s0));
        if (it.el === 0) rev = eOut(prog(t, s0 - ant - .2, s0));
      } else { rev = eOut(prog(t, s0 - ant - .12, s0)); rise = (1 - rev) * it.cap * .3; }
      const act = it.style === 2 ? clamp(Math.min(prog(t, it.actStart, it.actStart + .5), 1 - prog(t, it.actEnd, it.actEnd + 1.1))) : 0;
      const res = it.style === 2 ? prog(t, it.actEnd - .2, it.actEnd + 1.0) : 0;
      R.set([it.wx0, it.wy0, it.wx0 + it.ww, it.wy0 + it.wh], i * 4);
      U.set([it.sdf.ax, it.sdf.ay, it.sdf.ax + it.sdf.w, it.sdf.ay + it.sdf.h], i * 4);
      S.set([it.style, rev, it.k, it.cap], i * 4);
      E.set([it.el, act, res, it.y], i * 4);
      X.set([it.seed, t - s0, rise, alpha], i * 4);
      if (it.el === 1 && act > lightAmt) { lightAmt = act; light = it; (light as Item & { idx?: number }).idx = i; }
      if (it.el === 5) windAmt = Math.max(windAmt, act);
      if (it.el === 3) rainAmt = Math.max(rainAmt, act);
      if (it.el === 6 && act > 0) vorts.push([it.x + it.adv / 2, it.y - it.cap / 2, Math.max(it.adv * .6, it.cap * 2), 2.4 * act * (t < it.actEnd ? 1 : -.3)]);
      if (it.el === 2 && act > .05) fires.push(it);
    });
    // tiles: up to 8 words per 32px screen tile
    this.tileBuf0.fill(0); this.tileBuf1.fill(0);
    const [TX, TY] = this.tilesN; const cnt = new Uint8Array(TX * TY);
    vis.forEach((it, i) => {
      const reach = it.cap * (it.el === 2 || it.el === 9 ? .9 : .4) + 140;
      const sx0 = (it.wx0 - reach - cam.cx) * cam.z + W / 2, sx1 = (it.wx0 + it.ww + reach - cam.cx) * cam.z + W / 2;
      const sy0 = (it.wy0 - reach - cam.cy) * cam.z + H / 2, sy1 = (it.wy0 + it.wh + reach - cam.cy) * cam.z + H / 2;
      const x0 = Math.max(0, Math.floor(sx0 / 32)), x1 = Math.min(TX - 1, Math.floor(sx1 / 32)), y0 = Math.max(0, Math.floor(sy0 / 32)), y1 = Math.min(TY - 1, Math.floor(sy1 / 32));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const c = y * TX + x, n = cnt[c]; if (n >= 8) continue; (n < 4 ? this.tileBuf0 : this.tileBuf1)[c * 4 + (n % 4)] = i + 1; cnt[c] = n + 1; }
    });
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog.p);
    const u = this.prog.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlas); gl.uniform1i(u.uA, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tiles[0]); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TX, TY, gl.RGBA, gl.UNSIGNED_BYTE, this.tileBuf0); gl.uniform1i(u.uT0, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.tiles[1]); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TX, TY, gl.RGBA, gl.UNSIGNED_BYTE, this.tileBuf1); gl.uniform1i(u.uT1, 2);
    gl.uniform2f(u.uTN, TX, TY); gl.uniform2f(u.uRes, W, H); gl.uniform2f(u.uAS, this.atlasW, this.atlasH);
    gl.uniform4f(u.uCam, cam.cx, cam.cy, cam.z, t);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.dataTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAXW, 5, gl.RGBA, gl.FLOAT, D); gl.uniform1i(u.uD, 3);
    // audio
    const beatIdx = lastIndexLE(a.beats, t), lastBeat = beatIdx >= 0 ? a.beats[beatIdx] : -9;
    const pulse = Math.exp(-(t - lastBeat) * 7);
    gl.uniform4f(u.uAud, sample(a.bands.bass, t), sample(a.bands.mid, t), sample(a.bands.high, t), sample(a.loud, t));
    gl.uniform4f(u.uAud2, pulse, sample(a.flux, t), sample(a.centroid, t), react);
    const L = light as (Item & { idx?: number }) | null;
    gl.uniform4f(u.uLight, L ? L.x + L.adv / 2 : 0, L ? L.y - L.cap / 2 : 0, L ? L.adv * .5 : 1, lightAmt * inten); gl.uniform1i(u.uLightW, L ? L.idx! : -1);
    gl.uniform4f(u.uRain, rainAmt * (0.6 + 0.6 * sample(a.bands.high, t) * react), t, windAmt > .05 ? -0.52 : 0, Number(this.p.rain) * 1.8);
    // waves (the three most recent shocks)
    const W4 = new Float32Array(12); let flash = 0; let k = 0;
    for (let i = this.shocks.length - 1; i >= 0 && k < 3; i--) {
      const sh = this.shocks[i]; const dt = t - sh.t; if (dt < 0 || dt > 2.4) continue;
      W4.set([sh.x, sh.y, dt * 2600, 70 * Math.exp(-dt * 1.1) * inten], k * 4); k++;
      if (this.p.shockFlash && sh.strong && dt < 4 / 60) flash = Math.max(flash, 1 - dt / (4 / 60) * .4);
    }
    gl.uniform4fv(u.uWave, W4);
    const V4 = new Float32Array(8); vorts.slice(0, 2).forEach((v, i) => V4.set(v, i * 4)); gl.uniform4fv(u.uVort, V4);
    // quakes (persistent): nearest three to the camera that have begun
    const Q = new Float32Array(12), Q2 = new Float32Array(12);
    this.quakes.filter(q => t >= q.t - .1).sort((x, y) => Math.hypot(x.x - cam.cx, x.y - cam.cy) - Math.hypot(y.x - cam.cx, y.y - cam.cy)).slice(0, 3).forEach((q, i) => {
      const shake = prog(t, q.t - .05, q.t + .15) * (1 - prog(t, q.t + .5, q.t + 1.6));
      const lock = eIO(prog(t, q.t + .3, q.t + 1.6));
      Q.set([q.x, q.y, q.R, shake * inten], i * 4); Q2.set([lock * Number(this.p.persistence) * inten, q.seed, prog(t, q.t, q.t + .2) * (1 - .6 * prog(t, q.t + 1.6, q.t + 3)), 0], i * 4);
    });
    gl.uniform4fv(u.uQk, Q); gl.uniform4fv(u.uQk2, Q2);
    gl.uniform4f(u.uMisc, windAmt * inten, flash, fade, fade * 40);
    gl.uniform3fv(u.uBg0, pal.bg0); gl.uniform3fv(u.uBg1, pal.bg1); gl.uniform3fv(u.uPaper, pal.paper); gl.uniform3fv(u.uCold, pal.cold); gl.uniform3fv(u.uSlate, pal.slate);
    gl.uniform1f(u.uPersist, Number(this.p.persistence)); gl.uniform1f(u.uInt, inten);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    // sparks over the most active fire word
    const nSp = Math.round(Number(this.p.sparks));
    if (fires.length && nSp > 0) {
      const f = fires[fires.length - 1];
      const amt = clamp(Math.min(prog(t, f.actStart + .2, f.actStart + .5), 1 - prog(t, f.actEnd - .3, f.actEnd + .6))) * inten;
      if (amt > 0) {
        gl.useProgram(this.progSp.p); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.uniform4f(this.progSp.u.uCam, cam.cx, cam.cy, cam.z, t); gl.uniform2f(this.progSp.u.uRes, W, H);
        gl.uniform4f(this.progSp.u.uBox, f.x, f.y - f.cap, f.x + f.adv, f.y); gl.uniform1f(this.progSp.u.uAmt, amt);
        gl.bindVertexArray(this.spVao); gl.drawArrays(gl.POINTS, 0, nSp); gl.disable(gl.BLEND);
      }
    }
    gl.bindVertexArray(null);
    out.drawImage(this.cv, 0, 0, W, H);
  }

  dispose() { const gl = this.gl; if (!gl) return; gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}

function audioElement(w: Word, a: EffectContext['song']['analysis']): ElementKind {
  const t = w.start;
  const flux = sample(a.flux, t), loud = sample(a.loud, t), cen = sample(a.centroid, t), hi = sample(a.bands.high, t), mid = sample(a.bands.mid, t);
  if (a.drops.some(d => Math.abs(d - t) < 1)) return 'quake';
  if (flux > .75) return 'shock';
  if (loud > .65 && mid > .55) return 'fire';
  if (loud < .35 && cen > .5) return 'light';
  if (hi > .6) return 'water';
  if (cen > .6) return 'wind';
  return (['light', 'fire', 'water', 'smoke', 'ice', 'wind'] as ElementKind[])[w.id % 6];
}

export const ElementsFactory: EffectFactory = { id: 'elements', name: 'Elements', description: 'Words become fire, light, water, thunder, wind, vortex, quake, ice and smoke.', params: PARAMS, create: () => new ElementsEffect() };
void lerp;

// SWARM — a conserved crowd of N particles builds every line. Nothing is created or destroyed.
// Formations are sampled from the text, paired along a Hilbert curve to minimise travel, and all motion
// is closed-form in the vertex shader (curved paths, x-staggered departures, wobble, beat breath, settle,
// drop explosions). Words light up as they are sung.
import type { ParamSpec, Params, Word } from '../types';
import { type Effect, type EffectContext, type EffectFactory, clamp, rng, defaults, displayText } from './types';
import { fontCSS, capRatio } from '../render/sdf';
import { compile } from '../render/gl';
import { sample } from '../analysis/dsp';

const PARAMS: ParamSpec[] = [
  { key: 'count', label: 'Particles', group: 'Swarm', type: 'range', min: 5000, max: 80000, step: 1000, default: 30000, help: 'Population size (fixed for the whole song)', live: false },
  { key: 'look', label: 'Particle look', group: 'Swarm', type: 'select', options: ['dot', 'star', 'petal', 'human', 'confetti'], default: 'dot', help: 'Shape of each particle', live: true },
  { key: 'size', label: 'Size', group: 'Swarm', type: 'range', min: 0.5, max: 4, step: 0.05, default: 1.6, help: 'Particle size', live: true },
  { key: 'trail', label: 'Trail samples', group: 'Swarm', type: 'range', min: 0, max: 6, step: 1, default: 2, help: 'Motion trail (deterministic multi-sample)', live: true },
  { key: 'travel', label: 'Travel time (beats)', group: 'Motion', type: 'range', min: 0.5, max: 4, step: 0.25, default: 1.5, help: 'How long a re-formation takes', live: true },
  { key: 'stagger', label: 'Stagger', group: 'Motion', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45, help: 'Departures staggered left → right', live: true },
  { key: 'curve', label: 'Path curve', group: 'Motion', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, help: 'How far paths bow sideways', live: true },
  { key: 'wobble', label: 'Wobble', group: 'Motion', type: 'range', min: 0, max: 1, step: 0.01, default: 0.35, help: 'Idle drift', live: true },
  { key: 'breath', label: 'Beat breath', group: 'Music', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, help: 'Radial pulse with the bass on beats', live: true },
  { key: 'quantize', label: 'Quantize to 1/8 beat', group: 'Music', type: 'toggle', default: true, help: 'Formations change on the 1/8-beat grid', live: false },
  { key: 'explode', label: 'Explode on drops', group: 'Music', type: 'toggle', default: true, help: 'Burst outward on drops, re-form on the next downbeat', live: true },
  { key: 'palette', label: 'Palette', group: 'Look', type: 'select', options: ['ember', 'ice', 'gold', 'mono', 'neon'], default: 'ember', help: 'Colours; choruses switch to the accent', live: true },
  { key: 'dust', label: 'Waiting dust', group: 'Look', type: 'range', min: 0, max: 0.4, step: 0.01, default: 0.12, help: 'Share of particles waiting in the margins', live: false }
];

const PALS: Record<string, { bg: number[]; a: number[]; b: number[]; accent: number[]; dim: number[] }> = {
  ember: { bg: [.03, .025, .03], a: [1, .93, .82], b: [1, .55, .2], accent: [1, .32, .18], dim: [.35, .28, .26] },
  ice: { bg: [.015, .03, .05], a: [.86, .95, 1], b: [.45, .75, 1], accent: [.55, 1, .95], dim: [.2, .3, .4] },
  gold: { bg: [.03, .025, .015], a: [1, .95, .78], b: [1, .78, .35], accent: [1, .88, .5], dim: [.35, .3, .2] },
  mono: { bg: [.02, .02, .02], a: [1, 1, 1], b: [.8, .8, .8], accent: [1, 1, 1], dim: [.3, .3, .3] },
  neon: { bg: [.02, .01, .04], a: [.98, .9, 1], b: [1, .25, .65], accent: [.2, .95, 1], dim: [.3, .2, .4] }
};

const VS = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray uF;          // RGBA32F per formation: x, y, word index, role (-1 = dust)
uniform int uS; uniform int uN;
uniform vec4 uA;                    // layer from, layer to, t0, dur
uniform vec4 uT;                    // t, trail dt, aspect, size px
uniform vec4 uM;                    // stagger, curve, wobble, breath*pulse
uniform vec4 uX;                    // explode amount, current word idx, reveal edge, chorus
uniform vec4 uC;                    // cam zoom, cam rot, cam x, cam y
uniform int uTrail;
out vec4 vCol; out float vSeed; out float vRole;
uniform vec3 uColA, uColB, uAcc, uDim;
float h(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
vec4 fetchF(int layer, int i){ return texelFetch(uF, ivec3(i % uS, i / uS, layer), 0); }
float eio(float p){ return p < .5 ? 4. * p * p * p : 1. - pow(-2. * p + 2., 3.) / 2.; }
void main(){
  int i = gl_VertexID % uN; int k = gl_VertexID / uN;
  float fi = float(i);
  float t = uT.x - float(k) * uT.y;
  vec4 A = fetchF(int(uA.x), i), B = fetchF(int(uA.y), i);
  // x-staggered departure along a seeded curved path, with a small arrival settle
  float st = (A.x / max(uT.z, 1.) * .5 + .5) * uM.x * uA.w * .6;
  float dur = uA.w * (1. - uM.x * .6);
  float q = clamp((t - uA.z - st) / max(dur, .01), 0., 1.);
  float e = eio(q);
  vec2 d = B.xy - A.xy; vec2 nrm = vec2(-d.y, d.x);
  float bow = (h(fi * 1.7 + 3.) - .5) * 2. * uM.y;
  vec2 p = mix(A.xy, B.xy, e) + nrm * bow * sin(3.14159 * e) * .6;
  p += normalize(d + 1e-5) * sin(clamp(q * 1.25 - .25, 0., 1.) * 3.14159) * 0.0 ;
  float settle = q >= 1. ? 0. : sin(q * 3.14159) * (1. - q);
  // idle wobble (smooth, seeded)
  float w = uM.z * .012;
  p += w * vec2(sin(t * (.7 + h(fi) * .9) + fi), cos(t * (.6 + h(fi + 5.) * .8) + fi * 1.3));
  // beat breath
  p *= 1. + uM.w * .05 * (.5 + h(fi + 9.));
  // explosion on drops
  if (uX.x > 0.) { float a = h(fi + 2.) * 6.2832; float r = (.15 + .85 * h(fi + 4.) * h(fi + 6.)) * uX.x; p += vec2(cos(a), sin(a)) * r + vec2(0., -.25) * uX.x * uX.x; }
  // camera
  float cr = cos(uC.y), sr = sin(uC.y);
  p = mat2(cr, -sr, sr, cr) * (p - uC.zw) * uC.x;
  gl_Position = vec4(p.x / uT.z, -p.y, 0., 1.);
  float role = B.w;
  vRole = role;
  float sung = step(B.z, uX.y + .5);
  vec3 col = role < -.5 ? uDim * .7 : mix(uDim * 1.4, role > 1.5 ? mix(uColB, uAcc, uX.w) : uColA, mix(.25, 1., sung));
  float tw = .75 + .25 * sin(t * 3. + fi);
  float trailA = 1. / (1. + float(k) * 1.4);
  vCol = vec4(col * tw, (role < -.5 ? .35 : 1.) * trailA * (k > 0 ? .6 : 1.));
  vSeed = h(fi + 11.);
  gl_PointSize = uT.w * (role > 1.5 ? 1.25 : 1.) * (1. + settle * .5) * (role < -.5 ? .7 : 1.);
}`;

const FS = `#version 300 es
precision highp float;
in vec4 vCol; in float vSeed; in float vRole; out vec4 o;
uniform int uLook;
void main(){
  vec2 c = gl_PointCoord * 2. - 1.;
  float a = 0.;
  if (uLook == 0) a = smoothstep(1., .2, length(c));
  else if (uLook == 1) { float r = length(c); float ang = atan(c.y, c.x); a = smoothstep(.55 + .45 * pow(abs(cos(ang * 2.)), 8.), .1, r); }
  else if (uLook == 2) { float an = vSeed * 6.28; vec2 q = mat2(cos(an), -sin(an), sin(an), cos(an)) * c; a = smoothstep(1., .7, length(q * vec2(1., 2.2))); }
  else if (uLook == 3) { float head = smoothstep(.32, .2, length(c - vec2(0., -.55))); float body = step(abs(c.x), .3 - c.y * .12) * step(-.25, c.y) * step(c.y, .55); float legs = step(abs(abs(c.x) - .15), .08) * step(.5, c.y) * step(c.y, 1.); a = max(head, max(body, legs)); }
  else { float an = vSeed * 6.28; vec2 q = mat2(cos(an), -sin(an), sin(an), cos(an)) * c; a = step(abs(q.x), .8) * step(abs(q.y), .45); }
  if (a < .01) discard;
  vec3 col = vCol.rgb;
  if (uLook == 4) col *= mix(vec3(1.), vec3(.6 + .4 * sin(vSeed * 40.), .6 + .4 * sin(vSeed * 53.), .6 + .4 * sin(vSeed * 71.)), .6);
  o = vec4(col * a * vCol.a, a * vCol.a);
}`;

const BG_FS = `#version 300 es
precision highp float; uniform vec2 uRes; uniform vec3 uBg; uniform float uPulse; out vec4 o;
void main(){ vec2 u = gl_FragCoord.xy / uRes - .5; u.x *= uRes.x / uRes.y; float v = 1. - smoothstep(.2, 1.1, length(u)); o = vec4(uBg * (.55 + .9 * v) * (1. + uPulse * .25), 1.); }`;

interface Formation { t0: number; dur: number; line: number; words: Word[]; chorus: boolean }

class SwarmEffect implements Effect {
  readonly id = 'swarm'; readonly name = 'Swarm'; readonly description = 'A fixed crowd of particles builds every line, flows between formations, breathes with the bass and explodes on drops.';
  readonly params = PARAMS;
  private p: Params = defaults(PARAMS);
  private ctx!: EffectContext;
  private cv!: HTMLCanvasElement; private gl!: WebGL2RenderingContext;
  private prg!: ReturnType<typeof compile>; private bg!: ReturnType<typeof compile>;
  private tex: WebGLTexture | null = null; private vao!: WebGLVertexArrayObject;
  private N = 0; private S = 0; private forms: Formation[] = []; private starts: number[] = [];

  async prepare(ctx: EffectContext) {
    this.ctx = ctx; this.p = { ...defaults(PARAMS), ...ctx.params };
    if (!this.gl) {
      this.cv = document.createElement('canvas');
      const gl = this.cv.getContext('webgl2', { antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true }); if (!gl) throw new Error('WebGL2 is not available');
      this.gl = gl; this.prg = compile(gl, VS, FS);
      this.bg = compile(gl, `#version 300 es\nvoid main(){ vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); gl_Position = vec4(p, 0., 1.); }`, BG_FS);
      this.vao = gl.createVertexArray()!;
    }
    this.cv.width = ctx.width; this.cv.height = ctx.height;
    this.build();
  }
  setParams(p: Params) { this.p = { ...this.p, ...p }; }
  dispose() { this.gl?.getExtension('WEBGL_lose_context')?.loseContext(); }

  /** Grid on which formations change (1/8 beat = half a beat in 4/4). */
  private quant(t: number) {
    if (!this.p.quantize) return t; const B = this.ctx.song.analysis.beats; if (B.length < 2) return t;
    let lo = 0, hi = B.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (B[m] <= t) lo = m; else hi = m; }
    const a = B[lo], b = B[hi], half = (b - a) / 2; const g = [a, a + half, b]; return g.reduce((x, y) => Math.abs(y - t) < Math.abs(x - t) ? y : x);
  }

  private build() {
    const { song, settings, width: W, height: H } = this.ctx; const ly = song.lyrics, an = song.analysis;
    const off = settings.syncOffsetMs / 1000, aspect = W / H;
    const N = Math.round(Number(this.p.count)); this.N = N; this.S = Math.ceil(Math.sqrt(N));
    const beat = an.bpm > 0 ? 60 / an.bpm : .5, travel = Number(this.p.travel) * beat;
    // formation list: intro cloud, one per line (with cloud breaks in long gaps), outro cloud
    const forms: Formation[] = [{ t0: -10, dur: 1, line: -1, words: [], chorus: false }];
    ly.lines.forEach((L, i) => {
      if (!L.words.length) return;
      const prev = ly.lines[i - 1];
      if (prev && L.start - prev.end > 5) forms.push({ t0: this.quant(prev.end + off + 1), dur: travel * 1.5, line: -1, words: [], chorus: false });
      const t0 = this.quant(L.start + off - travel * .75);
      const lab = an.sections[L.section]?.label;
      forms.push({ t0: Math.max(t0, (forms[forms.length - 1]?.t0 ?? -10) + .2), dur: travel, line: i, words: L.words.map(id => ly.words[id]), chorus: lab === 'chorus' || lab === 'drop' });
    });
    const last = ly.lines[ly.lines.length - 1];
    if (last) forms.push({ t0: this.quant(last.end + off + 1.2), dur: travel * 2, line: -1, words: [], chorus: false });
    this.forms = forms; this.starts = forms.map(f => f.t0);

    // sample every formation into N targets, chained by Hilbert pairing
    const S = this.S, L = forms.length, data = new Float32Array(S * S * 4 * L);
    const R = rng(settings.seed * 31 + 7);
    const dustFrac = Number(this.p.dust);
    let prevPos: Float32Array | null = null;
    const raster = document.createElement('canvas'); const RW = 900, RH = Math.round(RW / aspect); raster.width = RW; raster.height = RH;
    const rc = raster.getContext('2d', { willReadFrequently: true })!;
    forms.forEach((f, fi) => {
      let pts: { x: number; y: number; w: number; role: number }[] = [];
      if (f.line >= 0) pts = this.sampleText(rc, RW, RH, f.words, aspect, settings.caseMode, R);
      const nText = f.line >= 0 && pts.length ? Math.round(N * (1 - dustFrac)) : 0;
      const targets = new Float32Array(N * 4);
      for (let k = 0; k < N; k++) {
        if (k < nText) { const q = pts[Math.floor(R() * pts.length)]; targets.set([q.x + (R() - .5) * 2 / RW * aspect, q.y + (R() - .5) * 2 / RW * aspect, q.w, q.role], k * 4); }
        else if (f.line >= 0) { // dust: a soft band around the frame edge
          const a = R() * Math.PI * 2, r = .82 + R() * .5; targets.set([Math.cos(a) * r * aspect, Math.sin(a) * r, -1, -1], k * 4);
        } else { // cloud: a slowly spinning galaxy disc
          const r = Math.pow(R(), .6) * .9, arm = Math.floor(R() * 3), a = arm * 2.094 + r * 5 + (R() - .5) * .6;
          targets.set([Math.cos(a) * r * aspect * .55, Math.sin(a) * r * .55, -1, fi === 0 ? 0 : 1], k * 4);
        }
      }
      // Hilbert pairing with the previous formation
      const order = (arr: Float32Array, n: number) => { const keys = new Float64Array(n); for (let k = 0; k < n; k++) keys[k] = hilbert(arr[k * (arr === targets ? 4 : 2)] / aspect, arr[k * (arr === targets ? 4 : 2) + 1]); return Array.from({ length: n }, (_, k) => k).sort((x, y) => keys[x] - keys[y]); };
      const pos = new Float32Array(N * 2);
      const layer = new Float32Array(S * S * 4);
      if (!prevPos) { for (let k = 0; k < N; k++) { layer.set(targets.subarray(k * 4, k * 4 + 4), k * 4); pos[k * 2] = targets[k * 4]; pos[k * 2 + 1] = targets[k * 4 + 1]; } }
      else {
        const po = order(prevPos, N), to = order(targets, N);
        for (let r = 0; r < N; r++) { const pi = po[r], ti = to[r]; layer.set(targets.subarray(ti * 4, ti * 4 + 4), pi * 4); pos[pi * 2] = targets[ti * 4]; pos[pi * 2 + 1] = targets[ti * 4 + 1]; }
        // local swaps: a few passes over neighbours in Hilbert order reduce crossings
        for (let pass = 0; pass < 2; pass++) for (let r = 0; r + 1 < N; r++) {
          const a = po[r], b = po[r + 1];
          const d0 = dist2(prevPos, a, pos, a) + dist2(prevPos, b, pos, b), d1 = dist2(prevPos, a, pos, b) + dist2(prevPos, b, pos, a);
          if (d1 < d0) { swap4(layer, a, b); const tx = pos[a * 2], ty = pos[a * 2 + 1]; pos[a * 2] = pos[b * 2]; pos[a * 2 + 1] = pos[b * 2 + 1]; pos[b * 2] = tx; pos[b * 2 + 1] = ty; }
        }
      }
      data.set(layer, fi * S * S * 4);
      prevPos = pos;
    });
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA32F, S, S, L, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  /** Lay a line out (wrapped, centred) and return ink sample points in frame units (y ∈ [-1,1]). */
  private sampleText(c: CanvasRenderingContext2D, RW: number, RH: number, words: Word[], aspect: number, caseMode: string, R: () => number) {
    const txt = words.map(w => displayText(w.display, caseMode === 'lower' ? 'lower' : caseMode === 'as-is' ? 'as-is' : 'upper'));
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, RW, RH);
    // choose rows: greedy wrap at a width that keeps 1–3 rows; heroes bigger
    const maxW = RW * .86;
    let cap = RH * .2;
    const lay = () => {
      const rows: { i: number; x: number; w: number; cap: number }[][] = [[]]; let x = 0;
      txt.forEach((s, i) => { const cp = cap * (words[i].role === 'hero' ? 1.25 : words[i].role === 'connective' ? .7 : 1); c.font = fontCSS('cond', cp / capRatio('cond')); const w = c.measureText(s).width; const gap = cap * .3; if (x && x + gap + w > maxW) { rows.push([]); x = 0; } rows[rows.length - 1].push({ i, x: x ? x + gap : 0, w, cap: cp }); x = (x ? x + gap : 0) + w; });
      return rows;
    };
    let rows = lay();
    for (let it = 0; it < 12; it++) { const hh = rows.reduce((s, r) => s + Math.max(...r.map(q => q.cap)) * 1.3, 0); if (hh < RH * .7 && rows.length <= 3) break; cap *= .88; rows = lay(); }
    const rowH = rows.map(r => Math.max(...r.map(q => q.cap)) * 1.3), total = rowH.reduce((a, b) => a + b, 0);
    let y = (RH - total) / 2;
    const roleOf = (w: Word) => w.role === 'hero' ? 2 : w.role === 'support' ? 1 : 0;
    const boxes: { i: number; x0: number; x1: number; y0: number; y1: number }[] = [];
    rows.forEach((r, ri) => {
      const rw = r[r.length - 1].x + r[r.length - 1].w, x0 = (RW - rw) / 2; y += rowH[ri];
      for (const q of r) { c.font = fontCSS('cond', q.cap / capRatio('cond')); c.fillStyle = '#fff'; c.fillText(txt[q.i], x0 + q.x, y - rowH[ri] * .2); boxes.push({ i: q.i, x0: x0 + q.x, x1: x0 + q.x + q.w, y0: y - rowH[ri] * .2 - q.cap * 1.1, y1: y - rowH[ri] * .2 + q.cap * .3 }); }
    });
    const img = c.getImageData(0, 0, RW, RH).data; const pts: { x: number; y: number; w: number; role: number }[] = [];
    for (let py = 0; py < RH; py += 1) for (let px = 0; px < RW; px += 1) {
      if (img[(py * RW + px) * 4 + 3] < 200) continue;
      if (R() > .6) continue;
      const b = boxes.find(q => px >= q.x0 - 2 && px <= q.x1 + 2 && py >= q.y0 && py <= q.y1) ?? boxes[0];
      pts.push({ x: (px / RW * 2 - 1) * aspect, y: py / RH * 2 - 1, w: b.i, role: roleOf(words[b.i]) });
    }
    return pts;
  }

  render(t: number, out: CanvasRenderingContext2D) {
    const { width: W, height: H, song, settings } = this.ctx; const gl = this.gl, a = song.analysis;
    const pal = PALS[String(this.p.palette)] ?? PALS.ember;
    gl.viewport(0, 0, W, H);
    // background
    gl.disable(gl.BLEND); gl.useProgram(this.bg.p); gl.bindVertexArray(this.vao);
    const bi = lastLE(a.beats, t), pulse = bi >= 0 ? Math.exp(-(t - a.beats[bi]) * 6) : 0;
    const react = settings.reactivity / 100;
    gl.uniform2f(this.bg.u.uRes, W, H); gl.uniform3fv(this.bg.u.uBg, pal.bg); gl.uniform1f(this.bg.u.uPulse, pulse * sample(a.bands.bass, t) * react);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // which formation pair
    let fi = lastLE(this.starts, t); if (fi < 0) fi = 0;
    const F = this.forms[fi], from = Math.max(0, fi - 1);
    // current word within the line
    let wIdx = -1; if (F.line >= 0) { const off = settings.syncOffsetMs / 1000 + settings.anticipationMs / 1000; F.words.forEach((w, k) => { if (w.start - off <= t) wIdx = k; }); }
    // explosion on drops
    let ex = 0;
    if (this.p.explode) for (const d of a.drops) { if (t < d || t > d + 4) continue; const db = Math.min(a.downbeats.find(x => x > d + 60 / Math.max(60, a.bpm)) ?? d + 1, d + 1.1); if (t < db) ex = Math.max(ex, Math.sin(Math.min(1, (t - d) / .35) * Math.PI / 2)); else ex = Math.max(ex, 1 - clamp((t - db) / .6)); ex *= Number(settings.intensity) / 100; }
    // gentle camera
    const camE = settings.cameraEnergy / 100;
    const zoom = 1 + .04 * Math.sin(t * .23) * camE + (F.chorus ? .04 * camE : 0), rot = .03 * Math.sin(t * .17) * camE;
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prg.p); const u = this.prg.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex); gl.uniform1i(u.uF, 0);
    gl.uniform1i(u.uS, this.S); gl.uniform1i(u.uN, this.N);
    gl.uniform4f(u.uA, from, fi, F.t0, F.dur);
    const size = Number(this.p.size) * H / 1080 * 2.2;
    const trail = Math.round(Number(this.p.trail));
    gl.uniform4f(u.uT, t, 1 / 60, W / H, size);
    gl.uniform4f(u.uM, Number(this.p.stagger), Number(this.p.curve), Number(this.p.wobble), Number(this.p.breath) * pulse * sample(a.bands.bass, t) * 2 * react);
    gl.uniform4f(u.uX, ex, wIdx, 0, F.chorus ? 1 : 0);
    gl.uniform4f(u.uC, zoom, rot, 0, 0);
    gl.uniform3fv(u.uColA, pal.a); gl.uniform3fv(u.uColB, pal.b); gl.uniform3fv(u.uAcc, pal.accent); gl.uniform3fv(u.uDim, pal.dim);
    gl.uniform1i(u.uLook, ['dot', 'star', 'petal', 'human', 'confetti'].indexOf(String(this.p.look)));
    gl.drawArrays(gl.POINTS, 0, this.N * (1 + trail));
    gl.bindVertexArray(null);
    out.drawImage(this.cv, 0, 0, W, H);
    const fade = clamp((t - (a.duration - .6)) / .55);
    if (fade > 0) { out.fillStyle = `rgba(0,0,0,${fade})`; out.fillRect(0, 0, W, H); }
  }
}

function lastLE(arr: number[], t: number) { let lo = 0, hi = arr.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; }
function dist2(a: Float32Array, i: number, b: Float32Array, j: number) { const dx = a[i * 2] - b[j * 2], dy = a[i * 2 + 1] - b[j * 2 + 1]; return dx * dx + dy * dy; }
function swap4(arr: Float32Array, a: number, b: number) { for (let k = 0; k < 4; k++) { const v = arr[a * 4 + k]; arr[a * 4 + k] = arr[b * 4 + k]; arr[b * 4 + k] = v; } }
/** Hilbert index of a point in [-1.5,1.5]² on a 1024 grid. */
function hilbert(x: number, y: number) {
  const n = 1024; let px = Math.max(0, Math.min(n - 1, Math.floor((x / 3 + .5) * n))), py = Math.max(0, Math.min(n - 1, Math.floor((y / 3 + .5) * n)));
  let d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (px & s) > 0 ? 1 : 0, ry = (py & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { px = n - 1 - px; py = n - 1 - py; } const tt = px; px = py; py = tt; }
  }
  return d;
}

export const SwarmFactory: EffectFactory = { id: 'swarm', name: 'Swarm', description: 'A fixed crowd of particles builds every line, flows between formations, breathes with the bass and explodes on drops.', params: PARAMS, create: () => new SwarmEffect() };

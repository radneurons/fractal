// SWARM — a conserved particle crowd (SPEC §8.4). N particles build every line; none is created or destroyed.
// Formations live in an RGBA32F texture array indexed by particle; all motion is closed-form in the vertex shader.
// v3: colours can follow chord changes; the galaxy turns once per 8 bars; voice B forms from a second population.
// Reduce motion calms: the drop explosion (off), wobble, breath and the path bow.
import type { Target } from '../render/glhost.ts';
import { GLEffect, type EffectContext, type EffectMeta, range, toggle, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { layoutLine } from './common.ts';
import { makeCanvas } from '../render/sdf.ts';
import { setFont } from '../render/textkit.ts';
import { hexToRgb, GLSL_NOISE } from '../render/gl.ts';
import { mulberry32, nearest, lowerBound, sample, pulse } from '../analysis/dsp.ts';
import { isDuet } from '../lyrics/voices.ts';

const TW = 256;
const PALS: Record<string, [string, string, string, string]> = { // bg, particle, accent, voice B
  ember: ['#0A0605', '#FFB36B', '#FF4A1C', '#7FC8FF'], ice: ['#04080E', '#BFE3FF', '#5AD1FF', '#FFB3D1'], gold: ['#0B0904', '#F2D48A', '#FFF1C2', '#9AD0C2'],
  mono: ['#060606', '#EDEDED', '#FFFFFF', '#9A9A9A'], neon: ['#06040E', '#FF2D75', '#29E3FF', '#B6FF3C'],
};

const VS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2DArray; precision highp sampler2D;
uniform sampler2DArray uForm; uniform sampler2D uWords;
uniform int uA, uB, uN, uLook, uMask, uWordsW;
uniform float uT, uT0, uT1, uStagger, uCurve, uWobble, uBreath, uSize, uAspect, uRotA, uRotB, uGalA, uGalB, uBeat, uBass, uDrop, uReform, uChorus, uChordHue, uHueOn, uTrail, uRM, uRes;
uniform vec3 uCol, uAcc, uColB;
out vec4 vCol; out float vSeed;
float h1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
vec3 hue(float h){ return clamp(abs(fract(h + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
void main(){
  int id = gl_VertexID; float fi = float(id);
  float t = uT - float(gl_InstanceID) / 60.0;
  ivec2 tc = ivec2(id % ${TW}, id / ${TW});
  vec4 pa = texelFetch(uForm, ivec3(tc, uA), 0), pb = texelFetch(uForm, ivec3(tc, uB), 0);
  vec2 a = uGalA > 0.5 ? rot(uRotA) * pa.xy : pa.xy, b = uGalB > 0.5 ? rot(uRotB) * pb.xy : pb.xy;
  float s1 = h1(fi), s2 = h1(fi + 17.3), s3 = h1(fi * 1.7 + 3.1);
  // departure is staggered left → right
  float dur = max(0.05, uT1 - uT0);
  float delay = uStagger * 0.45 * dur * clamp((a.x / uAspect) * 0.5 + 0.5, 0.0, 1.0);
  float u = clamp((t - uT0 - delay) / (dur - uStagger * 0.45 * dur), 0.0, 1.0);
  float e = u * u * (3.0 - 2.0 * u);
  vec2 d = b - a; float dist = length(d);
  vec2 perp = dist > 1e-4 ? vec2(-d.y, d.x) / dist : vec2(0.0);
  vec2 p = mix(a, b, e) + perp * sin(3.14159 * u) * uCurve * (s1 - 0.5) * dist * 0.9 * (1.0 - uRM);
  // a small arrival settle, then idle wobble
  float since = t - uT1;
  p += d * 0.03 * exp(-max(since, 0.0) * 9.0) * cos(since * 26.0) * step(0.0, since) * (1.0 - uRM);
  p += vec2(sin(t * (1.1 + s2) + s1 * 6.28), cos(t * (0.9 + s1) + s2 * 6.28)) * 0.006 * uWobble * (1.0 - 0.7 * uRM);
  // beat breath: radial scale ∝ bass × beat pulse
  p *= 1.0 + 0.045 * uBreath * uBass * uBeat * (1.0 - 0.7 * uRM);
  // drop explosion: ballistic burst along seeded radial directions, re-forming by the next downbeat
  float td = t - uDrop;
  if(td > 0.0 && td < uReform && uRM < 0.5){
    float env = sin(3.14159 * clamp(td / uReform, 0.0, 1.0));
    float ang = s3 * 6.2832; float sp = 0.5 + 1.3 * s2;
    vec2 burst = vec2(cos(ang), sin(ang)) * sp * min(td, 0.5) * 1.6 + vec2(0.0, -1.1 * td * td * 0.6);
    p += burst * env;
  }
  gl_Position = vec4(p.x / uAspect, p.y, 0.0, 1.0);
  // colour: sung words bright, upcoming dim; heroes take the accent in choruses
  float wid = e > 0.5 ? pb.z : pa.z; float role = e > 0.5 ? pb.w : pa.w;
  float lit = 0.25;
  vec3 c = uCol;
  bool voiceB = role > 3.5; float r2 = voiceB ? role - 4.0 : role;
  if(wid >= 0.0){
    float ws = texelFetch(uWords, ivec2(int(wid) % uWordsW, int(wid) / uWordsW), 0).r;
    lit = t >= ws ? 1.0 : 0.25;
    if(r2 > 1.5 && uChorus > 0.5) c = uAcc;
    if(voiceB) c = uColB;
    if(uHueOn > 0.5) c = mix(c, hue(uChordHue) * 0.9 + 0.2, 0.55);
  } else { lit = 0.12 + 0.1 * s1; }
  float trail = 1.0 - float(gl_InstanceID) * uTrail;
  float sz = uSize * (0.6 + 0.8 * s2) * (wid >= 0.0 ? 1.0 : 0.7) * (r2 > 1.5 ? 1.2 : 1.0);
  gl_PointSize = max(1.0, sz * uRes / 720.0 * (uLook == 0 ? 1.0 : 1.9));
  vCol = uMask == 1 ? vec4(vec3(wid >= 0.0 ? 1.0 : 0.0), 1.0) * (gl_InstanceID == 0 ? 1.0 : 0.0) : vec4(c * lit, 1.0) * trail * (0.75 + 0.25 * s3);
  vSeed = s1;
}`;
const FS = `#version 300 es
precision highp float; precision highp int;
uniform int uLook, uMask;
in vec4 vCol; in float vSeed; out vec4 o;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0; float r = length(q); float a = 0.0;
  if(uLook == 0 || uMask == 1) a = smoothstep(1.0, 0.25, r);                         // soft dot
  else if(uLook == 1) a = smoothstep(0.5, 0.0, abs(q.x) * abs(q.y) * 9.0 + r * 0.45); // 4-point star
  else if(uLook == 2){ float an = vSeed * 6.28; vec2 p = mat2(cos(an), -sin(an), sin(an), cos(an)) * q; a = smoothstep(0.1, -0.05, length(p * vec2(1.0, 2.3)) - 0.75); } // petal
  else if(uLook == 3){ float head = smoothstep(0.26, 0.2, length(q - vec2(0.0, -0.55))); float body = step(abs(q.x), 0.3 - 0.05 * q.y) * step(-0.28, q.y) * step(q.y, 0.95); a = max(head, body); } // tiny human
  else { float an = vSeed * 6.28; vec2 p = mat2(cos(an), -sin(an), sin(an), cos(an)) * q; a = step(abs(p.x), 0.8) * step(abs(p.y), 0.35); }                  // confetti
  if(a <= 0.003) discard;
  o = vCol * a;
}`;
const FS_BG = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform vec3 uBg; uniform float uAspect, uT, uOn;
${GLSL_NOISE}
void main(){ float r = length((vUv - 0.5) * vec2(uAspect, 1.0)); vec3 c = mix(uBg * 2.2 + 0.015, uBg * 0.5, smoothstep(0.0, 0.9, r)); c += 0.02 * fbm3(vUv * 4.0 + uT * 0.02); o = vec4(c, 1.0) * uOn; }`;

interface Formation { t0: number; t1: number; galaxy: boolean; line: number }

function hilbert(x: number, y: number): number { // 1024 × 1024 grid
  let d = 0;
  for (let s = 512; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = 1023 - x; y = 1023 - y; } const t = x; x = y; y = t; }
  }
  return d;
}

export class Swarm extends GLEffect {
  static meta: EffectMeta = {
    id: 'swarm', name: 'Swarm', kind: 'gl',
    description: 'A conserved crowd of particles flows from line to line; explodes on drops and rests as a galaxy.',
    affinity: aff(0.95, 0.4, 0.3, 0.35, 0.75, 0.6, 0.6, 0.85),
    supportsTransparent: true, supportsLive: true,
    params: [
      range('count', 'Particle count', 'Particles', 30000, 5000, 80000, 1000, false),
      select('look', 'Look', 'Particles', 'soft dot', ['soft dot', '4-point star', 'petal', 'tiny human', 'confetti']),
      range('size', 'Size', 'Particles', 3.2, 1, 9, 0.1),
      range('trails', 'Trail samples', 'Particles', 3, 1, 8, 1),
      range('travel', 'Travel time (beats)', 'Motion', 2, 0.5, 6, 0.25, false),
      range('stagger', 'Stagger', 'Motion', 0.6, 0, 1, 0.01),
      range('curve', 'Path curve', 'Motion', 0.5, 0, 1.5, 0.01),
      range('wobble', 'Wobble', 'Motion', 1, 0, 3, 0.01),
      range('breath', 'Beat breath', 'Motion', 1, 0, 3, 0.01),
      toggle('quantise', 'Quantise to 1/8 beat', 'Motion', true, false),
      toggle('explode', 'Explode on drops', 'Motion', true),
      select('palette', 'Palette', 'Colour', 'ember', ['ember', 'ice', 'gold', 'mono', 'neon', 'key']),
      toggle('chordColours', 'Colours follow chords', 'Colour', false),
      range('dust', 'Waiting dust', 'Particles', 0.12, 0, 0.5, 0.01, false),
    ],
  };
  readonly meta = Swarm.meta;
  private N = 0;
  private forms: Formation[] = [];
  private tex: WebGLTexture | null = null;
  private wordTex: WebGLTexture | null = null;
  private wordsW = 256;
  private vao: WebGLVertexArrayObject | null = null;

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const gl = this.scope.gl, { W, H } = this, a = this.a, ly = this.ly;
    const N = this.N = Math.round(this.num('count') / TW) * TW;
    const rows = N / TW;
    const asp = W / H;
    const rnd = mulberry32(this.seed * 31 + 7);
    const beat = a.bpm > 0 ? 60 / a.bpm : 0.5;
    const travel = this.num('travel') * beat;
    const grid: number[] = [];
    if (this.bool('quantise')) for (let i = 0; i + 1 < a.beats.length; i++) for (let k = 0; k < 8; k++) grid.push(a.beats[i] + ((a.beats[i + 1] - a.beats[i]) * k) / 8);
    const q = (t: number) => { if (!grid.length) return t; const g = nearest(grid, t); return Number.isNaN(g) ? t : g; };
    // ---- formation list: galaxy for the intro, gaps > 5 s and the outro; one per lyric line ----
    const forms: Formation[] = [{ t0: -10, t1: -9, galaxy: true, line: -1 }];
    ly.lines.forEach((line, i) => {
      const prev = ly.lines[i - 1];
      if (prev && line.start - prev.end > 5) { const tg = q(prev.end + 0.6); forms.push({ t0: tg, t1: tg + travel, galaxy: true, line: -1 }); }
      const t0 = q(line.start - 0.75 * travel - 0.25 * travel);
      forms.push({ t0, t1: Math.min(line.start - 0.02, t0 + travel), galaxy: false, line: i });
    });
    if (ly.lines.length) { const tg = q(ly.lines[ly.lines.length - 1].end + 0.8); forms.push({ t0: tg, t1: tg + travel * 1.5, galaxy: true, line: -1 }); }
    const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
    if (forms.length > maxLayers) forms.length = maxLayers;
    this.forms = forms;
    // ---- targets ----
    const RW = 900, RH = Math.round(900 / asp);
    const rc = makeCanvas(RW, RH);
    const rg = rc.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    const duet = isDuet(ly) && this.s.voicePalette;
    const nB = duet ? Math.floor(N / 4) : 0;
    const dust = this.num('dust');
    const data = new Float32Array(forms.length * N * 4);
    const galaxy = (out: Float32Array, off: number) => {
      for (let i = 0; i < N; i++) {
        const arm = i % 3, r = Math.pow(rnd(), 0.6) * 0.82, ang = arm * 2.094 + r * 5.2 + (rnd() - 0.5) * 0.7 * (1 - r * 0.6);
        out[off + i * 4] = Math.cos(ang) * r * 1.05; out[off + i * 4 + 1] = Math.sin(ang) * r * 0.62; out[off + i * 4 + 2] = -1; out[off + i * 4 + 3] = 0;
      }
    };
    const ringDust = (): [number, number] => { const an = rnd() * 6.2832, rr = 1.02 + rnd() * 0.12; return [Math.cos(an) * asp * rr, Math.sin(an) * rr]; };
    let prevPos: Float32Array | null = null;
    forms.forEach((f, fi) => {
      const off = fi * N * 4;
      const tgt = new Float32Array(N * 4);
      if (f.galaxy) galaxy(tgt, 0);
      else {
        const line = ly.lines[f.line];
        let L = layoutLine(ly, line, { maxW: RW * 0.86, cap: RW * 0.1, heroScale: 1.25, supportScale: 1, connScale: 0.7, fonts: { hero: 'oswald', support: 'oswald', conn: 'oswald' }, caseMode: this.s.caseMode, maxRows: 3, lineGap: 0.32 });
        const k = Math.min(1, (RH * 0.8) / Math.max(1, L.height));
        if (k < 1) L = layoutLine(ly, line, { maxW: RW * 0.86, cap: RW * 0.1 * k, heroScale: 1.25, supportScale: 1, connScale: 0.7, fonts: { hero: 'oswald', support: 'oswald', conn: 'oswald' }, caseMode: this.s.caseMode, maxRows: 4, lineGap: 0.32 });
        rg.clearRect(0, 0, RW, RH);
        rg.textBaseline = 'alphabetic';
        const ox = (RW - L.width) / 2, oy = (RH - L.height) / 2;
        const lineWords = L.words.map((p) => p.w);
        L.words.forEach((p, wi) => { setFont(rg, p.font, p.cap); rg.fillStyle = `rgb(${wi + 1},${p.w.role === 'hero' ? 200 : p.w.role === 'support' ? 100 : 0},${p.w.voice === 'B' ? 255 : 0})`; rg.fillText(p.text, ox + p.x, oy + p.y); });
        const img = rg.getImageData(0, 0, RW, RH).data;
        const inkA: number[] = [], inkB: number[] = [];
        for (let i = 0; i < RW * RH; i++) if (img[i * 4 + 3] > 200) (duet && img[i * 4 + 2] > 128 ? inkB : inkA).push(i);
        const fill = (from: number, to: number, ink: number[]) => {
          for (let i = from; i < to; i++) {
            if (!ink.length || rnd() < dust) { const [dx, dy] = ringDust(); tgt[i * 4] = dx; tgt[i * 4 + 1] = dy; tgt[i * 4 + 2] = -1; tgt[i * 4 + 3] = 0; continue; }
            const pxi = ink[Math.floor(rnd() * ink.length)];
            const x = (pxi % RW) + rnd(), y = Math.floor(pxi / RW) + rnd();
            const wl = img[pxi * 4] - 1, w = lineWords[Math.max(0, Math.min(lineWords.length - 1, wl))];
            tgt[i * 4] = (x / RW * 2 - 1) * asp; tgt[i * 4 + 1] = 1 - (y / RH) * 2;
            tgt[i * 4 + 2] = w.id; tgt[i * 4 + 3] = (w.role === 'hero' ? 2 : w.role === 'support' ? 1 : 0) + (duet && w.voice === 'B' ? 4 : 0);
          }
        };
        fill(0, nB, inkB); fill(nB, N, inkA);
      }
      // ---- pairing: sort previous positions and new targets along a Hilbert curve, then local swaps ----
      if (prevPos) {
        const pp: Float32Array = prevPos;
        const pair = (from: number, to: number) => {
          const n = to - from;
          if (n <= 1) return;
          const key = (arr: Float32Array, i: number) => hilbert(Math.max(0, Math.min(1023, Math.floor(((arr[i * 4] / asp) * 0.42 + 0.5) * 1023))), Math.max(0, Math.min(1023, Math.floor((arr[i * 4 + 1] * 0.42 + 0.5) * 1023))));
          const ia = new Uint32Array(n), ib = new Uint32Array(n), ka = new Float64Array(n), kb = new Float64Array(n);
          for (let i = 0; i < n; i++) { ia[i] = from + i; ib[i] = from + i; ka[i] = key(pp, from + i); kb[i] = key(tgt, from + i); }
          const sa = Array.from(ia).sort((x, y) => ka[x - from] - ka[y - from]), sb = Array.from(ib).sort((x, y) => kb[x - from] - kb[y - from]);
          const d2 = (p: number, t: number) => (pp[p * 4] - tgt[t * 4]) ** 2 + (pp[p * 4 + 1] - tgt[t * 4 + 1]) ** 2;
          for (let pass = 0; pass < 2; pass++) for (let i = pass; i + 1 < n; i += 2) if (d2(sa[i], sb[i + 1]) + d2(sa[i + 1], sb[i]) < d2(sa[i], sb[i]) + d2(sa[i + 1], sb[i + 1])) { const t = sb[i]; sb[i] = sb[i + 1]; sb[i + 1] = t; }
          for (let i = 0; i < n; i++) { const p = sa[i], t = sb[i]; data[off + p * 4] = tgt[t * 4]; data[off + p * 4 + 1] = tgt[t * 4 + 1]; data[off + p * 4 + 2] = tgt[t * 4 + 2]; data[off + p * 4 + 3] = tgt[t * 4 + 3]; }
        };
        pair(0, nB); pair(nB, N);
      } else data.set(tgt, off);
      prevPos = data.subarray(off, off + N * 4);
    });
    // ---- upload ----
    this.tex = this.scope.track(gl.createTexture()!);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA32F, TW, rows, forms.length, 0, gl.RGBA, gl.FLOAT, data);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const nW = Math.max(1, ly.words.length);
    this.wordsW = 256;
    const wh = Math.ceil(nW / 256);
    const wd = new Float32Array(256 * wh * 4);
    ly.words.forEach((w, i) => { wd[i * 4] = w.start - this.s.anticipationMs / 1000; wd[i * 4 + 1] = w.end; });
    this.wordTex = this.scope.texture({ w: 256, h: wh, internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, data: wd, filter: gl.NEAREST });
    this.vao = this.scope.vao();
  }

  protected drawGL(t: number, target: Target, mask: boolean): void {
    const gl = this.scope.gl, a = this.a, { W, H } = this;
    if (!this.tex || !this.N) return;
    let pname = this.str('palette');
    let pal = PALS[pname] ?? PALS.ember;
    if (this.s.paletteSource === 'artwork' && this.ctx.artwork) { const ar = this.ctx.artwork; pal = [ar.darkest, ar.lightest, ar.vivid1, ar.vivid2]; pname = 'art'; }
    if (!mask) this.scope.pass(this.scope.program(FS_BG), target, { uBg: hexToRgb(pal[0]), uAspect: W / H, uT: t, uOn: this.s.transparentBackground ? 0 : 1 });
    // which two formations are we between?
    let fi = 0;
    for (let i = 0; i < this.forms.length; i++) if (this.forms[i].t0 <= t) fi = i;
    const B = this.forms[fi], A = this.forms[Math.max(0, fi - 1)];
    const bars = this.ctx.host ? (() => { const d = a.downbeats; if (d.length < 2) return t / 2; const i = Math.max(0, Math.min(d.length - 2, lowerBound(d, t + 1e-9) - 1)); return i + (t - d[i]) / (d[i + 1] - d[i]); })() : 0;
    const rotNow = (bars / 8) * Math.PI * 2 * (this.s.reduceMotion ? 0.3 : 1);
    // drop: burst peaking 0.35 s after it, re-formed by the next downbeat after one beat (≤ 1.1 s)
    let drop = -99, reform = 1;
    if (this.bool('explode')) for (const d of a.drops) if (t >= d && t < d + 1.2) { drop = d; const beat = 60 / (a.bpm || 120); const nd = a.downbeats.find((x) => x >= d + beat - 1e-3) ?? d + 1; reform = Math.min(1.1, Math.max(0.5, nd - d)); }
    const sec = a.sections.find((s) => t >= s.start && t < s.end);
    const chord = a.chords.find((c) => t >= c.start && t < c.end);
    const prog = this.scope.program(FS, VS);
    this.scope.host.bind(target);
    gl.useProgram(prog.program);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    const r = this.react;
    this.scope.host.setUniforms(prog, {
      uForm: { texArray: this.tex }, uWords: this.wordTex!, uA: { i: Math.max(0, fi - 1) }, uB: { i: fi }, uN: { i: this.N }, uWordsW: { i: this.wordsW },
      uLook: { i: ['soft dot', '4-point star', 'petal', 'tiny human', 'confetti'].indexOf(this.str('look')) }, uMask: { i: mask ? 1 : 0 },
      uT: t, uT0: B.t0, uT1: B.t1, uStagger: this.num('stagger'), uCurve: this.num('curve'), uWobble: this.num('wobble'), uBreath: this.num('breath') * r,
      uSize: this.num('size') * (mask ? 1.25 : 1), uAspect: W / H, uRotA: rotNow, uRotB: rotNow, uGalA: A.galaxy ? 1 : 0, uGalB: B.galaxy ? 1 : 0,
      uBeat: pulse(a.beats, t, 7), uBass: sample(a.bands.bass, t), uDrop: drop, uReform: reform, uChorus: sec && (sec.label === 'chorus' || sec.label === 'drop') ? 1 : 0,
      uChordHue: chord && chord.quality !== 'N' ? ((chord.root * 7) % 12) / 12 : 0, uHueOn: this.bool('chordColours') && chord && chord.quality !== 'N' ? 1 : 0,
      uTrail: 1 / (Math.round(this.num('trails')) + 0.5), uRM: this.s.reduceMotion ? 1 : 0, uRes: H,
      uCol: hexToRgb(pal[1]), uAcc: hexToRgb(pal[2]), uColB: hexToRgb(pal[3]),
    });
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.POINTS, 0, this.N, mask ? 1 : Math.max(1, Math.round(this.num('trails'))));
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    void pname;
  }
}
registerEffect(Swarm);

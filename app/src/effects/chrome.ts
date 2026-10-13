// LIQUID CHROME — ferrofluid typography. Each line is a pool of liquid metal whose letters rise as they
// are sung, grow bass-driven spikes, throw droplets on kicks and melt into the next line (SDF morph with
// a smooth-min bridge). Shading: studio softbox reflections, Fresnel, thin-film iridescence by centroid.
import type { ParamSpec, Params, Word } from '../types';
import { type Effect, type EffectContext, type EffectFactory, clamp, rng, defaults, displayText } from './types';
import { fontCSS, capRatio, sdfFromAlpha } from '../render/sdf';
import { compile, fullscreenTriangle, VS_FULL, GLSL_NOISE } from '../render/gl';
import { sample } from '../analysis/dsp';

const PARAMS: ParamSpec[] = [
  { key: 'tint', label: 'Metal', group: 'Look', type: 'select', options: ['chrome', 'gold', 'rose', 'oil', 'mercury'], default: 'chrome', help: 'Metal tint', live: true },
  { key: 'irid', label: 'Iridescence', group: 'Look', type: 'range', min: 0, max: 1, step: 0.01, default: 0.3, help: 'Thin-film colour (hue follows the music’s brightness)', live: true },
  { key: 'env', label: 'Studio brightness', group: 'Look', type: 'range', min: 0.3, max: 1.8, step: 0.01, default: 1, help: 'Softbox strength', live: true },
  { key: 'spikeH', label: 'Spike height', group: 'Ferrofluid', type: 'range', min: 0, max: 1.5, step: 0.01, default: 0.8, help: 'Bass-driven spikes on the sung word', live: true },
  { key: 'spikeD', label: 'Spike density', group: 'Ferrofluid', type: 'range', min: 0.5, max: 2, step: 0.01, default: 1, help: 'Lattice density of the spikes', live: true },
  { key: 'bassSens', label: 'Bass sensitivity', group: 'Ferrofluid', type: 'range', min: 0, max: 2, step: 0.01, default: 1, help: 'How strongly sub/bass raise the spikes', live: true },
  { key: 'melt', label: 'Melt (beats)', group: 'Motion', type: 'range', min: 0.25, max: 3, step: 0.25, default: 1, help: 'Duration of the melt into the next line', live: false },
  { key: 'droplets', label: 'Droplets per kick', group: 'Motion', type: 'range', min: 0, max: 4, step: 1, default: 3, help: 'Liquid thrown up by kicks', live: true },
  { key: 'tilt', label: 'Tilt (°)', group: 'Camera', type: 'range', min: 0, max: 12, step: 0.5, default: 7, help: 'Slow orbit tilt', live: true },
  { key: 'bg', label: 'Backdrop', group: 'Look', type: 'select', options: ['studio', 'black', 'white'], default: 'studio', help: 'Background', live: true }
];
const TINTS: Record<string, number[]> = { chrome: [.92, .94, .98], gold: [1, .78, .42], rose: [1, .72, .68], oil: [.55, .58, .62], mercury: [.8, .84, .86] };

const MAXD = 12;
const FS = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray uSD; uniform vec2 uRes; uniform vec2 uRaster;
uniform vec4 uP;            // layer A, layer B, melt q, t
uniform vec2 uPool;         // A is pool, B is pool
uniform float uRise[16];    // per word in B: 0..1 risen
uniform float uHero[16];    // per word in B: spike mask (hero & active)
uniform vec4 uAud;          // bass env, centroid, beat pulse, loud
uniform vec4 uK;            // spikeH, spikeDensity, irid, env
uniform vec3 uTint; uniform int uBg;
uniform vec4 uCam;          // zoom, tilt(rad), cx shift, cy shift
uniform vec4 uDrop[${MAXD}];
uniform float uFade;
out vec4 o;
const float SPREAD = 24.;
${GLSL_NOISE}
float smin(float a, float b, float k){ float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }
float poolSD(vec2 px){ vec2 c = uRaster * vec2(.5, .62); vec2 d = (px - c) / (uRaster * vec2(.3, .045)); return (length(d) - 1.) * uRaster.y * .045; }
vec2 layer(float L, float isPool, vec2 uv){
  if (isPool > .5) return vec2(poolSD(uv * uRaster), 0.);
  vec2 v = texture(uSD, vec3(uv, L)).rg;
  return vec2((v.r - .5) * 2. * SPREAD, floor(v.g * 255. / 16.));
}
// field: x = signed distance (raster px), y = height, z = word index
vec3 field(vec2 uv){
  vec2 a = layer(uP.x, uPool.x, uv), b = layer(uP.y, uPool.y, uv);
  float q = uP.z;
  float sd = mix(a.x, b.x, q) - 10. * q * (1. - q) * 4.;     // smooth-min style bridge while melting
  float wi = b.y;
  // droplets (metaballs)
  vec2 px = uv * uRaster;
  for (int k = 0; k < ${MAXD}; k++) { vec4 D = uDrop[k]; if (D.z <= 0.) continue; sd = smin(sd, length(px - D.xy) - D.z, 9.); }
  float depth = clamp(-sd / 7., 0., 1.), deep = clamp(-sd / 20., 0., 1.);
  float dome = (1. - (1. - depth) * (1. - depth)) * .55 + sqrt(deep) * .45;
  int iw = int(wi + .5);
  float rise = q > .5 ? uRise[iw] : 1.;
  float hgt = dome * mix(.22, 1., rise);
  // ferrofluid spikes: hexagonal lattice of cones, masked to the letter core
  float hero = q > .5 ? uHero[iw] : 0.;
  if (hero > 0. && uK.x > 0.) {
    float cell = 20. / uK.y;
    vec2 g = px / cell; g.x += mod(floor(g.y), 2.) * .5;
    vec2 f = fract(g) - .5;
    float cone = max(0., 1. - length(f * vec2(1., 1.15)) * 2.6);
    float mask = smoothstep(.35, .8, deep);
    hgt += cone * cone * mask * uK.x * uAud.x * hero * 1.2;
  }
  return vec3(sd, hgt, wi);
}
vec3 env(vec3 r){
  // chrome studio: bright sky above a sharp horizon, dark floor below, an overhead softbox and two strip lights
  float y = r.y;
  vec3 sky = mix(vec3(.55, .6, .68), vec3(1.15, 1.17, 1.2), smoothstep(0., .7, y));
  vec3 ground = mix(vec3(.10, .09, .085), vec3(.015), smoothstep(0., -.6, y));
  vec3 c = y > 0. ? sky : ground;
  c += vec3(1.) * smoothstep(.035, 0., abs(y - .02)) * .9;                              // horizon line
  c += vec3(1.4) * smoothstep(.06, 0., max(abs(r.x) - .5, abs(y - .62) - .14));        // overhead softbox
  c += vec3(1.1, 1.05, 1.) * smoothstep(.03, 0., abs(r.x - .72)) * step(-.2, y);       // strip lights
  c += vec3(1., 1.05, 1.1) * smoothstep(.03, 0., abs(r.x + .74)) * step(-.2, y) * .8;
  return c * uK.w;
}
void main(){
  vec2 s = gl_FragCoord.xy / uRes; s.y = 1. - s.y;
  // camera: zoom about centre, slight perspective tilt (rotation about the x axis)
  vec2 c = (s - .5);
  float persp = 1. + uCam.y * c.y * 1.6;
  c = vec2(c.x / persp, c.y / persp * cos(uCam.y));
  vec2 uv = c / uCam.x + .5 + uCam.zw;
  vec3 F = field(uv);
  vec2 e = vec2(1. / uRaster.x, 0.);
  float hx = field(uv + e.xy).y - field(uv - e.xy).y, hy = field(uv + e.yx).y - field(uv - e.yx).y;
  vec3 N = normalize(vec3(-hx * 14., hy * 14., 1.));
  // backdrop
  vec3 bg;
  if (uBg == 0) { float v = 1. - smoothstep(.1, 1., length((s - vec2(.5, .45)) * vec2(1.2, 1.))); bg = mix(vec3(.012, .013, .018), vec3(.07, .075, .09), v); bg += vec3(.02) * smoothstep(.62, .64, s.y) * (1. - s.y); }
  else if (uBg == 1) bg = vec3(0.);
  else bg = mix(vec3(.93), vec3(.78), length(s - .5));
  // contact shadow
  float sh = smoothstep(26., -4., field(uv + vec2(-.004, -.012)).x);
  vec3 col = bg * (1. - sh * .55);
  float cov = smoothstep(1.2, -1.2, F.x);
  if (cov > 0.) {
    vec3 V = normalize(vec3(c * .6, 1.));
    vec3 R = reflect(-V, N);
    R.y = R.y * .9 + .08 - .25 * c.y;          // the horizon runs through the middle of the letters
    vec3 m = env(R) * uTint;
    float fres = pow(1. - max(N.z, 0.), 3.);
    float film = F.y * 1.2 + uAud.y * 1.5 + fres * .8;
    vec3 ir = .5 + .5 * cos(6.2832 * (film + vec3(0., .33, .67)));
    m = mix(m, m * ir * 1.9 + ir * .05, uK.z * (.25 + .75 * fres));
    m += fres * .25 * env(N);
    m *= .7 + .3 * min(F.y, 1.);                         // pools (unsung words) are darker
    m += uAud.z * .05;                            // beat glint
    col = mix(col, m, cov);
  }
  o = vec4(col * (1. - uFade), 1.);
}`;

interface State { t0: number; layer: number; pool: boolean; words: Word[]; line: number; chorus: boolean }

class ChromeEffect implements Effect {
  readonly id = 'chrome'; readonly name = 'Liquid Chrome'; readonly description = 'Ferrofluid type: liquid-metal lines rise word by word, spike with the bass, throw droplets on kicks and melt into the next line.';
  readonly params = PARAMS;
  private p: Params = defaults(PARAMS);
  private ctx!: EffectContext;
  private cv!: HTMLCanvasElement; private gl!: WebGL2RenderingContext; private prg!: ReturnType<typeof compile>; private vao!: WebGLVertexArrayObject;
  private tex: WebGLTexture | null = null; private RW = 960; private RH = 540;
  private states: State[] = []; private starts: number[] = []; private meltDur = .5;
  private kicks: number[] = []; private emitters: number[][][] = [];

  async prepare(ctx: EffectContext) {
    this.ctx = ctx; this.p = { ...defaults(PARAMS), ...ctx.params };
    if (!this.gl) {
      this.cv = document.createElement('canvas');
      const gl = this.cv.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true }); if (!gl) throw new Error('WebGL2 is not available');
      this.gl = gl; this.prg = compile(gl, VS_FULL, FS); this.vao = fullscreenTriangle(gl);
    }
    this.cv.width = ctx.width; this.cv.height = ctx.height;
    this.build();
  }
  setParams(p: Params) { this.p = { ...this.p, ...p }; }
  dispose() { this.gl?.getExtension('WEBGL_lose_context')?.loseContext(); }

  private build() {
    const { song, settings, width: W, height: H } = this.ctx; const ly = song.lyrics, a = song.analysis;
    const off = settings.syncOffsetMs / 1000, beat = a.bpm > 0 ? 60 / a.bpm : .5;
    this.meltDur = Number(this.p.melt) * beat;
    const long = 896; this.RW = W >= H ? long : Math.round(long * W / H); this.RH = W >= H ? Math.round(long * H / W) : long;
    const RW = this.RW, RH = this.RH;
    // states
    const st: State[] = [{ t0: -10, layer: 0, pool: true, words: [], line: -1, chorus: false }];
    const lines = ly.lines.filter(L => L.words.length);
    lines.forEach((L, i) => {
      const prev = lines[i - 1];
      if (prev && L.start - prev.end > 4) st.push({ t0: prev.end + off + .8, layer: 0, pool: true, words: [], line: -1, chorus: false });
      const lab = a.sections[L.section]?.label;
      st.push({ t0: Math.max(L.start + off - this.meltDur - .15, st[st.length - 1].t0 + .15), layer: i, pool: false, words: L.words.map(id => ly.words[id]), line: L.idx, chorus: lab === 'chorus' || lab === 'drop' });
    });
    const last = lines[lines.length - 1];
    if (last) st.push({ t0: last.end + off + 1.2, layer: 0, pool: true, words: [], line: -1, chorus: false });
    this.states = st; this.starts = st.map(s => s.t0);
    // rasterise each line → SDF (R) + word index (G)
    const cv = document.createElement('canvas'); cv.width = RW; cv.height = RH; const c = cv.getContext('2d', { willReadFrequently: true })!;
    const data = new Uint8Array(RW * RH * 2 * Math.max(1, lines.length));
    const R = rng(settings.seed * 3 + 1);
    this.emitters = [];
    lines.forEach((L, li) => {
      const ws = L.words.map(id => ly.words[id]);
      const txt = ws.map(w => displayText(w.display, settings.caseMode === 'lower' ? 'lower' : settings.caseMode === 'as-is' ? 'as-is' : 'upper'));
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, RW, RH);
      let cap = RH * .2; const maxW = RW * .8;
      const lay = () => { const rows: { i: number; x: number; w: number }[][] = [[]]; let x = 0; c.font = fontCSS('mont8', cap / capRatio('mont8')); const gap = cap * .32; txt.forEach((s, i) => { const w = c.measureText(s).width; if (x && x + gap + w > maxW) { rows.push([]); x = 0; } rows[rows.length - 1].push({ i, x: x ? x + gap : 0, w }); x = (x ? x + gap : 0) + w; }); return rows; };
      let rows = lay(); for (let it = 0; it < 14 && (rows.length > 3 || rows.length * cap * 1.5 > RH * .62 || rows.some(r => r[r.length - 1].x + r[r.length - 1].w > maxW)); it++) { cap *= .9; rows = lay(); }
      const lh = cap * 1.42, y0 = RH * .5 - (rows.length * lh) / 2 + cap * 1.05;
      const boxes: { i: number; x0: number; x1: number; y: number }[] = [];
      c.fillStyle = '#fff'; c.font = fontCSS('mont8', cap / capRatio('mont8'));
      rows.forEach((r, ri) => { const rw = r[r.length - 1].x + r[r.length - 1].w, x0 = (RW - rw) / 2; for (const q of r) { c.fillText(txt[q.i], x0 + q.x, y0 + ri * lh); boxes.push({ i: q.i, x0: x0 + q.x, x1: x0 + q.x + q.w, y: y0 + ri * lh - cap / 2 }); } });
      const img = c.getImageData(0, 0, RW, RH).data;
      const sd = sdfFromAlpha(img, RW, RH, 24);
      const base = li * RW * RH * 2; const em: number[][] = [];
      for (let py = 0; py < RH; py++) for (let px = 0; px < RW; px++) {
        let bi = 0, bd = 1e9; for (const b of boxes) { const dx = Math.max(b.x0 - px, 0, px - b.x1), dy = Math.abs(py - b.y) * 1.3; const d = dx + dy; if (d < bd) { bd = d; bi = b.i; } }
        const k = py * RW + px; data[base + k * 2] = sd[k]; data[base + k * 2 + 1] = Math.min(15, bi) * 16 + 8;
        if (img[k * 4 + 3] > 200 && R() < .002 && em.length < 24) em.push([px, py]);
      }
      this.emitters.push(em.length ? em : [[RW / 2, RH / 2]]);
    });
    const gl = this.gl; if (this.tex) gl.deleteTexture(this.tex);
    this.tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RG8, RW, RH, Math.max(1, lines.length), 0, gl.RG, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // kicks: strong onsets with bass
    this.kicks = a.onsets.filter((o, i) => a.onsetStrength[i] > .45 && sample(a.bands.bass, o + .02) > .5);
  }

  render(t: number, out: CanvasRenderingContext2D) {
    const { width: W, height: H, song, settings } = this.ctx; const gl = this.gl, a = song.analysis;
    let si = 0; for (let i = 0; i < this.starts.length; i++) if (this.starts[i] <= t) si = i;
    const S = this.states[si], P = this.states[Math.max(0, si - 1)];
    const q = si === 0 ? 1 : clamp((t - S.t0) / this.meltDur);
    const melt = q * q * (3 - 2 * q);
    const rise = new Float32Array(16), hero = new Float32Array(16);
    const ant = settings.anticipationMs / 1000, off = 0;
    S.words.slice(0, 16).forEach((w, k) => {
      const ws = w.start + settings.syncOffsetMs / 1000 - ant;
      rise[k] = clamp((t - ws + .18) / .3);
      const active = t >= ws - .05 && t < Math.max(w.end + settings.syncOffsetMs / 1000, ws + .5) + .4;
      hero[k] = (w.role === 'hero' ? 1 : w.role === 'support' ? .45 : 0) * (active ? 1 : .25);
    });
    void off;
    const react = settings.reactivity / 100, inten = settings.intensity / 100;
    const bassEnv = Math.min(1.4, (sample(a.bands.sub, t) * .5 + sample(a.bands.bass, t)) * Number(this.p.bassSens) * react);
    const bi = lastLE(a.beats, t), pulse = bi >= 0 ? Math.exp(-(t - a.beats[bi]) * 8) : 0;
    // droplets from recent kicks
    const D = new Float32Array(MAXD * 4); let nd = 0; const per = Math.round(Number(this.p.droplets));
    if (per > 0 && !S.pool) {
      const em = this.emitters[S.layer] ?? [[this.RW / 2, this.RH / 2]];
      for (let k = this.kicks.length - 1; k >= 0 && nd < MAXD; k--) {
        const dt = t - this.kicks[k]; if (dt < 0) continue; if (dt > 1.1) break;
        const R = rng(Math.round(this.kicks[k] * 1000));
        for (let j = 0; j < per && nd < MAXD; j++) {
          const e = em[Math.floor(R() * em.length)], vx = (R() - .5) * 260, vy = -(380 + R() * 320) * inten, g = 1400;
          const x = e[0] + vx * dt, y = e[1] + vy * dt + .5 * g * dt * dt;
          const r = (5 + R() * 6) * (1 - dt / 1.2);
          if (y > e[1] + 4 && dt > .2) continue;           // landed: merged back into the pool
          D.set([x, y, r, 0], nd * 4); nd++;
        }
      }
    }
    const camE = settings.cameraEnergy / 100;
    const tilt = Number(this.p.tilt) * Math.PI / 180 * (.6 + .4 * Math.sin(t * .21)) * camE;
    const zoom = (1 + (S.chorus ? .06 : 0) * camE) * (1 + .015 * Math.sin(t * .31));
    gl.viewport(0, 0, W, H); gl.useProgram(this.prg.p); const u = this.prg.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex); gl.uniform1i(u.uSD, 0);
    gl.uniform2f(u.uRes, W, H); gl.uniform2f(u.uRaster, this.RW, this.RH);
    gl.uniform4f(u.uP, P.layer, S.layer, melt, t); gl.uniform2f(u.uPool, P.pool ? 1 : 0, S.pool ? 1 : 0);
    gl.uniform1fv(u.uRise, rise); gl.uniform1fv(u.uHero, hero);
    gl.uniform4f(u.uAud, bassEnv, sample(a.centroid, t), pulse * react, sample(a.loud, t));
    gl.uniform4f(u.uK, Number(this.p.spikeH) * inten, Number(this.p.spikeD), Number(this.p.irid), Number(this.p.env));
    gl.uniform3fv(u.uTint, TINTS[String(this.p.tint)] ?? TINTS.chrome);
    gl.uniform1i(u.uBg, ['studio', 'black', 'white'].indexOf(String(this.p.bg)));
    gl.uniform4f(u.uCam, zoom, tilt, Math.sin(t * .13) * .01 * camE, 0);
    gl.uniform4fv(u.uDrop, D);
    gl.uniform1f(u.uFade, clamp((t - (a.duration - .6)) / .55));
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
    out.drawImage(this.cv, 0, 0, W, H);
  }
}
function lastLE(arr: number[], t: number) { let lo = 0, hi = arr.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; }

export const ChromeFactory: EffectFactory = { id: 'chrome', name: 'Liquid Chrome', description: 'Ferrofluid type: liquid-metal lines rise word by word, spike with the bass, throw droplets on kicks and melt into the next line.', params: PARAMS, create: () => new ChromeEffect() };

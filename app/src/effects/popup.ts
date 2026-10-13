// POP-UP — a paper theatre. A book spread lies on a table; every word is a die-cut card hinged to the
// page that stands up on its onset (with overshoot) and folds away when the next line arrives; hero
// cards are thicker with a white core edge; concept words raise cut-out props; cards cast real (planar)
// shadows from a warm key light; sections turn the page; the camera dollies low on choruses.
import type { ParamSpec, Params, Word } from '../types';
import { type Effect, type EffectContext, type EffectFactory, clamp, lerp, eIO, eOut, rng, defaults, displayText } from './types';
import { fontCSS, capRatio } from '../render/sdf';
import { compile } from '../render/gl';
import { drawIcon } from '../render/icons';

const PARAMS: ParamSpec[] = [
  { key: 'colors', label: 'Paper colours', group: 'Look', type: 'select', options: ['circus', 'nursery', 'ink', 'sunset'], default: 'circus', help: 'Card colour set', live: false },
  { key: 'table', label: 'Table', group: 'Look', type: 'select', options: ['walnut', 'felt', 'slate'], default: 'walnut', help: 'What the book lies on', live: true },
  { key: 'overshoot', label: 'Pop overshoot', group: 'Motion', type: 'range', min: 0, max: 0.5, step: 0.01, default: 0.22, help: 'How far a card swings past upright before settling', live: true },
  { key: 'depth', label: 'Layer depth', group: 'Layout', type: 'range', min: 0.2, max: 0.6, step: 0.01, default: 0.4, help: 'Distance between alternating card rows', live: false },
  { key: 'props', label: 'Props', group: 'Imagery', type: 'toggle', default: true, help: 'Concept words raise cut-out props', live: false },
  { key: 'turnEvery', label: 'Page turn', group: 'Motion', type: 'select', options: ['section', '8 bars', 'never'], default: 'section', help: 'When pages turn', live: false },
  { key: 'shadow', label: 'Shadow softness', group: 'Look', type: 'range', min: 0, max: 4, step: 0.1, default: 1.6, help: 'Blur of card shadows', live: true },
  { key: 'camera', label: 'Camera angle', group: 'Camera', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, help: '0 = top-down, 1 = low; choruses go lower', live: true }
];
const COLORS: Record<string, string[]> = {
  circus: ['#D7332B', '#F2B033', '#2E6FB5', '#2E8B57', '#F0E6D2'],
  nursery: ['#F4A7B9', '#A7D8F4', '#F9E79F', '#B8E0B0', '#FFFFFF'],
  ink: ['#1D1D1F', '#C0392B', '#1D1D1F', '#4B4B4F', '#F2EEE6'],
  sunset: ['#E4572E', '#F3A712', '#A8201A', '#6B2737', '#F6E8D8']
};
const TABLES: Record<string, number[][]> = { walnut: [[.24, .14, .08], [.36, .22, .13]], felt: [[.06, .2, .14], [.09, .27, .19]], slate: [[.12, .13, .15], [.19, .2, .22]] };

const VS = `#version 300 es
layout(location=0) in vec2 aP;      // unit quad 0..1
uniform mat4 uVP, uM; uniform vec3 uL; uniform float uShadow;
out vec2 vUv; out vec3 vN; out vec3 vW;
void main(){
  vec4 w = uM * vec4(aP.x - .5, aP.y, 0., 1.);
  vN = normalize(mat3(uM) * vec3(0., 0., 1.));
  if (uShadow > .5) { w.xyz -= uL * (w.y / uL.y); w.y = .0015; }
  vW = w.xyz; vUv = vec2(aP.x, 1. - aP.y);
  gl_Position = uVP * w;
}`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform int uMode; uniform vec3 uL; uniform vec4 uTint; uniform float uSoft; uniform vec3 uTab0, uTab1; uniform float uT;
in vec2 vUv; in vec3 vN; in vec3 vW; out vec4 o;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + 1.), f.x), f.y); }
void main(){
  if (uMode == 0) {        // card face
    vec4 c = texture(uTex, vUv);
    if (c.a < .5) discard;
    float lam = .82 + .3 * abs(dot(normalize(vN), normalize(uL)));
    o = vec4(c.rgb * lam * uTint.rgb, 1.);
  } else if (uMode == 1) { // shadow
    float a = textureLod(uTex, vUv, uSoft).a;
    if (a < .02) discard;
    o = vec4(0., 0., 0., a * .3 * uTint.a);
  } else if (uMode == 2) { // page
    float g = smoothstep(0., .08, abs(vW.x));                        // gutter shading
    float edge = smoothstep(1., .96, abs(vW.x)) * smoothstep(.7, .66, abs(vW.z));
    vec3 paper = vec3(.96, .93, .86) * (.86 + .14 * g) * (.97 + .03 * vn(vW.xz * 90.));
    o = vec4(paper * mix(.8, 1., edge) * uTint.rgb, 1.);
  } else if (uMode == 3) { // table
    vec2 p = vW.xz;
    float grain = vn(vec2(p.x * 2., p.y * 40.)) * .6 + vn(vec2(p.x * 9., p.y * 120.)) * .4;
    vec3 c = mix(uTab0, uTab1, grain);
    float v = 1. - smoothstep(.8, 3.2, length(p));
    o = vec4(c * (.35 + .75 * v), 1.);
  } else {                 // page edge / card core
    o = vec4(uTint.rgb, 1.);
  }
}`;

interface Card { word: Word | null; icon?: string; tex: WebGLTexture; w: number; h: number; x: number; z: number; up: number; down: number; hero: boolean; color: string; page: number; side: number }

type M4 = Float32Array;
const m4 = {
  mul(a: M4, b: M4): M4 { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; },
  persp(fov: number, asp: number, n: number, f: number): M4 { const t = 1 / Math.tan(fov / 2); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]); },
  look(e: number[], c: number[], up: number[]): M4 {
    const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
  },
  // translate · rotZ(rz) · rotX(rx) · scale(sx, sy)
  model(tx: number, ty: number, tz: number, rx: number, sx: number, sy: number, rz = 0, pivotX = 0): M4 {
    const cx = Math.cos(rx), sxr = Math.sin(rx), cz = Math.cos(rz), sz = Math.sin(rz);
    // columns of R = Rz * Rx
    const Rx = [[1, 0, 0], [0, cx, sxr], [0, -sxr, cx]];   // column-major columns of rotX
    const col = (v: number[]) => [cz * v[0] - sz * v[1], sz * v[0] + cz * v[1], v[2]];
    const c0 = col(Rx[0]).map(v => v * sx), c1 = col(Rx[1]).map(v => v * sy), c2 = col(Rx[2]);
    // pivot about x = pivotX (for page turns around the gutter)
    const p = col([tx - pivotX, ty, tz]);
    return new Float32Array([c0[0], c0[1], c0[2], 0, c1[0], c1[1], c1[2], 0, c2[0], c2[1], c2[2], 0, p[0] + pivotX, p[1], p[2], 1]);
  }
};
function norm(v: number[]) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function cross(a: number[], b: number[]) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a: number[], b: number[]) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

class PopupEffect implements Effect {
  readonly id = 'popup'; readonly name = 'Pop-Up'; readonly description = 'A paper theatre: die-cut word cards hinge up on the beat with real shadows, props pop up beside heroes, sections turn the page.';
  readonly params = PARAMS;
  private p: Params = defaults(PARAMS);
  private ctx!: EffectContext;
  private cv!: HTMLCanvasElement; private gl!: WebGL2RenderingContext; private prg!: ReturnType<typeof compile>; private vao!: WebGLVertexArrayObject;
  private cards: Card[] = []; private white!: WebGLTexture; private pages: { t: number }[] = [];
  private chorusT: [number, number][] = [];

  async prepare(ctx: EffectContext) {
    this.ctx = ctx; this.p = { ...defaults(PARAMS), ...ctx.params };
    if (!this.gl) {
      this.cv = document.createElement('canvas');
      const gl = this.cv.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true }); if (!gl) throw new Error('WebGL2 is not available');
      this.gl = gl; this.prg = compile(gl, VS, FS);
      this.vao = gl.createVertexArray()!; gl.bindVertexArray(this.vao);
      const b = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
      this.white = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.white); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    }
    this.cv.width = ctx.width; this.cv.height = ctx.height;
    this.build();
  }
  setParams(p: Params) { this.p = { ...this.p, ...p }; }
  dispose() { this.gl?.getExtension('WEBGL_lose_context')?.loseContext(); }

  private cardTex(text: string | null, icon: string | null, color: string, hero: boolean): { tex: WebGLTexture; aspect: number } {
    const H = 160, pad = 22;
    const c = document.createElement('canvas').getContext('2d')!;
    const fk = hero ? 'mont8' : 'barlow7';
    let W = H;
    if (text) { c.font = fontCSS(fk, H * .62 / capRatio(fk)); W = Math.ceil(c.measureText(text).width) + pad * 2; }
    const cv = c.canvas; cv.width = W; cv.height = H + pad;
    c.clearRect(0, 0, W, H + pad);
    const ink = color, border = '#FBF7EE';
    c.lineJoin = 'round';
    if (text) {
      c.font = fontCSS(fk, H * .62 / capRatio(fk));
      const base = H * .62 + pad * 1.4;
      // die-cut outline: white border around the letters, plus a tab down to the hinge
      c.strokeStyle = border; c.fillStyle = border; c.lineWidth = pad * 1.3;
      c.strokeText(text, pad, base); c.fillRect(pad * .4, base - 4, W - pad * .8, H + pad - base + 4);
      c.fillStyle = ink; c.fillText(text, pad, base);
      // a little print texture
      c.globalAlpha = .08; c.fillStyle = '#000'; for (let i = 0; i < 40; i++) c.fillRect(Math.random() * 0 + (i * 37) % W, (i * 53) % (H + pad), 1.5, 1.5);
    } else if (icon) {
      c.save(); c.translate(W / 2, H * .5); c.fillStyle = border; c.strokeStyle = border; c.lineWidth = pad * 1.4;
      // outline by drawing the icon slightly larger in border colour
      for (let a = 0; a < 8; a++) { c.save(); c.translate(Math.cos(a * Math.PI / 4) * pad * .5, Math.sin(a * Math.PI / 4) * pad * .5); drawIcon(c, icon, H * .4); c.restore(); }
      c.fillRect(-H * .08, 0, H * .16, H * .5 + pad);
      c.fillStyle = ink; drawIcon(c, icon, H * .4); c.restore();
    }
    const gl = this.gl, tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex, aspect: cv.width / cv.height };
  }

  private build() {
    const { song, settings } = this.ctx; const ly = song.lyrics, a = song.analysis;
    const off = settings.syncOffsetMs / 1000, ant = settings.anticipationMs / 1000;
    const gl = this.gl; for (const c of this.cards) gl.deleteTexture(c.tex); this.cards = [];
    const cols = COLORS[String(this.p.colors)] ?? COLORS.circus, R = rng(settings.seed * 11 + 2);
    const ICON: Record<string, string> = { fire: 'flame', light: 'sun', water: 'drop', shock: 'bolt', wind: 'cloud', vortex: 'spiral', quake: 'mountain', ice: 'flake', smoke: 'cloud', heart: 'heart', home: 'house', moon: 'moon', time: 'clock', road: 'road', crown: 'crown', bird: 'bird', eye: 'eye', music: 'note', key: 'key', flower: 'flower', people: 'people', star: 'star' };
    // pages: section starts (or every 8 bars)
    const mode = String(this.p.turnEvery), bar = a.bpm > 0 ? 240 / a.bpm : 2;
    const pageT: number[] = [0];
    if (mode === 'section') for (const s of a.sections.slice(1)) pageT.push(s.start);
    else if (mode === '8 bars') for (let t = (a.downbeats[0] ?? 0) + 8 * bar; t < a.duration; t += 8 * bar) pageT.push(t);
    this.pages = pageT.map(t => ({ t }));
    this.chorusT = a.sections.filter(s => s.label === 'chorus' || s.label === 'drop').map(s => [s.start, s.end]);
    const pageOf = (t: number) => { let k = 0; pageT.forEach((pt, i) => { if (pt - .6 <= t) k = i; }); return k; };
    const lines = ly.lines.filter(L => L.words.length);
    const depth = Number(this.p.depth);
    lines.forEach((L, li) => {
      const ws = L.words.map(id => ly.words[id]);
      const next = lines[li + 1];
      const pg = pageOf(L.start + off);
      const lineDown = next && pageOf(next.start + off) === pg ? next.start + off - ant - .15 : (pageT[pg + 1] ?? a.duration + 9) - .6;
      const band = li % 2 === 0 ? .22 : .22 - depth;
      const specs = ws.map(w => {
        const hero = w.role === 'hero';
        const color = hero ? cols[(w.id * 7) % 4] : w.role === 'connective' ? cols[2] : cols[(w.id * 3 + 1) % 4];
        const txt = displayText(w.display, settings.caseMode === 'lower' ? 'lower' : settings.caseMode === 'as-is' ? 'as-is' : 'upper');
        const { tex, aspect } = this.cardTex(txt, null, color, hero);
        const h = hero ? .5 : w.role === 'connective' ? .24 : .34;
        return { w, tex, h, wd: h * aspect, hero, color };
      });
      // fit the row across the spread
      const gap = .04, tot = specs.reduce((s, q) => s + q.wd, 0) + gap * (specs.length - 1), k = Math.min(1, Math.min(1.86, Math.max(1.1, 1.1 * this.ctx.width / this.ctx.height)) / tot);
      let x = -tot * k / 2;
      specs.forEach(q => {
        const w = q.wd * k, h = q.h * k;
        this.cards.push({ word: q.w, tex: q.tex, w, h, x: x + w / 2, z: band + (R() - .5) * .02, up: q.w.start + off - ant, down: lineDown, hero: q.hero, color: q.color, page: pg, side: 0 });
        // a cut-out prop for concept heroes
        if (this.p.props && q.hero && q.w.concept && ICON[q.w.concept]) {
          const pt = this.cardTex(null, ICON[q.w.concept], q.color === cols[0] ? cols[1] : cols[0], false);
          const ph = .5 * Math.max(.6, k);
          this.cards.push({ word: null, icon: ICON[q.w.concept], tex: pt.tex, w: ph * pt.aspect, h: ph, x: Math.max(-.85, Math.min(.85, x + w / 2 + (R() - .5) * .3)), z: band - .16, up: q.w.start + off - ant + .12, down: lineDown, hero: false, color: q.color, page: pg, side: 0 });
        }
        x += w + gap * k;
      });
    });
  }

  render(t: number, out: CanvasRenderingContext2D) {
    const { width: W, height: H, song, settings } = this.ctx; const gl = this.gl, a = song.analysis;
    // camera: top-down on verses, low on choruses, gentle dolly and sway
    const inChorus = this.chorusT.some(([s, e]) => t >= s - .5 && t < e);
    let low = Number(this.p.camera); const chorusMix = this.chorusT.reduce((m, [s, e]) => Math.max(m, clamp((t - s + 1) / 1.2) * clamp((e - t + .5) / 1.2)), 0);
    low = lerp(low * .55, Math.min(1, low * .55 + .5), chorusMix);
    const camE = settings.cameraEnergy / 100;
    const pitch = lerp(.98, .36, low), dist = lerp(2.05, 1.6, low) * (W < H ? .92 : 1) * (1 - .03 * Math.sin(t * .2) * camE);
    const yaw = .12 * Math.sin(t * .13) * camE;
    // aim at the row that is currently standing (eased between rows)
    let cur: Card | null = null, prev: Card | null = null;
    let rowStart = 0;
    for (const c of this.cards) { if (c.word && c.up <= t + .3) { if (!cur || Math.abs(cur.z - c.z) > .05) { prev = cur; rowStart = c.up; } cur = c; } }
    const zc = cur ? (prev ? lerp(prev.z, cur.z, eIO(clamp((t - rowStart + .6) / .9))) : cur.z) : 0;
    const tgt = [0, .16 + .08 * low, zc - .12];
    const eye = [tgt[0] + Math.sin(yaw) * Math.cos(pitch) * dist, tgt[1] + Math.sin(pitch) * dist, tgt[2] + Math.cos(yaw) * Math.cos(pitch) * dist];
    const asp = W / H, fov = asp >= 1 ? .62 : 1.0;
    const VP = m4.mul(m4.persp(fov, asp, .05, 30), m4.look(eye, tgt, [0, 1, 0]));
    const L = norm([-.55, 1, .45]);
    gl.viewport(0, 0, W, H); gl.clearColor(.03, .025, .02, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(this.prg.p); gl.bindVertexArray(this.vao);
    const u = this.prg.u;
    gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniform3fv(u.uL, L); gl.uniform1f(u.uT, t);
    const T = TABLES[String(this.p.table)] ?? TABLES.walnut; gl.uniform3fv(u.uTab0, T[0]); gl.uniform3fv(u.uTab1, T[1]);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(u.uTex, 0);
    const quad = (M: M4, mode: number, tex: WebGLTexture, tint = [1, 1, 1, 1], shadow = false) => {
      gl.uniformMatrix4fv(u.uM, false, M); gl.uniform1i(u.uMode, mode); gl.uniform1f(u.uShadow, shadow ? 1 : 0); gl.uniform4fv(u.uTint, tint);
      gl.bindTexture(gl.TEXTURE_2D, tex); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    // table and the book (a flat quad lying on y=0 → rotate the unit quad −90° about x)
    quad(m4.model(0, -.002, 3, -Math.PI / 2, 12, 8), 3, this.white);
    quad(m4.model(0, 0, .7, -Math.PI / 2, 2.08, 1.42), 4, this.white, [.82, .78, .7, 1]);          // book board / page block
    quad(m4.model(0, .004, .66, -Math.PI / 2, 2.0, 1.32), 2, this.white);
    // page turn
    const pages = this.pages; let pi = 0; for (let i = 0; i < pages.length; i++) if (pages[i].t - .6 <= t) pi = i;
    const turnQ = pi > 0 ? clamp((t - (pages[pi].t - .6)) / 1.1) : 1;
    const os = Number(this.p.overshoot);
    const fold = (c: Card) => {
      // stand up on onset with overshoot; fold away at `down`
      const up = clamp((t - c.up) / .38), dn = clamp((t - c.down) / .32);
      const swing = up < 1 ? Math.sin(up * Math.PI * .5) * (1 + os * Math.sin(up * Math.PI)) : 1 + os * Math.exp(-(t - c.up - .38) * 9) * Math.sin((t - c.up - .38) * 24);
      return Math.PI / 2 * Math.max(0, swing) * (1 - eIO(dn));
    };
    const visible = this.cards.filter(c => c.page === pi && t >= c.up - .05 && t < c.down + .4);
    // shadows first (blended, no depth write)
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.uniform1f(u.uSoft, Number(this.p.shadow));
    for (const c of visible) { const th = fold(c); quad(m4.model(c.x, .006, c.z, -(Math.PI / 2 - th), c.w, c.h), 1, c.tex, [1, 1, 1, clamp(Math.sin(th) * 1.5)], true); }
    gl.depthMask(true); gl.disable(gl.BLEND);
    // cards: the hinge is the bottom edge; rx rotates the card from flat (−z) to upright
    for (const c of visible) {
      const th = fold(c);
      const M = m4.model(c.x, .006, c.z, -(Math.PI / 2 - th), c.w, c.h);
      if (c.hero) { quad(m4.model(c.x, .006, c.z - .006, -(Math.PI / 2 - th), c.w, c.h), 0, c.tex, [1.12, 1.12, 1.12, 1]); }   // white core edge behind (3 mm card)
      quad(M, 0, c.tex);
    }
    // the turning sheet (rotates about the gutter, right page → left)
    if (turnQ > 0 && turnQ < 1) {
      const ang = eIO(turnQ) * Math.PI;
      quad(m4.model(.5, .01, .66, -Math.PI / 2, 1.0, 1.32, ang, 0), 2, this.white);
    }
    gl.bindVertexArray(null); gl.disable(gl.DEPTH_TEST);
    out.drawImage(this.cv, 0, 0, W, H);
    const fade = clamp((t - (a.duration - .6)) / .55);
    if (fade > 0) { out.fillStyle = `rgba(0,0,0,${fade})`; out.fillRect(0, 0, W, H); }
    void inChorus; void eOut;
  }
}

export const PopupFactory: EffectFactory = { id: 'popup', name: 'Pop-Up', description: 'A paper theatre — die-cut word cards hinge up on the beat with real shadows, props pop up beside heroes, sections turn the page.', params: PARAMS, create: () => new PopupEffect() };

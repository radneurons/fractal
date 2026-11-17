// POP-UP — a paper theatre (SPEC §8.8). WebGL2, hand-written mat4, no 3D library.
// Each word is a die-cut card hinged on a book spread; it folds upright on its onset and casts a planar shadow.
// v3: voice B's cards stand on the facing page; backing vocals are small flags on sticks; pages also turn on repeats.
// Reduce motion calms: the overshoot and wobble (off), the camera sway and the low chorus angle.
import type { Target } from '../render/glhost.ts';
import { GLEffect, type EffectContext, type EffectMeta, range, toggle, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { ShelfPacker, makeCanvas, font, sizeForCap } from '../render/sdf.ts';
import { type Ctx2D, cleanDisplay, clamp01, smooth, easeOutCubic } from '../render/textkit.ts';
import { drawIcon } from '../render/icons.ts';
import { conceptById } from '../director/lexicon.ts';
import { hexToRgb, FS_HEAD, GLSL_NOISE } from '../render/gl.ts';
import { perspective, lookAt, mul, model, norm, type M4 } from '../render/mat4.ts';
import { hash01, sample } from '../analysis/dsp.ts';
import type { Word } from '../types.ts';
import { FS_BLIT } from './common.ts';

const PAPERS: Record<string, string[]> = {
  circus: ['#E63946', '#F4A261', '#2A9D8F', '#E9C46A', '#264653', '#F28482'],
  nursery: ['#A8DADC', '#F7CAD0', '#FFE5B4', '#B5E48C', '#CDB4DB', '#FFC8DD'],
  ink: ['#1D3557', '#22223B', '#3D405B', '#14213D', '#283618', '#540B0E'],
  sunset: ['#F94144', '#F3722C', '#F8961E', '#F9C74F', '#90BE6D', '#577590'],
};
const TABLES: Record<string, number> = { walnut: 0, felt: 1, slate: 2 };
const L = norm([-0.45, 1.0, 0.55]);

const VS_CARD = `#version 300 es
layout(location=0) in vec2 aP;
uniform mat4 uM, uVP; uniform vec2 uSize; uniform vec4 uUV; uniform float uShadow; uniform vec3 uL;
out vec2 vUv; out vec3 vN; out vec3 vW;
void main(){
  vec4 w = uM * vec4(aP.x * uSize.x, aP.y * uSize.y, 0.0, 1.0);
  if(uShadow > 0.5){ w.xyz -= uL * (w.y / uL.y); w.y = 0.0012; }
  vW = w.xyz; vN = normalize(mat3(uM) * vec3(0.0, 0.0, 1.0));
  vUv = vec2(uUV.x + aP.x * uUV.z, 1.0 - (uUV.y + (1.0 - aP.y) * uUV.w));
  gl_Position = uVP * w;
}`;
const FS_CARD = `#version 300 es
precision highp float;
uniform sampler2D uAtlas, uInk; uniform vec3 uL, uBackCol; uniform float uShadow, uSoft, uAlpha, uMask, uAge, uCore, uDim;
in vec2 vUv; in vec3 vN; in vec3 vW; out vec4 o;
void main(){
  if(uShadow > 0.5){ float a = textureLod(uAtlas, vUv, uSoft).a * uAlpha; o = vec4(0.0, 0.0, 0.0, a); return; }
  vec4 c = texture(uAtlas, vUv);
  if(c.a < 0.5) discard;
  if(uMask > 0.5){ float ink = texture(uInk, vUv).a * uAlpha; o = vec4(ink, ink * clamp(uAge / 2.0, 0.0, 1.0), ink, 1.0); return; }
  vec3 n = gl_FrontFacing ? vN : -vN;
  float lam = max(dot(n, uL), 0.0);
  vec3 base = gl_FrontFacing ? c.rgb : uBackCol;
  if(uCore > 0.5) base = vec3(0.97, 0.96, 0.93);
  vec3 col = base * (0.42 + 0.62 * lam) * uDim;
  o = vec4(col, 1.0);
}`;
const FS_WORLD = `#version 300 es
precision highp float;
uniform int uKind; uniform vec3 uL; uniform float uT;
in vec2 vUv; in vec3 vN; in vec3 vW; out vec4 o;
${GLSL_NOISE.replace('#version 300 es', '')}
void main(){
  vec3 p = vW; vec3 c;
  if(uKind == 0){ // walnut
    float g = fbm(vec2(p.x * 1.2, p.z * 14.0)) + 0.4 * sin(p.z * 40.0 + fbm(p.xz * 3.0) * 6.0);
    c = mix(vec3(0.22, 0.12, 0.07), vec3(0.42, 0.25, 0.14), clamp(g * 0.6 + 0.2, 0.0, 1.0));
  } else if(uKind == 1){ c = vec3(0.09, 0.32, 0.2) * (0.85 + 0.25 * vnoise(p.xz * 160.0)); }      // felt
  else if(uKind == 2){ c = vec3(0.2, 0.22, 0.25) * (0.8 + 0.35 * fbm(p.xz * 2.5)); }              // slate
  else if(uKind == 3){ // pages: cream with gutter shading and paper noise
    float gut = smoothstep(0.0, 0.16, abs(p.x));
    c = vec3(0.96, 0.93, 0.85) * (0.86 + 0.14 * gut) - 0.03 * fbm(p.xz * 18.0) - 0.02 * vnoise(p.xz * 300.0);
    c *= 1.0 - 0.15 * smoothstep(0.9, 1.0, abs(p.x));
  } else { c = vec3(0.32, 0.08, 0.08); }                                                         // cover
  float d = length(p.xz * vec2(0.45, 0.6));
  c *= 1.05 - 0.45 * smoothstep(0.6, 2.6, d);                                                     // warm key light falloff
  c *= vec3(1.04, 1.0, 0.94);
  c = mix(c, vec3(0.05, 0.035, 0.03), smoothstep(3.0, 14.0, length(p.xz)));
  o = vec4(c, 1.0);
}`;
const VS_WORLD = `#version 300 es
layout(location=0) in vec2 aP;
uniform mat4 uM, uVP; uniform vec2 uSize;
out vec2 vUv; out vec3 vN; out vec3 vW;
void main(){ vec4 w = uM * vec4(aP.x * uSize.x, aP.y * uSize.y, 0.0, 1.0); vW = w.xyz; vN = normalize(mat3(uM) * vec3(0.0, 0.0, 1.0)); vUv = aP; gl_Position = uVP * w; }`;

interface Card { w: Word; x: number; z: number; wd: number; ht: number; uv: [number, number, number, number]; rise: number; down: number; hero: boolean; prop?: { uv: [number, number, number, number]; wd: number; ht: number } ; page: number; flag: boolean }
interface Sheet { start: number; at: number }

export class PopUp extends GLEffect {
  static meta: EffectMeta = {
    id: 'popup', name: 'Pop-Up', kind: 'gl',
    description: 'A paper theatre: die-cut word cards fold up from a book spread on their beats, with props, shadows and page turns.',
    affinity: aff(0.55, 0.6, 0.55, 0.45, 0.75, 0.25, 0.9, 0.5),
    supportsTransparent: false,
    params: [
      select('paper', 'Paper colours', 'Look', 'circus', ['circus', 'nursery', 'ink', 'sunset'], false),
      select('table', 'Table', 'Look', 'walnut', ['walnut', 'felt', 'slate']),
      range('overshoot', 'Pop overshoot', 'Motion', 1, 0, 2, 0.01),
      range('depth', 'Layer depth', 'Layout', 0.4, 0.2, 0.7, 0.01, false),
      toggle('props', 'Props', 'Layout', true, false),
      select('pageTurn', 'Page turn', 'Motion', 'section', ['section', '8 bars', 'never'], false),
      range('soft', 'Shadow softness', 'Look', 3, 0, 6, 0.1),
      range('angle', 'Camera angle', 'Camera', 1, 0, 1.5, 0.01),
    ],
  };
  readonly meta = PopUp.meta;
  private cards: Card[] = [];
  private sheets: Sheet[] = [];
  private atlas: WebGLTexture | null = null;
  private ink: WebGLTexture | null = null;
  private scene!: Target;
  private quad: WebGLVertexArrayObject | null = null;
  private chorusW!: Float32Array;

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const gl = this.scope.gl, ly = this.ly, a = this.a, { W, H } = this;
    const portrait = H > W;
    const cols = PAPERS[this.str('paper')] ?? PAPERS.circus;
    // ---- pages ----
    const bar = a.downbeats.length > 1 ? (a.downbeats[a.downbeats.length - 1] - a.downbeats[0]) / (a.downbeats.length - 1) : 2;
    const mode = this.str('pageTurn');
    const pageOf: number[] = [];
    let page = 0, pageStart = -Infinity;
    const turns: Sheet[] = [];
    ly.lines.forEach((line, i) => {
      const prev = ly.lines[i - 1];
      let turn = false;
      if (prev && mode === 'section' && (line.section !== prev.section || (line.repeatOf !== undefined && prev.repeatOf === undefined && line.start - pageStart > 6))) turn = true;
      if (prev && mode === '8 bars' && line.start - pageStart >= 8 * bar) turn = true;
      if (turn) { page++; turns.push({ start: line.start - 1.4, at: line.start }); }
      if (i === 0 || turn) pageStart = line.start;
      pageOf.push(page);
    });
    this.sheets = turns;
    // ---- atlas: every word as a die-cut card (+ prop cards) ----
    const CH = 120, pad = 8;
    const ac = makeCanvas(4096, 4096), ic = makeCanvas(4096, 4096);
    const ag = ac.getContext('2d') as Ctx2D, ig = ic.getContext('2d') as Ctx2D;
    const pack = new ShelfPacker(4096);
    const cellFor = (w: Word, text: string, fnt: string): { x: number; y: number; cw: number; ch: number } => {
      ag.font = font(fnt, sizeForCap(fnt, CH * 0.44));
      const tw = ag.measureText(text).width;
      const cw = Math.ceil(tw + CH * 0.62), ch = Math.ceil(CH * 1.12);
      const p = pack.add(cw + pad, ch + pad);
      return { x: p.x, y: p.y, cw, ch };
    };
    const drawCard = (c: { x: number; y: number; cw: number; ch: number }, text: string, fnt: string, fill: string) => {
      const { x, y, cw, ch } = c;
      const border = CH * 0.07, tab = CH * 0.12, body = ch - tab;
      const rr = CH * 0.14;
      for (const [g, f, ink] of [[ag, fill, false], [ig, '#000', true]] as const) {
        g.save();
        g.beginPath(); g.roundRect(x, y, cw, body, rr);
        // a tab down to the hinge
        g.rect(x + cw * 0.3, y + body - 2, cw * 0.4, tab + 2);
        if (!ink) { g.fillStyle = '#FBF8F1'; g.fill(); g.beginPath(); g.roundRect(x + border, y + border, cw - 2 * border, body - 2 * border, rr * 0.7); g.fillStyle = f; g.fill(); }
        else { g.fillStyle = 'rgba(0,0,0,0.004)'; g.fill(); }
        const light = hexToRgb(fill).reduce((s, v) => s + v, 0) > 1.9;
        g.font = font(fnt, sizeForCap(fnt, CH * 0.44));
        g.textAlign = 'center'; g.textBaseline = 'alphabetic';
        g.fillStyle = ink ? '#fff' : light ? '#1B1B1E' : '#FFFFFF';
        g.fillText(text, x + cw / 2, y + body / 2 + CH * 0.22);
        g.restore();
      }
    };
    const cards: Card[] = [];
    const maxW = portrait ? 1.1 : 1.86;
    const zBack = -0.22, zFront = zBack + this.num('depth');
    const duet = ly.lines.some((l) => l.voice === 'B') && ly.lines.some((l) => l.voice === 'A');
    ly.lines.forEach((line, li) => {
      const ws = line.words.map((i) => ly.words[i]);
      const row: Card[] = [];
      for (const w of ws) {
        const hero = w.role === 'hero' && !w.backing;
        const fnt = hero ? 'montserrat' : 'barlow';
        const text = cleanDisplay(w, this.s.caseMode);
        const fill = cols[Math.floor(hash01(w.id, this.seed, 2) * cols.length)];
        const cell = cellFor(w, text, fnt);
        drawCard(cell, text, fnt, fill);
        const ht = w.backing ? 0.16 : hero ? 0.5 : w.role === 'support' ? 0.34 : 0.24;
        const wd = (ht * cell.cw) / cell.ch;
        const card: Card = { w, x: 0, z: 0, wd, ht, uv: [cell.x / 4096, cell.y / 4096, cell.cw / 4096, cell.ch / 4096], rise: w.start - this.s.anticipationMs / 1000, down: Infinity, hero, page: pageOf[li], flag: !!w.backing };
        const c = this.bool('props') && hero ? conceptById(w.concept) : undefined;
        if (c) {
          const pc = pack.add(CH + pad, Math.round(CH * 1.4) + pad);
          ag.save(); ag.translate(pc.x + CH / 2, pc.y + CH * 0.5);
          ag.fillStyle = '#FBF8F1'; ag.beginPath(); ag.arc(0, 0, CH * 0.48, 0, 7); ag.fill(); ag.fillRect(-CH * 0.04, 0, CH * 0.08, CH * 0.9);
          ag.fillStyle = fill; drawIcon(ag, c.icon, CH * 0.38);
          ag.restore();
          card.prop = { uv: [pc.x / 4096, pc.y / 4096, CH / 4096, (CH * 1.4) / 4096], wd: 0.34, ht: 0.34 * 1.4 };
        }
        row.push(card);
      }
      // scale the row to fit, then centre it on its page half (voice B stands on the facing page in duets)
      const gap = 0.035;
      let total = row.reduce((s, c) => s + c.wd, 0) + gap * (row.length - 1);
      const span = duet && line.voice ? (portrait ? 0.9 : 0.92) : maxW;
      const k = Math.min(1, span / total);
      row.forEach((c) => { c.wd *= k; c.ht *= k; if (c.prop) { c.prop.wd *= k; c.prop.ht *= k; } });
      total *= k;
      const cx = duet && line.voice === 'B' ? (portrait ? 0 : 0.5) : duet && line.voice === 'A' ? (portrait ? 0 : -0.5) : 0;
      let x = cx - total / 2;
      const z = li % 2 ? zFront : zBack;
      for (const c of row) { c.x = x; c.z = c.flag ? z + 0.12 : z; x += c.wd + gap * k; }
      // the previous line folds flat when this one arrives
      if (li > 0) { const prevRow = cards.filter((c) => c.w.line === li - 1); for (const p of prevRow) p.down = Math.min(p.down, row[0].rise - 0.45); }
      // old cards fold away before a page turn
      const t = turns.find((s) => s.at === line.start);
      if (t) for (const p of cards) if (p.down === Infinity || p.down > t.start) p.down = Math.min(p.down, t.start - 0.35);
      cards.push(...row);
    });
    if (ly.lines.length) { const end = ly.lines[ly.lines.length - 1].end; for (const c of cards) if (c.down === Infinity) c.down = end + 2.5; }
    this.cards = cards;
    this.atlas = this.scope.upload('atlas', ac as HTMLCanvasElement, { mip: true });
    this.ink = this.scope.upload('ink', ic as HTMLCanvasElement, { mip: true });
    this.scene = this.scope.target(W, H, { depth: true });
    // quad VAO
    this.quad = this.scope.vao();
    gl.bindVertexArray(this.quad);
    const b = this.scope.buffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    // chorus weight (pitch blend), smoothed over 1.5 s
    const n = a.n;
    this.chorusW = new Float32Array(n);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / 60;
      const s = a.sections.find((q) => t >= q.start && t < q.end);
      const target = s && (s.label === 'chorus' || s.label === 'drop') ? 1 : 0;
      y += (target - y) * (1 - Math.exp(-1 / (0.5 * 60)));
      this.chorusW[i] = y;
    }
  }

  /** fold angle: 0 = flat (lying away from the camera), π/2 = upright */
  private fold(c: Card, t: number): number {
    const up = 0.38, rm = this.s.reduceMotion;
    const u = clamp01((t - (c.rise - up)) / up);
    if (u <= 0) return 0;
    const ov = rm ? 0 : this.num('overshoot');
    let ang = (Math.PI / 2) * (1 - Math.pow(1 - u, 3)) * (1 + 0.12 * ov * Math.sin(Math.PI * u));
    const since = t - c.rise;
    if (since > 0 && !rm) ang += 0.12 * ov * Math.exp(-since * 7) * Math.sin(since * 24);
    const d = clamp01((t - c.down) / 0.3);
    return ang * (1 - smooth(d));
  }

  protected drawGL(t: number, target: Target, mask: boolean): void {
    const gl = this.scope.gl, { W, H } = this, a = this.a;
    const host = this.scope.host;
    host.bind(this.scene);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // ---- camera: near top-down on verses, low on choruses; yaw sway; the target follows the standing row ----
    const cw = sample(this.chorusW, t) * (this.s.reduceMotion ? 0.3 : 1) * this.num('angle');
    const pitch = (56 - 34 * cw) * Math.PI / 180;
    const yaw = (this.s.reduceMotion ? 0 : 0.07 * Math.sin(t * 0.21)) * this.camEnergy;
    let standing = this.cards.filter((c) => t >= c.rise - 0.4 && t < c.down + 0.3);
    if (!standing.length) standing = this.cards.filter((c) => c.rise > t).slice(0, 4);
    const x0 = standing.length ? Math.min(...standing.map((c) => c.x)) : -0.5, x1 = standing.length ? Math.max(...standing.map((c) => c.x + c.wd)) : 0.5;
    const tx = (x0 + x1) / 2;
    const tz = standing.length ? standing[0].z : 0;
    const rowW = Math.max(0.9, x1 - x0 + 0.25);
    const portrait = H > W;
    const dist = Math.max(1.25, rowW * (portrait ? 1.75 : 1.05)) * (1 - 0.05 * Math.sin(t * 0.13) * this.camEnergy);
    const at = [tx, 0.16 + 0.06 * cw, tz];
    const eye = [at[0] + dist * Math.cos(pitch) * Math.sin(yaw), at[1] + dist * Math.sin(pitch), at[2] + dist * Math.cos(pitch) * Math.cos(yaw)];
    const VP = mul(perspective(0.62, W / H, 0.05, 50), lookAt(eye, at, [0, 1, 0]));
    const page = (() => { let p = 0; for (const s of this.sheets) if (t >= s.at - 0.45) p++; return p; })();
    const progW = this.scope.program(FS_WORLD, VS_WORLD), progC = this.scope.program(FS_CARD, VS_CARD);
    gl.bindVertexArray(this.quad);
    const quad = (prog: typeof progW, M: M4, w: number, h: number, u: Record<string, unknown>) => {
      gl.useProgram(prog.program);
      host.setUniforms(prog, { uM: M, uVP: VP, uSize: [w, h], uL: L, ...(u as Record<string, number>) });
      gl.bindVertexArray(this.quad);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    // lying quads: rotX(-π/2) maps local y to −z
    const flat = (x: number, y: number, z: number) => model([x, y, z], 0, -Math.PI / 2, [1, 1, 1]);
    if (!mask) {
      quad(progW, flat(-40, -0.03, 40), 80, 80, { uKind: { i: TABLES[this.str('table')] ?? 0 } as never, uT: t });
      quad(progW, flat(-1.06, -0.012, 0.72), 2.12, 1.44, { uKind: { i: 4 } as never });
      quad(progW, flat(-1, 0, 0.66), 2, 1.32, { uKind: { i: 3 } as never });
      // turning sheet: rotates 180° about the gutter
      for (const s of this.sheets) {
        const u = clamp01((t - s.start) / 0.9);
        if (u <= 0 || u >= 1) continue;
        const ang = Math.PI * smooth(u);
        quad(progW, mul(model([0, 0.004, 0.66], 0, 0, [1, 1, 1]), mul(model([0, 0, 0], ang, 0, [1, 1, 1]), model([0, 0, 0], 0, -Math.PI / 2, [1, 1, 1]))), 1, 1.32, { uKind: { i: 3 } as never });
      }
    }
    // ---- cards ----
    const visible = this.cards.filter((c) => c.page === page && t >= c.rise - 0.5 && t < c.down + 0.45);
    const backCol = hexToRgb('#E9E3D6');
    const cardM = (c: Card, ang: number, dz = 0, dx = 0) => model([c.x + dx, 0.001, c.z + dz], 0, -(Math.PI / 2 - ang), [1, 1, 1]);
    if (!mask) {
      // planar shadows on the page along the light, alpha from the card texture at a mip level × sin(fold)
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      for (const c of visible) {
        const ang = this.fold(c, t);
        if (ang <= 0.01) continue;
        quad(progC, cardM(c, ang), c.wd, c.ht, { uShadow: 1, uSoft: this.num('soft'), uAlpha: 0.42 * Math.sin(ang), uUV: c.uv as never, uAtlas: this.atlas as never });
        if (c.prop) quad(progC, cardM({ ...c, wd: c.prop.wd } as Card, Math.min(ang, this.fold({ ...c, rise: c.rise + 0.12 }, t)), -0.09, c.wd * 0.62), c.prop.wd, c.prop.ht, { uShadow: 1, uSoft: this.num('soft'), uAlpha: 0.35 * Math.sin(ang), uUV: c.prop.uv as never, uAtlas: this.atlas as never });
      }
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
    }
    for (const c of visible) {
      const ang = this.fold(c, t);
      const age = t - c.rise;
      const common = { uShadow: 0, uAtlas: this.atlas as never, uInk: this.ink as never, uBackCol: backCol, uMask: mask ? 1 : 0, uAge: age, uAlpha: 1, uDim: 1 };
      if (c.prop && !mask) {
        const pa = Math.min(ang, this.fold({ ...c, rise: c.rise + 0.12 }, t));
        quad(progC, cardM({ ...c } as Card, pa, -0.09, c.wd * 0.62), c.prop.wd, c.prop.ht, { ...common, uUV: c.prop.uv as never, uCore: 0 });
      }
      // hero cards: a second, slightly offset light layer as a 3 mm white core edge
      if (c.hero && !mask) {
        const M = mul(cardM(c, ang), model([0, 0, -0.012], 0, 0, [1, 1, 1]));
        quad(progC, M, c.wd, c.ht, { ...common, uUV: c.uv as never, uCore: 1, uDim: 0.95 });
      }
      quad(progC, cardM(c, ang), c.wd, c.ht, { ...common, uUV: c.uv as never, uCore: 0 });
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    this.scope.pass(this.scope.program(FS_BLIT), target, { uTex: this.scene.tex });
    void a; void easeOutCubic;
  }
}
registerEffect(PopUp);

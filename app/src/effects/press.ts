// PRESS — loudness becomes ink weight on a hand-engraved page.
// Each section is a page; lines are set as a justified column and stay justified as the weight breathes:
// loudness → stroke dilation/erosion (continuous, never a font swap), brightness (centroid) → width,
// stress → slant; kicks spread the ink for 80 ms; long held words bend along a curve; choruses use a red
// second ink; sections change with a page curl. A shader turns the ink mask into engraving hatch on paper.
import type { ParamSpec, Params, Word, Line } from '../types';
import { type Effect, type EffectContext, type EffectFactory, clamp, eOut, eIO, defaults, displayText } from './types';
import { fontCSS, capRatio, type FontKey } from '../render/sdf';
import { compile, fullscreenTriangle, VS_FULL, GLSL_NOISE } from '../render/gl';
import { sample } from '../analysis/dsp';

const PARAMS: ParamSpec[] = [
  { key: 'wMin', label: 'Lightest weight', group: 'Weight', type: 'range', min: -1, max: 1, step: 0.01, default: -0.6, help: 'Ink weight at silence (negative = thinner than the cut)', live: true },
  { key: 'wMax', label: 'Heaviest weight', group: 'Weight', type: 'range', min: 0, max: 3, step: 0.01, default: 1.8, help: 'Ink weight at the loudest moments', live: true },
  { key: 'smooth', label: 'Loudness smoothing (s)', group: 'Weight', type: 'range', min: 0, max: 1, step: 0.01, default: 0.25, help: 'Averaging window for the weight', live: true },
  { key: 'widthFromCentroid', label: 'Width from brightness', group: 'Weight', type: 'toggle', default: true, help: 'Brighter sound sets wider type (column stays justified)', live: true },
  { key: 'hatch', label: 'Hatch density', group: 'Engraving', type: 'range', min: 0.4, max: 2, step: 0.01, default: 1, help: 'Engraving line density', live: true },
  { key: 'paper', label: 'Paper', group: 'Engraving', type: 'select', options: ['cream', 'white', 'grey', 'black'], default: 'cream', help: 'Paper tone', live: true },
  { key: 'ink2', label: 'Second ink', group: 'Engraving', type: 'color', default: '#B52A1E', help: 'Chorus ink', live: true },
  { key: 'turn', label: 'Page turn', group: 'Pages', type: 'select', options: ['curl', 'slide', 'cut'], default: 'curl', help: 'How sections change pages', live: true },
  { key: 'melisma', label: 'Melisma curves', group: 'Pages', type: 'toggle', default: true, help: 'Long held words bend along a curve', live: true },
  { key: 'dropCap', label: 'Drop caps', group: 'Pages', type: 'toggle', default: true, help: 'Each page opens with a two-line red initial', live: true }
];
const PAPERS: Record<string, { paper: number[]; ink: number[] }> = { cream: { paper: [.94, .9, .82], ink: [.09, .08, .07] }, white: { paper: [.97, .97, .96], ink: [.06, .06, .07] }, grey: { paper: [.78, .77, .74], ink: [.08, .08, .09] }, black: { paper: [.07, .07, .075], ink: [.92, .9, .85] } };

const FS = `#version 300 es
precision highp float;
uniform sampler2D uA, uAb, uB, uBb;   // ink masks (r = ink, b = second ink) and blurred masks, pages A (current) and B (previous)
uniform vec2 uRes; uniform vec4 uTurn; // progress, mode (0 curl, 1 slide), _, _
uniform vec3 uPaper, uInk, uInk2; uniform float uHatch, uFade, uT;
out vec4 o;
${GLSL_NOISE}
vec3 paperAt(vec2 p){
  float f = fbm(p / 260.) * .06 + vnoise(p / 3.) * .025 + vnoise(vec2(p.x / 900., p.y / 2.)) * .02;
  float fib = smoothstep(.75, .95, vnoise(vec2(p.x / 40. + p.y / 7., p.y / 40.))) * .03;
  return uPaper * (1. - f - fib + .02);
}
vec3 page(sampler2D M, sampler2D Mb, vec2 uv, vec2 p){
  vec4 m = texture(M, uv), mb = texture(Mb, uv);
  vec3 col = paperAt(p);
  float ink = m.r, ink2 = m.b, depth = clamp(mb.r + mb.b, 0., 1.);
  float cov = max(ink, ink2);
  if (cov > .002) {
    // engraving: horizontal hatch, lines swell toward the core of each stroke; crisp contour at the edge
    float sp = 4.2 / uHatch * (uRes.y / 1080.);
    float y = p.y + sin(p.x * .015) * 1.4;
    float ph = abs(fract(y / sp) - .5) * 2.;
    float lineW = mix(.38, 1.05, smoothstep(.15, .85, depth));
    float hatch = smoothstep(lineW + .12, lineW - .12, ph);
    float edge = smoothstep(.55, .2, depth) * 1.;
    float a = clamp(max(hatch, edge), 0., 1.) * cov;
    vec3 ic = mix(uInk, uInk2, ink2 / max(cov, 1e-3));
    col = mix(col, ic, a * .96);
  }
  return col;
}
void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = p / uRes;
  vec3 col;
  float q = uTurn.x;
  if (q <= 0. || q >= 1.) col = page(uA, uAb, uv, p);
  else if (uTurn.y > .5) { // slide: the old page slides off to the left with a shadow
    float off = eio(q) * uRes.x;
    if (p.x < uRes.x - off) { col = page(uB, uBb, (p + vec2(off, 0.)) / uRes, p + vec2(off, 0.)); }
    else { col = page(uA, uAb, uv, p); col *= .75 + .25 * smoothstep(0., 60., p.x - (uRes.x - off)); }
  } else { // curl: a cylinder-like fold travels right → left
    float xc = mix(uRes.x * 1.02, -uRes.x * .35, q);
    float R = uRes.x * .09;
    if (p.x < xc - R * .1) {
      col = page(uB, uBb, uv, p);
      // shadow cast by the lifting flap
      col *= 1. - .35 * smoothstep(-R * 3., 0., p.x - xc);
      // the back of the flap lies over [xc - flapW, xc]
      float flapW = (uRes.x - xc) * .62;
      if (p.x > xc - flapW) {
        float u = (xc - p.x) / max(flapW, 1.);           // 0 at the fold, 1 at the flap edge
        float shade = .78 + .2 * (1. - (1. - 2. * u) * (1. - 2. * u));   // quadratic surface highlight
        vec2 mp = vec2(xc + (xc - p.x) / .62, p.y);      // mirrored point on the old page
        vec3 back = paperAt(mp) * shade;
        vec4 gm = texture(uB, mp / uRes);
        back = mix(back, uInk, max(gm.r, gm.b) * .08);   // text showing through
        col = back;
      }
    } else {
      col = page(uA, uAb, uv, p);
      col *= 1. - .45 * smoothstep(R * 2.5, 0., p.x - xc);   // shadow of the curl on the new page
    }
  }
  float vig = 1. - .18 * smoothstep(.45, 1.1, length((uv - .5) * vec2(1.2, 1.)));
  o = vec4(col * vig * (1. - uFade), 1.);
}`;

interface PageDef { start: number; end: number; lines: Line[]; chorus: boolean; idx: number }

class PressEffect implements Effect {
  readonly id = 'press'; readonly name = 'Press'; readonly description = 'A hand-engraved page that breathes: loudness becomes ink weight, brightness becomes width, held notes bend, choruses print in a second ink.';
  readonly params = PARAMS;
  private p: Params = defaults(PARAMS);
  private ctx!: EffectContext;
  private cv!: HTMLCanvasElement; private gl!: WebGL2RenderingContext; private prg!: ReturnType<typeof compile>; private vao!: WebGLVertexArrayObject;
  private mask: HTMLCanvasElement[] = []; private blur: HTMLCanvasElement[] = []; private texs: WebGLTexture[] = [];
  private pages: PageDef[] = []; private kicks: number[] = [];

  async prepare(ctx: EffectContext) {
    this.ctx = ctx; this.p = { ...defaults(PARAMS), ...ctx.params };
    if (!this.gl) {
      this.cv = document.createElement('canvas');
      const gl = this.cv.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true }); if (!gl) throw new Error('WebGL2 is not available');
      this.gl = gl; this.prg = compile(gl, VS_FULL, FS.replace('${GLSL_NOISE}', '') .replace('out vec4 o;', 'out vec4 o;\nfloat eio(float p){ return p < .5 ? 4. * p * p * p : 1. - pow(-2. * p + 2., 3.) / 2.; }')); this.vao = fullscreenTriangle(gl);
      for (let i = 0; i < 4; i++) { const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); this.texs.push(t); }
    }
    this.cv.width = ctx.width; this.cv.height = ctx.height;
    this.mask = [0, 1].map(() => { const c = document.createElement('canvas'); c.width = ctx.width; c.height = ctx.height; return c; });
    this.blur = [0, 1].map(() => { const c = document.createElement('canvas'); c.width = Math.ceil(ctx.width / 2); c.height = Math.ceil(ctx.height / 2); return c; });
    // pages = sections that hold lines (long sections split every 8 lines)
    const { song } = ctx; const a = song.analysis, ly = song.lyrics; const off = ctx.settings.syncOffsetMs / 1000;
    const pages: PageDef[] = [];
    for (const L of ly.lines) {
      if (!L.words.length) continue;
      const cur = pages[pages.length - 1];
      const lab = a.sections[L.section]?.label;
      if (!cur || (cur as PageDef & { sec?: number }).sec !== L.section || cur.lines.length >= 8) { const pg = { start: L.start + off, end: L.end + off, lines: [L], chorus: lab === 'chorus' || lab === 'drop', idx: pages.length, sec: L.section } as PageDef & { sec: number }; pages.push(pg); }
      else { cur.lines.push(L); cur.end = L.end + off; }
    }
    this.pages = pages;
    this.kicks = a.onsets.filter((o, i) => a.onsetStrength[i] > .4 && sample(a.bands.bass, o + .02) > .45);
  }
  setParams(p: Params) { this.p = { ...this.p, ...p }; }
  dispose() { this.gl?.getExtension('WEBGL_lose_context')?.loseContext(); }

  private txt(s: string) { const m = this.ctx.settings.caseMode; return displayText(s, m === 'upper' ? 'as-is' : m === 'lower' ? 'lower' : 'as-is'); }
  private weight(t: number) {
    const a = this.ctx.song.analysis, win = Number(this.p.smooth); let s = 0, n = 0;
    for (let k = 0; k <= 6; k++) { s += sample(a.loud, t - win * k / 6); n++; }
    const l = s / n, w0 = Number(this.p.wMin), w1 = Number(this.p.wMax);
    let w = w0 + (w1 - w0) * Math.pow(l, 1.3) * this.ctx.settings.intensity / 100;
    // ink spread on kicks: closed-form, 80 ms
    for (let i = this.kicks.length - 1; i >= 0; i--) { const d = t - this.kicks[i]; if (d < 0) continue; if (d > .08) break; w += 1.2 * (1 - d / .08) * this.ctx.settings.reactivity / 100; }
    return w;
  }

  /** Set one page into an ink-mask canvas: red channel = ink, blue = second ink. */
  private setPage(c: CanvasRenderingContext2D, pg: PageDef, t: number) {
    const { width: W, height: H, song, settings } = this.ctx; const a = song.analysis, ly = song.lyrics;
    const off = settings.syncOffsetMs / 1000, ant = settings.anticipationMs / 1000;
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    const colW = Math.min(W * .7, H * 1.15), x0 = (W - colW) / 2;
    const wgt = this.weight(t), widthK = this.p.widthFromCentroid ? .9 + .28 * sample(a.centroid, t) : 1;
    // rows: wrap each lyric line into rows by natural width
    type Tok = { w: Word; s: string; f: FontKey; cap: number; nat: number };
    const dropOn = Boolean(this.p.dropCap);
    const build = (lineCap: number) => {
      const rows: Tok[][] = []; let firstTok = true;
      for (const L of pg.lines) {
        const toks = L.words.map(id => ly.words[id]).map(w => { const f: FontKey = w.role === 'hero' ? 'serif' : 'caslon'; const cap = lineCap * (w.role === 'hero' ? 1.08 : w.role === 'connective' ? .86 : .95); return { w, s: this.txt(w.display).replace(/f(?=[iltf])/g, 'f\u200C'), f, cap, nat: 0 }; });
        if (firstTok && dropOn && toks.length) { toks[0].s = toks[0].s.slice(1); }
        for (const tk of toks) { c.font = fontCSS(tk.f, tk.cap / capRatio(tk.f)); tk.nat = c.measureText(tk.s).width; }
        let row: Tok[] = [], acc = 0;
        for (const tk of toks) { const avail = colW - (dropOn && rows.length < 2 ? dcW(lineCap) : 0); if (row.length && acc + tk.nat * widthK + lineCap * .3 > avail) { rows.push(row); row = []; acc = 0; } row.push(tk); acc += tk.nat * widthK + lineCap * .3; }
        if (row.length) rows.push(row);
        firstTok = false;
      }
      return rows;
    };
    const dcW = (lc: number) => { c.font = fontCSS('serif', lc * 2.6 / capRatio('serif')); return c.measureText(firstLetter).width + lc * .25; };
    const fw = pg.lines[0] ? ly.words[pg.lines[0].words[0]] : null; const firstLetter = fw ? this.txt(fw.display)[0] : 'A';
    let lineCap = Math.min(H * .075, W * .045), rows = build(lineCap);
    for (let it = 0; it < 12 && rows.length * lineCap * 1.55 > H * .74; it++) { lineCap *= .9; rows = build(lineCap); }
    const lh = lineCap * 1.55, top = Math.max(H * .15, (H - rows.length * lh) / 2 + lineCap * 1.1);
    // running head
    c.fillStyle = '#f00'; c.font = fontCSS('caslon', H * .016 / capRatio('caslon') * .9);
    const head = (settings.title || 'Lyric Engine').toUpperCase().split('').join(' ');
    c.textAlign = 'center'; c.fillText(head, W / 2, H * .075); c.textAlign = 'left';
    c.fillRect(x0, H * .09, colW, Math.max(1, H * .0015));
    c.font = fontCSS('caslon', H * .014 / capRatio('caslon')); c.textAlign = 'center'; c.fillText(String(pg.idx + 1), W / 2, H * .95); c.textAlign = 'left';
    const ink = pg.chorus ? '#00f' : '#f00';
    let first = true;
    rows.forEach((row, ri) => {
      const y = top + ri * lh;
      const widths = row.map(tk => tk.nat * widthK);
      const sum = widths.reduce((s, v) => s + v, 0);
      let gap = row.length > 1 ? (colW - sum) / (row.length - 1) : 0;
      const justify = row.length > 1 && gap < lineCap * 2.6;
      if (!justify) gap = lineCap * .3;
      const ind = dropOn && ri < 2 ? dcW(lineCap) : 0;
      if (justify) gap = (colW - ind - sum) / (row.length - 1);
      let x = x0 + ind;
      // drop cap: first word of the page (two rows tall, red)
      row.forEach((tk, k) => {
        const s0 = tk.w.start + off - ant;
        const vis = clamp((t - s0 + .06) / .1); if (vis <= 0) { x += widths[k] + gap; return; }
        const pressIn = 1 - eOut(clamp((t - s0) / .18));   // ink impression: heavier for a moment, then settles
        c.save(); c.translate(x, y);
        const slant = tk.w.role === 'hero' ? -.12 * tk.w.stress : 0;
        c.transform(widthK, 0, slant, 1, 0, 0);
        c.font = fontCSS(tk.f, tk.cap / capRatio(tk.f));
        const color = ink;
        const held = tk.w.end - tk.w.start;
        const isMel = Boolean(this.p.melisma) && held > 1.0 && tk.s.length >= 3;
        const w2 = wgt + pressIn * 1.5;
        const drawStr = (fn: (s: string, x: number, y: number) => void) => {
          if (!isMel) { fn(tk.s, 0, 0); return; }
          // letters along a quadratic curve that bends as the note is held
          const hq = eIO(clamp((t - (tk.w.start + off)) / held));
          let lx = 0; for (let i = 0; i < tk.s.length; i++) { const ch = tk.s[i], cw = c.measureText(ch).width, u = (lx + cw / 2) / Math.max(1, tk.nat); const track = 1 + .35 * hq; const px = (lx + cw / 2) * track, py = Math.sin(u * Math.PI) * tk.cap * .45 * hq; const ang = Math.cos(u * Math.PI) * .5 * hq; c.save(); c.translate(px, py); c.rotate(ang); fn(ch, -cw / 2, 0); c.restore(); lx += cw; }
        };
        if (first && dropOn) {
          const cap2 = lineCap * 2.6; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.font = fontCSS('serif', cap2 / capRatio('serif')); c.fillStyle = '#00f'; c.globalAlpha = vis; c.fillText(firstLetter, x0, top + lh * .98); c.restore();
        }
        first = false;
        c.globalAlpha = vis; c.fillStyle = color; c.strokeStyle = color; c.lineJoin = 'round';
        drawStr((s, xx, yy) => c.fillText(s, xx, yy));
        const lw = Math.abs(w2) * tk.cap * .03;
        if (w2 > 0) { c.lineWidth = lw; drawStr((s, xx, yy) => c.strokeText(s, xx, yy)); }
        else if (w2 < 0) { c.globalCompositeOperation = 'destination-out'; c.lineWidth = lw; drawStr((s, xx, yy) => c.strokeText(s, xx, yy)); c.globalCompositeOperation = 'source-over'; }
        c.restore();
        x += widths[k] + gap;
      });
    });
    // fleuron at the end of the page once its last word is sung
    const lastW = pg.lines[pg.lines.length - 1]; const le = lastW ? lastW.end + off : 0;
    if (t > le + .2) { c.globalAlpha = clamp((t - le - .2) / .3); c.fillStyle = ink; c.font = fontCSS('caslon', lineCap * .8 / capRatio('caslon')); c.textAlign = 'center'; c.fillText('❦', W / 2, top + rows.length * lh + lineCap * .2); c.textAlign = 'left'; c.globalAlpha = 1; }
  }

  private upload(i: number, cv: HTMLCanvasElement) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.texs[i]); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); }

  render(t: number, out: CanvasRenderingContext2D) {
    const { width: W, height: H, song } = this.ctx; const gl = this.gl;
    const pages = this.pages;
    let pi = 0; for (let i = 0; i < pages.length; i++) if (pages[i].start - 1.2 <= t) pi = i;
    const cur = pages[pi], prev = pages[pi - 1];
    const turnDur = .9, mode = String(this.p.turn);
    const q = prev && mode !== 'cut' ? clamp((t - (cur.start - 1.2)) / turnDur) : 1;
    const draw = (k: number, pg: PageDef | undefined, tt: number) => {
      const c = this.mask[k].getContext('2d')!;
      if (pg) this.setPage(c, pg, tt); else { c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#000'; c.fillRect(0, 0, W, H); }
      const b = this.blur[k].getContext('2d')!; b.setTransform(1, 0, 0, 1, 0, 0); b.filter = `blur(${Math.max(1, H / 540) * 1.6}px)`; b.clearRect(0, 0, this.blur[k].width, this.blur[k].height); b.drawImage(this.mask[k], 0, 0, this.blur[k].width, this.blur[k].height); b.filter = 'none';
      this.upload(k * 2, this.mask[k]); this.upload(k * 2 + 1, this.blur[k]);
    };
    draw(0, cur && t >= cur.start - 1.2 ? cur : undefined, t);
    if (q > 0 && q < 1) draw(1, prev, prev ? Math.min(t, prev.end + 1.5) : t);
    gl.viewport(0, 0, W, H); gl.useProgram(this.prg.p); const u = this.prg.u;
    ['uA', 'uAb', 'uB', 'uBb'].forEach((nm, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, this.texs[i]); gl.uniform1i(u[nm], i); });
    gl.uniform2f(u.uRes, W, H); gl.uniform4f(u.uTurn, q >= 1 ? 1 : q, mode === 'slide' ? 1 : 0, 0, 0);
    const P = PAPERS[String(this.p.paper)] ?? PAPERS.cream;
    gl.uniform3fv(u.uPaper, P.paper); gl.uniform3fv(u.uInk, P.ink); gl.uniform3fv(u.uInk2, hex3(String(this.p.ink2)));
    gl.uniform1f(u.uHatch, Number(this.p.hatch)); gl.uniform1f(u.uFade, clamp((t - (song.analysis.duration - .6)) / .55)); gl.uniform1f(u.uT, t);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
    out.drawImage(this.cv, 0, 0, W, H);
  }
}
function hex3(h: string) { const v = parseInt(h.replace('#', ''), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; }

export const PressFactory: EffectFactory = { id: 'press', name: 'Press', description: 'A hand-engraved page that breathes — loudness becomes ink weight, brightness becomes width, held notes bend, choruses print in a second ink.', params: PARAMS, create: () => new PressEffect() };

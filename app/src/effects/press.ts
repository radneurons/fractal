// PRESS — loudness becomes ink weight on an engraved page (SPEC §8.7).
// A Canvas2D page is an ink mask (R = ink, B = second ink); a shader engraves it with hatch lines on paper
// and turns the pages with a curl.
// v3: ink weight follows vocal loudness when available; melisma words ride the real f0 curve.
// Reduce motion calms: the page curl (becomes a cut), the impression overshoot and the melisma bend.
import type { Target } from '../render/glhost.ts';
import { GLEffect, type EffectContext, type EffectMeta, range, toggle, select, colour, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { maskFill } from './common.ts';
import { FS_HEAD, GLSL_NOISE, hexToRgb } from '../render/gl.ts';
import { type Ctx2D, setFont, cleanDisplay, graphemes, clamp01, textWidth, canSplitLetters } from '../render/textkit.ts';
import { sample, pulse } from '../analysis/dsp.ts';
import type { Line, Word } from '../types.ts';

const FS = FS_HEAD + GLSL_NOISE + `
uniform sampler2D uA, uB; uniform vec2 uRes; uniform float uTurn, uDens, uT, uFrame, uTransparent; uniform int uStyle;
uniform vec3 uPaper, uInk, uInk2; uniform float uPaperDark;
vec3 paperCol(vec2 px){
  float tone = fbm(px * 0.0025) * 0.07 + vnoise(px * 0.9) * 0.03;
  float fib = smoothstep(0.86, 1.0, vnoise(vec2(px.x * 0.02, px.y * 0.9))) * 0.035 + smoothstep(0.9, 1.0, vnoise(vec2(px.x * 0.7, px.y * 0.015) + 9.0)) * 0.03;
  float pores = step(0.985, hash21(floor(px / 2.0))) * 0.05;
  vec3 c = uPaper - tone - fib - pores;
  return uPaperDark > 0.5 ? uPaper + tone * 0.6 + fib : c;
}
// engrave one page: horizontal hatch whose line width swells toward the stroke core
vec4 page(sampler2D tex, vec2 uv){
  if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  vec2 px = vec2(uv.x, 1.0 - uv.y) * uRes;
  vec4 m = texture(tex, uv); vec4 d = textureLod(tex, uv, 2.5);
  float ink = max(m.r, m.b), depth = max(d.r, d.b);
  float second = m.b > m.r ? 1.0 : 0.0;
  float period = 4.2 / uDens * uRes.y / 720.0;
  float line = abs(fract((px.y + sin(px.x * 0.018) * 1.2) / period) - 0.5) * 2.0;
  float wd = mix(0.38, 1.05, smoothstep(0.3, 0.95, depth));
  float hatch = smoothstep(wd, wd - 0.28, line);
  float contour = ink * smoothstep(0.8, 0.3, depth);         // crisp contour where the depth is low
  float a = clamp(max(hatch * ink, contour), 0.0, 1.0);
  vec3 pap = paperCol(px);
  vec3 inkc = mix(uInk, uInk2, second);
  vec3 c = mix(pap, inkc, a * 0.94);
  float vg = length((uv - 0.5) * vec2(uRes.x / uRes.y, 1.0));
  c *= 1.0 - 0.22 * smoothstep(0.45, 1.05, vg);
  return vec4(c, 1.0);
}
void main(){
  vec2 uv = vUv;
  vec4 A = page(uA, uv);
  if(uTurn <= 0.0){ o = A; return; }
  vec4 B = page(uB, uv);
  if(uStyle == 2){ o = uTurn < 0.5 ? A : B; return; }                                 // cut
  if(uStyle == 1){ // slide: the old page slides off with a shadow edge
    float x = uv.x + uTurn;
    vec4 old = page(uA, vec2(x, uv.y));
    float sh = smoothstep(0.0, 0.05, 1.0 - x) * step(x, 1.0);
    o = x <= 1.0 ? old : B * (1.0 - 0.35 * smoothstep(0.08, 0.0, x - 1.0));
    o.rgb *= mix(1.0, 0.92 + 0.08 * sh, step(x, 1.0)); return; }
  // curl: a fold line travels right → left; the flap's back shows mirrored paper
  float fold = 1.1 - uTurn * 1.35;                  // x of the fold line
  float r = 0.07;                                    // curl radius
  vec3 c;
  if(uv.x < fold){
    c = A.rgb;
    c *= 1.0 - 0.35 * smoothstep(0.12, 0.0, fold - uv.x) * smoothstep(0.0, 0.3, uTurn); // the lifting flap casts a shadow on the old page
  } else if(uv.x < fold + r){ // the cylinder: back of the flap, with a quadratic highlight
    float u = (uv.x - fold) / r;
    float srcx = fold + (3.14159 - asin(clamp(u, 0.0, 1.0))) * r;
    vec3 back = paperCol(vec2(1.0 - srcx, 1.0 - uv.y) * uRes) * 0.96;
    back = mix(back, mix(back, uInk, 0.5), 0.08 * max(texture(uA, vec2(srcx, uv.y)).r, texture(uA, vec2(srcx, uv.y)).b)); // 8 % show-through
    float hl = 1.0 - u * u;
    c = back * (0.72 + 0.34 * hl);
  } else {
    c = B.rgb;
    c *= 1.0 - 0.3 * smoothstep(0.14, 0.0, uv.x - fold - r);   // the curl casts a shadow on the new page
  }
  o = vec4(c, 1.0);
}`;
const FS_MASK = FS_HEAD + `uniform sampler2D uTex; void main(){ vec4 c = texture(uTex, vUv); float a = max(c.r, c.b); o = vec4(a, c.g, a, 1.0); }`;
const PAPERS: Record<string, [string, string, boolean]> = { cream: ['#F1E9D6', '#17130F', false], white: ['#F7F6F2', '#111111', false], grey: ['#CFCDC7', '#151515', false], black: ['#141312', '#EDE6D6', true] };

interface PWord { w: Word; text: string; font: string; cap: number; base: number; letters?: string[] }
interface PRow { words: PWord[]; y: number; indent: number; last: boolean }
interface Page { rows: PRow[]; start: number; end: number; chorus: boolean; num: number; lines: Line[]; dropCap: string; dropW: number }

export class Press extends GLEffect {
  static meta: EffectMeta = {
    id: 'press', name: 'Press', kind: 'gl',
    description: 'Loudness becomes ink weight on an engraved page: justified type, hatch shading, drop caps and page turns.',
    affinity: aff(0.3, 0.9, 0.9, 0.85, 0.5, 0.6, 0.45, 0.3),
    supportsTransparent: false,
    params: [
      range('wMin', 'Lightest weight', 'Ink', -0.9, -2, 1, 0.01),
      range('wMax', 'Heaviest weight', 'Ink', 2.6, 0, 6, 0.01),
      range('smoothing', 'Loudness smoothing (s)', 'Ink', 0.25, 0.05, 1, 0.01),
      toggle('widthFromBrightness', 'Width from brightness', 'Ink', true),
      range('density', 'Hatch density', 'Engraving', 1, 0.5, 2, 0.01),
      select('paper', 'Paper', 'Engraving', 'cream', ['cream', 'white', 'grey', 'black']),
      colour('ink2', 'Second ink', 'Engraving', '#B52A1E'),
      select('turn', 'Page turn', 'Pages', 'curl', ['curl', 'slide', 'cut']),
      toggle('melisma', 'Melisma curves', 'Pages', true),
      toggle('dropCaps', 'Drop caps', 'Pages', true, false),
    ],
  };
  readonly meta = Press.meta;
  private pages: Page[] = [];
  private colW = 0; private colX = 0; private cap = 30; private top = 0;

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const { W, H } = this, ly = this.ly, a = this.a;
    const portrait = H > W;
    this.colW = W * (portrait ? 0.84 : 0.7); this.colX = (W - this.colW) / 2;
    this.top = H * 0.2;
    // pages: each section (or every 8 lines)
    const groups: Line[][] = [];
    for (const line of ly.lines) { const g = groups[groups.length - 1]; if (!g || g[0].section !== line.section || g.length >= 8) groups.push([line]); else g.push(line); }
    const maxRows = Math.max(...groups.map((g) => g.length), 3);
    this.cap = Math.min(H * 0.052, (H * 0.62) / (maxRows * 1.9 + 1));
    this.pages = groups.map((g, pi) => {
      const sec = a.sections[g[0].section];
      const rows: PRow[] = [];
      let y = this.top + this.cap * 1.5;
      let dropCap = '', dropW = 0;
      g.forEach((line, li) => {
        const ws = line.words.map((i) => ly.words[i]);
        const pw: PWord[] = ws.map((w) => {
          const hero = w.role === 'hero' && !w.backing;
          const font = hero ? 'playfair' : 'caslon';
          const cap = this.cap * (hero ? 1.08 : w.role === 'support' ? 0.95 : 0.86) * (w.backing ? 0.7 : 1);
          const text = cleanDisplay(w, this.s.caseMode === 'upper' ? 'as-is' : this.s.caseMode, true);
          return { w, text, font, cap, base: textWidth(text, font, cap), letters: canSplitLetters(w) ? graphemes(text) : undefined };
        });
        if (pi >= 0 && li === 0 && this.bool('dropCaps') && pw.length) {
          const first = pw[0];
          dropCap = graphemes(first.text)[0].toUpperCase();
          dropW = textWidth(dropCap, 'playfair', this.cap * 2.9) + this.cap * 0.35;
          first.text = graphemes(first.text).slice(1).join(''); first.base = textWidth(first.text, first.font, first.cap); first.letters = first.letters?.slice(1);
        }
        // wrap to the column (drop-cap rows are indented)
        let cur: PWord[] = [], width = 0;
        const flush = (last: boolean) => { if (!cur.length) return; const indent = dropCap && rows.length < 2 ? dropW : 0; rows.push({ words: cur, y, indent, last }); y += this.cap * 1.9; cur = []; width = 0; };
        for (const p of pw) {
          const indent = dropCap && rows.length < 2 ? dropW : 0;
          if (cur.length && width + p.base > (this.colW - indent) * 0.96) flush(false);
          cur.push(p); width += p.base + this.cap * 0.42;
        }
        flush(true);
      });
      return { rows, start: g[0].start, end: g[g.length - 1].end, chorus: sec?.label === 'chorus' || sec?.label === 'drop', num: pi + 1, lines: g, dropCap, dropW };
    });
  }

  /** ink weight in px: wMin…wMax by (vocal) loudness^1.3, + kick spread */
  private weight(t: number): number {
    const a = this.a, sm = this.num('smoothing');
    let l = 0, n = 0;
    for (let k = -4; k <= 0; k++) { const tt = t + (k / 4) * sm; const v = sample(a.vocal, tt) > 0.35 ? Math.max(sample(a.loud, tt), 0.9 * sample(a.bands.mid, tt)) : sample(a.loud, tt); l += v; n++; }
    l /= n;
    const w = this.num('wMin') + (this.num('wMax') - this.num('wMin')) * Math.pow(clamp01(l), 1.3);
    return (w + 0.9 * this.react * pulse(a.onsets, t, 1 / 0.08) * (sample(a.bands.bass, t) > 0.5 ? 1 : 0)) * (this.H / 720) * this.intensity;
  }

  private paintPage(g: Ctx2D, pi: number, t: number, mask: boolean): void {
    const { W, H } = this, a = this.a;
    g.clearRect(0, 0, W, H);
    if (mask) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
    const page = this.pages[pi];
    if (!page) return;
    const ink = mask ? '#fff' : page.chorus ? 'rgb(0,0,255)' : 'rgb(255,0,0)';
    const wgt = this.weight(t);
    const cap = this.cap;
    g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.lineJoin = 'round';
    if (!mask) {
      // running head (letter-spaced title) and a rule, page number
      g.fillStyle = 'rgb(255,0,0)';
      setFont(g, 'caslon', cap * 0.42);
      const head = (this.s.title || 'LYRICS').toUpperCase().split('').join(' ');
      g.textAlign = 'center'; g.fillText(head, W / 2, this.top - cap * 0.5);
      g.fillRect(this.colX, this.top, this.colW, Math.max(1, H * 0.0025));
      g.fillText(String(page.num), W / 2, H * 0.93);
      g.textAlign = 'left';
    }
    const widthK = this.bool('widthFromBrightness') ? 0.9 + 0.28 * sample(a.centroid, t) : 1;
    page.rows.forEach((row, ri) => {
      // every line is justified at every moment: the gap is recomputed from the current widths
      const widths = row.words.map((p) => p.base * widthK);
      const avail = this.colW - row.indent;
      const sum = widths.reduce((s, x) => s + x, 0);
      const natural = cap * 0.42;
      const gap = row.words.length > 1 ? (row.last && sum + natural * (row.words.length - 1) < avail * 0.8 ? natural : (avail - sum) / (row.words.length - 1)) : 0;
      let x = this.colX + row.indent;
      row.words.forEach((p, wi) => {
        const w = p.w;
        const age = t - (w.start - this.s.anticipationMs / 1000);
        if (age >= 0) {
          // each word prints with an impression overshoot (+1.5 weight, decaying over 0.18 s)
          const wt = wgt + (this.s.reduceMotion ? 0 : 1.5 * (H / 720) * Math.exp(-age / 0.06) * (age < 0.18 ? 1 : 0));
          setFont(g, p.font, p.cap);
          const hero = w.role === 'hero' && !w.backing;
          g.save();
          g.translate(x, row.y);
          g.scale(widthK, 1);
          if (hero) g.transform(1, 0, -0.16 * w.stress * (hero ? 1 : 0), 1, 0, 0);
          g.fillStyle = mask ? maskFill(age, w.backing ? 0.7 : 1) : ink;
          g.strokeStyle = g.fillStyle;
          const held = w.end - w.start > 1 && this.bool('melisma') && p.letters && !this.s.reduceMotion;
          const drawGlyphs = (fn: (s: string, xx: number, yy: number) => void) => {
            if (!held) { fn(p.text, 0, 0); return; }
            // melisma: letters ride the pitch contour (or a sine arch), with growing tracking
            const u = clamp01((t - w.start) / (w.end - w.start));
            let xx = 0;
            const n = p.letters!.length;
            p.letters!.forEach((ch, i) => {
              const k = n > 1 ? i / (n - 1) : 0;
              const tt = w.start + k * (w.end - w.start);
              const f0 = sample(a.f0, tt), ref = w.pitch ?? f0;
              const usePitch = w.melisma && !Number.isNaN(f0) && !Number.isNaN(ref) && Math.abs(f0 - ref) < 6;
              const lift = usePitch ? Math.max(-0.45, Math.min(0.45, (f0 - ref) * 0.09)) : Math.sin(k * Math.PI) * 0.32;
              const yy = -lift * p.cap * u;
              const rot = n > 1 ? -Math.cos(k * Math.PI) * 0.18 * u * (usePitch ? 0.5 : 1) : 0;
              g.save(); g.translate(xx, yy); g.rotate(rot); fn(ch, 0, 0); g.restore();
              xx += g.measureText(ch).width + p.cap * 0.06 * u;
            });
          };
          drawGlyphs((s, xx, yy) => g.fillText(s, xx, yy));
          if (wt > 0.05) { g.lineWidth = wt * 2; drawGlyphs((s, xx, yy) => g.strokeText(s, xx, yy)); }           // positive weight dilates
          else if (wt < -0.05 && !mask) { g.globalCompositeOperation = 'destination-out'; g.lineWidth = Math.min(p.cap * 0.07, -wt * 2); drawGlyphs((s, xx, yy) => g.strokeText(s, xx, yy)); g.globalCompositeOperation = 'source-over'; } // negative erodes
          g.restore();
        }
        x += widths[wi] + gap;
      });
      void ri;
    });
    if (!mask) {
      // red two-line drop cap; the fleuron after the last line is sung
      if (page.dropCap && t >= page.start - 0.4) {
        setFont(g, 'playfair', cap * 2.9);
        g.fillStyle = 'rgb(0,0,255)';
        g.fillText(page.dropCap, this.colX - cap * 0.1, page.rows[Math.min(1, page.rows.length - 1)].y);
      }
      if (t > page.end + 0.3) {
        setFont(g, 'caslon', cap * 0.9);
        g.textAlign = 'center'; g.fillStyle = 'rgb(255,0,0)';
        g.globalAlpha = clamp01((t - page.end - 0.3) / 0.4);
        g.fillText('❦', W / 2, page.rows[page.rows.length - 1].y + cap * 2.2);
        g.globalAlpha = 1; g.textAlign = 'left';
      }
    }
  }

  protected drawGL(t: number, target: Target, mask: boolean): void {
    const { W, H } = this;
    // which page, and are we turning to the next one? (0.9 s, starting 1.2 s before its first word)
    let pi = 0;
    for (let i = 0; i < this.pages.length; i++) if (this.pages[i].start - 1.2 <= t) pi = i;
    let turn = 0, from = pi;
    const style = this.s.reduceMotion ? 'cut' : this.str('turn');
    if (pi > 0) { const u = (t - (this.pages[pi].start - 1.2)) / 0.9; if (u < 1) { turn = clamp01(u); from = pi - 1; } }
    if (mask) {
      const { c, g } = this.layer('mask');
      this.paintPage(g, turn > 0.5 || turn === 0 ? pi : from, t, true);
      this.scope.pass(this.scope.program(FS_MASK), target, { uTex: this.scope.upload('mask', c as HTMLCanvasElement) });
      return;
    }
    const la = this.layer('a');
    this.paintPage(la.g, from, t, false);
    const ta = this.scope.upload('a', la.c as HTMLCanvasElement, { mip: true });
    let tb = ta;
    if (turn > 0) { const lb = this.layer('b'); this.paintPage(lb.g, pi, t, false); tb = this.scope.upload('b', lb.c as HTMLCanvasElement, { mip: true }); }
    const [paper, ink, dark] = PAPERS[this.str('paper')] ?? PAPERS.cream;
    this.scope.pass(this.scope.program(FS), target, {
      uA: ta, uB: tb, uRes: [W, H], uTurn: turn, uDens: this.num('density'), uT: t, uFrame: Math.round(t * 60), uTransparent: 0,
      uStyle: { i: style === 'curl' ? 0 : style === 'slide' ? 1 : 2 }, uPaper: hexToRgb(paper), uInk: hexToRgb(ink), uInk2: hexToRgb(this.str('ink2')), uPaperDark: dark ? 1 : 0,
    });
  }
}
registerEffect(Press);

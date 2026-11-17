// MANDALA — a kaleidoscope locked to the bar (SPEC §8.13).
// Ornaments are drawn into one wedge of angle 2π/n and folded by a shader (mirrored on alternate wedges).
// The current hero stays readable in an unmirrored centre medallion; support words run around rings.
// Reduce motion calms: ring rotation (¼ speed), the drop zoom punch (off) and the ornament drift.
import type { Target } from '../render/glhost.ts';
import { GLEffect, type EffectContext, type EffectMeta, range, toggle, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { maskFill } from './common.ts';
import { FS_HEAD, GLSL_NOISE, hsl, rgbToHex } from '../render/gl.ts';
import { type Ctx2D, setFont, cleanDisplay, clamp01, smooth, easeOutCubic, lineAt, subtitle, textWidth } from '../render/textkit.ts';
import { drawIcon } from '../render/icons.ts';
import { conceptById } from '../director/lexicon.ts';
import { keyHue } from '../analysis/harmony.ts';
import { FPS, sample, lowerBound, pulse, hash01 } from '../analysis/dsp.ts';
import type { Word } from '../types.ts';

const FS = FS_HEAD + GLSL_NOISE + `
uniform sampler2D uWedge, uOver;
uniform vec2 uRes; uniform float uN, uZoom, uInvert, uT, uTransparent; uniform vec3 uBg1, uBg2;
void main(){
  float asp = uRes.x / uRes.y;
  vec2 p = (vUv - 0.5) * vec2(asp, 1.0) / uZoom;
  float r = length(p), th = atan(p.y, p.x);
  float w = 6.2831853 / uN;
  float a = mod(th, 2.0 * w);
  if(a > w) a = 2.0 * w - a;                       // mirrored on alternate wedges
  vec2 q = vec2(cos(-a), sin(-a)) * r;              // the wedge was drawn at canvas angles [0, w]
  vec4 orn = texture(uWedge, q / vec2(asp, 1.0) + 0.5);
  vec4 ov = texture(uOver, p / vec2(asp, 1.0) + 0.5);
  vec3 bg = mix(uBg1, uBg2, smoothstep(0.0, 0.9, r)) + 0.02 * fbm3(p * 3.0 + uT * 0.02);
  vec3 c = bg * (1.0 - orn.a) + orn.rgb;
  c = c * (1.0 - ov.a) + ov.rgb;
  if(uInvert > 0.5) c = vec3(1.0) - c;
  c *= 1.0 - 0.25 * smoothstep(0.6, 1.2, r);
  float alpha = uTransparent > 0.5 ? max(orn.a, ov.a) : 1.0;
  o = vec4(uTransparent > 0.5 ? (orn.rgb * (1.0 - ov.a) + ov.rgb) : c, alpha);
}`;
const FS_MASK = FS_HEAD + `uniform sampler2D uTex; void main(){ o = vec4(texture(uTex, vUv).rgb, 1.0); }`;

export class Mandala extends GLEffect {
  static meta: EffectMeta = {
    id: 'mandala', name: 'Mandala', kind: 'gl',
    description: 'A kaleidoscope locked to the bar: the hero in a centre medallion, words circling in rings, ornaments blooming on every beat.',
    affinity: aff(0.6, 0.75, 0.35, 0.3, 0.85, 0.45, 0.8, 0.5),
    supportsTransparent: true, supportsLive: true,
    params: [
      select('segments', 'Segments', 'Symmetry', 'auto', ['auto', '6', '8', '12', '16']),
      range('speed', 'Rotation speed', 'Motion', 1, 0, 3, 0.01),
      range('density', 'Ring density', 'Rings', 1, 0.4, 1.6, 0.01, false),
      select('style', 'Ornament style', 'Ornaments', 'lace', ['lace', 'geometric', 'floral', 'icons']),
      select('palette', 'Palette', 'Colour', 'key', ['key', 'jewel', 'pastel', 'mono']),
      range('hueShift', 'Hue shift', 'Colour', 0, -1, 1, 0.01),
      select('medallionFont', 'Medallion font', 'Type', 'by mood', ['by mood', 'montserrat', 'playfair'], false),
      toggle('invertBridges', 'Invert on bridges', 'Colour', true),
    ],
  };
  readonly meta = Mandala.meta;
  /** cumulative rotation (in bars), frozen during breakdowns */
  private clock!: Float32Array;

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const a = this.a, n = a.n + 2;
    this.clock = new Float32Array(n);
    let acc = 0, sp = 1;
    const db = a.downbeats;
    for (let i = 1; i < n; i++) {
      const t = i / FPS;
      const sec = a.sections.find((s) => t >= s.start && t < s.end);
      const target = sec?.label === 'breakdown' ? 0 : 1;
      sp += (target - sp) * (1 - Math.exp(-1 / (0.8 * FPS)));             // rotation eases to a stop in breakdowns
      const k = lowerBound(db, t) - 1;
      const bar = k >= 0 && k + 1 < db.length ? db[k + 1] - db[k] : (60 / (a.bpm || 120)) * 4;
      acc += (sp / bar) / FPS;
      this.clock[i] = acc;
    }
  }

  private colours(t: number): { base: number; sat: number; light: number; pal: string[] } {
    const a = this.a;
    const pal = this.str('palette');
    let hue = keyHue(a.key.tonic);
    const ch = a.chords.find((c) => t >= c.start && t < c.end);
    if (ch && ch.quality !== 'N') hue += (((ch.root - a.key.tonic) * 7) % 12 + 12) % 12 * 30; // chord changes rotate the hue by the root's interval
    hue += this.num('hueShift') * 180;
    const mk = (h: number, s: number, l: number) => { const c = hsl(((h % 360) + 360) % 360, s, l); return rgbToHex(c[0], c[1], c[2]); };
    if (pal === 'mono') return { base: 0, sat: 0, light: 0.8, pal: ['#F2F2F2', '#BBBBBB', '#888888', '#FFFFFF'] };
    const s = pal === 'pastel' ? 0.55 : pal === 'jewel' ? 0.85 : a.key.mode === 'minor' ? 0.62 : 0.75;
    const l = pal === 'pastel' ? 0.78 : pal === 'jewel' ? 0.52 : a.key.mode === 'minor' ? 0.5 : 0.58;
    const art = this.s.paletteSource === 'artwork' && this.ctx.artwork;
    return { base: hue, sat: s, light: l, pal: art ? [this.ctx.artwork!.vivid1, this.ctx.artwork!.vivid2, this.ctx.artwork!.lightest, this.ctx.artwork!.dominant] : [mk(hue, s, l), mk(hue + 30, s, l * 0.9), mk(hue - 40, s * 0.9, l * 1.1), mk(hue + 180, s * 0.7, Math.min(0.9, l * 1.2))] };
  }

  private segments(t: number): number {
    const a = this.a;
    let n = this.str('segments') === 'auto' ? 2 * (a.meter === 6 ? 3 : a.meter) : Number(this.str('segments'));
    if (this.str('segments') === 'auto' && a.drops.some((d) => t >= d && t < d + 8 * (60 / (a.bpm || 120)))) n *= 2; // doubled symmetry on drops
    return n;
  }

  /** Ornament rings: one is born on each beat and lives 4 bars, drifting outward and fading. */
  private wedge(g: Ctx2D, t: number, R: number, r0: number, n: number, cols: string[]): void {
    const a = this.a;
    const w = (Math.PI * 2) / n;
    const style = this.str('style');
    const beat = 60 / (a.bpm || 120);
    const life = 4 * (a.meter === 6 ? 2 : a.meter) * beat;
    const frozen = (tt: number) => { const sec = a.sections.find((s) => tt >= s.start && tt < s.end); return sec?.label === 'breakdown'; };
    // in breakdowns the ornaments freeze: evaluate them at the section start
    let te = t;
    const sec = a.sections.find((s) => t >= s.start && t < s.end);
    if (sec && frozen(t)) te = sec.start;
    const i1 = lowerBound(a.beats, te + 1e-6);
    const line = this.ly.lines[lineAt(this.ly, te)];
    const icons = line ? line.words.map((i) => conceptById(this.ly.words[i].concept)?.icon).filter((x): x is string => !!x) : [];
    g.save();
    g.translate(this.W / 2, this.H / 2);
    for (let k = i1 - 1; k >= 0 && te - a.beats[k] < life; k--) {
      const age = te - a.beats[k];
      const u = age / life;
      const rr = r0 + (R - r0) * (0.08 + 0.92 * easeOutCubic(u)) * (this.s.reduceMotion ? 0.7 : 1);
      const alpha = (1 - u) * (1 - u) * clamp01(age / 0.12);
      const sd = k * 13 + this.seed;
      const shape = style === 'icons' && icons.length ? 4 : style === 'floral' ? (k % 2 ? 0 : 3) : style === 'geometric' ? (k % 2 ? 1 : 2) : Math.floor(hash01(sd, 3) * 4);
      const col = cols[k % cols.length];
      g.globalAlpha = alpha;
      g.strokeStyle = col; g.fillStyle = col;
      g.lineWidth = Math.max(1.2, R * 0.006);
      const count = 1 + Math.floor(hash01(sd, 4) * 3);
      for (let j = 0; j < count; j++) {
        const ang = (w * (j + 0.5)) / count;
        const x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
        const size = R * (0.035 + 0.04 * hash01(sd, j, 5)) * (0.6 + 0.6 * (1 - u));
        g.save(); g.translate(x, y); g.rotate(ang);
        g.beginPath();
        if (shape === 0) { // petal
          g.moveTo(-size, 0); g.quadraticCurveTo(0, -size * 0.7, size, 0); g.quadraticCurveTo(0, size * 0.7, -size, 0); g.fill();
        } else if (shape === 1) { // arcs
          g.arc(0, 0, size, -Math.PI / 2, Math.PI / 2); g.stroke();
        } else if (shape === 2) { // dot chain
          for (let d = -2; d <= 2; d++) { g.moveTo(d * size * 0.5 + size * 0.14, 0); g.arc(d * size * 0.5, 0, size * 0.14, 0, 7); }
          g.fill();
        } else if (shape === 3) { // lace: a scalloped arc with a dot
          g.arc(0, 0, size, Math.PI, 0); g.stroke(); g.beginPath(); g.arc(0, -size * 1.25, size * 0.18, 0, 7); g.fill();
        } else { g.rotate(Math.PI / 2); drawIcon(g, icons[k % icons.length], size * 0.9); }
        g.restore();
      }
      // a thin connecting circle segment so the ring reads as a ring
      g.globalAlpha = alpha * 0.55;
      g.beginPath(); g.arc(0, 0, rr, 0, w); g.stroke();
    }
    g.restore();
  }

  protected drawGL(t: number, target: Target, mask: boolean): void {
    const { W, H } = this, a = this.a, ly = this.ly;
    const R = Math.min(W, H) * 0.5;
    const r0 = R * 0.38 * (H > W ? 0.9 : 1);
    const n = this.segments(t);
    const col = this.colours(t);
    const clock = sample(this.clock, t) * this.num('speed') * (this.s.reduceMotion ? 0.25 : 1);
    const antic = this.s.anticipationMs / 1000;
    const li = lineAt(ly, t + 0.4);
    const line = li >= 0 ? ly.lines[li] : undefined;
    const words = line ? line.words.map((i) => ly.words[i]) : [];
    const heroes = words.filter((w) => w.role === 'hero' && !w.backing);
    const hero: Word | undefined = [...heroes].reverse().find((w) => w.start - antic <= t) ?? (line && t < (line.start + 0.2) ? undefined : heroes[0]);
    const others = words.filter((w) => !(w.role === 'hero' && !w.backing));
    // ---- overlay: medallion, ring borders, ring text ----
    const ov = this.layer(mask ? 'mask' : 'over');
    const g = ov.g;
    g.clearRect(0, 0, W, H);
    if (mask) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
    g.save();
    g.translate(W / 2, H / 2);
    const beatK = this.s.reduceMotion ? 0 : pulse(a.beats, t, 9);
    if (!mask) {
      g.fillStyle = 'rgba(8,8,12,0.78)';
      g.beginPath(); g.arc(0, 0, r0 * 0.98, 0, 7); g.fill();
      // the ring border ticks on beats
      g.strokeStyle = col.pal[0]; g.lineWidth = R * 0.012;
      g.beginPath(); g.arc(0, 0, r0, 0, 7); g.stroke();
      const nt = 4 * n;
      const bi = lowerBound(a.beats, t + 1e-6);
      for (let k = 0; k < nt; k++) {
        const on = (k + bi) % 4 === 0;
        const ang = (k / nt) * Math.PI * 2 + clock * 0.25;
        const len = R * (on ? 0.05 + 0.03 * beatK : 0.025);
        g.lineWidth = R * (on ? 0.008 : 0.004);
        g.beginPath(); g.moveTo(Math.cos(ang) * r0 * 1.03, Math.sin(ang) * r0 * 1.03); g.lineTo(Math.cos(ang) * (r0 * 1.03 + len), Math.sin(ang) * (r0 * 1.03 + len)); g.stroke();
      }
    }
    // the hero, unmirrored and readable
    if (hero) {
      const age = t - (hero.start - antic);
      const mood = line?.mood?.valence ?? 0;
      const mf = this.str('medallionFont');
      const fnt = mf === 'playfair' || (mf === 'by mood' && mood < 0) ? 'playfair' : 'montserrat';
      const text = cleanDisplay(hero, this.s.caseMode);
      let cap = r0 * 0.46;
      const tw = textWidth(text, fnt, cap);
      if (tw > r0 * 1.78) cap *= (r0 * 1.78) / tw;
      const pop = age >= 0 ? 1 + 0.12 * Math.exp(-age * 8) : 0.8;
      g.save(); g.scale(pop, pop);
      setFont(g, fnt, cap);
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.globalAlpha = clamp01((age + 0.15) / 0.15);
      g.fillStyle = mask ? maskFill(age) : '#FFFFFF';
      g.fillText(text, 0, cap / 2);
      g.restore();
    }
    // rings: support and connective words written along circles; ring i rotates at ±(i+1) turns per 8 bars
    const nRings = Math.min(3, Math.max(1, Math.ceil(others.length / Math.max(2, Math.round(5 * this.num('density'))))));
    const perRing = Math.ceil(others.length / nRings);
    for (let ri = 0; ri < nRings; ri++) {
      const ws = others.slice(ri * perRing, (ri + 1) * perRing);
      if (!ws.length) continue;
      const rr = r0 * (1.32 + ri * 0.36) * this.num('density') ** 0.2;
      const rot = ((ri % 2 ? -1 : 1) * (ri + 1) * clock * Math.PI * 2) / 8;
      const cap = Math.min(R * 0.07, r0 * 0.2);
      setFont(g, ri === 0 ? 'montserrat600' : 'barlow', cap);
      let ang = rot - Math.PI / 2;
      for (const w of ws) {
        const age = t - (w.start - antic);
        const text = cleanDisplay(w, this.s.caseMode) + '  ·  ';
        const vis = smooth(clamp01((age + 0.3) / 0.3));            // rings fade in from the centre as the line is sung
        for (const ch of text) {
          const cw = g.measureText(ch).width;
          const da = cw / rr;
          if (vis > 0.01 && ch !== ' ') {
            g.save();
            g.rotate(ang + da / 2);
            g.translate(0, -rr * (0.8 + 0.2 * vis));
            g.globalAlpha = vis * (age >= 0 ? 1 : 0.4);
            g.fillStyle = mask ? maskFill(age, vis) : col.pal[(ri + 2) % col.pal.length];
            g.textAlign = 'center';
            g.fillText(ch, 0, 0);
            g.restore();
          }
          ang += da;
        }
      }
    }
    g.restore();
    if (!mask) subtitle(g, ly.lines[lineAt(ly, t)], t, this.s, W, H, '#fff');
    if (mask) {
      this.scope.pass(this.scope.program(FS_MASK), target, { uTex: this.scope.upload('mask', ov.c as HTMLCanvasElement) });
      return;
    }
    const ovTex = this.scope.upload('over', ov.c as HTMLCanvasElement);
    // ---- the folded ornament wedge ----
    const wd = this.layer('wedge');
    wd.g.clearRect(0, 0, W, H);
    this.wedge(wd.g, t, Math.hypot(W, H) * 0.55, r0 * 1.05, n, col.pal);
    const wTex = this.scope.upload('wedge', wd.c as HTMLCanvasElement);
    // drops: a zoom punch 1.25 → 1 over one beat
    const beat = 60 / (a.bpm || 120);
    let zoom = 1;
    if (!this.s.reduceMotion) for (const d of a.drops) if (t >= d && t < d + beat) zoom = 1.25 - 0.25 * easeOutCubic((t - d) / beat);
    const sec = a.sections.find((s) => t >= s.start && t < s.end);
    const bg1 = hsl(col.base, col.sat * 0.6, 0.12), bg2 = hsl(col.base + 40, col.sat * 0.5, 0.03);
    this.scope.pass(this.scope.program(FS), target, {
      uWedge: wTex, uOver: ovTex, uRes: [W, H], uN: n, uZoom: zoom, uT: t, uTransparent: this.s.transparentBackground ? 1 : 0,
      uInvert: this.bool('invertBridges') && sec?.label === 'bridge' ? 1 : 0, uBg1: bg1, uBg2: bg2,
    });
  }
}
registerEffect(Mandala);

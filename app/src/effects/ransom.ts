// RANSOM — paper collage in stop motion (SPEC §8.14). Every letter is cut from a different magazine;
// everything moves "on twos". Letters are drawn procedurally from seeded swatch parameters each frame.
// Reduce motion calms: the boil (off), slide-ins (become slaps) and the board wipe (becomes a cut).
import type { Target } from '../render/glhost.ts';
import { type EffectContext, type EffectMeta, range, toggle, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { TextShaderEffect, FS_BLIT, maskFill } from './common.ts';
import { FS_HEAD, GLSL_NOISE } from '../render/gl.ts';
import { type Ctx2D, graphemes, clamp01, subtitle, lineAt, cleanDisplay } from '../render/textkit.ts';
import { font, sizeForCap, makeCanvas, capRatio } from '../render/sdf.ts';
import { drawIcon } from '../render/icons.ts';
import { mulberry32, hash01, lowerBound } from '../analysis/dsp.ts';
import type { Word } from '../types.ts';

const FONTS = ['bebas', 'abril', 'rubik', 'elite', 'playfair', 'oswald', 'caslon'];
type Paper = 'news' | 'gloss' | 'kraft' | 'photo' | 'black';
const PAPERS: Paper[] = ['news', 'gloss', 'kraft', 'photo', 'black'];
const GLOSS = ['#E63946', '#1D70B8', '#F4D35E', '#2A9D8F', '#F28482', '#7B2CBF', '#FF7B00', '#06D6A0'];

const FS_ZINE = FS_HEAD + GLSL_NOISE + `
uniform sampler2D uTex; uniform vec2 uRes; uniform float uFrame;
void main(){
  vec2 uv = vUv; vec2 px = uv * uRes;
  vec3 W3 = vec3(0.3, 0.59, 0.11);
  float lumA = dot(texture(uTex, uv).rgb, W3);
  float lumB = dot(texture(uTex, uv + vec2(1.5, -1.0) / uRes).rgb, W3);                     // misregistration
  float local = dot(textureLod(uTex, uv, 5.0).rgb, W3);                                       // the copier's auto-exposure
  float n = (hash21(floor(px / 1.5)) - 0.5) * 0.08 + (fbm3(px * 0.01) - 0.5) * 0.06;          // toner noise
  float thr = min(local - 0.1, 0.5) + n;
  float ink = step(lumA, thr) + step(lumA, 0.16) * 0.0, ink2 = step(lumB, thr);
  ink = max(ink, step(lumA + n, 0.2)); ink2 = max(ink2, step(lumB + n, 0.2));
  vec3 paper = vec3(0.93, 0.92, 0.88) - 0.04 * fbm3(px * 0.004);
  vec3 c = mix(paper, vec3(0.08, 0.08, 0.1), ink);
  c = mix(c, vec3(0.35, 0.1, 0.12), (ink2 - ink) * 0.35 * step(0.0, ink2 - ink));
  c *= 1.0 - 0.06 * step(0.97, hash21(floor(px * 0.25) + floor(uFrame / 2.0)));               // speckle, boils on twos
  o = vec4(c, 1.0);
}`;

interface Glyph { ch: string; fontK: string; size: number; upper: boolean; paper: Paper; colour: string; inv: boolean; rot: number; poly: number[]; w: number; h: number }
interface RWord { w: Word; glyphs: Glyph[]; x: number; y: number; width: number; entrance: 'slap' | 'slide' | 'drop'; side: number }
interface RLine { words: RWord[]; scale: number; ox: number; oy: number; start: number; end: number; section: number }

export class Ransom extends TextShaderEffect {
  static meta: EffectMeta = {
    id: 'ransom', name: 'Ransom', kind: 'gl',
    description: 'Paper collage in stop motion: every letter cut from a different magazine, taped, stapled and doodled on the beat.',
    affinity: aff(0.75, 0.5, 0.6, 0.6, 0.55, 0.55, 0.65, 0.7),
    supportsTransparent: true,
    params: [
      range('chaos', 'Chaos', 'Collage', 1, 0, 2, 0.01, false),
      select('fps', 'Frame rate', 'Motion', '12', ['24', '12', '8'], true, 'on ones, twos or threes'),
      range('paperMix', 'Paper mix', 'Collage', 1, 0, 1, 0.01, false, '0 = newsprint only'),
      toggle('tape', 'Tape', 'Decorations', true),
      toggle('doodles', 'Doodles', 'Decorations', true),
      select('background', 'Background', 'Board', 'corkboard', ['corkboard', 'kraft', 'black paper', 'photocopied wall']),
      toggle('zine', 'Zine mode', 'Board', false),
    ],
  };
  readonly meta = Ransom.meta;
  private lines: RLine[] = [];
  private patterns: Record<string, HTMLCanvasElement | OffscreenCanvas> = {};

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const { W, H } = this, ly = this.ly;
    const chaos = this.num('chaos');
    const mix = this.num('paperMix');
    this.lines = ly.lines.map((line, li) => {
      const rnd = mulberry32(this.seed * 1009 + li * 7919);
      const words: RWord[] = [];
      const base = 100;
      let x = 0, y = 0, rowH = 0;
      const maxW = 1000;
      for (const w of line.words.map((i) => ly.words[i])) {
        const hero = w.role === 'hero' && !w.backing;
        const scale = w.backing ? 0.5 : hero ? 1.25 : w.role === 'connective' ? 0.68 : 0.9;
        const gs = graphemes(cleanDisplay(w, 'as-is', true));
        const glyphs: Glyph[] = gs.map((ch) => {
          const fontK = FONTS[Math.floor(rnd() * FONTS.length)];
          const size = base * scale * (1 + (rnd() - 0.5) * 0.24);
          const paper: Paper = rnd() < mix ? PAPERS[Math.floor(rnd() * PAPERS.length)] : 'news';
          const g: Glyph = { ch, fontK, size, upper: rnd() < 0.55, paper, colour: GLOSS[Math.floor(rnd() * GLOSS.length)], inv: rnd() < 0.15, rot: (rnd() - 0.5) * 2 * (8 * Math.PI / 180) * chaos, poly: [], w: 0, h: 0 };
          const c = makeCanvas(4, 4).getContext('2d') as Ctx2D;
          c.font = font(fontK, sizeForCap(fontK, size * 0.62));
          const txt = g.upper ? ch.toUpperCase() : ch.toLowerCase();
          g.w = Math.max(size * 0.38, c.measureText(txt).width + size * 0.22);
          g.h = size * 0.98;
          // the cut edge: a jittered polygon around the letter's box
          for (let k = 0; k < 8; k++) g.poly.push((rnd() - 0.5) * size * 0.08 * chaos);
          return g;
        });
        const width = glyphs.reduce((s, g) => s + g.w * 0.94, 0);
        if (x > 0 && x + width > maxW) { x = 0; y += rowH * 1.3; rowH = 0; }
        const r = rnd();
        words.push({ w, glyphs, x, y, width, entrance: this.s.reduceMotion ? 'slap' : r < 0.45 ? 'slap' : r < 0.75 ? 'slide' : 'drop', side: rnd() < 0.5 ? -1 : 1 });
        x += width + base * 0.32;
        rowH = Math.max(rowH, base * scale);
      }
      const width = Math.max(...words.map((p) => p.x + p.width)), height = y + rowH;
      // centre rows
      const rows = new Map<number, RWord[]>();
      for (const p of words) { if (!rows.has(p.y)) rows.set(p.y, []); rows.get(p.y)!.push(p); }
      for (const rw of rows.values()) { const e = rw[rw.length - 1].x + rw[rw.length - 1].width; for (const p of rw) p.x += (width - e) / 2; }
      const scale = Math.min((W * 0.86) / width, (H * 0.6) / Math.max(1, height));
      return { words, scale, ox: (W - width * scale) / 2, oy: (H - height * scale) / 2 + base * scale * 0.85, start: line.start, end: line.end, section: line.section };
    });
    // paper textures as patterns
    const mk = (w: number, h: number, fn: (g: CanvasRenderingContext2D) => void) => { const c = makeCanvas(w, h); fn(c.getContext('2d') as CanvasRenderingContext2D); return c; };
    const r2 = mulberry32(this.seed);
    this.patterns.news = mk(64, 64, (g) => { g.fillStyle = '#E9E5DA'; g.fillRect(0, 0, 64, 64); g.fillStyle = 'rgba(30,30,30,0.22)'; for (let y = 0; y < 64; y += 4) for (let x = 0; x < 64; x += 4) { g.beginPath(); g.arc(x + ((y / 4) % 2) * 2, y, 0.9 + r2() * 0.6, 0, 7); g.fill(); } });
    this.patterns.kraft = mk(128, 128, (g) => { g.fillStyle = '#B88B5A'; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${r2() < 0.5 ? '70,45,20' : '230,200,160'},${0.08 + r2() * 0.12})`; g.fillRect(r2() * 128, r2() * 128, 1 + r2() * 6, 1); } });
    this.patterns.cork = mk(160, 160, (g) => { g.fillStyle = '#A9744F'; g.fillRect(0, 0, 160, 160); for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${r2() < 0.5 ? '90,50,25' : '210,160,110'},${0.2 + r2() * 0.3})`; g.beginPath(); g.arc(r2() * 160, r2() * 160, 0.6 + r2() * 1.8, 0, 7); g.fill(); } });
    this.patterns.wall = mk(200, 200, (g) => { g.fillStyle = '#D9D6CE'; g.fillRect(0, 0, 200, 200); for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(0,0,0,${r2() * 0.08})`; g.fillRect(r2() * 200, r2() * 200, 1 + r2() * 2, 1 + r2() * 2); } });
  }

  private poseTime(t: number): { tp: number; pose: number; fr: number } {
    const fr = Number(this.str('fps')) || 12;
    const pose = Math.floor(t * fr + 1e-6);
    return { tp: pose / fr, pose, fr };
  }

  private board(g: Ctx2D, section: number, alpha = 1): void {
    const { W, H } = this;
    const kind = this.str('background');
    g.save();
    g.globalAlpha = alpha;
    const pat = kind === 'kraft' ? this.patterns.kraft : kind === 'photocopied wall' ? this.patterns.wall : kind === 'black paper' ? null : this.patterns.cork;
    if (pat) { g.fillStyle = g.createPattern(pat as HTMLCanvasElement, 'repeat')!; } else g.fillStyle = '#16161a';
    g.translate((section * 53) % 97, (section * 31) % 89);
    g.fillRect(-100, -100, W + 200, H + 200);
    g.restore();
    if (kind === 'black paper') { g.fillStyle = 'rgba(255,255,255,0.025)'; for (let i = 0; i < 300; i++) g.fillRect(hash01(i, section, 1) * W, hash01(i, section, 2) * H, 2, 1); }
  }

  protected paint(t: number, g: Ctx2D, mask: boolean): void {
    const { W, H } = this, a = this.a;
    const { tp, pose, fr } = this.poseTime(t);
    const ly = this.ly;
    const li = lineAt(ly, tp + 0.5);
    const L = this.lines[Math.max(0, li)];
    if (!mask && !this.s.transparentBackground) {
      // boards: each section gets a new board through a torn-paper wipe
      const sec = L ? L.section : 0;
      const secStart = a.sections[sec]?.start ?? 0;
      this.board(g, sec);
      const prevSec = li > 0 ? this.lines.slice(0, li).reverse().find((l) => l.section !== sec)?.section : undefined;
      const u = clamp01((tp - (secStart - 0.15)) / 0.45);
      if (prevSec !== undefined && u < 1 && !this.s.reduceMotion) {
        // the old board is torn away diagonally: a ragged edge with a paper-fibre fringe
        const edge = (yy: number) => W * (1.15 - u * 1.45) + (yy / H) * W * 0.25 + (hash01(Math.floor(yy / 9), sec, 3) - 0.5) * 26;
        g.save();
        g.beginPath(); g.moveTo(-10, -10);
        for (let yy = -10; yy <= H + 10; yy += 9) g.lineTo(edge(yy), yy);
        g.lineTo(-10, H + 10); g.closePath(); g.clip();
        this.board(g, prevSec);
        g.restore();
        g.strokeStyle = 'rgba(245,240,228,0.95)'; g.lineWidth = 5;
        g.beginPath(); for (let yy = -10; yy <= H + 10; yy += 9) { const xx = edge(yy) + 2; if (yy < -5) g.moveTo(xx, yy); else g.lineTo(xx, yy); } g.stroke();
      }
    }
    if (!L) return;
    const boil = this.s.reduceMotion ? 0 : 1;
    g.save();
    g.translate(L.ox, L.oy);
    g.scale(L.scale, L.scale);
    const antic = this.s.anticipationMs / 1000;
    const beatIdx = lowerBound(a.beats, tp + 1e-6) - 1;
    const sec = a.sections.find((s) => tp >= s.start && tp < s.end);
    const chorus = sec?.label === 'chorus' || sec?.label === 'drop';
    for (const p of L.words) {
      const land = p.w.start - antic;
      // the pose that contains the onset is the landed pose
      const posesBefore = Math.floor(land * fr + 1e-6) - pose;
      if (posesBefore > 3) continue;
      const k = posesBefore <= 0 ? 1 : 0;
      let dx = 0, dy = 0, sc = 1, sy = 1;
      if (k < 1) {
        if (p.entrance === 'slap') { sc = posesBefore === 1 ? 1.3 : 1.6; if (posesBefore > 2) continue; }
        else if (p.entrance === 'slide') dx = p.side * (posesBefore / 3) * (W / L.scale);
        else { dy = -(posesBefore / 3) * (H / L.scale) * 0.6; if (posesBefore === 1) sy = 1.15; }
      } else if (posesBefore === 0 && p.entrance === 'slap') sc = 0.94;          // 1-pose overshoot
      else if (posesBefore === 0 && p.entrance === 'drop') sy = 0.86;            // 1-pose squash
      let x = p.x;
      p.glyphs.forEach((gl, gi) => {
        const sd = p.w.id * 37 + gi;
        const jx = boil * (hash01(sd, pose, 1) - 0.5) * 1.2, jy = boil * (hash01(sd, pose, 2) - 0.5) * 1.2;
        const jr = boil * (hash01(sd, pose, 3) - 0.5) * (0.8 * Math.PI / 180);
        g.save();
        g.translate(x + gl.w / 2 + dx + jx, p.y - gl.h * 0.42 + dy + jy);
        g.rotate(gl.rot + jr);
        g.scale(sc, sc * sy);
        this.swatch(g, gl, mask, t - land);
        g.restore();
        x += gl.w * 0.94;
      });
      if (mask || k < 1) continue;
      // decorations
      const hero = p.w.role === 'hero' && !p.w.backing;
      if (this.bool('tape') && hero) { // masking tape lands on a downbeat
        const db = a.downbeats.find((d) => d >= land - 0.05);
        if (db !== undefined && tp >= db) {
          g.save(); g.translate(p.x + p.width * 0.5, p.y - 100 * 1.1); g.rotate((hash01(p.w.id, 8) - 0.5) * 0.5);
          g.fillStyle = 'rgba(240,226,180,0.82)';
          g.beginPath(); g.moveTo(-60, -14); for (let i = 0; i <= 6; i++) g.lineTo(-60 + i * 20, -14 + (i % 2 ? 3 : 0)); g.lineTo(60, 14); for (let i = 6; i >= 0; i--) g.lineTo(-60 + i * 20, 14 - (i % 2 ? 3 : 0)); g.closePath(); g.fill();
          g.restore();
        }
      }
      if (chorus && p.w.role === 'support') { // staples on supports in choruses
        g.strokeStyle = '#B8BCC4'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(p.x + 8, p.y - 70); g.lineTo(p.x + 30, p.y - 74); g.stroke();
      }
      if (this.bool('doodles') && hero && beatIdx >= 0) { // marker doodles drawn on beats, revealed over 2 poses
        const bAfter = a.beats.filter((b) => b >= land && b <= tp).length;
        if (bAfter > 0) {
          const bt = a.beats[lowerBound(a.beats, land)];
          const rev = clamp01((pose - Math.floor(bt * fr) + 1) / 2);
          const kind = Math.floor(hash01(p.w.id, this.seed, 12) * 4);
          g.save();
          g.strokeStyle = ['#E63946', '#1D70B8', '#111111', '#FF7B00'][kind]; g.lineWidth = 6; g.lineCap = 'round';
          const cx = p.x + p.width / 2, cy = p.y - 40;
          g.beginPath();
          if (kind === 0) { g.ellipse(cx, cy, p.width * 0.62, 78, -0.06, 0, Math.PI * 2 * rev); }
          else if (kind === 1) { g.moveTo(p.x - 10, p.y + 26); g.quadraticCurveTo(cx, p.y + 40, p.x + (p.width + 10) * rev, p.y + 22); }
          else if (kind === 2) { const ax = p.x + p.width + 70, ay = p.y - 140; g.moveTo(ax + 60, ay - 50); g.lineTo(ax + 60 - 60 * rev, ay - 50 + 50 * rev); if (rev >= 1) { g.moveTo(ax, ay); g.lineTo(ax + 22, ay - 2); g.moveTo(ax, ay); g.lineTo(ax + 4, ay - 22); } }
          else { g.restore(); g.save(); g.fillStyle = '#FF7B00'; g.globalAlpha = rev; g.translate(p.x + p.width + 40, p.y - 120); g.rotate(0.3); drawIcon(g, 'star', 28); }
          g.stroke();
          g.restore();
        }
      }
      x = 0;
    }
    g.restore();
    if (!mask) subtitle(g, ly.lines[lineAt(ly, t)], t, this.s, W, H, '#fff');
  }

  /** One magazine cut-out, centred on the origin. */
  private swatch(g: Ctx2D, gl: Glyph, mask: boolean, age: number): void {
    const w = gl.w, h = gl.h, p = gl.poly;
    const path = () => {
      g.beginPath();
      g.moveTo(-w / 2 + p[0], -h / 2 + p[1]); g.lineTo(w / 2 + p[2], -h / 2 + p[3]);
      g.lineTo(w / 2 + p[4], h / 2 + p[5]); g.lineTo(-w / 2 + p[6], h / 2 + p[7]); g.closePath();
    };
    const txt = gl.upper ? gl.ch.toUpperCase() : gl.ch.toLowerCase();
    g.font = font(gl.fontK, sizeForCap(gl.fontK, gl.size * 0.62));
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const baseY = gl.size * 0.62 * 0.5;
    if (mask) { g.fillStyle = maskFill(age); g.fillText(txt, 0, baseY); return; }
    // soft drop shadow, then the paper
    g.save(); g.translate(4, 6); path(); g.fillStyle = 'rgba(0,0,0,0.28)'; g.fill(); g.restore();
    let bg: string | CanvasPattern | CanvasGradient = '#EEE', ink = '#111';
    switch (gl.paper) {
      case 'news': bg = g.createPattern(this.patterns.news as HTMLCanvasElement, 'repeat')!; ink = '#141414'; break;
      case 'gloss': bg = gl.colour; ink = '#FFFFFF'; break;
      case 'kraft': bg = g.createPattern(this.patterns.kraft as HTMLCanvasElement, 'repeat')!; ink = '#1B1209'; break;
      case 'photo': { const gr = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2); gr.addColorStop(0, '#4E5D6C'); gr.addColorStop(0.5, '#C7B299'); gr.addColorStop(1, '#2F3E46'); bg = gr; ink = '#FFF8EC'; break; }
      case 'black': bg = '#111'; ink = '#F5F5F5'; break;
    }
    if (gl.inv) [bg, ink] = [ink, typeof bg === 'string' ? bg : '#E9E5DA'];
    if (gl.paper === 'gloss') { g.save(); g.scale(1.06, 1.05); path(); g.fillStyle = '#FBFAF6'; g.fill(); g.restore(); } // white paper fringe
    path(); g.fillStyle = bg; g.fill();
    g.fillStyle = ink;
    g.fillText(txt, 0, baseY);
    void capRatio;
  }

  protected shade(t: number, target: Target, text: WebGLTexture): void {
    if (this.bool('zine')) this.scope.pass(this.scope.program(FS_ZINE), target, { uTex: text, uRes: [this.W, this.H], uFrame: this.poseTime(t).pose });
    else this.scope.pass(this.scope.program(FS_BLIT), target, { uTex: text });
  }
}
registerEffect(Ransom);

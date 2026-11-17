// SIGNAL — a terminal, a CRT and a bad VHS tape (SPEC §8.10).
// Lyrics are typed per syllable into a log; drops tear the signal apart. The text layer is drawn at the
// CRT's virtual resolution; phosphor persistence re-renders it at t − k/60 (deterministic, no feedback).
// Reduce motion calms: glitches (off), the rolling slip, VHS wobble and the cursor blink.
import type { Target } from '../render/glhost.ts';
import { GLEffect, type EffectContext, type EffectMeta, range, toggle, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { FS_HEAD, GLSL_NOISE, hexToRgb } from '../render/gl.ts';
import { makeCanvas, font, sizeForCap } from '../render/sdf.ts';
import { type Ctx2D, graphemes, clamp01, smooth } from '../render/textkit.ts';
import { hash01, lowerBound, sample } from '../analysis/dsp.ts';
import { keyName } from '../analysis/harmony.ts';
import type { Word } from '../types.ts';
import { FS_MASK_BLIT } from './common.ts';

const PHOS: Record<string, string> = { green: '#39FF7A', amber: '#FFB21A', white: '#E6EEFF', blue: '#6CB8FF' };

const FS = FS_HEAD + GLSL_NOISE + `
uniform sampler2D uText;
uniform vec2 uRes, uVRes; uniform vec4 uScreen; uniform float uT, uFrame, uCurv, uScan, uDisplay, uFrameStyle, uRotate, uAtten, uRoll, uTransparent;
uniform vec3 uPhos; uniform vec4 uGlitch; // amount, seed, rgb split px, smear
vec4 txt(vec2 uv, float lod){ return textureLod(uText, uv, lod); }
void main(){
  vec2 uv = vUv;
  vec3 outc = vec3(0.0); float alpha = 1.0;
  // ---- monitor frame ----
  vec2 suv = (uv - uScreen.xy) / uScreen.zw;
  bool inScreen = all(greaterThanEqual(suv, vec2(0.0))) && all(lessThanEqual(suv, vec2(1.0)));
  if(uFrameStyle > 0.5){
    vec2 d = abs(suv - 0.5) * uScreen.zw * vec2(uRes.x / uRes.y, 1.0);
    vec2 half_ = 0.5 * uScreen.zw * vec2(uRes.x / uRes.y, 1.0);
    float rr = 0.04;
    float sd = length(max(d - half_ + rr, 0.0)) - rr;
    if(sd > 0.0){
      vec3 bez = uFrameStyle < 1.5 ? vec3(0.85, 0.81, 0.72) : vec3(0.1, 0.1, 0.11);
      bez *= 0.85 + 0.15 * smoothstep(0.0, 1.0, 1.0 - uv.y) + 0.03 * vnoise(uv * uRes * 0.5);
      bez *= 1.0 - 0.5 * smoothstep(0.03, 0.0, sd) * smoothstep(0.0, 0.03, sd);      // inner recess
      bez = mix(bez * 0.35, bez, smoothstep(0.0, 0.025, sd));
      if(uFrameStyle < 1.5){ // vents and a power LED on the beige bezel
        vec2 q = uv * uRes;
        bez *= 1.0 - 0.2 * step(0.92, 1.0 - uv.y) * step(fract(q.x / 12.0), 0.35) * step(abs(uv.x - 0.5), 0.2);
        bez = mix(bez, vec3(0.2, 1.0, 0.3), smoothstep(0.006, 0.0, length((uv - vec2(uScreen.x + uScreen.z - 0.03, uScreen.y - 0.04)) * vec2(uRes.x / uRes.y, 1.0))));
      }
      o = vec4(bez, 1.0); return;
    }
  }
  if(uRotate > 0.5) suv = vec2(1.0 - suv.y, suv.x);
  // ---- tube geometry ----
  vec2 c = suv - 0.5;
  if(uDisplay > 0.5){ c *= 1.0 + 0.12 * uCurv * 4.0 * dot(c, c) * 0.5; }
  vec2 tuv = c + 0.5;
  float edge = step(0.0, tuv.x) * step(tuv.x, 1.0) * step(0.0, tuv.y) * step(tuv.y, 1.0);
  // VHS: horizontal wobble, rolling slip on drops
  if(uDisplay > 1.5){ tuv.x += sin(tuv.y * uVRes.y * 0.03 + uT * 2.0) * 1.5 / uVRes.x; }
  tuv.y = fract(tuv.y + uRoll);
  // ---- glitch: block displacement, row smear, RGB split ----
  float gA = uGlitch.x;
  if(gA > 0.0){
    vec2 cell = floor(tuv * vec2(7.0, 23.0));
    float h = hash21(cell + uGlitch.y);
    if(h < 0.18 * gA) tuv.x += (hash21(cell.yx + uGlitch.y * 3.1) - 0.5) * 0.22;
  }
  float split = (uGlitch.z + (uDisplay > 1.5 ? 0.6 : 0.0)) / uVRes.x;
  vec4 T = txt(tuv, 0.0);
  float r = txt(tuv + vec2(split, 0.0), 0.0).r, b = txt(tuv - vec2(split, 0.0), 0.0).r;
  float I = T.r;
  if(uGlitch.w > 0.0){ // pixel sort: within bands, each pixel takes the brightest pixel up to 40 px to its left
    float band = step(1.0 - 0.3 * uGlitch.w, hash11(floor(tuv.y * 40.0) + uGlitch.y));
    if(band > 0.5){ float m = I; for(int i=1;i<=12;i++){ float s = txt(tuv - vec2(float(i) * 40.0 / 12.0 / uVRes.x, 0.0), 1.0).r; if(s > 0.35) m = max(m, s); } I = m; r = max(r, m); b = max(b, m); }
  }
  // ---- phosphor colour, bloom ----
  vec3 col = uPhos * vec3(mix(I, r, 0.5), I, mix(I, b, 0.5));
  vec3 bloom = uPhos * (txt(tuv, 3.0).r * 0.55 + txt(tuv, 5.0).r * 0.45);
  col += bloom * (uDisplay > 0.5 ? 0.9 : 0.55);
  col += uPhos * 0.025;                                    // the tube's own glow
  if(uDisplay > 0.5){
    float row = tuv.y * uVRes.y;
    float scan = 0.5 + 0.5 * cos(6.2831853 * row);         // cos² per row
    col *= 1.0 - uScan * 0.35 * (1.0 - scan * scan);
    float px = mod(floor(uv.x * uRes.x), 3.0);              // aperture grille
    vec3 grille = px < 0.5 ? vec3(1.12, 0.92, 0.92) : px < 1.5 ? vec3(0.92, 1.12, 0.92) : vec3(0.92, 0.92, 1.12);
    col *= mix(vec3(1.0), grille, 0.6);
    col *= 1.0 - 0.6 * smoothstep(0.32, 0.72, length(c * vec2(1.05, 1.15)));   // vignette, edge darkening
    col *= 1.0 + 0.005 * (hash11(uFrame * 1.37) - 0.5) * 2.0;                     // flicker by frame index
  }
  if(uDisplay > 1.5){
    // chroma bleed: chroma shifted 3 px and blurred
    vec3 sh = uPhos * txt(tuv - vec2(3.0 / uVRes.x, 0.0), 1.5).r;
    float y = dot(col, vec3(0.299, 0.587, 0.114));
    col = y + (sh - dot(sh, vec3(0.299, 0.587, 0.114))) * 1.3 + (col - y) * 0.4;
    // tracking lines rolling upward
    float tl = fract(tuv.y * 0.7 + uT * 0.07);
    col += vec3(0.6) * smoothstep(0.012, 0.0, abs(tl - 0.5)) * hash21(vec2(floor(tuv.x * 220.0), floor(uT * 30.0))) * 0.5;
    // head-switching noise in the bottom 4 %
    float hs = step(tuv.y, 0.04);
    col = mix(col, vec3(hash21(vec2(floor(uv.x * uRes.x * 0.5), uFrame))) * 0.6, hs * 0.7);
  }
  col *= edge;
  col = mix(col, vec3(1.0), clamp(gA * 0.0, 0.0, 1.0));
  alpha = uTransparent > 0.5 ? clamp(max(col.r, max(col.g, col.b)) * 1.4, 0.0, 1.0) : 1.0;
  o = vec4(col, alpha);
}`;

interface Entry { t: number; kind: 'line' | 'sys' | 'art'; rows: { chars: { ch: string; t: number }[]; inverse?: boolean }[]; }
/** rows an entry occupies (block art uses half-height rows) */
const rowsOf = (e: Entry) => (e.kind === 'art' ? Math.ceil(e.rows.length / 2) : e.rows.length);
interface Glitch { t: number; dur: number; seed: number; roll: boolean }

export class Signal extends GLEffect {
  static meta: EffectMeta = {
    id: 'signal', name: 'Signal', kind: 'gl',
    description: 'Lyrics typed into a terminal on an old monitor: phosphor, scanlines, VHS tape and glitches that tear the signal on drops.',
    affinity: aff(0.75, 0.55, 0.85, 0.85, 0.45, 0.8, 0.3, 0.75),
    supportsTransparent: true, supportsLive: true,
    params: [
      select('phosphor', 'Phosphor', 'Display', 'green', ['green', 'amber', 'white', 'blue']),
      select('display', 'Display', 'Display', 'CRT', ['clean', 'CRT', 'VHS']),
      range('curvature', 'Curvature', 'Display', 1, 0, 2, 0.01),
      range('scanlines', 'Scanlines', 'Display', 1, 0, 1.5, 0.01),
      range('persistence', 'Persistence', 'Display', 1, 0, 1.5, 0.01),
      range('glitch', 'Glitch amount', 'Glitch', 1, 0, 2, 0.01),
      toggle('blockArt', 'Block-art heroes', 'Text', true, false),
      select('log', 'Log style', 'Text', 'prompt', ['prompt', 'timestamp'], false),
      toggle('system', 'System messages', 'Text', true, false),
      select('monitor', 'Monitor frame', 'Display', 'none', ['none', 'beige', 'studio'], false),
      select('portrait', 'Portrait', 'Display', 'reflow', ['reflow', 'rotate'], false),
    ],
  };
  readonly meta = Signal.meta;
  private entries: Entry[] = [];
  private rowStart: number[] = [];   // first row index of each entry
  private glitches: Glitch[] = [];
  private VW = 960; private VH = 720; private cols = 60; private rowsVis = 22; private cell = 32; private charW = 16;
  private screen: [number, number, number, number] = [0, 0, 1, 1];
  private rotate = false;

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const { W, H } = this, a = this.a, ly = this.ly;
    const portrait = H > W;
    const framed = this.str('monitor') !== 'none';
    this.rotate = portrait && this.str('portrait') === 'rotate';
    // the screen rectangle (uv, y up) and the virtual resolution
    if (framed) {
      const sa = this.rotate || !portrait ? 4 / 3 : 3 / 4;
      let sh = portrait ? 0.62 : 0.8, sw = (sh * H * sa) / W;
      if (sw > 0.86) { sw = 0.86; sh = (sw * W) / (H * sa); }
      this.screen = [(1 - sw) / 2, (1 - sh) / 2 + 0.03, sw, sh];
      [this.VW, this.VH] = sa > 1 ? [960, 720] : [720, 960];
    } else {
      this.screen = [0, 0, 1, 1];
      if (this.rotate) [this.VW, this.VH] = [Math.round((720 * H) / W), 720];
      else [this.VW, this.VH] = portrait ? [720, Math.round((720 * H) / W)] : [Math.round((720 * W) / H), 720];
    }
    if (this.rotate && framed) [this.VW, this.VH] = [960, 720];
    this.rowsVis = Math.max(10, Math.round(this.VH / 52));
    this.cell = Math.floor(this.VH / this.rowsVis);
    const g = makeCanvas(8, 8).getContext('2d') as Ctx2D;
    g.font = font('vt323', this.cell);
    this.charW = g.measureText('M').width;
    this.cols = Math.max(16, Math.floor((this.VW - this.cell) / this.charW));
    const antic = this.s.anticipationMs / 1000;
    const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
    const entries: Entry[] = [];
    const sys = (t: number, text: string) => { if (this.bool('system')) entries.push({ t, kind: 'sys', rows: [{ chars: graphemes(` ${text} `).map((ch, i) => ({ ch, t: t + i * 0.012 })), inverse: true }] }); };
    // ---- lines: characters typed per syllable (first 70 % of each syllable, jittered ±15 ms) ----
    let lastArt = -Infinity;
    for (const line of ly.lines) {
      const ws = line.words.map((i) => ly.words[i]);
      const prefix = this.str('log') === 'timestamp' ? `[${fmt(line.start)}] ` : '> ';
      const chars: { ch: string; t: number }[] = graphemes(prefix).map((ch) => ({ ch, t: line.start - antic - 0.05 }));
      for (const w of ws) {
        const text = w.display;
        const syl = w.syllableTimes && w.syllableTimes.length ? w.syllableTimes : [{ text, start: w.start, end: w.end }];
        const gs = graphemes(text);
        // distribute the graphemes over the syllables by their letter counts
        const counts = syl.map((s) => Math.max(1, graphemes(s.text).length));
        const tot = counts.reduce((x, y) => x + y, 0);
        let gi = 0;
        syl.forEach((s, si) => {
          const n = si === syl.length - 1 ? gs.length - gi : Math.round((counts[si] / tot) * gs.length);
          const span = Math.max(0.03, (s.end - s.start) * 0.7);
          for (let k = 0; k < n && gi < gs.length; k++, gi++) {
            const jit = (hash01(w.id * 31 + gi, this.seed, 4) - 0.5) * 0.03;
            chars.push({ ch: gs[gi], t: s.start - antic + (span * k) / Math.max(1, n) + (k ? jit : 0) });
          }
        });
        chars.push({ ch: ' ', t: chars[chars.length - 1].t });
      }
      // wrap at the column count
      const rows: Entry['rows'] = [];
      let cur: { ch: string; t: number }[] = [];
      let lastSpace = -1;
      for (const c of chars) {
        cur.push(c);
        if (c.ch === ' ') lastSpace = cur.length - 1;
        if (cur.length >= this.cols) {
          if (lastSpace > 2) { rows.push({ chars: cur.slice(0, lastSpace) }); cur = [...graphemes('  ').map((ch) => ({ ch, t: cur[lastSpace].t })), ...cur.slice(lastSpace + 1)]; }
          else { rows.push({ chars: cur }); cur = graphemes('  ').map((ch) => ({ ch, t: c.t })); }
          lastSpace = -1;
        }
      }
      if (cur.length) rows.push({ chars: cur });
      entries.push({ t: line.start - antic - 0.05, kind: 'line', rows });
      // block-art hero: rasterise the glyphs at 12 rows; each cell takes █▓▒░ or a space by its coverage
      const hero = ws.filter((w) => w.role === 'hero' && !w.backing).sort((p, q) => q.stress - p.stress)[0];
      if (this.bool('blockArt') && hero && hero.stress > 0.6 && hero.start - lastArt > 9 && graphemes(hero.text).length <= Math.floor(this.cols / 7)) {
        lastArt = hero.start;
        entries.push({ t: hero.start - antic, kind: 'art', rows: this.blockArt(hero, hero.start - antic) });
      }
    }
    // ---- system messages from the analysis ----
    if (a.downbeats.length) { sys(a.downbeats[0], `BPM LOCK ${a.bpm.toFixed(1)}`); if (a.key.confidence > 0.02) sys(a.downbeats[0] + 0.6, `KEY ${keyName(a.key).toUpperCase()}`); }
    for (const s of a.sections.slice(1)) sys(s.start - 0.02, `SECTION › ${s.label.toUpperCase()}`);
    for (const d of a.drops) sys(d + 0.05, 'DROP DETECTED');
    for (let i = 0; i + 1 < ly.lines.length; i++) if (ly.lines[i + 1].start - ly.lines[i].end > 6) sys(ly.lines[i].end + 1.2, 'VOCAL LOST');
    if (ly.lines.length) sys(ly.lines[ly.lines.length - 1].end + 1.5, 'SIGNAL OK');
    entries.sort((p, q) => p.t - q.t);
    this.entries = entries;
    let r = 0;
    this.rowStart = entries.map((e) => { const s = r; r += rowsOf(e); return s; });
    // ---- glitch events: shock words, drops and chord changes in choruses; at most one per bar ----
    const bar = a.downbeats.length > 1 ? (a.downbeats[a.downbeats.length - 1] - a.downbeats[0]) / (a.downbeats.length - 1) : 2;
    const cands: { t: number; roll: boolean }[] = [];
    for (const w of ly.words) if (w.element === 'shock' || w.concept === 'shock') cands.push({ t: w.start, roll: false });
    for (const d of a.drops) cands.push({ t: d, roll: true });
    for (const c of a.chords) { const s = a.sections.find((x) => c.start >= x.start && c.start < x.end); if (s && (s.label === 'chorus' || s.label === 'drop')) cands.push({ t: c.start, roll: false }); }
    cands.sort((p, q) => p.t - q.t);
    this.glitches = [];
    for (const c of cands) {
      const last = this.glitches[this.glitches.length - 1];
      if (last && c.t - last.t < bar * 0.98) { if (c.roll) { last.roll = true; } continue; }
      this.glitches.push({ t: c.t, dur: (2 + Math.floor(hash01(Math.round(c.t * 100), this.seed, 9) * 5)) / 60, seed: hash01(Math.round(c.t * 1000), 3) * 97, roll: c.roll });
    }
  }

  private blockArt(w: Word, t0: number): Entry['rows'] {
    const text = w.display.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
    const rowsN = 12, colsN = Math.min(this.cols - 2, graphemes(text).length * 7);
    const c = makeCanvas(colsN * 4, rowsN * 4);
    const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    g.font = font('oswald', sizeForCap('oswald', rowsN * 4 * 0.8));
    const tw = g.measureText(text).width;
    g.save(); g.scale(Math.min(1, (colsN * 4) / tw), 1);
    g.fillStyle = '#fff'; g.textBaseline = 'alphabetic'; g.fillText(text, 0, rowsN * 4 * 0.9); g.restore();
    const d = g.getImageData(0, 0, colsN * 4, rowsN * 4).data;
    const rows: Entry['rows'] = [];
    for (let ry = 0; ry < rowsN; ry++) {
      const chars: { ch: string; t: number }[] = [];
      for (let cx = 0; cx < colsN; cx++) {
        let cov = 0;
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) cov += d[((ry * 4 + y) * colsN * 4 + cx * 4 + x) * 4 + 3];
        cov /= 16 * 255;
        chars.push({ ch: cov > 0.8 ? '█' : cov > 0.55 ? '▓' : cov > 0.3 ? '▒' : cov > 0.1 ? '░' : ' ', t: t0 + (0.25 * ry) / rowsN });
      }
      rows.push({ chars });
    }
    return rows;
  }

  /** The terminal text at time t (white on black). */
  private paintText(g: Ctx2D, t: number, alpha: number, mask: boolean): void {
    const { VW, VH, cell, charW } = this;
    g.globalAlpha = alpha;
    g.font = font('vt323', cell);
    g.textBaseline = 'alphabetic';
    // how many rows have been printed by t? old lines scroll up smoothly
    let last = -1;
    for (let i = 0; i < this.entries.length; i++) if (this.entries[i].t <= t) last = i;
    if (last < 0) return;
    const totalRows = this.rowStart[last] + rowsOf(this.entries[last]);
    const prevTotal = this.rowStart[last];
    const u = smooth(clamp01((t - this.entries[last].t) / 0.12));
    const scroll = Math.max(0, prevTotal + (totalRows - prevTotal) * u - this.rowsVis + 1);
    const x0 = cell * 0.5, y0 = cell * 1.05;
    for (let i = Math.max(0, last - this.rowsVis - 4); i <= last; i++) {
      const e = this.entries[i];
      if (e.kind === 'art') {
        // block art: cells drawn as half-height character blocks (█ ▓ ▒ ░ by coverage)
        e.rows.forEach((row, ri) => {
          const r = this.rowStart[i] + ri * 0.5 - scroll;
          if (r < -1 || r > this.rowsVis + 1) return;
          const y = y0 + r * cell - cell * 0.78;
          row.chars.forEach((c, k) => {
            if (c.t > t || c.ch === ' ') return;
            g.globalAlpha = alpha * (c.ch === '█' ? 1 : c.ch === '▓' ? 0.72 : c.ch === '▒' ? 0.48 : 0.24);
            g.fillStyle = '#fff';
            g.fillRect(x0 + k * charW, y, charW * 0.9, cell * 0.46);
          });
        });
        g.globalAlpha = alpha;
        continue;
      }
      e.rows.forEach((row, ri) => {
        const r = this.rowStart[i] + ri - scroll;
        if (r < -1 || r > this.rowsVis + 1) return;
        const y = y0 + r * cell;
        if (row.inverse) {
          const n = row.chars.filter((c) => c.t <= t).length;
          if (!n) return;
          g.fillStyle = mask ? '#fff' : '#d8d8d8';
          g.fillRect(x0 - 2, y - cell * 0.82, n * charW + 4, cell * 0.98);
          g.fillStyle = '#000';
        } else g.fillStyle = mask ? '#fff' : e.kind === 'art' ? '#ffffff' : '#c8c8c8';
        let x = x0;
        let lastShown = -1;
        const prevOp = g.globalCompositeOperation;
        if (row.inverse) g.globalCompositeOperation = 'destination-out'; // inverse video: the letters cut out of the bar
        row.chars.forEach((c, k) => { if (c.t <= t) { if (c.ch !== ' ') g.fillText(c.ch, x, y); lastShown = k; } x += charW; });
        g.globalCompositeOperation = prevOp;
        // a block cursor blinks on the beat: on for the first half of each beat
        if (i === last && ri === e.rows.length - 1 && !mask) {
          const bi = lowerBound(this.a.beats, t + 1e-6) - 1;
          const on = this.s.reduceMotion || bi < 0 || (t - this.a.beats[bi]) < 0.5 * ((this.a.beats[bi + 1] ?? this.a.beats[bi] + 0.5) - this.a.beats[bi]);
          if (on) { g.fillStyle = '#c8c8c8'; g.fillRect(x0 + (lastShown + 1) * charW, y - cell * 0.75, charW * 0.9, cell * 0.85); }
        }
      });
    }
    void VW; void VH;
  }

  protected drawGL(t: number, target: Target, mask: boolean): void {
    const { VW, VH } = this;
    const { c, g } = this.layer(mask ? 'mask' : 'text', VW, VH);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000'; g.fillRect(0, 0, VW, VH);
    if (mask) {
      this.paintText(g, t, 1, true);
      // the mask is drawn in output space: place the virtual screen rectangle
      const m = this.layer('maskOut');
      m.g.fillStyle = '#000'; m.g.fillRect(0, 0, this.W, this.H);
      const [sx, sy, sw, sh] = this.screen;
      m.g.drawImage(c as HTMLCanvasElement, sx * this.W, (1 - sy - sh) * this.H, sw * this.W, sh * this.H);
      this.scope.pass(this.scope.program(FS_MASK_BLIT), target, { uTex: this.scope.upload('mask', m.c as HTMLCanvasElement) });
      return;
    }
    // phosphor persistence: re-render at t − k/60 with decay e^(−k/2.4)
    const p = this.num('persistence');
    g.globalCompositeOperation = 'lighter';
    if (p > 0) for (let k = 5; k >= 1; k--) this.paintText(g, t - k / 60, Math.exp(-k / 2.4) * 0.55 * p, false);
    this.paintText(g, t, 1, false);
    g.globalAlpha = 1;
    // VHS on-screen display
    if (this.str('display') === 'VHS') {
      g.font = font('vt323', this.cell * 1.1);
      g.fillStyle = '#ffffff';
      g.fillText('PLAY ▶', this.cell, this.cell * 1.4);
      const ct = Math.max(0, t);
      g.textAlign = 'right';
      g.fillText(`${Math.floor(ct / 3600)}:${String(Math.floor((ct % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(ct % 60)).padStart(2, '0')}`, VW - this.cell, VH - this.cell * 0.9);
      g.textAlign = 'left';
    }
    g.globalCompositeOperation = 'source-over';
    const tex = this.scope.upload('text', c as HTMLCanvasElement, { mip: true });
    // the current glitch
    let gl4: [number, number, number, number] = [0, 0, 0, 0];
    let roll = 0;
    const amt = this.s.reduceMotion ? 0 : this.num('glitch') * this.intensity;
    if (amt > 0) {
      const i = lowerBound(this.glitches.map((x) => x.t), t + 1e-6) - 1;
      const gq = this.glitches[i];
      if (gq && t - gq.t < gq.dur) {
        const fr = Math.floor((t - gq.t) * 60);
        gl4 = [amt * this.flash(t), gq.seed + fr * 1.7, (2 + 6 * hash01(fr, Math.round(gq.seed))) * amt, amt * (hash01(fr, 5) < 0.5 ? 1 : 0)];
      }
      for (const d of this.a.drops) { const dt = t - d; if (dt >= 0 && dt < 0.35) roll = Math.max(roll, (1 - smooth(dt / 0.35)) * 0.4 * amt); }
    }
    const disp = ['clean', 'CRT', 'VHS'].indexOf(this.str('display'));
    let phos = hexToRgb(PHOS[this.str('phosphor')] ?? PHOS.green);
    if (this.s.paletteSource === 'artwork' && this.ctx.artwork) phos = hexToRgb(this.ctx.artwork.vivid1);
    this.scope.pass(this.scope.program(FS), target, {
      uText: tex, uRes: [this.W, this.H], uVRes: [VW, VH], uScreen: this.screen, uT: t, uFrame: Math.round(t * 60) % 4096,
      uCurv: this.num('curvature'), uScan: this.num('scanlines'), uDisplay: disp, uFrameStyle: ['none', 'beige', 'studio'].indexOf(this.str('monitor')),
      uRotate: this.rotate ? 1 : 0, uAtten: this.flash(t), uRoll: roll, uPhos: phos, uGlitch: gl4, uTransparent: this.s.transparentBackground ? 1 : 0,
    });
    void sample;
  }
}
registerEffect(Signal);

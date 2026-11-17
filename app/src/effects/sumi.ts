// SUMI — brush calligraphy on rice paper (SPEC §8.11). Each word is written stroke by stroke while it is sung.
// Strokes follow the glyph skeletons (§7.2); a pressure model shapes the brush, the ink load falls as it writes
// (flying white below 35 %), and a shader bleeds fresh ink into the paper fibres by the time since it was laid.
// Reduce motion calms: the camera follow (holds per line), splashes (off) and the ensō (drawn, not swept).
import type { Target } from '../render/glhost.ts';
import { type EffectContext, type EffectMeta, range, toggle, select, text, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { TextShaderEffect, frameKeys } from './common.ts';
import { FS_HEAD, GLSL_NOISE, hexToRgb } from '../render/gl.ts';
import { type Ctx2D, cleanDisplay, clamp01, isCJKText, graphemes, lineAt, subtitle, easeOutCubic } from '../render/textkit.ts';
import { skeletonize, strokeAt, SKEL_CAP, type Skeleton } from '../render/skeleton.ts';
import { font, sizeForCap } from '../render/sdf.ts';
import { type CamKey, sampleCamera } from '../render/camera.ts';
import { hash01, lowerBound } from '../analysis/dsp.ts';
import type { Word } from '../types.ts';

const INKS: Record<string, { ink: string; paper: string; dark: boolean }> = {
  'black sumi': { ink: '#141210', paper: '#EFE8D8', dark: false }, indigo: { ink: '#1B2A4A', paper: '#ECE6D6', dark: false },
  vermilion: { ink: '#B8321F', paper: '#F1EADB', dark: false }, 'gold on black': { ink: '#D9B45B', paper: '#121110', dark: true },
};

const FS = FS_HEAD + GLSL_NOISE + `
uniform sampler2D uTex; uniform vec2 uRes; uniform vec3 uCam; uniform float uBleed, uTransparent, uDark;
uniform vec3 uInk, uPaper;
float fibres(vec2 w){ // thin random curves baked into the paper
  float a = vnoise(vec2(w.x * 0.02, w.y * 0.9)) * vnoise(vec2(w.x * 0.9 + 3.0, w.y * 0.02));
  return smoothstep(0.55, 0.75, vnoise(w * 0.05) * 0.5 + vnoise(vec2(w.x * 0.012 + w.y * 0.004, w.y * 0.3)) * 0.5) + a;
}
void main(){
  vec2 uv = vUv;
  vec2 w = (vec2(uv.x, 1.0 - uv.y) * uRes - uRes * 0.5) / uCam.z + uCam.xy;   // paper coordinates (move with the camera)
  vec4 t0 = texture(uTex, uv);
  float cov = t0.r;
  float age = t0.a > 0.0 ? t0.g / max(t0.r, 1e-3) : 1.0;                       // 0..1 over the first 1.5 s after laying
  float blur1 = textureLod(uTex, uv, 1.5).r, blur2 = textureLod(uTex, uv, 3.0).r;
  // wet bleed: the edge spreads to r(t) = r0·(1 − e^(−t/0.25)), thresholded against the fibres
  float grow = 1.0 - exp(-age * 1.5 / 0.25);
  float fib = fibres(w * 1.0);
  float bleed = smoothstep(0.55, 0.9, blur2 * 1.6 * grow * uBleed + fib * 0.25) * blur2;
  float ink = clamp(cov + bleed * 0.35, 0.0, 1.0);
  ink += 0.35 * clamp(cov - blur1, 0.0, 1.0);                                   // edge darkening
  vec3 paper = uPaper * (0.94 + 0.05 * fbm(w * 0.004)) - 0.04 * fib * (1.0 - uDark) + 0.02 * fib * uDark;
  paper -= 0.025 * vnoise(w * 0.6);
  vec3 c = mix(paper, uInk * (0.85 + 0.15 * vnoise(w * 0.3)), clamp(ink, 0.0, 1.0));
  vec3 red = vec3(0.72, 0.12, 0.1);
  c = mix(c, red, clamp(t0.b - t0.r, 0.0, 1.0));                                 // the seal (blue channel)
  float vg = length((uv - 0.5) * vec2(uRes.x / uRes.y, 1.0));
  c *= 1.0 - 0.18 * smoothstep(0.5, 1.1, vg);
  o = uTransparent > 0.5 ? vec4(uInk * clamp(ink, 0.0, 1.0), clamp(ink, 0.0, 1.0)) : vec4(c, 1.0);
}`;

interface SWord { w: Word; sk: Skeleton; x: number; y: number; k: number; t0: number; t1: number; strokes: { s0: number; s1: number }[]; vertical: boolean }
interface SLine { words: SWord[]; x: number; y: number; w: number; h: number; start: number; end: number; chorus: boolean; section: number }

function noise1(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash01(i, seed) * (1 - u) + hash01(i + 1, seed) * u;
}

export class Sumi extends TextShaderEffect {
  static meta: EffectMeta = {
    id: 'sumi', name: 'Sumi', kind: 'gl',
    description: 'Brush calligraphy on rice paper: each word written stroke by stroke as it is sung, with dry brush, ink bleed and a red seal.',
    affinity: aff(0.25, 0.95, 0.8, 0.3, 0.9, 0.55, 0.5, 0.2),
    supportsTransparent: true,
    params: [
      select('ink', 'Ink', 'Ink', 'black sumi', ['black sumi', 'indigo', 'vermilion', 'gold on black'], false),
      range('brush', 'Brush size', 'Brush', 1, 0.5, 1.8, 0.01),
      range('dryness', 'Dryness', 'Brush', 1, 0, 2, 0.01),
      range('bleed', 'Bleed', 'Paper', 1, 0, 2, 0.01),
      toggle('splashes', 'Splashes', 'Extras', true),
      toggle('enso', 'Ensō on drops', 'Extras', true),
      text('seal', 'Seal text', 'Extras', ''),
      select('direction', 'Direction', 'Layout', 'auto', ['auto', 'horizontal', 'vertical'], false),
    ],
  };
  readonly meta = Sumi.meta;
  private lines: SLine[] = [];
  private keys: CamKey[] = [];
  private seals: { t: number; line: number }[] = [];

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const { W, H } = this, ly = this.ly, a = this.a;
    const portrait = H > W;
    const antic = this.s.anticipationMs / 1000;
    const cap = 120;
    const lines: SLine[] = [];
    let x = 0;
    for (const line of ly.lines) {
      const ws = line.words.map((i) => ly.words[i]);
      const sec = a.sections[line.section];
      const chorus = sec?.label === 'chorus' || sec?.label === 'drop';
      const cjk = isCJKText(line.text);
      const vertical = this.str('direction') === 'vertical' || (this.str('direction') === 'auto' && cjk);
      // a fresh sheet for each chorus: leave a gap on the scroll
      const prev = lines[lines.length - 1];
      if (prev && (chorus !== prev.chorus || (chorus && prev.section !== line.section))) x += cap * 3;
      const sw: SWord[] = [];
      let cx = 0, cy = 0, rowW = 0, maxW = 0;
      const lineMax = (portrait ? 0.82 : 0.9) * 1800;
      for (const w of ws) {
        const hero = w.role === 'hero' && !w.backing;
        const c = cap * (hero ? 1.3 : w.backing ? 0.55 : w.role === 'connective' ? 0.75 : 1);
        const txt = cleanDisplay(w, cjk ? 'as-is' : this.s.caseMode === 'upper' ? 'as-is' : this.s.caseMode, false);
        const k = c / SKEL_CAP;
        if (vertical) {
          // vertical columns, top to bottom: each character is its own skeleton
          for (const ch of graphemes(txt)) {
            const sk = skeletonize(ch, 'caslon');
            sw.push({ w, sk, x: -cx, y: cy + c, k, t0: 0, t1: 0, strokes: [], vertical: true });
            cy += c * 1.12;
            if (cy > 1000) { cy = 0; cx += c * 1.3; }
          }
          continue;
        }
        const sk = skeletonize(txt, 'caslon');
        const width = sk.width * k;
        if (rowW > 0 && rowW + width > lineMax) { cy += cap * 1.7; rowW = 0; }
        sw.push({ w, sk, x: rowW, y: cy, k, t0: 0, t1: 0, strokes: [], vertical: false });
        rowW += width + cap * 0.38;
        maxW = Math.max(maxW, rowW);
      }
      const lw = vertical ? cx + cap * 1.3 : maxW, lh = vertical ? 1100 : cy + cap * 1.7;
      // timing: the word is written between its entrance start and end; heroes start 0.3 s earlier so the
      // last stroke lands on the stressed syllable. Stroke durations ∝ length, 25 ms lifts between strokes.
      for (const s of sw) {
        const w = s.w;
        const hero = w.role === 'hero' && !w.backing;
        const chars = sw.filter((q) => q.w === w);
        const idx = chars.indexOf(s), nch = chars.length;
        const ent = Math.min(0.45, Math.max(0.18, (w.end - w.start) * 0.6));
        let a0 = w.start - antic - ent * 0.5 - (hero ? 0.3 : 0), a1 = w.start - antic + Math.max(0.12, (w.end - w.start) * 0.55);
        if (nch > 1) { const span = a1 - a0; a0 += (span * idx) / nch; a1 = a0 + span / nch; }
        s.t0 = a0; s.t1 = Math.max(a0 + 0.08, a1);
        const lifts = 0.025 * Math.max(0, s.sk.strokes.length - 1);
        const avail = Math.max(0.05, s.t1 - s.t0 - lifts);
        let tt = s.t0;
        s.strokes = s.sk.strokes.map((st) => { const d = (avail * st.len) / Math.max(1, s.sk.total); const r = { s0: tt, s1: tt + d }; tt += d + 0.025; return r; });
      }
      const offX = vertical ? lw : 0;
      for (const s of sw) if (s.vertical) s.x += offX - cap;
      lines.push({ words: sw, x, y: 0, w: lw, h: lh, start: line.start, end: line.end, chorus, section: line.section });
      x += lw + cap * 1.4;
    }
    this.lines = lines;
    // camera: follows each line (the brush tip within long lines); holds the full sheet as each chorus ends
    const frames: Parameters<typeof frameKeys>[0] = [];
    for (const L of lines) {
      const top = L.words[0]?.vertical ? L.y : L.y - cap * 1.45, bottom = L.words[0]?.vertical ? L.y + L.h : L.y + L.h - cap * 1.25;
      const fw = Math.max(L.w + 240, portrait ? 900 : 1400), fh = bottom - top + cap * 1.2;
      frames.push({ t: L.start - 0.6, x: L.x - 120, y: (top + bottom) / 2 - fh / 2, w: fw, h: fh, margin: 0.9, move: 0.8 });
      const next = lines[lines.indexOf(L) + 1];
      if (L.chorus && (!next || !next.chorus)) {
        const sheet = lines.filter((q) => q.section === L.section);
        const x0 = sheet[0].x, x1 = L.x + L.w;
        frames.push({ t: L.end + 0.4, x: x0 - 160, y: -cap * 1.8, w: x1 - x0 + 320, h: Math.max(...sheet.map((q) => q.h)) + cap * 2.6, margin: 0.9, move: 1.0 });
      }
    }
    this.keys = frameKeys(frames, W, H);
    // a seal at the end of each section, pressed on a downbeat
    this.seals = [];
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i], next = lines[i + 1];
      if (!next || next.section !== L.section) {
        const db = a.downbeats[lowerBound(a.downbeats, L.end + 0.2)];
        if (db !== undefined && (!next || db < next.start - 0.3)) this.seals.push({ t: db, line: i });
      }
    }
  }

  /** brush pressure along a stroke: a quick press with a hook, a noisy sustain, a taper at the lift */
  private pressure(u: number, seed: number): number {
    if (u < 0.08) { const v = u / 0.08; return 0.55 + 0.6 * v - 0.15 * Math.sin(v * Math.PI); }
    if (u > 0.85) return Math.max(0.12, 1 - (u - 0.85) / 0.15 * 0.88);
    return 0.92 + 0.16 * (noise1(u * 9, seed) - 0.5);
  }

  protected paint(t: number, g: Ctx2D, mask: boolean): void {
    const { W, H } = this, a = this.a;
    const c0 = sampleCamera(this.keys, t);
    const cam = { x: c0.x, y: c0.y, zoom: c0.zoom };
    g.save();
    g.translate(W / 2, H / 2); g.scale(cam.zoom, cam.zoom); g.translate(-cam.x, -cam.y);
    const viewW = W / cam.zoom;
    const brush = this.num('brush'), dry = this.num('dryness');
    // R = coverage, G = coverage × age (0..1 over 1.5 s), B = seal
    for (const L of this.lines) {
      if (L.start - 1.5 > t) break;
      if (L.x - cam.x > viewW || cam.x - (L.x + L.w) > viewW) continue;
      for (const s of L.words) {
        if (s.t0 > t) continue;
        const total = s.sk.total;
        let used = 0;
        s.sk.strokes.forEach((st, si) => {
          const tm = s.strokes[si];
          if (t < tm.s0) { used += st.len; return; }
          const u = clamp01((t - tm.s0) / Math.max(0.01, tm.s1 - tm.s0));
          const upto = st.len * u;
          const age = clamp01((t - tm.s1 + (tm.s1 - tm.s0) * (1 - u)) / 1.5);
          const step = Math.max(1.2, 5 * s.k * 0.6);
          for (let d = 0; d <= upto; d += step / s.k) {
            const [px, py, hw, tx, ty] = strokeAt(st, d);
            const p = this.pressure(d / Math.max(1, st.len), s.w.id * 7 + si);
            // downstrokes press heavier than horizontals, like a held brush
            const tl0 = Math.hypot(tx, ty) || 1;
            const dirK = 0.72 + 0.5 * Math.abs(ty) / tl0;
            const wdt = Math.max(1.5, 2 * hw * p * brush * dirK) * s.k;
            // ink load falls with distance since the last dip (each word re-dips)
            const load = 1 - ((used + d) / Math.max(1, total)) * 0.85 * dry;
            const X = L.x + s.x + px * s.k, Y = L.y + s.y + py * s.k;
            if (mask) { g.fillStyle = `rgb(255,${Math.round(255 * clamp01((t - s.w.start) / 2))},255)`; g.beginPath(); g.arc(X, Y, wdt / 2, 0, 7); g.fill(); continue; }
            const col = `rgb(255,${Math.round(255 * age)},0)`;
            if (load >= 0.35) { g.fillStyle = col; g.globalAlpha = 0.55 + 0.45 * load; g.beginPath(); g.arc(X, Y, wdt / 2, 0, 7); g.fill(); }
            else {
              // flying white (飛白): 16 bristle lanes gated by 1D noise
              const tl = Math.hypot(tx, ty) || 1, nx = -ty / tl, ny = tx / tl;
              g.fillStyle = col; g.globalAlpha = 0.85;
              for (let l = 0; l < 16; l++) {
                if (noise1(d * 0.08 + l * 13.7, s.w.id + l) < (0.35 - load) * 2.2) continue;
                const off = (l / 15 - 0.5) * wdt;
                g.fillRect(X + nx * off - 0.8, Y + ny * off - 0.8, Math.max(1.6, step * 1.3), wdt / 14 + 0.6);
              }
            }
          }
          used += st.len;
        });
        g.globalAlpha = 1;
      }
      if (mask) continue;
      // splashes: on downbeats in choruses, seeded ink splatter lands near heroes
      if (this.bool('splashes') && L.chorus && !this.s.reduceMotion) {
        const i0 = lowerBound(a.downbeats, L.start - 0.05), i1 = lowerBound(a.downbeats, Math.min(t, L.end + 0.5));
        for (let k = i0; k < i1; k++) {
          const hero = L.words.find((q) => q.w.role === 'hero') ?? L.words[0];
          if (!hero) continue;
          const sd = k * 17 + this.seed;
          const cx = L.x + hero.x + (hash01(sd, 1) - 0.2) * 300, cy = L.y + hero.y - 140 + (hash01(sd, 2) - 0.5) * 140;
          const age = clamp01((t - a.downbeats[k]) / 1.5);
          g.fillStyle = `rgb(255,${Math.round(255 * age)},0)`;
          for (let d = 0; d < 9; d++) {
            const ang = hash01(sd, d, 3) * Math.PI * 2, rr = 10 + 70 * hash01(sd, d, 4), sz = 2 + 9 * hash01(sd, d, 5) ** 2;
            const dx = Math.cos(ang) * rr, dy = Math.sin(ang) * rr;
            g.beginPath(); g.arc(cx + dx, cy + dy, sz, 0, 7); g.fill();
            g.beginPath(); g.moveTo(cx + dx, cy + dy); g.lineTo(cx + dx * 1.35, cy + dy * 1.35); g.lineWidth = sz * 0.6; g.strokeStyle = g.fillStyle; g.stroke();
          }
        }
      }
      // ensō on drops: a big circle brushed behind the line in one beat
      if (this.bool('enso')) for (const dt of a.drops) {
        if (dt < L.start - 1 || dt > L.end) continue;
        const beat = 60 / (a.bpm || 120);
        const u = this.s.reduceMotion ? (t >= dt ? 1 : 0) : clamp01((t - dt) / beat);
        if (u <= 0) continue;
        const cx = L.x + L.w / 2, cy = L.y + L.h * 0.3 - 40, R = Math.max(L.h, 380) * 0.9;
        g.fillStyle = `rgb(255,${Math.round(255 * clamp01((t - dt) / 1.5))},0)`;
        const a0 = -Math.PI * 0.62, sweep = Math.PI * 1.86 * easeOutCubic(u);
        for (let s2 = 0; s2 <= sweep; s2 += 0.012) {
          const v = s2 / (Math.PI * 1.86);
          const wdt = 34 * (v < 0.06 ? 0.6 + v * 7 : 1 - Math.max(0, v - 0.75) * 3.2) * (0.85 + 0.3 * noise1(v * 12, 5));
          const X = cx + Math.cos(a0 + s2) * R, Y = cy + Math.sin(a0 + s2) * R;
          if (v > 0.6 && noise1(s2 * 30, 9) < (v - 0.6) * 1.8) continue; // dry tail
          g.globalAlpha = 0.6; g.beginPath(); g.arc(X, Y, Math.max(2, wdt / 2), 0, 7); g.fill();
        }
        g.globalAlpha = 1;
      }
    }
    // seals: a red square with the song's initials, pressed with a 2-frame squash
    if (!mask) for (const sl of this.seals) {
      if (t < sl.t) continue;
      const L = this.lines[sl.line];
      const fr = Math.floor((t - sl.t) * 60);
      const sq = fr < 2 ? 0.86 : 1;
      const text0 = this.str('seal') || (this.s.title || 'LE').split(/\s+/).map((x) => x[0]).join('').slice(0, 3).toUpperCase();
      g.save();
      g.translate(L.x + L.w + 30, L.y + L.h - 60);
      g.scale(1 / sq, sq);
      g.fillStyle = 'rgb(0,0,255)';
      g.beginPath();
      for (let i = 0; i < 24; i++) { const side = Math.floor(i / 6), f = (i % 6) / 6; const pts = [[-50, -50], [50, -50], [50, 50], [-50, 50]]; const [ax, ay] = pts[side], [bx, by] = pts[(side + 1) % 4]; const jx = (hash01(i, sl.line, 2) - 0.5) * 6; if (i) g.lineTo(ax + (bx - ax) * f + jx, ay + (by - ay) * f + jx); else g.moveTo(ax, ay); }
      g.closePath(); g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.font = font('stencil', sizeForCap('stencil', 30));
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text0, 0, 2, 86);
      g.globalCompositeOperation = 'source-over';
      g.restore();
    }
    g.restore();
    if (!mask) subtitle(g, this.ly.lines[lineAt(this.ly, t)], t, this.s, W, H, '#111');
  }

  protected shade(t: number, target: Target, text: WebGLTexture): void {
    const c0 = sampleCamera(this.keys, t);
    const ink = INKS[this.str('ink')] ?? INKS['black sumi'];
    let inkC = hexToRgb(ink.ink);
    if (this.s.paletteSource === 'artwork' && this.ctx.artwork) inkC = hexToRgb(this.ctx.artwork.darkest);
    this.scope.pass(this.scope.program(FS), target, {
      uTex: text, uRes: [this.W, this.H], uCam: [c0.x, c0.y, c0.zoom], uBleed: this.num('bleed'), uTransparent: this.s.transparentBackground ? 1 : 0,
      uDark: ink.dark ? 1 : 0, uInk: inkC, uPaper: hexToRgb(ink.paper),
    });
  }
}
registerEffect(Sumi);

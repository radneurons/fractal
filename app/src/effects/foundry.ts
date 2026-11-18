// FOUNDRY — every sung word is manufactured by an old printing works, seen in one continuous side-on shot. Letters
// fall through glass tubes into a composing tray; strong words are cast from molten metal and cool from orange to
// steel; heavy absolute words (ALWAYS, NEVER, FINE…) come down on a crane chain as iron slabs that swing and slam;
// an ink roller sweeps the finished line, a cast-iron press head stamps it onto a river of paper, and the printed
// lines travel away with the paper. Punctuation is physical: an em dash shoots out as a barrier, a question mark
// sets the tray rocking, a full stop rolls in as an iron ball that ends the line, a comma clicks in as a small brass
// piece, and parenthesised backing vocals are closed into steel cage ribs. Machines have inertia: gears turn, letters
// rattle along an overhead channel, steam escapes after each strike, and amber lamps light the tray.
// Reduce motion: no swing, rocking or shake; letters appear in place.
import { Canvas2DEffect, type EffectContext, type EffectMeta, range, toggle, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { maskFill } from './common.ts';
import { type Ctx2D, clamp01, easeInCubic, easeOutCubic, graphemes, subtitle, lineAt } from '../render/textkit.ts';
import { font, sizeForCap, scratchCtx } from '../render/sdf.ts';
import { hash01 } from '../analysis/dsp.ts';
import { type Tok, tokens, fit, unit, impact } from './kit2d.ts';

const TYPE = 'abril';
const HEAVY = new Set(['ALWAYS', 'NEVER', 'FINE', 'FOREVER', 'NOTHING', 'NOBODY', 'EVERYTHING', 'NO', 'NONE', 'GONE', 'ALONE', 'END', 'ALL', 'ONLY', 'EVER']);
const C = { soot: '#0D0C0B', iron: '#2E2C2A', steel: '#76716A', steelHi: '#B9B3A8', brass: '#B5893A', paper: '#E8DFCB', ink: '#141210', molten: '#FF7A1A', glow: '#FFD27A', lamp: '#FFB54A' };

interface Piece { ch: string; x: number; w: number }
interface FWord { tok: Tok; x: number; row: number; cap: number; pieces: Piece[]; heavy: boolean; dash: boolean; question: boolean; comma: boolean; caged: boolean }
interface FLine { printW: number; li: number; words: FWord[]; rows: number; cap: number; rowW: number[]; start: number; end: number; next: number; lastLand: number; stamp: number; stop: boolean; seed: number; text: string }

export class Foundry extends Canvas2DEffect {
  static meta: EffectMeta = {
    id: 'foundry', name: 'Foundry', kind: '2d',
    description: 'An old printing works makes every word: letters cast, dropped through tubes, set, inked and stamped onto a river of paper; heavy words arrive as iron slabs and punctuation becomes machinery.',
    affinity: aff(0.45, 0.75, 0.85, 0.55, 0.7, 0.75, 0.35, 0.35),
    supportsTransparent: false, ownsTitle: false,
    params: [
      range('speed', 'Paper speed', 'Machine', 1, 0.3, 2, 0.01),
      toggle('steam', 'Steam', 'Machine', true),
      toggle('semantics', 'Heavy words and punctuation', 'Machine', true, false, 'ALWAYS / NEVER / FINE as iron slabs, punctuation as machinery'),
    ],
  };
  readonly meta = Foundry.meta;
  private lines: FLine[] = [];

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const { W, H } = this, ly = this.ly, antic = this.s.anticipationMs / 1000;
    const sem = this.bool('semantics');
    this.lines = ly.lines.map((line, li) => {
      const toks = tokens(ly, line, this.s, TYPE);
      for (const p of toks) {
        if (sem && HEAVY.has(p.text.toUpperCase().replace(/[^A-Z]/g, ''))) p.scale = 1.7;
        p.u = graphemes(p.text).reduce((a2, ch) => a2 + unit(ch, TYPE) + 0.06, 0);
      }
      const portrait = H > W;
      const f = fit(toks, W * (portrait ? 0.88 : 0.8), H * (portrait ? 0.36 : 0.26), portrait ? 4 : 2, 1.5, 0.45);
      const words: FWord[] = toks.map((p) => {
        const cap = f.cap * p.scale;
        let x = 0;
        const pieces = graphemes(p.text).map((ch) => { const w = unit(ch, TYPE) * cap + cap * 0.06; const pc = { ch, x, w }; x += w; return pc; });
        const raw = p.raw;
        return {
          tok: p, x: p.x, row: p.row, cap, pieces,
          heavy: p.scale > 1.5,
          dash: sem && /[—–]|--$|-$/.test(raw),
          question: sem && /\?/.test(raw),
          comma: sem && /,$/.test(raw),
          caged: sem && (p.w.backing === true || /^\(|\)$/.test(raw)),
        };
      });
      const lastLand = Math.max(...toks.map((p) => p.w.start - antic), line.start);
      const next = ly.lines[li + 1]?.start ?? Infinity;
      // stamp when the line has been sung (and inked), but always before the next line's letters start falling
      const stamp = Math.min(Math.max(line.end, lastLand + 0.55), next - 0.45);
      const pcap = H * 0.17 * 0.36;
      const sg = scratchCtx(); sg.font = font(TYPE, sizeForCap(TYPE, pcap));
      const printW = Math.min(sg.measureText(toks.map((p) => p.text).join(' ')).width, W * 0.9);
      return { printW, li, words, rows: f.rows, cap: f.cap, rowW: f.rowW, start: line.start, end: line.end, next, lastLand, stamp, stop: sem && /\.$/.test(line.text.trim()), seed: (this.seed * 7919 + li * 104729) >>> 0, text: toks.map((p) => p.text).join(' ') };
    });
  }

  private get reduce(): boolean { return this.s.reduceMotion; }
  private get v(): number { return this.W * 0.02 * this.num('speed'); }
  /** how far the paper has travelled by t: a slow drift plus a feed of one printed line after every strike */
  private paperPos(t: number): number {
    let p = t * this.v;
    for (let i = 0; i < this.lines.length; i++) {
      const L = this.lines[i], N = this.lines[i + 1];
      // make room just before the next strike, so each print stays under the press while the next line is set
      const t0 = Math.max(L.stamp + 0.3, (N ? N.stamp : L.stamp + 4) - 0.65);
      const u = clamp01((t - t0) / 0.5);
      if (u <= 0) break;
      p += ((L.printW + (N?.printW ?? L.printW)) / 2 + this.W * 0.08) * (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
    }
    return p;
  }

  protected draw(t: number, g: Ctx2D, mask: boolean): void {
    const { W, H } = this, ly = this.ly, antic = this.s.anticipationMs / 1000;
    // the line on the tray: from 0.5 s before its first letter falls until it has been stamped
    const li = lineAt(ly, t + antic + 0.5);
    const L = li >= 0 ? this.lines[li] : null;
    // the previous line stays on the tray until its own strike
    const P = li > 0 ? this.lines[li - 1] : null;
    const active = P && t < P.stamp + 0.25 ? P : L && t < L.stamp + 0.25 ? L : null;
    // shake: heavy slabs and press strikes
    let sx = 0, sy = 0;
    const SL = active ?? L;
    if (!this.reduce && SL) {
      const heavyLand = SL.words.filter((w) => w.heavy).map((w) => w.tok.w.start - antic).filter((x) => x <= t).pop();
      const e = t >= SL.stamp ? SL.stamp + 0.1 : heavyLand;
      [sx, sy] = impact(t, e, SL.seed + (t >= SL.stamp ? 7 : 3), H * 0.012 * this.camEnergy, (a, b) => hash01(a, b, 9));
    }
    g.save(); g.translate(sx, sy);
    if (!mask) this.factory(g, t);
    if (!mask) this.paperRiver(g, t);
    if (active) this.tray(g, t, active, antic, mask);
    if (!mask) this.press(g, t, active ?? L);
    if (!mask) this.lamps(g);
    g.restore();
    if (!mask) subtitle(g, ly.lines[lineAt(ly, t)], t, this.s, W, H, '#fff');
  }

  /** layout of the tray area */
  private trayY(row: number, L: FLine): number { return this.H * 0.56 - (L.rows - 1 - row) * L.cap * 1.5; }
  private wordX(w: FWord, L: FLine): number { return this.W / 2 - L.rowW[w.row] / 2 + w.x; }

  // ---------- the works ----------
  private factory(g: Ctx2D, t: number): void {
    const { W, H } = this;
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#16130F'); gr.addColorStop(0.6, C.soot); gr.addColorStop(1, '#070605');
    g.fillStyle = gr; g.fillRect(-40, -40, W + 80, H + 80);
    const dolly = this.reduce ? 0 : t * W * 0.02;
    // far layer: gears turning at different speeds (they hesitate on each beat, like real machinery)
    const beatK = this.reduce ? 0 : this.beatPulse(t, 9) * 0.25;
    for (let i = 0; i < 6; i++) {
      const r = H * (0.12 + 0.12 * hash01(i, 1)), x = ((W * (0.1 + i * 0.22) - dolly * (0.4 + 0.1 * i)) % (W * 1.4) + W * 1.4) % (W * 1.4) - W * 0.2;
      this.gear(g, x, H * (0.2 + 0.25 * hash01(i, 2)), r, (i % 2 ? -1 : 1) * (t * (0.4 + hash01(i, 3) * 0.5) - beatK), i % 3 === 0 ? C.brass : C.iron, 0.35 + 0.2 * hash01(i, 4));
    }
    // pipes
    g.strokeStyle = '#25221E'; g.lineWidth = H * 0.018;
    for (let i = 0; i < 3; i++) { const y = H * (0.07 + 0.11 * i); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    // the overhead channel, with metal letters rattling along it
    const cy = H * 0.12;
    g.fillStyle = '#1B1916'; g.fillRect(0, cy - H * 0.025, W, H * 0.05);
    for (let i = 0; i < 26; i++) {
      const x = ((i * W * 0.06 + t * W * 0.22 * (0.9 + 0.2 * hash01(i, 5))) % (W * 1.6)) - W * 0.2, jit = this.reduce ? 0 : (hash01(i, Math.floor(t * 20), 6) - 0.5) * H * 0.004;
      g.fillStyle = C.steel; g.fillRect(x, cy - H * 0.016 + jit, H * 0.024, H * 0.03);
      g.fillStyle = C.steelHi; g.fillRect(x, cy - H * 0.016 + jit, H * 0.024, H * 0.004);
    }
  }

  private gear(g: Ctx2D, x: number, y: number, r: number, ang: number, c: string, a: number): void {
    g.save(); g.translate(x, y); g.rotate(ang); g.globalAlpha = a; g.fillStyle = c;
    const n = 14;
    g.beginPath();
    for (let i = 0; i < n * 2; i++) { const a0 = (i / (n * 2)) * Math.PI * 2, rr = i % 2 ? r : r * 1.12; g.lineTo(Math.cos(a0) * rr, Math.sin(a0) * rr); }
    g.closePath();
    // hub and spoke holes as part of the same path (even-odd), so the background shows through
    g.moveTo(r * 0.35, 0); g.arc(0, 0, r * 0.35, 0, Math.PI * 2);
    for (let i = 0; i < 5; i++) { const a0 = (i / 5) * Math.PI * 2, hx = Math.cos(a0) * r * 0.68, hy = Math.sin(a0) * r * 0.68; g.moveTo(hx + r * 0.16, hy); g.arc(hx, hy, r * 0.16, 0, Math.PI * 2); }
    g.fill('evenodd');
    g.restore();
  }

  /** the paper river: printed lines travel left from the press */
  private paperRiver(g: Ctx2D, t: number): void {
    const { W, H } = this;
    const y0 = H * 0.78, y1 = H * 0.95;
    g.fillStyle = C.paper; g.fillRect(-40, y0, W + 80, y1 - y0);
    // fibres and roller marks drift with the paper
    const pos = this.paperPos(t), off = pos % (W * 0.25);
    g.fillStyle = 'rgba(80,60,30,0.08)';
    for (let i = 0; i < 12; i++) g.fillRect(((i * W * 0.25 - off) % (W * 1.25) + W * 1.25) % (W * 1.25) - W * 0.1, y0, 2, y1 - y0);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-40, y0 - H * 0.008, W + 80, H * 0.008);
    // printed lines (ink with a slight smear at the leading edge)
    for (const L of this.lines) {
      if (t < L.stamp + 0.1) continue;
      const x = W / 2 - (pos - this.paperPos(L.stamp + 0.1));
      if (x < -W * 2) continue;
      if (x > W * 1.5) continue;
      const cap = (y1 - y0) * 0.36;
      g.save();
      g.font = font(TYPE, sizeForCap(TYPE, cap)); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      const tw = g.measureText(L.text).width, k = Math.min(1, (W * 0.9) / tw);
      g.translate(x, (y0 + y1) / 2 + cap / 2); g.scale(k, k);
      g.fillStyle = 'rgba(20,18,16,0.25)'; g.fillText(L.text, -cap * 0.06, cap * 0.02);
      g.fillStyle = C.ink; g.fillText(L.text, 0, 0);
      g.restore();
    }
  }

  /** the composing tray with the current line's type */
  private tray(g: Ctx2D, t: number, L: FLine, antic: number, mask: boolean): void {
    const { W, H } = this;
    const stampDown = this.stampDepth(t, L);
    // a question mark anywhere sets the tray rocking from that word on
    const q = L.words.find((w) => w.question);
    const rock = !this.reduce && q && t >= q.tok.w.start - antic ? Math.sin((t - q.tok.w.start) * 7) * 0.035 * Math.exp(-(t - q.tok.w.start) * 0.8) : 0;
    g.save();
    g.translate(W / 2, this.trayY(L.rows - 1, L) + stampDown * H * 0.1); g.rotate(rock); g.translate(-W / 2, -this.trayY(L.rows - 1, L));
    if (!mask) { // the brass tray under the last row
      const y = this.trayY(L.rows - 1, L) + L.cap * 0.32, w = Math.max(...L.rowW) + L.cap * 1.2;
      g.fillStyle = C.brass; g.fillRect(W / 2 - w / 2, y, w, L.cap * 0.18);
      g.fillStyle = '#6B4F1E'; g.fillRect(W / 2 - w / 2, y + L.cap * 0.18, w, L.cap * 0.06);
    }
    const inkX = this.inkX(t, L);
    for (const w of L.words) {
      const land = w.tok.w.start - antic;
      const x0 = this.wordX(w, L), base = this.trayY(w.row, L);
      if (w.heavy) { this.slab(g, t, w, x0, base, land, inkX, mask); continue; }
      w.pieces.forEach((pc, k) => {
        // letters fall through the tube one after another, landing with the word's onset
        const tl = land - (w.pieces.length - 1 - k) * 0.025;
        const fallT = 0.22, u = this.reduce ? (t >= tl ? 1 : 0) : clamp01((t - (tl - fallT)) / fallT);
        if (u <= 0) return;
        const y = base - (1 - easeInCubic(u)) * H * 0.6 + (!this.reduce && t > tl && t < tl + 0.12 ? Math.sin((t - tl) * 50) * L.cap * 0.03 * (1 - (t - tl) / 0.12) : 0);
        if (!mask && u < 1) { g.fillStyle = 'rgba(190,220,230,0.08)'; g.fillRect(x0 + pc.x - pc.w * 0.1, H * 0.15, pc.w * 1.2, base - H * 0.15); }
        // strong words are cast from molten metal and cool from orange to steel
        const heat = w.tok.hero ? clamp01(1 - (t - tl) / 0.5) : 0;
        this.block(g, pc, x0, y, w.cap, t > tl && x0 + pc.x < inkX, heat, mask, t - tl);
      });
      if (mask) continue;
      const wEnd = x0 + (w.pieces.at(-1)?.x ?? 0) + (w.pieces.at(-1)?.w ?? 0);
      if (w.comma && t >= land) { g.fillStyle = C.brass; g.beginPath(); g.arc(wEnd + w.cap * 0.12, base - w.cap * 0.05, w.cap * 0.09, 0, Math.PI * 2); g.fill(); g.fillRect(wEnd + w.cap * 0.1, base - w.cap * 0.05, w.cap * 0.05, w.cap * 0.22); }
      if (w.dash && t >= land) { // an em dash shoots sideways as a barrier
        const u = this.reduce ? 1 : easeOutCubic((t - land) / 0.15);
        g.fillStyle = C.steel; g.fillRect(wEnd + w.cap * 0.1, base - w.cap * 0.55, (W * 0.95 - wEnd) * u, w.cap * 0.16);
        g.fillStyle = '#C23B22'; for (let x = wEnd + w.cap * 0.3; x < wEnd + (W * 0.95 - wEnd) * u; x += w.cap * 0.6) g.fillRect(x, base - w.cap * 0.55, w.cap * 0.25, w.cap * 0.16);
      }
      if (w.caged && t >= land) { // steel ribs close around backing vocals like a cage
        const u = this.reduce ? 1 : easeOutCubic((t - land) / 0.2);
        g.strokeStyle = C.steelHi; g.lineWidth = w.cap * 0.07;
        const cx = (x0 + wEnd) / 2, rw = (wEnd - x0) / 2 + w.cap * 0.35, cy = base - w.cap * 0.5;
        for (const side of [-1, 1]) { g.beginPath(); g.ellipse(cx, cy, rw, w.cap * 0.95, 0, side < 0 ? Math.PI * (1.5 - 0.5 * u) : -Math.PI * 0.5 * u, side < 0 ? Math.PI * (0.5 + 0.5 * u) : Math.PI * 0.5 * u, side > 0); g.stroke(); }
      }
    }
    // a full stop rolls in as an iron ball and ends the line
    if (!mask && L.stop && t > L.lastLand + 0.2) {
      const u = this.reduce ? 1 : easeOutCubic((t - L.lastLand - 0.2) / 0.5), r = L.cap * 0.32;
      const endX = W / 2 + L.rowW[L.rows - 1] / 2 + r * 1.6, x = endX + (1 - u) * W * 0.5, y = this.trayY(L.rows - 1, L) - r + L.cap * 0.32;
      const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r); gr.addColorStop(0, '#6A6660'); gr.addColorStop(1, '#0A0A0A');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // the ink roller sweeps across once the line is set
    if (!mask && inkX > -1e8 && inkX < W * 1.1) {
      const y = this.trayY(0, L) - L.cap * 1.35;
      g.fillStyle = C.iron; g.fillRect(inkX - L.cap * 0.05, y - H * 0.4, L.cap * 0.1, H * 0.4);
      g.fillStyle = '#121212'; g.beginPath(); g.ellipse(inkX, y + (L.rows * L.cap * 1.5) / 2, L.cap * 0.32, (L.rows * L.cap * 1.5) / 2 + L.cap * 0.3, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(inkX - L.cap * 0.22, y, L.cap * 0.08, L.rows * L.cap * 1.5);
    }
    g.restore();
  }

  /** x of the ink roller (−∞ before it starts) */
  private inkX(t: number, L: FLine): number {
    const t0 = L.lastLand + 0.15, dur = Math.max(0.2, Math.min(0.4, L.stamp - t0 - 0.05));
    if (t < t0) return -1e9;
    return -this.W * 0.1 + clamp01((t - t0) / dur) * this.W * 1.25;
  }

  /** how far the press head is down (0..1) */
  private stampDepth(t: number, L: FLine | null): number {
    if (!L) return 0;
    const d = t - L.stamp;
    if (d < 0 || d > 0.5) return 0;
    if (d < 0.1) return easeInCubic(d / 0.1);
    if (d < 0.22) return 1;
    return 1 - easeOutCubic((d - 0.22) / 0.28);
  }

  /** one piece of metal type: a steel block with the letter in relief on its face */
  private block(g: Ctx2D, pc: Piece, x0: number, base: number, cap: number, inked: boolean, heat: number, mask: boolean, age: number): void {
    const x = x0 + pc.x, bh = cap * 1.3, top = base - cap * 1.12;
    g.font = font(TYPE, sizeForCap(TYPE, cap)); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    if (mask) { g.fillStyle = maskFill(age); g.fillText(pc.ch, x + pc.w / 2, base); return; }
    const body = heat > 0 ? mix(C.steel, C.molten, heat) : C.steel;
    g.fillStyle = mix(body, '#000', 0.45); g.fillRect(x + cap * 0.02, top + cap * 0.04, pc.w - cap * 0.04, bh);
    g.fillStyle = body; g.fillRect(x, top, pc.w - cap * 0.04, bh - cap * 0.05);
    g.fillStyle = heat > 0 ? mix(C.steelHi, C.glow, heat) : C.steelHi; g.fillRect(x, top, pc.w - cap * 0.04, cap * 0.05);
    if (heat > 0.05) { g.save(); g.globalAlpha = heat * 0.5; g.fillStyle = C.glow; g.fillRect(x - cap * 0.05, top - cap * 0.05, pc.w + cap * 0.06, bh + cap * 0.1); g.restore(); }
    // the letter in relief: a light edge up-left, the face, then ink if the roller has passed
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillText(pc.ch, x + pc.w / 2 - cap * 0.02, base - cap * 0.02);
    g.fillStyle = inked ? C.ink : heat > 0 ? mix('#3B3732', C.glow, heat) : '#3B3732'; g.fillText(pc.ch, x + pc.w / 2, base);
    if (inked) { g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + pc.w * 0.15, top + cap * 0.08, pc.w * 0.12, bh * 0.7); }
  }

  /** a heavy word: an iron slab lowered on a crane chain, swinging, then slammed into the tray */
  private slab(g: Ctx2D, t: number, w: FWord, x0: number, base: number, land: number, inkX: number, mask: boolean): void {
    const { H } = this;
    const width = (w.pieces.at(-1)?.x ?? 0) + (w.pieces.at(-1)?.w ?? 0), bh = w.cap * 1.3, top = base - w.cap * 1.12;
    const lower = 0.6;
    if (t < land - lower) return;
    const u = this.reduce ? 1 : easeOutCubic(clamp01((t - (land - lower)) / lower));
    const drop = (1 - u) * H * 0.7;
    const sw = this.reduce ? 0 : (t < land ? 0.25 * (1 - u) : 0.12 * Math.exp(-(t - land) * 5) * Math.cos((t - land) * 14));
    const cx = x0 + width / 2;
    g.save(); g.translate(cx, top - drop); g.rotate(sw);
    if (!mask) {
      g.strokeStyle = '#4A4743'; g.lineWidth = w.cap * 0.05; g.setLineDash([w.cap * 0.12, w.cap * 0.06]);
      g.beginPath(); g.moveTo(0, -H); g.lineTo(0, 0); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#121110'; g.fillRect(-width / 2 + w.cap * 0.05, w.cap * 0.06, width, bh);
      g.fillStyle = '#2B2926'; g.fillRect(-width / 2, 0, width, bh);
      g.fillStyle = '#4C4843'; g.fillRect(-width / 2, 0, width, w.cap * 0.06);
      g.fillStyle = '#5E5952'; for (const rx of [-width / 2 + w.cap * 0.12, width / 2 - w.cap * 0.12]) for (const ry of [w.cap * 0.15, bh - w.cap * 0.15]) { g.beginPath(); g.arc(rx, ry, w.cap * 0.04, 0, Math.PI * 2); g.fill(); }
    }
    g.font = font(TYPE, sizeForCap(TYPE, w.cap)); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const text = w.pieces.map((p) => p.ch).join('');
    if (mask) { g.fillStyle = maskFill(t - land); g.fillText(text, 0, w.cap * 1.12); }
    else { g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillText(text, -w.cap * 0.02, w.cap * 1.1); g.fillStyle = inkX > x0 + width ? C.ink : '#7C766E'; g.fillText(text, 0, w.cap * 1.12); }
    g.restore();
    // dust where it lands
    if (!mask && !this.reduce && t > land && t < land + 0.6) {
      const k = (t - land) / 0.6;
      g.save(); g.globalAlpha = 0.35 * (1 - k); g.fillStyle = '#9A9286';
      for (let i = 0; i < 10; i++) { const dir = i % 2 ? 1 : -1; g.beginPath(); g.arc(cx + dir * (width / 2 + k * w.cap * (1 + hash01(i, 3))), base + w.cap * 0.2 - k * w.cap * 0.6 * hash01(i, 4), w.cap * (0.1 + 0.25 * k), 0, Math.PI * 2); g.fill(); }
      g.restore();
    }
  }

  /** the cast-iron press head above the tray, and steam after each strike */
  private press(g: Ctx2D, t: number, L: FLine | null): void {
    const { W, H } = this;
    const d = this.stampDepth(t, L);
    const headW = W * 0.86, headH = H * 0.09;
    const y = H * 0.17 + d * (L ? this.trayY(0, L) - L.cap * 1.25 - H * 0.17 - headH : 0);
    g.fillStyle = '#1A1816'; g.fillRect(W / 2 - headW / 2 - W * 0.02, -10, W * 0.025, H * 0.82); g.fillRect(W / 2 + headW / 2 - W * 0.005, -10, W * 0.025, H * 0.82);
    const gr = g.createLinearGradient(0, y, 0, y + headH); gr.addColorStop(0, '#3A3733'); gr.addColorStop(1, '#151412');
    g.fillStyle = gr; g.fillRect(W / 2 - headW / 2, y, headW, headH);
    g.fillStyle = C.brass; g.fillRect(W / 2 - headW / 2, y + headH - H * 0.008, headW, H * 0.008);
    g.fillStyle = '#5E5952'; for (let i = 0; i < 12; i++) { g.beginPath(); g.arc(W / 2 - headW / 2 + headW * (i + 0.5) / 12, y + headH * 0.3, H * 0.006, 0, Math.PI * 2); g.fill(); }
    // steam escaping after the strike
    if (this.bool('steam') && L && t > L.stamp + 0.12 && t < L.stamp + 2.4) {
      const k = (t - L.stamp - 0.12) / 2.3;
      for (let i = 0; i < 8; i++) {
        const x = W / 2 + (i % 2 ? 1 : -1) * (headW / 2 + W * 0.01), yy = H * 0.7 - k * H * (0.3 + 0.4 * hash01(L.seed, i, 1)), r = H * (0.04 + 0.12 * k);
        const sg = g.createRadialGradient(x, yy, 0, x, yy, r); sg.addColorStop(0, `rgba(220,220,215,${0.22 * (1 - k)})`); sg.addColorStop(1, 'rgba(220,220,215,0)');
        g.fillStyle = sg; g.beginPath(); g.arc(x + (hash01(L.seed, i, 2) - 0.5) * H * 0.1, yy, r, 0, Math.PI * 2); g.fill();
      }
    }
  }

  /** amber inspection lamps pooling light on the tray, and a vignette */
  private lamps(g: Ctx2D): void {
    const { W, H } = this;
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const x of [W * 0.3, W * 0.7]) { const gr = g.createRadialGradient(x, H * 0.5, 0, x, H * 0.5, H * 0.55); gr.addColorStop(0, 'rgba(255,170,70,0.18)'); gr.addColorStop(1, 'rgba(255,170,70,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
    g.restore();
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }
}

function rgbOf(s: string): number[] {
  if (s.startsWith('rgb')) return s.replace(/[^\d,.]/g, '').split(',').slice(0, 3).map(Number);
  const h = s.length === 4 ? s.slice(1).split('').map((c) => c + c).join('') : s.slice(1, 7);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function mix(a: string, b: string, k: number): string {
  const x = rgbOf(a), y = rgbOf(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * clamp01(k))).join(',')})`;
}
registerEffect(Foundry);

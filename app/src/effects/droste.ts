// DROSTE — infinite recursion locked to tempo (SPEC §8.6). The panel contains itself; the camera falls one
// level per bar, forever. Levels are drawn explicitly (0…7), each clipped to its parent's window — no feedback.
// v3: levels per bar follow the detected meter; a key change swaps the style at the next level boundary.
// Reduce motion calms: the fall rate (¼), the reverse on drops (off) and the beat pulse.
import type { Word, Line } from '../types.ts';
import { Canvas2DEffect, type EffectContext, type EffectMeta, range, toggle, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { maskFill } from './common.ts';
import { type Ctx2D, setFont, cleanDisplay, clamp01, easeOutBack, textWidth, subtitle, lineAt } from '../render/textkit.ts';
import { FPS, lowerBound, pulse, sample } from '../analysis/dsp.ts';
import { rgba, mixHex } from '../render/gl.ts';

type Style = 'deco' | 'brutalist' | 'swiss';
const STYLES: Style[] = ['deco', 'brutalist', 'swiss'];
const COLS: Record<Style, Record<'night' | 'day', { bg: string; ink: string; accent: string; frame: string; lintel: string; lintelInk: string }>> = {
  deco: { night: { bg: '#0E1A33', ink: '#F3E3B6', accent: '#D8B45A', frame: '#D8B45A', lintel: '#0A1326', lintelInk: '#F3E3B6' }, day: { bg: '#F2E6C8', ink: '#15264A', accent: '#B8892B', frame: '#15264A', lintel: '#15264A', lintelInk: '#F2E6C8' } },
  brutalist: { night: { bg: '#3A3B3D', ink: '#F1F1EE', accent: '#E0352B', frame: '#111111', lintel: '#0B0B0B', lintelInk: '#F1F1EE' }, day: { bg: '#C9C8C3', ink: '#141414', accent: '#E0352B', frame: '#141414', lintel: '#141414', lintelInk: '#EDEDE8' } },
  swiss: { night: { bg: '#111214', ink: '#F5F5F2', accent: '#E3272B', frame: '#F5F5F2', lintel: '#111214', lintelInk: '#F5F5F2' }, day: { bg: '#F5F5F2', ink: '#111214', accent: '#E3272B', frame: '#111214', lintel: '#F5F5F2', lintelInk: '#111214' } },
};

export class Droste extends Canvas2DEffect {
  static meta: EffectMeta = {
    id: 'droste', name: 'Droste', kind: '2d',
    description: 'The panel contains itself: the camera falls one level per bar through Art Deco, Brutalist or Swiss frames.',
    affinity: aff(0.55, 0.7, 0.4, 0.3, 0.9, 0.6, 0.5, 0.55),
    supportsTransparent: false,
    params: [
      select('style', 'Panel style', 'Look', 'deco', ['deco', 'brutalist', 'swiss']),
      select('scheme', 'Colour scheme', 'Look', 'night', ['night', 'day']),
      range('ornament', 'Ornament density', 'Look', 1, 0, 2, 0.01),
      range('k', 'Window scale k', 'Recursion', 0.32, 0.2, 0.5, 0.01, false),
      select('anchor', 'Window anchor', 'Recursion', 'right', ['right', 'centre', 'left'], false),
      select('levelsPerBar', 'Levels per bar', 'Recursion', '1', ['0.5', '1', '2'], false),
      toggle('reverse', 'Reverse on drops', 'Recursion', true, false),
      toggle('freeze', 'Freeze in breakdowns', 'Recursion', true, false),
    ],
  };
  readonly meta = Droste.meta;
  private phi!: Float32Array;
  private rate = 0.5;
  private swaps: number[] = [];

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const a = this.a;
    const n = a.n + 2;
    const lpb = Number(this.str('levelsPerBar')) * (this.s.reduceMotion ? 0.25 : 1);
    const bar = a.downbeats.length > 1 ? (a.downbeats[a.downbeats.length - 1] - a.downbeats[0]) / (a.downbeats.length - 1) : 2;
    this.rate = lpb / bar;
    // φ(t): a 60 fps cumulative table
    this.phi = new Float32Array(n);
    const first = a.downbeats[0] ?? 0;
    let acc = 0;
    for (let i = 1; i < n; i++) {
      const t = i / FPS;
      let r = t >= first ? this.rate : 0;
      const sec = a.sections.find((s) => t >= s.start && t < s.end);
      if (this.bool('freeze') && sec?.label === 'breakdown') r = 0;
      if (this.bool('reverse') && !this.s.reduceMotion) for (const d of a.drops) if (t >= d && t < d + 2 * bar) r = -this.rate; // the camera rises outward
      acc += r / FPS;
      this.phi[i] = acc;
    }
    // style swaps: bridges, breakdowns and key changes move to the next style
    this.swaps = [...a.sections.filter((s) => s.label === 'bridge' || s.label === 'breakdown').map((s) => s.start), ...a.keyChanges.map((k) => k.t)].sort((x, y) => x - y);
  }

  private styleAt(t: number): Style {
    const base = STYLES.indexOf(this.str('style') as Style);
    return STYLES[(Math.max(0, base) + lowerBound(this.swaps, t + 1e-6)) % STYLES.length];
  }

  protected draw(t: number, g: Ctx2D, mask: boolean): void {
    const { W, H } = this;
    const k = this.num('k');
    const ph = sample(this.phi, Math.max(0, t));
    const base = Math.floor(ph), frac = ph - base;
    // window rect inside the unit panel
    const anchor = this.str('anchor');
    const wy = 0.2 + (0.8 - k) * 0.5, wx = anchor === 'right' ? 1 - k - 0.06 : anchor === 'left' ? 0.06 : (1 - k) / 2;
    const fx = wx / (1 - k), fy = wy / (1 - k);       // fixed point of p → w + k·p
    const s = Math.pow(k, -frac);                     // seamless at integer φ
    g.save();
    g.scale(W, H);
    g.translate(fx, fy); g.scale(s, s); g.translate(-fx, -fy);
    for (let i = 0; i < 8; i++) {
      g.save();
      g.beginPath(); g.rect(0, 0, 1, 1); g.clip();
      // absolute level A shows the lyrics at the time the recursion reaches it
      const A = base + i;
      const tau = t + (A - ph) / Math.max(1e-4, Math.abs(this.rate) || 0.5);
      // the level that currently fills the screen is the live one
      this.panel(g, t, tau, A, i === (frac < 0.5 ? 0 : 1), { wx, wy, k }, mask);
      g.restore();
      g.translate(wx, wy); g.scale(k, k);
      if (Math.pow(k, i + 1) * s * Math.min(W, H) < 6) break;
    }
    g.restore();
    if (!mask) subtitle(g, this.ly.lines[lineAt(this.ly, t)], t, this.s, W, H, '#fff');
  }

  /** Text at a cap height given in unit space (fonts are set at 100 px and scaled). */
  private ftext(g: Ctx2D, str: string, x: number, y: number, cap: number, font: string, align: CanvasTextAlign = 'left'): void {
    g.save();
    g.translate(x, y); g.scale(cap / 100, cap / 100);
    setFont(g, font, 100);
    g.textAlign = align; g.textBaseline = 'alphabetic';
    g.fillText(str, 0, 0);
    g.restore();
  }

  /** One panel in unit coordinates (aspect-corrected inside). */
  private panel(g: Ctx2D, t: number, tau: number, A: number, live: boolean, win: { wx: number; wy: number; k: number }, mask: boolean): void {
    const { W, H } = this;
    const asp = W / H;
    const style = this.styleAt(Math.max(0, tau));
    const C = COLS[style][this.str('scheme') as 'night' | 'day'];
    const orn = this.num('ornament');
    const tt = live ? t : tau;
    const ly = this.ly, a = this.a;
    // content for this level: the line and hero around its time
    const li = lineAt(ly, tt + (live ? 0 : 0.6), 0.25);
    const line: Line | undefined = li >= 0 && tt < ly.lines[li].end + (live ? 1.2 : 2.5) ? ly.lines[li] : undefined;
    let hero: Word | undefined;
    if (line) {
      const hs = line.words.map((i) => ly.words[i]).filter((w) => w.role === 'hero' && !w.backing);
      hero = live ? [...hs].reverse().find((w) => w.start - this.s.anticipationMs / 1000 <= t) : hs[0];
    }
    const X = (x: number) => x, Y = (y: number) => y;
    g.save();
    g.scale(1 / asp, 1); // work in "height units": the panel is asp × 1
    const PW = asp;
    if (!mask) {
      g.fillStyle = C.bg; g.fillRect(0, 0, PW, 1);
      const wcx = (win.wx + win.k / 2) * PW, wcy = win.wy + win.k / 2;
      if (style === 'deco') { // sunburst rays from the window centre, a stepped double border
        g.fillStyle = rgba(C.accent, 0.1 * orn);
        const n = 28;
        for (let i = 0; i < n; i += 2) { g.beginPath(); g.moveTo(wcx, wcy); const a0 = (i / n) * Math.PI * 2 + 0.05, a1 = ((i + 1) / n) * Math.PI * 2 + 0.05; g.lineTo(wcx + Math.cos(a0) * 3, wcy + Math.sin(a0) * 3); g.lineTo(wcx + Math.cos(a1) * 3, wcy + Math.sin(a1) * 3); g.fill(); }
        g.strokeStyle = C.frame; g.lineWidth = 0.008; g.strokeRect(0.018, 0.018, PW - 0.036, 1 - 0.036);
        g.lineWidth = 0.003; g.strokeRect(0.032, 0.032, PW - 0.064, 1 - 0.064);
      } else if (style === 'brutalist') { // concrete slabs and grid columns
        g.fillStyle = rgba('#000000', 0.1);
        for (let i = 0; i < 6; i++) g.fillRect((i / 6) * PW, 0.2, 0.004, 0.8);
        g.fillStyle = rgba('#ffffff', 0.045 * orn);
        for (let i = 0; i < 5; i++) g.fillRect(0, 0.2 + i * 0.16 + 0.15, PW, 0.006);
      } else { // swiss: a 12 × 8 grid and a red bar
        g.strokeStyle = rgba(C.ink, 0.1 * orn); g.lineWidth = 0.0015;
        g.beginPath();
        for (let i = 1; i < 12; i++) { g.moveTo((i / 12) * PW, 0); g.lineTo((i / 12) * PW, 1); }
        for (let j = 1; j < 8; j++) { g.moveTo(0, j / 8); g.lineTo(PW, j / 8); }
        g.stroke();
        g.fillStyle = C.accent; g.fillRect(0.05, 0.9, PW * 0.22, 0.02);
      }
      // lintel band (top 20 %)
      g.fillStyle = C.lintel; g.fillRect(0, 0, PW, 0.2);
      if (style === 'deco') {
        g.strokeStyle = C.accent; g.lineWidth = 0.004; g.beginPath(); g.moveTo(0.04, 0.2); g.lineTo(PW - 0.04, 0.2); g.stroke();
        g.fillStyle = C.accent;
        for (let i = 0; i < Math.round(9 * orn); i++) { const cx = PW / 2 + (i - 4 * orn) * 0.05; g.beginPath(); g.moveTo(cx - 0.018, 0.2); g.lineTo(cx, 0.185); g.lineTo(cx + 0.018, 0.2); g.fill(); }
      } else if (style === 'brutalist') { g.fillStyle = C.accent; g.fillRect(PW - 0.16, 0.2, 0.12, 0.022); }
      // label
      g.fillStyle = rgba(C.lintelInk, 0.7);
      this.ftext(g, style === 'deco' ? `LEVEL ${Math.max(0, A)}` : style === 'brutalist' ? `${String(Math.max(0, A)).padStart(3, '0')}/∞` : `№ ${Math.max(0, A)}`, 0.045, 0.045, 0.016, 'mono');
    }
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    // lintel: the current line, with words revealed as sung
    if (line) {
      const font = style === 'deco' ? 'caslon' : style === 'brutalist' ? 'mono' : 'montserrat600';
      const ws = line.words.map((i) => ly.words[i]);
      let cap = 0.052;
      const texts = ws.map((w) => cleanDisplay(w, this.s.caseMode, true));
      let total = texts.reduce((s2, tx) => s2 + (textWidth(tx, font, 100) / 100) * cap, 0) + cap * 0.4 * (ws.length - 1);
      if (total > PW * 0.9) { cap *= (PW * 0.9) / total; total = PW * 0.9; }
      let x = (PW - total) / 2;
      ws.forEach((w, i) => {
        const sung = t >= w.start - this.s.anticipationMs / 1000;
        const age = t - w.start;
        g.fillStyle = mask ? maskFill(age, live ? (sung ? 1 : 0.3) : 0.2) : rgba(this.s.voicePalette && w.voice === 'B' ? C.accent : C.lintelInk, live ? (sung ? 1 : 0.32) : 0.3);
        this.ftext(g, texts[i], x, 0.13, cap, font);
        x += (textWidth(texts[i], font, 100) / 100) * cap + cap * 0.4;
      });
    }
    // field: the current hero word as large as fits beside the window
    if (hero) {
      const font = style === 'deco' ? 'oswald' : 'montserrat';
      const text = cleanDisplay(hero, 'upper');
      const freeW = this.str('anchor') === 'centre' ? PW * 0.9 : PW * (1 - win.k - 0.06) - 0.1;
      const x0 = this.str('anchor') === 'left' ? PW * (win.k + 0.06) + 0.05 : 0.05;
      let cap = 0.36;
      const tw = textWidth(text, font, 100) / 100;
      cap = Math.min(cap, freeW / tw);
      const age = t - (hero.start - this.s.anticipationMs / 1000);
      const landed = live && age >= 0;
      const pop = landed ? 1 + 0.16 * (1 - easeOutBack(clamp01(age / 0.22))) : 1;
      const beat = live && !this.s.reduceMotion ? 1 + 0.02 * this.react * pulse(a.beats, t, 8) : 1;
      const cy = this.str('anchor') === 'centre' ? 0.32 : 0.6;
      g.save();
      g.translate(x0 + freeW / 2, cy); g.scale(pop * beat, pop * beat);
      const alpha = live ? (landed ? 1 : 0) : 0.28;
      if (alpha > 0) {
        g.fillStyle = mask ? maskFill(age, alpha) : rgba(hero.concept === 'fire' || hero.concept === 'heart' || hero.concept === 'shock' ? C.accent : C.ink, alpha);
        this.ftext(g, text, 0, cap / 2, cap, font, 'center');
      }
      g.restore();
    }
    // the window frame glows on downbeats
    if (!mask) {
      const glow = this.s.reduceMotion ? 0 : pulse(a.downbeats, t, 5) * this.react;
      const x = win.wx * PW, y = win.wy, w = win.k * PW, hgt = win.k;
      g.strokeStyle = C.frame; g.lineWidth = 0.009;
      g.strokeRect(x - 0.0045, y - 0.0045, w + 0.009, hgt + 0.009);
      if (style === 'deco') { g.lineWidth = 0.003; g.strokeRect(x - 0.016, y - 0.016, w + 0.032, hgt + 0.032); }
      if (glow > 0.02) { g.strokeStyle = rgba(mixHex(C.accent, '#ffffff', 0.4), glow); g.lineWidth = 0.012; g.strokeRect(x - 0.006, y - 0.006, w + 0.012, hgt + 0.012); }
    } else { g.fillStyle = '#000'; g.fillRect(win.wx * PW, win.wy, win.k * PW, win.k); }
    g.restore();
    void X; void Y;
  }
}
registerEffect(Droste);

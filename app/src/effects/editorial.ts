// EDITORIAL — a fashion-lookbook title sequence: giant condensed type that fills the frame edge to edge, a word turned
// 90° up the side, red split panels around a black column, a paper card slapped on a desk, white type on black cut
// hard on every word, and words so big the frame crops them. Hard cuts carry motion-blur ghost echoes.
// Cream, black, red and white; no labels, no numbering. Each line is one layout chosen from its section; repeated
// lines reuse their layout. Reduce motion: no echoes or slap-ins.
import { Canvas2DEffect, type EffectContext, type EffectMeta, range, toggle, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { type Ctx2D, clamp01, easeOutQuint, subtitle, lineAt } from '../render/textkit.ts';
import { hash01, lowerBound } from '../analysis/dsp.ts';
import { type Tok, tokens, fit, landed, punch, drawText, sceneClock, unit } from './kit2d.ts';
import { font, sizeForCap } from '../render/sdf.ts';

type Layout = 'full' | 'side' | 'panels' | 'card' | 'hard' | 'crop';
interface Pal { paper: string; ink: string; red: string; white: string; desk: string }
const PALS: Record<string, Pal> = {
  Lookbook: { paper: '#EADFCB', ink: '#0D0C0B', red: '#D3141B', white: '#F8F5EF', desk: '#D9D6D0' },
  Cobalt: { paper: '#E9E6DF', ink: '#0B0D14', red: '#1F3BFF', white: '#F7F7F4', desk: '#D6D8DE' },
  Acid: { paper: '#F1F0E6', ink: '#0B0B0B', red: '#C6F000', white: '#FFFFFF', desk: '#DCDCD2' },
};
const POOLS: Record<string, Layout[]> = {
  chorus: ['full', 'crop', 'panels'], drop: ['full', 'crop', 'hard'], verse: ['side', 'card', 'hard'],
  bridge: ['panels', 'card', 'side'], breakdown: ['hard', 'card'], intro: ['full', 'card'], outro: ['crop', 'full'], speech: ['card', 'side'],
};
interface Scene { layout: Layout; variant: number; seed: number; toks: Tok[]; chunks: number[][]; hero: number; start: number; end: number; first: boolean }

export class Editorial extends Canvas2DEffect {
  static meta: EffectMeta = {
    id: 'editorial', name: 'Editorial', kind: '2d',
    description: 'Fashion-lookbook type: words that fill the frame edge to edge, side-turned words, red split panels, paper cards and hard cuts with motion-blur echoes.',
    affinity: aff(0.75, 0.5, 0.65, 0.55, 0.7, 0.6, 0.6, 0.7),
    supportsTransparent: true, ownsTitle: true,
    params: [
      select('palette', 'Palette', 'Look', 'Lookbook', ['Lookbook', 'Cobalt', 'Acid']),
      range('echo', 'Ghost echoes', 'Motion', 1, 0, 2, 0.01),
      toggle('marks', 'Print marks', 'Look', true),
    ],
  };
  readonly meta = Editorial.meta;
  private scenes: Scene[] = [];
  private P: Pal = PALS.Lookbook;
  private title = '';

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const ly = this.ly, a = this.a;
    this.P = PALS[this.str('palette')] ?? PALS.Lookbook;
    this.title = (this.s.title || ly.meta?.title || '').toUpperCase();
    this.scenes = [];
    ly.lines.forEach((line, li) => {
      const label = a.sections[line.section]?.label ?? 'verse';
      const prev = this.scenes[li - 1];
      const toks = tokens(ly, line, this.s, 'bebas');
      const rep = line.repeatOf !== undefined ? this.scenes[line.repeatOf] : undefined;
      let layout: Layout, variant: number;
      if (rep) { layout = rep.layout; variant = rep.variant; }
      else {
        const pool = POOLS[label] ?? POOLS.verse;
        let k = Math.floor(hash01(this.seed, li, 21) * pool.length);
        if (prev && pool[k] === prev.layout) k = (k + 1) % pool.length;
        layout = pool[k]; variant = Math.floor(hash01(this.seed, li, 22) * 3);
      }
      // two-word chunks for the full-bleed layouts (a short connective rides with the next word)
      const chunks: number[][] = [];
      let cur: number[] = [];
      toks.forEach((p, i) => {
        cur.push(i);
        const chars = cur.reduce((s, j) => s + toks[j].text.length, 0);
        if (cur.length >= 2 || chars >= 9 || i === toks.length - 1) { chunks.push(cur); cur = []; }
      });
      let hero = toks.findIndex((p) => p.hero);
      if (hero < 0) hero = toks.reduce((b, p, i) => (p.text.length > toks[b].text.length ? i : b), 0);
      this.scenes.push({ layout, variant, seed: (this.seed * 7919 + li * 104729) >>> 0, toks, chunks, hero, start: line.start, end: line.end, first: !prev || ly.lines[li - 1].section !== line.section });
    });
  }

  protected draw(t: number, g: Ctx2D, mask: boolean): void {
    const { W, H, P } = this, ly = this.ly;
    const antic = this.s.anticipationMs / 1000, lead = antic + 0.05;
    const ck = sceneClock(ly, t, lead, this.a.duration);
    const sc = ck.brk ? null : this.scenes[ck.li];
    const opaque = !mask && !this.s.transparentBackground;
    if (!sc) {
      if (opaque) { g.fillStyle = P.ink; g.fillRect(0, 0, W, H); this.marks(g, P.paper, ck.age); }
      if (!mask && ck.brk?.intro && this.title) { const rows = this.titleRows(); this.fullRows(g, rows, t, ck.age, P.paper, false, rows.map(() => 0)); }
      if (!mask) subtitle(g, ly.lines[lineAt(ly, t)], t, this.s, W, H, '#fff');
      return;
    }
    // snap zoom at every cut
    const z = this.s.reduceMotion ? 1 : 1 + 0.05 * (1 - easeOutQuint(ck.age / 0.14));
    g.save();
    g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-W / 2, -H / 2);
    switch (sc.layout) {
      case 'full': this.full(g, t, sc, antic, mask, opaque); break;
      case 'side': this.side(g, t, sc, antic, mask, opaque); break;
      case 'panels': this.panels(g, t, sc, antic, mask, opaque, ck.age); break;
      case 'card': this.card(g, t, sc, antic, mask, opaque, ck.age); break;
      case 'hard': this.hard(g, t, sc, antic, mask, opaque); break;
      case 'crop': this.crop(g, t, sc, antic, mask, opaque); break;
    }
    g.restore();
    if (!mask) subtitle(g, ly.lines[lineAt(ly, t)], t, this.s, W, H, '#fff');
  }

  /** the title broken into up to three balanced rows */
  private titleRows(): string[] {
    const words = this.title.split(/\s+/).filter(Boolean);
    const n = Math.min(3, Math.max(1, Math.ceil(this.title.length / 9)));
    const rows: string[] = []; const per = Math.ceil(words.length / n);
    for (let i = 0; i < words.length; i += per) rows.push(words.slice(i, i + per).join(' '));
    return rows;
  }

  private echoK(): number { return this.s.reduceMotion ? 0 : this.num('echo'); }

  /** rows of text, each stretched to the full frame width; rows share the height */
  private fullRows(g: Ctx2D, texts: string[], t: number, age: number, ink: string, mask: boolean, ages: number[], dx = 0, alpha = 1): void {
    const { W, H } = this, n = texts.length, gap = H * 0.025;
    let cap = (H * 0.93 - gap * (n - 1)) / n;
    // a row can squeeze to 45 % width at most: longer text gets a smaller cap so it never leaves the frame
    for (const text of texts) cap = Math.min(cap, (W * 0.965) / (0.45 * Math.max(0.05, this.unitOf(text))));
    g.save(); g.globalAlpha *= alpha;
    texts.forEach((text, r) => {
      if (ages[r] < 0) return;
      const u = Math.max(0.05, this.unitOf(text));
      const sx = Math.max(0.45, Math.min(3.2, (W * 0.965) / (u * cap)));
      const y = H * 0.035 + r * (cap + gap) + cap;
      drawText(g, text, W / 2 + dx, y, cap, ink, mask, ages[r], { align: 'center', sx });
    });
    g.restore();
  }
  private uCache = new Map<string, number>();
  private unitOf(text: string): number {
    let u = this.uCache.get(text);
    if (u === undefined) { u = unit(text, 'bebas'); this.uCache.set(text, u); }
    return u;
  }

  private colours(v: number): [string, string] { const P = this.P; return [[P.paper, P.ink], [P.ink, P.paper], [P.red, P.white]][v] as [string, string]; }

  // ---------- layouts ----------
  private full(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean, opaque: boolean): void {
    const [bg, ink] = this.colours(s.variant);
    if (opaque) { g.fillStyle = bg; g.fillRect(-20, -20, this.W + 40, this.H + 40); }
    const cur = landed(s.toks, t, antic);
    if (!cur) return;
    const ci = s.chunks.findIndex((c) => c.includes(cur.i));
    const chunk = s.chunks[ci];
    const firstAge = t - (s.toks[chunk[0]].w.start - antic);
    // the previous chunk smears out sideways for 120 ms
    if (!mask && ci > 0 && firstAge < 0.12 && this.echoK() > 0) {
      const pc = s.chunks[ci - 1], k = firstAge / 0.12;
      for (let e = 1; e <= 3; e++) this.fullRows(g, pc.map((j) => s.toks[j].text), t, 1, ink, false, pc.map(() => 1), -this.W * 0.06 * e * (0.4 + k), 0.22 * (1 - k) * this.echoK());
    }
    this.fullRows(g, chunk.map((j) => s.toks[j].text), t, firstAge, ink, mask, chunk.map((j) => t - (s.toks[j].w.start - antic)));
  }

  private side(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean, opaque: boolean): void {
    const { W, H, P } = this;
    if (opaque) { g.fillStyle = P.paper; g.fillRect(-20, -20, W + 40, H + 40); if (this.bool('marks')) this.marks(g, P.ink, 1); }
    const hero = s.toks[s.hero];
    // the hero word turned 90°, filling the frame's height in the right-hand strip
    const ha = t - (hero.w.start - antic);
    if (ha >= 0) {
      const stripW = W * 0.3, cap = stripW * 0.92, len = H * 0.94;
      const sx = Math.max(0.4, Math.min(2.5, len / Math.max(0.05, hero.u * cap)));
      g.save(); g.translate(W - stripW * 0.04, H / 2); g.rotate(-Math.PI / 2);
      const k = punch(ha, this.s.reduceMotion, 0.6);
      g.scale(k, k);
      if (!mask && this.echoK() > 0 && ha < 0.3) for (let e = 1; e <= 3; e++) { g.save(); g.globalAlpha = 0.25 * (1 - ha / 0.3) * this.echoK(); drawText(g, hero.text, 0, -e * stripW * 0.12, cap, P.ink, false, 1, { align: 'center', sx }); g.restore(); }
      drawText(g, hero.text, 0, 0, cap, P.ink, mask, ha, { align: 'center', sx });
      g.restore();
    }
    // the rest of the line, one word per row on the left, each row as wide as the column
    const rest = s.toks.filter((_, i) => i !== s.hero);
    const colW = W * 0.6, n = Math.max(1, rest.length), rowH = Math.min(H * 0.86 / n, H * 0.3);
    rest.forEach((p, r) => {
      const a0 = t - (p.w.start - antic);
      if (a0 < 0) return;
      const cap = rowH * 0.84;
      const sx = Math.max(0.5, Math.min(2.2, colW / Math.max(0.05, p.u * cap)));
      const y = H / 2 - (n * rowH) / 2 + r * rowH + cap;
      const slide = this.s.reduceMotion ? 0 : (1 - easeOutQuint(a0 / 0.16)) * -W * 0.2;
      if (!mask && this.echoK() > 0 && a0 < 0.2) for (let e = 1; e <= 2; e++) { g.save(); g.globalAlpha = 0.2 * (1 - a0 / 0.2) * this.echoK(); drawText(g, p.text, W * 0.05 + slide - e * W * 0.03, y, cap, P.ink, false, 1, { sx }); g.restore(); }
      drawText(g, p.text, W * 0.05 + slide, y, cap, p.w.role === 'hero' ? P.red : P.ink, mask, a0, { sx });
    });
  }

  private panels(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean, opaque: boolean, age: number): void {
    const { W, H, P } = this;
    const colW = W * 0.26, cx = W / 2;
    const u = this.s.reduceMotion ? 1 : easeOutQuint(age / 0.18);
    if (opaque) {
      g.fillStyle = P.red; g.fillRect(-20, -20, W + 40, H + 40);
      const pw = (W - colW) / 2 - W * 0.05, ph = H * 0.78, py = (H - ph) / 2;
      g.fillStyle = P.paper;
      g.fillRect(W * 0.035 - (1 - u) * W * 0.5, py, pw, ph);
      g.fillRect(cx + colW / 2 + W * 0.015 + (1 - u) * W * 0.5, py, pw, ph);
      g.fillStyle = P.ink; g.fillRect(cx - colW / 2, -20, colW, H + 40);
    }
    const cur = landed(s.toks, t, antic, true) ?? landed(s.toks, t, antic);
    // centre column: the current word stacked tall in white
    if (cur) {
      const p = s.toks[cur.i], a0 = t - (p.w.start - antic);
      const cap = H * 0.82, sx = Math.max(0.25, Math.min(1.6, (colW * 0.9) / Math.max(0.05, p.u * cap)));
      const k = punch(a0, this.s.reduceMotion, 0.7);
      g.save(); g.translate(cx, H / 2); g.scale(k, k); g.translate(-cx, -H / 2);
      drawText(g, p.text, cx, H / 2 + cap / 2, cap, P.white, mask, a0, { align: 'center', sx });
      g.restore();
    }
    // left panel: the line so far; right panel: the strongest word, ghosted
    const pw = (W - colW) / 2 - W * 0.05, ph = H * 0.78, py = (H - ph) / 2;
    const done = s.toks.filter((p) => p.w.start - antic <= t);
    if (done.length) {
      const f = fit(done, pw * 0.86, ph * 0.86, 5);
      done.forEach((p) => {
        const a0 = t - (p.w.start - antic);
        drawText(g, p.text, W * 0.035 + pw * 0.07 + p.x - (1 - u) * W * 0.5, py + ph * 0.07 + p.row * f.cap * 1.16 + f.cap, f.cap * p.scale, P.ink, mask, a0);
      });
    }
    const hero = s.toks[s.hero], ha = t - (hero.w.start - antic);
    if (ha >= 0 && !mask) {
      const cap = ph * 0.8, sx = Math.max(0.3, Math.min(1.8, (pw * 0.9) / Math.max(0.05, hero.u * cap)));
      g.save(); g.globalAlpha = 0.16;
      drawText(g, hero.text, cx + colW / 2 + W * 0.015 + pw / 2 + (1 - u) * W * 0.5, py + ph / 2 + cap / 2, cap, P.ink, false, 1, { align: 'center', sx });
      g.restore();
    }
  }

  private card(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean, opaque: boolean, age: number): void {
    const { W, H, P } = this;
    if (opaque) { g.fillStyle = P.desk; g.fillRect(-20, -20, W + 40, H + 40); if (this.bool('marks')) this.marks(g, P.ink, 1); }
    const cw = W * 0.5, ch = H * 0.56;
    const rot = (hash01(s.seed, 31) - 0.5) * 0.14;
    const slap = this.s.reduceMotion ? 1 : 1 + 0.18 * (1 - easeOutQuint(age / 0.14));
    // a small wobble on downbeats
    const db = this.a.downbeats[lowerBound(this.a.downbeats, t + 1e-6) - 1];
    const wob = !this.s.reduceMotion && db !== undefined && t - db < 0.25 ? Math.exp(-(t - db) / 0.06) * 0.012 : 0;
    g.save();
    g.translate(W / 2, H / 2); g.rotate(rot + wob); g.scale(slap, slap);
    if (opaque) {
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(-cw / 2 + W * 0.008, -ch / 2 + H * 0.016, cw, ch);
      g.fillStyle = P.white; g.fillRect(-cw / 2, -ch / 2, cw, ch);
    }
    const f = fit(s.toks, cw * 0.84, ch * 0.8, 3);
    const y0 = -(f.rows * f.cap * 1.16 - f.cap * 0.16) / 2;
    s.toks.forEach((p) => {
      const a0 = t - (p.w.start - antic);
      if (a0 < 0) return;
      const x = -cw * 0.42 + p.x, base = y0 + p.row * f.cap * 1.16 + f.cap, cap = f.cap * p.scale;
      if (!mask && p === s.toks[s.hero]) { g.fillStyle = P.red; g.fillRect(x - cap * 0.08, base - cap * 1.08, p.u * cap + cap * 0.16, cap * 1.16); }
      const k = punch(a0, this.s.reduceMotion, 0.6);
      g.save(); g.translate(x, base - cap / 2); g.scale(k, k); g.translate(-x, -(base - cap / 2));
      drawText(g, p.text, x, base, cap, p === s.toks[s.hero] ? P.white : P.ink, mask, a0);
      g.restore();
    });
    g.restore();
  }

  private hard(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean, opaque: boolean): void {
    const { W, H, P } = this;
    if (opaque) {
      g.fillStyle = '#050505'; g.fillRect(-20, -20, W + 40, H + 40);
      // two thin rules at the edges that jitter on the beat
      const bi = lowerBound(this.a.beats, t + 1e-6);
      g.fillStyle = P.white; g.globalAlpha = 0.85;
      g.fillRect(W * (0.06 + 0.01 * hash01(bi, 41)), 0, Math.max(1, W * 0.0015), H);
      g.fillRect(W * (0.93 - 0.01 * hash01(bi, 42)), H * 0.1, Math.max(1, W * 0.0015), H * 0.8);
      g.globalAlpha = 1;
    }
    const cur = landed(s.toks, t, antic);
    if (!cur) return;
    // a hard cut on every word: the current word and the one before it, stacked
    const ids = cur.i > 0 && s.toks[cur.i - 1].text.length + s.toks[cur.i].text.length < 12 ? [cur.i - 1, cur.i] : [cur.i];
    const n = ids.length, cap = H * (n === 2 ? 0.34 : 0.5);
    ids.forEach((j, r) => {
      const p = s.toks[j], a0 = t - (p.w.start - antic);
      const sx = Math.max(0.5, Math.min(1.4, (W * 0.62) / Math.max(0.05, p.u * cap)));
      const y = H / 2 - (n * cap * 1.06) / 2 + r * cap * 1.06 + cap;
      drawText(g, p.text, W / 2, y, cap, P.white, mask, a0, { align: 'center', sx });
    });
  }

  private crop(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean, opaque: boolean): void {
    const { W, H, P } = this;
    const [bg, ink] = this.colours(s.variant === 2 ? 0 : s.variant);
    if (opaque) { g.fillStyle = bg; g.fillRect(-20, -20, W + 40, H + 40); }
    const cur = landed(s.toks, t, antic, true) ?? landed(s.toks, t, antic);
    if (cur) {
      const p = s.toks[cur.i], a0 = t - (p.w.start - antic);
      // taller than the frame: the frame crops its top and bottom
      const cap = H * 1.28, sx = Math.max(0.35, Math.min(2.6, (W * 1.02) / Math.max(0.05, p.u * cap)));
      if (!mask && this.echoK() > 0 && a0 < 0.14) { g.save(); g.globalAlpha = 0.3 * (1 - a0 / 0.14) * this.echoK(); drawText(g, p.text, W / 2 + W * 0.05, H / 2 + cap / 2, cap, ink, false, 1, { align: 'center', sx }); g.restore(); }
      drawText(g, p.text, W / 2, H / 2 + cap / 2, cap, ink, mask, a0, { align: 'center', sx });
    }
    // the whole line so far on a red band near the bottom
    if (!mask) {
      const done = s.toks.filter((p) => p.w.start - antic <= t).map((p) => p.text).join(' ');
      if (done) {
        const cap = H * 0.055;
        g.save();
        g.font = font('montserrat', sizeForCap('montserrat', cap));
        const tw = g.measureText(done).width, k = Math.min(1, (W * 0.8) / tw);
        g.translate(W * 0.06, H * 0.86); g.scale(k, k);
        g.fillStyle = P.red; g.fillRect(-cap * 0.5, -cap * 1.4, tw + cap, cap * 1.85);
        g.fillStyle = P.white; g.textBaseline = 'alphabetic'; g.fillText(done, 0, 0);
        g.restore();
      }
    }
  }

  /** registration crosses and thin trim rules */
  private marks(g: Ctx2D, c: string, alpha: number): void {
    const { W, H } = this, m = Math.min(W, H) * 0.035, l = m * 0.6;
    g.save(); g.strokeStyle = c; g.globalAlpha = 0.5 * clamp01(alpha); g.lineWidth = Math.max(1, H * 0.0015);
    for (const [x, y] of [[m, m], [W - m, m], [m, H - m], [W - m, H - m]]) {
      g.beginPath(); g.moveTo(x - l, y); g.lineTo(x + l, y); g.moveTo(x, y - l); g.lineTo(x, y + l); g.stroke();
      g.beginPath(); g.arc(x, y, l * 0.45, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
  }
}
registerEffect(Editorial);

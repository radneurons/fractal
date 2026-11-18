// BREAKOUT — a campaign title sequence made of type only: giant kinetic words, hard-edged colour fields, barcodes and
// UI ticks, halftone, ink spatter, torn paper, stickers, speed lines, RGB splits, shutter flashes, impact shakes and
// snap zooms, all snapped to the analysed beats.
//
// Two fixed letterbox bars frame a central picture window. Compositing, back to front: the scene (confined to the
// window) → the bars (never move, never change) → the foreground type, which is NOT confined: when a word lands it
// punches toward the viewer and spills over the bars, with black left visible beside every overlap.
//
// Every line is a scene in one of six styles (MEGA, STACK, TICKER, LOADING, SPLAT, TORN) chosen from the section's
// character; repeated lines reuse their first occurrence's scene so choruses stay recognisable. Instrumental breaks get
// a LOADING card with a progress bar that runs to the next vocal, and the intro gets the title.
// Reduce motion: no shake, whip, RGB split or marquee scroll, shorter snaps.
import { Canvas2DEffect, softCanvas, type EffectContext, type EffectMeta, range, toggle, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { maskFill } from './common.ts';
import { type Ctx2D, clamp01, easeOutQuint, easeOutBack, cleanDisplay, lineAt, subtitle } from '../render/textkit.ts';
import { font, sizeForCap, scratchCtx, makeCanvas } from '../render/sdf.ts';
import { hash01, lowerBound } from '../analysis/dsp.ts';
import type { Word } from '../types.ts';

type Style = 'mega' | 'stack' | 'ticker' | 'loading' | 'splat' | 'torn';
/** a: accent (hot pink) · b: second accent (lime) · k: black · d: dark field (teal) · w: white */
interface Pal { a: string; b: string; k: string; d: string; w: string }
const PALS: Record<string, Pal> = {
  Pix: { a: '#FF1F8F', b: '#B9F23C', k: '#0B0B0D', d: '#0F4B4E', w: '#F7F6F1' },
  Riot: { a: '#FF3B2F', b: '#FFE14D', k: '#0B0B0D', d: '#13265E', w: '#F7F6F1' },
  Ice: { a: '#7C5CFF', b: '#45E3FF', k: '#0A0A12', d: '#14213D', w: '#F4F6FB' },
};
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const DISPLAY = 'bebas', LABEL = 'montserrat', UI = 'mono';
const PITCH = 1.16; // row pitch in caps

interface SW { w: Word; text: string; hero: boolean; u: number; scale: number; row: number; x: number }
interface Scene {
  li: number; style: Style; start: number; end: number; next: number; label: string;
  words: SW[]; cap: number; rows: number; rowW: number[];
  variant: number; seed: number; firstOfSection: boolean;
  sticker: { text: string; t: number; corner: number; tone: number } | null;
}

const POOLS: Record<string, Style[]> = {
  chorus: ['mega', 'ticker', 'splat'], drop: ['mega', 'splat', 'ticker'],
  verse: ['loading', 'stack', 'torn'], bridge: ['torn', 'mega', 'loading'], breakdown: ['torn', 'loading', 'stack'],
  intro: ['mega', 'loading'], outro: ['loading', 'mega'], speech: ['loading', 'stack'],
};

export class Breakout extends Canvas2DEffect {
  static meta: EffectMeta = {
    id: 'breakout', name: 'Breakout', kind: '2d',
    description: 'Campaign title sequence in pure type: giant kinetic words that punch out over the letterbox bars, colour fields, barcodes, stickers, spatter and torn paper, snapped to the beat.',
    affinity: aff(0.9, 0.35, 0.6, 0.65, 0.6, 0.4, 0.85, 0.85),
    supportsTransparent: true, ownsTitle: true,
    params: [
      select('palette', 'Palette', 'Look', 'Pix', ['Pix', 'Riot', 'Ice']),
      range('bars', 'Letterbox bars', 'Frame', 0.12, 0, 0.2, 0.005, false, 'thickness of each bar, as a fraction of the height'),
      range('breakout', 'Frame break', 'Frame', 1, 0, 1.5, 0.01, false, 'how far words punch out over the bars'),
      range('shake', 'Impact shake', 'Motion', 1, 0, 2, 0.01),
      range('split', 'RGB split', 'Motion', 1, 0, 2, 0.01),
      toggle('ui', 'UI chrome', 'Graphics', true),
      toggle('halftone', 'Halftone', 'Graphics', true),
      toggle('stickers', 'Stickers', 'Graphics', true),
    ],
  };
  readonly meta = Breakout.meta;
  private scenes: Scene[] = [];
  private P: Pal = PALS.Pix;
  private bar = 0;
  private halftones = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
  private grain: HTMLCanvasElement | OffscreenCanvas | null = null;
  private title = '';
  private artist = '';

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const { W, H } = this, ly = this.ly, a = this.a;
    this.P = PALS[this.str('palette')] ?? PALS.Pix;
    if (this.s.paletteSource === 'artwork' && ctx.artwork) this.P = { ...this.P, a: ctx.artwork.vivid1, b: ctx.artwork.vivid2, d: ctx.artwork.dominant };
    this.bar = Math.round(H * this.num('bars'));
    this.title = (this.s.title || ly.meta?.title || '').toUpperCase();
    this.artist = (this.s.artist || '').toUpperCase(); // only what the user typed, never file tags
    this.halftones.clear();
    const sc = scratchCtx();
    const unit = (text: string, key: string) => { sc.font = font(key, sizeForCap(key, 100)); return sc.measureText(text).width / 100; };
    const wh = H - 2 * this.bar;
    const scenes: Scene[] = [];
    ly.lines.forEach((line, li) => {
      const sec = a.sections[line.section];
      const label = sec?.label ?? 'verse';
      const prev = scenes[li - 1];
      const firstOfSection = !prev || ly.lines[li - 1].section !== line.section;
      const words: SW[] = line.words.map((i) => ly.words[i]).map((w) => {
        const text = cleanDisplay(w, this.s.caseMode);
        return { w, text, hero: w.role === 'hero' && !w.backing, u: unit(text, DISPLAY), scale: w.backing ? 0.55 : w.role === 'hero' ? 1.12 : 1, row: 0, x: 0 };
      });
      // style: repeated lines reuse their first occurrence's scene; otherwise a seeded pick from the section's pool
      // that never repeats the previous scene's style
      let style: Style, variant: number;
      const rep = line.repeatOf !== undefined ? scenes[line.repeatOf] : undefined;
      if (rep) { style = rep.style; variant = rep.variant; }
      else {
        const pool = POOLS[label] ?? POOLS.verse;
        let k = Math.floor(hash01(this.seed, li, 11) * pool.length);
        if (prev && pool[k] === prev.style) k = (k + 1) % pool.length;
        style = pool[k];
        variant = Math.floor(hash01(this.seed, li, 12) * 3);
      }
      const s: Scene = { li, style, start: line.start, end: line.end, next: ly.lines[li + 1]?.start ?? Infinity, label, words, cap: 0, rows: 1, rowW: [0], variant, seed: (this.seed * 7919 + li * 104729) >>> 0, firstOfSection, sticker: null };
      // fit the line into the style's box
      const box = style === 'stack' ? [0.8, 0.78, 4] : style === 'ticker' ? [0.86, 0.34, 2] : style === 'torn' ? [0.82, 0.44, 2] : style === 'splat' ? [0.84, 0.7, 3] : [0.86, 0.76, 2];
      this.fit(s, W * box[0], wh * box[1], box[2]);
      // a sticker on the first line of a section and on some others, slapped on a downbeat
      if (this.bool('stickers') && (firstOfSection || hash01(s.seed, 3) < 0.4)) {
        // graphic stickers and facts from the analysis only: no section names, no numbering
        const pick = Math.floor(hash01(s.seed, 4) * 4);
        const text = [`${Math.round(a.bpm)} BPM`, `${KEYS[a.key.tonic] ?? 'C'} ${a.key.mode === 'minor' ? 'MINOR' : 'MAJOR'}`, '★★★', '✦ ✦ ✦'][pick];
        const db = a.downbeats[lowerBound(a.downbeats, line.start + 0.15)];
        s.sticker = { text, t: db !== undefined && db < line.end ? db : line.start + 0.35, corner: Math.floor(hash01(s.seed, 5) * 4), tone: Math.floor(hash01(s.seed, 6) * 3) };
      }
      scenes.push(s);
    });
    this.scenes = scenes;
    // grain for the torn-paper scenes
    const gr = makeCanvas(128, 128), gg = gr.getContext('2d', { willReadFrequently: softCanvas() }) as Ctx2D;
    for (let i = 0; i < 1400; i++) { gg.fillStyle = `rgba(${hash01(i, 1) < 0.5 ? '0,0,0' : '255,255,255'},${0.05 + hash01(i, 2) * 0.08})`; gg.fillRect(hash01(i, 3) * 128, hash01(i, 4) * 128, 1 + hash01(i, 5) * 2, 1); }
    this.grain = gr;
  }

  /** greedy rows at a cap, then shrink the cap until the line fits the box */
  private fit(s: Scene, bw: number, bh: number, maxRows: number): void {
    const flow = (cap: number) => {
      let row = 0, x = 0; const rowW = [0];
      for (const p of s.words) {
        const wd = p.u * cap * p.scale;
        if (x > 0 && x + wd > bw) { row++; x = 0; rowW.push(0); }
        p.row = row; p.x = x; x += wd + cap * 0.28; rowW[row] = x - cap * 0.28;
      }
      return { rows: row + 1, rowW };
    };
    let cap = bh / Math.max(1, Math.min(maxRows, s.words.length)) / PITCH, f = flow(cap);
    for (let i = 0; i < 40; i++) {
      const fits = f.rows * cap * PITCH <= bh * 1.02 && Math.max(...f.rowW) <= bw * 1.001;
      if (fits && (f.rows <= maxRows || cap < bh * 0.12)) break;
      cap *= 0.93; f = flow(cap);
    }
    s.cap = cap; s.rows = f.rows; s.rowW = f.rowW;
  }

  // ---------- frame ----------
  protected draw(t: number, g: Ctx2D, mask: boolean): void {
    const { W, H, P } = this, bar = this.bar, wy = bar, wh = H - 2 * bar, ly = this.ly;
    const reduce = this.s.reduceMotion;
    const antic = this.s.anticipationMs / 1000, lead = antic + 0.06;
    const li = lineAt(ly, t + lead);
    const sc = li >= 0 ? this.scenes[li] : null;
    // instrumental breaks and the intro: a LOADING / title card that runs to the next vocal
    let brk: { from: number; to: number; intro: boolean } | null = null;
    if (!sc) brk = { from: 0, to: ly.lines[0] ? ly.lines[0].start - lead : this.a.duration, intro: true };
    else if (sc.next - sc.end >= 5 && t > sc.end + 1.2) brk = { from: sc.end + 1.2, to: sc.next - lead, intro: false };
    const t0 = brk ? brk.from : sc!.start - lead;
    const age = t - t0;
    const style: Style | 'break' = brk ? 'break' : sc!.style;
    const seed = brk ? Math.floor(brk.from * 10) : sc!.seed;
    // camera: snap zoom at every scene, whip pan into a new section, impact shake on chorus downbeats and landings
    const zoom = 1 + (reduce ? 0.025 : 0.085) * (1 - easeOutQuint(age / 0.16));
    const whipIn = !reduce && (brk ? true : sc!.firstOfSection) ? (1 - easeOutQuint(age / 0.2)) : 0;
    const whipDir = hash01(seed, 21) < 0.5 ? -1 : 1;
    let sx = 0, sy = 0;
    if (!reduce && this.num('shake') > 0) {
      const amp = 0.013 * H * this.num('shake') * this.camEnergy;
      const di = lowerBound(this.a.downbeats, t + 1e-6) - 1;
      const db = this.a.downbeats[di];
      const loud = sc && (sc.label === 'chorus' || sc.label === 'drop');
      const land = sc ? this.lastLanding(sc, t, antic) : null;
      let e = -1, k = 0;
      if (loud && db !== undefined && t - db < 0.3) { e = di; k = Math.exp(-(t - db) / 0.06); }
      if (land && (style === 'mega' || style === 'splat') && t - land.t < 0.3) { const k2 = Math.exp(-(t - land.t) / 0.06); if (k2 > k) { k = k2; e = 1e5 + land.i; } }
      if (e >= 0) { sx = (hash01(e, seed, 1) - 0.5) * 2 * amp * k; sy = (hash01(e, seed, 2) - 0.5) * 2 * amp * k; }
    }
    const cam = (gg: Ctx2D) => {
      gg.translate(W / 2 + sx + whipDir * W * 0.55 * whipIn, wy + wh / 2 + sy);
      gg.scale(zoom, zoom);
      gg.translate(-W / 2, -(wy + wh / 2));
    };
    const opaque = !this.s.transparentBackground && !mask;
    // 1. background, confined to the picture window
    if (opaque) {
      g.fillStyle = P.k; g.fillRect(0, 0, W, H);
      g.save();
      g.beginPath(); g.rect(0, wy, W, wh); g.clip();
      cam(g);
      this.background(g, t, style, sc, brk, age, seed);
      g.restore();
      // 2. the bars: fixed, equal, plain black; the UI chrome lives on them
      g.fillStyle = P.k; g.fillRect(0, 0, W, bar); g.fillRect(0, H - bar, W, bar);
      if (this.bool('ui') && bar >= 18) this.chrome(g, t, sc, brk);
    }
    // 3. foreground type: not confined to the window
    g.save();
    cam(g);
    this.foreground(g, t, style, sc, brk, age, seed, mask);
    g.restore();
    if (mask) return;
    // stickers are slapped on the screen itself (no camera), straddling the window edge
    if (sc && !brk && sc.sticker && t >= sc.sticker.t) this.sticker(g, t, sc);
    // whip smear: speed lines across the window while it travels
    if (whipIn > 0.05 && opaque) {
      g.save(); g.beginPath(); g.rect(0, wy, W, wh); g.clip();
      g.fillStyle = P.w; g.globalAlpha = 0.5 * whipIn;
      for (let i = 0; i < 18; i++) { const y = wy + hash01(i, seed, 31) * wh, len = W * (0.2 + hash01(i, seed, 32) * 0.5); g.fillRect(hash01(i, seed, 33) * W - len / 2, y, len, Math.max(1, H * 0.003)); }
      g.restore();
    }
    // shutter flash into a new section (scaled by the photosensitivity guard)
    const firstAge = brk ? age : sc!.firstOfSection ? age : 1;
    if (opaque && firstAge >= 0 && firstAge < 0.1) {
      g.save(); g.globalAlpha = 0.55 * (1 - firstAge / 0.1) * this.flash(t) * this.intensity;
      g.fillStyle = P.w; g.fillRect(0, wy, W, wh); g.restore();
    }
    subtitle(g, ly.lines[lineAt(ly, t)], t, this.s, W, H, '#fff');
  }

  /** the latest word of the scene that has landed (index into the scene's words) */
  private lastLanding(s: Scene, t: number, antic: number, skipConnective = false): { i: number; t: number } | null {
    let best: { i: number; t: number } | null = null;
    s.words.forEach((p, i) => {
      const land = p.w.start - antic;
      if (land > t || p.w.backing) return;
      if (skipConnective && p.w.role === 'connective') return;
      if (!best || land >= best.t) best = { i, t: land };
    });
    return best;
  }

  /** scale of a landing word: it pops from just below size to an overshoot past it (toward the viewer), then settles */
  private punch(age: number, hero: boolean): number {
    if (age < 0) return 0;
    if (this.s.reduceMotion) return 1;
    const brk = this.num('breakout');
    return 0.8 + 0.2 * easeOutBack(age / (hero ? 0.24 : 0.18), (hero ? 3.2 : 2.2) * brk);
  }

  private split(age: number, cap: number): number {
    if (this.s.reduceMotion || age < 0) return 0;
    return cap * 0.045 * this.num('split') * Math.exp(-age / 0.09);
  }

  /** draw a word with its baseline at (x, y); RGB split and an optional stroke; in mask mode only its coverage */
  private type(g: Ctx2D, text: string, x: number, y: number, cap: number, fill: string, mask: boolean, age: number, o: { key?: string; stroke?: string; sw?: number; split?: number; align?: CanvasTextAlign } = {}): void {
    const key = o.key ?? DISPLAY;
    g.font = font(key, sizeForCap(key, cap));
    g.textAlign = o.align ?? 'left'; g.textBaseline = 'alphabetic';
    if (mask) { g.fillStyle = maskFill(age); g.fillText(text, x, y); return; }
    const sp = o.split ?? 0;
    if (sp > 0.5) {
      const ga = g.globalAlpha;
      g.globalAlpha = ga * 0.9;
      g.fillStyle = this.P.a; g.fillText(text, x - sp, y - sp * 0.3);
      g.fillStyle = this.P.b; g.fillText(text, x + sp, y + sp * 0.3);
      g.globalAlpha = ga;
    }
    if (o.stroke) { g.lineJoin = 'round'; g.lineWidth = o.sw ?? cap * 0.08; g.strokeStyle = o.stroke; g.strokeText(text, x, y); }
    g.fillStyle = fill; g.fillText(text, x, y);
  }

  // ---------- background (inside the window) ----------
  private background(g: Ctx2D, t: number, style: Style | 'break', s: Scene | null, brk: { from: number; to: number } | null, age: number, seed: number): void {
    const { W, H, P } = this, wy = this.bar, wh = H - 2 * this.bar;
    const fill = (c: string) => { g.fillStyle = c; g.fillRect(-W, wy - H, W * 3, wh + 2 * H); };
    const v = s?.variant ?? 0;
    switch (style) {
      case 'mega': {
        const bg = [P.w, P.a, P.k][v];
        fill(bg);
        if (this.bool('halftone')) this.halftone(g, v === 1 ? P.k : P.a, seed);
        this.barcode(g, W * 0.035, wy + wh * 0.18, W * 0.022, wh * 0.4, v === 2 ? P.w : P.k, seed, true);
        this.ticks(g, t, W * 0.955, wy + wh * 0.12, wh * 0.76, v === 2 ? P.b : P.k, seed);
        break;
      }
      case 'stack': {
        fill([P.d, P.k, P.d][v]);
        // a hard-edged field slicing the window and fast speed lines in the background
        g.fillStyle = v === 1 ? P.d : P.k; g.globalAlpha = 0.55;
        g.beginPath(); g.moveTo(W * 0.62, wy - 10); g.lineTo(W + 10, wy - 10); g.lineTo(W + 10, wy + wh + 10); g.lineTo(W * 0.48, wy + wh + 10); g.closePath(); g.fill();
        g.globalAlpha = 1;
        this.speedLines(g, t, P.w, 0.1, seed);
        if (this.bool('halftone')) this.halftone(g, P.a, seed);
        break;
      }
      case 'ticker': {
        fill(P.b);
        this.speedLines(g, t, P.k, 0.12, seed);
        break;
      }
      case 'loading': case 'break': {
        fill(P.w);
        // the colour field snaps in from the side
        const u = this.s.reduceMotion ? 1 : easeOutQuint(age / 0.14);
        const x0 = W * (0.1 + 0.04 * hash01(seed, 41)), x1 = W * (0.84 - 0.04 * hash01(seed, 42));
        const off = (1 - u) * -W * 0.8;
        g.fillStyle = style === 'break' ? P.a : [P.a, P.a, P.b][v];
        g.fillRect(x0 + off, wy + wh * 0.1, x1 - x0, wh * 0.78);
        if (this.bool('halftone')) this.halftone(g, P.k, seed);
        this.barcode(g, W * 0.03, wy + wh * 0.2, W * 0.02, wh * 0.36, P.k, seed, true);
        this.ticks(g, t, W * 0.95, wy + wh * 0.1, wh * 0.7, P.k, seed);
        break;
      }
      case 'splat': {
        fill(P.b);
        // a big ink stain grows in behind the line at the scene's start
        const u = this.s.reduceMotion ? 1 : easeOutQuint(age / 0.12);
        this.splat(g, W * 0.5, wy + wh * 0.5, Math.min(W, wh) * 0.3 * u, P.k, seed, 1);
        this.splat(g, W * (0.15 + 0.7 * hash01(seed, 51)), wy + wh * (0.2 + 0.6 * hash01(seed, 52)), Math.min(W, wh) * 0.09 * u, P.a, seed + 1, 1);
        break;
      }
      case 'torn': {
        fill(P.d);
        if (this.grain) { g.save(); g.fillStyle = g.createPattern(this.grain as HTMLCanvasElement, 'repeat')!; g.fillRect(-W, wy - H, W * 3, wh + 2 * H); g.restore(); }
        // a white scrap torn off in one corner, then the pink band tearing in across the window
        this.torn(g, W * 0.0, wy + wh * 0.62, W * 0.36, wh * 0.5, -0.18, P.w, seed + 7, 0);
        const u = this.s.reduceMotion ? 1 : easeOutQuint(age / 0.18);
        this.torn(g, W * 0.5 + (1 - u) * W, wy + wh * 0.5, W * 1.3, wh * 0.56, -0.1, P.a, seed, 1);
        break;
      }
    }
    void brk;
  }

  // ---------- foreground (over the bars when it breaks out) ----------
  private foreground(g: Ctx2D, t: number, style: Style | 'break', s: Scene | null, brk: { from: number; to: number; intro: boolean } | null, age: number, seed: number, mask: boolean): void {
    const { W, H, P } = this, wy = this.bar, wh = H - 2 * this.bar, cx = W / 2, cy = wy + wh / 2;
    const antic = this.s.anticipationMs / 1000;
    const brkK = this.num('breakout');
    if (style === 'break' && brk) {
      if (mask) return;
      // LOADING… card (or the title in the intro), with a progress bar that runs to the next vocal
      const p = clamp01((t - brk.from) / Math.max(0.5, brk.to - brk.from));
      const intro = brk.intro && !!this.title;
      const nb = lowerBound(this.a.beats, t + 1e-6);
      const text = intro ? this.title : 'LOADING' + '.'.repeat(nb % 4);
      const unitW = (() => { g.font = font(DISPLAY, sizeForCap(DISPLAY, 100)); return g.measureText(intro ? text : 'LOADING...').width / 100; })();
      const cap = Math.min(wh * (intro ? 0.7 : 0.78) * (1 + 0.12 * brkK), (W * 0.9) / unitW);
      const k = this.punch(age, true);
      g.save(); g.translate(cx, cy); g.scale(k, k); g.translate(-cx, -cy);
      this.type(g, text, W / 2 - (unitW * cap) / 2, cy + cap / 2, cap, P.k, false, age, { split: this.split(age, cap) });
      g.restore();
      if (intro && this.artist) this.tag(g, this.artist, W * 0.06, wy + wh * 0.9, wh * 0.05, P.k, P.w);
      this.progress(g, W * 0.12, wy + wh * 0.93, W * 0.72, Math.max(4, wh * 0.022), p, P.k);
      return;
    }
    if (!s) return;
    const lw = (p: SW) => p.w.start - antic;
    switch (style) {
      case 'mega': {
        // one giant word at a time, taller than the window: it breaks the frame over both bars
        const cur = this.lastLanding(s, t, antic, true) ?? this.lastLanding(s, t, antic);
        const fg = [P.a, P.k, P.b][s.variant];
        if (cur) {
          const p = s.words[cur.i];
          const cap = Math.min(wh * (1 + 0.16 * brkK), (W * 0.9) / Math.max(0.05, p.u));
          const a0 = t - lw(p);
          // the previous giant word smears out over 80 ms
          const prevI = s.words.findIndex((q, i) => i < cur.i && lw(q) <= t && q.w.role !== 'connective' && !q.w.backing && s.words.slice(i + 1, cur.i).every((r) => r.w.role === 'connective' || r.w.backing));
          if (!mask && prevI >= 0 && a0 < 0.08 && !this.s.reduceMotion) {
            const q = s.words[prevI], c2 = Math.min(wh * (1 + 0.16 * brkK), (W * 0.9) / Math.max(0.05, q.u));
            g.save(); g.globalAlpha = 1 - a0 / 0.08; g.translate(cx, cy); g.scale(1 + a0 * 3, 1 + a0 * 3); g.translate(-cx, -cy);
            this.type(g, q.text, cx, cy + c2 / 2, c2, fg, false, 1, { align: 'center' });
            g.restore();
          }
          const k = this.punch(a0, true);
          g.save(); g.translate(cx, cy); g.scale(k, k); g.translate(-cx, -cy);
          this.type(g, p.text, cx, cy + cap / 2, cap, fg, mask, a0, { align: 'center', split: this.split(a0, cap) });
          g.restore();
        }
        if (!mask) { // the whole line so far, in a tag in the lower left
          const done = s.words.filter((p) => lw(p) <= t).map((p) => p.text).join(' ');
          if (done) this.tag(g, done, W * 0.05, wy + wh * 0.9, wh * 0.052, s.variant === 2 ? P.b : P.k, s.variant === 2 ? P.k : P.w);
        }
        break;
      }
      case 'stack': {
        // rows of words on hard-edged blocks that wipe in from the left just before each word lands
        const pad = s.cap * 0.14, x0 = W * 0.09, y0 = cy - (s.rows * s.cap * PITCH) / 2;
        const blocks = [P.a, P.b, P.w];
        s.words.forEach((p, i) => {
          const a0 = t - lw(p);
          if (a0 < -0.1) return;
          const cap = s.cap * p.scale, wd = p.u * cap;
          const x = x0 + p.x + p.row * s.cap * 0.35, top = y0 + p.row * s.cap * PITCH;
          const col = p.hero ? P.a : blocks[(i + s.variant) % 3];
          if (!mask) { g.fillStyle = col; g.fillRect(x - pad, top - pad + (s.cap - cap), (wd + 2 * pad) * clamp01((a0 + 0.1) / 0.1), cap + 2 * pad); }
          if (a0 < 0) return;
          const k = this.punch(a0, p.hero), mx = x + wd / 2, my = top + s.cap - cap / 2;
          g.save(); g.translate(mx, my); g.scale(k, k); g.translate(-mx, -my);
          this.type(g, p.text, x, top + s.cap, cap, col === P.a ? P.w : P.k, mask, a0, { split: p.hero ? this.split(a0, cap) : 0 });
          g.restore();
        });
        break;
      }
      case 'ticker': {
        // marquee rows of the latest strong word run along both edges of the window, half over each bar
        const cur = this.lastLanding(s, t, antic, true) ?? this.lastLanding(s, t, antic);
        if (cur && !mask) {
          const mtext = s.words[cur.i].text + '  ✦  ';
          const cap = Math.min(wh * 0.3, W * 0.2);
          g.font = font(DISPLAY, sizeForCap(DISPLAY, cap));
          const per = Math.max(1, g.measureText(mtext).width);
          const speed = this.s.reduceMotion ? 0 : W * 0.16 * (this.a.bpm / 120);
          const over = this.bar * 0.62 * Math.min(1, brkK);
          for (const [dir, base] of [[-1, wy - over + cap], [1, wy + wh + over]] as const) {
            let x = -((((dir * t * speed) % per) + per) % per) - per;
            for (; x < W; x += per) this.type(g, mtext, x, base, cap, P.a, false, 1, { stroke: P.k, sw: cap * 0.05 });
          }
        }
        // the line itself in the middle, the word being sung in the accent colour
        this.rows(g, s, t, antic, mask, (p, a0, sung) => (sung ? P.a : P.k), (p) => (p.hero ? P.k : undefined));
        break;
      }
      case 'loading': {
        this.rows(g, s, t, antic, mask, () => P.k);
        if (!mask) {
          const p = clamp01((t - s.start) / Math.max(0.3, s.end - s.start));
          this.progress(g, W * 0.12, wy + wh * 0.93, W * 0.72, Math.max(4, wh * 0.022), p, P.k);
        }
        break;
      }
      case 'splat': {
        // ink droplets burst from every hero landing and fly out over the bars
        if (!mask) s.words.forEach((p, i) => {
          if (!p.hero) return;
          const a0 = t - lw(p);
          if (a0 < 0) return;
          const n = 9, R = Math.min(W, wh) * (0.32 + 0.25 * brkK);
          for (let k = 0; k < n; k++) {
            const ang = hash01(s.seed + i * 131, k, 1) * Math.PI * 2, d = R * (0.4 + 0.6 * hash01(s.seed + i * 131, k, 2)) * easeOutQuint(a0 / 0.22);
            const r = Math.min(W, wh) * (0.006 + 0.016 * hash01(s.seed + i * 131, k, 3));
            g.fillStyle = k % 3 ? P.k : P.a;
            g.beginPath(); g.ellipse(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d * 1.5, r * (1 + 1.5 * Math.exp(-a0 / 0.08)), r, ang, 0, Math.PI * 2); g.fill();
          }
        });
        // white type with a black keyline reads on both the lime field and the black stain
        this.rows(g, s, t, antic, mask, (p) => (p.hero ? P.a : P.w), (p) => (p.hero ? P.w : P.k));
        break;
      }
      case 'torn': {
        // the words sit on the torn band, at its angle
        const u = this.s.reduceMotion ? 1 : easeOutQuint(age / 0.18);
        g.save(); g.translate(cx + (1 - u) * W, cy); g.rotate(-0.1); g.translate(-cx, -cy);
        this.rows(g, s, t, antic, mask, (p) => (p.hero ? P.k : P.w));
        g.restore();
        break;
      }
    }
  }

  /** the line as centred rows, each word punching in as it lands */
  private rows(g: Ctx2D, s: Scene, t: number, antic: number, mask: boolean, colour: (p: SW, age: number, sung: boolean) => string, stroke?: (p: SW) => string | undefined): void {
    const { W, H } = this, wy = this.bar, wh = H - 2 * this.bar, cy = wy + wh / 2;
    const y0 = cy - (s.rows * s.cap * PITCH - s.cap * (PITCH - 1)) / 2;
    for (const p of s.words) {
      const a0 = t - (p.w.start - antic);
      if (a0 < 0) continue;
      const cap = s.cap * p.scale, wd = p.u * cap;
      const x = (W - s.rowW[p.row]) / 2 + p.x, base = y0 + p.row * s.cap * PITCH + s.cap;
      const k = this.punch(a0, p.hero), mx = x + wd / 2, my = base - cap / 2;
      const sung = t >= p.w.start - antic && t < p.w.end;
      g.save(); g.translate(mx, my); g.scale(k, k); g.translate(-mx, -my);
      const st = stroke?.(p);
      this.type(g, p.text, x, base, cap, colour(p, a0, sung), mask, a0, { split: p.hero ? this.split(a0, cap) : 0, stroke: st, sw: cap * 0.07 });
      g.restore();
    }
  }

  // ---------- graphic kit ----------
  private tag(g: Ctx2D, text: string, x: number, base: number, cap: number, box: string, ink: string): void {
    g.font = font(LABEL, sizeForCap(LABEL, cap));
    const tw = g.measureText(text).width, k = Math.min(1, (this.W * 0.62) / Math.max(1, tw));
    g.save(); g.translate(x, base); g.scale(k, k);
    g.fillStyle = box; g.fillRect(-cap * 0.5, -cap * 1.45, tw + cap, cap * 1.9);
    g.fillStyle = ink; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(text, 0, 0);
    g.restore();
  }

  private progress(g: Ctx2D, x: number, y: number, w: number, h: number, p: number, c: string): void {
    g.strokeStyle = c; g.lineWidth = Math.max(1.5, h * 0.18); g.strokeRect(x, y, w, h);
    g.fillStyle = c; g.fillRect(x + h * 0.3, y + h * 0.3, (w - h * 0.6) * p, h * 0.4);
    const cap = h * 1.3;
    g.font = font(UI, sizeForCap(UI, cap)); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(`${Math.round(p * 100)}%`, x + w + h * 1.2, y + h);
  }

  private barcode(g: Ctx2D, x: number, y: number, w: number, h: number, c: string, seed: number, vertical: boolean): void {
    g.fillStyle = c;
    let o = 0; const len = vertical ? h : w, th = vertical ? w : h;
    for (let i = 0; o < len; i++) {
      const bw = len * (0.008 + 0.022 * hash01(seed + 61, i)), gap = len * (0.01 + 0.015 * hash01(seed + 62, i));
      if (vertical) g.fillRect(x, y + o, th, Math.min(bw, len - o)); else g.fillRect(x + o, y, Math.min(bw, len - o), th);
      o += bw + gap;
    }
  }

  /** a column of UI ticks; the one on the current beat lights up */
  private ticks(g: Ctx2D, t: number, x: number, y: number, h: number, c: string, seed: number): void {
    const n = 12, bi = lowerBound(this.a.beats, t + 1e-6) - 1;
    for (let i = 0; i < n; i++) {
      const on = ((bi % n) + n) % n === i;
      g.fillStyle = on ? this.P.a : c;
      const w = this.W * (0.008 + (hash01(seed + 71, i) < 0.3 ? 0.01 : 0));
      g.fillRect(x - w / 2, y + (h * i) / n, w, Math.max(2, h / n * 0.45));
    }
  }

  private speedLines(g: Ctx2D, t: number, c: string, alpha: number, seed: number): void {
    const { W, H } = this, wy = this.bar, wh = H - 2 * this.bar;
    const speed = this.s.reduceMotion ? 0 : W * 1.6;
    g.save(); g.fillStyle = c; g.globalAlpha = alpha;
    for (let i = 0; i < 26; i++) {
      const len = W * (0.1 + 0.3 * hash01(seed + 81, i)), y = wy + hash01(seed + 82, i) * wh;
      const x = W - ((((t * speed * (0.6 + hash01(seed + 83, i))) + hash01(seed + 84, i) * W * 2) % (W * 2 + len)));
      g.fillRect(x, y, len, Math.max(1, H * (0.002 + 0.004 * hash01(seed + 85, i))));
    }
    g.restore();
  }

  /** halftone dots growing toward one corner of the window (cached per colour and corner) */
  private halftone(g: Ctx2D, c: string, seed: number): void {
    const corner = Math.floor(hash01(seed, 91) * 4);
    const key = `${c}|${corner}|${this.W}x${this.H}|${this.bar}|${softCanvas()}`;
    let cv = this.halftones.get(key);
    if (!cv) {
      const { W, H } = this, wy = this.bar, wh = H - 2 * this.bar;
      cv = makeCanvas(W, H);
      // software raster when exporting, like the effect's own canvases, so cached art never differs from fresh art
      const hg = cv.getContext('2d', { willReadFrequently: softCanvas() }) as Ctx2D;
      hg.fillStyle = c;
      const step = Math.max(8, Math.round(Math.min(W, H) * 0.018));
      const ox = corner % 2 ? W : 0, oy = corner < 2 ? wy : wy + wh;
      const reach = Math.hypot(W, wh) * 0.42;
      for (let y = wy; y < wy + wh; y += step) for (let x = ((y / step) % 2) * step / 2; x < W; x += step) {
        const d = 1 - Math.hypot(x - ox, y - oy) / reach;
        if (d <= 0) continue;
        hg.beginPath(); hg.arc(x, y, step * 0.48 * d, 0, Math.PI * 2); hg.fill();
      }
      this.halftones.set(key, cv);
    }
    g.save(); g.globalAlpha = 0.28; g.drawImage(cv as HTMLCanvasElement, 0, 0); g.restore();
  }

  /** an ink splat: a lumpy blob with spikes and satellite droplets */
  private splat(g: Ctx2D, x: number, y: number, r: number, c: string, seed: number, alpha: number): void {
    if (r <= 0.5) return;
    g.save(); g.fillStyle = c; g.globalAlpha = alpha;
    g.beginPath();
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2, spike = hash01(seed + 101, i % n) < 0.25 ? 1.35 + 0.5 * hash01(seed + 102, i % n) : 0.82 + 0.2 * hash01(seed + 103, i % n);
      const px = x + Math.cos(a) * r * spike, py = y + Math.sin(a) * r * spike;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.fill();
    for (let i = 0; i < 14; i++) {
      const a = hash01(seed + 104, i) * Math.PI * 2, d = r * (1.3 + 1.1 * hash01(seed + 105, i)), rr = r * (0.03 + 0.09 * hash01(seed + 106, i));
      g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, rr, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  /** a torn paper strip centred on (x, y), rotated, with ragged edges and a white fibre fringe */
  private torn(g: Ctx2D, x: number, y: number, w: number, h: number, rot: number, c: string, seed: number, fringe: number): void {
    g.save(); g.translate(x, y); g.rotate(rot);
    const n = 40, top: number[] = [], bot: number[] = [];
    for (let i = 0; i <= n; i++) { top.push((hash01(seed + 111, i) - 0.5) * h * 0.08); bot.push((hash01(seed + 112, i) - 0.5) * h * 0.08); }
    const path = (grow: number) => {
      g.beginPath();
      for (let i = 0; i <= n; i++) { const px = -w / 2 + (w * i) / n, py = -h / 2 + top[i] - grow; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }
      for (let i = n; i >= 0; i--) g.lineTo(-w / 2 + (w * i) / n, h / 2 + bot[i] + grow);
      g.closePath();
    };
    if (fringe) { path(h * 0.03); g.fillStyle = '#F2EFE8'; g.fill(); }
    path(0); g.fillStyle = c; g.fill();
    g.restore();
  }

  /** a sticker slapped across the window edge so it overlaps a bar */
  private sticker(g: Ctx2D, t: number, s: Scene): void {
    const st = s.sticker!, { W, H, P } = this, wy = this.bar, wh = H - 2 * this.bar;
    const cap = Math.max(10, Math.min(this.bar * 0.42, H * 0.045, W * 0.03));
    const age = t - st.t;
    const k = this.s.reduceMotion ? 1 : 1 + 0.7 * (1 - easeOutQuint(age / 0.12));
    const x = st.corner % 2 ? W * 0.84 : W * 0.16, y = st.corner < 2 ? wy : wy + wh;
    const rot = (hash01(s.seed, 7) - 0.5) * 0.26;
    const [box, ink] = [[P.b, P.k], [P.a, P.w], [P.w, P.k]][st.tone];
    g.save();
    g.font = font(LABEL, sizeForCap(LABEL, cap));
    const tw = g.measureText(st.text).width, bw = tw + cap * 1.3, bh = cap * 2.1;
    const room = W / 2 - (bw / 2 + cap) * k;
    g.translate(Math.max(W / 2 - room, Math.min(W / 2 + room, x)), y); g.rotate(rot); g.scale(k, k);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-bw / 2 + cap * 0.15, -bh / 2 + cap * 0.2, bw, bh);
    g.fillStyle = P.w; g.fillRect(-bw / 2 - cap * 0.14, -bh / 2 - cap * 0.14, bw + cap * 0.28, bh + cap * 0.28);
    g.fillStyle = box; g.fillRect(-bw / 2, -bh / 2, bw, bh);
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(st.text, 0, cap * 0.05);
    g.restore();
  }

  /** UI on the bars: title, section and beat light on top; barcode, timecode, phrase squares and BPM below */
  private chrome(g: Ctx2D, t: number, s: Scene | null, brk: { from: number } | null): void {
    const { W, H, P } = this, bar = this.bar;
    const cap = Math.max(7, Math.min(bar * 0.2, W * 0.0125, 16));
    g.save();
    g.font = font(UI, sizeForCap(UI, cap)); g.textBaseline = 'middle';
    g.fillStyle = P.w; g.globalAlpha = 0.85;
    const labelX = W * 0.97 - cap * 2, labelW = 0;
    // the title takes what is left of the top bar, cut with an ellipsis
    let head = this.title ? `▶ ${this.title}${this.artist ? ' — ' + this.artist : ''}` : '▶ BREAKOUT';
    const room = labelX - labelW - cap * 2 - W * 0.03;
    while (head.length > 3 && g.measureText(head).width > room) head = head.slice(0, -2) + '…';
    g.textAlign = 'left';
    g.fillText(head, W * 0.03, bar / 2);
    const on = this.beatPulse(t, 9) > 0.4;
    g.globalAlpha = 1; g.fillStyle = on ? P.a : '#444';
    g.beginPath(); g.arc(W * 0.97 - cap * 0.6, bar / 2, cap * 0.45, 0, Math.PI * 2); g.fill();
    // bottom bar
    const yb = H - bar / 2;
    g.globalAlpha = 0.85;
    const bcW = Math.min(bar * 2.2, W * 0.16), bcH = Math.min(bar * 0.36, cap * 1.6);
    this.barcode(g, W * 0.03, yb - bcH / 2, bcW, bcH, P.w, 4242, false);
    const f = Math.floor(t * 30), mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    const tc = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(f % 30).padStart(2, '0')}`;
    g.fillStyle = P.w; g.textAlign = 'left';
    const tcX = W * 0.03 + bcW + cap * 1.2;
    g.fillText(tc, tcX, yb);
    const bpm = `${Math.round(this.a.bpm)} BPM`, bpmW = g.measureText(bpm).width;
    g.textAlign = 'right';
    g.fillText(bpm, W * 0.97, yb);
    // phrase squares between them, when there is room
    const meter = this.a.meter, di = lowerBound(this.a.downbeats, t + 1e-6) - 1;
    const inBar = di >= 0 ? lowerBound(this.a.beats, t + 1e-6) - lowerBound(this.a.beats, this.a.downbeats[di] - 1e-3) : 0;
    const filled = di >= 0 ? (di % 4) * meter + Math.max(1, inBar) : 0;
    const n = 4 * meter, sq = cap * 0.9, x0 = W * 0.97 - bpmW - cap * 1.5 - n * sq * 1.5;
    if (x0 > tcX + g.measureText(tc).width + cap * 1.5)
      for (let i = 0; i < n; i++) { g.fillStyle = i < filled ? (i === filled - 1 ? P.a : P.w) : '#333'; g.fillRect(x0 + i * sq * 1.5, yb - sq / 2, sq, sq); }
    g.restore();
  }
}
registerEffect(Breakout);

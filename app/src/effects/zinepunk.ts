// ZINE PUNK — a hand-made 2000s pop-punk zine in lemon yellow, jade, ink black and paper white, animated "on twos".
// Words are stamped on torn paper scraps with a jade misprint and land with a smear frame; impacts flood the yellow
// field into jade-and-black lotus tiles; a floral plane rotates behind choruses; spinning jade discs, brush X's, tape
// strips, hand-drawn stars and crosses, ink splats and photocopy grain boil on twos; comic hits burst on the kick drum
// (BAM! POW! 叩 炸 轰 砰); section changes fire a jade shockwave; the last line locks up as a magazine cover.
// Reduce motion: no boil, smears, shake or bursts' scale pops; the floral plane stops turning.
import { Canvas2DEffect, type EffectContext, type EffectMeta, range, toggle, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { maskFill } from './common.ts';
import { type Ctx2D, clamp01, easeOutCubic, subtitle, lineAt } from '../render/textkit.ts';
import { font, sizeForCap } from '../render/sdf.ts';
import { hash01, sample } from '../analysis/dsp.ts';
import { type Tok, type Fit, tokens, fit, landed, sceneClock, impact, helperCanvas } from './kit2d.ts';

const Z = { lemon: '#FFE21A', jade: '#13A86C', lime: '#8EDB1F', ink: '#0B0B0B', paper: '#FAF7EE', mint: '#6FFFE0', tape: 'rgba(236,224,190,0.85)' };
const HITS = ['BAM!', 'POW!', 'WHAM!', 'BOOM!', 'SMASH!', '叩', '炸', '轰', '砰', '嘭', '啪'];
const TYPE = 'rubik';
type Bg = 'floor' | 'flood' | 'plane' | 'copy';
interface Scene { bg: Bg; seed: number; toks: Tok[]; f: Fit; start: number; end: number; first: boolean; cover: boolean }

export class ZinePunk extends Canvas2DEffect {
  static meta: EffectMeta = {
    id: 'zinepunk', name: 'Zine Punk', kind: '2d',
    description: 'Hand-made pop-punk zine on twos: stamped torn-paper words, lotus tile floods, jade discs, brush X’s, tape and comic hits on the kick drum.',
    affinity: aff(0.9, 0.3, 0.45, 0.7, 0.5, 0.35, 0.95, 0.9),
    supportsTransparent: false, ownsTitle: true,
    params: [
      range('hits', 'Comic hits', 'Graphics', 1, 0, 2, 0.01, false, 'how many kick drums get a BAM'),
      toggle('chinese', 'Chinese sound words', 'Graphics', true, false),
      range('boil', 'Boil', 'Motion', 1, 0, 2, 0.01),
    ],
  };
  readonly meta = ZinePunk.meta;
  private scenes: Scene[] = [];
  private hits: { t: number; text: string; x: number; y: number; k: number }[] = [];
  private grain: HTMLCanvasElement | OffscreenCanvas | null = null;
  private title = '';

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const { W, H } = this, ly = this.ly, a = this.a;
    this.title = (this.s.title || ly.meta?.title || '').toUpperCase();
    this.scenes = ly.lines.map((line, li) => {
      const label = a.sections[line.section]?.label ?? 'verse';
      const toks = tokens(ly, line, this.s, TYPE);
      const cover = li === ly.lines.length - 1 && ly.lines.length > 2;
      const f = fit(toks, W * (cover ? 0.86 : 0.78), H * (cover ? 0.72 : 0.5), cover ? 4 : 3, 1.32, 0.3);
      const loud = label === 'chorus' || label === 'drop';
      const bg: Bg = loud ? (hash01(this.seed, li, 1) < 0.5 ? 'flood' : 'plane') : (['floor', 'copy', 'floor'] as Bg[])[Math.floor(hash01(this.seed, li, 2) * 3)];
      return { bg, seed: (this.seed * 7919 + li * 104729) >>> 0, toks, f, start: line.start, end: line.end, first: li === 0 || ly.lines[li - 1].section !== line.section, cover };
    });
    // comic hits on strong kick drums, at most one every 0.55 s
    this.hits = [];
    const want = this.num('hits');
    if (want > 0) {
      let last = -1;
      a.onsets.forEach((t, i) => {
        if (a.onsetStrength[i] < 1.05 - 0.2 * want || sample(a.bands.bass, t + 0.03) < 0.62 - 0.08 * want || t - last < 0.55 / want) return;
        last = t;
        const pool = this.bool('chinese') ? HITS : HITS.filter((h) => /^[A-Z!]+$/.test(h));
        const k = this.hits.length;
        // in the top or bottom band, towards a side, so a burst never covers the lyrics
        const side = hash01(this.seed, k, 3) < 0.5 ? 0.14 : 0.86, band = hash01(this.seed, k, 6) < 0.5 ? 0.15 : 0.85;
        this.hits.push({ t, text: pool[Math.floor(hash01(this.seed, k, 4) * pool.length)], x: W * (side + (hash01(this.seed, k, 5) - 0.5) * 0.08), y: H * band, k });
      });
    }
    // photocopy grain
    const gr = helperCanvas(256, 256);
    for (let i = 0; i < 3800; i++) { gr.g.fillStyle = `rgba(0,0,0,${0.04 + hash01(i, 7) * 0.12})`; gr.g.fillRect(hash01(i, 8) * 256, hash01(i, 9) * 256, 1 + hash01(i, 10) * 2, 1 + hash01(i, 11) * 1.5); }
    this.grain = gr.c;
  }

  private get reduce(): boolean { return this.s.reduceMotion; }
  /** pose index on twos (12 poses per second) */
  private pose(t: number): number { return Math.floor(t * 12 + 1e-6); }
  private boil(seed: number, t: number, k: number, amp: number): number { return this.reduce ? 0 : (hash01(seed, this.pose(t), k) - 0.5) * 2 * amp * this.num('boil'); }

  protected draw(t: number, g: Ctx2D, mask: boolean): void {
    const { W, H } = this, ly = this.ly;
    const tp = this.pose(t) / 12; // the whole zine moves on twos
    const antic = this.s.anticipationMs / 1000, lead = antic + 0.05;
    const ck = sceneClock(ly, tp, lead, this.a.duration);
    const sc = ck.brk ? null : this.scenes[ck.li];
    // shake on comic hits and landings
    let sx = 0, sy = 0;
    if (!this.reduce) {
      const hit = this.hits.filter((h) => h.t <= tp).pop();
      [sx, sy] = impact(tp, hit?.t, hit?.k ?? 0, H * 0.012 * this.camEnergy, (a, b) => hash01(a, b, 12));
    }
    g.save(); g.translate(sx, sy);
    if (!mask) this.background(g, tp, sc, ck.age);
    if (!mask) this.decor(g, tp, sc);
    if (sc) this.words(g, tp, sc, antic, mask);
    else if (!mask && ck.brk?.intro && this.title) this.cover(g, tp, [this.title], ck.age);
    if (!mask) this.comicHits(g, tp);
    if (!mask && sc && sc.first) this.shockwave(g, tp, sc.start - lead);
    g.restore();
    if (!mask && this.grain) { g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.5; g.fillStyle = g.createPattern(this.grain as HTMLCanvasElement, 'repeat')!; g.translate((this.pose(t) % 4) * 37, (this.pose(t) % 3) * 53); g.fillRect(-200, -200, W + 400, H + 400); g.restore(); }
    if (!mask) subtitle(g, ly.lines[lineAt(ly, t)], t, this.s, W, H, '#fff');
  }

  // ---------- background ----------
  private background(g: Ctx2D, t: number, s: Scene | null, age: number): void {
    const { W, H } = this;
    g.fillStyle = Z.lemon; g.fillRect(-40, -40, W + 80, H + 80);
    if (!s) return;
    const tile = Math.max(40, H / 4.5);
    if (s.bg === 'floor') { // checker slides
      const off = this.reduce ? 0 : (t * tile * 1.2) % (tile * 2);
      g.fillStyle = 'rgba(19,168,108,0.16)';
      for (let y = -tile; y < H + tile; y += tile) for (let x = -tile * 2; x < W + tile * 2; x += tile) if (((x / tile + y / tile) & 1) === 0) g.fillRect(x + off * ((y / tile) & 1 ? 1 : -1), y, tile, tile);
    } else if (s.bg === 'flood') { // a stomp floods the field into jade and black lotus tiles
      const ox = W * (0.2 + 0.6 * hash01(s.seed, 13)), oy = H * 0.92;
      const r = (this.reduce ? 10 : age) * W * 2.2;
      for (let y = 0; y < H + tile; y += tile) for (let x = 0; x < W + tile; x += tile) {
        const d = Math.hypot(x + tile / 2 - ox, y + tile / 2 - oy);
        if (d > r) continue;
        const dark = ((x / tile) + (y / tile)) % 2 === 0;
        g.fillStyle = dark ? Z.ink : Z.jade; g.fillRect(x, y, tile + 1, tile + 1);
        g.strokeStyle = dark ? Z.jade : Z.ink; g.lineWidth = Math.max(1.5, tile * 0.03);
        this.lotus(g, x + tile / 2, y + tile * 0.6, tile * 0.36);
      }
    } else if (s.bg === 'plane') { // a giant floral plane rotating behind the type
      g.fillStyle = Z.lime; g.fillRect(-40, -40, W + 80, H + 80);
      g.save(); g.translate(W / 2, H * 0.55); g.rotate(this.reduce ? 0.2 : t * 0.6);
      g.strokeStyle = Z.jade; g.lineWidth = Math.max(2, H * 0.006);
      for (let ring = 1; ring <= 3; ring++) for (let i = 0; i < 6 * ring; i++) { const a = (i / (6 * ring)) * Math.PI * 2, r = ring * H * 0.28; this.lotus(g, Math.cos(a) * r, Math.sin(a) * r, H * 0.09); }
      g.strokeStyle = Z.ink; g.lineWidth = Math.max(3, H * 0.012); this.lotus(g, 0, H * 0.06, H * 0.2);
      g.restore();
    } else { // photocopied paper with black brush X's
      g.fillStyle = Z.paper; g.fillRect(-40, -40, W + 80, H + 80);
      for (let i = 0; i < 3; i++) this.brushX(g, W * (0.15 + 0.7 * hash01(s.seed, i, 14)), H * (0.2 + 0.6 * hash01(s.seed, i, 15)), H * 0.12, Z.ink, s.seed + i, t);
    }
  }

  /** lotus line-art: outer petals, inner petals and a base arc (stroked with the current style) */
  private lotus(g: Ctx2D, x: number, y: number, r: number): void {
    g.save(); g.translate(x, y); g.beginPath();
    for (const [a, len, wid] of [[-1.1, 0.8, 0.32], [-0.55, 0.95, 0.34], [0, 1, 0.36], [0.55, 0.95, 0.34], [1.1, 0.8, 0.32]] as const) {
      g.save(); g.rotate(a); g.moveTo(0, 0); g.bezierCurveTo(-r * wid, -r * len * 0.4, -r * wid * 0.6, -r * len * 0.85, 0, -r * len); g.bezierCurveTo(r * wid * 0.6, -r * len * 0.85, r * wid, -r * len * 0.4, 0, 0); g.restore();
    }
    g.moveTo(-r * 0.8, r * 0.05); g.quadraticCurveTo(0, r * 0.38, r * 0.8, r * 0.05);
    g.stroke(); g.restore();
  }

  private brushX(g: Ctx2D, x: number, y: number, r: number, c: string, seed: number, t: number): void {
    g.save(); g.translate(x + this.boil(seed, t, 1, r * 0.03), y + this.boil(seed, t, 2, r * 0.03)); g.rotate(this.boil(seed, t, 3, 0.04));
    g.fillStyle = c;
    for (const sgn of [-1, 1]) {
      g.beginPath(); g.moveTo(-r, sgn * -r * 0.95); g.quadraticCurveTo(0, sgn * r * 0.1, r, sgn * r); g.lineTo(r * 0.82, sgn * r * 1.08); g.quadraticCurveTo(-r * 0.1, sgn * r * 0.22, -r * 1.05, sgn * -r * 0.8); g.closePath(); g.fill();
    }
    g.restore();
  }

  // ---------- decorations (boil on twos) ----------
  private decor(g: Ctx2D, t: number, s: Scene | null): void {
    const { W, H } = this, seed = s?.seed ?? 99;
    // spinning jade discs
    for (let i = 0; i < 3; i++) {
      const x = W * (0.08 + 0.84 * hash01(seed, i, 21)), y = H * (0.12 + 0.76 * hash01(seed, i, 22)), r = H * (0.04 + 0.05 * hash01(seed, i, 23));
      const sq = this.reduce ? 1 : Math.abs(Math.cos(t * 3 + i));
      g.save(); g.translate(x, y); g.scale(Math.max(0.15, sq), 1);
      g.fillStyle = Z.jade; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.arc(0, 0, r * 0.35, 0, Math.PI * 2, true); g.fill('evenodd');
      g.strokeStyle = Z.ink; g.lineWidth = Math.max(1.5, r * 0.08); g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
      g.restore();
    }
    // hand-drawn stars and crosses
    g.strokeStyle = Z.ink; g.lineWidth = Math.max(2, H * 0.006); g.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const x = W * hash01(seed, i, 24), y = H * hash01(seed, i, 25), r = H * (0.02 + 0.025 * hash01(seed, i, 26));
      const j = (k: number) => this.boil(seed + i, t, k, r * 0.12);
      g.beginPath();
      if (i % 2) { g.moveTo(x - r + j(1), y - r + j(2)); g.lineTo(x + r + j(3), y + r + j(4)); g.moveTo(x + r + j(5), y - r + j(6)); g.lineTo(x - r + j(7), y + r + j(8)); }
      else for (let k = 0; k <= 10; k++) { const a = (k / 10) * Math.PI * 2 - Math.PI / 2, rr = k % 2 ? r * 0.45 : r; const px = x + Math.cos(a) * rr + j(k), py = y + Math.sin(a) * rr + j(k + 11); if (k) g.lineTo(px, py); else g.moveTo(px, py); }
      g.stroke();
    }
    // tape strips at two corners
    for (let i = 0; i < 2; i++) {
      g.save(); g.translate(i ? W * 0.9 : W * 0.1, i ? H * 0.88 : H * 0.1); g.rotate((i ? 0.6 : -0.6) + this.boil(seed, t, 30 + i, 0.03));
      g.fillStyle = Z.tape; g.fillRect(-H * 0.12, -H * 0.025, H * 0.24, H * 0.05); g.restore();
    }
    // a few ink splats
    for (let i = 0; i < 2; i++) this.splat(g, W * (0.1 + 0.8 * hash01(seed, i, 27)), H * (0.1 + 0.8 * hash01(seed, i, 28)), H * 0.035, seed + i);
  }

  private splat(g: Ctx2D, x: number, y: number, r: number, seed: number): void {
    g.fillStyle = Z.ink; g.beginPath();
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2, rr = r * (hash01(seed, i % 16, 31) < 0.3 ? 1.6 : 0.85); if (i) g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.fill();
    for (let i = 0; i < 6; i++) { const a = hash01(seed, i, 32) * Math.PI * 2, d = r * (1.8 + hash01(seed, i, 33) * 1.4); g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.15, 0, Math.PI * 2); g.fill(); }
  }

  // ---------- words: stamped on torn paper ----------
  private words(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean): void {
    if (s.cover) { this.cover(g, t, s.toks.filter((p) => t >= p.w.start - antic).map((p) => p.text), t - (s.start - antic), s, antic, mask); return; }
    const { W, H } = this, f = s.f;
    const y0 = H * 0.5 - (f.rows * f.cap * 1.32 - f.cap * 0.32) / 2;
    s.toks.forEach((p, i) => {
      const a0 = t - (p.w.start - antic);
      if (a0 < -1 / 12) return;
      const cap = f.cap * p.scale, wd = p.u * cap;
      const x = W / 2 - f.rowW[p.row] / 2 + p.x, base = y0 + p.row * f.cap * 1.32 + f.cap;
      const rot = (hash01(s.seed, i, 41) - 0.5) * 0.12 + this.boil(s.seed + i, t, 42, 0.012);
      // smear on the pose before the landing, a squash on it, then settle
      let sxx = 1, syy = 1, ox = 0;
      if (!this.reduce) {
        if (a0 < 0) { sxx = 1.5; syy = 0.8; ox = -(wd * 0.25); }
        else if (a0 < 1 / 12) { sxx = 1.12; syy = 0.9; }
      }
      g.save(); g.translate(x + wd / 2 + ox, base - cap / 2); g.rotate(rot); g.scale(sxx, syy); g.translate(-(x + wd / 2), -(base - cap / 2));
      if (!mask) {
        // torn paper scrap (yellow or white), then a jade misprint, then the black stamp
        const pad = cap * 0.22, paper = p.hero ? Z.paper : i % 3 === 1 ? Z.paper : '#FFF06A';
        g.fillStyle = 'rgba(0,0,0,0.25)'; this.scrap(g, x - pad + cap * 0.05, base - cap - pad + cap * 0.07, wd + pad * 2, cap + pad * 2, s.seed + i); g.fill();
        g.fillStyle = paper; this.scrap(g, x - pad, base - cap - pad, wd + pad * 2, cap + pad * 2, s.seed + i); g.fill();
      }
      g.font = font(TYPE, sizeForCap(TYPE, cap)); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      if (mask) { g.fillStyle = maskFill(a0); g.fillText(p.text, x, base); }
      else {
        g.fillStyle = Z.jade; g.fillText(p.text, x + cap * 0.06, base + cap * 0.05);
        if (p.hero) { g.strokeStyle = Z.jade; g.lineWidth = cap * 0.09; g.lineJoin = 'round'; g.strokeText(p.text, x, base); }
        g.fillStyle = Z.ink; g.fillText(p.text, x, base);
      }
      g.restore();
    });
  }

  /** a torn-paper rectangle path with ragged edges */
  private scrap(g: Ctx2D, x: number, y: number, w: number, h: number, seed: number): void {
    const n = Math.max(6, Math.round(w / (h * 0.25)));
    g.beginPath();
    for (let i = 0; i <= n; i++) g.lineTo(x + (w * i) / n, y + (hash01(seed, i, 51) - 0.5) * h * 0.12);
    for (let i = 0; i <= 4; i++) g.lineTo(x + w + (hash01(seed, i, 52) - 0.5) * h * 0.1, y + (h * i) / 4);
    for (let i = n; i >= 0; i--) g.lineTo(x + (w * i) / n, y + h + (hash01(seed, i, 53) - 0.5) * h * 0.12);
    for (let i = 4; i >= 0; i--) g.lineTo(x + (hash01(seed, i, 54) - 0.5) * h * 0.1, y + (h * i) / 4);
    g.closePath();
  }

  /** the magazine-cover lock-up: big stacked type with stars, lotus line-art and X's */
  private cover(g: Ctx2D, t: number, texts: string[], age: number, s?: Scene, antic = 0, mask = false): void {
    const { W, H } = this;
    if (!mask) {
      g.fillStyle = Z.lemon; g.fillRect(-40, -40, W + 80, H + 80);
      g.strokeStyle = Z.jade; g.lineWidth = Math.max(2, H * 0.008); this.lotus(g, W * 0.82, H * 0.62, H * 0.32);
      this.brushX(g, W * 0.12, H * 0.8, H * 0.1, Z.ink, 7, t);
      g.fillStyle = Z.paper; for (let i = 0; i < 7; i++) this.star(g, W * hash01(i, 61), H * hash01(i, 62), H * (0.015 + 0.02 * hash01(i, 63)));
    }
    if (!texts.length) return;
    const n = texts.length, rowH = (H * 0.84) / Math.max(2, n);
    texts.forEach((text, r) => {
      const cap = rowH * 0.8;
      g.save();
      g.font = font(TYPE, sizeForCap(TYPE, cap)); g.textBaseline = 'alphabetic'; g.textAlign = 'left';
      const tw = g.measureText(text).width, k = Math.min(1.6, (W * 0.8) / Math.max(1, tw));
      g.translate(W * 0.08, H * 0.1 + r * rowH + cap); g.rotate(-0.04); g.scale(k, 1);
      const p = s?.toks.find((q) => q.text === text);
      const a0 = p ? t - (p.w.start - antic) : age;
      if (mask) { g.fillStyle = maskFill(a0); g.fillText(text, 0, 0); }
      else { g.fillStyle = Z.jade; g.fillText(text, cap * 0.06, cap * 0.06); g.fillStyle = r % 2 ? Z.ink : Z.paper; g.strokeStyle = Z.ink; g.lineWidth = cap * 0.06; if (!(r % 2)) g.strokeText(text, 0, 0); g.fillText(text, 0, 0); }
      g.restore();
    });
  }

  private star(g: Ctx2D, x: number, y: number, r: number): void {
    g.beginPath(); for (let k = 0; k <= 10; k++) { const a = (k / 10) * Math.PI * 2 - Math.PI / 2, rr = k % 2 ? r * 0.42 : r; if (k) g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.closePath(); g.fill(); g.strokeStyle = Z.ink; g.lineWidth = Math.max(1, r * 0.15); g.stroke();
  }

  /** comic sound words in jagged bursts on strong kick drums */
  private comicHits(g: Ctx2D, t: number): void {
    const { H } = this;
    for (const h of this.hits) {
      const a0 = t - h.t;
      if (a0 < 0 || a0 > 0.42) continue;
      const k = this.reduce ? 1 : a0 < 1 / 12 ? 1.35 : 1;
      const r = Math.min(H * 0.11, this.W * 0.13);
      g.save(); g.translate(Math.max(r * 1.5, Math.min(this.W - r * 1.5, h.x)), h.y); g.rotate((hash01(h.k, 71) - 0.5) * 0.4); g.scale(k, k);
      g.globalAlpha = a0 > 0.33 ? 1 - (a0 - 0.33) / 0.09 : 1;
      g.fillStyle = h.k % 2 ? Z.paper : Z.mint; g.strokeStyle = Z.ink; g.lineWidth = Math.max(2, H * 0.006);
      g.beginPath();
      for (let i = 0; i <= 18; i++) { const a = (i / 18) * Math.PI * 2, rr = r * (i % 2 ? 0.62 : 1) * (0.9 + 0.2 * hash01(h.k, i, 72)); if (i) g.lineTo(Math.cos(a) * rr * 1.4, Math.sin(a) * rr); else g.moveTo(Math.cos(a) * rr * 1.4, Math.sin(a) * rr); }
      g.closePath(); g.fill(); g.stroke();
      const cjk = !/^[A-Z!]+$/.test(h.text);
      const key = cjk ? 'comic' : TYPE, cap = cjk ? r * 0.9 : r * 0.5;
      g.font = cjk ? font(key, r * 1.05) : font(key, sizeForCap(key, cap));
      g.textAlign = 'center'; g.textBaseline = cjk ? 'middle' : 'alphabetic';
      g.fillStyle = Z.jade; g.fillText(h.text, r * 0.05, cjk ? r * 0.05 : cap / 2 + r * 0.05);
      g.fillStyle = Z.ink; g.fillText(h.text, 0, cjk ? 0 : cap / 2);
      g.restore();
    }
  }

  /** a jade shockwave ring at a section change */
  private shockwave(g: Ctx2D, t: number, t0: number): void {
    const a0 = t - t0;
    if (a0 < 0 || a0 > 0.6 || this.reduce) return;
    const { W, H } = this, u = easeOutCubic(a0 / 0.6);
    g.save(); g.strokeStyle = Z.jade; g.globalAlpha = 1 - u; g.lineWidth = H * 0.03 * (1 - u) + 2;
    g.beginPath(); g.ellipse(W / 2, H * 0.92, W * 0.9 * u, H * 0.5 * u, 0, 0, Math.PI * 2); g.stroke(); g.restore();
    void clamp01; void landed;
  }
}
registerEffect(ZinePunk);

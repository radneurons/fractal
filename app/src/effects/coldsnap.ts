// COLD SNAP — an ice-cold motion-graphics trailer in type: every lyric line is a different cut. A lightning slash rips
// the frame and sprays shards while a barcode races and snaps; letters burst out of a tunnel of nested rectangles; a
// rotating block of type shatters into streaking fragments; diagonal colour fields wipe while a giant word scrolls the
// other way; a tower of words sheds letters and topples; a word drops onto a white card and springs like a trampoline;
// outlined type rolls 360° with stroboscopic ghosts; a word barrage slams one word per beat; isometric cubes tumble while
// a reticle locks on; flat poster planes peel away; rapid-fire cards cut on every word; a shockwave of rings blasts
// out; the song's last line resolves into an identity card. Ice blue, cobalt, white, silver, black.
// Reduce motion: no shake, split, strobe ghosts or flashes; spins and drops become cuts.
import { Canvas2DEffect, type EffectContext, type EffectMeta, range, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { type Ctx2D, clamp01, easeOutQuint, easeOutCubic, easeInCubic, subtitle, lineAt } from '../render/textkit.ts';
import { hash01, lowerBound } from '../analysis/dsp.ts';
import { type Tok, type Fit, tokens, fit, landed, punch, drawText, sceneClock, impact, unit } from './kit2d.ts';

type Cut = 'slash' | 'tunnel' | 'block' | 'diagonal' | 'stack' | 'drop' | 'chevron' | 'barrage' | 'cubes' | 'posters' | 'cards' | 'shockwave' | 'identity';
const ORDER: Cut[] = ['slash', 'tunnel', 'block', 'diagonal', 'stack', 'drop', 'chevron', 'barrage', 'cubes', 'posters', 'cards', 'shockwave'];
interface Pal { ice: string; cobalt: string; white: string; silver: string; black: string }
const PALS: Record<string, Pal> = {
  Ice: { ice: '#9FE6FF', cobalt: '#1D3FD8', white: '#F5F9FF', silver: '#B8C0CA', black: '#06080C' },
  Ember: { ice: '#FFB25C', cobalt: '#D8321D', white: '#FFF8F0', silver: '#C9BDB3', black: '#0C0706' },
  Mint: { ice: '#8CFFD2', cobalt: '#0E7C66', white: '#F4FFFA', silver: '#BBC9C3', black: '#050B09' },
};
interface Scene { cut: Cut; seed: number; toks: Tok[]; f: Fit; hero: number; start: number; end: number; next: number }

export class ColdSnap extends Canvas2DEffect {
  static meta: EffectMeta = {
    id: 'coldsnap', name: 'Cold Snap', kind: '2d',
    description: 'Ice-cold motion-graphics trailer: every line a different cut — lightning slash, type tunnel, shattering blocks, toppling word towers, trampoline drops, tumbling cubes, peeling posters, shockwaves.',
    affinity: aff(0.9, 0.4, 0.45, 0.6, 0.6, 0.6, 0.55, 0.9),
    supportsTransparent: false, ownsTitle: true,
    params: [
      select('palette', 'Palette', 'Look', 'Ice', ['Ice', 'Ember', 'Mint']),
      range('shake', 'Impact shake', 'Motion', 1, 0, 2, 0.01),
      range('split', 'Chromatic split', 'Motion', 1, 0, 2, 0.01),
    ],
  };
  readonly meta = ColdSnap.meta;
  private scenes: Scene[] = [];
  private P: Pal = PALS.Ice;
  private title = '';

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const { W, H } = this, ly = this.ly;
    this.P = PALS[this.str('palette')] ?? PALS.Ice;
    this.title = (this.s.title || ly.meta?.title || '').toUpperCase();
    this.scenes = [];
    let k = Math.floor(hash01(this.seed, 3) * ORDER.length);
    ly.lines.forEach((line, li) => {
      const toks = tokens(ly, line, this.s, 'bebas');
      const rep = line.repeatOf !== undefined ? this.scenes[line.repeatOf] : undefined;
      // every new line is the next cut in the sequence; repeats reuse their cut; the last line is the identity card
      const cut: Cut = li === ly.lines.length - 1 && ly.lines.length > 2 ? 'identity' : rep ? rep.cut : ORDER[k++ % ORDER.length];
      let hero = toks.findIndex((p) => p.hero);
      if (hero < 0) hero = toks.reduce((b, p, i) => (p.text.length > toks[b].text.length ? i : b), 0);
      const box = cut === 'identity' ? [0.8, 0.5, 3] : cut === 'stack' ? [0.5, 0.82, 8] : cut === 'diagonal' ? [0.5, 0.3, 3] : cut === 'posters' ? [0.8, 0.62, 3] : [0.82, 0.56, 3];
      const f = fit(toks, W * box[0], H * box[1], box[2]);
      this.scenes.push({ cut, seed: (this.seed * 7919 + li * 104729) >>> 0, toks, f, hero, start: line.start, end: line.end, next: ly.lines[li + 1]?.start ?? Infinity });
    });
  }

  private get reduce(): boolean { return this.s.reduceMotion; }
  private split(age: number, cap: number): number { return this.reduce || age < 0 ? 0 : cap * 0.05 * this.num('split') * Math.exp(-age / 0.09); }
  private txt(g: Ctx2D, text: string, x: number, y: number, cap: number, fill: string, mask: boolean, age: number, o: Parameters<typeof drawText>[8] = {}): void {
    drawText(g, text, x, y, cap, fill, mask, age, { splitA: this.P.ice, splitB: this.P.cobalt, ...o });
  }

  protected draw(t: number, g: Ctx2D, mask: boolean): void {
    const { W, H, P } = this, ly = this.ly;
    const antic = this.s.anticipationMs / 1000, lead = antic + 0.05;
    const ck = sceneClock(ly, t, lead, this.a.duration);
    const sc = ck.brk ? null : this.scenes[ck.li];
    // impact shake on landings
    let sx = 0, sy = 0;
    if (sc && !this.reduce) {
      const l = landed(sc.toks, t, antic);
      if (l && ['slash', 'barrage', 'drop', 'shockwave', 'cards', 'block'].includes(sc.cut)) [sx, sy] = impact(t, l.t, l.i + sc.seed, H * 0.014 * this.num('shake') * this.camEnergy, (a, b) => hash01(a, b, 5));
    }
    g.save(); g.translate(sx, sy);
    if (!sc) this.breakCard(g, t, ck.age, ck.brk!.intro, mask);
    else switch (sc.cut) {
      case 'slash': this.slash(g, t, sc, antic, mask, ck.age); break;
      case 'tunnel': this.tunnel(g, t, sc, antic, mask); break;
      case 'block': this.block(g, t, sc, antic, mask); break;
      case 'diagonal': this.diagonal(g, t, sc, antic, mask, ck.age); break;
      case 'stack': this.stack(g, t, sc, antic, mask); break;
      case 'drop': this.drop(g, t, sc, antic, mask); break;
      case 'chevron': this.chevron(g, t, sc, antic, mask); break;
      case 'barrage': this.barrage(g, t, sc, antic, mask); break;
      case 'cubes': this.cubes(g, t, sc, antic, mask); break;
      case 'posters': this.posters(g, t, sc, antic, mask); break;
      case 'cards': this.cards(g, t, sc, antic, mask); break;
      case 'shockwave': this.shockwave(g, t, sc, antic, mask); break;
      case 'identity': this.identity(g, t, sc, antic, mask, ck.age); break;
    }
    g.restore();
    if (!mask) subtitle(g, ly.lines[lineAt(ly, t)], t, this.s, W, H, '#fff');
    void P;
  }

  private fill(g: Ctx2D, c: string, mask: boolean): void { if (!mask) { g.fillStyle = c; g.fillRect(-40, -40, this.W + 80, this.H + 80); } }

  /** the line as centred rows; every word punches in with a chromatic split as it lands */
  private rows(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean, colour: (p: Tok, i: number) => string, cy = this.H / 2, f = s.f, cx = this.W / 2): void {
    const y0 = cy - (f.rows * f.cap * 1.16 - f.cap * 0.16) / 2;
    s.toks.forEach((p, i) => {
      const a0 = t - (p.w.start - antic);
      if (a0 < 0) return;
      const cap = f.cap * p.scale, wd = p.u * cap;
      const x = cx - f.rowW[p.row] / 2 + p.x, base = y0 + p.row * f.cap * 1.16 + f.cap;
      const k = punch(a0, this.reduce, p.hero ? 1.2 : 0.8);
      g.save(); g.translate(x + wd / 2, base - cap / 2); g.scale(k, k); g.translate(-(x + wd / 2), -(base - cap / 2));
      this.txt(g, p.text, x, base, cap, colour(p, i), mask, a0, { split: this.split(a0, cap) });
      g.restore();
    });
  }

  // ---------- 01 slash ----------
  private slash(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean, age: number): void {
    const { W, H, P } = this;
    this.fill(g, P.black, mask);
    if (!mask) {
      const x0 = W * (0.3 + 0.4 * hash01(s.seed, 1));
      const rip = this.reduce ? 1 : easeOutQuint(age / 0.12);
      // the field rips: the right half shifts, a jagged ice-blue slash glows in the gap
      const pts: [number, number][] = [];
      for (let i = 0; i <= 14; i++) pts.push([x0 + (hash01(s.seed, i, 2) - 0.5) * W * 0.05, (H * i) / 14 * rip]);
      for (const [w, c, a] of [[W * 0.03, P.ice, 0.18], [W * 0.012, P.ice, 0.6], [W * 0.004, P.white, 1]] as const) {
        g.save(); g.strokeStyle = c; g.globalAlpha = a; g.lineWidth = w; g.lineJoin = 'miter';
        g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.restore();
      }
      // white shards spray sideways and decelerate
      if (!this.reduce && age < 0.8) for (let i = 0; i < 16; i++) {
        const dir = hash01(s.seed, i, 3) < 0.5 ? -1 : 1, d = W * (0.1 + 0.35 * hash01(s.seed, i, 4)) * easeOutCubic(age / 0.5);
        const y = H * hash01(s.seed, i, 5), sz = H * (0.01 + 0.03 * hash01(s.seed, i, 6));
        g.save(); g.globalAlpha = clamp01(1 - age / 0.8); g.fillStyle = P.white; g.translate(x0 + dir * d, y); g.rotate(hash01(s.seed, i, 7) * 6 + age * 8 * dir);
        g.beginPath(); g.moveTo(0, -sz); g.lineTo(sz * 0.5, sz * 0.6); g.lineTo(-sz * 0.4, sz * 0.4); g.closePath(); g.fill(); g.restore();
      }
      // a barcode strip races left to right, then snaps in two and falls
      const by = H * 0.84, bw = W * 0.28, run = clamp01(age / 0.45), bx = -bw + (W + bw) * easeOutCubic(run);
      const snap = Math.max(0, age - 0.45);
      for (let half = 0; half < 2; half++) {
        g.save(); g.translate(bx + half * bw * 0.52, by + (snap > 0 ? snap * snap * H * 2 * (half ? 1.2 : 0.8) : 0)); g.rotate(snap * (half ? 1.5 : -1.2));
        g.fillStyle = P.ice;
        let o = 0; for (let i = 0; o < bw * 0.48; i++) { const w = bw * (0.006 + 0.02 * hash01(s.seed, half * 50 + i, 8)); g.fillRect(o, 0, w, H * 0.035); o += w + bw * 0.012; }
        g.restore();
      }
    }
    this.rows(g, t, s, antic, mask, (p) => (p.hero ? P.ice : P.white));
  }

  // ---------- 02 tunnel ----------
  private tunnel(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean): void {
    const { W, H, P } = this;
    this.fill(g, P.cobalt, mask);
    if (!mask) {
      const n = 12, sp = this.reduce ? 0 : t * 0.9;
      g.save(); g.lineWidth = Math.max(1.5, H * 0.004);
      for (let i = 0; i < n; i++) {
        const u = (((i / n) + sp) % 1), z = u * u * 1.4;
        g.strokeStyle = i % 3 === 0 ? P.ice : P.white; g.globalAlpha = clamp01(u * 1.5) * 0.7;
        g.strokeRect(W / 2 - (W * z) / 2, H / 2 - (H * z) / 2, W * z, H * z);
      }
      g.restore();
    }
    // every word bursts out of the vanishing point to its place in the line
    const y0 = H / 2 - (s.f.rows * s.f.cap * 1.16 - s.f.cap * 0.16) / 2;
    s.toks.forEach((p) => {
      const a0 = t - (p.w.start - antic);
      if (a0 < -0.18) return;
      const u = this.reduce ? (a0 >= 0 ? 1 : 0) : easeOutQuint((a0 + 0.18) / 0.26);
      if (u <= 0) return;
      const cap = s.f.cap * p.scale, x = W / 2 - s.f.rowW[p.row] / 2 + p.x, base = y0 + p.row * s.f.cap * 1.16 + s.f.cap;
      const cx = x + (p.u * cap) / 2, cy = base - cap / 2;
      g.save(); g.translate(W / 2 + (cx - W / 2) * u, H / 2 + (cy - H / 2) * u); g.scale(0.05 + 0.95 * u, 0.05 + 0.95 * u);
      this.txt(g, p.text, -(p.u * cap) / 2, cap / 2, cap, p.hero ? P.ice : P.white, mask, a0, { split: this.split(a0, cap) });
      g.restore();
    });
  }

  // ---------- 03 block ----------
  private block(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean): void {
    const { W, H, P } = this;
    this.fill(g, P.silver, mask);
    const cur = landed(s.toks, t, antic);
    if (!cur) return;
    const p = s.toks[cur.i], a0 = t - cur.t;
    // the previous block shatters into fragments trailing ice streaks
    if (!mask && cur.i > 0 && a0 < 0.6 && !this.reduce) {
      for (let i = 0; i < 18; i++) {
        const ang = hash01(s.seed + cur.i, i, 11) * Math.PI * 2, d = W * 0.5 * easeOutCubic(a0 / 0.6) * (0.4 + hash01(s.seed + cur.i, i, 12));
        const x = W / 2 + Math.cos(ang) * d, y = H / 2 + Math.sin(ang) * d * 0.7, sz = H * (0.03 + 0.05 * hash01(s.seed + cur.i, i, 13));
        g.save(); g.globalAlpha = 1 - a0 / 0.6;
        g.strokeStyle = P.ice; g.lineWidth = sz * 0.25; g.beginPath(); g.moveTo(W / 2 + Math.cos(ang) * d * 0.6, H / 2 + Math.sin(ang) * d * 0.42); g.lineTo(x, y); g.stroke();
        g.translate(x, y); g.rotate(ang + a0 * 9); g.fillStyle = P.white; g.fillRect(-sz / 2, -sz / 2, sz, sz * 0.6); g.restore();
      }
    }
    // a giant white block of type, rotating
    const rot = this.reduce ? 0 : Math.sin(t * 1.3 + s.seed) * 0.12;
    const cap = Math.min(H * 0.34, (W * 0.62) / Math.max(0.05, p.u));
    const bw = p.u * cap + cap * 0.5, bh = cap * 1.5;
    const k = punch(a0, this.reduce, 1.1);
    g.save(); g.translate(W / 2, H / 2); g.rotate(rot); g.scale(k, k);
    if (!mask) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(-bw / 2 + H * 0.015, -bh / 2 + H * 0.025, bw, bh); g.fillStyle = P.white; g.fillRect(-bw / 2, -bh / 2, bw, bh); }
    this.txt(g, p.text, 0, cap / 2, cap, P.black, mask, a0, { align: 'center', split: this.split(a0, cap) });
    g.restore();
  }

  // ---------- 04 diagonal ----------
  private diagonal(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean, age: number): void {
    const { W, H, P } = this;
    this.fill(g, P.black, mask);
    if (!mask) {
      // three full-bleed diagonal fields wipe in, one after another
      [P.cobalt, P.white, P.ice].forEach((c, i) => {
        const u = this.reduce ? 1 : easeOutQuint((age - i * 0.07) / 0.18);
        if (u <= 0) return;
        const x0 = -W * 0.4 + i * W * 0.42, w = W * 0.5;
        g.fillStyle = c;
        g.beginPath(); g.moveTo(x0 + W * 0.25 - (1 - u) * W * 1.5, 0); g.lineTo(x0 + W * 0.25 + w - (1 - u) * W * 1.5, 0); g.lineTo(x0 + w - (1 - u) * W * 1.5, H); g.lineTo(x0 - (1 - u) * W * 1.5, H); g.closePath(); g.fill();
      });
      // the hero word, huge, scrolling against the wipe
      const hero = s.toks[s.hero];
      if (t >= hero.w.start - antic) {
        const cap = H * 0.5, per = hero.u * cap + cap * 0.6, off = this.reduce ? 0 : ((t * W * 0.35) % per);
        g.save(); g.globalAlpha = 0.9; g.lineWidth = cap * 0.03; g.strokeStyle = P.black;
        for (let x = -per + off; x < W; x += per) drawText(g, hero.text, x, H / 2 + cap / 2, cap, 'rgba(0,0,0,0)', false, 1, { stroke: P.black, sw: cap * 0.025 });
        g.restore();
      }
    }
    this.rows(g, t, s, antic, mask, () => P.black, this.H * 0.8, s.f, this.W * 0.33);
  }

  // ---------- 05 stack ----------
  private stack(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean): void {
    const { W, H, P } = this;
    this.fill(g, P.ice, mask);
    const n = s.toks.length, rowH = Math.min(H * 0.84 / n, H * 0.22), base = H * 0.93;
    // after the line, the tower topples from its base
    const fallT = t - (s.end + 0.15);
    const fall = this.reduce || fallT <= 0 || s.next - s.end < 0.6 ? 0 : easeInCubic(fallT / 0.5) * 1.3;
    g.save(); g.translate(W * 0.36, base); g.rotate(fall); g.translate(-W * 0.36, -base);
    s.toks.forEach((p, i) => {
      const a0 = t - (p.w.start - antic);
      if (a0 < 0) return;
      const cap = rowH * 0.86;
      const sxx = Math.max(0.6, Math.min(2.2, (W * 0.44) / Math.max(0.05, p.u * cap)));
      const y = base - i * rowH;
      const drop = this.reduce ? 0 : (1 - easeOutQuint(a0 / 0.16)) * -H * 0.5;
      const col = p.hero ? P.cobalt : P.black;
      // each later landing knocks one letter off this word, which flies away spinning
      const knocked = s.toks.slice(i + 1).filter((q) => t >= q.w.start - antic).length > 0 && p.text.length > 2;
      if (!knocked || mask) { this.txt(g, p.text, W * 0.14, y + drop, cap, col, mask, a0, { sx: sxx, split: this.split(a0, cap) }); return; }
      const li = 1 + Math.floor(hash01(s.seed, i, 21) * (p.text.length - 2));
      const pre = p.text.slice(0, li), ch = p.text[li], post = p.text.slice(li + 1);
      const wPre = unit(pre, 'bebas') * cap * sxx, wCh = unit(ch, 'bebas') * cap * sxx;
      this.txt(g, pre, W * 0.14, y + drop, cap, col, false, a0, { sx: sxx });
      this.txt(g, post, W * 0.14 + wPre + wCh, y + drop, cap, col, false, a0, { sx: sxx });
      const kt = t - (s.toks[i + 1].w.start - antic);
      if (kt < 0.9 && !this.reduce) {
        const dir = hash01(s.seed, i, 22) < 0.5 ? -1 : 1;
        g.save(); g.translate(W * 0.14 + wPre + wCh / 2 + dir * kt * W * 0.6, y - cap / 2 - kt * H * 0.9 + kt * kt * H * 1.6); g.rotate(dir * kt * 9);
        this.txt(g, ch, -wCh / 2, cap / 2, cap, P.cobalt, false, 1, { sx: sxx }); g.restore();
      }
    });
    g.restore();
  }

  // ---------- 06 drop ----------
  private drop(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean): void {
    const { W, H, P } = this;
    this.fill(g, P.white, mask);
    const cur = landed(s.toks, t, antic, true) ?? landed(s.toks, t, antic);
    if (!cur) return;
    const p = s.toks[cur.i], a0 = t - cur.t;
    const cap = Math.min(H * 0.5, (W * 0.84) / Math.max(0.05, p.u));
    const floor = H * 0.66;
    // it drops in from the top, lands, compresses like a trampoline and springs back
    let y = floor, sq = 1;
    if (!this.reduce) {
      if (a0 < 0.12) y = floor - (1 - easeInCubic(a0 / 0.12)) * H;
      else { const k = a0 - 0.12; sq = 1 - 0.32 * Math.exp(-k / 0.09) * Math.cos(k * 32); }
    }
    if (!mask) { g.fillStyle = P.cobalt; const uw = p.u * cap * (2 - sq); g.fillRect(W / 2 - uw / 2, floor + H * 0.035 + (1 - sq) * H * 0.08, uw, H * 0.022); }
    g.save(); g.translate(W / 2, y); g.scale(2 - sq, sq);
    this.txt(g, p.text, 0, 0, cap, P.black, mask, a0, { align: 'center' });
    g.restore();
    // the line so far, small, top left
    if (!mask) {
      const done = s.toks.filter((q) => q.w.start - antic <= t).map((q) => q.text).join(' ');
      const cap = Math.min(H * 0.045, (W * 0.88) / Math.max(0.05, unit(done, 'montserrat')));
      drawText(g, done, W * 0.06, H * 0.13, cap, P.black, false, 1, { key: 'montserrat' });
    }
  }

  // ---------- 07 chevron ----------
  private chevron(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean): void {
    const { W, H, P } = this;
    this.fill(g, P.silver, mask);
    if (!mask) { g.fillStyle = P.black; const th = H * 0.22; g.beginPath(); g.moveTo(-W * 0.1, -th); g.lineTo(W * 0.62, H / 2); g.lineTo(-W * 0.1, H + th); g.lineTo(-W * 0.1 + th * 1.6, H + th); g.lineTo(W * 0.62 + th * 1.6, H / 2); g.lineTo(-W * 0.1 + th * 1.6, -th); g.closePath(); g.fill(); }
    const cur = landed(s.toks, t, antic, true) ?? landed(s.toks, t, antic);
    if (!cur) return;
    const p = s.toks[cur.i], a0 = t - cur.t;
    const cap = Math.min(H * 0.42, (W * 0.6) / Math.max(0.05, p.u));
    // giant outlined word that rolls 360° in 0.5 s, with stroboscopic ghosts in the palette's colours
    const spin = this.reduce ? 1 : easeOutCubic(a0 / 0.5);
    const ghosts = this.reduce ? [] : [P.ice, P.cobalt, P.white, P.black];
    if (!mask && spin < 1) ghosts.forEach((c, i) => {
      const r = Math.max(0, spin - (i + 1) * 0.08) * Math.PI * 2;
      g.save(); g.translate(W * 0.62, H / 2); g.rotate(r); g.globalAlpha = 0.5;
      drawText(g, p.text, 0, cap / 2, cap, 'rgba(0,0,0,0)', false, 1, { align: 'center', stroke: c, sw: cap * 0.04 }); g.restore();
    });
    g.save(); g.translate(W * 0.62, H / 2); g.rotate(spin * Math.PI * 2);
    this.txt(g, p.text, 0, cap / 2, cap, mask ? '#fff' : P.white, mask, a0, { align: 'center', stroke: P.black, sw: cap * 0.05 });
    g.restore();
  }

  // ---------- 08 barrage ----------
  private barrage(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean): void {
    const { W, H, P } = this;
    const cur = landed(s.toks, t, antic);
    const alt = cur ? cur.i % 2 : 0;
    this.fill(g, alt ? P.cobalt : P.black, mask);
    if (!cur) return;
    const p = s.toks[cur.i], a0 = t - cur.t;
    const cap = Math.min(H * 0.62, (W * 0.9) / Math.max(0.05, p.u));
    const k = punch(a0, this.reduce, 1.4);
    g.save(); g.translate(W / 2, H / 2); g.scale(k, k);
    this.txt(g, p.text, 0, cap / 2, cap, alt ? P.white : P.ice, mask, a0, { align: 'center', split: this.split(a0, cap) });
    g.restore();
    // a shutter flash on each slam (scaled by the photosensitivity guard)
    if (!mask && !this.reduce && a0 < 0.06) { g.save(); g.globalAlpha = 0.45 * (1 - a0 / 0.06) * this.flash(t) * this.intensity; g.fillStyle = P.white; g.fillRect(0, 0, W, H); g.restore(); }
  }

  // ---------- 09 cubes ----------
  private cubes(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean): void {
    const { W, H, P } = this;
    this.fill(g, P.black, mask);
    if (!mask) for (let i = 0; i < 7; i++) this.cube(g, W * (0.08 + 0.84 * hash01(s.seed, i, 31)), H * (0.15 + 0.7 * hash01(s.seed, i, 32)), H * (0.05 + 0.1 * hash01(s.seed, i, 33)), (this.reduce ? 0.3 : t * (0.6 + hash01(s.seed, i, 34))) + i, (this.reduce ? 0.5 : t * (0.4 + hash01(s.seed, i, 35))) + i * 2);
    const cur = landed(s.toks, t, antic, true) ?? landed(s.toks, t, antic);
    if (!cur) return;
    const p = s.toks[cur.i], a0 = t - cur.t;
    const cap = Math.min(H * 0.3, (W * 0.6) / Math.max(0.05, p.u));
    this.txt(g, p.text, W / 2, H / 2 + cap / 2, cap, P.white, mask, a0, { align: 'center', split: this.split(a0, cap) });
    if (mask) return;
    // a thin reticle closes in and locks onto the word, with data ticks
    const lock = this.reduce ? 1 : easeOutQuint(a0 / 0.22);
    const bw = p.u * cap * (1 + (1 - lock) * 1.2) + cap * 0.4, bh = cap * (1.5 + (1 - lock) * 1.5);
    g.save(); g.translate(W / 2, H / 2); g.rotate((1 - lock) * 0.8);
    g.strokeStyle = P.ice; g.lineWidth = Math.max(1.5, H * 0.003);
    const c = Math.min(bw, bh) * 0.18;
    for (const [sx2, sy2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.beginPath(); g.moveTo(sx2 * bw / 2, sy2 * (bh / 2 - c)); g.lineTo(sx2 * bw / 2, sy2 * bh / 2); g.lineTo(sx2 * (bw / 2 - c), sy2 * bh / 2); g.stroke(); }
    g.globalAlpha = 0.6; g.beginPath(); g.arc(0, 0, bh * 0.75, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, r = bh * 0.75; g.beginPath(); g.moveTo(Math.cos(a) * r, Math.sin(a) * r); g.lineTo(Math.cos(a) * r * (i % 6 ? 1.04 : 1.1), Math.sin(a) * r * (i % 6 ? 1.04 : 1.1)); g.stroke(); }
    g.restore();
  }

  /** a white isometric cube tumbling about two axes, with flat shading */
  private cube(g: Ctx2D, cx: number, cy: number, r: number, ax: number, ay: number): void {
    const P = this.P;
    const v: [number, number, number][] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      let X = x, Y = y * Math.cos(ax) - z * Math.sin(ax), Z = y * Math.sin(ax) + z * Math.cos(ax);
      const X2 = X * Math.cos(ay) + Z * Math.sin(ay); Z = -X * Math.sin(ay) + Z * Math.cos(ay); X = X2;
      v.push([X, Y, Z]);
    }
    const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
    const lit = [0.4, -0.6, 0.7];
    const vis = faces.map((f) => {
      const [a, b, c] = [v[f[0]], v[f[1]], v[f[2]]];
      const u1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], u2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u1[1] * u2[2] - u1[2] * u2[1], u1[2] * u2[0] - u1[0] * u2[2], u1[0] * u2[1] - u1[1] * u2[0]];
      const z = (v[f[0]][2] + v[f[1]][2] + v[f[2]][2] + v[f[3]][2]) / 4;
      return { f, n, z };
    }).sort((p, q) => p.z - q.z);
    for (const { f, n } of vis) {
      const len = Math.hypot(n[0], n[1], n[2]) || 1, d = (n[0] * lit[0] + n[1] * lit[1] + n[2] * lit[2]) / len;
      g.fillStyle = d > 0.3 ? P.white : d > -0.2 ? P.silver : '#5B636E';
      g.beginPath(); f.forEach((k, i) => { const [x, y] = v[k]; const px = cx + x * r * 0.7, py = cy + y * r * 0.7; if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.closePath(); g.fill();
    }
  }

  // ---------- 10 posters ----------
  private posters(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean): void {
    const { W, H, P } = this;
    const planes = [P.cobalt, P.white, P.ice, P.silver, P.black];
    const n = s.toks.filter((p) => t >= p.w.start - antic).length;
    const top = planes[n % planes.length], under = planes[(n + 1) % planes.length];
    const ink = (c: string) => (c === P.white || c === P.ice || c === P.silver ? P.black : P.white);
    this.fill(g, top, mask);
    // the plane below peels away diagonally as each word lands, revealing the next
    const last = landed(s.toks, t, antic);
    if (!mask && last && n > 0 && !this.reduce) {
      const a0 = t - last.t, u = easeOutCubic(a0 / 0.22);
      if (u < 1) {
        const prev = planes[(n - 1) % planes.length], e = -W * 0.3 + u * W * 1.8;
        g.save(); g.fillStyle = prev;
        g.beginPath(); g.moveTo(e, -10); for (let y = 0; y <= H; y += H / 12) g.lineTo(e - y * 0.4 + (hash01(s.seed, Math.floor(y), n) - 0.5) * W * 0.02, y); g.lineTo(W + 10, H + 10); g.lineTo(W + 10, -10); g.closePath(); g.fill();
        g.restore();
      }
    }
    void under;
    this.rows(g, t, s, antic, mask, () => ink(top));
  }

  // ---------- 11 cards ----------
  private cards(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean): void {
    const { W, H, P } = this;
    const cur = landed(s.toks, t, antic);
    const kind = cur ? (cur.i + Math.floor(hash01(s.seed, 41) * 5)) % 5 : 0;
    const bgs = [P.white, P.cobalt, P.ice, P.black, P.silver];
    this.fill(g, bgs[kind], mask);
    if (!cur) return;
    const p = s.toks[cur.i], a0 = t - cur.t, ink = kind === 1 || kind === 3 ? P.white : P.black;
    const cap = Math.min(H * 0.5, (W * 0.7) / Math.max(0.05, p.u));
    if (!mask) {
      if (kind === 1) { g.fillStyle = P.ice; g.beginPath(); g.moveTo(W * 0.55, 0); g.lineTo(W, H / 2); g.lineTo(W * 0.55, H); g.lineTo(W * 0.75, H); g.lineTo(W * 1.2, H / 2); g.lineTo(W * 0.75, 0); g.closePath(); g.fill(); }
      if (kind === 2) { g.fillStyle = P.black; let o = 0; for (let i = 0; o < W; i++) { const w = W * (0.004 + 0.012 * hash01(s.seed, i, 42)); g.fillRect(o, H * 0.08, w, H * 0.12); o += w + W * 0.008; } }
      if (kind === 4) { g.fillStyle = P.cobalt; for (let y = 0; y < H; y += H / 24) for (let x = 0; x < W; x += H / 24) { const d = 1 - Math.hypot(x - W * 0.75, y - H * 0.3) / (H * 0.7); if (d > 0) { g.beginPath(); g.arc(x, y, (H / 48) * d, 0, Math.PI * 2); g.fill(); } } }
    }
    if (kind === 3) { // slashed crop: the word cut diagonally with its halves offset
      for (const side of [0, 1]) {
        g.save(); g.beginPath();
        if (side) { g.moveTo(0, H * 0.62); g.lineTo(W, H * 0.38); g.lineTo(W, H); g.lineTo(0, H); } else { g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, H * 0.38); g.lineTo(0, H * 0.62); }
        g.closePath(); g.clip();
        this.txt(g, p.text, W / 2 + (side ? 1 : -1) * W * 0.02, H / 2 + cap / 2, cap, ink, mask, a0, { align: 'center' });
        g.restore();
      }
      return;
    }
    const pos = kind === 0 ? [W * 0.06, H * 0.12 + cap] : [W / 2 - (p.u * cap) / 2, H / 2 + cap / 2];
    this.txt(g, p.text, pos[0], pos[1], cap, ink, mask, a0, { split: this.split(a0, cap) });
  }

  // ---------- 12 shockwave ----------
  private shockwave(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean): void {
    const { W, H, P } = this;
    if (!mask) {
      const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, P.white); gr.addColorStop(0.62, '#E6EEF6'); gr.addColorStop(1, P.white);
      g.fillStyle = gr; g.fillRect(-40, -40, W + 80, H + 80);
    }
    const hero = s.toks[s.hero], ha = t - (hero.w.start - antic);
    if (!mask && ha >= 0 && !this.reduce) {
      // concentric rings, wind streaks and shattered letter shards blasting outward from the landing
      for (let i = 0; i < 4; i++) {
        const u = (ha - i * 0.08) / 0.7;
        if (u <= 0 || u >= 1) continue;
        g.save(); g.strokeStyle = P.ice; g.globalAlpha = 1 - u; g.lineWidth = H * 0.012 * (1 - u) + 1;
        g.beginPath(); g.ellipse(W / 2, H * 0.55, W * 0.7 * easeOutCubic(u), H * 0.35 * easeOutCubic(u), 0, 0, Math.PI * 2); g.stroke(); g.restore();
      }
      for (let i = 0; i < 20; i++) {
        const u = clamp01(ha / 0.6), ang = hash01(s.seed, i, 51) * Math.PI * 2, d = W * 0.6 * easeOutCubic(u) * (0.3 + hash01(s.seed, i, 52));
        g.save(); g.globalAlpha = 1 - u; g.fillStyle = i % 2 ? P.cobalt : P.black;
        g.translate(W / 2 + Math.cos(ang) * d, H * 0.55 + Math.sin(ang) * d * 0.5); g.rotate(ang + u * 6);
        g.fillRect(-H * 0.012, -H * 0.04, H * 0.024, H * 0.08); g.restore();
      }
      g.save(); g.fillStyle = P.silver; g.globalAlpha = clamp01(1 - ha / 0.8) * 0.7;
      for (let i = 0; i < 14; i++) { const y = H * hash01(s.seed, i, 53), len = W * (0.2 + 0.4 * hash01(s.seed, i, 54)); g.fillRect(W / 2 + (i % 2 ? 1 : -1) * W * 0.6 * easeOutCubic(ha / 0.5) - len / 2, y, len, Math.max(1, H * 0.003)); }
      g.restore();
    }
    this.rows(g, t, s, antic, mask, (p) => (p.hero ? P.cobalt : P.black), H * 0.55);
    // overexpose to white as the line ends
    if (!mask && !this.reduce && s.next - s.end > 0.5) { const u = clamp01((t - s.end) / 0.4); if (u > 0) { g.save(); g.globalAlpha = u * 0.85; g.fillStyle = P.white; g.fillRect(0, 0, W, H); g.restore(); } }
  }

  // ---------- 13 identity ----------
  private identity(g: Ctx2D, t: number, s: Scene, antic: number, mask: boolean, age: number): void {
    const { W, H, P } = this;
    this.fill(g, P.white, mask);
    if (!mask) {
      const cx = W * 0.5, cy = H * 0.5;
      g.save(); g.strokeStyle = P.ice; g.globalAlpha = 0.45;
      for (let i = 1; i <= 5; i++) { g.lineWidth = Math.max(1, H * 0.004 * (6 - i)); g.beginPath(); g.arc(cx, cy, H * 0.13 * i, 0, Math.PI * 2); g.stroke(); }
      // technical arcs with ticks
      g.globalAlpha = 0.7; g.strokeStyle = P.cobalt; g.lineWidth = Math.max(1, H * 0.002);
      const sp = this.reduce ? 0 : t * 0.25;
      for (let i = 0; i < 3; i++) { const r = H * (0.3 + i * 0.09); g.beginPath(); g.arc(cx, cy, r, sp * (i % 2 ? -1 : 1) + i, sp * (i % 2 ? -1 : 1) + i + 1.2); g.stroke(); for (let k = 0; k <= 8; k++) { const a = sp * (i % 2 ? -1 : 1) + i + (1.2 * k) / 8; g.beginPath(); g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.lineTo(cx + Math.cos(a) * r * 1.03, cy + Math.sin(a) * r * 1.03); g.stroke(); } }
      g.restore();
      // a rough black emblem with a snow crystal
      const ex = W * 0.86, ey = H * 0.2, er = H * 0.11;
      g.save(); g.fillStyle = P.black; g.beginPath();
      for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2, r = er * (0.96 + 0.08 * hash01(s.seed, i % 40, 61)); if (i) g.lineTo(ex + Math.cos(a) * r, ey + Math.sin(a) * r); else g.moveTo(ex + Math.cos(a) * r, ey + Math.sin(a) * r); }
      g.fill(); g.strokeStyle = P.white; g.lineWidth = Math.max(1.5, er * 0.06);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + (this.reduce ? 0 : t * 0.3); g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex + Math.cos(a) * er * 0.7, ey + Math.sin(a) * er * 0.7); g.moveTo(ex + Math.cos(a) * er * 0.4, ey + Math.sin(a) * er * 0.4); g.lineTo(ex + Math.cos(a + 0.5) * er * 0.55, ey + Math.sin(a + 0.5) * er * 0.55); g.stroke(); }
      g.restore();
    }
    this.rows(g, t, s, antic, mask, () => P.black);
    // one last ice pulse sweeps through the type
    if (!mask && !this.reduce) {
      const u = clamp01((t - s.end + 0.2) / 0.7);
      if (u > 0 && u < 1) { const x = -W * 0.3 + u * W * 1.6; const gr = g.createLinearGradient(x - W * 0.15, 0, x + W * 0.15, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, P.ice); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.save(); g.globalAlpha = 0.55; g.globalCompositeOperation = 'multiply'; g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore(); }
    }
    void age;
  }

  // ---------- intro / breaks ----------
  private breakCard(g: Ctx2D, t: number, age: number, intro: boolean, mask: boolean): void {
    const { W, H, P } = this;
    this.fill(g, P.black, mask);
    if (mask) return;
    for (let i = 0; i < 5; i++) this.cube(g, W * (0.1 + 0.8 * hash01(i, 71)), H * (i % 2 ? 0.14 + 0.08 * hash01(i, 72) : 0.8 + 0.08 * hash01(i, 72)), H * (0.05 + 0.08 * hash01(i, 73)), (this.reduce ? 0.3 : t * 0.5) + i, (this.reduce ? 0.6 : t * 0.35) + i * 2);
    if (intro && this.title) {
      const u = unit(this.title, 'bebas'), cap = Math.min(H * 0.3, (W * 0.84) / Math.max(0.05, u));
      const k = punch(age - 0.1, this.reduce, 1.2);
      if (k > 0) { g.save(); g.translate(W / 2, H / 2); g.scale(k, k); this.txt(g, this.title, 0, cap / 2, cap, P.white, false, age, { align: 'center', split: this.split(age - 0.1, cap) }); g.restore(); }
    }
    void lowerBound;
  }
}
registerEffect(ColdSnap);

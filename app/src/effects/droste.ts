// DROSTE — the frame contains itself. One panel design holds a window with the same panel scaled by k;
// the camera falls inward exactly one level per bar (seamless: z = k^-φ). Breakdowns freeze φ, drops
// reverse it, bridges swap the panel style at a level boundary. Inner levels show the lines to come,
// approaching from inside the window; the outer level sets the current line on the lintel and the
// current hero word in the field.
import type { ParamSpec, Params, Word, Line } from '../types';
import { type Effect, type EffectContext, type EffectFactory, clamp, lerp, eOut, rng, defaults, displayText } from './types';
import { fontCSS, capRatio, type FontKey } from '../render/sdf';

const PARAMS: ParamSpec[] = [
  { key: 'style', label: 'Panel style', group: 'Look', type: 'select', options: ['deco', 'brutalist', 'swiss'], default: 'deco', help: 'Art Deco, Brutalist or Swiss panel', live: false },
  { key: 'k', label: 'Window scale k', group: 'Recursion', type: 'range', min: 0.25, max: 0.4, step: 0.005, default: 0.32, help: 'Size of the inner window relative to the panel', live: false },
  { key: 'anchor', label: 'Window anchor', group: 'Recursion', type: 'select', options: ['right', 'center', 'left'], default: 'right', help: 'Where the window sits', live: false },
  { key: 'lpb', label: 'Levels per bar', group: 'Recursion', type: 'select', options: ['0.5', '1', '2'], default: '1', help: 'Recursion speed locked to the bar', live: false },
  { key: 'reverseOnDrop', label: 'Reverse on drops', group: 'Music', type: 'toggle', default: true, help: 'Drops send the camera back outward for two bars', live: false },
  { key: 'freeze', label: 'Freeze in breakdowns', group: 'Music', type: 'toggle', default: true, help: 'Recursion stops; only the hero word changes', live: false },
  { key: 'ornament', label: 'Ornament density', group: 'Look', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7, help: 'Rays, steps, rules and chevrons', live: true },
  { key: 'scheme', label: 'Colour scheme', group: 'Look', type: 'select', options: ['night', 'day'], default: 'night', help: 'Dark or light variant of the style', live: true }
];

type StyleId = 'deco' | 'brutalist' | 'swiss';
interface Sty { bg: string; bg2: string; fg: string; acc: string; line: string; heroF: FontKey; lintelF: FontKey }
const STY: Record<StyleId, Record<'night' | 'day', Sty>> = {
  deco: { night: { bg: '#0F1E2B', bg2: '#16293A', fg: '#F3E6C4', acc: '#D4AF6A', line: '#D4AF6A', heroF: 'cond', lintelF: 'caslon' }, day: { bg: '#EFE4C8', bg2: '#E4D5B0', fg: '#1A2430', acc: '#A8762E', line: '#A8762E', heroF: 'cond', lintelF: 'caslon' } },
  brutalist: { night: { bg: '#2A2A28', bg2: '#3A3A37', fg: '#EDEDE8', acc: '#E8452C', line: '#8E8E88', heroF: 'mont8', lintelF: 'mono' }, day: { bg: '#B9B8B1', bg2: '#A5A49C', fg: '#121212', acc: '#E8452C', line: '#4A4A46', heroF: 'mont8', lintelF: 'mono' } },
  swiss: { night: { bg: '#111111', bg2: '#1C1C1C', fg: '#F4F2EC', acc: '#E2231A', line: '#F4F2EC', heroF: 'mont8', lintelF: 'mont6' }, day: { bg: '#F4F2EC', bg2: '#E9E6DE', fg: '#111111', acc: '#E2231A', line: '#111111', heroF: 'mont8', lintelF: 'mont6' } }
};
const ORDER: StyleId[] = ['deco', 'brutalist', 'swiss'];

class DrosteEffect implements Effect {
  readonly id = 'droste'; readonly name = 'Droste'; readonly description = 'Infinite recursion locked to tempo: the panel contains itself and the camera falls one level per bar; breakdowns freeze, drops reverse.';
  readonly params = PARAMS;
  private p: Params = defaults(PARAMS);
  private ctx!: EffectContext;
  private phi = new Float32Array(0); private fps = 60;
  private bar = 2; private t0 = 0; private win = { x: 0, y: 0, k: .32 };
  private lines: Line[] = []; private heroes: Word[] = [];
  private mc = document.createElement('canvas').getContext('2d')!;

  async prepare(ctx: EffectContext) { this.ctx = ctx; this.p = { ...defaults(PARAMS), ...ctx.params }; this.build(); }
  setParams(p: Params) { this.p = { ...this.p, ...p }; }
  dispose() { /* nothing */ }

  private build() {
    const { song, width: W, height: H } = this.ctx; const a = song.analysis;
    this.bar = a.bpm > 0 ? 60 / a.bpm * (a.meter || 4) : 2;
    this.t0 = a.downbeats[0] ?? 0;
    const k = Number(this.p.k), anchor = String(this.p.anchor);
    const wx = anchor === 'right' ? W * (1 - k) - W * .06 : anchor === 'left' ? W * .06 : W * (1 - k) / 2;
    const wy = H * (1 - k) - H * .09;
    this.win = { x: wx, y: wy, k };
    // φ(t) as a cumulative table: +lpb per bar, 0 in breakdowns, reversed for two bars after drops
    const lpb = Number(this.p.lpb), n = Math.ceil(a.duration * this.fps) + 2, phi = new Float32Array(n);
    const secAt = (t: number) => a.sections.find(s => t >= s.start && t < s.end)?.label;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const t = i / this.fps;
      let rate = t < this.t0 ? 0 : lpb / this.bar;
      if (this.p.freeze && secAt(t) === 'breakdown') rate = 0;
      if (this.p.reverseOnDrop) for (const d of a.drops) if (t >= d && t < d + 2 * this.bar) rate = -lpb / this.bar;
      phi[i] = acc; acc += rate / this.fps;
    }
    this.phi = phi;
    this.lines = song.lyrics.lines.filter(L => L.words.length);
    this.heroes = song.lyrics.words.filter(w => w.role === 'hero');
  }

  private phiAt(t: number) { const i = Math.max(0, Math.min(this.phi.length - 1, t * this.fps)); const i0 = Math.floor(i), f = i - i0; return lerp(this.phi[i0], this.phi[Math.min(this.phi.length - 1, i0 + 1)], f); }
  /** Time at which the recursion first reaches absolute level L (extrapolated beyond the table). */
  private timeOfLevel(L: number, t: number, phiNow: number) {
    if (L <= phiNow) { for (let i = Math.floor(t * this.fps); i >= 0; i--) if (this.phi[i] <= L) return i / this.fps; return 0; }
    const lpb = Number(this.p.lpb);
    for (let i = Math.floor(t * this.fps); i < this.phi.length; i++) if (this.phi[i] >= L) return i / this.fps;
    return t + (L - phiNow) * this.bar / lpb;
  }
  private lineAt(t: number): Line | null {
    const off = this.ctx.settings.syncOffsetMs / 1000; let cur: Line | null = null;
    for (const L of this.lines) { if (L.start + off - .3 <= t) cur = L; else break; }
    if (!cur || t > cur.end + off + 2.5) { const nx = this.lines.find(L => L.start + off - .3 > t); if (nx && nx.start + off - t < this.bar * 1.5) return nx; }
    return cur;
  }
  private heroAt(t: number): Word | null { const off = this.ctx.settings.syncOffsetMs / 1000; let h: Word | null = null; for (const w of this.heroes) { if (w.start + off - .05 <= t) h = w; else break; } return h; }
  private styleFor(t: number): StyleId {
    const base = String(this.p.style) as StyleId, a = this.ctx.song.analysis;
    const lab = a.sections.find(s => t >= s.start && t < s.end)?.label;
    return lab === 'bridge' || lab === 'breakdown' ? ORDER[(ORDER.indexOf(base) + 1) % 3] : base;
  }
  private txt(s: string) { const m = this.ctx.settings.caseMode; return displayText(s, m === 'lower' ? 'lower' : m === 'as-is' ? 'as-is' : 'upper'); }

  /** Draw one panel in panel space [0,W]×[0,H]. live = the outermost level (words reveal as sung). */
  private panel(c: CanvasRenderingContext2D, L: number, tLevel: number, tNow: number, live: boolean, depth: number) {
    const { width: W, height: H, song } = this.ctx; const a = song.analysis;
    const sid = this.styleFor(tLevel), S = STY[sid][String(this.p.scheme) as 'night' | 'day'] ?? STY[sid].night;
    const orn = Number(this.p.ornament), w = this.win, u = Math.min(W, H);
    const R = rng(L * 977 + 13);
    c.fillStyle = S.bg; c.fillRect(0, 0, W, H);
    const lintelH = H * .2;
    // ── ornaments per style
    c.save();
    if (sid === 'deco') {
      // sunburst rays from the window centre
      const cx = w.x + W * w.k / 2, cy = w.y + H * w.k / 2, nR = Math.round(18 + orn * 30);
      c.globalAlpha = .12 + orn * .1; c.fillStyle = S.bg2;
      for (let i = 0; i < nR; i++) { const a0 = i / nR * Math.PI * 2 + tNow * .02, a1 = a0 + Math.PI / nR; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a0) * W * 2, cy + Math.sin(a0) * W * 2); c.lineTo(cx + Math.cos(a1) * W * 2, cy + Math.sin(a1) * W * 2); c.fill(); }
      c.globalAlpha = 1; c.strokeStyle = S.line; c.lineWidth = u * .004;
      // stepped double border
      for (const inset of [.025, .035]) { const ix = u * inset; c.beginPath(); c.moveTo(ix + u * .03, ix); c.lineTo(W - ix - u * .03, ix); c.lineTo(W - ix, ix + u * .03); c.lineTo(W - ix, H - ix - u * .03); c.lineTo(W - ix - u * .03, H - ix); c.lineTo(ix + u * .03, H - ix); c.lineTo(ix, H - ix - u * .03); c.lineTo(ix, ix + u * .03); c.closePath(); c.stroke(); }
      // lintel band and chevrons
      c.beginPath(); c.moveTo(u * .05, lintelH); c.lineTo(W - u * .05, lintelH); c.stroke();
      if (orn > .2) for (const sx of [u * .09, W - u * .09]) for (let k = 0; k < 3; k++) { const yy = lintelH * .5 + (k - 1) * u * .018; c.beginPath(); c.moveTo(sx - u * .02, yy - u * .012); c.lineTo(sx, yy + u * .004); c.lineTo(sx + u * .02, yy - u * .012); c.stroke(); }
    } else if (sid === 'brutalist') {
      c.fillStyle = S.bg2; const nb = Math.round(3 + orn * 6);
      for (let i = 0; i < nb; i++) { const bx = R() * W * .5, by = lintelH + R() * H * .7, bw = W * (.1 + R() * .25), bh = H * (.05 + R() * .2); c.fillRect(bx, by, bw, bh); }
      c.fillStyle = S.fg; c.fillRect(0, 0, W, lintelH * .92);
      c.fillStyle = S.acc; c.fillRect(W * .04, lintelH * .92, W * .16, H * .025);
      c.strokeStyle = S.line; c.lineWidth = u * .002; for (let x = W * .04; x < W; x += W / 12) { c.globalAlpha = .25 * orn; c.beginPath(); c.moveTo(x, lintelH); c.lineTo(x, H); c.stroke(); } c.globalAlpha = 1;
    } else {
      c.strokeStyle = S.line; c.lineWidth = u * .0018; c.globalAlpha = .18 + .25 * orn;
      for (let x = W * .05; x <= W * .951; x += W * .9 / 12) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
      for (let y = H * .05; y <= H * .951; y += H * .9 / 8) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      c.globalAlpha = 1; c.fillStyle = S.acc; c.fillRect(W * .05, lintelH - H * .02, W * .9 * (.25 + .5 * orn), H * .014);
    }
    c.restore();
    // ── lintel: the line
    const line = this.lineAt(tLevel), off = this.ctx.settings.syncOffsetMs / 1000;
    if (line) {
      const ws = line.words.map(id => song.lyrics.words[id]);
      const fk = S.lintelF; let cap = lintelH * .3; const maxW = W * .78;
      c.font = fontCSS(fk, cap / capRatio(fk)); const full = ws.map(x => this.txt(x.display)).join(' ');
      const fw = c.measureText(full).width; if (fw > maxW) { cap *= maxW / fw; c.font = fontCSS(fk, cap / capRatio(fk)); }
      let x = (W - Math.min(fw * cap / (lintelH * .3), maxW)) / 2; const y = lintelH * .5 + cap / 2;
      const ink = sid === 'brutalist' ? S.bg : S.fg;
      for (const wd of ws) {
        const s = this.txt(wd.display) + ' '; const sung = !live || wd.start + off <= tNow + this.ctx.settings.anticipationMs / 1000;
        c.fillStyle = ink; c.globalAlpha = sung ? 1 : .28; c.fillText(s, x, y); x += c.measureText(s).width;
      }
      c.globalAlpha = 1;
    }
    // ── field: the hero word, big, in the space beside the window
    const hero = this.heroAt(tLevel);
    if (hero && (!line || hero.start + off >= line.start + off - .5 || live)) {
      const fx0 = W * .06, fx1 = (String(this.p.anchor) === 'right' ? w.x : W * .94) - W * .03, fy1 = H * .9;
      const avail = Math.max(W * .2, fx1 - fx0);
      const s = this.txt(hero.display); const fk = S.heroF;
      let cap = (H - lintelH) * .42; c.font = fontCSS(fk, cap / capRatio(fk));
      const hw = c.measureText(s).width; if (hw > avail) { cap *= avail / hw; c.font = fontCSS(fk, cap / capRatio(fk)); }
      let k = 1, al = 1;
      if (live) { const dt = tNow - (hero.start + off); k = 1 + .25 * (1 - eOut(clamp((dt + .12) / .3))); al = clamp((dt + .15) / .12); const bi = this.lastBeat(tNow); if (bi >= 0) k *= 1 + .02 * Math.exp(-(tNow - a.beats[bi]) * 8) * this.ctx.settings.reactivity / 100; }
      c.save(); c.translate(fx0, fy1 - (sid === 'swiss' ? 0 : H * .02)); c.scale(k, k); c.globalAlpha = al;
      c.fillStyle = sid === 'deco' ? S.acc : sid === 'swiss' ? S.fg : S.fg; c.fillText(s, 0, 0);
      if (sid === 'deco' && orn > .3) { c.strokeStyle = S.acc; c.lineWidth = u * .003; c.beginPath(); c.moveTo(0, u * .03); c.lineTo(Math.min(avail, c.measureText(s).width), u * .03); c.stroke(); }
      c.restore();
    }
    // ── window frame
    c.save(); const ww = W * w.k, wh = H * w.k;
    c.strokeStyle = sid === 'swiss' ? S.acc : S.line; c.lineWidth = u * (sid === 'brutalist' ? .02 : .008);
    const glow = this.downbeatGlow(tNow);
    if (live && glow > 0) { c.shadowColor = S.acc; c.shadowBlur = u * .03 * glow; }
    c.strokeRect(w.x - c.lineWidth / 2, w.y - c.lineWidth / 2, ww + c.lineWidth, wh + c.lineWidth);
    if (sid === 'deco') { c.shadowBlur = 0; c.lineWidth = u * .003; c.strokeRect(w.x - u * .018, w.y - u * .018, ww + u * .036, wh + u * .036); c.font = fontCSS('mono', u * .018); c.fillStyle = S.line; c.fillText(`LEVEL ${L}`, w.x, w.y - u * .03); }
    if (sid === 'brutalist') { c.fillStyle = S.fg; c.font = fontCSS('mono', u * .02); c.fillText(`${String(L).padStart(3, '0')}/∞`, w.x, w.y + wh + u * .045); }
    c.restore();
    void depth;
  }
  private lastBeat(t: number) { const B = this.ctx.song.analysis.beats; let lo = 0, hi = B.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (B[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; }
  private downbeatGlow(t: number) { const D = this.ctx.song.analysis.downbeats; let last = -9; for (const d of D) { if (d <= t) last = d; else break; } return Math.exp(-(t - last) * 4); }

  render(t: number, out: CanvasRenderingContext2D) {
    const { width: W, height: H, song } = this.ctx; const w = this.win, k = w.k;
    const phi = this.phiAt(t), m = Math.floor(phi), u = phi - m;
    // fixed point of p → w + k·p, and the zoom about it
    const fx = w.x / (1 - k), fy = w.y / (1 - k), s = Math.pow(k, -u);
    out.save(); out.setTransform(1, 0, 0, 1, 0, 0);
    out.translate(fx, fy); out.scale(s, s); out.translate(-fx, -fy);
    for (let n = 0; n < 8; n++) {
      const scaleN = s * Math.pow(k, n); if (W * scaleN < 3) break;
      const L = m + n, tL = n === 0 ? t : this.timeOfLevel(L, t, phi);
      out.save();
      if (n > 0) { out.beginPath(); out.rect(0, 0, W, H); out.clip(); }
      this.panel(out, L, tL, t, n === 0, n);
      out.restore();
      // descend into the window
      out.translate(w.x, w.y); out.scale(k, k);
      out.beginPath(); out.rect(0, 0, W, H); out.clip();
    }
    out.restore();
    const fade = clamp((t - (song.analysis.duration - .6)) / .55);
    if (fade > 0) { out.fillStyle = `rgba(0,0,0,${fade})`; out.fillRect(0, 0, W, H); }
    void lerp;
  }
}

export const DrosteFactory: EffectFactory = { id: 'droste', name: 'Droste', description: 'Infinite recursion locked to tempo — the panel contains itself, the camera falls one level per bar, breakdowns freeze and drops reverse.', params: PARAMS, create: () => new DrosteEffect() };

// KARAOKE — the clear one (SPEC §8.16). Two lines, syllable-exact wipe, voices, countdown, contrast-checked.
// Reduce motion calms: the bouncing ball (off), the background drift, and the line slide-in (becomes a fade).
import type { Line, Word } from '../types.ts';
import { Canvas2DEffect, type EffectContext, type EffectMeta, range, toggle, select, colour, text, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { type Ctx2D, setFont, textWidth, cleanDisplay, graphemes, clamp01, smooth, easeOutCubic, lineAt, isRTLText } from '../render/textkit.ts';
import { translationState } from '../lyrics/translate.ts';
import { hexToRgb, mixHex, rgba } from '../render/gl.ts';
import { relLum } from '../render/flashguard.ts';
import { lowerBound, hash01 } from '../analysis/dsp.ts';

interface KWord { w: Word; text: string; x: number; width: number; cap: number; font: string; row: number; sylX: number[] }
interface KLine { line: Line; words: KWord[]; width: number; rows: number; cap: number; slot: number; showAt: number; hideAt: number; gapBefore: number; rtl: boolean }

const FONT_OPTS = ['montserrat', 'oswald', 'barlow', 'caslon', 'bebas'];

export class Karaoke extends Canvas2DEffect {
  static meta: EffectMeta = {
    id: 'karaoke', name: 'Karaoke', kind: '2d',
    description: 'Two clear lines with a syllable-exact wipe, voices, countdown and translation. The sing-along baseline.',
    affinity: aff(0.35, 0.7, 0.95, 0.9, 0.5, 0.5, 0.5, 0.5),
    supportsTransparent: true, supportsLive: true, ownsTitle: true, ownsTranslation: true,
    params: [
      select('font', 'Font', 'Type', 'montserrat', FONT_OPTS, false),
      range('size', 'Size', 'Type', 1, 0.6, 1.6, 0.01, false),
      select('lines', 'Lines shown', 'Layout', '2', ['2', '3'], false),
      select('position', 'Position', 'Layout', 'bottom', ['bottom', 'centre'], false),
      select('wipe', 'Wipe style', 'Wipe', 'syllable', ['syllable', 'word', 'line']),
      colour('colA', 'Voice A / sing colour', 'Colours', '#4AA8FF'),
      colour('colB', 'Voice B', 'Colours', '#FF5FA2'),
      colour('colBoth', 'Both voices', 'Colours', '#58D68D'),
      colour('colText', 'Unsung text', 'Colours', '#FFFFFF'),
      range('outline', 'Outline', 'Colours', 0.6, 0, 1.5, 0.01),
      toggle('ball', 'Bouncing ball', 'Extras', false),
      toggle('countdown', 'Countdown dots', 'Extras', true),
      range('dim', 'Background dim', 'Background', 0.35, 0, 1, 0.01),
      select('band', 'Contrast band', 'Background', 'auto', ['auto', 'always', 'off']),
      text('lyricsBy', 'Lyrics by', 'Title page', ''),
    ],
  };
  readonly meta = Karaoke.meta;
  private lines: KLine[] = [];
  private bg: [string, string, string] = ['#0B1026', '#1B2A5A', '#2A1140'];
  private bandAlpha = 0;
  private cap = 40;

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const { W, H } = this;
    const fontKey = this.str('font');
    const portrait = H > W;
    this.cap = Math.min(W, H) * (portrait ? 0.05 : 0.062) * this.num('size');
    const maxW = W * 0.9;
    const ly = this.ly;
    this.lines = [];
    let slot = 0;
    for (let i = 0; i < ly.lines.length; i++) {
      const line = ly.lines[i];
      const ws = line.words.map((k) => ly.words[k]);
      const rtl = line.dir === 'rtl' || isRTLText(line.text);
      const build = (cap: number) => {
        const out: KWord[] = [];
        let x = 0, row = 0;
        for (const w of ws) {
          const f = w.backing && fontKey === 'montserrat' ? 'barlowCondIt' : fontKey === 'barlow' ? 'barlow' : fontKey;
          const c = w.backing ? cap * 0.62 : cap;
          let txt = cleanDisplay(w, this.s.caseMode === 'upper' ? 'as-is' : this.s.caseMode, true);
          if (w.backing && !/^[(（]/.test(txt)) txt = txt; // parentheses are part of the display text already
          const width = textWidth(txt, f, c);
          const gap = cap * 0.34;
          if (x > 0 && x + width > maxW) { row++; x = 0; }
          // x offset of every syllable boundary inside the word
          const sylX: number[] = [0];
          const st = w.syllableTimes;
          if (st && st.length > 1) {
            let acc = '';
            const total = st.map((s) => s.text).join('');
            const lead = txt.toLowerCase().indexOf(total.toLowerCase().slice(0, 1));
            const offs = lead > 0 ? txt.slice(0, lead) : '';
            for (let k = 0; k < st.length - 1; k++) { acc += st[k].text; sylX.push(Math.min(width, textWidth(offs + txt.slice(offs.length, offs.length + graphemes(acc).length), f, c))); }
          }
          sylX.push(width);
          out.push({ w, text: txt, x, width, cap: c, font: f, row, sylX });
          x += width + gap;
        }
        const rows = row + 1;
        // centre each row
        let width = 0;
        for (let r = 0; r < rows; r++) {
          const rw = out.filter((k) => k.row === r);
          const wd = rw.length ? rw[rw.length - 1].x + rw[rw.length - 1].width : 0;
          width = Math.max(width, wd);
          for (const k of rw) k.x = rtl ? wd / 2 - k.x - k.width : k.x - wd / 2;
        }
        return { out, rows, width };
      };
      // keep a line on ONE row by scaling it down (to 60 %); only very long lines wrap, at a tighter pitch
      let cap = this.cap;
      let b = build(cap);
      for (let k = 0; k < 6 && b.rows > 1; k++) { cap *= 0.92; b = build(cap); }
      if (b.rows > 2) { cap *= 0.85; b = build(cap); }
      const prev = ly.lines[i - 1], next = ly.lines[i + 1];
      const gapBefore = prev ? line.start - prev.end : line.start;
      if (gapBefore >= 4) slot = 0;
      const lead = gapBefore >= 4 ? Math.min(3.2, gapBefore - 0.3) : 0;
      const showAt = gapBefore >= 4 || !prev ? line.start - Math.max(1.2, lead) : Math.min(line.start - 0.4, prev.start + 0.15);
      const hideAt = next && next.start - line.end < 4 ? Math.max(line.end + 0.25, next.start + 0.1) : line.end + Math.max(0.6, this.s.minReadMs / 1000);
      this.lines.push({ line, words: b.out, width: b.width, rows: b.rows, cap, slot, showAt, hideAt, gapBefore, rtl });
      slot = 1 - slot;
    }
    // background palette (artwork when available)
    const art = ctx.artwork;
    if (art && this.s.paletteSource !== 'effect') this.bg = [mixHex(art.darkest, '#000000', 0.35), mixHex(art.dominant, '#000000', 0.45), mixHex(art.vivid1, '#000000', 0.55)];
    else if (art) this.bg = [mixHex(art.darkest, '#05060c', 0.4), mixHex(art.dominant, '#0a0d1a', 0.55), mixHex(art.vivid1, '#0a0d1a', 0.6)];
    // WCAG contrast (≥ 4.5:1) of the sing colour and the text against the background under the text band
    const lumOf = (hex: string) => { const [r, g, b] = hexToRgb(hex); return relLum(r, g, b); };
    const dim = this.num('dim');
    const bgLum = (0.5 * lumOf(this.bg[1]) + 0.5 * lumOf(this.bg[2])) * (1 - dim) ** 2;
    const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const need = Math.min(ratio(lumOf(this.str('colA')), bgLum), ratio(lumOf(this.str('colText')), bgLum), ratio(lumOf(this.str('colB')), bgLum));
    this.bandAlpha = 0;
    if (this.str('band') === 'always' || this.s.transparentBackground) this.bandAlpha = 0.55;
    else if (this.str('band') === 'auto' && need < 4.5) {
      // darken under the text until every colour passes
      for (let a = 0.1; a <= 0.9; a += 0.05) {
        const l = bgLum * (1 - a) ** 2;
        if (Math.min(ratio(lumOf(this.str('colA')), l), ratio(lumOf(this.str('colB')), l)) >= 4.5) { this.bandAlpha = a; break; }
        this.bandAlpha = a;
      }
    }
  }

  private slotY(l: KLine): number {
    const { H } = this;
    const three = this.str('lines') === '3';
    const centre = this.str('position') === 'centre';
    const pitch = this.cap * 2.5;
    const base = centre ? H * 0.5 - pitch * 0.5 : H * (three ? 0.6 : 0.68);
    return base + l.slot * pitch + (l.rows > 1 ? -l.cap * 0.72 : 0);
  }

  private voiceCol(w: Word): string {
    if (!this.s.voicePalette) return this.str('colA');
    return w.voice === 'B' ? this.str('colB') : w.voice === 'all' ? this.str('colBoth') : this.str('colA');
  }

  /** x position (inside the word) the wipe has reached at t */
  private wipeX(k: KWord, line: Line, t: number): number {
    const w = k.w, style = this.str('wipe');
    if (style === 'line') return t >= line.start ? k.width : 0;
    if (style === 'word') return t >= w.start ? k.width : 0;
    if (t <= w.start) return 0;
    if (t >= w.end) return k.width;
    const st = w.syllableTimes;
    if (!st || st.length < 2 || k.sylX.length !== st.length + 1) return k.width * clamp01((t - w.start) / Math.max(0.05, w.end - w.start));
    for (let i = 0; i < st.length; i++) {
      if (t < st[i].end || i === st.length - 1) {
        const p = clamp01((t - st[i].start) / Math.max(0.03, st[i].end - st[i].start));
        return k.sylX[i] + (k.sylX[i + 1] - k.sylX[i]) * p;
      }
    }
    return k.width;
  }

  protected draw(t: number, g: Ctx2D, mask: boolean): void {
    const { W, H } = this;
    const a = this.a, ly = this.ly;
    const rm = this.s.reduceMotion;
    if (!mask && !this.s.transparentBackground) this.background(t, g);
    const three = this.str('lines') === '3';
    const first = ly.words.length ? ly.words[0].start : Infinity;
    if (!mask) this.titlePage(t, g, first);
    // contrast band behind the text block
    if (!mask && this.bandAlpha > 0) {
      const anyVisible = this.lines.some((l) => t >= l.showAt && t < l.hideAt);
      if (anyVisible) {
        const y0 = this.slotY({ slot: 0, rows: 1, cap: this.cap } as KLine) - this.cap * 2.0, y1 = this.slotY({ slot: 1, rows: 1, cap: this.cap } as KLine) + this.cap * 1.6;
        const gr = g.createLinearGradient(0, y0, 0, y1);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.18, `rgba(0,0,0,${this.bandAlpha})`);
        gr.addColorStop(0.82, `rgba(0,0,0,${this.bandAlpha})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(0, y0, W, y1 - y0);
      }
    }
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    const outline = this.num('outline');
    let activeLine: KLine | null = null;
    for (const l of this.lines) {
      let vis = t >= l.showAt && t < l.hideAt;
      let dimPrev = 0;
      if (three && !vis && t >= l.hideAt && t < l.hideAt + 1.6) { vis = true; dimPrev = 1; }
      if (!vis) continue;
      const fadeIn = clamp01((t - l.showAt) / 0.25), fadeOut = dimPrev ? clamp01((l.hideAt + 1.6 - t) / 0.4) : clamp01((l.hideAt - t) / 0.2);
      const alpha = smooth(fadeIn) * fadeOut * (dimPrev ? 0.35 : 1);
      if (alpha <= 0) continue;
      const y = dimPrev ? this.slotY({ ...l, slot: 0 }) - this.cap * 2.5 : this.slotY(l) + (rm ? 0 : (1 - easeOutCubic(fadeIn)) * this.cap * 0.35);
      if (t >= l.line.start - 0.05 && t < l.line.end) activeLine = l;
      const rowPitch = l.cap * 1.45;
      for (const k of l.words) {
        const x = W / 2 + k.x, yy = y + k.row * rowPitch;
        setFont(g, k.font, k.cap);
        if (mask) {
          const age = Math.max(0, t - k.w.start);
          g.globalAlpha = alpha * (k.w.backing ? 0.7 : 1);
          g.fillStyle = `rgb(255,${Math.round(clamp01(age / 2) * 255)},255)`;
          g.fillText(k.text, x, yy);
          continue;
        }
        g.globalAlpha = alpha * (k.w.backing ? 0.75 : 1);
        if (outline > 0) {
          g.lineJoin = 'round';
          g.lineWidth = k.cap * 0.16 * outline;
          g.strokeStyle = 'rgba(0,0,0,0.85)';
          g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = k.cap * 0.25; g.shadowOffsetY = k.cap * 0.06;
          g.strokeText(k.text, x, yy);
          g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
        }
        g.fillStyle = this.str('colText');
        g.fillText(k.text, x, yy);
        // syllable wipe with a soft 2 px edge
        const wx = this.wipeX(k, l.line, t);
        if (wx > 0) {
          const col = this.voiceCol(k.w);
          const soft = Math.max(2, this.H / 360);
          if (wx >= k.width) g.fillStyle = col;
          else {
            const x0 = l.rtl ? x + k.width : x, dirn = l.rtl ? -1 : 1;
            const gr = g.createLinearGradient(x0, 0, x0 + dirn * (k.width + soft), 0);
            const p = wx / (k.width + soft);
            gr.addColorStop(0, col); gr.addColorStop(Math.max(0, p), col);
            gr.addColorStop(Math.min(1, p + soft / (k.width + soft)), rgba(col, 0)); gr.addColorStop(1, rgba(col, 0));
            g.fillStyle = gr;
          }
          g.fillText(k.text, x, yy);
        }
      }
      g.globalAlpha = 1;
      // countdown: four dots disappear on the beats before a line that follows a gap ≥ 4 s
      if (!mask && this.bool('countdown') && l.gapBefore >= 4 && t < l.line.start && !dimPrev) {
        const bi = lowerBound(a.beats, l.line.start - 0.05);
        const beatsBefore = [4, 3, 2, 1].map((n) => a.beats[bi - n] ?? l.line.start - n * (60 / (a.bpm || 120)));
        if (t >= beatsBefore[0] - 0.6) {
          const r = this.cap * 0.16;
          const lx = W / 2 - l.width / 2 + r, ly2 = y - l.cap * 1.55;
          for (let d = 0; d < 4; d++) {
            const gone = t >= beatsBefore[d];
            const pop = gone ? clamp01(1 - (t - beatsBefore[d]) / 0.15) : 1;
            if (pop <= 0) continue;
            g.globalAlpha = alpha * pop;
            g.fillStyle = this.str('colA');
            g.beginPath(); g.arc(lx + d * r * 3.2, ly2, r * (gone ? 1 + (1 - pop) * 0.8 : 1), 0, Math.PI * 2); g.fill();
          }
          g.globalAlpha = 1;
        }
      }
      // translation: a third, smaller line under the active line
      if (!mask && this.s.showTranslation !== 'off' && l.line.translation && t >= l.line.start - 0.3 && !dimPrev) {
        const st = translationState(l.line, t, this.s.showTranslation === 'alternate' ? 'under' : this.s.showTranslation);
        if (st.translation) {
          const c2 = this.cap * 0.5;
          setFont(g, 'montserrat600', c2);
          g.textAlign = 'center';
          g.globalAlpha = alpha * 0.85;
          g.fillStyle = 'rgba(0,0,0,0.6)';
          const tw = Math.min(W * 0.92, g.measureText(st.translation).width);
          const ty = this.slotY({ ...l, slot: 1 }) + this.cap * 1.25;
          g.fillRect(W / 2 - tw / 2 - c2, ty - c2 * 1.5, tw + c2 * 2, c2 * 2.2);
          g.fillStyle = '#E8ECF5';
          g.fillText(st.translation, W / 2, ty, W * 0.92);
          g.textAlign = 'left'; g.globalAlpha = 1;
        }
      }
    }
    if (mask) return;
    // bouncing ball: hops from syllable to syllable, landing on each syllable start
    if (this.bool('ball') && !rm && activeLine) this.ball(t, g, activeLine);
    // instrumental breaks: slim progress bar
    const li = lineAt(ly, t);
    const from = li >= 0 ? ly.lines[li].end : 0, to = li + 1 < ly.lines.length ? ly.lines[li + 1].start : a.duration;
    if (t > from + 0.8 && to - from >= 6 && t < to - 3.4 && (li >= 0 || t > 0.5) && t > (first === Infinity ? 0 : Math.min(first, 0))) {
      if (li >= 0) {
        const fade = clamp01((t - from - 0.8) / 0.4) * clamp01((to - 3.4 - t) / 0.4);
        const bw = W * 0.26, bx = W / 2 - bw / 2, by = this.slotY({ slot: 0, rows: 1, cap: this.cap } as KLine) + this.cap * 0.4;
        g.globalAlpha = 0.85 * fade;
        g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(bx, by, bw, Math.max(2, H * 0.004));
        g.fillStyle = this.str('colA'); g.fillRect(bx, by, bw * clamp01((t - from) / (to - from)), Math.max(2, H * 0.004));
        setFont(g, 'montserrat600', this.cap * 0.4);
        g.textAlign = 'center'; g.fillStyle = '#fff';
        g.fillText('♪ instrumental', W / 2, by - this.cap * 0.45);
        g.textAlign = 'left'; g.globalAlpha = 1;
      }
    }
  }

  private ball(t: number, g: Ctx2D, l: KLine): void {
    // landing points: every syllable start in the line
    const pts: { t: number; x: number; y: number }[] = [];
    const y = this.slotY(l);
    for (const k of l.words) {
      if (k.w.backing) continue;
      const st = k.w.syllableTimes;
      const yy = y + k.row * l.cap * 1.45 - k.cap * 1.35;
      if (st && st.length === k.sylX.length - 1) st.forEach((s, i) => pts.push({ t: s.start, x: this.W / 2 + k.x + 0.5 * (k.sylX[i] + k.sylX[i + 1]), y: yy }));
      else pts.push({ t: k.w.start, x: this.W / 2 + k.x + k.width / 2, y: yy });
    }
    if (!pts.length) return;
    let i = 0;
    while (i + 1 < pts.length && pts[i + 1].t <= t) i++;
    const p0 = pts[i], p1 = pts[Math.min(pts.length - 1, i + 1)];
    let x = p0.x, yy = p0.y;
    if (t < pts[0].t) { const u = clamp01(1 - (pts[0].t - t) / 0.5); x = p0.x - (1 - u) * l.cap * 2; yy = p0.y - Math.sin(u * Math.PI) * l.cap * 1.2 * 0 - (1 - u) * (1 - u) * 0 - 4 * u * (1 - u) * l.cap; }
    else if (p1 !== p0) {
      const u = clamp01((t - p0.t) / Math.max(0.05, p1.t - p0.t));
      const hgt = Math.min(l.cap * 2.2, l.cap * (0.45 + 1.6 * (p1.t - p0.t)));
      x = p0.x + (p1.x - p0.x) * u; yy = p0.y + (p1.y - p0.y) * u - 4 * u * (1 - u) * hgt;
    }
    const r = l.cap * 0.2;
    g.fillStyle = '#FFE14A';
    g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = r;
    g.beginPath(); g.arc(x, yy, r, 0, Math.PI * 2); g.fill();
    g.shadowColor = 'transparent'; g.shadowBlur = 0;
  }

  private background(t: number, g: Ctx2D): void {
    const { W, H } = this;
    const drift = this.s.reduceMotion ? 0 : t * 0.05;
    const gr = g.createLinearGradient(W * (0.2 + 0.2 * Math.sin(drift)), 0, W * (0.8 + 0.2 * Math.cos(drift * 1.3)), H);
    gr.addColorStop(0, this.bg[0]); gr.addColorStop(0.55, this.bg[1]); gr.addColorStop(1, this.bg[2]);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // soft moving lights that breathe with the song's loudness
    const loud = this.sample(this.a.loud, t) * this.react;
    for (let i = 0; i < 3; i++) {
      const cx = W * (0.5 + 0.38 * Math.sin(drift * (1 + i * 0.4) + i * 2.1)), cy = H * (0.4 + 0.3 * Math.cos(drift * (0.8 + i * 0.3) + i));
      const rr = Math.max(W, H) * (0.35 + 0.1 * loud);
      const rg = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      rg.addColorStop(0, rgba(this.bg[(i + 1) % 3], 0.5 + 0.2 * loud)); rg.addColorStop(1, rgba(this.bg[(i + 1) % 3], 0));
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
    }
    g.globalCompositeOperation = 'source-over';
    const dim = this.num('dim');
    if (dim > 0) { g.fillStyle = `rgba(0,0,0,${dim})`; g.fillRect(0, 0, W, H); }
    void hash01;
  }

  private titlePage(t: number, g: Ctx2D, first: number): void {
    const s = this.s;
    if (!(s.title || s.artist) || first < 2.5) return;
    const end = first - 2.2;
    const fade = clamp01(t / 0.6) * clamp01((end - t) / 0.5);
    if (fade <= 0) return;
    const { W, H } = this;
    g.save();
    g.globalAlpha = fade;
    g.textAlign = 'center';
    const cap = Math.min(W, H) * 0.07;
    setFont(g, 'montserrat', cap);
    g.fillStyle = '#fff';
    const title = s.title || '';
    const k = Math.min(1, (W * 0.86) / Math.max(1, g.measureText(title).width));
    g.save(); g.translate(W / 2, H * 0.46); g.scale(k, k); g.fillText(title, 0, 0); g.restore();
    setFont(g, 'montserrat600', cap * 0.36);
    g.fillStyle = this.str('colA');
    if (s.artist) g.fillText(s.artist, W / 2, H * 0.46 + cap * 0.95);
    const by = this.str('lyricsBy');
    if (by) { setFont(g, 'montserrat300', cap * 0.26); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText(`lyrics by ${by}`, W / 2, H * 0.46 + cap * 1.6); }
    g.restore();
  }
}
registerEffect(Karaoke);

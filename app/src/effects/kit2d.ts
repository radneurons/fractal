// Shared helpers for the type-driven 2D effects (EDITORIAL, COLD SNAP, FOUNDRY, ZINE PUNK): word tokens with
// measured widths, fitting a line into a box, landings, the "punch" scale, text with RGB split / stroke / stretch,
// a per-line scene clock with instrumental breaks, and helper canvases that rasterise in software for exports.
import { softCanvas } from './types.ts';
import { maskFill } from './common.ts';
import { type Ctx2D, clamp01, easeOutBack, cleanDisplay, lineAt } from '../render/textkit.ts';
import { font, sizeForCap, scratchCtx, makeCanvas } from '../render/sdf.ts';
import type { GlobalSettings, Line, Lyrics, Word } from '../types.ts';

/** width of `text` per unit of cap height */
export function unit(text: string, key: string): number {
  const g = scratchCtx();
  g.font = font(key, sizeForCap(key, 100));
  return g.measureText(text).width / 100;
}

export interface Tok { w: Word; text: string; raw: string; hero: boolean; u: number; scale: number; row: number; x: number }

export function tokens(ly: Lyrics, line: Line, s: GlobalSettings, key: string): Tok[] {
  return line.words.map((i) => ly.words[i]).map((w) => {
    const text = cleanDisplay(w, s.caseMode);
    return { w, text, raw: w.display, hero: w.role === 'hero' && !w.backing, u: unit(text, key), scale: w.backing ? 0.55 : w.role === 'hero' ? 1.12 : 1, row: 0, x: 0 };
  });
}

export interface Fit { cap: number; rows: number; rowW: number[] }
/** greedy rows at a cap, shrinking the cap until the words fit `bw × bh` in at most `maxRows` rows */
export function fit(toks: Tok[], bw: number, bh: number, maxRows: number, pitch = 1.16, gap = 0.28): Fit {
  const flow = (cap: number) => {
    let row = 0, x = 0; const rowW = [0];
    for (const p of toks) {
      const wd = p.u * cap * p.scale;
      if (x > 0 && x + wd > bw) { row++; x = 0; rowW.push(0); }
      p.row = row; p.x = x; x += wd + cap * gap; rowW[row] = x - cap * gap;
    }
    return { rows: row + 1, rowW };
  };
  let cap = bh / Math.max(1, Math.min(maxRows, toks.length)) / pitch, f = flow(cap);
  for (let i = 0; i < 48; i++) {
    const fits = f.rows * cap * pitch <= bh * 1.02 && Math.max(...f.rowW) <= bw * 1.001;
    if (fits && (f.rows <= maxRows || cap < bh * 0.1)) break;
    cap *= 0.93; f = flow(cap);
  }
  return { cap, rows: f.rows, rowW: f.rowW };
}

/** the latest landed word (index), optionally skipping connectives and backing vocals */
export function landed(toks: Tok[], t: number, antic: number, skipWeak = false): { i: number; t: number } | null {
  let best: { i: number; t: number } | null = null;
  toks.forEach((p, i) => {
    const land = p.w.start - antic;
    if (land > t) return;
    if (skipWeak && (p.w.role === 'connective' || p.w.backing)) return;
    if (!best || land >= best.t) best = { i, t: land };
  });
  return best;
}

/** landing scale: pops from just under size to an overshoot, then settles (1 under reduce motion) */
export function punch(age: number, reduce: boolean, strength = 1, dur = 0.2): number {
  if (age < 0) return 0;
  if (reduce) return 1;
  return 0.8 + 0.2 * easeOutBack(age / dur, 2.4 * strength);
}

export interface TextOpts { key?: string; stroke?: string; sw?: number; split?: number; splitA?: string; splitB?: string; align?: CanvasTextAlign; sx?: number; sy?: number }
/** a word with its baseline at (x, y); stretch, RGB split and stroke; in mask mode only its coverage */
export function drawText(g: Ctx2D, text: string, x: number, y: number, cap: number, fill: string, mask: boolean, age: number, o: TextOpts = {}): void {
  const key = o.key ?? 'bebas';
  g.save();
  g.translate(x, y);
  if (o.sx !== undefined || o.sy !== undefined) g.scale(o.sx ?? 1, o.sy ?? 1);
  g.font = font(key, sizeForCap(key, cap));
  g.textAlign = o.align ?? 'left'; g.textBaseline = 'alphabetic';
  if (mask) { g.fillStyle = maskFill(age); g.fillText(text, 0, 0); g.restore(); return; }
  const sp = o.split ?? 0;
  if (sp > 0.5) {
    const ga = g.globalAlpha;
    g.globalAlpha = ga * 0.9;
    g.fillStyle = o.splitA ?? '#ff2a6d'; g.fillText(text, -sp, -sp * 0.25);
    g.fillStyle = o.splitB ?? '#2ad4ff'; g.fillText(text, sp, sp * 0.25);
    g.globalAlpha = ga;
  }
  if (o.stroke) { g.lineJoin = 'round'; g.lineWidth = o.sw ?? cap * 0.08; g.strokeStyle = o.stroke; g.strokeText(text, 0, 0); }
  g.fillStyle = fill; g.fillText(text, 0, 0);
  g.restore();
}

/** a helper canvas that rasterises in software when exporting (cached art must equal fresh art) */
export function helperCanvas(w: number, h: number): { c: HTMLCanvasElement | OffscreenCanvas; g: Ctx2D } {
  const c = makeCanvas(w, h);
  return { c, g: c.getContext('2d', { willReadFrequently: softCanvas() }) as Ctx2D };
}

export interface Clock { li: number; brk: { from: number; to: number; intro: boolean } | null; t0: number; age: number }
/** which line's scene is on at t (switching just before its first word lands), or an intro / instrumental break */
export function sceneClock(ly: Lyrics, t: number, lead: number, duration: number, gap = 5): Clock {
  const li = lineAt(ly, t + lead);
  if (li < 0) { const to = ly.lines[0] ? ly.lines[0].start - lead : duration; return { li, brk: { from: 0, to, intro: true }, t0: 0, age: t }; }
  const line = ly.lines[li], next = ly.lines[li + 1]?.start ?? Infinity;
  if (next - line.end >= gap && t > line.end + 1.2) { const from = line.end + 1.2; return { li, brk: { from, to: next - lead, intro: false }, t0: from, age: t - from }; }
  const t0 = line.start - lead;
  return { li, brk: null, t0, age: t - t0 };
}

/** decaying impact offset for an event at time `e` (index `k` seeds the direction) */
export function impact(t: number, e: number | undefined, k: number, amp: number, h: (a: number, b: number) => number): [number, number] {
  if (e === undefined || t < e || t - e > 0.35) return [0, 0];
  const f = Math.exp(-(t - e) / 0.06) * amp;
  return [(h(k, 1) - 0.5) * 2 * f, (h(k, 2) - 0.5) * 2 * f];
}

export const clamp = clamp01;

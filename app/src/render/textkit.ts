// Shared layout & timing kit (SPEC §7.3): used by every effect and the SDK.
import type { GlobalSettings, Line, Lyrics, Word } from '../types.ts';
import { font, sizeForCap, scratchCtx } from './sdf.ts';
import { VOICE_COLOURS } from '../lyrics/voices.ts';
import { translationState } from '../lyrics/translate.ts';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// ---------- easing ----------
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;
export const easeOutQuint = (t: number) => 1 - (1 - clamp01(t)) ** 5;
export const easeInCubic = (t: number) => clamp01(t) ** 3;
export const easeInOutQuad = (t: number) => { t = clamp01(t); return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; };
export const easeOutBack = (t: number, s = 1.70158) => { t = clamp01(t); return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2; };
export const easeOutBounce = (t: number) => {
  t = clamp01(t);
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};
/** damped wobble that settles to 0: e^(−k t)·cos(ω t) */
export const wobble = (t: number, k = 8, w = 22) => (t <= 0 ? 0 : Math.exp(-k * t) * Math.cos(w * t));

// ---------- graphemes & scripts ----------
const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
/** Split by grapheme cluster — never by code unit. */
export function graphemes(s: string): string[] {
  if (!seg) return Array.from(s);
  const out: string[] = [];
  for (const g of seg.segment(s)) out.push(g.segment);
  return out;
}
// Arabic, Syriac, N'Ko, Mongolian and the Indic blocks: splitting letters breaks shaping
const JOINING = /[؀-ۿ܀-ݏݐ-ݿ߀-߿ࡠ-ࣿऀ-෿᠀-᢯ﭐ-﷿ﹰ-﻿]/;
export function canSplitLetters(word: Word | string): boolean {
  return !JOINING.test(typeof word === 'string' ? word : word.display);
}
export const isRTLText = (s: string) => /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(s);
export const isCJKText = (s: string) => /[぀-ヿ㐀-䶿一-鿿]/.test(s);

export function applyCase(s: string, mode: GlobalSettings['caseMode']): string {
  return mode === 'upper' ? s.toUpperCase() : mode === 'lower' ? s.toLowerCase() : s;
}
/** display text without trailing punctuation clutter (for big type) */
export function cleanDisplay(w: Word, mode: GlobalSettings['caseMode'], keepPunct = false): string {
  let s = w.display;
  if (!keepPunct) s = s.replace(/^[("'“‘\[]+/, '').replace(/[)"'”’\],.;:]+$/, '');
  return applyCase(s, mode);
}

// ---------- timing ----------
export interface WordState {
  phase: 'before' | 'entering' | 'landed' | 'sung' | 'after';
  /** entrance progress 0..1 (1 exactly at the landing) */
  enter: number;
  /** progress through the word's own span 0..1 */
  sung: number;
  syllable: number;
  syllableProgress: number;
  /** seconds since the landing (negative before) */
  age: number;
}

export interface TimingOpts { anticipation: number; minRead: number }
export function timingOf(s: GlobalSettings): TimingOpts { return { anticipation: s.anticipationMs / 1000, minRead: s.minReadMs / 1000 }; }

/**
 * A word LANDS exactly at its onset (minus the global anticipation). The entrance begins
 * `entrance` seconds before the landing. After its span it stays "sung" until `holdUntil`.
 */
export function wordState(w: Word, t: number, entrance: number, opts: TimingOpts, holdUntil = Infinity): WordState {
  const land = w.start - opts.anticipation;
  const age = t - land;
  const dur = Math.max(0.06, w.end - w.start);
  let phase: WordState['phase'];
  if (age < -entrance) phase = 'before';
  else if (age < 0) phase = 'entering';
  else if (t < w.end) phase = 'landed';
  else if (t < Math.max(holdUntil, w.end + opts.minRead)) phase = 'sung';
  else phase = 'after';
  const enter = entrance > 0 ? clamp01((age + entrance) / entrance) : age >= 0 ? 1 : 0;
  const sung = clamp01((t - w.start) / dur);
  let syllable = 0, syllableProgress = 0;
  const st = w.syllableTimes;
  if (st && st.length) {
    if (t >= w.end) { syllable = st.length - 1; syllableProgress = 1; }
    else if (t >= st[0].start) {
      for (let i = 0; i < st.length; i++) if (t >= st[i].start) syllable = i;
      const s = st[syllable];
      syllableProgress = clamp01((t - s.start) / Math.max(0.03, s.end - s.start));
    }
  } else { syllableProgress = sung; }
  return { phase, enter, sung, syllable, syllableProgress, age };
}

/** Fraction (0..1) of the word's LETTERS revealed at t, advancing by syllable time (§8.0). */
export function letterReveal(w: Word, t: number): number {
  const st = w.syllableTimes;
  if (!st || st.length < 2) return clamp01((t - w.start) / Math.max(0.06, w.end - w.start));
  const total = st.reduce((s, x) => s + graphemes(x.text).length, 0) || 1;
  let done = 0;
  for (const s of st) {
    const n = graphemes(s.text).length;
    if (t >= s.end) { done += n; continue; }
    if (t > s.start) done += n * clamp01((t - s.start) / Math.max(0.03, s.end - s.start));
    break;
  }
  return clamp01(done / total);
}

/** index of the line being sung at t (the latest line whose start ≤ t + lead), or −1 */
export function lineAt(ly: Lyrics, t: number, lead = 0): number {
  let lo = 0, hi = ly.lines.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ly.lines[m].start <= t + lead) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
/** true while nothing is sung for ≥ `gap` seconds around t (instrumental break) */
export function inBreak(ly: Lyrics, t: number, gap = 4): { on: boolean; from: number; to: number } {
  const i = lineAt(ly, t);
  const from = i >= 0 ? ly.lines[i].end : 0;
  const to = i + 1 < ly.lines.length ? ly.lines[i + 1].start : Infinity;
  return { on: t >= from && to - from >= gap && t < to, from, to };
}

// ---------- measuring & rows ----------
export function setFont(g: Ctx2D, key: string, cap: number): void { g.font = font(key, sizeForCap(key, cap)); }
export function textWidth(text: string, key: string, cap: number): number {
  const g = scratchCtx();
  setFont(g, key, cap);
  return g.measureText(text).width;
}

export interface Placed { word: Word; text: string; x: number; y: number; w: number; cap: number; font: string; row: number }

/** Greedy rows of words, each row centred or left-aligned in `maxW`. Sizes come from `style(word)`. */
export function layoutRows(
  words: Word[], maxW: number,
  style: (w: Word) => { font: string; cap: number; text: string },
  opts: { gap?: number; lineGap?: number; align?: 'left' | 'center' | 'right'; maxRows?: number; rtl?: boolean } = {},
): { placed: Placed[]; width: number; height: number; rows: number } {
  const gapK = opts.gap ?? 0.32;
  const rows: Placed[][] = [[]];
  let x = 0;
  for (const w of words) {
    const s = style(w);
    const ww = textWidth(s.text, s.font, s.cap);
    const gap = s.cap * gapK;
    if (x > 0 && x + ww > maxW) { rows.push([]); x = 0; }
    rows[rows.length - 1].push({ word: w, text: s.text, x, y: 0, w: ww, cap: s.cap, font: s.font, row: rows.length - 1 });
    x += ww + gap;
  }
  let y = 0, width = 0;
  const placed: Placed[] = [];
  for (const row of rows) {
    if (!row.length) continue;
    const rowCap = Math.max(...row.map((p) => p.cap));
    const rw = row[row.length - 1].x + row[row.length - 1].w;
    width = Math.max(width, rw);
    y += rowCap;
    const off = opts.align === 'left' ? 0 : opts.align === 'right' ? maxW - rw : (maxW - rw) / 2;
    for (const p of row) {
      p.x = opts.rtl ? off + (rw - p.x - p.w) : p.x + off;
      p.y = y;
      placed.push(p);
    }
    y += rowCap * (opts.lineGap ?? 0.42);
  }
  return { placed, width, height: y, rows: rows.length };
}

/** Scale factor so `natural` width fits `target` (capped). */
export const fitScale = (natural: number, target: number, cap = Infinity) => Math.min(cap, target / Math.max(1e-6, natural));

// ---------- voices, translation ----------
export function voiceColour(w: Pick<Word, 'voice'>, settings: GlobalSettings, a: string, b: string, both?: string): string {
  if (!settings.voicePalette) return a;
  return w.voice === 'B' ? b : w.voice === 'all' ? both ?? a : a;
}
export { VOICE_COLOURS };

/** Shared subtitle for line.translation (effects without `ownsTranslation`). */
export function subtitle(g: Ctx2D, line: Line | undefined, t: number, settings: GlobalSettings, W: number, H: number, colour = '#ffffff'): void {
  if (!line) return;
  const st = translationState(line, t, settings.showTranslation);
  if (!st.translation) return;
  const fade = clamp01((t - line.start + 0.2) / 0.25) * clamp01((line.end + 0.6 - t) / 0.3);
  if (fade <= 0) return;
  const cap = Math.min(W, H) * 0.028;
  g.save();
  setFont(g, 'montserrat600', cap);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.globalAlpha = 0.6 * fade;
  const tw = g.measureText(st.translation).width;
  const k = Math.min(1, (W * 0.9) / tw);
  g.translate(W / 2, H * 0.93);
  g.scale(k, k);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(-tw / 2 - cap * 0.6, -cap * 1.45, tw + cap * 1.2, cap * 2.1);
  g.globalAlpha = 0.9 * fade;
  g.fillStyle = colour;
  g.fillText(st.translation, 0, 0);
  g.restore();
}

/** seconds → frames helper for entrance tables written at 60 fps */
export const fr = (frames: number) => frames / 60;

// Helpers shared by several effects: line layouts, world cameras, and the "text layer → shader" base class.
import type { GlobalSettings, Line, Lyrics, Word } from '../types.ts';
import { GLEffect } from './types.ts';
import type { Target } from '../render/glhost.ts';
import { FS_HEAD } from '../render/gl.ts';
import { type Ctx2D, textWidth, cleanDisplay, clamp01 } from '../render/textkit.ts';
import { type CamKey, buildKeys } from '../render/camera.ts';

export interface LW { w: Word; text: string; x: number; y: number; width: number; cap: number; font: string; row: number }
export interface LineLayout { line: Line; words: LW[]; width: number; height: number; rows: number; rowTops: number[]; rowCaps: number[] }

export interface LayoutOpts {
  maxW: number;
  cap: number;
  heroScale?: number; supportScale?: number; connScale?: number;
  fonts: { hero: string; support: string; conn: string; backing?: string };
  caseMode: GlobalSettings['caseMode'];
  gap?: number; lineGap?: number;
  align?: 'left' | 'center' | 'right';
  maxRows?: number;
  /** keep punctuation on the words */
  punct?: boolean;
}

/** Rows of words for one lyric line. Positions are relative to the block's top-left; y is the baseline. */
export function layoutLine(ly: Lyrics, line: Line, o: LayoutOpts): LineLayout {
  const ws = line.words.map((i) => ly.words[i]).filter(Boolean);
  const rtl = line.dir === 'rtl';
  const build = (capBase: number): LineLayout => {
    const rows: LW[][] = [[]];
    let x = 0;
    for (const w of ws) {
      const k = w.backing ? 0.55 * (o.supportScale ?? 1) : w.role === 'hero' ? o.heroScale ?? 1 : w.role === 'support' ? o.supportScale ?? 1 : o.connScale ?? 1;
      const cap = capBase * k;
      const font = w.backing ? o.fonts.backing ?? o.fonts.conn : w.role === 'hero' ? o.fonts.hero : w.role === 'support' ? o.fonts.support : o.fonts.conn;
      const text = cleanDisplay(w, o.caseMode, o.punct);
      const width = textWidth(text, font, cap);
      const gap = capBase * (o.gap ?? 0.3) * Math.max(0.6, k);
      if (x > 0 && x + width > o.maxW) { rows.push([]); x = 0; }
      rows[rows.length - 1].push({ w, text, x, y: 0, width, cap, font, row: rows.length - 1 });
      x += width + gap;
    }
    const words: LW[] = [];
    const rowTops: number[] = [], rowCaps: number[] = [];
    let y = 0, width = 0;
    for (const row of rows) {
      if (!row.length) continue;
      const rc = Math.max(...row.map((p) => p.cap));
      const rw = row[row.length - 1].x + row[row.length - 1].width;
      width = Math.max(width, rw);
      rowTops.push(y); rowCaps.push(rc);
      y += rc;
      for (const p of row) { p.y = y; if (rtl) p.x = rw - p.x - p.width; words.push(p); }
      y += rc * (o.lineGap ?? 0.4);
    }
    // alignment inside the block's own width
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row.length) continue;
      const rw = Math.max(...row.map((p) => p.x + p.width));
      const off = o.align === 'left' ? 0 : o.align === 'right' ? width - rw : (width - rw) / 2;
      for (const p of row) p.x += off;
    }
    return { line, words, width, height: y - (rowCaps[rowCaps.length - 1] ?? 0) * (o.lineGap ?? 0.4), rows: rowTops.length, rowTops, rowCaps };
  };
  let cap = o.cap;
  let L = build(cap);
  for (let i = 0; i < 8 && o.maxRows && L.rows > o.maxRows; i++) { cap *= 0.88; L = build(cap); }
  return L;
}

/** Mask colour for a word: R/B = coverage, G = time since onset (0..2 s) for per-word material animation. */
export function maskFill(age: number, level = 1): string {
  const v = Math.round(255 * clamp01(level));
  return `rgb(${v},${Math.round(clamp01(Math.max(0, age) / 2) * v)},${v})`;
}

/**
 * Camera keys that frame rectangles at given times (centre + zoom to fit). The camera HOLDS on a frame
 * and travels to the next one only during the last `move` seconds before it.
 */
export function frameKeys(frames: { t: number; x: number; y: number; w: number; h: number; margin?: number; ease?: CamKey['ease']; roll?: number; move?: number }[], W: number, H: number, move = 0.9): CamKey[] {
  const keys: CamKey[] = [];
  for (const f of frames) {
    const k: CamKey = { t: f.t, x: f.x + f.w / 2, y: f.y + f.h / 2, zoom: Math.min(W / Math.max(1, f.w), H / Math.max(1, f.h)) * (f.margin ?? 0.84), roll: f.roll ?? 0, ease: f.ease ?? 'inout' };
    const prev = keys[keys.length - 1];
    const mv = f.move ?? move;
    if (prev && k.t - prev.t > mv + 0.2) keys.push({ ...prev, t: k.t - mv, ease: 'hold' });
    keys.push(k);
  }
  return buildKeys(keys);
}

export const FS_MASK_BLIT = FS_HEAD + `uniform sampler2D uTex; void main(){ vec4 c = texture(uTex, vUv); o = vec4(c.rgb, 1.0); }`;
export const FS_BLIT = FS_HEAD + `uniform sampler2D uTex; void main(){ o = texture(uTex, vUv); }`;

/**
 * GPU effects built as "a 2D text layer shaded by a fragment shader". `paint` draws the layer
 * (and, in mask mode, every word white on black); `shade` runs the look.
 */
export abstract class TextShaderEffect extends GLEffect {
  protected abstract paint(t: number, g: Ctx2D, mask: boolean): void;
  protected abstract shade(t: number, target: Target, text: WebGLTexture): void;
  protected drawGL(t: number, target: Target, mask: boolean): void {
    const { c, g } = this.layer(mask ? 'mask' : 'text');
    if (mask) { g.fillStyle = '#000'; g.fillRect(0, 0, this.W, this.H); } else g.clearRect(0, 0, this.W, this.H);
    g.save();
    this.paint(t, g, mask);
    g.restore();
    const tex = this.scope.upload(mask ? 'mask' : 'text', c as HTMLCanvasElement, { mip: !mask });
    if (mask) this.scope.pass(this.scope.program(FS_MASK_BLIT), target, { uTex: tex });
    else this.shade(t, target, tex);
  }
}

/** Automatic adherence scoring: ID-mask IoU between the blockout and a segmentation of the result, plus flicker and palette metrics. */
import { hexToRgb } from '@blockout/core';
import { resize, type Image } from '@blockout/render';

/** A segmentation provider turns a result frame into a label image using the manifest palette (label = palette colour). */
export interface SegmentationProvider { id: string; name: string; segment(frame: Image, palette: { color: string; entityId: string }[], hint?: Image): Promise<Image> | Image }
const key = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
/** Exact for images that already are ID-like (tests, providers that return masks). */
export const paletteSegmenter: SegmentationProvider = { id: 'palette', name: 'Nearest palette colour', segment(frame, palette) {
  const cols = palette.map((p) => hexToRgb(p.color)), out = new Uint8ClampedArray(frame.data.length);
  for (let i = 0; i < frame.width * frame.height; i++) { const r = frame.data[i * 4], g = frame.data[i * 4 + 1], b = frame.data[i * 4 + 2]; let best = 0, bd = Infinity; for (let k = 0; k < cols.length; k++) { const d = (r - cols[k][0]) ** 2 + (g - cols[k][1]) ** 2 + (b - cols[k][2]) ** 2; if (d < bd) { bd = d; best = k; } } out[i * 4] = cols[best][0]; out[i * 4 + 1] = cols[best][1]; out[i * 4 + 2] = cols[best][2]; out[i * 4 + 3] = 255; }
  return { width: frame.width, height: frame.height, data: out }; } };
/** Model-free fallback: marks pixels that stand out from their row's median colour as "figure" and assigns them to the entity the
 *  blockout expects nearest to that pixel. It measures whether *something figure-like* is where a figure should be — a coarse
 *  staging check, not identity. Swap in a real segmenter (e.g. an HTTP SAM endpoint) through this interface for production scoring. */
export const saliencySegmenter: SegmentationProvider = { id: 'saliency', name: 'Row-median saliency (no model)', segment(frame, _palette, hint) {
  const { width: w, height: h } = frame, out = new Uint8ClampedArray(w * h * 4), H = hint && hint.width !== w ? resize(hint, w, h) : hint;
  for (let y = 0; y < h; y++) {
    const L: number[] = []; for (let x = 0; x < w; x += 2) { const i = (y * w + x) * 4; L.push(frame.data[i] * 0.3 + frame.data[i + 1] * 0.59 + frame.data[i + 2] * 0.11); } L.sort((a, b) => a - b); const med = L[L.length >> 1];
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, l = frame.data[i] * 0.3 + frame.data[i + 1] * 0.59 + frame.data[i + 2] * 0.11; out[i + 3] = 255; if (Math.abs(l - med) > 26 && H) { let found = -1; for (let r = 0; r <= 6 && found < 0; r += 2) for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = (yy * w + xx) * 4; if (H.data[j] + H.data[j + 1] + H.data[j + 2] > 90) { found = j; break; } } if (found >= 0) { out[i] = H.data[found]; out[i + 1] = H.data[found + 1]; out[i + 2] = H.data[found + 2]; } } }
  }
  return { width: w, height: h, data: out }; } };

export interface IoUResult { mean: number; perEntity: Record<string, number>; coverage: number }
/** IoU per entity between two label images (blockout id pass vs segmented result). Ground/sky are ignored. */
export function maskIoU(blockoutId: Image, seg: Image, palette: { color: string; entityId: string; kind?: string }[]): IoUResult {
  const B = seg.width !== blockoutId.width ? resize(seg, blockoutId.width, blockoutId.height) : seg, n = blockoutId.width * blockoutId.height;
  const ents = palette.filter((p) => !/ground|scatter|fx/.test(p.kind ?? p.entityId)), idx = new Map(ents.map((e, i) => { const c = hexToRgb(e.color); return [key(c[0], c[1], c[2]), i]; })), inter = new Float64Array(ents.length), uni = new Float64Array(ents.length); let fg = 0;
  for (let i = 0; i < n; i++) { const a = idx.get(key(blockoutId.data[i * 4], blockoutId.data[i * 4 + 1], blockoutId.data[i * 4 + 2])), b = idx.get(key(B.data[i * 4], B.data[i * 4 + 1], B.data[i * 4 + 2])); if (a !== undefined) { uni[a]++; fg++; } if (b !== undefined && b !== a) uni[b]++; if (a !== undefined && a === b) inter[a]++; }
  const perEntity: Record<string, number> = {}; let sum = 0, cnt = 0; ents.forEach((e, i) => { if (uni[i] > 0) { perEntity[e.entityId] = inter[i] / uni[i]; sum += perEntity[e.entityId]; cnt++; } });
  return { mean: cnt ? sum / cnt : 0, perEntity, coverage: fg / n };
}
/** Mean absolute luminance change between consecutive frames (0..1). Compare result vs blockout to isolate generator flicker. */
export function flicker(frames: Image[]): number { if (frames.length < 2) return 0; let acc = 0; for (let f = 1; f < frames.length; f++) { const a = frames[f - 1].data, b = frames[f].data; let d = 0; const n = a.length / 4; for (let i = 0; i < a.length; i += 16) d += Math.abs(a[i] + a[i + 1] + a[i + 2] - b[i] - b[i + 1] - b[i + 2]) / 765; acc += d / (n / 4); } return acc / (frames.length - 1); }
/** Mean distance (0..1) from each pixel to its nearest style-bible palette colour. */
export function paletteDistance(frame: Image, palette: string[]): number { const cols = palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).map(hexToRgb); if (!cols.length) return 0; let acc = 0, n = 0; for (let i = 0; i < frame.data.length; i += 4 * 7) { let bd = Infinity; for (const c of cols) bd = Math.min(bd, Math.hypot(frame.data[i] - c[0], frame.data[i + 1] - c[1], frame.data[i + 2] - c[2])); acc += bd / 441.7; n++; } return acc / n; }
export async function scoreTake(blockoutId: Image[], blockoutClay: Image[], result: Image[], palette: { color: string; entityId: string; kind?: string }[], stylePalette: string[], seg: SegmentationProvider = saliencySegmenter) {
  const picks = [0, Math.floor(result.length / 2), result.length - 1].filter((v, i, a) => v >= 0 && a.indexOf(v) === i), per: Record<string, number[]> = {}; let mean = 0, cov = 0;
  for (const f of picks) { const bi = Math.min(blockoutId.length - 1, Math.round((f / Math.max(1, result.length - 1)) * (blockoutId.length - 1))), r = maskIoU(blockoutId[bi], await seg.segment(result[f], palette, blockoutId[bi]), palette); mean += r.mean; cov += r.coverage; for (const [k, v] of Object.entries(r.perEntity)) (per[k] ??= []).push(v); }
  return { iou: mean / picks.length, coverage: cov / picks.length, perEntity: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length])), flicker: Math.max(0, flicker(result) - flicker(blockoutClay)), paletteDistance: paletteDistance(result[picks[1] ?? 0], stylePalette), segmenter: seg.id };
}

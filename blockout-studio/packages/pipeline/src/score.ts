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


/** Seeded segmentation (no model): the blockout masks seed per-entity colour models *learned from the result frame itself*
 *  (eroded mask interiors), the background model comes from outside the dilated masks, and pixels in a band around the expected
 *  silhouettes are assigned to the closest model (diagonal Gaussian) with a 3×3 majority clean-up. On-mark subjects read
 *  their own colours and score high; a subject that drifted leaves the band, its interior samples the background, and IoU drops. */
export const seededSegmenter: SegmentationProvider = { id: 'seeded', name: 'Blockout-seeded colour segmentation (no model)', segment(frame, palette: { color: string; entityId: string; kind?: string }[], hint) {
  const { width: w, height: h } = frame, n = w * h, out = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) out[i * 4 + 3] = 255;
  if (!hint) return { width: w, height: h, data: out };
  const H = hint.width !== w ? resize(hint, w, h) : hint, ents = palette.filter((p) => !/ground|scatter|fx/.test(p.kind ?? p.entityId)), cols = ents.map((e) => hexToRgb(e.color)), idx = new Map(cols.map((c, i) => [key(c[0], c[1], c[2]), i]));
  const lab = new Int16Array(n).fill(-1); for (let i = 0; i < n; i++) { const k = idx.get(key(H.data[i * 4], H.data[i * 4 + 1], H.data[i * 4 + 2])); if (k !== undefined) lab[i] = k; }
  const r = Math.max(1, Math.round(h / 90)), edge = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if ((x + 1 < w && lab[i] !== lab[i + 1]) || (y + 1 < h && lab[i] !== lab[i + w])) edge[i] = 1; }
  const dilate = (src: Uint8Array, rad: number) => { const a = new Uint8Array(n), b = new Uint8Array(n); for (let y = 0; y < h; y++) { let run = -1e9; for (let x = 0; x < w; x++) { if (src[y * w + x]) run = x; if (x - run <= rad) a[y * w + x] = 1; } run = 1e9; for (let x = w - 1; x >= 0; x--) { if (src[y * w + x]) run = x; if (run - x <= rad) a[y * w + x] = 1; } }
    for (let x = 0; x < w; x++) { let run = -1e9; for (let y = 0; y < h; y++) { if (a[y * w + x]) run = y; if (y - run <= rad) b[y * w + x] = 1; } run = 1e9; for (let y = h - 1; y >= 0; y--) { if (a[y * w + x]) run = y; if (run - y <= rad) b[y * w + x] = 1; } } return b; };
  const nearEdge = dilate(edge, r), fg = new Uint8Array(n); for (let i = 0; i < n; i++) fg[i] = lab[i] >= 0 ? 1 : 0; const band = dilate(fg, 4 * r);
  const BG = ents.length, K = BG + 1, ring = new Uint8Array(n); for (let i = 0; i < n; i++) ring[i] = band[i] && lab[i] < 0 && !nearEdge[i] ? 1 : 0;
  // per-model colour clusters (k-means, deterministic init by luminance quantiles) learned from the RESULT frame
  type Cl = { mu: number[]; v: number[] }[];
  const fit = (pick: (i: number) => boolean, k: number): Cl => {
    const px: number[][] = []; let seen = 0; for (let i = 0; i < n; i++) if (pick(i)) { seen++; if (px.length < 4000 || (seen * 2654435761) % 7 === 0) px.length < 6000 && px.push([frame.data[i * 4], frame.data[i * 4 + 1], frame.data[i * 4 + 2]]); }
    if (!px.length) return []; const L = (q: number[]) => q[0] * 0.3 + q[1] * 0.59 + q[2] * 0.11, sorted = [...px].sort((x, y) => L(x) - L(y)); k = Math.min(k, px.length);
    let mu = Array.from({ length: k }, (_, j) => [...sorted[Math.floor(((j + 0.5) / k) * sorted.length)]]), as = new Int32Array(px.length);
    for (let it = 0; it < 8; it++) { px.forEach((q, i) => { let best = 0, bd = Infinity; mu.forEach((m, j) => { const d = (q[0] - m[0]) ** 2 + (q[1] - m[1]) ** 2 + (q[2] - m[2]) ** 2; if (d < bd) { bd = d; best = j; } }); as[i] = best; }); mu = mu.map((m, j) => { const mem = px.filter((_, i) => as[i] === j); return mem.length ? [0, 1, 2].map((c) => mem.reduce((t, q) => t + q[c], 0) / mem.length) : m; }); }
    return mu.map((m, j) => { const mem = px.filter((_, i) => as[i] === j); return { mu: m, v: [0, 1, 2].map((c) => Math.max(60, mem.reduce((t, q) => t + (q[c] - m[c]) ** 2, 0) / Math.max(1, mem.length))) }; }).filter((_, j) => px.some((__, i) => as[i] === j));
  };
  const area = new Int32Array(BG), core = new Int32Array(BG); for (let i = 0; i < n; i++) if (lab[i] >= 0) { area[lab[i]]++; if (!nearEdge[i]) core[lab[i]]++; }
  const models: Cl[] = ents.map((_, m) => fit((i) => lab[i] === m && (core[m] >= 12 ? !nearEdge[i] : true), 3)); /* small or far subjects: no erosion */ models.push(fit((i) => ring[i] === 1, 5));
  const cost = (i: number, cl: Cl) => { let best = Infinity; for (const g of cl) { let s = 0; for (let c = 0; c < 3; c++) { const d = frame.data[i * 4 + c] - g.mu[c]; s += (d * d) / g.v[c] + Math.log(g.v[c]); } if (s < best) best = s; } return best; };
  const res = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) { if (!band[i]) continue; let best = BG, bc = models[BG].length ? cost(i, models[BG]) : Infinity; for (let m = 0; m < BG; m++) { if (!models[m].length) continue; const c = cost(i, models[m]); if (c < bc) { bc = c; best = m; } } res[i] = best === BG ? -1 : best; }
  const vote = new Int16Array(K); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!band[i]) continue; vote.fill(0); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { const v = res[yy * w + xx]; vote[v < 0 ? BG : v]++; } } let best = BG; for (let m = 0; m < K; m++) if (vote[m] > vote[best]) best = m; if (best !== BG) { const c = cols[best]; out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; } }
  return { width: w, height: h, data: out }; } };

export interface IoUResult { mean: number; perEntity: Record<string, number>; coverage: number }
/** IoU per entity between two label images (blockout id pass vs segmented result). Ground/sky are ignored. */
export function maskIoU(blockoutId: Image, seg: Image, palette: { color: string; entityId: string; kind?: string }[]): IoUResult {
  const B = seg.width !== blockoutId.width ? resize(seg, blockoutId.width, blockoutId.height) : seg, n = blockoutId.width * blockoutId.height;
  const ents = palette.filter((p) => !/ground|scatter|fx/.test(p.kind ?? p.entityId)), idx = new Map(ents.map((e, i) => { const c = hexToRgb(e.color); return [key(c[0], c[1], c[2]), i]; })), inter = new Float64Array(ents.length), uni = new Float64Array(ents.length); let fg = 0;
  for (let i = 0; i < n; i++) { const a = idx.get(key(blockoutId.data[i * 4], blockoutId.data[i * 4 + 1], blockoutId.data[i * 4 + 2])), b = idx.get(key(B.data[i * 4], B.data[i * 4 + 1], B.data[i * 4 + 2])); if (a !== undefined) { uni[a]++; fg++; } if (b !== undefined && b !== a) uni[b]++; if (a !== undefined && a === b) inter[a]++; }
  const perEntity: Record<string, number> = {}; let sum = 0, cnt = 0, csum = 0, ccnt = 0; ents.forEach((e, i) => { if (uni[i] > 0) { perEntity[e.entityId] = inter[i] / uni[i]; sum += perEntity[e.entityId]; cnt++; if (e.kind === 'character') { csum += perEntity[e.entityId]; ccnt++; } } });
  // headline = characters (staging is about where the people are); props count only when no character is in frame
  if (ccnt) return { mean: csum / ccnt, perEntity, coverage: fg / n };
  return { mean: cnt ? sum / cnt : 0, perEntity, coverage: fg / n };
}
/** Mean absolute luminance change between consecutive frames (0..1). Compare result vs blockout to isolate generator flicker. */
export function flicker(frames: Image[]): number { if (frames.length < 2) return 0; let acc = 0; for (let f = 1; f < frames.length; f++) { const a = frames[f - 1].data, b = frames[f].data; let d = 0; const n = a.length / 4; for (let i = 0; i < a.length; i += 16) d += Math.abs(a[i] + a[i + 1] + a[i + 2] - b[i] - b[i + 1] - b[i + 2]) / 765; acc += d / (n / 4); } return acc / (frames.length - 1); }
/** Mean distance (0..1) from each pixel to its nearest style-bible palette colour. */
export function paletteDistance(frame: Image, palette: string[]): number { const cols = palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).map(hexToRgb); if (!cols.length) return 0; let acc = 0, n = 0; for (let i = 0; i < frame.data.length; i += 4 * 7) { let bd = Infinity; for (const c of cols) bd = Math.min(bd, Math.hypot(frame.data[i] - c[0], frame.data[i + 1] - c[1], frame.data[i + 2] - c[2])); acc += bd / 441.7; n++; } return acc / n; }
export async function scoreTake(blockoutId: Image[], blockoutClay: Image[], result: Image[], palette: { color: string; entityId: string; kind?: string }[], stylePalette: string[], seg: SegmentationProvider = seededSegmenter) {
  const picks = [0, Math.floor(result.length / 2), result.length - 1].filter((v, i, a) => v >= 0 && a.indexOf(v) === i), per: Record<string, number[]> = {}; let mean = 0, cov = 0;
  for (const f of picks) { const bi = Math.min(blockoutId.length - 1, Math.round((f / Math.max(1, result.length - 1)) * (blockoutId.length - 1))), r = maskIoU(blockoutId[bi], await seg.segment(result[f], palette, blockoutId[bi]), palette); mean += r.mean; cov += r.coverage; for (const [k, v] of Object.entries(r.perEntity)) (per[k] ??= []).push(v); }
  return { iou: mean / picks.length, coverage: cov / picks.length, perEntity: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length])), flicker: Math.max(0, flicker(result) - flicker(blockoutClay)), paletteDistance: paletteDistance(result[picks[1] ?? 0], stylePalette), segmenter: seg.id };
}

// ---------- pluggable HTTP segmentation (e.g. a SAM endpoint) ----------
import { z } from 'zod';
import { decodePNG, encodePNG } from '@blockout/render';
export const HttpSegmenterConfigS = z.object({
  name: z.string().default('HTTP segmenter'), url: z.string().url(), headers: z.record(z.string()).default({}),
  /** Response path to a base64 PNG label image that uses the palette colours (white/black/any other colour = background). */
  maskPath: z.string().default('mask'),
});
export type HttpSegmenterConfig = z.infer<typeof HttpSegmenterConfigS>;
const b64e = (u: Uint8Array) => (typeof Buffer !== 'undefined' ? Buffer.from(u).toString('base64') : btoa(Array.from(u, (c) => String.fromCharCode(c)).join('')));
const b64d = (s: string) => (typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(s, 'base64')) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
/** Request body: { image: <png base64>, hint: <png base64 of the blockout ID mask>, palette: [{color, entityId}] }.
 *  Headers may use {{secret:NAME}} (resolved by the caller, i.e. the bridge keychain). */
export async function segmentViaHttp(raw: unknown, frame: Image, palette: { color: string; entityId: string }[], hint: Image | undefined, deps: { fetch?: typeof fetch; secret(name: string): Promise<string | undefined> }): Promise<Image> {
  const c = HttpSegmenterConfigS.parse(raw), headers: Record<string, string> = { 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(c.headers)) { let out = v; for (const m of v.matchAll(/\{\{secret:([^}]+)\}\}/g)) { const s = await deps.secret(m[1]); if (s === undefined) throw new Error(`secret "${m[1]}" is not set in the bridge keychain`); out = out.replace(m[0], s); } headers[k] = out; }
  const res = await (deps.fetch ?? fetch)(c.url, { method: 'POST', headers, body: JSON.stringify({ image: b64e(encodePNG(frame.data, frame.width, frame.height, 1)), hint: hint ? b64e(encodePNG(hint.data, hint.width, hint.height, 1)) : null, palette }) });
  if (!res.ok) throw new Error(`${c.name}: HTTP ${res.status}`);
  const json = await res.json(), mask = c.maskPath.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], json); if (typeof mask !== 'string') throw new Error(`${c.name}: no base64 mask at "${c.maskPath}"`);
  const img = decodePNG(b64d(mask)); return img.width === frame.width ? img : resize(img, frame.width, frame.height);
}
/** A SegmentationProvider backed by any async segment function (the studio passes one that calls the bridge). */
export const remoteSegmenter = (id: string, name: string, fn: (frame: Image, palette: { color: string; entityId: string }[], hint?: Image) => Promise<Image>): SegmentationProvider => ({ id, name, segment: fn });

/** Dependency-light PNG codec (RGBA8) that runs identically in Node and the browser. Deterministic output. */
import { unzlibSync, zlibSync } from 'fflate';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf: Uint8Array, start = 0, end = buf.length): number { let c = 0xffffffff; for (let i = start; i < end; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export function encodePNG(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 4): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
  const idat = zlibSync(raw, { level });
  const out = new Uint8Array(8 + 25 + 12 + idat.length + 12), dv = new DataView(out.buffer); let o = 0;
  out.set(SIG, 0); o = 8;
  const chunk = (type: string, data: Uint8Array) => { dv.setUint32(o, data.length); for (let i = 0; i < 4; i++) out[o + 4 + i] = type.charCodeAt(i); out.set(data, o + 8); dv.setUint32(o + 8 + data.length, crc32(out, o + 4, o + 8 + data.length)); o += 12 + data.length; };
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer); hv.setUint32(0, w); hv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  chunk('IHDR', ihdr); chunk('IDAT', idat); chunk('IEND', new Uint8Array(0));
  return out;
}
export interface Image { width: number; height: number; data: Uint8ClampedArray }
export function decodePNG(buf: Uint8Array): Image {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error('not a PNG');
  let o = 8, w = 0, h = 0, ct = 6, depth = 8; const parts: Uint8Array[] = []; let pal: Uint8Array | null = null;
  while (o < buf.length) {
    const len = dv.getUint32(o), type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]), data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = dv.getUint32(o + 8); h = dv.getUint32(o + 12); depth = buf[o + 16]; ct = buf[o + 17]; if (depth !== 8 || buf[o + 20] !== 0) throw new Error('unsupported PNG (need 8-bit, non-interlaced)'); }
    else if (type === 'PLTE') pal = data; else if (type === 'IDAT') parts.push(data); else if (type === 'IEND') break;
    o += 12 + len;
  }
  const total = parts.reduce((a, p) => a + p.length, 0), z = new Uint8Array(total); let q = 0; for (const p of parts) { z.set(p, q); q += p.length; }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : 1, stride = w * ch, raw = unzlibSync(z), px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[dst + x - ch] : 0, b = y ? px[dst + x - stride] : 0, c = x >= ch && y ? px[dst + x - stride - ch] : 0; let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v;
    }
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (ct === 6) { data[i * 4] = px[i * 4]; data[i * 4 + 1] = px[i * 4 + 1]; data[i * 4 + 2] = px[i * 4 + 2]; data[i * 4 + 3] = px[i * 4 + 3]; }
    else if (ct === 2) { data[i * 4] = px[i * 3]; data[i * 4 + 1] = px[i * 3 + 1]; data[i * 4 + 2] = px[i * 3 + 2]; data[i * 4 + 3] = 255; }
    else if (ct === 3 && pal) { const k = px[i] * 3; data[i * 4] = pal[k]; data[i * 4 + 1] = pal[k + 1]; data[i * 4 + 2] = pal[k + 2]; data[i * 4 + 3] = 255; }
    else { const g = px[i * ch]; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g; data[i * 4 + 3] = ct === 4 ? px[i * 2 + 1] : 255; }
  }
  return { width: w, height: h, data };
}
/** FNV-1a over bytes -> hex; fast content hash for determinism checks. */
export function hashBytes(b: ArrayLike<number>, seed = 2166136261): string { let h = seed >>> 0; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
/** Box-filter downscale (integer or fractional) for thumbnails / contact sheets. */
export function resize(img: Image, w: number, h: number): Image {
  const out = new Uint8ClampedArray(w * h * 4), sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)), y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy)); let r = 0, g = 0, b = 0, n = 0;
    for (let yy = y0; yy < y1 && yy < img.height; yy++) for (let xx = x0; xx < x1 && xx < img.width; xx++) { const i = (yy * img.width + xx) * 4; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++; }
    const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
  }
  return { width: w, height: h, data: out };
}
const FONT: Record<string, string> = { '0': '757', '1': '222', '2': '716', '3': '737', '4': '571', '5': '437', '6': '467', '7': '711', '8': '777', '9': '771' };
const GLYPH: Record<string, number[]> = { '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [7, 1, 7, 4, 7], '3': [7, 1, 7, 1, 7], '4': [5, 5, 7, 1, 1], '5': [7, 4, 7, 1, 7], '6': [7, 4, 7, 5, 7], '7': [7, 1, 1, 1, 1], '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 7], '.': [0, 0, 0, 0, 2], ':': [0, 2, 0, 2, 0], 's': [0, 3, 6, 1, 6], '-': [0, 0, 7, 0, 0], ' ': [0, 0, 0, 0, 0] };
void FONT;
/** Stamp tiny 3x5 digits (frame numbers / timecodes) without needing a canvas. */
export function stamp(img: Image, text: string, x: number, y: number, scale = 2, color: [number, number, number] = [255, 255, 255]): void {
  for (const chr of text) {
    const g = GLYPH[chr] ?? GLYPH[' '];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r] & (4 >> c)) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const px = x + c * scale + dx, py = y + r * scale + dy; if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue; const i = (py * img.width + px) * 4; img.data[i] = color[0]; img.data[i + 1] = color[1]; img.data[i + 2] = color[2]; img.data[i + 3] = 255;
    }
    x += 4 * scale;
  }
}

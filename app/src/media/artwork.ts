// Artwork palette (SPEC §9.5): k-means (k = 6) in Lab on a 64×64 downsample of the cover.
import { makeCanvas } from '../render/sdf.ts';
import { rgbToHex } from '../render/gl.ts';

export interface ArtPalette { dominant: string; darkest: string; lightest: string; vivid1: string; vivid2: string; all: string[] }

function rgb2lab(r: number, g: number, b: number): [number, number, number] {
  const f = (c: number) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
  const R = f(r), G = f(g), B = f(b);
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, y = 0.2126 * R + 0.7152 * G + 0.0722 * B, z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const h = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * h(y) - 16, 500 * (h(x) - h(y)), 200 * (h(y) - h(z))];
}

/** Deterministic k-means: centres are seeded evenly along the lightness-sorted pixels. */
export function paletteFromPixels(rgba: Uint8ClampedArray | Uint8Array, k = 6): ArtPalette {
  const n = rgba.length >> 2;
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const [L, a, b] = rgb2lab(rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255); lab[i * 3] = L; lab[i * 3 + 1] = a; lab[i * 3 + 2] = b; }
  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => lab[x * 3] - lab[y * 3]);
  const cen = new Float32Array(k * 3);
  for (let c = 0; c < k; c++) { const i = order[Math.floor(((c + 0.5) / k) * n)]; cen.set(lab.subarray(i * 3, i * 3 + 3), c * 3); }
  const asg = new Uint8Array(n);
  for (let it = 0; it < 12; it++) {
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (lab[i * 3] - cen[c * 3]) ** 2 + (lab[i * 3 + 1] - cen[c * 3 + 1]) ** 2 + (lab[i * 3 + 2] - cen[c * 3 + 2]) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      asg[i] = best;
    }
    const sum = new Float64Array(k * 3), cnt = new Float64Array(k);
    for (let i = 0; i < n; i++) { const c = asg[i]; cnt[c]++; sum[c * 3] += lab[i * 3]; sum[c * 3 + 1] += lab[i * 3 + 1]; sum[c * 3 + 2] += lab[i * 3 + 2]; }
    for (let c = 0; c < k; c++) if (cnt[c]) { cen[c * 3] = sum[c * 3] / cnt[c]; cen[c * 3 + 1] = sum[c * 3 + 1] / cnt[c]; cen[c * 3 + 2] = sum[c * 3 + 2] / cnt[c]; }
  }
  // mean RGB per cluster
  const rs = new Float64Array(k * 3), cnt = new Float64Array(k);
  for (let i = 0; i < n; i++) { const c = asg[i]; cnt[c]++; rs[c * 3] += rgba[i * 4]; rs[c * 3 + 1] += rgba[i * 4 + 1]; rs[c * 3 + 2] += rgba[i * 4 + 2]; }
  const cl = Array.from({ length: k }, (_, c) => ({
    hex: rgbToHex(rs[c * 3] / (cnt[c] || 1) / 255, rs[c * 3 + 1] / (cnt[c] || 1) / 255, rs[c * 3 + 2] / (cnt[c] || 1) / 255),
    L: cen[c * 3], chroma: Math.hypot(cen[c * 3 + 1], cen[c * 3 + 2]), n: cnt[c],
  })).filter((c) => c.n > 0);
  const by = <T,>(arr: T[], f: (x: T) => number) => arr.slice().sort((x, y) => f(y) - f(x));
  const vivid = by(cl, (c) => c.chroma * (0.4 + Math.min(1, c.n / (n * 0.04))));
  return {
    dominant: by(cl, (c) => c.n)[0].hex, darkest: by(cl, (c) => -c.L)[0].hex, lightest: by(cl, (c) => c.L)[0].hex,
    vivid1: vivid[0].hex, vivid2: (vivid[1] ?? vivid[0]).hex, all: by(cl, (c) => c.n).map((c) => c.hex),
  };
}

export function paletteFromImage(img: CanvasImageSource): ArtPalette {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  g.drawImage(img, 0, 0, 64, 64);
  return paletteFromPixels(g.getImageData(0, 0, 64, 64).data);
}

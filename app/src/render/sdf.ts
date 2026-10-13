// Text → signed-distance-field atlas (exact Euclidean distance transform, Felzenszwalb & Huttenlocher).

export const FONTS = {
  serif: { family: 'LE Playfair', url: 'fonts/playfair-900.ttf', weight: '900' },
  cond: { family: 'LE Oswald', url: 'fonts/oswald-700.ttf', weight: '700' },
  semi: { family: 'LE BarlowSemi', url: 'fonts/barlowsemicond-800.ttf', weight: '800' },
  barlow7: { family: 'LE Barlow7', url: 'fonts/barlow-700.ttf', weight: '700' },
  barlow5: { family: 'LE Barlow5', url: 'fonts/barlow-500.ttf', weight: '500' },
  condItalic: { family: 'LE BarlowCondItalic', url: 'fonts/barlowc-800i.ttf', weight: '800' },
  mont8: { family: 'LE Mont8', url: 'fonts/montserrat-800.ttf', weight: '800' },
  mont6: { family: 'LE Mont6', url: 'fonts/montserrat-600.ttf', weight: '600' },
  mont3: { family: 'LE Mont3', url: 'fonts/montserrat-300.ttf', weight: '300' },
  stencil: { family: 'LE Stencil', url: 'fonts/allerta-stencil.ttf', weight: '400' },
  caslon: { family: 'LE Caslon', url: 'fonts/libre-caslon-700.ttf', weight: '700' },
  mono: { family: 'LE Mono', url: 'fonts/plexmono-500.ttf', weight: '500' }
} as const;
export type FontKey = keyof typeof FONTS;

let fontsReady: Promise<void> | null = null;
export function loadFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    await Promise.all(Object.values(FONTS).map(async f => {
      const ff = new FontFace(f.family, `url(${new URL(f.url, document.baseURI).href})`, { weight: f.weight });
      await ff.load(); document.fonts.add(ff);
    }));
  })();
  return fontsReady;
}

const mctx = (typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null)!;
export const fontCSS = (k: FontKey, px: number) => `${FONTS[k].weight} ${px}px "${FONTS[k].family}"`;
const capCache = new Map<string, number>();
export function capRatio(k: FontKey): number {
  if (!capCache.has(k)) { mctx.font = fontCSS(k, 200); capCache.set(k, mctx.measureText('H').actualBoundingBoxAscent / 200); }
  return capCache.get(k)!;
}
/** Advance width of `text` at the given cap height. */
export function measureCap(k: FontKey, cap: number, text: string): number { mctx.font = fontCSS(k, cap / capRatio(k)); return mctx.measureText(text).width; }

function edt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt2(g: Float64Array, w: number, h: number) {
  const n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = d[x]; }
}

export interface SDFGlyphs { w: number; h: number; data: Uint8Array; base: number; x0: number; adv: number; acap: number; spread: number; ax: number; ay: number }

/** Rasterise a string at `acap` px cap height; return an SDF (128 = edge, < 128 inside). */
export function makeSDF(text: string, font: FontKey, acap: number, spread: number): SDFGlyphs {
  const px = acap / capRatio(font);
  mctx.font = fontCSS(font, px);
  const m = mctx.measureText(text);
  const pad = spread + 4;
  const asc = Math.ceil(Math.max(m.actualBoundingBoxAscent, acap)), desc = Math.ceil(Math.max(m.actualBoundingBoxDescent, acap * 0.28));
  const left = Math.ceil(Math.max(0, m.actualBoundingBoxLeft));
  const w = Math.max(8, Math.ceil(m.actualBoundingBoxRight + left) + pad * 2), h = asc + desc + pad * 2;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.font = fontCSS(font, px); c.fillStyle = '#fff';
  c.fillText(text, pad + left, pad + asc);
  const img = c.getImageData(0, 0, w, h).data;
  const N = w * h, a = new Float64Array(N), b = new Float64Array(N);
  for (let i = 0; i < N; i++) { const on = img[i * 4 + 3] > 127; a[i] = on ? 0 : 1e20; b[i] = on ? 1e20 : 0; }
  edt2(a, w, h); edt2(b, w, h);
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const sd = Math.sqrt(a[i]) - Math.sqrt(b[i]); out[i] = Math.round(Math.min(1, Math.max(0, 0.5 + sd / (2 * spread))) * 255); }
  return { w, h, data: out, base: pad + asc, x0: pad + left, adv: m.width, acap, spread, ax: 0, ay: 0 };
}

/** Shelf-pack SDFs into one atlas (width 4096). Returns null if it would exceed maxH. */
export function packAtlas(items: SDFGlyphs[], maxH: number): { data: Uint8Array; w: number; h: number } | null {
  const W = 4096; let x = 0, y = 0, rowH = 0;
  for (const s of items) { if (x + s.w > W) { x = 0; y += rowH + 2; rowH = 0; } s.ax = x; s.ay = y; x += s.w + 2; rowH = Math.max(rowH, s.h); }
  const H = y + rowH; if (H > maxH) return null;
  const data = new Uint8Array(W * Math.max(1, H)).fill(255);
  for (const s of items) for (let r = 0; r < s.h; r++) data.set(s.data.subarray(r * s.w, (r + 1) * s.w), (s.ay + r) * W + s.ax);
  return { data, w: W, h: Math.max(1, H) };
}

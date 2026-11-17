// Fonts, cap-height metrics and signed distance fields (SPEC §7).

export interface FontDef { family: string; file: string; weight: string; style?: string; range?: string }

export const FONTS = {
  playfair: { family: 'LE Playfair', file: 'PlayfairDisplay.ttf', weight: '900', range: '400 900' },
  oswald: { family: 'LE Oswald', file: 'Oswald.ttf', weight: '700', range: '200 700' },
  barlowSemi: { family: 'LE Barlow Semi', file: 'BarlowSemiCondensed-ExtraBold.ttf', weight: '800' },
  barlow: { family: 'LE Barlow', file: 'Barlow-Bold.ttf', weight: '700' },
  barlowMed: { family: 'LE Barlow', file: 'Barlow-Medium.ttf', weight: '500' },
  barlowCondIt: { family: 'LE Barlow Cond', file: 'BarlowCondensed-ExtraBoldItalic.ttf', weight: '800', style: 'italic' },
  montserrat: { family: 'LE Montserrat', file: 'Montserrat.ttf', weight: '800', range: '100 900' },
  montserrat600: { family: 'LE Montserrat', file: 'Montserrat.ttf', weight: '600', range: '100 900' },
  montserrat300: { family: 'LE Montserrat', file: 'Montserrat.ttf', weight: '300', range: '100 900' },
  stencil: { family: 'LE Stencil', file: 'AllertaStencil.ttf', weight: '400' },
  caslon: { family: 'LE Caslon', file: 'LibreCaslonText.ttf', weight: '700', range: '400 700' },
  mono: { family: 'LE Plex Mono', file: 'IBMPlexMono-Medium.ttf', weight: '500' },
  pacifico: { family: 'LE Pacifico', file: 'Pacifico.ttf', weight: '400' },
  vt323: { family: 'LE VT323', file: 'VT323.ttf', weight: '400' },
  bebas: { family: 'LE Bebas', file: 'BebasNeue.ttf', weight: '400' },
  abril: { family: 'LE Abril', file: 'AbrilFatface.ttf', weight: '400' },
  rubik: { family: 'LE Rubik Mono', file: 'RubikMonoOne.ttf', weight: '400' },
  elite: { family: 'LE Special Elite', file: 'SpecialElite.ttf', weight: '400' },
} satisfies Record<string, FontDef>;

export type FontKey = keyof typeof FONTS;
const userFonts = new Map<string, FontDef>();

export function fontDef(key: string): FontDef { return userFonts.get(key) ?? (FONTS as Record<string, FontDef>)[key] ?? FONTS.montserrat; }

/** CSS font shorthand for canvas: `font('oswald', 120)` */
export function font(key: string, px: number): string {
  const f = fontDef(key);
  return `${f.style ?? 'normal'} ${f.weight} ${px}px "${f.family}", system-ui, sans-serif`;
}

let loaded: Promise<void> | null = null;
/** Load every bundled .ttf (no runtime CDN). */
export function loadFonts(base = './fonts/'): Promise<void> {
  if (loaded) return loaded;
  const seen = new Set<string>();
  const jobs: Promise<unknown>[] = [];
  for (const f of Object.values(FONTS) as FontDef[]) {
    const id = f.family + '|' + f.file;
    if (seen.has(id)) continue;
    seen.add(id);
    const face = new FontFace(f.family, `url(${base}${f.file})`, { weight: f.range ?? f.weight, style: f.style ?? 'normal' });
    jobs.push(face.load().then((ff) => { (document.fonts as FontFaceSet & { add(f: FontFace): void }).add(ff); }).catch((e) => console.warn('font failed', f.file, e)));
  }
  loaded = Promise.all(jobs).then(() => { capCache.clear(); });
  return loaded;
}

/** Register a user font (role override). */
export async function addUserFont(key: string, data: ArrayBuffer, weight = '400'): Promise<void> {
  const family = `LE User ${key}`;
  const ff = await new FontFace(family, data, { weight }).load();
  (document.fonts as FontFaceSet & { add(f: FontFace): void }).add(ff);
  userFonts.set(key, { family, file: '', weight });
  capCache.clear();
}

let scratch: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
export function scratchCtx(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  if (!scratch) scratch = makeCanvas(8, 8).getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  return scratch;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}

const capCache = new Map<string, number>();
/** Cap height per px of font size; all layout is in cap-height units. */
export function capRatio(key: string): number {
  let r = capCache.get(key);
  if (r === undefined) {
    const g = scratchCtx();
    g.font = font(key, 200);
    const m = g.measureText('H');
    r = (m.actualBoundingBoxAscent || 140) / 200;
    capCache.set(key, r);
  }
  return r;
}
/** font size (px) for a given cap height */
export const sizeForCap = (key: string, cap: number) => cap / capRatio(key);
/** width of `text` at cap height `cap` */
export function measureCap(text: string, key: string, cap: number): number {
  const g = scratchCtx();
  g.font = font(key, sizeForCap(key, cap));
  return g.measureText(text).width;
}

// ---------- exact Euclidean distance transform (Felzenszwalb & Huttenlocher) ----------
const INF = 1e20;
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s: number;
    do {
      const p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
    } while (s <= z[k] && --k >= 0);
    k++;
    v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

function edt(grid: Float64Array, w: number, h: number): void {
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
}

/** Euclidean distance (px) from each inside pixel to the nearest outside pixel (0 outside). */
export function insideDistance(alpha: Uint8Array | Uint8ClampedArray, w: number, h: number, stride = 4, offset = 3, thr = 128): Float32Array {
  const n = w * h, grid = new Float64Array(n);
  for (let i = 0; i < n; i++) grid[i] = alpha[i * stride + offset] >= thr ? INF : 0;
  edt(grid, w, h);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sqrt(grid[i]);
  return out;
}

export interface SDF { data: Uint8Array; w: number; h: number; spread: number }

/** Signed distance field from an alpha mask (0..255). 128 = edge; ±spread px maps to 0..255 (inside > 128). */
export function sdfFromAlpha(alpha: Uint8Array | Uint8ClampedArray, w: number, h: number, spread = 22, stride = 1, offset = 0): SDF {
  const n = w * h;
  const outside = new Float64Array(n), inside = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = alpha[i * stride + offset] / 255;
    // anti-aliased edges: sub-pixel offsets
    if (a >= 1) { outside[i] = 0; inside[i] = INF; }
    else if (a <= 0) { outside[i] = INF; inside[i] = 0; }
    else { const d = 0.5 - a; outside[i] = d > 0 ? d * d : 0; inside[i] = d < 0 ? d * d : 0; }
  }
  edt(outside, w, h);
  edt(inside, w, h);
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.sqrt(inside[i]) - Math.sqrt(outside[i]); // > 0 inside
    data[i] = Math.max(0, Math.min(255, Math.round(128 + (d / spread) * 127)));
  }
  return { data, w, h, spread };
}

/** SDF of a string. The glyph box is padded by `spread`; `ox`,`oy` give the baseline origin inside it. */
export function makeSDF(text: string, key: string, capPx: number, spread = 22): SDF & { ox: number; oy: number; advance: number } {
  const g = scratchCtx();
  const px = sizeForCap(key, capPx);
  g.font = font(key, px);
  const m = g.measureText(text);
  const left = Math.ceil(m.actualBoundingBoxLeft || 0), right = Math.ceil(m.actualBoundingBoxRight || m.width);
  const asc = Math.ceil(m.actualBoundingBoxAscent || capPx), desc = Math.ceil(m.actualBoundingBoxDescent || 0);
  const w = left + right + 2 * spread + 2, h = asc + desc + 2 * spread + 2;
  const c = g.canvas;
  if (c.width < w) c.width = w;
  if (c.height < h) c.height = h;
  g.clearRect(0, 0, c.width, c.height);
  g.font = font(key, px);
  g.fillStyle = '#fff';
  g.textBaseline = 'alphabetic';
  const ox = left + spread + 1, oy = asc + spread + 1;
  g.fillText(text, ox, oy);
  const img = g.getImageData(0, 0, w, h);
  return { ...sdfFromAlpha(img.data, w, h, spread, 4, 3), ox, oy, advance: m.width };
}

/** Shelf packing into a fixed-width atlas. */
export class ShelfPacker {
  private x = 0; private y = 0; private rowH = 0;
  constructor(readonly width = 4096, public height = 0) {}
  add(w: number, h: number): { x: number; y: number } {
    if (this.x + w > this.width) { this.x = 0; this.y += this.rowH; this.rowH = 0; }
    const pos = { x: this.x, y: this.y };
    this.x += w; this.rowH = Math.max(this.rowH, h);
    this.height = Math.max(this.height, this.y + this.rowH);
    return pos;
  }
}

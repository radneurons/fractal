// Motion toolkit: timing, easing, springs, noise, colour and type helpers.
// Everything here is a pure function of its inputs so any frame can be
// rendered in isolation (and in parallel) with identical results.

export const W = 1920;
export const H = 1080;
export const TAU = Math.PI * 2;

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => clamp((x - a) / (b - a));
export const remap = (x, a, b, c, d, e = ease.linear) => lerp(c, d, e(invLerp(a, b, x)));
export const fract = (x) => x - Math.floor(x);
export const mix2 = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];

// ---------------------------------------------------------------- easing
export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQuart: (t) => 1 - (1 - t) ** 4,
  inQuart: (t) => t ** 4,
  inOutQuart: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  outQuint: (t) => 1 - (1 - t) ** 5,
  inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
  inExpo: (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutExpo: (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
  outBack: (t, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2,
  inBack: (t, s = 1.70158) => (s + 1) * t ** 3 - s * t * t,
  outCirc: (t) => Math.sqrt(1 - (t - 1) ** 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

// CSS-style cubic-bezier, solved with Newton + bisection fallback.
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x, d = dx(t);
      if (Math.abs(e) < 1e-6) return sy(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}
// House curves: a snappy "motion designer" ease-out and a weighty in-out.
ease.snap = bezier(0.16, 1, 0.3, 1);
ease.swift = bezier(0.65, 0, 0.35, 1);
ease.anticipate = bezier(0.5, -0.35, 0.3, 1.25);

// Under-damped spring step response, 0 -> 1 with overshoot.
export function spring(t, freq = 3.2, damping = 0.32) {
  if (t <= 0) return 0;
  const w = TAU * freq;
  const wd = w * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
}

// Progress of t through [a, b] with an easing applied.
export const seg = (t, a, b, e = ease.linear) => e(invLerp(a, b, t));
// In/out envelope: rises over [a, a+i], holds, falls over [b-o, b].
export const env = (t, a, b, i = 0.2, o = 0.2, ei = ease.outCubic, eo = ease.inCubic) =>
  Math.min(seg(t, a, a + i, ei), 1 - seg(t, b - o, b, eo));

// ---------------------------------------------------------------- random & noise
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u) * 2 - 1;
}
export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy) * 2 - 1;
}
export function fbm2(x, y, oct = 4) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    v += a * noise2(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return v;
}

// ---------------------------------------------------------------- colour
export const C = {
  bg0: '#03040a',
  bg1: '#0a1124',
  ink: '#eef1f8',
  mute: '#7c849a',
  dim: '#3a4157',
  cyan: '#5cf2ff',
  amber: '#ffb547',
  magenta: '#ff3d8b',
  violet: '#8b6bff',
};
export function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(h, a = 1) {
  const [r, g, b] = hexToRgb(h);
  return `rgba(${r},${g},${b},${clamp(a)})`;
}
export function mixHex(h1, h2, t, a = 1) {
  const p = hexToRgb(h1), q = hexToRgb(h2);
  return `rgba(${Math.round(lerp(p[0], q[0], t))},${Math.round(lerp(p[1], q[1], t))},${Math.round(lerp(p[2], q[2], t))},${clamp(a)})`;
}
// Cyan -> violet -> magenta -> amber spectrum used for "harmonic" colouring.
const SPECTRUM = ['#5cf2ff', '#8b6bff', '#ff3d8b', '#ffb547'];
export function spectrum(t, a = 1) {
  t = clamp(t) * (SPECTRUM.length - 1);
  const i = Math.min(SPECTRUM.length - 2, Math.floor(t));
  return mixHex(SPECTRUM[i], SPECTRUM[i + 1], t - i, a);
}

// ---------------------------------------------------------------- strings
// Exact plucked-string solution: a triangle of height h released at x = p,
// decomposed into normal modes, each with its own damping.
export function pluck(x, tt, p = 0.5, h = 1, freq = 2, damp = 1.5, modes = 14) {
  if (tt < 0 || h === 0) return 0;
  let y = 0;
  const k = 2 / (Math.PI * Math.PI * p * (1 - p));
  for (let n = 1; n <= modes; n++) {
    const b = (k * Math.sin(n * Math.PI * p)) / (n * n);
    y += b * Math.sin(n * Math.PI * x) * Math.cos(TAU * freq * n * tt) * Math.exp(-damp * Math.sqrt(n) * tt);
  }
  return h * y;
}

// Triangle shape of a string pulled aside at x = p (the moment before release).
export const tri = (x, p) => (x < p ? x / p : (1 - x) / (1 - p));

// Pulled, held, released: anticipation into the exact plucked-string motion.
export function pluckWithPull(x, tt, tRelease, pull = 0.28, p = 0.5, h = 1, freq = 2, damp = 1.5) {
  if (tt < tRelease) return h * tri(x, p) * ease.inOutCubic(seg(tt, tRelease - pull, tRelease));
  return pluck(x, tt - tRelease, p, h, freq, damp);
}

// Struck string (velocity impulse at x = p): starts flat, so it can be
// triggered on a resting string without a visual pop.
export function strike(x, tt, p = 0.5, h = 1, freq = 2, damp = 1.5, modes = 14) {
  if (tt < 0 || h === 0) return 0;
  let y = 0;
  for (let n = 1; n <= modes; n++) {
    const b = Math.sin(n * Math.PI * p) / n;
    y += b * Math.sin(n * Math.PI * x) * Math.sin(TAU * freq * n * tt) * Math.exp(-damp * Math.sqrt(n) * tt);
  }
  return h * y;
}

// ---------------------------------------------------------------- typography
export const F = {
  black: 'IDBlack',
  bold: 'IDBold',
  medium: 'IDMedium',
  light: 'IDLight',
  serif: 'ISerif',
  serifI: 'ISerifItalic',
  mono: 'JBMono',
  monoB: 'JBMonoBold',
  math: 'STIXItalic',
  mathR: 'STIX',
};

// Offscreen canvas factory (Node: @napi-rs/canvas, browser: DOM canvas).
let canvasFactory = null;
export const setCanvasFactory = (fn) => (canvasFactory = fn);
export const makeCanvas = (w, h) => canvasFactory(w, h);
export const font = (size, fam) => `${size}px ${fam}`;

// Measure a string with manual tracking (em units).
export function measure(ctx, str, size, fam, track = 0) {
  ctx.font = font(size, fam);
  const w = ctx.measureText(str).width;
  return w + Math.max(0, str.length - 1) * track * size;
}

// Draw text glyph-by-glyph so every character can be animated. `fn(i, ch)`
// may return {dx, dy, a, s} offsets for each glyph.
export function glyphs(ctx, str, x, y, size, fam, color, { track = 0, align = 'left', fn = null } = {}) {
  ctx.font = font(size, fam);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const total = measure(ctx, str, size, fam, track);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const base = ctx.globalAlpha;
  const chars = [...str];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const w = ctx.measureText(ch).width;
    const o = fn ? fn(i, ch, chars.length) : null;
    if (!o || o.a === undefined || o.a > 0.001) {
      ctx.globalAlpha = base * (o && o.a !== undefined ? o.a : 1);
      ctx.fillStyle = (o && o.color) || color;
      if (o && o.s !== undefined && o.s !== 1) {
        ctx.save();
        ctx.translate(cx + w / 2 + (o.dx || 0), y + (o.dy || 0));
        ctx.scale(o.s, o.s);
        ctx.fillText(ch, -w / 2, 0);
        ctx.restore();
      } else {
        ctx.fillText(ch, cx + ((o && o.dx) || 0), y + ((o && o.dy) || 0));
      }
    }
    cx += w + track * size;
  }
  ctx.globalAlpha = base;
  return total;
}

// "Decode" effect: unresolved glyphs cycle through a technical charset.
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*/<>=+';
export function decode(str, p, seed = 1, t = 0) {
  const chars = [...str];
  const n = chars.length;
  return chars
    .map((ch, i) => {
      if (ch === ' ') return ' ';
      const local = p * (n + 6) - i;
      if (local >= 6) return ch;
      if (local <= 0) return '';
      return CHARSET[Math.floor(hash(i * 13.1 + seed + Math.floor(t * 30)) * CHARSET.length)];
    })
    .join('');
}

// Masked slide-up reveal for a single line. p: 0..1 in, q: 0..1 out.
export function maskLine(ctx, str, x, y, size, fam, color, p, q = 0, opts = {}) {
  if (p <= 0 || q >= 1) return 0;
  const { track = 0, align = 'left', lineH = size * 1.25 } = opts;
  const w = measure(ctx, str, size, fam, track);
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0 - size, y - size * 1.05, w + size * 2, lineH + size * 0.1);
  ctx.clip();
  const dy = (1 - ease.snap(p)) * size * 1.15 - ease.inCubic(q) * size * 1.15;
  glyphs(ctx, str, x, y + dy, size, fam, color, { track, align });
  ctx.restore();
  return w;
}

// Per-word staggered masked reveal.
export function maskWords(ctx, str, x, y, size, fam, color, t, t0, opts = {}) {
  const { track = 0, stagger = 0.045, dur = 0.55, out = Infinity, outDur = 0.3 } = opts;
  const words = str.split(' ');
  ctx.font = font(size, fam);
  const space = ctx.measureText(' ').width + track * size;
  let cx = x;
  words.forEach((wd, i) => {
    const p = seg(t, t0 + i * stagger, t0 + i * stagger + dur);
    const q = seg(t, out + i * stagger * 0.6, out + i * stagger * 0.6 + outDur);
    const w = maskLine(ctx, wd, cx, y, size, fam, color, p, q, { track });
    cx += (w || measure(ctx, wd, size, fam, track)) + space;
  });
}

// ---------------------------------------------------------------- geometry
export function polyline(ctx, pts, close = false) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) ctx.moveTo(p[0], p[1]);
    else ctx.lineTo(p[0], p[1]);
  }
  if (close) ctx.closePath();
}

// Draw only the first fraction `p` of a polyline (for draw-on strokes).
export function partial(pts, p, from = 0) {
  if (p >= 1 && from <= 0) return pts;
  const n = pts.length - 1;
  const a = clamp(from) * n, b = clamp(p) * n;
  if (b <= a) return [];
  const out = [];
  const ia = Math.floor(a), ib = Math.floor(b);
  out.push(mix2(pts[ia], pts[Math.min(n, ia + 1)], a - ia));
  for (let i = ia + 1; i <= ib; i++) out.push(pts[i]);
  if (ib < n) out.push(mix2(pts[ib], pts[ib + 1], b - ib));
  return out;
}

export function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, TAU);
  ctx.fill();
}

// Soft radial glow sprite.
export function glow(ctx, x, y, r, color, a = 1) {
  if (r <= 0 || a <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.25, rgba(color, a * 0.35));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// Simple perspective camera for the few 3D shots.
export function project(p, cam) {
  let [x, y, z] = p;
  const { yaw = 0, pitch = 0, roll = 0, dist = 6, fov = 900, cx = W / 2, cy = H / 2, scale = 1 } = cam;
  let c = Math.cos(yaw), s = Math.sin(yaw);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(pitch); s = Math.sin(pitch);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(roll); s = Math.sin(roll);
  [x, y] = [x * c - y * s, x * s + y * c];
  const d = dist + z;
  const k = (fov / d) * scale;
  return [cx + x * k, cy + y * k, d, k];
}

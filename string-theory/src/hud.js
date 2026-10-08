// Persistent design system: the timeline string, the year odometer, the
// per-era text block and the technical corner furniture.

import {
  W, H, TAU, C, F, clamp, lerp, seg, ease, rgba, strike, glyphs, measure, decode, maskLine,
  maskWords, polyline, dot, glow, font,
} from './engine.js';
import { ERAS, OUTRO, NOW, FPS } from './timeline.js';
import { TL } from './scenes.js';

// ------------------------------------------------------------ year value
const ROLLS = [
  [1.95, 0.6, 1900, ERAS[0].year],
  ...ERAS.slice(1).map((e, i) => [e.t0 - 0.04, 0.42, ERAS[i].year, e.year]),
  [OUTRO - 0.02, 0.5, ERAS[ERAS.length - 1].year, NOW],
];
export function yearAt(t) {
  let v = ROLLS[0][2];
  for (const [t0, d, a, b] of ROLLS) {
    if (t >= t0) v = lerp(a, b, ease.inOutQuart(clamp((t - t0) / d)));
  }
  return v;
}
const xOfYear = (y) => lerp(TL.x0, TL.x1, (y - TL.y0) / (TL.y1 - TL.y0));

// ------------------------------------------------------------ timeline
const STRIKES = [
  [2.0, 0.5, 34],
  ...ERAS.slice(1).map((e) => [e.t0 + 0.36, (xOfYear(e.year) - TL.x0) / (TL.x1 - TL.x0), 9]),
  [OUTRO + 0.46, (xOfYear(NOW) - TL.x0) / (TL.x1 - TL.x0), 14],
];
function tlDisp(s, t) {
  let y = 0;
  for (const [t0, p, h] of STRIKES) if (t >= t0) y += strike(s, t - t0, p, h, 2.4, 1.6);
  return y;
}

function timeline(ctx, t) {
  if (t < 1.98) return;
  const a = 1 - seg(t, 14.55, 14.95);
  const yr = yearAt(t);
  const px = xOfYear(yr);
  const N = 260;
  const ptsAt = (tt) => {
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      pts.push([lerp(TL.x0, TL.x1, s), TL.y + tlDisp(s, tt)]);
    }
    return pts;
  };
  const pts = ptsAt(t);
  ctx.globalAlpha = a;
  // unvisited future: dim
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, TL.y - 80, W, 160);
  ctx.clip();
  ctx.strokeStyle = rgba(C.ink, 0.22);
  ctx.lineWidth = 1.4;
  polyline(ctx, pts);
  ctx.stroke();
  ctx.restore();
  // visited past: lit, with trails
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, TL.y - 80, px, 160);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 4; k >= 1; k--) {
    ctx.strokeStyle = rgba(C.cyan, 0.12 * (1 - k / 5));
    ctx.lineWidth = 2;
    polyline(ctx, ptsAt(t - k * 0.012));
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(C.cyan, 0.9);
  ctx.lineWidth = 2;
  polyline(ctx, pts);
  ctx.stroke();
  ctx.restore();

  // ruler
  const rp = seg(t, 2.0, 2.6, ease.snap);
  ctx.fillStyle = rgba(C.ink, 0.3);
  for (let y = TL.y0; y <= TL.y1; y++) {
    const x = xOfYear(y);
    if ((x - TL.x0) / (TL.x1 - TL.x0) > rp) break;
    const big = y % 10 === 0, mid = y % 5 === 0;
    ctx.fillRect(x - 0.5, TL.y + 12, 1, big ? 9 : mid ? 6 : 3);
    if (big) glyphs(ctx, `${y}`, x, TL.y + 40, 11, F.mono, C.mute, { align: 'center', track: 0.08 });
  }
  // era markers
  ERAS.forEach((e) => {
    const x = xOfYear(e.year);
    const s = (x - TL.x0) / (TL.x1 - TL.x0);
    if (s > rp) return;
    const y = TL.y + tlDisp(s, t);
    const visited = yr >= e.year - 0.01;
    if (visited) {
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, x, y, 12, C.cyan, 0.8 * a);
      ctx.globalCompositeOperation = 'source-over';
      dot(ctx, x, y, 3.2, '#ffffff');
    } else {
      ctx.strokeStyle = rgba(C.ink, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, TAU);
      ctx.stroke();
    }
  });
  // playhead
  const hy = TL.y + tlDisp((px - TL.x0) / (TL.x1 - TL.x0), t);
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, px, hy, 34, C.amber, a);
  ctx.globalCompositeOperation = 'source-over';
  dot(ctx, px, hy, 5, '#ffffff');
  ctx.fillStyle = rgba(C.amber, 0.8);
  ctx.fillRect(px - 0.5, hy - 34, 1, 22);
  const label = t >= OUTRO + 0.3 ? 'NOW' : `${Math.round(yr)}`;
  glyphs(ctx, label, px, hy - 44, 13, F.monoB, C.amber, { align: 'center', track: 0.1 });
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------ odometer
const OD = { x: 140, y: 405, size: 210 };
function odometer(ctx, t) {
  const a = seg(t, 1.95, 2.25) * (1 - seg(t, OUTRO + 0.15, OUTRO + 0.4));
  if (a <= 0) return;
  const v = yearAt(t);
  const speed = Math.abs(yearAt(t + 1 / FPS) - yearAt(t - 1 / FPS)) * FPS * 0.5;
  const size = OD.size;
  ctx.font = font(size, F.serifI);
  const cw = Math.max(...'0123456789'.split('').map((d) => ctx.measureText(d).width)) * 0.92;
  const lineH = size * 0.92;
  ctx.save();
  ctx.beginPath();
  ctx.rect(OD.x - 30, OD.y - size * 0.8, cw * 4 + 80, size * 0.95);
  ctx.clip();
  for (let k = 0; k < 4; k++) {
    const p10 = 10 ** k;
    const base = Math.floor(v / p10);
    const lower = v - base * p10; // fractional remainder below this digit
    const roll = k === 0 ? lower : clamp(lower - (p10 - 1));
    const pos = (base % 10) + roll;
    const col = 3 - k;
    const x = OD.x + col * cw + cw / 2;
    const d0 = Math.floor(pos) % 10;
    const f = pos - Math.floor(pos);
    const blurN = k === 0 ? Math.min(5, Math.floor(speed / 6)) : 0;
    for (let j = 0; j < 2; j++) {
      const digit = (d0 + j) % 10;
      const y = OD.y - (f - j) * lineH;
      const dist = Math.abs(y - OD.y) / lineH;
      const alpha = a * clamp(1 - dist * 1.1);
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha / (1 + blurN * 0.6);
      ctx.fillStyle = C.ink;
      ctx.textAlign = 'center';
      for (let b = -blurN; b <= blurN; b++) ctx.fillText(`${digit}`, x, y + b * 9);
    }
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------ era text block
function eraText(ctx, t) {
  const X = OD.x + 4;
  const Y = OD.y;
  ERAS.forEach((e, i) => {
    if (t < e.t0 - 0.05 || t > e.t1 + 0.05) return;
    const t1 = i === ERAS.length - 1 ? e.t1 - 0.08 : e.t1;
    // kicker: accent bar + decoded label
    const kp = seg(t, e.t0 + 0.05, e.t0 + 0.45);
    const kq = seg(t, t1 - 0.22, t1 - 0.04);
    if (kp > 0 && kq < 1) {
      ctx.globalAlpha = 1 - kq;
      ctx.fillStyle = C.cyan;
      ctx.fillRect(X, Y + 56, 34 * ease.snap(seg(t, e.t0, e.t0 + 0.3)) * (1 - kq), 2);
      glyphs(ctx, e.n, X + 48, Y + 63, 15, F.monoB, C.cyan, { track: 0.15 });
      glyphs(ctx, decode(e.kicker, kp, i + 1, t), X + 84, Y + 63, 15, F.mono, C.cyan, { track: 0.2 });
      ctx.globalAlpha = 1;
    }
    e.head.forEach((line, j) => {
      maskWords(ctx, line, X - 3, Y + 140 + j * 62, 54, F.bold, C.ink, t, e.t0 + 0.08 + j * 0.08, {
        stagger: 0.04,
        dur: 0.5,
        out: t1 - 0.3 + j * 0.03,
        outDur: 0.24,
        track: -0.01,
      });
    });
    const np = seg(t, e.t0 + 0.3, e.t0 + 0.75);
    const nq = seg(t, t1 - 0.26, t1 - 0.05);
    maskLine(ctx, e.names, X, Y + 252, 24, F.light, C.mute, np, nq, { track: 0.01 });
  });
}

// ------------------------------------------------------------ corners
function corners(ctx, t) {
  const a = seg(t, 1.9, 2.3) * (1 - seg(t, OUTRO + 0.1, OUTRO + 0.4));
  if (a <= 0) return;
  ctx.globalAlpha = a;
  ctx.strokeStyle = rgba(C.ink, 0.28);
  ctx.lineWidth = 1;
  const m = 34, l = 18;
  [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(([x, y, sx, sy]) => {
    polyline(ctx, [[x + sx * l, y], [x, y], [x, y + sy * l]]);
    ctx.stroke();
  });
  const p = seg(t, 1.95, 2.5);
  glyphs(ctx, decode('STRING THEORY', p, 21, t), 66, 74, 13, F.monoB, C.ink, { track: 0.28 });
  glyphs(ctx, decode('A BRIEF HISTORY IN FIFTEEN SECONDS', p, 22, t), 268, 74, 13, F.mono, C.mute, { track: 0.18 });
  const era = ERAS.reduce((k, e, i) => (t >= e.t0 ? i : k), 0);
  const frame = Math.floor(t * FPS + 1e-6);
  const tc = `00:${String(Math.floor(frame / FPS)).padStart(2, '0')}:${String(frame % FPS).padStart(2, '0')}`;
  glyphs(ctx, tc, W - 66, 74, 13, F.mono, C.mute, { align: 'right', track: 0.12 });
  glyphs(ctx, `${ERAS[era].n} / 08`, W - 196, 74, 13, F.monoB, C.ink, { align: 'right', track: 0.12 });
  ctx.globalAlpha = 1;
}

export function hud(ctx, t) {
  odometer(ctx, t);
  eraText(ctx, t);
  corners(ctx, t);
  timeline(ctx, t);
}

// The eight eras plus intro/outro. Each scene is a pure function of global
// time `t` and draws only while its window (plus hand-off margins) is live.

import {
  W, H, TAU, C, F, clamp, lerp, invLerp, seg, ease, spring, rgba, mixHex, spectrum, pluck, pluckWithPull,
  font, glyphs, measure, decode, maskLine, polyline, partial, dot, glow, project, hash, noise1,
  fbm2, makeCanvas, rng,
} from './engine.js';
import E8 from './e8.json' with { type: 'json' };

export const VC = [1290, 470]; // visual-column centre

// -------------------------------------------------------------- shared bits
function lighter(ctx, fn) {
  const op = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  fn();
  ctx.globalCompositeOperation = op;
}

// Stroke a moving polyline with "long-exposure" ghost trails.
function trails(ctx, ptsAt, t, { n = 6, dt = 0.012, color = C.cyan, width = 2, alpha = 1, core = null } = {}) {
  lighter(ctx, () => {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let k = n; k >= 1; k--) {
      ctx.globalAlpha = alpha * 0.32 * (1 - k / (n + 1)) ** 1.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      polyline(ctx, ptsAt(t - k * dt));
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * 2.2;
    ctx.globalAlpha = alpha * 0.35;
    const pts = ptsAt(t);
    polyline(ctx, pts);
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = core || '#ffffff';
    ctx.lineWidth = width * 0.75;
    polyline(ctx, pts);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

function caption(ctx, str, x, y, t, t0, t1, align = 'left') {
  const p = seg(t, t0, t0 + 0.45);
  const q = seg(t, t1 - 0.25, t1);
  if (p <= 0 || q >= 1) return;
  ctx.globalAlpha = 1 - q;
  glyphs(ctx, decode(str, p, 7, t), x, y, 12, F.mono, C.mute, { track: 0.18, align });
  ctx.globalAlpha = 1;
}

// Leader-line annotation: anchor dot -> elbow -> label.
function annotate(ctx, ax, ay, lx, ly, label, p, q = 0, color = C.mute) {
  if (p <= 0 || q >= 1) return;
  const a = 1 - q;
  const pts = [[ax, ay], [lx, ly], [lx + (lx > ax ? 26 : -26), ly]];
  ctx.globalAlpha = a;
  ctx.strokeStyle = rgba(C.ink, 0.45);
  ctx.lineWidth = 1;
  polyline(ctx, partial(pts, ease.snap(p)));
  ctx.stroke();
  dot(ctx, ax, ay, 3 * ease.outBack(clamp(p * 2)), C.ink);
  const lp = seg(p, 0.5, 1);
  if (lp > 0) {
    glyphs(ctx, decode(label, lp, 3, p), lx + (lx > ax ? 34 : -34), ly + 4, 13, F.mono, color, {
      track: 0.12,
      align: lx > ax ? 'left' : 'right',
    });
  }
  ctx.globalAlpha = 1;
}

// -------------------------------------------------------------- title card
let titleCan = null;
const TITLE = 'STRING THEORY';
const TS = 172; // title size
function titleCanvas() {
  if (!titleCan) titleCan = makeCanvas(1760, 320);
  return titleCan;
}

// The title rides the string: it is cut into thin vertical strips, each one
// displaced by the string's displacement at that x.
function drawTitle(ctx, t, { cx, cy, reveal, dispAt, exit = 0, color = C.ink }) {
  const tc = titleCanvas();
  const tx = tc.getContext('2d');
  tx.clearRect(0, 0, tc.width, tc.height);
  const base = 230;
  tx.save();
  tx.beginPath();
  tx.rect(0, 0, tc.width, base + 40);
  tx.clip();
  glyphs(tx, TITLE, tc.width / 2, base, TS, F.black, color, {
    track: -0.015,
    align: 'center',
    fn: (i) => {
      const p = seg(reveal, i * 0.045, i * 0.045 + 0.5, ease.snap);
      return { dy: (1 - p) * 200, a: p > 0 ? 1 : 0 };
    },
  });
  tx.restore();
  const strip = 6;
  const capH = TS * 0.72;
  const x0 = cx - tc.width / 2;
  for (let sx = 0; sx < tc.width; sx += strip) {
    const i = sx / strip;
    const dx = x0 + sx;
    let dy = dispAt(dx + strip / 2) * 0.55;
    let a = 1;
    if (exit > 0) {
      const e = clamp((exit - (sx / tc.width) * 0.45 - hash(i * 0.37) * 0.06) / 0.5);
      dy += ease.inCubic(e) * (380 + 120 * hash(i + 11.3));
      a = 1 - ease.inQuad(e);
    }
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    ctx.drawImage(tc, sx, 0, strip, tc.height, dx, cy + capH / 2 - base + dy, strip, tc.height);
  }
  ctx.globalAlpha = 1;
}

function stringPts(cx, y, L, dispFn, n = 220) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    pts.push([cx - L + 2 * L * s, y + dispFn(s)]);
  }
  return pts;
}

// -------------------------------------------------------------- intro
export const TL = { y: 990, x0: 180, x1: 1740, y0: 1965, y1: 2030 };

export function intro(ctx, t) {
  if (t > 2.05) return;
  const cx = W / 2, cy = 540;
  // the seed of light
  const a0 = seg(t, 0.04, 0.3, ease.outCubic);
  const L = 790 * ease.snap(seg(t, 0.3, 0.82));
  const tp = 0.78;
  const amp = 92;
  const fall = seg(t, 1.58, 2.0, ease.swift); // string falls to become the timeline
  const y = lerp(cy, TL.y, fall);
  const Lx = lerp(L, (TL.x1 - TL.x0) / 2, fall);
  const dampA = 1 - fall * 0.85;
  const disp = (s, tt) =>
    dampA * (pluckWithPull(s, tt, tp, 0.3, 0.37, amp, 1.9, 1.15) + (tt < tp ? Math.sin(s * Math.PI) * noise1(tt * 9 + s * 4) * 2 : 0));

  if (a0 > 0) {
    lighter(ctx, () => {
      glow(ctx, cx, y, 30 + 180 * a0 * (1 - seg(t, 0.3, 0.9)), C.cyan, 0.9 * a0);
      glow(ctx, cx, y, 18, '#ffffff', a0);
    });
  }
  if (L > 2) {
    trails(ctx, (tt) => stringPts(cx, y, Lx, (s) => disp(s, tt)), t, { n: 7, dt: 0.011, width: 2.4 });
    lighter(ctx, () => {
      glow(ctx, cx - Lx, y, 40, C.amber, 0.8);
      glow(ctx, cx + Lx, y, 40, C.amber, 0.8);
    });
  }

  // kinetic title, riding the string
  const reveal = seg(t, 0.86, 1.6);
  if (reveal > 0) {
    drawTitle(ctx, t, {
      cx,
      cy,
      reveal,
      exit: seg(t, 1.5, 1.95),
      dispAt: (x) => disp(clamp((x - (cx - L)) / (2 * Math.max(L, 1))), t),
    });
  }
  // supers
  const sp = seg(t, 0.95, 1.4);
  const sq = seg(t, 1.45, 1.62);
  if (sp > 0 && sq < 1) {
    ctx.globalAlpha = 1 - sq;
    glyphs(ctx, decode('A BRIEF HISTORY OF', sp, 2, t), cx, cy - 138, 17, F.mono, C.cyan, { track: 0.5, align: 'center' });
    ctx.globalAlpha = 1;
  }
  const lp = seg(t, 1.1, 1.55);
  if (lp > 0 && sq < 1) {
    maskLine(ctx, '1968  —  the present', cx, cy + 172, 38, F.serifI, C.mute, lp, sq, { align: 'center' });
  }
}

// -------------------------------------------------------------- 1968
export function s1968(ctx, t) {
  const u = t - 2.0;
  if (u < -0.05 || u >= 1.5) return;
  const D = [VC[0], 400];
  const corners = [[-250, -165], [-250, 165], [250, -165], [250, 165]]; // TL BL TR BR
  // s <-> t duality: the propagator rotates 90 degrees and back
  const th = (Math.PI / 2) * (seg(u, 0.5, 0.82, ease.swift) - seg(u, 0.92, 1.22, ease.swift));
  const r = 72;
  const A = [D[0] - r * Math.cos(th), D[1] - r * Math.sin(th)];
  const B = [D[0] + r * Math.cos(th), D[1] + r * Math.sin(th)];
  const w = th / (Math.PI / 2);

  // faint Regge-trajectory plot behind
  const rp = seg(u, 0.0, 0.7, ease.snap);
  const rq = seg(u, 1.1, 1.45);
  if (rp > 0 && rq < 1) {
    const ox = 985, oy = 700, gx = 600, gy = 520;
    ctx.globalAlpha = 0.5 * (1 - rq);
    ctx.strokeStyle = rgba(C.ink, 0.25);
    ctx.lineWidth = 1;
    polyline(ctx, partial([[ox, oy - gy * rp], [ox, oy], [ox + gx * rp, oy]], 1));
    ctx.stroke();
    glyphs(ctx, 'J', ox - 18, oy - gy * rp + 10, 13, F.mono, C.mute);
    glyphs(ctx, 'M²', ox + gx * rp + 8, oy + 4, 13, F.mono, C.mute);
    ctx.setLineDash([4, 6]);
    for (let k = 0; k < 3; k++) {
      const x0 = ox, y0 = oy - 40 - k * 70;
      const x1 = ox + gx * rp, y1 = y0 - gy * 0.62 * rp;
      ctx.strokeStyle = rgba(C.violet, 0.45);
      polyline(ctx, [[x0, y0], [x1, y1]]);
      ctx.stroke();
      for (let j = 1; j < 6; j++) {
        const f = j / 6;
        if (f > rp) continue;
        dot(ctx, lerp(x0, ox + gx, f), lerp(y0, y0 - gy * 0.62, f), 2.5, rgba(C.violet, 0.8));
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // legs: draw on from the corners, retract into the vertices at the end
  const retract = seg(u, 1.18, 1.42, ease.inOutCubic);
  const legs = [
    [corners[0], [[A, 1]]],
    [corners[1], [[A, 1 - w], [B, w]]],
    [corners[2], [[B, 1 - w], [A, w]]],
    [corners[3], [[B, 1]]],
  ];
  lighter(ctx, () => {
    legs.forEach(([c, targets], i) => {
      const p = seg(u, 0.04 + i * 0.05, 0.42 + i * 0.05, ease.snap);
      if (p <= 0) return;
      const P0 = [D[0] + c[0], D[1] + c[1]];
      targets.forEach(([T, wt]) => {
        if (wt < 0.01) return;
        const pts = [P0, T];
        const shown = partial(pts, p, retract);
        if (shown.length < 2) return;
        ctx.globalAlpha = wt;
        ctx.strokeStyle = rgba(C.cyan, 0.35);
        ctx.lineWidth = 6;
        polyline(ctx, shown);
        ctx.stroke();
        ctx.strokeStyle = '#d9fbff';
        ctx.lineWidth = 2;
        polyline(ctx, shown);
        ctx.stroke();
        // quanta travelling along the leg
        if (retract < 0.5) {
          for (let k = 0; k < 2; k++) {
            const f = (u * 1.4 + k * 0.5 + i * 0.13) % 1;
            const incoming = i < 2 ? f : 1 - f;
            if (incoming > p) continue;
            const q = [lerp(P0[0], T[0], incoming), lerp(P0[1], T[1], incoming)];
            glow(ctx, q[0], q[1], 16, C.amber, 0.9 * wt * (1 - retract));
          }
        }
        ctx.globalAlpha = 1;
      });
    });
    // propagator (survives into 1970 as the first string)
    const pp = seg(u, 0.24, 0.46, ease.snap);
    if (pp > 0) {
      const pts = partial([A, B], pp);
      ctx.strokeStyle = rgba(C.amber, 0.4);
      ctx.lineWidth = 7;
      polyline(ctx, pts);
      ctx.stroke();
      ctx.strokeStyle = '#fff3dc';
      ctx.lineWidth = 2.4;
      polyline(ctx, pts);
      ctx.stroke();
      const vp = ease.outBack(seg(u, 0.3, 0.55));
      [A, B].forEach((v) => {
        glow(ctx, v[0], v[1], 34 * vp, C.amber, 0.9);
        dot(ctx, v[0], v[1], 4.5 * vp, '#ffffff');
      });
    }
  });
  // channel labels
  const lq = seg(u, 1.12, 1.3);
  const la = seg(u, 0.35, 0.6) * (1 - lq);
  if (la > 0) {
    ctx.globalAlpha = la * (1 - w);
    glyphs(ctx, 's', D[0], D[1] - 22, 38, F.math, C.amber, { align: 'center' });
    ctx.globalAlpha = la * w;
    glyphs(ctx, 't', D[0] + 30, D[1] + 12, 38, F.math, C.amber, { align: 'center' });
    ctx.globalAlpha = 1;
  }

  // Veneziano amplitude, glyph by glyph
  const ex = seg(u, 1.22, 1.45, ease.inCubic);
  if (u > 0.3 && ex < 1) {
    const ey = 700;
    const size = 44;
    const lhs = 'A(s, t)  =  ';
    const num = 'Γ(−α(s)) Γ(−α(t))';
    const den = 'Γ(−α(s) − α(t))';
    const wl = measure(ctx, lhs, size, F.math);
    const wn = measure(ctx, num, size, F.math);
    const wd = measure(ctx, den, size, F.math);
    const wf = Math.max(wn, wd) + 24;
    const x0 = D[0] - (wl + wf) / 2;
    const n = lhs.length + num.length + den.length;
    let idx = 0;
    const g = (i0) => (i) => {
      const k = i0 + i;
      const p = seg(u, 0.32 + (k / n) * 0.45, 0.32 + (k / n) * 0.45 + 0.22, ease.snap);
      return { a: p * (1 - ex), dy: (1 - p) * 16 - ex * 30, color: k < lhs.length ? C.ink : undefined };
    };
    glyphs(ctx, lhs, x0, ey + 14, size, F.math, C.ink, { fn: g(idx) });
    idx += lhs.length;
    glyphs(ctx, num, x0 + wl + wf / 2, ey - 14, size, F.math, C.ink, { align: 'center', fn: g(idx) });
    idx += num.length;
    glyphs(ctx, den, x0 + wl + wf / 2, ey + 48, size, F.math, C.ink, { align: 'center', fn: g(idx) });
    const bar = seg(u, 0.45, 0.85, ease.snap) * (1 - ex);
    ctx.fillStyle = C.ink;
    ctx.fillRect(x0 + wl, ey + 1, wf * bar, 2);
  }
  caption(ctx, 'FIG. 1 — s ↔ t CHANNEL DUALITY', D[0] - 250, D[1] - 205, t, 2.15, 3.35);
}

// -------------------------------------------------------------- 1970
const S70 = { mid: 470, gap: 92, L: 270 };
export function s1970(ctx, t) {
  const u = t - 3.5;
  if (u < -0.02 || u >= 1.5) return;
  const cx = VC[0];
  // the 1968 propagator expands into the stack's fundamental string
  const grow = seg(u, 0, 0.35, ease.snap);
  const L = lerp(72, S70.L, grow);
  const conv = seg(u, 1.05, 1.32, ease.inOutCubic); // collapse back to one string
  const midY = lerp(400, S70.mid, grow);
  const curl = seg(u, 1.15, 1.48, ease.inOutCubic);
  const fade = seg(u, 1.0, 1.25);

  for (let k = 0; k < 5; k++) {
    const n = k + 1;
    const isMid = k === 2;
    const sp = spring(u - 0.12 - Math.abs(k - 2) * 0.06, 2.1, 0.42);
    let y = lerp(midY, S70.mid + (k - 2) * S70.gap, isMid ? 1 : sp);
    y = lerp(y, S70.mid, conv);
    if (!isMid && (sp <= 0 || fade >= 1)) continue;
    if (isMid && curl > 0) continue; // hand-off: the curling string is drawn below
    const alpha = isMid ? 1 : clamp(sp * 1.5) * (1 - fade);
    const amp = (46 / Math.sqrt(n)) * seg(u, 0.18 + k * 0.03, 0.5 + k * 0.03, ease.outCubic) * (1 - conv * 0.7);
    const col = spectrum(k / 4);
    const ptsAt = (tt) => {
      const pts = [];
      for (let i = 0; i <= 160; i++) {
        const s = i / 160;
        const d = amp * Math.sin(n * Math.PI * s) * Math.cos(TAU * 1.25 * n * (tt - 3.5) + k);
        pts.push([cx - L + 2 * L * s, y + d]);
      }
      return pts;
    };
    trails(ctx, ptsAt, t, { n: 6, dt: 0.014, color: col, width: 2.2, alpha, core: '#ffffff' });
    lighter(ctx, () => {
      glow(ctx, cx - L, y, 22, C.amber, alpha);
      glow(ctx, cx + L, y, 22, C.amber, alpha);
    });
    dot(ctx, cx - L, y, 3.5, rgba('#ffffff', alpha));
    dot(ctx, cx + L, y, 3.5, rgba('#ffffff', alpha));
    // node markers
    const np = seg(u, 0.45 + k * 0.04, 0.7 + k * 0.04) * (1 - fade);
    if (np > 0) {
      ctx.strokeStyle = rgba(C.ink, 0.6 * np);
      ctx.lineWidth = 1;
      for (let j = 1; j < n; j++) {
        ctx.beginPath();
        ctx.arc(cx - L + (2 * L * j) / n, y, 5 * ease.outBack(np), 0, TAU);
        ctx.stroke();
      }
      // labels & mass bars
      ctx.globalAlpha = np;
      glyphs(ctx, `n = ${n}`, cx - L - 44, y + 5, 13, F.mono, C.mute, { align: 'right' });
      const bw = 70 * Math.sqrt(n) * ease.snap(np);
      ctx.fillStyle = col;
      ctx.fillRect(cx + L + 40, y - 1.5, bw, 3);
      glyphs(ctx, `${n}`, cx + L + 50 + bw, y + 5, 13, F.mono, C.mute);
      ctx.globalAlpha = 1;
    }
  }
  const hp = seg(u, 0.5, 0.8) * (1 - fade);
  if (hp > 0) {
    ctx.globalAlpha = hp;
    glyphs(ctx, 'MODE', cx - L - 44, S70.mid - 2.5 * S70.gap - 8, 11, F.mono, C.dim, { align: 'right', track: 0.2 });
    glyphs(ctx, 'MASS²  ∝  n', cx + L + 40, S70.mid - 2.5 * S70.gap - 8, 11, F.mono, C.dim, { track: 0.2 });
    ctx.globalAlpha = 1;
  }
  // the fundamental curls into a closed loop for 1974
  if (curl > 0) drawCurl(ctx, t, curl);
  caption(ctx, 'FIG. 2 — ONE STRING, MANY PARTICLES', cx - S70.L, S70.mid + 2.5 * S70.gap + 40, t, 3.6, 4.85);
}

export const LOOP = { c: [VC[0], 400], R: 100 };
function curlPts(curl, wob, tt) {
  const L = lerp(2 * S70.L, TAU * LOOP.R, curl);
  const phi = Math.max(1e-4, TAU * curl);
  const R = L / phi;
  const M = [LOOP.c[0], lerp(S70.mid, LOOP.c[1] + LOOP.R, curl)];
  const C0 = [M[0], M[1] - R];
  const pts = [];
  const N = 180;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const a = phi * (s - 0.5);
    const d = wob * Math.sin(3 * Math.PI * s) * Math.cos(TAU * 2.2 * tt);
    pts.push([C0[0] + (R + d) * Math.sin(a), C0[1] + (R + d) * Math.cos(a)]);
  }
  return pts;
}
function drawCurl(ctx, t, curl) {
  trails(ctx, (tt) => curlPts(curl, 14 * (1 - curl), tt), t, { n: 6, dt: 0.014, color: C.cyan, width: 2.4 });
  if (curl < 0.97) {
    const pts = curlPts(curl, 0, t);
    lighter(ctx, () => {
      glow(ctx, pts[0][0], pts[0][1], 24, C.amber, 1 - curl);
      glow(ctx, pts[pts.length - 1][0], pts[pts.length - 1][1], 24, C.amber, 1 - curl);
    });
  } else {
    lighter(ctx, () => glow(ctx, LOOP.c[0], LOOP.c[1] + LOOP.R, 60, '#ffffff', (curl - 0.97) * 30));
  }
}

// -------------------------------------------------------------- 1974
export function s1974(ctx, t) {
  const u = t - 5.0;
  if (u < 0 || u > 1.5) return;
  const [cx, cy] = LOOP.c;
  const tension = seg(u, 1.1, 1.5, ease.inQuad);
  const R = LOOP.R * lerp(1, 1.15, spring(u, 1.6, 0.4));
  const pol = seg(u, 0.7, 0.9, ease.inOutCubic) * (Math.PI / 4);
  const om = TAU * 1.55;
  const eps = lerp(0.04, 0.17, seg(u, 0, 0.35)) * (1 + tension * 0.8);

  // spacetime sheet: perspective grid with a gravity well and radiating ripples
  const gp = seg(u, 0, 0.5, ease.snap);
  const cam = { pitch: -1.08, dist: 7, fov: 760, cx, cy: cy + 230, yaw: 0.25 + u * 0.08 };
  const hgt = (x, z) => {
    const r = Math.hypot(x, z);
    const well = 1.25 / (1 + (r / 0.9) ** 2);
    const rip = 0.13 * Math.sin(3.2 * r - 9 * u) * Math.exp(-r / 3.5) * seg(u, 0.1, 0.5) * (1 + tension);
    return (well + rip) * gp;
  };
  const N = 28;
  const ext = 5.2 * lerp(0.6, 1, gp);
  lighter(ctx, () => {
    ctx.lineWidth = 1;
    for (let dir = 0; dir < 2; dir++) {
      for (let i = 0; i <= N; i++) {
        const a = -ext + (2 * ext * i) / N;
        const pts = [];
        for (let j = 0; j <= 48; j++) {
          const b = -ext + (2 * ext * j) / 48;
          const [x, z] = dir ? [a, b] : [b, a];
          pts.push(project([x, hgt(x, z), z], cam));
        }
        const centre = 1 - Math.abs(a) / ext;
        ctx.strokeStyle = rgba(C.cyan, 0.07 + 0.28 * centre * centre * gp);
        polyline(ctx, pts);
        ctx.stroke();
      }
    }
  });

  // the closed string: quadrupole (spin-2) oscillation, + then x polarisation
  const loopAt = (tt) => {
    const uu = tt - 5.0;
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const th = (i / 200) * TAU;
      const r =
        R *
        (1 +
          eps * Math.sin(om * uu) * Math.cos(2 * (th - pol)) +
          0.025 * Math.sin(3 * th + uu * 7) +
          tension * 0.04 * Math.sin(5 * th - uu * 20));
      pts.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]);
    }
    return pts;
  };
  trails(ctx, loopAt, t, { n: 7, dt: 0.013, color: C.cyan, width: 2.6 });
  lighter(ctx, () => glow(ctx, cx, cy, R * 1.6, C.cyan, 0.12 + tension * 0.2));

  // ring of free-falling test masses, squeezed by the passing wave
  const rp = seg(u, 0.25, 0.6, ease.snap);
  if (rp > 0) {
    const R2 = 205 * lerp(0.7, 1, rp);
    const pts = [];
    for (let i = 0; i < 18; i++) {
      const th = (i / 18) * TAU + u * 0.2;
      const r = R2 * (1 + 0.1 * Math.sin(om * u - 0.9) * Math.cos(2 * (th - pol)));
      pts.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]);
    }
    ctx.strokeStyle = rgba(C.amber, 0.25 * rp);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    polyline(ctx, pts, true);
    ctx.stroke();
    ctx.setLineDash([]);
    lighter(ctx, () => pts.forEach(([x, y]) => glow(ctx, x, y, 12 * rp, C.amber, 0.9)));
    pts.forEach(([x, y]) => dot(ctx, x, y, 2.6 * rp, '#fff3dc'));
  }
  const ap = seg(u, 0.45, 0.85);
  const aq = seg(u, 1.25, 1.45);
  annotate(ctx, cx + R * 0.71, cy - R * 0.71, cx + 250, cy - 190, 'MASS = 0', ap, aq);
  annotate(ctx, cx - R * 0.8, cy + R * 0.6, cx - 250, cy + 150, 'SPIN = 2', seg(u, 0.55, 0.95), aq);
  const polLabel = pol > Math.PI / 8 ? 'POLARISATION ×' : 'POLARISATION +';
  annotate(ctx, cx + 205, cy, cx + 275, cy + 120, polLabel, seg(u, 0.65, 1.0), aq, C.amber);
  caption(ctx, 'FIG. 3 — CLOSED STRING  →  GRAVITON', cx - 260, cy - 250, t, 5.1, 6.4);
}

// -------------------------------------------------------------- 1984: E8
const E8P = (() => {
  const roots = E8.roots.map((r) => r.map((v) => v / 2));
  const basis = E8.basis;
  // a fixed "chaotic" basis to unfold from
  const rnd = rng(84);
  const raw = Array.from({ length: 4 }, () => Array.from({ length: 8 }, () => rnd() * 2 - 1));
  return { roots, basis, raw };
})();

function orthonormal(u, v) {
  const n = (a) => Math.hypot(...a);
  const un = u.map((x) => x / n(u));
  const d = v.reduce((s, x, i) => s + x * un[i], 0);
  const v2 = v.map((x, i) => x - d * un[i]);
  return [un, v2.map((x) => x / n(v2))];
}

export function s1984(ctx, t) {
  const u = t - 6.5;
  if (u < 0 || u > 1.62) return;
  const cx = VC[0], cy = 445;
  const exit = seg(u, 1.3, 1.6, ease.inExpo);

  // ghost "496" behind everything
  const np = seg(u, 0, 0.6, ease.snap);
  ctx.save();
  ctx.translate(cx, cy + 40);
  const ns = lerp(1.35, 1, np) * (1 + exit * 1.6);
  ctx.scale(ns, ns);
  ctx.font = font(470, F.black);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = (1 - exit) * np;
  ctx.strokeStyle = rgba(C.cyan, 0.22);
  ctx.lineWidth = 1.5;
  ctx.strokeText('496', 0, 0);
  ctx.fillStyle = rgba(C.cyan, 0.035);
  ctx.fillText('496', 0, 0);
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.textBaseline = 'alphabetic';

  // chaotic projection -> perfect Coxeter-plane symmetry at t = 7.0
  const snap = seg(u, 0.1, 0.5, ease.inOutExpo);
  const wob = u * 1.3;
  const r = E8P.raw;
  const cu = r[0].map((x, i) => x * Math.cos(wob) + r[2][i] * Math.sin(wob));
  const cv = r[1].map((x, i) => x * Math.cos(wob * 0.7) + r[3][i] * Math.sin(wob * 0.7));
  const drift = 0.05 * Math.sin(u * 2); // after the snap, breathe gently in 8D
  const pu = E8P.basis[0].map((x, i) => x + drift * E8P.basis[2][i]);
  const pv = E8P.basis[1].map((x, i) => x + drift * E8P.basis[3][i]);
  const [bu, bv] = orthonormal(
    cu.map((x, i) => lerp(x * 0.5, pu[i], snap)),
    cv.map((x, i) => lerp(x * 0.5, pv[i], snap)),
  );
  const rot = u * 0.22;
  const scale = 262 * lerp(0.55, 1, seg(u, 0, 0.4, ease.snap)) * (1 + exit * 5);
  const P = E8P.roots.map((rt) => {
    let x = 0, y = 0;
    for (let i = 0; i < 8; i++) {
      x += rt[i] * bu[i];
      y += rt[i] * bv[i];
    }
    const c = Math.cos(rot), s = Math.sin(rot);
    return [cx + (x * c - y * s) * scale, cy + (x * s + y * c) * scale];
  });
  const ea = seg(u, 0.05, 0.4) * (1 - exit);
  lighter(ctx, () => {
    ctx.lineWidth = 0.7;
    const buckets = Array.from({ length: 8 }, () => []);
    for (const [a, b] of E8.edges) buckets[Math.min(E8.rings[a], E8.rings[b])].push(a, b);
    buckets.forEach((list, ring) => {
      ctx.strokeStyle = spectrum(ring / 7, (0.05 + snap * 0.05) * ea * (0.35 + ring / 7));
      ctx.beginPath();
      for (let i = 0; i < list.length; i += 2) {
        const p = P[list[i]], q = P[list[i + 1]];
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
      }
      ctx.stroke();
    });
    P.forEach(([x, y], i) => {
      const ring = E8.rings[i];
      glow(ctx, x, y, 7, ring % 2 ? C.magenta : C.cyan, 0.3 * ea);
    });
  });
  P.forEach(([x, y]) => dot(ctx, x, y, 1.8, rgba('#ffffff', ea)));

  // symmetry snap shockwave
  const sw = seg(u, 0.5, 1.1, ease.outCubic);
  if (sw > 0 && sw < 1) {
    lighter(ctx, () => {
      ctx.strokeStyle = rgba(C.ink, 0.8 * (1 - sw));
      ctx.lineWidth = 3 * (1 - sw) + 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 40 + 460 * sw, 0, TAU);
      ctx.stroke();
    });
  }

  // dimension counter 26 -> 10 (Lovelace's bosonic string -> superstring)
  const dp = seg(u, 0.12, 0.5, ease.inOutExpo);
  const da = seg(u, 0.05, 0.2) * (1 - seg(u, 1.25, 1.45));
  if (da > 0) {
    ctx.globalAlpha = da;
    const dval = Math.round(lerp(26, 10, dp));
    glyphs(ctx, 'SPACETIME DIMENSIONS', 1745, 196, 11, F.mono, C.mute, { track: 0.2, align: 'right' });
    glyphs(ctx, `D = ${dval}`, 1745, 246, 42, F.monoB, dp >= 1 ? C.cyan : C.ink, { align: 'right' });
    ctx.globalAlpha = 1;
  }

  // the five consistent superstring theories
  const chips = ['TYPE I', 'TYPE IIA', 'TYPE IIB', 'HETEROTIC SO(32)', 'HETEROTIC E₈×E₈'];
  const cq = seg(u, 1.28, 1.5, ease.inCubic);
  const cyy = 855;
  ctx.font = font(12, F.mono);
  const widths = chips.map((c) => measure(ctx, c, 12, F.mono, 0.14) + 30);
  const total = widths.reduce((a, b) => a + b, 0) + 12 * (chips.length - 1);
  let x = cx - total / 2;
  const hp = seg(u, 0.8, 1.1);
  if (hp > 0 && cq < 1) {
    ctx.globalAlpha = hp * (1 - cq);
    glyphs(ctx, 'FIVE CONSISTENT SUPERSTRING THEORIES', cx, cyy - 34, 11, F.mono, C.mute, { track: 0.22, align: 'center' });
    ctx.globalAlpha = 1;
  }
  chips.forEach((c, i) => {
    const p = seg(u, 0.85 + i * 0.05, 1.15 + i * 0.05, ease.snap);
    if (p > 0 && cq < 1) {
      const dy = (1 - p) * 30 + cq * 40;
      ctx.globalAlpha = p * (1 - cq);
      ctx.strokeStyle = rgba(C.cyan, 0.55);
      ctx.lineWidth = 1;
      roundRect(ctx, x, cyy - 15 + dy, widths[i], 30, 15);
      ctx.stroke();
      ctx.fillStyle = rgba(C.cyan, 0.06);
      ctx.fill();
      glyphs(ctx, c, x + widths[i] / 2, cyy + 5 + dy, 12, F.mono, C.ink, { track: 0.14, align: 'center' });
      ctx.globalAlpha = 1;
    }
    x += widths[i] + 12;
  });
  caption(ctx, 'FIG. 4 — E₈ ROOT SYSTEM  ·  240 ROOTS', 835, 196, t, 6.7, 7.85);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// -------------------------------------------------------------- 1985: Calabi-Yau
// Hanson's quintic cross-section: z1^5 + z2^5 = 1 drawn as 25 patches.
function cyMesh(alpha, N) {
  const n = 5;
  const quads = [];
  const cpow = (re, im, e) => {
    const r = Math.hypot(re, im) ** e;
    const a = Math.atan2(im, re) * e;
    return [r * Math.cos(a), r * Math.sin(a)];
  };
  for (let k1 = 0; k1 < n; k1++) {
    for (let k2 = 0; k2 < n; k2++) {
      const grid = [];
      for (let i = 0; i <= N; i++) {
        const row = [];
        const xi = -1 + (2 * i) / N;
        for (let j = 0; j <= N; j++) {
          const th = ((Math.PI / 2) * j) / N;
          const ch = [Math.cosh(xi) * Math.cos(th), Math.sinh(xi) * Math.sin(th)];
          const sh = [Math.sinh(xi) * Math.cos(th), Math.cosh(xi) * Math.sin(th)];
          const z1 = cpow(ch[0], ch[1], 2 / n);
          const z2 = cpow(sh[1], -sh[0], 2 / n); // (-i sinh z)^(2/n)
          const a1 = (TAU * k1) / n, a2 = (TAU * k2) / n;
          const w1 = [z1[0] * Math.cos(a1) - z1[1] * Math.sin(a1), z1[0] * Math.sin(a1) + z1[1] * Math.cos(a1)];
          const w2 = [z2[0] * Math.cos(a2) - z2[1] * Math.sin(a2), z2[0] * Math.sin(a2) + z2[1] * Math.cos(a2)];
          row.push([w1[0], w2[0], Math.cos(alpha) * w1[1] + Math.sin(alpha) * w2[1]]);
        }
        grid.push(row);
      }
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++)
          quads.push({ p: [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]], k: k1 * n + k2, k1, k2 });
    }
  }
  return quads;
}

function drawCY(ctx, { cx, cy, size, yaw, pitch, alpha, N = 9, wire = 0.7, a = 1 }) {
  const quads = cyMesh(alpha, N);
  const cam = { yaw, pitch, dist: 5.5, fov: 5.5 * size, cx, cy };
  const L = [0.4, -0.7, -0.6];
  const ln = Math.hypot(...L);
  const drawn = quads.map((q) => {
    const P = q.p.map((v) => project(v, cam));
    const z = (P[0][2] + P[1][2] + P[2][2] + P[3][2]) / 4;
    // normal in screen space (depth carried from projection)
    const ax = P[2][0] - P[0][0], ay = P[2][1] - P[0][1], az = (P[2][2] - P[0][2]) * size;
    const bx = P[3][0] - P[1][0], by = P[3][1] - P[1][1], bz = (P[3][2] - P[1][2]) * size;
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const nn = Math.hypot(nx, ny, nz) || 1;
    const lam = Math.abs((nx * L[0] + ny * L[1] + nz * L[2]) / (nn * ln));
    const fres = 1 - Math.abs(nz / nn);
    return { P, z, lam, fres, k: q.k, k1: q.k1, k2: q.k2 };
  });
  drawn.sort((p, q) => q.z - p.z);
  ctx.lineWidth = 0.7;
  ctx.lineJoin = 'round';
  for (const d of drawn) {
    const hue = (((d.k1 * 2 + d.k2) % 5) / 4) * 0.68;
    const base = spectrum(hue);
    const shade = 0.08 + 0.42 * d.lam ** 1.5;
    const rim = d.fres ** 4;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo(d.P[0][0], d.P[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(d.P[i][0], d.P[i][1]);
    ctx.closePath();
    ctx.fillStyle = shadeColor(base, shade + rim * 0.9);
    ctx.fill();
    if (wire > 0) {
      ctx.strokeStyle = shadeColor(base, 0.5 + rim * 1.4).replace('rgb(', 'rgba(').replace(')', `,${wire * (0.5 + rim)})`);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
function shadeColor(rgbaStr, k) {
  const m = rgbaStr.match(/rgba\((\d+),(\d+),(\d+)/);
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  const f = (v) => Math.round(clamp(v * k + 255 * Math.max(0, k - 1) * 0.6, 0, 255));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

let cySprite = null;
export function s1985(ctx, t) {
  const u = t - 8.0;
  if (u < -0.15 || u > 1.6) return;
  const cx = VC[0], cy = 455;
  const zin = seg(u, -0.15, 0.45, ease.snap);
  const back = seg(u, 0.9, 1.35, ease.inOutCubic);
  const yaw = 0.6 + u * 1.1 + (1 - zin) * 2.2;
  const pitch = 0.45 + 0.25 * Math.sin(u * 1.4);
  const alpha = 0.55 + 0.35 * Math.sin(u * 1.7);
  const size = 185 * lerp(0.1, 1, zin) * lerp(1, 0.16, back);

  if (back > 0) {
    // powers-of-ten pull back: one of these at every point of space
    if (!cySprite) cySprite = makeCanvas(160, 160);
    const sx = cySprite.getContext('2d');
    sx.clearRect(0, 0, 160, 160);
    drawCY(sx, { cx: 80, cy: 80, size: 60, yaw: yaw + 0.8, pitch, alpha, N: 6, wire: 0.5 });
    const cam = { pitch: -0.9, dist: 9, fov: 900, cx, cy: cy + 40 };
    ctx.save();
    ctx.beginPath();
    ctx.rect(900, 120, W - 900, 800);
    ctx.clip();
    for (let i = -5; i <= 5; i++) {
      for (let j = -3; j <= 3; j++) {
        if (i === 0 && j === 0) continue;
        const d = Math.hypot(i, j);
        const p = seg(back, 0.1 + d * 0.06, 0.55 + d * 0.06, ease.snap);
        if (p <= 0) continue;
        const [x, y, , k] = project([i * 1.25, 0, j * 1.25], cam);
        const s = (k / 100) * 36 * p;
        ctx.globalAlpha = p * clamp(1.1 - d / 5.5) * clamp((x - 900) / 140);
        ctx.drawImage(cySprite, x - s, y - s, s * 2, s * 2);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    const [mx, my] = project([0, 0, 0], cam);
    drawCY(ctx, { cx: lerp(cx, mx, back), cy: lerp(cy, my - 10, back), size, yaw, pitch, alpha, N: 9 });
  } else {
    lighter(ctx, () => glow(ctx, cx, cy, size * 2.2, C.violet, 0.22 * zin));
    drawCY(ctx, { cx, cy, size, yaw, pitch, alpha, N: 10 });
  }

  const ap = seg(u, 0.3, 0.65);
  const aq = seg(u, 0.85, 1.0);
  if (ap > 0 && aq < 1) {
    maskLine(ctx, '4 + 6 = 10', 1745, 250, 48, F.serifI, C.amber, ap, aq, { align: 'right' });
    ctx.globalAlpha = (1 - aq) * ap;
    glyphs(ctx, 'SEEN  +  HIDDEN  =  TOTAL', 1745, 280, 11, F.mono, C.mute, { track: 0.2, align: 'right' });
    ctx.globalAlpha = 1;
  }
  const lp = seg(u, 1.05, 1.35);
  if (lp > 0) {
    ctx.globalAlpha = 1 - seg(u, 1.38, 1.5);
    glyphs(ctx, decode('AT EVERY POINT OF SPACE', lp, 5, t), cx, 830, 13, F.mono, C.ink, { track: 0.35, align: 'center' });
    ctx.globalAlpha = 1;
  }
  caption(ctx, 'FIG. 5 — QUINTIC CALABI–YAU, 2D SLICE', 835, 196, t, 8.15, 9.4);
}

// -------------------------------------------------------------- 1995: M-theory
const MT = {
  c: [VC[0], 450],
  R: 268,
  labels: ['11D SUPERGRAVITY', 'HETEROTIC E₈×E₈', 'HETEROTIC SO(32)', 'TYPE I', 'TYPE IIB', 'TYPE IIA'],
  links: ['S¹ / Z₂', 'T', 'S', 'Ω', 'T', 'S¹'],
};
export function s1995(ctx, t) {
  const u = t - 9.5;
  if (u < 0 || u > 1.55) return;
  const [cx, cy] = MT.c;
  const rot = -Math.PI / 2 + u * 0.08;
  const out = seg(u, 1.2, 1.5, ease.inCubic);
  const V = Array.from({ length: 6 }, (_, k) => {
    const a = rot + (k * TAU) / 6;
    const sp = spring(u + 0.02 - k * 0.04, 2.4, 0.45);
    const r = MT.R * lerp(0.3, 1, clamp(sp)) * lerp(1, 0.85, out);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), sp, a];
  });
  // concave star-shaped moduli space
  const edge = (k) => {
    const p = V[k], q = V[(k + 1) % 6];
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const ctl = [cx + (m[0] - cx) * 0.38, cy + (m[1] - cy) * 0.38];
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const s = i / 30;
      pts.push([
        (1 - s) ** 2 * p[0] + 2 * (1 - s) * s * ctl[0] + s * s * q[0],
        (1 - s) ** 2 * p[1] + 2 * (1 - s) * s * ctl[1] + s * s * q[1],
      ]);
    }
    return pts;
  };
  const ep = seg(u, 0.1, 0.5, ease.inOutCubic);
  const fillA = seg(u, 0.3, 0.7) * (1 - out);
  if (fillA > 0) {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const pts = edge(k);
      pts.forEach(([x, y], i) => (k === 0 && i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, MT.R);
    g.addColorStop(0, rgba(C.cyan, 0.32 * fillA));
    g.addColorStop(1, rgba(C.violet, 0.04 * fillA));
    ctx.fillStyle = g;
    ctx.fill();
  }
  lighter(ctx, () => {
    for (let k = 0; k < 6; k++) {
      const p = clamp(ep * 1.6 - k * 0.12);
      if (p <= 0) continue;
      const pts = partial(edge(k), ease.snap(p));
      ctx.globalAlpha = 1 - out;
      ctx.strokeStyle = rgba(C.cyan, 0.35);
      ctx.lineWidth = 6;
      polyline(ctx, pts);
      ctx.stroke();
      ctx.strokeStyle = '#dffcff';
      ctx.lineWidth = 1.8;
      polyline(ctx, pts);
      ctx.stroke();
      // duality label on each edge
      const mid = edge(k)[15];
      const lp = seg(u, 0.55 + k * 0.04, 0.8 + k * 0.04);
      if (lp > 0) {
        const ox = (mid[0] - cx) * 0.28, oy = (mid[1] - cy) * 0.28;
        ctx.globalAlpha = lp * (1 - out);
        glyphs(ctx, MT.links[k], mid[0] - ox, mid[1] - oy + 6, 22, F.math, C.amber, { align: 'center' });
      }
    }
    ctx.globalAlpha = 1;
    // spokes with energy flowing into M
    const sp = seg(u, 0.6, 0.9) * (1 - out);
    if (sp > 0) {
      V.forEach(([x, y], k) => {
        ctx.strokeStyle = rgba(C.ink, 0.12 * sp);
        ctx.lineWidth = 1;
        polyline(ctx, [[x, y], [cx, cy]]);
        ctx.stroke();
        for (let j = 0; j < 3; j++) {
          const f = ((u - 0.6) * 1.2 + j / 3 + k * 0.07) % 1;
          glow(ctx, lerp(x, cx, f), lerp(y, cy, f), 14, C.amber, sp * Math.sin(f * Math.PI));
        }
      });
    }
  });
  // vertices and labels
  V.forEach(([x, y, sp, a], k) => {
    if (sp <= 0) return;
    const s = clamp(sp, 0, 1.3);
    lighter(ctx, () => glow(ctx, x, y, 30 * s, C.cyan, 0.9 * (1 - out)));
    dot(ctx, x, y, 5 * s, rgba('#ffffff', 1 - out));
    const lp = seg(u, 0.08 + k * 0.05, 0.48 + k * 0.05);
    if (lp > 0) {
      const lx = x + Math.cos(a) * 34, ly = y + Math.sin(a) * 34 + 5;
      const align = Math.abs(Math.cos(a)) < 0.2 ? 'center' : Math.cos(a) > 0 ? 'left' : 'right';
      ctx.globalAlpha = 1 - out;
      glyphs(ctx, decode(MT.labels[k], lp, k + 1, t), lx, ly + (Math.abs(Math.cos(a)) < 0.2 ? Math.sin(a) * 8 : 0), 13, F.mono, C.ink, { track: 0.12, align });
      ctx.globalAlpha = 1;
    }
  });
  // M
  const mp = spring(u - 0.55, 2.2, 0.38);
  if (mp > 0) {
    lighter(ctx, () => glow(ctx, cx, cy, 170 * clamp(mp), C.cyan, 0.5 * (1 - out)));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(mp * (1 + out * 0.4), mp * (1 + out * 0.4));
    ctx.globalAlpha = 1 - out;
    ctx.font = font(200, F.serifI);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('M', 0, 8);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
    // orbit
    ctx.save();
    ctx.strokeStyle = rgba(C.ink, 0.4 * (1 - out) * clamp(mp));
    ctx.setLineDash([3, 7]);
    ctx.lineDashOffset = -u * 40;
    ctx.beginPath();
    ctx.arc(cx, cy, 118, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  // shockwaves: the second one becomes the AdS boundary
  [[0.55, 0.6, 620], [1.2, 0.45, 0]].forEach(([t0, d, rMax], i) => {
    const p = seg(u, t0, t0 + d, i === 0 ? ease.outCubic : ease.snap);
    if (p <= 0 || (i === 0 && p >= 1)) return;
    const r = i === 0 ? 60 + rMax * p : lerp(40, ADS.R, p);
    const a = i === 0 ? 1 - p : 1;
    lighter(ctx, () => {
      ctx.strokeStyle = rgba(i === 0 ? C.ink : C.amber, 0.85 * a);
      ctx.lineWidth = i === 0 ? 3 * (1 - p) + 0.5 : 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
    });
  });
  caption(ctx, 'FIG. 6 — THE M-THEORY WEB OF DUALITIES', 835, 196, t, 9.65, 10.9);
}

// -------------------------------------------------------------- 1997: AdS/CFT
export const ADS = { c: [VC[0], 450], R: 330 };
const cx_ = (re, im) => [re, im];
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a, b) => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const cconj = (a) => [a[0], -a[1]];
const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const csub = (a, b) => [a[0] - b[0], a[1] - b[1]];
// z -> (z - a) / (1 - conj(a) z)
const toOrigin = (z, a) => cdiv(csub(z, a), csub([1, 0], cmul(cconj(a), z)));
const fromOrigin = (w, a) => cdiv(cadd(w, a), cadd([1, 0], cmul(cconj(a), w)));

function reflectAcross(z, a, b) {
  const bb = toOrigin(b, a);
  const phi = Math.atan2(bb[1], bb[0]);
  const w = toOrigin(z, a);
  const e = [Math.cos(2 * phi), Math.sin(2 * phi)];
  return fromOrigin(cmul(e, cconj(w)), a);
}
function geodesic(a, b, n) {
  const bb = toOrigin(b, a);
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(fromOrigin([(bb[0] * i) / n, (bb[1] * i) / n], a));
  return pts;
}

// {7,3} hyperbolic tiling, built once by reflecting heptagons across edges.
const TILES = (() => {
  const p = 7, q = 3;
  const r0 = Math.sqrt(Math.cos(Math.PI / q + Math.PI / p) / Math.cos(Math.PI / q - Math.PI / p));
  const first = { v: Array.from({ length: p }, (_, k) => cx_(r0 * Math.cos((TAU * k) / p + Math.PI / 2), r0 * Math.sin((TAU * k) / p + Math.PI / 2))), c: [0, 0], d: 0 };
  const tiles = [first];
  const seen = new Set(['0,0']);
  const key = (c) => `${Math.round(c[0] * 2000)},${Math.round(c[1] * 2000)}`;
  for (let i = 0; i < tiles.length && tiles.length < 1400; i++) {
    const T = tiles[i];
    for (let e = 0; e < p; e++) {
      const a = T.v[e], b = T.v[(e + 1) % p];
      const c = reflectAcross(T.c, a, b);
      if (Math.hypot(c[0], c[1]) > 0.975) continue;
      const k = key(c);
      if (seen.has(k)) continue;
      seen.add(k);
      tiles.push({ v: T.v.map((z) => reflectAcross(z, a, b)).reverse(), c, d: T.d + 1 });
    }
  }
  // sample each tile boundary along true geodesics
  tiles.forEach((T) => {
    T.loop = [];
    for (let e = 0; e < p; e++) T.loop.push(...geodesic(T.v[e], T.v[(e + 1) % p], 6).slice(0, 6));
  });
  return tiles;
})();

export function s1997(ctx, t) {
  const u = t - 11.0;
  if (u < 0 || u > 1.55) return;
  const [cx, cy] = ADS.c;
  const R = ADS.R;
  const tilt = seg(u, 1.2, 1.55, ease.inCubic);
  const out = seg(u, 1.25, 1.5);
  const grow = seg(u, 0, 0.55, ease.snap);
  // continuous hyperbolic motion: tiles stream in from the boundary
  const drift = 0.32 * seg(u, 0, 0.6, ease.inOutSine) + u * 0.12;
  const A = [Math.tanh(drift) * Math.cos(0.7 + u * 0.4), Math.tanh(drift) * Math.sin(0.7 + u * 0.4)];
  const spin = u * 0.15;
  const mob = (z) => {
    const w = fromOrigin(z, A);
    return [w[0] * Math.cos(spin) - w[1] * Math.sin(spin), w[0] * Math.sin(spin) + w[1] * Math.cos(spin)];
  };
  ctx.save();
  ctx.translate(cx, cy + tilt * 140);
  ctx.scale(1 + tilt * 0.5, Math.cos(tilt * 1.25) * (1 + tilt * 0.5));

  // bulk tiles
  TILES.forEach((T) => {
    const cz = mob(T.c);
    const rc = Math.hypot(cz[0], cz[1]);
    const vis = clamp((grow * 1.15 - rc) * 8);
    if (vis <= 0) return;
    const pts = T.loop.map((z) => {
      const w = mob(z);
      return [w[0] * R, w[1] * R];
    });
    const conf = 1 - rc * rc;
    if (conf * R < 3) return;
    polyline(ctx, pts, true);
    ctx.fillStyle = T.d % 2 ? rgba(C.violet, 0.12 * vis * (1 - out)) : rgba(C.cyan, 0.05 * vis * (1 - out));
    ctx.fill();
    ctx.strokeStyle = rgba(C.cyan, (0.25 + 0.5 * conf) * vis * (1 - out));
    ctx.lineWidth = 0.4 + 1.6 * conf;
    ctx.stroke();
  });

  // boundary: the CFT lives here
  lighter(ctx, () => {
    ctx.strokeStyle = rgba(C.amber, 0.35);
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = '#ffe2b0';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    const tp = seg(u, 0.1, 0.6) * (1 - out);
    ctx.strokeStyle = rgba(C.amber, 0.7 * tp);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * TAU - u * 0.3;
      const l = i % 5 === 0 ? 14 : 6;
      ctx.moveTo(Math.cos(a) * (R + 6), Math.sin(a) * (R + 6));
      ctx.lineTo(Math.cos(a) * (R + 6 + l * tp), Math.sin(a) * (R + 6 + l * tp));
    }
    ctx.stroke();
  });

  // Ryu-Takayanagi: boundary region A and its minimal bulk surface
  const rt = seg(u, 0.5, 0.95, ease.snap) * (1 - out);
  if (rt > 0) {
    const a1 = (212 * Math.PI) / 180, a2 = (298 * Math.PI) / 180;
    const p1 = [Math.cos(a1), Math.sin(a1)], p2 = [Math.cos(a2), Math.sin(a2)];
    const g = geodesic([p1[0] * 0.9999, p1[1] * 0.9999], [p2[0] * 0.9999, p2[1] * 0.9999], 60).map((z) => [z[0] * R, z[1] * R]);
    ctx.beginPath();
    g.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.arc(0, 0, R, a2, a1, true);
    ctx.closePath();
    ctx.fillStyle = rgba(C.magenta, 0.16 * rt);
    ctx.fill();
    lighter(ctx, () => {
      const shown = partial(g, rt);
      ctx.strokeStyle = rgba(C.magenta, 0.5);
      ctx.lineWidth = 7;
      polyline(ctx, shown);
      ctx.stroke();
      ctx.strokeStyle = '#ffd0e2';
      ctx.lineWidth = 2.2;
      polyline(ctx, shown);
      ctx.stroke();
      ctx.strokeStyle = rgba(C.magenta, 0.9);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, R, a1, lerp(a1, a2, rt));
      ctx.stroke();
    });
    ctx.globalAlpha = rt;
    const m = g[30];
    glyphs(ctx, 'γ', m[0] + 16, m[1] - 10, 30, F.math, '#ffd0e2');
    glyphs(ctx, 'S = Area(γ) / 4G', -R + 30, R + 64, 30, F.math, C.ink);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  const ap = seg(u, 0.25, 0.6);
  const aq = seg(u, 1.15, 1.35);
  annotate(ctx, cx + R * 0.72, cy - R * 0.69, cx + R + 40, cy - R + 10, 'BOUNDARY · CFT', ap, aq, C.amber);
  annotate(ctx, cx + 30, cy + 40, cx + R + 40, cy + 120, 'BULK · AdS GRAVITY', seg(u, 0.35, 0.7), aq);
  caption(ctx, 'FIG. 7 — POINCARÉ DISK  {7, 3}', 835, 196, t, 11.15, 12.35);
}

// -------------------------------------------------------------- 2003: landscape
const VACUA = (() => {
  const r = rng(2003);
  return Array.from({ length: 140 }, () => [r() * 12 - 6, r() * 14, r()]);
})();
export function s2003(ctx, t) {
  const u = t - 12.5;
  if (u < -0.2 || u > 1.05) return;
  const fin = seg(u, -0.2, 0.35, ease.snap);
  const implode = seg(u, 0.72, 1.0, ease.inExpo);
  const P0 = [W / 2, 540];
  const fly = u * 1.8;
  const cam = { pitch: -0.22, dist: 1.2, fov: 900, cx: VC[0] + 60, cy: 420, yaw: 0.1 * Math.sin(u * 1.3) };
  const hgt = (x, z) => 2.0 * fbm2(x * 0.3 + 3, (z + fly) * 0.3, 4) + 1.4;
  const pull = (p, d) => {
    const k = clamp(implode * 1.4 - d * 0.4);
    const e = ease.inCubic(k);
    return [lerp(p[0], P0[0], e), lerp(p[1], P0[1], e)];
  };
  const cols = 56, rows = 30;
  // hidden-line ridgelines, far to near: each ridge occludes the ones behind
  for (let j = rows; j >= 0; j--) {
    const z = 0.4 + (j / rows) * 13 - (fly % (13 / rows));
    const fog = clamp(1 - z / 13.5) * fin;
    const pts = [];
    for (let i = 0; i <= cols; i++) {
      const x = -8 + (16 * i) / cols;
      const h = hgt(x, z);
      const p = project([x, h, z], cam);
      pts.push(pull(p, z / 13));
    }
    if (implode < 0.3) {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineTo(pts[pts.length - 1][0], H + 50);
      ctx.lineTo(pts[0][0], H + 50);
      ctx.closePath();
      ctx.fillStyle = `rgba(5,8,19,${0.94 * fin * (1 - implode / 0.3)})`;
      ctx.fill();
    }
    lighter(ctx, () => {
      ctx.lineWidth = lerp(1.8, 0.8, z / 13);
      ctx.strokeStyle = mixHex(C.cyan, C.violet, clamp(z / 10), 0.85 * fog);
      polyline(ctx, pts);
      ctx.stroke();
    });
  }
  lighter(ctx, () => {
    // vacua sitting in the valleys
    VACUA.forEach(([x, z0, s], i) => {
      const z = ((z0 - fly) % 14 + 14) % 14 + 0.4;
      const h = hgt(x, z);
      if (h < 1.75) return;
      const p = pull(project([x, h - 0.05, z], cam), z / 13);
      const fog = clamp(1 - z / 13) * fin;
      const tw = 0.6 + 0.4 * Math.sin(u * 9 + i);
      glow(ctx, p[0], p[1], 26 * fog + 4, s > 0.7 ? C.magenta : C.amber, fog * tw);
      dot(ctx, p[0], p[1], 2.2 * fog, '#ffffff');
    });
  });
  // 10^N counter
  const cp = seg(u, 0.05, 0.62, ease.outExpo);
  const ca = seg(u, 0.0, 0.15) * (1 - seg(u, 0.66, 0.8));
  if (ca > 0) {
    const x = 1490, y = 300;
    ctx.globalAlpha = ca;
    glyphs(ctx, '10', x, y, 150, F.serifI, C.ink, { align: 'right' });
    glyphs(ctx, `${Math.round(cp * 500)}`, x + 6, y - 92, 64, F.bold, cp >= 1 ? C.amber : C.ink);
    glyphs(ctx, 'POSSIBLE VACUA — SOME ESTIMATE MANY MORE', x - 210, y + 38, 11, F.mono, C.mute, { track: 0.2 });
    ctx.globalAlpha = 1;
  }
  // implosion streaks
  if (implode > 0) {
    lighter(ctx, () => {
      for (let i = 0; i < 70; i++) {
        const a = hash(i) * TAU;
        const r0 = 900 * (1 - implode) * (0.5 + hash(i + 3));
        const r1 = r0 * (0.2 + 0.3 * hash(i + 9));
        ctx.strokeStyle = rgba(i % 3 ? C.cyan : C.amber, 0.5 * implode);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(P0[0] + Math.cos(a) * r0, P0[1] + Math.sin(a) * r0);
        ctx.lineTo(P0[0] + Math.cos(a) * r1, P0[1] + Math.sin(a) * r1);
        ctx.stroke();
      }
      glow(ctx, P0[0], P0[1], 60 + 140 * implode, C.cyan, implode);
    });
  }
  caption(ctx, 'FIG. 8 — A LANDSCAPE OF VACUA', 835, 196, t, 12.6, 13.25);
}

// -------------------------------------------------------------- outro
export function outro(ctx, t) {
  const u = t - 13.5;
  if (u < 0) return;
  const cx = W / 2, cy = 520;
  const tp = 0.42;
  const L = 700 * ease.snap(seg(u, 0.1, 0.5));
  const settle = seg(u, 0.9, 1.5);
  const disp = (s, tt) => pluckWithPull(s, tt - 13.5, tp, 0.25, 0.42, 78, 2.1, 1.6);
  const flare = Math.exp(-u * 6);
  lighter(ctx, () => {
    glow(ctx, cx, cy, 120 + 260 * flare, C.cyan, 0.8 * flare + 0.2);
    glow(ctx, cx, cy, 24, '#ffffff', 0.9 * (1 - seg(u, 0.4, 0.7)) + 0.1);
  });
  if (L > 2) {
    trails(ctx, (tt) => stringPts(cx, cy, L, (s) => disp(s, tt)), t, { n: 7, dt: 0.011, width: 2.4 });
    lighter(ctx, () => {
      glow(ctx, cx - L, cy, 40, C.amber, 0.8);
      glow(ctx, cx + L, cy, 40, C.amber, 0.8);
    });
  }
  const reveal = seg(u, 0.36, 0.95);
  if (reveal > 0) {
    drawTitle(ctx, t, {
      cx,
      cy,
      reveal,
      dispAt: (x) => disp(clamp((x - (cx - L)) / (2 * Math.max(L, 1))), t),
    });
  }
  const sp = seg(u, 0.5, 0.95);
  if (sp > 0) {
    glyphs(ctx, decode('1968 — 2026', sp, 9, t), cx, cy - 138, 17, F.mono, C.cyan, { track: 0.5, align: 'center' });
  }
  const lp = seg(u, 0.7, 1.1);
  if (lp > 0) maskLine(ctx, 'Fifty-eight years later — still vibrating.', cx, cy + 176, 40, F.serifI, C.ink, lp, 0, { align: 'center' });
  void settle;
}

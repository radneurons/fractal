// 24 flat vector pictograms drawn into radius r with the current fill (SPEC §7).
// Holes use the even-odd rule — never destination-out — so icons composite over anything.
import type { Ctx2D } from './textkit.ts';

export const ICONS = ['flame', 'sun', 'star', 'drop', 'bolt', 'wing', 'spiral', 'mountain', 'flake', 'cloud', 'heart', 'house',
  'moon', 'clock', 'road', 'crown', 'bird', 'eye', 'note', 'key', 'flower', 'person', 'people', 'seal'] as const;
export type IconName = (typeof ICONS)[number];

const TAU = Math.PI * 2;
function poly(g: Ctx2D, pts: number[], r: number): void {
  g.moveTo(pts[0] * r, pts[1] * r);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] * r, pts[i + 1] * r);
  g.closePath();
}
function circle(g: Ctx2D, x: number, y: number, rad: number, r: number): void { g.moveTo((x + rad) * r, y * r); g.arc(x * r, y * r, rad * r, 0, TAU); g.closePath(); }
function person(g: Ctx2D, x: number, s: number, r: number): void {
  circle(g, x, -0.62 * s, 0.2 * s, r);
  g.moveTo((x - 0.3 * s) * r, 0.95 * s * r);
  g.lineTo((x - 0.3 * s) * r, -0.05 * s * r);
  g.quadraticCurveTo((x - 0.3 * s) * r, -0.36 * s * r, x * r, -0.36 * s * r);
  g.quadraticCurveTo((x + 0.3 * s) * r, -0.36 * s * r, (x + 0.3 * s) * r, -0.05 * s * r);
  g.lineTo((x + 0.3 * s) * r, 0.95 * s * r);
  g.closePath();
}

/** Draw icon `name` centred on the origin inside radius r. */
/** `straightRoad`: draw the road without perspective, for when it replaces the letter I */
export function drawIcon(g: Ctx2D, name: string, r: number, straightRoad = false): void {
  g.beginPath();
  switch (name as IconName) {
    case 'flame':
      g.moveTo(0, -r);
      g.bezierCurveTo(0.2 * r, -0.5 * r, 0.75 * r, -0.2 * r, 0.62 * r, 0.42 * r);
      g.bezierCurveTo(0.52 * r, 0.9 * r, 0.2 * r, r, 0, r);
      g.bezierCurveTo(-0.3 * r, r, -0.68 * r, 0.8 * r, -0.62 * r, 0.3 * r);
      g.bezierCurveTo(-0.58 * r, -0.05 * r, -0.3 * r, -0.2 * r, -0.28 * r, -0.5 * r);
      g.bezierCurveTo(-0.1 * r, -0.4 * r, -0.05 * r, -0.7 * r, 0, -r);
      g.closePath();
      g.moveTo(0, 0.1 * r);
      g.bezierCurveTo(0.3 * r, 0.35 * r, 0.3 * r, 0.8 * r, 0, 0.8 * r);
      g.bezierCurveTo(-0.3 * r, 0.8 * r, -0.25 * r, 0.4 * r, 0, 0.1 * r);
      g.closePath();
      break;
    case 'sun':
      circle(g, 0, 0, 0.46, r);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU, c = Math.cos(a), s = Math.sin(a), w = 0.085;
        g.moveTo((c * 0.6 - s * w) * r, (s * 0.6 + c * w) * r);
        g.lineTo(c * r, s * r);
        g.lineTo((c * 0.6 + s * w) * r, (s * 0.6 - c * w) * r);
        g.closePath();
      }
      break;
    case 'star': {
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * TAU, rr = i % 2 ? 0.42 * r : r; if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.closePath();
      break;
    }
    case 'drop':
      g.moveTo(0, -r);
      g.bezierCurveTo(0.15 * r, -0.55 * r, 0.68 * r, -0.05 * r, 0.68 * r, 0.36 * r);
      g.arc(0, 0.36 * r, 0.68 * r, 0, Math.PI);
      g.bezierCurveTo(-0.68 * r, -0.05 * r, -0.15 * r, -0.55 * r, 0, -r);
      g.closePath();
      break;
    case 'bolt': poly(g, [0.25, -1, -0.55, 0.12, -0.05, 0.12, -0.3, 1, 0.58, -0.2, 0.06, -0.2], r); break;
    case 'wing':
      g.moveTo(-r, 0.1 * r);
      g.bezierCurveTo(-0.6 * r, -0.9 * r, 0.5 * r, -0.95 * r, r, -0.5 * r);
      g.bezierCurveTo(0.6 * r, -0.45 * r, 0.5 * r, -0.3 * r, 0.75 * r, -0.12 * r);
      g.bezierCurveTo(0.4 * r, -0.12 * r, 0.3 * r, 0.02 * r, 0.5 * r, 0.24 * r);
      g.bezierCurveTo(0.15 * r, 0.18 * r, 0.05 * r, 0.32 * r, 0.2 * r, 0.56 * r);
      g.bezierCurveTo(-0.3 * r, 0.6 * r, -0.75 * r, 0.45 * r, -r, 0.1 * r);
      g.closePath();
      break;
    case 'spiral': {
      const turns = 2.6, n = 90, w = 0.13;
      for (let i = 0; i <= n; i++) { const u = i / n, a = u * turns * TAU, rr = (0.1 + 0.9 * u) * r; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      for (let i = n; i >= 0; i--) { const u = i / n, a = u * turns * TAU, rr = Math.max(0, (0.1 + 0.9 * u) - w) * r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.closePath();
      break;
    }
    case 'mountain':
      poly(g, [-1, 0.8, -0.25, -0.75, 0.12, -0.1, 0.38, -0.5, 1, 0.8], r);
      poly(g, [-0.25, -0.75, -0.45, -0.3, -0.25, -0.42, -0.08, -0.25, 0.02, -0.33], r);
      break;
    case 'flake':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU, c = Math.cos(a), s = Math.sin(a), w = 0.07;
        const P = (x: number, y: number): [number, number] => [(c * x - s * y) * r, (s * x + c * y) * r];
        const pts: [number, number][] = [P(0, -w), P(0.5, -w), P(0.72, -0.3), P(0.82, -0.22), P(0.66, -w), P(1, -w), P(1, w), P(0.66, w), P(0.82, 0.22), P(0.72, 0.3), P(0.5, w), P(0, w)];
        g.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
        g.closePath();
      }
      break;
    case 'cloud':
      g.moveTo(-0.7 * r, 0.5 * r);
      g.bezierCurveTo(-1.1 * r, 0.5 * r, -1.1 * r, -0.05 * r, -0.68 * r, -0.08 * r);
      g.bezierCurveTo(-0.7 * r, -0.6 * r, -0.05 * r, -0.72 * r, 0.12 * r, -0.3 * r);
      g.bezierCurveTo(0.5 * r, -0.55 * r, 0.95 * r, -0.2 * r, 0.72 * r, 0.08 * r);
      g.bezierCurveTo(1.08 * r, 0.12 * r, 1.05 * r, 0.5 * r, 0.7 * r, 0.5 * r);
      g.closePath();
      break;
    case 'heart':
      g.moveTo(0, 0.9 * r);
      g.bezierCurveTo(-1.35 * r, 0.0 * r, -0.95 * r, -0.95 * r, -0.45 * r, -0.82 * r);
      g.bezierCurveTo(-0.2 * r, -0.76 * r, -0.05 * r, -0.6 * r, 0, -0.42 * r);
      g.bezierCurveTo(0.05 * r, -0.6 * r, 0.2 * r, -0.76 * r, 0.45 * r, -0.82 * r);
      g.bezierCurveTo(0.95 * r, -0.95 * r, 1.35 * r, 0.0 * r, 0, 0.9 * r);
      g.closePath();
      break;
    case 'house':
      poly(g, [-0.95, -0.1, 0, -0.95, 0.45, -0.55, 0.45, -0.85, 0.7, -0.85, 0.7, -0.32, 0.95, -0.1, 0.72, -0.1, 0.72, 0.9, -0.72, 0.9, -0.72, -0.1], r);
      poly(g, [-0.16, 0.9, -0.16, 0.3, 0.16, 0.3, 0.16, 0.9], r);
      break;
    case 'moon':
      g.arc(0, 0, r, 0.35 * Math.PI, 1.65 * Math.PI, false);
      g.arc(0.45 * r, 0, 0.82 * r, 1.42 * Math.PI, 0.58 * Math.PI, true);
      g.closePath();
      break;
    case 'clock':
      circle(g, 0, 0, 1, r);
      circle(g, 0, 0, 0.8, r);
      poly(g, [-0.07, 0.07, -0.07, -0.6, 0.07, -0.6, 0.07, -0.07, 0.45, -0.07, 0.45, 0.07], r);
      break;
    case 'road':
      if (straightRoad) { // standing in for an "I": parallel edges, so it does not read as an "A"
        poly(g, [-0.5, -1, 0.5, -1, 0.5, 1, -0.5, 1], r);
        for (let i = 0; i < 3; i++) { const y0 = -0.78 + i * 0.6; poly(g, [-0.07, y0, 0.07, y0, 0.07, y0 + 0.36, -0.07, y0 + 0.36], r); }
        break;
      }
      poly(g, [-0.28, -1, 0.28, -1, 0.9, 1, -0.9, 1], r);
      for (let i = 0; i < 3; i++) { const y0 = -0.8 + i * 0.62, w0 = 0.035 + i * 0.02; poly(g, [-w0, y0, w0, y0, w0 * 1.4, y0 + 0.34, -w0 * 1.4, y0 + 0.34], r); }
      break;
    case 'crown': poly(g, [-0.95, 0.7, -0.95, -0.55, -0.45, 0.0, 0, -0.85, 0.45, 0.0, 0.95, -0.55, 0.95, 0.7], r); break;
    case 'bird':
      g.moveTo(-r, -0.25 * r);
      g.bezierCurveTo(-0.55 * r, -0.75 * r, -0.2 * r, -0.4 * r, 0, 0.0 * r);
      g.bezierCurveTo(0.2 * r, -0.4 * r, 0.55 * r, -0.75 * r, r, -0.25 * r);
      g.bezierCurveTo(0.6 * r, -0.4 * r, 0.3 * r, -0.05 * r, 0.12 * r, 0.42 * r);
      g.lineTo(0, 0.7 * r);
      g.lineTo(-0.12 * r, 0.42 * r);
      g.bezierCurveTo(-0.3 * r, -0.05 * r, -0.6 * r, -0.4 * r, -r, -0.25 * r);
      g.closePath();
      break;
    case 'eye':
      g.moveTo(-r, 0);
      g.bezierCurveTo(-0.5 * r, -0.75 * r, 0.5 * r, -0.75 * r, r, 0);
      g.bezierCurveTo(0.5 * r, 0.75 * r, -0.5 * r, 0.75 * r, -r, 0);
      g.closePath();
      circle(g, 0, 0, 0.38, r);
      circle(g, 0, 0, 0.16, r);
      break;
    case 'note':
      g.ellipse(-0.3 * r, 0.62 * r, 0.36 * r, 0.27 * r, -0.35, 0, TAU);
      g.closePath();
      poly(g, [-0.02, 0.62, -0.02, -0.95, 0.75, -0.6, 0.75, -0.2, 0.14, -0.5, 0.14, 0.62], r);
      break;
    case 'key':
      circle(g, -0.5, 0, 0.5, r);
      circle(g, -0.6, 0, 0.2, r);
      poly(g, [-0.05, -0.12, 1, -0.12, 1, 0.12, 0.85, 0.12, 0.85, 0.42, 0.65, 0.42, 0.65, 0.12, 0.5, 0.12, 0.5, 0.34, 0.32, 0.34, 0.32, 0.12, -0.05, 0.12], r);
      break;
    case 'flower':
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; g.moveTo((Math.cos(a) * 0.58 + 0.4) * r, Math.sin(a) * 0.58 * r); g.arc(Math.cos(a) * 0.58 * r, Math.sin(a) * 0.58 * r, 0.4 * r, 0, TAU); g.closePath(); }
      break;
    case 'person': person(g, 0, 1, r); break;
    case 'people': person(g, -0.55, 0.78, r); person(g, 0.55, 0.78, r); person(g, 0, 1, r); break;
    case 'seal':
      for (let i = 0; i < 32; i++) { const a = (i / 32) * TAU, rr = (i % 2 ? 0.88 : 1) * r; if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.closePath();
      circle(g, 0, 0, 0.7, r);
      circle(g, 0, 0, 0.56, r);
      break;
    default: circle(g, 0, 0, 1, r);
  }
  if (name === 'flower') { g.fill('nonzero'); g.beginPath(); circle(g, 0, 0, 0.26, r); g.save(); g.globalCompositeOperation = 'source-over'; g.globalAlpha *= 0.35; g.fillStyle = '#000'; g.fill(); g.restore(); return; }
  g.fill('evenodd');
}

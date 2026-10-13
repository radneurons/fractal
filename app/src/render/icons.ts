// Flat vector pictograms, drawn centred at (0,0) inside radius r with the current fillStyle.
// Used as pictogram letters (BROADSIDE), poster glyphs (MISSION POSTER) and pop-up props.

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

function star(c: Ctx, r: number, n = 5, inner = .42, rot = 0) {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = rot - Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? r * inner : r; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  c.closePath();
}
export function starPath(c: Ctx, x: number, y: number, r: number, rot = 0) { c.save(); c.translate(x, y); star(c, r, 5, .42, rot); c.restore(); }

function heart(c: Ctx, r: number) {
  c.beginPath(); c.moveTo(0, r * .9);
  c.bezierCurveTo(-r * 1.25, r * .05, -r * .75, -r * 1.05, 0, -r * .45);
  c.bezierCurveTo(r * .75, -r * 1.05, r * 1.25, r * .05, 0, r * .9); c.closePath();
}
export function heartPath(c: Ctx, r: number) { heart(c, r); }

export function flameTongue(c: Ctx, cx: number, base: number, wd: number, h: number, lean: number) {
  c.beginPath(); c.moveTo(cx - wd / 2, base);
  c.bezierCurveTo(cx - wd * .62, base - h * .42, cx - wd * .1 + lean * .4, base - h * .62, cx + lean, base - h);
  c.bezierCurveTo(cx + wd * .12 + lean * .3, base - h * .58, cx + wd * .66, base - h * .38, cx + wd / 2, base);
  c.closePath(); c.fill();
}

export function person(c: Ctx, h: number, kind: number) {
  c.beginPath(); c.arc(0, -.86 * h, .075 * h, 0, TAU); c.fill();
  const torso = () => { c.beginPath(); c.moveTo(-.11 * h, -.78 * h); c.lineTo(.11 * h, -.78 * h); c.lineTo(.13 * h, -.38 * h); c.lineTo(-.13 * h, -.38 * h); c.fill(); c.fillRect(-.09 * h, -.4 * h, .07 * h, .4 * h); c.fillRect(.02 * h, -.4 * h, .07 * h, .4 * h); };
  if (kind === 0) { c.beginPath(); c.moveTo(-.14 * h, -.92 * h); c.quadraticCurveTo(0, -1.06 * h, .14 * h, -.92 * h); c.closePath(); c.fill(); torso(); }
  else if (kind === 1) { c.beginPath(); c.arc(0, -.87 * h, .1 * h, Math.PI * .9, Math.PI * 2.1); c.fill(); c.beginPath(); c.moveTo(-.08 * h, -.78 * h); c.lineTo(.08 * h, -.78 * h); c.lineTo(.2 * h, 0); c.lineTo(-.2 * h, 0); c.closePath(); c.fill(); }
  else if (kind === 2) { c.save(); c.scale(.62, .62); torso(); c.restore(); }
  else { c.fillRect(-.14 * h, -.97 * h, .28 * h, .05 * h); c.fillRect(-.07 * h, -1.03 * h, .14 * h, .08 * h); torso(); c.save(); c.translate(.16 * h, -.6 * h); c.rotate(-.25); c.fillRect(-.015 * h, -.45 * h, .03 * h, 1.05 * h); c.restore(); }
}

/** Draw icon `name` centred at origin within radius r. `t` animates a few (clock hands, sun rays). */
export function drawIcon(c: Ctx, name: string, r: number, t = 0) {
  c.save();
  switch (name) {
    case 'flame': {
      const tongue = (cx: number, base: number, wd: number, h: number, lean: number) => {
        c.moveTo(cx - wd / 2, base);
        c.bezierCurveTo(cx - wd * .62, base - h * .42, cx - wd * .1 + lean * .4, base - h * .62, cx + lean, base - h);
        c.bezierCurveTo(cx + wd * .12 + lean * .3, base - h * .58, cx + wd * .66, base - h * .38, cx + wd / 2, base); c.closePath();
      };
      c.beginPath(); tongue(0, r, r * 1.1, r * 2, r * .12); tongue(r * .05, r * .92, r * .42, r * .85, -r * .05); c.fill('evenodd');
      break;
    }
    case 'sun': {
      c.beginPath(); c.arc(0, 0, r * .45, 0, TAU); c.fill();
      for (let i = 0; i < 12; i++) { c.save(); c.rotate(i * TAU / 12 + t * .4); c.beginPath(); c.moveTo(-r * .07, -r * .58); c.lineTo(0, -r * (i % 2 ? .85 : 1)); c.lineTo(r * .07, -r * .58); c.fill(); c.restore(); }
      break;
    }
    case 'star': star(c, r); c.fill(); break;
    case 'drop': {
      c.beginPath(); c.moveTo(0, -r); c.bezierCurveTo(r * .2, -r * .5, r * .72, -r * .05, r * .72, r * .3); c.arc(0, r * .3, r * .72, 0, Math.PI); c.bezierCurveTo(-r * .72, -r * .05, -r * .2, -r * .5, 0, -r); c.fill();
      break;
    }
    case 'bolt': {
      c.beginPath(); c.moveTo(r * .25, -r); c.lineTo(-r * .45, r * .1); c.lineTo(-r * .02, r * .1); c.lineTo(-r * .3, r); c.lineTo(r * .5, -r * .18); c.lineTo(r * .06, -r * .18); c.lineTo(r * .4, -r); c.closePath(); c.fill();
      break;
    }
    case 'wing': {
      c.beginPath(); c.moveTo(-r, r * .3);
      c.bezierCurveTo(-r * .4, -r * .9, r * .6, -r * 1.0, r, -r * .6);
      c.bezierCurveTo(r * .7, -r * .3, r * .6, -r * .2, r * .75, -r * .05);
      c.bezierCurveTo(r * .35, 0, r * .3, r * .05, r * .5, r * .25);
      c.bezierCurveTo(r * .1, r * .3, -r * .3, r * .4, -r, r * .3); c.fill();
      break;
    }
    case 'spiral': {
      c.lineWidth = r * .16; c.lineCap = 'round'; c.strokeStyle = c.fillStyle as string;
      c.beginPath(); for (let i = 0; i <= 90; i++) { const a = i / 90 * TAU * 2.4 + t, rr = r * (.08 + .9 * i / 90); c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } c.stroke();
      break;
    }
    case 'mountain': {
      c.beginPath(); c.moveTo(-r, r * .7); c.lineTo(-r * .25, -r * .75); c.lineTo(r * .1, -r * .1); c.lineTo(r * .4, -r * .45); c.lineTo(r, r * .7); c.closePath(); c.fill();
      break;
    }
    case 'flake': {
      c.strokeStyle = c.fillStyle as string; c.lineWidth = r * .13; c.lineCap = 'round';
      for (let i = 0; i < 6; i++) { c.save(); c.rotate(i * TAU / 6); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -r); c.moveTo(0, -r * .55); c.lineTo(-r * .25, -r * .8); c.moveTo(0, -r * .55); c.lineTo(r * .25, -r * .8); c.stroke(); c.restore(); }
      break;
    }
    case 'cloud': {
      c.beginPath(); c.arc(-r * .45, r * .15, r * .38, 0, TAU); c.arc(0, -r * .15, r * .5, 0, TAU); c.arc(r * .45, r * .12, r * .4, 0, TAU); c.fill(); c.fillRect(-r * .45, r * .1, r * .9, r * .43);
      break;
    }
    case 'heart': heart(c, r); c.fill(); break;
    case 'house': {
      c.beginPath(); c.moveTo(-r, -r * .05); c.lineTo(0, -r * .95); c.lineTo(r, -r * .05); c.lineTo(r * .72, -r * .05); c.lineTo(r * .72, r * .85); c.lineTo(-r * .72, r * .85); c.lineTo(-r * .72, -r * .05); c.closePath();
      c.rect(-r * .2, r * .3, r * .4, r * .55); c.fill('evenodd');
      break;
    }
    case 'moon': {
      c.beginPath(); c.arc(0, 0, r, 0, TAU); c.arc(r * .42, -r * .2, r * .82, 0, TAU, true); c.fill('evenodd');
      break;
    }
    case 'clock': {
      c.beginPath(); c.arc(0, 0, r, 0, TAU); c.arc(0, 0, r * .8, 0, TAU, true); c.fill('evenodd');
      c.lineWidth = r * .12; c.lineCap = 'round'; c.strokeStyle = c.fillStyle as string;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.sin(t * 2) * r * .62, -Math.cos(t * 2) * r * .62); c.moveTo(0, 0); c.lineTo(Math.sin(t / 6) * r * .42, -Math.cos(t / 6) * r * .42); c.stroke();
      break;
    }
    case 'road': {
      c.beginPath(); c.moveTo(-r * .2, -r); c.lineTo(r * .2, -r); c.lineTo(r * .9, r); c.lineTo(-r * .9, r); c.closePath();
      for (let i = 0; i < 4; i++) { const y0 = -r * .95 + i * r * .48 + ((t * 2) % 1) * r * .48, y1 = Math.min(r * .95, y0 + r * .22); if (y0 >= y1) continue; const w0 = .03 + .05 * (y0 + r) / (2 * r), w1 = .03 + .05 * (y1 + r) / (2 * r); c.moveTo(-r * w0, y0); c.lineTo(-r * w1, y1); c.lineTo(r * w1, y1); c.lineTo(r * w0, y0); c.closePath(); }
      c.fill('evenodd');
      break;
    }
    case 'crown': {
      c.beginPath(); c.moveTo(-r, -r * .45); c.lineTo(-r * .55, r * .05); c.lineTo(0, -r * .7); c.lineTo(r * .55, r * .05); c.lineTo(r, -r * .45); c.lineTo(r * .8, r * .55); c.lineTo(-r * .8, r * .55); c.closePath(); c.fill();
      c.fillRect(-r * .8, r * .62, r * 1.6, r * .2);
      for (const x of [-1, 0, 1]) { c.beginPath(); c.arc(x * r * (x ? 1 : 0), x ? -r * .5 : -r * .76, r * .12, 0, TAU); c.fill(); }
      break;
    }
    case 'bird': {
      c.beginPath(); c.moveTo(-r, -r * .1);
      c.quadraticCurveTo(-r * .5, -r * .7, 0, -r * .05); c.quadraticCurveTo(r * .5, -r * .7, r, -r * .1);
      c.quadraticCurveTo(r * .45, -r * .35, 0, r * .25); c.quadraticCurveTo(-r * .45, -r * .35, -r, -r * .1); c.fill();
      break;
    }
    case 'eye': {
      c.beginPath(); c.moveTo(-r, 0); c.quadraticCurveTo(0, -r * 1.05, r, 0); c.quadraticCurveTo(0, r * 1.05, -r, 0); c.closePath();
      c.arc(0, 0, r * .42, 0, TAU, true); c.fill('evenodd');
      c.beginPath(); c.arc(0, 0, r * .22, 0, TAU); c.fill();
      break;
    }
    case 'note': {
      c.beginPath(); c.ellipse(-r * .35, r * .62, r * .34, r * .25, -.4, 0, TAU); c.fill();
      c.fillRect(-r * .08, -r * .95, r * .14, r * 1.55);
      c.beginPath(); c.moveTo(-r * .02, -r * .95); c.quadraticCurveTo(r * .5, -r * .7, r * .55, -r * .2); c.quadraticCurveTo(r * .35, -r * .5, -r * .02, -r * .55); c.fill();
      break;
    }
    case 'key': {
      c.beginPath(); c.arc(0, -r * .55, r * .4, 0, TAU); c.arc(0, -r * .55, r * .18, 0, TAU, true); c.fill('evenodd');
      c.fillRect(-r * .09, -r * .2, r * .18, r * 1.2);
      c.fillRect(r * .05, r * .55, r * .3, r * .14); c.fillRect(r * .05, r * .8, r * .22, r * .14);
      break;
    }
    case 'flower': {
      for (let i = 0; i < 6; i++) { c.save(); c.rotate(i * TAU / 6 + t * .2); c.beginPath(); c.ellipse(0, -r * .58, r * .25, r * .4, 0, 0, TAU); c.fill(); c.restore(); }
      c.beginPath(); c.arc(0, 0, r * .13, 0, TAU); c.fill();
      break;
    }
    case 'person': c.translate(0, r); person(c, r * 2, 0); break;
    case 'people': for (let i = -1; i <= 1; i++) { c.save(); c.translate(i * r * .6, r); person(c, r * (i ? 1.5 : 1.9), i + 1); c.restore(); } break;
    case 'seal': {
      c.beginPath(); for (let i = 0; i <= 72; i++) { const a = i / 72 * TAU, rr = r * (1 + .045 * Math.sin(a * 9) + .02 * Math.sin(a * 23)); c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } c.closePath();
      c.arc(0, 0, r * .74, 0, TAU, true); c.fill('evenodd');
      break;
    }
    default: c.beginPath(); c.arc(0, 0, r * .6, 0, TAU); c.fill();
  }
  c.restore();
}

export const ICON_NAMES = ['flame', 'sun', 'star', 'drop', 'bolt', 'wing', 'spiral', 'mountain', 'flake', 'cloud', 'heart', 'house', 'moon', 'clock', 'road', 'crown', 'bird', 'eye', 'note', 'key', 'flower', 'person', 'people', 'seal'];

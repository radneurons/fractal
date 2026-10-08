// Composition + "lens": camera moves, sub-frame motion blur, bloom,
// anamorphic streaks, chromatic aberration, flashes, vignette and grain.

import { W, H, C, clamp, lerp, seg, ease, noise1, rgba, makeCanvas, rng, glow } from './engine.js';
import { intro, s1968, s1970, s1974, s1984, s1985, s1995, s1997, s2003, outro, LOOP } from './scenes.js';
import { hud } from './hud.js';
import { HITS, FPS, DURATION } from './timeline.js';

const SCENES = [intro, s1968, s1970, s1974, s1984, s1985, s1995, s1997, s2003, outro];

let B = null; // buffers
function buffers() {
  if (B) return B;
  const mk = (w, h) => {
    const c = makeCanvas(w, h);
    return { c, x: c.getContext('2d') };
  };
  B = {
    work: mk(W, H),
    sub: mk(W, H),
    tmp: mk(W, H),
    chan: [mk(W, H), mk(W, H), mk(W, H)],
    q1: mk(W / 4, H / 4),
    q2: mk(W / 4, H / 4),
    e1: mk(W / 8, H / 8),
    e2: mk(W / 8, H / 8),
    st1: mk(W / 32, H / 4),
    st2: mk(W / 32, H / 4),
    bg: mk(W, H),
    vig: mk(W, H),
    grain: [],
  };
  // background: deep gradient + engineering dot grid
  const g = B.bg.x;
  const rg = g.createRadialGradient(W * 0.64, H * 0.42, 0, W * 0.64, H * 0.42, W * 0.8);
  rg.addColorStop(0, C.bg1);
  rg.addColorStop(1, C.bg0);
  g.fillStyle = rg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(160,180,255,0.07)';
  for (let x = 24; x < W; x += 48) for (let y = 24; y < H; y += 48) g.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
  // vignette
  const v = B.vig.x;
  const vg = v.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.72)');
  v.fillStyle = vg;
  v.fillRect(0, 0, W, H);
  // film grain plates
  for (let k = 0; k < 3; k++) {
    const gr = mk(W / 2, H / 2);
    const img = gr.x.createImageData(W / 2, H / 2);
    const r = rng(1000 + k);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = 128 + (r() + r() + r() - 1.5) * 120;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
      img.data[i + 3] = 255;
    }
    gr.x.putImageData(img, 0, 0);
    B.grain.push(gr);
  }
  return B;
}

// ------------------------------------------------------------ events
const hitEnv = (t, k = 7) => HITS.reduce((s, [t0, a]) => s + (t >= t0 ? a * Math.exp(-(t - t0) * k) : 0), 0);
export { drawWorld, post };
export function shake(t) {
  const tension = t < 6.5 ? seg(t, 6.0, 6.5, ease.inQuad) : 0;
  const a = 16 * hitEnv(t, 6) + 3 * tension;
  return [noise1(t * 31) * a, noise1(t * 29 + 40) * a, noise1(t * 13 + 9) * a * 0.0015];
}
function flash(t) {
  return [[6.5, 0.75, 22], [7.0, 0.2, 14], [10.05, 0.18, 12], [13.5, 0.4, 11]].reduce(
    (s, [t0, a, k]) => s + (t >= t0 ? a * Math.exp(-(t - t0) * k) : 0),
    0,
  );
}
function aberration(t) {
  const tension = t < 6.5 ? seg(t, 6.05, 6.5, ease.inCubic) : 0;
  return Math.min(28, 26 * hitEnv(t, 9) + 14 * tension + Math.abs(whipVel(t)) / 6);
}
// whip pan 1985 -> 1995
function whipX(t) {
  if (t < 9.5) return -W * 0.55 * ease.inExpo(seg(t, 9.28, 9.5));
  return W * 0.55 * (1 - ease.outExpo(seg(t, 9.5, 9.85)));
}
function whipVel(t) {
  return (whipX(t + 0.5 / FPS) - whipX(t - 0.5 / FPS)) / 1;
}

// ------------------------------------------------------------ world
function drawWorld(ctx, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.drawImage(buffers().bg.c, 0, 0);
  const [sx, sy, rot] = shake(t);
  ctx.save();
  ctx.translate(W / 2 + sx, H / 2 + sy);
  ctx.rotate(rot);
  // tension push-in on the graviton before the cut
  const push = 1 + 0.07 * ease.inQuad(seg(t, 5.7, 6.5)) * (t < 6.5 ? 1 : 0);
  // slow drift-in breathing across the whole film
  const breathe = 1 + 0.012 * Math.sin(t * 0.9);
  ctx.scale(push * breathe, push * breathe);
  ctx.translate(-W / 2, -H / 2);
  if (push > 1) {
    const [lx, ly] = LOOP.c;
    ctx.translate((W / 2 - lx) * (push - 1) * 1.2, (H / 2 - ly) * (push - 1) * 1.2);
  }
  ctx.translate(whipX(t), 0);
  for (const s of SCENES) {
    ctx.save();
    s(ctx, t);
    ctx.restore();
  }
  ctx.restore();
  ctx.save();
  ctx.translate(sx * 0.35, sy * 0.35);
  hud(ctx, t);
  ctx.restore();
}

// ------------------------------------------------------------ lens / post
function post(out, src, t, frame) {
  const b = buffers();
  const o = out;
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalAlpha = 1;
  o.globalCompositeOperation = 'source-over';
  o.filter = 'none';

  // chromatic aberration: split RGB, scale R out and B in about the centre
  const ca = aberration(t);
  if (ca > 1.5) {
    const tints = ['#ff0000', '#00ff00', '#0000ff'];
    b.chan.forEach((ch, i) => {
      ch.x.globalCompositeOperation = 'source-over';
      ch.x.drawImage(src, 0, 0);
      ch.x.globalCompositeOperation = 'multiply';
      ch.x.fillStyle = tints[i];
      ch.x.fillRect(0, 0, W, H);
      ch.x.globalCompositeOperation = 'source-over';
    });
    o.fillStyle = '#000';
    o.fillRect(0, 0, W, H);
    o.globalCompositeOperation = 'lighter';
    const k = ca / W;
    [1 + k, 1, 1 - k].forEach((s, i) => {
      const dx = clamp(whipVel(t) * 0.1, -24, 24) * (i - 1);
      o.drawImage(b.chan[i].c, W / 2 - (W / 2) * s + dx, H / 2 - (H / 2) * s, W * s, H * s);
    });
    o.globalCompositeOperation = 'source-over';
  } else {
    o.drawImage(src, 0, 0);
  }
  const lens = o.canvas;

  // bloom: square the image twice (soft threshold), blur at two scales
  const bright = (dst, w, h) => {
    dst.x.globalCompositeOperation = 'source-over';
    dst.x.filter = 'none';
    dst.x.drawImage(lens, 0, 0, w, h);
    dst.x.globalCompositeOperation = 'multiply';
    dst.x.drawImage(dst.c, 0, 0);
    dst.x.drawImage(dst.c, 0, 0);
    dst.x.globalCompositeOperation = 'source-over';
  };
  bright(b.q1, W / 4, H / 4);
  b.q2.x.clearRect(0, 0, W / 4, H / 4);
  b.q2.x.filter = 'blur(5px)';
  b.q2.x.drawImage(b.q1.c, 0, 0);
  b.q2.x.filter = 'none';
  b.e1.x.globalCompositeOperation = 'source-over';
  b.e1.x.drawImage(b.q1.c, 0, 0, W / 8, H / 8);
  b.e2.x.clearRect(0, 0, W / 8, H / 8);
  b.e2.x.filter = 'blur(9px)';
  b.e2.x.drawImage(b.e1.c, 0, 0);
  b.e2.x.filter = 'none';
  // anamorphic streak: squash horizontally, blur, stretch back, tint cyan
  b.st1.x.clearRect(0, 0, W / 32, H / 4);
  b.st1.x.drawImage(b.q1.c, 0, 0, W / 32, H / 4);
  b.st2.x.clearRect(0, 0, W / 32, H / 4);
  b.st2.x.filter = 'blur(3px)';
  b.st2.x.drawImage(b.st1.c, 0, 0);
  b.st2.x.filter = 'none';
  b.st2.x.globalCompositeOperation = 'multiply';
  b.st2.x.fillStyle = '#7fe8ff';
  b.st2.x.fillRect(0, 0, W / 32, H / 4);
  b.st2.x.globalCompositeOperation = 'source-over';

  o.globalCompositeOperation = 'lighter';
  o.globalAlpha = 0.5;
  o.drawImage(b.q2.c, 0, 0, W, H);
  o.globalAlpha = 0.6;
  o.drawImage(b.e2.c, 0, 0, W, H);
  o.globalAlpha = 0.45;
  o.drawImage(b.st2.c, 0, 0, W, H);
  o.globalAlpha = 1;

  // flash
  const fl = flash(t);
  if (fl > 0.003) {
    o.fillStyle = rgba('#eaf6ff', clamp(fl));
    o.fillRect(0, 0, W, H);
  }
  o.globalCompositeOperation = 'source-over';

  // vignette
  o.drawImage(b.vig.c, 0, 0);

  // grain (overlay), new plate + offset every frame
  const g = b.grain[frame % b.grain.length];
  const r = rng(frame * 7 + 3);
  o.globalCompositeOperation = 'overlay';
  o.globalAlpha = 0.11;
  const ox = Math.floor(r() * W / 2), oy = Math.floor(r() * H / 2);
  for (let x = -ox; x < W; x += W / 2) for (let y = -oy; y < H; y += H / 2) o.drawImage(g.c, x, y);
  o.globalAlpha = 1;
  o.globalCompositeOperation = 'source-over';

  // head & tail fades
  const black = Math.max(1 - seg(t, 0, 0.12), seg(t, DURATION - 0.32, DURATION - 0.02, ease.inQuad));
  if (black > 0) {
    o.fillStyle = `rgba(0,0,0,${clamp(black)})`;
    o.fillRect(0, 0, W, H);
  }
}

// Render one output frame into `out` (a W x H 2D context).
export function renderFrame(out, frame, { samples = 3, shutter = 0.5 } = {}) {
  const b = buffers();
  const t = frame / FPS;
  if (samples <= 1) {
    drawWorld(b.work.x, t);
  } else {
    // sub-frame accumulation = true motion blur (180-degree shutter by default)
    for (let i = 0; i < samples; i++) {
      const ts = t + ((i + 0.5) / samples - 0.5) * (shutter / FPS);
      drawWorld(b.sub.x, ts);
      b.work.x.setTransform(1, 0, 0, 1, 0, 0);
      b.work.x.globalCompositeOperation = 'source-over';
      b.work.x.globalAlpha = 1 / (i + 1);
      b.work.x.drawImage(b.sub.c, 0, 0);
    }
    b.work.x.globalAlpha = 1;
  }
  post(out, b.work.c, t, frame);
}

export { DURATION, FPS };

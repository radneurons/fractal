// FIREWORKS — the sky spells the hook (SPEC §8.15).
// Each hero is a shell that bursts exactly on its onset; its stars fly with linear drag from the burst centre to
// points sampled from the word's glyphs, arriving at τa = 0.28 s (launch velocity solved in closed form).
// Every star, trail, smoke puff and flash is a closed-form function of t — no simulation state.
// Reduce motion calms: the finale barrage (fewer shells), ground fountains (off) and the crowd cheer.
import type { Target } from '../render/glhost.ts';
import { GLEffect, type EffectContext, type EffectMeta, range, toggle, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { FS_HEAD, GLSL_NOISE, hexToRgb } from '../render/gl.ts';
import { makeCanvas, font, sizeForCap } from '../render/sdf.ts';
import { type Ctx2D, cleanDisplay, clamp01, subtitle, lineAt, setFont, textWidth } from '../render/textkit.ts';
import { mulberry32, hash01, lowerBound, sample } from '../analysis/dsp.ts';
import type { Word } from '../types.ts';

const VS_PT = `#version 300 es
layout(location=0) in vec2 aP; layout(location=1) in float aS; layout(location=2) in vec4 aC;
uniform vec2 uRes; out vec4 vC;
void main(){ vec2 n = aP / uRes * 2.0 - 1.0; gl_Position = vec4(n.x, -n.y, 0.0, 1.0); gl_PointSize = aS; vC = aC; }`;
const FS_PT = `#version 300 es
precision highp float; in vec4 vC; out vec4 o;
void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); float a = exp(-r * 3.2) + 0.8 * exp(-r * 22.0); o = vec4(vC.rgb * vC.a * a, 0.0); }`;
const FS_BG = FS_HEAD + GLSL_NOISE + `
uniform vec2 uRes; uniform float uT, uScene, uHorizon, uFlash, uCheer, uTransparent; uniform vec3 uFlashCol;
uniform vec4 uPuffs[10]; uniform vec4 uPuffC[10]; uniform vec4 uBack[4];
float skyline(float x){ // building tops (y up from the horizon, in frame heights)
  float c = floor(x * 46.0); float h = 0.04 + 0.09 * hash11(c * 1.7); h += step(0.93, hash11(c * 3.1)) * 0.12; return h; }
void main(){
  vec2 uv = vUv; float asp = uRes.x / uRes.y;
  float hy = uHorizon;
  vec3 sky = mix(vec3(0.035, 0.07, 0.16), vec3(0.006, 0.01, 0.03), smoothstep(hy, 1.0, uv.y));
  sky += step(0.997, hash21(floor(uv * uRes / 2.0))) * 0.35 * smoothstep(hy + 0.1, 0.9, uv.y);                   // background stars
  sky += uFlashCol * uFlash * (0.5 + 0.5 * smoothstep(hy, 1.0, 1.0 - uv.y + hy));                                 // bursts light the sky
  // readability backing: dark ellipses behind words while they hold
  for(int i=0;i<4;i++){ vec4 b = uBack[i]; if(b.z <= 0.0) continue; vec2 q = (uv - b.xy) / b.zw; sky *= 1.0 - 0.55 * b.z * 0.0 - 0.45 * exp(-dot(q, q) * 1.6) * step(0.001, b.z); }
  // smoke puffs: closed-form, drifting with the wind, lit by later bursts
  for(int i=0;i<10;i++){ vec4 p = uPuffs[i]; if(p.w <= 0.0) continue; vec2 q = (uv - p.xy) * vec2(asp, 1.0); float r = length(q) / p.z;
    float d = smoothstep(1.0, 0.2, r) * (0.45 + 0.55 * fbm3(q * 7.0 / p.z + p.xy * 13.0 + uT * 0.05)) * p.w;
    sky = mix(sky, uPuffC[i].rgb + uFlashCol * uFlash * 0.6, clamp(d, 0.0, 1.0) * 0.55); }
  vec3 c = sky;
  float y = uv.y - hy;
  if(uScene < 1.5){
    float top = skyline(uv.x * asp / 1.78);
    float isB = step(y, top) * step(-0.02, y);
    vec3 b = vec3(0.012, 0.014, 0.02);
    vec2 wc = fract(vec2(uv.x * 260.0, y * 150.0));
    b += vec3(1.0, 0.78, 0.4) * step(0.62, hash21(floor(vec2(uv.x * 260.0, y * 150.0)))) * step(0.3, wc.x) * step(wc.y, 0.55) * 0.35;
    b += uFlashCol * uFlash * 0.45 * smoothstep(top - 0.01, top, y);                                               // rim light
    c = mix(c, b, isB);
  } else {
    float trees = 0.05 + 0.04 * fbm3(vec2(uv.x * 18.0, 0.0)) + 0.02 * sin(uv.x * 90.0);
    float crowd = 0.012 + 0.01 * step(0.5, fract(uv.x * 120.0)) * (1.0 + 2.5 * uCheer * hash11(floor(uv.x * 120.0)));
    c = mix(c, vec3(0.01, 0.015, 0.012), step(y, trees) * step(-0.02, y));
    c = mix(c, vec3(0.0), step(uv.y, hy + crowd - 0.06) * step(hy - 0.12, uv.y));
  }
  if(uScene < 0.5 && uv.y < hy - 0.02){ // harbour: water with ripples reflecting the sky
    float wy = (hy - 0.02) - uv.y;
    vec2 r = vec2(uv.x + 0.004 * sin(uv.y * 300.0 + uT * 2.0), hy - 0.02 + wy);
    vec3 refl = mix(vec3(0.03, 0.05, 0.1), vec3(0.01, 0.015, 0.03), wy * 4.0) + uFlashCol * uFlash * 0.35;
    float top = skyline(r.x * asp / 1.78);
    refl = mix(refl, vec3(0.01), step(wy, top) * 0.8);
    c = refl * (0.85 + 0.15 * vnoise(vec2(uv.x * 40.0, uv.y * 400.0)));
  } else if(uv.y < hy - 0.02 && uScene > 0.5) c = mix(vec3(0.01), c, 0.0) + vec3(0.008);
  o = vec4(c, uTransparent > 0.5 ? 0.0 : 1.0);
}`;
const FS_OVER = FS_HEAD + `uniform sampler2D uTex; void main(){ o = texture(uTex, vUv); }`;
const FS_MASK = FS_HEAD + `uniform sampler2D uTex; void main(){ o = vec4(texture(uTex, vUv).rgb, 1.0); }`;

type Shell = 'peony' | 'chrysanthemum' | 'willow' | 'crossette' | 'strobe';
interface Burst { w: Word | null; tb: number; flight: number; lx: number; p0: [number, number]; tx: Float32Array; col: [number, number, number]; type: Shell; seed: number; size: number; rect: [number, number, number, number] }

const CONCEPT: Record<string, string> = { fire: '#FFC24A', water: '#4FA3FF', heart: '#FF3B5C', light: '#FFFFFF', star: '#FFFFFF' };
const PAL = ['#FF4D6D', '#FFD166', '#06D6A0', '#4CC9F0', '#C77DFF', '#FF9F1C'];

export class Fireworks extends GLEffect {
  static meta: EffectMeta = {
    id: 'fireworks', name: 'Fireworks', kind: 'gl',
    description: 'Shells burst on every hero word and their stars spell it in the sky over a harbour, a city or a field.',
    affinity: aff(0.95, 0.3, 0.2, 0.25, 0.85, 0.35, 0.9, 0.6),
    supportsTransparent: true, supportsLive: true,
    params: [
      range('stars', 'Stars per word', 'Stars', 450, 120, 1200, 10, false),
      range('hang', 'Hang time', 'Stars', 1.2, 0.3, 3, 0.05),
      range('gravity', 'Gravity', 'Physics', 1, 0, 2, 0.01),
      range('drag', 'Drag', 'Physics', 2.4, 0.5, 6, 0.05, false),
      select('scene', 'Scene', 'Scene', 'harbour', ['harbour', 'city', 'field']),
      select('colour', 'Colour mode', 'Colour', 'concept', ['concept', 'palette', 'gold']),
      toggle('smoke', 'Smoke', 'Scene', true),
      toggle('finale', 'Finale on drops', 'Scene', true),
      toggle('fountains', 'Ground fountains', 'Scene', true),
      toggle('backing', 'Readability backing', 'Scene', true),
    ],
  };
  readonly meta = Fireworks.meta;
  private bursts: Burst[] = [];
  private kicks: number[] = [];
  private buf: WebGLBuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private data = new Float32Array(0);
  private horizon = 0.26;

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const gl = this.scope.gl, { W, H } = this, ly = this.ly, a = this.a;
    const portrait = H > W;
    this.horizon = this.str('scene') === 'field' ? 0.18 : 0.26;
    const nStars = Math.round(this.num('stars'));
    const rnd = mulberry32(this.seed * 7 + 3);
    const rc = makeCanvas(900, 300);
    const rg = rc.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    const mode = this.str('colour');
    const bursts: Burst[] = [];
    let lastX = 0.5;
    for (const w of ly.words) {
      if (w.role !== 'hero' || w.backing) continue;
      const text = cleanDisplay(w, 'upper');
      // glyph raster → star targets
      rg.clearRect(0, 0, 900, 300);
      rg.font = font('oswald', sizeForCap('oswald', 170));
      const tw = rg.measureText(text).width;
      const k = Math.min(1, 860 / tw);
      rg.save(); rg.translate(450 - (tw * k) / 2, 235); rg.scale(k, k); rg.fillStyle = '#fff'; rg.fillText(text, 0, 0); rg.restore();
      const img = rg.getImageData(0, 0, 900, 300).data;
      const ink: number[] = [];
      for (let i = 0; i < 900 * 300; i++) if (img[i * 4 + 3] > 160) ink.push(i);
      if (!ink.length) continue;
      // placement in the sky (pixels): width ≤ 60 % of the frame
      // a word still hanging in the sky: take the other side, a different height and at most 44 % width
      const prev = bursts[bursts.length - 1];
      const overlap = !!prev && prev.tb + this.num('hang') + 1.6 > w.start;
      const maxFrac = portrait ? 0.86 : overlap ? 0.44 : 0.6;
      const wordW = Math.min(W * maxFrac, (tw * k / 860) * W * (portrait ? 0.92 : 0.62));
      const sc = wordW / Math.max(1, tw * k);
      let cx = 0.25 + 0.5 * rnd();
      let cy = H * (0.2 + 0.18 * rnd());
      if (overlap && !portrait) { cx = lastX < 0.5 ? 0.74 : 0.26; cy = prev.p0[1] < H * 0.28 ? H * (0.34 + 0.05 * rnd()) : H * (0.18 + 0.04 * rnd()); }
      else if (overlap) { cx = 0.5; cy = prev.p0[1] < H * 0.3 ? H * 0.42 : H * 0.2; }
      else if (Math.abs(cx - lastX) < 0.12) cx = cx < 0.5 ? cx + 0.2 : cx - 0.2;
      lastX = cx;
      const tx = new Float32Array(nStars * 2);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < nStars; i++) {
        const p = ink[Math.floor(rnd() * ink.length)];
        const x = (p % 900) + rnd() - 450 + 0, y = Math.floor(p / 900) + rnd() - 160;
        tx[i * 2] = cx * W + x * sc; tx[i * 2 + 1] = cy + y * sc;
        x0 = Math.min(x0, tx[i * 2]); x1 = Math.max(x1, tx[i * 2]); y0 = Math.min(y0, tx[i * 2 + 1]); y1 = Math.max(y1, tx[i * 2 + 1]);
      }
      const c = w.concept ?? '';
      const type: Shell = c === 'fire' || c === 'light' ? 'willow' : c === 'shock' ? 'crossette' : c === 'star' ? 'strobe' : w.stress > 0.85 ? 'chrysanthemum' : 'peony';
      const hex = mode === 'gold' ? '#FFC24A' : mode === 'concept' && CONCEPT[c] ? CONCEPT[c] : this.s.voicePalette && w.voice === 'B' ? '#4CC9F0' : PAL[Math.floor(hash01(w.id, this.seed, 2) * PAL.length)];
      bursts.push({ w, tb: w.start - this.s.anticipationMs / 1000, flight: 1.1 + 0.4 * rnd(), lx: cx * W + (rnd() - 0.5) * W * 0.1, p0: [(x0 + x1) / 2, (y0 + y1) / 2], tx, col: hexToRgb(hex), type, seed: Math.floor(rnd() * 1e6), size: wordW, rect: [(x0 + x1) / 2 / W, 1 - (y0 + y1) / 2 / H, (x1 - x0) / W * 0.7 + 0.06, (y1 - y0) / H * 0.9 + 0.08] });
    }
    // finale barrage on drops: a dense burst of shells over one bar
    if (this.bool('finale')) for (const d of a.drops) {
      const bar = (60 / (a.bpm || 120)) * (a.meter === 6 ? 2 : a.meter);
      const n = this.s.reduceMotion ? 3 : 9;
      for (let i = 0; i < n; i++) {
        const tb = d + (i / n) * bar;
        const px = W * (0.12 + 0.76 * rnd()), py = H * (0.12 + 0.3 * rnd());
        bursts.push({ w: null, tb, flight: 0.9 + 0.3 * rnd(), lx: px, p0: [px, py], tx: new Float32Array(0), col: hexToRgb(PAL[i % PAL.length]), type: i % 3 === 0 ? 'chrysanthemum' : i % 3 === 1 ? 'willow' : 'peony', seed: Math.floor(rnd() * 1e6), size: W * 0.3, rect: [0, 0, 0, 0] });
      }
    }
    bursts.sort((p, q) => p.tb - q.tb);
    this.bursts = bursts;
    this.kicks = a.onsets.filter((t, i) => a.onsetStrength[i] > 0.9 && sample(a.bands.bass, t + 0.03) > 0.5 && a.sections.some((s) => t >= s.start && t < s.end && (s.label === 'chorus' || s.label === 'drop')));
    this.buf = this.scope.buffer();
    this.vao = this.scope.vao();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 28, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
  }

  /** Closed-form star position with linear drag k and gravity g, arriving at `tg` at τa. */
  private starPos(p0: [number, number], tgx: number, tgy: number, tau: number, k: number, g: number, ta: number, hang: number, droop: number): [number, number, number] {
    if (tau <= ta) {
      const e = 1 - Math.exp(-k * ta);
      // v0 = (target − p0 − g·(τa/k − (1 − e^(−kτa))/k²)) · k / (1 − e^(−kτa))
      const vx = ((tgx - p0[0]) * k) / e;
      const vy = ((tgy - p0[1] - g * (ta / k - e / (k * k))) * k) / e;
      const f = (1 - Math.exp(-k * tau)) / k;
      return [p0[0] + vx * f, p0[1] + vy * f + g * (tau / k - f / k), 1];
    }
    const d = tau - ta - hang;
    if (d <= 0) return [tgx, tgy, 1];
    return [tgx, tgy + 0.5 * g * droop * d * d, Math.max(0, 1 - d / 1.4)];
  }

  protected drawGL(t: number, target: Target, mask: boolean): void {
    const gl = this.scope.gl, { W, H } = this, a = this.a;
    const g = this.num('gravity') * H * 0.22;
    const k = this.num('drag'), ta = 0.28, hang = this.num('hang');
    const pts: number[] = [];
    const push = (x: number, y: number, s: number, r: number, gg: number, b: number, al: number) => { if (al > 0.01) pts.push(x, y, s, r, gg, b, al); };
    const harbour = this.str('scene') === 'harbour';
    const waterY = H * (1 - this.horizon + 0.02);
    let flash = 0;
    const flashCol = [0, 0, 0];
    const puffs = new Float32Array(40), puffC = new Float32Array(40);
    let np = 0;
    const back = new Float32Array(16);
    let nb = 0;
    const pr = Math.max(1.5, H / 300);
    const i0 = lowerBound(this.bursts.map((b) => b.tb + hang + 4), t);
    for (let bi = Math.max(0, i0 - 2); bi < this.bursts.length; bi++) {
      const b = this.bursts[bi];
      if (b.tb - b.flight > t) break;
      const tau = t - b.tb;
      const rnd = mulberry32(b.seed);
      if (tau < 0) { // the shell rises from the skyline with a spark trail
        const u = 1 + tau / b.flight;
        const sy = H * (1 - this.horizon), x = b.lx + (b.p0[0] - b.lx) * u, y = sy + (b.p0[1] - sy) * (1 - (1 - u) * (1 - u));
        if (!mask) for (let j = 0; j < 14; j++) { const uj = Math.max(0, u - j * 0.012); push(b.lx + (b.p0[0] - b.lx) * uj + (rnd() - 0.5) * 3, sy + (b.p0[1] - sy) * (1 - (1 - uj) * (1 - uj)) + j * 1.5, pr * (2.4 - j * 0.12), 1, 0.75, 0.4, 0.9 * (1 - j / 14)); }
        void x; void y;
        continue;
      }
      if (tau > ta + hang + 3) continue;
      // flash light, decaying over 0.5 s
      const fl = Math.exp(-tau / 0.17) * (tau < 0.5 ? 1 : 0) * (b.w ? 1 : 0.7);
      if (fl > flash * 0.3) { flash += fl * 0.35; flashCol[0] += b.col[0] * fl; flashCol[1] += b.col[1] * fl; flashCol[2] += b.col[2] * fl; }
      // smoke puff left by the burst
      if (np < 10 && this.bool('smoke')) {
        const age = tau;
        puffs[np * 4] = (b.p0[0] + age * W * 0.006) / W; puffs[np * 4 + 1] = 1 - (b.p0[1] - age * H * 0.004) / H;
        puffs[np * 4 + 2] = (b.size / W) * (0.35 + 0.08 * age); puffs[np * 4 + 3] = Math.max(0, 0.5 * Math.min(1, age / 0.4) * (1 - age / 7));
        puffC[np * 4] = 0.06; puffC[np * 4 + 1] = 0.065; puffC[np * 4 + 2] = 0.08; np++;
      }
      const col = b.col;
      const trailN = b.type === 'willow' ? 7 : b.type === 'chrysanthemum' ? 5 : 3;
      const hangB = b.type === 'willow' ? hang * 0.7 : hang;
      const droop = b.type === 'willow' ? 0.55 : 0.3;
      // letter stars
      const n = b.tx.length / 2;
      if (b.w && tau >= ta && tau < ta + hangB && this.bool('backing') && nb < 4) { back[nb * 4] = b.rect[0]; back[nb * 4 + 1] = b.rect[1]; back[nb * 4 + 2] = b.rect[2]; back[nb * 4 + 3] = b.rect[3]; nb++; }
      for (let i = 0; i < n; i++) {
        const tgx = b.tx[i * 2], tgy = b.tx[i * 2 + 1];
        const blink = b.type === 'strobe' && tau > ta ? (hash01(i, Math.floor(tau * 14), b.seed) > 0.45 ? 1 : 0.15) : 1;
        const sparkle = tau > ta ? 0.7 + 0.3 * hash01(i, Math.floor(tau * 20), b.seed) : 1;
        if (mask) { const [x, y, al] = this.starPos(b.p0, tgx, tgy, tau, k, g, ta, hangB, droop); push(x, y, pr * 3.4, 1, clamp01(tau / 2), 1, al); continue; }
        for (let j = 0; j <= trailN; j++) {
          const tj = tau - j / 60;
          if (tj < 0) break;
          const [x, y, al] = this.starPos(b.p0, tgx, tgy, tj, k, g, ta, hangB, droop);
          const tr = 1 - j / (trailN + 1);
          const hot = tj < ta + 0.15 ? 0.45 : 0;                            // white-hot on arrival
          push(x, y, pr * (j ? 1.6 : 2.5), col[0] + hot, col[1] + hot, col[2] + hot, al * tr * blink * sparkle * (j ? 0.5 : 1));
          if (harbour && !j && y < waterY) push(x, 2 * waterY - y + Math.sin(x * 0.05 + t * 3) * 3, pr * 2, col[0], col[1], col[2], al * 0.22);
        }
        if (b.type === 'crossette' && tau > ta + 0.05 && tau < ta + 0.6 && i % 3 === 0) { // stars split in four
          const d = (tau - ta - 0.05) * H * 0.12;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) push(tgx + dx * d, tgy + dy * d, pr * 1.6, col[0], col[1], col[2], 1 - (tau - ta) / 0.6);
        }
      }
      // spectacle stars: a radial shell around the word (not letters)
      if (!mask) {
        const ns = b.w ? 140 : 320;
        for (let i = 0; i < ns; i++) {
          const ang = rnd() * Math.PI * 2, sp = (0.6 + 0.6 * rnd()) * b.size * 1.1;
          const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
          for (let j = 0; j <= trailN; j++) {
            const tj = tau - j / 60;
            if (tj < 0) break;
            const f = (1 - Math.exp(-k * tj)) / k;
            const x = b.p0[0] + vx * f, y = b.p0[1] + vy * f + g * (tj / k - f / k) * (1 + droop);
            const al = Math.max(0, 1 - tj / (b.w ? 1.3 : 2.0)) * (1 - j / (trailN + 1));
            push(x, y, pr * (j ? 1.3 : 2), col[0], col[1], col[2], al * (b.w ? 0.55 : 1));
          }
        }
      }
    }
    // ground fountains on kicks in choruses
    if (!mask && this.bool('fountains') && !this.s.reduceMotion) {
      const ki = lowerBound(this.kicks, t);
      for (let q = Math.max(0, ki - 4); q < ki; q++) {
        const age = t - this.kicks[q];
        if (age > 0.9) continue;
        const fx = W * (0.15 + 0.7 * hash01(q, this.seed, 3)), fy = H * (1 - this.horizon + 0.005);
        const r = mulberry32(q * 31 + 1);
        for (let i = 0; i < 70; i++) {
          const ang = -Math.PI / 2 + (r() - 0.5) * 0.5, sp = H * (0.35 + 0.3 * r());
          const x = fx + Math.cos(ang) * sp * age, y = fy + Math.sin(ang) * sp * age + 0.5 * H * 0.9 * age * age;
          push(x, y, pr * 1.6, 1, 0.8, 0.45, 1 - age / 0.9);
        }
      }
    }
    // ---- draw ----
    const att = this.flash(t);
    if (!mask) {
      const fc = flash > 0 ? [flashCol[0] / (flash / 0.35), flashCol[1] / (flash / 0.35), flashCol[2] / (flash / 0.35)] : [0, 0, 0];
      const prog = this.scope.program(FS_BG);
      this.scope.host.bind(target);
      gl.useProgram(prog.program);
      gl.uniform4fv(prog.uniforms.get('uPuffs') ?? null, puffs);
      gl.uniform4fv(prog.uniforms.get('uPuffC') ?? null, puffC);
      gl.uniform4fv(prog.uniforms.get('uBack') ?? null, back);
      const cheer = this.s.reduceMotion ? 0 : a.drops.reduce((m, d) => Math.max(m, t >= d && t < d + 2 ? Math.abs(Math.sin((t - d) * 9)) * (1 - (t - d) / 2) : 0), 0);
      this.scope.pass(prog, target, { uRes: [W, H], uT: t, uScene: ['harbour', 'city', 'field'].indexOf(this.str('scene')), uHorizon: this.horizon, uFlash: Math.min(0.6, flash) * att * this.intensity, uFlashCol: fc, uCheer: cheer, uTransparent: this.s.transparentBackground ? 1 : 0 });
    } else this.scope.host.clear(0, 0, 0, 1);
    // stars, additive
    const nPts = pts.length / 7;
    if (nPts) {
      if (this.data.length < pts.length) this.data = new Float32Array(Math.ceil(pts.length * 1.3));
      this.data.set(pts);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, pts.length), gl.STREAM_DRAW);
      const pp = this.scope.program(FS_PT, VS_PT);
      this.scope.host.bind(target);
      gl.useProgram(pp.program);
      this.scope.host.setUniforms(pp, { uRes: [W, H] });
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.POINTS, 0, nPts);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }
    // supports and connectives as small warm lantern text along the horizon
    const ov = this.layer(mask ? 'mask' : 'over');
    ov.g.clearRect(0, 0, W, H);
    this.lanterns(ov.g, t, mask);
    if (!mask) subtitle(ov.g, this.ly.lines[lineAt(this.ly, t)], t, this.s, W, H, '#fff');
    const tex = this.scope.upload(mask ? 'mask' : 'over', ov.c as HTMLCanvasElement);
    this.scope.pass(this.scope.program(mask ? FS_OVER : FS_OVER), target, { uTex: tex }, { blend: 'alpha' });
    void FS_MASK;
  }

  private lanterns(g: Ctx2D, t: number, mask: boolean): void {
    const { W, H } = this, ly = this.ly;
    const li = lineAt(ly, t + 0.3);
    if (li < 0) return;
    const line = ly.lines[li];
    if (t > line.end + 2) return;
    const ws = line.words.map((i) => ly.words[i]);
    const cap = Math.min(W, H) * 0.034;
    const texts = ws.map((w) => cleanDisplay(w, this.s.caseMode));
    const tot = texts.reduce((s, x, i) => s + textWidth(x, 'montserrat600', cap) + (i ? cap * 0.6 : 0), 0);
    const k = Math.min(1, (W * 0.9) / tot);
    let x = (W - tot * k) / 2;
    const y = H * (1 - this.horizon) - cap * 0.9 - H * 0.1;
    setFont(g, 'montserrat600', cap * k);
    g.textBaseline = 'alphabetic';
    ws.forEach((w, i) => {
      const age = t - (w.start - this.s.anticipationMs / 1000);
      const wd = textWidth(texts[i], 'montserrat600', cap) * k;
      const lit = age >= 0 ? 1 : 0.3;
      const fade = Math.min(1, (line.end + 2 - t) / 0.6);
      g.globalAlpha = Math.max(0, lit * fade);
      if (mask) g.fillStyle = `rgb(255,${Math.round(clamp01(Math.max(0, age) / 2) * 255)},255)`;
      else { g.shadowColor = 'rgba(255,170,60,0.9)'; g.shadowBlur = cap * 0.6 * lit; g.fillStyle = w.role === 'hero' ? '#FFE6A8' : '#FFC27A'; }
      g.fillText(texts[i], x, y);
      x += wd + cap * 0.6 * k;
    });
    g.shadowBlur = 0; g.globalAlpha = 1;
  }
}
registerEffect(Fireworks);

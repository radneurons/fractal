// LIQUID CHROME — ferrofluid typography (SPEC §8.5). Each line is a pool of liquid metal that melts into the next.
// Two text layers (previous / next line) are blended as blurred fields so blobs stay connected while melting.
// v3: spikes follow the percussive part; vibrato ripples the surface; metals tint toward the key colour.
// Reduce motion calms: the perspective tilt and dolly, droplets (off) and spike jitter.
import type { Target } from '../render/glhost.ts';
import { GLEffect, type EffectContext, type EffectMeta, range, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { layoutLine, maskFill, type LineLayout } from './common.ts';
import { FS_HEAD, GLSL_NOISE, hexToRgb, hsl } from '../render/gl.ts';
import { type Ctx2D, setFont, clamp01, smooth } from '../render/textkit.ts';
import { sample, hash01, lowerBound } from '../analysis/dsp.ts';
import { keyHue } from '../analysis/harmony.ts';

const FS = FS_HEAD + GLSL_NOISE + `
uniform sampler2D uA, uB;
uniform vec2 uRes; uniform float uT, uMelt, uPoolA, uPoolB, uSpike, uDens, uIri, uStudio, uTilt, uDolly, uCen, uVib, uBack, uTransparent;
uniform vec3 uTint; uniform vec4 uDrops[8];
float pool(vec2 uv){ vec2 q = (uv - vec2(0.5, 0.46)) / vec2(0.3, 0.12); return smoothstep(1.25, 0.55, length(q)); }
vec3 field(vec2 uv, float lod){ // x = blob field, y = rise (sung height), z = active word
  vec4 a = textureLod(uA, uv, lod), b = textureLod(uB, uv, lod);
  float fa = mix(a.r, pool(uv), uPoolA), fb = mix(b.r, pool(uv), uPoolB);
  float ra = a.r > 0.02 ? a.g / a.r : 0.22, rb = b.r > 0.02 ? b.g / b.r : 0.22;
  return vec3(mix(fa, fb, uMelt), mix(mix(ra, 1.0, uPoolA), mix(rb, 1.0, uPoolB), uMelt), mix(a.b, b.b, uMelt));
}
float height(vec2 uv){
  float m = uMelt * (1.0 - uMelt) * 4.0;                // 0 at rest, 1 mid-melt
  float lod = 1.2 + 3.4 * m;
  vec3 f = field(uv, lod), f2 = field(uv, lod + 2.0);
  // bridge: a smooth-min style swell keeps blobs connected while melting
  float fld = f.x + 0.35 * m * f2.x;
  for(int i=0;i<8;i++){ vec4 d = uDrops[i]; if(d.w > 0.0){ vec2 q = (uv - d.xy) * vec2(uRes.x / uRes.y, 1.0); fld += d.w * exp(-dot(q, q) / (d.z * d.z)); } }
  float body = smoothstep(0.42 - 0.12 * m, 0.62, fld);
  float dome = 0.55 * smoothstep(0.45, 1.0, fld) + 0.45 * sqrt(clamp(f2.x * 1.4, 0.0, 1.0));
  float h = body * dome * mix(0.22, 1.0, clamp(f.y, 0.0, 1.0));
  // ferrofluid spikes: a hexagonal lattice of cones on the letter core of the active word
  if(uSpike > 0.001){
    vec2 p = uv * uRes / (20.0 / uDens * uRes.y / 720.0);
    vec2 a2 = vec2(1.0, 1.7320508); vec2 h2 = a2 * 0.5;
    vec2 ga = mod(p, a2) - h2, gb = mod(p - h2, a2) - h2;
    vec2 g = dot(ga, ga) < dot(gb, gb) ? ga : gb;
    float cone = max(0.0, 1.0 - length(g) * 2.1);
    h += cone * cone * uSpike * smoothstep(0.55, 0.95, f2.x) * smoothstep(0.2, 0.7, f.z) * 0.9;
  }
  h += 0.02 * uVib * sin(uv.x * 90.0 + uT * 38.0) * body;
  return h;
}
vec3 studio(vec3 r){ // bright sky over a sharp horizon, dark floor; softbox and two strip lights
  float y = r.y;
  vec3 sky = mix(vec3(0.62, 0.7, 0.8), vec3(1.0), smoothstep(0.0, 0.8, y)) * uStudio;
  vec3 fl = mix(vec3(0.03), vec3(0.2, 0.19, 0.18), smoothstep(-1.0, 0.0, y));
  vec3 c = mix(fl, sky, smoothstep(-0.015, 0.015, y));
  c += vec3(1.4) * smoothstep(0.8, 0.94, y) * smoothstep(0.55, 0.0, abs(r.x)) * uStudio;
  c += vec3(1.0) * smoothstep(0.07, 0.0, abs(abs(r.x) - 0.6)) * smoothstep(-0.05, 0.5, y) * uStudio;
  return c;
}
void main(){
  // slow perspective tilt about the x axis, with a dolly on choruses
  vec2 uv = vUv - 0.5;
  uv /= 1.0 + uDolly;
  float z = 1.0 + (uv.y) * sin(uTilt) * 0.9;
  uv = vec2(uv.x / z, uv.y / z * cos(uTilt * 0.5)) + 0.5;
  float h = height(uv);
  vec2 e = vec2(1.6) / uRes;
  vec3 n = normalize(vec3((height(uv - vec2(e.x, 0.0)) - height(uv + vec2(e.x, 0.0))) * 14.0, (height(uv - vec2(0.0, e.y)) - height(uv + vec2(0.0, e.y))) * 14.0, 1.0));
  float cov = smoothstep(0.02, 0.09, h);
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
  r.y += 0.1 + (h - 0.55) * 0.55;                        // the horizon runs through the middle of the letters
  float fres = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.5);
  vec3 env = studio(normalize(r));
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (h + 1.5 * uCen + fres + vec3(0.0, 0.33, 0.67)));
  vec3 metal = env * uTint;
  metal = mix(metal, metal * film * 1.6, uIri * (0.25 + 0.75 * fres));
  metal += fres * 0.35 * uStudio;
  // backdrop
  vec3 bg; float vg = length((vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0));
  if(uBack < 0.5) bg = mix(vec3(0.20, 0.205, 0.215), vec3(0.035, 0.035, 0.04), smoothstep(0.1, 1.0, vg)) + 0.012 * vnoise(vUv * uRes * 0.7);
  else if(uBack < 1.5) bg = vec3(0.0);
  else bg = mix(vec3(0.97), vec3(0.8), smoothstep(0.2, 1.1, vg));
  // contact shadow, offset below
  float sh = smoothstep(0.02, 0.3, height(uv + vec2(0.004, 0.016)));
  bg *= 1.0 - 0.55 * sh * (1.0 - cov);
  vec3 c = mix(bg, metal, cov);
  float alpha = uTransparent > 0.5 ? max(cov, sh * 0.5 * (1.0 - cov)) : 1.0;
  if(uTransparent > 0.5) c = mix(vec3(0.0), metal, cov);
  o = vec4(c, alpha);
}`;
const FS_MASK = FS_HEAD + `uniform sampler2D uTex; void main(){ o = vec4(texture(uTex, vUv).rgb, 1.0); }`;
const METALS: Record<string, string> = { chrome: '#F2F5F8', gold: '#F5C469', rose: '#F1B6A6', oil: '#8C93A8', mercury: '#DADDE3' };

export class Chrome extends GLEffect {
  static meta: EffectMeta = {
    id: 'chrome', name: 'Liquid Chrome', kind: 'gl',
    description: 'Ferrofluid typography: each line is a pool of liquid metal that spikes with the bass and melts into the next.',
    affinity: aff(0.85, 0.5, 0.25, 0.4, 0.85, 0.7, 0.55, 0.7),
    supportsTransparent: true,
    params: [
      select('metal', 'Metal', 'Metal', 'chrome', ['chrome', 'gold', 'rose', 'oil', 'mercury', 'key']),
      range('iridescence', 'Iridescence', 'Metal', 0.35, 0, 1, 0.01),
      range('studio', 'Studio brightness', 'Metal', 1, 0.4, 1.6, 0.01),
      range('spike', 'Spike height', 'Ferrofluid', 0.8, 0, 2, 0.01),
      range('density', 'Spike density', 'Ferrofluid', 1, 0.5, 2, 0.01),
      range('sensitivity', 'Bass sensitivity', 'Ferrofluid', 1, 0, 2, 0.01),
      range('melt', 'Melt (beats)', 'Motion', 2, 0.5, 6, 0.25, false),
      range('droplets', 'Droplets per kick', 'Motion', 3, 0, 4, 1),
      range('tilt', 'Tilt', 'Motion', 0.6, 0, 1, 0.01),
      select('backdrop', 'Backdrop', 'Look', 'studio', ['studio', 'black', 'white']),
    ],
  };
  readonly meta = Chrome.meta;
  private lines: (LineLayout | null)[] = [];
  /** stages: index into lines, or −1 for the pool; with the melt window */
  private stages: { idx: number; t0: number; t1: number }[] = [];
  private kicks: number[] = [];

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const { W, H } = this, ly = this.ly, a = this.a;
    const beat = a.bpm > 0 ? 60 / a.bpm : 0.5;
    const melt = this.num('melt') * beat;
    this.lines = ly.lines.map((line) => {
      let L = layoutLine(ly, line, { maxW: W * 0.8, cap: Math.min(W, H) * 0.19, heroScale: 1.15, supportScale: 1, connScale: 0.7, fonts: { hero: 'montserrat', support: 'montserrat', conn: 'montserrat' }, caseMode: this.s.caseMode, maxRows: 3, lineGap: 0.36, gap: 0.24 });
      if (L.height > H * 0.7) L = layoutLine(ly, line, { maxW: W * 0.8, cap: (Math.min(W, H) * 0.19 * H * 0.7) / L.height, heroScale: 1.15, supportScale: 1, connScale: 0.7, fonts: { hero: 'montserrat', support: 'montserrat', conn: 'montserrat' }, caseMode: this.s.caseMode, maxRows: 4, lineGap: 0.36, gap: 0.24 });
      return L;
    });
    // stages: pool → line → (pool on long gaps) → line …; the melt finishes before the line's first word
    const st: { idx: number; t0: number; t1: number }[] = [{ idx: -1, t0: -10, t1: -9 }];
    ly.lines.forEach((line, i) => {
      const prev = ly.lines[i - 1];
      if (prev && line.start - prev.end > 5) { const t0 = prev.end + 0.6; st.push({ idx: -1, t0, t1: t0 + melt }); }
      const t1 = line.start - 0.08;
      const lo = st[st.length - 1].t1;
      st.push({ idx: i, t0: Math.max(lo, t1 - melt), t1 });
    });
    if (ly.lines.length) { const t0 = ly.lines[ly.lines.length - 1].end + 0.9; st.push({ idx: -1, t0, t1: t0 + melt * 1.5 }); }
    this.stages = st;
    // kicks: strong onsets with bass > 0.5
    this.kicks = a.onsets.filter((t, i) => a.onsetStrength[i] > 0.9 && sample(a.bands.bass, t + 0.03) > 0.5);
  }

  /** R = coverage, G = coverage × rise (unsung words sit at 22 %), B = the active word. */
  private paintLine(g: Ctx2D, idx: number, t: number, mask: boolean): void {
    const { W, H } = this;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const L = this.lines[idx];
    if (!L) return;
    const ox = (W - L.width) / 2, oy = (H - L.height) / 2 - H * 0.02;
    g.textBaseline = 'alphabetic';
    for (const k of L.words) {
      setFont(g, k.font, k.cap);
      const age = t - (k.w.start - this.s.anticipationMs / 1000);
      if (mask) { if (age >= -0.4) { g.fillStyle = maskFill(age, age >= 0 ? 1 : 0.35); g.fillText(k.text, ox + k.x, oy + k.y); } continue; }
      // unsung words sit low and rise to full height at their onset
      const rise = 0.22 + 0.78 * smooth(clamp01(age / 0.12 + 0.0)) * (age >= 0 ? 1 : 0);
      const active = age >= 0 && t < k.w.end + 0.25 && k.w.role !== 'connective' ? 1 : 0;
      g.fillStyle = `rgb(255,${Math.round(255 * rise)},${255 * active})`;
      g.fillText(k.text, ox + k.x, oy + k.y);
    }
  }

  protected drawGL(t: number, target: Target, mask: boolean): void {
    const { W, H } = this, a = this.a;
    let si = 0;
    for (let i = 0; i < this.stages.length; i++) if (this.stages[i].t0 <= t) si = i;
    const B = this.stages[si], A = this.stages[Math.max(0, si - 1)];
    const melt = smooth(clamp01((t - B.t0) / Math.max(0.05, B.t1 - B.t0)));
    if (mask) {
      const { c, g } = this.layer('mask');
      this.paintLine(g, melt > 0.5 ? B.idx : A.idx, t, true);
      this.scope.pass(this.scope.program(FS_MASK), target, { uTex: this.scope.upload('mask', c as HTMLCanvasElement) });
      return;
    }
    const la = this.layer('a'), lb = this.layer('b');
    this.paintLine(la.g, A.idx, t, false);
    this.paintLine(lb.g, B.idx, t, false);
    const ta = this.scope.upload('a', la.c as HTMLCanvasElement, { mip: true }), tb = this.scope.upload('b', lb.c as HTMLCanvasElement, { mip: true });
    // droplets: ballistic arcs from seeded emitter points; they vanish as they land back
    const drops = new Float32Array(32);
    const nD = this.s.reduceMotion ? 0 : Math.round(this.num('droplets'));
    if (nD > 0) {
      let slot = 0;
      const ki = lowerBound(this.kicks, t) - 1;
      for (let k = ki; k >= Math.max(0, ki - 2) && slot < 8; k--) {
        const tk = this.kicks[k], dt = t - tk;
        if (dt < 0 || dt > 1.1) continue;
        for (let d = 0; d < nD && slot < 8; d++) {
          const sd = Math.round(tk * 100) + d * 13;
          const x0 = 0.22 + 0.56 * hash01(sd, this.seed, 1), y0 = 0.5 + 0.06 * (hash01(sd, 2) - 0.5);
          const vy = (380 + 320 * hash01(sd, 3)) / 720, vx = (hash01(sd, 4) - 0.5) * 0.25;
          const y = y0 + vy * dt - 0.5 * (1400 / 720) * dt * dt;
          if (y < y0 - 0.01) continue; // landed back into the pool
          drops[slot * 4] = x0 + vx * dt; drops[slot * 4 + 1] = y; drops[slot * 4 + 2] = 0.022 + 0.012 * hash01(sd, 5); drops[slot * 4 + 3] = 0.9;
          slot++;
        }
      }
    }
    const sec = a.sections.find((s) => t >= s.start && t < s.end);
    const chorus = sec && (sec.label === 'chorus' || sec.label === 'drop') ? 1 : 0;
    const rm = this.s.reduceMotion ? 0.25 : 1;
    const metal = this.str('metal');
    let tint = hexToRgb(METALS[metal] ?? METALS.chrome);
    if (metal === 'key' || this.s.paletteSource === 'key') { const c = hsl(keyHue(a.key.tonic), 0.45, 0.72); tint = [c[0], c[1], c[2]]; }
    else if (this.s.paletteSource === 'artwork' && this.ctx.artwork) tint = hexToRgb(this.ctx.artwork.vivid1).map((v) => 0.45 + 0.55 * v) as [number, number, number];
    const lineB = B.idx >= 0 ? this.ly.lines[B.idx] : null;
    const vib = lineB ? lineB.words.some((i) => { const w = this.ly.words[i]; return w.vibrato && t >= w.start && t < w.end; }) : false;
    const prog = this.scope.program(FS);
    this.scope.host.bind(target);
    this.scope.gl.useProgram(prog.program);
    this.scope.gl.uniform4fv(prog.uniforms.get('uDrops') ?? null, drops);
    this.scope.pass(prog, target, {
      uA: ta, uB: tb, uRes: [W, H], uT: t, uMelt: melt, uPoolA: A.idx < 0 ? 1 : 0, uPoolB: B.idx < 0 ? 1 : 0,
      uSpike: this.num('spike') * this.num('sensitivity') * this.react * Math.max(sample(a.percussive, t), 0.6 * sample(a.bands.bass, t)) * this.intensity,
      uDens: this.num('density'), uIri: this.num('iridescence'), uStudio: this.num('studio'),
      uTilt: (12 * Math.PI / 180) * this.num('tilt') * this.camEnergy * rm * Math.sin(t * 0.23), uDolly: 0.06 * chorus * this.camEnergy * rm * smooth(clamp01((t - (sec?.start ?? 0)) / 2)),
      uCen: sample(a.centroid, t), uVib: vib ? 1 : 0, uBack: ['studio', 'black', 'white'].indexOf(this.str('backdrop')), uTransparent: this.s.transparentBackground ? 1 : 0, uTint: tint,
    });
  }
}
registerEffect(Chrome);

// ELEMENTS — words become the element they name (SPEC §8.2). Dark, cinematic, smoky.
// The world is laid out in section columns; a 2D colour layer holds ordinary words and element residue,
// a mask layer holds the ACTIVE hero, and one shader pass turns that mask into fire, light, water,
// thunder, wind, vortex, quake, ice or smoke.
// v3: fire height follows the word's pitch; melismas stretch the activity window; vibrato ripples water.
// Reduce motion calms: camera drift, shock displacement and flash, quake shake, wind smear length.
import type { ElementKind, Word } from '../types.ts';
import { type EffectContext, type EffectMeta, range, toggle, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { TextShaderEffect, layoutLine, maskFill, frameKeys, type LineLayout, type LW } from './common.ts';
import type { Target } from '../render/glhost.ts';
import { FS_HEAD, GLSL_NOISE, hexToRgb, rgba } from '../render/gl.ts';
import { type Ctx2D, setFont, clamp01, smooth, easeOutCubic, timingOf, subtitle, lineAt, type TimingOpts } from '../render/textkit.ts';
import { type CamKey, sampleCamera, applyCamera } from '../render/camera.ts';
import { sample, pulse, hash01 } from '../analysis/dsp.ts';

const EL: ElementKind[] = ['none', 'light', 'fire', 'water', 'shock', 'wind', 'vortex', 'quake', 'ice', 'smoke'];
const LEAD: Record<ElementKind, number> = { none: 0.3, light: 0.6, fire: 0.7, water: 1.0, shock: 0, wind: 0.9, vortex: 0.8, quake: 0.6, ice: 0.8, smoke: 0.9 };
const PAL: Record<string, { bg0: string; bg1: string; paper: string }> = {
  soot: { bg0: '#0B0A09', bg1: '#171411', paper: '#EFE6D2' }, midnight: { bg0: '#05070D', bg1: '#0F1626', paper: '#E3E9F5' },
  ember: { bg0: '#0D0604', bg1: '#24100A', paper: '#F5E3CF' }, ash: { bg0: '#101010', bg1: '#242424', paper: '#EDEDED' },
};

const FS = FS_HEAD + GLSL_NOISE + `
uniform sampler2D uCol, uAct;
uniform vec2 uRes, uC, uSz; uniform float uT, uA, uAge, uInt, uFlash, uRain, uSparks, uShockR, uPitch, uVib, uPersist, uTransparent, uRM;
uniform int uEl; uniform vec4 uAud; uniform vec3 uBg0, uBg1, uPaper;
#define M(uv, l) textureLod(uAct, uv, l).r
vec3 emberRamp(float x){ x = clamp(x, 0.0, 1.0);
  vec3 c = mix(vec3(0.0), vec3(0.6, 0.04, 0.0), smoothstep(0.0, 0.25, x));
  c = mix(c, vec3(1.0, 0.45, 0.05), smoothstep(0.2, 0.55, x)); c = mix(c, vec3(1.0, 0.85, 0.3), smoothstep(0.5, 0.8, x));
  return mix(c, vec3(1.0), smoothstep(0.8, 1.0, x)); }
vec2 voro(vec2 p){ vec2 n = floor(p), f = fract(p); float md = 8.0, md2 = 8.0, id = 0.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g = vec2(float(i), float(j)); vec2 o2 = hash22(n + g); vec2 r = g + o2 - f; float d = dot(r, r);
    if(d < md){ md2 = md; md = d; id = hash21(n + g); } else if(d < md2) md2 = d; }
  return vec2(sqrt(md2) - sqrt(md), id); }
void main(){
  vec2 uv = vUv; float asp = uRes.x / uRes.y;
  vec2 px = vec2(uv.x, 1.0 - uv.y) * uRes;
  vec2 cpx = vec2(uC.x, 1.0 - uC.y) * uRes;
  vec2 rel = (uv - uC) * vec2(asp, 1.0);
  float r = length(rel);
  vec2 duv = uv; vec3 extra = vec3(0.0); float flashAdd = 0.0;
  // ---- displacement elements ----
  if(uEl == 4 && uAge >= 0.0){ // shock: expanding ring wave
    float R = uShockR * uAge;
    float w = 0.06 + 0.25 * uAge;
    float ring = exp(-pow((r - R) / w, 2.0)) * exp(-uAge * 2.2) * (1.0 - uRM);
    duv -= normalize(rel + 1e-5) / vec2(asp, 1.0) * ring * 0.035 * uInt;
    extra += vec3(0.75, 0.85, 1.0) * ring * 0.35;
    flashAdd = step(uAge, 4.0 / 60.0) * uFlash;
  } else if(uEl == 6){ // vortex: a swirl whose strength reverses as it ends
    float s = uA * sin(clamp(uAge, -1.0, 3.0) * 1.3 + 0.6) * 1.6 * uInt;
    float a = s * exp(-r * r / max(0.02, 1.4 * uSz.x * uSz.x * asp * asp + 0.03));
    vec2 q = rot(a) * rel; duv = uC + q / vec2(asp, 1.0);
  } else if(uEl == 7){ // quake: plates shake on impact, then lock with persistent offsets
    vec2 v = voro(px / (uRes.y * 0.11) + 3.0);
    float shake = exp(-max(uAge, 0.0) * 5.0) * step(0.0, uAge) * (1.0 - uRM);
    float near = exp(-r * r / (2.2 * uSz.x * uSz.x * asp * asp + 0.05));
    vec2 off = (vec2(hash11(v.y * 91.7), hash11(v.y * 37.1)) - 0.5);
    duv += off * near * uA * (0.008 + 0.035 * shake * sin(uT * 70.0 + v.y * 40.0)) * uInt;
    extra += vec3(1.0, 0.45, 0.1) * smoothstep(0.035, 0.0, v.x) * near * uA * 0.8;
  }
  // ---- sample the layers (wind smears everything downwind) ----
  vec4 col = texture(uCol, duv); float m = M(duv, 0.0);
  if(uEl == 5 && uA > 0.0){
    vec4 acc = col; float am = m, wsum = 1.0;
    float len = 0.11 * uA * uInt * (1.0 - 0.6 * uRM) * (0.6 + 0.4 * fbm3(vec2(uv.y * 9.0, uT * 0.8)));
    for(int i=1;i<7;i++){ float k = float(i) / 6.0; float w = 1.0 - k * 0.85; vec2 o2 = vec2(-len * k, 0.006 * sin(uv.x * 40.0 + uT * 3.0) * k);
      acc += texture(uCol, duv + o2) * w; am += M(duv + o2, 0.0) * w; wsum += w; }
    col = acc / wsum; m = am / wsum;
  }
  // ---- background: soot gradient with drifting smoke ----
  float vg = length((uv - 0.5) * vec2(asp, 1.0));
  vec3 bg = mix(uBg1, uBg0, smoothstep(0.1, 0.95, vg));
  bg += 0.035 * fbm(uv * vec2(asp, 1.0) * 3.0 + vec2(uT * 0.02, -uT * 0.015));
  vec3 c = bg; float alpha = 1.0 - uTransparent;
  if(uTransparent > 0.5) c = vec3(0.0);
  // ---- element looks (behind and inside the active word) ----
  float glow = M(duv, 5.0), soft = M(duv, 3.0), edge = M(duv, 1.5);
  vec3 word = uPaper; float wAlpha = m; vec3 add = extra;
  if(uEl == 1){ // light: cold blue type and god-rays marched from the word
    vec2 lightPos = uC + vec2(0.0, 0.42);
    float rays = 0.0; vec2 q = uv;
    vec2 stepv = (lightPos - uv) / 26.0 * 0.92;
    for(int i=0;i<26;i++){ q += stepv; rays += M(q, 2.5) * (1.0 - float(i) / 26.0); }
    rays = rays / 26.0 * 3.2;
    word = mix(vec3(0.62, 0.8, 1.0), vec3(1.0), smoothstep(0.4, 1.0, soft));
    add += vec3(0.55, 0.75, 1.0) * rays * uA * uInt + vec3(0.6, 0.8, 1.0) * glow * 0.5 * uA;
  } else if(uEl == 2){ // fire: domain-warped flames through an ember ramp
    float hgt = (0.11 + 0.1 * uPitch) * (1.0 + 0.35 * uAud.x) * uInt;
    float fl = 0.0;
    for(int i=1;i<=7;i++){ float k = float(i) / 7.0; vec2 q = duv - vec2(0.0, k * hgt);
      q.x += (fbm3(vec2(px.x * 0.01, px.y * 0.012 + uT * 2.4 + k * 2.0)) - 0.5) * 0.07 * k;
      fl += M(q, 2.0 + 2.5 * k) * (1.0 - 0.8 * k); }
    fl *= 0.45 * (0.6 + 0.8 * fbm3(vec2(px.x * 0.018, px.y * 0.025 + uT * 3.2)));
    add += emberRamp(fl * (0.9 + 0.5 * uPitch)) * uA * (1.0 - 0.5 * m);
    float core = 0.35 + 0.4 * fbm3(px * 0.03 + uT * 1.5);
    word = emberRamp(core + (soft - edge) * -1.5 + 0.25 + 0.3 * uPitch);
    // sparks rising above the word
    if(uSparks > 0.0){ vec2 g = vec2(px.x / (uRes.y * 0.02), (px.y + uT * uRes.y * 0.35) / (uRes.y * 0.05)); vec2 id = floor(g);
      float life = fract(hash21(id) + uT * 0.5); vec2 f = fract(g) - vec2(0.5 + 0.3 * sin(uT * 3.0 + id.y), 0.5);
      float inCol = smoothstep(uSz.x * 0.75 * asp, 0.0, abs(rel.x)) * smoothstep(0.0, 0.3, rel.y + uSz.y) * smoothstep(0.75, 0.1, rel.y);
      add += vec3(1.0, 0.6, 0.15) * smoothstep(0.16, 0.0, length(f)) * step(0.72, hash21(id + 5.0)) * (1.0 - life) * inCol * uA * uSparks * 1.6; }
  } else if(uEl == 3){ // water: glass letters fill from the bottom up, left to right
    float fill = smoothstep(0.0, 1.0, (uAge + 1.0) / 1.2);
    float lvl = uC.y - uSz.y * 0.75 + fill * uSz.y * 1.6 + 0.012 * sin(duv.x * 60.0 + uT * (4.0 + 30.0 * uVib)) * (0.4 + uVib) - (duv.x - uC.x) * 0.25 * (1.0 - fill);
    float inWater = smoothstep(0.004, -0.004, duv.y - lvl);
    vec2 e = 2.0 / uRes;
    vec2 n = vec2(M(duv + vec2(e.x, 0.0), 2.5) - M(duv - vec2(e.x, 0.0), 2.5), M(duv + vec2(0.0, e.y), 2.5) - M(duv - vec2(0.0, e.y), 2.5));
    vec3 refr = mix(uBg1, uBg0, 0.5) + 0.25 * texture(uCol, duv + n * 0.25).rgb;
    vec3 water = mix(vec3(0.08, 0.3, 0.5), vec3(0.3, 0.65, 0.9), smoothstep(-0.02, 0.12, duv.y - (uC.y - uSz.y))) + refr * 0.5;
    float spec = pow(clamp(1.0 - length(n) * 9.0, 0.0, 1.0), 1.0) * 0.0 + smoothstep(0.02, 0.0, abs(duv.y - lvl)) * 0.6;
    float speck = step(0.985, hash21(floor(px / 3.0))) * 0.5;
    word = mix(vec3(0.75, 0.86, 0.95) * 0.35 + refr * 0.5, water + spec + speck, inWater) + length(n) * 3.0;
    wAlpha = m * mix(0.55, 1.0, inWater);
    add += vec3(0.2, 0.5, 0.8) * glow * 0.25 * uA;
  } else if(uEl == 4){ word = mix(uPaper, vec3(1.0), 0.6); add += vec3(0.7, 0.8, 1.0) * glow * exp(-max(uAge, 0.0) * 3.0) * 1.2; }
  else if(uEl == 5){ word = vec3(0.55, 0.62, 0.7); }
  else if(uEl == 6){ word = mix(uPaper, vec3(0.75, 0.6, 1.0), 0.5); add += vec3(0.5, 0.35, 0.9) * glow * 0.35 * uA; }
  else if(uEl == 7){ word = mix(uPaper, vec3(0.85, 0.6, 0.4), 0.45); }
  else if(uEl == 8){ // ice: frost facets grow from the edges inward, with a cold halo
    float grow = clamp((uAge + 0.8) / 1.4, 0.0, 1.0);
    vec2 v = voro(px / (uRes.y * 0.018));
    float dEdge = 1.0 - smoothstep(0.45, 1.0, soft);
    float front = smoothstep(1.0 - grow * 1.3 - 0.1, 1.0 - grow * 1.3 + 0.1, dEdge + (v.y - 0.5) * 0.3);
    vec3 ice = mix(vec3(0.5, 0.75, 0.95), vec3(0.97, 1.0, 1.0), 0.55 + 0.45 * v.y) + 0.35 * smoothstep(0.07, 0.0, v.x);
    word = mix(uPaper * 0.75, ice, front);
    add += vec3(0.45, 0.7, 1.0) * glow * 0.55 * uA;
  } else if(uEl == 9){ // smoke: wisps rise from the letters
    float s = 0.0;
    for(int i=1;i<=6;i++){ float k = float(i) / 6.0; vec2 q = duv - vec2(0.0, k * 0.16 * uInt);
      q.x += (fbm3(vec2(px.x * 0.006 + k, px.y * 0.008 + uT * 0.9)) - 0.5) * 0.12 * k; s += M(q, 3.0 + 2.0 * k) * (1.0 - k); }
    add += vec3(0.5, 0.52, 0.56) * s * 0.3 * fbm3(px * 0.008 + vec2(0.0, uT * 0.7)) * 2.0 * uA;
    word = vec3(0.62, 0.63, 0.66); wAlpha = m * mix(1.0, smoothstep(-0.2, 0.9, 0.5 - (duv.y - uC.y) / max(uSz.y, 0.01) * 0.5), clamp(uAge * 0.5, 0.0, 1.0));
  }
  // rain across the screen while water is active (density follows the hi-hats)
  if(uEl == 3 && uRain > 0.0){ vec2 g = vec2(px.x / (uRes.y * 0.012) + px.y * 0.012, px.y / (uRes.y * 0.22) - uT * 3.2 - hash11(floor(px.x / (uRes.y * 0.012))) * 7.0);
    float col2 = hash11(floor(g.x)); float streak = smoothstep(0.0, 0.9, fract(g.y)) * smoothstep(1.0, 0.9, fract(g.y)) * step(1.0 - 0.3 * uRain * (0.4 + 0.8 * uAud.y), col2);
    add += vec3(0.55, 0.7, 0.85) * streak * 0.22 * uA * smoothstep(0.5, 0.2, abs(fract(g.x) - 0.5)); }
  // ---- composite: background, colour layer (ordinary words + residue), active word, light ----
  c = c * (1.0 - col.a) + col.rgb;
  alpha = max(alpha, col.a);
  c = mix(c, word, clamp(wAlpha, 0.0, 1.0));
  alpha = max(alpha, clamp(wAlpha, 0.0, 1.0));
  c += add;
  alpha = max(alpha, clamp(dot(add, vec3(0.4)), 0.0, 1.0));
  c = mix(c, vec3(1.0), clamp(flashAdd, 0.0, 1.0) * 0.85);
  if(uTransparent < 0.5) c *= 1.0 - 0.35 * smoothstep(0.5, 1.1, vg);
  o = vec4(c, alpha);
}`;

interface Hero { lw: LW; block: number; start: number; end: number; lead: number; el: ElementKind }

export class Elements extends TextShaderEffect {
  static meta: EffectMeta = {
    id: 'elements', name: 'Elements', kind: 'gl',
    description: 'Hero words become fire, light, water, thunder, wind, vortex, quake, ice or smoke — and leave a residue in the world.',
    affinity: aff(0.9, 0.5, 0.35, 0.45, 0.8, 0.9, 0.35, 0.6),
    supportsTransparent: true,
    params: [
      select('palette', 'Palette', 'Look', 'soot', ['soot', 'midnight', 'ember', 'ash'], false),
      range('intensity', 'Element intensity', 'Look', 1, 0, 2, 0.01),
      range('persistence', 'Residue persistence', 'Look', 0.8, 0, 1, 0.01),
      range('heroSize', 'Hero size', 'Type', 1, 0.6, 1.5, 0.01, false),
      range('connScale', 'Connective size', 'Type', 0.3, 0.2, 0.6, 0.01, false),
      range('rowWidth', 'Line width', 'Type', 2400, 1400, 3600, 50, false),
      toggle('meaning', 'Meaning picks the element', 'Elements', true, false, 'Off: the music alone decides'),
      toggle('flash', 'Shock flash', 'Elements', true),
      range('rain', 'Rain density', 'Elements', 1, 0, 2, 0.01),
      range('sparks', 'Sparks', 'Elements', 1, 0, 2, 0.01),
      range('beat', 'Beat reactivity', 'Motion', 1, 0, 2, 0.01),
      range('camera', 'Camera energy', 'Motion', 1, 0, 2, 0.01),
      toggle('pullbacks', 'Section pull-backs', 'Motion', true, false),
    ],
  };
  readonly meta = Elements.meta;
  private blocks: { L: LineLayout; x: number; y: number; col: number }[] = [];
  private heroes: Hero[] = [];
  private keys: CamKey[] = [];
  private tm!: TimingOpts;
  private pal = PAL.soot;
  private actT!: Target;
  private pitchLo = 50; private pitchHi = 70;

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    this.tm = timingOf(this.s);
    this.pal = PAL[this.str('palette')] ?? PAL.soot;
    if (this.s.paletteSource === 'artwork' && ctx.artwork) this.pal = { bg0: '#050505', bg1: ctx.artwork.darkest, paper: ctx.artwork.lightest };
    const { W, H } = this;
    const portrait = H > W;
    const cap = 240 * this.num('heroSize');
    const maxW = this.num('rowWidth') * (portrait ? Math.max(0.45, (W / H) * 1.25) : 1);
    const ly = this.ly;
    this.blocks = []; this.heroes = [];
    let x = 0, y = 0, colW = 0, col = 0, lastSec = -1;
    const colBoxes: { x: number; y: number; w: number; h: number; t0: number; t1: number }[] = [];
    const frames: Parameters<typeof frameKeys>[0] = [];
    for (const line of ly.lines) {
      if (line.section !== lastSec && lastSec >= 0) { x += colW + cap * 1.6; y = 0; colW = 0; col++; }
      lastSec = line.section;
      const L = layoutLine(ly, line, { maxW, cap, heroScale: 1, supportScale: 0.5, connScale: this.num('connScale'), fonts: { hero: 'oswald', support: 'oswald', conn: 'playfair', backing: 'playfair' }, caseMode: 'upper', gap: 0.26, lineGap: 0.3, align: 'left' });
      const bi = this.blocks.length;
      this.blocks.push({ L, x, y, col });
      // the camera frames each line block; when the hero would be under 8.5 % of the frame height, row by row
      const zoomBlock = Math.min(W / (L.width * 1.2), H / (L.height * 1.7));
      const heroPx = cap * zoomBlock;
      const first = ly.words[line.words[0]];
      if (heroPx < 0.085 * H && L.rows > 1) {
        for (let r = 0; r < L.rows; r++) {
          const rw = L.words.filter((k) => k.row === r);
          const xs = Math.min(...rw.map((k) => k.x)), xe = Math.max(...rw.map((k) => k.x + k.width));
          frames.push({ t: rw[0].w.start - 0.35, x: x + xs, y: y + L.rowTops[r] - L.rowCaps[r] * 0.5, w: xe - xs, h: L.rowCaps[r] * 2, margin: 0.8 });
        }
      } else frames.push({ t: first.start - 0.45, x, y: y - cap * 0.35, w: L.width, h: L.height + cap * 0.7, margin: 0.78 });
      for (const k of L.words) if (k.w.role === 'hero' && !k.w.backing) this.heroes.push({ lw: k, block: bi, start: 0, end: 0, lead: 0, el: 'none' });
      const cb = colBoxes[col] ?? (colBoxes[col] = { x, y: 0, w: 0, h: 0, t0: line.start, t1: line.end });
      cb.w = Math.max(cb.w, L.width); cb.h = y + L.height; cb.t1 = line.end;
      y += L.height + cap * 0.75;
      colW = Math.max(colW, L.width);
      // pull back to show the section's column "as a record" at section breaks
      const next = ly.lines[line.idx + 1];
      if (this.bool('pullbacks') && (!next || next.section !== line.section) && cb.h > L.height * 1.5) {
        const gap = (next ? next.start : this.a.duration) - line.end;
        if (gap > 1.6) frames.push({ t: line.end + 0.5, x: cb.x, y: -cap * 0.3, w: cb.w, h: cb.h + cap * 0.6, margin: 0.82 });
      }
    }
    // final pull-back to the whole world
    if (this.blocks.length) {
      const wx = Math.max(...colBoxes.map((c) => c.x + c.w)), wy = Math.max(...colBoxes.map((c) => c.h));
      const lastEnd = ly.lines[ly.lines.length - 1].end;
      frames.push({ t: Math.min(this.a.duration - 0.2, lastEnd + 2.2), x: 0, y: -cap * 0.3, w: wx, h: wy + cap * 0.6, margin: 0.9 });
    }
    this.keys = frameKeys(frames.sort((a, b) => a.t - b.t), W, H);
    // activity windows: until the next hero, at least 1.4 s and at most 4 s (melismas hold longer)
    this.heroes.sort((a, b) => a.lw.w.start - b.lw.w.start);
    const meaning = this.bool('meaning');
    let cyc = 0;
    this.heroes.forEach((h, i) => {
      const w = h.lw.w;
      let el = (w.element && w.element !== 'none' ? w.element : 'light') as ElementKind;
      if (!meaning && !w.elementLocked) el = (['light', 'fire', 'water', 'smoke', 'ice', 'wind', 'vortex'] as ElementKind[])[cyc++ % 7];
      h.el = el;
      h.lead = LEAD[el];
      const next = this.heroes[i + 1]?.lw.w.start ?? Infinity;
      const hold = w.melisma ? Math.max(1.4, w.end - w.start + 0.6) : 1.4;
      h.start = w.start - h.lead;
      h.end = Math.min(w.start + 4, Math.max(w.start + hold, Math.min(next - (LEAD[this.heroes[i + 1]?.el ?? 'none'] ?? 0), w.start + 4)));
    });
    const ps = ly.words.map((w) => w.pitch).filter((p): p is number => p !== undefined).sort((a, b) => a - b);
    if (ps.length > 4) { this.pitchLo = ps[Math.floor(ps.length * 0.05)]; this.pitchHi = ps[Math.floor(ps.length * 0.95)]; }
    this.actT = this.scope.target(W, H, { mip: true });
  }

  private cam(t: number): { x: number; y: number; zoom: number; roll: number } {
    const c = sampleCamera(this.keys, t);
    const e = this.camEnergy * this.num('camera');
    return { x: c.x + Math.sin(t * 0.21) * 22 * e, y: c.y + Math.cos(t * 0.17) * 14 * e, zoom: c.zoom * (1 + 0.012 * e * Math.sin(t * 0.13) + 0.006 * this.react * this.num('beat') * pulse(this.a.beats, t, 8)), roll: 0 };
  }

  private activeHero(t: number): Hero | null {
    let best: Hero | null = null;
    for (const h of this.heroes) { if (h.start > t) break; if (t < h.end) best = h; }
    return best;
  }

  /** 2D colour layer: ordinary words and element residue. In mask mode: every visible word, white. */
  protected paint(t: number, g: Ctx2D, mask: boolean): void {
    const cam = this.cam(t);
    const { W, H } = this;
    const active = mask ? null : this.activeHero(t);
    const persist = this.num('persistence');
    applyCamera(g, cam, W, H);
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    const viewH = H / cam.zoom, viewW = W / cam.zoom;
    for (const b of this.blocks) {
      if (b.L.line.start - 1.2 > t) continue;
      if (b.y - cam.y > viewH || cam.y - (b.y + b.L.height) > viewH || b.x - cam.x > viewW || cam.x - (b.x + b.L.width) > viewW) continue;
      for (const k of b.L.words) {
        const w = k.w;
        const age = t - (w.start - this.tm.anticipation);
        if (age < 0) continue;
        if (active && active.lw === k) continue;
        const pop = easeOutCubic(clamp01(age / 0.1));
        const x = b.x + k.x, y = b.y + k.y;
        setFont(g, k.font, k.cap);
        if (mask) { g.fillStyle = maskFill(age); g.fillText(k.text, x, y); continue; }
        g.save();
        g.globalAlpha = pop;
        if (w.role === 'hero' && !w.backing) this.residue(g, k, x, y, this.heroes.find((h) => h.lw === k)?.el ?? 'none', persist, t);
        else {
          g.fillStyle = w.role === 'connective' ? rgba(this.pal.paper, w.backing ? 0.5 : 0.72) : this.s.voicePalette && w.voice === 'B' ? '#9CC4E8' : this.pal.paper;
          g.translate(x, y); g.scale(1, 0.9 + 0.1 * pop); g.fillText(k.text, 0, 0);
        }
        g.restore();
      }
    }
  }

  /** What an element leaves behind. */
  private residue(g: Ctx2D, k: LW, x: number, y: number, el: ElementKind, persist: number, t: number): void {
    const cap = k.cap, paper = this.pal.paper;
    g.translate(x, y);
    const p = 0.35 + 0.65 * persist;
    switch (el) {
      case 'fire': // charred letters with glowing ember rims
        g.fillStyle = '#4a342b'; g.fillText(k.text, 0, 0);
        g.lineWidth = cap * 0.024; g.strokeStyle = `rgba(255,${120 + Math.round(40 * Math.sin(t * 2 + k.w.id))},50,${0.6 + 0.35 * p})`; g.strokeText(k.text, 0, 0);
        break;
      case 'light': g.fillStyle = '#BFD9FF'; g.shadowColor = `rgba(150,200,255,${0.6 * p})`; g.shadowBlur = cap * 0.2; g.fillText(k.text, 0, 0); break;
      case 'water': {
        const gr = g.createLinearGradient(0, -cap, 0, 0);
        gr.addColorStop(0, `rgba(190,225,245,${0.55 + 0.3 * p})`); gr.addColorStop(1, `rgba(60,140,200,${0.75 + 0.2 * p})`);
        g.fillStyle = gr; g.fillText(k.text, 0, 0);
        g.lineWidth = cap * 0.012; g.strokeStyle = 'rgba(230,245,255,0.55)'; g.strokeText(k.text, 0, 0);
        break;
      }
      case 'shock': g.fillStyle = '#F4F7FF'; g.fillText(k.text, 0, 0); break;
      case 'wind': g.fillStyle = '#8D9AA8'; g.transform(1, 0, -0.12 * p, 1, 0, 0); g.fillText(k.text, 0, 0); break;
      case 'vortex': g.translate(k.width / 2, -cap / 2); g.rotate(0.07 * p * (hash01(k.w.id, 3) < 0.5 ? -1 : 1)); g.fillStyle = '#CDBEF2'; g.fillText(k.text, -k.width / 2, cap / 2); break;
      case 'quake': g.fillStyle = paper; g.fillText(k.text, 0, 0); g.fillStyle = `rgba(255,120,30,${0.7 * p})`; g.fillRect(0, cap * 0.09, k.width, cap * 0.022); break;
      case 'ice': g.fillStyle = '#DDF1FB'; g.fillText(k.text, 0, 0); g.lineWidth = cap * 0.014; g.strokeStyle = `rgba(255,255,255,${0.8 * p})`; g.strokeText(k.text, 0, 0); break;
      case 'smoke': { // the word thins away from the top
        const gr = g.createLinearGradient(0, -cap, 0, 0);
        gr.addColorStop(0, `rgba(160,160,168,${0.12 + 0.2 * p})`); gr.addColorStop(1, `rgba(170,170,178,${0.6 + 0.3 * p})`);
        g.fillStyle = gr; g.fillText(k.text, 0, 0);
        break;
      }
      default: g.fillStyle = paper; g.fillText(k.text, 0, 0);
    }
  }

  protected shade(t: number, target: Target, text: WebGLTexture): void {
    const { W, H } = this;
    const a = this.a;
    const h = this.activeHero(t);
    // the active word's own mask layer
    const { c, g } = this.layer('active');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    let uC: [number, number] = [0.5, 0.5], uSz: [number, number] = [0.2, 0.1], act = 0, age = -9, el = 0, pitch = 0.5, vib = 0;
    const cam = this.cam(t);
    if (h) {
      const k = h.lw, b = this.blocks[h.block];
      age = t - (k.w.start - this.tm.anticipation);
      const inn = h.lead > 0 ? smooth(clamp01((t - h.start) / h.lead)) : age >= 0 ? 1 : 0;
      act = inn * smooth(clamp01((h.end - t) / 0.45));
      el = EL.indexOf(h.el);
      g.save();
      applyCamera(g, cam, W, H);
      setFont(g, k.font, k.cap);
      g.textBaseline = 'alphabetic';
      // the letters themselves arrive on the onset; before it, only a faint seed for the element to grow from
      const reveal = age >= 0 ? 1 : 0.35 * inn;
      g.fillStyle = `rgba(255,255,255,${reveal * smooth(clamp01((h.end - t) / 0.3 + 0.0)) + (age >= 0 ? 0 : 0)})`;
      const pop = age >= 0 ? 1 + 0.06 * Math.exp(-age * 9) : 1;
      g.translate(b.x + k.x + k.width / 2, b.y + k.y - k.cap / 2); g.scale(pop, pop);
      g.fillText(k.text, -k.width / 2, k.cap / 2);
      g.restore();
      const sx = (b.x + k.x + k.width / 2 - cam.x) * cam.zoom + W / 2, sy = (b.y + k.y - k.cap / 2 - cam.y) * cam.zoom + H / 2;
      uC = [sx / W, 1 - sy / H]; uSz = [(k.width * cam.zoom) / W / 2, (k.cap * cam.zoom) / H / 2];
      if (k.w.pitch !== undefined) pitch = clamp01((k.w.pitch - this.pitchLo) / Math.max(1, this.pitchHi - this.pitchLo));
      vib = k.w.vibrato ? 1 : 0;
    }
    const actTex = this.scope.upload('active', c as HTMLCanvasElement, { mip: true });
    const r = this.react * this.num('beat');
    const fl = this.bool('flash') && !this.s.reduceMotion ? this.flash(t) * (h && sample(a.onsetStrength.length ? a.flux : a.flux, h.lw.w.start + 0.02) > 0.5 ? 1 : 0.5) : 0;
    this.scope.pass(this.scope.program(FS), target, {
      uCol: text, uAct: actTex, uRes: [W, H], uC, uSz, uT: t, uA: act, uAge: age, uInt: this.num('intensity') * this.intensity,
      uFlash: fl, uRain: this.num('rain'), uSparks: this.num('sparks'), uShockR: (2600 * cam.zoom) / H, uPitch: pitch, uVib: vib, uPersist: this.num('persistence'),
      uTransparent: this.s.transparentBackground ? 1 : 0, uRM: this.s.reduceMotion ? 1 : 0, uEl: { i: el },
      uAud: [sample(a.bands.mid, t) * r, sample(a.bands.high, t) * r, sample(a.bands.bass, t) * r, sample(a.flux, t) * r],
      uBg0: hexToRgb(this.pal.bg0), uBg1: hexToRgb(this.pal.bg1), uPaper: hexToRgb(this.pal.paper),
    });
    // translation subtitle on top (2D → blended pass)
    if (this.s.showTranslation !== 'off') {
      const sub = this.layer('sub');
      sub.g.clearRect(0, 0, W, H);
      subtitle(sub.g, this.ly.lines[lineAt(this.ly, t)], t, this.s, W, H, this.pal.paper);
      const st = this.scope.upload('sub', sub.c as HTMLCanvasElement);
      this.scope.pass(this.scope.program(FS_HEAD + `uniform sampler2D uTex; void main(){ o = texture(uTex, vUv); }`), target, { uTex: st }, { blend: 'alpha' });
    }
    void (null as unknown as Word);
  }
}
registerEffect(Elements);

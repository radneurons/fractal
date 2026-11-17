// NEON — signs that switch on, one word at a time (SPEC §8.9).
// Each lyric line is a neon sign on a wet brick wall; tubes follow the glyph skeletons (§7.2).
// Tubes are drawn as layered strokes (glass, white-hot core, specular streak) into an emission layer; one
// shader pass lights the brick with the blurred emission, adds the two-scale glow, mirrors everything into a
// rippled street and blurs signs other than the active one (depth of field by mip level).
// Reduce motion calms: the flicker (shortened), the faulty tube, the dolly push and the drop surge.
import type { Target } from '../render/glhost.ts';
import { GLEffect, type EffectContext, type EffectMeta, range, toggle, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { frameKeys } from './common.ts';
import { FS_HEAD, GLSL_NOISE, hexToRgb, rgba, hsl, rgbToHex } from '../render/gl.ts';
import { type Ctx2D, cleanDisplay, clamp01, smooth, subtitle, lineAt } from '../render/textkit.ts';
import { skeletonize, strokePath, SKEL_CAP, type Skeleton } from '../render/skeleton.ts';
import { type CamKey, sampleCamera } from '../render/camera.ts';
import { hash01, pulse, lowerBound, sample } from '../analysis/dsp.ts';
import { keyHue } from '../analysis/harmony.ts';
import type { Word } from '../types.ts';

const PALS: Record<string, string[]> = {
  Vegas: ['#FF2D75', '#FFD23F', '#29E3FF', '#FF7A1F'], Tokyo: ['#FF2BD6', '#29E3FF', '#B026FF', '#FF4E7E'],
  Diner: ['#FF3B3B', '#2EE6C9', '#FFE45C', '#FF8A3D'], 'Mono white': ['#FFF4E2', '#FFF4E2', '#FFF4E2', '#FFF4E2'],
};
const CONCEPT_COL: Record<string, string> = { fire: '#FF5A1F', ice: '#29E3FF', water: '#29E3FF', heart: '#FF2D75', light: '#FFE7B0', star: '#FFE7B0' };

const FS = FS_HEAD + GLSL_NOISE + `
uniform sampler2D uSharp, uSoft;
uniform vec2 uRes; uniform vec3 uCam; uniform float uT, uWall, uRefl, uSurge, uTransparent, uGlow;
uniform vec4 uDrops[8];
float brickH(vec2 w, out float id){
  vec2 b = vec2(w.x / 120.0, w.y / 52.0);
  b.x += 0.5 * mod(floor(b.y), 2.0);
  vec2 f = fract(b); id = hash21(floor(b));
  float m = smoothstep(0.0, 0.045, f.x) * smoothstep(1.0, 0.955, f.x) * smoothstep(0.0, 0.09, f.y) * smoothstep(1.0, 0.91, f.y);
  return m * (0.85 + 0.15 * vnoise(w * 0.08));
}
vec3 scene(vec2 uv, float lodBoost){
  // world position of this pixel on the wall
  vec2 w = (vec2(uv.x, 1.0 - uv.y) * uRes - uRes * 0.5) / uCam.z + uCam.xy;
  vec3 wall;
  if(uWall < 0.5){ float id; float h = brickH(w, id);
    vec3 brick = mix(vec3(0.21, 0.09, 0.07), vec3(0.33, 0.15, 0.1), id) * (0.75 + 0.35 * fbm3(w * 0.02));
    wall = mix(vec3(0.06, 0.055, 0.055), brick, h);
    float eps = 2.0; float i1; float hx = brickH(w + vec2(eps, 0.0), i1) - h, hy = brickH(w + vec2(0.0, eps), i1) - h;
    wall *= 0.85 + 0.6 * clamp(-hy * 6.0 - hx * 2.0, -0.3, 0.6);
  } else if(uWall < 1.5){ wall = vec3(0.16, 0.16, 0.17) * (0.7 + 0.5 * fbm(w * 0.006)) + 0.03 * vnoise(w * 0.5); }
  else { wall = vec3(0.015); }
  wall *= 0.55 + 0.45 * smoothstep(0.0, 1.0, fbm3(w * 0.003 + 7.0));                  // grime
  // lit by the signs: emission blurred through mip levels 3–6
  vec3 light = textureLod(uSoft, uv, 4.0 + lodBoost).rgb * 3.0 + textureLod(uSharp, uv, 5.0 + lodBoost).rgb * 5.0 + textureLod(uSharp, uv, 7.0).rgb * 7.0;
  vec3 c = wall * (0.16 + light * (2.6 + uSurge));
  // emission: tubes, then the two-scale glow
  vec3 e = textureLod(uSharp, uv, lodBoost).rgb + textureLod(uSoft, uv, 1.6 + lodBoost).rgb;
  vec3 g = textureLod(uSharp, uv, 2.0 + lodBoost).rgb * 0.9 + textureLod(uSharp, uv, 4.5).rgb * 1.3 + textureLod(uSoft, uv, 4.0).rgb * 0.9;
  c = c + e + g * uGlow * (1.0 + 1.2 * uSurge);
  return c;
}
void main(){
  vec2 uv = vUv;
  vec3 c;
  float hor = 0.28;
  if(uRefl > 0.5 && uv.y < hor){
    // the street mirrors the scene with ripples (closed-form rings from raindrops)
    vec2 r = vec2(uv.x, 2.0 * hor - uv.y);
    vec2 off = vec2(0.0);
    for(int i=0;i<8;i++){ vec4 d = uDrops[i]; if(d.w <= 0.0) continue; vec2 q = (uv - d.xy) * vec2(uRes.x / uRes.y, 3.0); float dist = length(q); float R = d.z * 0.25;
      float ring = exp(-pow((dist - R) / 0.012, 2.0)) * d.w; off += normalize(q + 1e-5) * ring * 0.012; }
    r += off + vec2(0.0, 0.003 * sin(uv.x * 140.0 + uT * 2.0) * (hor - uv.y) * 4.0);
    c = scene(r, 1.4) * (0.42 - 0.25 * (hor - uv.y) / hor);
    c += vec3(0.02, 0.022, 0.026) * fbm(vec2(uv.x * 40.0, uv.y * 8.0));
    c *= smoothstep(0.0, 0.01, abs(uv.y - hor) + 0.005);
  } else c = scene(uv, 0.0);
  float vg = length((uv - 0.5) * vec2(uRes.x / uRes.y, 1.0));
  c *= 1.0 - 0.45 * smoothstep(0.5, 1.15, vg);
  c = c / (1.0 + c * 0.18);
  if(uTransparent > 0.5){ vec3 e = textureLod(uSharp, uv, 0.0).rgb + textureLod(uSoft, uv, 1.0).rgb + textureLod(uSharp, uv, 3.0).rgb; c = e; o = vec4(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0)); return; }
  o = vec4(c, 1.0);
}`;
const FS_MASK = FS_HEAD + `uniform sampler2D uTex; void main(){ o = vec4(texture(uTex, vUv).rgb, 1.0); }`;

interface Tube { w: Word; sk: Skeleton; x: number; y: number; k: number; r: number; col: string; hero: boolean; width: number }
interface Sign { line: number; x: number; y: number; w: number; h: number; tubes: Tube[]; start: number; end: number; next: number }

export class Neon extends GLEffect {
  static meta: EffectMeta = {
    id: 'neon', name: 'Neon', kind: 'gl',
    description: 'Each line is a neon sign on a wet brick wall; words switch on as they are sung and reflect in the street.',
    affinity: aff(0.7, 0.65, 0.6, 0.5, 0.7, 0.85, 0.5, 0.6),
    supportsTransparent: true, supportsLive: true,
    params: [
      select('palette', 'Palette', 'Look', 'Vegas', ['Vegas', 'Tokyo', 'Diner', 'Mono white', 'Key']),
      range('tube', 'Tube thickness', 'Tubes', 1, 0.5, 2, 0.01, false),
      range('glow', 'Glow', 'Tubes', 1, 0, 2, 0.01),
      range('flicker', 'Flicker amount', 'Tubes', 1, 0, 2, 0.01),
      toggle('faulty', 'Faulty tube', 'Tubes', true),
      toggle('script', 'Script heroes', 'Tubes', true, false),
      toggle('cables', 'Cables', 'Signs', true),
      select('wall', 'Wall', 'Scene', 'brick', ['brick', 'concrete', 'black']),
      toggle('rain', 'Rain ripples', 'Scene', true),
      toggle('reflection', 'Reflection', 'Scene', true),
      range('dof', 'Depth of field', 'Scene', 1, 0, 2, 0.01),
      toggle('surge', 'Surge on drops', 'Scene', true),
    ],
  };
  readonly meta = Neon.meta;
  private signs: Sign[] = [];
  private keys: CamKey[] = [];
  private faulty = -1;
  private ripples: number[] = [];

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    const { W, H } = this, ly = this.ly, a = this.a;
    const portrait = H > W;
    let pal = PALS[this.str('palette')] ?? PALS.Vegas;
    if (this.str('palette') === 'Key' || this.s.paletteSource === 'key') { const h0 = keyHue(a.key.tonic); pal = [0, 60, 150, 210].map((d) => { const c = hsl((h0 + d) % 360, 1, 0.6); return rgbToHex(c[0], c[1], c[2]); }); }
    if (this.s.paletteSource === 'artwork' && ctx.artwork) pal = [ctx.artwork.vivid1, ctx.artwork.vivid2, ctx.artwork.lightest, ctx.artwork.dominant];
    // world units: px of a 720-high frame
    const S = 720;
    const capBase = S * (portrait ? 0.075 : 0.11);
    const maxW = S * (W / H) * 0.8;
    const signs: Sign[] = [];
    let x = 0;
    ly.lines.forEach((line, li) => {
      const ws = line.words.map((i) => ly.words[i]);
      const build = (cap: number) => {
        const tubes: Tube[] = [];
        let cx = 0, row = 0, rowW: number[] = [0];
        for (const w of ws) {
          const hero = w.role === 'hero' && !w.backing;
          const fnt = hero && this.bool('script') ? 'pacifico' : 'montserrat600';
          const txt = cleanDisplay(w, hero && this.bool('script') ? 'as-is' : this.s.caseMode);
          const c = cap * (hero ? 1.25 : w.backing ? 0.55 : w.role === 'connective' ? 0.7 : 0.9);
          const sk = skeletonize(txt, fnt);
          const k = c / SKEL_CAP;
          const width = sk.width * k;
          if (cx > 0 && cx + width > maxW) { row++; cx = 0; rowW.push(0); }
          const col = this.s.voicePalette && w.voice === 'B' ? pal[1] : CONCEPT_COL[w.concept ?? ''] ?? (w.concept ? pal[Math.floor(hash01(w.id, this.seed, 3) * pal.length)] : pal[(li + (hero ? 0 : 2)) % pal.length]);
          tubes.push({ w, sk, x: cx, y: row * cap * 1.7, k, r: Math.max(1.6, c * 0.09 * this.num('tube') * (hero && fnt === 'pacifico' ? 0.75 : 1)), col, hero, width });
          cx += width + cap * 0.35;
          rowW[row] = cx - cap * 0.35;
        }
        return { tubes, rows: row + 1, width: Math.max(...rowW) };
      };
      let cap = capBase;
      let b = build(cap);
      for (let i = 0; i < 6 && b.rows > 2; i++) { cap *= 0.85; b = build(cap); }
      const h = b.rows * cap * 1.7;
      // centre rows
      for (let r = 0; r < b.rows; r++) {
        const tr = b.tubes.filter((t) => Math.round(t.y / (cap * 1.7)) === r);
        const rw = tr.length ? tr[tr.length - 1].x + tr[tr.length - 1].width : 0;
        for (const t of tr) t.x += (b.width - rw) / 2;
      }
      // lines alternate left- and right-aligned along the wall
      const y = (li % 2 ? 1 : -1) * S * 0.06 - S * 0.06;
      signs.push({ line: li, x, y, w: b.width, h, tubes: b.tubes, start: line.start, end: line.end, next: ly.lines[li + 1]?.start ?? line.end + 4 });
      x += b.width + S * (W / H) * 0.45;
    });
    this.signs = signs;
    // the camera dollies sideways from sign to sign
    const frames = signs.map((s) => {
      const fw = s.w + S * 0.3, fh = Math.max(s.h * 2.6, S * 0.62);
      const top = s.y + Math.min(...s.tubes.map((tb) => tb.y - tb.k * SKEL_CAP));
      const bottom = s.y + Math.max(...s.tubes.map((tb) => tb.y + 0.3 * tb.k * SKEL_CAP));
      const zoom = Math.min(W / fw, H / fh) * 0.92;
      // the sign's centre sits at 42 % from the top of the frame, above its reflection in the street
      const cy = (top + bottom) / 2 + 0.08 * (H / zoom);
      return { t: s.start - 0.9, x: s.x - S * 0.15, y: cy - fh / 2, w: fw, h: fh, margin: 0.92, move: 1.0 };
    });
    this.keys = frameKeys(frames, W, H);
    // the faulty tube: one seeded hero word
    const heroes = signs.flatMap((s) => s.tubes.filter((t) => t.hero));
    this.faulty = heroes.length ? heroes[Math.floor(hash01(this.seed, 77) * heroes.length)].w.id : -1;
    // rain: hi-hat onsets in choruses
    this.ripples = a.onsets.filter((t) => { const s = a.sections.find((q) => t >= q.start && t < q.end); return !!s && (s.label === 'chorus' || s.label === 'drop') && sample(a.bands.high, t + 0.02) > 0.55; });
  }

  /** brightness of a word's tube (0..1) and how far along its strokes the light has filled */
  private lit(t: Tube, time: number, line: Sign): { on: number; fill: number } {
    const w = t.w, antic = this.s.anticipationMs / 1000;
    const land = w.start - antic;
    const fl = this.num('flicker') * (this.s.reduceMotion ? 0.4 : 1);
    if (time < land - 0.22 * fl) return { on: 0, fill: 0 };
    let on = 1;
    if (time < land) { // a seeded 6-step on/off pattern over 0.22 s that ends lit exactly at the onset
      const step = Math.floor(((time - (land - 0.22 * fl)) / (0.22 * fl)) * 6);
      on = hash01(w.id, step, this.seed) > 0.45 || step >= 5 ? 0.85 : 0.1;
    }
    // heroes fill with light along their length over the first syllable (≥ 120 ms)
    let fill = 1;
    if (t.hero) { const syl = w.syllableTimes?.[0]; const dur = Math.max(0.12, syl ? syl.end - syl.start : (w.end - w.start) / Math.max(1, w.syllables)); fill = clamp01((time - land + 0.06) / dur); if (time < land) fill = 0.15; }
    // lit until the line ends, then "still warm" at 35 %
    if (time > Math.min(line.next, line.end + 1.2)) on *= 0.35;
    if (time > line.next + 6) on = 0;
    // the faulty tube flickers irregularly through breakdowns
    if (w.id === this.faulty && this.bool('faulty') && !this.s.reduceMotion) {
      const sec = this.a.sections.find((s) => time >= s.start && time < s.end);
      if (sec?.label === 'breakdown' || time > line.next) { const f = Math.floor(time * 18); on *= hash01(f, 5, this.seed) > 0.3 ? 1 : 0.15; }
    }
    return { on, fill };
  }

  private paint(g: Ctx2D, t: number, cam: { x: number; y: number; zoom: number }, which: 'sharp' | 'soft' | 'mask', active: number): void {
    const { W, H } = this;
    g.save();
    g.translate(W / 2, H / 2); g.scale(cam.zoom, cam.zoom); g.translate(-cam.x, -cam.y);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const viewW = W / cam.zoom;
    const surge = this.bool('surge') && !this.s.reduceMotion ? this.a.drops.reduce((m, d) => Math.max(m, t >= d && t < d + 60 / (this.a.bpm || 120) ? 1 : 0), 0) : 0;
    for (const s of this.signs) {
      if (s.x - cam.x > viewW || cam.x - (s.x + s.w) > viewW) continue;
      const isActive = s.line === active;
      if (which === 'sharp' && !isActive && this.num('dof') > 0) continue;
      if (which === 'soft' && (isActive || this.num('dof') <= 0)) continue;
      if (which !== 'mask' && t < s.start - 30) continue;
      g.save();
      g.translate(s.x, s.y);
      const baseH = s.h;
      if (which !== 'mask') {
        // raceway and standoffs behind the baseline
        for (const tb of s.tubes) {
          if (tb.x > 0 && s.tubes.indexOf(tb) > 0 && tb.y !== s.tubes[s.tubes.indexOf(tb) - 1].y) continue;
        }
        const rows = new Set(s.tubes.map((tb) => tb.y));
        for (const ry of rows) {
          const tr = s.tubes.filter((tb) => tb.y === ry);
          const x0 = Math.min(...tr.map((tb) => tb.x)) - 14, x1 = Math.max(...tr.map((tb) => tb.x + tb.width)) + 14;
          const capH = tr[0].k * SKEL_CAP;
          g.fillStyle = '#0d0d10';
          g.beginPath(); g.roundRect(x0, ry - capH * 0.32, x1 - x0, capH * 0.25, capH * 0.08); g.fill();
          g.fillStyle = '#2a2a30';
          for (let xx = x0 + 20; xx < x1 - 10; xx += 70) g.fillRect(xx, ry - capH * 0.3, 4, capH * 0.21);
        }
        // thin cables hang between words in catenary curves
        if (this.bool('cables')) {
          g.strokeStyle = 'rgba(30,30,34,0.9)'; g.lineWidth = 1.6;
          for (let i = 0; i + 1 < s.tubes.length; i++) {
            const a1 = s.tubes[i], b1 = s.tubes[i + 1];
            if (a1.y !== b1.y) continue;
            const xa = a1.x + a1.width, xb = b1.x, ya = a1.y - 4;
            g.beginPath(); g.moveTo(xa - 6, ya); g.quadraticCurveTo((xa + xb) / 2, ya + 22, xb + 6, ya); g.stroke();
          }
        }
      }
      for (const tb of s.tubes) {
        const { on, fill } = this.lit(tb, t, s);
        g.save();
        g.translate(tb.x, tb.y);
        const k = tb.k, r = tb.r;
        if (which === 'mask') {
          if (on > 0.05) { g.strokeStyle = `rgb(${Math.round(255 * on)},${Math.round(255 * on * clamp01((t - tb.w.start) / 2))},${Math.round(255 * on)})`; g.lineWidth = r * 2.2; g.beginPath(); for (const st of tb.sk.strokes) strokePath(g, st, k); g.stroke(); }
          g.restore(); continue;
        }
        // unlit glass: pale grey tubes with dark electrodes at their ends
        g.strokeStyle = 'rgba(190,195,205,0.16)'; g.lineWidth = r * 2;
        g.beginPath(); for (const st of tb.sk.strokes) strokePath(g, st, k); g.stroke();
        g.fillStyle = '#18181c';
        for (const st of tb.sk.strokes) { const n = st.cum.length - 1; for (const i of [0, n]) { g.beginPath(); g.arc(st.pts[i * 3] * k, st.pts[i * 3 + 1] * k, r * 1.05, 0, 7); g.fill(); } }
        if (on > 0.02) {
          const total = tb.sk.total;
          const amp = on * (1 + 1.2 * surge);
          const drawLit = (width: number, style: string, dy = 0) => {
            g.strokeStyle = style; g.lineWidth = width;
            g.beginPath();
            let used = 0;
            for (const st of tb.sk.strokes) {
              const upTo = fill * total - used;
              used += st.len;
              if (upTo <= 0) break;
              g.save(); g.translate(0, dy); strokePath(g, st, k, upTo); g.restore();
            }
            g.stroke();
          };
          drawLit(r * 2, rgba(tb.col, Math.min(1, 0.95 * amp)));            // coloured glass
          drawLit(r * 0.62, `rgba(255,255,255,${Math.min(1, 0.9 * amp)})`); // white-hot core
          drawLit(r * 0.3, `rgba(255,255,255,${0.35 * on})`, -r * 0.45);    // specular streak on the upper side
        }
        g.restore();
      }
      void baseH;
      g.restore();
    }
    g.restore();
  }

  protected drawGL(t: number, target: Target, mask: boolean): void {
    const { W, H } = this, a = this.a;
    const c0 = sampleCamera(this.keys, t);
    // world → 720-high units
    const unit = H / 720;
    // a slow push on held notes
    const held = this.ly.words.find((w) => t >= w.start && t < w.end && w.end - w.start > 0.7);
    const push = held && !this.s.reduceMotion ? 1 + 0.03 * smooth(clamp01((t - held.start) / (held.end - held.start))) : 1;
    const cam = { x: c0.x, y: c0.y, zoom: (c0.zoom * push) };
    let active = -1;
    for (const s of this.signs) if (s.start - 1.0 <= t) active = s.line;
    void unit;
    if (mask) {
      const m = this.layer('mask');
      m.g.fillStyle = '#000'; m.g.fillRect(0, 0, W, H);
      this.paint(m.g, t, cam, 'mask', active);
      this.scope.pass(this.scope.program(FS_MASK), target, { uTex: this.scope.upload('mask', m.c as HTMLCanvasElement) });
      return;
    }
    const sh = this.layer('sharp'), so = this.layer('soft');
    sh.g.clearRect(0, 0, W, H); so.g.clearRect(0, 0, W, H);
    sh.g.fillStyle = '#000'; sh.g.fillRect(0, 0, W, H);
    so.g.fillStyle = '#000'; so.g.fillRect(0, 0, W, H);
    this.paint(sh.g, t, cam, 'sharp', active);
    this.paint(so.g, t, cam, 'soft', active);
    if (this.s.showTranslation !== 'off') subtitle(sh.g, this.ly.lines[lineAt(this.ly, t)], t, this.s, W, H, '#fff');
    const ts = this.scope.upload('sharp', sh.c as HTMLCanvasElement, { mip: true });
    const tso = this.scope.upload('soft', so.c as HTMLCanvasElement, { mip: true });
    // raindrops: rings that expand and decay over 0.8 s
    const drops = new Float32Array(32);
    if (this.bool('rain')) {
      let slot = 0;
      const i0 = lowerBound(this.ripples, t - 0.8);
      for (let i = i0; i < this.ripples.length && this.ripples[i] <= t && slot < 8; i++) {
        const age = t - this.ripples[i];
        drops[slot * 4] = 0.08 + 0.84 * hash01(i, this.seed, 1); drops[slot * 4 + 1] = 0.03 + 0.2 * hash01(i, 2);
        drops[slot * 4 + 2] = age; drops[slot * 4 + 3] = 1 - age / 0.8;
        slot++;
      }
    }
    const surge = this.bool('surge') && !this.s.reduceMotion ? a.drops.reduce((m, d) => Math.max(m, t >= d && t < d + 60 / (a.bpm || 120) ? 1.2 * (1 - (t - d) / (60 / (a.bpm || 120))) : 0), 0) * this.flash(t) : 0;
    const prog = this.scope.program(FS);
    this.scope.host.bind(target);
    this.scope.gl.useProgram(prog.program);
    this.scope.gl.uniform4fv(prog.uniforms.get('uDrops') ?? null, drops);
    this.scope.pass(prog, target, {
      uSharp: ts, uSoft: tso, uRes: [W, H], uCam: [cam.x, cam.y, cam.zoom], uT: t, uWall: ['brick', 'concrete', 'black'].indexOf(this.str('wall')),
      uRefl: this.bool('reflection') ? 1 : 0, uSurge: surge, uTransparent: this.s.transparentBackground ? 1 : 0,
      uGlow: this.num('glow') * this.intensity * (0.85 + 0.3 * this.react * pulse(a.beats, t, 6)),
    });
  }
}
registerEffect(Neon);

// Materials (SPEC §9 hybrid + §9.3): re-skin any effect's words from its word mask.
// One pass: height, edges and glow come from the mask's mip levels, so any layout works.
// Mask channels: R = letter coverage, G/R = time since the word's onset (0..2 s → 0..1).
import type { MaterialKind, MaterialSettings } from '../types.ts';
import { MATERIALS } from '../types.ts';
import type { GLHost, GLScope, Target } from './glhost.ts';
import { FS_HEAD, GLSL_NOISE, hexToRgb } from './gl.ts';

const FS = FS_HEAD + GLSL_NOISE + `
uniform sampler2D uFrame, uMask;
uniform vec2 uRes; uniform float uT, uStrength, uBackdrop, uFrameIdx;
uniform int uKind; uniform vec3 uTint; uniform vec4 uAudio; // bass, centroid, beatPulse, loud
#define M(uv, l) textureLod(uMask, uv, l).r
float cov(vec2 uv){ return texture(uMask, uv).r; }
float age(vec2 uv){ vec4 m = textureLod(uMask, uv, 1.0); return 2.0 * clamp(m.g / max(m.r, 1e-3), 0.0, 1.0); }
float height(vec2 uv){ return 0.45 * M(uv, 2.0) + 0.35 * M(uv, 3.5) + 0.2 * M(uv, 5.0); }
vec3 normalAt(vec2 uv, float k){
  vec2 e = 2.5 / uRes;
  float hx = height(uv + vec2(e.x, 0.0)) - height(uv - vec2(e.x, 0.0));
  float hy = height(uv + vec2(0.0, e.y)) - height(uv - vec2(0.0, e.y));
  return normalize(vec3(-hx * k, -hy * k, 1.0));
}
vec3 studio(vec3 r){ // bright sky over a sharp horizon, dark floor, softbox and strip lights
  float y = r.y;
  vec3 sky = mix(vec3(0.75, 0.82, 0.92), vec3(1.0), smoothstep(0.0, 0.9, y));
  vec3 floorC = mix(vec3(0.05, 0.05, 0.07), vec3(0.22, 0.2, 0.2), smoothstep(-0.9, 0.0, y));
  vec3 c = mix(floorC, sky, smoothstep(-0.02, 0.02, y));
  c += vec3(1.2) * smoothstep(0.82, 0.95, y) * smoothstep(0.5, 0.0, abs(r.x));
  c += vec3(0.9) * smoothstep(0.06, 0.0, abs(abs(r.x) - 0.62)) * smoothstep(-0.1, 0.5, y);
  return c;
}
vec3 heat(float x){ x = clamp(x, 0.0, 1.0);
  return mix(mix(mix(vec3(0.0), vec3(0.75, 0.05, 0.0), smoothstep(0.0, 0.3, x)), vec3(1.0, 0.5, 0.05), smoothstep(0.25, 0.6, x)), vec3(1.0, 0.95, 0.7), smoothstep(0.6, 1.0, x)); }
vec2 voronoi(vec2 p){ vec2 n = floor(p), f = fract(p); float md = 8.0, id = 0.0, md2 = 8.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g = vec2(float(i), float(j)); vec2 o2 = hash22(n + g); vec2 r = g + o2 - f; float d = dot(r, r);
    if(d < md){ md2 = md; md = d; id = hash21(n + g); } else if(d < md2) md2 = d; }
  return vec2(sqrt(md2) - sqrt(md), id); }
vec3 paper(vec2 px){ float n = fbm(px * 0.004) * 0.06 + vnoise(px * 0.7) * 0.035; return vec3(0.95, 0.92, 0.85) - n; }
void main(){
  vec2 uv = vUv; vec2 px = vec2(uv.x, 1.0 - uv.y) * uRes; float asp = uRes.x / uRes.y;
  vec4 F = texture(uFrame, uv);
  float m = cov(uv), h = height(uv), soft = M(uv, 3.0), glow = M(uv, 5.5);
  float bass = uAudio.x, cen = uAudio.y, beat = uAudio.z, loud = uAudio.w;
  vec3 bgMat = vec3(0.03, 0.03, 0.04);
  vec3 col = vec3(0.0); float a = m; vec3 addGlow = vec3(0.0);
  if(uKind == 1){ // liquid chrome
    vec3 n = normalAt(uv, 26.0);
    vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
    r.y += 0.12 + (h - 0.5) * 0.5;
    float fr = pow(1.0 - n.z, 2.0);
    vec3 env = studio(normalize(r));
    vec3 film = 0.5 + 0.5 * cos(6.2831 * (h * 1.2 + cen * 1.5 + fr + vec3(0.0, 0.33, 0.67)));
    col = mix(env, env * film * 1.4, 0.22 + 0.4 * fr) * mix(vec3(1.0), uTint, 0.35);
    bgMat = mix(vec3(0.09, 0.09, 0.1), vec3(0.02), length(uv - 0.5) * 1.3);
    float sh = M(uv + vec2(0.006, 0.012), 4.0);
    bgMat *= 1.0 - 0.6 * sh;
  } else if(uKind == 2){ // fire
    float fl = 0.0;
    for(int i=1;i<=6;i++){ float k = float(i) / 6.0; vec2 q = uv - vec2(0.0, k * (0.07 + 0.06 * bass));
      q.x += (fbm3(vec2(px.x * 0.012, px.y * 0.012 + uT * 2.2 + k * 3.0)) - 0.5) * 0.05 * k;
      fl += M(q, 2.0 + 2.0 * k) * (1.0 - k * 0.75); }
    fl *= 0.42 * (0.7 + 0.6 * fbm3(vec2(px.x * 0.02, px.y * 0.03 + uT * 3.0)));
    float core = m * (0.25 + 0.3 * fbm3(px * 0.03 + uT));
    float rim = clamp(soft - M(uv, 1.0) * 0.6, 0.0, 1.0) * m;
    col = mix(vec3(0.06, 0.02, 0.01), heat(core + rim * 2.0), 0.9);
    addGlow = heat(fl * (0.9 + 0.5 * bass)) * (1.0 - m * 0.6) * mix(vec3(1.0), uTint, 0.25);
    bgMat = vec3(0.025, 0.015, 0.01) + heat(glow * 0.25) * 0.25;
  } else if(uKind == 3){ // engraving
    float wv = sin(px.x * 0.02) * 1.3;
    float period = 4.2;
    float line = abs(fract((px.y + wv) / period) - 0.5) * 2.0;
    float wd = mix(0.38, 1.05, smoothstep(0.35, 0.95, soft));
    float ink = smoothstep(wd, wd - 0.3, line) * m;
    ink = max(ink, m * smoothstep(0.75, 0.35, soft) * 0.9);
    vec3 pap = paper(px);
    bgMat = pap;
    col = mix(pap, mix(vec3(0.07, 0.06, 0.08), uTint * 0.6, 0.35), ink); a = max(m, 0.0);
  } else if(uKind == 4){ // neon
    float edge = smoothstep(0.25, 0.5, m) * smoothstep(0.98, 0.6, soft);
    float tube = clamp(edge * 1.6, 0.0, 1.0);
    float flick = 0.92 + 0.08 * step(0.2, hash11(floor(uT * 24.0) + 3.0));
    float pulse = (0.75 + 0.5 * beat) * flick;
    col = mix(uTint * 0.25, mix(uTint, vec3(1.0), smoothstep(0.55, 1.0, tube)), tube) * pulse; a = max(m * 0.85, tube);
    addGlow = uTint * (glow * 1.1 + M(uv, 3.0) * 0.5) * pulse * 0.8;
    bgMat = vec3(0.02, 0.02, 0.035);
  } else if(uKind == 5){ // halftone
    vec2 q = rot(0.7854) * px / (uRes.y / 90.0);
    float d = length(fract(q) - 0.5);
    float size = sqrt(clamp(M(uv, 2.5), 0.0, 1.0)) * 0.62 * (1.0 + 0.25 * beat);
    float dot_ = smoothstep(size, size - 0.08, d);
    bgMat = paper(px);
    col = mix(bgMat, uTint * 0.9, dot_); a = step(0.02, M(uv, 2.5));
  } else if(uKind == 6){ // stardust
    vec2 g = px / (uRes.y / 110.0); g.y += uT * 0.6 + beat * 0.6;
    vec2 id = floor(g); vec2 f = fract(g) - 0.5;
    vec2 jit = hash22(id) - 0.5;
    float tw = 0.5 + 0.5 * sin(uT * (3.0 + 6.0 * hash21(id)) + 6.28 * hash21(id + 9.0));
    float s = smoothstep(0.16, 0.0, length(f - jit * 0.7)) * tw;
    col = mix(uTint, vec3(1.0), s) * s * 1.8; a = m * clamp(s * 2.5, 0.0, 1.0);
    addGlow = uTint * glow * 0.35;
    bgMat = vec3(0.012, 0.014, 0.03);
  } else if(uKind == 7){ // glass
    vec3 n = normalAt(uv, 22.0);
    vec2 refr = n.xy * 0.045 * (1.0 / 1.45);
    vec3 behind = texture(uFrame, uv - refr).rgb;
    float fr = pow(1.0 - n.z, 3.0);
    float caustic = smoothstep(0.35, 0.5, m) * smoothstep(0.9, 0.55, soft);
    col = behind * 0.92 * mix(vec3(1.0), uTint, 0.12) + caustic * 0.35 + fr * studio(reflect(vec3(0.0, 0.0, -1.0), n)) * 0.5;
    bgMat = F.rgb;
  } else if(uKind == 8){ // gold leaf
    vec2 v = voronoi(px / (uRes.y / 34.0));
    vec3 n = normalize(vec3((hash22(vec2(v.y, 3.1)) - 0.5) * 0.9 + normalAt(uv, 10.0).xy, 1.0));
    vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
    vec3 env = studio(normalize(r + vec3(0.0, 0.25, 0.0)));
    vec3 gold = mix(vec3(0.83, 0.56, 0.16), vec3(1.0, 0.87, 0.45), env.g);
    col = gold * (0.55 + 0.6 * env) * mix(vec3(1.0), uTint, 0.2);
    col *= 1.0 - 0.35 * smoothstep(0.05, 0.0, v.x);
    col += 0.25 * smoothstep(0.9, 0.5, soft) * m;
    bgMat = vec3(0.07, 0.05, 0.045);
  } else if(uKind == 9){ // frost: crystals grow inward from the letter edges over 0.8 s
    float t = clamp(age(uv) / 0.8, 0.0, 1.0);
    float dEdge = clamp(1.0 - smoothstep(0.5, 1.0, soft), 0.0, 1.0); // 1 at the edge, 0 at the core
    vec2 v = voronoi(px / (uRes.y / 70.0));
    float front = smoothstep(1.0 - t * 1.25 - 0.1, 1.0 - t * 1.25 + 0.1, dEdge + (v.y - 0.5) * 0.25);
    float facets = 0.75 + 0.25 * v.y + 0.3 * smoothstep(0.06, 0.0, v.x);
    vec3 ice = mix(vec3(0.55, 0.78, 0.95), vec3(0.96, 0.99, 1.0), facets) * mix(vec3(1.0), uTint, 0.2);
    col = mix(F.rgb * 0.5 + vec3(0.1, 0.16, 0.22), ice, front);
    addGlow = vec3(0.5, 0.75, 1.0) * glow * 0.3 * t;
    bgMat = vec3(0.03, 0.05, 0.08);
  } else if(uKind == 10){ // holographic foil
    vec3 n = normalAt(uv, 14.0);
    float ph = uv.x * 2.2 + uv.y * 1.4 + cen * 1.5 + uT * 0.12 + n.x * 0.8 + n.y * 0.6;
    vec3 rain = 0.5 + 0.5 * cos(6.2831 * (ph + vec3(0.0, 0.33, 0.67)));
    float grating = 0.85 + 0.15 * sin(px.x * 1.9 + px.y * 0.6);
    col = (rain * 0.85 + 0.25) * grating * mix(vec3(1.0), uTint, 0.15) + pow(1.0 - n.z, 2.0) * 0.6;
    bgMat = vec3(0.05, 0.05, 0.07);
  } else if(uKind == 11){ // lava: cooling crust over magma
    vec2 v = voronoi(px / (uRes.y / 26.0) + vec2(uT * 0.02, 0.0));
    float crack = smoothstep(0.03 + 0.12 * loud, 0.0, v.x);
    float crust = 0.25 + 0.2 * v.y;
    vec3 magma = heat(0.55 + 0.45 * fbm3(px * 0.01 + uT * 0.4) + 0.3 * bass);
    col = mix(vec3(0.12, 0.08, 0.07) * crust * 3.0, magma, crack) + magma * 0.25 * bass * (1.0 - crack) * step(0.6, v.y);
    addGlow = heat(glow * 0.6) * 0.5;
    bgMat = vec3(0.03, 0.015, 0.012);
  } else if(uKind == 12){ // embroidery: satin stitch across the stroke
    vec2 e = 3.0 / uRes;
    vec2 gr = vec2(M(uv + vec2(e.x, 0.0), 3.0) - M(uv - vec2(e.x, 0.0), 3.0), M(uv + vec2(0.0, e.y), 3.0) - M(uv - vec2(0.0, e.y), 3.0));
    vec2 dir = length(gr) > 1e-4 ? normalize(gr) : vec2(0.7071);
    float along = dot(px, vec2(-dir.y, -dir.x));
    float thread = 0.5 + 0.5 * sin(along * 1.6);
    float sheen = pow(0.5 + 0.5 * sin(dot(px, dir) * 0.35 + thread), 3.0);
    col = uTint * (0.5 + 0.35 * thread + 0.45 * sheen);
    col *= 0.75 + 0.5 * smoothstep(0.3, 0.9, soft);
    float weave = 0.5 + 0.25 * sin(px.x * 1.4) * sin(px.y * 1.4);
    bgMat = vec3(0.16, 0.17, 0.2) * (0.8 + 0.4 * weave);
    bgMat *= 1.0 - 0.45 * M(uv + vec2(0.004, 0.008), 4.0) * (1.0 - m);
  }
  vec3 bg = uBackdrop > 0.5 ? bgMat : F.rgb;
  float bgA = uBackdrop > 0.5 ? 1.0 : F.a;
  vec3 outc = mix(bg, col, clamp(a, 0.0, 1.0)) + addGlow;
  float outa = max(bgA, max(clamp(a, 0.0, 1.0), clamp(dot(addGlow, vec3(0.34)), 0.0, 1.0)));
  o = mix(F, vec4(outc, outa), uStrength);
}`;

export class MaterialPass {
  private scope: GLScope;
  private maskT: Target | null = null;
  constructor(readonly host: GLHost) { this.scope = host.scope(); }

  /** Returns a texture with the material applied. `mask` must be a word-mask texture. */
  apply(frame: WebGLTexture, mask: WebGLTexture, out: Target, maskMip: Target, t: number, fps: number, s: MaterialSettings, intensity: number, audio: [number, number, number, number]): WebGLTexture {
    const kind = Math.max(0, MATERIALS.indexOf(s.kind));
    if (!kind) return frame;
    void maskMip;
    this.scope.pass(this.scope.program(FS), out, {
      uFrame: frame, uMask: mask, uRes: [out.w, out.h], uT: t, uFrameIdx: Math.round(t * fps),
      uStrength: Math.max(0, Math.min(1, s.strength * intensity)), uBackdrop: s.backdrop === 'material' ? 1 : 0,
      uKind: { i: kind }, uTint: hexToRgb(s.tint || '#ffffff'), uAudio: audio,
    });
    return out.tex;
  }
  dispose(): void { this.scope.freeTarget(this.maskT); this.scope.dispose(); }
}

export const MATERIAL_LABELS: Record<MaterialKind, string> = {
  none: 'None', chrome: 'Liquid chrome', fire: 'Fire', engraving: 'Engraving', neon: 'Neon', halftone: 'Halftone', stardust: 'Stardust',
  glass: 'Glass', goldleaf: 'Gold leaf', frost: 'Frost', holo: 'Holographic foil', lava: 'Lava', embroidery: 'Embroidery',
};
export const MATERIAL_TINTS: Record<MaterialKind, string> = {
  none: '#ffffff', chrome: '#ffffff', fire: '#ffb070', engraving: '#1a1a22', neon: '#ff2d75', halftone: '#101018', stardust: '#9ecbff',
  glass: '#dff4ff', goldleaf: '#ffd27a', frost: '#cfeaff', holo: '#ffffff', lava: '#ff7a2a', embroidery: '#d83a52',
};

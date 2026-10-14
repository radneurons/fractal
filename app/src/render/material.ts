// Hybrid materials: take a layout effect's frame and its word mask (white words on black) and re-skin
// the words — liquid chrome, fire, engraving, neon, halftone or stardust — keeping the layout's motion.
// Height, edges and glow come from blurred copies of the mask (its mip levels), so any layout works.
import { compile, fullscreenTriangle, VS_FULL, GLSL_NOISE } from './gl';

export const MATERIALS = [
  { id: 'off', label: 'Off' },
  { id: 'chrome', label: 'Liquid chrome' },
  { id: 'fire', label: 'Fire' },
  { id: 'engrave', label: 'Engraving' },
  { id: 'neon', label: 'Neon' },
  { id: 'halftone', label: 'Halftone' },
  { id: 'stardust', label: 'Stardust' }
] as const;
export type MaterialId = typeof MATERIALS[number]['id'];
export interface MaterialSettings { id: MaterialId; strength: number; backdrop: 'layout' | 'material'; tint: string }
export const DEFAULT_MATERIAL: MaterialSettings = { id: 'off', strength: 1, backdrop: 'layout', tint: '#ffb347' };

const MODES: Record<MaterialId, number> = { off: 0, chrome: 1, fire: 2, engrave: 3, neon: 4, halftone: 5, stardust: 6 };

const FS = `#version 300 es
precision highp float;
uniform sampler2D uFrame, uMask; uniform vec2 uRes; uniform int uMode; uniform float uT, uK, uBackdrop;
uniform vec4 uAud;   // bass, centroid, beat pulse, loud
uniform vec3 uTint;
out vec4 o;
${GLSL_NOISE}
float M(vec2 uv, float lod){ return textureLod(uMask, uv, lod).r; }
float height(vec2 uv){ return M(uv,0.)*.22 + M(uv,1.5)*.24 + M(uv,2.5)*.22 + M(uv,3.5)*.18 + M(uv,4.5)*.14; }
vec3 studio(vec3 r){
  float y = r.y;
  vec3 c = y > 0. ? mix(vec3(.55,.6,.68), vec3(1.15,1.17,1.2), smoothstep(0.,.7,y)) : mix(vec3(.1,.09,.085), vec3(.015), smoothstep(0.,-.6,y));
  c += smoothstep(.035,0.,abs(y-.02))*.9;
  c += 1.4*smoothstep(.06,0.,max(abs(r.x)-.5, abs(y-.62)-.14));
  c += smoothstep(.03,0.,abs(r.x-.72))*step(-.2,y)*1.05;
  return c;
}
vec3 ramp(float h){ h = clamp(h,0.,1.);
  vec3 a=vec3(.227,.039,.016), b=vec3(.62,.165,.043), c=vec3(.91,.38,.10), d=vec3(1.,.757,.37), e=vec3(1.,.957,.84);
  if (h<.25) return mix(vec3(0.),a,h/.25); if (h<.45) return mix(a,b,(h-.25)/.2); if (h<.65) return mix(b,c,(h-.45)/.2); if (h<.85) return mix(c,d,(h-.65)/.2); return mix(d,e,(h-.85)/.15); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes; uv.y = 1. - uv.y;            // canvas orientation
  vec2 px = 1. / uRes;
  vec3 frame = texture(uFrame, uv).rgb;
  float m = M(uv, 0.), cov = smoothstep(.35, .65, m);
  float k = uK;
  vec3 back = uBackdrop > .5 ? mix(vec3(.02,.022,.03), vec3(.07,.075,.09), 1. - length(uv - .5)) : frame;
  vec3 col = back;
  if (uMode == 1) {                         // liquid chrome
    float hx = height(uv + vec2(px.x*2.,0.)) - height(uv - vec2(px.x*2.,0.));
    float hy = height(uv + vec2(0.,px.y*2.)) - height(uv - vec2(0.,px.y*2.));
    vec3 n = normalize(vec3(-hx*7., hy*7., 1.));
    vec3 r = reflect(vec3(0.,0.,-1.), n); r.y = -r.y*.9 + .08 - .25*(uv.y - .5);
    vec3 metal = studio(r) * mix(vec3(1.), uTint, .25);
    float fres = pow(1. - n.z, 3.);
    vec3 ir = .5 + .5*cos(6.2832*(height(uv)*1.2 + uAud.y*1.5 + vec3(0.,.33,.67)));
    metal = mix(metal, metal*ir*1.7, .3*(.3+.7*fres)) + uAud.z*.05;
    float sh = smoothstep(.0, .5, M(uv + vec2(-.003,-.01), 3.)) * (1. - cov);
    col = mix(back * (1. - sh*.5*k), metal, cov);
  } else if (uMode == 2) {                  // fire: the words smoulder and flames rise from them
    float flames = 0.;
    for (int i = 1; i <= 10; i++) {
      float fi = float(i); vec2 off = vec2((vnoise(vec2(uv.x*30., uT*2.+fi))-.5)*.006*fi, fi*.006*(1.+uAud.x*.8)*k);
      flames += M(uv + off, 1.5 + fi*.25) * (1. - fi/11.);
    }
    float n = fbm(vec2(uv.x*14., uv.y*9. + uT*3.));
    float heat = clamp(flames*.42*(.6 + .8*n) * k, 0., 1.);
    vec3 f = ramp(heat) * heat * 1.6;
    vec3 core = mix(vec3(.12,.03,.02), ramp(.55 + .35*n), .55 + .45*sin(uT*7. + uv.x*40.)*.5);
    col = back + f;
    col = mix(col, core, cov);
    col += ramp(.7) * smoothstep(.02,.0,abs(m-.5)-.08) * .6;       // glowing rim
  } else if (uMode == 3) {                  // engraving: horizontal hatch whose lines swell toward the stroke core
    float depth = M(uv, 2.5);
    float sp = 4.2 * uRes.y / 1080.;
    float y = gl_FragCoord.y + sin(gl_FragCoord.x*.015)*1.4;
    float ph = abs(fract(y/sp)-.5)*2.;
    float lw = mix(.38, 1.05, smoothstep(.15,.85,depth));
    float hatch = smoothstep(lw+.12, lw-.12, ph);
    float edge = smoothstep(.75,.45,depth) * cov;
    vec3 paper = vec3(.94,.9,.82) * (1. - fbm(uv*300.)*.06);
    vec3 ink = uBackdrop > .5 ? vec3(.09,.08,.07) : frame;
    vec3 ground = uBackdrop > .5 ? paper : frame * .25;
    col = uBackdrop > .5 ? paper : frame;
    col = mix(col, mix(ground, ink, 1.), cov * max(hatch, edge));
    if (uBackdrop < .5) col = mix(col, frame*.22, cov*(1.-max(hatch,edge)));
  } else if (uMode == 4) {                  // neon tubes
    float ring = smoothstep(.12, .0, abs(m - .5)) ;
    float glow = M(uv,3.)*.6 + M(uv,4.5)*.5 + M(uv,5.5)*.4;
    vec3 hue = .5 + .5*cos(6.2832*(vec3(0.,.33,.67) + uT*.05 + uv.x*.2));
    vec3 c2 = mix(uTint, hue, .35);
    float flick = .85 + .15*step(.12, h11(floor(uT*14.))) ;
    vec3 dark = uBackdrop > .5 ? vec3(.02,.015,.03) : frame * .35;
    col = dark + c2 * glow * (.8 + .6*uAud.z) * k * flick;
    col = mix(col, vec3(1.) * .95 + c2*.2, ring * flick);
    col = mix(col, c2 * .25, cov * (1. - ring) * .6);
  } else if (uMode == 5) {                  // halftone print
    float cell = 9. * uRes.y / 1080.;
    vec2 p = mat2(.7071,-.7071,.7071,.7071) * gl_FragCoord.xy;
    vec2 c = (floor(p/cell)+.5)*cell, d = p - c;
    vec2 cuv = (mat2(.7071,.7071,-.7071,.7071) * c) / uRes; cuv.y = 1. - cuv.y;
    float tone = M(cuv, 1.5);
    float r = sqrt(tone) * cell * .62 * (1. + uAud.z*.15);
    float dot = smoothstep(r + .8, r - .8, length(d));
    vec3 inkc = uBackdrop > .5 ? vec3(.08) : texture(uFrame, cuv).rgb;
    vec3 ground = uBackdrop > .5 ? vec3(.96,.94,.88) : frame;
    col = mix(ground, inkc, dot * smoothstep(.02,.2,tone));
    if (uBackdrop < .5) col = mix(col, frame*.3, cov*(1.-dot));
  } else if (uMode == 6) {                  // stardust: the words are made of twinkling points that drift on the beat
    float cell = 5. * uRes.y / 1080.;
    vec2 g = floor(gl_FragCoord.xy / cell);
    vec3 acc = vec3(0.);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 id = g + vec2(i,j); vec2 rnd = h22(id);
      vec2 home = (id + rnd) * cell;
      vec2 huv = home / uRes; huv.y = 1. - huv.y;
      float on = M(huv, .5); if (on < .5) continue;
      vec2 drift = vec2(sin(uT*1.3 + rnd.x*6.28), cos(uT*1.1 + rnd.y*6.28)) * cell * (.3 + 1.5*uAud.z*k);
      float d = length(gl_FragCoord.xy - home - drift);
      float tw = .55 + .45*sin(uT*4. + rnd.x*40.);
      acc += mix(vec3(1.), uTint, rnd.y*.6) * smoothstep(cell*.45, 0., d) * tw;
    }
    vec3 dark = uBackdrop > .5 ? vec3(.02,.02,.035) : frame * mix(1., .35, M(uv,2.));
    col = dark + acc * 1.3;
  }
  o = vec4(mix(frame, col, uMode == 0 ? 0. : 1.), 1.);
}`;

export class MaterialPass {
  private cv = document.createElement('canvas');
  private gl: WebGL2RenderingContext;
  private prg: ReturnType<typeof compile>;
  private vao: WebGLVertexArrayObject;
  private tFrame: WebGLTexture; private tMask: WebGLTexture;
  constructor() {
    const gl = this.cv.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true }); if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl; this.prg = compile(gl, VS_FULL, FS); this.vao = fullscreenTriangle(gl);
    const mk = (mip: boolean) => { const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    this.tFrame = mk(false); this.tMask = mk(true);
  }
  /** Draw the re-skinned frame into `out`. */
  apply(frame: HTMLCanvasElement, mask: HTMLCanvasElement, out: CanvasRenderingContext2D, t: number, m: MaterialSettings, aud: [number, number, number, number]) {
    const gl = this.gl, W = frame.width, H = frame.height;
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
    gl.viewport(0, 0, W, H); gl.useProgram(this.prg.p); const u = this.prg.u;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tFrame); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame); gl.uniform1i(u.uFrame, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tMask); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask); gl.generateMipmap(gl.TEXTURE_2D); gl.uniform1i(u.uMask, 1);
    gl.uniform2f(u.uRes, W, H); gl.uniform1i(u.uMode, MODES[m.id]); gl.uniform1f(u.uT, t); gl.uniform1f(u.uK, m.strength); gl.uniform1f(u.uBackdrop, m.backdrop === 'material' ? 1 : 0);
    gl.uniform4f(u.uAud, ...aud);
    const v = parseInt(m.tint.replace('#', ''), 16); gl.uniform3f(u.uTint, ((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
    out.drawImage(this.cv, 0, 0, W, H);
  }
  dispose() { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}

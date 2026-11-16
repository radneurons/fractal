// One shared WebGL2 context for every GPU effect, the compositor and the post stack (SPEC §7.1).
import { compile, VS_FULL, type Program } from './gl.ts';

export interface Target { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number; float: boolean; mip: boolean; depth?: WebGLRenderbuffer }
export type UniformValue = number | boolean | number[] | Float32Array | WebGLTexture | { i: number } | { tex3d: WebGLTexture } | { texArray: WebGLTexture } | null | undefined;
export type TexSource = TexImageSource;

export class GLHost {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly gl: WebGL2RenderingContext;
  readonly floatTargets: boolean;
  readonly floatLinear: boolean;
  lost = false;
  onLost: (() => void) | null = null;
  onRestored: (() => void) | null = null;
  private tri: WebGLVertexArrayObject;
  private programs = new Map<string, Program>();
  private scopes = new Set<GLScope>();
  readonly maxTex: number;

  constructor(canvas?: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas ?? (typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(4, 4));
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: false, alpha: true, antialias: false, depth: false, stencil: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    this.floatLinear = !!gl.getExtension('OES_texture_float_linear');
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.tri = this.makeTri();
    this.canvas.addEventListener('webglcontextlost', (e) => { (e as Event).preventDefault(); this.lost = true; this.onLost?.(); });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false; this.programs.clear(); this.tri = this.makeTri();
      for (const s of this.scopes) s.forget();
      this.onRestored?.();
    });
  }

  private makeTri(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  scope(): GLScope { const s = new GLScope(this); this.scopes.add(s); return s; }
  release(s: GLScope): void { this.scopes.delete(s); }

  /** fragment-only program over the fullscreen triangle (cached by source) */
  program(fs: string, vs: string = VS_FULL): Program {
    const key = vs + '\u0000' + fs;
    let p = this.programs.get(key);
    if (!p) { p = compile(this.gl, vs, fs); this.programs.set(key, p); }
    return p;
  }

  /** Reset every piece of GL state effects may touch to a known default. */
  resetState(): void {
    const gl = this.gl;
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE);
    gl.depthMask(true); gl.colorMask(true, true, true, true);
    gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
  }

  bind(target: Target | null, w?: number, h?: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    if (target) gl.viewport(0, 0, target.w, target.h);
    else gl.viewport(0, 0, w ?? this.canvas.width, h ?? this.canvas.height);
  }

  clear(r = 0, g = 0, b = 0, a = 0): void {
    const gl = this.gl;
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  setUniforms(p: Program, u: Record<string, UniformValue>): void {
    const gl = this.gl;
    let unit = 0;
    for (const name in u) {
      const loc = p.uniforms.get(name);
      if (!loc) continue;
      const v = u[name];
      if (v === null || v === undefined) continue;
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (typeof v === 'boolean') gl.uniform1f(loc, v ? 1 : 0);
      else if (v instanceof WebGLTexture) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v); gl.uniform1i(loc, unit++); }
      else if (Array.isArray(v) || v instanceof Float32Array) {
        const n = v.length;
        if (n === 2) gl.uniform2fv(loc, v as number[]);
        else if (n === 3) gl.uniform3fv(loc, v as number[]);
        else if (n === 4) gl.uniform4fv(loc, v as number[]);
        else if (n === 9) gl.uniformMatrix3fv(loc, false, v as number[]);
        else if (n === 16) gl.uniformMatrix4fv(loc, false, v as number[]);
        else gl.uniform1fv(loc, v as number[]);
      } else if ('i' in v) gl.uniform1i(loc, v.i);
      else if ('tex3d' in v) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_3D, v.tex3d); gl.uniform1i(loc, unit++); }
      else if ('texArray' in v) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D_ARRAY, v.texArray); gl.uniform1i(loc, unit++); }
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Fullscreen pass into `target` (null = the host canvas). */
  pass(p: Program, target: Target | null, uniforms: Record<string, UniformValue>, opts: { blend?: 'none' | 'alpha' | 'add'; clear?: boolean } = {}): void {
    const gl = this.gl;
    this.bind(target);
    if (opts.clear) this.clear();
    if (!opts.blend || opts.blend === 'none') gl.disable(gl.BLEND);
    else { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, opts.blend === 'add' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); }
    gl.useProgram(p.program);
    this.setUniforms(p, uniforms);
    gl.bindVertexArray(this.tri);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  resize(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }
}

/** Per-effect resource registry: everything created through a scope is freed by dispose(). */
export class GLScope {
  readonly gl: WebGL2RenderingContext;
  private textures = new Set<WebGLTexture>();
  private fbos = new Set<WebGLFramebuffer>();
  private rbs = new Set<WebGLRenderbuffer>();
  private vaos = new Set<WebGLVertexArrayObject>();
  private buffers = new Set<WebGLBuffer>();
  private uploads = new Map<string, { tex: WebGLTexture; w: number; h: number }>();
  constructor(readonly host: GLHost) { this.gl = host.gl; }

  program(fs: string, vs?: string): Program { return this.host.program(fs, vs); }

  texture(opts: { w: number; h: number; internal?: number; format?: number; type?: number; data?: ArrayBufferView | null; filter?: number; wrap?: number; mip?: boolean }): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    this.textures.add(t);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, opts.internal ?? gl.RGBA8, opts.w, opts.h, 0, opts.format ?? gl.RGBA, opts.type ?? gl.UNSIGNED_BYTE, opts.data ?? null);
    const f = opts.filter ?? gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.mip ? gl.LINEAR_MIPMAP_LINEAR : f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrap ?? gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrap ?? gl.CLAMP_TO_EDGE);
    if (opts.mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    return t;
  }

  /**
   * Upload a canvas / image / video frame (premultiplied, y flipped so uv (0,0) is the bottom-left).
   * `slot` names a reusable texture: the same slot re-uploads into the same texture object.
   */
  upload(slot: string, src: TexSource, opts: { mip?: boolean; filter?: number; wrap?: number } = {}): WebGLTexture {
    const gl = this.gl;
    const w = (src as HTMLCanvasElement).width ?? (src as HTMLVideoElement).videoWidth, h = (src as HTMLCanvasElement).height ?? (src as HTMLVideoElement).videoHeight;
    let e = this.uploads.get(slot);
    if (!e) { e = { tex: gl.createTexture()!, w: 0, h: 0 }; this.textures.add(e.tex); this.uploads.set(slot, e); }
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const f = opts.filter ?? gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.mip ? gl.LINEAR_MIPMAP_LINEAR : f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrap ?? gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrap ?? gl.CLAMP_TO_EDGE);
    if (opts.mip) gl.generateMipmap(gl.TEXTURE_2D);
    e.w = w; e.h = h;
    return e.tex;
  }

  target(w: number, h: number, opts: { float?: boolean; mip?: boolean; depth?: boolean; filter?: number } = {}): Target {
    const gl = this.gl;
    const float = !!opts.float && this.host.floatTargets;
    const tex = this.texture({ w, h, internal: float ? gl.RGBA16F : gl.RGBA8, format: gl.RGBA, type: float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, filter: opts.filter });
    if (opts.mip) { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    const fbo = gl.createFramebuffer()!;
    this.fbos.add(fbo);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let depth: WebGLRenderbuffer | undefined;
    if (opts.depth) {
      depth = gl.createRenderbuffer()!;
      this.rbs.add(depth);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, w, h, float, mip: !!opts.mip, depth };
  }

  /** Regenerate mip levels of a target after rendering into it. */
  mips(t: Target | WebGLTexture): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, (t as Target).tex ?? (t as WebGLTexture));
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  freeTarget(t: Target | null | undefined): void {
    if (!t) return;
    const gl = this.gl;
    gl.deleteFramebuffer(t.fbo); this.fbos.delete(t.fbo);
    gl.deleteTexture(t.tex); this.textures.delete(t.tex);
    if (t.depth) { gl.deleteRenderbuffer(t.depth); this.rbs.delete(t.depth); }
  }

  vao(): WebGLVertexArrayObject { const v = this.gl.createVertexArray()!; this.vaos.add(v); return v; }
  buffer(): WebGLBuffer { const b = this.gl.createBuffer()!; this.buffers.add(b); return b; }
  track(t: WebGLTexture): WebGLTexture { this.textures.add(t); return t; }

  /** begin(): bind the output target with all state reset; end() returns its texture. */
  begin(target: Target, clear = true): void {
    this.host.resetState();
    this.host.bind(target);
    if (clear) this.host.clear();
  }
  end(target: Target): WebGLTexture {
    this.host.resetState();
    if (target.mip) this.mips(target);
    return target.tex;
  }
  pass(p: Program, target: Target | null, uniforms: Record<string, UniformValue>, opts?: { blend?: 'none' | 'alpha' | 'add'; clear?: boolean }): void {
    this.host.pass(p, target, uniforms, opts);
  }

  /** after a context loss the objects are gone: drop the handles without deleting */
  forget(): void { this.textures.clear(); this.fbos.clear(); this.rbs.clear(); this.vaos.clear(); this.buffers.clear(); this.uploads.clear(); }

  dispose(): void {
    const gl = this.gl;
    if (!this.host.lost) {
      for (const t of this.textures) gl.deleteTexture(t);
      for (const f of this.fbos) gl.deleteFramebuffer(f);
      for (const r of this.rbs) gl.deleteRenderbuffer(r);
      for (const v of this.vaos) gl.deleteVertexArray(v);
      for (const b of this.buffers) gl.deleteBuffer(b);
    }
    this.forget();
    this.host.release(this);
  }
}

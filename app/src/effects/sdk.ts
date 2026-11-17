// Effect SDK (SPEC §15). `defineEffect(spec)` returns a registered Effect class built from plain functions,
// with the house helpers handed in as a kit. Authors never subclass anything and never touch the stage.
//
//   export default defineEffect({ id, name, description, params, prepare(k) { …return state }, render(k, s, t, g) {…}, renderMask(k, s, t, g) {…} })
//
// Rules the kit makes easy and the docs (docs/EFFECTS.md) spell out: render is a pure function of t (no Math.random,
// no frame-to-frame state, never block); all layout happens in prepare; the mask draws every visible word white
// (coverage) with nothing else.
import type { Affinity, Analysis, GlobalSettings, Line, Lyrics, ParamSpec, Word } from '../types.ts';
import { NEUTRAL_AFFINITY } from '../types.ts';
import { BaseEffect, Canvas2DEffect, GLEffect, type EffectContext, type EffectMeta, type Frame } from './types.ts';
import { registerEffect, effectClass } from './registry.ts';
import type { GLScope, Target } from '../render/glhost.ts';
import * as tk from '../render/textkit.ts';
import { layoutLine, frameKeys, maskFill, type LayoutOpts, type LineLayout } from './common.ts';
import { sampleCamera, applyCamera, fitZoom, type CamKey, type CamState } from '../render/camera.ts';
import { makeSDF } from '../render/sdf.ts';
import { skeletonize, type Skeleton } from '../render/skeleton.ts';
import { drawIcon, ICONS } from '../render/icons.ts';
import { mulberry32, hash01, sample as sampleArr, pulse } from '../analysis/dsp.ts';
import { keyHue } from '../analysis/harmony.ts';
import { hsl, mixHex, rgba } from '../render/gl.ts';
import type { LiveFeatures } from '../live/types.ts';

export type { Ctx2D, WordState } from '../render/textkit.ts';
export { range, toggle, select, colour, text } from './types.ts';

export interface Palette { bg: string; ink: string; accent: string; secondary: string; source: 'artwork' | 'key' | 'effect' }

/** Everything an SDK effect may read. Recreated per prepare; never stored between renders by the stage. */
export interface Kit {
  readonly W: number; readonly H: number;
  readonly analysis: Analysis; readonly lyrics: Lyrics; readonly settings: GlobalSettings;
  readonly words: Word[]; readonly lines: Line[];
  /** 'export' renders must be full quality */
  readonly quality: 'preview' | 'export';
  num(key: string): number; bool(key: string): boolean; str(key: string): string;
  // ---- textkit
  wordState(w: Word, t: number, entrance?: number, holdUntil?: number): tk.WordState;
  lineAt(t: number, lead?: number): number;
  layoutLine(line: Line, o: Partial<LayoutOpts> & { maxW: number; cap: number }): LineLayout;
  graphemes(s: string): string[];
  display(w: Word): string;
  setFont(g: tk.Ctx2D, fontKey: string, capPx: number): void;
  textWidth(text: string, fontKey: string, capPx: number): number;
  ease: { smooth: (x: number) => number; outCubic: (x: number) => number; outBack: (x: number) => number; inOut: (x: number) => number; clamp01: (x: number) => number; lerp: (a: number, b: number, t: number) => number };
  /** mask colour for a word that landed `age` seconds ago (R/B coverage, G age) */
  maskFill(age: number, level?: number): string;
  // ---- camera
  camera: {
    keys(frames: { t: number; x: number; y: number; w: number; h: number; margin?: number; move?: number }[], move?: number): CamKey[];
    at(keys: CamKey[], t: number): CamState;
    apply(g: tk.Ctx2D, c: { x: number; y: number; zoom: number; roll: number }): void;
    fit(w: number, h: number, margin?: number): number;
  };
  // ---- assets
  sdf: typeof makeSDF;
  skeleton(text: string, fontKey: string): Skeleton;
  icon(g: tk.Ctx2D, name: string, r: number): void;
  readonly icons: readonly string[];
  /** artwork palette when present and allowed, else one derived from the key (hue = circle of fifths) */
  palette(fallback?: Partial<Palette>): Palette;
  // ---- time and randomness
  /** a fresh PRNG per purpose: seed(1) is always the same sequence for the same project seed */
  seed(purpose: number): () => number;
  hash(a: number, b?: number, c?: number): number;
  sample(arr: ArrayLike<number> | undefined, t: number): number;
  beatPulse(t: number, sharpness?: number): number;
  downbeatPulse(t: number, sharpness?: number): number;
  /** 0..1, scales anything flashy (photosensitivity guard) */
  flashAttenuation(t: number): number;
}

export interface GLKit { scope: GLScope; target: Target; gl: WebGL2RenderingContext; layer(name: string, w?: number, h?: number): { c: HTMLCanvasElement | OffscreenCanvas; g: tk.Ctx2D } }

interface SpecBase<S> {
  id: string; name: string; description: string;
  params?: ParamSpec[];
  affinity?: Partial<Affinity>;
  supportsTransparent?: boolean;
  supportsLive?: boolean;
  /** lay out once; whatever it returns is handed to every render */
  prepare(k: Kit): S | Promise<S>;
  dispose?(state: S): void;
}
export interface Spec2D<S> extends SpecBase<S> {
  kind?: '2d';
  render(k: Kit, state: S, t: number, g: tk.Ctx2D): void;
  /** required: every visible word white (coverage) on black, nothing else */
  renderMask(k: Kit, state: S, t: number, g: tk.Ctx2D): void;
  /** live mode (§14): words come from the follower, features from the online analyser */
  renderLive?(k: Kit, state: S, t: number, g: tk.Ctx2D, live: LiveFeatures): void;
}
export interface SpecGL<S> extends SpecBase<S> {
  kind: 'gl';
  render(k: Kit, state: S, t: number, gl: GLKit): void;
  renderMask(k: Kit, state: S, t: number, gl: GLKit): void;
  renderLive?(k: Kit, state: S, t: number, gl: GLKit, live: LiveFeatures): void;
}
export type EffectSpec<S> = Spec2D<S> | SpecGL<S>;

/** Kit factory, shared with the built-in effects' tests. */
export function makeKit(e: BaseEffect): Kit {
  const ctx: EffectContext = e.ctx;
  const timing = () => tk.timingOf(e.s);
  return {
    W: e.W, H: e.H, analysis: e.a, lyrics: e.ly, settings: e.s, words: e.ly.words, lines: e.ly.lines,
    quality: ctx.quality ?? 'preview',
    num: (k) => e.num(k), bool: (k) => e.bool(k), str: (k) => e.str(k),
    wordState: (w, t, entrance = 0.3, hold = Infinity) => tk.wordState(w, t, entrance, timing(), hold),
    lineAt: (t, lead = 0) => tk.lineAt(e.ly, t, lead),
    layoutLine: (line, o) => layoutLine(e.ly, line, { fonts: { hero: 'montserrat', support: 'montserrat', conn: 'montserrat' }, caseMode: e.s.caseMode, ...o }),
    graphemes: tk.graphemes,
    display: (w) => tk.cleanDisplay(w, e.s.caseMode),
    setFont: tk.setFont, textWidth: tk.textWidth,
    ease: { smooth: tk.smooth, outCubic: tk.easeOutCubic, outBack: (x) => tk.easeOutBack(x), inOut: tk.easeInOutQuad, clamp01: tk.clamp01, lerp: tk.lerp },
    maskFill,
    camera: {
      keys: (frames, move) => frameKeys(frames, e.W, e.H, move),
      at: sampleCamera,
      apply: (g, c) => applyCamera(g, c, e.W, e.H),
      fit: (w, h, margin) => fitZoom(w, h, e.W, e.H, margin),
    },
    sdf: makeSDF,
    skeleton: skeletonize,
    icon: drawIcon, icons: ICONS,
    palette: (fb = {}) => {
      const art = ctx.artwork;
      if (art && e.s.paletteSource !== 'effect') return { bg: mixHex(art.darkest, '#000000', 0.3), ink: art.lightest, accent: art.vivid1, secondary: art.vivid2, source: 'artwork' };
      if (e.s.paletteSource === 'effect' && fb.bg) return { bg: fb.bg, ink: fb.ink ?? '#ffffff', accent: fb.accent ?? '#ffcc33', secondary: fb.secondary ?? '#66ccff', source: 'effect' };
      const h = keyHue(e.a.key.tonic), minor = e.a.key.mode === 'minor';
      const hex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
      return { bg: hex(hsl(h, minor ? 0.45 : 0.35, minor ? 0.07 : 0.1)), ink: '#f4f1ea', accent: hex(hsl(h, 0.85, 0.6)), secondary: hex(hsl((h + 150) % 360, 0.7, 0.62)), source: 'key' };
    },
    seed: (purpose) => mulberry32(Math.floor(hash01(e.seed, purpose, 0x5d) * 2 ** 31)),
    hash: hash01,
    sample: (arr, t) => sampleArr(arr, t),
    beatPulse: (t, k = 7) => pulse(e.a.beats, t, k),
    downbeatPulse: (t, k = 5) => pulse(e.a.downbeats, t, k),
    flashAttenuation: (t) => ctx.flashAttenuation(t),
  };
}

function metaOf<S>(spec: EffectSpec<S>): EffectMeta {
  return {
    id: spec.id, name: spec.name, description: spec.description, params: spec.params ?? [],
    affinity: { ...NEUTRAL_AFFINITY, ...spec.affinity },
    supportsTransparent: spec.supportsTransparent ?? true, supportsLive: spec.supportsLive ?? false,
    kind: spec.kind === 'gl' ? 'gl' : '2d',
  };
}

/** SDK effects expose live rendering through this shape (see live/runtime.ts). */
export interface LiveCapable { renderLive(t: number, live: LiveFeatures, mask?: boolean): Frame }

/** Build, validate and register an effect. Throws at module load when the contract is broken (the build lint runs this too). */
export function defineEffect<S>(spec: EffectSpec<S>): (new () => BaseEffect) & { meta: EffectMeta } {
  const missing = (['id', 'name', 'description', 'prepare', 'render', 'renderMask'] as const).filter((k) => !(spec as unknown as Record<string, unknown>)[k]);
  if (missing.length) throw new Error(`defineEffect(${spec.id ?? '?'}): missing ${missing.join(', ')} — renderMask is required (SPEC §15)`);
  if (!/^[a-z][a-z0-9-]*$/.test(spec.id)) throw new Error(`defineEffect: id "${spec.id}" must be kebab-case`);
  if (spec.supportsLive && !spec.renderLive) throw new Error(`defineEffect(${spec.id}): supportsLive needs renderLive`);
  const meta = metaOf(spec);
  let cls: (new () => BaseEffect) & { meta: EffectMeta };
  if (spec.kind === 'gl') {
    const s = spec;
    cls = class extends GLEffect implements LiveCapable {
      static meta = meta;
      readonly meta = meta;
      private kit!: Kit; private state!: S;
      private live: LiveFeatures | null = null;
      async prepare(ctx: EffectContext): Promise<void> { await this.init(ctx); this.kit = makeKit(this); this.state = await s.prepare(this.kit); }
      protected drawGL(t: number, target: Target, mask: boolean): void {
        const glk: GLKit = { scope: this.scope, target, gl: this.scope.gl, layer: (n, w, h) => this.layer(n, w, h) };
        if (mask) s.renderMask(this.kit, this.state, t, glk);
        else if (this.live && s.renderLive) s.renderLive(this.kit, this.state, t, glk, this.live);
        else s.render(this.kit, this.state, t, glk);
      }
      renderLive(t: number, live: LiveFeatures, mask = false): Frame { this.live = live; try { return this.render(t, mask); } finally { this.live = null; } }
      dispose(): void { if (this.state !== undefined) s.dispose?.(this.state); super.dispose(); }
    };
  } else {
    const s = spec;
    cls = class extends Canvas2DEffect implements LiveCapable {
      static meta = meta;
      readonly meta = meta;
      private kit!: Kit; private state!: S;
      private live: LiveFeatures | null = null;
      async prepare(ctx: EffectContext): Promise<void> { await this.init(ctx); this.kit = makeKit(this); this.state = await s.prepare(this.kit); }
      protected draw(t: number, g: tk.Ctx2D, mask: boolean): void {
        if (mask) s.renderMask(this.kit, this.state, t, g);
        else if (this.live && s.renderLive) s.renderLive(this.kit, this.state, t, g, this.live);
        else s.render(this.kit, this.state, t, g);
      }
      renderLive(t: number, live: LiveFeatures, mask = false): Frame { this.live = live; try { return this.render(t, mask); } finally { this.live = null; } }
      dispose(): void { if (this.state !== undefined) s.dispose?.(this.state); super.dispose(); }
    };
  }
  const replaced = !!effectClass(spec.id);
  registerEffect(cls as never);
  // hot reload in `npm run dev`: the stage re-prepares only this effect (main.ts listens)
  if (replaced && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('le:effect-reloaded', { detail: spec.id }));
  return cls;
}

export { rgba, mixHex };

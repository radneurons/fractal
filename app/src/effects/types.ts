// Effect contract (SPEC §3, §8.0, §15).
import type { Affinity, Analysis, GlobalSettings, Lyrics, ParamSpec, Params, Song } from '../types.ts';
import type { GLHost, GLScope, Target } from '../render/glhost.ts';
import { makeCanvas } from '../render/sdf.ts';
import type { Ctx2D } from '../render/textkit.ts';
import { sample, pulse } from '../analysis/dsp.ts';
import type { ArtPalette } from '../media/artwork.ts';

export interface EffectContext {
  song: Song;
  /** lyrics with the global sync offset applied */
  lyrics: Lyrics;
  analysis: Analysis;
  settings: GlobalSettings;
  params: Params;
  width: number;
  height: number;
  host: GLHost;
  /** 0..1: scales every "flashy" contribution (photosensitivity guard, §10.3) */
  flashAttenuation(t: number): number;
  artwork?: ArtPalette | null;
  /** instance id (modulation targets, seeds) */
  instanceId: string;
  /** 'export' renders at full quality; effects may cut corners in 'preview' (never in export) */
  quality?: 'preview' | 'export';
}

/** What an effect hands to the compositor: a 2D canvas or a texture in the shared GL context. */
export interface Frame { canvas?: HTMLCanvasElement | OffscreenCanvas; tex?: WebGLTexture; w: number; h: number; opaque: boolean }

export interface PaletteSlots { bg: string; ink: string; accent: string; secondary: string }

export interface EffectMeta {
  id: string;
  name: string;
  description: string;
  params: ParamSpec[];
  affinity: Affinity;
  supportsTransparent: boolean;
  supportsLive?: boolean;
  ownsTitle?: boolean;
  ownsTranslation?: boolean;
  kind: '2d' | 'gl';
}

export interface Effect {
  readonly meta: EffectMeta;
  prepare(ctx: EffectContext): Promise<void>;
  setParams(p: Params): void;
  /** Pure function of t. `mask`: every word white on black and nothing else (§8.0). */
  render(t: number, mask?: boolean): Frame;
  dispose(): void;
}

export type EffectClass = (new () => Effect) & { meta: EffectMeta };

export function defaults(specs: ParamSpec[]): Params {
  const o: Params = {};
  for (const s of specs) o[s.key] = s.default;
  return o;
}

/** Shared state + helpers for both kinds of effect. */
export abstract class BaseEffect implements Effect {
  abstract readonly meta: EffectMeta;
  ctx!: EffectContext;
  p: Params = {};
  W = 0; H = 0;
  get a(): Analysis { return this.ctx.analysis; }
  get ly(): Lyrics { return this.ctx.lyrics; }
  get s(): GlobalSettings { return this.ctx.settings; }
  /** master percentages */
  get intensity(): number { return this.s.intensity / 100; }
  get camEnergy(): number { return (this.s.reduceMotion ? 0.35 : 1) * this.s.cameraEnergy / 100; }
  get react(): number { return this.s.reactivity / 100; }
  get seed(): number { return this.s.seed; }
  num(k: string): number { return Number(this.p[k]); }
  bool(k: string): boolean { return !!this.p[k]; }
  str(k: string): string { return String(this.p[k]); }
  sample(arr: ArrayLike<number>, t: number): number { return sample(arr, t); }
  beatPulse(t: number, k = 7): number { return pulse(this.a.beats, t, k); }
  downbeatPulse(t: number, k = 5): number { return pulse(this.a.downbeats, t, k); }
  flash(t: number): number { return this.ctx.flashAttenuation(t); }
  setParams(p: Params): void { this.p = { ...this.p, ...p }; }
  protected async init(ctx: EffectContext): Promise<void> {
    this.ctx = ctx; this.W = ctx.width; this.H = ctx.height;
    this.p = { ...defaults(this.meta.params), ...ctx.params };
  }
  abstract prepare(ctx: EffectContext): Promise<void>;
  abstract render(t: number, mask?: boolean): Frame;
  abstract dispose(): void;
}

/** Canvas2D effects implement draw(); the frame and the mask have their own canvases. */
/** Deterministic (software) 2D rasterisation: on for exports and when `?soft2d` / LE_SOFT2D is set. */
export function softCanvas(): boolean { const g = globalThis as { __LE_SOFT2D?: boolean; __LE_EXPORT?: boolean; location?: Location }; return !!g.__LE_SOFT2D || !!g.__LE_EXPORT || (!!g.location && /[?&]soft2d\b/.test(g.location.search)); }

export abstract class Canvas2DEffect extends BaseEffect {
  private cv: (HTMLCanvasElement | OffscreenCanvas)[] = [];
  private gx: Ctx2D[] = [];
  private soft: boolean[] = [];
  /** true while rendering the word mask */
  maskMode = false;
  protected abstract draw(t: number, g: Ctx2D, mask: boolean): void;
  protected ensure(i: number): Ctx2D {
    const soft = softCanvas();
    if (!this.cv[i] || this.cv[i].width !== this.W || this.cv[i].height !== this.H || this.soft[i] !== soft) {
      this.cv[i] = makeCanvas(this.W, this.H); this.soft[i] = soft;
      // software raster when asked: accelerated 2D canvases cache glyphs by history, which breaks render(t) purity
      this.gx[i] = this.cv[i].getContext('2d', { alpha: true, willReadFrequently: softCanvas() }) as Ctx2D;
    }
    return this.gx[i];
  }
  render(t: number, mask = false): Frame {
    const i = mask ? 1 : 0;
    const g = this.ensure(i);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
    g.shadowColor = 'transparent'; g.shadowBlur = 0;
    if (mask) { g.fillStyle = '#000'; g.fillRect(0, 0, this.W, this.H); }
    else g.clearRect(0, 0, this.W, this.H);
    this.maskMode = mask;
    g.save();
    this.draw(t, g, mask);
    g.restore();
    this.maskMode = false;
    return { canvas: this.cv[i], w: this.W, h: this.H, opaque: mask || !this.s.transparentBackground || !this.meta.supportsTransparent };
  }
  dispose(): void { this.cv = []; this.gx = []; }
}

/** GPU effects render into framebuffers of the shared context through a GLScope. */
export abstract class GLEffect extends BaseEffect {
  scope!: GLScope;
  protected out: Target[] = [];
  /** scratch 2D canvases (text layers uploaded as textures) */
  private scratch = new Map<string, { c: HTMLCanvasElement | OffscreenCanvas; g: Ctx2D; soft: boolean }>();
  protected async init(ctx: EffectContext): Promise<void> {
    await super.init(ctx);
    this.scope?.dispose();
    this.scope = ctx.host.scope();
    this.out = [this.scope.target(this.W, this.H), this.scope.target(this.W, this.H)];
    this.scratch.clear();
  }
  protected layer(name: string, w = this.W, h = this.H): { c: HTMLCanvasElement | OffscreenCanvas; g: Ctx2D; soft: boolean } {
    let e = this.scratch.get(name);
    const soft = softCanvas();
    if (!e || e.c.width !== w || e.c.height !== h || e.soft !== soft) {
      const c = makeCanvas(w, h);
      e = { c, g: c.getContext('2d', { alpha: true, willReadFrequently: soft }) as Ctx2D, soft };
      this.scratch.set(name, e);
    }
    e.g.setTransform(1, 0, 0, 1, 0, 0);
    e.g.globalAlpha = 1; e.g.globalCompositeOperation = 'source-over';
    return e;
  }
  protected abstract drawGL(t: number, target: Target, mask: boolean): void;
  render(t: number, mask = false): Frame {
    const target = this.out[mask ? 1 : 0];
    this.scope.begin(target);
    this.drawGL(t, target, mask);
    const tex = this.scope.end(target);
    return { tex, w: this.W, h: this.H, opaque: mask || !this.s.transparentBackground || !this.meta.supportsTransparent };
  }
  dispose(): void { this.scope?.dispose(); this.scratch.clear(); }
}

export function param(key: string, label: string, group: string, type: ParamSpec['type'], def: ParamSpec['default'], extra: Partial<ParamSpec> = {}): ParamSpec {
  return { key, label, group, type, default: def, live: true, ...extra };
}
export const range = (key: string, label: string, group: string, def: number, min: number, max: number, step = 0.01, live = true, help = ''): ParamSpec =>
  ({ key, label, group, type: 'range', default: def, min, max, step, live, help });
export const toggle = (key: string, label: string, group: string, def: boolean, live = true, help = ''): ParamSpec =>
  ({ key, label, group, type: 'toggle', default: def, live, help });
export const select = (key: string, label: string, group: string, def: string, options: string[], live = true, help = ''): ParamSpec =>
  ({ key, label, group, type: 'select', default: def, options, live, help });
export const colour = (key: string, label: string, group: string, def: string, live = true): ParamSpec =>
  ({ key, label, group, type: 'color', default: def, live });
export const text = (key: string, label: string, group: string, def: string, live = false): ParamSpec =>
  ({ key, label, group, type: 'text', default: def, live });

export const aff = (energyHigh: number, energyLow: number, speech: number, denseLyrics: number, sparseLyrics: number, darkMood: number, brightMood: number, fastTempo: number): Affinity =>
  ({ energyHigh, energyLow, speech, denseLyrics, sparseLyrics, darkMood, brightMood, fastTempo });

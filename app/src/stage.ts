// The stage (SPEC §9): prepares the effects the plan and layers need, composites them, applies
// materials, modulation, post and the flash guard, and draws the title card.
import type { Analysis, Layer, Lyrics, Params, PlanSegment, Song, TransitionKind } from './types.ts';
import { GLHost } from './render/glhost.ts';
import { Compositor, TRANSITION_ANCHOR, TRANSITION_DURATION, maskBounds } from './compose/layers.ts';
import { MaterialPass } from './render/material.ts';
import { PostStack, postIsNeutral } from './render/post.ts';
import { Modulation } from './compose/modulation.ts';
import { MediaStore } from './media/background.ts';
import type { Effect, EffectContext, Frame } from './effects/types.ts';
import { defaults } from './effects/types.ts';
import { effectClass, effectMeta } from './effects/registry.ts';
import { type AppState, buildPlan, planInstance, sizeFor } from './project/state.ts';
import { shiftLyrics } from './lyrics/build.ts';
import { font, loadFonts, sizeForCap, makeCanvas } from './render/sdf.ts';
import { hexToRgb } from './render/gl.ts';
import { sample, pulse } from './analysis/dsp.ts';
import type { ArtPalette } from './media/artwork.ts';
import type { GuardState } from './render/flashguard.ts';

interface Prepared { effect: Effect; key: string; effectId: string; ms: number }

const POST_SPECS = (['bloom', 'grain', 'chroma', 'vignette', 'distortion', 'halation'] as const).map((key) => ({ key, label: key, group: 'post', type: 'range' as const, min: key === 'distortion' ? -1 : 0, max: 1, default: 0, live: true }));
const GLOBAL_SPECS = (['intensity', 'cameraEnergy', 'reactivity'] as const).map((key) => ({ key, label: key, group: 'global', type: 'range' as const, min: 0, max: 200, default: 100, live: true }));

export class Stage {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private g: CanvasRenderingContext2D;
  readonly host: GLHost;
  readonly comp: Compositor;
  private material: MaterialPass;
  readonly post: PostStack;
  readonly media = new MediaStore();
  song: Song | null = null;
  w = 1280; h = 720;
  /** when set, overrides the preview size (export) */
  forcedSize: { w: number; h: number } | null = null;
  segments: PlanSegment[] = [];
  mod: Modulation = new Modulation(null, null);
  artwork: ArtPalette | null = null;
  guard: GuardState | null = null;
  fps = 60;
  /** per-layer milliseconds of the last frame (performance HUD) */
  layerMs: Record<string, number> = {};
  frameMs = 0;
  previewScale = 1;
  private inst = new Map<string, Prepared>();
  private lyricsShift: { stamp: number; offset: number; ly: Lyrics } | null = null;
  private preparing: Promise<void> = Promise.resolve();
  private gen = 0;
  private matchCache = new Map<string, { ca: [number, number]; cb: [number, number]; scale: number }>();
  onStatus: ((msg: string) => void) | null = null;
  playing = false;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, public state: AppState, host?: GLHost) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d', { alpha: true }) as CanvasRenderingContext2D;
    this.host = host ?? new GLHost();
    this.comp = new Compositor(this.host);
    this.material = new MaterialPass(this.host);
    this.post = new PostStack(this.host);
    this.host.onLost = () => this.onStatus?.('Restoring graphics…');
    this.host.onRestored = () => { for (const p of this.inst.values()) p.key = ''; void this.prepare(); };
  }

  setSong(song: Song | null): void {
    this.song = song;
    this.lyricsShift = null;
    this.guard = null;
    this.matchCache.clear();
    this.mod = new Modulation(song?.analysis ?? null, song?.lyrics ?? null, this.state.settings.seed);
  }

  get lyrics(): Lyrics | null {
    const s = this.song;
    if (!s) return null;
    const off = this.state.settings.syncOffsetMs / 1000;
    if (!this.lyricsShift || this.lyricsShift.stamp !== s.stamp || this.lyricsShift.offset !== off) this.lyricsShift = { stamp: s.stamp, offset: off, ly: shiftLyrics(s.lyrics, off) };
    return this.lyricsShift.ly;
  }
  get analysis(): Analysis | null { return this.song?.analysis ?? null; }
  get duration(): number { return this.song?.analysis.duration ?? 0; }

  private size(): { w: number; h: number } {
    if (this.forcedSize) return this.forcedSize;
    const s = sizeFor(this.state.settings.aspect, this.state.previewRes);
    const k = this.previewScale;
    return { w: Math.max(2, Math.round((s.w * k) / 2) * 2), h: Math.max(2, Math.round((s.h * k) / 2) * 2) };
  }

  /** Which instances the plan and the layers need right now. */
  private needed(): Map<string, string> {
    const need = new Map<string, string>();
    for (const seg of this.segments) need.set(planInstance(seg.effect), seg.effect);
    for (const l of this.state.layers) if (l.kind === 'effect' && l.enabled && l.effect) need.set(l.instanceId, l.effect);
    return need;
  }

  private baseParams(instanceId: string, effectId: string): Params {
    const meta = effectMeta(effectId);
    return { ...(meta ? defaults(meta.params) : {}), ...(this.state.instances[instanceId]?.params ?? {}) };
  }

  private prepareKey(instanceId: string, effectId: string): string {
    const s = this.state.settings, meta = effectMeta(effectId);
    const p = this.baseParams(instanceId, effectId);
    const nonLive: Params = {};
    for (const spec of meta?.params ?? []) if (!spec.live) nonLive[spec.key] = p[spec.key];
    return JSON.stringify([this.w, this.h, this.song?.stamp, s.syncOffsetMs, s.caseMode, s.seed, s.minReadMs, s.anticipationMs, s.aspect, s.transparentBackground,
      s.voicePalette, s.showTranslation, s.reduceMotion, s.paletteSource, s.title, s.artist, s.fontOverrides, this.artwork?.all.join(''), nonLive]);
  }

  /** Prepare stale effects (debounced by the caller). Resolves when the stage can render. */
  prepare(): Promise<void> {
    const gen = ++this.gen;
    this.preparing = this.preparing.catch(() => {}).then(async () => {
      if (gen !== this.gen) return;
      await loadFonts();
      const { w, h } = this.size();
      this.w = w; this.h = h;
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.comp.resize(w, h);
      const song = this.song;
      this.segments = buildPlan(this.state.plan, song?.analysis ?? null, this.duration);
      if (!song) return;
      const need = this.needed();
      for (const [id, p] of this.inst) if (!need.has(id) || need.get(id) !== p.effectId) { p.effect.dispose(); this.inst.delete(id); }
      for (const [id, effectId] of need) {
        if (gen !== this.gen) return;
        const cls = effectClass(effectId);
        if (!cls) continue;
        const key = this.prepareKey(id, effectId);
        const cur = this.inst.get(id);
        if (cur && cur.key === key) continue;
        cur?.effect.dispose();
        this.inst.delete(id);
        const effect = new cls();
        const t0 = performance.now();
        this.onStatus?.(`Preparing ${cls.meta.name}…`);
        const ctx: EffectContext = {
          song, lyrics: this.lyrics!, analysis: song.analysis, settings: this.state.settings, params: this.baseParams(id, effectId),
          width: w, height: h, host: this.host, flashAttenuation: (t) => this.flashAttenuation(t), artwork: this.artwork, instanceId: id,
        };
        await effect.prepare(ctx);
        this.inst.set(id, { effect, key, effectId, ms: performance.now() - t0 });
      }
      this.matchCache.clear();
      this.onStatus?.('');
    });
    return this.preparing;
  }
  whenReady(): Promise<void> { return this.preparing; }

  flashAttenuation(t: number): number {
    const g = this.guard;
    if (!g || !this.state.settings.flashGuard) return 1;
    return sample(g.attenuation, t, g.fps);
  }

  private liveParams(instanceId: string, effectId: string, t: number): void {
    const p = this.inst.get(instanceId);
    const meta = effectMeta(effectId);
    if (!p || !meta) return;
    const base = this.baseParams(instanceId, effectId);
    const mod = this.mod.apply(instanceId, base, meta.params, this.state.routes, this.state.lanes, t);
    const live: Params = {};
    for (const spec of meta.params) if (spec.live) live[spec.key] = mod && spec.key in mod ? mod[spec.key] : base[spec.key];
    p.effect.setParams(live);
  }

  private frameOf(instanceId: string, effectId: string, t: number, mask = false): Frame | null {
    const p = this.inst.get(instanceId);
    if (!p) return null;
    if (!mask) this.liveParams(instanceId, effectId, t);
    return p.effect.render(t, mask);
  }

  /** transition into segment j resolved from 'auto' by the kind of section change (§9.6) */
  private transitionKind(j: number): TransitionKind {
    const seg = this.segments[j];
    let k = seg.transition ?? this.state.plan.transition;
    if (this.state.settings.reduceMotion && (k === 'flash' || k === 'glitch' || k === 'zoom')) k = 'dissolve';
    if (k !== 'auto') return k;
    const a = this.analysis;
    if (!a) return 'cut';
    const into = a.sections.find((s) => seg.start + 0.1 >= s.start && seg.start + 0.1 < s.end);
    const from = a.sections.find((s) => seg.start - 0.1 >= s.start && seg.start - 0.1 < s.end);
    if (a.drops.some((d) => Math.abs(d - seg.start) < 0.6) || into?.label === 'drop') return this.state.settings.reduceMotion ? 'dissolve' : 'flash';
    if (into?.label === 'breakdown') return 'dissolve';
    if (into?.label === 'bridge') return 'mask';
    if (into && from && a.sections.some((s) => s !== into && s.cluster === into.cluster && s.start < into.start)) return 'match';
    return 'wipe';
  }

  /** The plan layer at time t: one effect, or two mixed by a transition. */
  private planTex(t: number): { tex: WebGLTexture; effectId: string; instanceId: string; opaque: boolean } | null {
    const segs = this.segments;
    if (!segs.length) return null;
    let i = segs.findIndex((s) => t < s.end);
    if (i < 0) i = segs.length - 1;
    // is t inside a transition window around the boundary into segment j?
    for (const j of [i, i + 1]) {
      if (j <= 0 || j >= segs.length || segs[j].effect === segs[j - 1].effect) continue;
      const kind = this.transitionKind(j);
      const d = TRANSITION_DURATION[kind];
      if (d <= 0) continue;
      const b = segs[j].start, t0 = b - TRANSITION_ANCHOR[kind] * d;
      if (t < t0 || t >= t0 + d) continue;
      const u = (t - t0) / d;
      const A = segs[j - 1].effect, B = segs[j].effect;
      const fa = this.frameOf(planInstance(A), A, t), fb = this.frameOf(planInstance(B), B, t);
      if (!fa || !fb) break;
      const ta = this.comp.tex(fa, 'trA'), tb = this.comp.tex(fb, 'trB');
      let maskA: WebGLTexture | null = null;
      let geo: { ca: [number, number]; cb: [number, number]; scale: number } | undefined;
      if (kind === 'mask') {
        const fm = this.frameOf(planInstance(A), A, t, true);
        if (fm) maskA = this.comp.copy(this.comp.tex(fm, 'trMask'), true).tex;
      }
      if (kind === 'match' || kind === 'zoom') geo = this.matchGeometry(j, A, B, b);
      const tex = this.comp.transition(ta, tb, kind, u, { seed: this.state.settings.seed + j, flash: this.flashAttenuation(t), maskA, ...geo });
      const cur = u < 0.5 ? A : B;
      return { tex, effectId: cur, instanceId: planInstance(cur), opaque: fa.opaque && fb.opaque };
    }
    const e = segs[i].effect;
    const f = this.frameOf(planInstance(e), e, t);
    if (!f) return null;
    return { tex: this.comp.tex(f, 'plan'), effectId: e, instanceId: planInstance(e), opaque: f.opaque };
  }

  /** Where the outgoing effect's last hero stood and where the incoming one lands (from the word masks). */
  private matchGeometry(j: number, A: string, B: string, b: number): { ca: [number, number]; cb: [number, number]; scale: number } {
    const key = `${j}|${A}|${B}|${b.toFixed(3)}`;
    const hit = this.matchCache.get(key);
    if (hit) return hit;
    const boundsOf = (eff: string, t: number) => {
      const f = this.frameOf(planInstance(eff), eff, t, true);
      if (!f) return null;
      const px = this.comp.readSmall(this.comp.tex(f, 'mb'), 64, 36);
      return maskBounds(px, 64, 36);
    };
    const ba = boundsOf(A, b - 0.05), bb = boundsOf(B, b + 0.45);
    const out = { ca: [ba?.cx ?? 0.5, ba?.cy ?? 0.5] as [number, number], cb: [bb?.cx ?? 0.5, bb?.cy ?? 0.5] as [number, number], scale: ba && bb ? Math.max(0.5, Math.min(2, ba.h / Math.max(0.02, bb.h))) : 1 };
    this.matchCache.set(key, out);
    return out;
  }

  private layerActive(l: Layer, t: number): boolean {
    if (!l.enabled) return false;
    if (this.state.layers.some((x) => x.solo) && !l.solo) return false;
    if (l.start !== undefined && t < l.start) return false;
    if (l.end !== undefined && l.end > 0 && t >= l.end) return false;
    if (l.sectionOnly) {
      const a = this.analysis;
      const sec = a?.sections.find((s) => t >= s.start && t < s.end);
      if (!sec || sec.label !== l.sectionOnly) return false;
    }
    return true;
  }

  private audioAt(t: number): [number, number, number, number] {
    const a = this.analysis;
    if (!a) return [0, 0.5, 0, 0];
    const r = this.state.settings.reactivity / 100;
    return [sample(a.bands.bass, t) * r, sample(a.centroid, t), pulse(a.beats, t) * r, sample(a.loud, t)];
  }

  /** Render the frame for time t into the stage canvas. Pure function of t and the project state. */
  renderAt(t: number, opts: { noTitle?: boolean } = {}): void {
    const t00 = performance.now();
    const st = this.state, s = st.settings;
    const W = this.w, H = this.h;
    if (!this.song || this.host.lost) { this.g.fillStyle = '#000'; this.g.fillRect(0, 0, W, H); return; }
    // modulated global masters
    const gm = this.mod.apply('global', s as unknown as Params, GLOBAL_SPECS, st.routes, st.lanes, t);
    const saved = gm ? { intensity: s.intensity, cameraEnergy: s.cameraEnergy, reactivity: s.reactivity } : null;
    if (gm) Object.assign(s, gm);
    const transparent = s.transparentBackground;
    this.comp.begin(transparent);
    let below: { instanceId: string; effectId: string } | null = null;
    let ownsTitle = false;
    for (const l of st.layers) {
      if (!this.layerActive(l, t)) continue;
      const l0 = performance.now();
      let tex: WebGLTexture | null = null;
      let cur: { instanceId: string; effectId: string } | null = null;
      if (l.kind === 'plan') {
        const p = this.planTex(t);
        if (p) { tex = p.tex; cur = p; ownsTitle = !!effectMeta(p.effectId)?.ownsTitle; }
      } else if (l.kind === 'effect' && l.effect) {
        const f = this.frameOf(l.instanceId, l.effect, t);
        if (f) { tex = this.comp.tex(f, `L${l.id}`); cur = { instanceId: l.instanceId, effectId: l.effect }; }
      } else if (l.kind === 'media') {
        const c = this.media.draw(l, t, W, H, this.analysis, s.seed);
        if (c) tex = this.comp.tex({ canvas: c, w: W, h: H, opaque: true }, `L${l.id}`);
      } else if (l.kind === 'solid') {
        tex = this.comp.solidTex(hexToRgb(l.color ?? '#000000'), l.color2 ? hexToRgb(l.color2) : null);
      }
      if (!tex) continue;
      // material: re-skin this layer's words from its own word mask
      if (l.material && l.material.kind !== 'none' && cur) {
        const fm = this.frameOf(cur.instanceId, cur.effectId, t, true);
        if (fm) {
          const mk = this.comp.copy(this.comp.tex(fm, `M${l.id}`), true);
          tex = this.material.apply(tex, mk.tex, this.comp.scratch(), mk, t, this.fps, l.material, s.intensity / 100, this.audioAt(t));
        }
      }
      // mask from the words (or luma) of the layer below
      let maskTex: WebGLTexture | null = null;
      if (l.mask !== 'none' && below) {
        if (l.mask === 'inside-words' || l.mask === 'outside-words') {
          const fm = this.frameOf(below.instanceId, below.effectId, t, true);
          if (fm) maskTex = this.comp.tex(fm, `K${l.id}`);
        } else maskTex = this.comp.copy(this.comp.result().tex).tex;
      }
      const lo = this.mod.apply(`layer:${l.id}`, { opacity: l.opacity }, [{ key: 'opacity', label: 'opacity', group: 'layer', type: 'range', min: 0, max: 1, default: 1, live: true }], st.routes, st.lanes, t);
      this.comp.blend(tex, l.kind === 'plan' ? 'normal' : l.blend, lo ? Number(lo.opacity) : l.opacity, maskTex, l.mask);
      if (cur) below = cur;
      this.layerMs[l.id] = performance.now() - l0;
    }
    // post
    let outTex = this.comp.result().tex;
    const post = { ...st.post };
    const pm = this.mod.apply('post', post as unknown as Params, POST_SPECS, st.routes, st.lanes, t);
    if (pm) Object.assign(post, pm);
    const att = this.flashAttenuation(t);
    const g = this.guard;
    const guardMix = g && s.flashGuard && att < 1 ? 0.3 + 0.7 * att : 1;
    const mean = g ? sample(g.mean, t, g.fps) : 0;
    if (!postIsNeutral(post) || guardMix < 0.999) {
      const m = Math.sqrt(Math.max(0, mean)); // display-referred grey for the precomputed mean luminance
      outTex = this.post.apply(outTex, W, H, post, Math.round(t * this.fps), { mix: guardMix, mean: [m, m, m] }, att);
    }
    this.comp.present(outTex, !transparent);
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.globalCompositeOperation = 'copy';
    this.g.drawImage(this.host.canvas as HTMLCanvasElement, 0, 0, W, H, 0, 0, W, H);
    this.g.globalCompositeOperation = 'source-over';
    if (!opts.noTitle && !ownsTitle) this.titleCard(t);
    if (saved) Object.assign(s, saved);
    this.frameMs = performance.now() - t00;
  }

  /** The word mask of the plan layer at t, drawn into the stage canvas (tests, storyboards). */
  renderMaskAt(t: number): void {
    const segs = this.segments;
    if (!segs.length || !this.song) return;
    let i = segs.findIndex((s) => t < s.end);
    if (i < 0) i = segs.length - 1;
    const e = segs[i].effect;
    const f = this.frameOf(planInstance(e), e, t, true);
    if (!f) return;
    this.comp.begin(false);
    this.comp.present(this.comp.tex(f, 'maskOut'), true);
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.drawImage(this.host.canvas as HTMLCanvasElement, 0, 0);
  }

  /** Render t and return the 64×36 guard grid (bottom-up RGBA) of the composited frame. */
  renderSmall(t: number): Uint8Array {
    this.renderAt(t, { noTitle: true });
    const c = this.small ?? (this.small = makeCanvas(64, 36));
    const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    g.drawImage(this.canvas as HTMLCanvasElement, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data;
    // flip to bottom-up to match the GL convention used by measure()
    const out = new Uint8Array(d.length);
    for (let y = 0; y < 36; y++) out.set(d.subarray((35 - y) * 64 * 4, (36 - y) * 64 * 4), y * 64 * 4);
    return out;
  }
  private small: HTMLCanvasElement | OffscreenCanvas | null = null;

  private titleCard(t: number): void {
    const s = this.state.settings, ly = this.lyrics;
    if (!(s.title || s.artist) || !ly || !ly.words.length) return;
    const first = ly.words[0].start;
    if (first < 1.2) return;
    const fade = Math.min(1, t / 0.5) * Math.max(0, Math.min(1, (first - 0.35 - t) / 0.5));
    if (fade <= 0) return;
    const g = this.g, W = this.w, H = this.h;
    g.save();
    g.globalAlpha = 0.35 * fade;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.globalAlpha = fade;
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const cap = Math.min(W, H) * 0.075;
    g.fillStyle = '#F4EFE6';
    g.font = font('oswald', sizeForCap('oswald', cap));
    const title = (s.title || '').toUpperCase();
    const tw = g.measureText(title).width;
    const k = Math.min(1, (W * 0.86) / Math.max(1, tw));
    g.save(); g.translate(W / 2, H * 0.5); g.scale(k, k); g.fillText(title, 0, 0); g.restore();
    if (s.artist) {
      const c2 = cap * 0.28;
      g.font = font('montserrat300', sizeForCap('montserrat300', c2));
      const spaced = s.artist.toUpperCase().split('').join('  ');
      try { (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(c2 * 0.45).toFixed(1)}px`; } catch { /* older canvas */ }
      g.fillText((g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing !== undefined ? s.artist.toUpperCase() : spaced, W / 2, H * 0.5 + cap * 0.95);
      try { (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px'; } catch { /* */ }
    }
    g.restore();
  }

  /** current effect id of the plan at t */
  effectAt(t: number): string | null {
    const s = this.segments.find((x) => t < x.end) ?? this.segments[this.segments.length - 1];
    return s?.effect ?? null;
  }
  prepared(instanceId: string): Effect | undefined { return this.inst.get(instanceId)?.effect; }
  prepareMs(): Record<string, number> { const o: Record<string, number> = {}; for (const [k, v] of this.inst) o[k] = v.ms; return o; }

  dispose(): void {
    for (const p of this.inst.values()) p.effect.dispose();
    this.inst.clear();
    this.comp.dispose(); this.material.dispose(); this.post.dispose();
  }
}

// Stage: owns the output canvas, prepares effects, and composites them over time
// (a single effect, or Director mode which switches effect per section with a transition).
import type { GlobalSettings, Params, Song } from './types';
import type { Effect, EffectFactory } from './effects/types';
import { clamp, eIO } from './effects/types';
import { fontCSS } from './render/sdf';
import { MaterialPass, DEFAULT_MATERIAL, type MaterialSettings } from './render/material';
import { sample } from './analysis/dsp';

export type BlendMode = 'screen' | 'lighter' | 'multiply' | 'overlay' | 'soft-light' | 'source-over';
export interface OverlaySettings { effect: string; blend: BlendMode; opacity: number }
export const DEFAULT_OVERLAY: OverlaySettings = { effect: 'off', blend: 'screen', opacity: .6 };

export interface PlanSeg { start: number; end: number; effect: string }
export type Transition = 'cut' | 'flash' | 'wipe' | 'dissolve';

export const ASPECTS: Record<GlobalSettings['aspect'], [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] };

export function sizeFor(aspect: GlobalSettings['aspect'], scale: number): [number, number] {
  const [w, h] = ASPECTS[aspect]; return [Math.round(w * scale / 2) * 2, Math.round(h * scale / 2) * 2];
}

export class Stage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private layers: [HTMLCanvasElement, HTMLCanvasElement];
  private lctx: [CanvasRenderingContext2D, CanvasRenderingContext2D];
  private instances = new Map<string, { fx: Effect; key: string }>();
  private factories: Map<string, EffectFactory>;
  song: Song | null = null;
  settings!: GlobalSettings;
  params: Record<string, Params> = {};
  plan: PlanSeg[] = [];
  transition: Transition = 'flash';
  width = 960; height = 540;
  private prepId = 0;
  /** Hybrid: a material re-skins the words of layout effects; an overlay effect is blended on top. Both off by default. */
  material: MaterialSettings = { ...DEFAULT_MATERIAL };
  overlay: OverlaySettings = { ...DEFAULT_OVERLAY };
  private matPass: MaterialPass | null = null;
  private frameCv = document.createElement('canvas'); private maskCv = document.createElement('canvas'); private ovCv = document.createElement('canvas');

  constructor(canvas: HTMLCanvasElement, factories: EffectFactory[]) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.factories = new Map(factories.map(f => [f.id, f]));
    const mk = () => { const c = document.createElement('canvas'); return c; };
    this.layers = [mk(), mk()];
    this.lctx = [this.layers[0].getContext('2d', { alpha: false })!, this.layers[1].getContext('2d', { alpha: false })!];
  }

  setSize(w: number, h: number) {
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    for (const l of [...this.layers, this.frameCv, this.maskCv, this.ovCv]) { l.width = w; l.height = h; }
  }

  /** Prepare every effect the plan needs. Returns false if superseded by a newer call. */
  async prepare(onStatus?: (s: string) => void): Promise<boolean> {
    const id = ++this.prepId;
    if (!this.song) return true;
    const need = new Set(this.plan.map(p => p.effect));
    if (this.overlay.effect !== 'off' && this.factories.has(this.overlay.effect)) need.add(this.overlay.effect);
    // drop instances no longer needed (WebGL contexts are a scarce resource)
    for (const [k, v] of this.instances) if (!need.has(k)) { v.fx.dispose(); this.instances.delete(k); }
    for (const eid of need) {
      const f = this.factories.get(eid); if (!f) continue;
      const key = this.prepKey(eid);
      const cur = this.instances.get(eid);
      if (cur && cur.key === key) continue;
      onStatus?.(`Preparing ${f.name}…`);
      const fx = cur?.fx ?? f.create();
      await fx.prepare({ song: this.song, settings: this.settings, params: { ...this.params[eid] }, width: this.width, height: this.height });
      if (id !== this.prepId) return false;
      this.instances.set(eid, { fx, key });
    }
    return true;
  }

  /** Signature of everything that requires re-preparation (non-live params + global settings + size). */
  private prepKey(eid: string): string {
    const f = this.factories.get(eid)!; const p = this.params[eid] ?? {};
    const nonLive = f.params.filter(s => !s.live).map(s => `${s.key}=${p[s.key]}`).join('&');
    const s = this.settings;
    return [this.width, this.height, s.syncOffsetMs, s.caseMode, s.seed, s.minReadMs, s.aspect, s.cameraEnergy, nonLive, this.songStamp].join('|');
  }
  songStamp = 0;

  setLiveParams(eid: string, p: Params) { this.params[eid] = { ...this.params[eid], ...p }; this.instances.get(eid)?.fx.setParams(this.params[eid]); }
  needsPrepare(eid: string) { const cur = this.instances.get(eid); return !cur || cur.key !== this.prepKey(eid); }
  isReady() { return this.plan.every(p => this.instances.has(p.effect)) && (this.overlay.effect === 'off' || !this.factories.has(this.overlay.effect) || this.instances.has(this.overlay.effect)); }
  /** Can this effect be re-skinned by a material? (it renders a word mask) */
  supportsMaterial(eid: string) { const f = this.factories.get(eid); return !!f && typeof f.create().renderMask === 'function'; }

  segmentAt(t: number): number {
    for (let i = 0; i < this.plan.length; i++) if (t < this.plan[i].end || i === this.plan.length - 1) return i;
    return 0;
  }

  render(t: number) {
    this.renderBase(t);
    this.applyHybrid(t);
    this.overlays(t);
  }

  private applyHybrid(t: number) {
    const W = this.width, H = this.height, c = this.ctx;
    if (!this.song || !this.plan.length) return;
    const seg = this.plan[this.segmentAt(t)], cur = this.instances.get(seg.effect);
    const a = this.song.analysis;
    if (this.material.id !== 'off' && cur?.fx.renderMask) {
      if (!this.matPass) { try { this.matPass = new MaterialPass(); } catch { this.material = { ...this.material, id: 'off' }; } }
      if (this.matPass) {
        const fc = this.frameCv.getContext('2d')!; fc.drawImage(this.canvas, 0, 0);
        const mc = this.maskCv.getContext('2d', { alpha: false })!; mc.setTransform(1, 0, 0, 1, 0, 0); mc.fillStyle = '#000'; mc.fillRect(0, 0, W, H);
        cur.fx.renderMask(t, mc);
        let lb = -9; for (const b of a.beats) { if (b <= t) lb = b; else break; }
        const react = this.settings.reactivity / 100;
        this.matPass.apply(this.frameCv, this.maskCv, c, t, { ...this.material, strength: this.material.strength * this.settings.intensity / 100 },
          [sample(a.bands.bass, t) * react, sample(a.centroid, t), Math.exp(-(t - lb) * 7) * react, sample(a.loud, t)]);
      }
    }
    const ov = this.overlay; const o = ov.effect !== 'off' ? this.instances.get(ov.effect) : undefined;
    if (o && ov.opacity > 0 && ov.effect !== seg.effect) {
      const oc = this.ovCv.getContext('2d', { alpha: false })!; oc.setTransform(1, 0, 0, 1, 0, 0);
      o.fx.render(t, oc);
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = ov.opacity; c.globalCompositeOperation = ov.blend; c.drawImage(this.ovCv, 0, 0, W, H); c.restore();
    }
  }

  private renderBase(t: number) {
    const c = this.ctx, W = this.width, H = this.height;
    if (!this.song || !this.plan.length) { c.fillStyle = '#000'; c.fillRect(0, 0, W, H); return; }
    const i = this.segmentAt(t), seg = this.plan[i];
    const cur = this.instances.get(seg.effect);
    if (!cur) { c.fillStyle = '#000'; c.fillRect(0, 0, W, H); return; }
    const prev = i > 0 ? this.plan[i - 1] : null;
    const dt = t - seg.start;
    const TR = { cut: 0, flash: 0, wipe: 0.55, dissolve: 0.8 }[this.transition];
    if (prev && prev.effect !== seg.effect && dt < TR) {
      const pf = this.instances.get(prev.effect);
      if (pf) {
        pf.fx.render(t, this.lctx[0]); cur.fx.render(t, this.lctx[1]);
        const q = eIO(clamp(dt / TR));
        if (this.transition === 'dissolve') { c.globalAlpha = 1; c.drawImage(this.layers[0], 0, 0); c.globalAlpha = q; c.drawImage(this.layers[1], 0, 0); c.globalAlpha = 1; }
        else { // ink wipe: a ragged diagonal edge
          c.drawImage(this.layers[0], 0, 0);
          c.save(); c.beginPath();
          const edge = -0.25 * W + q * 1.5 * W;
          c.moveTo(0, 0);
          for (let y = 0; y <= H; y += H / 24) { const j = Math.sin(y * 0.031 + 1.7) * 18 + Math.sin(y * 0.11) * 9; c.lineTo(edge - y * 0.25 + j, y); }
          c.lineTo(0, H); c.closePath(); c.clip(); c.drawImage(this.layers[1], 0, 0); c.restore();
        }
        return;
      }
    }
    cur.fx.render(t, c);
    if (prev && prev.effect !== seg.effect && this.transition === 'flash' && dt >= 0 && dt < 0.3) {
      c.fillStyle = `rgba(255,255,255,${(1 - dt / 0.3) ** 2 * 0.9})`; c.fillRect(0, 0, W, H);
    }
  }

  /** Title card at the head (when there is room before the first word). */
  private overlays(t: number) {
    const s = this.settings, song = this.song!; if (!s.endCard || !(s.title || s.artist)) return;
    const seg = this.plan[this.segmentAt(t)]; if (seg && this.instances.get(seg.effect)?.fx.ownsTitle) return;
    const first = song.lyrics.words[0]?.start ?? 4;
    const end = Math.min(4, first - 0.25); if (end < 1.2 || t > end) return;
    const a = clamp(Math.min(t / 0.5, (end - t) / 0.4));
    const c = this.ctx, W = this.width, H = this.height, u = Math.min(W, H);
    c.save(); c.globalAlpha = a; c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, W, H);
    c.textAlign = 'center'; c.fillStyle = '#f2efe6';
    c.font = fontCSS('cond', u * 0.11); c.fillText(s.title.toUpperCase(), W / 2, H / 2);
    c.font = fontCSS('mont3', u * 0.035); c.fillStyle = '#d8d3c6'; c.fillText(s.artist.toUpperCase().split('').join(' '), W / 2, H / 2 + u * 0.075);
    c.restore();
  }

  dispose() { for (const v of this.instances.values()) v.fx.dispose(); this.instances.clear(); this.matPass?.dispose(); this.matPass = null; }
}

/** Build an effect plan for Director mode from the song's sections. */
export function directorPlan(song: Song, byLabel: Record<string, string>, fallback: string): PlanSeg[] {
  const secs = song.analysis.sections; const dur = song.analysis.duration;
  if (!secs.length) return [{ start: 0, end: dur, effect: fallback }];
  const out: PlanSeg[] = [];
  secs.forEach((s, i) => {
    const eff = byLabel[s.label] || fallback;
    const start = i === 0 ? 0 : s.start, end = i === secs.length - 1 ? dur : secs[i + 1].start;
    if (out.length && out[out.length - 1].effect === eff) out[out.length - 1].end = end;
    else out.push({ start, end, effect: eff });
  });
  return out;
}

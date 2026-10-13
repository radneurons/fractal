// Stage: owns the output canvas, prepares effects, and composites them over time
// (a single effect, or Director mode which switches effect per section with a transition).
import type { GlobalSettings, Params, Song } from './types';
import type { Effect, EffectFactory } from './effects/types';
import { clamp, eIO } from './effects/types';
import { fontCSS } from './render/sdf';

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
    for (const l of this.layers) { l.width = w; l.height = h; }
  }

  /** Prepare every effect the plan needs. Returns false if superseded by a newer call. */
  async prepare(onStatus?: (s: string) => void): Promise<boolean> {
    const id = ++this.prepId;
    if (!this.song) return true;
    const need = new Set(this.plan.map(p => p.effect));
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
    return [this.width, this.height, s.syncOffsetMs, s.caseMode, s.seed, s.minReadMs, s.aspect, nonLive, this.songStamp].join('|');
  }
  songStamp = 0;

  setLiveParams(eid: string, p: Params) { this.params[eid] = { ...this.params[eid], ...p }; this.instances.get(eid)?.fx.setParams(this.params[eid]); }
  needsPrepare(eid: string) { const cur = this.instances.get(eid); return !cur || cur.key !== this.prepKey(eid); }
  isReady() { return this.plan.every(p => this.instances.has(p.effect)); }

  segmentAt(t: number): number {
    for (let i = 0; i < this.plan.length; i++) if (t < this.plan[i].end || i === this.plan.length - 1) return i;
    return 0;
  }

  render(t: number) {
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
        this.overlays(t); return;
      }
    }
    cur.fx.render(t, c);
    if (prev && prev.effect !== seg.effect && this.transition === 'flash' && dt >= 0 && dt < 0.3) {
      c.fillStyle = `rgba(255,255,255,${(1 - dt / 0.3) ** 2 * 0.9})`; c.fillRect(0, 0, W, H);
    }
    this.overlays(t);
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

  dispose() { for (const v of this.instances.values()) v.fx.dispose(); this.instances.clear(); }
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

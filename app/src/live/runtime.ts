// Live runtime (SPEC §14.4, §14.6): drives one live-capable effect from the online analyser and the follower.
// prepareLive = the effect's own prepare over the follower's view (current line + 1 line of look-ahead), re-run
// whenever a line or word is cued; the previous instance keeps rendering until the new one is ready, so a cue never
// drops a frame. renderLive = render(t) on the live clock against a rolling analysis (session.ts), or the SDK
// effect's own renderLive when it has one. The flash guard runs online on the 64×36 output.
import type { GlobalSettings, Lyrics, Song } from '../types.ts';
import type { Effect, EffectContext } from '../effects/types.ts';
import { effectClass, allEffects } from '../effects/registry.ts';
import type { Stage } from '../stage.ts';
import { LiveAnalysis, type OnlineDelta } from './session.ts';
import { Follower } from './follow.ts';
import type { LiveFeatures, OnlineState } from './types.ts';
import type { LiveCapable } from '../effects/sdk.ts';
import { measure, analyseFlashes, type GuardFrame } from '../render/flashguard.ts';
import { pulse } from '../analysis/dsp.ts';

export function liveEffects(): { id: string; name: string }[] {
  return allEffects().filter((c) => c.meta.supportsLive).map((c) => ({ id: c.meta.id, name: c.meta.name }));
}

export class LiveRuntime {
  readonly session = new LiveAnalysis();
  readonly follower: Follower;
  effectId: string;
  private cur: { effect: Effect; version: number; effectId: string; w: number; h: number } | null = null;
  private preparing = false;
  /** latest analyser report and when it arrived (performance.now, ms) */
  private online: OnlineState | null = null; private onlineAt = 0;
  private frameNo = 0;
  // online flash guard
  private guardFrames: GuardFrame[] = [];
  private att = 1; private attHoldUntil = 0;
  private flashesNow = 0;
  stamp = 1;
  constructor(private stage: Stage, lyrics: Lyrics, private settings: () => GlobalSettings, effectId = 'neon') {
    this.follower = new Follower(lyrics);
    this.effectId = liveEffects().some((e) => e.id === effectId) ? effectId : 'karaoke';
  }

  /** Live clock: the analyser's audio time, advanced by wall time since its last report (≤ 100 ms). */
  now(): number {
    if (!this.online) return 0;
    return this.online.t + Math.min(0.1, (performance.now() - this.onlineAt) / 1000);
  }
  get state(): OnlineState | null { return this.online; }
  get flashes(): number { return this.flashesNow; }
  get attenuation(): number { return this.att; }

  ingest(s: OnlineState, d: OnlineDelta): void {
    this.session.ingest(s, d);
    this.online = s; this.onlineAt = performance.now();
    if (d.onsets.length) this.follower.hear(d.onsets, s.vocal);
  }

  setEffect(id: string): void { if (id !== this.effectId) { this.effectId = id; this.stamp++; } }

  private key(): number { return this.follower.version * 1000 + this.stamp; }

  private async prepare(): Promise<void> {
    const cls = effectClass(this.effectId);
    if (!cls) return;
    this.preparing = true;
    const version = this.key(), effectId = this.effectId;
    try {
      const { w, h } = this.stage.liveSize();
      const view = this.follower.view();
      const settings = this.settings();
      const song = { name: 'live', audio: null as unknown as AudioBuffer, analysis: this.session.a, lyrics: view, stamp: version } as Song;
      const ctx: EffectContext = {
        song, lyrics: view, analysis: this.session.a, settings, params: {}, width: w, height: h, host: this.stage.host,
        flashAttenuation: () => this.att, artwork: null, instanceId: `live:${effectId}`, quality: 'preview',
      };
      const effect = new cls();
      await effect.prepare(ctx);
      const old = this.cur;
      this.cur = { effect, version, effectId, w, h };
      old?.effect.dispose();
    } finally { this.preparing = false; }
  }

  private features(t: number): LiveFeatures {
    const s = this.online!;
    const beats = this.session.a.beats;
    const f = this.follower;
    return {
      ...s, t, follow: f.state(),
      beatPulse: (x, k = 7) => pulse(beats, x, k),
      wordReveal: (id, x, entrance = 0.3) => { const w = f.state().words.find((q) => q.id === id); return w && Number.isFinite(w.shownAt) ? Math.max(0, Math.min(1, (x - w.shownAt + entrance) / entrance)) : 0; },
    };
  }

  /** Render and present one frame. Call from requestAnimationFrame. */
  frame(): void {
    const { w, h } = this.stage.liveSize();
    const want = this.key();
    if (!this.preparing && (!this.cur || this.cur.version !== want || this.cur.w !== w || this.cur.h !== h)) void this.prepare();
    if (!this.cur || !this.online) { this.stage.clearLive(); return; }
    const t = this.now();
    const e = this.cur.effect as Effect & Partial<LiveCapable>;
    const f = e.renderLive ? e.renderLive(t, this.features(t)) : e.render(t);
    const px = this.stage.presentLive(f, this.frameNo++, this.att);
    this.guard(px);
  }

  /** WCAG 2.3.1 online: count general/red flashes in the last second of output; attenuate the next frames. */
  private guard(px: Uint8Array): void {
    const s = this.settings();
    this.guardFrames.push(measure(px, 64, 36));
    if (this.guardFrames.length > 60) this.guardFrames.shift();
    const rep = analyseFlashes(this.guardFrames, 60);
    this.flashesNow = rep.maxFlashesPerSecond;
    const nowMs = performance.now();
    if (s.flashGuard && rep.maxFlashesPerSecond >= 3) { this.att = Math.min(this.att, 0.25); this.attHoldUntil = nowMs + 500; }
    else if (nowMs > this.attHoldUntil) this.att = Math.min(1, this.att + 1 / 60 / 0.6); // ease back over ~0.6 s
  }

  dispose(): void { this.cur?.effect.dispose(); this.cur = null; }
}

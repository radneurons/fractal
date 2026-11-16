// Runs the photosensitivity pre-pass on a stage (SPEC §10.3): measure → fix → verify, in idle slices.
import type { Stage } from '../stage.ts';
import { measure, analyseFlashes, buildAttenuation, meanCurve, type GuardFrame, type GuardState, type FlashReport } from './flashguard.ts';

export interface GuardRun { cancel(): void; done: Promise<GuardState | null> }

/** Key of everything that changes the picture; a guard computed for another key is stale. */
export function guardKey(stage: Stage): string {
  const s = stage.state;
  return JSON.stringify([stage.song?.stamp, s.plan, s.layers, s.instances, s.post, s.routes, s.lanes, { ...s.settings, flashGuard: 0 }]);
}

async function prepass(stage: Stage, fps: number, t0: number, t1: number, onProgress: (p: number) => void, cancelled: () => boolean, slice: number): Promise<GuardFrame[] | null> {
  const n = Math.max(1, Math.ceil((t1 - t0) * fps));
  const frames: GuardFrame[] = [];
  let last = performance.now();
  for (let i = 0; i < n; i++) {
    if (cancelled()) return null;
    frames.push(measure(stage.renderSmall(t0 + i / fps), 64, 36));
    if (performance.now() - last > slice) { onProgress(i / n); await new Promise((r) => setTimeout(r, 0)); last = performance.now(); }
  }
  return frames;
}

/**
 * Measure the whole timeline (or a range) at `fps`, attenuate the windows that would hold a 4th flash,
 * and verify. Up to four passes: attenuation 0.5 → 0.25 → 0.08 → 0.
 */
export function runGuard(stage: Stage, opts: { fps?: number; start?: number; end?: number; onProgress?: (msg: string, p: number) => void; slice?: number } = {}): GuardRun {
  let cancel = false;
  const fps = opts.fps ?? 30;
  const t0 = opts.start ?? 0, t1 = opts.end ?? stage.duration;
  const key = guardKey(stage);
  const done = (async (): Promise<GuardState | null> => {
    const n = Math.max(1, Math.ceil((t1 - t0) * fps));
    const total = Math.max(1, Math.ceil(stage.duration * fps));
    const prev = stage.guard;
    // measure without any attenuation
    stage.guard = null;
    const levels = [0.5, 0.25, 0.08, 0];
    let frames = await prepass(stage, fps, t0, t1, (p) => opts.onProgress?.('Checking flashes', p * 0.5), () => cancel, opts.slice ?? 12);
    if (!frames) { stage.guard = prev; return null; }
    let report: FlashReport = analyseFlashes(frames, fps);
    const fixed: [number, number][] = report.violations.map(([a, b]) => [t0 + a / fps, t0 + b / fps]);
    const off = Math.round(t0 * fps);
    let att = new Float32Array(total).fill(1);
    const mean = new Float32Array(total);
    mean.set(meanCurve(frames, fps).subarray(0, Math.min(n, total - off)), off);
    let state: GuardState = { fps, attenuation: att, mean, report, fixed, verified: report.violations.length === 0, key };
    for (let pass = 0; pass < levels.length && report.violations.length; pass++) {
      const local = buildAttenuation(n, fps, report, levels[pass], att.subarray(off, off + n));
      att = Float32Array.from(att);
      att.set(local.subarray(0, Math.min(n, total - off)), off);
      state = { ...state, attenuation: att };
      stage.guard = state;
      frames = await prepass(stage, fps, t0, t1, (p) => opts.onProgress?.(`Verifying (pass ${pass + 1})`, 0.5 + 0.5 * p), () => cancel, opts.slice ?? 12);
      if (!frames) { stage.guard = prev; return null; }
      report = analyseFlashes(frames, fps);
      state = { ...state, report, verified: report.violations.length === 0 };
    }
    stage.guard = state;
    return state;
  })();
  return { cancel: () => { cancel = true; }, done };
}

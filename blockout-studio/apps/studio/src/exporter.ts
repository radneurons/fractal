import { buildShotPackage, createVideoSink, GLPassRenderer, hashBytes, passSize, softRenderer, type PassName, type PassRenderer, type ShotManifest } from '@blockout/render';
import { shotFrames, type Project, type Shot } from '@blockout/core';
import { S } from './store';

export const DEFAULT_PASSES: PassName[] = ['clay', 'depth', 'depthMetric', 'normals', 'id', 'pose', 'canny', 'flow', 'fx'];
export interface ExportOpts { height?: number; passes?: PassName[]; video?: boolean; prompts?: Record<string, string>; onProgress?: (done: number, total: number, label: string) => void; soft?: boolean; project?: Project }
let shared: GLPassRenderer | null = null;
/** One offscreen WebGL renderer reused across exports (context creation is the expensive part). */
export function exportRenderer(): PassRenderer { try { return (shared ??= new GLPassRenderer(document.createElement('canvas'))); } catch { return softRenderer; } }

export async function exportShotPackage(shot: Shot, o: ExportOpts = {}): Promise<{ zip: Uint8Array; manifest: ShotManifest; files: Record<string, Uint8Array>; seconds: number; hash: string }> {
  const project = o.project ?? S().project, R = o.soft ? softRenderer : exportRenderer(), gl = R.kind === 'webgl' ? (R as GLPassRenderer) : null, t0 = performance.now();
  const [w, h] = passSize(project, o.height ?? 720);
  const res = await buildShotPackage(project, shot, {
    renderer: R, passes: o.passes ?? DEFAULT_PASSES, height: o.height ?? 720, prompts: o.prompts, onProgress: o.onProgress,
    videoSink: o.video === false ? undefined : () => createVideoSink(w, h, project.fps),
    drawToCanvas: gl ? (f, pass) => { gl.renderShotFrame(project, shot, f, pass, w, h); return gl.output; } : undefined,
  });
  return { ...res, seconds: (performance.now() - t0) / 1000, hash: hashBytes(res.zip) };
}
/** Clay-pass throughput at a given height, as a multiple of real time. `encode` includes WebCodecs. */
export async function benchClay(height = 1080, frames = 48, encode = true): Promise<{ fps: number; xRealtime: number; width: number; height: number; renderer: string; encoded: boolean }> {
  const p = S().project, shot = p.shots[3] ?? p.shots[0], gl = exportRenderer() as GLPassRenderer, [w, h] = passSize(p, height), n = Math.min(frames, shotFrames(p, shot));
  const sink = encode ? await createVideoSink(w, h, p.fps) : null;
  gl.renderShotFrame(p, shot, 0, 'clay', w, h); const t0 = performance.now();
  for (let f = 0; f < n; f++) { gl.renderShotFrame(p, shot, f, 'clay', w, h); if (sink) await sink.add(gl.output, f); else gl.renderer.getContext().finish(); }
  if (sink) await sink.finish();
  const fps = n / ((performance.now() - t0) / 1000);
  return { fps, xRealtime: fps / p.fps, width: w, height: h, renderer: gl.info, encoded: !!sink };
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__blockout = { exportShotPackage, benchClay, hashBytes };

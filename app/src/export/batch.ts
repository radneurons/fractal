// Batch export (SPEC §13.6): a queue of outputs; each re-prepares at its own size and aspect (layouts adapt, never crop).
import type { App } from '../app.ts';
import type { Aspect } from '../types.ts';
import { exportVideo, type ExportOptions, type ExportResult } from './exporter.ts';
import { exportGif } from './gif.ts';

export interface BatchItem { id: string; label: string; kind: 'video' | 'gif'; aspect: Aspect; res: number; format: 'mp4' | 'webm'; fps: number; status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; progress: number; error?: string; result?: { blob: Blob; fileName: string }; abort?: AbortController }

export const BATCH_PRESETS: Omit<BatchItem, 'id' | 'status' | 'progress'>[] = [
  { label: '16:9 1080p MP4', kind: 'video', aspect: '16:9', res: 1080, format: 'mp4', fps: 30 },
  { label: '9:16 1080p MP4', kind: 'video', aspect: '9:16', res: 1080, format: 'mp4', fps: 30 },
  { label: '1:1 1080p MP4', kind: 'video', aspect: '1:1', res: 1080, format: 'mp4', fps: 30 },
  { label: '4:5 1080p MP4', kind: 'video', aspect: '4:5', res: 1080, format: 'mp4', fps: 30 },
  { label: '1:1 GIF', kind: 'gif', aspect: '1:1', res: 480, format: 'mp4', fps: 15 },
];

export async function runBatch(app: App, items: BatchItem[], base: Omit<ExportOptions, 'format' | 'res' | 'fps' | 'aspect'>, onUpdate: () => void): Promise<void> {
  const savedAspect = app.state.settings.aspect;
  for (const it of items) {
    if (it.status !== 'queued') continue;
    it.status = 'running'; it.abort = new AbortController(); onUpdate();
    try {
      if (it.kind === 'gif') {
        app.state.settings.aspect = it.aspect;
        const r = await exportGif(app, { start: base.start, end: base.end, width: it.res, fps: it.fps, loop: true, signal: it.abort.signal, onProgress: (p) => { it.progress = p; onUpdate(); } });
        it.result = { blob: r.blob, fileName: `${(app.state.settings.title || 'lyric-video').replace(/\s+/g, '-')}-${it.aspect.replace(':', 'x')}.gif` };
      } else {
        const r: ExportResult = await exportVideo(app, { ...base, format: it.format, res: it.res, fps: it.fps, aspect: it.aspect, signal: it.abort.signal, onProgress: (p) => { it.progress = p.frame / p.frames; onUpdate(); } });
        it.result = { blob: r.blob, fileName: r.fileName };
      }
      it.status = 'done'; it.progress = 1;
    } catch (e) {
      it.status = (e as Error).name === 'AbortError' ? 'cancelled' : 'failed';
      it.error = String((e as Error).message ?? e);
    } finally { app.state.settings.aspect = savedAspect; }
    onUpdate();
  }
}

// Transparent video (SPEC §13.2): VP9 with alpha in WebM when the encoder supports it;
// otherwise a PNG sequence streamed into a zip with fflate so memory stays flat.
import { Zip, ZipPassThrough } from 'fflate';
import type { App } from '../app.ts';
import { sizeFor } from '../project/state.ts';
import { pickVideoCodec } from './exporter.ts';
import { effectMeta } from '../effects/registry.ts';

export async function alphaSupported(w: number, h: number, fps: number): Promise<boolean> {
  return !!(await pickVideoCodec('webm', w, h, fps, 8e6, true));
}

/** Effects in the current plan/layers that cannot render a transparent background honestly. */
export function opaqueEffects(app: App): string[] {
  const ids = new Set<string>(app.stage.segments.map((s) => s.effect));
  for (const l of app.state.layers) if (l.kind === 'effect' && l.effect && l.enabled) ids.add(l.effect);
  return [...ids].filter((id) => !effectMeta(id)?.supportsTransparent).map((id) => effectMeta(id)?.name ?? id);
}

export async function exportPngZip(app: App, o: { res: number; fps: number; start: number; end: number; onProgress?: (p: number) => void; signal?: AbortSignal }): Promise<{ blob: Blob; frames: number }> {
  const stage = app.stage;
  const { w, h } = sizeFor(app.state.settings.aspect, o.res);
  const prev = { forced: stage.forcedSize, tr: app.state.settings.transparentBackground };
  app.exporting = true;
  const chunks: Uint8Array[] = [];
  const zip = new Zip((err, data) => { if (err) throw err; chunks.push(data); });
  try {
    app.state.settings.transparentBackground = true;
    stage.forcedSize = { w, h }; stage.fps = o.fps;
    await stage.prepare();
    const n = Math.max(1, Math.round((o.end - o.start) * o.fps));
    for (let i = 0; i < n; i++) {
      if (o.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      stage.renderAt(o.start + i / o.fps);
      const blob = await new Promise<Blob>((res, rej) => (stage.canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
      const f = new ZipPassThrough(`frame_${String(i).padStart(5, '0')}.png`);
      zip.add(f);
      f.push(new Uint8Array(await blob.arrayBuffer()), true);
      if (i % 2 === 0) { o.onProgress?.(i / n); await new Promise((r) => setTimeout(r, 0)); }
    }
    zip.end();
    return { blob: new Blob(chunks as BlobPart[], { type: 'application/zip' }), frames: n };
  } finally {
    stage.forcedSize = prev.forced; app.state.settings.transparentBackground = prev.tr;
    await stage.prepare(); app.exporting = false;
  }
}

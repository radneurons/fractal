// GIF export (SPEC §13.3): gifenc, a global palette from 8 sampled frames, ≤ 15 s, ≤ 720 px wide, 15 fps,
// optional ordered dither and a seamless loop (whole bars, last 0.25 s cross-faded into the first).
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { App } from '../app.ts';
import { sizeFor } from '../project/state.ts';
import { nearest } from '../analysis/dsp.ts';

export interface GifOptions { start: number; end: number; width?: number; fps?: number; dither?: boolean; loop?: boolean; onProgress?: (p: number) => void; signal?: AbortSignal }

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v / 16 - 0.5) * 24);

export async function exportGif(app: App, o: GifOptions): Promise<{ blob: Blob; frames: number; width: number; height: number }> {
  const song = app.song;
  if (!song) throw new Error('load a song first');
  const fps = o.fps ?? 15;
  let start = o.start, end = Math.min(o.end, o.start + 15);
  if (o.loop) {
    // a whole number of bars
    const db = song.analysis.downbeats;
    const s = nearest(db, start), e = nearest(db, end);
    if (!Number.isNaN(s) && !Number.isNaN(e) && e > s) { start = s; end = e; }
  }
  const stage = app.stage;
  const full = sizeFor(app.state.settings.aspect, 720);
  const k = Math.min(1, (o.width ?? 720) / full.w);
  const w = Math.round((full.w * k) / 2) * 2, h = Math.round((full.h * k) / 2) * 2;
  const prev = stage.forcedSize;
  app.exporting = true;
  try {
    stage.forcedSize = { w, h }; stage.fps = fps;
    await stage.prepare();
    const n = Math.max(1, Math.round((end - start) * fps));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const grab = (t: number): Uint8ClampedArray => { stage.renderAt(t); g.drawImage(stage.canvas as HTMLCanvasElement, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
    // global palette from 8 sampled frames
    const sample = new Uint8ClampedArray(8 * w * h * 4);
    for (let i = 0; i < 8; i++) sample.set(grab(start + ((i + 0.5) / 8) * (end - start)), i * w * h * 4);
    const palette = quantize(sample, 256, { format: 'rgb565' });
    const enc = GIFEncoder();
    const fade = o.loop ? Math.min(Math.round(0.25 * fps), n >> 1) : 0;
    const head: Uint8ClampedArray[] = [];
    for (let i = 0; i < n; i++) {
      if (o.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      let px = grab(start + i / fps);
      if (fade) {
        if (i < fade) head.push(px.slice());
        else if (i >= n - fade) { // cross-fade the tail into the head
          const u = (i - (n - fade) + 1) / (fade + 1), hp = head[i - (n - fade)];
          const mix = new Uint8ClampedArray(px.length);
          for (let q = 0; q < px.length; q++) mix[q] = px[q] * (1 - u) + hp[q] * u;
          px = mix;
        }
      }
      if (o.dither) {
        const d = new Uint8ClampedArray(px.length);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const q = (y * w + x) * 4, b = BAYER[(y & 3) * 4 + (x & 3)]; d[q] = px[q] + b; d[q + 1] = px[q + 1] + b; d[q + 2] = px[q + 2] + b; d[q + 3] = 255; }
        px = d;
      }
      enc.writeFrame(applyPalette(px, palette, 'rgb565'), w, h, { palette: i === 0 ? palette : undefined, delay: Math.round(1000 / fps), repeat: 0 });
      if (i % 4 === 0) { o.onProgress?.(i / n); await new Promise((r) => setTimeout(r, 0)); }
    }
    enc.finish();
    return { blob: new Blob([enc.bytes() as BlobPart], { type: 'image/gif' }), frames: n, width: w, height: h };
  } finally { stage.forcedSize = prev; await stage.prepare(); app.exporting = false; }
}

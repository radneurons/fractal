// Media layers (SPEC §9.5): images with Ken Burns moves cut on bars, and frame-exact video.
import type { Layer, Analysis } from '../types.ts';
import { makeCanvas } from '../render/sdf.ts';
import { hash01, lowerBound } from '../analysis/dsp.ts';

export interface LoadedMedia { id: string; kind: 'image' | 'video'; el: HTMLImageElement | HTMLVideoElement | ImageBitmap; w: number; h: number; url?: string; preciseSeek: boolean }

export class MediaStore {
  private items = new Map<string, LoadedMedia>();
  private canvases = new Map<string, { c: HTMLCanvasElement | OffscreenCanvas; g: CanvasRenderingContext2D }>();

  async add(id: string, blob: Blob, kind: 'image' | 'video'): Promise<LoadedMedia> {
    this.remove(id);
    const url = URL.createObjectURL(blob);
    let m: LoadedMedia;
    if (kind === 'image') {
      const img = new Image();
      img.src = url;
      await img.decode();
      m = { id, kind, el: img, w: img.naturalWidth, h: img.naturalHeight, url, preciseSeek: true };
    } else {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('video failed to load')); });
      m = { id, kind, el: v, w: v.videoWidth, h: v.videoHeight, url, preciseSeek: 'requestVideoFrameCallback' in v };
    }
    this.items.set(id, m);
    return m;
  }
  addBitmap(id: string, bmp: ImageBitmap | HTMLImageElement): void {
    this.items.set(id, { id, kind: 'image', el: bmp, w: (bmp as ImageBitmap).width, h: (bmp as ImageBitmap).height, preciseSeek: true });
  }
  get(id: string | undefined): LoadedMedia | undefined { return id ? this.items.get(id) : undefined; }
  remove(id: string): void { const m = this.items.get(id); if (m?.url) URL.revokeObjectURL(m.url); this.items.delete(id); }

  /** Seek every video layer to its frame for time t and wait until the frame is decoded (export). */
  async seekAll(layers: Layer[], t: number): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const l of layers) {
      const m = this.get(l.mediaId);
      if (!m || m.kind !== 'video') continue;
      const v = m.el as HTMLVideoElement;
      const target = Math.max(0, Math.min((v.duration || 1e9) - 0.01, t - (l.start ?? 0)));
      if (Math.abs(v.currentTime - target) < 1e-4) continue;
      jobs.push(new Promise<void>((res) => {
        const done = () => { v.removeEventListener('seeked', done); res(); };
        v.addEventListener('seeked', done);
        v.currentTime = target;
        setTimeout(done, 1500);
      }));
    }
    await Promise.all(jobs);
  }
  /** Preview: keep videos roughly in step with the transport. */
  syncPreview(layers: Layer[], t: number, playing: boolean): void {
    for (const l of layers) {
      const m = this.get(l.mediaId);
      if (!m || m.kind !== 'video') continue;
      const v = m.el as HTMLVideoElement;
      const target = Math.max(0, t - (l.start ?? 0));
      if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = Math.min(target, (v.duration || 1e9) - 0.05);
      if (playing && v.paused) void v.play().catch(() => {});
      if (!playing && !v.paused) v.pause();
    }
  }

  /** Draw a media layer into its own canvas (cover fit, optional Ken Burns, blur and dim). */
  draw(layer: Layer, t: number, W: number, H: number, a: Analysis | null, seed: number): HTMLCanvasElement | OffscreenCanvas | null {
    const m = this.get(layer.mediaId);
    if (!m) return null;
    let e = this.canvases.get(layer.id);
    if (!e || e.c.width !== W || e.c.height !== H) { const c = makeCanvas(W, H); e = { c, g: c.getContext('2d') as CanvasRenderingContext2D }; this.canvases.set(layer.id, e); }
    const g = e.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.filter = 'none'; g.globalAlpha = 1;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const fit = layer.mediaFit === 'contain' ? Math.min(W / m.w, H / m.h) : Math.max(W / m.w, H / m.h);
    let zoom = 1, px = 0, py = 0;
    if (m.kind === 'image' && layer.mediaMotion !== 'hold') {
      // Ken Burns between seeded framings, cut every 4 bars
      const bars = a?.downbeats ?? [];
      const k = Math.floor((lowerBound(bars, t + 1e-6) - 1) / 4);
      const t0 = bars[Math.max(0, k * 4)] ?? 0, t1 = bars[Math.min(bars.length - 1, k * 4 + 4)] ?? t0 + 8;
      const u = Math.max(0, Math.min(1, (t - t0) / Math.max(0.5, t1 - t0)));
      const z0 = 1.06 + 0.1 * hash01(k, seed, 1), z1 = 1.06 + 0.1 * hash01(k, seed, 2);
      zoom = z0 + (z1 - z0) * u;
      px = (hash01(k, seed, 3) - 0.5 + (hash01(k, seed, 4) - 0.5) * u) * 0.05 * W;
      py = (hash01(k, seed, 5) - 0.5 + (hash01(k, seed, 6) - 0.5) * u) * 0.05 * H;
    }
    const blur = layer.mediaBlur ?? 0;
    if (blur > 0) g.filter = `blur(${(blur * Math.min(W, H) * 0.03).toFixed(1)}px)`;
    const dw = m.w * fit * zoom * (blur > 0 ? 1.08 : 1), dh = m.h * fit * zoom * (blur > 0 ? 1.08 : 1);
    g.drawImage(m.el as CanvasImageSource, (W - dw) / 2 + px, (H - dh) / 2 + py, dw, dh);
    g.filter = 'none';
    const dim = layer.mediaDim ?? 0;
    if (dim > 0) { g.fillStyle = `rgba(0,0,0,${Math.min(1, dim)})`; g.fillRect(0, 0, W, H); }
    return e.c;
  }
}

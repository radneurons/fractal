// Frame-exact offline export (SPEC §13): WebCodecs video + audio, muxed with mp4-muxer / webm-muxer.
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import type { App } from '../app.ts';
import type { Aspect } from '../types.ts';
import { sizeFor } from '../project/state.ts';
import { integratedLufs, limitTruePeak } from '../analysis/loudness.ts';

export interface ExportOptions {
  format: 'mp4' | 'webm';
  /** short-side resolution: 720, 1080, 1440, 2160 */
  res: number;
  aspect?: Aspect;
  fps: number;
  start: number;
  end: number;
  /** Mbps */
  quality: number;
  alpha?: boolean;
  fadeInMs?: number;
  fadeOutMs?: number;
  /** target integrated loudness (LUFS) or null for off */
  normalise?: number | null;
  preRoll?: number;
  postRoll?: number;
  motionBlur?: { samples: number; shutter: number } | null;
  onProgress?: (p: { frame: number; frames: number; eta: number; msPerFrame: number }) => void;
  signal?: AbortSignal;
}

export interface ExportResult { blob: Blob; videoCodec: string; audioCodec: string; frames: number; width: number; height: number; seconds: number; lufs?: number; fileName: string }

const H264 = ['avc1.640033', 'avc1.640028', 'avc1.4d0033', 'avc1.42e033'];

export async function pickVideoCodec(format: 'mp4' | 'webm', width: number, height: number, fps: number, bitrate: number, alpha = false): Promise<{ codec: string; config: VideoEncoderConfig } | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  const big = Math.max(width, height) > 1920;
  const list = alpha ? ['vp09.00.40.08', 'vp8'] : format === 'mp4'
    ? [...(big ? ['avc1.640034', 'avc1.640033'] : H264), 'vp09.00.40.08', 'vp09.00.51.08', 'av01.0.08M.08', 'av01.0.12M.08']
    : ['vp09.00.40.08', 'vp09.00.51.08', 'vp8', 'av01.0.08M.08'];
  for (const codec of list) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps, ...(codec.startsWith('avc') ? { avc: { format: 'avc' as const } } : {}), ...(alpha ? { alpha: 'keep' as const } : {}) };
    try { const s = await VideoEncoder.isConfigSupported(config); if (s.supported) return { codec, config }; } catch { /* try the next */ }
  }
  return null;
}

async function pickAudioCodec(format: 'mp4' | 'webm'): Promise<{ codec: string; config: AudioEncoderConfig } | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const codec of format === 'mp4' ? ['mp4a.40.2', 'opus'] : ['opus']) {
    const config: AudioEncoderConfig = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
    try { const s = await AudioEncoder.isConfigSupported(config); if (s.supported) return { codec, config }; } catch { /* next */ }
  }
  return null;
}

/** The export range rendered to 48 kHz stereo, with fades, loudness normalisation and a −1 dBTP limiter. */
export async function renderAudio(buffer: AudioBuffer, start: number, end: number, o: Pick<ExportOptions, 'fadeInMs' | 'fadeOutMs' | 'normalise' | 'preRoll' | 'postRoll'>): Promise<{ channels: Float32Array[]; lufs: number }> {
  const pre = o.preRoll ?? 0, post = o.postRoll ?? 0;
  const dur = end - start + pre + post;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(dur * 48000)), 48000);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  src.connect(g); g.connect(ctx.destination);
  const fi = (o.fadeInMs ?? 0) / 1000, fo = (o.fadeOutMs ?? 0) / 1000;
  g.gain.setValueAtTime(fi > 0 ? 0 : 1, 0);
  if (fi > 0) g.gain.linearRampToValueAtTime(1, Math.min(dur, pre + fi));
  if (fo > 0) { g.gain.setValueAtTime(1, Math.max(0, dur - post - fo)); g.gain.linearRampToValueAtTime(0, Math.max(0.001, dur - post)); }
  src.start(Math.max(0, pre - start), Math.max(0, start - pre), end - start + pre + post);
  const out = await ctx.startRendering();
  let channels: Float32Array[] = [out.getChannelData(0), out.numberOfChannels > 1 ? out.getChannelData(1) : out.getChannelData(0)];
  let lufs = integratedLufs(channels, 48000);
  if (o.normalise !== null && o.normalise !== undefined && lufs > -60) {
    const gain = 10 ** ((o.normalise - lufs) / 20);
    channels = channels.map((c) => { const x = new Float32Array(c.length); for (let i = 0; i < c.length; i++) x[i] = c[i] * gain; return x; });
    channels = limitTruePeak(channels, 48000, -1);
    lufs = integratedLufs(channels, 48000);
  }
  return { channels, lufs };
}

export async function exportVideo(app: App, o: ExportOptions): Promise<ExportResult> {
  const song = app.song;
  if (!song) throw new Error('load a song first');
  const stage = app.stage;
  const aspect = o.aspect ?? app.state.settings.aspect;
  const { w, h } = sizeFor(aspect, o.res);
  const pre = o.preRoll ?? 0, post = o.postRoll ?? 0;
  const t0 = Math.max(0, o.start) - pre, seconds = o.end - o.start + pre + post;
  const frames = Math.max(1, Math.round(seconds * o.fps));
  const bitrate = o.quality * 1e6 * (w * h > 1920 * 1080 ? (w * h) / (1920 * 1080) : 1);
  const v = await pickVideoCodec(o.format, w, h, o.fps, bitrate, !!o.alpha);
  if (!v) throw new Error('This browser has no WebCodecs video encoder for that size; use the real-time recorder instead.');
  const au = await pickAudioCodec(o.format);
  const prev = { forced: stage.forcedSize, aspect: app.state.settings.aspect, fps: stage.fps, transparent: app.state.settings.transparentBackground };
  app.exporting = true;
  app.player.pause();
  let wake: { release(): Promise<void> } | null = null;
  try { wake = await (navigator as Navigator & { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* not available */ }
  try {
    app.state.settings.aspect = aspect;
    if (o.alpha) app.state.settings.transparentBackground = true;
    stage.forcedSize = { w, h };
    stage.fps = o.fps;
    await stage.prepare();
    const isMp4 = o.format === 'mp4';
    const vName = v.codec.startsWith('avc') ? 'avc' : v.codec.startsWith('vp09') ? 'vp9' : v.codec.startsWith('vp8') ? 'vp8' : 'av1';
    const aName = au ? (au.codec.startsWith('mp4a') ? 'aac' : 'opus') : null;
    const target = isMp4 ? new Mp4Target() : new WebmTarget();
    const muxer = isMp4
      ? new Mp4Muxer({ target: target as Mp4Target, fastStart: 'in-memory', firstTimestampBehavior: 'offset', video: { codec: vName as 'avc', width: w, height: h, frameRate: o.fps }, ...(aName ? { audio: { codec: aName as 'aac', sampleRate: 48000, numberOfChannels: 2 } } : {}) })
      : new WebmMuxer({ target: target as WebmTarget, firstTimestampBehavior: 'offset', video: { codec: vName === 'vp9' ? 'V_VP9' : vName === 'vp8' ? 'V_VP8' : 'V_AV1', width: w, height: h, frameRate: o.fps, alpha: !!o.alpha }, ...(aName ? { audio: { codec: 'A_OPUS', sampleRate: 48000, numberOfChannels: 2 } } : {}) });
    let err: Error | null = null;
    const venc = new VideoEncoder({ output: (chunk, meta) => (muxer as Mp4Muxer<Mp4Target>).addVideoChunk(chunk, meta), error: (e) => { err = e; } });
    venc.configure(v.config);
    // ---- audio ----
    let lufs: number | undefined;
    if (au) {
      const a = await renderAudio(song.audio, o.start, o.end, o);
      lufs = a.lufs;
      const aenc = new AudioEncoder({ output: (chunk, meta) => (muxer as Mp4Muxer<Mp4Target>).addAudioChunk(chunk, meta), error: (e) => { err = e; } });
      aenc.configure(au.config);
      const n = a.channels[0].length, step = 4800; // 0.1 s chunks
      for (let i = 0; i < n; i += step) {
        const len = Math.min(step, n - i);
        const data = new Float32Array(len * 2);
        data.set(a.channels[0].subarray(i, i + len), 0);
        data.set(a.channels[1].subarray(i, i + len), len);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round((i / 48000) * 1e6), data });
        aenc.encode(ad); ad.close();
      }
      await aenc.flush(); aenc.close();
    }
    // ---- video ----
    const started = performance.now();
    const canvas = stage.canvas as HTMLCanvasElement;
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (err) throw err;
      const t = t0 + i / o.fps;
      await stage.media.seekAll(app.state.layers, t);
      if (o.motionBlur && o.motionBlur.samples > 1) stage.renderBlurred(t, o.fps, o.motionBlur.samples, o.motionBlur.shutter);
      else stage.renderAt(t);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i / o.fps) * 1e6), duration: Math.round(1e6 / o.fps), alpha: o.alpha ? 'keep' : 'discard' });
      venc.encode(frame, { keyFrame: i % Math.round(o.fps * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
      if (i % 3 === 0) {
        const ms = (performance.now() - started) / (i + 1);
        o.onProgress?.({ frame: i + 1, frames, eta: (ms * (frames - i - 1)) / 1000, msPerFrame: ms });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await venc.flush(); venc.close();
    if (err) throw err;
    muxer.finalize();
    const buffer = (target as Mp4Target).buffer;
    const blob = new Blob([buffer], { type: isMp4 ? 'video/mp4' : 'video/webm' });
    const base = (app.state.settings.title || song.name).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'lyric-video';
    return { blob, videoCodec: v.codec, audioCodec: au?.codec ?? 'none', frames, width: w, height: h, seconds, lufs, fileName: `${base}-${aspect.replace(':', 'x')}-${h}p.${o.format}` };
  } finally {
    stage.forcedSize = prev.forced; stage.fps = prev.fps;
    app.state.settings.aspect = prev.aspect; app.state.settings.transparentBackground = prev.transparent;
    await stage.prepare();
    app.exporting = false;
    try { await wake?.release(); } catch { /* */ }
  }
}

/** Real-time fallback without WebCodecs: MediaRecorder on canvas.captureStream + the audio. */
export async function recordRealtime(app: App, start: number, end: number, fps = 30, onProgress?: (p: number) => void): Promise<Blob> {
  const canvas = app.stage.canvas as HTMLCanvasElement;
  const stream = canvas.captureStream(fps);
  const dest = app.player.ctx.createMediaStreamDestination();
  const src = app.player.ctx.createBufferSource();
  src.buffer = app.song!.audio;
  src.connect(dest);
  for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
  const rec = new MediaRecorder(stream, { videoBitsPerSecond: 12e6 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((res) => { rec.onstop = () => res(); });
  app.player.seek(start);
  rec.start(250);
  src.start(0, start, end - start);
  const t0 = performance.now();
  await new Promise<void>((res) => {
    const tick = () => {
      const t = start + (performance.now() - t0) / 1000;
      app.stage.renderAt(Math.min(end, t));
      onProgress?.((t - start) / (end - start));
      if (t >= end) res(); else requestAnimationFrame(tick);
    };
    app.exporting = true;
    tick();
  });
  rec.stop();
  await done;
  app.exporting = false;
  return new Blob(chunks, { type: rec.mimeType });
}

export function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

// Offline, frame-exact video export with WebCodecs (+ mp4-muxer / webm-muxer).
// Falls back to real-time MediaRecorder capture where WebCodecs is unavailable.
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';

export interface ExportOpts { width: number; height: number; fps: number; start: number; end: number; mbps: number; format: 'mp4' | 'webm' }
export interface ExportResult { blob: Blob; ext: string; videoCodec: string; audioCodec: string | null; frames: number; seconds: number }
export type Progress = (p: number, msg: string) => void;
export class Cancelled extends Error { constructor() { super('cancelled'); } }

const tick = () => new Promise<void>(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

async function pickVideo(o: ExportOpts): Promise<{ cfg: VideoEncoderConfig; mux: string } | null> {
  const base = { width: o.width, height: o.height, bitrate: Math.round(o.mbps * 1e6), framerate: o.fps, latencyMode: 'quality' as const };
  const cands: [string, string][] = o.format === 'mp4'
    ? [['avc1.640033', 'avc'], ['avc1.640028', 'avc'], ['avc1.4d0033', 'avc'], ['avc1.42e033', 'avc'], ['vp09.00.41.08', 'vp9'], ['av01.0.09M.08', 'av1']]
    : [['vp09.00.41.08', 'V_VP9'], ['vp8', 'V_VP8'], ['av01.0.09M.08', 'V_AV1']];
  for (const [codec, mux] of cands) {
    const cfg: VideoEncoderConfig = { ...base, codec, ...(codec.startsWith('avc') ? { avc: { format: 'avc' } } : {}) } as VideoEncoderConfig;
    try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) return { cfg, mux }; } catch { /* try next */ }
  }
  return null;
}

async function pickAudio(fmt: ExportOpts['format'], ch: number): Promise<{ cfg: AudioEncoderConfig; mux: string } | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  const cands: [string, string][] = fmt === 'mp4' ? [['mp4a.40.2', 'aac'], ['opus', 'opus']] : [['opus', 'A_OPUS']];
  for (const [codec, mux] of cands) {
    const cfg: AudioEncoderConfig = { codec, sampleRate: 48000, numberOfChannels: ch, bitrate: 192000 };
    try { const s = await AudioEncoder.isConfigSupported(cfg); if (s.supported) return { cfg, mux }; } catch { /* */ }
  }
  return null;
}

/** Resample the export range to 48 kHz stereo. */
async function renderAudio(buf: AudioBuffer, start: number, end: number): Promise<AudioBuffer> {
  const ch = Math.min(2, buf.numberOfChannels), len = Math.ceil((end - start) * 48000);
  const oc = new OfflineAudioContext(ch, Math.max(1, len), 48000);
  const s = oc.createBufferSource(); s.buffer = buf; s.connect(oc.destination); s.start(0, start, end - start);
  return await oc.startRendering();
}

export function webCodecsAvailable() { return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'; }

export async function exportVideo(canvas: HTMLCanvasElement, renderAt: (t: number) => void, audio: AudioBuffer | null, o: ExportOpts, onProgress: Progress, cancel: { cancelled: boolean }): Promise<ExportResult> {
  const v = await pickVideo(o);
  if (!v) throw new Error('No supported video encoder for this format in this browser. Try the other format.');
  const nCh = audio ? Math.min(2, audio.numberOfChannels) : 0;
  const a = audio ? await pickAudio(o.format, nCh) : null;
  const isMp4 = o.format === 'mp4';
  const target = isMp4 ? new Mp4Target() : new WebmTarget();
  const muxer: Mp4Muxer<Mp4Target> | WebmMuxer<WebmTarget> = isMp4
    ? new Mp4Muxer({ target: target as Mp4Target, video: { codec: v.mux as 'avc', width: o.width, height: o.height, frameRate: o.fps }, ...(a ? { audio: { codec: a.mux as 'aac', numberOfChannels: nCh, sampleRate: 48000 } } : {}), fastStart: 'in-memory', firstTimestampBehavior: 'offset' })
    : new WebmMuxer({ target: target as WebmTarget, video: { codec: v.mux, width: o.width, height: o.height, frameRate: o.fps }, ...(a ? { audio: { codec: a.mux, numberOfChannels: nCh, sampleRate: 48000 } } : {}), firstTimestampBehavior: 'offset' });
  let err: Error | null = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { err = e as Error; } });
  venc.configure(v.cfg);

  // audio first (fast)
  if (a && audio) {
    onProgress(0, 'Encoding audio…');
    const ab = await renderAudio(audio, o.start, o.end);
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { err = e as Error; } });
    aenc.configure(a.cfg);
    const CH = 4800, chans = Array.from({ length: nCh }, (_, c) => ab.getChannelData(Math.min(c, ab.numberOfChannels - 1)));
    for (let i = 0; i < ab.length; i += CH) {
      const n = Math.min(CH, ab.length - i), data = new Float32Array(n * nCh);
      for (let c = 0; c < nCh; c++) data.set(chans[c].subarray(i, i + n), c * n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: nCh, timestamp: Math.round(i / 48000 * 1e6), data });
      aenc.encode(ad); ad.close();
      if (aenc.encodeQueueSize > 20) await tick();
    }
    await aenc.flush(); aenc.close();
  }

  const N = Math.max(1, Math.round((o.end - o.start) * o.fps)), t0 = performance.now();
  for (let i = 0; i < N; i++) {
    if (cancel.cancelled) { venc.close(); throw new Cancelled(); }
    if (err) throw err;
    renderAt(o.start + i / o.fps);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / o.fps), duration: Math.round(1e6 / o.fps) });
    venc.encode(vf, { keyFrame: i % (o.fps * 2) === 0 }); vf.close();
    while (venc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 2));
    if (i % 3 === 0) {
      const el = (performance.now() - t0) / 1000, eta = el / (i + 1) * (N - i - 1);
      onProgress((i + 1) / N, `Rendering frame ${i + 1} / ${N} · ${eta < 90 ? Math.ceil(eta) + ' s' : Math.ceil(eta / 60) + ' min'} left`);
      await tick();
    }
  }
  await venc.flush(); venc.close();
  if (err) throw err;
  muxer.finalize();
  const buf = (target as Mp4Target | WebmTarget).buffer;
  return { blob: new Blob([buf], { type: isMp4 ? 'video/mp4' : 'video/webm' }), ext: isMp4 ? 'mp4' : 'webm', videoCodec: v.cfg.codec, audioCodec: a?.cfg.codec ?? null, frames: N, seconds: (performance.now() - t0) / 1000 };
}

/** Real-time fallback: plays the song and records the canvas + audio. */
export async function recordRealtime(canvas: HTMLCanvasElement, renderAt: (t: number) => void, audio: AudioBuffer, o: ExportOpts, onProgress: Progress, cancel: { cancelled: boolean }): Promise<ExportResult> {
  const ac = new AudioContext(); const dest = ac.createMediaStreamDestination();
  const src = ac.createBufferSource(); src.buffer = audio; src.connect(dest); src.connect(ac.destination);
  const stream = new MediaStream([...canvas.captureStream(o.fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) ?? '';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: o.mbps * 1e6 });
  const parts: Blob[] = []; rec.ondataavailable = e => parts.push(e.data);
  const done = new Promise<void>(r => { rec.onstop = () => r(); });
  rec.start(250); const when = ac.currentTime + 0.05; src.start(when, o.start, o.end - o.start);
  const t0 = performance.now();
  await new Promise<void>(res => {
    const loop = () => {
      const t = o.start + Math.max(0, ac.currentTime - when);
      if (cancel.cancelled || t >= o.end) { res(); return; }
      renderAt(t); onProgress((t - o.start) / (o.end - o.start), 'Recording in real time…'); requestAnimationFrame(loop);
    };
    loop();
  });
  rec.stop(); src.stop(); await done; await ac.close();
  if (cancel.cancelled) throw new Cancelled();
  return { blob: new Blob(parts, { type: 'video/webm' }), ext: 'webm', videoCodec: mime, audioCodec: 'opus', frames: 0, seconds: (performance.now() - t0) / 1000 };
}

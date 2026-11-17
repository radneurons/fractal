/** WebCodecs encoding (browser only): H.264 in MP4, falling back to VP9 in WebM, else null (caller writes a PNG sequence). */
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';
import type { VideoSink } from './package';

const CANDIDATES = [{ codec: 'avc1.640033', kind: 'mp4' as const }, { codec: 'avc1.42E01F', kind: 'mp4' as const }, { codec: 'vp09.00.40.08', kind: 'webm' as const }, { codec: 'vp8', kind: 'webm' as const }];
export async function pickCodec(width: number, height: number, fps: number) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const c of CANDIDATES) { try { const s = await VideoEncoder.isConfigSupported({ codec: c.codec, width, height, framerate: fps, bitrate: 8e6 }); if (s.supported) return c; } catch { /* next */ } }
  return null;
}
export interface SinkAudio { sampleRate: number; channels: Float32Array[] }
async function pickAudio(kind: 'mp4' | 'webm', a: SinkAudio): Promise<{ codec: string; mux: 'aac' | 'opus' } | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const c of kind === 'mp4' ? [{ codec: 'mp4a.40.2', mux: 'aac' as const }, { codec: 'opus', mux: 'opus' as const }] : [{ codec: 'opus', mux: 'opus' as const }]) { try { if ((await AudioEncoder.isConfigSupported({ codec: c.codec, sampleRate: a.sampleRate, numberOfChannels: a.channels.length, bitrate: 160000 })).supported) return c; } catch { /* next */ } }
  return null;
}
/** `audio` (optional): already-mixed PCM for the whole clip; it is encoded interleaved with the video frames. */
export async function createVideoSink(width: number, height: number, fps: number, bitrate = Math.round(width * height * fps * 0.12), audio?: SinkAudio): Promise<VideoSink | null> {
  const pick = await pickCodec(width, height, fps); if (!pick) return null;
  const ac = audio ? await pickAudio(pick.kind, audio) : null, nch = audio?.channels.length ?? 0;
  const mp4 = pick.kind === 'mp4' ? new Mp4Muxer({ target: new Mp4Target(), video: { codec: 'avc', width, height }, ...(ac && audio ? { audio: { codec: ac.mux, numberOfChannels: nch, sampleRate: audio.sampleRate } } : {}), fastStart: 'in-memory', firstTimestampBehavior: 'offset' }) : null;
  const webm = pick.kind === 'webm' ? new WebmMuxer({ target: new WebmTarget(), video: { codec: pick.codec === 'vp8' ? 'V_VP8' : 'V_VP9', width, height, frameRate: fps }, ...(ac && audio ? { audio: { codec: 'A_OPUS', numberOfChannels: nch, sampleRate: audio.sampleRate } } : {}), firstTimestampBehavior: 'offset' }) : null;
  let err: Error | null = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => { mp4 ? mp4.addVideoChunk(chunk, meta) : webm!.addVideoChunk(chunk, meta); }, error: (e) => { err = e; } });
  enc.configure({ codec: pick.codec, width, height, framerate: fps, bitrate, latencyMode: 'quality' });
  let aenc: AudioEncoder | null = null, aPos = 0; const BLOCK = 1024;
  if (ac && audio) { aenc = new AudioEncoder({ output: (chunk, meta) => { mp4 ? mp4.addAudioChunk(chunk, meta) : webm!.addAudioChunk(chunk, meta); }, error: (e) => { err = e; } }); aenc.configure({ codec: ac.codec, sampleRate: audio.sampleRate, numberOfChannels: nch, bitrate: 160000 }); }
  const pumpAudio = (until: number) => { if (!aenc || !audio) return; const total = audio.channels[0].length, end = Math.min(total, Math.round(until * audio.sampleRate));
    while (aPos < end) { const n = Math.min(BLOCK, total - aPos), planar = new Float32Array(n * nch); for (let c = 0; c < nch; c++) planar.set(audio.channels[c].subarray(aPos, aPos + n), c * n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: audio.sampleRate, numberOfFrames: n, numberOfChannels: nch, timestamp: Math.round((aPos / audio.sampleRate) * 1e6), data: planar }); aenc.encode(ad); ad.close(); aPos += n; } };
  return {
    async add(source, frame) {
      if (err) throw err; const timestamp = Math.round((frame * 1e6) / fps), duration = Math.round(1e6 / fps);
      const vf = source instanceof Uint8ClampedArray || source instanceof Uint8Array ? new VideoFrame(source as Uint8Array<ArrayBuffer>, { format: 'RGBA', codedWidth: width, codedHeight: height, timestamp, duration }) : new VideoFrame(source as CanvasImageSource, { timestamp, duration });
      pumpAudio((frame + 1) / fps); enc.encode(vf, { keyFrame: frame % (fps * 2) === 0 }); vf.close();
      while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
    },
    audioCodec: ac?.codec ?? null,
    async finish() { await enc.flush(); enc.close(); if (aenc) { pumpAudio(Infinity); await aenc.flush(); aenc.close(); } if (err) throw err; if (mp4) { mp4.finalize(); return { ext: 'mp4', bytes: new Uint8Array(mp4.target.buffer), codec: pick.codec }; } webm!.finalize(); return { ext: 'webm', bytes: new Uint8Array(webm!.target.buffer), codec: pick.codec }; },
  };
}

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
export async function createVideoSink(width: number, height: number, fps: number, bitrate = Math.round(width * height * fps * 0.12)): Promise<VideoSink | null> {
  const pick = await pickCodec(width, height, fps); if (!pick) return null;
  const mp4 = pick.kind === 'mp4' ? new Mp4Muxer({ target: new Mp4Target(), video: { codec: 'avc', width, height }, fastStart: 'in-memory' }) : null;
  const webm = pick.kind === 'webm' ? new WebmMuxer({ target: new WebmTarget(), video: { codec: pick.codec === 'vp8' ? 'V_VP8' : 'V_VP9', width, height, frameRate: fps } }) : null;
  let err: Error | null = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => { mp4 ? mp4.addVideoChunk(chunk, meta) : webm!.addVideoChunk(chunk, meta); }, error: (e) => { err = e; } });
  enc.configure({ codec: pick.codec, width, height, framerate: fps, bitrate, latencyMode: 'quality' });
  return {
    async add(source, frame) {
      if (err) throw err; const timestamp = Math.round((frame * 1e6) / fps), duration = Math.round(1e6 / fps);
      const vf = source instanceof Uint8ClampedArray || source instanceof Uint8Array ? new VideoFrame(source as Uint8Array<ArrayBuffer>, { format: 'RGBA', codedWidth: width, codedHeight: height, timestamp, duration }) : new VideoFrame(source as CanvasImageSource, { timestamp, duration });
      enc.encode(vf, { keyFrame: frame % (fps * 2) === 0 }); vf.close();
      while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
    },
    async finish() { await enc.flush(); enc.close(); if (err) throw err; if (mp4) { mp4.finalize(); return { ext: 'mp4', bytes: new Uint8Array(mp4.target.buffer), codec: pick.codec }; } webm!.finalize(); return { ext: 'webm', bytes: new Uint8Array(webm!.target.buffer), codec: pick.codec }; },
  };
}

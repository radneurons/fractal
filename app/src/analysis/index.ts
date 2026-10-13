import type { Analysis } from '../types';

/** Decode an audio file and analyse it in a worker. */
export async function decodeAudio(file: ArrayBuffer, ctx: BaseAudioContext): Promise<AudioBuffer> {
  return await ctx.decodeAudioData(file.slice(0));
}

export function monoMix(buf: AudioBuffer): Float32Array {
  const n = buf.length, out = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / buf.numberOfChannels; }
  return out;
}

export function analyzeInWorker(buf: AudioBuffer, onProgress: (stage: string, p: number) => void): Promise<Analysis> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const pcm = monoMix(buf);
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.stage, m.p);
      else if (m.type === 'done') { w.terminate(); resolve(m.analysis as Analysis); }
      else if (m.type === 'error') { w.terminate(); reject(new Error(m.message)); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
    w.postMessage({ pcm, sampleRate: buf.sampleRate }, [pcm.buffer]);
  });
}

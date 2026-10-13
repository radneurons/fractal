// Analysis worker: receives mono PCM, returns an Analysis (all arrays transferred).
import { analyze } from './dsp';

self.onmessage = (e: MessageEvent<{ pcm: Float32Array; sampleRate: number }>) => {
  const { pcm, sampleRate } = e.data;
  try {
    const a = analyze(pcm, sampleRate, (stage, p) => (self as unknown as Worker).postMessage({ type: 'progress', stage, p }));
    const transfer: ArrayBuffer[] = [a.loud.buffer, a.rmsDb.buffer, a.centroid.buffer, a.flux.buffer, a.peaks.buffer,
      ...Object.values(a.bands).map((b: Float32Array) => b.buffer as ArrayBuffer)] as ArrayBuffer[];
    (self as unknown as Worker).postMessage({ type: 'done', analysis: a }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: String((err as Error)?.stack || err) });
  }
};

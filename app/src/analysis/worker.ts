// Analysis Web Worker: all DSP off the main thread, progress reported in stages.
import { analyze, analysisTransferables, type AudioInput } from './index.ts';

self.onmessage = (e: MessageEvent<{ id: number; input: AudioInput }>) => {
  const { id, input } = e.data;
  try {
    const a = analyze(input, (stage, p) => (self as unknown as Worker).postMessage({ id, type: 'progress', stage, p }));
    (self as unknown as Worker).postMessage({ id, type: 'done', analysis: a }, analysisTransferables(a));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, type: 'error', message: String((err as Error)?.message ?? err) });
  }
};

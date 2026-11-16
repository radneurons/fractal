// Whisper in a worker via transformers.js (SPEC §5 Auto-sync). WebGPU when an adapter exists, else WASM.
// Models download once from huggingface.co and are cached by the browser.
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

env.allowLocalModels = false;
let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loaded = '';

self.onmessage = async (e: MessageEvent<{ id: number; audio: Float32Array; model: string; language?: string }>) => {
  const { id, audio, model, language } = e.data;
  const post = (m: Record<string, unknown>) => (self as unknown as Worker).postMessage({ id, ...m });
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const device = gpu && (await gpu.requestAdapter().catch(() => null)) ? 'webgpu' : 'wasm';
    if (!asr || loaded !== model) {
      post({ type: 'status', message: `Loading ${model} (${device})…`, p: 0 });
      const progress_callback = (p: { status?: string; progress?: number; file?: string }) => { if (p.status === 'progress') post({ type: 'status', message: `Downloading ${p.file ?? 'model'}`, p: (p.progress ?? 0) / 100 }); };
      try { asr = (await pipeline('automatic-speech-recognition', model, { device, revision: 'output_attentions', progress_callback } as never)) as unknown as AutomaticSpeechRecognitionPipeline; }
      catch { asr = (await pipeline('automatic-speech-recognition', model, { device, progress_callback } as never)) as unknown as AutomaticSpeechRecognitionPipeline; }
      loaded = model;
    }
    post({ type: 'status', message: 'Listening…', p: 0.5 });
    const base = { chunk_length_s: 30, stride_length_s: 5, ...(language && !model.endsWith('.en') ? { language, task: 'transcribe' } : {}) };
    let mode = 'word';
    let out: { chunks?: { text: string; timestamp: [number, number | null] }[] };
    try { out = (await asr(audio, { ...base, return_timestamps: 'word' } as never)) as never; }
    catch { mode = 'phrase'; out = (await asr(audio, { ...base, return_timestamps: true } as never)) as never; }
    const words = (out.chunks ?? []).map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + (mode === 'word' ? 0.3 : 2) }));
    post({ type: 'done', words, mode });
  } catch (err) {
    post({ type: 'error', message: String((err as Error)?.message ?? err) });
  }
};

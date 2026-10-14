// Speech recognition worker: Whisper via transformers.js (WebGPU when available, else WASM).
// The model downloads once from huggingface.co and is cached by the browser.
// In:  { audio: Float32Array (16 kHz mono), model: string, language: string | null }
// Out: { type: 'progress', stage: 'download' | 'listen', p, file? } · { type: 'done', chunks, level, text } · { type: 'error', message }
type Msg = { audio: Float32Array; model: string; language: string | null };
type Chunk = { text: string; timestamp: [number, number | null] };
type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: Chunk[] }>;

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
let asr: Asr | null = null, loadedKey = '';

self.onmessage = async (e: MessageEvent<Msg>) => {
  const { audio, model, language } = e.data;
  try {
    const tf = await import('@huggingface/transformers');
    tf.env.allowLocalModels = false;
    const files = new Map<string, { loaded: number; total: number }>();
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let l = 0, t = 0; for (const f of files.values()) { l += f.loaded; t += f.total; }
      post({ type: 'progress', stage: 'download', p: t ? l / t : 0, loaded: l, total: t });
    };
    const key = model;
    if (!asr || loadedKey !== key) {
      const make = (device: 'webgpu' | 'wasm') => tf.pipeline('automatic-speech-recognition', model, { device, progress_callback } as never) as unknown as Promise<Asr>;
      const hasGpu = 'gpu' in navigator && !!(await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
      asr = hasGpu ? await make('webgpu').catch(() => make('wasm')) : await make('wasm');
      loadedKey = key;
    }
    post({ type: 'progress', stage: 'listen', p: -1 });
    const english = /\.en$/.test(model);
    const opts: Record<string, unknown> = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: 'word', ...(language && !english ? { language, task: 'transcribe' } : {}) };
    let level: 'word' | 'phrase' = 'word', out;
    try { out = await asr(audio, opts); }
    catch { level = 'phrase'; out = await asr(audio, { ...opts, return_timestamps: true }); }   // model without word-timing heads
    const chunks = (out.chunks ?? []).map(c => ({ text: c.text, start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? (c.timestamp[0] ?? 0) + .5 }));
    post({ type: 'done', chunks, level, text: out.text });
  } catch (err) {
    post({ type: 'error', message: String((err as Error)?.message ?? err) });
  }
};

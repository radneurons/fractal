// Auto-sync front end: resample → Whisper worker → alignment.
import type { Analysis, Lyrics } from '../types.ts';
import { alignToRecognised, phrasesToWords, findDeafSpans, mergeRetry, type AlignResult, type RecWord } from './align.ts';
import { countSyllables } from '../lyrics/syllables.ts';
import { syllablePeriod } from '../lyrics/build.ts';

export const WHISPER_MODELS = [
  { id: 'Xenova/whisper-tiny.en', label: 'Tiny (English, ~40 MB)' }, { id: 'Xenova/whisper-base.en', label: 'Base (English, ~80 MB)' },
  { id: 'Xenova/whisper-small.en', label: 'Small (English, ~250 MB)' }, { id: 'Xenova/whisper-base', label: 'Base (multilingual)' }, { id: 'Xenova/whisper-small', label: 'Small (multilingual)' },
];

/** 16 kHz mono with a 100 Hz high-pass and a 7 kHz low-pass. */
export async function prepareForAsr(audio: AudioBuffer): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000);
  const src = ctx.createBufferSource();
  src.buffer = audio;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 100;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
  src.connect(hp); hp.connect(lp); lp.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0).slice();
}

/** Can this page reach the model host? (hosted previews often cannot) */
export async function canReachModels(): Promise<boolean> {
  try { const r = await fetch('https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json', { method: 'HEAD' }); return r.ok; } catch { return false; }
}

let worker: Worker | null = null;
let seq = 0;
export function transcribe(pcm: Float32Array, model: string, language: string | undefined, onStatus: (msg: string, p: number) => void, signal?: AbortSignal): Promise<{ words: RecWord[]; mode: 'word' | 'phrase' }> {
  worker ??= new Worker(new URL('./whisperWorker.ts', import.meta.url), { type: 'module' });
  const id = ++seq, w = worker;
  return new Promise((resolve, reject) => {
    const on = (e: MessageEvent) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'status') onStatus(m.message, m.p);
      else { w.removeEventListener('message', on); if (m.type === 'done') resolve({ words: m.words, mode: m.mode }); else reject(new Error(m.message)); }
    };
    w.addEventListener('message', on);
    signal?.addEventListener('abort', () => { w.removeEventListener('message', on); w.terminate(); worker = null; reject(new DOMException('cancelled', 'AbortError')); });
    w.postMessage({ id, audio: pcm, model, language }, [pcm.buffer]);
  });
}

export async function autoSync(audio: AudioBuffer, ly: Lyrics, a: Analysis, model: string, language: string | undefined, onStatus: (msg: string, p: number) => void, signal?: AbortSignal): Promise<AlignResult & { mode: string }> {
  const pcm = await prepareForAsr(audio);
  const pcmKeep = pcm.slice(); // transcribe() transfers its buffer to the worker
  const rec = await transcribe(pcm, model, language, onStatus, signal);
  // a second pass over long sung stretches the recogniser returned nothing for (each on its own, ≤ 120 s)
  if (rec.mode === 'word') {
    const spans = findDeafSpans(rec.words, a.vocal, a.fps, a.duration).slice(0, 6);
    for (const [k, sp] of spans.entries()) {
      const s0 = sp[0], s1 = Math.min(sp[1], sp[0] + 120);
      onStatus(`Listening again to ${Math.round(s0)}–${Math.round(s1)} s (${k + 1}/${spans.length})`, 0.9);
      const part = await transcribe(pcmKeep.slice(Math.floor(s0 * 16000), Math.floor(s1 * 16000)), model, language, () => {}, signal);
      rec.words = mergeRetry(rec.words, part.words.map((w) => ({ ...w, start: w.start + s0, end: w.end + s0 })), [s0, s1]);
    }
  }
  const words = rec.mode === 'word' ? rec.words : phrasesToWords(rec.words, countSyllables, syllablePeriod(a));
  const res = alignToRecognised(ly, words, a, { approx: rec.mode !== 'word' });
  return { ...res, mode: rec.mode };
}

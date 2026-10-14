// Auto-sync front end: prepare the audio, run Whisper in a worker, align the user's lyrics to it.
import type { AsrChunk } from './align';

export const ASR_MODELS: { id: string; label: string }[] = [
  { id: 'Xenova/whisper-tiny.en', label: 'English · fast (≈40 MB)' },
  { id: 'Xenova/whisper-base.en', label: 'English · better (≈80 MB)' },
  { id: 'Xenova/whisper-small.en', label: 'English · best, slow (≈250 MB)' },
  { id: 'Xenova/whisper-base', label: 'Any language (≈80 MB)' },
  { id: 'Xenova/whisper-small', label: 'Any language · best, slow (≈250 MB)' }
];
export const ASR_LANGS: [string, string][] = [['', 'Detect automatically'], ['english', 'English'], ['spanish', 'Spanish'], ['french', 'French'], ['german', 'German'], ['portuguese', 'Portuguese'], ['italian', 'Italian'], ['dutch', 'Dutch'], ['japanese', 'Japanese'], ['korean', 'Korean'], ['chinese', 'Chinese'], ['russian', 'Russian'], ['arabic', 'Arabic'], ['hindi', 'Hindi'], ['turkish', 'Turkish'], ['polish', 'Polish'], ['swedish', 'Swedish']];

/** 16 kHz mono with the band outside the voice (rumble, cymbals) turned down. */
export async function voice16k(buf: AudioBuffer): Promise<Float32Array> {
  const sr = 16000, oc = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * sr)), sr);
  const src = oc.createBufferSource(); src.buffer = buf;
  const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 100;
  const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
  src.connect(hp).connect(lp).connect(oc.destination); src.start();
  return (await oc.startRendering()).getChannelData(0).slice();
}

export interface TranscribeResult { chunks: AsrChunk[]; level: 'word' | 'phrase'; text: string }
export function transcribe(audio: Float32Array, model: string, language: string | null, onProgress: (stage: 'download' | 'listen', p: number, info?: { loaded: number; total: number }) => void, cancel: { cancelled: boolean; abort?: () => void }): Promise<TranscribeResult> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./whisperWorker.ts', import.meta.url), { type: 'module' });
    cancel.abort = () => { w.terminate(); reject(new Error('cancelled')); };
    w.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.stage, m.p, m.total ? { loaded: m.loaded, total: m.total } : undefined);
      else if (m.type === 'done') { w.terminate(); resolve({ chunks: m.chunks, level: m.level, text: m.text }); }
      else if (m.type === 'error') { w.terminate(); reject(new Error(m.message)); }
    };
    w.onerror = e => { w.terminate(); reject(new Error(e.message || 'speech recognition failed to start')); };
    w.postMessage({ audio, model, language }, [audio.buffer]);
  });
}

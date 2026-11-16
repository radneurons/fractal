// Main-thread side of the analysis worker, with an IndexedDB cache keyed by the audio's SHA-256.
import type { Analysis } from '../types.ts';
import { ANALYSIS_VERSION } from './index.ts';
import { idbGet, idbSet } from '../project/idb.ts';

let worker: Worker | null = null;
let seq = 0;

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface AnalyseOpts { hash?: string; stemHashes?: string[]; vocals?: AudioBuffer | null; onProgress?: (stage: string, p: number) => void; signal?: AbortSignal }

export async function analyseBuffer(audio: AudioBuffer, opts: AnalyseOpts = {}): Promise<Analysis> {
  const key = opts.hash ? `v${ANALYSIS_VERSION}:${opts.hash}${opts.stemHashes?.length ? ':' + opts.stemHashes.join(',') : ''}` : '';
  if (key) {
    try { const hit = await idbGet<Analysis>('analysis', key); if (hit && hit.version === ANALYSIS_VERSION) return hit; } catch { /* cache unavailable */ }
  }
  const channels: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) channels.push(audio.getChannelData(c).slice());
  const input = {
    sampleRate: audio.sampleRate, channels,
    stems: opts.vocals ? { vocals: { sampleRate: opts.vocals.sampleRate, channels: [opts.vocals.getChannelData(0).slice()] } } : undefined,
  };
  worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  const w = worker;
  const result = await new Promise<Analysis>((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'progress') opts.onProgress?.(m.stage, m.p);
      else { w.removeEventListener('message', onMsg); if (m.type === 'done') resolve(m.analysis); else reject(new Error(m.message)); }
    };
    w.addEventListener('message', onMsg);
    opts.signal?.addEventListener('abort', () => { w.removeEventListener('message', onMsg); w.terminate(); worker = null; reject(new DOMException('cancelled', 'AbortError')); });
    w.postMessage({ id, input }, channels.map((c) => c.buffer as ArrayBuffer));
  });
  if (key) { try { await idbSet('analysis', key, result); } catch { /* quota */ } }
  return result;
}

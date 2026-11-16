// Whisper word timestamps in Node (same model family the app's Auto-sync uses).
//   node scripts/tools/transcribe.mjs song.mp3 out.json [model]
import { pipeline, env } from '@huggingface/transformers';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [, , input, output, model = 'Xenova/whisper-small.en'] = process.argv;
env.cacheDir = new URL('../../.cache/hf', import.meta.url).pathname;
// 16 kHz mono, high-pass 100 Hz, low-pass 7 kHz (as in the app)
const r = spawnSync('ffmpeg', ['-v', 'error', '-i', input, '-map', '0:a:0', '-af', 'highpass=f=100,lowpass=f=7000', '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'], { maxBuffer: 1 << 30 });
if (r.status !== 0) throw new Error(r.stderr.toString());
const audio = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength >> 2).slice();
console.log(`audio ${(audio.length / 16000).toFixed(1)} s, model ${model}`);
let asr, words = null, mode = 'word';
const t0 = Date.now();
try {
  asr = await pipeline('automatic-speech-recognition', model, { revision: 'output_attentions', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' } });
  const out = await asr(audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: 'word' });
  words = out.chunks.map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 }));
} catch (e) {
  console.log('word timestamps unavailable (' + String(e.message).slice(0, 120) + '); falling back to phrases');
  mode = 'phrase';
  asr = await pipeline('automatic-speech-recognition', model);
  const out = await asr(audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
  words = out.chunks.map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 2 }));
}
writeFileSync(output, JSON.stringify({ model, mode, words }, null, 1));
console.log(`${words.length} ${mode}s in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${output}`);

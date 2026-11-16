// Node-side audio loading for tests and tools.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export interface Pcm { sampleRate: number; channels: Float32Array[] }

export function readWav(path: string): Pcm {
  const b = readFileSync(path);
  let o = 12, fmt = { ch: 2, sr: 44100, bits: 16, float: false }, dataOff = -1, dataLen = 0;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), len = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22), float: b.readUInt16LE(o + 8) === 3 };
    if (id === 'data') { dataOff = o + 8; dataLen = Math.min(len, b.length - dataOff); break; }
    o += 8 + len + (len & 1);
  }
  if (dataOff < 0) throw new Error('no data chunk in ' + path);
  const bytes = fmt.bits / 8, n = Math.floor(dataLen / (bytes * fmt.ch));
  const channels = Array.from({ length: fmt.ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.ch; c++) {
    const p = dataOff + (i * fmt.ch + c) * bytes;
    channels[c][i] = fmt.float ? b.readFloatLE(p) : fmt.bits === 16 ? b.readInt16LE(p) / 32768 : fmt.bits === 24 ? b.readIntLE(p, 3) / 8388608 : b.readInt32LE(p) / 2147483648;
  }
  return { sampleRate: fmt.sr, channels };
}

/** Decode any file with ffmpeg (tools only; the app uses decodeAudioData). */
export function decodeFile(path: string, sampleRate = 44100): Pcm {
  if (path.toLowerCase().endsWith('.wav')) return readWav(path);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:a:0', '-f', 'f32le', '-ac', '2', '-ar', String(sampleRate), '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr.toString());
  const f = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength / 4));
  const n = Math.floor(f.length / 2);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = f[i * 2]; R[i] = f[i * 2 + 1]; }
  return { sampleRate, channels: [L, R] };
}

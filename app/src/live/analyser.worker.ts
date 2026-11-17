// Live analysis worker (SPEC §14.2): audio arrives from the AudioWorklet either through a SharedArrayBuffer ring
// (when cross-origin isolated) or as transferred chunks on a MessagePort. Reports go to the main thread at ~60 Hz.
import { OnlineAnalyser } from '../analysis/online.ts';

let an: OnlineAnalyser | null = null;
let ring: { data: Float32Array; idx: Int32Array; read: number } | null = null;
let lastReport = 0;

function report(): void {
  if (!an) return;
  const now = performance.now();
  if (now - lastReport < 15) return;
  lastReport = now;
  (self as unknown as Worker).postMessage({ type: 'report', state: an.state(), delta: an.drain() });
}

function pump(): void {
  if (!an || !ring) return;
  const w = Atomics.load(ring.idx, 0), size = ring.data.length;
  let r = ring.read;
  if (w - r > size) r = w - size; // overrun: drop the oldest audio rather than fall behind
  while (r < w) {
    const a = r % size, n = Math.min(w - r, size - a);
    an.push(ring.data.subarray(a, a + n));
    r += n;
  }
  ring.read = r;
  report();
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') {
    an = new OnlineAnalyser(m.sampleRate);
    if (m.sab) { ring = { data: new Float32Array(m.sab.data), idx: new Int32Array(m.sab.idx), read: 0 }; setInterval(pump, 8); }
    if (m.port) (m.port as MessagePort).onmessage = (ev) => { an!.push(ev.data as Float32Array); report(); };
  }
};

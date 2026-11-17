// The live tap (SPEC §14.2): an AudioWorklet that mixes the input to mono and hands it to the analysis worker —
// through a SharedArrayBuffer ring when the page is cross-origin isolated, else as transferred chunks on a
// MessagePort straight to the worker (the main thread never touches audio). It also reports a peak level ~30×/s.
import type { OnlineState } from './types.ts';
import type { OnlineDelta } from './session.ts';

const PROCESSOR = `
class LiveTap extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = opts.processorOptions || {};
    this.ring = o.sab ? { data: new Float32Array(o.sab.data), idx: new Int32Array(o.sab.idx) } : null;
    this.port2 = null; this.batch = new Float32Array(512); this.bn = 0;
    this.peak = 0; this.blocks = 0;
    this.port.onmessage = (e) => { if (e.data && e.data.port) this.port2 = e.data.port; };
  }
  process(inputs) {
    const ch = inputs[0];
    if (!ch || !ch.length) return true;
    const n = ch[0].length;
    for (let i = 0; i < n; i++) {
      let v = 0; for (let c = 0; c < ch.length; c++) v += ch[c][i]; v /= ch.length;
      const a = v < 0 ? -v : v; if (a > this.peak) this.peak = a;
      if (this.ring) { const w = Atomics.load(this.ring.idx, 0); this.ring.data[w % this.ring.data.length] = v; Atomics.store(this.ring.idx, 0, w + 1); }
      else { this.batch[this.bn++] = v; if (this.bn === this.batch.length) { if (this.port2) { this.port2.postMessage(this.batch, [this.batch.buffer]); } this.batch = new Float32Array(512); this.bn = 0; } }
    }
    if (++this.blocks % 12 === 0) { this.port.postMessage({ level: this.peak }); this.peak = 0; }
    return true;
  }
}
registerProcessor('le-live-tap', LiveTap);
`;

export interface LiveTap {
  node: AudioWorkletNode;
  worker: Worker;
  /** 'sab' or 'port' */
  transport: 'sab' | 'port';
  stop(): void;
}

export async function startTap(ctx: AudioContext, source: AudioNode, on: { report(s: OnlineState, d: OnlineDelta): void; level(peak: number): void }): Promise<LiveTap> {
  const url = URL.createObjectURL(new Blob([PROCESSOR], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const worker = new Worker(new URL('./analyser.worker.ts', import.meta.url), { type: 'module' });
  const useSab = typeof SharedArrayBuffer !== 'undefined' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
  let node: AudioWorkletNode;
  if (useSab) {
    const sab = { data: new SharedArrayBuffer(4 * ctx.sampleRate * 2), idx: new SharedArrayBuffer(4) }; // 2 s ring
    node = new AudioWorkletNode(ctx, 'le-live-tap', { numberOfInputs: 1, numberOfOutputs: 1, processorOptions: { sab } });
    worker.postMessage({ type: 'init', sampleRate: ctx.sampleRate, sab });
  } else {
    node = new AudioWorkletNode(ctx, 'le-live-tap', { numberOfInputs: 1, numberOfOutputs: 1 });
    const ch = new MessageChannel();
    node.port.postMessage({ port: ch.port1 }, [ch.port1]);
    worker.postMessage({ type: 'init', sampleRate: ctx.sampleRate, port: ch.port2 }, [ch.port2]);
  }
  node.port.onmessage = (e) => { if (typeof e.data?.level === 'number') on.level(e.data.level); };
  worker.onmessage = (e) => { if (e.data?.type === 'report') on.report(e.data.state, e.data.delta); };
  // a node must reach the destination to be pulled reliably; the tap outputs silence through a muted gain
  const mute = ctx.createGain(); mute.gain.value = 0;
  source.connect(node); node.connect(mute).connect(ctx.destination);
  return { node, worker, transport: useSab ? 'sab' : 'port', stop: () => { try { source.disconnect(node); node.disconnect(); mute.disconnect(); } catch { /* already */ } node.port.close(); worker.terminate(); } };
}

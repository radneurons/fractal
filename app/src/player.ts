// Audio playback with a sample-accurate clock (AudioContext time), plus an optional click track.

export class Player {
  readonly ctx: AudioContext;
  private buf: AudioBuffer | null = null;
  private src: AudioBufferSourceNode | null = null;
  private t0 = 0;            // ctx.currentTime at song time 0
  private pausedAt = 0;
  playing = false;
  private gain: GainNode;
  private clicks: AudioBufferSourceNode[] = [];
  metronome = false;
  beats: number[] = []; downbeats: number[] = [];
  onEnded: () => void = () => {};

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.gain = this.ctx.createGain(); this.gain.connect(this.ctx.destination);
  }

  setBuffer(b: AudioBuffer) { this.stop(); this.buf = b; this.pausedAt = 0; }
  get duration() { return this.buf?.duration ?? 0; }

  /** Current song time in seconds (compensates output latency so visuals meet the ear). */
  now(): number {
    if (!this.playing) return this.pausedAt;
    const lat = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return Math.max(0, Math.min(this.duration, this.ctx.currentTime - this.t0 - lat));
  }

  async play(from = this.pausedAt) {
    if (!this.buf) return;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.stopSource();
    from = Math.max(0, Math.min(from, this.duration - 0.01));
    const s = this.ctx.createBufferSource(); s.buffer = this.buf; s.connect(this.gain);
    const when = this.ctx.currentTime + 0.03;
    s.start(when, from);
    this.t0 = when - from; this.src = s; this.playing = true;
    s.onended = () => { if (this.src === s) { this.playing = false; this.pausedAt = this.duration; this.onEnded(); } };
    if (this.metronome) this.scheduleClicks(from, when);
  }

  pause() { if (!this.playing) return; this.pausedAt = this.now(); this.stopSource(); this.playing = false; }
  stop() { this.stopSource(); this.playing = false; this.pausedAt = 0; }
  seek(t: number) { const was = this.playing; this.pausedAt = Math.max(0, Math.min(t, this.duration)); if (was) void this.play(this.pausedAt); }
  toggle() { if (this.playing) this.pause(); else void this.play(); }

  private stopSource() {
    if (this.src) { this.src.onended = null; try { this.src.stop(); } catch { /* already stopped */ } this.src.disconnect(); this.src = null; }
    for (const c of this.clicks) { try { c.stop(); } catch { /* */ } c.disconnect(); }
    this.clicks = [];
  }

  private clickBuf(hi: boolean) {
    const sr = this.ctx.sampleRate, n = Math.round(sr * 0.04), b = this.ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    const f = hi ? 1760 : 1100; for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-i / (sr * 0.008)) * 0.5;
    return b;
  }
  private scheduleClicks(from: number, when: number) {
    const hi = this.clickBuf(true), lo = this.clickBuf(false); const db = new Set(this.downbeats.map(x => x.toFixed(3)));
    for (const b of this.beats) {
      if (b < from) continue; if (b > from + 600) break;
      const s = this.ctx.createBufferSource(); s.buffer = db.has(b.toFixed(3)) ? hi : lo; s.connect(this.ctx.destination); s.start(when + (b - from)); this.clicks.push(s);
    }
  }
}

// Audio transport: sample-accurate clock, seeking, and an optional click track.
export class Player {
  readonly ctx: AudioContext;
  buffer: AudioBuffer | null = null;
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode;
  private clickGain: GainNode;
  private startedAt = 0;
  private offset = 0;
  playing = false;
  click = false;
  beats: number[] = [];
  downbeats: number[] = [];
  private clickTimer = 0;
  private clickIdx = 0;
  onState: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.clickGain = this.ctx.createGain();
    this.clickGain.gain.value = 0.5;
    this.clickGain.connect(this.ctx.destination);
  }
  get duration(): number { return this.buffer?.duration ?? 0; }
  get time(): number {
    if (!this.playing) return this.offset;
    return Math.min(this.duration, this.offset + (this.ctx.currentTime - this.startedAt));
  }
  setBuffer(b: AudioBuffer | null): void { this.pause(); this.buffer = b; this.offset = 0; }
  set volume(v: number) { this.gain.gain.value = v; }

  async play(): Promise<void> {
    if (!this.buffer || this.playing) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.offset >= this.duration - 0.02) this.offset = 0;
    const s = this.ctx.createBufferSource();
    s.buffer = this.buffer;
    s.connect(this.gain);
    this.startedAt = this.ctx.currentTime + 0.02;
    s.start(this.startedAt, this.offset);
    s.onended = () => { if (this.src === s && this.playing && this.time >= this.duration - 0.05) { this.playing = false; this.offset = this.duration; this.src = null; this.onState?.(); } };
    this.src = s;
    this.playing = true;
    this.scheduleClicks(true);
    this.onState?.();
  }
  pause(): void {
    if (!this.playing) return;
    this.offset = this.time;
    this.playing = false;
    try { this.src?.stop(); } catch { /* already stopped */ }
    this.src = null;
    clearTimeout(this.clickTimer);
    this.onState?.();
  }
  toggle(): void { if (this.playing) this.pause(); else void this.play(); }
  seek(t: number): void {
    const was = this.playing;
    if (was) this.pause();
    this.offset = Math.max(0, Math.min(this.duration, t));
    if (was) void this.play();
    else this.onState?.();
  }

  /** Scheduled clicks (high on downbeats), looked ahead 200 ms. */
  private scheduleClicks(reset = false): void {
    clearTimeout(this.clickTimer);
    if (!this.playing) return;
    if (reset) { this.clickIdx = 0; const t = this.time; while (this.clickIdx < this.beats.length && this.beats[this.clickIdx] < t) this.clickIdx++; }
    if (this.click) {
      const horizon = this.time + 0.2;
      while (this.clickIdx < this.beats.length && this.beats[this.clickIdx] < horizon) {
        const bt = this.beats[this.clickIdx++];
        const when = this.startedAt + (bt - this.offset);
        if (when < this.ctx.currentTime) continue;
        const down = this.downbeats.some((d) => Math.abs(d - bt) < 0.03);
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.frequency.value = down ? 1760 : 1100;
        g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(0.6, when + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
        o.connect(g); g.connect(this.clickGain);
        o.start(when); o.stop(when + 0.06);
      }
    }
    this.clickTimer = window.setTimeout(() => this.scheduleClicks(), 60);
  }
}

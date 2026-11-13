// Subtle synthesized UI sounds (off by default; enable in Settings).
let ctx: AudioContext | null = null;
export function sfx(kind: 'good' | 'bad' | 'tap' | 'level') {
  try {
    ctx ??= new AudioContext();
    const notes = { good: [660, 880], bad: [300, 220], tap: [520], level: [523, 659, 784] }[kind];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = ctx!.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(ctx!.destination);
      o.start(t);
      o.stop(t + 0.2);
    });
  } catch {
    /* audio unavailable */
  }
}

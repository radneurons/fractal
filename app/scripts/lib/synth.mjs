// Shared synthesis for the demo fixtures and the in-memory robustness recordings. Deterministic.
import { writeFileSync } from 'node:fs';

export const SR = 44100;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

export class Mix {
  constructor(seconds) { this.n = Math.ceil(seconds * SR); this.L = new Float32Array(this.n); this.R = new Float32Array(this.n); }
  add(t, len, pan, fn) {
    const i0 = Math.round(t * SR), m = Math.round(len * SR);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = 0; i < m; i++) {
      const j = i0 + i;
      if (j < 0 || j >= this.n) continue;
      const v = fn(i / SR, i);
      this.L[j] += v * gl * Math.SQRT2; this.R[j] += v * gr * Math.SQRT2;
    }
  }
  wav(path) {
    let peak = 0;
    for (let i = 0; i < this.n; i++) peak = Math.max(peak, Math.abs(this.L[i]), Math.abs(this.R[i]));
    const g = 0.89 / (peak || 1);
    const buf = Buffer.alloc(44 + this.n * 4);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + this.n * 4, 4); buf.write('WAVEfmt ', 8);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
    buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(this.n * 4, 40);
    for (let i = 0; i < this.n; i++) {
      buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, this.L[i] * g)) * 32767), 44 + i * 4);
      buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, this.R[i] * g)) * 32767), 46 + i * 4);
    }
    writeFileSync(path, buf);
  }
}

// ---------- instruments ----------
export function kick(mix, t, g = 1) {
  let ph = 0;
  mix.add(t, 0.3, 0, (x) => {
    const f = 46 + 110 * Math.exp(-x * 28);
    ph += (2 * Math.PI * f) / SR;
    return g * (Math.sin(ph) * Math.exp(-x * 9) + 0.25 * Math.exp(-x * 400));
  });
}
export function snare(mix, t, r, g = 1) {
  let lp = 0;
  mix.add(t, 0.22, 0.05, (x) => {
    const nz = r() * 2 - 1;
    lp += 0.5 * (nz - lp);
    return g * 0.55 * ((nz - 0.6 * lp) * Math.exp(-x * 22) + 0.5 * Math.sin(2 * Math.PI * 185 * x) * Math.exp(-x * 30));
  });
}
export function hat(mix, t, r, g = 1, pan = 0.25) {
  let prev = 0;
  mix.add(t, 0.06, pan, (x) => {
    const nz = r() * 2 - 1;
    const hp = nz - prev; prev = nz;
    return g * 0.22 * hp * Math.exp(-x * 90);
  });
}
export function bass(mix, t, len, midi, g = 1) {
  const f = midiHz(midi);
  mix.add(t, len, 0, (x) => {
    const env = Math.min(1, x / 0.008) * Math.min(1, (len - x) / 0.03);
    return g * 0.42 * env * (Math.sin(2 * Math.PI * f * x) + 0.35 * Math.sin(4 * Math.PI * f * x) + 0.15 * Math.sin(6 * Math.PI * f * x));
  });
}
export function pad(mix, t, len, midis, g = 1, attack = 0.25) {
  for (const [k, m] of midis.entries()) {
    for (const [pan, det] of [[-0.7, 0.997], [0.7, 1.003]]) {
      const f = midiHz(m) * det;
      mix.add(t, len, pan, (x) => {
        const env = Math.min(1, x / attack) * Math.min(1, (len - x) / 0.2);
        return g * 0.07 * env * (Math.sin(2 * Math.PI * f * x) + 0.4 * Math.sin(4 * Math.PI * f * x + k) + 0.2 * Math.sin(6 * Math.PI * f * x));
      });
    }
  }
}
export function stab(mix, t, len, midis, g = 1, pan = 0) {
  for (const m of midis) {
    const f = midiHz(m);
    mix.add(t, len, pan, (x) => {
      const env = Math.min(1, x / 0.004) * Math.exp(-x * 7);
      return g * 0.1 * env * (Math.sin(2 * Math.PI * f * x) + 0.5 * Math.sin(4 * Math.PI * f * x) + 0.25 * Math.sin(6 * Math.PI * f * x));
    });
  }
}
/** formant-shaped voice; `pitchAt(x)` → midi, so melisma and vibrato are exact */
export function voice(mix, t, len, pitchAt, formants, r, g = 1, pan = 0) {
  let ph = 0;
  const amp = (f) => {
    let a = 0;
    for (const [F, bw, gn] of formants) a += gn / Math.sqrt(1 + ((f - F) / bw) ** 2);
    return a;
  };
  let prev = 0;
  mix.add(t, len, pan, (x) => {
    const f0 = midiHz(pitchAt(x));
    ph += (2 * Math.PI * f0) / SR;
    let s = 0;
    for (let h = 1; h * f0 < 5000; h++) s += (amp(h * f0) / h ** 0.6) * Math.sin(h * ph);
    const env = Math.min(1, x / 0.018) * Math.min(1, (len - x) / 0.04);
    // a short breath-noise consonant at the start of each syllable
    const nz = r() * 2 - 1; const hp = nz - prev; prev = nz;
    const cons = 0.25 * hp * Math.exp(-x * 120);
    return g * 0.2 * (env * s + cons);
  });
}
export const VOICE_A = [[700, 110, 1], [1150, 130, 0.7], [2600, 200, 0.25]];
export const VOICE_B = [[320, 90, 1], [2250, 180, 0.6], [3000, 220, 0.3]];
export const VOICE_LEAD = [[560, 120, 1], [1500, 160, 0.6], [2500, 220, 0.25]];

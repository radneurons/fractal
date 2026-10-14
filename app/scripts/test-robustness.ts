// Robustness of the analysis beyond the demo fixture, on two more synthetic recordings made here:
//  · a 92 BPM ballad (drumless intro, soft verse, full chorus, half-time bridge, chorus, pad outro)
//  · a speech-like recording (formant-filtered syllables in phrases, no beat)
import { analyze } from '../src/analysis/dsp';

(globalThis as { LE_DEBUG?: boolean }).LE_DEBUG = true;
let fails = 0;
const check = (name: string, ok: boolean, info: string) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + ' — ' + info); if (!ok) fails++; };
let seed = 777; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// ───────── ballad ─────────
{
  const SR = 22050, BPM = 92, BEAT = 60 / BPM, BAR = BEAT * 4;
  const secs = [{ l: 'intro', b: 8 }, { l: 'verse', b: 8 }, { l: 'chorus', b: 8 }, { l: 'bridge', b: 4 }, { l: 'chorus', b: 8 }, { l: 'outro', b: 4 }];
  const bars = secs.reduce((a, s) => a + s.b, 0), N = Math.ceil((bars * BAR + 1) * SR), x = new Float32Array(N);
  const add = (i: number, v: number) => { if (i >= 0 && i < N) x[i] += v; };
  const tone = (t: number, f: number, len: number, g: number, dec = 2.5) => { const i0 = Math.round(t * SR); for (let k = 0; k < len * SR; k++) { const tt = k / SR; add(i0 + k, g * Math.sin(2 * Math.PI * f * tt) * Math.min(1, tt * 200) * Math.exp(-tt * dec)); } };
  const kick = (t: number, g: number) => { const i0 = Math.round(t * SR); for (let k = 0; k < SR * .3; k++) { const tt = k / SR; add(i0 + k, g * Math.sin(2 * Math.PI * (48 + 80 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 10)); } };
  const snare = (t: number, g: number) => { const i0 = Math.round(t * SR); for (let k = 0; k < SR * .18; k++) { const tt = k / SR; add(i0 + k, g * (rnd() * 2 - 1) * Math.exp(-tt * 20)); } };
  const chA = [[220, 277.2, 329.6], [185, 233.1, 277.2], [146.8, 185, 220], [164.8, 207.7, 246.9]];
  const chB = [[196, 246.9, 293.7], [174.6, 220, 261.6]];
  let bar = 0; const truthSec: { l: string; t: number }[] = [];
  for (const s of secs) {
    truthSec.push({ l: s.l, t: bar * BAR });
    for (let b = 0; b < s.b; b++, bar++) {
      const tb = bar * BAR, ch = s.l === 'bridge' ? chB[b % 2] : chA[bar % 4];
      // piano: arpeggio on eighths (the pulse even without drums)
      for (let e = 0; e < 8; e++) tone(tb + e * BEAT / 2, ch[e % 3] * (e % 4 === 0 ? 1 : 2), BEAT / 2, s.l === 'chorus' ? .16 : .12, 4);
      if (s.l === 'outro') continue;
      if (s.l === 'verse') { kick(tb, .5); kick(tb + 2 * BEAT, .5); snare(tb + BEAT, .12); snare(tb + 3 * BEAT, .12); tone(tb, ch[0] / 2, BAR, .2, .8); }
      if (s.l === 'chorus') { for (let q = 0; q < 4; q++) { kick(tb + q * BEAT, .8); if (q % 2) snare(tb + q * BEAT, .35); } for (let e = 0; e < 4; e++) tone(tb + e * BEAT, ch[0] / 2, BEAT, .3, 1.2); }
      if (s.l === 'bridge') { kick(tb, .6); snare(tb + 2 * BEAT, .25); tone(tb, ch[0] / 2, BAR, .25, .6); }
    }
  }
  const a = analyze(x, SR);
  const okTempo = Math.abs(a.bpm - BPM) / BPM < .03;
  check('ballad tempo', okTempo, `bpm ${a.bpm.toFixed(2)} (truth ${BPM})`);
  const beatErr = a.beats.filter(b => b > 1 && b < a.duration - 2).map(b => { const k = Math.round(b / BEAT); return Math.abs(b - k * BEAT); }).sort((p, q) => p - q);
  check('ballad beats', beatErr[beatErr.length >> 1] < .03, `median ${(beatErr[beatErr.length >> 1] * 1000).toFixed(1)} ms`);
  const near = (t: number) => a.sections.some(s => Math.abs(s.start - t) < BAR * 1.01);
  const want = truthSec.filter(s => s.l === 'chorus' || s.l === 'verse').map(s => s.t);
  check('ballad section boundaries', want.every(near), `found ${a.sections.map(s => s.label + '@' + s.start.toFixed(1)).join(', ')}; want ${want.map(t => t.toFixed(1)).join(', ')}`);
  const ch1 = truthSec.find(s => s.l === 'chorus')!.t;
  check('ballad chorus label', a.sections.some(s => s.label === 'chorus' && Math.abs(s.start - ch1) < BAR * 1.01), 'first chorus labelled chorus');
  check('ballad no spurious drops', a.drops.length <= 1, `drops ${a.drops.map(d => d.toFixed(1)).join(', ') || 'none'}`);
}

// ───────── speech ─────────
{
  const SR = 22050, DUR = 26, N = DUR * SR, x = new Float32Array(N);
  const starts: number[] = [];
  let t = .8;
  while (t < DUR - 2) {
    const words = 4 + Math.floor(rnd() * 8);
    for (let w = 0; w < words && t < DUR - 1; w++) {
      const syl = 1 + Math.floor(rnd() * 3); starts.push(t);
      for (let s = 0; s < syl; s++) {
        const len = .12 + rnd() * .14, f1 = 400 + rnd() * 500, f2 = 1100 + rnd() * 1300, i0 = Math.round(t * SR);
        // two resonators driven by a glottal pulse train + noise
        let y1 = 0, y2 = 0, z1 = 0, z2 = 0; const r = .985, pitch = 110 + rnd() * 60;
        const c1 = 2 * r * Math.cos(2 * Math.PI * f1 / SR), c2 = 2 * r * Math.cos(2 * Math.PI * f2 / SR);
        for (let k = 0; k < len * SR; k++) {
          const tt = k / SR, env = Math.sin(Math.PI * tt / len) ** .6;
          const src = ((k % Math.round(SR / pitch)) === 0 ? 1 : 0) * 2 + (rnd() * 2 - 1) * .15;
          const o1 = src + c1 * y1 - r * r * y2; y2 = y1; y1 = o1;
          const o2 = src + c2 * z1 - r * r * z2; z2 = z1; z1 = o2;
          if (i0 + k < N) x[i0 + k] += env * (o1 * .02 + o2 * .012);
        }
        t += len + .02;
      }
      t += .05 + rnd() * .12;
    }
    t += .45 + rnd() * 1.1;   // phrase pause
  }
  const a = analyze(x, SR);
  const speechy = a.sections.every(s => s.label === 'speech') || a.bpmConfidence < .2;
  check('speech mode', speechy, `confidence ${a.bpmConfidence.toFixed(2)}, sections ${a.sections.map(s => s.label).join(',')}`);
  const hit = starts.filter(s => a.onsets.some(o => Math.abs(o - s) < .06)).length / starts.length;
  check('speech word onsets', hit > .8, `${(hit * 100).toFixed(0)}% of ${starts.length} word starts within 60 ms`);
}


// ───────── click tracks: feature alignment, slow pulse, short clip ─────────
{
  const click = (bpm: number, dur: number, sr = 44100) => { const x = new Float32Array(Math.round(dur * sr)), pulses: number[] = []; for (let t = .5; t < dur - .2; t += 60 / bpm) { pulses.push(t); const i0 = Math.round(t * sr); for (let k = 0; k < sr * .03; k++) x[i0 + k] += Math.sin(2 * Math.PI * 1000 * k / sr) * Math.exp(-k / sr * 120) + Math.sin(2 * Math.PI * 60 * k / sr) * Math.exp(-k / sr * 30) * .8; } return { x, sr, pulses }; };
  const c = click(120, 12); const a = analyze(c.x, c.sr);
  const s60 = (t: number) => a.flux[Math.min(a.n - 1, Math.max(0, Math.round(t * 60)))];
  const at = a.downbeats.slice(1, -1).map(d => s60(d)), early = a.downbeats.slice(1, -1).map(d => s60(d - .076));
  const mean = (v: number[]) => v.reduce((p, q) => p + q, 0) / Math.max(1, v.length);
  check('features aligned with onsets', mean(at) > mean(early) && mean(at) > .4, `flux at downbeats ${mean(at).toFixed(2)}, 76 ms earlier ${mean(early).toFixed(2)}`);
  check('short music clip is not speech', a.sections.every(s2 => s2.label !== 'speech'), a.sections.map(s2 => s2.label).join(','));
  const slow = click(50, 30), b = analyze(slow.x, slow.sr);
  const onPulse = b.beats.filter(t => slow.pulses.some(p => Math.abs(p - t) < .05)).length / Math.max(1, b.beats.length);
  check('very slow pulse: beats land on pulses', onPulse > .45 && Math.abs(b.bpm / 50 - Math.round(b.bpm / 50)) < .03, `bpm ${b.bpm.toFixed(1)}, ${(onPulse * 100).toFixed(0)}% of beats on a pulse`);
}

if (fails) { console.log(`${fails} failure(s)`); process.exit(1); }
console.log('robustness: all passed');

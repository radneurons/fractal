// SPEC §17 test-robustness: two more recordings synthesised in memory.
//  A. 92 BPM ballad: 8-bar drumless piano intro, soft verse, full chorus, 4-bar half-time bridge, chorus, pad outro.
//     Expect tempo ±3 %, beats < 30 ms, verse and chorus boundaries within a bar, the first chorus labelled chorus,
//     ≤ 1 drop.
//  B. Formant-synthesised speech in phrases with pauses. Expect speech mode and > 80 % of word starts found as
//     onsets within 60 ms.
import { check, done } from './lib/check.ts';
import { analyze } from '../src/analysis/index.ts';
// @ts-expect-error — plain JS module shared with make-fixtures.mjs
import { SR, rng, midiHz, Mix, kick, snare, hat, bass, pad, voice, VOICE_LEAD } from './lib/synth.mjs';

type MixT = { n: number; L: Float32Array; R: Float32Array; add(t: number, len: number, pan: number, fn: (x: number, i: number) => number): void };
const pcmOf = (mix: MixT) => {
  let peak = 0; for (let i = 0; i < mix.n; i++) peak = Math.max(peak, Math.abs(mix.L[i]), Math.abs(mix.R[i]));
  const g = 0.89 / (peak || 1);
  return { sampleRate: SR, channels: [mix.L.map((v) => v * g), mix.R.map((v) => v * g)] };
};
/** a piano-ish note: inharmonic partials, hammer click, exponential decay per partial */
function piano(mix: MixT, t: number, len: number, midi: number, g = 1, pan = 0): void {
  const f = midiHz(midi);
  mix.add(t, len, pan, (x) => {
    let s = 0;
    for (let h = 1; h <= 6; h++) { const fh = f * h * Math.sqrt(1 + 0.0004 * h * h); s += (Math.sin(2 * Math.PI * fh * x) / h) * Math.exp(-x * (1.6 + h * 0.9)); }
    return g * 0.16 * Math.min(1, x / 0.003) * Math.min(1, (len - x) / 0.05) * s;
  });
}

// ---------------------------------------------------------------- A. ballad
{
  console.log('  — ballad, 92 BPM');
  const BPM = 92, BEAT = 60 / BPM, BAR = 4 * BEAT;
  const plan: [string, number][] = [['intro', 8], ['verse', 8], ['chorus', 8], ['bridge', 4], ['chorus', 8], ['outro', 4]];
  const total = plan.reduce((s, p) => s + p[1], 0);
  const mix = new Mix(total * BAR + 2) as MixT;
  const r = rng(92);
  const roots = [57, 53, 60, 55]; // A F C G
  const starts: Record<string, number[]> = {};
  const beats: number[] = [];
  let bar = 0;
  for (const [label, bars] of plan) {
    (starts[label] ??= []).push(bar * BAR);
    for (let k = 0; k < bars; k++, bar++) {
      const t = bar * BAR, root = roots[bar % 4];
      const triad = [root, root + (bar % 4 === 0 ? 3 : 4), root + 7].map((m) => m + 12);
      for (let b = 0; b < 4; b++) beats.push(t + b * BEAT);
      if (label === 'outro') { pad(mix, t, BAR + 0.2, triad, 0.9, 0.5); continue; }
      // piano: quarter-note chords (left hand root on 1 and 3), softer in the intro and verse
      const pg = label === 'chorus' ? 1 : 0.75;
      for (let b = 0; b < 4; b++) for (const m of triad) piano(mix, t + b * BEAT, BEAT * 0.95, m, pg * (b === 0 ? 1 : 0.7), 0.2);
      if (label === 'intro') continue;
      piano(mix, t, BAR * 0.5, root - 12, pg, -0.2); piano(mix, t + 2 * BEAT, BAR * 0.5, root - 12, pg * 0.8, -0.2);
      if (label === 'verse') {
        kick(mix, t, 0.55); kick(mix, t + 2 * BEAT, 0.5);
        snare(mix, t + BEAT, r, 0.35); snare(mix, t + 3 * BEAT, r, 0.35);
        bass(mix, t, BAR * 0.95, root - 24, 0.6);
      } else if (label === 'chorus') {
        for (let b = 0; b < 4; b++) { kick(mix, t + b * BEAT, b % 2 ? 0.7 : 1); if (b % 2) snare(mix, t + b * BEAT, r, 1); hat(mix, t + b * BEAT, r, 0.8); hat(mix, t + (b + 0.5) * BEAT, r, 0.6); }
        for (let b = 0; b < 4; b++) bass(mix, t + b * BEAT, BEAT * 0.9, root - 24, 0.9);
        pad(mix, t, BAR + 0.1, triad, 0.8, 0.15);
      } else if (label === 'bridge') { // half-time: kick on 1, snare on 3
        kick(mix, t, 0.9); snare(mix, t + 2 * BEAT, r, 0.9);
        for (let b = 0; b < 4; b++) hat(mix, t + b * BEAT, r, 0.5);
        bass(mix, t, BAR * 0.95, root - 24, 0.7);
        pad(mix, t, BAR + 0.1, triad, 0.7, 0.3);
      }
      // a sung phrase over verses and choruses (two half notes and a held note)
      if (label === 'verse' || label === 'chorus') {
        const top = triad[2] + 5;
        voice(mix, t + 0.02, BEAT * 1.9, () => top, VOICE_LEAD, r, label === 'chorus' ? 1 : 0.8, 0);
        voice(mix, t + 2 * BEAT + 0.02, BEAT * 1.9, () => top - 2, VOICE_LEAD, r, label === 'chorus' ? 1 : 0.8, 0);
      }
    }
  }
  const t0 = performance.now();
  const a = analyze(pcmOf(mix));
  console.log(`    analysis ${(performance.now() - t0).toFixed(0)} ms, ${a.bpm.toFixed(2)} BPM, sections ${a.sections.map((s) => `${s.label}@${s.start.toFixed(1)}`).join(' ')}, drops ${a.drops.map((d) => d.toFixed(1)).join(' ') || 'none'}`);
  check('ballad: tempo within ±3 %', Math.abs(a.bpm / BPM - 1) <= 0.03, `${a.bpm.toFixed(2)} vs ${BPM}`);
  // beats after the drumless intro: mean |error| of matched beats < 30 ms
  const truth = beats.filter((b) => b >= 8 * BAR && b < (total - 4) * BAR);
  let hit = 0, err = 0;
  for (const b of truth) { let best = 1; for (const g of a.beats) best = Math.min(best, Math.abs(g - b)); if (best <= 0.07) { hit++; err += best; } }
  check('ballad: beats < 30 ms (mean error, ≥ 90 % matched)', hit / truth.length >= 0.9 && err / Math.max(1, hit) < 0.03, `${hit}/${truth.length} matched, mean ${(1000 * err / Math.max(1, hit)).toFixed(1)} ms`);
  const bounds = a.sections.map((s) => s.start);
  const near = (t: number) => Math.min(...bounds.map((b) => Math.abs(b - t)));
  check('ballad: verse boundary within a bar', near(starts.verse[0]) <= BAR, `${near(starts.verse[0]).toFixed(2)} s off (bar ${BAR.toFixed(2)} s)`);
  check('ballad: chorus boundary within a bar', near(starts.chorus[0]) <= BAR, `${near(starts.chorus[0]).toFixed(2)} s off`);
  const firstChorus = a.sections.find((s) => Math.abs(s.start - starts.chorus[0]) <= BAR);
  check('ballad: the first chorus is labelled chorus', firstChorus?.label === 'chorus', firstChorus ? `${firstChorus.label} @ ${firstChorus.start.toFixed(1)}` : 'no section there');
  check('ballad: ≤ 1 drop', a.drops.length <= 1, `${a.drops.length}`);
}

// ---------------------------------------------------------------- B. speech
{
  console.log('  — speech');
  const r = rng(7);
  const VOWELS = [[[730, 90, 1], [1090, 110, 0.6], [2440, 160, 0.25]], [[270, 60, 1], [2290, 150, 0.5], [3010, 200, 0.3]], [[570, 80, 1], [840, 100, 0.7], [2410, 160, 0.2]], [[300, 70, 1], [870, 100, 0.5], [2240, 160, 0.2]], [[530, 80, 1], [1840, 130, 0.5], [2480, 170, 0.25]]];
  const mix = new Mix(62) as MixT;
  const wordStarts: number[] = [];
  let t = 0.8;
  while (t < 58) {
    const words = 4 + Math.floor(r() * 5);
    const base = 50 + r() * 4; // ~ 125–160 Hz speaking pitch (midi)
    for (let w = 0; w < words && t < 58; w++) {
      wordStarts.push(t);
      const syl = 1 + Math.floor(r() * 3);
      for (let s = 0; s < syl; s++) {
        const len = 0.11 + r() * 0.12;
        const fv = VOWELS[Math.floor(r() * VOWELS.length)];
        const p0 = base + (r() - 0.5) * 3, p1 = p0 - 1 - r() * 2; // falling intonation per syllable
        voice(mix, t, len, (x: number) => p0 + (p1 - p0) * (x / len), fv, r, s === 0 ? 1 : 0.75, 0);
        t += len + 0.025 + r() * 0.03;
      }
      t += 0.06 + r() * 0.1; // between words
    }
    t += 0.6 + r() * 0.6; // phrase pause
  }
  const a = analyze(pcmOf(mix));
  check('speech: speech mode detected', a.isSpeech, `isSpeech ${a.isSpeech}, ${a.bpm.toFixed(0)} BPM conf ${a.bpmConfidence.toFixed(2)}`);
  const ons = [...a.onsets, ...a.vocalOnsets].sort((x, y) => x - y);
  let found = 0;
  for (const w of wordStarts) if (ons.some((o) => Math.abs(o - w) <= 0.06)) found++;
  check('speech: > 80 % of word starts found as onsets within 60 ms', found / wordStarts.length > 0.8, `${found}/${wordStarts.length} (${(100 * found / wordStarts.length).toFixed(0)} %)`);
}
done();

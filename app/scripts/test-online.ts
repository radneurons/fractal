// SPEC §17 Live: both fixtures through the online analyser in 128-sample chunks. After an 8 s warm-up:
// beat F-measure ≥ 0.9 (±70 ms), tempo within ±2 %, mean beat-prediction error < 25 ms.
import { readFileSync } from 'node:fs';
import { readWav } from './lib/node-audio.ts';
import { check, done } from './lib/check.ts';
import { OnlineAnalyser } from '../src/analysis/online.ts';

for (const name of ['demo-song', 'demo-waltz']) {
  console.log(`  — ${name}`);
  const pcm = readWav(`public/demo/${name}.wav`);
  const exp = JSON.parse(readFileSync(`public/demo/${name}.json`, 'utf8'));
  const L = pcm.channels[0], R = pcm.channels[1] ?? L;
  const an = new OnlineAnalyser(pcm.sampleRate);
  const chunk = new Float32Array(128);
  const t0 = performance.now();
  for (let i = 0; i + 128 <= L.length; i += 128) {
    for (let k = 0; k < 128; k++) chunk[k] = 0.5 * (L[i + k] + R[i + k]);
    an.push(chunk);
  }
  const ms = performance.now() - t0;
  const dur = L.length / pcm.sampleRate;
  const warm = 8; // demo-song's first 8 s are a beat-less pad, so its warm-up is the first second of drums
  const truth = (exp.beats as number[]).filter((b) => b >= warm && b <= dur - 1);
  // only score where the music has a pulse (demo-song's breakdown keeps hats; its outro after 66 s is a fade)
  const end = name === 'demo-song' ? 64 : dur - 1;
  const T = truth.filter((b) => b <= end);
  const got = an.events.beats.filter((b) => b >= warm && b <= end);
  let tp = 0, errSum = 0; const used = new Set<number>();
  for (const b of T) {
    let bi = -1, bd = 0.07;
    for (let i = 0; i < got.length; i++) { const d = Math.abs(got[i] - b); if (d <= bd && !used.has(i)) { bd = d; bi = i; } }
    if (bi >= 0) { used.add(bi); tp++; errSum += bd; }
  }
  const P = got.length ? tp / got.length : 0, Rc = T.length ? tp / T.length : 0;
  const F = P + Rc ? (2 * P * Rc) / (P + Rc) : 0;
  const lastTempo = an.events.tempo.filter((x) => x.t >= warm);
  const bpm = an.state().bpm;
  console.log(`    ${(ms).toFixed(0)} ms for ${dur.toFixed(0)} s (${(dur * 1000 / ms).toFixed(0)}× real time), ${an.events.onsets.length} onsets, ${lastTempo.length} tempo updates after warm-up`);
  check(`${name}: beat F-measure ≥ 0.9`, F >= 0.9, `F ${F.toFixed(3)} (P ${P.toFixed(2)}, R ${Rc.toFixed(2)}, ${got.length} predicted / ${T.length} true)`);
  check(`${name}: tempo within ±2 %`, Math.abs(bpm / exp.bpm - 1) <= 0.02, `${bpm.toFixed(2)} vs ${exp.bpm}`);
  check(`${name}: mean beat-prediction error < 25 ms`, tp > 0 && errSum / tp < 0.025, `${tp ? ((errSum / tp) * 1000).toFixed(1) : '—'} ms`);
  check(`${name}: runs faster than real time`, dur * 1000 / ms > 4, `${(dur * 1000 / ms).toFixed(0)}×`);
}
done();

// SPEC §4 fixture test on the demo song: 120 BPM, sections, one drop, onsets.
import { readFileSync } from 'node:fs';
import { readWav } from './lib/node-audio.ts';
import { check, done, near } from './lib/check.ts';
import { matchEvents } from './lib/metrics.ts';
import { analyze } from '../src/analysis/index.ts';

const exp = JSON.parse(readFileSync('public/demo/demo-song.json', 'utf8'));
const t0 = performance.now();
const a = analyze(readWav('public/demo/demo-song.wav'));
const ms = performance.now() - t0;
console.log(`  analysis took ${ms.toFixed(0)} ms`);

check('duration 73 s', near(a.duration, 73, 0.05), a.duration.toFixed(2));
check('tempo within ±1 %', near(a.bpm, exp.bpm, exp.bpm * 0.01), `${a.bpm.toFixed(2)} BPM, confidence ${a.bpmConfidence.toFixed(2)}`);
const inMusic = (t: number) => t >= 8 && t <= 64;
const pad = (t: number) => t >= 7.9 && t <= 64.1;
const bm = matchEvents(a.beats.filter(pad), exp.beats.filter(inMusic), 0.02);
check('beats within ±20 ms', bm.recall >= 0.98 && bm.precision >= 0.98, `recall ${bm.recall.toFixed(3)}, precision ${bm.precision.toFixed(3)}, mean err ${(bm.meanErr * 1000).toFixed(1)} ms, bias ${(bm.bias * 1000).toFixed(1)} ms`);
const dm = matchEvents(a.downbeats.filter(pad), exp.downbeats.filter(inMusic), 0.02);
check('downbeats within ±20 ms', dm.recall >= 0.98 && dm.precision >= 0.98, `recall ${dm.recall.toFixed(3)}, precision ${dm.precision.toFixed(3)}, bias ${(dm.bias * 1000).toFixed(1)} ms`);
check('meter 4', a.meter === 4, String(a.meter));
const starts = a.sections.map((s) => s.start);
for (const s of exp.sections) {
  const got = a.sections.find((x) => Math.abs(x.start - s.start) < 0.6);
  check(`section boundary at ${s.start} s (${s.label})`, !!got && got.label === s.label, got ? `${got.start.toFixed(2)} ${got.label}` : `missing; found ${starts.map((x) => x.toFixed(1)).join(', ')}`);
}
check('no extra sections', a.sections.length === exp.sections.length, `${a.sections.length} found`);
check('exactly one drop, at 48 s', a.drops.length === 1 && near(a.drops[0], 48, 0.1), a.drops.map((d) => d.toFixed(2)).join(', ') || 'none');
const om = matchEvents(a.onsets, exp.onsets, 0.05);
check('≥ 95 % of onsets recalled', om.recall >= 0.95, `recall ${om.recall.toFixed(3)} (${a.onsets.length} found / ${exp.onsets.length} expected), bias ${(om.bias * 1000).toFixed(1)} ms`);
check('not speech', !a.isSpeech);
done();

// Run with: npm test (bundled by scripts/test.mjs)
import { readFileSync } from 'node:fs';
import { analyze } from '../src/analysis/dsp.ts';

const wav = readFileSync('public/demo/demo-song.wav');
const truth = JSON.parse(readFileSync('public/demo/demo-song.json', 'utf8'));
const sr = wav.readUInt32LE(24), n = (wav.length - 44) / 4, mono = new Float32Array(n);
for (let i = 0; i < n; i++) mono[i] = (wav.readInt16LE(44 + i * 4) + wav.readInt16LE(46 + i * 4)) / 65536;
(globalThis as { LE_DEBUG?: boolean }).LE_DEBUG = true;
const t0 = performance.now();
const a = analyze(mono, sr);
const ms = performance.now() - t0;
let fails = 0;
const check = (name: string, ok: boolean, info: string) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + ' — ' + info); if (!ok) fails++; };
check('tempo', Math.abs(a.bpm - truth.bpm) < 2, `bpm ${a.bpm.toFixed(2)} (truth ${truth.bpm}), conf ${a.bpmConfidence.toFixed(2)}`);
// beats within 25 ms of the true grid
const beatErr = a.beats.filter(b => b > 1 && b < a.duration - 1).map(b => { const k = Math.round(b / 0.5); return Math.abs(b - k * 0.5); });
const med = [...beatErr].sort((x, y) => x - y)[beatErr.length >> 1];
check('beats', med < 0.025, `median error ${(med * 1000).toFixed(1)} ms over ${beatErr.length} beats`);
const dbErr = a.downbeats.filter(d => d > 1 && d < a.duration - 2).map(d => Math.min(...truth.downbeats.map((x: number) => Math.abs(x - d))));
const dbMed = [...dbErr].sort((x, y) => x - y)[dbErr.length >> 1];
check('downbeats', dbMed < 0.05, `median error ${(dbMed * 1000).toFixed(1)} ms`);
const secStarts = a.sections.map(s => s.start);
const missed = truth.sections.slice(1).filter((s: { start: number }) => !secStarts.some(x => Math.abs(x - s.start) <= 2.01));
check('sections', missed.length <= 1, `found ${a.sections.map(s => `${s.label}@${s.start.toFixed(1)}`).join(', ')}; missed ${missed.map((m: { label: string; start: number }) => m.label + '@' + m.start).join(', ') || 'none'}`);
check('chorus label', a.sections.some(s => s.label === 'chorus'), 'at least one chorus');
check('drop', a.drops.some(d => Math.abs(d - truth.drop) < 2.1), `drops ${a.drops.map(d => d.toFixed(1)).join(', ')} (truth ${truth.drop})`);
const onsetHit = truth.words.filter((w: { start: number }) => a.onsets.some(o => Math.abs(o - w.start) < 0.06)).length / truth.words.length;
check('onsets', onsetHit > 0.6, `${(onsetHit * 100).toFixed(0)}% of word onsets detected within 60 ms`);
console.log(`analysis took ${ms.toFixed(0)} ms for ${a.duration.toFixed(1)} s of audio`);
process.exit(fails ? 1 : 0);

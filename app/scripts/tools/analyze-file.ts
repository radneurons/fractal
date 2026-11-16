// Analyse any audio file and print a readable report:  node scripts/run.mjs scripts/tools/analyze-file.ts song.mp3
import { decodeFile } from '../lib/node-audio.ts';
import { analyze } from '../../src/analysis/index.ts';
import { chordName, keyName } from '../../src/analysis/harmony.ts';

const path = process.argv[2];
const t0 = performance.now();
const pcm = decodeFile(path);
const t1 = performance.now();
let last = '';
const a = analyze(pcm, (s) => { if (s !== last) { last = s; } });
const t2 = performance.now();
const f = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
console.log(`${path}\n  decode ${(t1 - t0).toFixed(0)} ms, analysis ${(t2 - t1).toFixed(0)} ms, duration ${f(a.duration)}`);
console.log(`  tempo ${a.bpm.toFixed(2)} BPM (confidence ${a.bpmConfidence.toFixed(2)}), meter ${a.meter}, beats ${a.beats.length}, bars ${a.downbeats.length}, speech ${a.isSpeech}`);
console.log(`  first downbeats ${a.downbeats.slice(0, 6).map((x) => x.toFixed(2)).join(' ')}`);
console.log(`  key ${keyName(a.key)} (conf ${a.key.confidence.toFixed(2)})  changes: ${a.keyChanges.map((k) => `${f(k.t)} ${keyName(k)}`).join(', ') || 'none'}`);
console.log(`  onsets ${a.onsets.length}, vocal onsets ${a.vocalOnsets.length}, LUFS ${a.lufs.toFixed(1)}`);
console.log(`  sections:`);
for (const s of a.sections) console.log(`    ${f(s.start)} – ${f(s.end)}  ${s.label.padEnd(9)} energy ${s.energy.toFixed(2)} cluster ${s.cluster}`);
console.log(`  drops: ${a.drops.map(f).join(', ') || 'none'}`);
console.log(`  repeats: ${a.repeats.slice(0, 8).map((r) => `${f(r.a)}≈${f(r.b)} (${r.len.toFixed(0)}s)`).join(', ') || 'none'}`);
console.log(`  chords: ${a.chords.slice(0, 24).map((c) => chordName(c)).join(' ')}${a.chords.length > 24 ? ' …' : ''}`);
let voiced = 0, act = 0;
for (let i = 0; i < a.n; i++) { if (!Number.isNaN(a.f0[i])) voiced++; if (a.vocal[i] > 0.5) act++; }
console.log(`  vocal active ${(100 * act / a.n).toFixed(0)} % of frames, voiced f0 ${(100 * voiced / a.n).toFixed(0)} %`);

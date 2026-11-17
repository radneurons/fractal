// Auto-Director constraints (SPEC §9.6) on the demo analysis, plus a mostly-hook song shape.
import { readWav } from './lib/node-audio.ts';
import { check, done } from './lib/check.ts';
import { analyze } from '../src/analysis/index.ts';
import { autoDirect } from '../src/director/autodirector.ts';
import '../src/effects/registry.ts';
import type { Analysis, Lyrics } from '../src/types.ts';

// effects register on import; the SDK glob needs Vite, so import the built-ins one by one
const mods = ['broadside', 'elements', 'mission', 'swarm', 'chrome', 'droste', 'press', 'popup', 'signal', 'neon', 'ransom', 'mandala', 'fireworks', 'sumi', 'monolith', 'karaoke'];
await Promise.all(mods.map((m) => import(`../src/effects/${m}.ts`)));
const a = analyze(readWav('public/demo/demo-song.wav'));
const ly: Lyrics = { words: [], lines: [], source: 'lrc' } as unknown as Lyrics;
const sameInARow = (p: ReturnType<typeof autoDirect>) => p.segments.some((s, i) => i > 0 && p.segments[i - 1].effect === s.effect);
for (const seed of [1776, 7, 42]) {
  const p = autoDirect(a, ly, seed);
  check(`seed ${seed}: never the same effect twice in a row`, !sameInARow(p), p.segments.map((s) => s.effect).join(' → '));
  check(`seed ${seed}: ≤ 5 distinct effects`, new Set(p.segments.map((s) => s.effect)).size <= 5);
  const choruses = a.sections.map((s, i) => [s, i] as const).filter(([s]) => s.label === 'chorus');
  const eff = (t: number) => p.segments.find((s) => t >= s.start && t < s.end)?.effect;
  check(`seed ${seed}: repeated choruses share an effect`, new Set(choruses.map(([s]) => eff(s.start + 0.1))).size === 1);
}
check('different seeds give different cuts', new Set([1, 2, 3, 4, 5, 6].map((s) => autoDirect(a, ly, s).segments.map((x) => x.effect).join())).size > 1);
// a mostly-hook song: intro, chorus ×5 back to back, bridge, outro
const secs = [0, 14, 40, 55, 72, 95, 116, 135, 161, 176, 185];
const hook: Analysis = { ...a, duration: 185, drops: [], sections: secs.slice(0, -1).map((t, i) => ({ start: t, end: secs[i + 1], label: i === 0 ? 'intro' : i === 8 ? 'bridge' : i === 9 ? 'outro' : 'chorus', energy: 0.8, cluster: i === 0 ? 0 : i === 8 ? 2 : i === 9 ? 3 : 1 })) } as Analysis;
const ph = autoDirect(hook, ly, 1776);
const longest = Math.max(...ph.segments.map((s) => s.end - s.start));
check('back-to-back repeats alternate (no 100 s single-effect block)', !sameInARow(ph) && longest < 40, ph.segments.map((s) => `${s.effect} ${(s.end - s.start).toFixed(0)}s`).join(', '));
done();

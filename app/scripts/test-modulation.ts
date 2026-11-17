// SPEC §17 test-modulation: precomputed smoothing equals a reference one-pole; order independence;
// automation easing endpoints; clamp behaviour.
import { readFileSync } from 'node:fs';
import { check, done, near } from './lib/check.ts';
import { readWav } from './lib/node-audio.ts';
import { analyze } from '../src/analysis/index.ts';
import { Modulation, onePole, shapeCurve } from '../src/compose/modulation.ts';
import { laneValue } from '../src/compose/automation.ts';
import { mulberry32, sample } from '../src/analysis/dsp.ts';
import type { ModRoute, ParamSpec } from '../src/types.ts';

const a = analyze(readWav('public/demo/demo-song.wav'));
void readFileSync;
// reference: a plain asymmetric one-pole stepped sample by sample
const ref = (x: Float32Array, at: number, rt: number) => { const out = new Float32Array(x.length); let y = x[0]; const ka = Math.exp(-1000 / (at * 60)), kr = Math.exp(-1000 / (rt * 60)); for (let i = 0; i < x.length; i++) { y = x[i] + (y - x[i]) * (x[i] > y ? ka : kr); out[i] = y; } return out; };
const o1 = onePole(a.bands.bass, 30, 250), r1 = ref(a.bands.bass, 30, 250);
let maxd = 0;
for (let i = 0; i < o1.length; i++) maxd = Math.max(maxd, Math.abs(o1[i] - r1[i]));
check('precomputed smoothing equals a reference one-pole', maxd < 1e-6, `max diff ${maxd.toExponential(1)}`);

const route: ModRoute = { id: 'r', source: 'bass', target: { instanceId: 'x', key: 'k' }, amount: 0.5, curve: 'lin', attackMs: 30, releaseMs: 250, lo: 0, hi: 1, invert: false, enabled: true };
const times = Array.from({ length: 200 }, (_, i) => (i * 0.37) % a.duration);
const m1 = new Modulation(a, null), seqA = times.map((t) => m1.routeValue(route, t));
const shuffled = times.map((t, i) => [t, i] as const).sort((p, q) => mulberry32(Math.round(p[0] * 1000))() - mulberry32(Math.round(q[0] * 1000))());
const m2 = new Modulation(a, null);
const seqB = new Array<number>(times.length);
for (const [t, i] of shuffled) seqB[i] = m2.routeValue(route, t);
check('value at t is independent of call order', seqA.every((v, i) => v === seqB[i]));
check('route equals sampled smoothed source × amount', near(m1.routeValue(route, 30), sample(r1, 30) * 0.5, 1e-6));
// closed-form sources
check('beat pulse peaks on a beat', near(m1.source({ ...route, source: 'beatPulse' }, a.beats[20]), 1, 1e-6));
const lfo = (ph: number) => m1.source({ ...route, source: 'lfo', bars: 1, shape: 'saw' }, a.downbeats[5] + ph * (a.downbeats[6] - a.downbeats[5]));
check('LFO saw follows the bar phase', near(lfo(0.25), 0.25, 0.01) && near(lfo(0.75), 0.75, 0.01));
const sh1 = m1.source({ ...route, source: 'sampleHold', hold: 'beat' }, a.beats[10] + 0.05), sh2 = m1.source({ ...route, source: 'sampleHold', hold: 'beat' }, a.beats[10] + 0.2);
check('sample & hold holds within a beat', sh1 === sh2);
// automation easing endpoints
const lane = { target: { instanceId: 'x', key: 'k' }, snap: 'none' as const, keys: [{ t: 1, v: 0, ease: 'linear' as const }, { t: 3, v: 10, ease: 'ease' as const }, { t: 5, v: 4, ease: 'hold' as const }, { t: 7, v: 8, ease: 'bezier' as const, c1: 0.2, c2: 0.8 }] };
check('automation endpoints', laneValue(lane, 0) === 0 && laneValue(lane, 1) === 0 && laneValue(lane, 3) === 10 && laneValue(lane, 9) === 8);
check('easing shapes', near(laneValue(lane, 2)!, 5, 1e-6) && laneValue(lane, 4.9) === 10 && near(laneValue(lane, 6)!, 6, 0.6));
// clamp: base + Σ routes clamped to the spec range; a lane replaces base
const spec: ParamSpec[] = [{ key: 'k', label: 'k', group: 'g', type: 'range', min: 0, max: 1, default: 0.5, live: true }];
const big = { ...route, source: 'constant' as const, amount: 1 };
const r = new Modulation(a, null).apply('x', { k: 0.8 }, spec, [big], [], 10);
check('clamp at the range maximum', r?.k === 1);
const r2 = new Modulation(a, null).apply('x', { k: 0.8 }, spec, [], [{ ...lane, keys: [{ t: 0, v: 0.2, ease: 'linear' }] }], 10);
check('a lane replaces the base value', r2?.k === 0.2);
check('curves', shapeCurve(0.5, 'exp') === 0.25 && near(shapeCurve(0.25, 'log'), 0.5, 1e-9) && shapeCurve(0.6, 'step') === 2 / 3);
done();

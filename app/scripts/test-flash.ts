// The photosensitivity analysis (SPEC §10.3) on synthetic frame sequences: counts flashes, finds violations,
// and the attenuation curve removes them.
import { check, done } from './lib/check.ts';
import { analyseFlashes, buildAttenuation, CELLS, type GuardFrame } from '../src/render/flashguard.ts';

const fps = 30;
const frame = (lum: number, red = 0, cells = CELLS): GuardFrame => { const l = new Float32Array(CELLS).fill(0.05), r = new Float32Array(CELLS); for (let c = 0; c < cells; c++) { l[c] = lum; r[c] = red; } return { lum: l, red: r }; };
// 8 full-screen flashes in 2 s (4 Hz): a violation
const strobe: GuardFrame[] = [];
for (let i = 0; i < 150; i++) strobe.push(frame(i >= 45 && i < 105 && Math.floor((i - 45) / 4) % 2 === 0 ? 0.9 : 0.05));
const rep = analyseFlashes(strobe, fps);
check('a 4 Hz full-frame strobe violates', rep.violations.length > 0 && rep.maxFlashesPerSecond > 3, `${rep.maxFlashesPerSecond} flashes/s`);
// 2 flashes per second: allowed
const slow: GuardFrame[] = [];
for (let i = 0; i < 90; i++) slow.push(frame(Math.floor(i / 8) % 2 === 0 ? 0.9 : 0.05));
check('2 flashes per second pass', analyseFlashes(slow, fps).violations.length === 0, `${analyseFlashes(slow, fps).maxFlashesPerSecond} flashes/s`);
// a strobe over less than 25 % of the frame: allowed
const small: GuardFrame[] = [];
for (let i = 0; i < 90; i++) small.push(frame(Math.floor(i / 4) % 2 === 0 ? 0.9 : 0.05, 0, 3));
check('a small-area strobe passes', analyseFlashes(small, fps).violations.length === 0);
// a red strobe
const red: GuardFrame[] = [];
for (let i = 0; i < 90; i++) red.push(frame(0.1, Math.floor(i / 4) % 2 === 0 ? 0.8 : 0));
check('a saturated-red strobe violates', analyseFlashes(red, fps).violations.length > 0);
// attenuation: scale the strobe's contrast by a(t) and re-measure
const att = buildAttenuation(strobe.length, fps, rep, 0.08);
const fixed = strobe.map((f, i) => ({ lum: f.lum.map((v) => 0.05 + (v - 0.05) * att[i]), red: f.red }));
check('attenuation removes the violation', analyseFlashes(fixed, fps).violations.length === 0, `min a = ${Math.min(...att).toFixed(2)}`);
check('attenuation leaves calm passages alone', att[0] === 1 && att[att.length - 1] === 1);
done();

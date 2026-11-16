// Generates the four small .cube LUTs (17³) shipped in public/luts (SPEC §2, §10.1).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'luts');
mkdirSync(OUT, { recursive: true });
const N = 17;
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp = (x) => Math.max(0, Math.min(1, x));
const sCurve = (x, k) => { const t = clamp(x); return t + k * (t * t * (3 - 2 * t) - t); };
const LOOKS = {
  'warm-film': (r, g, b) => { const l = lum(r, g, b); const sh = 1 - l;
    return [sCurve(r * 1.04 + 0.02 * sh, 0.5), sCurve(g * 1.0 + 0.012 * sh, 0.45), sCurve(b * 0.9 + 0.035 * sh, 0.4)].map((v, i) => clamp(0.03 + 0.97 * v - (i === 2 ? 0.02 * l : 0))); },
  bleach: (r, g, b) => { const l = lum(r, g, b); const mix = (c) => clamp(sCurve(c * 0.55 + l * 0.45, 0.9) * 1.03); return [mix(r), mix(g), mix(b)]; },
  'teal-orange': (r, g, b) => { const l = lum(r, g, b); const w = l * l * (3 - 2 * l);
    return [clamp(sCurve(r + 0.07 * w - 0.05 * (1 - w), 0.35)), clamp(sCurve(g + 0.01 * w + 0.02 * (1 - w), 0.35)), clamp(sCurve(b - 0.08 * w + 0.07 * (1 - w), 0.35))]; },
  mono: (r, g, b) => { const l = sCurve(lum(r, g, b), 0.6); return [clamp(l * 1.02), clamp(l), clamp(l * 0.97)]; },
};
for (const [name, fn] of Object.entries(LOOKS)) {
  let s = `TITLE "${name}"\nLUT_3D_SIZE ${N}\nDOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n`;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) s += fn(r / (N - 1), g / (N - 1), b / (N - 1)).map((v) => v.toFixed(5)).join(' ') + '\n';
  writeFileSync(join(OUT, `${name}.cube`), s);
}
console.log(`LUTs written to ${OUT}`);

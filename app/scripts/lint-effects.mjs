// Build-time effect lint (SPEC §15): every effect must render a mask, must not use Math.random or Date in render
// paths, and SDK effects must pass renderMask to defineEffect. Fails the build with a list of offences.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'effects');
const files = [
  ...readdirSync(root).filter((f) => f.endsWith('.ts') && !['types.ts', 'registry.ts', 'index.ts', 'common.ts', 'sdk.ts'].includes(f)).map((f) => join(root, f)),
  ...(existsSync(join(root, 'user')) ? readdirSync(join(root, 'user')).filter((f) => f.endsWith('.ts')).map((f) => join(root, 'user', f)) : []),
];
const bad = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const name = f.slice(root.length + 1);
  if (src.includes('defineEffect(') || src.includes('defineEffect<')) {
    if (!/\brenderMask\s*[(:]/.test(src)) bad.push(`${name}: defineEffect without renderMask`);
  } else if (/registerEffect\(/.test(src)) {
    if (!/protected (draw|drawGL|paint)\(t: number, [^)]*mask: boolean\)/.test(src)) bad.push(`${name}: draw()/drawGL()/paint() must take and honour the mask flag`);
  } else continue;
  if (/Math\.random\s*\(/.test(src)) bad.push(`${name}: Math.random() — use the seeded kit.seed(n) / hash01 (render must be a pure function of t)`);
  if (/\b(Date\.now|performance\.now)\s*\(/.test(src)) bad.push(`${name}: wall-clock time in an effect — use t`);
}
if (bad.length) { console.error('effect lint failed:\n  ' + bad.join('\n  ')); process.exit(1); }
console.log(`effect lint: ${files.length} effects ok`);

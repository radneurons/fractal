// Scaffold an SDK effect (SPEC §15):  npm run new-effect <name>
//   src/effects/user/<name>.ts        a working copy of the RISE example, renamed
//   scripts/e2e-effect-<name>.mjs     renders it at 4 times, in two orders and after a re-prepare: must match bit-exactly
//   docs/EFFECTS.md                   an entry under "User effects"
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = process.argv[2];
if (!raw) { console.error('usage: npm run new-effect <name>   (e.g. npm run new-effect tide)'); process.exit(1); }
const id = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
if (!/^[a-z][a-z0-9-]*$/.test(id)) { console.error(`"${raw}" does not make a valid id (letters, digits, dashes; starts with a letter)`); process.exit(1); }
const file = join(root, 'src/effects/user', `${id}.ts`);
if (existsSync(file)) { console.error(`${file} already exists`); process.exit(1); }
const title = id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

let src = readFileSync(join(root, 'src/effects/user/rise.ts'), 'utf8');
src = src
  .replace(/^\/\/ RISE[^\n]*\n(\/\/[^\n]*\n)*/, `// ${title.toUpperCase()} — scaffolded from the RISE example by \`npm run new-effect\`. See docs/EFFECTS.md.\n`)
  .replace("id: 'rise'", `id: '${id}'`)
  .replace("name: 'Rise (SDK example)'", `name: '${title}'`)
  .replace(/description: '[^']*'/, `description: '${title}: describe what it looks like in one sentence.'`)
  .replace(/\s*\/\/ low everywhere[^\n]*\n\s*affinity: \{[^}]*\},/, `\n  // 0..1: how well it suits each kind of section (the Auto-Director's dot product, SPEC §8.0)\n  affinity: { energyHigh: 0.5, energyLow: 0.5, speech: 0.5, denseLyrics: 0.5, sparseLyrics: 0.5, darkMood: 0.5, brightMood: 0.5, fastTempo: 0.5 },`);
writeFileSync(file, src);

const test = join(root, 'scripts', `e2e-effect-${id}.mjs`);
writeFileSync(test, `// Determinism + mask check for the ${title} effect (scaffolded). Run after \`npx vite build\`:  node scripts/e2e-effect-${id}.mjs
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, [join(here, 'e2e-effect.mjs'), '--effects', '${id}', '--times', '2.5,9.1,20.3,41.7'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
`);

const docs = join(root, '..', 'docs', 'EFFECTS.md');
if (existsSync(docs)) appendFileSync(docs, `\n### ${title} (\`${id}\`)\n\nScaffolded ${new Date().toISOString().slice(0, 10)}. File: \`app/src/effects/user/${id}.ts\`. Check: \`node scripts/e2e-effect-${id}.mjs\`.\n`);

console.log(`created
  src/effects/user/${id}.ts
  scripts/e2e-effect-${id}.mjs
  docs/EFFECTS.md entry
next: npm run dev (the effect appears at the end of the grid and hot-reloads), then npx vite build && node scripts/e2e-effect-${id}.mjs`);

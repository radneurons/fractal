// Bundles every scripts/test-*.ts with esbuild and runs it with Node. `npm test [filter]`
import { build } from 'esbuild';
import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const filter = process.argv[2] ?? '';
if (!existsSync(join(root, 'public/demo/demo-song.wav')) || !existsSync(join(root, 'public/demo/demo-waltz.wav'))) {
  const r = spawnSync(process.execPath, [join(here, 'make-fixtures.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(1);
}
const tests = readdirSync(here).filter((f) => /^test-.*\.ts$/.test(f) && f.includes(filter)).sort();
mkdirSync(join(root, '.cache/tests'), { recursive: true });
let failed = 0;
for (const t of tests) {
  const out = join(root, '.cache/tests', t.replace(/\.ts$/, '.mjs'));
  await build({ entryPoints: [join(here, t)], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', external: ['@huggingface/transformers', 'onnxruntime-node', 'sharp'] });
  console.log(`\n━━ ${t}`);
  const r = spawnSync(process.execPath, [out], { stdio: 'inherit', cwd: root });
  if (r.status !== 0) { failed++; console.log(`✗ ${t} failed`); }
}
console.log(failed ? `\n${failed} test file(s) failed` : `\nall ${tests.length} test file(s) passed`);
process.exit(failed ? 1 : 0);

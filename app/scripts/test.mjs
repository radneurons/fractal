// Test runner: bundles each scripts/test-*.ts with esbuild (ships with Vite) and runs it with node.
import { build } from 'esbuild';
import { readdirSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
mkdirSync('out/tests', { recursive: true });
const tests = readdirSync('scripts').filter(f => /^test-.*\.ts$/.test(f));
let failed = 0;
for (const f of tests) {
  const outfile = `out/tests/${f.replace(/\.ts$/, '.mjs')}`;
  await build({ entryPoints: [`scripts/${f}`], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error' });
  console.log(`\n── ${f}`);
  const r = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} test file(s) failed` : '\nall tests passed');
process.exit(failed ? 1 : 0);

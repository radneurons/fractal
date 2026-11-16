// Run a TypeScript tool: node scripts/run.mjs scripts/tools/<name>.ts [args…]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [entry, ...args] = process.argv.slice(2);
mkdirSync(join(root, '.cache/tools'), { recursive: true });
const out = join(root, '.cache/tools', basename(entry).replace(/\.ts$/, '.mjs'));
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', external: ['@huggingface/transformers', 'onnxruntime-node', 'sharp'] });
const r = spawnSync(process.execPath, ['--max-old-space-size=8192', out, ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);

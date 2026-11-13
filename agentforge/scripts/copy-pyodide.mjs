// Copies the Pyodide runtime into public/pyodide so Python exercises run fully offline (no CDN).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pyodide');
const dest = join(root, 'public', 'pyodide');
const files = ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
if (!existsSync(src)) {
  console.error('pyodide is not installed — run npm install');
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const f of files) cpSync(join(src, f), join(dest, f));
console.log(`Copied Pyodide runtime to public/pyodide (${files.length} files)`);

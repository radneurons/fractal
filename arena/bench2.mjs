import { chromium } from 'playwright';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const file = process.argv[2], times = process.argv[3].split(',').map(Number);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto('file://' + path.join(here, file) + '?capture'); await p.evaluate(() => window.ready);
for (const t of times) {
  const r = await p.evaluate(t => { const c = document.getElementById('c'); const gl = c.getContext('webgl2'); const a = performance.now(); window.seek(t); const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const b = performance.now(); return b - a; }, t);
  console.log(t, 'render+readPixels', r.toFixed(0), 'ms');
}
await b.close();

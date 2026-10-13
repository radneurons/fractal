// Export smoke test: renders a short clip via the app's exporter and saves it.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const [, , effect = 'elements', fmt = 'mp4', start = '24', len = '2', res = '720', fps = '24', out = 'out/e2e'] = process.argv;
mkdirSync(out, { recursive: true });
const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('console.error', m.text()); });
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.LE);
await page.evaluate(() => window.LE.loadDemo());
await page.evaluate(id => window.LE.setEffect(id), effect);
await page.evaluate(() => window.LE.whenReady());
const t0 = Date.now();
const r = await page.evaluate(o => window.LE.exportClip(o), { res: +res, fps: +fps, start: +start, len: +len, mbps: 8, format: fmt });
console.log('export', JSON.stringify(r), (Date.now() - t0) / 1000, 's');
if (r) {
  const b64 = await page.evaluate(async url => { const b = await (await fetch(url)).blob(); const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192)); return btoa(s); }, r.url);
  writeFileSync(`${out}/export_${effect}.${fmt}`, Buffer.from(b64, 'base64'));
}
await browser.close();

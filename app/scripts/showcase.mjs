// Renders the demo song as a reel through all eight effects via the app's own exporter.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const [, , out = 'out/showcase/reel.mp4', res = '720', fps = '30', aspect = '16:9'] = process.argv;
mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('console.error', m.text()); });
await page.goto(process.env.LE_URL ?? 'http://localhost:4173/'); await page.waitForFunction(() => window.LE);
await page.evaluate(a => { window.LE.state.settings.aspect = a; }, aspect);
await page.evaluate(() => window.LE.loadDemo());
await page.evaluate(() => window.LE.setPlan([
  { start: 0, end: 8, effect: 'mission' }, { start: 8, end: 16, effect: 'broadside' }, { start: 16, end: 24, effect: 'press' },
  { start: 24, end: 32, effect: 'elements' }, { start: 32, end: 40, effect: 'chrome' }, { start: 40, end: 48, effect: 'droste' },
  { start: 48, end: 56, effect: 'swarm' }, { start: 56, end: 64, effect: 'popup' }, { start: 64, end: 73, effect: 'mission' }
], 'flash'));
await page.waitForTimeout(200);
console.log('ready', await page.evaluate(() => window.LE.whenReady()));
const t0 = Date.now();
const r = await page.evaluate(o => window.LE.exportClip(o), { res: +res, fps: +fps, start: 0, len: 999, mbps: 10, format: 'mp4' });
console.log('export', JSON.stringify(r), ((Date.now() - t0) / 60000).toFixed(1), 'min');
if (r) {
  const b64 = await page.evaluate(async url => { const b = await (await fetch(url)).blob(); const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192)); return btoa(s); }, r.url);
  writeFileSync(out, Buffer.from(b64, 'base64'));
}
await browser.close();

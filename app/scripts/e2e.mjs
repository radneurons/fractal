// End-to-end smoke test: build is served by `vite preview`; loads the demo, renders stills per effect.
// usage: node scripts/e2e.mjs [effectId|all] [times comma-separated] [outDir]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const [, , which = 'all', timesArg = '2,9.2,24.6,28.6,33,41.5,48.6,60,72.5', out = 'out/e2e', aspect = '16:9', url = 'http://localhost:4173/'] = process.argv;
mkdirSync(out, { recursive: true });
const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); else console.log('  [page]', m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto(url);
await page.waitForFunction(() => window.LE);
await page.evaluate(a => { window.LE.state.settings.aspect = a; }, aspect);
let t0 = Date.now();
await page.evaluate(() => window.LE.loadDemo());
console.log('demo loaded in', Date.now() - t0, 'ms');
const ids = which === 'all' ? await page.evaluate(() => window.LE.state && Object.keys(window.LE.state.params)) : which.split(',');
const times = timesArg.split(',').map(Number);
for (const id of ids) {
  t0 = Date.now();
  await page.evaluate(id => window.LE.setEffect(id), id);
  await page.waitForTimeout(50);
  const ok = await page.evaluate(() => window.LE.whenReady());
  console.log(`${id}: prepared ${ok} in ${Date.now() - t0} ms`);
  for (const t of times) {
    const t1 = Date.now();
    const png = await page.evaluate(t => { window.LE.renderAt(t); return window.LE.stage.canvas.toDataURL('image/png'); }, t);
    writeFileSync(`${out}/${id}_${String(t).replace('.', '_')}.png`, Buffer.from(png.split(',')[1], 'base64'));
    console.log(`  t=${t}  ${Date.now() - t1} ms`);
  }
}
await page.screenshot({ path: `${out}/ui.png` });
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();

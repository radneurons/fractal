// Director mode: one effect per section with transitions; renders around section boundaries + a UI screenshot.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const out = process.argv[2] ?? 'out/director'; mkdirSync(out, { recursive: true });
const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(process.argv[3] ?? 'http://localhost:4173/'); await page.waitForFunction(() => window.LE);
await page.evaluate(() => window.LE.loadDemo());
await page.evaluate(() => { window.LE.state.transition = 'flash'; window.LE.setMode('director'); });
await page.waitForTimeout(100);
console.log('ready', await page.evaluate(() => window.LE.whenReady()));
console.log('plan', JSON.stringify(await page.evaluate(() => window.LE.stage.plan)));
for (const t of [7.9, 8.05, 23.9, 24.08, 40.1, 48.1, 62.2, 66]) {
  const png = await page.evaluate(t => { window.LE.renderAt(t); return window.LE.stage.canvas.toDataURL('image/png'); }, t);
  writeFileSync(`${out}/dir_${String(t).replace('.', '_')}.png`, Buffer.from(png.split(',')[1], 'base64'));
}
await page.evaluate(() => { window.LE.player.seek(26); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/ui.png` });
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no errors');
await browser.close();

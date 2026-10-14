// Hybrid smoke test: layout effects with each material, and overlay pairings; saves stills.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const out = process.argv[2] ?? 'out/hybrid', url = process.argv[3] ?? 'http://localhost:4173/'; mkdirSync(out, { recursive: true });
const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await page.goto(url); await page.waitForFunction(() => window.LE);
await page.evaluate(() => window.LE.loadDemo()); await page.evaluate(() => window.LE.whenReady());
const cases = [
  ['broadside', { id: 'chrome' }, null, 24.6], ['broadside', { id: 'fire' }, null, 24.6], ['broadside', { id: 'engrave', backdrop: 'material' }, null, 13],
  ['broadside', { id: 'neon', backdrop: 'material' }, null, 13], ['broadside', { id: 'halftone' }, null, 28.6], ['broadside', { id: 'stardust', backdrop: 'material' }, null, 28.6],
  ['mission', { id: 'fire' }, null, 24.6], ['droste', { id: 'engrave', backdrop: 'material' }, null, 13], ['popup', { id: 'chrome' }, null, 24.6],
  ['press', { id: 'off' }, { effect: 'swarm', blend: 'screen', opacity: .8 }, 24.6], ['broadside', { id: 'off' }, { effect: 'elements', blend: 'screen', opacity: .7 }, 24.6],
  ['broadside', { id: 'off' }, { effect: 'off' }, 24.6]
];
let k = 0;
for (const [eff, mat, ov, t] of cases) {
  await page.evaluate(([e, m, o]) => { window.LE.setEffect(e); window.LE.setHybrid({ backdrop: 'layout', strength: 1, ...m }, o ?? { effect: 'off' }); }, [eff, mat, ov]);
  await page.waitForTimeout(80); await page.evaluate(() => window.LE.whenReady());
  const png = await page.evaluate(t => { window.LE.renderAt(t); return window.LE.stage.canvas.toDataURL('image/png'); }, t);
  writeFileSync(`${out}/h_${String(k).padStart(2, '0')}_${eff}_${mat.id}${ov && ov.effect !== 'off' ? '+' + ov.effect : ''}.png`, Buffer.from(png.split(',')[1], 'base64')); k++;
}
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no errors');
await browser.close();

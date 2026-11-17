// Determinism (SPEC §17): for every effect, render t = 31.4 directly, after 10 other random times, and after a
// re-prepare; all three must be pixel-identical (hash of getImageData). Also after toggling a material and back.
import { createHash } from 'node:crypto';
import { startServer, openApp, args } from './lib/browser.mjs';

const a = args({ t: '31.4', res: '360' });
const server = await startServer(Number(a.port ?? 4181));
// ?soft2d = the export raster path (Stage sets it whenever forcedSize is set). Accelerated 2D canvases keep a
// glyph cache whose state depends on what was drawn before, so preview frames may differ by a few AA levels.
const { browser, page } = await openApp({ url: server.url + '?soft2d' });
let failed = 0;
const hash = async () => createHash('sha1').update(Buffer.from(await page.evaluate(() => {
  const c = document.getElementById('stage');
  const g = c.getContext('2d');
  return Array.from(g.getImageData(0, 0, c.width, c.height).data);
}))).digest('hex').slice(0, 12);
try {
  await page.evaluate((res) => { window.LE.state.previewRes = Number(res); }, a.res);
  await page.evaluate(() => window.LE.loadDemo());
  const effects = a.effects ? a.effects.split(',') : await page.evaluate(() => window.LE.effects().map((e) => e.id));
  const T = Number(a.t);
  for (const id of effects) {
    await page.evaluate((e) => window.LE.setEffect(e), id);
    await page.evaluate(() => window.LE.whenReady());
    await page.evaluate((t) => window.LE.renderAt(t), T);
    const h1 = await hash();
    for (let i = 0; i < 10; i++) await page.evaluate((t) => window.LE.renderAt(t), ((i * 7.31) % 70) + 0.37);
    await page.evaluate((t) => window.LE.renderAt(t), T);
    const h2 = await hash();
    // re-prepare: change a non-live setting and back
    await page.evaluate(() => { window.LE.setSetting('seed', 1777); });
    await page.evaluate(() => window.LE.whenReady());
    await page.evaluate(() => { window.LE.setSetting('seed', 1776); });
    await page.evaluate(() => window.LE.whenReady());
    await page.evaluate((t) => window.LE.renderAt(t), T);
    const h3 = await hash();
    // material on and off
    await page.evaluate(() => window.LE.setHybrid({ material: { kind: 'chrome' } }));
    await page.evaluate(() => window.LE.whenReady());
    await page.evaluate((t) => window.LE.renderAt(t), T);
    await page.evaluate(() => window.LE.setHybrid({ material: null }));
    await page.evaluate(() => window.LE.whenReady());
    await page.evaluate((t) => window.LE.renderAt(t), T);
    const h4 = await hash();
    const ok = h1 === h2 && h2 === h3 && h3 === h4;
    if (!ok) failed++;
    console.log(`  ${id.padEnd(10)} ${ok ? 'deterministic' : `DIFFERS ${h1} ${h2} ${h3} ${h4}`}`);
  }
} finally { await browser.close(); server.stop(); }
console.log(failed ? `${failed} effect(s) not deterministic` : 'all effects deterministic');
process.exit(failed ? 1 : 0);

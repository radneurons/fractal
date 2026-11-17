// Determinism check for one or more effects (used by `npm run new-effect` scaffolds and CI):
//   node scripts/e2e-effect.mjs --effects rise[,other] [--times 2.5,9.1,20.3,41.7]
// Renders each time, then the same times in reverse order and after a re-prepare; every pair must match bit-exactly.
// Also checks that the mask is non-empty while words are on screen.
import { createHash } from 'node:crypto';
import { startServer, openApp, args } from './lib/browser.mjs';

const a = args({ effects: 'rise', times: '2.5,9.1,20.3,41.7', res: '360' });
const server = await startServer(Number(a.port ?? 4185));
const { browser, page, errors } = await openApp({ url: server.url + '?soft2d' });
let failed = 0;
const pixels = () => page.evaluate(() => {
  const c = document.getElementById('stage');
  return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
});
/** share of stage pixels lit by the word mask at t */
const maskLit = (t) => page.evaluate((x) => {
  window.LE.renderMaskAt(x);
  const c = document.getElementById('stage'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 128) lit++;
  return lit / (d.length / 4);
}, t);
const hash = (px) => createHash('sha1').update(Buffer.from(px)).digest('hex').slice(0, 12);
try {
  await page.evaluate((r) => { window.LE.state.previewRes = Number(r); }, a.res);
  await page.evaluate(() => window.LE.loadDemo());
  const times = a.times.split(',').map(Number);
  for (const id of a.effects.split(',')) {
    await page.evaluate((e) => window.LE.setEffect(e), id);
    await page.evaluate(() => window.LE.whenReady());
    const render = async (t) => { await page.evaluate((x) => window.LE.renderAt(x), t); return hash(await pixels()); };
    const first = []; for (const t of times) first.push(await render(t));
    const rev = []; for (const t of [...times].reverse()) rev.unshift(await render(t));
    await page.evaluate(() => { window.LE.setSetting('seed', 4242); }); await page.evaluate(() => window.LE.whenReady());
    await page.evaluate(() => { window.LE.setSetting('seed', 1776); }); await page.evaluate(() => window.LE.whenReady());
    const again = []; for (const t of times) again.push(await render(t));
    const ok = first.every((h, i) => h === rev[i] && h === again[i]);
    const distinct = new Set(first).size;
    let lit = 0; for (const t of times) if ((await maskLit(t)) > 0.0005) lit++;
    console.log(`  ${id.padEnd(10)} ${ok ? 'deterministic' : 'DIFFERS'}  (${distinct} distinct frames, mask lit at ${lit}/${times.length} times)`);
    if (!ok || distinct < 2 || lit === 0) failed++;
  }
  const errs = [...errors, ...(await page.evaluate(() => window.LE.errors))].filter((e) => !/ResizeObserver loop/.test(e));
  if (errs.length) { console.log('errors:\n' + errs.slice(0, 5).join('\n')); failed++; }
} finally { await browser.close(); server.stop(); }
if (failed) { console.log(`${failed} effect check(s) failed`); process.exit(1); }
console.log('effect checks passed');

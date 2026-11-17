// Screenshot of the whole UI:  node scripts/ui-shot.mjs [--effect broadside] [--t 26.4] [--tab Layers] [--out out/ui.png]
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { startServer, openApp, args, ROOT } from './lib/browser.mjs';
const a = args({ effect: 'broadside', t: '26.4', out: 'out/ui.png', song: 'demo-song', width: '1500', height: '940' });
const out = resolve(ROOT, a.out);
mkdirSync(dirname(out), { recursive: true });
const server = await startServer(Number(a.port ?? 4173));
const { browser, page, errors } = await openApp({ url: server.url, width: Number(a.width), height: Number(a.height) });
try {
  if (a.empty !== 'true') {
    await page.evaluate((n) => window.LE.loadDemo(n), a.song);
    await page.evaluate((e) => window.LE.setEffect(e), a.effect);
    await page.evaluate(() => window.LE.whenReady());
    await page.evaluate((t) => { window.LE.player.seek(t); }, Number(a.t));
    if (a.js) await page.evaluate((code) => new Function('LE', code)(window.LE), a.js);
    if (a.tab) await page.getByRole('tab', { name: a.tab }).click();
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: out });
  console.log(out);
  const all = [...errors, ...(await page.evaluate(() => window.LE.errors))].filter((e) => !/ResizeObserver loop/.test(e));
  if (all.length) { console.log('ERRORS:\n' + all.slice(0, 8).join('\n')); process.exitCode = 1; }
} finally { await browser.close(); server.stop(); }

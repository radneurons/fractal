// e2e: every effect at chosen times, frames + word masks, in 16:9, 9:16 and 1:1; fails on any console or page error.
// Contact sheets go to out/e2e/sheet-<aspect>.png.   node scripts/e2e.mjs [--aspects 16:9,9:16] [--effects a,b]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startServer, openApp, grab, args, ROOT } from './lib/browser.mjs';

const a = args({ aspects: '16:9,9:16,1:1', times: '9.6,26.6,43,48.4', res: '360' });
const out = join(ROOT, 'out/e2e');
mkdirSync(out, { recursive: true });
const server = await startServer(Number(a.port ?? 4180));
const { browser, page, errors } = await openApp({ url: server.url });
let failed = 0;
try {
  await page.evaluate(() => window.LE.loadDemo());
  const effects = a.effects ? a.effects.split(',') : await page.evaluate(() => window.LE.effects().map((e) => e.id));
  console.log(`${effects.length} effects`);
  for (const aspect of a.aspects.split(',')) {
    await page.evaluate(([asp, res]) => { window.LE.state.previewRes = Number(res); window.LE.setSetting('aspect', asp); }, [aspect, a.res]);
    const files = [];
    for (const id of effects) {
      const before = errors.length;
      const t0 = Date.now();
      try {
        await page.evaluate((e) => window.LE.setEffect(e), id);
        await page.evaluate(() => window.LE.whenReady());
        for (const t of a.times.split(',').map(Number)) {
          await page.evaluate((tt) => window.LE.renderAt(tt), t);
          const f = join(out, `${aspect.replace(':', 'x')}-${id}-${t}.png`);
          writeFileSync(f, await grab(page));
          files.push(f);
        }
        await page.evaluate(() => window.LE.renderMaskAt(26.6));
        const fm = join(out, `${aspect.replace(':', 'x')}-${id}-mask.png`);
        writeFileSync(fm, await grab(page));
        files.push(fm);
      } catch (e) { errors.push(`${id}: ${String(e).slice(0, 300)}`); }
      const errs = [...errors.slice(before), ...(await page.evaluate(() => window.LE.errors.splice(0)))].filter((x) => !/ResizeObserver/.test(x));
      const status = errs.length ? `FAIL ${errs[0].slice(0, 200)}` : 'ok';
      if (errs.length) failed++;
      console.log(`  ${aspect} ${id.padEnd(10)} ${String(Date.now() - t0).padStart(5)} ms  ${status}`);
    }
    const cols = a.times.split(',').length + 1;
    spawnSync('python3', [join(ROOT, 'scripts/sheet.py'), join(out, `sheet-${aspect.replace(':', 'x')}.png`), String(cols), aspect === '9:16' ? '150' : '260', ...files], { stdio: 'inherit' });
  }
} finally { await browser.close(); server.stop(); }
console.log(failed ? `${failed} effect run(s) failed` : 'all effects rendered without errors');
process.exit(failed ? 1 : 0);

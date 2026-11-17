// Performance (SPEC §17): median and 95th-percentile render ms per effect at 720p, against a stored baseline from
// the same machine (test/perf-baseline.json, keyed by a machine fingerprint). Fails only on a > 30 % regression.
// Headless SwiftShader numbers are not comparable to real GPUs; a new machine just records its first baseline.
//   node scripts/e2e-perf.mjs [--update] [--frames 40] [--res 720]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { cpus, hostname } from 'node:os';
import { createHash } from 'node:crypto';
import { startServer, openApp, args, ROOT } from './lib/browser.mjs';

const a = args({ frames: '40', res: '720' });
const update = process.argv.includes('--update');
const file = resolve(ROOT, 'test/perf-baseline.json');
mkdirSync(dirname(file), { recursive: true });
const machine = createHash('sha1').update(`${cpus()[0]?.model}|${cpus().length}|${hostname().replace(/[-_][a-z0-9]{5,}$/i, '')}|swiftshader`).digest('hex').slice(0, 12);
const base = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const server = await startServer(Number(a.port ?? 4197));
const { browser, page } = await openApp({ url: server.url });
const rows = {};
let failed = 0;
try {
  await page.evaluate((r) => { window.LE.state.previewRes = Number(r); }, a.res);
  await page.evaluate(() => window.LE.loadDemo());
  const effects = await page.evaluate(() => window.LE.effects().map((e) => e.id));
  for (const id of effects) {
    await page.evaluate((e) => window.LE.setEffect(e), id);
    await page.evaluate(() => window.LE.whenReady());
    const ms = await page.evaluate((n) => {
      const out = [], dur = window.LE.song.analysis.duration;
      window.LE.renderAt(10); // warm-up (shader compiles, atlases)
      window.LE.stage.canvas.getContext('2d').getImageData(0, 0, 1, 1);
      for (let i = 0; i < n; i++) {
        const t = 8 + ((i * 7.919) % (dur - 12));
        const t0 = performance.now();
        window.LE.renderAt(t);
        window.LE.stage.canvas.getContext('2d').getImageData(0, 0, 1, 1); // force the GPU to finish
        out.push(performance.now() - t0);
      }
      return out.sort((x, y) => x - y);
    }, Number(a.frames));
    const med = ms[Math.floor(ms.length / 2)], p95 = ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))];
    rows[id] = { median: Number(med.toFixed(1)), p95: Number(p95.toFixed(1)) };
    const b = base[machine]?.effects?.[id];
    let verdict = 'baseline recorded';
    if (b && !update) {
      const worse = med > b.median * 1.3 && med - b.median > 2;
      verdict = worse ? `REGRESSION (baseline ${b.median} ms)` : `ok (baseline ${b.median} ms)`;
      if (worse) failed++;
    }
    console.log(`  ${id.padEnd(10)} median ${med.toFixed(1).padStart(6)} ms  p95 ${p95.toFixed(1).padStart(6)} ms  ${verdict}`);
  }
} finally { await browser.close(); server.stop(); }
if (update || !base[machine]) { base[machine] = { recorded: new Date().toISOString().slice(0, 10), res: Number(a.res), note: 'headless Chromium + SwiftShader; not comparable to real GPUs', effects: { ...(base[machine]?.effects ?? {}), ...rows } }; writeFileSync(file, JSON.stringify(base, null, 1) + '\n'); console.log(`  baseline for machine ${machine} written to test/perf-baseline.json`); }
console.log(failed ? `${failed} effect(s) regressed > 30 %` : 'performance ok');
process.exit(failed ? 1 : 0);

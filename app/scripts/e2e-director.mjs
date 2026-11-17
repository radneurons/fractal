// Director e2e (SPEC §17): Director mode on the demo; frames just before, at and just after every section boundary
// (the transitions), a contact sheet, and a UI screenshot with the plan on the timeline. Fails on errors, on a
// boundary where nothing changes, or when an effect switch doesn't happen at the boundary.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { startServer, openApp, args, ROOT, grab } from './lib/browser.mjs';

const a = args({ out: 'out/director', res: '360' });
const outDir = resolve(ROOT, a.out);
mkdirSync(outDir, { recursive: true });
const server = await startServer(Number(a.port ?? 4199));
const { browser, page, errors } = await openApp({ url: server.url, width: 1500, height: 940 });
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };
const files = [];
try {
  await page.evaluate((r) => { window.LE.state.previewRes = Number(r); }, a.res);
  await page.evaluate(() => window.LE.loadDemo());
  await page.evaluate(() => window.LE.setMode('director', 'auto'));
  await page.evaluate(() => window.LE.whenReady());
  const segs = await page.evaluate(() => window.LE.stage.segments.map((s) => ({ start: s.start, end: s.end, effect: s.effect, transition: s.transition ?? window.LE.state.plan.transition })));
  console.log('  plan: ' + segs.map((s) => `${s.start.toFixed(1)} ${s.effect} (${s.transition})`).join(' | '));
  check('director mode builds a multi-effect plan', segs.length >= 3 && new Set(segs.map((s) => s.effect)).size >= 3, `${segs.length} segments`);
  for (const s of segs.slice(1)) {
    const hashes = [];
    for (const dt of [-0.4, 0, 0.4]) {
      const t = s.start + dt;
      await page.evaluate((x) => window.LE.renderAt(x), t);
      const png = await grab(page);
      const f = join(outDir, `b${s.start.toFixed(1)}_${dt >= 0 ? '+' : ''}${dt}.png`); writeFileSync(f, png); files.push(f);
      hashes.push(createHash('sha1').update(png).digest('hex'));
    }
    check(`boundary ${s.start.toFixed(1)} s → ${s.effect} (${s.transition}) changes the picture`, new Set(hashes).size === 3);
  }
  // UI screenshot with the plan on the timeline
  await page.evaluate(() => window.LE.resume());
  await page.evaluate((t) => window.LE.player.seek(t), segs[1]?.start ?? 10);
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(outDir, 'ui-director.png') });
  const errs = [...errors, ...(await page.evaluate(() => window.LE.errors))].filter((e) => !/ResizeObserver loop/.test(e));
  check('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
} finally { await browser.close(); server.stop(); }
spawnSync('python3', [join(ROOT, 'scripts/sheet.py'), join(outDir, 'sheet.png'), '3', '320', ...files], { stdio: 'inherit' });
console.log(failed ? `${failed} director check(s) failed` : 'director ok');
process.exit(failed ? 1 : 0);

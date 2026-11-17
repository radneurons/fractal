// Showcase reel v3 (SPEC §17), everything through the app's own exporter:
//   out/showcase/demo-auto-1776.mp4   the demo song through the Auto-Director, seed 1776 (16:9)
//   out/showcase/demo-9x16.mp4        a 9:16 cut (the first chorus into the breakdown)
//   out/showcase/waltz-karaoke.mp4    KARAOKE on the waltz, with its translation
//   out/showcase/effects-sheet.png    a contact sheet of every effect
//   node scripts/showcase.mjs [--res 720] [--out out/showcase]
import { mkdirSync, openSync, writeSync, closeSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startServer, openApp, args, ROOT, grab } from './lib/browser.mjs';

const a = args({ res: '720', out: 'out/showcase', quality: '6' });
const outDir = resolve(ROOT, a.out);
mkdirSync(outDir, { recursive: true });
const server = await startServer(Number(a.port ?? 4198));
const { browser, page, errors } = await openApp({ url: server.url });
page.setDefaultTimeout(0);
page.on('console', (m) => { if (m.text().startsWith('export ')) console.log('    ' + m.text()); });

async function exportTo(name, o) {
  const t0 = Date.now();
  const r = await page.evaluate((x) => window.LE.exportClip({ ...x, chunked: true }), { format: 'mp4', fps: 30, quality: Number(a.quality), res: Number(a.res), ...o });
  const f = join(outDir, name), fd = openSync(f, 'w');
  for (let off = 0; off < r.bytes; off += 8 << 20) writeSync(fd, Buffer.from(await page.evaluate(([p, l]) => window.LE.readExport(p, l), [off, 8 << 20]), 'base64'));
  closeSync(fd);
  console.log(`  ${name}: ${r.width}×${r.height}, ${r.frames} frames, ${(r.bytes / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
try {
  // 1. the demo through the Auto-Director
  await page.evaluate(() => window.LE.loadDemo());
  const plan = await page.evaluate(() => window.LE.autoDirect(1776, true).segments.map((s) => `${s.start.toFixed(1)}–${s.end.toFixed(1)} ${s.effect} (${s.transition})`));
  console.log('  Auto-Director, seed 1776:\n    ' + plan.join('\n    '));
  writeFileSync(join(outDir, 'demo-auto-1776.plan.txt'), plan.join('\n') + '\n');
  await page.evaluate(() => window.LE.whenReady());
  const dur = await page.evaluate(() => window.LE.song.analysis.duration);
  await exportTo('demo-auto-1776.mp4', { start: 0, end: dur });
  // 2. a 9:16 cut
  await page.evaluate(() => window.LE.setSetting('aspect', '9:16'));
  await page.evaluate(() => window.LE.whenReady());
  await exportTo('demo-9x16.mp4', { start: 23.5, end: 44, aspect: '9:16' });
  await page.evaluate(() => window.LE.setSetting('aspect', '16:9'));
  // 3. KARAOKE on the waltz with its translation
  await page.evaluate(() => window.LE.loadDemo('demo-waltz'));
  await page.evaluate(() => { window.LE.setMode('single'); window.LE.setEffect('karaoke'); });
  await page.evaluate(() => window.LE.whenReady());
  const wdur = await page.evaluate(() => window.LE.song.analysis.duration);
  await exportTo('waltz-karaoke.mp4', { start: 0, end: wdur });
  // 4. contact sheet of every effect on the demo
  await page.evaluate(() => { window.LE.state.previewRes = 360; });
  await page.evaluate(() => window.LE.loadDemo());
  const ids = await page.evaluate(() => window.LE.effects().map((e) => e.id).filter((id) => id !== 'rise'));
  const files = [];
  for (const id of ids) {
    await page.evaluate((e) => { window.LE.setMode('single'); window.LE.setEffect(e); }, id);
    await page.evaluate(() => window.LE.whenReady());
    await page.evaluate(() => window.LE.renderAt(26.2));
    const f = join(outDir, `still-${id}.png`); writeFileSync(f, await grab(page)); files.push(f);
  }
  spawnSync('python3', [join(ROOT, 'scripts/sheet.py'), join(outDir, 'effects-sheet.png'), '4', '400', ...files], { stdio: 'inherit' });
  const errs = [...errors, ...(await page.evaluate(() => window.LE.errors))].filter((e) => !/ResizeObserver loop/.test(e));
  if (errs.length) { console.log('ERRORS:\n' + errs.slice(0, 5).join('\n')); process.exitCode = 1; }
} finally { await browser.close(); server.stop(); }

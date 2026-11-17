// Export a clip through the app's own exporter and save it:
//   node scripts/export-clip.mjs --audio song.mp3 --lrc song.lrc --effect broadside --start 20 --end 40 --out out/clip.mp4
//     [--mode director] [--res 720] [--fps 30] [--aspect 16:9] [--auto 1776] [--variety 5] [--js "LE.setPost({bloom:0.3})"]
import { writeFileSync, readFileSync, mkdirSync, openSync, writeSync, closeSync } from 'node:fs';
import { dirname, join, basename, isAbsolute } from 'node:path';
import { startServer, openApp, args, ROOT } from './lib/browser.mjs';

const a = args({ song: 'demo-song', effect: 'broadside', start: '0', end: '5', res: '720', fps: '30', aspect: '16:9', out: 'out/clip.mp4', format: 'mp4', quality: '8' });
const out = isAbsolute(a.out) ? a.out : join(ROOT, a.out);
mkdirSync(dirname(out), { recursive: true });
const server = await startServer(Number(a.port ?? 4173));
const { browser, page, errors } = await openApp({ url: server.url, local: a.audio ? { audio: a.audio } : {} });
try {
  await page.evaluate(([aspect]) => { window.LE.setSetting('aspect', aspect); }, [a.aspect]);
  if (a.audio) await page.evaluate(([lrc, name]) => window.LE.loadUrl('/__local/audio', lrc, name), [a.lrc ? readFileSync(a.lrc, 'utf8') : undefined, basename(a.audio)]);
  else await page.evaluate((n) => window.LE.loadDemo(n), a.song);
  if (a.mode === 'director') await page.evaluate((tr) => window.LE.setMode('director', tr), a.transition ?? 'auto');
  else if (a.auto) { const plan = await page.evaluate(([seed, v]) => window.LE.autoDirect(Number(seed), true, v ? Number(v) : undefined).segments.map((s) => `${s.start.toFixed(1)}–${s.end.toFixed(1)} ${s.effect} (${s.transition})`), [a.auto, a.variety]); console.log('plan:\n  ' + plan.join('\n  ')); }
  else await page.evaluate((e) => window.LE.setEffect(e), a.effect);
  for (const kv of a.set) { const [k, v] = kv.split('='); await page.evaluate(([e, k2, v2]) => window.LE.setParam(e, k2, v2 === 'true' ? true : v2 === 'false' ? false : Number.isNaN(Number(v2)) ? v2 : Number(v2)), [a.effect, k, v]); }
  if (a.js) await page.evaluate((code) => new Function('LE', code)(window.LE), a.js);
  await page.evaluate(() => window.LE.whenReady());
  const t0 = Date.now();
  const end = a.end === 'full' ? await page.evaluate(() => window.LE.song.analysis.duration) : Number(a.end);
  page.on('console', (m) => { if (m.text().startsWith('export ')) console.log('  ' + m.text()); });
  page.setDefaultTimeout(0);
  const r = await page.evaluate((o) => window.LE.exportClip(o), { format: a.format, res: Number(a.res), fps: Number(a.fps), start: Number(a.start), end, quality: Number(a.quality), aspect: a.aspect, alpha: a.alpha === 'true', normalise: a.normalise ? Number(a.normalise) : null, chunked: true });
  const fd = openSync(out, 'w');
  const CH = 8 << 20;
  for (let off = 0; off < r.bytes; off += CH) writeSync(fd, Buffer.from(await page.evaluate(([o, l]) => window.LE.readExport(o, l), [off, CH]), 'base64'));
  closeSync(fd);
  console.log(`${out}: ${r.width}×${r.height}, ${r.frames} frames, ${r.videoCodec} + ${r.audioCodec}, ${(r.bytes / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s to export`);
  const all = [...errors, ...(await page.evaluate(() => window.LE.errors))].filter((e) => !/ResizeObserver loop/.test(e));
  if (all.length) { console.log('ERRORS:\n' + all.slice(0, 6).join('\n')); process.exitCode = 1; }
} finally { await browser.close(); server.stop(); }

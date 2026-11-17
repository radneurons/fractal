// Render stills of any effect at chosen times:
//   node scripts/shots.mjs --effect karaoke --times 9,26,45,50 [--song demo-song | --audio x.mp3 --lrc x.lrc]
//     [--aspect 16:9] [--res 540] [--out out/shots] [--set key=value …] [--mask]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { startServer, openApp, grab, args, ROOT } from './lib/browser.mjs';

const a = args({ song: 'demo-song', effect: 'karaoke', times: '9,26,45,50', aspect: '16:9', res: '540', out: 'out/shots' });
const outDir = resolve(ROOT, a.out);
mkdirSync(outDir, { recursive: true });
const server = await startServer(Number(a.port ?? 4173));
const local = a.audio ? { audio: a.audio } : {};
const { browser, page, errors } = await openApp({ url: server.url, local });
try {
  await page.evaluate(([aspect, res]) => { window.LE.state.previewRes = Number(res); window.LE.setSetting('aspect', aspect); }, [a.aspect, a.res]);
  if (a.audio) await page.evaluate(([lrc, name]) => window.LE.loadUrl('/__local/audio', lrc, name), [a.lrc ? readFileSync(a.lrc, 'utf8') : undefined, basename(a.audio)]);
  else await page.evaluate((n) => window.LE.loadDemo(n), a.song);
  for (const effect of a.effect.split(',')) {
    await page.evaluate((e) => window.LE.setEffect(e), effect);
    for (const kv of a.set) { const [k, v] = kv.split('='); await page.evaluate(([e, k2, v2]) => window.LE.setParam(e, k2, v2 === 'true' ? true : v2 === 'false' ? false : Number.isNaN(Number(v2)) ? v2 : Number(v2)), [effect, k, v]); }
    const t0 = Date.now();
    await page.evaluate(() => window.LE.whenReady());
    const prep = Date.now() - t0;
    const ms = [];
    for (const t of a.times.split(',').map(Number)) {
      const dt = await page.evaluate(([tt, mask]) => { const s = performance.now(); if (mask) window.LE.renderMaskAt(tt); else window.LE.renderAt(tt); return performance.now() - s; }, [t, a.mask === 'true']);
      ms.push(dt);
      const name = `${a.tag ?? (a.audio ? basename(a.audio).replace(/\.\w+$/, '') : a.song)}-${effect}-${a.aspect.replace(':', 'x')}-${String(t).replace('.', '_')}${a.mask === 'true' ? '-mask' : ''}.png`;
      writeFileSync(join(outDir, name), await grab(page));
    }
    console.log(`${effect}: prepare ${prep} ms, render ${ms.map((x) => x.toFixed(0)).join('/')} ms`);
  }
  const pageErrors = await page.evaluate(() => window.LE.errors);
  const all = [...errors, ...pageErrors].filter((e) => !/ResizeObserver loop/.test(e));
  if (all.length) { console.log('ERRORS:\n' + all.slice(0, 8).join('\n')); process.exitCode = 1; }
} finally { await browser.close(); server.stop(); }

// Flash safety (SPEC §17): the demo through a plan containing every effect with flash-prone settings maxed, plus a
// 4 Hz white strobe layer so the test cannot pass vacuously. Without the guard the measurement must find violations
// (it measures something); with the guard, its verification pass must report 0 violations; and an exported clip
// across the strobe, re-measured from the decoded MP4 frames, must also be clean.
import { flashStats } from './tools/flash-check.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startServer, openApp, args, ROOT } from './lib/browser.mjs';

const a = args({ res: '360', fps: '30', out: 'out/flash' });
const outDir = resolve(ROOT, a.out);
mkdirSync(outDir, { recursive: true });
const server = await startServer(Number(a.port ?? 4194));
const { browser, page, errors } = await openApp({ url: server.url });
page.setDefaultTimeout(0);
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };
try {
  await page.evaluate((r) => { window.LE.state.previewRes = Number(r); }, a.res);
  await page.evaluate(() => window.LE.loadDemo());
  const plan = await page.evaluate(() => {
    const ids = window.LE.effects().map((e) => e.id);
    const dur = window.LE.song.analysis.duration, n = ids.length;
    const segs = ids.map((effect, i) => ({ start: (i * dur) / n, end: ((i + 1) * dur) / n, effect, transition: 'flash' }));
    window.LE.setPlan(segs, 'flash');
    // flash-prone settings maxed: masters, and every range param that sounds flashy
    window.LE.setSetting('intensity', 200); window.LE.setSetting('reactivity', 200); window.LE.setSetting('cameraEnergy', 200);
    for (const e of window.LE.effects()) for (const p of e.params) if (p.type === 'range' && /flash|strobe|flicker|pulse|glow|spark|burst|bright|shake|glitch|bloom/i.test(p.key)) window.LE.setParam(`plan:${e.id}`, p.key, p.max);
    window.LE.setPost({ bloom: 1, chroma: 1 });
    // the strobe: a white solid layer whose opacity a square LFO toggles 8×/s (4 flashes/s, over WCAG's 3)
    const layers = window.LE.state.layers.filter((l) => l.id !== 'strobe');
    window.LE.setLayers([...layers, { id: 'strobe', kind: 'solid', color: '#ffffff', instanceId: 'layer:strobe', enabled: true, blend: 'normal', opacity: 0, mask: 'none' }]);
    window.LE.addRoute({ id: 'strobe-lfo', source: 'lfo', shape: 'square', bars: 0.125, target: { instanceId: 'layer:strobe', key: 'opacity' }, amount: 1, curve: 'lin', attackMs: 0, releaseMs: 0, lo: 0, hi: 1, invert: false, enabled: true });
    return segs.map((s) => s.effect).join(' → ');
  });
  console.log(`  plan: ${plan}`);
  await page.evaluate(() => window.LE.whenReady());
  const fps = Number(a.fps);
  const t0 = Date.now();
  const r = await page.evaluate(([f]) => window.LE.flashReport({ start: 0, end: window.LE.song.analysis.duration, fps: f }), [fps]);
  console.log(`  guard run: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  check('guard off: the measurement finds violations', r.fixed.length > 0, `${r.fixed.length} violating window(s), first ${r.fixed[0]?.map((x) => x.toFixed(2)).join('–')} s`);
  check('guard on: verification reports 0 violations', r.verified && r.violations === 0, `${r.violations} left, max ${r.maxFlashesPerSecond} flashes/s after attenuation`);

  // the exported file itself: 4 s across the strobe, decoded and measured independently in Node
  const ex = await page.evaluate(() => window.LE.exportClip({ format: 'mp4', res: 360, fps: 30, start: 20, end: 24, quality: 3, chunked: true }));
  const parts = [];
  for (let off = 0; off < ex.bytes; off += 8 << 20) parts.push(Buffer.from(await page.evaluate(([o, l]) => window.LE.readExport(o, l), [off, 8 << 20]), 'base64'));
  const mp4 = join(outDir, 'guarded.mp4'); writeFileSync(mp4, Buffer.concat(parts));
  const st = flashStats(mp4);
  const worst = st.worstFlashesPerSecond, n = st.frames;
  check('exported MP4 re-measured from decoded frames: ≤ 3 flashes in any second', worst <= 3, `${worst} flashes/s max over ${n} frames`);
  const errs = [...errors, ...(await page.evaluate(() => window.LE.errors))].filter((e) => !/ResizeObserver loop/.test(e));
  check('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
} finally { await browser.close(); server.stop(); }
console.log(failed ? `${failed} flash check(s) failed` : 'flash safety ok');
process.exit(failed ? 1 : 0);

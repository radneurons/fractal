// Live mode end to end (SPEC §14): the demo song through the rehearsal source → AudioWorklet → analysis worker →
// follower → a live effect. Lines are cued at their LRC times (as an operator would). Checks the online tempo, beat
// predictions, that cued words appear, frames change, the flash guard runs, and the audience/output plumbing exists.
//   node scripts/e2e-live.mjs [--effect neon] [--seconds 26] [--out out/live]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { startServer, openApp, args, ROOT } from './lib/browser.mjs';

const a = args({ effect: 'neon', seconds: '26', out: 'out/live' });
const outDir = resolve(ROOT, a.out);
mkdirSync(outDir, { recursive: true });
const exp = JSON.parse(readFileSync(join(ROOT, 'public/demo/demo-song.json'), 'utf8'));
// line start times from the LRC's line stamps
const lineStarts = readFileSync(join(ROOT, 'public/demo/demo-song.lrc'), 'utf8').split('\n').map((l) => /^\[(\d+):(\d+\.\d+)\]/.exec(l)).filter(Boolean).map((m) => Number(m[1]) * 60 + Number(m[2]));
const server = await startServer(Number(a.port ?? 4187));
const { browser, page, errors } = await openApp({ url: server.url });
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };
try {
  await page.evaluate(() => { window.LE.state.previewRes = 360; });
  await page.evaluate(() => window.LE.loadDemo());
  await page.evaluate(() => window.LE.whenReady());
  await page.evaluate(async (eff) => { const l = await window.LE.openLive(); l.setEffect(eff); await l.start('file'); }, a.effect);
  const t0 = Date.now();
  const shots = [];
  let cued = 0, iters = 0;
  const secs = Number(a.seconds);
  while ((Date.now() - t0) / 1000 < secs) {
    const now = await page.evaluate(() => window.LE.live()?.runtime()?.now() ?? 0);
    // cue each line ~0.1 s before it is sung (an operator's anticipation)
    while (cued < lineStarts.length && now >= lineStarts[cued] - 0.1) { await page.evaluate(() => window.LE.live().cue()); cued++; }
    if ([10, 14, 19, 23].some((s) => now >= s && !shots.some((x) => x.s === s))) {
      const s = [10, 14, 19, 23].find((x) => now >= x && !shots.some((y) => y.s === x));
      const png = Buffer.from((await page.evaluate(() => document.querySelector('.live-stage canvas').toDataURL('image/png'))).split(',')[1], 'base64');
      writeFileSync(join(outDir, `live-${a.effect}-${s}s.png`), png);
      shots.push({ s, h: createHash('sha1').update(png).digest('hex').slice(0, 10) });
    }
    iters++;
    await new Promise((r) => setTimeout(r, 30));
  }
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
  console.log(`  (${iters} control iterations, live loop ≈ ${fps} fps in this headless software-GL browser)`);
  const r = await page.evaluate(() => {
    const rt = window.LE.live().runtime();
    const st = rt.state, a = rt.session.a, f = rt.follower.state();
    return { bpm: st?.bpm ?? 0, t: st?.t ?? 0, beats: a.beats.filter((b) => b <= (st?.t ?? 0)), line: f.line, shown: f.words.filter((w) => Number.isFinite(w.shownAt)).length, att: rt.attenuation, transport: document.querySelector('.live-bar')?.textContent ?? '' };
  });
  check('analyser clock advanced with the audio', r.t > secs - 3, `${r.t.toFixed(1)} s`);
  check('online tempo within ±2 % of 120 BPM', Math.abs(r.bpm / 120 - 1) <= 0.02, `${r.bpm.toFixed(2)} BPM`);
  const truth = exp.beats.filter((b) => b >= 10 && b <= r.t - 0.5);
  const got = r.beats.filter((b) => b >= 10);
  let hit = 0, err = 0; for (const b of truth) { const d = Math.min(...got.map((g) => Math.abs(g - b))); if (d <= 0.07) { hit++; err += d; } }
  check('beat predictions match the fixture (≥ 90 % within ±70 ms)', hit / Math.max(1, truth.length) >= 0.9, `${hit}/${truth.length}, mean error ${(1000 * err / Math.max(1, hit)).toFixed(1)} ms (includes the browser audio path)`);
  check('the follower reached the cued line', r.line === cued - 1 && cued >= 3, `line ${r.line}, ${cued} cues, ${r.shown} words shown`);
  check('frames differ over time', new Set(shots.map((s) => s.h)).size === shots.length && shots.length >= 3, shots.map((s) => `${s.s}s ${s.h}`).join(', '));
  check('flash guard running (attenuation in [0, 1])', r.att >= 0 && r.att <= 1, `att ${r.att.toFixed(2)}`);
  const hasOutput = await page.evaluate(() => typeof BroadcastChannel !== 'undefined');
  check('BroadcastChannel available for ?live&output', hasOutput);
  const errs = [...errors, ...(await page.evaluate(() => window.LE.errors))].filter((e) => !/ResizeObserver loop/.test(e));
  check('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
} finally { await browser.close(); server.stop(); }
console.log(failed ? `${failed} live check(s) failed` : 'live mode ok');
process.exit(failed ? 1 : 0);

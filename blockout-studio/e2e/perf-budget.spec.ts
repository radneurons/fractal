/** The brief's performance budget, measured on the production build.
 *  - Everywhere: the main-thread CPU cost per frame (what the app itself spends) must fit the budget with headroom:
 *      editing 20 characters / 10 cameras / 200 props ≤ 12 ms per frame (60 fps = 16.7 ms),
 *      1080p clay export ≤ 8.5 ms per frame (4× real time at 24 fps = 10.4 ms).
 *    GPU raster and video encoding run in other processes; on Linux they are pinned to other cores so they cannot
 *    inflate the measurement.
 *  - On a hardware GPU (or `pnpm bench`): wall-clock ≥ 55 fps editing and ≥ 4× real-time export are asserted too. */
import { expect, test, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
declare global { interface Window { __studio: { getState(): any }; __sceneGL: any } }

const URL = 'http://localhost:4174/?fresh&nobridge', HW = !!process.env.BLOCKOUT_BENCH_HW;
if (HW) test.use({ launchOptions: { args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] }, headless: false });
const pin = () => { if (process.platform !== 'linux') return; try { for (const l of execSync('ps -eo pid,args').toString().split('\n')) { const pid = l.trim().split(/\s+/)[0]; if (/--type=gpu-process|--type=utility/.test(l)) execSync(`taskset -a -p -c 2,3 ${pid}`); else if (/--type=renderer/.test(l)) execSync(`taskset -a -p -c 0,1 ${pid}`); } } catch { /* no taskset: measure unpinned */ } };
async function profileMainThread(page: Page, run: () => Promise<number>) {
  const cdp = await page.context().newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start');
  const frames = await run(), { profile } = await cdp.send('Profiler.stop'), byId = new Map(profile.nodes.map((n: any) => [n.id, n])); let busy = 0;
  (profile.samples ?? []).forEach((id: number, i: number) => { const c = (byId.get(id) as any).callFrame; if (!/^\((idle|program)\)$/.test(c.functionName)) busy += profile.timeDeltas?.[i] ?? 0; });
  return { frames, cpuMsPerFrame: busy / 1000 / Math.max(1, frames) };
}
const isSoftware = (r: string) => /swiftshader|llvmpipe|software/i.test(r);

test('editing budget: 20 characters, 10 cameras, 200 props', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 950 }); await page.goto(URL); await page.getByTestId('scene-view').waitFor(); pin(); await page.waitForTimeout(800);
  await page.evaluate(() => { const st = window.__studio.getState(), ops: unknown[] = [];
    for (let i = 0; i < 18; i++) ops.push({ type: 'addCharacter', character: { id: 'pc' + i, name: 'P' + i, idColor: '#' + (0x100000 + i * 0x0b0d11).toString(16).slice(0, 6), height: 1.75, build: 1, held: { kind: 'sword', hand: 'R' }, interp: 'catmull', poseKeys: [], keys: [{ id: 'a', t: 0, pos: [i * 2 - 18, 0, 6], clip: 'run', facing: { mode: 'path' }, ease: 'linear', speed: 1 }, { id: 'b', t: 14, pos: [i * 2 - 18, 0, 40], clip: 'idle', facing: { mode: 'path' }, ease: 'linear', speed: 1 }] } });
    for (let i = 0; i < 4; i++) ops.push({ type: 'addCamera', camera: { id: 'pcam' + i, name: 'PC' + i, sensorWidth: 36, shake: { profile: 'none', amount: 1, seed: 1 }, keys: [{ id: 'k', t: 0, pos: [i * 3, 2, 12], target: [0, 1, 0], focal: 35, focus: 5, fstop: 2.8, roll: 0, ease: 'linear' }] } });
    for (let i = 0; i < 198; i++) ops.push({ type: 'addProp', prop: { id: 'pp' + i, name: 'box', kind: 'box', pos: [(i % 20) * 2 - 20, 0, -8 - Math.floor(i / 20) * 2], rot: [0, 0, 0], scale: [1, 1, 1], idColor: '#' + (0x202020 + i * 0x010203).toString(16).slice(0, 6) } });
    st.dispatch({ type: 'batch', label: 'perf scene', ops }); st.select({ kind: 'character', id: 'pc3' }); st.togglePlay('scene'); });
  await page.waitForTimeout(2000);
  const counts = await page.evaluate(() => { const p = window.__studio.getState().project; return [Object.keys(p.characters).length, Object.keys(p.cameras).length, Object.keys(p.props).length]; }); expect(counts).toEqual([20, 10, 200]);
  const gpu = await page.evaluate(() => new Promise<{ calls: number; tris: number }>((res) => { const g = window.__sceneGL; requestAnimationFrame(() => { g.info.autoReset = false; g.info.reset(); requestAnimationFrame(() => { const r = { calls: g.info.render.calls, tris: g.info.render.triangles }; g.info.autoReset = true; res(r); }); }); }));
  const m = await profileMainThread(page, () => page.evaluate(() => new Promise<number>((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 4000 ? requestAnimationFrame(f) : res(n); }; requestAnimationFrame(f); })));
  const renderer = await page.evaluate(() => { const g = window.__sceneGL.getContext(), e = g.getExtension('WEBGL_debug_renderer_info'); return String(e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''); }), wallFps = m.frames / 4;
  console.log(`editing: ${m.cpuMsPerFrame.toFixed(2)} ms main-thread CPU/frame (budget 12) · ${gpu.calls} draw calls · ${(gpu.tris / 1000).toFixed(0)}k triangles · ${wallFps.toFixed(1)} fps wall on ${renderer}`);
  expect(m.cpuMsPerFrame).toBeLessThan(12); expect(gpu.calls).toBeLessThan(150); expect(gpu.tris).toBeLessThan(2_000_000);
  if (HW || !isSoftware(renderer)) expect(wallFps).toBeGreaterThan(55);
});

test('export budget: 1080p clay pass at ≥ 4× real time', async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 900, height: 560 }); await page.goto(URL); await page.getByTestId('scene-view').waitFor(); pin();
  await page.evaluate(() => window.__studio.getState().set({ playing: false }));
  await page.evaluate(() => (window as any).__blockout.benchClay(1080, 4, true)); // warm-up: shaders, render targets, encoder probe
  let r: any = null; const m = await profileMainThread(page, async () => { r = await page.evaluate(() => (window as any).__blockout.benchClay(1080, 48, true)); return 48; });
  console.log(`export 1080p clay: ${m.cpuMsPerFrame.toFixed(2)} ms main-thread CPU/frame (budget 8.5 → ≥ ${(1000 / m.cpuMsPerFrame / 24).toFixed(1)}× real time when not GPU-bound) · ${r.drawCalls} draw calls · ${(r.triangles / 1000).toFixed(0)}k triangles · wall ${r.xRealtime.toFixed(2)}× on ${r.renderer} (encoded=${r.encoded})`);
  expect(r.encoded).toBe(true); expect(m.cpuMsPerFrame).toBeLessThan(8.5);
  if (HW || !isSoftware(r.renderer)) expect(r.xRealtime).toBeGreaterThan(4);
});

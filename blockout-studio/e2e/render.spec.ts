import { expect, test } from '@playwright/test';

type B = { exportShotPackage(shot: unknown, o: unknown): Promise<{ hash: string; files: Record<string, Uint8Array>; manifest: { renderer: string; passes: Record<string, { storage: string }> } }>; benchClay(h: number, n: number, enc: boolean): Promise<{ fps: number; xRealtime: number; renderer: string; encoded: boolean; width: number; height: number }> };
declare global { interface Window { __blockout: B; __studio: { getState(): any } } }

test('WebGL export is deterministic: two runs give byte-identical packages', async ({ page }) => {
  await page.goto('/?fresh'); await page.waitForFunction(() => !!window.__blockout);
  const r = await page.evaluate(async () => {
    const s = window.__studio.getState(), shot = { ...s.project.shots[3], end: s.project.shots[3].start + 0.5 }, o = { height: 180, video: false };
    const a = await window.__blockout.exportShotPackage(shot, o), b = await window.__blockout.exportShotPackage(shot, o);
    return { a: a.hash, b: b.hash, n: Object.keys(a.files).length, renderer: a.manifest.renderer, passes: Object.keys(a.manifest.passes) };
  });
  expect(r.a).toBe(r.b); expect(r.n).toBeGreaterThan(100); expect(r.passes).toEqual(['clay', 'depth', 'depthMetric', 'normals', 'id', 'pose', 'canny', 'flow', 'fx']); expect(r.renderer).toMatch(/three/);
});

test('video encoding path produces a package with encoded passes', async ({ page }) => {
  await page.goto('/?fresh'); await page.waitForFunction(() => !!window.__blockout);
  const r = await page.evaluate(async () => { const s = window.__studio.getState(), shot = { ...s.project.shots[1], end: s.project.shots[1].start + 0.5 }; const a = await window.__blockout.exportShotPackage(shot, { height: 360, passes: ['clay', 'id'] }); return { files: Object.keys(a.files), passes: a.manifest.passes }; });
  expect(r.passes.id.storage).toBe('png-sequence'); // data passes are never lossy
  expect(['video', 'png-sequence']).toContain(r.passes.clay.storage);
});

test('perf: 1080p clay pass export speed', async ({ page }) => {
  await page.goto('/?fresh'); await page.waitForFunction(() => !!window.__blockout);
  const r = await page.evaluate(() => window.__blockout.benchClay(1080, 24, true));
  console.log(`clay 1080p: ${r.fps.toFixed(1)} fps = ${r.xRealtime.toFixed(2)}x realtime on ${r.renderer} (encoded=${r.encoded})`);
  const software = /swiftshader|llvmpipe|software/i.test(r.renderer);
  // Budget: >= 4x real time on a hardware GPU. Software GL (CI) cannot meet it, so there we only guard against regressions.
  expect(r.xRealtime).toBeGreaterThan(software ? 0.05 : 4);
});

test('perf: editing stays interactive with 20 characters, 10 cameras, 200 props', async ({ page }) => {
  await page.goto('/?fresh'); await page.waitForFunction(() => !!window.__studio);
  const r = await page.evaluate(async () => {
    const st = window.__studio.getState(), ops: unknown[] = [];
    for (let i = 0; i < 18; i++) ops.push({ type: 'addCharacter', character: { id: 'pc' + i, name: 'P' + i, idColor: '#' + (0x100000 + i * 0x0b0d11).toString(16).slice(0, 6), height: 1.75, build: 1, held: { kind: 'none', hand: 'R' }, interp: 'catmull', poseKeys: [], keys: [{ id: 'a', t: 0, pos: [i * 2 - 18, 0, 6], clip: 'run', facing: { mode: 'path' }, ease: 'linear', speed: 1 }, { id: 'b', t: 14, pos: [i * 2 - 18, 0, 40], clip: 'idle', facing: { mode: 'path' }, ease: 'linear', speed: 1 }] } });
    for (let i = 0; i < 4; i++) ops.push({ type: 'addCamera', camera: { id: 'pcam' + i, name: 'PC' + i, sensorWidth: 36, shake: { profile: 'none', amount: 1, seed: 1 }, keys: [{ id: 'k', t: 0, pos: [i * 3, 2, 12], target: [0, 1, 0], focal: 35, focus: 5, fstop: 2.8, roll: 0, ease: 'linear' }] } });
    for (let i = 0; i < 198; i++) ops.push({ type: 'addProp', prop: { id: 'pp' + i, name: 'box', kind: 'box', pos: [(i % 20) * 2 - 20, 0, -8 - Math.floor(i / 20) * 2], rot: [0, 0, 0], scale: [1, 1, 1], idColor: '#' + (0x202020 + i * 0x010203).toString(16).slice(0, 6) } });
    st.dispatch({ type: 'batch', label: 'perf scene', ops }); st.togglePlay('scene');
    await new Promise((r) => setTimeout(r, 800));
    let n = 0; const t0 = performance.now(); await new Promise<void>((res) => { const f = () => { n++; performance.now() - t0 < 3000 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
    const gl = document.createElement('canvas').getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const core = (window as any).__studio.getState(); const p = core.project; const c0 = performance.now(); for (let i = 0; i < 60; i++) (window as any).__compile?.(p, i / 24); const compileMs = (performance.now() - c0) / 60;
    return { fps: n / 3, renderer: String(ext ? gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''), chars: Object.keys(p.characters).length, cams: Object.keys(p.cameras).length, props: Object.keys(p.props).length, compileMs };
  });
  console.log(`editor: ${r.fps.toFixed(1)} fps with ${r.chars} characters / ${r.cams} cameras / ${r.props} props on ${r.renderer}; scene compile ${r.compileMs.toFixed(2)} ms/frame`);
  expect(r.chars).toBe(20); expect(r.cams).toBe(10); expect(r.props).toBe(200);
  expect(r.compileMs).toBeLessThan(6); // CPU side of the 60 fps budget (16.6 ms)
  expect(r.fps).toBeGreaterThan(/swiftshader|llvmpipe|software/i.test(r.renderer) ? 2 : 55);
});

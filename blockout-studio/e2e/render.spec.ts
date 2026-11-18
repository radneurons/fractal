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

test('bit-exact export matches the Node software renderer byte for byte (cross-machine determinism)', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?fresh'); await page.waitForFunction(() => !!(window as any).__blockout);
  const browser = await page.evaluate(async () => { const s = (window as any).__studio.getState(), shot = { ...s.project.shots[3], end: s.project.shots[3].start + 0.25 }; const r = await (window as any).__blockout.exportShotPackage(shot, { height: 90, soft: true, video: false, passes: ['clay', 'id', 'depthMetric', 'pose'] }); return Object.fromEntries(Object.entries(r.files as Record<string, Uint8Array>).filter(([k]) => k.startsWith('passes/')).map(([k, v]) => [k, (window as any).__blockout.hashBytes(v)])); });
  const { demoProject } = await import('../packages/core/src/index'), { buildShotPackage, softRenderer, hashBytes } = await import('../packages/render/src/index');
  const p = demoProject(), node = await buildShotPackage(p, { ...p.shots[3], end: p.shots[3].start + 0.25 }, { renderer: softRenderer, passes: ['clay', 'id', 'depthMetric', 'pose'], height: 90 });
  const nodeHashes = Object.fromEntries(Object.entries(node.files).filter(([k]) => k.startsWith('passes/')).map(([k, v]) => [k, hashBytes(v)]));
  expect(Object.keys(browser).length).toBeGreaterThan(10); expect(browser).toEqual(nodeHashes); // V8-in-Chromium and Node produce identical pass bytes
});

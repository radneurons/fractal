import { expect, test } from '@playwright/test';
declare global { interface Window { __studio: { getState(): any } } }

/** A minimal valid GLB: one box mesh, 2 × 1 × 0.5 m. */
function boxGLB(): Buffer {
  const [x, y, z] = [1, 0.5, 0.25], P = [-x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z, -x, -y, z, x, -y, z, x, y, z, -x, y, z], I = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
  const pos = Buffer.from(new Float32Array(P).buffer), idx = Buffer.from(new Uint16Array(I).buffer), bin = Buffer.concat([pos, idx, Buffer.alloc((4 - ((pos.length + idx.length) % 4)) % 4)]);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }], buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length }, { buffer: 0, byteOffset: pos.length, byteLength: idx.length }], accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-x, -y, -z], max: [x, y, z] }, { bufferView: 1, componentType: 5123, count: I.length, type: 'SCALAR' }] };
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const ch = (b: Buffer, t: string) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.write(t, 4); return Buffer.concat([h, b]); };
  return Buffer.concat([head, ch(js, 'JSON'), ch(bin, 'BIN\0')]);
}

test('GLB import: the model becomes a prop sized to its bounds, renders, and survives a reload', async ({ page }) => {
  await page.goto('/?nobridge'); await page.getByTestId('scene-view').waitFor();
  await page.getByTestId('add-menu').click(); const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'Prop · GLB model…' }).click()]);
  await chooser.setFiles({ name: 'crate.glb', mimeType: 'model/gltf-binary', buffer: boxGLB() });
  await expect.poll(() => page.evaluate(() => Object.values(window.__studio.getState().project.props).find((p: any) => p.kind === 'glb') as any)).toMatchObject({ name: 'crate', scale: [2, 1, 0.5] });
  expect(await page.evaluate(() => (window as any).__blockout.modelCount())).toBe(1);
  await page.waitForTimeout(1200); // autosave
  await page.reload(); await page.getByTestId('scene-view').waitFor();
  await expect.poll(() => page.evaluate(() => (window as any).__blockout.modelCount?.() ?? 0), { timeout: 15000 }).toBe(1);
  expect(await page.evaluate(() => Object.values(window.__studio.getState().project.props).some((p: any) => p.kind === 'glb'))).toBe(true);
});

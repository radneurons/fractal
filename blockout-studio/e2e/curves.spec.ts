import { expect, test } from '@playwright/test';
declare global { interface Window { __studio: { getState(): any } } }

test('curve editor: dragging a camera height key raises the camera (one undo entry)', async ({ page }) => {
  await page.goto('/?fresh&nobridge'); await page.getByTestId('timeline').waitFor();
  await page.evaluate(() => window.__studio.getState().select({ kind: 'camera', id: 'cam2' }));
  await page.getByRole('button', { name: 'Curves' }).click(); const key = page.getByTestId('curve-key-height').first(); await key.scrollIntoViewIfNeeded();
  const b = (await key.boundingBox())!, y0 = await page.evaluate(() => window.__studio.getState().project.cameras.cam2.keys[0].pos[1]), h0 = await page.evaluate(() => window.__studio.getState().history.past.length);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); for (let i = 1; i <= 6; i++) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - i * 6); await page.mouse.up();
  const y1 = await page.evaluate(() => window.__studio.getState().project.cameras.cam2.keys[0].pos[1]); expect(y1).toBeGreaterThan(y0 + 0.01);
  expect(await page.evaluate(() => window.__studio.getState().history.past.length)).toBe(h0 + 1);
  await page.evaluate(() => window.__studio.getState().undo()); expect(await page.evaluate(() => window.__studio.getState().project.cameras.cam2.keys[0].pos[1])).toBe(y0);
});

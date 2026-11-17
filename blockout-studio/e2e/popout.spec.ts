import { expect, test } from '@playwright/test';
declare global { interface Window { __studio: { getState(): any } } }

test('the Blockout viewer pops out into its own window and follows the editor live', async ({ page, context }) => {
  await page.goto('/?fresh&nobridge'); await page.getByTestId('blockout-view').waitFor();
  const [pop] = await Promise.all([context.waitForEvent('page'), page.getByTestId('popout-blockout').click()]);
  await pop.getByTestId('popout-blockout').waitFor(); await expect(pop.getByTestId('blockout-view')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => { const s = window.__studio.getState(); s.select({ kind: 'shot', id: 's4' }); s.setTime(7.0); s.set({ blockoutPass: 'id' }); s.dispatch({ type: 'setLens', cameraId: 'cam4', focal: 85 }); });
  await expect.poll(() => pop.evaluate(() => { const s = window.__studio.getState(); return [s.activeShotId, s.t, s.blockoutPass, s.project.cameras.cam4.keys[0].focal]; })).toEqual(['s4', 7, 'id', 85]);
  await expect(pop.getByTestId('facts-badge')).toContainText('85mm');
  expect(await pop.evaluate(() => window.__studio.getState().history.past.length)).toBe(0); // read-only mirror
});

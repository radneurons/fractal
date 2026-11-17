import { expect, test } from '@playwright/test';

test('panels re-dock: scene/stack swap, sidebar side, viewer order — and the layout persists', async ({ page }) => {
  await page.goto('/?fresh&nobridge'); await page.getByTestId('scene-view').waitFor();
  const x = async (id: string) => (await page.getByTestId(id).boundingBox())!.x, y = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;
  expect(await x('scene-view')).toBeLessThan(await x('blockout-view')); expect(await x('blockout-view')).toBeLessThan(await x('inspector'));
  const toggle = async (name: string) => { await page.getByTestId('layout-menu').click(); await page.getByRole('menuitemcheckbox', { name }).click(); };
  await toggle('Scene view on the right'); await toggle('Sidebar on the left'); await toggle('Result above Blockout');
  await expect(page.getByTestId('main-area')).toHaveAttribute('data-layout', '111');
  expect(await x('inspector')).toBeLessThan(await x('blockout-view')); expect(await x('blockout-view')).toBeLessThan(await x('scene-view')); expect(await y('result-view')).toBeLessThan(await y('blockout-view'));
  await page.reload(); await page.getByTestId('scene-view').waitFor(); await expect(page.getByTestId('main-area')).toHaveAttribute('data-layout', '111');
  expect(await x('inspector')).toBeLessThan(await x('scene-view'));
});

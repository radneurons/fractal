import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('accessibility: no serious/critical axe violations in either theme, and Tab navigates controls', async ({ page }) => {
  await page.goto('/?fresh&nobridge'); await page.getByTestId('scene-view').waitFor(); await page.waitForTimeout(800);
  const all: string[] = [];
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByLabel('Toggle theme').click();
    for (const tab of ['inspector', 'prompt', 'bibles', 'takes', 'claude', 'live']) {
      await page.getByTestId(`tab-${tab}`).click(); await page.waitForTimeout(150);
      const r = await new AxeBuilder({ page }).exclude('canvas').analyze(), bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      all.push(...bad.map((v) => `${theme}/${tab}: ${v.id} (${v.nodes.length}) — ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`));
    }
  }
  console.log(all.join('\n')); expect(all).toEqual([]);
  // Tab moves between controls once something is focused; with nothing focused it toggles scene/blockout focus
  await page.getByTestId('add-menu').focus(); await page.keyboard.press('Tab'); expect(await page.evaluate(() => document.activeElement?.textContent)).toMatch(/Direct with Claude/); // disabled Undo/Redo are skipped
  await page.evaluate(() => (document.activeElement as HTMLElement).blur()); const f0 = await page.evaluate(() => (window as any).__studio.getState().focus); await page.keyboard.press('Tab'); expect(await page.evaluate(() => (window as any).__studio.getState().focus)).not.toBe(f0);
});

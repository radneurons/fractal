import { expect, test } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { readFileSync } from 'node:fs';
declare global { interface Window { __studio: { getState(): any } } }

test('create a character → draw a path → add a camera → export a shot package → run the mock provider → view the take', async ({ page }) => {
  await page.goto('/?fresh&nobridge'); await page.getByTestId('scene-view').waitFor(); await page.waitForTimeout(1500);
  const st = () => page.evaluate(() => { const s = window.__studio.getState(); return { chars: Object.keys(s.project.characters).length, cams: Object.keys(s.project.cameras).length, shots: s.project.shots.length, sel: s.selection, hist: s.history.past.length }; });
  const before = await st();

  // 1. character
  await page.getByTestId('add-menu').click(); await page.getByRole('menuitem', { name: 'Character', exact: true }).click();
  const a = await st(); expect(a.chars).toBe(before.chars + 1); expect(a.sel.kind).toBe('character'); const cid = a.sel.id;

  // 2. path: Path mode + clicks on the ground
  await page.getByRole('button', { name: 'Path', exact: true }).click();
  const box = (await page.getByTestId('scene-view').boundingBox())!;
  for (const [fx, fy] of [[0.35, 0.78], [0.55, 0.82], [0.72, 0.76]]) { await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy); await page.waitForTimeout(250); }
  const keys = await page.evaluate((id) => window.__studio.getState().project.characters[id].keys.length, cid); expect(keys).toBe(4);
  await page.getByRole('button', { name: 'Select', exact: true }).click();

  // 3. camera (preset aimed at the selected character) + a short shot on it
  await page.evaluate((id) => window.__studio.getState().select({ kind: 'character', id }), cid);
  await page.getByTestId('add-menu').click(); await page.getByRole('menuitem', { name: 'Camera · pushIn' }).click();
  await page.getByTestId('add-menu').click(); await page.getByRole('menuitem', { name: 'Shot', exact: true }).click();
  const b = await st(); expect(b.cams).toBe(before.cams + 1); expect(b.shots).toBe(before.shots + 1);
  const shot = await page.evaluate(() => { const s = window.__studio.getState(); return s.project.shots.find((x: any) => x.id === s.activeShotId); });
  const start = await page.getByLabel('Shot start').inputValue(); await page.getByLabel('Shot end').fill(String(+start + 0.5)); await page.getByLabel('Shot end').press('Enter');
  expect(await page.evaluate((id) => window.__studio.getState().project.shots.find((x: any) => x.id === id).end, shot.id)).toBeCloseTo(+start + 0.5, 3);

  // 4. export the shot package
  await page.getByTestId('export-height').selectOption('180');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), page.getByTestId('export-shot').click()]);
  const zip = unzipSync(new Uint8Array(readFileSync((await dl.path())!))), manifest = JSON.parse(strFromU8(zip['manifest.json']));
  expect(manifest.frames).toBe(12); expect(manifest.shot.id).toBe(shot.id); expect(Object.keys(manifest.passes)).toContain('pose'); expect(zip['passes/id/0011.png']).toBeTruthy(); expect(manifest.idPalette.some((e: any) => e.entityId === cid)).toBe(true);

  // 5. run the mock provider (with confirmation and cost estimate)
  await page.getByTestId('tab-takes').click(); await expect(page.getByTestId('cost-estimate')).toContainText('Estimate $0.03');
  await page.getByTestId('generate').click(); await page.getByTestId('generate-confirm').click();
  await expect(page.locator('[data-testid="take-card"][data-status="done"]')).toHaveCount(1, { timeout: 120_000 });
  const take = await page.evaluate((id) => Object.values(window.__studio.getState().project.takes).find((t: any) => t.shotId === id) as any, shot.id);
  expect(take.frames).toHaveLength(12); expect(take.providerId).toBe('mock'); expect(take.prompt.length).toBeGreaterThan(50);

  // 6. view the take
  await page.getByTestId('take-card').locator('button').first().click();
  const img = page.getByTestId('take-frame'); await expect(img).toBeVisible(); await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate((id) => (Object.values(window.__studio.getState().project.takes).find((t: any) => t.shotId === id) as any).iou ?? -1, shot.id), { timeout: 30_000 }).toBeGreaterThanOrEqual(0);

  // everything is undoable
  const h = await page.evaluate(() => window.__studio.getState().history.past.length); expect(h).toBeGreaterThan(8);
});

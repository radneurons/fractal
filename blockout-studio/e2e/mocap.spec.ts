import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
declare global { interface Window { __studio: { getState(): any } } }

// A fake webcam: the mannequin (with a painted face) performing, rendered by the software renderer as Y4M.
const dir = fileURLToPath(new URL('../test-results/fixtures/', import.meta.url)), y4m = dir + 'performer.y4m', model = fileURLToPath(new URL('../apps/studio/public/models/pose_landmarker_full.task', import.meta.url));
if (!existsSync(y4m)) { mkdirSync(dir, { recursive: true }); execFileSync('npx', ['tsx', fileURLToPath(new URL('../scripts/make-mocap-fixture.ts', import.meta.url)), y4m], { stdio: 'ignore' }); }
test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] }, permissions: ['camera'] });

test('webcam mocap runs fully offline and retargets the performance onto a character', async ({ page }) => {
  test.skip(!existsSync(model), 'run `pnpm mocap:fetch` once to store the pose model locally');
  test.setTimeout(240_000);
  const cdn: string[] = []; await page.route(/cdn\.jsdelivr\.net|storage\.googleapis\.com/, (r) => { cdn.push(r.request().url()); return r.abort(); });
  await page.goto('/?fresh&nobridge'); await page.getByTestId('scene-view').waitFor();
  await page.evaluate(() => window.__studio.getState().select({ kind: 'character', id: 'ren' })); await page.getByTestId('tab-live').click();
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  const status = page.locator('section:has-text("Webcam mocap") p.mt-0\\.5');
  await expect(status).toContainText('recording', { timeout: 120_000 }); await page.waitForTimeout(5000); await page.getByRole('button', { name: 'Stop' }).click();
  await expect(status).toContainText('→ clip');
  const clip = await page.evaluate(() => { const p = window.__studio.getState().project, c = Object.values(p.clips)[0] as any, k = p.characters.ren.keys[0]; const arm = c.frames.map((f: any) => f.upperArmR[0]); return { n: c.frames.length, assigned: k.clip === c.id, armRange: Math.max(...arm) - Math.min(...arm), hasRoot: !!c.frames[0]._root }; });
  expect(clip.n).toBeGreaterThanOrEqual(6); expect(clip.assigned).toBe(true); expect(clip.hasRoot).toBe(true); expect(clip.armRange).toBeGreaterThan(0.05); // the gesturing arm moves
  expect(cdn).toEqual([]); // nothing fetched from a CDN
});

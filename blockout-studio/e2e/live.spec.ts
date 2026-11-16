import { expect, test } from '@playwright/test';
declare global { interface Window { __studio: { getState(): any } } }
// Extra contexts keep rendering with software GL and starve later tests: close them.
const opened: import('@playwright/test').BrowserContext[] = [];
test.afterEach(async () => { await Promise.all(opened.splice(0).map((c) => c.close().catch(() => {}))); });
const ctx = async (browser: import('@playwright/test').Browser, o?: Parameters<import('@playwright/test').Browser['newContext']>[0]) => { const c = await browser.newContext(o); opened.push(c); return c; };

test('two people block a scene together over Yjs, with presence', async ({ browser }) => {
  const room = 'e2e-' + Date.now().toString(36), a = await (await ctx(browser)).newPage(), b = await (await ctx(browser)).newPage();
  for (const [p, n] of [[a, 'Ana'], [b, 'Ben']] as const) { await p.goto('/?fresh'); await p.getByTestId('tab-live').click(); await expect(p.getByTestId('collab-join')).toBeEnabled({ timeout: 15000 }); await p.getByLabel('Your name').fill(n); await p.getByLabel('Room').fill(room); await p.getByTestId('collab-join').click(); await expect(p.getByTestId('collab-status')).toContainText('live', { timeout: 10000 }); }
  await expect(a.getByTestId('collab-status')).toContainText('1 other', { timeout: 10000 }); await expect(a.getByText('Ben')).toBeVisible();
  await a.evaluate(() => window.__studio.getState().dispatch({ type: 'setLens', cameraId: 'cam2', focal: 85 }));
  await b.evaluate(() => window.__studio.getState().dispatch({ type: 'setLighting', patch: { timeOfDay: 9 } }));
  for (const p of [a, b]) await expect.poll(() => p.evaluate(() => { const s = window.__studio.getState().project; return [s.cameras.cam2.keys[0].focal, s.lighting.timeOfDay]; }), { timeout: 10000 }).toEqual([85, 9]);
  await a.evaluate(() => window.__studio.getState().undo()); // undo travels as an inverse op
  await expect.poll(() => b.evaluate(() => window.__studio.getState().project.cameras.cam2.keys[0].focal), { timeout: 10000 }).toBe(28);
});

test('phone virtual camera: pair, stream orientation (WebRTC), calibrate, record keys', async ({ browser }) => {
  const studio = await (await ctx(browser)).newPage(); await studio.goto('/?fresh'); await studio.getByTestId('tab-live').click();
  await studio.evaluate(() => { const s = window.__studio.getState(); s.select({ kind: 'camera', id: 'cam3' }); s.setTime(4.6); });
  await expect(studio.getByRole('button', { name: 'Pair phone' })).toBeEnabled({ timeout: 15000 }); await studio.getByRole('button', { name: 'Pair phone' }).click();
  const url = await studio.locator('p.break-all').innerText(), room = new URL(url).searchParams.get('phone')!;
  const phone = await (await ctx(browser, { permissions: ['accelerometer', 'gyroscope', 'magnetometer'] })).newPage(); await phone.goto(`/?phone=${room}`); await phone.getByRole('button', { name: 'Start' }).click();
  await expect(phone.getByTestId('phone-state')).toContainText(/streaming|connected/, { timeout: 15000 });
  const tilt = (alpha: number) => phone.evaluate((a) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: a, beta: 90, gamma: 0 })), alpha);
  await tilt(0); await studio.waitForTimeout(300); await studio.getByRole('button', { name: 'Calibrate' }).click();
  await tilt(20); await expect.poll(() => studio.evaluate(() => !!window.__studio.getState().ghost)).toBe(true); // live aim preview
  const before = await studio.evaluate(() => window.__studio.getState().project.cameras.cam3.keys.length);
  await studio.getByRole('button', { name: '● Record' }).click(); for (let i = 0; i < 30; i++) { await tilt(20 + i * 2); await studio.waitForTimeout(60); } await studio.getByRole('button', { name: '■ Stop' }).click();
  const after = await studio.evaluate(() => { const c = window.__studio.getState().project.cameras.cam3; return { n: c.keys.length, last: window.__studio.getState().history.past.at(-1).label, yaws: c.keys.map((k: any) => Math.atan2(k.target[0] - k.pos[0], k.target[2] - k.pos[2])) }; });
  expect(after.n).toBeGreaterThan(before + 3); expect(after.last).toMatch(/Phone camera take/); expect(Math.abs(after.yaws.at(-1) - after.yaws[0])).toBeGreaterThan(0.2); // the pan was recorded
});

test('audio import draws a waveform and adds beat markers that keys snap to', async ({ page }) => {
  const sr = 22050, dur = 6, n = sr * dur, data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(sr, 24); data.writeUInt32LE(sr * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let b = 0.5; b < dur; b += 0.5) for (let i = 0; i < 800; i++) { const k = Math.floor(b * sr) + i; if (k < n) data.writeInt16LE(Math.round(Math.sin(i * 0.3) * Math.exp(-i / 200) * 30000), 44 + k * 2); }
  await page.goto('/?fresh&nobridge'); await page.getByTestId('tab-live').click();
  await page.locator('input[type=file][accept="audio/*"]').setInputFiles({ name: 'click-120.wav', mimeType: 'audio/wav', buffer: data });
  await expect.poll(() => page.evaluate(() => Object.values(window.__studio.getState().project.audio).length), { timeout: 15000 }).toBe(1);
  const r = await page.evaluate(() => { const p = window.__studio.getState().project; return { beats: Object.values(p.markers).filter((m: any) => m.kind === 'beat').map((m: any) => m.t).sort((a: number, b: number) => a - b), label: Object.values(p.markers).find((m: any) => m.kind === 'beat') as any, peaks: (Object.values(p.audio)[0] as any).peaks.length }; });
  expect(r.label.label).toMatch(/^1(19|20|21)(\.\d)? BPM$/); expect(r.beats.length).toBeGreaterThanOrEqual(10); expect(r.peaks).toBeGreaterThan(100);
  for (const t of [1, 2.5, 4]) expect(Math.min(...r.beats.map((x: number) => Math.abs(x - t)))).toBeLessThan(0.05);
});

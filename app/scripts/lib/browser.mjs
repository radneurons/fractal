// Shared e2e rig: serves the built app with `vite preview` and opens it in headless Chromium.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function startServer(port = 4173) {
  if (!existsSync(join(ROOT, 'dist/index.html'))) throw new Error('run `npx vite build` first');
  const proc = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(url); if (r.ok) return { url, stop: () => proc.kill() }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  proc.kill();
  throw new Error('vite preview did not start:\n' + out);
}

/** Opens the app. `local` maps URL paths under /__local/ to files on disk (for songs outside the repo). */
export async function openApp({ url, width = 1400, height = 900, local = {}, query = '' }) {
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required',
      '--enable-features=SharedArrayBuffer', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.stack ?? e)));
  await page.route('**/__local/**', async (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/__local/')[1]);
    const file = local[key];
    if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, body: readFileSync(file), contentType: file.endsWith('.mp3') ? 'audio/mpeg' : file.endsWith('.wav') ? 'audio/wav' : 'application/octet-stream' });
  });
  await page.goto(url + query);
  await page.waitForFunction(() => !!window.LE, null, { timeout: 30000 });
  await page.evaluate(() => window.LE.ready);
  return { browser, page, errors };
}

/** PNG bytes of the stage canvas. */
export async function grab(page) {
  const b64 = await page.evaluate(() => document.getElementById('stage').toDataURL('image/png').split(',')[1]);
  return Buffer.from(b64, 'base64');
}

export function args(defaults = {}) {
  const a = { ...defaults, set: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2), v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    if (k === 'set') a.set.push(v); else a[k] = v;
  }
  return a;
}

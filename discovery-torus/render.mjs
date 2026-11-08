#!/usr/bin/env node
// Offline renderer: drives index.html?capture=1 in headless Chromium, steps t
// deterministically, and pipes PNG frames into ffmpeg.
//
//   node render.mjs                       # 12 s @ 30 fps -> discovery-torus.mp4
//   node render.mjs --stills 0,3.2,7.5    # PNG stills -> out/
//   env: DURATION=12 FPS=30
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright'); // global install is fine (CJS resolution honours NODE_PATH)
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');   // serve repo root so ../string-theory/fonts resolves
const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.otf': 'font/otf', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  try {
    const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(root)) throw 0;
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;

const args = process.argv.slice(2);
const stillsArg = args.includes('--stills') ? args[args.indexOf('--stills') + 1] : null;
const FPS = Number(process.env.FPS ?? 30), DURATION = Number(process.env.DURATION ?? 12);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 720, height: 908 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://localhost:${port}/discovery-torus/index.html?capture=1`);
await page.waitForFunction(() => window.ready === true);
const canvas = await page.$('#out');
const frame = async (t) => { await page.evaluate((t) => window.renderAt(t), t); return canvas.screenshot({ type: 'png' }); };

if (stillsArg) {
  await mkdir(path.join(here, 'out'), { recursive: true });
  for (const s of stillsArg.split(',')) {
    const t0 = Date.now();
    await writeFile(path.join(here, 'out', `still_${s}.png`), await frame(Number(s)));
    console.log(`still t=${s} ${Date.now() - t0}ms`);
  }
} else {
  const file = path.join(here, 'discovery-torus.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round(DURATION * FPS), t0 = Date.now();
  for (let f = 0; f < n; f++) {
    const buf = await frame(f / FPS);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 30 === 0) console.log(`frame ${f}/${n} ${((Date.now() - t0) / (f + 1)).toFixed(0)}ms/f`);
  }
  ff.stdin.end(); await new Promise((r) => ff.on('close', r));
  console.log(`wrote ${file}`);
}
await browser.close(); server.close();

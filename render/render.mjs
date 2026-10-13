// Render he-has.html frame-by-frame via window.seek(t) and pipe JPEG frames to ffmpeg.
// usage: node render.mjs [out.mp4] [--frames=a,b,c (seconds) -> PNG stills instead]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const stills = args.find(a => a.startsWith('--frames='));
const out = args.find(a => !a.startsWith('--')) || path.join(here, 'he-has.mp4');
const FPS = 60, DUR = 30;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', e => { console.error('PAGE ERROR', e); process.exit(1); });
await page.goto('file://' + path.join(here, 'he-has.html') + '?still');
await page.waitForFunction(() => window.__ready === true);
const clip = { x: 0, y: 0, width: 1920, height: 1080 };

if (stills) {
  for (const s of stills.slice(9).split(',')) {
    await page.evaluate(t => window.seek(t), +s);
    await page.screenshot({ path: path.join(path.dirname(out), `still-${s}.png`), clip });
  }
} else {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const N = FPS * DUR;
  for (let n = 0; n < N; n++) {
    await page.evaluate(t => window.seek(t), n / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 93, clip });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (n % 300 === 0) console.log(`frame ${n}/${N}`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  console.log('wrote', out);
}
await browser.close();

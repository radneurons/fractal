// Capture tool for in-the-arena.html
//   node render.mjs video [out.mp4]          1800 frames via window.renderFrame(n) -> H.264
//   node render.mjs stills t1,t2,...          PNG stills into out/
//   node render.mjs strip a b step name       horizontal frame strip (inspect motion)
//   node render.mjs sheet                     debug contact sheet from window.debug.contactSheet()
//   node render.mjs check                     determinism + black open/close + network audit
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out'); mkdirSync(outDir, { recursive: true });
const [mode = 'stills', ...rest] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const requests = [];
page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) requests.push(r.url()); });
page.on('pageerror', e => { console.error('PAGE ERROR', e); process.exit(1); });
page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
await page.goto('file://' + path.join(here, 'in-the-arena.html') + '?capture');
await page.evaluate(() => window.ready);
const clip = { x: 0, y: 0, width: 1920, height: 1080 };
const shot = async (t, file) => { await page.evaluate(t => window.seek(t), t); await page.screenshot({ path: file, clip }); };

if (mode === 'video') {
  const out = rest[0] || path.join(outDir, 'in-the-arena.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let n = 0; n < 1500; n++) {
    await page.evaluate(n => window.renderFrame(n), n);
    const buf = await page.screenshot({ type: 'jpeg', quality: 94, clip });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (n % 50 === 0) console.log('frame', n, new Date().toISOString());
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); console.log('wrote', out);
} else if (mode === 'stills') {
  for (const s of (rest[0] || '').split(',').filter(Boolean)) await shot(+s, path.join(outDir, `s-${(+s).toFixed(2)}.png`));
} else if (mode === 'strip') {
  const [a, b, step, name] = [+rest[0], +rest[1], +rest[2], rest[3] || 'strip'];
  const files = [];
  for (let t = a; t <= b + 1e-6; t += step) { const f = path.join(outDir, `_st-${t.toFixed(3)}.png`); await shot(t, f); files.push(f); }
  const args = ['-y', '-loglevel', 'error']; files.forEach(f => args.push('-i', f));
  const cols = Math.min(4, files.length), rows = Math.ceil(files.length / cols);
  const lay = files.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, () => 'w0').join('+') : '0'}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+') : '0'}`).join('|');
  const pad = rows * cols - files.length;
  args.push('-filter_complex', `${files.map((_, i) => `[${i}]scale=480:-1[v${i}]`).join(';')};${files.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${files.length}:layout=${lay}:fill=black`, path.join(outDir, name + '.png'));
  await new Promise(r => spawn('ffmpeg', args, { stdio: 'inherit' }).on('close', r));
  void pad;
} else if (mode === 'sheet') {
  const url = await page.evaluate(() => window.debug.contactSheet().toDataURL('image/png'));
  writeFileSync(path.join(outDir, 'contact-sheet.png'), Buffer.from(url.split(',')[1], 'base64'));
} else if (mode === 'check') {
  const times = [1.8, 5.6, 9.8, 13, 15.8, 17.6, 19.6, 21.4, 23.4, 24.95];
  const asc = {}; for (const t of times) asc[t] = await page.evaluate(t => window.debug.hashFrame(t), t);
  const shuffled = [...times].sort((a, b) => ((a * 7919) % 13) - ((b * 7919) % 13)).reverse();
  let mismatch = 0; for (const t of shuffled) { const h = await page.evaluate(t => window.debug.hashFrame(t), t); if (h !== asc[t]) { mismatch++; console.log('MISMATCH at', t); } }
  const b0 = await page.evaluate(() => window.debug.isBlack(0)), b30 = await page.evaluate(() => window.debug.isBlack(25)), b2995 = await page.evaluate(() => window.debug.isBlack(24.95));
  const cues = await page.evaluate(() => window.cues);
  const text = cues.map(c => c.word).join(' ');
  console.log(JSON.stringify({ determinism: mismatch === 0 ? 'ascending == shuffled for ' + times.length + ' timestamps' : mismatch + ' mismatches', black0: b0, black25: b30, black24_95: b2995, cueCount: cues.length, hasWhich: cues.some(c => c.word === 'which'), monotonic: cues.every((c, i) => !i || c.t > cues[i - 1].t), externalRequests: requests }, null, 1));
  console.log('cue text:', text);
}
await browser.close();

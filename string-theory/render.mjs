#!/usr/bin/env node
// Offline renderer: draws frames with Skia (@napi-rs/canvas) and pipes raw
// RGBA into ffmpeg.
//
//   node render.mjs --stills 0.5,2.4,7.1          # PNG stills into out/stills
//   node render.mjs --from 0 --to 300 --out a.mkv  # frame range -> lossless segment
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { W, H, setCanvasFactory } from './src/engine.js';
import { renderFrame, FPS, DURATION } from './src/film.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fonts = {
  IDBlack: 'InterDisplay-Black.otf',
  IDBold: 'InterDisplay-Bold.otf',
  IDMedium: 'InterDisplay-Medium.otf',
  IDLight: 'InterDisplay-Light.otf',
  ISerif: 'InstrumentSerif-Regular.ttf',
  ISerifItalic: 'InstrumentSerif-Italic.ttf',
  JBMono: 'JetBrainsMono-Regular.ttf',
  JBMonoBold: 'JetBrainsMono-Bold.ttf',
  STIX: 'STIXTwoText-Regular.ttf',
  STIXItalic: 'STIXTwoText-Italic.ttf',
};
for (const [alias, file] of Object.entries(fonts)) GlobalFonts.registerFromPath(path.join(here, 'fonts', file), alias);
setCanvasFactory((w, h) => createCanvas(w, h));

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const samples = Number(args.samples ?? 3);
const out = createCanvas(W, H);
const ctx = out.getContext('2d');

if (args.stills) {
  const dir = path.join(here, 'out', 'stills');
  mkdirSync(dir, { recursive: true });
  for (const s of args.stills.split(',')) {
    const f = Math.round(Number(s) * FPS);
    const t0 = Date.now();
    renderFrame(ctx, f, { samples });
    writeFileSync(path.join(dir, `f${String(f).padStart(4, '0')}.png`), out.toBuffer('image/png'));
    console.log(`still t=${s}s frame=${f} ${Date.now() - t0}ms`);
  }
} else {
  const from = Number(args.from ?? 0);
  const to = Number(args.to ?? Math.round(DURATION * FPS));
  const file = args.out ?? path.join(here, 'out', 'segment.mkv');
  mkdirSync(path.dirname(file), { recursive: true });
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', `${FPS}`,
    '-i', '-', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'bgr0', file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res)));
  const t0 = Date.now();
  for (let f = from; f < to; f++) {
    renderFrame(ctx, f, { samples });
    await write(Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer));
    if ((f - from) % 30 === 0) console.log(`[${from}-${to}] frame ${f} ${((Date.now() - t0) / (f - from + 1)).toFixed(0)}ms/f`);
  }
  ff.stdin.end();
  await new Promise((res) => ff.on('close', res));
  console.log(`done ${file} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

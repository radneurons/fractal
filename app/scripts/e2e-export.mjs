// Export e2e (SPEC §17): everything through the app's own exporter, verified with ffprobe/ffmpeg.
//  • 2 s MP4: H.264 + audio, duration and frame rate
//  • 2 s VP9-alpha WebM: alpha_mode=1 (or, where the encoder lacks alpha, the PNG-sequence zip fallback is valid)
//  • GIF: the requested frame count
//  • loudness-normalised audio: −14 ± 0.5 LUFS measured by ffmpeg's ebur128
//  • ASS / SRT / VTT sidecars parse (ffprobe reads them as subtitle streams)
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import { startServer, openApp, args, ROOT } from './lib/browser.mjs';

const a = args({ out: 'out/export' });
const outDir = resolve(ROOT, a.out);
mkdirSync(outDir, { recursive: true });
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };
const probe = (f, extra = []) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', ...extra, f], { encoding: 'utf8' }));
const server = await startServer(Number(a.port ?? 4188));
const { browser, page, errors } = await openApp({ url: server.url });
page.setDefaultTimeout(0);
async function save(name, bytes) {
  const fd = [];
  for (let off = 0; off < bytes; off += 8 << 20) fd.push(Buffer.from(await page.evaluate(([o, l]) => window.LE.readExport(o, l), [off, 8 << 20]), 'base64'));
  const f = join(outDir, name); writeFileSync(f, Buffer.concat(fd)); return f;
}
try {
  await page.evaluate(() => window.LE.loadDemo());
  await page.evaluate(() => window.LE.setEffect('broadside'));
  await page.evaluate(() => window.LE.whenReady());

  // 1. MP4
  let r = await page.evaluate(() => window.LE.exportClip({ format: 'mp4', res: 360, fps: 30, start: 24, end: 26, quality: 4, chunked: true }));
  let f = await save('clip.mp4', r.bytes);
  let p = probe(f);
  const v = p.streams.find((s) => s.codec_type === 'video'), au = p.streams.find((s) => s.codec_type === 'audio');
  check('MP4 has H.264 video and audio', v?.codec_name === 'h264' && !!au, `${v?.codec_name} ${v?.width}×${v?.height} + ${au?.codec_name}`);
  check('MP4 duration 2 s ± 0.1', Math.abs(Number(p.format.duration) - 2) <= 0.1, `${Number(p.format.duration).toFixed(3)} s`);
  check('MP4 frame rate 30', v?.r_frame_rate === '30/1' || v?.avg_frame_rate === '30/1', `${v?.r_frame_rate} / ${v?.avg_frame_rate}`);

  // 2. alpha
  await page.evaluate(() => { window.LE.setEffect('karaoke'); window.LE.setSetting('transparentBackground', true); });
  await page.evaluate(() => window.LE.whenReady());
  const alphaOk = await page.evaluate(() => window.LE.alphaSupported(640, 360, 30));
  if (alphaOk) {
    r = await page.evaluate(() => window.LE.exportClip({ format: 'webm', alpha: true, res: 360, fps: 30, start: 24, end: 26, quality: 4, chunked: true }));
    f = await save('alpha.webm', r.bytes);
    p = probe(f);
    const vs = p.streams.find((s) => s.codec_type === 'video');
    const am = vs?.tags?.alpha_mode ?? vs?.tags?.ALPHA_MODE;
    check('WebM is VP9 with alpha_mode=1', vs?.codec_name === 'vp9' && String(am) === '1', `${vs?.codec_name}, alpha_mode=${am}`);
  } else {
    r = await page.evaluate(() => window.LE.exportPngZip({ res: 360, fps: 12, start: 24, end: 25 }));
    f = await save('alpha-frames.zip', r.bytes);
    const files = Object.entries(unzipSync(readFileSync(f))).filter(([n]) => n.endsWith('.png'));
    const sig = files.every(([, d]) => d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47);
    check('no VP9-alpha encoder here: PNG zip fallback is valid', files.length === r.frames && files.length >= 12 && sig, `${files.length} PNGs`);
  }
  await page.evaluate(() => window.LE.setSetting('transparentBackground', false));

  // 3. GIF
  await page.evaluate(() => window.LE.setEffect('broadside'));
  await page.evaluate(() => window.LE.whenReady());
  r = await page.evaluate(() => window.LE.exportGif({ start: 26, end: 27.5, fps: 12, width: 320 }));
  f = await save('clip.gif', r.bytes);
  const nb = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());
  check('GIF has the requested frame count (1.5 s × 12 fps = 18)', nb === 18 && r.frames === 18, `ffprobe ${nb}, exporter ${r.frames}`);

  // 4. loudness normalisation
  r = await page.evaluate(() => window.LE.exportClip({ format: 'mp4', res: 360, fps: 30, start: 24, end: 36, quality: 2, normalise: -14, chunked: true }));
  f = await save('normalised.mp4', r.bytes);
  const log = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-map', '0:a', '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const I = Number(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+)/.exec(log)?.[1]);
  check('normalised audio measures −14 ± 0.5 LUFS (ffmpeg ebur128)', Math.abs(I + 14) <= 0.5, `${I.toFixed(2)} LUFS (exporter reported ${r.lufs?.toFixed?.(2)})`);

  // 5. sidecars
  const sc = await page.evaluate(() => window.LE.sidecars());
  for (const [ext, text] of Object.entries(sc)) {
    const sf = join(outDir, `lyrics.${ext}`); writeFileSync(sf, text);
    let ok = false, detail = '';
    try { const q = probe(sf); const s0 = q.streams[0]; ok = s0?.codec_type === 'subtitle'; detail = `${s0?.codec_name}`; } catch (e) { detail = String(e.message).slice(0, 120); }
    if (ext === 'ass') { const dl = text.split('\n').filter((l) => l.startsWith('Dialogue:')).length; ok = ok && /\[Script Info\]/.test(text) && /\[V4\+ Styles\]/.test(text) && dl >= 10; detail += `, ${dl} dialogue lines`; }
    check(`${ext.toUpperCase()} sidecar parses`, ok, detail);
  }
  const errs = [...errors, ...(await page.evaluate(() => window.LE.errors))].filter((e) => !/ResizeObserver loop/.test(e));
  check('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
} finally { await browser.close(); server.stop(); }
console.log(failed ? `${failed} export check(s) failed` : 'export ok');
process.exit(failed ? 1 : 0);

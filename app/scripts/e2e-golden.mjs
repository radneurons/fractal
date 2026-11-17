// Golden frames (SPEC §17): 4 times × 3 aspects × 16 effects, compared with stored PNGs by a perceptual difference
// (mean SSIM over 8×8 luma blocks ≥ 0.97). `--update` rewrites the goldens after a deliberate change; diff images
// (abs difference ×4) go to out/golden-diff/. Goldens live in test/golden/ at a small size to keep the repo light.
//   node scripts/e2e-golden.mjs [--update] [--effects a,b] [--aspects 16:9,9:16,1:1]
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startServer, openApp, args, ROOT } from './lib/browser.mjs';

const a = args({ times: '9.3,26.2,44.6,57.9', aspects: '16:9,9:16,1:1', res: '180', min: '0.97' });
const update = process.argv.includes('--update');
const goldDir = resolve(ROOT, 'test/golden'), diffDir = resolve(ROOT, 'out/golden-diff');
mkdirSync(goldDir, { recursive: true }); mkdirSync(diffDir, { recursive: true });
const server = await startServer(Number(a.port ?? 4195));
const { browser, page, errors } = await openApp({ url: server.url + '?soft2d' });
let failed = 0, compared = 0, written = 0;
const pending = []; // PNGs to convert to lossless WebP (2.4× smaller in the repo)
const worst = [];
try {
  await page.evaluate((r) => { window.LE.state.previewRes = Number(r); }, a.res);
  await page.evaluate(() => window.LE.loadDemo());
  const effects = a.effects ? a.effects.split(',') : await page.evaluate(() => window.LE.effects().map((e) => e.id).filter((id) => id !== 'rise'));
  const times = a.times.split(',').map(Number);
  for (const aspect of a.aspects.split(',')) {
    await page.evaluate((x) => window.LE.setSetting('aspect', x), aspect);
    for (const id of effects) {
      await page.evaluate((e) => window.LE.setEffect(e), id);
      await page.evaluate(() => window.LE.whenReady());
      for (const t of times) {
        await page.evaluate((x) => window.LE.renderAt(x), t);
        const stem = `${id}-${aspect.replace(':', 'x')}-${String(t).replace('.', '_')}`, name = `${stem}.png`;
        const png = Buffer.from((await page.evaluate(() => document.getElementById('stage').toDataURL('image/png'))).split(',')[1], 'base64');
        const gf = join(goldDir, `${stem}.webp`);
        if (update || !existsSync(gf)) { writeFileSync(gf + '.png', png); pending.push(gf); written++; continue; }
        const gold = 'data:image/webp;base64,' + readFileSync(gf).toString('base64');
        const r = await page.evaluate(async (g) => {
          const img = new Image(); img.src = g; await img.decode();
          const cur = document.getElementById('stage');
          if (img.width !== cur.width || img.height !== cur.height) return { ssim: 0, note: `size ${img.width}×${img.height} vs ${cur.width}×${cur.height}` };
          const W = cur.width, H = cur.height;
          const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; const g2 = c2.getContext('2d'); g2.drawImage(img, 0, 0);
          const A = g2.getImageData(0, 0, W, H).data, B = cur.getContext('2d').getImageData(0, 0, W, H).data;
          const Y = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
          let sum = 0, n = 0;
          for (let by = 0; by + 8 <= H; by += 8) for (let bx = 0; bx + 8 <= W; bx += 8) {
            let ma = 0, mb = 0; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const i = ((by + y) * W + bx + x) * 4; ma += Y(A, i); mb += Y(B, i); }
            ma /= 64; mb /= 64;
            let va = 0, vb = 0, cv = 0; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const i = ((by + y) * W + bx + x) * 4; const da = Y(A, i) - ma, db = Y(B, i) - mb; va += da * da; vb += db * db; cv += da * db; }
            va /= 63; vb /= 63; cv /= 63;
            sum += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
          }
          // diff image: |A − B| × 4
          const out = g2.createImageData(W, H);
          for (let i = 0; i < A.length; i += 4) { for (let k = 0; k < 3; k++) out.data[i + k] = Math.min(255, Math.abs(A[i + k] - B[i + k]) * 4); out.data[i + 3] = 255; }
          g2.putImageData(out, 0, 0);
          return { ssim: sum / n, diff: c2.toDataURL('image/png') };
        }, gold);
        compared++;
        worst.push([r.ssim, name]);
        if (r.ssim < Number(a.min)) {
          failed++;
          console.log(`  ✗ ${name}  SSIM ${r.ssim.toFixed(4)}${r.note ? ' ' + r.note : ''}`);
          if (r.diff) writeFileSync(join(diffDir, name), Buffer.from(r.diff.split(',')[1], 'base64'));
        }
      }
    }
  }
  const errs = [...errors, ...(await page.evaluate(() => window.LE.errors))].filter((e) => !/ResizeObserver loop/.test(e));
  if (errs.length) { console.log('  ✗ page errors: ' + errs.slice(0, 3).join(' | ')); failed++; }
} finally { await browser.close(); server.stop(); }
if (pending.length) {
  const py = 'import sys,os\nfrom PIL import Image\nfor f in sys.argv[1:]:\n  Image.open(f+".png").save(f,"WEBP",lossless=True,method=6); os.remove(f+".png")';
  const r = spawnSync('python3', ['-c', py, ...pending], { stdio: 'inherit' });
  if (r.status !== 0) { console.log('  ✗ could not convert goldens to WebP (needs python3 + Pillow)'); failed++; }
}
worst.sort((x, y) => x[0] - y[0]);
if (written) console.log(`  wrote ${written} golden frame(s) to test/golden/`);
if (compared) console.log(`  compared ${compared}; lowest SSIM ${worst.slice(0, 3).map(([s, n]) => `${n} ${s.toFixed(4)}`).join(', ')}`);
console.log(failed ? `${failed} golden check(s) failed (diffs in out/golden-diff/)` : 'golden frames ok');
process.exit(failed ? 1 : 0);

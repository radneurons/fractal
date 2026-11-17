// Hybrid e2e (SPEC §17): every material on BROADSIDE, fire on MISSION POSTER, engraving on DROSTE, chrome on POP-UP,
// two overlay pairings and an all-off control. Saves stills + a contact sheet; fails on any error, on a blank frame,
// or when a material leaves the frame identical to the all-off control.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { startServer, openApp, args, ROOT, grab } from './lib/browser.mjs';

const a = args({ out: 'out/hybrid', t: '27.2', res: '360' });
const outDir = resolve(ROOT, a.out);
mkdirSync(outDir, { recursive: true });
const T = Number(a.t);
const server = await startServer(Number(a.port ?? 4189));
const { browser, page, errors } = await openApp({ url: server.url });
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };
const files = [];
async function shot(name, setup) {
  await page.evaluate(setup.fn, setup.arg);
  await page.evaluate(() => window.LE.whenReady());
  await page.evaluate((t) => window.LE.renderAt(t), T);
  const png = await grab(page);
  const f = join(outDir, `${name}.png`); writeFileSync(f, png); files.push(f);
  const stats = await page.evaluate(() => { const c = document.getElementById('stage'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; return lit / (d.length / 4); });
  return { hash: createHash('sha1').update(png).digest('hex'), lit: stats };
}
try {
  await page.evaluate((r) => { window.LE.state.previewRes = Number(r); }, a.res);
  await page.evaluate(() => window.LE.loadDemo());
  const materials = ['chrome', 'fire', 'engraving', 'neon', 'halftone', 'stardust', 'glass', 'goldleaf', 'frost', 'holo', 'lava', 'embroidery'];
  const off = await shot('broadside-off', { fn: () => { window.LE.setEffect('broadside'); window.LE.setHybrid({ material: null, overlay: null }); } });
  check('all-off control renders', off.lit > 0.01, `${(off.lit * 100).toFixed(1)} % lit`);
  for (const m of materials) {
    const r = await shot(`broadside-${m}`, { fn: (k) => window.LE.setHybrid({ material: { kind: k } }), arg: m });
    check(`BROADSIDE + ${m}`, r.hash !== off.hash && r.lit > 0.005, `${(r.lit * 100).toFixed(1)} % lit`);
  }
  for (const [eff, m] of [['mission', 'fire'], ['droste', 'engraving'], ['popup', 'chrome']]) {
    const base = await shot(`${eff}-off`, { fn: (e) => { window.LE.setEffect(e); window.LE.setHybrid({ material: null, overlay: null }); }, arg: eff });
    const r = await shot(`${eff}-${m}`, { fn: (k) => window.LE.setHybrid({ material: { kind: k } }), arg: m });
    check(`${eff.toUpperCase()} + ${m}`, r.hash !== base.hash && r.lit > 0.005, `${(r.lit * 100).toFixed(1)} % lit`);
  }
  for (const [eff, over, blend] of [['karaoke', 'swarm', 'screen'], ['sumi', 'fireworks', 'add']]) {
    const base = await shot(`${eff}-alone`, { fn: (e) => { window.LE.setEffect(e); window.LE.setHybrid({ material: null, overlay: null }); }, arg: eff });
    const r = await shot(`${eff}+${over}`, { fn: ([o, b]) => window.LE.setHybrid({ overlay: { effect: o, blend: b, opacity: 0.6 } }), arg: [over, blend] });
    check(`overlay ${over.toUpperCase()} (${blend}) on ${eff.toUpperCase()}`, r.hash !== base.hash, `${(r.lit * 100).toFixed(1)} % lit`);
  }
  await page.evaluate(() => window.LE.setHybrid({ material: null, overlay: null }));
  const errs = [...errors, ...(await page.evaluate(() => window.LE.errors))].filter((e) => !/ResizeObserver loop/.test(e));
  check('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
} finally { await browser.close(); server.stop(); }
spawnSync('python3', [join(ROOT, 'scripts/sheet.py'), join(outDir, 'sheet.png'), '5', '320', ...files], { stdio: 'inherit' });
console.log(failed ? `${failed} hybrid check(s) failed` : 'hybrid ok');
process.exit(failed ? 1 : 0);

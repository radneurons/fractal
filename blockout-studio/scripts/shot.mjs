import { chromium } from "@playwright/test";
const [,, out, url='http://localhost:5173/?fresh', script=''] = process.argv;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
const logs = []; p.on('console', m => { if (m.type() === 'error' || m.type()==='warning') logs.push(m.type()+': '+m.text().slice(0, 300)); }); p.on('pageerror', e => logs.push('PAGEERROR ' + e.message.slice(0, 400)));
await p.goto(url); await p.waitForTimeout(3500);
if (script) { const r = await p.evaluate(script); if (r !== undefined) console.log('eval:', JSON.stringify(r)); await p.waitForTimeout(1500); }
await p.screenshot({ path: out }); console.log(logs.slice(0, 12).join('\n')); await b.close();

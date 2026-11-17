import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 950 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.addInitScript(() => localStorage.setItem('blockout:layout', JSON.stringify({ sceneRight: true, sidebarLeft: true, resultTop: true })));
await p.goto('http://localhost:5174/?fresh&nobridge'); await p.waitForTimeout(4000); await p.screenshot({ path: process.argv[2] }); console.log(errs.join('\n')); await b.close();

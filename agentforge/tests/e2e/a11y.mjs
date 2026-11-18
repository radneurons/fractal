// Automated accessibility audit (axe-core, WCAG 2.1 A/AA rules) of every main route in dark, light and high-contrast themes.
// Usage: npm run build && npm run a11y. Automated checks catch roughly a third of issues — not a substitute for testing with people.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = 4181;
const BASE = `http://localhost:${PORT}/`;
const ROUTES = ['', 'home', 'onboarding', 'universe', 'academy', 'academy/s4', 'lesson/l-chatbot-vs-agent', 'planner', 'lab/prompt', 'lab/code', 'lab/api', 'lab/terminal', 'lab/review', 'lab/eval', 'lab/compare', 'lab/mcp', 'studio', 'arena', 'arena/prompt-architect', 'brain-gym', 'interview', 'projects', 'projects/p-agentloop', 'observatory', 'vault', 'review', 'practice/t-mcp', 'recover/t-mcp', 'settings'];

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: new URL('../../', import.meta.url).pathname, stdio: 'pipe', detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); } };
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); res(); } });
});

const browser = await chromium.launch();
let total = 0;
try {
  for (const theme of ['dark', 'light', 'contrast']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: theme === 'light' ? 'light' : 'dark', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    for (const r of ROUTES) {
      await page.goto(BASE + '#/' + r);
      await page.locator('main, h1').first().waitFor({ timeout: 10000 }).catch(() => {});
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await page.waitForTimeout(400);
      await page.addScriptTag({ content: AXE });
      const res = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'], resultTypes: ['violations'] })).violations
        .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + (n.any[0]?.message ? ` — ${n.any[0].message}` : '')) , count: v.nodes.length })));
      total += res.length;
      for (const v of res) console.log(`[${theme}] /${r}: ${v.impact} ${v.id} ×${v.count} — ${v.help}\n    ${v.nodes.join('\n    ')}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  stop();
}
console.log(total ? `\n${total} violation group(s) found` : '\nNo axe violations on any route in dark, light or high-contrast theme');
process.exit(total ? 1 : 0);

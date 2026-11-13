// End-to-end learner journey (MASTER_PROMPT §14). Runs against `vite preview`.
// Usage: npm run build && npm run e2e   (starts its own preview server)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: new URL('../../', import.meta.url).pathname, stdio: 'pipe', detached: true });
const stopServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); } };
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); res(); } });
  server.stderr.on('data', (d) => process.stderr.write(d));
});

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(['✓', name]);
    console.log(`✓ ${name}`);
  } catch (e) {
    results.push(['✗', name, e.message]);
    console.log(`✗ ${name}\n   ${e.message.split('\n')[0]}`);
    throw e;
  }
};
const expectVisible = async (loc, msg) => {
  await loc.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => { throw new Error(msg); });
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

let failed = false;
try {
  await step('1. Opens the platform (landing with three entry points)', async () => {
    await page.goto(BASE);
    await expectVisible(page.getByRole('button', { name: /starting from zero/i }), 'entry point missing');
    await expectVisible(page.getByRole('button', { name: /already use AI/i }), 'entry 2 missing');
    await expectVisible(page.getByRole('button', { name: /test my skills/i }), 'entry 3 missing');
    await page.screenshot({ path: SHOTS + '01-landing.png' });
  });

  await step('2. Completes onboarding (level, goal, time)', async () => {
    await page.getByRole('button', { name: /starting from zero/i }).click();
    await page.getByRole('button', { name: /^Continue/ }).click();
    await page.getByRole('radio', { name: /AI Agent Engineer/ }).click();
    await page.getByRole('button', { name: /^Continue/ }).click();
    await page.getByRole('button', { name: '20 min' }).click();
    await page.getByRole('button', { name: /Start the skills check/ }).click();
  });

  await step('3. Takes the adaptive diagnostic (6 items)', async () => {
    for (let i = 0; i < 6; i++) {
      await expectVisible(page.getByRole('button', { name: /Check answer|I don't know yet/ }), `diagnostic item ${i + 1} missing`);
      const opts = page.locator('.opts [role="radio"], .opts [role="checkbox"]');
      if (await opts.count()) {
        await opts.nth(i % 2).click();
        await page.getByRole('button', { name: 'Check answer' }).click();
      } else {
        await page.getByRole('button', { name: /I don't know yet/ }).click();
      }
      await page.getByRole('button', { name: /Next question|Finish/ }).click();
    }
    await page.getByRole('button', { name: /See my results/ }).click();
  });

  await step('4. Receives a personalised plan', async () => {
    await expectVisible(page.getByRole('heading', { name: /Here's what we found/ }), 'plan reveal missing');
    await expectVisible(page.getByText(/Your first week/), 'first week plan missing');
    await page.screenshot({ path: SHOTS + '02-plan.png' });
  });

  await step('5. Starts a lesson (Chatbot vs Agent)', async () => {
    const sig = page.getByRole('button', { name: /signature lesson/ });
    if (await sig.count()) await sig.click();
    else await page.goto(BASE + '#/lesson/L-ag01');
    await expectVisible(page.getByRole('heading', { name: 'Chatbot vs agent' }), 'lesson title missing');
    await page.getByRole('button', { name: /Explore/ }).click();
    await expectVisible(page.getByText(/Agent loop simulator/), 'agent loop demo missing');
    await page.getByRole('button', { name: /^Step$|Step$/ }).first().click();
    await page.screenshot({ path: SHOTS + '03-lesson-demo.png' });
  });

  await step('6. Answers incorrectly and receives a specific explanation', async () => {
    await page.getByRole('button', { name: /Guided practice/ }).click();
    await page.getByRole('radio', { name: /bigger, more intelligent model/ }).click();
    await page.getByRole('button', { name: 'Check answer' }).click();
    await expectVisible(page.getByText('✗ Not yet'), 'incorrect result not shown');
    await expectVisible(page.getByText(/Model size does not make something an agent/), 'distractor-specific feedback missing');
  });

  await step('7. Completes remediation: targeted follow-up on a different item', async () => {
    await expectVisible(page.getByText('Targeted follow-up'), 'follow-up missing');
    const follow = page.locator('section[aria-label="Follow-up question"]');
    await follow.getByRole('radio', { name: /Call get_revenue with quarter/ }).click();
    await follow.getByRole('button', { name: 'Check answer' }).click();
  });

  await step('8. Passes the follow-up question', async () => {
    await expectVisible(page.locator('section[aria-label="Follow-up question"]').getByText('✓ Correct'), 'follow-up not graded correct');
    await page.screenshot({ path: SHOTS + '04-remediation.png' });
  });

  await step('9. Answers a lesson question with the keyboard only', async () => {
    await page.getByRole('button', { name: /Knowledge check/ }).click();
    // Knowledge check is a classify item — use the select-then-place buttons via keyboard.
    const item = page.locator('section[aria-label="Knowledge check"]');
    await expectVisible(item, 'knowledge check missing');
    const answers = {
      'Translate one paragraph into French': 'Single model call',
      'Extract fields from an invoice, then validate, then save — always in that order': 'Workflow (code decides steps)',
      'Investigate a bug: read files, run tests, edit, re-run until tests pass': 'Agent (model decides steps)',
      'Classify a ticket and route it to one of three fixed prompts': 'Workflow (code decides steps)',
    };
    for (const [card, bucket] of Object.entries(answers)) {
      await item.getByRole('button', { name: card, exact: true }).focus();
      await page.keyboard.press('Enter');
      await item.getByRole('button', { name: `Place selected card in ${bucket}` }).focus();
      await page.keyboard.press('Enter');
    }
    await item.getByRole('button', { name: 'Check answer' }).focus();
    await page.keyboard.press('Enter');
    await expectVisible(item.getByText('✓ Correct'), 'keyboard classify not correct');
  });

  await step('10. Completes a practical exercise (code runs in the sandbox)', async () => {
    await page.goto(BASE + '#/lab/code');
    await page.getByRole('button', { name: /Variables, types & control flow/ }).click();
    const editor = page.locator('.cm-content').first();
    await editor.waitFor();
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.insertText('function countPassing(scores) {\n  let passed = 0;\n  for (const s of scores) if (s >= 60) passed++;\n  return passed;\n}');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expectVisible(page.getByText('3/3 tests passed'), 'sandbox tests did not pass');
    await page.screenshot({ path: SHOTS + '05-code-lab.png' });
  });

  await step('11. Skill indicator updates from evidence (Observatory)', async () => {
    await page.goto(BASE + '#/observatory');
    await expectVisible(page.getByRole('link', { name: 'Chatbot vs agent' }), 'skill missing from matrix');
    await page.getByRole('link', { name: 'Chatbot vs agent' }).locator('xpath=ancestor::tr').getByRole('button', { name: 'Why this score?' }).click();
    await expectVisible(page.getByText(/estimate = \(1 \+/), 'formula explanation missing');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: SHOTS + '06-observatory.png' });
  });

  let evidenceBefore = '';
  await step('12. Saves progress and reloads the application', async () => {
    evidenceBefore = await page.locator('.kpi .v').first().innerText();
    await page.waitForTimeout(600); // allow async IndexedDB write
    await page.reload();
    await expectVisible(page.getByRole('heading', { name: 'What you can demonstrably do' }), 'observatory missing after reload');
    const after = await page.locator('.kpi .v').first().innerText();
    if (after !== evidenceBefore) throw new Error(`evidence count changed after reload: ${evidenceBefore} → ${after}`);
  });

  await step('13. Continues where they left off (lesson resumes at saved step)', async () => {
    await page.goto(BASE + '#/');
    await expectVisible(page.getByRole('link', { name: /Continue where you left off/ }), 'continue link missing');
    await page.goto(BASE + '#/lesson/L-ag01');
    await expectVisible(page.locator('.lesson-steps [aria-current="step"]').getByText('Knowledge check'), 'lesson did not resume at saved step');
  });

  await step('Extra: Agent Studio — faulty template fails, fix makes tests pass', async () => {
    await page.goto(BASE + '#/studio/bug-no-stop');
    await page.getByRole('button', { name: /Run tests/ }).first().click();
    await expectVisible(page.locator('.chip.danger', { hasText: 'fail' }), 'faulty template did not fail');
    await page.locator('.react-flow__node').filter({ hasText: 'Docs agent' }).click();
    await page.getByRole('tab', { name: 'Inspect' }).click();
    await page.getByLabel('Stop when goal is met').check();
    await page.getByRole('button', { name: /Run tests/ }).first().click();
    await expectVisible(page.locator('.chip.accent', { hasText: 'pass' }), 'fixed template did not pass');
    await page.screenshot({ path: SHOTS + '07-studio.png' });
  });

  await step('Extra: Knowledge Universe renders 3D and has an accessible 2D view', async () => {
    await page.goto(BASE + '#/universe');
    await expectVisible(page.locator('.universe canvas'), 'WebGL canvas missing');
    await page.waitForTimeout(800);
    await page.screenshot({ path: SHOTS + '08-universe.png' });
    await page.getByRole('button', { name: 'List / 2D' }).click();
    await expectVisible(page.getByRole('button', { name: /^Tokens & tokenization/ }), '2D list missing');
    await page.getByRole('button', { name: /^Tokens & tokenization/ }).first().click();
    await expectVisible(page.getByRole('complementary', { name: 'Skill details' }), 'skill panel missing');
    await page.getByRole('button', { name: '3D' }).click();
  });

  await step('Extra: Focus Mode toggles and persists', async () => {
    await page.goto(BASE + '#/home');
    await page.getByRole('button', { name: 'Enter Focus Mode' }).click();
    if (!(await page.evaluate(() => document.body.classList.contains('focus-mode')))) throw new Error('focus mode not applied');
    await page.waitForTimeout(400);
    await page.reload();
    if (!(await page.evaluate(() => document.body.classList.contains('focus-mode')))) throw new Error('focus mode not persisted');
    await page.getByRole('button', { name: 'Exit Focus Mode' }).click();
  });

  await step('Extra: every main route renders', async () => {
    for (const r of ['home', 'academy', 'academy/s4', 'planner', 'lab/prompt', 'lab/api', 'lab/terminal', 'lab/review', 'lab/eval', 'arena', 'arena/prompt-architect', 'arena/token-commander', 'brain-gym', 'interview', 'projects', 'projects/p-agentloop', 'vault', 'settings', 'review', 'practice/t-mcp', 'recover/t-mcp']) {
      await page.goto(BASE + '#/' + r);
      await page.locator('main h1, main h2').first().waitFor({ timeout: 8000 }).catch(() => { throw new Error(`route /${r} did not render a heading`); });
    }
  });

  await step('Extra: mobile layout has bottom navigation and no horizontal scroll', async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await m.newPage();
    await p.goto(BASE + '#/academy');
    await p.locator('.mobile-nav').waitFor();
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await p.screenshot({ path: SHOTS + '09-mobile.png' });
    await m.close();
    if (overflow > 2) throw new Error(`horizontal overflow of ${overflow}px`);
  });

  await step('Extra: WebGL unavailable → 2D fallback', async () => {
    const ctx2 = await browser.newContext();
    await ctx2.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(String(t)) ? null : orig.call(this, t, ...a); };
    });
    const p = await ctx2.newPage();
    await p.goto(BASE + '#/universe');
    await p.getByText('WebGL unavailable — showing accessible view').waitFor({ timeout: 8000 });
    await ctx2.close();
  });

  await step('Console is clean (no errors)', async () => {
    const relevant = consoleErrors.filter((e) => !/favicon|fonts\.g(oogleapis|static)|ERR_(NAME|INTERNET|CONNECTION|TUNNEL)|net::/i.test(e));
    if (relevant.length) throw new Error(relevant.slice(0, 5).join('\n'));
  });
} catch {
  failed = true;
} finally {
  await browser.close();
  stopServer();
}
console.log(`\n${results.filter((r) => r[0] === '✓').length}/${results.length} journey steps passed`);
process.exit(failed ? 1 : 0);

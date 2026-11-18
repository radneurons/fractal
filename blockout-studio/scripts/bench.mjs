// pnpm bench — run the performance budget on THIS machine's GPU (opens a browser window) against the production build.
import { spawnSync } from 'node:child_process';
const r = spawnSync('pnpm', ['exec', 'playwright', 'test', 'e2e/perf-budget.spec.ts', '--trace', 'off', '--reporter', 'list'], { stdio: 'inherit', env: { ...process.env, BLOCKOUT_BENCH_HW: '1' } });
process.exit(r.status ?? 1);

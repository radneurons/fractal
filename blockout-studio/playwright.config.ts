import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', timeout: 240_000, workers: 1, reporter: [['list']],
  use: { baseURL: 'http://localhost:5174', viewport: { width: 1600, height: 950 }, launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
  webServer: [
    { command: 'pnpm --filter @blockout/studio exec vite --port 5174 --strictPort', url: 'http://localhost:5174', reuseExistingServer: true, timeout: 60_000 },
    { command: 'BLOCKOUT_DATA_DIR=../../.blockout-data/e2e pnpm --filter @blockout/bridge exec tsx src/index.ts --port 8787', url: 'http://127.0.0.1:8787/health', reuseExistingServer: true, timeout: 60_000 },
  ],
});

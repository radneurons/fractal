import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/*/src/**/*.test.ts', 'apps/bridge/src/**/*.test.ts'], testTimeout: 60000 } });

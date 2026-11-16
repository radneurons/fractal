#!/usr/bin/env -S npx tsx
import { readFileSync } from 'node:fs';
import { ProjectS } from '@blockout/core';
import { startBridge } from './server';
export * from './server';
export * from './claude';
export * from './secrets';

if (process.argv[1] && /bridge[\\/]src[\\/]index\.ts$/.test(process.argv[1])) {
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const file = arg('project');
  startBridge({ port: arg('port') ? +arg('port')! : undefined, dataDir: arg('data'), project: file ? ProjectS.parse(JSON.parse(readFileSync(file, 'utf8'))) : undefined }).catch((e) => { console.error(`[bridge] failed to start: ${e.message}`); process.exit(1); });
}

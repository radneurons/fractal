// PracticeRuntime — runs learner JavaScript in an isolated Web Worker.
// Isolation: no DOM; network & storage APIs deleted from the worker scope; hard wall-clock timeout via terminate().
import { runHarness, type HarnessResult, type HarnessTest } from './harness';

export const SANDBOX_TIMEOUT_MS = 2000;

export interface SandboxRun extends HarnessResult {
  timedOut: boolean;
  durationMs: number;
  passed: number;
  total: number;
}

const WORKER_SRC = `
  // Remove capabilities a learner program must not have.
  for (const k of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','indexedDB','caches','BroadcastChannel','Worker','SharedWorker','navigator']) {
    try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch (e) { try { self[k] = undefined; } catch (_) {} }
  }
  const runHarness = ${runHarness.toString()};
  self.onmessage = async (ev) => {
    const { source, exportNames, tests } = ev.data;
    const out = await runHarness(source, exportNames, tests);
    self.postMessage(out);
  };
`;

let workerUrl: string | null = null;
function getWorkerUrl() {
  if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
  return workerUrl;
}

export function runInSandbox(source: string, exportNames: string[], tests: HarnessTest[], timeoutMs = SANDBOX_TIMEOUT_MS): Promise<SandboxRun> {
  const started = performance.now();
  return new Promise((resolve) => {
    const finish = (r: HarnessResult, timedOut: boolean) => {
      const passed = r.results.filter((x) => x.passed).length;
      resolve({ ...r, timedOut, durationMs: Math.round(performance.now() - started), passed, total: tests.length });
    };
    let worker: Worker;
    try {
      worker = new Worker(getWorkerUrl());
    } catch (e) {
      finish({ results: tests.map((t) => ({ name: t.name, passed: false, error: 'Sandbox unavailable in this browser' })), logs: [], compileError: String(e) }, false);
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      finish({ results: tests.map((t) => ({ name: t.name, passed: false, error: `Timed out after ${timeoutMs}ms (infinite loop?)` })), logs: [] }, true);
    }, timeoutMs);
    worker.onmessage = (ev: MessageEvent<HarnessResult>) => {
      clearTimeout(timer);
      worker.terminate();
      finish(ev.data, false);
    };
    worker.onerror = (ev) => {
      clearTimeout(timer);
      worker.terminate();
      finish({ results: tests.map((t) => ({ name: t.name, passed: false, error: ev.message })), logs: [], compileError: ev.message }, false);
    };
    worker.postMessage({ source, exportNames, tests });
  });
}

/// <reference lib="webworker" />
// Python runtime worker. Loads Pyodide from this app's own files (no CDN), then removes network and
// storage capabilities from the worker scope before any learner code runs. The main thread enforces a
// wall-clock limit by terminating this worker.
import { PY_HARNESS } from './pyHarness';

type Pyodide = { runPythonAsync: (code: string) => Promise<unknown>; globals: { set: (k: string, v: unknown) => void } };
let py: Pyodide | null = null;

const BLOCK = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker'];

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as { kind: 'init'; indexURL: string } | { kind: 'run'; id: number; source: string; tests: { name: string; code: string }[] };
  if (msg.kind === 'init') {
    try {
      const mod = await import(/* @vite-ignore */ `${msg.indexURL}pyodide.mjs`);
      py = await mod.loadPyodide({ indexURL: msg.indexURL, stdout: () => {}, stderr: () => {} });
      // Learner code must not reach the network or storage (also blocks `import js; js.fetch(...)`).
      for (const k of BLOCK) {
        try {
          Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false });
        } catch {
          try {
            (self as unknown as Record<string, unknown>)[k] = undefined;
          } catch {
            /* ignore */
          }
        }
      }
      self.postMessage({ kind: 'ready' });
    } catch (e) {
      self.postMessage({ kind: 'init-error', error: String((e as Error)?.message ?? e) });
    }
    return;
  }
  if (msg.kind === 'run') {
    if (!py) {
      self.postMessage({ kind: 'result', id: msg.id, result: { results: msg.tests.map((t) => ({ name: t.name, passed: false, error: 'Python runtime not ready' })), logs: [] } });
      return;
    }
    try {
      py.globals.set('__af_source', msg.source);
      py.globals.set('__af_tests', JSON.stringify(msg.tests));
      const out = (await py.runPythonAsync(PY_HARNESS)) as string;
      self.postMessage({ kind: 'result', id: msg.id, result: JSON.parse(out) });
    } catch (e) {
      self.postMessage({ kind: 'result', id: msg.id, result: { results: msg.tests.map((t) => ({ name: t.name, passed: false, error: 'Runtime error' })), logs: [], compileError: String((e as Error)?.message ?? e) } });
    }
  }
};

// Python execution for exercises: Pyodide (CPython compiled to WebAssembly) in a dedicated worker.
// The runtime ships with the app (public/pyodide) — no CDN, works offline. First load takes a few seconds.
import type { HarnessResult, HarnessTest } from './harness';
import type { SandboxRun } from './sandbox';

export const PY_TIMEOUT_MS = 5000;
const INIT_TIMEOUT_MS = 60000;

type Pending = { resolve: (r: HarnessResult) => void };
let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function indexURL() {
  return new URL('pyodide/', document.baseURI).href;
}

function reset() {
  worker?.terminate();
  worker = null;
  ready = null;
  for (const [, p] of pending) p.resolve({ results: [], logs: [], compileError: 'Python runtime restarted' });
  pending.clear();
}

export function warmPython(): Promise<void> {
  if (ready) return ready;
  worker = new Worker(new URL('./pyWorker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  ready = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => { reset(); reject(new Error('The Python runtime took too long to load.')); }, INIT_TIMEOUT_MS);
    w.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.kind === 'ready') { clearTimeout(t); resolve(); }
      else if (m.kind === 'init-error') { clearTimeout(t); reset(); reject(new Error(`Could not load the Python runtime: ${m.error}`)); }
      else if (m.kind === 'result') { pending.get(m.id)?.resolve(m.result); pending.delete(m.id); }
    };
    w.onerror = (e) => { clearTimeout(t); reset(); reject(new Error(e.message || 'Python worker failed')); };
  });
  w.postMessage({ kind: 'init', indexURL: indexURL() });
  return ready;
}

export async function runPython(source: string, tests: HarnessTest[], timeoutMs = PY_TIMEOUT_MS): Promise<SandboxRun> {
  const fail = (error: string, extra: Partial<SandboxRun> = {}): SandboxRun => ({ results: tests.map((t) => ({ name: t.name, passed: false, error })), logs: [], timedOut: false, durationMs: 0, passed: 0, total: tests.length, ...extra });
  try {
    await warmPython();
  } catch (e) {
    return fail('Python runtime unavailable', { compileError: String((e as Error).message) });
  }
  const id = nextId++;
  const started = performance.now();
  return new Promise<SandboxRun>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reset(); // the only way to stop a runaway Python loop is to kill the worker
      resolve(fail(`Timed out after ${timeoutMs / 1000}s (infinite loop?)`, { timedOut: true, durationMs: timeoutMs }));
    }, timeoutMs);
    pending.set(id, {
      resolve: (r) => {
        clearTimeout(timer);
        const passed = r.results.filter((x) => x.passed).length;
        resolve({ ...r, results: r.results.length ? r.results : tests.map((t) => ({ name: t.name, passed: false, error: r.compileError ?? 'No result' })), timedOut: false, durationMs: Math.round(performance.now() - started), passed, total: tests.length });
      },
    });
    worker!.postMessage({ kind: 'run', id, source, tests });
  });
}

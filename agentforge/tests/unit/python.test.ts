// Python exercises are checked with the same Pyodide build and harness the browser uses.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { ITEMS } from '@/content/items';
import { PY_HARNESS } from '@/core/runtime/pyHarness';
import type { CodeItem } from '@/core/types';

const require = createRequire(import.meta.url);
type Py = { runPythonAsync: (c: string) => Promise<unknown>; globals: { set: (k: string, v: unknown) => void } };
let py: Py;
const run = async (source: string, tests: { name: string; code: string }[]) => {
  py.globals.set('__af_source', source);
  py.globals.set('__af_tests', JSON.stringify(tests));
  return JSON.parse((await py.runPythonAsync(PY_HARNESS)) as string) as { results: { name: string; passed: boolean; error?: string }[]; logs: string[]; compileError?: string };
};

beforeAll(async () => {
  const { loadPyodide } = await import('pyodide');
  py = (await loadPyodide({ indexURL: dirname(require.resolve('pyodide/package.json')) + '/' })) as unknown as Py;
}, 60000);

const pyItems = ITEMS.filter((i): i is CodeItem => i.type === 'code' && i.language === 'python');

describe('Python exercises', () => {
  it('there are Python exercises', () => expect(pyItems.length).toBeGreaterThanOrEqual(6));
  for (const item of pyItems) {
    it(`${item.id}: reference solution passes`, async () => {
      const r = await run(item.solution, item.tests);
      expect(r.compileError).toBeUndefined();
      expect(r.results.filter((x) => !x.passed)).toEqual([]);
    });
    it(`${item.id}: starter does not pass`, async () => {
      const r = await run(item.starter, item.tests);
      expect(r.results.every((x) => x.passed)).toBe(false);
    });
  }
});

describe('Python harness honesty', () => {
  it('reports syntax errors and marks every test failed', async () => {
    const r = await run('def f(:\n  pass', [{ name: 't', code: 'f() == 1' }]);
    expect(r.compileError).toMatch(/SyntaxError/);
    expect(r.results[0].passed).toBe(false);
  });
  it('captures print output and requires exactly True', async () => {
    const r = await run('def f():\n    print("hi")\n    return 1', [{ name: 'a', code: 'f() == 1' }, { name: 'b', code: 'f()' }]);
    expect(r.results.map((x) => x.passed)).toEqual([true, false]);
    expect(r.logs).toContain('hi');
  });
  it('runtime errors in tests are reported, not thrown', async () => {
    const r = await run('def f():\n    return 1 / 0', [{ name: 'a', code: 'f() == 1' }]);
    expect(r.results[0].error).toMatch(/ZeroDivisionError/);
  });
  it('each run gets a fresh namespace', async () => {
    await run('x = 41', [{ name: 'a', code: 'x == 41' }]);
    const r = await run('', [{ name: 'b', code: "'x' not in globals()" }]);
    expect(r.results[0].passed).toBe(true);
  });
});

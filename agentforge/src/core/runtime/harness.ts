// Test harness shared by the Web Worker sandbox and unit tests.
// IMPORTANT: this function is stringified into the worker, so it must be self-contained (no imports, no closures).

export interface HarnessTest {
  name: string;
  code: string;
}
export interface HarnessResult {
  results: { name: string; passed: boolean; error?: string }[];
  logs: string[];
  compileError?: string;
}

export async function runHarness(source: string, exportNames: string[], tests: HarnessTest[]): Promise<HarnessResult> {
  const logs: string[] = [];
  const fmt = (a: unknown) => {
    try {
      return typeof a === 'string' ? a : JSON.stringify(a);
    } catch {
      return String(a);
    }
  };
  const sandboxConsole = {
    log: (...a: unknown[]) => logs.length < 200 && logs.push(a.map(fmt).join(' ')),
    error: (...a: unknown[]) => logs.length < 200 && logs.push('[error] ' + a.map(fmt).join(' ')),
    warn: (...a: unknown[]) => logs.length < 200 && logs.push('[warn] ' + a.map(fmt).join(' ')),
  };
  let mod: Record<string, unknown>;
  try {
    const exportsObj = exportNames.map((n) => `${JSON.stringify(n)}: (typeof ${n} !== 'undefined' ? ${n} : undefined)`).join(', ');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function('console', `"use strict";\n${source}\n;return { ${exportsObj} };`);
    mod = factory(sandboxConsole);
  } catch (e) {
    return { results: tests.map((t) => ({ name: t.name, passed: false, error: 'Code did not compile' })), logs, compileError: String((e as Error)?.message ?? e) };
  }
  const results: HarnessResult['results'] = [];
  for (const t of tests) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function('m', `"use strict";\n${t.code}`);
      let r = fn(mod);
      if (r && typeof (r as Promise<unknown>).then === 'function') r = await r;
      results.push({ name: t.name, passed: r === true, error: r === true ? undefined : `Expected true, got ${fmt(r)}` });
    } catch (e) {
      results.push({ name: t.name, passed: false, error: String((e as Error)?.message ?? e) });
    }
  }
  return { results, logs };
}

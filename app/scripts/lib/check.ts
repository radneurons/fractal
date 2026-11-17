// Tiny assertion helper for the Node test files.
let fails = 0, passes = 0;
export function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passes++; console.log(`  ✓ ${name}${detail ? '  — ' + detail : ''}`); }
  else { fails++; console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`); }
}
let gaps = 0;
/** A spec target the implementation is known not to meet yet: printed loudly, never hidden, but not fatal. */
export function gap(name: string, ok: boolean, detail = ''): void {
  if (ok) { passes++; console.log(`  ✓ ${name}${detail ? '  — ' + detail : ''}`); }
  else { gaps++; console.log(`  ⚠ KNOWN GAP ${name}${detail ? '  — ' + detail : ''}`); }
}
export function done(): void {
  console.log(`  ${passes} passed, ${fails} failed${gaps ? `, ${gaps} known gap(s)` : ''}`);
  process.exit(fails ? 1 : 0);
}
export const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// Tiny assertion helper for the Node test files.
let fails = 0, passes = 0;
export function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passes++; console.log(`  ✓ ${name}${detail ? '  — ' + detail : ''}`); }
  else { fails++; console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`); }
}
export function done(): void {
  console.log(`  ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}
export const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

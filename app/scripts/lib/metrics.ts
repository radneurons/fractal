// Evaluation helpers shared by the analysis tests.
export function matchEvents(found: number[], truth: number[], tol: number): { recall: number; precision: number; f: number; meanErr: number; maxErr: number; bias: number } {
  let hit = 0, sum = 0, mx = 0, bias = 0;
  const used = new Set<number>();
  for (const t of truth) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < found.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(found[i] - t);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0 && bd <= tol) { used.add(best); hit++; sum += bd; mx = Math.max(mx, bd); bias += found[best] - t; }
  }
  const recall = truth.length ? hit / truth.length : 1, precision = found.length ? hit / found.length : 1;
  return { recall, precision, f: recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0, meanErr: hit ? sum / hit : 0, maxErr: mx, bias: hit ? bias / hit : 0 };
}

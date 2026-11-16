/** Word-level diff with hunks the user can accept or reject individually. */
export interface Hunk { id: number; del: string; ins: string }
export type DiffPart = { kind: 'same'; text: string } | { kind: 'hunk'; hunk: Hunk };
const tok = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];
export function wordDiff(a: string, b: string): DiffPart[] {
  const A = tok(a), B = tok(b), n = A.length, m = B.length;
  if (n * m > 4_000_000) return a === b ? [{ kind: 'same', text: a }] : [{ kind: 'hunk', hunk: { id: 0, del: a, ins: b } }];
  const L = new Uint32Array((n + 1) * (m + 1)), W = m + 1;
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * W + j] = A[i] === B[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const raw: { k: 's' | 'd' | 'i'; t: string }[] = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { raw.push({ k: 's', t: A[i] }); i++; j++; } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) raw.push({ k: 'd', t: A[i++] }); else raw.push({ k: 'i', t: B[j++] }); }
  while (i < n) raw.push({ k: 'd', t: A[i++] }); while (j < m) raw.push({ k: 'i', t: B[j++] });
  // group changes; absorb whitespace-only "same" runs between changes so hunks read as phrases
  const parts: DiffPart[] = []; let id = 0, cur: Hunk | null = null;
  for (let k = 0; k < raw.length; k++) {
    const r = raw[k];
    if (r.k === 's') {
      const bridge = cur && /^\s+$/.test(r.t) && raw[k + 1] && raw[k + 1].k !== 's';
      if (bridge) { cur!.del += r.t; cur!.ins += r.t; continue; }
      cur = null; const last = parts[parts.length - 1]; if (last?.kind === 'same') last.text += r.t; else parts.push({ kind: 'same', text: r.t });
    } else { if (!cur) { cur = { id: id++, del: '', ins: '' }; parts.push({ kind: 'hunk', hunk: cur }); } if (r.k === 'd') cur.del += r.t; else cur.ins += r.t; }
  }
  return parts;
}
/** Rebuild text taking `ins` for accepted hunks and `del` for rejected ones. */
export function applyHunks(parts: DiffPart[], accepted: Set<number> | 'all'): string {
  return parts.map((p) => (p.kind === 'same' ? p.text : accepted === 'all' || accepted.has(p.hunk.id) ? p.hunk.ins : p.hunk.del)).join('');
}

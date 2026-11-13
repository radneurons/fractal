// DiagnosticEngine — an adaptive staircase over probe skills ordered by difficulty.
import type { Item, Profile } from '../types';

/** Probe skills, easiest → hardest, spanning the curriculum. */
export const PROBES = [
  'f-what-ai', 'f-tokens', 'p-clear', 'f-context', 'f-limits', 'p-format', 'ag-what', 'pg-json-http',
  't-function-calling', 'cc-review', 'api-resilience', 'r-retrieval', 'sec-injection', 'ag-stop', 'ev-metrics', 'ar-termination',
];

export const DIAGNOSTIC_LENGTH: Record<Profile['level'], number> = { zero: 6, 'uses-ai': 8, developer: 12 };
const START: Record<Profile['level'], number> = { zero: 0, 'uses-ai': 2, developer: 5 };

export interface DiagStep {
  probeIndex: number;
  skillId: string;
  itemId: string;
  correct: boolean | null; // null = "I don't know"
}

/** Pick a diagnostic-friendly item (prefer the last MCQ; lessons start from item 1). */
export function probeItem(skillId: string, items: Item[]): Item {
  const pool = items.filter((i) => i.skillId === skillId);
  const mcqs = pool.filter((i) => i.type === 'mcq');
  const quick = pool.filter((i) => i.type !== 'code' && i.type !== 'short');
  return mcqs[mcqs.length - 1] ?? quick[quick.length - 1] ?? pool[pool.length - 1];
}

/** Staircase: correct → jump 2 harder; wrong/unknown → step 1 easier (to an unasked probe). */
export function nextProbe(level: Profile['level'], history: DiagStep[]): number | null {
  const len = DIAGNOSTIC_LENGTH[level];
  if (history.length >= len) return null;
  const asked = new Set(history.map((h) => h.probeIndex));
  let target: number;
  if (!history.length) target = START[level];
  else {
    const last = history[history.length - 1];
    target = last.correct ? last.probeIndex + 2 : last.probeIndex - 1;
  }
  target = Math.max(0, Math.min(PROBES.length - 1, target));
  // Find nearest unasked probe, preferring the intended direction.
  for (let delta = 0; delta < PROBES.length; delta++) {
    for (const cand of [target + delta, target - delta]) {
      if (cand >= 0 && cand < PROBES.length && !asked.has(cand)) return cand;
    }
  }
  return null;
}

export function placementSummary(history: DiagStep[]) {
  const strong = history.filter((h) => h.correct).map((h) => PROBES[h.probeIndex]);
  const developing = history.filter((h) => !h.correct).map((h) => PROBES[h.probeIndex]);
  const highestCorrect = history.filter((h) => h.correct).reduce((m, h) => Math.max(m, h.probeIndex), -1);
  const band = highestCorrect < 3 ? 'Foundations' : highestCorrect < 8 ? 'Practitioner' : highestCorrect < 12 ? 'Builder' : 'Engineer';
  return { strong, developing, band, highestCorrect };
}

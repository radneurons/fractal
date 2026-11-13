// CompetencyEngine — transparent, evidence-weighted Beta model. See docs/MASTER_PROMPT.md §6.
import type { Evidence, EvidenceSource, ReviewState, SkillEstimate, SkillState } from '../types';
import { PASS } from './assessment';

export const DAY = 86_400_000;
export const PRIOR_A = 1;
export const PRIOR_B = 1;
export const HALF_LIFE_DAYS = 45;
export const MIN_SUFFICIENT_NEFF = 0.6;

export const SOURCE_WEIGHT: Record<EvidenceSource, number> = {
  diagnostic: 0.6,
  lesson: 0.8,
  practice: 1.0,
  review: 1.0,
  remediation: 1.0,
  game: 0.7,
  exercise: 1.2,
  interview: 1.2,
  project: 1.5,
  self: 0.2,
};

export function evidenceWeight(e: Evidence, now: number): number {
  if (e.solutionRevealed) return 0;
  const base = SOURCE_WEIGHT[e.source];
  const diff = 0.6 + 0.2 * e.difficulty;
  const hint = Math.max(0.25, 1 - 0.25 * e.hintsUsed);
  const ageDays = Math.max(0, (now - e.at) / DAY);
  const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  return base * diff * hint * recency;
}

export function confidenceLabel(c: number): SkillEstimate['confidenceLabel'] {
  if (c < 0.35) return 'insufficient';
  if (c < 0.5) return 'low';
  if (c < 0.65) return 'moderate';
  return 'high';
}

export interface EstimateContext {
  now: number;
  touched: boolean; // lesson opened / attempted
  prereqStates: SkillState[];
  review?: ReviewState;
}

export function estimate(skillId: string, evidence: Evidence[], ctx: EstimateContext): SkillEstimate {
  const ev = evidence.filter((e) => e.skillId === skillId);
  let sw = 0;
  let sws = 0;
  for (const e of ev) {
    const w = evidenceWeight(e, ctx.now);
    sw += w;
    sws += w * e.score;
  }
  const a = PRIOR_A + sws;
  const b = PRIOR_B + (sw - sws);
  const mastery = a / (a + b);
  const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
  const sd = Math.sqrt(variance);
  const ci: [number, number] = [Math.max(0, mastery - 1.645 * sd), Math.min(1, mastery + 1.645 * sd)];
  const confidence = 1 - 1 / Math.sqrt(1 + sw);

  const successes = ev.filter((e) => e.score >= PASS && !e.solutionRevealed);
  const passedItems = new Set(successes.map((e) => e.itemId ?? e.id)).size;
  const nonDiagnosticPass = successes.some((e) => e.source !== 'diagnostic');
  const lastSuccess = successes.length ? Math.max(...successes.map((e) => e.at)) : undefined;

  // Trend: mean score of the latest 3 vs the 3 before.
  const sorted = [...ev].sort((x, y) => x.at - y.at);
  const recent = sorted.slice(-3);
  const older = sorted.slice(-6, -3);
  const mean = (xs: Evidence[]) => (xs.length ? xs.reduce((s, e) => s + e.score, 0) / xs.length : 0);
  const trend = older.length ? mean(recent) - mean(older) : 0;

  const meetsMastery = mastery >= 0.8 && confidence >= 0.5 && passedItems >= 2 && nonDiagnosticPass;
  const reviewDue = !!ctx.review && ctx.review.due <= ctx.now && !!ctx.review.firstMasteredAt;

  let state: SkillState;
  if (sw >= 1.2 && mastery < 0.5) state = 'remediation';
  else if (meetsMastery && reviewDue) state = 'review-due';
  else if (meetsMastery) state = 'mastered';
  else if (successes.length > 0) state = 'practiced';
  else if (ctx.touched || ev.length > 0) state = 'in-progress';
  else if (ctx.prereqStates.every((s) => s === 'practiced' || s === 'mastered' || s === 'review-due')) state = 'ready';
  else state = 'locked-soft';

  return {
    skillId,
    mastery,
    nEff: sw,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    ci,
    attempts: ev.length,
    passedItems,
    lastSuccess,
    trend,
    state,
    nextReview: ctx.review?.due,
    sufficient: sw >= MIN_SUFFICIENT_NEFF,
  };
}

/** Estimate every skill in prerequisite order so prereq states are known first. */
export function estimateAll(
  skills: { id: string; prereqs: string[] }[],
  evidence: Evidence[],
  touched: Set<string>,
  reviews: Record<string, ReviewState>,
  now: number,
): Record<string, SkillEstimate> {
  const out: Record<string, SkillEstimate> = {};
  const byId = new Map(skills.map((s) => [s.id, s]));
  const visit = (id: string, stack: Set<string>) => {
    if (out[id]) return out[id];
    const s = byId.get(id);
    if (!s) throw new Error(`Unknown skill ${id}`);
    if (stack.has(id)) throw new Error(`Prerequisite cycle at ${id}`);
    stack.add(id);
    const prereqStates = s.prereqs.map((p) => visit(p, stack).state);
    stack.delete(id);
    out[id] = estimate(id, evidence, { now, touched: touched.has(id), prereqStates, review: reviews[id] });
    return out[id];
  };
  for (const s of skills) visit(s.id, new Set());
  return out;
}

export const STATE_LABEL: Record<SkillState, string> = {
  'locked-soft': 'Prerequisites first',
  ready: 'Ready to learn',
  'in-progress': 'In progress',
  practiced: 'Practiced',
  mastered: 'Demonstrated mastery',
  'review-due': 'Review due',
  remediation: 'Needs remediation',
};

export const STATE_ICON: Record<SkillState, string> = {
  'locked-soft': '○',
  ready: '◇',
  'in-progress': '◐',
  practiced: '◆',
  mastered: '★',
  'review-due': '↻',
  remediation: '!',
};

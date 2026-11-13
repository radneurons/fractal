// ReviewScheduler — Leitner-style ladder per skill. See MASTER_PROMPT §6.6.
import type { ReviewState } from '../types';
import { DAY } from './competency';

export const LADDER_DAYS = [1, 3, 7, 16, 35, 90];

export function scheduleAfter(prev: ReviewState | undefined, skillId: string, passed: boolean, mastered: boolean, now: number): ReviewState {
  const base: ReviewState = prev ?? { skillId, stage: 0, due: now + LADDER_DAYS[0] * DAY, history: [] };
  if (!prev && !passed) {
    // Never passed yet: no retention schedule, but come back tomorrow.
    return { ...base, stage: 0, due: now + DAY, history: [{ at: now, passed }] };
  }
  const stage = passed ? Math.min(LADDER_DAYS.length - 1, (prev ? base.stage + 1 : 0)) : Math.max(0, base.stage - 2);
  return {
    skillId,
    stage,
    due: now + LADDER_DAYS[stage] * DAY,
    history: [...base.history, { at: now, passed }].slice(-30),
    firstMasteredAt: base.firstMasteredAt ?? (mastered ? now : undefined),
  };
}

export function dueSkills(reviews: Record<string, ReviewState>, now: number): ReviewState[] {
  return Object.values(reviews)
    .filter((r) => r.due <= now && r.history.some((h) => h.passed))
    .sort((a, b) => a.due - b.due);
}

/** "Retained" = mastered once and passed at least one review 7+ days after first mastery. */
export function isRetained(r: ReviewState | undefined): boolean {
  if (!r?.firstMasteredAt) return false;
  return r.history.some((h) => h.passed && h.at - r.firstMasteredAt! >= 7 * DAY);
}

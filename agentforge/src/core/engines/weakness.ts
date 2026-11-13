// WeaknessFinder — weak skills, prerequisite hypotheses, recurring error patterns and recovery sequences. MASTER_PROMPT §6.5.
import type { ErrorTag, Evidence, Item, Skill, SkillEstimate } from '../types';
import { ERROR_TAG_LABEL } from '../types';
import { DAY } from './competency';

export interface Weakness {
  skillId: string;
  severity: number; // 0..1
  reasons: string[];
  hypotheses: { text: string; evidence: string }[];
  topErrors: { tag: ErrorTag; count: number }[];
}

export function errorCounts(evidence: Evidence[], skillId?: string, sinceMs?: number) {
  const counts = new Map<ErrorTag, number>();
  for (const e of evidence) {
    if (skillId && e.skillId !== skillId) continue;
    if (sinceMs && e.at < sinceMs) continue;
    for (const t of e.errorTags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

export function findWeaknesses(skills: Skill[], est: Record<string, SkillEstimate>, evidence: Evidence[], now: number): Weakness[] {
  const out: Weakness[] = [];
  const since = now - 14 * DAY;
  for (const s of skills) {
    const e = est[s.id];
    if (!e || e.attempts === 0) continue;
    const errs = errorCounts(evidence, s.id, since);
    const recurring = errs.find((x) => x.count >= 3);
    const weak = e.state === 'remediation';
    const failedRecently = evidence.some((x) => x.skillId === s.id && x.score < 0.7 && x.at >= since) && e.mastery < 0.6;
    if (!weak && !recurring && !failedRecently) continue;

    const reasons: string[] = [];
    if (weak) reasons.push(`Estimated mastery ${(e.mastery * 100).toFixed(0)}% with ${e.confidenceLabel} confidence across ${e.attempts} attempts.`);
    if (recurring) reasons.push(`Recurring error: ${ERROR_TAG_LABEL[recurring.tag]} (${recurring.count}× in 14 days).`);
    if (!weak && failedRecently) reasons.push('Recent unsuccessful attempt — not enough evidence yet to call it a weakness.');

    const hypotheses: Weakness['hypotheses'] = [];
    for (const p of s.prereqs) {
      const pe = est[p];
      const pSkill = skills.find((x) => x.id === p)!;
      if (!pe || pe.attempts === 0) hypotheses.push({ text: `Possible missing prerequisite: “${pSkill.title}” has not been assessed yet.`, evidence: 'No graded evidence on the prerequisite.' });
      else if (pe.mastery < 0.6) hypotheses.push({ text: `Possible missing prerequisite: “${pSkill.title}” is also below 60%.`, evidence: `Prerequisite estimate ${(pe.mastery * 100).toFixed(0)}% over ${pe.attempts} attempts.` });
    }
    if (errs[0]) {
      const tag = errs[0].tag;
      const map: Partial<Record<ErrorTag, string>> = {
        'concept-confusion': 'You may be mixing up related concepts — compare them side by side.',
        'wrong-tool': 'Tool/approach selection seems to be the sticking point rather than the concept itself.',
        'poor-verification': 'Answers suggest trusting outputs without checking evidence.',
        'unsafe-action': 'Choices lean toward actions with too much risk or privilege.',
        'context-omission': 'Missing context or specifics is the most common issue.',
        'bad-assumption': 'Several answers rested on an unsupported assumption.',
        'state-mgmt': 'Errors cluster around tracking state between steps.',
      };
      if (map[tag]) hypotheses.push({ text: map[tag]!, evidence: `${errs[0].count}× “${ERROR_TAG_LABEL[tag]}” on this skill.` });
    }
    const severity = Math.min(1, (weak ? 0.6 : 0.25) + (recurring ? 0.25 : 0) + (1 - e.mastery) * 0.3);
    out.push({ skillId: s.id, severity, reasons, hypotheses, topErrors: errs.slice(0, 3) });
  }
  return out.sort((a, b) => b.severity - a.severity);
}

export interface RecoveryStep {
  kind: 'explain' | 'prereq-check' | 'example' | 'targeted' | 'transfer' | 'schedule';
  title: string;
  itemId?: string;
  skillId?: string;
}

/** Recovery sequence: explain → (prereq check) → worked example → targeted item → transfer item → schedule review. */
export function recoveryPlan(skill: Skill, items: Item[], evidence: Evidence[], est: Record<string, SkillEstimate>): RecoveryStep[] {
  const pool = items.filter((i) => i.skillId === skill.id);
  const attempted = new Map<string, number>();
  for (const e of evidence) if (e.itemId) attempted.set(e.itemId, Math.max(attempted.get(e.itemId) ?? 0, e.score));
  const unseen = pool.filter((i) => !attempted.has(i.id));
  const failed = pool.filter((i) => (attempted.get(i.id) ?? 1) < 0.7);
  const easiest = [...(unseen.length ? unseen : failed.length ? failed : pool)].sort((a, b) => a.difficulty - b.difficulty);
  const targeted = easiest[0];
  const transferPool = pool.filter((i) => i.id !== targeted?.id).sort((a, b) => b.difficulty - a.difficulty);
  const transfer = transferPool.find((i) => !attempted.has(i.id)) ?? transferPool[0];

  const steps: RecoveryStep[] = [{ kind: 'explain', title: `Corrective note: ${skill.title}` }];
  const weakPrereq = skill.prereqs.find((p) => !est[p] || est[p].attempts === 0 || est[p].mastery < 0.6);
  if (weakPrereq) {
    const pItem = items.find((i) => i.skillId === weakPrereq && !attempted.has(i.id)) ?? items.find((i) => i.skillId === weakPrereq);
    if (pItem) steps.push({ kind: 'prereq-check', title: 'Quick prerequisite check', itemId: pItem.id, skillId: weakPrereq });
  }
  steps.push({ kind: 'example', title: 'A simpler worked example' });
  if (targeted) steps.push({ kind: 'targeted', title: 'Targeted exercise', itemId: targeted.id, skillId: skill.id });
  if (transfer && transfer.id !== targeted?.id) steps.push({ kind: 'transfer', title: 'Transfer check: a different problem', itemId: transfer.id, skillId: skill.id });
  steps.push({ kind: 'schedule', title: 'Spaced review scheduled' });
  return steps;
}

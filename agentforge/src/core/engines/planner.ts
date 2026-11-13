// AdaptivePlanner — next-best-activity and a 7-day plan fitted to the learner's time budget. See MASTER_PROMPT §7.
import type { GoalPath, Lesson, PlanBlock, PlanDay, Profile, SkillEstimate, Skill } from '../types';
import { DAY } from './competency';

export const PATHS: Record<GoalPath, { title: string; letter: string; blurb: string; schools: string[]; extra: string[] }> = {
  'power-user': { letter: 'A', title: 'AI Power User', blurb: 'Use AI tools for productivity, research, writing and analysis — with verification habits.', schools: ['s1', 's2', 's3'], extra: ['sec-secrets', 'sec-injection', 'pr-ux'] },
  'claude-code': { letter: 'B', title: 'Claude Code Specialist', blurb: 'Agentic coding with Claude Code, from first session to automation.', schools: ['s1', 's4'], extra: ['p-clear', 'p-context', 'c-capabilities', 'c-long-docs', 'pg-cli', 'pg-git-testing', 't-mcp', 'sec-least-priv', 'sec-secrets', 'sec-sandbox'] },
  codex: { letter: 'C', title: 'Codex Specialist', blurb: 'Professional Codex workflows, AGENTS.md, sandboxing and automation.', schools: ['s1', 's5'], extra: ['p-clear', 'p-context', 'pg-cli', 'pg-git-testing', 'cc-review', 'sec-least-priv', 'sec-sandbox', 'sec-secrets'] },
  'app-dev': { letter: 'D', title: 'AI Application Developer', blurb: 'Build complete AI-enabled software products with APIs and structured outputs.', schools: ['s1', 's2', 's6', 's7', 's9', 's14'], extra: ['r-chunking', 'r-retrieval', 'r-grounding', 'ev-why', 'sec-injection', 'sec-secrets'] },
  'agent-engineer': { letter: 'E', title: 'AI Agent Engineer', blurb: 'Design, implement, debug and evaluate agent systems.', schools: ['s1', 's8', 's9', 's10', 's11', 's12'], extra: ['p-format', 'api-basics', 'api-structured', 'api-resilience', 'sec-injection', 'sec-least-priv', 'sec-confirm'] },
  architect: { letter: 'F', title: 'AI Systems Architect', blurb: 'Orchestration, reliability, evaluation, security and production operations.', schools: ['s8', 's10', 's11', 's12', 's13', 's14', 's15', 's16'], extra: ['api-cost', 'api-resilience', 't-mcp', 't-untrusted'] },
};

/** All skills on a path, prerequisites included, in topological (learnable) order. */
export function pathSkills(path: GoalPath, skills: Skill[]): string[] {
  const p = PATHS[path];
  const byId = new Map(skills.map((s) => [s.id, s]));
  const wanted = new Set<string>(skills.filter((s) => p.schools.includes(s.schoolId)).map((s) => s.id));
  p.extra.forEach((e) => wanted.add(e));
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const pr of byId.get(id)?.prereqs ?? []) visit(pr);
    out.push(id);
  };
  // Visit in curriculum order for stable output.
  for (const s of skills) if (wanted.has(s.id)) visit(s.id);
  return out;
}

export interface PlanInput {
  profile: Profile;
  skills: Skill[];
  lessons: Lesson[];
  estimates: Record<string, SkillEstimate>;
  dueReviewSkills: string[];
  pinned: string[]; // skill ids the learner wants first
  skipped: string[]; // skill ids the learner chose to skip for now
  now: number;
}

export interface Candidate {
  skillId: string;
  priority: number;
  reason: string;
}

export function rankCandidates(inp: PlanInput): Candidate[] {
  const order = pathSkills(inp.profile.path, inp.skills);
  const due = new Set(inp.dueReviewSkills);
  const out: Candidate[] = [];
  order.forEach((id, idx) => {
    if (inp.skipped.includes(id)) return;
    const e = inp.estimates[id];
    if (!e) return;
    let p = 0;
    let reason = '';
    if (due.has(id) || e.state === 'review-due') {
      p += 3;
      reason = 'Review due — keep it retained';
    }
    if (e.state === 'remediation') {
      p += 2.5;
      reason = 'Evidence shows this needs work';
    }
    if (e.state === 'ready') {
      p += 2;
      reason ||= 'Prerequisites met — ready to learn';
    }
    if (e.state === 'in-progress') {
      p += 1;
      reason ||= 'Started — keep going';
    }
    if (e.state === 'practiced') {
      p += 0.6;
      reason ||= 'Practiced once — one more success to confirm mastery';
    }
    if (e.state === 'mastered') p -= 1;
    if (e.state === 'locked-soft') {
      p += 0.2;
      reason ||= 'Upcoming on your path';
    }
    if (inp.pinned.includes(id)) {
      p += 4;
      reason = 'You pinned this';
    }
    p -= idx * 0.01; // earlier on the path wins ties
    out.push({ skillId: id, priority: p, reason });
  });
  return out.sort((a, b) => b.priority - a.priority);
}

function blockFor(c: Candidate, inp: PlanInput): PlanBlock {
  const e = inp.estimates[c.skillId];
  const skill = inp.skills.find((s) => s.id === c.skillId)!;
  const lesson = inp.lessons.find((l) => l.skillIds[0] === c.skillId && l.status === 'current');
  if (e.state === 'review-due' || inp.dueReviewSkills.includes(c.skillId))
    return { kind: 'review', title: `Review: ${skill.title}`, skillId: c.skillId, route: `/review/${c.skillId}`, minutes: 5, reason: c.reason };
  if (e.state === 'remediation')
    return { kind: 'remediation', title: `Fix: ${skill.title}`, skillId: c.skillId, route: `/recover/${c.skillId}`, minutes: 10, reason: c.reason };
  if (lesson && e.state !== 'practiced')
    return { kind: 'lesson', title: lesson.title, skillId: c.skillId, lessonId: lesson.id, route: `/lesson/${lesson.id}`, minutes: lesson.minutes, reason: c.reason };
  return { kind: 'practice', title: `Practice: ${skill.title}`, skillId: c.skillId, route: `/practice/${c.skillId}`, minutes: 6, reason: c.reason };
}

export function recommendNext(inp: PlanInput): PlanBlock[] {
  return rankCandidates(inp).slice(0, 4).map((c) => blockFor(c, inp));
}

/** Build `days` sessions. Each session: ≤1 review block, ≤1 remediation block, then new learning, then practice if time remains. */
export function buildPlan(inp: PlanInput, days = 7): PlanDay[] {
  const budget = inp.profile.minutesPerSession;
  const perWeek = Math.max(1, Math.min(7, inp.profile.sessionsPerWeek));
  const ranked = rankCandidates(inp);
  const used = new Set<string>();
  const plan: PlanDay[] = [];
  const studyDays = new Set(Array.from({ length: perWeek }, (_, i) => Math.round((i * days) / perWeek)));

  for (let d = 0; d < days; d++) {
    const date = new Date(inp.now + d * DAY).toISOString().slice(0, 10);
    if (!studyDays.has(d)) {
      plan.push({ date, blocks: [], minutes: 0 });
      continue;
    }
    const blocks: PlanBlock[] = [];
    let minutes = 0;
    const take = (pred: (b: PlanBlock) => boolean, max: number) => {
      let n = 0;
      for (const c of ranked) {
        if (n >= max) break;
        if (used.has(c.skillId)) continue;
        const b = blockFor(c, inp);
        if (!pred(b)) continue;
        if (minutes + b.minutes > budget) continue;
        blocks.push(b);
        used.add(c.skillId);
        minutes += b.minutes;
        n++;
      }
    };
    take((b) => b.kind === 'review', d === 0 ? 2 : 1);
    take((b) => b.kind === 'remediation', 1);
    take((b) => b.kind === 'lesson', 3);
    take((b) => b.kind === 'practice', 2);
    if (minutes + 8 <= budget && blocks.length) {
      blocks.push({ kind: 'practice', title: 'Challenge Arena round', route: '/arena', minutes: 8, reason: 'Apply what you learned in a game' });
      minutes += 8;
    }
    if (budget >= 60 && minutes + 15 <= budget) {
      blocks.push({ kind: 'project', title: 'Project milestone', route: '/projects', minutes: 15, reason: 'Build portfolio evidence' });
      minutes += 15;
    }
    plan.push({ date, blocks, minutes });
  }
  return plan;
}

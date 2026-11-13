import { describe, expect, it } from 'vitest';
import { estimate, estimateAll, evidenceWeight, DAY } from '@/core/engines/competency';
import { grade } from '@/core/engines/assessment';
import { scheduleAfter, dueSkills, isRetained, LADDER_DAYS } from '@/core/engines/review';
import { buildPlan, pathSkills, recommendNext, PATHS } from '@/core/engines/planner';
import { nextProbe, PROBES, DIAGNOSTIC_LENGTH, placementSummary } from '@/core/engines/diagnostic';
import { findWeaknesses, recoveryPlan } from '@/core/engines/weakness';
import { rankFor, xpFor } from '@/core/engines/progression';
import { SKILLS, getSkill } from '@/content/skills';
import { LESSONS } from '@/content/lessons';
import { ITEMS, getItem } from '@/content/items';
import type { Evidence, Profile } from '@/core/types';

const NOW = Date.UTC(2026, 10, 13);
let n = 0;
const ev = (skillId: string, score: number, extra: Partial<Evidence> = {}): Evidence => ({
  id: `e${n++}`, skillId, itemId: `${skillId}-x${n}`, source: 'practice', score, difficulty: 2, hintsUsed: 0, solutionRevealed: false, errorTags: score < 0.7 ? ['conceptual'] : [], gradedBy: 'deterministic', at: NOW - 1000, ...extra,
});
const ctx = { now: NOW, touched: false, prereqStates: [] as any[] };

describe('CompetencyEngine', () => {
  it('reports insufficient evidence with no data', () => {
    const e = estimate('f-tokens', [], ctx);
    expect(e.sufficient).toBe(false);
    expect(e.confidenceLabel).toBe('insufficient');
    expect(e.mastery).toBeCloseTo(0.5);
    expect(e.state).toBe('ready');
  });
  it('revealed solutions carry zero weight', () => {
    expect(evidenceWeight(ev('f-tokens', 1, { solutionRevealed: true }), NOW)).toBe(0);
    const e = estimate('f-tokens', [ev('f-tokens', 1, { solutionRevealed: true })], ctx);
    expect(e.nEff).toBe(0);
    expect(e.state).toBe('in-progress');
  });
  it('hints reduce weight; recency decays with a 45-day half-life', () => {
    const base = evidenceWeight(ev('a', 1), NOW);
    expect(evidenceWeight(ev('a', 1, { hintsUsed: 2 }), NOW)).toBeCloseTo(base * 0.5, 5);
    expect(evidenceWeight(ev('a', 1, { at: NOW - 45 * DAY }), NOW)).toBeCloseTo(base / 2, 2);
  });
  it('mastery requires multiple distinct non-diagnostic successes', () => {
    const one = estimate('f-tokens', [ev('f-tokens', 1)], ctx);
    expect(one.state).toBe('practiced');
    const many = estimate('f-tokens', [ev('f-tokens', 1), ev('f-tokens', 1), ev('f-tokens', 1, { source: 'exercise' })], ctx);
    expect(many.mastery).toBeGreaterThan(0.8);
    expect(many.state).toBe('mastered');
    const diagOnly = estimate('f-tokens', [1, 2, 3, 4].map(() => ev('f-tokens', 1, { source: 'diagnostic' })), ctx);
    expect(diagOnly.state).not.toBe('mastered');
  });
  it('repeated failure triggers remediation, and later success recovers', () => {
    const fails = [ev('t-mcp', 0), ev('t-mcp', 0)];
    expect(estimate('t-mcp', fails, ctx).state).toBe('remediation');
    const recovered = estimate('t-mcp', [...fails, ev('t-mcp', 1, { source: 'remediation' }), ev('t-mcp', 1), ev('t-mcp', 1, { source: 'exercise' }), ev('t-mcp', 1)], ctx);
    expect(recovered.state).not.toBe('remediation');
    expect(recovered.mastery).toBeGreaterThan(0.6);
  });
  it('estimateAll resolves prerequisite states over the whole graph', () => {
    const all = estimateAll(SKILLS, [], new Set(), {}, NOW);
    expect(Object.keys(all)).toHaveLength(SKILLS.length);
    expect(all['f-what-ai'].state).toBe('ready');
    expect(all['f-ai-vs-code'].state).toBe('locked-soft');
  });
});

describe('AssessmentEngine partial credit', () => {
  it('multi-select subtracts false positives', () => {
    const it = getItem('f-tokens-3');
    if (it.type !== 'multi') throw new Error();
    const correct = it.options.filter((o) => o.correct).map((o) => o.id);
    const wrong = it.options.find((o) => !o.correct)!.id;
    expect(grade(it, { type: 'multi', optionIds: correct }).score).toBe(1);
    const r = grade(it, { type: 'multi', optionIds: [...correct, wrong] });
    expect(r.score).toBeCloseTo(2 / 3);
    expect(r.errorTags).toContain('concept-confusion');
  });
  it('order gives partial credit for one swap but not full', () => {
    const it = getItem('f-ml-nn-1');
    if (it.type !== 'order') throw new Error();
    const swapped = [it.steps[1], it.steps[0], ...it.steps.slice(2)];
    const r = grade(it, { type: 'order', order: swapped });
    expect(r.score).toBeGreaterThan(0.5);
    expect(r.correct).toBe(false);
  });
  it('mcq distractor yields its error tag; "I don\'t know" is incomplete', () => {
    const it = getItem('ag-what-2');
    if (it.type !== 'mcq') throw new Error();
    const d = it.options.find((o) => o.errorTag === 'wrong-tool')!;
    expect(grade(it, { type: 'mcq', optionId: d.id }).errorTags).toEqual(['wrong-tool']);
    expect(grade(it, { type: 'mcq', optionId: null }).errorTags).toEqual(['incomplete']);
  });
  it('short answers are heuristic and reject one-word replies', () => {
    const it = getItem('f-what-ai-4');
    const r = grade(it, { type: 'short', text: 'patterns' });
    expect(r.gradedBy).toBe('heuristic');
    expect(r.correct).toBe(false);
  });
});

describe('ReviewScheduler', () => {
  it('climbs the ladder on success and drops two on failure', () => {
    let r = scheduleAfter(undefined, 's', true, true, NOW);
    expect(r.stage).toBe(0);
    r = scheduleAfter(r, 's', true, true, NOW);
    r = scheduleAfter(r, 's', true, true, NOW);
    expect(r.stage).toBe(2);
    expect(r.due).toBe(NOW + LADDER_DAYS[2] * DAY);
    r = scheduleAfter(r, 's', false, true, NOW);
    expect(r.stage).toBe(0);
  });
  it('due skills and retention', () => {
    const r = scheduleAfter(undefined, 's', true, true, NOW - 10 * DAY);
    expect(dueSkills({ s: r }, NOW)).toHaveLength(1);
    expect(isRetained(r)).toBe(false);
    const r2 = scheduleAfter(r, 's', true, true, NOW);
    expect(isRetained(r2)).toBe(true);
  });
});

const profile = (p: Partial<Profile> = {}): Profile => ({ createdAt: NOW, level: 'zero', path: 'power-user', minutesPerSession: 20, sessionsPerWeek: 5, language: 'javascript', onboarded: true, diagnosticDone: true, ...p });

describe('AdaptivePlanner', () => {
  const est = estimateAll(SKILLS, [], new Set(), {}, NOW);
  it('path skills include prerequisites in topological order', () => {
    for (const path of Object.keys(PATHS) as (keyof typeof PATHS)[]) {
      const order = pathSkills(path, SKILLS);
      const pos = new Map(order.map((s, i) => [s, i]));
      for (const s of order) for (const p of getSkill(s).prereqs) expect(pos.get(p)!).toBeLessThan(pos.get(s)!);
    }
  });
  it('fits every session into the time budget', () => {
    for (const minutes of [20, 40, 60] as const) {
      const plan = buildPlan({ profile: profile({ minutesPerSession: minutes }), skills: SKILLS, lessons: LESSONS, estimates: est, dueReviewSkills: [], pinned: [], skipped: [], now: NOW });
      expect(plan).toHaveLength(7);
      for (const d of plan) expect(d.minutes).toBeLessThanOrEqual(minutes);
      expect(plan.filter((d) => d.blocks.length).length).toBe(5);
    }
  });
  it('prioritises remediation and respects pins and skips', () => {
    const evid = [ev('p-clear', 0), ev('p-clear', 0)];
    const est2 = estimateAll(SKILLS, evid, new Set(), {}, NOW);
    const next = recommendNext({ profile: profile(), skills: SKILLS, lessons: LESSONS, estimates: est2, dueReviewSkills: [], pinned: ['f-tokens'], skipped: ['f-what-ai'], now: NOW });
    expect(next[0].skillId).toBe('f-tokens');
    expect(next.some((b) => b.kind === 'remediation' && b.skillId === 'p-clear')).toBe(true);
    expect(next.some((b) => b.skillId === 'f-what-ai')).toBe(false);
  });
});

describe('DiagnosticEngine', () => {
  it('staircases up on success and down on failure, without repeats', () => {
    const first = nextProbe('uses-ai', [])!;
    expect(first).toBe(2);
    const up = nextProbe('uses-ai', [{ probeIndex: 2, skillId: PROBES[2], itemId: 'x', correct: true }]);
    expect(up).toBe(4);
    const down = nextProbe('uses-ai', [{ probeIndex: 2, skillId: PROBES[2], itemId: 'x', correct: false }]);
    expect(down).toBe(1);
  });
  it('stops at the configured length and summarises', () => {
    const h = Array.from({ length: DIAGNOSTIC_LENGTH.zero }, (_, i) => ({ probeIndex: i, skillId: PROBES[i], itemId: 'x', correct: i % 2 === 0 }));
    expect(nextProbe('zero', h)).toBeNull();
    expect(placementSummary(h).strong.length).toBe(3);
  });
});

describe('WeaknessFinder', () => {
  it('flags weak skills with prerequisite hypotheses', () => {
    const evid = [ev('t-mcp', 0, { errorTags: ['concept-confusion'] }), ev('t-mcp', 0, { errorTags: ['concept-confusion'] })];
    const est = estimateAll(SKILLS, evid, new Set(), {}, NOW);
    const w = findWeaknesses(SKILLS, est, evid, NOW);
    expect(w[0].skillId).toBe('t-mcp');
    expect(w[0].hypotheses.some((h) => h.text.includes('prerequisite'))).toBe(true);
  });
  it('recovery plan uses targeted and different transfer items', () => {
    const est = estimateAll(SKILLS, [], new Set(), {}, NOW);
    const steps = recoveryPlan(getSkill('t-mcp'), ITEMS, [], est);
    const t = steps.find((s) => s.kind === 'targeted')!;
    const tr = steps.find((s) => s.kind === 'transfer')!;
    expect(t.itemId).toBeTruthy();
    expect(tr.itemId).not.toBe(t.itemId);
    expect(steps[steps.length - 1].kind).toBe('schedule');
  });
});

describe('Progression', () => {
  it('rank depends on mastery and projects, not XP', () => {
    expect(rankFor(0, 0).rank.name).toBe('Explorer');
    expect(rankFor(14, 0).rank.name).toBe('Practitioner');
    expect(rankFor(14, 1).rank.name).toBe('Builder');
  });
  it('XP is zero for revealed solutions and halved with hints', () => {
    expect(xpFor({ score: 1, difficulty: 3, hintsUsed: 0, solutionRevealed: true }, false)).toBe(0);
    expect(xpFor({ score: 1, difficulty: 2, hintsUsed: 1, solutionRevealed: false }, false)).toBe(10);
    expect(xpFor({ score: 1, difficulty: 2, hintsUsed: 0, solutionRevealed: false }, true)).toBe(30);
  });
});

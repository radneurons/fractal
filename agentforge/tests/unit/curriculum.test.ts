import { describe, expect, it } from 'vitest';
import { validateCurriculum, Registry } from '@/core/registry';
import { ITEMS, itemsForSkill } from '@/content/items';
import { LESSONS } from '@/content/lessons';
import { SKILLS } from '@/content/skills';
import { SCHOOLS } from '@/content/schools';
import { grade } from '@/core/engines/assessment';
import { runHarness } from '@/core/runtime/harness';
import type { Item, Response } from '@/core/types';

describe('curriculum integrity', () => {
  const report = validateCurriculum();
  it('has no structural errors', () => {
    expect(report.errors).toEqual([]);
  });
  it('meets the v1 content budget', () => {
    expect(SCHOOLS).toHaveLength(16);
    expect(SKILLS.length).toBeGreaterThanOrEqual(90);
    expect(LESSONS.filter((l) => l.status === 'current').length).toBeGreaterThanOrEqual(30);
    expect(ITEMS.length).toBeGreaterThanOrEqual(200);
    expect(Object.keys(report.counts.itemTypes).sort()).toEqual(['classify', 'code', 'fill', 'match', 'mcq', 'multi', 'order', 'short']);
  });
  it('every school has skills and every skill has ≥2 items', () => {
    for (const s of SCHOOLS) expect(SKILLS.some((k) => k.schoolId === s.id)).toBe(true);
    for (const k of SKILLS) expect(itemsForSkill(k.id).length).toBeGreaterThanOrEqual(2);
  });
  it('lesson skills have ≥4 items so remediation can use an unseen item', () => {
    for (const l of LESSONS) expect(itemsForSkill(l.skillIds[0]).length).toBeGreaterThanOrEqual(4);
  });
  it('correct MCQ answer is not systematically the longest option', () => {
    const mcqs = ITEMS.filter((i): i is Extract<Item, { type: 'mcq' }> => i.type === 'mcq');
    const longestCorrect = mcqs.filter((m) => {
      const max = Math.max(...m.options.map((o) => o.text.length));
      return m.options.find((o) => o.correct)!.text.length === max;
    }).length;
    // Spec §5.4: keep below 40%. Remaining cases are mostly "pick the best prompt" items where the good prompt is naturally longer.
    expect(longestCorrect / mcqs.length).toBeLessThan(0.4);
  });
  it('registry exposes all collections', () => {
    expect(Registry.items.length).toBe(ITEMS.length);
  });
});

describe('authored answer keys grade as correct', () => {
  const correctResponse = (item: Item): Response | null => {
    switch (item.type) {
      case 'mcq': return { type: 'mcq', optionId: item.options.find((o) => o.correct)!.id };
      case 'multi': return { type: 'multi', optionIds: item.options.filter((o) => o.correct).map((o) => o.id) };
      case 'order': return { type: 'order', order: [...item.steps] };
      case 'match': return { type: 'match', mapping: Object.fromEntries(item.pairs.map((p) => [p.left, p.right])) };
      case 'fill': return { type: 'fill', values: item.blanks.map((b) => b.accept[0]) };
      case 'short': return { type: 'short', text: item.modelAnswer };
      case 'classify': return { type: 'classify', mapping: Object.fromEntries(item.cards.map((c) => [c.text, c.bucket])) };
      case 'code': return null;
    }
  };
  for (const item of ITEMS) {
    if (item.type === 'code') continue;
    it(`${item.id} model answer passes`, () => {
      const r = grade(item, correctResponse(item)!);
      expect(r.correct).toBe(true);
    });
  }
});

describe('code items: reference solutions pass and starters fail', () => {
  for (const item of ITEMS) {
    if (item.type !== 'code') continue;
    it(`${item.id} solution passes all tests`, async () => {
      const r = await runHarness(item.solution, item.exports, item.tests);
      expect(r.compileError).toBeUndefined();
      expect(r.results.filter((x) => !x.passed)).toEqual([]);
    });
    it(`${item.id} starter does not pass all tests`, async () => {
      const r = await runHarness(item.starter, item.exports, item.tests);
      expect(r.results.every((x) => x.passed)).toBe(false);
    });
  }
});

// CurriculumRegistry — single entry point for curriculum data, with structural validation.
import { z } from 'zod';
import { SCHOOLS } from '@/content/schools';
import { SKILLS } from '@/content/skills';
import { ITEMS } from '@/content/items';
import { LESSONS } from '@/content/lessons';
import type { Item, Lesson, Skill } from './types';

export const CURRICULUM_VERSION = '2026.11.1';

const skillSchema = z.object({
  id: z.string().min(2),
  schoolId: z.string(),
  title: z.string().min(3),
  summary: z.string().min(20),
  prereqs: z.array(z.string()),
  difficulty: z.number().int().min(1).max(5),
  remediation: z.string().min(80),
  workedExample: z.string().min(30),
});

const itemBase = {
  id: z.string(),
  skillId: z.string(),
  difficulty: z.number().int().min(1).max(5),
  prompt: z.string().min(8),
  explanation: z.string().min(8),
  hints: z.array(z.string()),
};
const option = z.object({ id: z.string(), text: z.string().min(1), correct: z.boolean(), errorTag: z.string().optional(), feedback: z.string().optional() });

export const itemSchema = z.discriminatedUnion('type', [
  z.object({ ...itemBase, type: z.literal('mcq'), options: z.array(option).min(3) }),
  z.object({ ...itemBase, type: z.literal('multi'), options: z.array(option).min(3) }),
  z.object({ ...itemBase, type: z.literal('order'), steps: z.array(z.string()).min(3), errorTag: z.string().optional() }),
  z.object({ ...itemBase, type: z.literal('match'), pairs: z.array(z.object({ left: z.string(), right: z.string() })).min(3), errorTag: z.string().optional() }),
  z.object({ ...itemBase, type: z.literal('fill'), template: z.string(), blanks: z.array(z.object({ accept: z.array(z.string()).min(1) })).min(1), errorTag: z.string().optional() }),
  z.object({ ...itemBase, type: z.literal('short'), rubric: z.array(z.object({ concept: z.string(), any: z.array(z.string()).min(1) })).min(2), minConcepts: z.number().min(1), modelAnswer: z.string().min(30) }),
  z.object({ ...itemBase, type: z.literal('code'), language: z.enum(['javascript', 'python']).optional(), exports: z.array(z.string()).min(1), starter: z.string(), solution: z.string(), tests: z.array(z.object({ name: z.string(), code: z.string() })).min(2), errorTag: z.string().optional() }),
  z.object({ ...itemBase, type: z.literal('classify'), buckets: z.array(z.string()).min(2), cards: z.array(z.object({ text: z.string(), bucket: z.string(), errorTag: z.string().optional() })).min(3) }),
]);

export interface ValidationReport {
  errors: string[];
  counts: { schools: number; skills: number; items: number; lessons: number; itemTypes: Record<string, number> };
}

export function validateCurriculum(): ValidationReport {
  const errors: string[] = [];
  const skillIds = new Set<string>();
  const schoolIds = new Set(SCHOOLS.map((s) => s.id));

  for (const s of SKILLS) {
    const r = skillSchema.safeParse(s);
    if (!r.success) errors.push(`skill ${s.id}: ${r.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
    if (skillIds.has(s.id)) errors.push(`duplicate skill ${s.id}`);
    skillIds.add(s.id);
    if (!schoolIds.has(s.schoolId)) errors.push(`skill ${s.id}: unknown school ${s.schoolId}`);
  }
  for (const s of SKILLS) for (const p of s.prereqs) if (!skillIds.has(p)) errors.push(`skill ${s.id}: unknown prereq ${p}`);

  // Cycle detection (DFS).
  const state = new Map<string, 0 | 1 | 2>();
  const byId = new Map(SKILLS.map((s) => [s.id, s]));
  const dfs = (id: string, path: string[]) => {
    const st = state.get(id) ?? 0;
    if (st === 1) {
      errors.push(`prerequisite cycle: ${[...path, id].join(' → ')}`);
      return;
    }
    if (st === 2) return;
    state.set(id, 1);
    for (const p of byId.get(id)?.prereqs ?? []) dfs(p, [...path, id]);
    state.set(id, 2);
  };
  for (const s of SKILLS) dfs(s.id, []);

  const itemIds = new Set<string>();
  const itemTypes: Record<string, number> = {};
  for (const it of ITEMS) {
    const r = itemSchema.safeParse(it);
    if (!r.success) errors.push(`item ${it.id}: ${r.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
    if (itemIds.has(it.id)) errors.push(`duplicate item ${it.id}`);
    itemIds.add(it.id);
    itemTypes[it.type] = (itemTypes[it.type] ?? 0) + 1;
    if (!skillIds.has(it.skillId)) errors.push(`item ${it.id}: unknown skill ${it.skillId}`);
    if (it.type === 'mcq') {
      const c = it.options.filter((o) => o.correct).length;
      if (c !== 1) errors.push(`item ${it.id}: mcq must have exactly 1 correct option (has ${c})`);
      for (const o of it.options) if (!o.correct && (!o.errorTag || !o.feedback)) errors.push(`item ${it.id}: distractor without errorTag/feedback`);
    }
    if (it.type === 'multi' && !it.options.some((o) => o.correct)) errors.push(`item ${it.id}: multi has no correct option`);
    if (it.type === 'classify') for (const c of it.cards) if (!it.buckets.includes(c.bucket)) errors.push(`item ${it.id}: card bucket ${c.bucket} not in buckets`);
    if (it.type === 'fill') {
      const n = (it.template.match(/\[\[\d+\]\]/g) ?? []).length;
      if (n !== it.blanks.length) errors.push(`item ${it.id}: template has ${n} blanks but ${it.blanks.length} answers`);
    }
  }
  for (const s of SKILLS) {
    const n = ITEMS.filter((i) => i.skillId === s.id).length;
    if (n < 2) errors.push(`skill ${s.id}: needs at least 2 items (has ${n})`);
  }

  const lessonIds = new Set<string>();
  for (const l of LESSONS) {
    if (lessonIds.has(l.id)) errors.push(`duplicate lesson ${l.id}`);
    lessonIds.add(l.id);
    for (const sid of [...l.skillIds, ...l.prerequisites]) if (!skillIds.has(sid)) errors.push(`lesson ${l.id}: unknown skill ${sid}`);
    for (const iid of [l.guided, ...l.practice, ...l.check, ...(l.challenge ? [l.challenge] : [])]) if (!itemIds.has(iid)) errors.push(`lesson ${l.id}: unknown item ${iid}`);
    if (l.status === 'current') {
      if (l.sections.length < 2) errors.push(`lesson ${l.id}: needs ≥2 sections`);
      if (!l.mistakes.length || !l.summary.length) errors.push(`lesson ${l.id}: needs mistakes and summary`);
      if (!l.sources.length) errors.push(`lesson ${l.id}: needs sources`);
    }
  }

  return { errors, counts: { schools: SCHOOLS.length, skills: SKILLS.length, items: ITEMS.length, lessons: LESSONS.length, itemTypes } };
}

export const Registry = {
  schools: SCHOOLS,
  skills: SKILLS,
  items: ITEMS,
  lessons: LESSONS,
};

export type { Skill, Item, Lesson };

import type { ClassifyItem, CodeItem, Difficulty, ErrorTag, FillItem, MatchItem, McqItem, MultiItem, Option, OrderItem, ShortItem } from '@/core/types';

/** Option spec: a string starting with '*' is correct; a tuple [text, errorTag, feedback] is a distractor. */
export type Opt = string | [string, ErrorTag, string];

const toOptions = (id: string, opts: Opt[]): Option[] =>
  opts.map((o, i) =>
    typeof o === 'string'
      ? { id: `${id}-o${i}`, text: o.replace(/^\*/, ''), correct: o.startsWith('*') }
      : { id: `${id}-o${i}`, text: o[0], correct: false, errorTag: o[1], feedback: o[2] },
  );

export const mcq = (id: string, skillId: string, difficulty: Difficulty, prompt: string, opts: Opt[], explanation: string, hints: string[] = []): McqItem => ({
  type: 'mcq', id, skillId, difficulty, prompt, options: toOptions(id, opts), explanation, hints,
});

export const multi = (id: string, skillId: string, difficulty: Difficulty, prompt: string, opts: Opt[], explanation: string, hints: string[] = []): MultiItem => ({
  type: 'multi', id, skillId, difficulty, prompt, options: toOptions(id, opts), explanation, hints,
});

export const order = (id: string, skillId: string, difficulty: Difficulty, prompt: string, steps: string[], explanation: string, errorTag: ErrorTag = 'weak-planning', hints: string[] = []): OrderItem => ({
  type: 'order', id, skillId, difficulty, prompt, steps, explanation, errorTag, hints,
});

export const match = (id: string, skillId: string, difficulty: Difficulty, prompt: string, pairs: [string, string][], explanation: string, errorTag: ErrorTag = 'concept-confusion', hints: string[] = []): MatchItem => ({
  type: 'match', id, skillId, difficulty, prompt, pairs: pairs.map(([left, right]) => ({ left, right })), explanation, errorTag, hints,
});

export const fill = (id: string, skillId: string, difficulty: Difficulty, prompt: string, template: string, blanks: string[][], explanation: string, errorTag: ErrorTag = 'conceptual', hints: string[] = []): FillItem => ({
  type: 'fill', id, skillId, difficulty, prompt, template, blanks: blanks.map((accept) => ({ accept })), explanation, errorTag, hints,
});

export const short = (id: string, skillId: string, difficulty: Difficulty, prompt: string, rubric: [string, string[]][], minConcepts: number, modelAnswer: string, explanation: string, hints: string[] = []): ShortItem => ({
  type: 'short', id, skillId, difficulty, prompt, rubric: rubric.map(([concept, any]) => ({ concept, any })), minConcepts, modelAnswer, explanation, hints,
});

export const classify = (id: string, skillId: string, difficulty: Difficulty, prompt: string, buckets: string[], cards: [string, string, ErrorTag?][], explanation: string, hints: string[] = []): ClassifyItem => ({
  type: 'classify', id, skillId, difficulty, prompt, buckets, cards: cards.map(([text, bucket, errorTag]) => ({ text, bucket, errorTag })), explanation, hints,
});

export const code = (
  id: string, skillId: string, difficulty: Difficulty, prompt: string,
  spec: { exports: string[]; starter: string; solution: string; tests: [string, string][]; language?: 'javascript' | 'python' },
  explanation: string, errorTag: ErrorTag = 'incomplete', hints: string[] = [],
): CodeItem => ({
  type: 'code', id, skillId, difficulty, prompt, language: spec.language, exports: spec.exports, starter: spec.starter, solution: spec.solution,
  tests: spec.tests.map(([name, c]) => ({ name, code: c })), explanation, errorTag, hints,
});

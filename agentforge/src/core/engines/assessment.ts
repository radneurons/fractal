// AssessmentEngine — one deterministic grader per item type.
// Every grader returns a score in [0,1] and the error tags implied by the specific mistake made.
import type { ErrorTag, GradeResult, Item, Response } from '../types';

export const PASS = 0.7;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function result(score: number, errorTags: ErrorTag[], feedback: string[], gradedBy: GradeResult['gradedBy'] = 'deterministic'): GradeResult {
  const s = Math.max(0, Math.min(1, score));
  return { score: s, correct: s >= PASS, errorTags: [...new Set(errorTags)], feedback, gradedBy };
}

export function grade(item: Item, response: Response): GradeResult {
  if (item.type !== response.type) throw new Error(`Response type ${response.type} does not match item ${item.type}`);
  switch (item.type) {
    case 'mcq': {
      const r = response as Extract<Response, { type: 'mcq' }>;
      if (r.optionId === null) return result(0, ['incomplete'], ['Marked as "I don\'t know" — that is useful information, not a failure.']);
      const opt = item.options.find((o) => o.id === r.optionId);
      if (!opt) throw new Error('Unknown option');
      if (opt.correct) return result(1, [], [opt.feedback ?? 'Correct.']);
      return result(0, [opt.errorTag ?? 'conceptual'], [opt.feedback ?? 'Not quite.']);
    }
    case 'multi': {
      const r = response as Extract<Response, { type: 'multi' }>;
      const chosen = new Set(r.optionIds);
      const correct = item.options.filter((o) => o.correct);
      let hits = 0;
      let falsePos = 0;
      const tags: ErrorTag[] = [];
      const fb: string[] = [];
      for (const o of item.options) {
        if (o.correct && chosen.has(o.id)) hits++;
        if (!o.correct && chosen.has(o.id)) {
          falsePos++;
          tags.push(o.errorTag ?? 'conceptual');
          if (o.feedback) fb.push(o.feedback);
        }
        if (o.correct && !chosen.has(o.id)) {
          tags.push('incomplete');
          fb.push(`Missed: “${o.text}”`);
        }
      }
      // Partial credit: hits/needed minus false positives, floored at 0.
      const score = Math.max(0, (hits - falsePos) / correct.length);
      return result(score, score === 1 ? [] : tags, fb.length ? fb : ['All correct options selected.']);
    }
    case 'order': {
      const r = response as Extract<Response, { type: 'order' }>;
      const n = item.steps.length;
      // Score = fraction of pairs in correct relative order (Kendall-tau style), robust to one swap.
      let good = 0;
      let total = 0;
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          total++;
          const a = r.order.indexOf(item.steps[i]);
          const b = r.order.indexOf(item.steps[j]);
          if (a > -1 && b > -1 && a < b) good++;
        }
      const exact = item.steps.every((s, i) => r.order[i] === s);
      const score = exact ? 1 : (good / total) * 0.8;
      const fb: string[] = [];
      if (!exact) {
        const firstWrong = item.steps.findIndex((s, i) => r.order[i] !== s);
        fb.push(`Step ${firstWrong + 1} should be: “${item.steps[firstWrong]}”`);
      }
      return result(score, exact ? [] : [item.errorTag ?? 'weak-planning'], exact ? ['Perfect sequence.'] : fb);
    }
    case 'match': {
      const r = response as Extract<Response, { type: 'match' }>;
      let ok = 0;
      const fb: string[] = [];
      for (const p of item.pairs) {
        if (r.mapping[p.left] === p.right) ok++;
        else fb.push(`“${p.left}” → “${p.right}”`);
      }
      const score = ok / item.pairs.length;
      return result(score, score === 1 ? [] : [item.errorTag ?? 'concept-confusion'], score === 1 ? ['All pairs matched.'] : ['Correct pairs you missed:', ...fb]);
    }
    case 'fill': {
      const r = response as Extract<Response, { type: 'fill' }>;
      let ok = 0;
      const fb: string[] = [];
      item.blanks.forEach((b, i) => {
        const v = norm(r.values[i] ?? '');
        if (b.accept.some((a) => norm(a) === v)) ok++;
        else fb.push(`Blank ${i + 1}: expected “${b.accept[0]}”`);
      });
      const score = ok / item.blanks.length;
      return result(score, score === 1 ? [] : [item.errorTag ?? 'conceptual'], score === 1 ? ['All blanks correct.'] : fb);
    }
    case 'short': {
      const r = response as Extract<Response, { type: 'short' }>;
      const text = norm(r.text);
      if (text.length < 15) return result(0, ['incomplete'], ['Write at least a sentence or two so the rubric can find your ideas.'], 'heuristic');
      const found: string[] = [];
      const missing: string[] = [];
      for (const c of item.rubric) {
        if (c.any.some((k) => text.includes(norm(k)))) found.push(c.concept);
        else missing.push(c.concept);
      }
      const score = Math.min(1, found.length / item.minConcepts);
      const fb = [
        `Rubric concepts detected (keyword heuristic): ${found.length ? found.join('; ') : 'none'}.`,
        ...(missing.length ? [`Not detected: ${missing.join('; ')}.`] : []),
        'Heuristic grading looks for key ideas, not exact wording — compare with the model answer.',
      ];
      return result(score, score >= PASS ? [] : ['incomplete'], fb, 'heuristic');
    }
    case 'code': {
      const r = response as Extract<Response, { type: 'code' }>;
      const score = r.total === 0 ? 0 : r.passed / r.total;
      return result(
        score,
        score === 1 ? [] : [item.errorTag ?? 'incomplete'],
        score === 1 ? [`All ${r.total} tests passed.`] : [`${r.passed}/${r.total} tests passed.`, ...r.failed.map((f) => `✗ ${f}`)],
        'executed',
      );
    }
    case 'classify': {
      const r = response as Extract<Response, { type: 'classify' }>;
      let ok = 0;
      const tags: ErrorTag[] = [];
      const fb: string[] = [];
      for (const c of item.cards) {
        if (r.mapping[c.text] === c.bucket) ok++;
        else {
          tags.push(c.errorTag ?? 'concept-confusion');
          fb.push(`“${c.text}” belongs in ${c.bucket}`);
        }
      }
      const score = ok / item.cards.length;
      return result(score, score === 1 ? [] : tags, score === 1 ? ['Everything sorted correctly.'] : fb);
    }
  }
}

/** Deterministic shuffle so options render in stable but non-authored order (seeded by id). */
export function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

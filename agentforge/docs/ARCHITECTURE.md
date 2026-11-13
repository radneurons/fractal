# Architecture

AgentForge is a single-page React 18 + TypeScript app built with Vite. All learning logic lives in pure, UI-independent TypeScript modules under `src/core`, which are unit-tested directly. The UI under `src/features` and `src/ui` only renders state and records evidence.

```
src/
  core/
    types.ts                 domain contracts (Skill, Item, Lesson, Evidence, SkillEstimate…)
    registry.ts              CurriculumRegistry + Zod validation of all content
    engines/
      assessment.ts          AssessmentEngine — one deterministic grader per item type
      competency.ts          CompetencyEngine — evidence-weighted Beta model, states
      review.ts              ReviewScheduler — Leitner ladder 1/3/7/16/35/90 days
      planner.ts             AdaptivePlanner — paths, candidate ranking, 7-day plan
      diagnostic.ts          DiagnosticEngine — adaptive staircase placement
      weakness.ts            WeaknessFinder — weak skills, hypotheses, recovery plans
      progression.ts         ranks (from mastery + projects), XP, badges
    runtime/
      harness.ts / sandbox.ts  PracticeRuntime — JS tests in an isolated Web Worker
      agentRuntime.ts        AgentStudioRuntime — typed graph validation + execution + traces
      tools.ts               deterministic tools (safe calculator parser, local search, mock APIs)
      templates.ts           Studio templates and debug challenges with acceptance tests
      retrieval.ts           chunking, BM25, toy embedding, hybrid ranking, recall@k
      terminalSim.ts         in-memory shell + Git simulation
      tokenizer.ts           transparent teaching tokenizer
    ai/
      provider.ts            AIProviderManager — optional Anthropic SDK / OpenAI calls
      mentorPrompts.ts       fixed mentor mode prompts (learner text wrapped as data)
  content/                   schools, skills, items, lessons, projects, games, interviews
  store/
    learner.ts               Zustand store persisted to IndexedDB (idb-keyval)
    model.ts                 useModel(): derived estimates, plan, weaknesses, rank
  features/                  one module per area (Lesson, Studio, Arena, Observatory…)
  ui/                        kit (icons, markdown, truth labels, modal, toasts), ItemView, router
```

## The single evidence log

Every graded interaction anywhere in the app calls `recordAttempt` / `recordEvidence`, which appends one `Evidence` record (skill, item, source, score, difficulty, hints, revealed, error tags, grader, time), updates the review schedule for that skill, awards XP and logs activity. Incorrect attempts also create a Mistake Journal entry. Nothing else stores progress-relevant numbers: the Universe colours, Command Center, Planner, Observatory, Mentor context and badges are all **derived** from the evidence log by `useModel()`. That is what makes the system one integrated learner model.

## Mastery model (exact)

- Evidence weight `w = source × (0.6 + 0.2·difficulty) × max(0.25, 1 − 0.25·hints) × 0.5^(age_days/45)`; revealed solutions weigh 0. Source weights: diagnostic 0.6, lesson 0.8, practice/review/remediation 1.0, game 0.7, exercise/interview 1.2, project 1.5, self-rated 0.2.
- Estimate = `(1 + Σ w·score) / (2 + Σ w)` (Beta posterior, weak uniform prior). 90% interval from the Beta variance.
- Confidence = `1 − 1/√(1 + Σ w)`; `Σ w < 0.6` → "Not enough evidence".
- States (in order): remediation (Σw ≥ 1.2 and estimate < 0.5) → review-due → mastered (≥ 0.8, confidence ≥ 0.5, ≥ 2 distinct items passed, ≥ 1 non-diagnostic success) → practiced → in-progress → ready (all prerequisites practiced) → prerequisites-first (never a hard gate).

## Agent Studio runtime

Graphs are `{nodes, edges}` with typed ports (`flow` vs `tool`). `connectionError` rejects invalid wiring at edit time; `validateGraph` checks a single input, an output, reachability, that every cycle contains a Loop node with a 1–20 limit, agent `maxSteps` 1–50, valid tools, and that external-impact tools (send_email) have a Human Approval node upstream. `runGraph` executes breadth-first with a global step budget, emits ordered trace events (`enter`, `decision`, `tool-request`, `tool-response`, `tool-error`, `state`, `branch`, `approval`, `final`, `budget`, `output`), validates tool arguments with Zod, enforces approval at runtime, supports retries and simulated failures, and runs an optional loop guard. The UI highlights nodes only from these events.

Agent decisions come from `rulePolicy` — a deterministic teaching policy that matches tool description keywords and extracts arguments by rules. It is labelled **SIMULATED** everywhere. The `Policy` interface allows a live model policy to be added without changing the runtime.

## Sandbox

`runInSandbox` creates a Web Worker from a Blob. Before any learner code runs, the worker deletes `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`, `indexedDB`, `caches`, `BroadcastChannel`, `Worker`, `SharedWorker` and `navigator` from its global scope. A 2-second wall-clock timer calls `worker.terminate()`, which also stops infinite loops. Test results come back from the worker; the UI never fabricates them. The same `runHarness` function is unit-tested in Node.

## Persistence

Zustand `persist` with an IndexedDB storage adapter (in-memory fallback when IndexedDB is unavailable, e.g. some private modes). Export produces versioned JSON without credentials; import validates the envelope and only accepts known keys.

## Routing & loading

A minimal hash router (works on any static host and from sub-paths). Every page is `React.lazy`-loaded; Three.js, React Flow and CodeMirror are split into their own chunks and only load on pages that need them.

## Testing

- `tests/unit/curriculum.test.ts` — schema validation, unique ids, prerequisite DAG, every skill ≥ 2 items, lesson skills ≥ 4 items, every MCQ distractor has an error tag + feedback, answer-length bias < 40%, every authored model answer grades correct, every code item's reference solution passes and starter fails.
- `tests/unit/engines.test.ts` — mastery model edge cases, partial credit, scheduler, planner time budgets/pins/skips, diagnostic staircase, weakness hypotheses and recovery, ranks/XP.
- `tests/unit/runtime.test.ts` — calculator safety, schema rejection, port typing, all templates' tests, faulty templates fail until fixed, cycles need loops, budgets halt, trace ordering, runtime approval enforcement, terminal sim, retrieval recall, tokenizer losslessness, harness honesty.
- `tests/unit/projects.test.ts` — every project/debug milestone solvable and not pre-solved, game balance (every Token Commander level winnable, default config not), interview rubrics satisfiable by model answers.
- `tests/e2e/journey.mjs` — the 13-step learner journey plus Studio fix, Universe 3D/2D, focus mode persistence, all routes, mobile overflow, WebGL fallback, clean console.

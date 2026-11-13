# AGENTFORGE — Master Build Specification v2

> An engineering-grade rewrite of the original "AgentForge master coding prompt".
> The original described a vision. This version makes that vision **buildable, testable and honest**:
> every feature has a data contract, a grading rule, an acceptance test and a definition of "done".
> Where the original said "make it amazing", this says *what amazing means and how we will know*.

---

## How this version improves the original (the "5×")

| # | Original weakness | v2 fix |
|---|---|---|
| 1 | Vision without contracts — "build a Mastery Engine" with no model | §6 gives the exact evidence model, formulas, thresholds and the states it can output |
| 2 | 16 schools × ~16 topics = ~250 lessons implied, impossible to author well | §5 separates the **skill graph** (all schools, every node real and navigable) from **authored depth** (a tiered content budget with an honest status per lesson) |
| 3 | "No fake AI" stated but not designed for | §9 defines three explicit **execution truth levels** (Executed / Deterministic simulation / Authored demonstration) that every output must carry as a visible label |
| 4 | Games described as themes, not mechanics | §11 specifies each game's input, scoring function, failure feedback and replay rule |
| 5 | Accessibility listed as bullets | §13 sets WCAG 2.2 AA targets, keyboard maps for every drag interaction, and a 3D-free path to 100 % of content |
| 6 | UI described with adjectives | §12 defines a token-based design system, layout grid, motion budget and the Focus/Explore mode split |
| 7 | Phases without exit criteria | §15 gives each phase measurable exit criteria and a "usable after every phase" rule |
| 8 | Tests listed as topics | §14 lists concrete test cases with expected outcomes, including the 13-step learner journey as an automated E2E |
| 9 | No information architecture | §3 defines routes, navigation hierarchy and the first-five-minutes flow screen by screen |
| 10 | No content-quality bar | §5.4 defines the authoring checklist every lesson and item must pass before it is marked `current` |
| 11 | Mentor described as personality | §8 defines mentor *inputs*, *mode prompts*, *hint-ladder credit rules* and offline behaviour |
| 12 | Security as principles | §10 gives a threat model: key handling, sandbox limits, prompt-injection boundaries inside the product itself |

---

## 0. Role, mission, non-negotiables

You are a senior product team (architecture, learning science, frontend craft, AI engineering, accessibility, game design). Build **AgentForge**: a learning environment that takes a complete beginner to someone who can build, debug, evaluate and safely operate AI agents.

**The one rule that overrides every other:** *the platform rewards demonstrated capability, never consumption.* Reading a lesson moves a skill to "in progress" at most. Only graded evidence moves mastery.

### Non-negotiables (each is a test in §14)
1. No dead controls. Every button does something or is not rendered.
2. No placeholder content presented as complete. Unwritten lessons are visibly marked `planned`.
3. No fabricated AI output, test results, streaming, or mastery numbers.
4. Every model-free output is labeled with its truth level (§9).
5. All required content reachable without WebGL, without a mouse, and without an API key.
6. Progress survives reload (IndexedDB, with export/import).
7. Untrusted code runs only in an isolated, time-limited worker; never on a host shell.
8. Grading logic for every item type is documented and unit-tested.
9. Claims about Claude, Claude Code, Codex and MCP cite an official source and a `lastReviewed` date.

---

## 1. Product pillars

| Pillar | Meaning | Measured by |
|---|---|---|
| **Learn by doing** | Every lesson has at least one graded interaction | Curriculum test: no lesson without a graded item |
| **Evidence, not vibes** | Mastery = f(graded evidence), with confidence shown | Observatory shows the evidence list behind every number |
| **Adaptive** | Errors change what you see next | Journey test: wrong answer ⇒ remediation item appears |
| **Honest** | Truth labels on every output | UI test: no unlabeled simulated output |
| **Beautiful but quiet** | Cinematic in Explore, calm in Focus | Focus mode removes all non-essential motion |
| **Accessible** | AA, keyboard-first, 2D equivalents | Axe-style checks + keyboard journey |

---

## 2. Architecture

### 2.1 Stack (browser-first, zero required backend)
React 18 + TypeScript (strict) + Vite · Three.js (Knowledge Universe, hero) · Zustand (state) persisted to IndexedDB · Zod (curriculum + tool schemas) · @xyflow/react (Agent Studio) · CodeMirror 6 (code editing — chosen over Monaco because it bundles locally, works offline and is ~10× lighter; Monaco remains a drop-in option) · hand-built SVG charts (accessible, theme-aware, no chart lib needed) · Vitest (unit) · Playwright (E2E).

### 2.2 Subsystems (pure TypeScript modules, UI-independent, unit-tested)
| Module | Responsibility | Key exports |
|---|---|---|
| `CurriculumRegistry` | Schools, skills, lessons, items, projects; validated with Zod at boot | `getSkill`, `getLesson`, `itemsForSkill`, `validateCurriculum` |
| `AssessmentEngine` | One grader per item type, returns `GradeResult {score 0..1, correct, errorTags[], feedback}` | `grade(item, response)` |
| `CompetencyEngine` | Evidence → mastery estimate, confidence, state | `estimate(skillId, evidence)` |
| `ReviewScheduler` | Spaced repetition per skill (Leitner-style ladder) | `nextReview`, `dueSkills` |
| `AdaptivePlanner` | Next best activity; weekly plan fitted to a time budget | `recommendNext`, `buildPlan` |
| `DiagnosticEngine` | Adaptive staircase placement test | `nextDiagnosticItem`, `placement` |
| `WeaknessFinder` | Weak skills, prereq hypotheses, error-pattern clusters, recovery sequences | `findWeaknesses`, `recoveryPlan` |
| `PracticeRuntime` | JS execution in a Web Worker with timeout + test harness | `runTests(code, tests)` |
| `AgentRuntime` | Executes Agent Studio graphs deterministically with step budget, emits trace events | `validateGraph`, `runGraph` |
| `TerminalSim` | Virtual filesystem shell + scripted coding-agent sessions | `exec(cmd)` |
| `AIProviderManager` | Optional Anthropic / OpenAI calls with user-supplied key, local only | `complete(req)` |
| `MentorEngine` | Builds mentor context; authored hint ladder offline | `mentorReply`, `nextHint` |
| `GameEngine` | Level data + scoring functions for each game | per-game `score()` |
| `Persistence` | IndexedDB storage, versioned migrations, export/import | `exportAll`, `importAll` |

### 2.3 Data flow
`UI interaction → AssessmentEngine.grade → Evidence record → store.addEvidence → CompetencyEngine (derived) → Planner / Observatory / Universe node colours / Mentor context`.
There is exactly **one** evidence log. Every surface reads from it. That is what makes the system "one integrated learner model".

### 2.4 Evidence record (the core contract)
```ts
interface Evidence {
  id: string; skillId: string; itemId?: string;
  source: 'diagnostic'|'lesson'|'practice'|'exercise'|'game'|'interview'|'project'|'review'|'remediation';
  score: number;          // 0..1 from a grader — never from time spent
  difficulty: 1|2|3|4|5;
  hintsUsed: number; solutionRevealed: boolean;
  errorTags: ErrorTag[];  // classified from the distractor/test that failed
  gradedBy: 'deterministic'|'heuristic'|'model'|'self';
  at: number;             // epoch ms
}
```

---

## 3. Information architecture

### 3.1 Routes
`/` Landing · `/onboarding` · `/diagnostic` · `/home` Command Center · `/universe` · `/academy` · `/academy/:schoolId` · `/lesson/:lessonId` · `/lab` (Prompt, Code, API, Terminal, Agent-Session) · `/studio` · `/arena` + `/arena/:gameId` · `/brain-gym` · `/interview` · `/projects` + `/projects/:id` · `/observatory` · `/vault` · `/planner` · `/settings`.

### 3.2 Navigation
Left rail (collapsible, icons + labels, keyboard reachable) grouped as **Learn** (Home, Universe, Academy, Planner) · **Practice** (Lab, Studio, Arena, Brain Gym) · **Prove** (Interview, Projects, Observatory) · **Keep** (Vault, Settings). On mobile the rail becomes a bottom bar with 5 primary items + "More".
A global **Forge Guide** button opens the mentor drawer from anywhere with the current context attached.
Command palette (`Ctrl/⌘ K`) searches lessons, skills, games, vault.

### 3.3 The first five minutes (screen by screen)
1. **Landing** — 3D constellation (or static SVG if WebGL/reduced motion). Headline, sub-line, three CTAs: *I'm starting from zero* · *I already use AI* · *Test my skills*. No sign-up.
2. **Onboarding (≤ 3 steps)** — experience level → goal path (A–F) → minutes per session (20/40/60) and days per week.
3. **Diagnostic** — 6 items (zero), 8 (use AI) or 12 (test my skills), adaptive staircase, skippable ("I don't know" is an answer and is graded 0 without penalty to confidence wording).
4. **Plan reveal** — "Here's what we found": strong / developing / not yet assessed, then the first week's plan.
5. **First lesson** — *Chatbot vs Agent* with the agent-loop visual.
6. **Hands-on** — a graded tool-selection exercise.
7. **First competency result** — skill card updates with the evidence that moved it.
8. **What's next** — the next two recommendations and why.

---

## 4. Learner journeys (acceptance scenarios)
- **J1 Absolute beginner:** lands → zero → Power User path → 6-item diagnostic → lesson L-F01 → gets a question wrong → sees misconception-specific explanation → gets a *different* follow-up item on the same skill → answers correctly → skill moves to `practiced` → reloads browser → resumes in the same lesson section.
- **J2 Developer:** "Test my skills" → 12-item diagnostic → plan skips foundations it has evidence for → Agent Studio template → fixes a faulty graph → runs acceptance tests → Studio skill evidence recorded.
- **J3 Weakness recovery:** fails two MCP items → Observatory shows `remediation` + hypothesis "prerequisite *tool calling* not demonstrated" → *Fix this weakness* → corrective note → worked example → targeted item → transfer item → review scheduled.

---

## 5. Curriculum

### 5.1 Structure
`School (16) → Skill (graph node, ~6 per school) → Lesson (0..n per skill) → Items`.
The **skill graph** is complete across all 16 schools so the Universe and Planner always have real structure. Each skill has: id, title, school, summary, prerequisites (DAG), difficulty, `remediation` note (≤ 150 words, authored), `workedExample`, and ≥ 2 assessment items so the system can always test, remediate and re-test with a *different* item.

### 5.2 Authored-depth budget for v1
| Asset | v1 target | Rule |
|---|---|---|
| Schools mapped | 16 | All navigable |
| Skills | ~96 | Every skill has summary + remediation + ≥ 2 items |
| Fully authored lessons | 30 | Full 14-part lesson structure (§5.3) |
| Assessment items | ≥ 200 | Every item: key, explanation, skill mapping, error tag per distractor |
| Practical exercises | 25 | Executed (JS tests) or deterministic graders |
| Games | 10 | §11 mechanics, ≥ 3 levels each |
| Interview scenarios | 20+ | Rubric with concept groups + model answer + follow-ups |
| Project briefs | 8 | Milestones + rubric |
| End-to-end guided projects | 3 | Executable milestones with real tests |
| Visualizations | 6 | Driven by real data/state |

Lessons beyond the budget appear with status `planned` and still offer the skill's remediation note + items, so no node is a dead end.

### 5.3 Lesson template (all 14 parts are required for `status: current`)
objective · prerequisites · motivation · explanation (sections) · interactive demo (widget id) · worked example · guided activity (graded, hints allowed) · independent practice (graded, fewer hints) · common mistakes · knowledge check (graded) · advanced challenge (optional, graded) · summary · review scheduling (automatic) · competency evidence (automatic).

### 5.4 Content quality checklist
- Objective is observable ("Choose the correct tool for a goal and justify it"), not "understand X".
- Every MCQ distractor maps to a named misconception (`errorTag`) and has its own feedback line.
- No claim about a vendor product without `sources[]` + `lastReviewed`. Commands are only those in official docs; when unsure, teach the concept and link the docs.
- Reading level: beginner tracks ≤ grade 9; jargon defined on first use.
- No item answerable by length/position heuristics (answer position is shuffled; longest option is correct < 40 % of the time — enforced by a test).

### 5.5 Content metadata
`id · version · lastReviewed · sources[] · status (current | review-needed | planned | archived) · environment (browser | simulated | requires-provider)`.

---

## 6. The Mastery Engine (exact model)

### 6.1 Evidence weighting
`w = base(source) × diff(d) × hint(h) × reveal × recency(t)`
- `base`: diagnostic 0.6 · lesson 0.8 · practice/review/remediation 1.0 · game 0.7 · exercise/interview 1.2 · project 1.5 · self 0.2
- `diff(d) = 0.6 + 0.2·d` (d = 1..5)
- `hint(h) = max(0.25, 1 − 0.25·h)`; `reveal = solutionRevealed ? 0 : 1` (*revealed solutions never earn credit*)
- `recency(t) = 0.5^(age_days / 45)`

### 6.2 Estimate
Beta posterior with a weak prior (α₀ = 1, β₀ = 1):
`mastery = (α₀ + Σ w·s) / (α₀ + β₀ + Σ w)` · `n_eff = Σ w`
`confidence = 1 − 1/√(1 + n_eff)` → label: *insufficient* (< 0.35) · *low* · *moderate* (≥ 0.5) · *high* (≥ 0.65).
A 90 % CI from the Beta variance is shown on hover. When `n_eff < 0.6`, the UI says **"Not enough evidence"** instead of a number.

### 6.3 States (Universe colours and Observatory)
| State | Rule (evaluated in order) |
|---|---|
| `remediation` | n_eff ≥ 1.2 and mastery < 0.5 |
| `review-due` | was `mastered` and review date passed |
| `mastered` | mastery ≥ 0.8, confidence ≥ 0.5, ≥ 2 distinct items passed, ≥ 1 non-diagnostic source |
| `practiced` | ≥ 1 graded success (score ≥ 0.7) |
| `in-progress` | lesson opened or any attempt |
| `ready` | all prerequisites ≥ practiced (or no prerequisites) |
| `locked-soft` | otherwise — still openable; we warn, we never gate |

### 6.4 Error taxonomy
`conceptual · missing-prereq · wrong-tool · syntax · weak-planning · context-omission · bad-assumption · poor-verification · incomplete · unsafe-action · state-mgmt · concept-confusion`. Tags come from the specific distractor chosen or the specific test that failed. Inferred causes are shown as **hypotheses** with the evidence that suggested them.

### 6.5 Weakness → recovery sequence
detect (state = remediation, or same errorTag ≥ 3 times in 14 days) → check prerequisites (any prereq < 0.6 or unassessed ⇒ hypothesis "missing prerequisite") → show remediation note → worked example → targeted item (unseen) → transfer item (different unseen item, higher difficulty if available) → schedule review in 1 day → mastery changes only through the new evidence.

### 6.6 Spaced review
Ladder of intervals `[1, 3, 7, 16, 35, 90]` days. Pass (≥ 0.7, no reveal) ⇒ step up; fail ⇒ step down two. "Learned once" vs "Retained" = mastered with ≥ 1 passed review ≥ 7 days after first mastery.

### 6.7 Ranks & XP
XP is awarded by graded score × difficulty, *halved for hints, zero for reveals*; correcting a previously failed skill gives a 1.5× bonus. **Rank is computed from mastered skills and completed projects, not XP**: Explorer (0) · Apprentice (3 mastered) · Practitioner (8) · Builder (14 + 1 project) · Engineer (22 + 2) · Specialist (32 + 3) · Architect (45 + 5) · Master (60 + 7). Badges list the evidence that earned them.

---

## 7. Adaptive Planner
Inputs: goal path, minutes/session, sessions/week, evidence, due reviews, weaknesses.
Algorithm: (1) topologically order the path's skills; (2) score each candidate `priority = 3·dueReview + 2.5·remediation + 2·ready + 1·inProgress − 1·mastered`; (3) fill each session up to the time budget using item/lesson duration estimates: always 1 review block if due, ≤ 1 remediation block, then new learning, then 1 practice block (game/lab) if time remains; (4) emit 7-day plan. Missed sessions just roll forward — no penalties, no broken-streak shame. "Rebuild my plan" recomputes; learner pins/skips are respected.

---

## 8. Forge Guide (mentor)
**Context sent (when a provider is configured, and only after consent):** current lesson/objective, current item prompt (never the answer key unless already submitted), last 5 evidence records, top 3 weak skills, chosen mode, explanation level.
**Modes:** Explain simply · Step by step · Socratic · Show example · Hint · Challenge me · Find my mistake · Another way · Interview me. Each mode has a fixed system prompt (in `src/core/ai/mentorPrompts.ts`).
**Hint ladder:** concept pointer → likely misunderstanding → partial approach → related example → full solution (only after an attempt). Each hint level lowers the credit of the *next* submission (§6.1); revealing gives zero credit.
**Offline:** authored hints, remediation notes and alternate explanations; the drawer explicitly says "Authored guidance — no AI model connected".
**Integrity:** no fake streaming; mentor never claims to have run code; model-graded results show "AI-graded — may be wrong" plus the rubric.

---

## 9. Execution truth levels (visible label on every output)
| Label | Meaning | Examples |
|---|---|---|
| **EXECUTED** | Really ran in this browser | JS tests in the worker, Agent Studio runtime, retrieval scoring, schema validation |
| **SIMULATED** | Deterministic simulation with authored rules | Terminal sim, offline agent policy, cost model in Token Budget Commander |
| **DEMONSTRATION** | Pre-authored example output | Offline Prompt Lab "what a model might return" |
| **LIVE MODEL** | Real provider response, model id shown | Mentor / Prompt Lab with a key |

---

## 10. Security & privacy
- **Keys:** optional, user-entered, stored only in this browser's IndexedDB, sent only to the chosen provider, never logged or exported. UI explains the risk of browser-held keys and recommends a backend proxy for anything public. Production deployments must use a server proxy (documented in `docs/PROVIDERS.md`).
- **Code execution:** Web Worker, no DOM, `fetch`/`XMLHttpRequest`/`importScripts`/`WebSocket` removed in the worker scope, hard 2 s timeout via `worker.terminate()`, output capped. No Python/shell execution in v1 (labelled "requires an isolated sandbox service").
- **Prompt-injection hygiene inside the product:** mentor prompts wrap learner content in delimited blocks and instruct the model to treat it as data.
- **Data:** local by default; export (JSON) and full delete in Settings.

---

## 11. Games — mechanics contracts
Each game: ≥ 3 levels, deterministic scoring, per-mistake feedback, replay with shuffled order, evidence emitted to mapped skills.
1. **Prompt Architect** — assemble prompt blocks (objective, context, constraints, examples, format, verification) from a palette that contains good, irrelevant and harmful blocks; score = requirements satisfied − penalties for harmful/irrelevant blocks.
2. **Agent Rescue** — read a real trace; choose root cause and fix; fix is applied and the scenario re-runs to show the corrected trace.
3. **Hallucination Hunter** — label each claim supported / unsupported / contradicted and cite the source sentence; score requires the right label *and* the right citation.
4. **Context Window Tetris** — knapsack under a token budget; task succeeds only if all required facts are included; penalties for redundancy; bonus for summaries.
5. **Tool-Calling Detective** — pick tool, write JSON args validated against the tool's Zod schema, predict result; the tool actually executes.
6. **Debug the Agent** — fix a buggy JS agent loop; real tests in the worker decide.
7. **Prompt Injection Defense** — identify the injected span in untrusted content and choose the defense; harmless sandboxed scenarios.
8. **Architecture Forge** — choose components; rubric of required capabilities, each satisfiable by several components (multiple valid designs).
9. **Token Budget Commander** — tune knobs against a transparent cost/quality model (formula shown; labelled SIMULATED).
10. **AI Incident Room** — read logs/metrics, pick root cause and the two best corrective actions.

**Brain Gym:** domain puzzles whose evidence counts only toward the mapped skill (logic puzzles alone never count as AI mastery).

---

## 12. Design system
- **Modes:** *Explore* (3D, motion, atmosphere) and *Focus* (no background animation, max 72-character measure, larger type). Focus is one click and persists.
- **Tokens:** colour (bg, surface 1–3, border, text 1–3, accent, accent-2, success, warn, danger, info + state colours for the 7 skill states), radius (6/10/16), spacing (4-pt), type scale (12/14/16/18/22/28/36/52), shadows (2 levels), motion (120/200/320 ms, `cubic-bezier(.2,.8,.2,1)`).
- **Type:** Space Grotesk (display), Inter (UI/body), JetBrains Mono (code).
- **Themes:** Dark (default, deep navy, teal accent, amber secondary), Light, High-contrast. All text ≥ 4.5:1.
- **Layout:** 12-col fluid grid, 16 px mobile gutter, max content 1280 px; lesson reading column 720 px.
- **Motion budget:** ≤ 1 ambient animation per screen; all motion disabled under `prefers-reduced-motion` or the Reduced-motion setting.
- **Truth labels, skill-state chips, evidence cards** are first-class components.

## 13. Accessibility
WCAG 2.2 AA. Every drag interaction has a keyboard alternative (move up/down buttons, select-then-place). Focus rings visible (3 px accent outline). Live regions announce grading results. The Universe has a 2D list/graph view with identical actions. Text size 90–130 %. No information conveyed by colour alone (state chips include icon + text).

## 14. Tests (must exist and pass)
**Unit:** curriculum integrity (unique ids, prereqs exist, DAG has no cycles, every lesson's items exist, every skill ≥ 2 items, every distractor has an errorTag, answer-position balance) · each grader (correct, incorrect, partial) · mastery model (no evidence ⇒ insufficient; reveal ⇒ no credit; recovery after later success; recency decay) · scheduler · planner fits time budget and respects pins · diagnostic staircase · weakness finder hypotheses · agent runtime (valid graph runs, invalid connection rejected, loop bounded by step budget, tool failure surfaces, trace order) · terminal sim commands · tool-schema validation.
**E2E (Playwright):** the J1 journey including reload/resume; Focus mode; keyboard-only lesson answer; 3D fallback when WebGL disabled; zero console errors.

## 15. Delivery phases with exit criteria
1. **Learning core** — shell, onboarding, registry, lesson player, graders, persistence. *Exit:* J1 steps 1–6 pass.
2. **Adaptive mastery** — diagnostic, competency, weakness, review, plan. *Exit:* J3 passes.
3. **Practice** — Prompt/Code/API/Terminal labs, hints, submissions. *Exit:* code tests execute in worker and fail/pass correctly.
4. **Agent Studio** — graph, validation, runtime, traces, faulty templates. *Exit:* a faulty template fails tests, fixed version passes.
5. **Arena** — 10 games. *Exit:* each emits evidence.
6. **Interview + Projects** — *Exit:* rubric grading + 3 guided projects with executable milestones.
7. **Universe & polish** — *Exit:* 60 fps target on a mid laptop, 2D parity.
8. **Infrastructure** — providers, sandbox service, sync. *Exit:* documented, optional, off by default.

## 16. Definition of done
A newcomer can open the app with no account and no key, learn, be tested, be corrected, improve, build something that runs, and see — with evidence — exactly what they can and cannot yet do.

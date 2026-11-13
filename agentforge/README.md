# AgentForge — the AI mastery universe

From absolute beginner to AI agent architect, through **evidence, not watch-time**.

AgentForge is a browser-first learning platform: an adaptive curriculum (16 schools, 91 skills, 54 fully authored lessons, 290 graded assessment items), real hands-on labs (code runs in a sandboxed Web Worker), a visual Agent Engineering Studio that actually executes agent graphs, ten educational games, an adaptive interview simulator, project workshops with test-graded milestones, and a transparent mastery model that finds weak spots and drives a personalised plan.

No account and no API key are required. Progress is saved locally in IndexedDB.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL (default http://localhost:5173).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check and production build to `dist/` (static files, works on any static host; hash routing, relative base) |
| `npm run preview` | Serve the production build on port 4173 |
| `npm test` | Unit + content-integrity tests (Vitest) — 425 tests |
| `npm run e2e` | Full learner-journey test in Chromium (Playwright) — run `npm run build` first |
| `npm run typecheck` | TypeScript only |

## What's inside

| Area | Route | Highlights |
|---|---|---|
| Landing | `/` | 3D constellation built from the real skill graph; three entry points |
| Onboarding | `/onboarding` | Level → goal path → time budget → adaptive staircase diagnostic → plan reveal |
| Command Center | `/home` | Next best activity, today's session, rank, reviews due, weaknesses, interview readiness |
| Knowledge Universe | `/universe` | Three.js skill map coloured by evidence state; accessible 2D view; WebGL fallback |
| Academy & lessons | `/academy`, `/lesson/:id` | 14-part lessons; graded items; targeted follow-up on wrong answers |
| Practice / review / recovery | `/practice/:skill`, `/review`, `/recover/:skill` | Spaced review without hints; "Fix this weakness" sequence |
| Practice Lab | `/lab/*` | Prompt Lab (structure analyser + optional live model), Code Lab (sandbox), API Lab, terminal & coding-agent session simulator, Review Lab, Eval & systems lab, AI vs AI Comparison Lab |
| Agent Studio | `/studio/:template` | React Flow editor with typed ports, validation, real execution, trace replay, tests, human approvals, 4 debug challenges; agent decisions by teaching rules or, with an Anthropic key, a live Claude model |
| Challenge Arena | `/arena/:game` | 10 games, ≥3 levels each, deterministic scoring |
| Brain Gym | `/brain-gym` | Domain reasoning puzzles requiring explanations |
| Interview Simulator | `/interview` | 23 scenarios, 5 levels, rubric + adaptive follow-up, optional model grading |
| Projects | `/projects/:id` | 9 projects, 3 fully guided with test-graded code milestones; Planning Lab |
| Observatory | `/observatory` | Radar, competency matrix, "Why this score?", error heatmap, timeline, badges |
| Vault | `/vault` | Notes, prompts, mistake journal (auto), review cards, Markdown/JSON export |
| Planner | `/planner` | 7-day plan fitted to 20/40/60-minute sessions; pins/skips; roadmap |
| Settings | `/settings` | Themes (dark/light/high-contrast), text size, reduced motion, focus mode, provider, data export/import/delete |

## Documentation

- [docs/MASTER_PROMPT.md](docs/MASTER_PROMPT.md) — the improved build specification (v2)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, data flow, mastery model, runtimes
- [docs/CURRICULUM.md](docs/CURRICULUM.md) — content structure, authoring rules, status
- [docs/PROVIDERS.md](docs/PROVIDERS.md) — optional AI provider integration
- [docs/SECURITY.md](docs/SECURITY.md) — security & privacy notes
- [docs/STATUS.md](docs/STATUS.md) — honest list of what is complete, simulated, or not yet built

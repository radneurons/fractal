# AgentForge — the AI mastery universe

From absolute beginner to AI agent architect, through **evidence, not watch-time**.

AgentForge is a browser-first learning platform: an adaptive curriculum (16 schools, 91 skills, 91 fully authored lessons, 370 graded assessment items), real hands-on labs (JavaScript and Python run in sandboxed Web Workers; MCP Lab speaks the real Model Context Protocol), a visual Agent Engineering Studio that actually executes agent graphs, ten educational games, an adaptive interview simulator, project workshops with test-graded milestones, and a transparent mastery model that finds weak spots and drives a personalised plan.

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
| `npm test` | Unit, protocol and content-integrity tests (Vitest) — 532 tests |
| `npm run e2e` | Full learner-journey test in Chromium (Playwright, 24 steps) — run `npm run build` first |
| `npm run a11y` | Automated accessibility audit (axe-core, WCAG 2.1 A/AA) of 29 routes in dark, light and high-contrast themes — run `npm run build` first |
| `npm run mcp:demo` | Start the bundled demo MCP server on http://localhost:8787/mcp for MCP Lab and Agent Studio |
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
| Practice Lab | `/lab/*` | Prompt Lab (structure analyser + optional live model), Code Lab (JavaScript and offline Python sandboxes), API Lab, terminal & coding-agent session simulator, Review Lab, Eval & systems lab, AI vs AI Comparison Lab, MCP Lab (real MCP client: capabilities, tools, resources, JSON-RPC log) |
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

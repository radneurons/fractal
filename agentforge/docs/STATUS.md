# Status — what is real, what is simulated, what is not built

Honest inventory against `docs/MASTER_PROMPT.md` (v2). "Executed" means it really runs in your browser; "Simulated" means deterministic authored rules; "Demonstration" means pre-written example output.

## Complete and verified (unit + e2e tests)

- Onboarding (3 entry points, goal paths A–F, 20/40/60-minute budgets), adaptive staircase diagnostic (6/8/12 items), plan reveal.
- Curriculum registry with Zod validation; 16 schools, 91 skills (DAG), 91 fully authored lessons (one per skill), 370 items across 8 item types — each with a real grader.
- Mastery engine exactly as specified (weights, Beta estimate, confidence, states, "Not enough evidence"), "Why this score?" with the full evidence table and formula.
- Weakness finder with labelled hypotheses (missing prerequisite, recurring error tag) and the "Fix this weakness" recovery sequence (note → prerequisite check → worked example → targeted item → transfer item → review).
- Spaced review ladder, review queue, "learned once" vs "retained".
- Adaptive planner with pins/skips, rebuild, roadmap; missed days never penalised.
- Lesson player with targeted follow-up on wrong answers and resume-where-you-left-off.
- Hint ladder with credit reduction; revealed solutions earn no credit; XP halved with hints; rank from mastery + projects only.
- Practice Lab: Prompt Lab (deterministic structure analyser + optional live run), Code Lab (20 JavaScript and 6 Python exercises with real tests, JS/Python scratchpad, submission history; Python is CPython via WebAssembly, bundled locally, offline, network blocked, 5 s kill), API Lab (Zod-validated request builder), terminal & coding-agent session simulator with checkpoints, Review Lab, Eval/RAG/multi-agent systems lab.
- Agent Studio: typed ports, validation, execution, trace replay, acceptance tests, human-approval modal, retries/failure injection, loop guard, 4 working templates + 4 debugging challenges; graphs persist per template.
- Challenge Arena: all 10 games with ≥3 levels; Brain Gym (9 puzzles, explanation required).
- Interview Simulator: 23 scenarios across 5 levels, timer, scratchpad, clarifying question, rubric, adaptive follow-up, model answers, history; optional model grading.
- Projects: 9 briefs (rubrics, milestones), 3 fully guided with 9 test-graded code milestones; Planning Lab with judgement checks and a generated AGENTS.md/CLAUDE.md draft.
- Observatory: radar, competency matrix, error heatmap, 30-day timeline, badges linked to evidence, documented metrics.
- Knowledge Vault: notes, prompts, auto Mistake Journal (resolves on later success), review cards, search/tags, Markdown + JSON export.
- Knowledge Universe: Three.js map from the real skill graph with state colours, fly-to, hover, prerequisite/unlock navigation; full 2D accessible alternative; automatic fallback without WebGL.
- Forge Guide mentor: 9 modes; authored guidance offline; live model when configured.
- Accessibility: keyboard alternatives for every drag interaction, visible focus, live-region grading announcements, reduced motion, focus mode, text scaling, dark/light/high-contrast themes, mobile layout with bottom navigation.
- Persistence in IndexedDB; export/import/delete.

- MCP Lab: a real MCP client built on the official MCP TypeScript SDK (Streamable HTTP). Connect to any CORS-enabled server, see server info, protocol version and capabilities, list and call tools, read resources, and inspect every JSON-RPC message. Connected tools appear in the Agent Studio palette and run inside workflows (arguments validated against the server's JSON Schema; flow-mode argument templates; non-read-only tools require Human Approval). A bundled demo server (`npm run mcp:demo`) is exercised by the unit suite and the e2e journey.
- AI vs AI Comparison Lab: one prompt run against two configurations (two models on one key, or two providers with a second key), measured latency and provider-reported token counts, deterministic per-task checks, a blind human rubric and saved, replayable records. Offline it offers practice on fictional outputs (labelled as such, not attributed to any vendor). It reports no prices and declares no winner; live runs have not been exercised against real APIs in this build environment (no keys available).

## Simulated or demonstration (clearly labelled in the UI)

- By default, agent decisions in Agent Studio and the agent-loop demo come from a deterministic rule-based policy (tools, validation, budgets and traces are real). With an Anthropic key configured, the Studio's "Live Claude" switch lets a real model make each decision instead; the runtime still validates arguments, enforces approvals and budgets, and records the trace. Studio acceptance tests always use the deterministic rules so results are repeatable. The live mode is covered by unit tests with an injected model; it has not been exercised against the real API in this build environment (no key available).
- Terminal and coding-agent sessions are simulations modelled on common workflows; they show visible plans and actions, not hidden model reasoning.
- Prompt Lab "weak vs strong" outputs, the LLM pipeline probabilities, the eval observatory outputs and Agent Rescue traces are pre-authored demonstrations (the graders over them execute for real).
- Token Budget Commander uses an illustrative cost/quality formula (shown in the UI), not real prices.
- The "learned" side of the rule-vs-model demo uses authored weights; the neural-network demo performs real gradient descent.
- The vector side of retrieval uses a transparent hashed-trigram embedding, not a neural embedding model.

## Out of scope by design (local-first, no backend)

- **Accounts and cross-device sync.** AgentForge is a static, local-first app with no server: progress lives in your browser's IndexedDB. To move it between devices, use Settings → Export (JSON) and Import on the other device. Adding accounts would require a backend and a privacy policy, which this build deliberately does not include.
- **Shell, package installation and repository-level exercises.** These need an isolated server-side sandbox with CPU, memory, network and filesystem limits. The terminal and coding-agent sessions are labelled simulations instead.
- **A calibrated knowledge-tracing model.** The weighted-evidence Beta model is the documented v1; calibrating a model such as BKT/IRT requires real learner data.
- **Captions for instructional media.** There is no audio or video media in this build.
- **Live provider calls verified against real APIs.** The live paths (Prompt Lab, Comparison Lab, Studio "Live Claude", Forge Guide, interview grading) are covered by unit tests with injected models but were not exercised against real APIs here (no keys available in the build environment).

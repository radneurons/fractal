# Status — what is real, what is simulated, what is not built

Honest inventory against `docs/MASTER_PROMPT.md` (v2). "Executed" means it really runs in your browser; "Simulated" means deterministic authored rules; "Demonstration" means pre-written example output.

## Complete and verified (unit + e2e tests)

- Onboarding (3 entry points, goal paths A–F, 20/40/60-minute budgets), adaptive staircase diagnostic (6/8/12 items), plan reveal.
- Curriculum registry with Zod validation; 16 schools, 91 skills (DAG), 30 fully authored lessons, 242 items across 8 item types — each with a real grader.
- Mastery engine exactly as specified (weights, Beta estimate, confidence, states, "Not enough evidence"), "Why this score?" with the full evidence table and formula.
- Weakness finder with labelled hypotheses (missing prerequisite, recurring error tag) and the "Fix this weakness" recovery sequence (note → prerequisite check → worked example → targeted item → transfer item → review).
- Spaced review ladder, review queue, "learned once" vs "retained".
- Adaptive planner with pins/skips, rebuild, roadmap; missed days never penalised.
- Lesson player with targeted follow-up on wrong answers and resume-where-you-left-off.
- Hint ladder with credit reduction; revealed solutions earn no credit; XP halved with hints; rank from mastery + projects only.
- Practice Lab: Prompt Lab (deterministic structure analyser + optional live run), Code Lab (12 sandboxed exercises + scratchpad + submission history), API Lab (Zod-validated request builder), terminal & coding-agent session simulator with checkpoints, Review Lab, Eval/RAG/multi-agent systems lab.
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

## Simulated or demonstration (clearly labelled in the UI)

- Agent decisions in Agent Studio and the agent-loop demo come from a deterministic rule-based policy, not a live model (tools, validation, budgets and traces are real).
- Terminal and coding-agent sessions are simulations modelled on common workflows; they show visible plans and actions, not hidden model reasoning.
- Prompt Lab "weak vs strong" outputs, the LLM pipeline probabilities, the eval observatory outputs and Agent Rescue traces are pre-authored demonstrations (the graders over them execute for real).
- Token Budget Commander uses an illustrative cost/quality formula (shown in the UI), not real prices.
- The "learned" side of the rule-vs-model demo uses authored weights; the neural-network demo performs real gradient descent.
- The vector side of retrieval uses a transparent hashed-trigram embedding, not a neural embedding model.

## Not built in this version

- Server-side isolated execution for Python, shell, package installation and repository-level exercises.
- Live-model agent policy inside Agent Studio (the `Policy` interface is ready; an Anthropic tool-use policy is a natural next step).
- MCP Tool node connected to real MCP servers (MCP is taught conceptually and via projects).
- Multi-provider side-by-side "AI vs AI" comparison runner (the Prompt Lab can run one provider at a time; curated comparisons are not included).
- Cross-device sync and accounts; a calibrated knowledge-tracing model (the weighted-evidence model is the documented v1).
- Full lessons for 61 of 91 skills (each has a corrective note, worked example and graded practice; marked "Full lesson planned").
- Captions for instructional media (there is no audio/video media in this build).

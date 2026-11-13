# Curriculum

Curriculum version `2026.11.1` · last reviewed 2026-11-01.

## Structure

`School (16) → Skill (91, prerequisite DAG) → Lesson (42 fully authored) → Items (266)`

| School | Skills | Authored lessons |
|---|---|---|
| 1 AI Foundations | 8 | 7 |
| 2 Effective AI Communication | 7 | 5 |
| 3 Claude Essentials | 5 | 2 |
| 4 Claude Code | 8 | 6 |
| 5 OpenAI Codex | 6 | 3 |
| 6 Programming for AI Builders | 7 | 2 |
| 7 AI APIs & App Development | 6 | 2 |
| 8 Agent Engineering Fundamentals | 6 | 3 |
| 9 Tool Calling, MCP & Integrations | 5 | 2 |
| 10 Context, Memory & RAG | 6 | 1 |
| 11 Advanced Agent Architecture | 5 | 2 |
| 12 Evals, Debugging & Reliability | 5 | 2 |
| 13 AI Security & Trust | 5 | 1 |
| 14 AI Product Engineering | 4 | 2 |
| 15 Professional AI Engineering | 4 | 2 |
| 16 Frontier & Specialized Topics | 4 | — |

Every skill — including those without a full lesson — has a summary, an authored corrective note (`remediation`), a worked example and at least two graded items, so every Universe node and Academy entry leads somewhere real. Skills without a full lesson are marked "Full lesson planned" in the UI.

## Item bank

266 items: 129 multiple choice, 42 multi-select, 20 ordering, 13 matching, 11 fill-in-the-blank, 24 classification (drag or select-and-place), 14 short explanations (keyword-rubric heuristic, labelled as such), 13 code (real tests in the sandbox).

Additional graded activities outside the item bank: 9 project milestone code tasks (test-graded), 3 Debug-the-Agent levels, 8 Agent Studio templates (4 debugging challenges) with acceptance tests, 5 Prompt Lab tasks, 3 Review Lab diffs, the API Lab, 30 game levels, 9 Brain Gym puzzles and 23 interview scenarios.

## Lesson template

Each authored lesson has: objective, prerequisites, motivation, 2–3 explanation sections, an optional interactive demo, a worked example, a guided item, practice, common mistakes, a knowledge check, an optional challenge, a summary, plus two authored alternative explanations ("Explain simply", "Teach it another way") used offline by the lesson and Forge Guide. Metadata: id, version, `lastReviewed`, `sources[]`, `status`, `environment`.

## Authoring rules (enforced by tests where possible)

1. Objectives are observable ("Choose…", "Write…", "Explain…").
2. Every MCQ distractor carries an `errorTag` and its own feedback (enforced).
3. Correct answers must not be identifiable by length — the longest option is correct in < 40% of MCQs (enforced; currently ~29%, mostly "pick the best prompt" items).
4. Every model answer / answer key grades as correct; every code reference solution passes and every starter fails (enforced).
5. Vendor-specific lessons (Claude Code, Codex, MCP) teach durable concepts and link to official documentation for exact commands, flags and settings, which change frequently. They avoid asserting specific command syntax that could go stale.
6. Answer keys ship in the client bundle (this is a client-only app); reference solutions for projects and debug levels are kept only in tests.

## Updating content

Content is plain TypeScript data in `src/content/`. To update one module: edit its skill/lesson/items, bump the lesson `version` and `lastReviewed`, run `npm test` (the integrity suite catches broken references, cycles, missing items and invalid keys). No other code needs to change.

## Sources used for vendor topics

- Claude docs: https://platform.claude.com/docs (formerly docs.anthropic.com)
- Claude Code docs: https://code.claude.com/docs
- Anthropic engineering: Building effective agents; Claude Code best practices
- OpenAI Codex: https://developers.openai.com/codex · OpenAI API: https://developers.openai.com/api/docs/
- AGENTS.md: https://agents.md · Model Context Protocol: https://modelcontextprotocol.io
- OWASP Top 10 for LLM Applications

# Curriculum

Curriculum version `2026.11.1` · last reviewed 2026-11-01.

## Structure

`School (16) → Skill (91, prerequisite DAG) → Lesson (91 — one per skill) → Items (370)`

| School | Skills | Authored lessons |
|---|---|---|
| 1 AI Foundations | 8 | 8 |
| 2 Effective AI Communication | 7 | 7 |
| 3 Claude Essentials | 5 | 5 |
| 4 Claude Code | 8 | 8 |
| 5 OpenAI Codex | 6 | 6 |
| 6 Programming for AI Builders | 7 | 7 |
| 7 AI APIs & App Development | 6 | 6 |
| 8 Agent Engineering Fundamentals | 6 | 6 |
| 9 Tool Calling, MCP & Integrations | 5 | 5 |
| 10 Context, Memory & RAG | 6 | 6 |
| 11 Advanced Agent Architecture | 5 | 5 |
| 12 Evals, Debugging & Reliability | 5 | 5 |
| 13 AI Security & Trust | 5 | 5 |
| 14 AI Product Engineering | 4 | 4 |
| 15 Professional AI Engineering | 4 | 4 |
| 16 Frontier & Specialized Topics | 4 | 4 |

Every skill has a fully authored lesson, a summary, an authored corrective note (`remediation`), a worked example and graded items, so every Universe node and Academy entry leads somewhere real. The integrity suite fails if any skill lacks a lesson.

## Item bank

370 items: 181 multiple choice, 46 multi-select, 31 ordering, 13 matching, 14 fill-in-the-blank, 45 classification (drag or select-and-place), 14 short explanations (keyword-rubric heuristic, labelled as such), 26 code — 20 JavaScript and 6 Python — graded by real tests in the browser sandboxes.

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

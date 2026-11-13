// Items for Schools 4–7: Claude Code, Codex, programming, APIs.
// Vendor-specific items test durable concepts; exact commands/flags are left to the linked official docs.
import type { Item } from '@/core/types';
import { classify, code, fill, match, mcq, multi, order, short } from './helpers';

export const CODING_ITEMS: Item[] = [
  // ── cc-start
  mcq('cc-start-1', 'cc-start', 1, 'What determines which files Claude Code works with when you start a session?', [
    '*The directory you start it in.',
    ['Every file on your computer, indexed automatically.', 'bad-assumption', 'It works within the project directory you start it in (plus anything you explicitly allow).'],
    ['Only files you paste into the chat.', 'concept-confusion', 'Unlike a chat window, it can read and search the project itself.'],
    ['Files stored in your cloud account.', 'conceptual', 'It works on the local project directory for a terminal session.'],
  ], 'Start Claude Code inside the repository you want it to work on.'),
  multi('cc-start-2', 'cc-start', 1, 'Which actions can an agentic coding tool like Claude Code take, subject to its permission settings? Select all that apply.', [
    '*Read and search files in the project',
    '*Run commands such as the test suite',
    '*Edit files to implement a change',
    ['Bypass your permission settings when it is confident', 'unsafe-action', 'Permission settings apply regardless of the model\'s confidence.'],
  ], 'It reads, runs and edits — under the permission system you control.'),
  order('cc-start-3', 'cc-start', 2, 'Order a sensible first session in an unfamiliar repository.', [
    'Start Claude Code in the project directory',
    'Ask it to explain the project structure and main files',
    'Request one small, well-scoped change',
    'Review the diff and run the tests',
  ], 'Understand first, change small, verify.'),
  mcq('cc-start-4', 'cc-start', 2, 'Claude Code finishes a task and says "All tests pass." What counts as evidence?', [
    '*The real test output and the diff.',
    ['The statement itself — it ran the tests.', 'poor-verification', 'Check the real output; an agent\'s summary is a claim, not evidence.'],
    ['The fact that no error appeared in the chat.', 'poor-verification', 'Absence of an error message is not a passing test run.'],
    ['How confident the message sounds.', 'poor-verification', 'Tone is not evidence.'],
  ], 'Verify with real outputs.'),

  // ── cc-instructions
  mcq('cc-instructions-1', 'cc-instructions', 2, 'Which instruction is most likely to produce a correct, reviewable change?', [
    '*"Users with uppercase emails can\'t log in. The comparison is in src/auth/login.ts. Normalise emails to lowercase at sign-up and login, add a test for mixed-case emails in login.test.ts, and run npm test."',
    ['"Fix the login bug."', 'context-omission', 'No symptom, location, constraint or verification step.'],
    ['"Make login better and more robust."', 'context-omission', 'Unbounded scope invites a sprawling diff.'],
    ['"Rewrite the auth module using best practices."', 'weak-planning', 'Large unscoped rewrites are hard to review and risky.'],
  ], 'Symptom + location + desired behaviour + verification.'),
  multi('cc-instructions-2', 'cc-instructions', 2, 'Which elements make a coding instruction more effective? Select all that apply.', [
    '*Pointers to relevant files or existing patterns to follow',
    '*Constraints such as "don\'t change the public API"',
    '*A way to verify the result, e.g. a specific test command',
    ['A request to be creative with the architecture', 'weak-planning', 'Usually you want consistency with the existing codebase.'],
  ], 'Where, what, constraints, verification.'),
  short('cc-instructions-3', 'cc-instructions', 3, 'Rewrite "add dark mode" as an effective instruction for a coding agent working in a React app.', [
    ['location / files', ['src/', '.tsx', '.css', 'file', 'component', 'theme']],
    ['specific behaviour', ['toggle', 'prefers-color-scheme', 'system', 'persist', 'localstorage', 'switch', 'setting']],
    ['constraint / pattern', ['existing', 'follow', "don't", 'do not', 'pattern', 'tokens', 'variables']],
    ['verification', ['test', 'run', 'screenshot', 'check', 'verify', 'typecheck', 'lint']],
  ], 3, '"Add a dark theme. Use the CSS variables in src/styles/theme.css (don\'t hardcode colours). Default to the OS setting via prefers-color-scheme, add a toggle in Header.tsx, and persist the choice in localStorage. Add a test for the toggle in Header.test.tsx and run npm test and npm run typecheck."',
    'Name the files, define behaviour precisely, constrain the approach, and say how to verify.'),
  mcq('cc-instructions-4', 'cc-instructions', 3, 'Why give the agent a way to check its own work (tests, type-check, screenshot)?', [
    '*It can catch and fix its own mistakes before handing back.',
    ['It makes the agent run faster.', 'bad-assumption', 'Verification adds steps; the gain is quality.'],
    ['It is required before the agent is allowed to edit files.', 'conceptual', 'It is a best practice, not a requirement.'],
    ['It prevents the agent from reading files.', 'conceptual', 'Unrelated to reading files.'],
  ], 'Self-verification is one of the highest-leverage things you can give a coding agent.'),

  // ── cc-review
  mcq('cc-review-1', 'cc-review', 2, 'An agent "fixed" a failing test by changing `expect(total).toBe(100)` to `expect(total).toBeDefined()`. What is the right response?', [
    '*Reject it: the test was weakened, not the bug fixed.',
    ['Accept it — the test passes now.', 'poor-verification', 'A passing weakened test hides the bug.'],
    ['Accept it but add a comment explaining the change.', 'poor-verification', 'Documentation does not fix a hidden regression.'],
    ['Delete the test since it was flaky.', 'unsafe-action', 'Nothing suggests flakiness; the code is wrong.'],
  ], 'Watch for weakened assertions, deleted tests and scope creep in diffs.'),
  multi('cc-review-2', 'cc-review', 2, 'Which Git practices make agent-driven changes safer? Select all that apply.', [
    '*Working on a separate branch',
    '*Committing before starting a large agent task',
    '*Reviewing `git diff` before committing',
    ['Letting the agent force-push to main to save time', 'unsafe-action', 'Force-pushing to main destroys shared history.'],
  ], 'Branch, checkpoint, review.'),
  match('cc-review-3', 'cc-review', 1, 'Match each Git command to its purpose.', [
    ['git status', 'See which files changed'],
    ['git diff', 'See exactly which lines changed'],
    ['git commit', 'Save a snapshot of staged changes'],
    ['git restore <file>', 'Discard uncommitted changes to a file'],
  ], 'These four commands are enough to review and undo most agent edits.'),
  classify('cc-review-4', 'cc-review', 3, 'Sort each diff observation.', ['Red flag', 'Usually fine'], [
    ['A test file was deleted', 'Red flag', 'poor-verification'],
    ['A new dependency appeared in package.json for a one-line task', 'Red flag', 'poor-verification'],
    ['A new test covers the bug that was fixed', 'Usually fine'],
    ['Changes are limited to the files named in the task', 'Usually fine'],
    ['An assertion changed from toBe(42) to toBeTruthy()', 'Red flag', 'poor-verification'],
  ], 'Review for scope, weakened tests and unexpected dependencies.'),

  // ── cc-claudemd
  mcq('cc-claudemd-1', 'cc-claudemd', 2, 'What is the main purpose of a project CLAUDE.md file?', [
    '*Persistent project context: commands, conventions, gotchas.',
    ['To store the conversation history between sessions.', 'concept-confusion', 'It holds instructions you write, not transcripts.'],
    ['To configure the model\'s API key.', 'conceptual', 'Keys do not belong in CLAUDE.md, which is often committed.'],
    ['To list every file in the repository.', 'context-omission', 'The agent can search files; CLAUDE.md holds what it cannot easily infer.'],
  ], 'Put in it what the agent would otherwise get wrong.'),
  classify('cc-claudemd-2', 'cc-claudemd', 2, 'Which lines belong in a project CLAUDE.md?', ['Good fit', 'Poor fit'], [
    ['Test command: npm test -- --run', 'Good fit'],
    ['Never edit files in src/generated/ (regenerated by codegen)', 'Good fit'],
    ['Our production database password', 'Poor fit', 'unsafe-action'],
    ['A full copy of the README', 'Poor fit', 'context-omission'],
    ['Use the ApiClient wrapper, never raw fetch', 'Good fit'],
  ], 'Concise, specific, non-secret, things the agent can\'t infer.'),
  mcq('cc-claudemd-3', 'cc-claudemd', 3, 'Why should CLAUDE.md be concise?', [
    '*It is loaded into context, so every line costs.',
    ['Because the file has a hard limit of 10 lines.', 'conceptual', 'There is no 10-line limit; conciseness is about cost and focus.'],
    ['Because long files are ignored entirely.', 'bad-assumption', 'They are read — but irrelevant lines dilute the important ones.'],
    ['Because Git cannot store large Markdown files.', 'conceptual', 'Git handles Markdown fine.'],
  ], 'High signal per line.'),
  short('cc-claudemd-4', 'cc-claudemd', 3, 'Write three lines you would put in CLAUDE.md for a TypeScript project, and say why each helps.', [
    ['a command', ['npm', 'pnpm', 'yarn', 'test', 'build', 'lint', 'typecheck']],
    ['a convention', ['use ', 'prefer', 'never', 'always', 'style', 'convention', 'export']],
    ['a justification', ['because', 'so that', 'otherwise', 'since', 'why']],
  ], 3, '- Typecheck with `npm run typecheck` before finishing — because CI fails on type errors.\n- Use named exports only — because our barrel files rely on them.\n- Never edit `src/generated/` — it is overwritten by codegen, so edits are lost.',
    'Good lines are specific, actionable and justified.'),

  // ── cc-permissions
  classify('cc-permissions-1', 'cc-permissions', 2, 'Assign a sensible default permission to each action.', ['Allow', 'Ask', 'Deny'], [
    ['Run the project\'s test suite', 'Allow'],
    ['Edit source files', 'Ask'],
    ['Read the .env file with production secrets', 'Deny', 'unsafe-action'],
    ['Install a new npm package', 'Ask'],
    ['Force-push to the main branch', 'Deny', 'unsafe-action'],
  ], 'Pre-approve frequent low-risk actions; ask for changes you care about; deny dangerous ones.'),
  mcq('cc-permissions-2', 'cc-permissions', 3, 'You are tired of approving `npm test` every time. What is the best change?', [
    '*Allow that one test command; keep others on "ask".',
    ['Switch off all permission prompts for every tool.', 'unsafe-action', 'Too broad — you lose control over risky actions.'],
    ['Allow every shell command that starts with npm.', 'unsafe-action', '`npm` can also install or publish packages — scope narrowly.'],
    ['Stop running tests to avoid the prompt.', 'poor-verification', 'Tests are your main verification.'],
  ], 'Allow narrowly; keep the safety net.'),
  multi('cc-permissions-3', 'cc-permissions', 3, 'Which principles apply when configuring an agent\'s permissions? Select all that apply.', [
    '*Least privilege: grant only what the task needs',
    '*Reversible, low-risk actions are good candidates for pre-approval',
    '*Secrets and destructive operations should be denied by default',
    ['Grant broad access so the agent never gets blocked', 'unsafe-action', 'Being blocked occasionally is cheaper than an irreversible mistake.'],
  ], 'Least privilege, reversibility, deny the dangerous.'),
  mcq('cc-permissions-4', 'cc-permissions', 3, 'Where should you look for the current syntax of Claude Code permission rules?', [
    '*The official Claude Code docs.',
    ['Ask the model to recall the syntax from memory.', 'poor-verification', 'Syntax evolves; models may recall outdated forms.'],
    ['Copy a rule from an old forum post.', 'poor-verification', 'May be outdated or unsafe.'],
    ['Guess and see if it errors.', 'unsafe-action', 'A wrong rule could silently allow too much.'],
  ], 'Primary docs for tool-specific syntax.'),

  // ── cc-plan
  order('cc-plan-1', 'cc-plan', 2, 'Order the plan-first workflow for a non-trivial change.', [
    'Ask the agent to explore the relevant files',
    'Ask for a written plan without editing',
    'Review and correct the plan',
    'Implement the plan',
    'Verify with tests and review the diff',
  ], 'Fixing a plan is cheaper than fixing a 20-file diff.'),
  mcq('cc-plan-2', 'cc-plan', 3, 'In a test-driven agent workflow, what should happen right after the agent writes the new tests?', [
    '*Run them and confirm they fail as expected.',
    ['Implement the feature immediately without running them.', 'poor-verification', 'A test that passes before implementation tests nothing.'],
    ['Ask the agent to make the tests pass by any means.', 'unsafe-action', 'Invites modifying the tests or hard-coding outputs.'],
    ['Delete the old tests to avoid conflicts.', 'unsafe-action', 'Old tests protect existing behaviour.'],
  ], 'Red → green: confirm the failure, then implement without editing the tests.'),
  multi('cc-plan-3', 'cc-plan', 3, 'What should you check when reviewing an agent\'s plan? Select all that apply.', [
    '*Does it address the actual requirement and edge cases?',
    '*Does it touch only the necessary files?',
    '*Does it say how the change will be verified?',
    ['Is it as long as possible?', 'bad-assumption', 'Length is not quality.'],
  ], 'Requirement fit, scope, verification.'),
  short('cc-plan-4', 'cc-plan', 4, 'Describe how you would ask a coding agent to add a "proration" feature to a billing module safely.', [
    ['explore / read first', ['explore', 'read', 'understand', 'investigate']],
    ['plan before editing', ['plan', "don't edit", 'do not edit', 'before editing', 'propose']],
    ['tests first', ['test', 'failing']],
    ['verify / review', ['verify', 'review', 'diff', 'run']],
  ], 3, 'Ask it to read src/billing and propose a plan without editing. Review the plan. Then ask it to write failing tests for the proration cases, confirm they fail, implement until they pass without modifying the tests, run the full suite, and show the diff for review.',
    'Explore → plan → tests → implement → verify.'),

  // ── cc-extend
  match('cc-extend-1', 'cc-extend', 3, 'Match each Claude Code extension point to its best use.', [
    ['Hook', 'Guarantee a command runs at a lifecycle event, e.g. format after every edit'],
    ['Subagent', 'A specialised assistant with its own instructions, tools and context'],
    ['Skill', 'Reusable packaged instructions/scripts loaded when relevant'],
    ['MCP server', 'Connect external tools and data sources'],
  ], 'Hooks for guarantees, subagents for focused delegation, skills for reusable know-how, MCP for integrations.'),
  mcq('cc-extend-2', 'cc-extend', 3, 'You need "the formatter runs on every file the agent edits — no exceptions." Which mechanism fits best?', [
    '*A post-edit hook that runs the formatter.',
    ['A line in CLAUDE.md asking it to format files.', 'wrong-tool', 'Instructions are followed most of the time; hooks are deterministic.'],
    ['A subagent dedicated to formatting.', 'wrong-tool', 'Still model-driven; a hook is simpler and guaranteed.'],
    ['Asking at the end of each session.', 'poor-verification', 'Manual and easy to forget.'],
  ], 'Use deterministic mechanisms for must-always rules.'),

  // ── cc-automation
  multi('cc-automation-1', 'cc-automation', 4, 'You run a coding agent headless in CI to review PRs. Which controls are appropriate? Select all that apply.', [
    '*Read-only tools and no push permissions',
    '*Limits on turns, time or cost',
    '*A human decides whether to act on findings',
    ['The same broad permissions you use interactively', 'unsafe-action', 'No human is approving each step in CI — tighten permissions.'],
  ], 'Remove the human from the loop → tighten everything else.'),
  mcq('cc-automation-2', 'cc-automation', 4, 'A long agent task spans several sessions and context resets. What helps most?', [
    '*A plan/progress file the agent keeps updated.',
    ['Relying on the model to remember previous sessions.', 'bad-assumption', 'Sessions do not share memory unless you provide it.'],
    ['One huge prompt with every instruction repeated.', 'weak-planning', 'Bloats context and still loses progress.'],
    ['Starting over each session.', 'weak-planning', 'Wastes work and risks inconsistency.'],
  ], 'Externalise state into files.'),

  // ── cx-what
  mcq('cx-what-1', 'cx-what', 1, 'How does a coding agent like Codex differ from pasting code into a chatbot?', [
    '*It works in your repo: reads, runs tests, edits.',
    ['It can only answer questions about code you paste.', 'concept-confusion', 'That describes a plain chatbot.'],
    ['It writes code without needing any review.', 'unsafe-action', 'You remain responsible for reviewing its changes.'],
    ['It only works on code that OpenAI wrote.', 'conceptual', 'It works on your projects.'],
  ], 'Agents act in an environment; chatbots only reply.'),
  multi('cx-what-2', 'cx-what', 2, 'Which are surfaces through which Codex can be used, according to OpenAI\'s documentation? Select all that apply.', [
    '*A command-line interface (CLI)',
    '*IDE integration',
    '*Delegated cloud tasks',
    ['A browser extension that rewrites any website', 'bad-assumption', 'Not a documented Codex surface — always check the official docs.'],
  ], 'Surfaces evolve; check developers.openai.com for the current list.'),
  mcq('cx-what-3', 'cx-what', 2, 'Codex reports that a task is complete. Who is responsible for the correctness of the merged code?', [
    '*You, and your review process.',
    ['The agent, since it wrote the code.', 'bad-assumption', 'Tools don\'t carry accountability; reviewers do.'],
    ['OpenAI.', 'bad-assumption', 'You own what you merge.'],
    ['Nobody, if tests passed.', 'poor-verification', 'Tests reduce risk; review remains essential.'],
  ], 'Agents accelerate work; humans own outcomes.'),
  order('cx-what-4', 'cx-what', 2, 'Order a typical Codex task loop.', [
    'Describe a scoped task with acceptance criteria',
    'The agent inspects relevant files',
    'The agent proposes or makes edits',
    'Tests run and output is shown',
    'You review the diff and accept or iterate',
  ], 'Same loop as any coding agent: scope → inspect → edit → test → review.'),

  // ── cx-cli
  mcq('cx-cli-1', 'cx-cli', 2, 'Before asking a coding agent CLI for a large change, what should you do first?', [
    '*Start from a clean Git branch.',
    ['Delete the tests to avoid slowing it down.', 'unsafe-action', 'Tests are your safety net.'],
    ['Give it the broadest permissions so it doesn\'t stop.', 'unsafe-action', 'Start restrictive.'],
    ['Nothing; agents never make mistakes on large changes.', 'bad-assumption', 'Large changes are where review matters most.'],
  ], 'Clean branch = cheap rollback.'),
  short('cx-cli-2', 'cx-cli', 3, 'Write a task for Codex to add validation to a POST /users endpoint.', [
    ['specific rules', ['email', 'length', 'chars', 'characters', 'required', 'valid']],
    ['error behaviour', ['400', 'error', 'reject']],
    ['tests', ['test']],
  ], 3, '"Add validation to POST /users in src/routes/users.ts: email must be a valid address and name 1–80 characters. On failure return 400 with {error: string}. Add tests in tests/users.test.ts for valid input and each failure, then run the test suite."',
    'Rules + error contract + tests.'),

  // ── cx-agentsmd
  mcq('cx-agentsmd-1', 'cx-agentsmd', 2, 'What is AGENTS.md for?', [
    '*Repo-specific instructions for coding agents.',
    ['A list of the human contributors to the project.', 'concept-confusion', 'That would be CONTRIBUTORS or AUTHORS.'],
    ['Configuration for the model\'s API key and billing.', 'unsafe-action', 'Never put secrets in repository instruction files.'],
    ['Logs of every previous agent run.', 'concept-confusion', 'It holds instructions, not logs.'],
  ], 'AGENTS.md tells agents how to work in your repo.'),
  classify('cx-agentsmd-2', 'cx-agentsmd', 2, 'Which content belongs in AGENTS.md?', ['Belongs', 'Does not belong'], [
    ['Install: pnpm install / Test: pnpm test', 'Belongs'],
    ['New endpoints need an integration test in tests/api/', 'Belongs'],
    ['The staging server\'s admin password', 'Does not belong', 'unsafe-action'],
    ['TypeScript strict mode; avoid `any`', 'Belongs'],
    ['A changelog of every release since 2019', 'Does not belong', 'context-omission'],
  ], 'Actionable, current, non-secret guidance.'),
  mcq('cx-agentsmd-3', 'cx-agentsmd', 3, 'Your AGENTS.md says "Test: npm test" but the project switched to pnpm and `npm test` now fails. What is the impact?', [
    '*Every agent run is misled by the wrong command.',
    ['None — agents ignore AGENTS.md when commands fail.', 'bad-assumption', 'Agents rely on it; stale instructions actively mislead.'],
    ['The agent will automatically update AGENTS.md.', 'bad-assumption', 'Maintaining it is your job.'],
    ['Only human contributors are affected.', 'concept-confusion', 'AGENTS.md is primarily for agents.'],
  ], 'Treat instruction files as code: keep them current.'),
  mcq('cx-agentsmd-4', 'cx-agentsmd', 3, 'A monorepo has different conventions in /web and /api. How can AGENTS.md handle that?', [
    '*A root AGENTS.md plus subdirectory files.',
    ['Only one AGENTS.md per repository is ever allowed.', 'conceptual', 'Codex supports more specific files deeper in the tree.'],
    ['Put both sets of rules in the README instead.', 'wrong-tool', 'Agents look for AGENTS.md specifically.'],
    ['Rely on agents to infer conventions from the code.', 'context-omission', 'Explicit guidance is more reliable.'],
  ], 'Scope guidance to where it applies.'),

  // ── cx-approvals
  match('cx-approvals-1', 'cx-approvals', 3, 'Match each control to what it governs.', [
    ['Sandbox mode', 'What the agent\'s commands can access (files, network)'],
    ['Approval policy', 'When the agent must stop and ask you'],
    ['Git branch', 'Isolation and reversibility of changes'],
  ], 'Codex distinguishes sandboxing from approvals; both matter.'),
  classify('cx-approvals-2', 'cx-approvals', 3, 'Choose the most appropriate sandbox level for each situation.', ['Read-only', 'Workspace write', 'Full access (disposable env only)'], [
    ['Exploring and explaining an unfamiliar codebase', 'Read-only'],
    ['Implementing a feature in your project', 'Workspace write'],
    ['A throwaway container that must install system packages', 'Full access (disposable env only)'],
    ['Reviewing a PR for risky changes', 'Read-only'],
  ], 'Most restrictive level that lets the task progress.'),
  mcq('cx-approvals-3', 'cx-approvals', 3, 'Why is granting full system access on your everyday laptop risky, even for a helpful agent?', [
    '*Errors or injection could reach far beyond the project.',
    ['It makes the agent slower.', 'bad-assumption', 'Speed is not the concern; blast radius is.'],
    ['It is never risky if you trust the model provider.', 'bad-assumption', 'Trusting the provider does not prevent model errors or injected instructions.'],
    ['It disables Git.', 'conceptual', 'Git still works; the risk is unbounded access.'],
  ], 'Limit blast radius with sandboxes.'),
  mcq('cx-approvals-4', 'cx-approvals', 3, 'An agent requests network access mid-task to "download a helpful script". What is the safest response?', [
    '*Inspect what and why; approve only if legitimate.',
    ['Approve automatically — downloads are harmless.', 'unsafe-action', 'Remote scripts can be malicious; network access is a key risk.'],
    ['Approve and run the script with full access.', 'unsafe-action', 'Compounds the risk.'],
    ['Never review; just deny every request ever.', 'weak-planning', 'Denying is fine, but blanket denial without looking can block legitimate work — inspect first.'],
  ], 'Approvals are only useful if you actually read them.'),

  // ── cx-automation
  mcq('cx-automation-1', 'cx-automation', 4, 'A nightly job uses Codex non-interactively to update a dependency. What should gate opening a PR?', [
    '*The full test suite passing.',
    ['The agent\'s message saying it succeeded.', 'poor-verification', 'Use machine-checkable criteria.'],
    ['Nothing; open a PR every night regardless.', 'weak-planning', 'Noise erodes trust in automation.'],
    ['Merging directly to main if the diff is small.', 'unsafe-action', 'Keep human review before merge.'],
  ], 'Automation needs objective gates and human review.'),
  multi('cx-automation-2', 'cx-automation', 4, 'What does programmatic control of a coding agent (e.g. via an SDK) enable? Select all that apply.', [
    '*Starting tasks from your own code and receiving structured events',
    '*Integrating agent runs into pipelines with your own checks',
    '*Logging runs for audit and evaluation',
    ['Skipping code review because runs are automated', 'unsafe-action', 'Automation increases the need for review.'],
  ], 'SDKs let you embed agents in controlled pipelines.'),

  // ── cx-choose
  mcq('cx-choose-1', 'cx-choose', 4, 'Your team wants to choose between Claude Code and Codex. What is the most credible method?', [
    '*Compare both on your real tasks under the same conditions.',
    ['Pick whichever has more social-media buzz this month.', 'poor-verification', 'Popularity is not task fit.'],
    ['Try each on one task and generalise.', 'poor-verification', 'One example is anecdote, not evidence.'],
    ['Pick based on which model scored higher on a public benchmark.', 'bad-assumption', 'Benchmarks may not reflect your codebase, tooling or workflow.'],
  ], 'Evaluate on your own work; decide per task type.'),
  multi('cx-choose-2', 'cx-choose', 4, 'Which factors legitimately affect which coding-agent workflow fits a task? Select all that apply.', [
    '*Whether the task is exploratory or a well-specified batch job',
    '*Required permission and sandboxing controls',
    '*Integration with CI and existing tools',
    ['Whether one vendor is universally superior', 'bad-assumption', 'Universal claims rarely survive contact with specific tasks.'],
  ], 'Task shape, controls, integrations, measured results.'),

  // ── pg-cli
  match('pg-cli-1', 'pg-cli', 1, 'Match each command to what it does.', [
    ['pwd', 'Show the current directory'],
    ['ls', 'List files in the current directory'],
    ['cd src', 'Move into the src folder'],
    ['cat notes.txt', 'Print the contents of notes.txt'],
  ], 'Four commands that let you orient yourself in any project.'),
  mcq('pg-cli-2', 'pg-cli', 2, 'You are in /home/sam/app and run `cd ..`. Where are you now?', [
    '*/home/sam',
    ['/home/sam/app/..', 'syntax', 'The shell resolves .. to the parent directory.'],
    ['/', 'conceptual', '.. goes up one level, not to the root.'],
    ['/home/sam/app (unchanged)', 'conceptual', 'cd .. moves to the parent directory.'],
  ], '".." means the parent directory.'),

  // ── pg-basics
  fill('pg-basics-1', 'pg-basics', 1, 'Fill in the JavaScript keywords.', '[[0]] maxRetries = 3; // value never changes\n[[1]] attempts = 0; // value will change', [['const'], ['let']],
    'Use const by default; let when you reassign.', 'syntax'),
  code('pg-basics-2', 'pg-basics', 1, 'Write `countPassing(scores)` that returns how many scores are 60 or higher.', {
    exports: ['countPassing'],
    starter: `function countPassing(scores) {\n  let passed = 0;\n  // loop over scores\n  return passed;\n}`,
    solution: `function countPassing(scores) {\n  let passed = 0;\n  for (const s of scores) if (s >= 60) passed++;\n  return passed;\n}`,
    tests: [
      ['counts mixed scores', `return m.countPassing([72, 91, 58]) === 2;`],
      ['includes exactly 60', `return m.countPassing([60, 59]) === 1;`],
      ['handles empty list', `return m.countPassing([]) === 0;`],
    ],
  }, 'A loop with a condition and a counter.', 'syntax', ['Use for (const s of scores).', 'Increment passed when s >= 60.']),

  // ── pg-functions-data
  code('pg-functions-data-1', 'pg-functions-data', 2, 'Write `cartTotal(items)` returning the sum of `price * qty` for items where `inStock` is true.', {
    exports: ['cartTotal'],
    starter: `function cartTotal(items) {\n  // filter → map → reduce\n  return 0;\n}`,
    solution: `function cartTotal(items) {\n  return items.filter(i => i.inStock).map(i => i.price * i.qty).reduce((a, b) => a + b, 0);\n}`,
    tests: [
      ['sums in-stock items', `return m.cartTotal([{price:10,qty:2,inStock:true},{price:5,qty:1,inStock:false}]) === 20;`],
      ['empty cart is 0', `return m.cartTotal([]) === 0;`],
      ['multiple items', `return m.cartTotal([{price:1.5,qty:2,inStock:true},{price:2,qty:3,inStock:true}]) === 9;`],
    ],
  }, 'filter keeps in-stock items, map computes line totals, reduce sums them (start at 0 for empty carts).', 'incomplete', ['filter(i => i.inStock)', 'reduce((a, b) => a + b, 0) — note the initial 0.']),
  mcq('pg-functions-data-2', 'pg-functions-data', 2, 'What does `[3, 8, 1].map(x => x * 2)` return?', [
    '*[6,16,2]',
    ['24', 'concept-confusion', 'That would be a reduce that sums doubled values; map returns an array.'],
    ['[3, 8, 1]', 'conceptual', 'map returns a new transformed array.'],
    ['[8]', 'concept-confusion', 'That looks like a filter result.'],
  ], 'map transforms each element and returns a new array of the same length.'),

  // ── pg-errors
  mcq('pg-errors-1', 'pg-errors', 2, '`TypeError: Cannot read properties of undefined (reading "email") at sendWelcome (mail.js:12)`. What is the most likely cause?', [
    '*The object read on line 12 is undefined.',
    ['The email address is invalid.', 'bad-assumption', 'The error is about undefined, not about the email\'s format.'],
    ['The mail server is down.', 'bad-assumption', 'A network outage would produce a different error.'],
    ['JavaScript does not support the word "email".', 'conceptual', 'It is an ordinary property name.'],
  ], 'Read the message and location literally; then find why the value is undefined.'),
  order('pg-errors-2', 'pg-errors', 2, 'Order the debugging loop.', [
    'Reproduce the bug reliably',
    'Read the error message and stack trace',
    'Form a hypothesis about the cause',
    'Test the hypothesis with logs or a minimal example',
    'Fix and verify the bug is gone',
  ], 'Systematic debugging beats guessing — for you and for agents.'),

  // ── pg-json-http
  match('pg-json-http-1', 'pg-json-http', 2, 'Match each HTTP status code to its meaning.', [
    ['200', 'OK — success'],
    ['400', 'Bad request — invalid input'],
    ['401', 'Unauthenticated — missing/invalid credentials'],
    ['429', 'Too many requests — rate limited'],
    ['503', 'Service unavailable — server-side problem'],
  ], '2xx success, 4xx client problem, 5xx server problem.'),
  code('pg-json-http-2', 'pg-json-http', 2, 'Write `safeParse(text)` that returns `{ ok: true, value }` for valid JSON and `{ ok: false, error }` (error is a string message) for invalid JSON.', {
    exports: ['safeParse'],
    starter: `function safeParse(text) {\n  // use try/catch around JSON.parse\n}`,
    solution: `function safeParse(text) {\n  try { return { ok: true, value: JSON.parse(text) }; }\n  catch (e) { return { ok: false, error: String(e && e.message || e) }; }\n}`,
    tests: [
      ['parses valid JSON', `const r = m.safeParse('{"a":1}'); return r.ok === true && r.value.a === 1;`],
      ['rejects invalid JSON', `const r = m.safeParse('{a:1}'); return r.ok === false && typeof r.error === 'string';`],
      ['parses arrays', `const r = m.safeParse('[1,2]'); return r.ok && r.value.length === 2;`],
    ],
  }, 'Model output can be malformed JSON — always parse defensively.', 'syntax', ['Wrap JSON.parse in try { } catch (e) { }.']),

  // ── pg-async
  mcq('pg-async-1', 'pg-async', 3, '`const data = fetchUser(1); console.log(data.name);` logs `undefined`. `fetchUser` is async. What is wrong?', [
    '*Missing `await`: data is a Promise.',
    ['fetchUser returned the wrong user.', 'bad-assumption', 'The value is a Promise; the user has not arrived yet.'],
    ['console.log cannot print objects.', 'conceptual', 'It can; the object is a Promise.'],
    ['The network is too slow.', 'bad-assumption', 'Even a fast network returns a Promise without await.'],
  ], 'Forgetting await is a classic async bug.'),
  code('pg-async-2', 'pg-async', 3, 'Write `withTimeout(promise, ms)` that resolves with the promise\'s value if it settles within `ms` milliseconds, otherwise rejects with an Error whose message is "timeout".', {
    exports: ['withTimeout'],
    starter: `function withTimeout(promise, ms) {\n  // race the promise against a timer\n}`,
    solution: `function withTimeout(promise, ms) {\n  return Promise.race([\n    promise,\n    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),\n  ]);\n}`,
    tests: [
      ['resolves fast promises', `return m.withTimeout(Promise.resolve(5), 50).then(v => v === 5);`],
      ['rejects slow promises', `return m.withTimeout(new Promise(r => setTimeout(() => r(1), 200)), 20).then(() => false, e => e.message === 'timeout');`],
    ],
  }, 'Promise.race lets the first settled promise win — a basic building block for API timeouts.', 'incomplete', ['Promise.race([promise, timer])', 'The timer promise should reject after ms.']),

  // ── pg-git-testing
  mcq('pg-git-testing-1', 'pg-git-testing', 2, 'Why are automated tests especially valuable when working with AI coding agents?', [
    '*They objectively catch regressions.',
    ['They make agents write code faster.', 'bad-assumption', 'They may slow each step slightly; the benefit is reliability.'],
    ['They replace the need to read diffs.', 'poor-verification', 'Tests and review are complementary.'],
    ['They prevent agents from editing files.', 'conceptual', 'Unrelated.'],
  ], 'Tests turn "looks right" into "verified behaviour".'),
  code('pg-git-testing-2', 'pg-git-testing', 2, 'Write a function `applyDiscount(price, pct)` returning the price after a percentage discount, rounded to 2 decimal places. pct is 0–100; values outside that range should throw an Error.', {
    exports: ['applyDiscount'],
    starter: `function applyDiscount(price, pct) {\n  return price;\n}`,
    solution: `function applyDiscount(price, pct) {\n  if (pct < 0 || pct > 100) throw new Error('pct out of range');\n  return Math.round(price * (1 - pct / 100) * 100) / 100;\n}`,
    tests: [
      ['10% off 50', `return m.applyDiscount(50, 10) === 45;`],
      ['rounds to cents', `return m.applyDiscount(19.99, 15) === 16.99;`],
      ['0% is unchanged', `return m.applyDiscount(20, 0) === 20;`],
      ['throws above 100', `try { m.applyDiscount(10, 120); return false; } catch { return true; }`],
    ],
  }, 'Tests specify behaviour, including edge cases and invalid input.', 'incomplete', ['Math.round(x * 100) / 100 rounds to cents.']),

  // ── api-basics
  multi('api-basics-1', 'api-basics', 2, 'Which fields are typically part of a model API request? Select all that apply.', [
    '*The model id',
    '*The messages (conversation turns)',
    '*A maximum number of output tokens',
    ['The model\'s training dataset', 'concept-confusion', 'Training data is not sent with requests.'],
  ], 'Model, messages (+ optional system prompt), output limit.'),
  mcq('api-basics-2', 'api-basics', 2, 'A response has stop reason "max_tokens". What should your code do?', [
    '*Treat it as possibly truncated; don\'t trust it as complete.',
    ['Treat it as a normal complete answer.', 'poor-verification', 'The output was cut off at the limit.'],
    ['Retry the identical request until a different stop reason appears.', 'weak-planning', 'The same limit will usually produce the same truncation.'],
    ['Report that the model refused.', 'concept-confusion', 'A refusal is a different stop reason.'],
  ], 'Always check the stop reason before trusting content.'),

  // ── api-keys
  mcq('api-keys-1', 'api-keys', 2, 'Where should a production web app keep its model API key?', [
    '*On your server, behind your own backend.',
    ['In the frontend JavaScript bundle, minified.', 'unsafe-action', 'Anyone can read a frontend bundle; minification does not hide strings.'],
    ['In a public GitHub repo, so the team can find it.', 'unsafe-action', 'Leaked keys are found and abused quickly.'],
    ['In the model\'s system prompt.', 'unsafe-action', 'Secrets never belong in prompts.'],
  ], 'Keys spend money — keep them server-side behind your own auth and rate limits.'),
  order('api-keys-2', 'api-keys', 2, 'Order the request path for a secure AI feature.', [
    'Browser sends the user\'s request to your backend',
    'Backend checks the user session and rate limits',
    'Backend calls the model API with the server-side key',
    'Backend returns only the needed result to the browser',
  ], 'The key never leaves the server.', 'unsafe-action'),

  // ── api-structured
  mcq('api-structured-1', 'api-structured', 3, 'An invoice extraction returns schema-valid JSON where `total` ≠ the sum of line items. What does this show?', [
    '*Valid shape ≠ correct data; check business rules.',
    ['The schema is wrong.', 'conceptual', 'The schema can be right and the data still wrong.'],
    ['Structured outputs are useless.', 'bad-assumption', 'They prevent malformed output; you still validate semantics.'],
    ['The model refused the task.', 'concept-confusion', 'It answered; the answer is inconsistent.'],
  ], 'Validate shape and meaning.'),
  code('api-structured-2', 'api-structured', 3, 'Write `validateInvoice(inv)` returning an array of error strings (empty if valid). Rules: `number` is a non-empty string; `total` is a number ≥ 0; `lines` is an array; `total` equals the sum of `lines[i].amount` within 0.01. Use the exact messages "number", "total", "lines", "sum".', {
    exports: ['validateInvoice'],
    starter: `function validateInvoice(inv) {\n  const errors = [];\n  return errors;\n}`,
    solution: `function validateInvoice(inv) {\n  const errors = [];\n  if (typeof inv.number !== 'string' || !inv.number) errors.push('number');\n  if (typeof inv.total !== 'number' || inv.total < 0) errors.push('total');\n  if (!Array.isArray(inv.lines)) { errors.push('lines'); return errors; }\n  const sum = inv.lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);\n  if (typeof inv.total === 'number' && Math.abs(sum - inv.total) > 0.01) errors.push('sum');\n  return errors;\n}`,
    tests: [
      ['valid invoice', `return m.validateInvoice({number:'A1', total:30, lines:[{amount:10},{amount:20}]}).length === 0;`],
      ['detects sum mismatch', `return m.validateInvoice({number:'A1', total:31, lines:[{amount:10},{amount:20}]}).includes('sum');`],
      ['detects missing number', `return m.validateInvoice({number:'', total:0, lines:[]}).includes('number');`],
      ['detects negative total', `return m.validateInvoice({number:'B', total:-1, lines:[]}).includes('total');`],
      ['detects non-array lines', `return m.validateInvoice({number:'B', total:0, lines:null}).includes('lines');`],
    ],
  }, 'Business-rule validation catches data errors that schema validation cannot.', 'poor-verification'),

  // ── api-streaming
  mcq('api-streaming-1', 'api-streaming', 3, 'What is a key benefit of streaming model responses?', [
    '*Faster perceived output; avoids long-request timeouts.',
    ['Streaming makes the model cheaper per token.', 'bad-assumption', 'Pricing is the same; the benefit is latency and robustness.'],
    ['Streaming guarantees valid JSON.', 'conceptual', 'You can only validate once the stream completes.'],
    ['Streaming lets you skip checking the stop reason.', 'poor-verification', 'You still check it at the end.'],
  ], 'Perceived latency and long-output robustness.'),
  mcq('api-streaming-2', 'api-streaming', 3, 'You stream a JSON response. When is it safe to act on the data?', [
    '*After the stream completes and is validated.',
    ['As soon as the first field appears.', 'poor-verification', 'Partial data may be incomplete or later contradicted.'],
    ['Halfway through, to save time.', 'poor-verification', 'Same problem.'],
    ['Never — streamed JSON cannot be validated.', 'conceptual', 'It can, once complete.'],
  ], 'Accumulate, complete, validate, then act.'),

  // ── api-resilience
  classify('api-resilience-1', 'api-resilience', 3, 'Should your code retry these errors?', ['Retry with backoff', 'Do not retry — fix the request'], [
    ['429 Too Many Requests', 'Retry with backoff'],
    ['503 Service Unavailable', 'Retry with backoff'],
    ['400 Invalid request: unknown parameter', 'Do not retry — fix the request', 'poor-verification'],
    ['401 Invalid API key', 'Do not retry — fix the request', 'poor-verification'],
    ['Network timeout', 'Retry with backoff'],
  ], 'Transient → retry with backoff; client errors → fix.'),
  code('api-resilience-2', 'api-resilience', 3, 'Write `backoffDelays(n, baseMs)` returning an array of n retry delays using exponential backoff: baseMs, baseMs·2, baseMs·4, … capped at 30000 ms.', {
    exports: ['backoffDelays'],
    starter: `function backoffDelays(n, baseMs) {\n  return [];\n}`,
    solution: `function backoffDelays(n, baseMs) {\n  return Array.from({ length: n }, (_, i) => Math.min(30000, baseMs * 2 ** i));\n}`,
    tests: [
      ['doubles each time', `return JSON.stringify(m.backoffDelays(4, 500)) === JSON.stringify([500,1000,2000,4000]);`],
      ['caps at 30000', `const d = m.backoffDelays(8, 1000); return d[d.length-1] === 30000 && d[5] === 30000;`],
      ['zero retries', `return m.backoffDelays(0, 500).length === 0;`],
    ],
  }, 'Real systems add random jitter and honour retry-after headers on top of this.', 'incomplete'),

  // ── api-cost
  fill('api-cost-1', 'api-cost', 3, 'A request uses 20,000 input tokens and 1,000 output tokens. Input costs $3 per million tokens and output $15 per million (illustrative prices). What does it cost?',
    'Cost = $[[0]]', [['0.075', '.075', '0.0750']],
    '20,000 × $3/1M = $0.06; 1,000 × $15/1M = $0.015; total $0.075.', 'conceptual'),
  multi('api-cost-2', 'api-cost', 3, 'Which are sound fallback behaviours when a model call fails after retries? Select all that apply.', [
    '*Try an alternative configured model',
    '*Return a graceful error explaining the feature is temporarily unavailable',
    '*Serve a cached result if one is still valid',
    ['Return a made-up answer so the UI looks normal', 'unsafe-action', 'Fabricated output destroys trust.'],
  ], 'Fail gracefully and honestly.'),
];

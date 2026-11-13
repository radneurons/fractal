// Items supporting the fourth wave of full lessons (part B).
import type { Item } from '@/core/types';
import { classify, code, fill, mcq, multi, order } from './helpers';

export const EXPANSION3B_ITEMS: Item[] = [
  // ── r-memory
  mcq('r-memory-3', 'r-memory', 3, 'A user says "I moved to Berlin" — but memory still says "lives in Lisbon". What should a well-designed memory system do?', [
    '*Update the fact and keep its date.',
    ['Keep both facts and let the model guess which one is currently true.', 'state-mgmt', 'Conflicting memories produce inconsistent answers.'],
    ['Ignore the new statement, since stored memories should never change.', 'state-mgmt', 'Memory must handle change.'],
    ['Delete all memories about the user to avoid any possible conflict.', 'weak-planning', 'Over-correction loses useful information.'],
  ], 'Memories need updates, timestamps and a rule for resolving conflicts.'),
  classify('r-memory-4', 'r-memory', 3, 'Should an assistant save this to long-term memory?', ['Save (with consent)', 'Do not save'], [
    ['"I prefer answers with code examples"', 'Save (with consent)'],
    ['A one-off typo in yesterday\'s question', 'Do not save', 'state-mgmt'],
    ['"My timezone is UTC+2"', 'Save (with consent)'],
    ['The user\'s password, pasted by mistake', 'Do not save', 'unsafe-action'],
    ['The full raw transcript of every session', 'Do not save', 'unsafe-action'],
  ], 'Save durable, useful facts the user would expect remembered — never secrets, and not everything.'),

  // ── r-eval
  code('r-eval-3', 'r-eval', 4, 'Write `mrr(ranks)` where `ranks` holds the 1-based rank of the first relevant chunk for each question, or `null` if none was retrieved. Return the mean reciprocal rank (1/rank, with 0 for null).', {
    exports: ['mrr'],
    starter: `function mrr(ranks) {\n  return 0;\n}`,
    solution: `function mrr(ranks) {\n  if (!ranks.length) return 0;\n  return ranks.reduce((s, r) => s + (r ? 1 / r : 0), 0) / ranks.length;\n}`,
    tests: [
      ['basic', `return Math.abs(m.mrr([1, 2, null, 4]) - (1 + 0.5 + 0 + 0.25) / 4) < 1e-9;`],
      ['all first', `return m.mrr([1, 1, 1]) === 1;`],
      ['empty', `return m.mrr([]) === 0;`],
    ],
  }, 'MRR rewards putting the relevant chunk near the top.', 'incomplete'),
  mcq('r-eval-4', 'r-eval', 4, 'Why evaluate retrieval separately from answer quality?', [
    '*To know which stage to fix.',
    ['Because answer quality cannot be measured at all in a RAG system.', 'conceptual', 'It can — separately.'],
    ['Because retrieval scores are always higher, which looks better in reports.', 'bad-assumption', 'The goal is diagnosis, not flattering numbers.'],
    ['Because retrieval quality has no effect at all on the final answers.', 'conceptual', 'It sets a ceiling on them.'],
  ], 'If the right chunk was never retrieved, no prompt fix will help. Separate metrics point to the broken stage.'),

  // ── ar-delegation
  order('ar-delegation-3', 'ar-delegation', 4, 'Order an orchestrator-worker run.', [
    'The lead agent plans and splits the task',
    'Each worker receives a spec: objective, boundaries, output format',
    'Workers run with focused context and limited tools',
    'The lead verifies each worker\'s output',
    'The lead synthesises the final result',
  ], 'Plan → specify → execute in isolation → verify → synthesise.'),
  mcq('ar-delegation-4', 'ar-delegation', 4, 'Two workers return conflicting facts. What should the lead agent do?', [
    '*Check the sources, or flag the conflict.',
    ['Pick whichever answer sounds more confident and use it in the report.', 'poor-verification', 'Confidence is not evidence.'],
    ['Average the two answers together into a single compromise figure.', 'bad-assumption', 'Averaging contradictory facts invents a third.'],
    ['Discard both answers silently and leave that section of the report out.', 'incomplete', 'The conflict itself is important information.'],
  ], 'Delegation needs an integration step that verifies and surfaces disagreement.'),

  // ── ar-parallel
  classify('ar-parallel-3', 'ar-parallel', 4, 'Can these two tasks safely run at the same time?', ['Safe in parallel', 'Needs coordination'], [
    ['Summarise file A and summarise file B', 'Safe in parallel'],
    ['Two agents editing the same config file', 'Needs coordination', 'state-mgmt'],
    ['Fetch prices from three different suppliers', 'Safe in parallel'],
    ['Two workers both sending "welcome" to the same new user', 'Needs coordination', 'state-mgmt'],
    ['Run unit tests and lint the code', 'Safe in parallel'],
  ], 'Independent reads parallelise; shared writes and side effects need locks, ownership or idempotency.'),
  mcq('ar-parallel-4', 'ar-parallel', 4, 'You go from 3 parallel agents to 10, but the job finishes no faster. Why?', [
    '*The critical path limits total time.',
    ['Parallel agents always slow each other down by sharing one model.', 'bad-assumption', 'They need not; the dependency chain is the limit here.'],
    ['Ten agents is above the maximum that any provider allows to run.', 'conceptual', 'Not the reason.'],
    ['The extra agents must be broken, because more agents always means faster.', 'bad-assumption', 'Dependencies cap speed-up.'],
  ], 'Tasks that depend on each other cannot overlap; the longest chain sets the floor.'),

  // ── ar-state
  code('ar-state-3', 'ar-state', 4, 'Write `resume(steps, done)` where `steps` is an array of step names and `done` an array of completed names. Return the steps still to run, in order.', {
    exports: ['resume'],
    starter: `function resume(steps, done) {\n  return steps;\n}`,
    solution: `function resume(steps, done) {\n  const d = new Set(done);\n  return steps.filter((s) => !d.has(s));\n}`,
    tests: [
      ['skips completed', `return JSON.stringify(m.resume(['validate','reserve','charge','ship'], ['validate','reserve'])) === '["charge","ship"]';`],
      ['nothing done', `return m.resume(['a','b'], []).length === 2;`],
      ['all done', `return m.resume(['a','b'], ['a','b']).length === 0;`],
    ],
  }, 'Resuming from checkpoints means skipping completed steps — never repeating their side effects.', 'state-mgmt'),
  mcq('ar-state-4', 'ar-state', 4, 'What does an idempotency key on a "send invoice" step guarantee?', [
    '*A retry is recognised, so it is sent once.',
    ['That the invoice is guaranteed to arrive faster at the recipient.', 'conceptual', 'Speed is unrelated.'],
    ['That the invoice content has been validated as correct.', 'concept-confusion', 'Idempotency is not validation.'],
    ['That the step can never fail under any circumstances.', 'bad-assumption', 'It can fail; retries just become safe.'],
  ], 'Idempotency makes retries safe for operations with side effects.'),

  // ── ev-datasets
  multi('ev-datasets-3', 'ev-datasets', 3, 'Good sources of eval cases include… Select all that apply.', [
    '*Anonymised real user inputs',
    '*Bugs reported in production',
    '*Deliberately tricky edge cases',
    ['Only examples the current prompt already handles well', 'poor-verification', 'An eval of easy cases cannot reveal weaknesses.'],
  ], 'Real inputs, real failures and deliberate edge cases.'),
  mcq('ev-datasets-4', 'ev-datasets', 3, 'A production bug is fixed. What should happen to the eval set?', [
    '*Add the bug as a new test case.',
    ['Nothing — the bug has been fixed, so it no longer needs to be tested.', 'poor-verification', 'Without a case it can silently return.'],
    ['Delete similar cases, since they are now known to work correctly.', 'poor-verification', 'You would lose regression coverage.'],
    ['Replace the whole eval set with cases about this particular bug.', 'weak-planning', 'Keep breadth; add the new case.'],
  ], 'Every fixed failure becomes a regression test.'),

  // ── ev-graders
  mcq('ev-graders-3', 'ev-graders', 3, 'Which criterion is best checked by deterministic code rather than a model grader?', [
    '*"The output is valid JSON with these fields."',
    ['"The summary captures the author\'s main argument faithfully."', 'wrong-tool', 'This needs judgement — a rubric or a human.'],
    ['"The tone is friendly but professional for a customer audience."', 'wrong-tool', 'This is subjective.'],
    ['"The explanation would make sense to a complete beginner."', 'wrong-tool', 'This requires judgement.'],
  ], 'Use code wherever the criterion is objective; save model graders for judgement.'),
  order('ev-graders-4', 'ev-graders', 4, 'Order the steps to set up a trustworthy model-based grader.', [
    'Write a specific rubric with clear pass/fail definitions',
    'Have humans label a sample of outputs',
    'Run the model grader on the same sample',
    'Measure agreement with the human labels',
    'Refine the rubric where they disagree',
  ], 'Model graders are calibrated against humans before they are trusted.', 'poor-verification'),

  // ── ev-traces
  classify('ev-traces-3', 'ev-traces', 4, 'Categorise each failed agent run.', ['Wrong tool', 'Bad arguments', 'Loop / no stop'], [
    ['Called search_web for an internal policy question', 'Wrong tool'],
    ['get_order called with order_id "latest"', 'Bad arguments', 'state-mgmt'],
    ['Same search repeated 12 times until the step cap', 'Loop / no stop', 'state-mgmt'],
    ['Calculator called with "seventeen percent of revenue"', 'Bad arguments'],
    ['Used send_email when asked only to draft a reply', 'Wrong tool'],
  ], 'Categorising failures turns individual traces into a prioritised fix list.'),
  mcq('ev-traces-4', 'ev-traces', 4, 'When reading a failed trace, where should you focus first?', [
    '*The first step that went wrong.',
    ['The final answer, since that is the part the user actually saw.', 'poor-verification', 'The final answer is usually a consequence.'],
    ['The longest step, since long steps are the most likely to be wrong.', 'bad-assumption', 'Length is not the signal.'],
    ['The model\'s confidence, since low confidence marks the error.', 'bad-assumption', 'Traces show actions; find the first wrong one.'],
  ], 'Later errors often cascade from the first one.'),

  // ── sec-secrets
  classify('sec-secrets-3', 'sec-secrets', 2, 'Is this a safe place for an API key?', ['Safe', 'Unsafe'], [
    ['An environment variable on the server', 'Safe'],
    ['A secrets manager with access controls', 'Safe'],
    ['A comment in the source code', 'Unsafe', 'unsafe-action'],
    ['A message to a coding agent', 'Unsafe', 'unsafe-action'],
    ['A screenshot attached to a bug ticket', 'Unsafe', 'unsafe-action'],
  ], 'Secrets live in secure storage and are injected at runtime — never in code, prompts or tickets.'),
  mcq('sec-secrets-4', 'sec-secrets', 3, 'A coding agent asks to read `.env` to "understand the configuration". What is best?', [
    '*Deny it; share a redacted example instead.',
    ['Allow it, since the agent is only reading the file and not editing it.', 'unsafe-action', 'Reading puts secrets into context, logs and possibly elsewhere.'],
    ['Allow it, and then ask the agent to forget the secrets afterwards.', 'bad-assumption', 'It cannot un-see them; they are already in context.'],
    ['Paste the real values into the chat, so that the agent can see them.', 'unsafe-action', 'Same problem, worse.'],
  ], 'Agents need the shape of config, not the secrets. Use .env.example and deny rules.'),

  // ── sec-sandbox
  classify('sec-sandbox-3', 'sec-sandbox', 3, 'Which environment fits running model-written code?', ['Appropriate sandbox', 'Too risky'], [
    ['A disposable container with no network and CPU/time limits', 'Appropriate sandbox'],
    ['Your laptop with all your accounts signed in', 'Too risky', 'unsafe-action'],
    ['A browser Web Worker with network APIs removed', 'Appropriate sandbox'],
    ['The production server', 'Too risky', 'unsafe-action'],
    ['A VM snapshot that is thrown away after each run', 'Appropriate sandbox'],
  ], 'Isolation, limits and disposability — matched to the risk.'),
  mcq('sec-sandbox-4', 'sec-sandbox', 3, 'Why does a sandbox need a time limit?', [
    '*Infinite loops would otherwise run forever.',
    ['Because time limits make the code inside the sandbox run faster.', 'conceptual', 'They stop runaway code; they do not speed it up.'],
    ['Because sandboxes are unable to run any code for more than one second.', 'conceptual', 'The limit is a choice, not a technical maximum.'],
    ['It is not needed, as long as the network has been disabled.', 'unsafe-action', 'No network does not stop runaway CPU use.'],
  ], 'Resource limits (time, CPU, memory) are as important as network isolation.'),

  // ── sec-confirm
  order('sec-confirm-3', 'sec-confirm', 3, 'Order a good confirmation flow for a high-impact action.', [
    'The agent prepares the exact action and parameters',
    'The UI shows a specific summary: what, to whom, how much',
    'The user approves, edits or cancels',
    'The action runs only after approval',
    'The decision and result are written to an audit log',
  ], 'Specific, informed, logged.', 'unsafe-action'),
  mcq('sec-confirm-4', 'sec-confirm', 3, 'Users approve every confirmation without reading it. What is the best fix?', [
    '*Confirm fewer, higher-stakes actions, specifically.',
    ['Add even more confirmation steps so that users are forced to slow down.', 'weak-planning', 'More prompts deepen approval fatigue.'],
    ['Remove all confirmations, since users are not reading them anyway.', 'unsafe-action', 'You lose the control entirely.'],
    ['Make each confirmation dialog longer, with more detailed legal wording.', 'weak-planning', 'Longer text is read less.'],
  ], 'Reserve confirmation for what matters and make each one easy to judge.'),

  // ── pr-mvp
  multi('pr-mvp-3', 'pr-mvp', 3, 'What belongs in an AI MVP? Select all that apply.', [
    '*The core AI task for a narrow, real use case',
    '*A human in the loop to catch errors',
    '*Instrumentation to measure whether users value it',
    ['Every feature in the long-term roadmap', 'weak-planning', 'That is not minimal.'],
  ], 'Small, real, supervised and measured.'),
  mcq('pr-mvp-4', 'pr-mvp', 3, 'Before launching the MVP, what should you decide?', [
    '*What result means continue, change or stop.',
    ['Which logo and colour scheme the full product will use at launch.', 'weak-planning', 'Not the point of an MVP.'],
    ['How to scale the system to millions of users from day one.', 'weak-planning', 'Premature before value is proven.'],
    ['Nothing — decide what the results mean once they come in.', 'poor-verification', 'Deciding afterwards invites rationalising.'],
  ], 'Pre-commit to decision criteria so the MVP actually informs a decision.'),

  // ── pr-monitoring
  classify('pr-monitoring-3', 'pr-monitoring', 4, 'What kind of signal is each?', ['Quality signal', 'Operational signal', 'Cost signal'], [
    ['Rate of thumbs-down on answers', 'Quality signal'],
    ['p95 latency', 'Operational signal'],
    ['Spend per feature per day', 'Cost signal'],
    ['Share of answers escalated to a human', 'Quality signal'],
    ['Error and refusal rates', 'Operational signal'],
  ], 'Monitor all three — quality, operations and cost — and watch them after every change.'),
  mcq('pr-monitoring-4', 'pr-monitoring', 4, 'After a model upgrade, thumbs-down rises from 1.1% to 2.4%. What should you do first?', [
    '*Sample and label the new failures.',
    ['Nothing — a change of about one percentage point is just random noise.', 'poor-verification', 'A doubling deserves investigation.'],
    ['Immediately switch to a different provider before investigating.', 'weak-planning', 'Diagnose first.'],
    ['Remove the thumbs-down button so the metric stops getting worse.', 'unsafe-action', 'That hides the problem.'],
  ], 'Investigate what changed; consider rolling back while you diagnose.'),

  // ── pro-durable
  order('pro-durable-3', 'pro-durable', 4, 'Order the lifecycle of a background AI job.', [
    'The API accepts the request and returns a job id',
    'The job is placed on a queue',
    'A worker processes it, retrying transient failures',
    'The result and status are stored',
    'The user is notified or polls for the status',
  ], 'Accept fast, process reliably, report status.'),
  mcq('pro-durable-4', 'pro-durable', 4, 'What is a dead-letter queue for?', [
    '*Jobs that failed every retry, kept for inspection.',
    ['Storing jobs that were completed successfully, for later reporting.', 'concept-confusion', 'Completed jobs go to results.'],
    ['Deleting old jobs automatically after a certain amount of time.', 'concept-confusion', 'It retains failures; it does not delete them.'],
    ['Running jobs faster by skipping all of their retry attempts.', 'conceptual', 'It is for failures, not speed.'],
  ], 'Failures are kept visible so a person can inspect, fix and replay them.'),

  // ── pro-cicd
  fill('pro-cicd-3', 'pro-cicd', 4, 'CI runs the eval on a prompt change. The gate requires at least 97% field accuracy.', 'The new prompt scores 96.4%, so the build [[0]]. The previous prompt scored 97.8%, so this change is a [[1]].', [['fails', 'failed', 'fail'], ['regression']],
    'Below the threshold → the gate fails; a drop from baseline is a regression.', 'poor-verification'),
  mcq('pro-cicd-4', 'pro-cicd', 4, 'Why roll out a new prompt or model gradually (canary)?', [
    '*To limit the impact and compare metrics.',
    ['Because providers only allow new model versions to reach a few users.', 'conceptual', 'It is your choice, not a provider rule.'],
    ['To make the deployment process finish faster than a full rollout.', 'bad-assumption', 'It is slower — on purpose.'],
    ['Gradual rollouts are only needed for changes to the user interface.', 'concept-confusion', 'They matter at least as much for model behaviour.'],
  ], 'Expose a small share of traffic, compare against the current version, then expand or roll back.'),

  // ── fr-computer-use
  classify('fr-computer-use-3', 'fr-computer-use', 5, 'Should a computer-use agent do this without asking first?', ['Can proceed', 'Confirm first'], [
    ['Scroll a page to find a price', 'Can proceed'],
    ['Submit a payment form', 'Confirm first'],
    ['Read a table on a public website', 'Can proceed'],
    ['Delete files in a shared folder', 'Confirm first'],
    ['Accept a site\'s terms of service', 'Confirm first'],
  ], 'Looking is fine; acting with consequences needs approval.'),
  mcq('fr-computer-use-4', 'fr-computer-use', 5, 'Why are computer-use agents especially exposed to prompt injection?', [
    '*They read untrusted screens, then act.',
    ['Because screenshots are always processed without any safety checks.', 'conceptual', 'The issue is untrusted content plus the power to act.'],
    ['Because they are only able to run on operating systems without security.', 'conceptual', 'Not the reason.'],
    ['They are not exposed, since they only look at pixels rather than text.', 'bad-assumption', 'Text on screen is read and can steer them.'],
  ], 'Any visible text — a web page, an email — can carry instructions. Isolate, limit and confirm.'),

  // ── fr-research
  order('fr-research-3', 'fr-research', 5, 'Order a disciplined research-agent workflow.', [
    'Clarify the question and what a good answer needs',
    'Plan searches and gather candidate sources',
    'Evaluate source quality and extract claims with citations',
    'Synthesise, noting disagreement and gaps',
    'Verify that every claim maps to a cited source',
  ], 'Scope → gather → evaluate → synthesise → verify.'),
  mcq('fr-research-4', 'fr-research', 5, 'Two sources disagree on a key figure. What should the report do?', [
    '*Show both, with sources, and say which is stronger.',
    ['Pick the larger figure, since it makes the report sound more striking.', 'bad-assumption', 'Picking for effect is misleading.'],
    ['Leave the figure out, so the report never has to mention the conflict.', 'incomplete', 'Hiding disagreement misleads readers.'],
    ['Average the two figures and present the result as a confirmed fact.', 'bad-assumption', 'That invents a number neither source supports.'],
  ], 'Good research surfaces disagreement and the evidence on each side.'),

  // ── fr-standards
  classify('fr-standards-3', 'fr-standards', 4, 'Is this a reliable source for the current state of an agent standard?', ['Primary / reliable', 'Secondary / check'], [
    ['The specification\'s official website and changelog', 'Primary / reliable'],
    ['A social-media thread summarising the spec', 'Secondary / check', 'poor-verification'],
    ['The release notes of the host you will run on', 'Primary / reliable'],
    ['A model\'s recollection of the spec', 'Secondary / check', 'poor-verification'],
    ['The official SDK\'s repository', 'Primary / reliable'],
  ], 'Specs, SDKs and host release notes are primary; summaries and memories need checking.'),
  mcq('fr-standards-4', 'fr-standards', 4, 'Why keep an adapter layer between your code and an emerging protocol?', [
    '*So a spec change is a contained fix.',
    ['Because adapters make every protocol message noticeably faster.', 'conceptual', 'The benefit is isolation from change.'],
    ['Because emerging protocols forbid applications from calling them directly.', 'conceptual', 'They do not.'],
    ['It is unnecessary, since standards never change once they are published.', 'bad-assumption', 'Emerging standards change often.'],
  ], 'Isolate fast-moving dependencies behind one interface you own.'),
];

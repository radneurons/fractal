// Items supporting the fourth wave of full lessons (part A).
import type { Item } from '@/core/types';
import { classify, code, fill, mcq, multi, order } from './helpers';

export const EXPANSION3A_ITEMS: Item[] = [
  // ── f-responsible
  classify('f-responsible-3', 'f-responsible', 1, 'Is it reasonable to paste this into a general-purpose AI chat tool without special approval?', ['Generally fine', 'Check policy / remove first'], [
    ['A paragraph from your own blog post', 'Generally fine'],
    ['A spreadsheet of patients\' names and diagnoses', 'Check policy / remove first', 'unsafe-action'],
    ['Publicly available product documentation', 'Generally fine'],
    ['A config file containing a database password', 'Check policy / remove first', 'unsafe-action'],
    ['Your company\'s unreleased financial results', 'Check policy / remove first', 'unsafe-action'],
  ], 'Public or personal low-risk text is usually fine; personal, regulated, confidential or secret data needs policy checks and minimisation first.'),
  mcq('f-responsible-4', 'f-responsible', 2, 'An AI tool helped write a report your team will publish. What is the responsible approach?', [
    '*A person verifies it and owns the result.',
    ['Publish it unchanged, because the AI tool already checked its own facts.', 'poor-verification', 'Models do not reliably check their own facts.'],
    ['Publish it, and add a note blaming the tool if any errors are found later.', 'unsafe-action', 'Accountability stays with the people who publish.'],
    ['Avoid mentioning AI anywhere, so readers judge it purely on its content.', 'bad-assumption', 'Where others rely on it, transparency about AI use matters.'],
  ], 'AI can draft; a person verifies and remains accountable — and is transparent where it matters.'),

  // ── c-capabilities
  classify('c-capabilities-3', 'c-capabilities', 1, 'What can a Claude model do on its own, and what needs a tool or integration?', ['Model alone', 'Needs a tool / integration'], [
    ['Summarise a PDF you attached', 'Model alone'],
    ['Check today\'s weather', 'Needs a tool / integration'],
    ['Rewrite an email in a friendlier tone', 'Model alone'],
    ['Create a ticket in your issue tracker', 'Needs a tool / integration'],
    ['Remember your preferences in a brand-new conversation', 'Needs a tool / integration'],
  ], 'Live data, actions in other systems and cross-conversation memory come from tools and product features, not from the model itself.'),
  mcq('c-capabilities-4', 'c-capabilities', 2, 'You need Claude to answer questions about 300 pages of internal documents. What is the most reliable setup?', [
    '*Provide the relevant documents and ask for quotes.',
    ['Ask Claude from memory, since it was trained on most of the internet.', 'bad-assumption', 'Internal documents are not in its training data.'],
    ['Describe the documents briefly from memory and ask Claude to infer the rest.', 'context-omission', 'Your summary is not the documents; details will be invented.'],
    ['Paste only the table of contents, so the conversation stays short.', 'context-omission', 'Headings do not contain the answers.'],
  ], 'Claude works best on material you give it — documents in context (or retrieved), with quotes for verification.'),

  // ── c-models
  multi('c-models-3', 'c-models', 2, 'Which are good reasons to choose a larger, more capable model? Select all that apply.', [
    '*Multi-step reasoning or agentic coding where errors are costly',
    '*Your eval shows the smaller model misses your quality bar',
    ['It is the newest model, so it must be best for every task', 'bad-assumption', 'Measure on your task.'],
    ['You want to classify millions of short messages cheaply', 'wrong-tool', 'High-volume easy tasks often suit smaller models.'],
  ], 'Pay for capability where your measurements say you need it.'),
  fill('c-models-4', 'c-models', 3, 'Illustrative prices: model S costs $1 per million input tokens, model L costs $5. A task uses 2,000 input tokens per request at 100,000 requests a day (ignore output).', 'Model S costs $[[0]] per day; model L costs $[[1]] per day.', [['200', '200.00'], ['1000', '1,000', '1000.00']],
    '2,000 × 100,000 = 200 M tokens. 200 × $1 = $200; 200 × $5 = $1,000.', 'conceptual'),

  // ── cx-automation
  order('cx-automation-3', 'cx-automation', 4, 'Order a controlled, scripted Codex run in CI.', [
    'Check out a fresh branch in a disposable environment',
    'Run the agent non-interactively with a narrow sandbox and a clear task',
    'Run the test suite and linters',
    'Open a draft pull request only if checks pass',
    'Record the run log for audit',
  ], 'Isolate, constrain, verify, propose, record.', 'unsafe-action'),
  mcq('cx-automation-4', 'cx-automation', 4, 'Why log every automated coding-agent run?', [
    '*To audit and evaluate what it did.',
    ['Because the provider requires a log before it will accept the next request.', 'conceptual', 'Logging is for you, not the provider.'],
    ['Because logs make the agent produce better code on its next attempt.', 'bad-assumption', 'Logs do not change the model.'],
    ['Logs are unnecessary once tests pass, so they can be safely skipped.', 'poor-verification', 'Passing tests do not tell you what else the run did.'],
  ], 'Logs let you reconstruct actions, debug failures and build an evaluation history.'),

  // ── cx-choose
  classify('cx-choose-3', 'cx-choose', 4, 'Classify each statement about comparing coding agents.', ['Sound practice', 'Misleading'], [
    ['Run both on the same real tickets with the same instructions', 'Sound practice'],
    ['Declare a winner after one impressive demo', 'Misleading', 'poor-verification'],
    ['Measure tests passed, diff size and reviewer time', 'Sound practice'],
    ['Assume a public benchmark predicts results on your codebase', 'Misleading', 'bad-assumption'],
    ['Re-run the comparison after major tool updates', 'Sound practice'],
  ], 'Fair comparisons use your own tasks, the same conditions and repeated measurement.'),
  mcq('cx-choose-4', 'cx-choose', 4, 'Your trial shows Tool A is better at exploratory debugging and Tool B at batch refactors. What is the sensible conclusion?', [
    '*Choose per task type, and re-check later.',
    ['Pick whichever won more trials overall and use it for absolutely everything.', 'weak-planning', 'You would discard the per-task evidence you gathered.'],
    ['The trial must be flawed, since one tool is normally better at everything.', 'bad-assumption', 'Different strengths are common.'],
    ['Stop using coding agents, because the results were not consistent enough.', 'weak-planning', 'Mixed results are information, not failure.'],
  ], 'Workflow choice can be per task — and both tools change, so revisit.'),

  // ── pg-basics
  mcq('pg-basics-3', 'pg-basics', 1, 'What does this print?\n```\nconst x = 7;\nif (x > 10) { console.log("big"); } else { console.log("small"); }\n```', [
    '*small',
    ['big', 'conceptual', '7 is not greater than 10, so the else branch runs.'],
    ['Nothing, because x is declared with const and cannot be compared.', 'concept-confusion', 'const means the variable cannot be reassigned; it can still be read.'],
    ['An error, because if statements require a semicolon after the condition.', 'syntax', 'The code is valid JavaScript.'],
  ], 'The condition is false, so the else branch runs.'),
  code('pg-basics-4', 'pg-basics', 2, 'Write `grade(score)` returning "A" for 90 and above, "B" for 75–89, "C" for 60–74 and "F" below 60.', {
    exports: ['grade'],
    starter: `function grade(score) {\n  return 'F';\n}`,
    solution: `function grade(score) {\n  if (score >= 90) return 'A';\n  if (score >= 75) return 'B';\n  if (score >= 60) return 'C';\n  return 'F';\n}`,
    tests: [
      ['90 is A', `return m.grade(90) === 'A';`],
      ['89 is B', `return m.grade(89) === 'B';`],
      ['60 is C', `return m.grade(60) === 'C';`],
      ['59 is F', `return m.grade(59) === 'F';`],
    ],
  }, 'Check the highest threshold first and return early.', 'conceptual', ['Order the checks from the highest grade down.']),

  // ── pg-functions-data
  mcq('pg-functions-data-3', 'pg-functions-data', 2, 'What does `[4, 9, 2, 7].filter(n => n > 5)` return?', [
    '*[9, 7]',
    ['[4, 2]', 'concept-confusion', 'filter keeps items where the condition is true.'],
    ['16', 'concept-confusion', 'That would be a reduce summing the kept numbers.'],
    ['true', 'conceptual', 'filter returns an array, not a boolean.'],
  ], 'filter returns a new array with the items that pass the test.'),
  code('pg-functions-data-4', 'pg-functions-data', 2, 'Write `countByStatus(tickets)` returning an object counting tickets per `status`, e.g. `{open: 2, closed: 1}`.', {
    exports: ['countByStatus'],
    starter: `function countByStatus(tickets) {\n  return {};\n}`,
    solution: `function countByStatus(tickets) {\n  return tickets.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});\n}`,
    tests: [
      ['counts statuses', `const r = m.countByStatus([{status:'open'},{status:'closed'},{status:'open'}]); return r.open === 2 && r.closed === 1;`],
      ['empty list', `return Object.keys(m.countByStatus([])).length === 0;`],
    ],
  }, 'reduce with an object accumulator is the standard way to count.', 'incomplete', ['Start reduce with {}.', 'acc[key] = (acc[key] || 0) + 1']),

  // ── pg-errors
  code('pg-errors-3', 'pg-errors', 2, 'Write `parseAge(input)` that returns the age as a number, or throws an Error with message "invalid age" if the input is not a whole number from 0 to 150.', {
    exports: ['parseAge'],
    starter: `function parseAge(input) {\n  return Number(input);\n}`,
    solution: `function parseAge(input) {\n  const n = Number(input);\n  if (!Number.isInteger(n) || n < 0 || n > 150 || String(input).trim() === '') throw new Error('invalid age');\n  return n;\n}`,
    tests: [
      ['parses valid', `return m.parseAge('42') === 42;`],
      ['rejects text', `try { m.parseAge('abc'); return false; } catch (e) { return e.message === 'invalid age'; }`],
      ['rejects negative', `try { m.parseAge('-1'); return false; } catch (e) { return e.message === 'invalid age'; }`],
      ['rejects decimals', `try { m.parseAge('3.5'); return false; } catch (e) { return e.message === 'invalid age'; }`],
      ['rejects empty', `try { m.parseAge(''); return false; } catch (e) { return e.message === 'invalid age'; }`],
    ],
  }, 'Validate early and throw a clear error; callers decide how to handle it.', 'incomplete'),
  mcq('pg-errors-4', 'pg-errors', 2, 'Which way of handling an error is worst?', [
    '*`catch (e) {}` — silently ignoring it.',
    ['Catching it and showing the user a clear message about what went wrong.', 'poor-verification', 'This is a good way to handle an expected error.'],
    ['Catching it, logging the details, and retrying once if it was transient.', 'poor-verification', 'A reasonable strategy for transient errors.'],
    ['Letting it propagate to a caller that knows how to handle that failure.', 'poor-verification', 'Often exactly right.'],
  ], 'Swallowed errors hide bugs and corrupt data silently.'),

  // ── pg-async
  fill('pg-async-3', 'pg-async', 3, 'Two independent API calls each take about 1 second.', 'Awaiting them one after another takes about [[0]] seconds; with Promise.all it takes about [[1]] second(s).', [['2', 'two'], ['1', 'one']],
    'Sequential awaits add up; Promise.all runs independent calls concurrently.', 'conceptual'),
  code('pg-async-4', 'pg-async', 3, 'Write `async function fetchAll(ids, fetchOne)` that calls `fetchOne(id)` for every id **in parallel** and returns the results in the same order.', {
    exports: ['fetchAll'],
    starter: `async function fetchAll(ids, fetchOne) {\n  const out = [];\n  for (const id of ids) out.push(await fetchOne(id));\n  return out;\n}`,
    solution: `async function fetchAll(ids, fetchOne) {\n  return Promise.all(ids.map((id) => fetchOne(id)));\n}`,
    tests: [
      ['keeps order', `return m.fetchAll([1,2,3], async (x) => x * 10).then(r => JSON.stringify(r) === '[10,20,30]');`],
      ['runs in parallel', `const t = Date.now(); return m.fetchAll([1,2,3,4], (x) => new Promise(r => setTimeout(() => r(x), 150))).then(() => Date.now() - t < 400);`],
    ],
  }, 'Promise.all over mapped calls runs them concurrently and preserves order.', 'incomplete', ['Use ids.map to start every call first.', 'Then await Promise.all(...).']),

  // ── pg-git-testing
  order('pg-git-testing-3', 'pg-git-testing', 2, 'Order a safe Git workflow for one change.', [
    'Create a branch',
    'Make the change',
    'Run the tests',
    'Review `git diff`',
    'Stage and commit with a clear message',
  ], 'Branch → change → test → review → commit.'),
  mcq('pg-git-testing-4', 'pg-git-testing', 2, 'What makes a test useful?', [
    '*It fails when the behaviour it checks breaks.',
    ['It always passes, so the build pipeline stays green and the team stays happy.', 'poor-verification', 'A test that cannot fail checks nothing.'],
    ['It is as long as possible, so that it covers many unrelated behaviours at once.', 'weak-planning', 'Focused tests make failures easy to diagnose.'],
    ['It prints a lot of output, so that readers can see what the code is doing.', 'conceptual', 'Output is not an assertion.'],
  ], 'A good test asserts specific behaviour and fails when that behaviour regresses.'),

  // ── api-keys
  classify('api-keys-3', 'api-keys', 2, 'Where does each belong in a web app that calls a model API?', ['Server only', 'Fine in the browser'], [
    ['The provider API key', 'Server only', 'unsafe-action'],
    ['The user\'s question text', 'Fine in the browser'],
    ['Per-user rate-limit counters', 'Server only'],
    ['The rendered answer', 'Fine in the browser'],
    ['The billing account id', 'Server only', 'unsafe-action'],
  ], 'Secrets and enforcement live on the server; user content and results travel to the browser.'),
  mcq('api-keys-4', 'api-keys', 2, 'Why add your own authentication and rate limits to a backend proxy?', [
    '*Otherwise anyone can spend your key.',
    ['Because providers refuse requests that do not come through a proxy server.', 'bad-assumption', 'They do not; the proxy protects you.'],
    ['Because rate limits make every model response more accurate and complete.', 'conceptual', 'Rate limits control usage, not accuracy.'],
    ['It is optional, since keys kept on a server can never be misused by anyone.', 'unsafe-action', 'An open proxy is as exposed as a leaked key.'],
  ], 'A server-side key is only safe if the proxy in front of it is protected.'),

  // ── api-structured
  mcq('api-structured-3', 'api-structured', 3, 'Validation of a model\'s JSON output fails. What should happen next?', [
    '*Retry once with the error, then fall back.',
    ['Save the invalid record anyway, and plan to fix the data at a later date.', 'poor-verification', 'Invalid data spreads downstream.'],
    ['Retry the identical request forever until the output finally validates.', 'weak-planning', 'Unbounded retries waste money and may never succeed.'],
    ['Silently fill every missing field with a default value and carry on.', 'bad-assumption', 'Defaults fabricate facts.'],
  ], 'Bounded retry with feedback, then a safe fallback such as human review.'),
  code('api-structured-4', 'api-structured', 3, 'Write `parseLabel(text, allowed)` that parses JSON like `{"label":"bug"}` and returns the label if it is in `allowed`; otherwise return `null` (including for invalid JSON).', {
    exports: ['parseLabel'],
    starter: `function parseLabel(text, allowed) {\n  return JSON.parse(text).label;\n}`,
    solution: `function parseLabel(text, allowed) {\n  try { const j = JSON.parse(text); return j && allowed.includes(j.label) ? j.label : null; } catch { return null; }\n}`,
    tests: [
      ['valid label', `return m.parseLabel('{"label":"bug"}', ['bug','billing']) === 'bug';`],
      ['unknown label', `return m.parseLabel('{"label":"urgent"}', ['bug','billing']) === null;`],
      ['invalid JSON', `return m.parseLabel('Sure! bug', ['bug']) === null;`],
      ['missing field', `return m.parseLabel('{}', ['bug']) === null;`],
    ],
  }, 'Parse defensively and check the value against the allowed set.', 'poor-verification'),

  // ── api-streaming
  order('api-streaming-3', 'api-streaming', 3, 'Order how a client handles a streamed response.', [
    'Open the stream and start receiving events',
    'Append each text delta to the visible output',
    'On the final event, read the stop reason and usage',
    'Validate the complete output before acting on it',
  ], 'Display incrementally; act only on the complete, validated result.', 'state-mgmt'),
  mcq('api-streaming-4', 'api-streaming', 3, 'A stream breaks halfway through. What should the UI do?', [
    '*Mark the answer incomplete and offer a retry.',
    ['Display the partial text as if it were the complete final answer.', 'poor-verification', 'Users would trust a truncated answer.'],
    ['Silently discard everything and show an empty screen to the user.', 'incomplete', 'Users need to know what happened.'],
    ['Keep waiting forever in case the stream eventually starts again.', 'weak-planning', 'Use a timeout and an explicit state.'],
  ], 'Partial output must be labelled as partial, with a way to recover.'),

  // ── api-cost
  multi('api-cost-3', 'api-cost', 3, 'Which changes reduce cost without changing the model? Select all that apply.', [
    '*Caching a long, repeated prompt prefix',
    '*Removing irrelevant context from each request',
    '*Lowering the maximum output length where answers are short',
    ['Retrying every request twice to be safe', 'weak-planning', 'That roughly multiplies cost.'],
  ], 'Fewer, smaller and cached tokens cost less.'),
  mcq('api-cost-4', 'api-cost', 3, 'What should you log with every model call to manage cost?', [
    '*Token usage, model, and a feature tag.',
    ['Only the total monthly invoice, which the provider sends at the end.', 'poor-verification', 'You cannot see which feature drives cost.'],
    ['The full API key, so that you can attribute usage to the right account.', 'unsafe-action', 'Never log secrets.'],
    ['Nothing — logging extra metadata always increases the cost of calls.', 'bad-assumption', 'Metadata logging is cheap and essential.'],
  ], 'Per-call usage with a feature tag shows exactly what costs what.'),

  // ── ag-action
  classify('ag-action-3', 'ag-action', 3, 'Tools: `search_docs`, `get_order(order_id)`, `calculator`. What is the right first action?', ['search_docs', 'get_order', 'calculator', 'Ask the user'], [
    ['"What is your refund policy?"', 'search_docs', 'wrong-tool'],
    ['"Has order 1204 shipped?"', 'get_order', 'wrong-tool'],
    ['"What is 15% of 840?"', 'calculator', 'wrong-tool'],
    ['"Where is my order?" (no id given)', 'Ask the user', 'bad-assumption'],
  ], 'Match the tool to the information needed — and ask when a required value is missing.'),
  mcq('ag-action-4', 'ag-action', 3, 'An agent keeps picking `search_web` when it should use `search_internal_docs`. What is the best first fix?', [
    '*Clarify each tool\'s description: when to use it.',
    ['Remove search_internal_docs, so that there is only one search tool left.', 'wrong-tool', 'It is the tool you want used.'],
    ['Increase the agent\'s step limit so it has time to try both tools.', 'weak-planning', 'More steps do not fix selection.'],
    ['Switch to a larger model and hope that it chooses correctly next time.', 'weak-planning', 'Fix the obvious description problem first.'],
  ], 'Tool descriptions are the model\'s main signal for selection.'),

  // ── ag-recovery
  classify('ag-recovery-3', 'ag-recovery', 3, 'How should an agent respond to each tool failure?', ['Retry (limited)', 'Fix the call', 'Escalate / ask'], [
    ['Weather service timed out once', 'Retry (limited)'],
    ['Validation error: quarter must be Q1–Q4', 'Fix the call', 'state-mgmt'],
    ['Payment service failed three times in a row', 'Escalate / ask'],
    ['503 from the search API', 'Retry (limited)'],
    ['Permission denied for this account', 'Escalate / ask', 'unsafe-action'],
  ], 'Transient → bounded retry; invalid call → correct it; persistent or permission failures → escalate.'),
  mcq('ag-recovery-4', 'ag-recovery', 4, 'Why checkpoint progress during a long agent task?', [
    '*So a failure resumes instead of restarting.',
    ['Because the model needs checkpoints in order to remember its instructions.', 'concept-confusion', 'Checkpoints are application state, not model memory.'],
    ['Because checkpoints make every individual model call noticeably faster.', 'bad-assumption', 'They do not change call speed.'],
    ['They are only needed for agents that run on more than one machine.', 'bad-assumption', 'Single-process agents crash and time out too.'],
  ], 'Saved progress turns a late failure into a resume, not a full redo with repeated side effects.'),

  // ── ag-when-not
  classify('ag-when-not-3', 'ag-when-not', 3, 'Choose the simplest approach that fits.', ['Single model call', 'Fixed workflow', 'Agent'], [
    ['Summarise one meeting transcript', 'Single model call'],
    ['Extract → validate → store, for every invoice', 'Fixed workflow'],
    ['Investigate an unfamiliar bug across a codebase', 'Agent'],
    ['Translate a product description', 'Single model call'],
    ['Classify, then route to one of three prompts', 'Fixed workflow'],
  ], 'Use autonomy only where the path genuinely cannot be fixed in advance.'),
  mcq('ag-when-not-4', 'ag-when-not', 3, 'A team wants an agent for a task whose mistakes cannot be detected or undone. What is the best advice?', [
    '*Don\'t automate it autonomously; keep a human in control.',
    ['Build the agent anyway, but use the most capable model that is available.', 'unsafe-action', 'Capability does not make undetectable errors acceptable.'],
    ['Build it with a much longer prompt that tells it never to make mistakes.', 'bad-assumption', 'Prompts cannot guarantee correctness.'],
    ['Build it, and add a disclaimer explaining that errors are possible.', 'unsafe-action', 'A disclaimer does not make errors recoverable.'],
  ], 'If errors cannot be caught or recovered, autonomy is the wrong design.'),

  // ── t-results
  mcq('t-results-3', 't-results', 3, 'A database tool would return 50,000 rows. What should the tool return to the model?', [
    '*A small summary or top rows, with a count.',
    ['All 50,000 rows, so that the model has every detail it could possibly need.', 'context-omission', 'It floods the context window and buries the signal.'],
    ['Nothing, with no indication of how many rows actually matched the query.', 'incomplete', 'The model would not know anything matched.'],
    ['A random selection of rows, presented as though it were the full result.', 'poor-verification', 'That misrepresents the data.'],
  ], 'Return concise, honest results and say what was omitted.'),
  classify('t-results-4', 't-results', 3, 'Which tool result is well designed?', ['Good result', 'Poor result'], [
    ['{"results": [], "note": "no matches for \'refund\'"}', 'Good result'],
    ['"" (an empty string)', 'Poor result', 'incomplete'],
    ['{"error": "timeout after 10s", "retryable": true}', 'Good result'],
    ['{"ok": true} returned after the call actually failed', 'Poor result', 'poor-verification'],
    ['Top 5 rows plus "195 more omitted"', 'Good result'],
  ], 'Honest, explicit, structured results — including errors and empty sets.'),

  // ── r-embeddings
  mcq('r-embeddings-3', 'r-embeddings', 3, 'Why can vector search find "annual leave" for the query "vacation days"?', [
    '*Embeddings place similar meanings close together.',
    ['Because vector search quietly expands every query into a list of synonyms.', 'concept-confusion', 'It compares vectors; it does not rewrite queries.'],
    ['Because both phrases contain the same number of letters and spaces.', 'conceptual', 'Length is irrelevant.'],
    ['Because vector search only works if the exact keywords also match.', 'concept-confusion', 'That describes keyword search.'],
  ], 'Embeddings capture meaning, so paraphrases can match.'),
  mcq('r-embeddings-4', 'r-embeddings', 3, 'A chunk has high cosine similarity to the query. What does that guarantee?', [
    '*Only that it is similar — not that it answers.',
    ['That the chunk contains the correct answer to the user\'s question.', 'bad-assumption', 'Similar is not the same as relevant or correct.'],
    ['That the chunk was written recently and is still up to date.', 'bad-assumption', 'Similarity knows nothing about dates.'],
    ['That the user is allowed to see the chunk under their permissions.', 'unsafe-action', 'Permissions are a separate filter.'],
  ], 'Similarity is a ranking signal; relevance, freshness and access still need checking.'),
];

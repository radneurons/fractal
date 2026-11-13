// Additional items supporting the second wave of full lessons (Schools 6, 7, 11, 12, 14, 15).
import type { Item } from '@/core/types';
import { classify, code, mcq, order, short } from './helpers';

export const EXPANSION_ITEMS: Item[] = [
  // ── pg-cli
  order('pg-cli-3', 'pg-cli', 1, 'An agent proposes a terminal command you have not seen before. Order the safe steps.', [
    'Read the whole command, including every flag',
    'Check which directory you are in',
    'Work out which files it will read or change',
    'Run it, then check the result',
  ], 'Read, locate, predict, then run — the same habit applies to your own commands.', 'unsafe-action'),
  mcq('pg-cli-4', 'pg-cli', 2, 'A coding agent asks to run `rm -rf build/`. What should you check first?', [
    '*Where you are, and what build/ contains.',
    ['Nothing — commands proposed by an agent have already been verified as safe.', 'unsafe-action', 'Agents can be wrong about paths; deletion has no undo.'],
    ['Whether the command is spelled in lowercase, since uppercase flags are dangerous.', 'conceptual', 'Letter case is not what makes a deletion risky.'],
    ['Whether your internet connection is stable enough to finish the deletion.', 'conceptual', 'Deleting local files does not use the network.'],
  ], 'Destructive commands deserve a location check (`pwd`) and a look (`ls build/`) before approval.'),

  // ── pg-json-http
  mcq('pg-json-http-3', 'pg-json-http', 1, 'Which of these is valid JSON?', [
    '*{"name": "Ada"}',
    ['{name: "Ada", tags: []}', 'syntax', 'JSON keys must be in double quotes.'],
    ["{'name': 'Ada', 'tags': []}", 'syntax', 'JSON requires double quotes, not single quotes.'],
    ['{"name": "Ada", "tags": [],}', 'syntax', 'JSON does not allow a trailing comma.'],
  ], 'Double-quoted keys and strings, no trailing commas, no comments.'),
  classify('pg-json-http-4', 'pg-json-http', 2, 'Sort each HTTP status code.', ['Success (2xx)', 'Client problem (4xx)', 'Server problem (5xx)'], [
    ['201 Created', 'Success (2xx)'],
    ['404 Not Found', 'Client problem (4xx)'],
    ['500 Internal Server Error', 'Server problem (5xx)'],
    ['429 Too Many Requests', 'Client problem (4xx)'],
    ['204 No Content', 'Success (2xx)'],
    ['502 Bad Gateway', 'Server problem (5xx)'],
  ], 'The first digit tells you who needs to act: 4xx — fix or slow the request; 5xx — the server side failed.'),

  // ── api-basics
  order('api-basics-3', 'api-basics', 2, 'Order one turn of a chat application built on a stateless model API.', [
    'Append the user\'s new message to the stored history',
    'Send the full history with the model id and output limit',
    'Check the stop reason of the response',
    'Append the assistant\'s reply to the stored history',
  ], 'The application owns the conversation; the API sees only what you send each time.', 'state-mgmt'),
  mcq('api-basics-4', 'api-basics', 2, 'Your app sends only the newest user message on each request, and the model "forgets" earlier turns. Why?', [
    '*The API is stateless; you must resend the history.',
    ['The model\'s context window is too small to hold more than one message.', 'conceptual', 'Context windows hold far more than one message; the history simply was not sent.'],
    ['The provider deletes conversations after every request for privacy reasons.', 'bad-assumption', 'There is no stored conversation to delete — each request stands alone.'],
    ['The model needs to be retrained on the conversation before it can recall it.', 'concept-confusion', 'Recall within a conversation comes from context, not training.'],
  ], 'Each request must contain everything the model needs: system prompt, prior turns, and the new message.'),

  // ── api-resilience
  mcq('api-resilience-3', 'api-resilience', 3, 'Why add random jitter to exponential backoff?', [
    '*So many clients don\'t all retry at the same instant.',
    ['Because randomised delays make each individual request cheaper to process.', 'conceptual', 'Jitter does not change the cost of a request.'],
    ['To guarantee that every retry happens sooner than the previous attempt did.', 'conceptual', 'Backoff makes retries later, not sooner.'],
    ['Because providers reject any retry that arrives on a predictable schedule.', 'bad-assumption', 'There is no such rule; the goal is to avoid synchronised retry waves.'],
  ], 'Without jitter, clients that failed together retry together and overload the service again.'),
  mcq('api-resilience-4', 'api-resilience', 3, 'A "create order" tool call timed out. Retrying might create a second order. What is the best design?', [
    '*Send an idempotency key so retries are deduplicated.',
    ['Never retry anything, and show the user an error whenever a timeout happens.', 'weak-planning', 'Safe retries are valuable; make the operation idempotent instead.'],
    ['Retry three times quickly and remove any duplicate orders by hand afterwards.', 'unsafe-action', 'Creating duplicates and cleaning up later risks real-world side effects.'],
    ['Increase the timeout to ten minutes so that the call can no longer time out.', 'weak-planning', 'Long timeouts hide the problem and still leave the outcome uncertain.'],
  ], 'Idempotency keys let the server recognise a retry of the same operation and return the original result.'),

  // ── ar-workflows
  classify('ar-workflows-3', 'ar-workflows', 3, 'Which workflow pattern fits each task?', ['Prompt chaining', 'Routing', 'Parallelisation'], [
    ['Draft, then fact-check the draft, then polish it', 'Prompt chaining'],
    ['Send billing tickets to one prompt and bug reports to another', 'Routing'],
    ['Review one document for tone, accuracy and legal risk at the same time', 'Parallelisation'],
    ['Translate, then verify the translation, then format it', 'Prompt chaining'],
    ['Summarise 40 files independently, then merge the summaries', 'Parallelisation'],
  ], 'Sequential dependence → chain; different kinds of input → route; independent subtasks → parallelise.'),
  mcq('ar-workflows-4', 'ar-workflows', 3, 'A generate → critique → revise loop is added to improve drafts. What makes it safe to run?', [
    '*A cap on the number of revision rounds.',
    ['A critic that is instructed to always find at least one more thing to improve.', 'weak-planning', 'A critic that never approves guarantees the loop never ends on its own.'],
    ['Using the largest available model for both the writer and the critic steps.', 'bad-assumption', 'Model size does not guarantee the loop ends.'],
    ['Letting the writer decide for itself when its own draft is finally good enough.', 'weak-planning', 'Termination should be guaranteed by code, not left to the model.'],
  ], 'Evaluator-optimizer loops need a code-enforced limit and a defined outcome when the limit is reached.'),

  // ── ar-termination
  mcq('ar-termination-3', 'ar-termination', 4, 'Agent A is waiting for B\'s result. Agent B is waiting for A\'s approval. Nothing happens. What is this, and the fix?', [
    '*A deadlock; add timeouts on waits.',
    ['A race condition; add an idempotency key to both of the agents\' actions.', 'concept-confusion', 'Races are about simultaneous actions; here nothing acts at all.'],
    ['A hallucination; switch both of the agents over to a larger, smarter model.', 'concept-confusion', 'No output is being invented — each side is simply waiting.'],
    ['Normal behaviour; given enough time the two agents will resolve it themselves.', 'bad-assumption', 'A circular wait never resolves without an outside rule.'],
  ], 'Circular waits need timeouts and a defined fallback (escalate, or proceed with a default).'),
  code('ar-termination-4', 'ar-termination', 4, 'Write `shouldStop(state, limits)`. `state` is `{steps, costUsd, elapsedMs, rounds}` and `limits` is `{maxSteps, maxCostUsd, maxMs, maxRounds}`. Return the first reason reached, checking in this order: `"steps"`, `"cost"`, `"time"`, `"rounds"` (a value equal to its limit counts as reached). Return `null` if no limit is reached.', {
    exports: ['shouldStop'],
    starter: `function shouldStop(state, limits) {\n  return null;\n}`,
    solution: `function shouldStop(state, limits) {\n  if (state.steps >= limits.maxSteps) return 'steps';\n  if (state.costUsd >= limits.maxCostUsd) return 'cost';\n  if (state.elapsedMs >= limits.maxMs) return 'time';\n  if (state.rounds >= limits.maxRounds) return 'rounds';\n  return null;\n}`,
    tests: [
      ['null when under every limit', `return m.shouldStop({steps:1,costUsd:0.1,elapsedMs:10,rounds:0},{maxSteps:5,maxCostUsd:1,maxMs:1000,maxRounds:3}) === null;`],
      ['steps limit', `return m.shouldStop({steps:5,costUsd:0,elapsedMs:0,rounds:0},{maxSteps:5,maxCostUsd:1,maxMs:1000,maxRounds:3}) === 'steps';`],
      ['cost limit', `return m.shouldStop({steps:1,costUsd:1.2,elapsedMs:0,rounds:0},{maxSteps:5,maxCostUsd:1,maxMs:1000,maxRounds:3}) === 'cost';`],
      ['time limit', `return m.shouldStop({steps:1,costUsd:0,elapsedMs:1000,rounds:0},{maxSteps:5,maxCostUsd:1,maxMs:1000,maxRounds:3}) === 'time';`],
      ['rounds limit', `return m.shouldStop({steps:1,costUsd:0,elapsedMs:0,rounds:3},{maxSteps:5,maxCostUsd:1,maxMs:1000,maxRounds:3}) === 'rounds';`],
      ['first reason wins', `return m.shouldStop({steps:9,costUsd:9,elapsedMs:9999,rounds:9},{maxSteps:5,maxCostUsd:1,maxMs:1000,maxRounds:3}) === 'steps';`],
    ],
  }, 'A single budget check, called every iteration, is what turns "should stop" into "will stop".', 'incomplete', ['Use >= for each comparison.', 'Return as soon as one limit is reached.']),

  // ── ev-why
  mcq('ev-why-3', 'ev-why', 3, 'Your provider releases a new model version. What tells you whether your feature got better or worse?', [
    '*Running your eval suite on both versions.',
    ['Reading the release announcement and its published benchmark improvements.', 'poor-verification', 'General benchmarks do not measure your task.'],
    ['Trying three favourite prompts by hand and comparing how the answers feel.', 'poor-verification', 'Three hand-picked prompts are anecdotes.'],
    ['Assuming that newer versions are always better on every kind of task.', 'bad-assumption', 'Upgrades can regress specific behaviours.'],
  ], 'A fixed eval suite turns a model upgrade into a measured comparison.'),
  short('ev-why-4', 'ev-why', 3, 'A teammate says: "I tried the new prompt and it looked good — let\'s ship." Explain why that is not enough, and what to do instead.', [
    ['outputs vary / one try is not representative', ['vary', 'variab', 'different each', 'random', 'non-determin', 'inconsisten', 'one example', 'few examples', 'anecdot']],
    ['other cases may regress', ['regress', 'break', 'worse', 'other cases', 'side effect']],
    ['use a fixed, repeatable test set', ['fixed', 'same set', 'repeat', 'test set', 'dataset', 'eval']],
    ['compare against the current version', ['compare', 'baseline', 'current version', 'before and after', 'measure']],
  ], 3, 'One good-looking output is an anecdote: model outputs vary, and a change that helps one case can make other cases worse. Run the fixed eval set on both the current and the new prompt, compare the measured results against the baseline, and ship only if nothing important regresses.',
    'Variability + regressions → a repeatable eval compared with a baseline.'),

  // ── ev-metrics
  mcq('ev-metrics-3', 'ev-metrics', 3, 'A spam filter flags only 1% of emails. Every flagged email really is spam, but most spam gets through. Describe it.', [
    '*High precision, low recall.',
    ['Low precision and high recall, since it flags very few emails.', 'concept-confusion', 'Precision is about how many flags are right — here all of them.'],
    ['High precision and high recall, since it never makes an error.', 'concept-confusion', 'Missing most spam is an error: low recall.'],
    ['Low precision and low recall, since it barely does anything.', 'concept-confusion', 'What it flags is always right, so precision is high.'],
  ], 'Precision: of what I flagged, how much was right? Recall: of what I should have flagged, how much did I catch?'),
  mcq('ev-metrics-4', 'ev-metrics', 4, 'A fraud detector reports 99% accuracy on data where 99% of transactions are legitimate. Why is that number misleading?', [
    '*Always answering "legitimate" also scores 99%.',
    ['Accuracy cannot be computed at all when one class is much larger than the other.', 'conceptual', 'It can be computed; it just hides what matters.'],
    ['Because 99% accuracy is a low score for any modern machine-learning system.', 'bad-assumption', 'The issue is imbalance, not the size of the number.'],
    ['Because accuracy only measures speed, and says nothing about correctness.', 'concept-confusion', 'Accuracy measures correctness, but averages over an unbalanced set.'],
  ], 'On imbalanced data, report precision and recall for the rare class — a do-nothing model can look excellent on accuracy.'),

  // ── pr-requirements
  classify('pr-requirements-3', 'pr-requirements', 3, 'A team is specifying an AI feature that suggests past resolutions to support agents. Classify each statement.', ['Goal', 'Non-goal', 'Constraint'], [
    ['Suggest three relevant past resolutions for each new ticket', 'Goal'],
    ['Sending replies to customers without an agent reviewing them', 'Non-goal'],
    ['Suggestions must appear within two seconds', 'Constraint'],
    ['No customer personal data may be sent to third parties', 'Constraint'],
    ['Replacing the support team', 'Non-goal'],
  ], 'Goals say what success is; non-goals prevent scope creep; constraints bound how you may achieve the goals.'),
  mcq('pr-requirements-4', 'pr-requirements', 3, 'What should the requirements for an AI feature say about mistakes?', [
    '*An acceptable error rate, and what happens on errors.',
    ['That the chosen model is advanced enough for mistakes not to be a concern.', 'bad-assumption', 'Every model makes mistakes; plan for them.'],
    ['Nothing — error handling is an implementation detail to settle after launch.', 'weak-planning', 'How errors are caught and corrected shapes the whole design.'],
    ['That users must agree not to rely on anything the feature tells them.', 'weak-planning', 'A disclaimer is not a design for handling errors.'],
  ], 'Define how wrong is tolerable, how errors are detected, and what the user or system does next.'),

  // ── pr-ux
  mcq('pr-ux-3', 'pr-ux', 3, 'An AI drafts replies that support agents send to customers. Which interface is best?', [
    '*An editable, labelled draft, sent only on click.',
    ['The reply is sent automatically, and the agent is shown a copy of it afterwards.', 'unsafe-action', 'External messages should not go out without human review in this design.'],
    ['The draft is shown as read-only text that can be either accepted or rejected.', 'incomplete', 'Agents need to correct small errors without starting over.'],
    ['The draft appears with no indication that it was produced by an AI system.', 'poor-verification', 'Unlabelled AI output invites over-trust.'],
  ], 'Label it, make it editable, keep the human in control of sending.'),
  classify('pr-ux-4', 'pr-ux', 3, 'Which patterns build appropriate trust in an AI feature?', ['Builds appropriate trust', 'Erodes trust'], [
    ['Each claim links to the source paragraph it came from', 'Builds appropriate trust'],
    ['Hiding the fact that a summary was AI-generated', 'Erodes trust', 'poor-verification'],
    ['One-click undo for any AI edit', 'Builds appropriate trust'],
    ['Showing a confident answer when retrieval found nothing', 'Erodes trust', 'unsafe-action'],
    ['A "this is wrong" button that feeds the eval set', 'Builds appropriate trust'],
  ], 'Evidence, reversibility and honest uncertainty let users trust the feature exactly as much as it deserves.'),

  // ── pro-observability
  mcq('pro-observability-3', 'pro-observability', 4, 'Users say "the assistant got worse this week". What lets you check that claim?', [
    '*Quality metrics broken down by prompt and model version.',
    ['The total number of requests the assistant handled during this week.', 'poor-verification', 'Volume says nothing about quality.'],
    ['A fresh round of manual spot checks on five conversations picked today.', 'poor-verification', 'Without a baseline you cannot tell "worse" from "same".'],
    ['Server CPU and memory graphs for the machines that run the application.', 'wrong-tool', 'Infrastructure health is not output quality.'],
  ], 'Version every prompt and model, tag every trace with those versions, and track quality signals over time.'),
  classify('pro-observability-4', 'pro-observability', 4, 'Where does each piece of information belong?', ['Trace (one request)', 'Metric (aggregate)', 'Never log'], [
    ['The tool calls and arguments made during request 81a', 'Trace (one request)'],
    ['p95 latency over the last hour', 'Metric (aggregate)'],
    ['The provider API key used for the call', 'Never log', 'unsafe-action'],
    ['Cost per feature per day', 'Metric (aggregate)'],
    ['The model output of one failed run', 'Trace (one request)'],
  ], 'Traces explain one request; metrics show trends; secrets appear in neither.'),

  // ── pro-incident
  mcq('pro-incident-3', 'pro-incident', 4, 'An agent is emailing incorrect information to customers right now. What is the first priority?', [
    '*Stop it: kill switch, or disable sending.',
    ['Find the exact root cause, so that the fix is certain to be the right one.', 'weak-planning', 'Diagnosis comes after the harm stops.'],
    ['Write a detailed incident report while the details are still fresh.', 'weak-planning', 'The report comes last.'],
    ['Improve the prompt and redeploy, then watch whether the emails get better.', 'unsafe-action', 'Experimenting in production while harm continues makes it worse.'],
  ], 'Mitigate first. Then diagnose, fix with a regression test, and review.'),
  mcq('pro-incident-4', 'pro-incident', 4, 'What makes a post-incident review "blameless"?', [
    '*It asks how the system allowed the error.',
    ['It avoids writing down what actually happened, so nobody is embarrassed.', 'conceptual', 'Blameless reviews are precise about events; they just do not punish people.'],
    ['It concludes that no changes are needed, because nobody was at fault.', 'weak-planning', 'The point is to produce concrete follow-up actions.'],
    ['It is held privately between a manager and whoever made the mistake.', 'conceptual', 'Reviews are shared so the whole team learns.'],
  ], 'People make mistakes inside systems; durable fixes change the system — guardrails, alerts, tests.'),
];

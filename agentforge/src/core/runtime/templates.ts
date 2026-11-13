// Agent Studio templates. Faulty templates are deliberate debugging challenges; their tests fail until fixed.
import type { GEdge, GNode, Graph, GraphTest } from './agentRuntime';

export interface Template {
  id: string;
  title: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  faulty: boolean;
  blurb: string;
  hint?: string;
  skills: string[];
  sampleInput: string;
  graph: Graph;
  tests: GraphTest[];
}

const N = (id: string, kind: GNode['kind'], label: string, x: number, y: number, config: Record<string, any> = {}): GNode => ({ id, kind, label, position: { x, y }, config });
const E = (source: string, target: string, sourceHandle = 'out', targetHandle = 'in'): GEdge => ({ id: `${source}:${sourceHandle}->${target}:${targetHandle}`, source, target, sourceHandle, targetHandle });
const T = (source: string, target: string) => E(source, target, 'tools', 'attach');

export const TEMPLATES: Template[] = [
  {
    id: 'revenue-agent', title: 'Revenue analyst agent', level: 'beginner', faulty: false, skills: ['ag-what', 'ag-loop', 't-function-calling'],
    blurb: 'An agent with two tools. It must fetch revenue before calculating a percentage — watch it choose actions in order.',
    sampleInput: 'What is 17% of our Q3 revenue?',
    graph: {
      nodes: [
        N('in', 'input', 'User question', 0, 120),
        N('agent', 'agent', 'Analyst agent', 260, 120, { instructions: 'Answer finance questions using tools. Never guess numbers.', maxSteps: 6, stopWhenDone: true, loopGuard: true }),
        N('t-rev', 'tool', 'get_revenue', 180, 300, { toolId: 'get_revenue' }),
        N('t-calc', 'tool', 'calculator', 380, 300, { toolId: 'calculator' }),
        N('out', 'output', 'Answer', 540, 120),
      ],
      edges: [E('in', 'agent'), T('agent', 't-rev'), T('agent', 't-calc'), E('agent', 'out')],
    },
    tests: [
      { name: '17% of Q3 → 408,000', input: 'What is 17% of our Q3 revenue?', expect: { outputIncludes: '408,000', toolUsed: 'calculator' } },
      { name: 'Asks when quarter is missing', input: 'What is 10% of our revenue?', expect: { outputIncludes: 'which quarter', toolNotUsed: 'calculator' } },
      { name: 'Efficient: ≤ 2 tool calls', input: 'What is 25% of Q1 revenue?', expect: { outputIncludes: '475,000', maxToolCalls: 2 } },
    ],
  },
  {
    id: 'support-router', title: 'Support ticket router (workflow)', level: 'beginner', faulty: false, skills: ['ar-workflows', 'ag-when-not'],
    blurb: 'A deterministic workflow: code routes each ticket to a specialised path. No autonomy needed — predictable and testable.',
    sampleInput: 'Can I get a refund on my annual plan?',
    graph: {
      nodes: [
        N('in', 'input', 'Ticket', 0, 160),
        N('route', 'router', 'Classify ticket', 220, 160, { routes: [{ label: 'billing', match: 'refund|invoice|charge|price|plan' }, { label: 'shipping', match: 'ship|deliver|arrive' }] }),
        N('t-docs', 'tool', 'search_docs (billing)', 460, 40, { toolId: 'search_docs' }),
        N('t-docs2', 'tool', 'search_docs (shipping)', 460, 170, { toolId: 'search_docs' }),
        N('out-auto', 'output', 'Suggested reply', 700, 100),
        N('out-human', 'output', 'Human queue', 700, 300),
      ],
      edges: [E('in', 'route'), E('route', 't-docs', 'r0'), E('route', 't-docs2', 'r1'), E('route', 'out-human', 'default'), E('t-docs', 'out-auto'), E('t-docs2', 'out-auto')],
    },
    tests: [
      { name: 'Refund → billing docs', input: 'Can I get a refund on my annual plan?', expect: { outputIncludes: '30 days', toolUsed: 'search_docs' } },
      { name: 'Shipping → shipping docs', input: 'How long does express shipping take to deliver?', expect: { outputIncludes: '1 to 2 business days' } },
      { name: 'Unknown → human queue', input: 'My cat walked on the keyboard', expect: { toolNotUsed: 'search_docs', status: 'completed' } },
    ],
  },
  {
    id: 'weather-retry', title: 'Weather helper with flaky API', level: 'intermediate', faulty: false, skills: ['ag-recovery', 'api-resilience'],
    blurb: 'The weather tool times out on its first attempt. The tool node is configured with 1 retry, so the agent recovers.',
    sampleInput: 'Do I need an umbrella in Oslo?',
    graph: {
      nodes: [
        N('in', 'input', 'Question', 0, 120),
        N('agent', 'agent', 'Weather agent', 240, 120, { instructions: 'Use the weather tool; report failures honestly.', maxSteps: 5, stopWhenDone: true, loopGuard: true }),
        N('t-w', 'tool', 'get_weather', 240, 300, { toolId: 'get_weather', retries: 1, failMode: 'first' }),
        N('out', 'output', 'Answer', 480, 120),
      ],
      edges: [E('in', 'agent'), T('agent', 't-w'), E('agent', 'out')],
    },
    tests: [
      { name: 'Recovers from one timeout', input: 'Do I need an umbrella in Oslo?', expect: { outputIncludes: '6mm rain', toolUsed: 'get_weather' } },
      { name: 'Asks for the city when missing', input: 'Will it rain?', expect: { outputIncludes: 'which city' } },
    ],
  },
  {
    id: 'email-approval', title: 'Notify customer — with approval gate', level: 'intermediate', faulty: false, skills: ['sec-confirm', 'sec-least-priv'],
    blurb: 'Sending email is high-impact, so a Human Approval node sits upstream. Reject it and nothing is sent.',
    sampleInput: 'Email jo@client.test that order 1204 has shipped',
    graph: {
      nodes: [
        N('in', 'input', 'Request', 0, 140),
        N('appr', 'approval', 'Approve outbound email', 220, 140),
        N('t-mail', 'tool', 'send_email', 460, 60, { toolId: 'send_email' }),
        N('out-ok', 'output', 'Sent', 680, 60),
        N('out-no', 'output', 'Cancelled', 460, 260),
      ],
      edges: [E('in', 'appr'), E('appr', 't-mail', 'approved'), E('appr', 'out-no', 'rejected'), E('t-mail', 'out-ok')],
    },
    tests: [
      { name: 'Approved → email sent', input: 'Email jo@client.test that order 1204 has shipped', approve: true, expect: { outputIncludes: 'email sent', toolUsed: 'send_email' } },
      { name: 'Rejected → nothing sent', input: 'Email jo@client.test that order 1204 has shipped', approve: false, expect: { toolNotUsed: 'send_email' } },
    ],
  },
  // ───── Faulty templates (debug challenges)
  {
    id: 'bug-wrong-tool', title: '🐞 Order bot uses the wrong tool', level: 'beginner', faulty: true, skills: ['ag-action', 't-function-calling'],
    blurb: 'Customers ask about specific orders but the bot can only search documentation. Tests fail. Fix the wiring.',
    hint: 'Add a Tool node, select get_order, and connect the agent\'s "tools" port to its "agent" port.',
    sampleInput: 'Where is order 991?',
    graph: {
      nodes: [
        N('in', 'input', 'Customer', 0, 120),
        N('agent', 'agent', 'Order bot', 240, 120, { instructions: 'Answer order questions.', maxSteps: 5, stopWhenDone: true, loopGuard: true }),
        N('t-docs', 'tool', 'search_docs', 240, 300, { toolId: 'search_docs' }),
        N('out', 'output', 'Reply', 480, 120),
      ],
      edges: [E('in', 'agent'), T('agent', 't-docs'), E('agent', 'out')],
    },
    tests: [
      { name: 'Looks up order 991', input: 'Where is order 991?', expect: { outputIncludes: 'delivered', toolUsed: 'get_order' } },
      { name: 'Still answers policy questions', input: 'What is the refund policy?', expect: { outputIncludes: '30 days' } },
    ],
  },
  {
    id: 'bug-no-stop', title: '🐞 Runaway agent (no stop condition)', level: 'intermediate', faulty: true, skills: ['ag-stop', 'ar-termination'],
    blurb: 'This agent repeats its last action forever; only maxSteps saves it. The test requires it to finish in ≤ 3 tool calls.',
    hint: 'Select the agent and enable "Stop when goal is met" (or enable the loop guard), then re-run the tests.',
    sampleInput: 'What are your support hours?',
    graph: {
      nodes: [
        N('in', 'input', 'Question', 0, 120),
        N('agent', 'agent', 'Docs agent', 240, 120, { instructions: 'Answer using the docs.', maxSteps: 25, stopWhenDone: false, loopGuard: false }),
        N('t-docs', 'tool', 'search_docs', 240, 300, { toolId: 'search_docs' }),
        N('out', 'output', 'Reply', 480, 120),
      ],
      edges: [E('in', 'agent'), T('agent', 't-docs'), E('agent', 'out')],
    },
    tests: [
      { name: 'Finishes with ≤ 3 tool calls', input: 'What are your support hours?', expect: { outputIncludes: 'monday', maxToolCalls: 3 } },
    ],
  },
  {
    id: 'bug-unsafe-email', title: '🐞 Email sent without approval', level: 'intermediate', faulty: true, skills: ['sec-confirm', 'sec-least-priv'],
    blurb: 'The workflow sends email straight from user input. Validation blocks the run. Insert a Human Approval gate.',
    hint: 'Add a Human Approval node between Input and send_email: Input → Approval; Approval "approved" → send_email; "rejected" → a new Output.',
    sampleInput: 'Email jo@client.test that order 1204 has shipped',
    graph: {
      nodes: [
        N('in', 'input', 'Request', 0, 140),
        N('t-mail', 'tool', 'send_email', 260, 140, { toolId: 'send_email' }),
        N('out', 'output', 'Result', 500, 140),
      ],
      edges: [E('in', 't-mail'), E('t-mail', 'out')],
    },
    tests: [
      { name: 'Approved → sent', input: 'Email jo@client.test that order 1204 has shipped', approve: true, expect: { outputIncludes: 'email sent' } },
      { name: 'Rejected → not sent', input: 'Email jo@client.test that order 1204 has shipped', approve: false, expect: { toolNotUsed: 'send_email', status: 'completed' } },
    ],
  },
  {
    id: 'bug-cycle', title: '🐞 Unbounded review cycle', level: 'advanced', faulty: true, skills: ['ar-termination', 'ar-workflows'],
    blurb: 'A draft is validated and sent back for revision on failure — but the cycle has no limit, so the graph is rejected.',
    hint: 'Insert a Loop node (max 3) into the revision path: invalid → Loop; Loop "body" → Agent; Loop "exit" → a Needs-human Output.',
    sampleInput: 'Summarise the refund policy in one sentence',
    graph: {
      nodes: [
        N('in', 'input', 'Request', 0, 140),
        N('agent', 'agent', 'Writer', 220, 140, { instructions: 'Draft an answer from the docs.', maxSteps: 4, stopWhenDone: true, loopGuard: true }),
        N('t-docs', 'tool', 'search_docs', 220, 320, { toolId: 'search_docs' }),
        N('val', 'validate', 'Mentions a timeframe?', 460, 140, { mustContain: 'days' }),
        N('out', 'output', 'Approved draft', 700, 60),
      ],
      edges: [E('in', 'agent'), T('agent', 't-docs'), E('agent', 'val'), E('val', 'out', 'valid'), E('val', 'agent', 'invalid')],
    },
    tests: [
      { name: 'Graph is valid and completes', input: 'Summarise the refund policy in one sentence', expect: { status: 'completed', outputIncludes: '30 days' } },
      { name: 'Unanswerable input terminates', input: 'Summarise the security policy', expect: { status: 'completed' } },
    ],
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);

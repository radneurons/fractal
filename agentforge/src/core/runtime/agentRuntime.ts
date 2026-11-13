// AgentStudioRuntime — validates and executes agent workflow graphs deterministically.
// Every highlighted node and trace line in the UI comes from the events emitted here (no decorative animation).
import { TOOLS, extractArgs, summarizeObservation } from './tools';

export type NodeKind = 'input' | 'agent' | 'tool' | 'router' | 'condition' | 'loop' | 'validate' | 'memory' | 'approval' | 'output';
export type PortType = 'flow' | 'tool';

export interface GNode {
  id: string;
  kind: NodeKind;
  label: string;
  config: Record<string, any>;
  position: { x: number; y: number };
}
export interface GEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}
export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
}

export interface PortDef {
  id: string;
  type: PortType;
  label?: string;
}

/** Port definitions per node kind. Handles are typed so invalid wiring can be rejected. */
export function portsFor(n: Pick<GNode, 'kind' | 'config'>): { inputs: PortDef[]; outputs: PortDef[] } {
  switch (n.kind) {
    case 'input': return { inputs: [], outputs: [{ id: 'out', type: 'flow' }] };
    case 'agent': return { inputs: [{ id: 'in', type: 'flow' }], outputs: [{ id: 'out', type: 'flow' }, { id: 'tools', type: 'tool', label: 'tools' }] };
    case 'tool': return { inputs: [{ id: 'in', type: 'flow' }, { id: 'attach', type: 'tool', label: 'agent' }], outputs: [{ id: 'out', type: 'flow' }] };
    case 'router': {
      const routes: { label: string }[] = n.config.routes ?? [];
      return { inputs: [{ id: 'in', type: 'flow' }], outputs: [...routes.map((r, i) => ({ id: `r${i}`, type: 'flow' as const, label: r.label })), { id: 'default', type: 'flow', label: 'default' }] };
    }
    case 'condition': return { inputs: [{ id: 'in', type: 'flow' }], outputs: [{ id: 'true', type: 'flow', label: 'true' }, { id: 'false', type: 'flow', label: 'false' }] };
    case 'loop': return { inputs: [{ id: 'in', type: 'flow' }], outputs: [{ id: 'body', type: 'flow', label: 'body' }, { id: 'exit', type: 'flow', label: 'exit' }] };
    case 'validate': return { inputs: [{ id: 'in', type: 'flow' }], outputs: [{ id: 'valid', type: 'flow', label: 'valid' }, { id: 'invalid', type: 'flow', label: 'invalid' }] };
    case 'memory': return { inputs: [{ id: 'in', type: 'flow' }], outputs: [{ id: 'out', type: 'flow' }] };
    case 'approval': return { inputs: [{ id: 'in', type: 'flow' }], outputs: [{ id: 'approved', type: 'flow', label: 'approved' }, { id: 'rejected', type: 'flow', label: 'rejected' }] };
    case 'output': return { inputs: [{ id: 'in', type: 'flow' }], outputs: [] };
  }
}

export function connectionError(g: Graph, c: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }): string | null {
  if (c.source === c.target) return 'A node cannot connect to itself.';
  const s = g.nodes.find((n) => n.id === c.source);
  const t = g.nodes.find((n) => n.id === c.target);
  if (!s || !t) return 'Unknown node.';
  const sp = portsFor(s).outputs.find((p) => p.id === (c.sourceHandle ?? 'out'));
  const tp = portsFor(t).inputs.find((p) => p.id === (c.targetHandle ?? 'in'));
  if (!sp || !tp) return 'Unknown port.';
  if (sp.type !== tp.type) return sp.type === 'tool' ? 'The agent "tools" port only connects to a tool\'s "agent" port.' : 'Flow ports cannot connect to a tool attachment port.';
  if (sp.type === 'tool' && t.kind !== 'tool') return 'Only tool nodes can be attached to an agent.';
  if (g.edges.some((e) => e.source === c.source && e.target === c.target && (e.sourceHandle ?? 'out') === (c.sourceHandle ?? 'out') && (e.targetHandle ?? 'in') === (c.targetHandle ?? 'in'))) return 'That connection already exists.';
  return null;
}

export interface ValidationResult {
  ok: boolean;
  errors: { nodeId?: string; message: string }[];
  warnings: { nodeId?: string; message: string }[];
}

const flowEdges = (g: Graph) => g.edges.filter((e) => (e.sourceHandle ?? 'out') !== 'tools');
const toolEdges = (g: Graph) => g.edges.filter((e) => e.sourceHandle === 'tools');

export function validateGraph(g: Graph): ValidationResult {
  const errors: ValidationResult['errors'] = [];
  const warnings: ValidationResult['warnings'] = [];
  const inputs = g.nodes.filter((n) => n.kind === 'input');
  if (inputs.length !== 1) errors.push({ message: `A workflow needs exactly one Input node (found ${inputs.length}).` });
  if (!g.nodes.some((n) => n.kind === 'output')) errors.push({ message: 'Add at least one Output node so the run has a result.' });
  for (const e of g.edges) {
    const err = connectionError({ nodes: g.nodes, edges: g.edges.filter((x) => x.id !== e.id) }, e);
    if (err) errors.push({ nodeId: e.source, message: `Invalid connection: ${err}` });
  }
  const fe = flowEdges(g);
  // Reachability over flow edges from the input.
  if (inputs[0]) {
    const seen = new Set<string>([inputs[0].id]);
    const q = [inputs[0].id];
    while (q.length) {
      const id = q.shift()!;
      for (const e of fe.filter((x) => x.source === id)) if (!seen.has(e.target)) seen.add(e.target), q.push(e.target);
    }
    const attached = new Set(toolEdges(g).map((e) => e.target));
    for (const n of g.nodes) if (!seen.has(n.id) && !(n.kind === 'tool' && attached.has(n.id))) warnings.push({ nodeId: n.id, message: `“${n.label}” is not reachable from the Input and will never run.` });
  }
  // Every flow cycle must pass through a Loop node (explicit limit) — otherwise termination isn't guaranteed.
  const colour = new Map<string, number>();
  const dfs = (id: string, stack: string[]) => {
    colour.set(id, 1);
    for (const e of fe.filter((x) => x.source === id)) {
      const c = colour.get(e.target) ?? 0;
      if (c === 1) {
        const cyc = [...stack.slice(stack.indexOf(e.target)), id];
        if (!cyc.some((nid) => g.nodes.find((n) => n.id === nid)?.kind === 'loop'))
          errors.push({ nodeId: e.target, message: 'Cycle without a Loop node: add a Loop with a max-iterations limit so the workflow is guaranteed to stop.' });
      } else if (c === 0) dfs(e.target, [...stack, e.target]);
    }
    colour.set(id, 2);
  };
  for (const n of g.nodes) if (!colour.get(n.id)) dfs(n.id, [n.id]);

  for (const n of g.nodes) {
    if (n.kind === 'agent') {
      const ms = Number(n.config.maxSteps);
      if (!(ms >= 1 && ms <= 50)) errors.push({ nodeId: n.id, message: `Agent “${n.label}” needs maxSteps between 1 and 50.` });
      if (!toolEdges(g).some((e) => e.source === n.id)) warnings.push({ nodeId: n.id, message: `Agent “${n.label}” has no tools attached — it can only answer from the prompt.` });
      if (n.config.stopWhenDone === false && !n.config.loopGuard) warnings.push({ nodeId: n.id, message: `Agent “${n.label}” has no stop condition and no loop guard — it will run until maxSteps.` });
    }
    if (n.kind === 'loop' && !(Number(n.config.max) >= 1 && Number(n.config.max) <= 20)) errors.push({ nodeId: n.id, message: `Loop “${n.label}” needs max iterations between 1 and 20.` });
    if (n.kind === 'tool') {
      if (!TOOLS[n.config.toolId]) errors.push({ nodeId: n.id, message: `Tool node “${n.label}” has no valid tool selected.` });
      const hasIn = fe.some((e) => e.target === n.id) || toolEdges(g).some((e) => e.target === n.id);
      if (!hasIn) warnings.push({ nodeId: n.id, message: `Tool “${n.label}” is not attached to an agent or connected to the flow.` });
      if (TOOLS[n.config.toolId]?.impact === 'external' && !upstreamHas(g, n.id, 'approval'))
        errors.push({ nodeId: n.id, message: `“${n.label}” has external impact (e.g. sends email) but no Human Approval node upstream.` });
    }
    if (n.kind === 'router' && !(n.config.routes ?? []).length) warnings.push({ nodeId: n.id, message: `Router “${n.label}” has no routes; everything goes to default.` });
  }
  return { ok: errors.length === 0, errors, warnings };
}

function upstreamHas(g: Graph, nodeId: string, kind: NodeKind): boolean {
  const seen = new Set<string>();
  const q = [nodeId];
  while (q.length) {
    const id = q.shift()!;
    for (const e of g.edges.filter((x) => x.target === id)) {
      if (seen.has(e.source)) continue;
      seen.add(e.source);
      const src = g.nodes.find((n) => n.id === e.source);
      if (src?.kind === kind) return true;
      q.push(e.source);
    }
  }
  return false;
}

// ───────── Execution

export type TraceKind = 'enter' | 'decision' | 'tool-request' | 'tool-response' | 'tool-error' | 'validation' | 'state' | 'branch' | 'approval' | 'final' | 'error' | 'budget' | 'output';
export interface TraceEvent {
  seq: number;
  nodeId: string;
  kind: TraceKind;
  message: string;
  data?: unknown;
}

export interface Decision {
  type: 'call' | 'final' | 'ask';
  toolNodeId?: string;
  toolId?: string;
  args?: Record<string, unknown>;
  text?: string;
  rationale: string;
}

export interface PolicyContext {
  goal: string;
  instructions: string;
  tools: { nodeId: string; toolId: string }[];
  observations: Record<string, any>; // toolId → last successful result
  errors: Record<string, number>; // toolId → error count
  calls: { toolId: string; args: unknown; ok: boolean; output?: unknown }[];
  config: Record<string, any>;
}

export interface Policy {
  name: string;
  live: boolean;
  decide(ctx: PolicyContext): Promise<Decision>;
}

/** Offline, deterministic policy: tool choice by description keywords; arguments extracted by rules. Clearly a simulation. */
export const rulePolicy: Policy = {
  name: 'Rule-based teaching policy (SIMULATED)',
  live: false,
  async decide(ctx) {
    const g = ctx.goal.toLowerCase();
    const triggered = ctx.tools.filter((t) => TOOLS[t.toolId]?.triggers.some((k) => g.includes(k)));
    if (ctx.config.stopWhenDone === false && ctx.calls.length > 0) {
      // Faulty-agent behaviour: keeps re-running its first tool because it has no stop condition.
      const last = ctx.calls[ctx.calls.length - 1];
      const t = ctx.tools.find((x) => x.toolId === last.toolId)!;
      return { type: 'call', toolNodeId: t.nodeId, toolId: t.toolId, args: last.args as any, rationale: 'No stop condition configured — repeating the last action.' };
    }
    const pending = triggered.filter((t) => !ctx.observations[t.toolId] && (ctx.errors[t.toolId] ?? 0) < 2);
    for (const t of pending) {
      const args = extractArgs(t.toolId, ctx.goal, ctx.observations);
      if (args) return { type: 'call', toolNodeId: t.nodeId, toolId: t.toolId, args, rationale: `Goal mentions “${TOOLS[t.toolId].triggers.find((k) => g.includes(k))}”, which matches ${t.toolId}'s description.` };
    }
    if (pending.length) {
      const need: Record<string, string> = { get_order: 'your order id', get_revenue: 'which quarter (Q1–Q4)', get_weather: 'which city', calculator: 'the numbers to calculate', file_lookup: 'the file path', send_email: 'the recipient email address', search_docs: 'what to search for' };
      return { type: 'ask', text: `To answer this I need ${need[pending[0].toolId] ?? 'more information'}. Could you provide it?`, rationale: `${pending[0].toolId} is relevant but a required argument is missing — asking instead of guessing.` };
    }
    const failed = triggered.filter((t) => (ctx.errors[t.toolId] ?? 0) >= 2 && !ctx.observations[t.toolId]);
    const parts = Object.entries(ctx.observations).map(([tool, r]) => summarizeObservation(tool, r));
    if (!triggered.length && !parts.length)
      return { type: 'final', text: 'I don\'t have a tool that fits this request, so I can\'t answer it reliably.', rationale: 'No attached tool matches the goal.' };
    let text = parts.length ? `${parts.join('; ')}.` : '';
    if (failed.length) text += `${text ? ' ' : ''}I couldn't get a result from ${failed.map((f) => f.toolId).join(', ')} after retrying.`;
    return { type: 'final', text: text.charAt(0).toUpperCase() + text.slice(1), rationale: 'All relevant tools have returned results — composing the answer from observations.' };
  },
};

export interface RunOptions {
  stepBudget?: number;
  policy?: Policy;
  approve?: (req: { nodeId: string; label: string; value: string }) => Promise<boolean>;
  failModes?: Record<string, 'never' | 'always' | 'first'>; // by tool node id
}

export interface RunResult {
  status: 'completed' | 'failed' | 'budget-exceeded' | 'invalid';
  outputs: { nodeId: string; value: string }[];
  trace: TraceEvent[];
  memory: Record<string, string>;
  toolCalls: { nodeId: string; toolId: string; args: unknown; ok: boolean; error?: string }[];
  stats: { steps: number; toolCalls: number; estTokens: number };
  validation: ValidationResult;
}

class BudgetError extends Error {}

export async function runGraph(g: Graph, input: string, opts: RunOptions = {}): Promise<RunResult> {
  const validation = validateGraph(g);
  const trace: TraceEvent[] = [];
  const toolCalls: RunResult['toolCalls'] = [];
  const memory: Record<string, string> = {};
  const outputs: RunResult['outputs'] = [];
  let seq = 0;
  let steps = 0;
  let estTokens = 0;
  const budget = opts.stepBudget ?? 40;
  const policy = opts.policy ?? rulePolicy;
  const emit = (nodeId: string, kind: TraceKind, message: string, data?: unknown) => trace.push({ seq: seq++, nodeId, kind, message, data });
  const step = (nodeId: string) => {
    steps++;
    if (steps > budget) {
      emit(nodeId, 'budget', `Global step budget of ${budget} exhausted — run halted to guarantee termination.`);
      throw new BudgetError();
    }
  };

  if (!validation.ok) {
    for (const e of validation.errors) emit(e.nodeId ?? '', 'error', e.message);
    return { status: 'invalid', outputs, trace, memory, toolCalls, stats: { steps, toolCalls: 0, estTokens }, validation };
  }
  const fe = flowEdges(g);
  const te = toolEdges(g);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const loopCounts = new Map<string, number>();
  const start = g.nodes.find((n) => n.kind === 'input')!;
  const queue: { nodeId: string; value: string; approved: boolean }[] = [{ nodeId: start.id, value: input, approved: false }];

  const execTool = async (nodeId: string, toolId: string, args: Record<string, unknown>, approved: boolean) => {
    const spec = TOOLS[toolId];
    const node = byId.get(nodeId)!;
    emit(nodeId, 'tool-request', `${toolId}(${JSON.stringify(args)})`, { args });
    const parsed = spec.schema.safeParse(args);
    if (!parsed.success) {
      const msg = `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'args'} ${i.message}`).join('; ')}`;
      emit(nodeId, 'tool-error', msg);
      toolCalls.push({ nodeId, toolId, args, ok: false, error: msg });
      return { ok: false as const, error: msg };
    }
    if (spec.impact === 'external' && !approved) {
      const msg = 'Permission denied: external-impact tool called without human approval on this path.';
      emit(nodeId, 'tool-error', msg);
      toolCalls.push({ nodeId, toolId, args, ok: false, error: msg });
      return { ok: false as const, error: msg };
    }
    const retries = Math.max(0, Math.min(3, Number(node.config.retries ?? 0)));
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        const result = spec.run(parsed.data, { failMode: opts.failModes?.[nodeId] ?? node.config.failMode ?? 'never', attempt });
        emit(nodeId, 'tool-response', JSON.stringify(result), { result, attempt });
        toolCalls.push({ nodeId, toolId, args, ok: true });
        estTokens += Math.ceil(JSON.stringify(result).length / 4);
        return { ok: true as const, result };
      } catch (e) {
        const msg = String((e as Error).message);
        emit(nodeId, 'tool-error', `${msg}${attempt <= retries ? ` — retrying (${attempt}/${retries})` : ''}`, { attempt });
        if (attempt > retries) {
          toolCalls.push({ nodeId, toolId, args, ok: false, error: msg });
          return { ok: false as const, error: msg };
        }
      }
    }
    return { ok: false as const, error: 'unreachable' };
  };

  const forward = (nodeId: string, handle: string, value: string, approved: boolean) => {
    for (const e of fe.filter((x) => x.source === nodeId && (x.sourceHandle ?? 'out') === handle)) queue.push({ nodeId: e.target, value, approved });
  };

  try {
    while (queue.length) {
      const { nodeId, value, approved } = queue.shift()!;
      const n = byId.get(nodeId)!;
      step(nodeId);
      emit(nodeId, 'enter', `${n.label}`, { value });
      switch (n.kind) {
        case 'input':
          forward(nodeId, 'out', value, approved);
          break;
        case 'output':
          outputs.push({ nodeId, value });
          emit(nodeId, 'output', value);
          break;
        case 'memory': {
          const key = String(n.config.key || 'notes');
          if (n.config.mode === 'read') {
            const v = memory[key];
            emit(nodeId, 'state', v ? `Read memory[${key}]` : `memory[${key}] is empty — passing input through`, { key, v });
            forward(nodeId, 'out', v ? `${value}\n[memory:${key}] ${v}` : value, approved);
          } else {
            memory[key] = value;
            emit(nodeId, 'state', `memory[${key}] ← ${value.slice(0, 80)}`, { key });
            forward(nodeId, 'out', value, approved);
          }
          break;
        }
        case 'router': {
          const routes: { label: string; match: string }[] = n.config.routes ?? [];
          const idx = routes.findIndex((r) => r.match && new RegExp(r.match, 'i').test(value));
          const handle = idx >= 0 ? `r${idx}` : 'default';
          emit(nodeId, 'branch', idx >= 0 ? `Routed to “${routes[idx].label}” (matched /${routes[idx].match}/)` : 'No route matched → default');
          forward(nodeId, handle, value, approved);
          break;
        }
        case 'condition': {
          const needle = String(n.config.contains ?? '');
          const res = needle ? value.toLowerCase().includes(needle.toLowerCase()) : value.trim().length > 0;
          emit(nodeId, 'branch', `Condition “contains ${JSON.stringify(needle)}” → ${res}`);
          forward(nodeId, res ? 'true' : 'false', value, approved);
          break;
        }
        case 'loop': {
          const c = (loopCounts.get(nodeId) ?? 0) + 1;
          loopCounts.set(nodeId, c);
          const max = Number(n.config.max);
          const exit = c > max;
          emit(nodeId, 'state', exit ? `Iteration limit ${max} reached → exit` : `Iteration ${c}/${max}`);
          forward(nodeId, exit ? 'exit' : 'body', value, approved);
          break;
        }
        case 'validate': {
          const problems: string[] = [];
          if (n.config.mustContain && !value.toLowerCase().includes(String(n.config.mustContain).toLowerCase())) problems.push(`missing “${n.config.mustContain}”`);
          if (n.config.maxLength && value.length > Number(n.config.maxLength)) problems.push(`longer than ${n.config.maxLength} chars`);
          if (n.config.json) {
            try {
              JSON.parse(value);
            } catch {
              problems.push('not valid JSON');
            }
          }
          emit(nodeId, 'validation', problems.length ? `Invalid: ${problems.join(', ')}` : 'Valid', { problems });
          forward(nodeId, problems.length ? 'invalid' : 'valid', value, approved);
          break;
        }
        case 'approval': {
          const ok = opts.approve ? await opts.approve({ nodeId, label: n.label, value }) : false;
          emit(nodeId, 'approval', ok ? 'Human approved' : 'Human rejected (or no approver available)');
          forward(nodeId, ok ? 'approved' : 'rejected', value, ok || approved);
          break;
        }
        case 'tool': {
          const toolId = n.config.toolId;
          const args = extractArgs(toolId, value, {});
          if (!args) {
            emit(nodeId, 'tool-error', `Could not derive arguments for ${toolId} from the input.`);
            forward(nodeId, 'out', `${toolId} skipped: missing arguments`, approved);
            break;
          }
          const r = await execTool(nodeId, toolId, args, approved);
          forward(nodeId, 'out', r.ok ? summarizeObservation(toolId, r.result) : `${toolId} failed: ${r.error}`, approved);
          break;
        }
        case 'agent': {
          const tools = te.filter((e) => e.source === nodeId).map((e) => ({ nodeId: e.target, toolId: byId.get(e.target)!.config.toolId as string }));
          const ctx: PolicyContext = { goal: value, instructions: String(n.config.instructions ?? ''), tools, observations: {}, errors: {}, calls: [], config: n.config };
          const max = Number(n.config.maxSteps);
          let answer: string | null = null;
          for (let i = 1; i <= max; i++) {
            step(nodeId);
            estTokens += Math.ceil((ctx.goal.length + ctx.instructions.length + JSON.stringify(ctx.observations).length) / 4) + 40;
            const d = await policy.decide(ctx);
            emit(nodeId, 'decision', `Step ${i}: ${d.type === 'call' ? `call ${d.toolId}` : d.type === 'ask' ? 'ask the user' : 'final answer'} — ${d.rationale}`, d);
            if (d.type !== 'call') {
              answer = d.text ?? '';
              emit(nodeId, 'final', answer);
              break;
            }
            const r = await execTool(d.toolNodeId!, d.toolId!, d.args ?? {}, approved);
            ctx.calls.push({ toolId: d.toolId!, args: d.args, ok: r.ok, output: r.ok ? r.result : r.error });
            if (r.ok) {
              ctx.observations[d.toolId!] = r.result;
              emit(nodeId, 'state', `observations.${d.toolId} = ${JSON.stringify(r.result).slice(0, 100)}`);
            } else ctx.errors[d.toolId!] = (ctx.errors[d.toolId!] ?? 0) + 1;
            if (n.config.loopGuard && ctx.calls.length >= 3) {
              const last = ctx.calls.slice(-3).map((c) => c.toolId + JSON.stringify(c.args));
              if (last.every((s) => s === last[0])) {
                answer = `Stopped: the same action was repeated 3 times without progress. Partial result: ${Object.entries(ctx.observations).map(([t, o]) => summarizeObservation(t, o)).join('; ') || 'none'}.`;
                emit(nodeId, 'budget', 'Loop guard triggered: 3 identical consecutive tool calls.');
                emit(nodeId, 'final', answer);
                break;
              }
            }
          }
          if (answer === null) {
            answer = `Stopped after reaching maxSteps (${max}) without a final answer.`;
            emit(nodeId, 'budget', answer);
          }
          forward(nodeId, 'out', answer, approved);
          break;
        }
      }
    }
  } catch (e) {
    if (e instanceof BudgetError) return { status: 'budget-exceeded', outputs, trace, memory, toolCalls, stats: { steps, toolCalls: toolCalls.length, estTokens }, validation };
    emit('', 'error', `Runtime error: ${(e as Error).message}`);
    return { status: 'failed', outputs, trace, memory, toolCalls, stats: { steps, toolCalls: toolCalls.length, estTokens }, validation };
  }
  return { status: outputs.length ? 'completed' : 'failed', outputs, trace, memory, toolCalls, stats: { steps, toolCalls: toolCalls.length, estTokens }, validation };
}

// ───────── Acceptance tests for templates / debug challenges

export interface GraphTest {
  name: string;
  input: string;
  expect: { outputIncludes?: string; toolUsed?: string; toolNotUsed?: string; status?: RunResult['status']; maxToolCalls?: number };
  approve?: boolean;
}

export async function runGraphTests(g: Graph, tests: GraphTest[], policy?: Policy) {
  const out: { name: string; passed: boolean; detail: string; run: RunResult }[] = [];
  for (const t of tests) {
    const run = await runGraph(g, t.input, { policy, approve: async () => t.approve ?? false });
    const fails: string[] = [];
    const text = run.outputs.map((o) => o.value).join('\n');
    if (t.expect.status && run.status !== t.expect.status) fails.push(`status was ${run.status}, expected ${t.expect.status}`);
    if (t.expect.outputIncludes && !text.toLowerCase().includes(t.expect.outputIncludes.toLowerCase())) fails.push(`output does not include “${t.expect.outputIncludes}”`);
    if (t.expect.toolUsed && !run.toolCalls.some((c) => c.toolId === t.expect.toolUsed && c.ok)) fails.push(`${t.expect.toolUsed} was not successfully used`);
    if (t.expect.toolNotUsed && run.toolCalls.some((c) => c.toolId === t.expect.toolNotUsed)) fails.push(`${t.expect.toolNotUsed} should not be called`);
    if (t.expect.maxToolCalls !== undefined && run.toolCalls.length > t.expect.maxToolCalls) fails.push(`${run.toolCalls.length} tool calls (max ${t.expect.maxToolCalls})`);
    out.push({ name: t.name, passed: fails.length === 0, detail: fails.length ? fails.join('; ') : 'passed', run });
  }
  return out;
}

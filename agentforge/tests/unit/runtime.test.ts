import { describe, expect, it } from 'vitest';
import { connectionError, runGraph, runGraphTests, validateGraph, type Graph } from '@/core/runtime/agentRuntime';
import { TEMPLATES, templateById } from '@/core/runtime/templates';
import { calculate, searchKB, TOOLS } from '@/core/runtime/tools';
import { exec, initialRepo } from '@/core/runtime/terminalSim';
import { chunkDocs, HANDBOOK, recallAtK, retrieve } from '@/core/runtime/retrieval';
import { teachTokenize } from '@/core/runtime/tokenizer';
import { runHarness } from '@/core/runtime/harness';

const clone = (g: Graph): Graph => JSON.parse(JSON.stringify(g));

describe('tools', () => {
  it('calculator is exact and rejects code', () => {
    expect(calculate('2400000*0.17')).toBe(408000);
    expect(calculate('(2+3)*4^2')).toBe(80);
    expect(calculate('-3+5')).toBe(2);
    expect(() => calculate('alert(1)')).toThrow();
    expect(() => calculate('2+')).toThrow();
  });
  it('search finds stemmed matches', () => {
    expect(searchKB('can I get a refund on my annual plan')[0].id).toBe('kb-refund');
  });
  it('tool schemas reject invalid arguments', () => {
    expect(TOOLS.get_revenue.schema.safeParse({ quarter: 'Q5' }).success).toBe(false);
    expect(TOOLS.send_email.schema.safeParse({ to: 'nope', subject: 'a', body: 'b' }).success).toBe(false);
  });
});

describe('AgentRuntime', () => {
  it('rejects mismatched port types', () => {
    const g = templateById('revenue-agent')!.graph;
    expect(connectionError(g, { source: 'agent', target: 'out', sourceHandle: 'tools', targetHandle: 'in' })).toMatch(/tool/);
    expect(connectionError(g, { source: 'in', target: 'in' })).toMatch(/itself/);
  });
  it('valid templates pass all of their tests', async () => {
    for (const t of TEMPLATES.filter((x) => !x.faulty)) {
      const res = await runGraphTests(t.graph, t.tests);
      expect(res.map((r) => `${t.id}: ${r.name} → ${r.detail}`)).toEqual(t.tests.map((x) => `${t.id}: ${x.name} → passed`));
    }
  });
  it('faulty templates fail their tests until fixed', async () => {
    for (const t of TEMPLATES.filter((x) => x.faulty)) {
      const res = await runGraphTests(t.graph, t.tests);
      expect(res.some((r) => !r.passed)).toBe(true);
    }
  });
  it('fixing the wrong-tool bug makes tests pass', async () => {
    const g = clone(templateById('bug-wrong-tool')!.graph);
    g.nodes.push({ id: 't-order', kind: 'tool', label: 'get_order', position: { x: 0, y: 0 }, config: { toolId: 'get_order' } });
    g.edges.push({ id: 'x', source: 'agent', target: 't-order', sourceHandle: 'tools', targetHandle: 'attach' });
    const res = await runGraphTests(g, templateById('bug-wrong-tool')!.tests);
    expect(res.every((r) => r.passed)).toBe(true);
  });
  it('fixing the runaway agent with a stop condition passes', async () => {
    const g = clone(templateById('bug-no-stop')!.graph);
    g.nodes.find((n) => n.id === 'agent')!.config.stopWhenDone = true;
    expect((await runGraphTests(g, templateById('bug-no-stop')!.tests)).every((r) => r.passed)).toBe(true);
    const g2 = clone(templateById('bug-no-stop')!.graph);
    g2.nodes.find((n) => n.id === 'agent')!.config.loopGuard = true;
    expect((await runGraphTests(g2, templateById('bug-no-stop')!.tests)).every((r) => r.passed)).toBe(true);
  });
  it('unbounded cycles are invalid; adding a Loop node fixes it and terminates', async () => {
    const t = templateById('bug-cycle')!;
    expect(validateGraph(t.graph).ok).toBe(false);
    const g = clone(t.graph);
    g.edges = g.edges.filter((e) => !(e.source === 'val' && e.sourceHandle === 'invalid'));
    g.nodes.push({ id: 'loop', kind: 'loop', label: 'Max 3 revisions', position: { x: 0, y: 0 }, config: { max: 3 } });
    g.nodes.push({ id: 'human', kind: 'output', label: 'Needs human', position: { x: 0, y: 0 }, config: {} });
    g.edges.push({ id: 'a', source: 'val', target: 'loop', sourceHandle: 'invalid', targetHandle: 'in' });
    g.edges.push({ id: 'b', source: 'loop', target: 'agent', sourceHandle: 'body', targetHandle: 'in' });
    g.edges.push({ id: 'c', source: 'loop', target: 'human', sourceHandle: 'exit', targetHandle: 'in' });
    expect(validateGraph(g).ok).toBe(true);
    expect((await runGraphTests(g, t.tests)).every((r) => r.passed)).toBe(true);
  });
  it('global step budget always halts', async () => {
    const g = clone(templateById('bug-no-stop')!.graph);
    const r = await runGraph(g, 'What are your support hours?', { stepBudget: 10 });
    expect(r.status).toBe('budget-exceeded');
    expect(r.trace.at(-1)!.kind).toBe('budget');
  });
  it('trace is ordered and records tool request/response pairs', async () => {
    const r = await runGraph(templateById('revenue-agent')!.graph, 'What is 17% of our Q3 revenue?');
    const kinds = r.trace.map((t) => t.kind);
    expect(r.trace.map((t) => t.seq)).toEqual([...r.trace.keys()]);
    expect(kinds.filter((k) => k === 'tool-request')).toHaveLength(2);
    expect(kinds.indexOf('tool-request')).toBeLessThan(kinds.indexOf('tool-response'));
    expect(r.outputs[0].value).toContain('408,000');
  });
  it('external tools are denied at runtime without approval', async () => {
    const r = await runGraph(templateById('email-approval')!.graph, 'Email jo@client.test that order 1204 has shipped', { approve: async () => false });
    expect(r.toolCalls).toHaveLength(0);
    expect(r.outputs[0].nodeId).toBe('out-no');
  });
});

describe('TerminalSim', () => {
  it('navigates, shows status/diff, and runs tests deterministically', () => {
    let s = initialRepo();
    expect(exec(s, 'pwd').out).toBe('/home/learner/acme-app');
    expect(exec(s, 'ls').out).toContain('src/');
    expect(exec(s, 'ls').out).not.toContain('.env');
    expect(exec(s, 'npm test').out).toContain('failing');
    s = exec(s, 'apply-fix').state;
    expect(exec(s, 'git status').out).toContain('src/total.js');
    expect(exec(s, 'git diff').out).toContain('+  return items.reduce((s, i) => s + i.price * i.qty, 0);');
    expect(exec(s, 'npm test').out).toContain('1 passing');
    s = exec(s, 'git add .').state;
    const c = exec(s, 'git commit -m "Fix total"');
    expect(c.out).toContain('Fix total');
    expect(exec(c.state, 'git status').out).toContain('clean');
    expect(exec(s, 'rm -rf /').out).toContain('disabled');
  });
});

describe('Retrieval', () => {
  const chunks = chunkDocs(HANDBOOK, 2, 1);
  it('chunks with overlap and metadata', () => {
    expect(chunks.length).toBeGreaterThan(HANDBOOK.length);
    expect(chunks.every((c) => c.title && c.docId)).toBe(true);
  });
  it('BM25 finds exact codes; hybrid recall is high', () => {
    expect(retrieve(chunks, 'What is code E-4012?', 'bm25', 1)[0].chunk.docId).toBe('expenses');
    expect(recallAtK(chunks, 'hybrid', 3).recall).toBeGreaterThanOrEqual(0.8);
  });
});

describe('Teaching tokenizer & harness', () => {
  it('tokenizes losslessly', () => {
    const text = 'Unbelievably, tokenization splits rare words!';
    const toks = teachTokenize(text);
    expect(toks.map((t) => t.text).join('')).toBe(text);
    expect(toks.length).toBeGreaterThan(6);
  });
  it('harness reports compile errors and failing tests honestly', async () => {
    const bad = await runHarness('function f( {', ['f'], [{ name: 't', code: 'return m.f() === 1' }]);
    expect(bad.compileError).toBeTruthy();
    expect(bad.results[0].passed).toBe(false);
    const ok = await runHarness('function f(){ console.log("hi"); return 1 }', ['f'], [{ name: 't', code: 'return m.f() === 1' }, { name: 'u', code: 'return m.f() === 2' }]);
    expect(ok.results.map((r) => r.passed)).toEqual([true, false]);
    expect(ok.logs).toContain('hi');
  });
});

import { makeLivePolicy, buildDecisionPrompt, toolDefsFor, TOOL_JSON_SCHEMAS, type ToolCaller } from '@/core/ai/livePolicy';

describe('Live policy (model injected, runtime unchanged)', () => {
  it('every tool has a JSON schema whose keys match its Zod schema', () => {
    for (const id of Object.keys(TOOLS)) {
      const js = TOOL_JSON_SCHEMAS[id] as { properties: Record<string, unknown>; additionalProperties: boolean };
      expect(js, id).toBeTruthy();
      expect(js.additionalProperties).toBe(false);
      const sample: Record<string, unknown> = { expression: '1+1', quarter: 'Q1', query: 'refund', order_id: '991', city: 'Oslo', path: 'README.md', to: 'a@b.co', subject: 's', body: 'b' };
      const args = Object.fromEntries(Object.keys(js.properties).map((k) => [k, sample[k]]));
      expect(TOOLS[id].schema.safeParse(args).success, id).toBe(true);
    }
    expect(toolDefsFor(['calculator', 'calculator', 'nope'])).toHaveLength(1);
  });
  it('drives the real runtime: tool calls execute, history is passed back, final answer returned', async () => {
    const seen: string[] = [];
    const fake: ToolCaller = async ({ user, tools }) => {
      seen.push(user);
      expect(tools.map((t) => t.name).sort()).toEqual(['calculator', 'get_revenue']);
      if (!user.includes('get_revenue(')) return { toolUse: { name: 'get_revenue', input: { quarter: 'Q3' } }, text: 'Need the revenue first.' };
      if (!user.includes('calculator(')) return { toolUse: { name: 'calculator', input: { expression: '2400000*0.17' } }, text: '' };
      return { text: '17% of Q3 revenue is $408,000.' };
    };
    const r = await runGraph(templateById('revenue-agent')!.graph, 'What is 17% of our Q3 revenue?', { policy: makeLivePolicy(fake, 'fake') });
    expect(r.status).toBe('completed');
    expect(r.outputs[0].value).toContain('408,000');
    expect(r.toolCalls.map((c) => c.toolId)).toEqual(['get_revenue', 'calculator']);
    expect(seen[2]).toContain('"revenue":2400000');
  });
  it('invalid model arguments are rejected by the runtime and reported back as errors', async () => {
    let n = 0;
    const fake: ToolCaller = async ({ user }) => (n++ === 0 ? { toolUse: { name: 'get_revenue', input: { quarter: 'Q9' } }, text: '' } : { text: user.includes('ERROR') ? 'saw the error' : 'missed it' });
    const r = await runGraph(templateById('revenue-agent')!.graph, 'revenue?', { policy: makeLivePolicy(fake, 'fake') });
    expect(r.toolCalls[0].ok).toBe(false);
    expect(r.outputs[0].value).toBe('saw the error');
  });
  it('a model that never stops is still bounded by maxSteps', async () => {
    const fake: ToolCaller = async () => ({ toolUse: { name: 'calculator', input: { expression: '1+1' } }, text: '' });
    const g = clone(templateById('revenue-agent')!.graph);
    g.nodes.find((x) => x.id === 'agent')!.config.loopGuard = false;
    const r = await runGraph(g, 'loop', { policy: makeLivePolicy(fake, 'fake') });
    expect(r.toolCalls).toHaveLength(6);
    expect(r.outputs[0].value).toContain('maxSteps');
  });
  it('external tools stay denied without approval even if the model asks', async () => {
    const g = clone(templateById('revenue-agent')!.graph);
    g.nodes.push({ id: 't-mail', kind: 'tool', label: 'send_email', position: { x: 0, y: 0 }, config: { toolId: 'send_email' } });
    g.edges.push({ id: 'm', source: 'agent', target: 't-mail', sourceHandle: 'tools', targetHandle: 'attach' });
    expect(validateGraph(g).ok).toBe(false); // blocked at validation: no approval upstream
  });
  it('prompt marks goal and tool results as data', () => {
    const p = buildDecisionPrompt({ goal: 'x', instructions: 'i', tools: [], observations: {}, errors: {}, calls: [], config: {} });
    expect(p.system).toMatch(/data, not instructions/);
    expect(p.user).toContain('<goal>x</goal>');
  });
});

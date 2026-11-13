// System demos: agent loop (real runtime), RAG (real retrieval), multi-agent scheduler, evaluation observatory, injection.
import { useEffect, useMemo, useState } from 'react';
import { runGraph, type RunResult, type TraceEvent } from '@/core/runtime/agentRuntime';
import { templateById } from '@/core/runtime/templates';
import { chunkDocs, HANDBOOK, recallAtK, retrieve, type Method } from '@/core/runtime/retrieval';
import { INJECTION_DEFENSE } from '@/content/games';
import { Icon, Seg, TruthLabel } from '@/ui/kit';
import { href } from '@/ui/router';

// ───────── Agent loop simulator (events come from the real runtime)
const SCENARIOS = [
  { id: 'ok', label: 'Normal run', template: 'revenue-agent', input: 'What is 17% of our Q3 revenue?' },
  { id: 'ask', label: 'Missing argument', template: 'revenue-agent', input: 'What is 10% of our revenue?' },
  { id: 'loop', label: 'No stop condition', template: 'bug-no-stop', input: 'What are your support hours?' },
  { id: 'retry', label: 'Flaky tool + retry', template: 'weather-retry', input: 'Do I need an umbrella in Oslo?' },
];
const STAGES: { id: string; label: string; kinds: TraceEvent['kind'][] }[] = [
  { id: 'input', label: 'Input', kinds: ['enter'] },
  { id: 'decide', label: 'Decision', kinds: ['decision'] },
  { id: 'req', label: 'Tool request', kinds: ['tool-request'] },
  { id: 'res', label: 'Tool result', kinds: ['tool-response', 'tool-error'] },
  { id: 'state', label: 'State update', kinds: ['state'] },
  { id: 'stop', label: 'Stop check', kinds: ['budget', 'final', 'output'] },
];
export function AgentLoopDemo() {
  const [sc, setSc] = useState(SCENARIOS[0]);
  const [run, setRun] = useState<RunResult | null>(null);
  const [i, setI] = useState(0);
  useEffect(() => {
    let alive = true;
    runGraph(templateById(sc.template)!.graph, sc.input).then((r) => alive && (setRun(r), setI(0)));
    return () => { alive = false; };
  }, [sc]);
  const ev = run?.trace[i];
  const stage = ev ? STAGES.find((s) => s.kinds.includes(ev.kind))?.id : undefined;
  return (
    <div className="card stack">
      <div className="row between"><b>Agent loop simulator</b><span className="row"><TruthLabel kind="executed" detail="Trace produced by the Agent Studio runtime executing real tools." /><TruthLabel kind="simulated" detail="Decisions come from a rule-based teaching policy, not a live model." /></span></div>
      <Seg label="Scenario" value={sc.id} onChange={(id) => setSc(SCENARIOS.find((s) => s.id === id)!)} options={SCENARIOS.map((s) => ({ id: s.id, label: s.label }))} />
      <div className="small muted">Goal: <b>"{sc.input}"</b></div>
      <div className="row" aria-label="Loop stages" style={{ gap: 6 }}>
        {STAGES.map((s, k) => (
          <div key={s.id} className="row nowrap" style={{ gap: 6 }}>
            <span className="chip" style={stage === s.id ? { background: 'var(--accent-2-soft)', color: 'var(--accent-2)', borderColor: 'var(--accent-2)' } : undefined}>{s.label}</span>
            {k < STAGES.length - 1 && <span className="faint">→</span>}
          </div>
        ))}
      </div>
      {run && ev && (
        <>
          <div className="card inset" aria-live="polite">
            <div className="row between"><span className="chip">{ev.kind}</span><span className="tiny faint">event {i + 1} / {run.trace.length}</span></div>
            <p className="mono small" style={{ margin: '10px 0 0', whiteSpace: 'pre-wrap' }}>{ev.message}</p>
          </div>
          <input type="range" min={0} max={run.trace.length - 1} value={i} onChange={(e) => setI(+e.target.value)} aria-label="Scrub through the trace" />
          <div className="row">
            <button className="btn" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}><Icon name="back" /> Step back</button>
            <button className="btn primary" onClick={() => setI(Math.min(run.trace.length - 1, i + 1))} disabled={i >= run.trace.length - 1}>Step <Icon name="arrow" /></button>
            <span className="spacer" />
            <span className="chip">{run.status}</span><span className="chip">{run.stats.toolCalls} tool calls</span><span className="chip">~{run.stats.estTokens} tokens (est.)</span>
          </div>
          {i === run.trace.length - 1 && <div className="callout">{run.outputs.map((o) => o.value).join('\n') || 'No output.'}{sc.id === 'loop' && ' — notice how the agent kept repeating the same action. Fix it in the Agent Studio debug challenge.'}</div>}
          {sc.id === 'loop' && <a className="btn sm" href={href('/studio/bug-no-stop')}>Open this agent in the Studio and fix it</a>}
        </>
      )}
    </div>
  );
}

// ───────── RAG pipeline (real retrieval)
export function RagDemo() {
  const [size, setSize] = useState(2);
  const [overlap, setOverlap] = useState(1);
  const [method, setMethod] = useState<Method>('hybrid');
  const [k, setK] = useState(3);
  const [q, setQ] = useState('How many vacation days do I get?');
  const chunks = useMemo(() => chunkDocs(HANDBOOK, size, Math.min(overlap, size - 1)), [size, overlap]);
  const hits = useMemo(() => retrieve(chunks, q, method, k), [chunks, q, method, k]);
  const evalRes = useMemo(() => recallAtK(chunks, method, k), [chunks, method, k]);
  return (
    <div className="card stack">
      <div className="row between"><b>RAG pipeline · Documents → Chunks → Index → Retrieve → Context</b><TruthLabel kind="executed" detail="Real BM25 and a toy hashed-trigram embedding (not a neural embedding), computed in your browser." /></div>
      <div className="grid g4">
        <label className="field">Sentences per chunk: {size}<input type="range" min={1} max={5} value={size} onChange={(e) => setSize(+e.target.value)} /></label>
        <label className="field">Overlap: {Math.min(overlap, size - 1)}<input type="range" min={0} max={3} value={overlap} onChange={(e) => setOverlap(+e.target.value)} /></label>
        <label className="field">top-k: {k}<input type="range" min={1} max={8} value={k} onChange={(e) => setK(+e.target.value)} /></label>
        <div className="field">Method<Seg label="Retrieval method" value={method} onChange={setMethod} options={[{ id: 'bm25', label: 'BM25' }, { id: 'vector', label: 'Vector' }, { id: 'hybrid', label: 'Hybrid' }]} /></div>
      </div>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Query" />
      <div className="row">{['What is code E-4012?', 'Can I work from home on Fridays?', 'Is there money for my home office?', 'How long is probation?'].map((s) => <button key={s} className="chip" style={{ cursor: 'pointer' }} onClick={() => setQ(s)}>{s}</button>)}</div>
      <div className="small faint">{HANDBOOK.length} documents → {chunks.length} chunks</div>
      <div className="stack sm">
        {hits.map((h) => (
          <div key={h.chunk.id} className="card inset">
            <div className="row between tiny"><b>#{h.rank} · [{h.chunk.id}] {h.chunk.title}</b><span className="mono">score {h.score.toFixed(3)} · bm25 {h.bm25.toFixed(2)} · vec {h.vector.toFixed(2)}</span></div>
            <div className="small" style={{ marginTop: 4 }}>{h.chunk.text}</div>
          </div>
        ))}
        {!hits.length && <div className="empty">No chunk matched — a grounded system should answer "not found".</div>}
      </div>
      <details>
        <summary><b>Retrieval evaluation:</b> recall@{k} = {(evalRes.recall * 100).toFixed(0)}% · MRR {evalRes.mrr.toFixed(2)} on {evalRes.rows.length} labelled questions</summary>
        <div className="table-wrap"><table className="t" style={{ marginTop: 8 }}><thead><tr><th>Question</th><th>Relevant doc</th><th>Hit?</th><th>Rank</th></tr></thead><tbody>
          {evalRes.rows.map((r) => <tr key={r.q}><td>{r.q}</td><td>{r.doc}</td><td style={{ color: r.hit ? 'var(--success)' : 'var(--danger)' }}>{r.hit ? '✓' : '✗'}</td><td>{r.rank ?? '—'}</td></tr>)}
        </tbody></table></div>
        <p className="tiny faint">Compare methods: vector-only struggles with exact codes like E-4012; BM25 struggles with paraphrases ("vacation" vs "leave").</p>
      </details>
    </div>
  );
}

// ───────── Multi-agent orchestration (deterministic list scheduler)
const TASKS = [
  { id: 'plan', label: 'Plan & spec', role: 'Planner', min: 10, deps: [] as string[] },
  { id: 'api', label: 'Backend API', role: 'Backend', min: 25, deps: ['plan'] },
  { id: 'ui', label: 'Frontend UI', role: 'Frontend', min: 30, deps: ['plan'] },
  { id: 'tests', label: 'Integration tests', role: 'Tester', min: 15, deps: ['api', 'ui'] },
  { id: 'review', label: 'Code review', role: 'Reviewer', min: 10, deps: ['tests'] },
  { id: 'docs', label: 'Docs', role: 'Planner', min: 8, deps: ['api'] },
];
export function MultiAgentDemo() {
  const [agents, setAgents] = useState(3);
  const [humanGate, setHumanGate] = useState(true);
  const [shared, setShared] = useState(false);
  const sched = useMemo(() => {
    const done = new Map<string, number>();
    const free = Array(agents).fill(0);
    const rows: { id: string; agent: number; start: number; end: number }[] = [];
    const remaining = [...TASKS];
    while (remaining.length) {
      const ready = remaining.filter((t) => t.deps.every((d) => done.has(d)));
      const t = ready.sort((a, b) => b.min - a.min)[0];
      const earliest = Math.max(0, ...t.deps.map((d) => done.get(d)!));
      const a = free.indexOf(Math.min(...free));
      const start = Math.max(earliest, free[a]) + (shared && t.deps.length > 1 ? 5 : 0);
      const end = start + t.min + (t.id === 'review' && humanGate ? 20 : 0);
      free[a] = end;
      done.set(t.id, end);
      rows.push({ id: t.id, agent: a, start, end });
      remaining.splice(remaining.indexOf(t), 1);
    }
    const total = Math.max(...rows.map((r) => r.end));
    const critical = 10 + 30 + 15 + 10 + (humanGate ? 20 : 0);
    const cost = TASKS.reduce((s, t) => s + t.min, 0) * (1 + (agents - 1) * 0.08) * (shared ? 1.25 : 1);
    return { rows, total, critical, cost };
  }, [agents, humanGate, shared]);
  return (
    <div className="card stack">
      <div className="row between"><b>Multi-agent orchestration lab</b><TruthLabel kind="executed" detail="A deterministic list scheduler over a real task dependency graph. Costs are relative units." /></div>
      <div className="row">
        <label className="field" style={{ minWidth: 200 }}>Parallel agents: {agents}<input type="range" min={1} max={6} value={agents} onChange={(e) => setAgents(+e.target.value)} /></label>
        <label className="switch"><input type="checkbox" checked={humanGate} onChange={(e) => setHumanGate(e.target.checked)} /> Human approval before merge</label>
        <label className="switch"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Shared context (handoff overhead)</label>
      </div>
      <svg viewBox={`0 0 600 ${agents * 34 + 20}`} style={{ width: '100%' }} role="img" aria-label={`Schedule finishes at ${sched.total} minutes`}>
        {Array.from({ length: agents }, (_, a) => <text key={a} x={0} y={a * 34 + 30} fontSize={11} fill="var(--text-3)">Agent {a + 1}</text>)}
        {sched.rows.map((r) => {
          const t = TASKS.find((x) => x.id === r.id)!;
          const x = 60 + (r.start / sched.total) * 530;
          const w = Math.max(18, ((r.end - r.start) / sched.total) * 530 - 2);
          return <g key={r.id}><rect x={x} y={r.agent * 34 + 12} width={w} height={24} rx={6} fill={t.id === 'review' && humanGate ? 'var(--accent-2-soft)' : 'var(--accent-soft)'} stroke={t.id === 'review' && humanGate ? 'var(--accent-2)' : 'var(--accent)'} /><text x={x + 6} y={r.agent * 34 + 28} fontSize={10} fill="var(--text)">{t.label}</text></g>;
        })}
      </svg>
      <div className="row"><span className="chip">Total: {sched.total} min</span><span className="chip">Critical path: {sched.critical} min</span><span className="chip">Relative cost: {sched.cost.toFixed(0)}</span></div>
      <div className="callout small">Beyond 2–3 agents the finish time stops improving — the critical path (plan → UI → tests → review) bounds it — while cost keeps rising. More agents ≠ faster. Shared context adds handoff overhead; isolated context with explicit handoffs is cheaper.</div>
    </div>
  );
}

// ───────── Evaluation observatory (deterministic graders over recorded outputs)
const EVAL_CASES = [
  { input: 'Order #4411 for $120.00 from ACME', gold: { id: '4411', total: 120 } },
  { input: 'Invoice 9002 — total due 75.50 EUR', gold: { id: '9002', total: 75.5 } },
  { input: 'Ref 31: amount $0 (cancelled)', gold: { id: '31', total: 0 } },
  { input: 'Thanks for your purchase! (no number)', gold: { id: null, total: null } },
  { input: 'PO 7777 total: 1,200.00', gold: { id: '7777', total: 1200 } },
  { input: 'Order 52 — $19.99 + $5 shipping = $24.99', gold: { id: '52', total: 24.99 } },
];
const OUTPUTS: Record<'v1' | 'v2', string[]> = {
  v1: ['{"id":"4411","total":120}', 'Sure! {"id":"9002","total":75.5}', '{"id":"31","total":"0"}', '{"id":"0000","total":0}', '{"id":"7777","total":1200}', '{"id":"52","total":19.99}'],
  v2: ['{"id":"4411","total":120}', '{"id":"9002","total":75.5}', '{"id":"31","total":0}', '{"id":null,"total":null}', '{"id":"7777","total":1200}', '{"id":"52","total":19.99}'],
};
function gradeOutput(raw: string, gold: { id: string | null; total: number | null }) {
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch { return { json: false, schema: false, id: false, total: false, category: 'invalid JSON' }; }
  const schema = parsed && typeof parsed === 'object' && 'id' in parsed && 'total' in parsed && (parsed.total === null || typeof parsed.total === 'number') && (parsed.id === null || typeof parsed.id === 'string');
  const id = parsed.id === gold.id;
  const total = parsed.total === gold.total;
  const category = !schema ? 'schema violation' : !id && gold.id === null ? 'hallucinated value' : !total ? 'wrong total' : !id ? 'wrong id' : 'pass';
  return { json: true, schema, id, total, category };
}
export function EvalDemo() {
  const [cfg, setCfg] = useState<'v1' | 'v2'>('v1');
  const rows = EVAL_CASES.map((c, i) => ({ ...c, out: OUTPUTS[cfg][i], g: gradeOutput(OUTPUTS[cfg][i], c.gold) }));
  const pass = rows.filter((r) => r.g.category === 'pass').length;
  const cats = rows.reduce<Record<string, number>>((m, r) => ((m[r.g.category] = (m[r.g.category] ?? 0) + 1), m), {});
  return (
    <div className="card stack">
      <div className="row between"><b>Evaluation observatory</b><span className="row"><TruthLabel kind="demo" detail="Model outputs are pre-recorded examples." /><TruthLabel kind="executed" detail="Graders (JSON parse, schema, exact match) run live in your browser." /></span></div>
      <Seg label="Prompt version" value={cfg} onChange={setCfg} options={[{ id: 'v1', label: 'Prompt v1 ("return JSON")' }, { id: 'v2', label: 'Prompt v2 (schema + null rule + only JSON)' }]} />
      <div className="row"><span className="chip accent">{pass}/{rows.length} pass</span>{Object.entries(cats).filter(([k]) => k !== 'pass').map(([k, v]) => <span key={k} className="chip danger">{k}: {v}</span>)}</div>
      <div className="table-wrap"><table className="t"><thead><tr><th>Input</th><th>Output</th><th>JSON</th><th>Schema</th><th>id</th><th>total</th><th>Category</th></tr></thead><tbody>
        {rows.map((r, i) => <tr key={i}><td className="small">{r.input}</td><td className="mono tiny">{r.out}</td>{(['json', 'schema', 'id', 'total'] as const).map((k) => <td key={k} style={{ color: r.g[k] ? 'var(--success)' : 'var(--danger)' }}>{r.g[k] ? '✓' : '✗'}</td>)}<td className="tiny">{r.g.category}</td></tr>)}
      </tbody></table></div>
      <div className="callout small">v2 fixes format and hallucination failures, but case 6 still fails in both: the model picks the subtotal. That needs a different fix (an example or a rule about totals) — and the eval tells you so.</div>
    </div>
  );
}

// ───────── Injection (lesson version)
export function InjectionDemo() {
  const lvl = INJECTION_DEFENSE[0];
  const [marked, setMarked] = useState<number[]>([]);
  const [def, setDef] = useState<number | null>(null);
  const done = def !== null;
  return (
    <div className="card stack">
      <div className="row between"><b>Find the injected instruction</b><TruthLabel kind="simulated" detail="Harmless, sandboxed scenario. Nothing is sent anywhere." /></div>
      <p className="small muted">{lvl.scenario} Click the segment(s) that try to hijack the assistant.</p>
      <div className="stack sm">{lvl.segments.map((s, i) => (
        <button key={i} className={`opt ${done ? (s.injected ? 'wrong' : '') : ''}`} aria-pressed={marked.includes(i)} onClick={() => !done && setMarked(marked.includes(i) ? marked.filter((x) => x !== i) : [...marked, i])}>{s.text}</button>
      ))}</div>
      <div className="small"><b>Best defence?</b></div>
      <div className="stack sm">{lvl.defenses.map((d, i) => <button key={i} className={`opt ${done ? (d.score === 50 ? 'right' : def === i ? 'wrong' : '') : ''}`} onClick={() => setDef(i)} disabled={done}>{d.text}{done && <span className="tiny" style={{ display: 'block', marginTop: 4 }}>{d.why}</span>}</button>)}</div>
      {done && <div className="callout">Injected segment {lvl.segments.findIndex((s) => s.injected) + 1} {marked.includes(lvl.segments.findIndex((s) => s.injected)) ? '— you found it ✓' : '— you missed it'}. Play more levels in the <a href={href('/arena/injection-defense')}>Arena</a>.</div>}
    </div>
  );
}

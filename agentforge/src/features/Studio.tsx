import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, applyNodeChanges, applyEdgeChanges, type Edge, type Node, type NodeChange, type EdgeChange, type Connection, type NodeProps } from '@xyflow/react';
import { connectionError, portsFor, runGraph, runGraphTests, validateGraph, type GNode, type Graph, type NodeKind, type RunResult } from '@/core/runtime/agentRuntime';
import { TEMPLATES, templateById } from '@/core/runtime/templates';
import { TOOLS, getTool } from '@/core/runtime/tools';
import { useMcp } from '@/core/mcp/session';
import { mcpToolSpec, mcpToolId } from '@/core/mcp/tools';
import { useLearner } from '@/store/learner';
import { Icon, Modal, Seg, Tabs, TruthLabel, useToast } from '@/ui/kit';
import { navigate } from '@/ui/router';
import { callWithTools, providerReady } from '@/core/ai/provider';
import { makeLivePolicy } from '@/core/ai/livePolicy';

const KIND_META: Record<NodeKind, { label: string; group: string; color: string; desc: string }> = {
  input: { label: 'User Input', group: 'Input', color: 'var(--info)', desc: 'Entry point: the user request.' },
  agent: { label: 'AI Agent', group: 'Agents', color: 'var(--violet)', desc: 'Model-in-a-loop that chooses attached tools.' },
  tool: { label: 'Tool', group: 'Tools', color: 'var(--accent-2)', desc: 'Attach to an agent, or run deterministically in the flow.' },
  router: { label: 'Router', group: 'Logic', color: 'var(--accent)', desc: 'Route by regex rules (deterministic).' },
  condition: { label: 'Condition', group: 'Logic', color: 'var(--accent)', desc: 'Branch on whether text contains a value.' },
  loop: { label: 'Loop (max N)', group: 'Logic', color: 'var(--accent)', desc: 'The only legal way to make a cycle — with an explicit limit.' },
  validate: { label: 'Validation', group: 'Logic', color: 'var(--accent)', desc: 'Check output (must contain / max length / JSON).' },
  memory: { label: 'Session Memory', group: 'Memory', color: 'var(--st-review)', desc: 'Write or read a key in run memory.' },
  approval: { label: 'Human Approval', group: 'Agents', color: 'var(--warn)', desc: 'Pause for a person to approve or reject.' },
  output: { label: 'Output', group: 'Output', color: 'var(--success)', desc: 'Collects a result.' },
};

interface FData extends Record<string, unknown> {
  g: GNode;
  status?: 'active' | 'visited' | 'err';
}

const FNode = memo(function FNode({ data, selected }: NodeProps<Node<FData>>) {
  const { g, status } = data;
  const ports = portsFor(g);
  const meta = KIND_META[g.kind];
  const detail = g.kind === 'tool' ? g.config.toolId : g.kind === 'agent' ? `max ${g.config.maxSteps} steps${g.config.loopGuard ? ' · loop guard' : ''}${g.config.stopWhenDone === false ? ' · no stop!' : ''}` : g.kind === 'loop' ? `max ${g.config.max}` : g.kind === 'validate' ? [g.config.mustContain && `contains "${g.config.mustContain}"`, g.config.json && 'JSON', g.config.maxLength && `≤${g.config.maxLength}`].filter(Boolean).join(' · ') : g.kind === 'memory' ? `${g.config.mode ?? 'write'} ${g.config.key ?? 'notes'}` : '';
  return (
    <div className={`fnode ${selected ? 'selected' : ''} ${status ?? ''}`} style={{ borderTop: `3px solid ${meta.color}` }}>
      {ports.inputs.map((p) => (
        <Handle key={p.id} id={p.id} type="target" position={p.type === 'tool' ? Position.Top : Position.Left} className={p.type === 'tool' ? 'tool' : ''} title={p.type === 'tool' ? 'Attach to an agent "tools" port' : 'Flow input'} />
      ))}
      <div className="k">{meta.label}</div>
      <div className="lbl">{g.label}</div>
      {detail && <div className="tiny faint" style={{ marginTop: 2 }}>{detail}</div>}
      {ports.outputs.map((p) => {
        const flowOuts = ports.outputs.filter((x) => x.type === 'flow');
        const fi = flowOuts.indexOf(p);
        return (
          <Handle key={p.id} id={p.id} type="source" position={p.type === 'tool' ? Position.Bottom : Position.Right} className={p.type === 'tool' ? 'tool' : ''}
            style={p.type === 'tool' ? undefined : { top: `${((fi + 1) / (flowOuts.length + 1)) * 100}%` }} title={p.label ?? p.id}>
            {p.label && p.type === 'flow' && flowOuts.length > 1 && <span className="hlabel" style={{ left: 12, top: -6 }}>{p.label}</span>}
            {p.type === 'tool' && <span className="hlabel" style={{ top: 8, left: -10 }}>tools</span>}
          </Handle>
        );
      })}
    </div>
  );
});
const nodeTypes = { f: FNode };

const DEFAULT_CONFIG: Record<NodeKind, Record<string, unknown>> = {
  input: {}, output: {}, approval: {},
  agent: { instructions: 'Use tools; never guess facts.', maxSteps: 6, stopWhenDone: true, loopGuard: true },
  tool: { toolId: 'search_docs', retries: 0 },
  router: { routes: [{ label: 'billing', match: 'refund|invoice|charge' }] },
  condition: { contains: '' },
  loop: { max: 3 },
  validate: { mustContain: '', maxLength: 0, json: false },
  memory: { mode: 'write', key: 'notes' },
};

export default function Studio({ templateId }: { templateId?: string }) {
  const tpl = templateById(templateId ?? '') ?? TEMPLATES[0];
  const saved = useLearner((s) => s.studioGraphs[tpl.id]);
  const saveGraph = useLearner((s) => s.saveGraph);
  const record = useLearner((s) => s.recordEvidence);
  const theme = useLearner((s) => s.settings.theme);
  const { toast } = useToast();
  const mcpConn = useMcp((s) => s.conn);
  const mcpTools = useMemo(() => (mcpConn ? mcpConn.tools.map((t) => mcpToolSpec(mcpConn, t)) : []), [mcpConn]);
  const provider = useLearner((s) => s.provider);
  const liveAvailable = providerReady(provider) && provider.provider === 'anthropic';
  const [mode, setMode] = useState<'rules' | 'live'>('rules');
  const live = mode === 'live' && liveAvailable;
  const [graph, setGraph] = useState<Graph>(() => structuredClone(saved ?? tpl.graph));
  const [sel, setSel] = useState<string | null>(null);
  const [panel, setPanel] = useState<'inspect' | 'run' | 'tests' | 'check'>('run');
  const [input, setInput] = useState(tpl.sampleInput);
  const [run, setRun] = useState<RunResult | null>(null);
  const [cursor, setCursor] = useState(0);
  const [tests, setTests] = useState<Awaited<ReturnType<typeof runGraphTests>> | null>(null);
  const [approval, setApproval] = useState<{ label: string; value: string; resolve: (b: boolean) => void } | null>(null);
  const [running, setRunning] = useState(false);
  const [runLive, setRunLive] = useState(false);
  const measured = useRef<Record<string, { width: number; height: number }>>({});
  const [, setMeasureTick] = useState(0);

  useEffect(() => { setGraph(structuredClone(saved ?? tpl.graph)); setRun(null); setTests(null); setInput(tpl.sampleInput); setSel(null); }, [tpl.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } saveGraph(tpl.id, graph); }, [graph]); // eslint-disable-line react-hooks/exhaustive-deps

  const validation = useMemo(() => validateGraph(graph), [graph]);
  const ev = run?.trace[cursor];
  const visited = useMemo(() => new Set(run?.trace.slice(0, cursor + 1).map((t) => t.nodeId) ?? []), [run, cursor]);
  const errNodes = new Set(validation.errors.map((e) => e.nodeId).filter(Boolean));

  const rfNodes: Node<FData>[] = graph.nodes.map((n) => ({ id: n.id, type: 'f', position: n.position, selected: n.id === sel, measured: measured.current[n.id], data: { g: n, status: ev?.nodeId === n.id ? 'active' : errNodes.has(n.id) ? 'err' : visited.has(n.id) ? 'visited' : undefined } }));
  const rfEdges: Edge[] = graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, className: e.sourceHandle === 'tools' ? 'tool' : '', animated: !!ev && ev.nodeId === e.target && visited.has(e.source), label: e.sourceHandle && !['out', 'tools'].includes(e.sourceHandle) ? graph.nodes.find((n) => n.id === e.source)?.kind === 'router' ? (portsFor(graph.nodes.find((n) => n.id === e.source)!).outputs.find((p) => p.id === e.sourceHandle)?.label) : e.sourceHandle : undefined, labelStyle: { fill: 'var(--text-3)', fontSize: 10 }, labelBgStyle: { fill: 'var(--bg-2)' } }));

  const onNodesChange = useCallback((ch: NodeChange<Node<FData>>[]) => {
    // Cache measurements separately so dimension updates never rebuild the graph (avoids a measure → render loop).
    let newDims = false;
    for (const c of ch) {
      if (c.type === 'dimensions' && c.dimensions) {
        const prev = measured.current[c.id];
        if (!prev || prev.width !== c.dimensions.width || prev.height !== c.dimensions.height) {
          measured.current[c.id] = c.dimensions;
          newDims = true;
        }
      }
    }
    if (newDims) setMeasureTick((t) => t + 1);
    if (ch.some((c) => c.type === 'position' || c.type === 'remove')) {
      const moved = applyNodeChanges(ch.filter((c) => c.type === 'position' || c.type === 'remove'), rfNodes);
      const removed = ch.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id);
      setGraph((g) => ({ nodes: g.nodes.filter((n) => !removed.includes(n.id)).map((n) => ({ ...n, position: moved.find((m) => m.id === n.id)?.position ?? n.position })), edges: g.edges.filter((e) => !removed.includes(e.source) && !removed.includes(e.target)) }));
    }
    const s = ch.find((c) => c.type === 'select' && (c as { selected: boolean }).selected) as { id: string } | undefined;
    if (s) { setSel(s.id); setPanel('inspect'); }
  }, [rfNodes]);
  const onEdgesChange = useCallback((ch: EdgeChange[]) => {
    const next = applyEdgeChanges(ch, rfEdges);
    setGraph((g) => ({ ...g, edges: g.edges.filter((e) => next.some((n) => n.id === e.id)) }));
  }, [rfEdges]);
  const onConnect = useCallback((c: Connection) => {
    const err = connectionError(graph, c);
    if (err) { toast(`Connection rejected: ${err}`); return; }
    setGraph((g) => ({ ...g, edges: [...g.edges, { id: `${c.source}:${c.sourceHandle}->${c.target}:${c.targetHandle}:${Date.now() % 1e5}`, source: c.source!, target: c.target!, sourceHandle: c.sourceHandle, targetHandle: c.targetHandle }] }));
  }, [graph, toast]);
  const isValidConnection = useCallback((c: Connection | Edge) => !connectionError(graph, c as Connection), [graph]);

  const addNode = (kind: NodeKind, toolId?: string) => {
    const id = `${kind}-${Date.now().toString(36)}`;
    const n: GNode = { id, kind, label: toolId ?? KIND_META[kind].label, position: { x: 120 + Math.random() * 200, y: 380 + Math.random() * 60 }, config: { ...structuredClone(DEFAULT_CONFIG[kind]), ...(toolId ? { toolId } : {}) } };
    setGraph((g) => ({ ...g, nodes: [...g.nodes, n] }));
    setSel(id);
    setPanel('inspect');
  };
  const updateNode = (id: string, p: Partial<GNode>) => setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...p, config: { ...n.config, ...(p.config ?? {}) } } : n)) }));

  const approve = (req: { label: string; value: string }) => new Promise<boolean>((resolve) => setApproval({ ...req, resolve }));
  const doRun = async () => {
    setRunning(true);
    setPanel('run');
    const policy = live ? makeLivePolicy((req) => callWithTools(provider, req), provider.model || 'Claude') : undefined;
    const r = await runGraph(graph, input, { approve, policy });
    setRunLive(live);
    setRun(r);
    setCursor(r.trace.length - 1);
    setRunning(false);
  };
  const doTests = async () => {
    setPanel('tests');
    const res = await runGraphTests(graph, tpl.tests);
    setTests(res);
    const score = res.filter((r) => r.passed).length / res.length;
    for (const s of tpl.skills.slice(0, 2)) record({ skillId: s, source: 'exercise', score, difficulty: tpl.level === 'advanced' ? 4 : tpl.level === 'intermediate' ? 3 : 2, hintsUsed: 0, solutionRevealed: false, errorTags: score < 0.7 ? ['incomplete'] : [], gradedBy: 'executed', itemId: `studio:${tpl.id}` }, `Agent Studio tests: ${tpl.title}`);
    toast(`${res.filter((r) => r.passed).length}/${res.length} tests passed${tpl.faulty && score === 1 ? ' — bug fixed!' : ''}`);
  };
  const selNode = graph.nodes.find((n) => n.id === sel);

  return (
    <div className="stack">
      <div className="row between">
        <div className="row">
          <select className="select" style={{ width: 'auto', minWidth: 260 }} value={tpl.id} onChange={(e) => navigate(`/studio/${e.target.value}`)} aria-label="Template">
            <optgroup label="Working templates">{TEMPLATES.filter((t) => !t.faulty).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</optgroup>
            <optgroup label="Debug challenges (broken on purpose)">{TEMPLATES.filter((t) => t.faulty).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</optgroup>
          </select>
          <span className="chip">{tpl.level}</span>
          <TruthLabel kind="executed" detail="The graph really executes: tools run, schemas validate, budgets stop runs." />
          {live
            ? <TruthLabel kind="live" detail={`Agent decisions come from ${provider.model || 'your Claude model'}. Tools, validation, approvals and budgets are still enforced by the runtime. Each agent step is one API call billed to your key.`} />
            : <TruthLabel kind="simulated" detail="Agent decisions come from a deterministic rule-based policy (keyword tool matching), not a live model." />}
          <Seg label="Who makes the agent's decisions" value={live ? 'live' : 'rules'} onChange={(m) => { if (m === 'live' && !liveAvailable) { toast('Connect an Anthropic key in Settings to use live decisions'); navigate('/settings'); return; } setMode(m); }} options={[{ id: 'rules', label: 'Teaching rules' }, { id: 'live', label: 'Live Claude' }]} />
        </div>
        <div className="row">
          <button className="btn ghost sm" onClick={() => { setGraph(structuredClone(tpl.graph)); setRun(null); setTests(null); toast('Template reset'); }}><Icon name="refresh" /> Reset</button>
          <button className="btn" onClick={doTests}><Icon name="check" /> Run tests ({tpl.tests.length})</button>
          <button className="btn primary" onClick={doRun} disabled={running}><Icon name="play" /> {running ? 'Running…' : 'Run'}</button>
        </div>
      </div>
      <div className={`callout small ${tpl.faulty ? 'warn' : ''}`}>{tpl.blurb}{tpl.faulty && tpl.hint && <details style={{ marginTop: 4 }}><summary>Hint</summary>{tpl.hint}</details>}</div>

      <div className="studio">
        <aside className="card panel stack sm" aria-label="Node palette">
          <b>Add nodes</b>
          {(['input', 'agent', 'approval', 'router', 'condition', 'loop', 'validate', 'memory', 'output'] as NodeKind[]).map((k) => (
            <button key={k} className="palette-item" onClick={() => addNode(k)} title={KIND_META[k].desc}><span style={{ width: 8, height: 8, borderRadius: 2, background: KIND_META[k].color }} />{KIND_META[k].label}</button>
          ))}
          <div className="eyebrow" style={{ marginTop: 8 }}>Tools</div>
          {Object.values(TOOLS).map((t) => (
            <button key={t.id} className="palette-item" onClick={() => addNode('tool', t.id)} title={t.description}><span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent-2)' }} /><span className="mono tiny">{t.id}</span>{t.impact === 'external' && <span className="chip danger" style={{ marginLeft: 'auto' }}>high impact</span>}</button>
          ))}
          <div className="eyebrow" style={{ marginTop: 8 }}>MCP tools{mcpConn ? ` · ${mcpConn.serverName}` : ''}</div>
          {mcpTools.length === 0 ? (
            <button className="palette-item" onClick={() => navigate('/lab/mcp')} title="Connect a real MCP server to use its tools here"><span className="tiny faint">Connect a server in MCP Lab →</span></button>
          ) : mcpTools.map((t) => (
            <button key={t.id} className="palette-item" onClick={() => addNode('tool', t.id)} title={t.description}><span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--violet)' }} /><span className="mono tiny">{t.id}</span>{t.impact === 'external' && <span className="chip danger" style={{ marginLeft: 'auto' }}>high impact</span>}</button>
          ))}
          <div className="tiny faint" style={{ marginTop: 8 }}>Connect right-side ports to left-side ports. The agent's square bottom port attaches tools. Select + Backspace deletes.</div>
        </aside>

        <div className="canvas" aria-label="Workflow canvas">
          <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} isValidConnection={isValidConnection} fitView fitViewOptions={{ padding: 0.25 }} colorMode={theme === 'light' ? 'light' : 'dark'} deleteKeyCode={['Backspace', 'Delete']} onPaneClick={() => setSel(null)}>
            <Background gap={22} size={1} color="var(--border)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="card panel stack" style={{ minWidth: 0 }}>
          <Tabs label="Studio panel" value={panel} onChange={setPanel} tabs={[{ id: 'run', label: 'Run' }, { id: 'tests', label: 'Tests' }, { id: 'inspect', label: 'Inspect' }, { id: 'check', label: `Checks${validation.errors.length ? ` (${validation.errors.length})` : ''}` }]} />
          {panel === 'run' && (
            <div className="stack sm">
              <label className="field">Input<textarea className="textarea" style={{ minHeight: 70 }} value={input} onChange={(e) => setInput(e.target.value)} /></label>
              {!run && <div className="tiny faint">Press Run. Every highlighted node and trace line comes from a real execution event.</div>}
              {run && (
                <>
                  <div className="row"><span className={`chip ${run.status === 'completed' ? 'accent' : 'danger'}`}>{run.status}</span><span className="chip">{run.stats.steps} steps</span><span className="chip">{run.stats.toolCalls} tool calls</span><span className="chip" title="Estimated from characters ÷ 4">~{run.stats.estTokens} tok</span><span className={`chip ${runLive ? 'info' : 'violet'}`}>{runLive ? 'decisions: live model' : 'decisions: teaching rules'}</span></div>
                  {run.outputs.map((o) => <div key={o.nodeId} className="callout small"><b>{graph.nodes.find((n) => n.id === o.nodeId)?.label}:</b> {o.value}</div>)}
                  <label className="field">Replay ({cursor + 1}/{run.trace.length})<input type="range" min={0} max={run.trace.length - 1} value={cursor} onChange={(e) => setCursor(+e.target.value)} /></label>
                  <div className="trace" style={{ maxHeight: 340, overflow: 'auto' }}>
                    {run.trace.map((t, k) => (
                      <button key={t.seq} className={`ev k-${t.kind} ${k === cursor ? 'cur' : ''}`} onClick={() => setCursor(k)}>
                        <span className="faint">{String(k + 1).padStart(2, '0')} {t.kind}</span> {graph.nodes.find((n) => n.id === t.nodeId)?.label ? `· ${graph.nodes.find((n) => n.id === t.nodeId)?.label}` : ''}<br />{t.message.slice(0, 220)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {panel === 'tests' && (
            <div className="stack sm">
              {tpl.tests.map((t, i) => {
                const r = tests?.[i];
                return (
                  <div key={t.name} className="card inset">
                    <div className="row between"><b className="small">{t.name}</b>{r && <span className={r.passed ? 'chip accent' : 'chip danger'}>{r.passed ? 'pass' : 'fail'}</span>}</div>
                    <div className="tiny faint mono">input: {t.input}{t.approve !== undefined ? ` · approver: ${t.approve ? 'approve' : 'reject'}` : ''}</div>
                    {r && !r.passed && <div className="tiny" style={{ color: 'var(--danger)', marginTop: 4 }}>{r.detail}</div>}
                    {r && <button className="btn ghost sm" style={{ marginTop: 4 }} onClick={() => { setRun(r.run); setCursor(r.run.trace.length - 1); setPanel('run'); setInput(t.input); }}>Inspect trace</button>}
                  </div>
                );
              })}
              <button className="btn primary" onClick={doTests}>Run tests</button>
              <div className="tiny faint">Results are recorded as evidence for: {tpl.skills.slice(0, 2).join(', ')}. Tests always use the deterministic teaching rules so results are repeatable; use Run to try the same graph with Live Claude.</div>
            </div>
          )}
          {panel === 'inspect' && (selNode ? <Inspector node={selNode} update={(p) => updateNode(selNode.id, p)} remove={() => { setGraph((g) => ({ nodes: g.nodes.filter((n) => n.id !== selNode.id), edges: g.edges.filter((e) => e.source !== selNode.id && e.target !== selNode.id) })); setSel(null); }} /> : <div className="tiny faint">Select a node to edit its configuration.</div>)}
          {panel === 'check' && (
            <div className="stack sm">
              {validation.ok && <div className="callout small">✓ Graph is valid.</div>}
              {validation.errors.map((e, i) => <button key={i} className="callout danger small" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => e.nodeId && (setSel(e.nodeId), setPanel('inspect'))}>✗ {e.message}</button>)}
              {validation.warnings.map((e, i) => <div key={i} className="callout warn small">⚠ {e.message}</div>)}
            </div>
          )}
        </aside>
      </div>
      <Modal open={!!approval} onClose={() => { approval?.resolve(false); setApproval(null); }} title={`Human approval: ${approval?.label ?? ''}`}>
        <p className="small muted">The workflow paused before a high-impact step. Review exactly what will happen.</p>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{approval?.value}</pre>
        <div className="row"><button className="btn primary" onClick={() => { approval?.resolve(true); setApproval(null); }}>Approve</button><button className="btn danger" onClick={() => { approval?.resolve(false); setApproval(null); }}>Reject</button></div>
      </Modal>
    </div>
  );
}

function Inspector({ node, update, remove }: { node: GNode; update: (p: Partial<GNode>) => void; remove: () => void }) {
  const c = node.config;
  const set = (k: string, v: unknown) => update({ config: { [k]: v } });
  const mcpConn = useMcp((s) => s.conn);
  const spec = node.kind === 'tool' ? getTool(c.toolId) : undefined;
  const toolOptions = useMemo(() => [...new Set([...Object.keys(TOOLS), ...(mcpConn ? mcpConn.tools.map((t) => mcpToolId(t.name)) : []), ...(c.toolId ? [String(c.toolId)] : [])])], [mcpConn, c.toolId]);
  return (
    <div className="stack sm">
      <div className="eyebrow">{KIND_META[node.kind].label}</div>
      <div className="tiny faint">{KIND_META[node.kind].desc}</div>
      <label className="field">Label<input className="input" value={node.label} onChange={(e) => update({ label: e.target.value })} /></label>
      {node.kind === 'agent' && (
        <>
          <label className="field">Instructions<textarea className="textarea" style={{ minHeight: 70 }} value={c.instructions ?? ''} onChange={(e) => set('instructions', e.target.value)} /></label>
          <label className="field">Max steps (1–50)<input className="input" type="number" min={1} max={50} value={c.maxSteps ?? 6} onChange={(e) => set('maxSteps', Number(e.target.value))} /></label>
          <label className="switch"><input type="checkbox" checked={c.stopWhenDone !== false} onChange={(e) => set('stopWhenDone', e.target.checked)} /> Stop when goal is met</label>
          <label className="switch"><input type="checkbox" checked={!!c.loopGuard} onChange={(e) => set('loopGuard', e.target.checked)} /> Loop guard (3 identical calls → stop)</label>
        </>
      )}
      {node.kind === 'tool' && (
        <>
          <label className="field">Tool<select className="select" value={c.toolId} onChange={(e) => update({ label: e.target.value, config: { toolId: e.target.value } })}>{toolOptions.map((id) => <option key={id} value={id}>{id}{getTool(id) ? '' : ' (not connected)'}</option>)}</select></label>
          {spec ? <div className="card inset tiny"><div>{spec.description}</div><div className="mono" style={{ marginTop: 6 }}>schema: {spec.schemaText}</div><div style={{ marginTop: 4 }}>impact: <b>{spec.impact}</b>{spec.source ? <> · source: <b>{spec.source}</b></> : null}</div></div>
            : <div className="callout warn tiny">This MCP tool's server is not connected. <a href="#/lab/mcp">Connect it in MCP Lab</a>.</div>}
          {String(c.toolId ?? '').startsWith('mcp__') && (
            <label className="field">Arguments template (flow mode; <code>{'{{input}}'}</code> = incoming text)<textarea className="textarea mono" style={{ minHeight: 56 }} value={c.argsTemplate ?? ''} placeholder={'{"term": "{{input}}"}'} onChange={(e) => set('argsTemplate', e.target.value)} spellCheck={false} /></label>
          )}
          <label className="field">Retries (0–3)<input className="input" type="number" min={0} max={3} value={c.retries ?? 0} onChange={(e) => set('retries', Number(e.target.value))} /></label>
          <label className="field">Simulated failure<select className="select" value={c.failMode ?? 'never'} onChange={(e) => set('failMode', e.target.value)}><option value="never">never</option><option value="first">first attempt fails</option><option value="always">always fails</option></select></label>
        </>
      )}
      {node.kind === 'router' && (
        <div className="stack sm">
          {(c.routes ?? []).map((r: { label: string; match: string }, i: number) => (
            <div key={i} className="row nowrap">
              <input className="input" value={r.label} aria-label="Route label" onChange={(e) => set('routes', c.routes.map((x: object, j: number) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <input className="input mono" value={r.match} aria-label="Route regex" onChange={(e) => set('routes', c.routes.map((x: object, j: number) => (j === i ? { ...x, match: e.target.value } : x)))} />
              <button className="icon-btn" aria-label="Remove route" onClick={() => set('routes', c.routes.filter((_: unknown, j: number) => j !== i))}><Icon name="trash" /></button>
            </div>
          ))}
          <button className="btn sm" onClick={() => set('routes', [...(c.routes ?? []), { label: `route ${(c.routes?.length ?? 0) + 1}`, match: '' }])}><Icon name="plus" /> Add route</button>
        </div>
      )}
      {node.kind === 'condition' && <label className="field">True if text contains<input className="input" value={c.contains ?? ''} onChange={(e) => set('contains', e.target.value)} /></label>}
      {node.kind === 'loop' && <label className="field">Max iterations (1–20)<input className="input" type="number" min={1} max={20} value={c.max ?? 3} onChange={(e) => set('max', Number(e.target.value))} /></label>}
      {node.kind === 'validate' && (
        <>
          <label className="field">Must contain<input className="input" value={c.mustContain ?? ''} onChange={(e) => set('mustContain', e.target.value)} /></label>
          <label className="field">Max length (0 = none)<input className="input" type="number" min={0} value={c.maxLength ?? 0} onChange={(e) => set('maxLength', Number(e.target.value))} /></label>
          <label className="switch"><input type="checkbox" checked={!!c.json} onChange={(e) => set('json', e.target.checked)} /> Must be valid JSON</label>
        </>
      )}
      {node.kind === 'memory' && (
        <>
          <label className="field">Mode<select className="select" value={c.mode ?? 'write'} onChange={(e) => set('mode', e.target.value)}><option value="write">write</option><option value="read">read</option></select></label>
          <label className="field">Key<input className="input" value={c.key ?? 'notes'} onChange={(e) => set('key', e.target.value)} /></label>
        </>
      )}
      <button className="btn danger sm" onClick={remove}><Icon name="trash" /> Delete node</button>
    </div>
  );
}

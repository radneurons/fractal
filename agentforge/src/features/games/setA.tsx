// Games 1–5: Prompt Architect, Agent Rescue, Hallucination Hunter, Context Window Tetris, Tool-Calling Detective.
import { useMemo, useState } from 'react';
import { AGENT_RESCUE, CONTEXT_TETRIS, HALLUCINATION_HUNTER, PROMPT_ARCHITECT, TOOL_DETECTIVE, type ClaimLabel } from '@/content/games';
import { TOOLS } from '@/core/runtime/tools';
import { seededShuffle } from '@/core/engines/assessment';
import { LevelBar, ScoreCard, useGameFinish, useLevel } from './common';
import { Icon, TruthLabel } from '@/ui/kit';

// ───────── 1. Prompt Architect
export function PromptArchitect() {
  const L = useLevel(PROMPT_ARCHITECT.length);
  const lvl = PROMPT_ARCHITECT[L.i];
  return <div className="stack"><LevelBar levels={PROMPT_ARCHITECT} index={L.i} setIndex={L.setI} gameId="prompt-architect" /><PALevelView key={`${lvl.id}-${L.nonce}`} lvl={lvl} index={L.i} onReplay={L.replay} onNext={L.next} /></div>;
}
function PALevelView({ lvl, index, onReplay, onNext }: { lvl: (typeof PROMPT_ARCHITECT)[number]; index: number; onReplay: () => void; onNext?: () => void }) {
  const finish = useGameFinish('prompt-architect');
  const palette = useMemo(() => seededShuffle(lvl.blocks, lvl.id + Math.random()), [lvl]);
  const [picked, setPicked] = useState<string[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const blocks = picked.map((id) => lvl.blocks.find((b) => b.id === id)!);
  const submit = () => {
    const met = lvl.requirements.filter((r) => r.by.some((b) => picked.includes(b))).length;
    const harmful = blocks.filter((b) => b.effect === 'harmful').length;
    const irrelevant = blocks.filter((b) => b.effect === 'irrelevant').length;
    setScore(finish(lvl.id, index, (100 * met) / lvl.requirements.length - 15 * harmful - 5 * irrelevant));
  };
  const move = (i: number, d: number) => { const n = [...picked]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setPicked(n); };
  return (
    <div className="stack">
      <div className="card"><b>{lvl.title}</b><p className="small muted" style={{ margin: '4px 0 0' }}>{lvl.task}</p></div>
      <div className="grid g2">
        <div className="card stack sm">
          <b>Block palette</b>
          {palette.filter((b) => !picked.includes(b.id)).map((b) => (
            <button key={b.id} className="palette-item" disabled={score !== null} onClick={() => setPicked([...picked, b.id])}><span className="chip">{b.kind}</span><span style={{ flex: 1 }}>{b.text}</span><Icon name="plus" size={14} /></button>
          ))}
        </div>
        <div className="card stack sm">
          <b>Your prompt</b>
          {!blocks.length && <div className="empty small">Add blocks from the palette.</div>}
          {blocks.map((b, i) => (
            <div key={b.id} className="order-row" style={score !== null ? { borderColor: b.effect === 'good' ? 'var(--success)' : 'var(--danger)' } : undefined}>
              <span style={{ flex: 1 }} className="small">{b.text}{score !== null && <span className="tiny" style={{ display: 'block', color: b.effect === 'good' ? 'var(--success)' : 'var(--danger)' }}>{b.feedback}</span>}</span>
              {score === null && <span className="row nowrap" style={{ gap: 2 }}><button className="icon-btn" aria-label="Move up" onClick={() => move(i, -1)}>▲</button><button className="icon-btn" aria-label="Move down" onClick={() => move(i, 1)}>▼</button><button className="icon-btn" aria-label="Remove block" onClick={() => setPicked(picked.filter((x) => x !== b.id))}><Icon name="close" /></button></span>}
            </div>
          ))}
          <div className="eyebrow" style={{ marginTop: 8 }}>Requirements</div>
          {lvl.requirements.map((r) => <div key={r.id} className="small">{score !== null ? (r.by.some((b) => picked.includes(b)) ? '✓' : '✗') : '○'} {r.label}</div>)}
          {score === null && <button className="btn primary" onClick={submit} disabled={!picked.length}>Evaluate prompt</button>}
        </div>
      </div>
      {score !== null && <ScoreCard score={score} onReplay={onReplay} onNext={onNext}><p className="small" style={{ margin: '6px 0 0' }}>Harmful blocks cost 15, irrelevant cost 5. Good prompts are complete, not long.</p></ScoreCard>}
    </div>
  );
}

// ───────── 2. Agent Rescue
export function AgentRescue() {
  const L = useLevel(AGENT_RESCUE.length);
  const lvl = AGENT_RESCUE[L.i];
  return <div className="stack"><LevelBar levels={AGENT_RESCUE} index={L.i} setIndex={L.setI} gameId="agent-rescue" /><RescueView key={`${lvl.id}-${L.nonce}`} lvl={lvl} index={L.i} onReplay={L.replay} onNext={L.next} /></div>;
}
function Trace({ steps }: { steps: { kind: string; text: string }[] }) {
  return <div className="trace">{steps.map((s, i) => <div key={i} className={`ev k-${s.kind}`}><span className="faint">{String(i + 1).padStart(2, '0')} {s.kind}</span><br />{s.text}</div>)}</div>;
}
function RescueView({ lvl, index, onReplay, onNext }: { lvl: (typeof AGENT_RESCUE)[number]; index: number; onReplay: () => void; onNext?: () => void }) {
  const finish = useGameFinish('agent-rescue');
  const causes = useMemo(() => seededShuffle(lvl.causes, lvl.id + 'c'), [lvl]);
  const fixes = useMemo(() => seededShuffle(lvl.fixes, lvl.id + 'f'), [lvl]);
  const [wrong, setWrong] = useState(0);
  const [cause, setCause] = useState<number | null>(null);
  const [fix, setFix] = useState<number | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const causeOk = cause !== null && causes[cause].correct;
  const tryCause = (i: number) => { setCause(i); if (!causes[i].correct) setWrong((w) => w + 1); };
  const tryFix = (i: number) => {
    setFix(i);
    if (!fixes[i].correct) { setWrong((w) => w + 1); return; }
    setScore(finish(lvl.id, index, 100 - wrong * 10));
  };
  return (
    <div className="stack">
      <div className="card"><b>{lvl.title}</b><p className="small muted" style={{ margin: '4px 0 0' }}>{lvl.goal}</p></div>
      <div className="grid g2">
        <div className="card stack sm"><div className="row between"><b>Failing trace</b><TruthLabel kind="demo" detail="Authored trace of a realistic failure." /></div><Trace steps={lvl.trace} /></div>
        <div className="card stack sm">
          <b>1 · Root cause</b>
          {causes.map((c, i) => <button key={i} className={`opt ${cause === i ? (c.correct ? 'right' : 'wrong') : ''}`} disabled={causeOk} onClick={() => tryCause(i)}>{c.text}{cause === i && <span className="tiny" style={{ display: 'block', marginTop: 4 }}>{c.why}</span>}</button>)}
          {causeOk && (<>
            <b style={{ marginTop: 8 }}>2 · Fix</b>
            {fixes.map((f, i) => <button key={i} className={`opt ${fix === i ? (f.correct ? 'right' : 'wrong') : ''}`} disabled={score !== null} onClick={() => tryFix(i)}>{f.text}{fix === i && <span className="tiny" style={{ display: 'block', marginTop: 4 }}>{f.why}</span>}</button>)}
          </>)}
        </div>
      </div>
      {score !== null && (
        <>
          <div className="card stack sm"><b>Re-run with the fix applied</b><Trace steps={lvl.fixedTrace} /></div>
          <ScoreCard score={score} onReplay={onReplay} onNext={onNext}><p className="small" style={{ margin: '6px 0 0' }}>{wrong} wrong attempt{wrong === 1 ? '' : 's'} (−10 each).</p></ScoreCard>
        </>
      )}
    </div>
  );
}

// ───────── 3. Hallucination Hunter
export function HallucinationHunter() {
  const L = useLevel(HALLUCINATION_HUNTER.length);
  const lvl = HALLUCINATION_HUNTER[L.i];
  return <div className="stack"><LevelBar levels={HALLUCINATION_HUNTER} index={L.i} setIndex={L.setI} gameId="hallucination-hunter" /><HHView key={`${lvl.id}-${L.nonce}`} lvl={lvl} index={L.i} onReplay={L.replay} onNext={L.next} /></div>;
}
function HHView({ lvl, index, onReplay, onNext }: { lvl: (typeof HALLUCINATION_HUNTER)[number]; index: number; onReplay: () => void; onNext?: () => void }) {
  const finish = useGameFinish('hallucination-hunter');
  const [labels, setLabels] = useState<Record<number, ClaimLabel>>({});
  const [cites, setCites] = useState<Record<number, number | null>>({});
  const [score, setScore] = useState<number | null>(null);
  const possible = lvl.claims.reduce((s, c) => s + 1 + (c.cite !== null ? 1 : 0), 0);
  const submit = () => {
    let pts = 0;
    lvl.claims.forEach((c, i) => {
      if (labels[i] === c.label) pts++;
      if (c.cite !== null && cites[i] === c.cite) pts++;
    });
    setScore(finish(lvl.id, index, (100 * pts) / possible));
  };
  return (
    <div className="stack">
      <div className="card"><b>{lvl.title}</b><p className="small muted" style={{ margin: '4px 0 0' }}>Question: {lvl.question} Label each claim in the AI answer and cite the source sentence. Points need evidence — guessing the label alone earns half.</p></div>
      <div className="grid g2">
        <div className="card stack sm">
          <b>Source</b>
          {lvl.source.map((s, i) => <div key={i} className="small"><span className="chip mono">S{i + 1}</span> {s}</div>)}
        </div>
        <div className="card stack">
          <b>AI answer — claims</b>
          {lvl.claims.map((c, i) => (
            <div key={i} className="card inset stack sm" style={score !== null ? { borderColor: labels[i] === c.label ? 'var(--success)' : 'var(--danger)' } : undefined}>
              <div className="small">“{c.text}”</div>
              <div className="row">
                {(['supported', 'unsupported', 'contradicted'] as ClaimLabel[]).map((l) => <button key={l} className={`btn sm ${labels[i] === l ? 'primary' : ''}`} aria-pressed={labels[i] === l} disabled={score !== null} onClick={() => setLabels({ ...labels, [i]: l })}>{l}</button>)}
                <select className="select" style={{ width: 'auto' }} value={cites[i] ?? ''} disabled={score !== null} onChange={(e) => setCites({ ...cites, [i]: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Cite source sentence">
                  <option value="">no citation</option>{lvl.source.map((_, k) => <option key={k} value={k}>S{k + 1}</option>)}
                </select>
              </div>
              {score !== null && <div className="tiny">Answer: <b>{c.label}</b>{c.cite !== null ? ` (S${c.cite + 1})` : ' — nothing in the source supports it'}</div>}
            </div>
          ))}
          {score === null && <button className="btn primary" onClick={submit} disabled={Object.keys(labels).length < lvl.claims.length}>Submit labels</button>}
        </div>
      </div>
      {score !== null && <ScoreCard score={score} onReplay={onReplay} onNext={onNext} />}
    </div>
  );
}

// ───────── 4. Context Window Tetris
export function ContextTetris() {
  const L = useLevel(CONTEXT_TETRIS.length);
  const lvl = CONTEXT_TETRIS[L.i];
  return <div className="stack"><LevelBar levels={CONTEXT_TETRIS} index={L.i} setIndex={L.setI} gameId="context-tetris" /><CTView key={`${lvl.id}-${L.nonce}`} lvl={lvl} index={L.i} onReplay={L.replay} onNext={L.next} /></div>;
}
function CTView({ lvl, index, onReplay, onNext }: { lvl: (typeof CONTEXT_TETRIS)[number]; index: number; onReplay: () => void; onNext?: () => void }) {
  const finish = useGameFinish('context-tetris');
  const [on, setOn] = useState<string[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const chosen = lvl.chunks.filter((c) => on.includes(c.id));
  const used = chosen.reduce((s, c) => s + c.tokens, 0);
  const facts = new Set(chosen.map((c) => c.fact).filter(Boolean));
  const missing = lvl.required.filter((f) => !facts.has(f));
  const redundant = chosen.filter((c) => c.redundantWith && on.includes(c.redundantWith)).length;
  const submit = () => {
    const s = used > lvl.budget || missing.length ? 0 : 70 + 30 * ((lvl.budget - used) / lvl.budget) - 10 * redundant;
    setScore(finish(lvl.id, index, s));
  };
  return (
    <div className="stack">
      <div className="card"><b>{lvl.title}</b><p className="small muted" style={{ margin: '4px 0 0' }}>{lvl.task} Budget: <b>{lvl.budget.toLocaleString()} tokens</b>.</p></div>
      <div className="bar" style={{ height: 14 }} role="meter" aria-valuenow={used} aria-valuemin={0} aria-valuemax={lvl.budget} aria-label="Tokens used"><span style={{ width: `${Math.min(100, (used / lvl.budget) * 100)}%`, background: used > lvl.budget ? 'var(--danger)' : 'var(--accent)' }} /></div>
      <div className="small">{used.toLocaleString()} / {lvl.budget.toLocaleString()} tokens {used > lvl.budget && <b style={{ color: 'var(--danger)' }}>— over budget</b>}</div>
      <div className="grid g2">
        {lvl.chunks.map((c) => (
          <button key={c.id} className={`opt ${score !== null ? (c.fact && lvl.required.includes(c.fact) && on.includes(c.id) ? 'right' : on.includes(c.id) && (!c.fact || c.redundantWith) ? 'wrong' : '') : ''}`} aria-pressed={on.includes(c.id)} disabled={score !== null} onClick={() => setOn(on.includes(c.id) ? on.filter((x) => x !== c.id) : [...on, c.id])}>
            <span className="key">{on.includes(c.id) ? '✓' : ''}</span><span style={{ flex: 1 }}>{c.text}</span><span className="mono tiny">{c.tokens.toLocaleString()}</span>
          </button>
        ))}
      </div>
      {score === null ? <button className="btn primary" onClick={submit} disabled={!on.length}>Send to the model</button> : (
        <ScoreCard score={score} onReplay={onReplay} onNext={onNext}>
          <p className="small" style={{ margin: '6px 0 0' }}>{used > lvl.budget ? 'Over budget: the request would fail.' : missing.length ? `Missing required information (${missing.join(', ')}): the model would have to guess.` : `All required facts present. ${redundant ? `${redundant} redundant chunk(s) wasted space.` : 'No redundancy.'}`}</p>
        </ScoreCard>
      )}
    </div>
  );
}

// ───────── 5. Tool-Calling Detective (tools really execute)
export function ToolDetective() {
  const L = useLevel(TOOL_DETECTIVE.length);
  const lvl = TOOL_DETECTIVE[L.i];
  return <div className="stack"><LevelBar levels={TOOL_DETECTIVE} index={L.i} setIndex={L.setI} gameId="tool-detective" /><TDView key={`${lvl.id}-${L.nonce}`} lvl={lvl} index={L.i} onReplay={L.replay} onNext={L.next} /></div>;
}
function TDView({ lvl, index, onReplay, onNext }: { lvl: (typeof TOOL_DETECTIVE)[number]; index: number; onReplay: () => void; onNext?: () => void }) {
  const finish = useGameFinish('tool-detective');
  const [tool, setTool] = useState<string | null>(null);
  const [args, setArgs] = useState('{\n  \n}');
  const [argTries, setArgTries] = useState(0);
  const [argErr, setArgErr] = useState('');
  const [pred, setPred] = useState<number | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const preds = useMemo(() => seededShuffle(lvl.predictions, lvl.id), [lvl]);
  const execute = () => {
    if (!tool || pred === null) return;
    const spec = TOOLS[tool];
    let parsed: unknown;
    try { parsed = JSON.parse(args); } catch (e) { setArgErr(`Invalid JSON: ${(e as Error).message}`); setArgTries((t) => t + 1); return; }
    const v = spec.schema.safeParse(parsed);
    if (!v.success) { setArgErr(`Schema validation failed: ${v.error.issues.map((i) => `${i.path.join('.') || 'args'} ${i.message}`).join('; ')}`); setArgTries((t) => t + 1); return; }
    setArgErr('');
    let out: string;
    try { out = JSON.stringify(spec.run(v.data, { attempt: 1 })); } catch (e) { out = `error: ${(e as Error).message}`; }
    setResult(out);
    const toolPts = tool === lvl.correctTool ? 40 : 0;
    const argPts = tool === lvl.correctTool ? (argTries === 0 ? 40 : 20) : 0;
    const predPts = preds[pred].correct && tool === lvl.correctTool ? 20 : 0;
    setScore(finish(lvl.id, index, toolPts + argPts + predPts));
  };
  return (
    <div className="stack">
      <div className="card"><b>{lvl.title}</b><p className="small muted" style={{ margin: '4px 0 0' }}>Goal: <b>{lvl.goal}</b></p></div>
      <div className="grid g3">
        <div className="card stack sm">
          <b>1 · Choose a tool</b>
          {lvl.tools.map((t) => <button key={t} className="opt" aria-pressed={tool === t} disabled={score !== null} onClick={() => setTool(t)} style={{ flexDirection: 'column' }}><span className="mono"><b>{t}</b></span><span className="tiny faint">{TOOLS[t].description}</span><span className="tiny mono">{TOOLS[t].schemaText}</span></button>)}
        </div>
        <div className="card stack sm">
          <b>2 · Arguments (JSON)</b>
          <textarea className="textarea code" value={args} onChange={(e) => setArgs(e.target.value)} disabled={score !== null} aria-label="Tool arguments JSON" />
          {argErr && <div className="callout danger tiny">{argErr}</div>}
          <div className="tiny faint">Validated against the tool's real schema before it runs.</div>
        </div>
        <div className="card stack sm">
          <b>3 · Predict the result</b>
          {preds.map((p, i) => <button key={i} className={`opt ${score !== null ? (p.correct ? 'right' : pred === i ? 'wrong' : '') : ''}`} aria-pressed={pred === i} disabled={score !== null} onClick={() => setPred(i)}>{p.text}</button>)}
          {score === null && <button className="btn primary" disabled={!tool || pred === null} onClick={execute}><Icon name="play" /> Execute tool</button>}
          {result && <div className="stack sm"><div className="row between"><b className="small">Tool result</b><TruthLabel kind="executed" /></div><pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{result}</pre></div>}
        </div>
      </div>
      {score !== null && <ScoreCard score={score} onReplay={onReplay} onNext={onNext}><p className="small" style={{ margin: '6px 0 0' }}>{tool === lvl.correctTool ? 'Right tool.' : `The best tool was ${lvl.correctTool}.`} {argTries ? `${argTries} invalid argument attempt(s).` : ''}</p></ScoreCard>}
    </div>
  );
}

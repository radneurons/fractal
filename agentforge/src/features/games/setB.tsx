// Games 6–10: Debug the Agent, Prompt Injection Defense, Architecture Forge, Token Budget Commander, AI Incident Room.
import { lazy, Suspense, useMemo, useState } from 'react';
import { ARCHITECTURE_FORGE, DEBUG_AGENT, INCIDENT_ROOM, INJECTION_DEFENSE, TOKEN_COMMANDER, simulateConfig, type Knobs } from '@/content/games';
import { runInSandbox, type SandboxRun } from '@/core/runtime/sandbox';
import { seededShuffle } from '@/core/engines/assessment';
import { LevelBar, ScoreCard, useGameFinish, useLevel } from './common';
import { Icon, Seg, TruthLabel } from '@/ui/kit';

const CodeEditor = lazy(() => import('@/ui/CodeEditor'));

// ───────── 6. Debug the Agent (real tests in the sandbox)
export function DebugAgent() {
  const L = useLevel(DEBUG_AGENT.length);
  const lvl = DEBUG_AGENT[L.i];
  return <div className="stack"><LevelBar levels={DEBUG_AGENT} index={L.i} setIndex={L.setI} gameId="debug-agent" /><DAView key={`${lvl.id}-${L.nonce}`} lvl={lvl} index={L.i} onReplay={L.replay} onNext={L.next} /></div>;
}
function DAView({ lvl, index, onReplay, onNext }: { lvl: (typeof DEBUG_AGENT)[number]; index: number; onReplay: () => void; onNext?: () => void }) {
  const finish = useGameFinish('debug-agent');
  const [code, setCode] = useState(lvl.starter);
  const [run, setRun] = useState<SandboxRun | null>(null);
  const [hints, setHints] = useState(0);
  const [score, setScore] = useState<number | null>(null);
  const exec = async (submit: boolean) => {
    const r = await runInSandbox(code, lvl.exports, lvl.tests);
    setRun(r);
    if (submit) setScore(finish(lvl.id, index, (100 * r.passed) / r.total - (hints ? 10 : 0), hints));
  };
  return (
    <div className="stack">
      <div className="card"><b>{lvl.title}</b><p className="small muted" style={{ margin: '4px 0 0' }}>{lvl.brief}</p></div>
      <Suspense fallback={<textarea className="textarea code" value={code} onChange={(e) => setCode(e.target.value)} />}><CodeEditor value={code} onChange={setCode} height="280px" label="Agent code" /></Suspense>
      <div className="row">
        <button className="btn" onClick={() => exec(false)}><Icon name="play" /> Run tests</button>
        <button className="btn primary" onClick={() => exec(true)} disabled={score !== null}><Icon name="check" /> Submit fix</button>
        {hints < lvl.hints.length && <button className="btn ghost sm" onClick={() => setHints(hints + 1)}><Icon name="hint" /> Hint (−10)</button>}
        <TruthLabel kind="executed" />
      </div>
      {lvl.hints.slice(0, hints).map((h) => <div key={h} className="hint">{h}</div>)}
      {run && (
        <div className="card inset">
          <b>{run.timedOut ? '⏱ Timed out' : `${run.passed}/${run.total} tests passed`}</b>
          {run.compileError && <pre style={{ color: 'var(--danger)' }}>{run.compileError}</pre>}
          {run.results.map((r) => <div key={r.name} className="test-row"><span className={r.passed ? 'pass' : 'fail'}>{r.passed ? '✓' : '✗'}</span>{r.name}{!r.passed && <span className="tiny faint mono">— {r.error}</span>}</div>)}
        </div>
      )}
      {score !== null && <ScoreCard score={score} onReplay={onReplay} onNext={onNext} />}
    </div>
  );
}

// ───────── 7. Prompt Injection Defense
export function InjectionDefense() {
  const L = useLevel(INJECTION_DEFENSE.length);
  const lvl = INJECTION_DEFENSE[L.i];
  return <div className="stack"><LevelBar levels={INJECTION_DEFENSE} index={L.i} setIndex={L.setI} gameId="injection-defense" /><IDView key={`${lvl.id}-${L.nonce}`} lvl={lvl} index={L.i} onReplay={L.replay} onNext={L.next} /></div>;
}
function IDView({ lvl, index, onReplay, onNext }: { lvl: (typeof INJECTION_DEFENSE)[number]; index: number; onReplay: () => void; onNext?: () => void }) {
  const finish = useGameFinish('injection-defense');
  const defs = useMemo(() => seededShuffle(lvl.defenses, lvl.id), [lvl]);
  const [marked, setMarked] = useState<number[]>([]);
  const [def, setDef] = useState<number | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const submit = () => {
    const tp = lvl.segments.filter((s, i) => s.injected && marked.includes(i)).length;
    const fp = lvl.segments.filter((s, i) => !s.injected && marked.includes(i)).length;
    const fn = lvl.segments.filter((s, i) => s.injected && !marked.includes(i)).length;
    const f1 = tp ? (2 * tp) / (2 * tp + fp + fn) : 0;
    setScore(finish(lvl.id, index, 50 * f1 + (def !== null ? defs[def].score : 0)));
  };
  return (
    <div className="stack">
      <div className="card"><div className="row between"><b>{lvl.title}</b><TruthLabel kind="simulated" detail="Harmless sandboxed scenario — nothing is executed." /></div><p className="small muted" style={{ margin: '4px 0 0' }}>{lvl.scenario}</p></div>
      <div className="grid g2">
        <div className="card stack sm">
          <b>1 · Untrusted content — mark the injected segment(s)</b>
          {lvl.segments.map((s, i) => <button key={i} className={`opt mono small ${score !== null ? (s.injected ? (marked.includes(i) ? 'right' : 'wrong') : marked.includes(i) ? 'wrong' : '') : ''}`} aria-pressed={marked.includes(i)} disabled={score !== null} onClick={() => setMarked(marked.includes(i) ? marked.filter((x) => x !== i) : [...marked, i])}>{s.text}</button>)}
        </div>
        <div className="card stack sm">
          <b>2 · Choose the most robust defence</b>
          {defs.map((d, i) => <button key={i} className={`opt ${score !== null ? (d.score === 50 ? 'right' : def === i ? 'wrong' : '') : ''}`} aria-pressed={def === i} disabled={score !== null} onClick={() => setDef(i)}>{d.text}{score !== null && <span className="tiny" style={{ display: 'block', marginTop: 4 }}>{d.score}/50 — {d.why}</span>}</button>)}
          {score === null && <button className="btn primary" disabled={def === null || !marked.length} onClick={submit}>Submit</button>}
        </div>
      </div>
      {score !== null && <ScoreCard score={score} onReplay={onReplay} onNext={onNext}><p className="small" style={{ margin: '6px 0 0' }}>Prompts alone are a partial defence. Robust designs make a successful injection harmless: least privilege, code-enforced limits, confirmation.</p></ScoreCard>}
    </div>
  );
}

// ───────── 8. Architecture Forge
export function ArchitectureForge() {
  const L = useLevel(ARCHITECTURE_FORGE.length);
  const lvl = ARCHITECTURE_FORGE[L.i];
  return <div className="stack"><LevelBar levels={ARCHITECTURE_FORGE} index={L.i} setIndex={L.setI} gameId="architecture-forge" /><AFView key={`${lvl.id}-${L.nonce}`} lvl={lvl} index={L.i} onReplay={L.replay} onNext={L.next} /></div>;
}
function AFView({ lvl, index, onReplay, onNext }: { lvl: (typeof ARCHITECTURE_FORGE)[number]; index: number; onReplay: () => void; onNext?: () => void }) {
  const finish = useGameFinish('architecture-forge');
  const [on, setOn] = useState<string[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const chosen = lvl.components.filter((c) => on.includes(c.id));
  const covered = new Set(chosen.flatMap((c) => c.provides));
  const anti = chosen.filter((c) => c.antiPattern);
  const cats = [...new Set(lvl.components.map((c) => c.category))];
  const submit = () => {
    const cov = lvl.capabilities.filter((c) => covered.has(c.id)).length / lvl.capabilities.length;
    setScore(finish(lvl.id, index, 100 * cov - 10 * anti.length - 3 * Math.max(0, chosen.length - lvl.softLimit)));
  };
  return (
    <div className="stack">
      <div className="card"><b>{lvl.title}</b><p className="small muted" style={{ margin: '4px 0 0' }}>{lvl.requirement} Soft limit: {lvl.softLimit} components. Several designs can score 100.</p></div>
      <div className="grid g-2-1">
        <div className="card stack">
          {cats.map((cat) => (
            <div key={cat}>
              <div className="eyebrow">{cat}</div>
              <div className="row">{lvl.components.filter((c) => c.category === cat).map((c) => (
                <button key={c.id} className={`btn sm ${on.includes(c.id) ? 'primary' : ''}`} aria-pressed={on.includes(c.id)} disabled={score !== null} onClick={() => setOn(on.includes(c.id) ? on.filter((x) => x !== c.id) : [...on, c.id])} style={score !== null && c.antiPattern && on.includes(c.id) ? { background: 'var(--danger)', color: '#fff' } : undefined}>{c.label}</button>
              ))}</div>
            </div>
          ))}
        </div>
        <div className="card stack sm">
          <b>Rubric · capabilities</b>
          {lvl.capabilities.map((c) => <div key={c.id} className="small" style={{ color: covered.has(c.id) ? 'var(--success)' : undefined }}>{covered.has(c.id) ? '✓' : '○'} {c.label}</div>)}
          <div className="tiny faint">{chosen.length} component(s) selected</div>
          {score === null ? <button className="btn primary" onClick={submit} disabled={!on.length}>Submit design</button> : (
            <div className="stack sm">
              {anti.map((a) => <div key={a.id} className="callout danger tiny">✗ {a.label}: {a.antiPattern}</div>)}
            </div>
          )}
        </div>
      </div>
      {score !== null && <ScoreCard score={score} onReplay={onReplay} onNext={onNext} />}
    </div>
  );
}

// ───────── 9. Token Budget Commander (transparent simulated cost/quality model)
export function TokenCommander() {
  const L = useLevel(TOKEN_COMMANDER.length);
  const lvl = TOKEN_COMMANDER[L.i];
  return <div className="stack"><LevelBar levels={TOKEN_COMMANDER} index={L.i} setIndex={L.setI} gameId="token-commander" /><TBView key={`${lvl.id}-${L.nonce}`} lvl={lvl} index={L.i} onReplay={L.replay} onNext={L.next} /></div>;
}
function TBView({ lvl, index, onReplay, onNext }: { lvl: (typeof TOKEN_COMMANDER)[number]; index: number; onReplay: () => void; onNext?: () => void }) {
  const finish = useGameFinish('token-commander');
  const [kn, setKn] = useState<Knobs>({ tier: 'large', k: 8, compress: false, cache: false, maxOut: 800 });
  const [score, setScore] = useState<number | null>(null);
  const sim = simulateConfig(lvl, kn);
  const pass = sim.quality >= lvl.targetQuality && sim.daily <= lvl.budget;
  const submit = () => {
    const s = !pass ? Math.max(0, 40 - Math.max(0, lvl.targetQuality - sim.quality) * 4 - Math.max(0, (sim.daily - lvl.budget) / lvl.budget) * 40) : 70 + 15 * Math.min(1, (lvl.budget - sim.daily) / lvl.budget) + 15 * Math.min(1, (sim.quality - lvl.targetQuality) / 8);
    setScore(finish(lvl.id, index, s));
  };
  return (
    <div className="stack">
      <div className="card"><div className="row between"><b>{lvl.title}</b><TruthLabel kind="simulated" detail="Illustrative cost/quality model — formula shown below. Real numbers must be measured with your provider." /></div><p className="small muted" style={{ margin: '4px 0 0' }}>{lvl.scenario} Target quality ≥ <b>{lvl.targetQuality}</b>, budget ≤ <b>${lvl.budget}/day</b>.</p></div>
      <div className="grid g2">
        <div className="card stack">
          <div className="field">Model tier<Seg label="Model tier" value={kn.tier} onChange={(tier) => setKn({ ...kn, tier })} options={[{ id: 'small', label: 'Small' }, { id: 'medium', label: 'Medium' }, { id: 'large', label: 'Large' }]} /></div>
          <label className="field">Retrieved chunks (k): {kn.k}<input type="range" min={0} max={10} value={kn.k} onChange={(e) => setKn({ ...kn, k: +e.target.value })} /></label>
          <label className="field">Max output tokens: {kn.maxOut}<input type="range" min={50} max={1500} step={50} value={kn.maxOut} onChange={(e) => setKn({ ...kn, maxOut: +e.target.value })} /></label>
          <label className="switch"><input type="checkbox" checked={kn.compress} onChange={(e) => setKn({ ...kn, compress: e.target.checked })} /> Compress retrieved context</label>
          <label className="switch"><input type="checkbox" checked={kn.cache} onChange={(e) => setKn({ ...kn, cache: e.target.checked })} /> Cache the stable prompt prefix</label>
        </div>
        <div className="card stack">
          <div className="grid g2">
            <div className="kpi"><span className="v" style={{ color: sim.quality >= lvl.targetQuality ? 'var(--success)' : 'var(--danger)' }}>{sim.quality}</span><span className="l">estimated quality</span></div>
            <div className="kpi"><span className="v" style={{ color: sim.daily <= lvl.budget ? 'var(--success)' : 'var(--danger)' }}>${sim.daily}</span><span className="l">estimated $/day</span></div>
          </div>
          <div className="tiny faint">~{sim.inTok} input tokens/request · {lvl.requests.toLocaleString()} requests/day</div>
          <details className="tiny"><summary>How is this computed?</summary>Quality = tier base (66/76/84) + retrieval benefit (peaks around k=4–5, falls with noise) − 2 if compressed − task difficulty adjustments. Cost = (input tokens × (1 − cached share) + cached × 10%) × tier price + output tokens × tier price × 5, per million tokens. Illustrative numbers only.</details>
          {score === null && <button className="btn primary" onClick={submit}>Lock in configuration</button>}
        </div>
      </div>
      {score !== null && <ScoreCard score={score} onReplay={onReplay} onNext={onNext}><p className="small" style={{ margin: '6px 0 0' }}>{pass ? 'Within budget and above the bar.' : 'Missed the target or the budget.'} In real systems, verify estimates against measured usage.</p></ScoreCard>}
    </div>
  );
}

// ───────── 10. AI Incident Room
export function IncidentRoom() {
  const L = useLevel(INCIDENT_ROOM.length);
  const lvl = INCIDENT_ROOM[L.i];
  return <div className="stack"><LevelBar levels={INCIDENT_ROOM} index={L.i} setIndex={L.setI} gameId="incident-room" /><IRView key={`${lvl.id}-${L.nonce}`} lvl={lvl} index={L.i} onReplay={L.replay} onNext={L.next} /></div>;
}
function IRView({ lvl, index, onReplay, onNext }: { lvl: (typeof INCIDENT_ROOM)[number]; index: number; onReplay: () => void; onNext?: () => void }) {
  const finish = useGameFinish('incident-room');
  const causes = useMemo(() => seededShuffle(lvl.causes, lvl.id), [lvl]);
  const actions = useMemo(() => seededShuffle(lvl.actions, lvl.id + 'a'), [lvl]);
  const [cause, setCause] = useState<number | null>(null);
  const [acts, setActs] = useState<number[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const submit = () => {
    let s = cause !== null && causes[cause].correct ? 40 : 0;
    for (const a of acts) s += actions[a].good ? 30 : actions[a].harmful ? -15 : 0;
    setScore(finish(lvl.id, index, s));
  };
  return (
    <div className="stack">
      <div className="callout danger"><b>{lvl.alert}</b></div>
      <div className="grid g2">
        <div className="card stack sm">
          <b>Logs</b>
          <pre className="small" style={{ margin: 0 }}>{lvl.logs.join('\n')}</pre>
          <b>Metrics</b>
          {lvl.metrics.map((m) => <div key={m.label} className="row between small"><span>{m.label}</span><span className="mono">{m.value}</span></div>)}
        </div>
        <div className="card stack sm">
          <b>Root cause</b>
          {causes.map((c, i) => <button key={i} className={`opt ${score !== null ? (c.correct ? 'right' : cause === i ? 'wrong' : '') : ''}`} aria-pressed={cause === i} disabled={score !== null} onClick={() => setCause(i)}>{c.text}</button>)}
          <b style={{ marginTop: 8 }}>Pick the two best actions</b>
          {actions.map((a, i) => <button key={i} className={`opt ${score !== null ? (a.good ? 'right' : acts.includes(i) ? 'wrong' : '') : ''}`} aria-pressed={acts.includes(i)} disabled={score !== null || (!acts.includes(i) && acts.length >= 2)} onClick={() => setActs(acts.includes(i) ? acts.filter((x) => x !== i) : [...acts, i])}>{a.text}{score !== null && <span className="tiny" style={{ display: 'block', marginTop: 4 }}>{a.why}</span>}</button>)}
          {score === null && <button className="btn primary" disabled={cause === null || acts.length !== 2} onClick={submit}>Resolve incident</button>}
        </div>
      </div>
      {score !== null && <ScoreCard score={score} onReplay={onReplay} onNext={onNext} />}
    </div>
  );
}

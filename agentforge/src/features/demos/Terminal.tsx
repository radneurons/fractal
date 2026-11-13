// Terminal simulator + a scripted coding-agent session with "predict the next safe action" checkpoints.
import { useEffect, useRef, useState } from 'react';
import { exec, initialRepo, SIM_HOME, type SimState } from '@/core/runtime/terminalSim';
import { useLearner } from '@/store/learner';
import { TruthLabel } from '@/ui/kit';

export function TerminalSim({ height = 340, onCommand }: { height?: number; onCommand?: (cmd: string, st: SimState) => void }) {
  const [st, setSt] = useState<SimState>(initialRepo);
  const [lines, setLines] = useState<{ k: 'in' | 'out'; t: string }[]>([{ k: 'out', t: 'Simulated terminal — safe sandbox. Type `help` to list commands.' }]);
  const [cmd, setCmd] = useState('');
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [lines]);
  const run = (c: string) => {
    const r = exec(st, c);
    setSt(r.state);
    setHist((h) => [c, ...h]);
    setHi(-1);
    if (r.clear) setLines([]);
    else setLines((l) => [...l, { k: 'in', t: `${st.cwd.replace(SIM_HOME, '~/acme-app')} $ ${c}` }, ...(r.out ? [{ k: 'out' as const, t: r.out }] : [])]);
    onCommand?.(c, r.state);
  };
  return (
    <div className="stack sm">
      <div className="row between"><span className="tiny faint">Repo: acme-app · branch {st.branch}</span><TruthLabel kind="simulated" detail="In-memory shell. Nothing runs on your computer." /></div>
      <div className="term" style={{ maxHeight: height }} onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()} role="log" aria-label="Terminal output">
        {lines.map((l, i) => (
          <div key={i} className="line">
            {l.k === 'in' ? <span className="ps">{l.t}</span> : l.t.split('\n').map((x, j) => <div key={j} className={x.startsWith('+') && !x.startsWith('+++') ? 'add' : x.startsWith('-') && !x.startsWith('---') ? 'del' : ''}>{x || ' '}</div>)}
          </div>
        ))}
        <div className="row nowrap" style={{ gap: 6 }} ref={end}>
          <span className="ps">{st.cwd.replace(SIM_HOME, '~/acme-app')} $</span>
          <input value={cmd} onChange={(e) => setCmd(e.target.value)} aria-label="Terminal command" autoComplete="off" spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { run(cmd.trim()); setCmd(''); }
              if (e.key === 'ArrowUp') { const n = Math.min(hist.length - 1, hi + 1); if (hist[n] !== undefined) { setHi(n); setCmd(hist[n]); } e.preventDefault(); }
              if (e.key === 'ArrowDown') { const n = hi - 1; setHi(n); setCmd(n >= 0 ? hist[n] : ''); e.preventDefault(); }
            }} />
        </div>
      </div>
      <div className="row">{['ls', 'cat src/total.js', 'npm test', 'apply-fix', 'git diff', 'git add .', 'git commit -m "Fix total"'].map((c) => <button key={c} className="chip mono" style={{ cursor: 'pointer' }} onClick={() => run(c)}>{c}</button>)}</div>
    </div>
  );
}

// Scripted session modelled on common agentic-coding workflows. Observable actions only — no invented hidden reasoning.
const SESSION = [
  { who: 'user', text: 'The cart total ignores quantity. Fix it and make sure tests pass.' },
  { who: 'agent', text: 'Plan (visible): 1) read src/total.js and its test, 2) reproduce the failure, 3) fix, 4) run tests, 5) show the diff.' },
  { who: 'tool', text: '$ cat src/total.js\nreturn items.reduce((s, i) => s + i.price, 0);' },
  { who: 'check', q: 'Before editing, what is the next safe step?', options: [{ t: 'Run the tests to reproduce the failure', ok: true, why: 'Confirms the bug and gives a baseline.' }, { t: 'Rewrite the whole file', ok: false, why: 'Unscoped edits are hard to review.' }, { t: 'Delete the failing test', ok: false, why: 'Hides the bug.' }] },
  { who: 'tool', text: '$ npm test\n✗ total multiplies price by quantity — expected 10 to equal 20' },
  { who: 'agent', text: 'Proposed edit to src/total.js:\n- return items.reduce((s, i) => s + i.price, 0);\n+ return items.reduce((s, i) => s + i.price * i.qty, 0);' },
  { who: 'check', q: 'The agent asks for approval to apply the edit. What do you do?', options: [{ t: 'Read the proposed diff, then approve — it is small and scoped', ok: true, why: 'Review before approving, even when it looks obvious.' }, { t: 'Approve all future edits automatically', ok: false, why: 'Blanket approval removes your safety net.' }, { t: 'Reject and ask it to change the test instead', ok: false, why: 'The code is wrong, not the test.' }] },
  { who: 'tool', text: '$ npm test\n✓ total multiplies price by quantity\n1 passing' },
  { who: 'check', q: 'Tests pass. What should happen before you commit?', options: [{ t: 'Review `git diff` yourself: only total.js changed, the test is untouched', ok: true, why: 'Evidence over claims.' }, { t: 'Commit immediately — the agent said tests pass', ok: false, why: 'Check the real diff and output.' }, { t: 'Push straight to main', ok: false, why: 'Skip review and CI at your peril.' }] },
  { who: 'agent', text: 'Summary: fixed quantity handling in src/total.js (1 line). Tests: 1 passing. No other files changed.' },
] as const;

export function AgentSessionSim() {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const record = useLearner((s) => s.recordEvidence);
  const visible = SESSION.slice(0, i + 1);
  const cur = SESSION[i];
  const waiting = cur.who === 'check' && answers[i] === undefined;
  return (
    <div className="stack">
      <div className="row between"><b>Coding-agent session (simulated)</b><TruthLabel kind="simulated" detail="A scripted session modelled on common agentic coding workflows. It shows observable actions and an explicit plan — not hidden model reasoning." /></div>
      <div className="stack sm">
        {visible.map((s, k) => (
          <div key={k} className="card inset fade-in" style={{ borderLeft: `3px solid ${s.who === 'user' ? 'var(--info)' : s.who === 'agent' ? 'var(--violet)' : s.who === 'tool' ? 'var(--border-strong)' : 'var(--accent-2)'}` }}>
            <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '.1em' }}>{s.who === 'check' ? 'Your call' : s.who}</div>
            {s.who === 'check' ? (
              <div className="stack sm">
                <b>{s.q}</b>
                {s.options.map((o, oi) => {
                  const chosen = answers[k];
                  return (
                    <button key={oi} className={`opt ${chosen !== undefined ? (o.ok ? 'right' : chosen === oi ? 'wrong' : '') : ''}`} disabled={chosen !== undefined}
                      onClick={() => { setAnswers({ ...answers, [k]: oi }); record({ skillId: 'cc-review', source: 'practice', score: o.ok ? 1 : 0, difficulty: 2, hintsUsed: 0, solutionRevealed: false, errorTags: o.ok ? [] : ['poor-verification'], gradedBy: 'deterministic', itemId: `session-check-${k}` }, 'Agent session checkpoint'); }}>
                      {o.t}{chosen !== undefined && (o.ok || chosen === oi) && <span className="tiny" style={{ display: 'block', marginTop: 4 }}>{o.why}</span>}
                    </button>
                  );
                })}
              </div>
            ) : <pre style={{ margin: '6px 0 0', background: 'none', border: 0, padding: 0, whiteSpace: 'pre-wrap' }}>{s.text}</pre>}
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn primary" disabled={waiting || i >= SESSION.length - 1} onClick={() => setI(i + 1)}>{waiting ? 'Answer the checkpoint to continue' : i >= SESSION.length - 1 ? 'Session complete' : 'Next step'}</button>
        <button className="btn ghost" onClick={() => { setI(0); setAnswers({}); }}>Restart</button>
      </div>
    </div>
  );
}

export function TerminalDemo() {
  return (
    <div className="grid g2">
      <div className="card"><TerminalSim /></div>
      <div className="card"><AgentSessionSim /></div>
    </div>
  );
}

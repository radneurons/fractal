// Renders and grades any assessment item. Every submission becomes evidence in the single learner model.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { CodeItem, Evidence, EvidenceSource, GradeResult, Item, Response } from '@/core/types';
import { ERROR_TAG_LABEL } from '@/core/types';
import { grade, seededShuffle } from '@/core/engines/assessment';
import { runInSandbox, type SandboxRun } from '@/core/runtime/sandbox';
import { runPython } from '@/core/runtime/pySandbox';
import { useLearner } from '@/store/learner';
import { getSkill } from '@/content/skills';
import { Icon, Markdown, TruthLabel, useToast } from './kit';
import { sfx } from './sound';

const CodeEditor = lazy(() => import('./CodeEditor'));

export interface ItemViewProps {
  item: Item;
  source: EvidenceSource;
  onGraded?: (r: GradeResult, ev: Evidence) => void;
  allowRetry?: boolean;
  label?: string;
  hideHints?: boolean;
}

const KEYS = 'ABCDEFGH';

function buildHintLadder(item: Item): string[] {
  const skill = getSkill(item.skillId);
  const ladder = [...item.hints];
  ladder.unshift(`**Concept to focus on — ${skill.title}:** ${skill.summary}`);
  if (item.type === 'mcq' || item.type === 'multi') {
    const tags = [...new Set(item.options.filter((o) => !o.correct && o.errorTag).map((o) => ERROR_TAG_LABEL[o.errorTag!]))];
    if (tags.length) ladder.push(`**Common traps here:** ${tags.join(', ')}. Eliminate options that fall into these.`);
  }
  ladder.push(`**Related worked example:** ${skill.workedExample}`);
  return ladder;
}

export default function ItemView({ item, source, onGraded, allowRetry = true, label, hideHints }: ItemViewProps) {
  const recordAttempt = useLearner((s) => s.recordAttempt);
  const addSubmission = useLearner((s) => s.addSubmission);
  const hintPolicy = useLearner((s) => s.settings.hintPolicy);
  const sound = useLearner((s) => s.settings.sound);
  const draft = useLearner((s) => s.drafts[`code:${item.id}`]);
  const setDraft = useLearner((s) => s.setDraft);
  const { announce, toast } = useToast();

  const [response, setResponse] = useState<Response | null>(null);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [hintsShown, setHintsShown] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [run, setRun] = useState<SandboxRun | null>(null);
  const [running, setRunning] = useState(false);
  const [attemptKey, setAttemptKey] = useState(0);
  const resultRef = useRef<HTMLDivElement>(null);
  const ladder = useMemo(() => buildHintLadder(item), [item]);

  useEffect(() => {
    setResponse(null);
    setResult(null);
    setHintsShown(0);
    setRevealed(false);
    setAttempted(false);
    setRun(null);
  }, [item.id]);

  const submit = async (resp: Response | 'unknown') => {
    const r: GradeResult = resp === 'unknown'
      ? { score: 0, correct: false, errorTags: ['incomplete'], feedback: ['Marked as "I don\'t know yet" — that is useful information, not a failure.'], gradedBy: 'deterministic' }
      : grade(item, resp);
    setResult(r);
    setAttempted(true);
    const { evidence } = recordAttempt({ item, result: r, source, hintsUsed: hintsShown, revealed, responseSummary: resp === 'unknown' ? "I don't know yet" : summarize(item, resp) });
    announce(r.correct ? 'Correct.' : `Not yet. Score ${Math.round(r.score * 100)} percent.`);
    if (sound) sfx(r.correct ? 'good' : 'bad');
    if (revealed) toast('Solution was revealed — this attempt earns no mastery credit.');
    onGraded?.(r, evidence);
    setTimeout(() => resultRef.current?.focus(), 30);
  };

  const runCode = async (codeItem: CodeItem, code: string, isSubmit: boolean) => {
    setRunning(true);
    const res = codeItem.language === 'python' ? await runPython(code, codeItem.tests) : await runInSandbox(code, codeItem.exports, codeItem.tests);
    setRun(res);
    setRunning(false);
    if (isSubmit) {
      addSubmission(item.id, { code, at: Date.now(), passed: res.passed, total: res.total });
      await submit({ type: 'code', passed: res.passed, total: res.total, failed: res.results.filter((x) => !x.passed).map((x) => `${x.name}: ${x.error}`) });
    }
  };

  const retry = () => {
    setResult(null);
    setResponse(null);
    setRun(null);
    setAttemptKey((k) => k + 1);
  };

  const locked = !!result;

  return (
    <section className="item card" aria-label={label ?? 'Exercise'}>
      <div className="row between">
        <div className="row">
          <span className="chip">{TYPE_LABEL[item.type]}{item.type === 'code' ? (item.language === 'python' ? ' · Python' : ' · JavaScript') : ''}</span>
          <span className="chip">Difficulty {item.difficulty}/5</span>
          <span className="chip violet">{getSkill(item.skillId).title}</span>
        </div>
        {item.type === 'code' ? <TruthLabel kind="executed" detail={item.language === 'python' ? 'Your Python runs in Pyodide (WebAssembly) in an isolated worker: no network, 5 s limit. Real tests decide.' : 'Your code runs in an isolated Web Worker (no network, 2 s limit). Real tests decide.'} /> : item.type === 'short' ? <TruthLabel kind="heuristic" /> : <span className="tiny faint">Auto-graded</span>}
      </div>
      <Markdown text={item.prompt} className="md item-prompt" />

      <div key={attemptKey}>
        {item.type === 'mcq' && <Mcq item={item} locked={locked} result={result} onChange={setResponse} />}
        {item.type === 'multi' && <Multi item={item} locked={locked} onChange={setResponse} />}
        {item.type === 'order' && <Order item={item} locked={locked} onChange={setResponse} />}
        {item.type === 'match' && <Match item={item} locked={locked} onChange={setResponse} />}
        {item.type === 'fill' && <Fill item={item} locked={locked} onChange={setResponse} />}
        {item.type === 'short' && <Short item={item} locked={locked} onChange={setResponse} />}
        {item.type === 'classify' && <Classify item={item} locked={locked} onChange={setResponse} />}
        {item.type === 'code' && (
          <CodeArea item={item} draft={draft} setDraft={(v) => setDraft(`code:${item.id}`, v)} running={running} run={run} locked={locked} onRun={(c) => runCode(item, c, false)} onSubmit={(c) => runCode(item, c, true)} />
        )}
      </div>

      {!result && item.type !== 'code' && (
        <div className="row">
          <button className="btn primary" disabled={!response || !isComplete(item, response)} onClick={() => response && submit(response)}>
            <Icon name="check" /> Check answer
          </button>
          <button className="btn ghost" onClick={() => submit('unknown')}>I don't know yet</button>
          <span className="spacer" />
          {!hideHints && hintPolicy === 'ladder' && hintsShown < ladder.length && (
            <button className="btn sm" onClick={() => setHintsShown((h) => h + 1)} aria-describedby={`hint-cost-${item.id}`}>
              <Icon name="hint" /> Hint {hintsShown + 1}/{ladder.length}
            </button>
          )}
        </div>
      )}
      {item.type === 'code' && !result && !hideHints && hintPolicy === 'ladder' && hintsShown < ladder.length && (
        <div className="row">
          <span className="spacer" />
          <button className="btn sm" onClick={() => setHintsShown((h) => h + 1)}>
            <Icon name="hint" /> Hint {hintsShown + 1}/{ladder.length}
          </button>
        </div>
      )}
      <span id={`hint-cost-${item.id}`} className="sr-only">Each hint reduces the credit this attempt earns.</span>

      {hintsShown > 0 && (
        <div className="hint-ladder" aria-live="polite">
          {ladder.slice(0, hintsShown).map((h, i) => (
            <div className="hint" key={i}>
              <div className="tiny faint">Hint {i + 1} · reduces credit for this attempt</div>
              <Markdown text={h} />
            </div>
          ))}
        </div>
      )}

      {result && (
        <div ref={resultRef} tabIndex={-1} className={`result ${result.correct ? 'ok' : result.score > 0.3 ? 'partial' : 'no'} fade-in`}>
          <div className="row between">
            <h4 style={{ margin: 0 }}>{result.correct ? '✓ Correct' : result.score > 0.3 ? `◐ Partially correct · ${Math.round(result.score * 100)}%` : '✗ Not yet'}</h4>
            <span className="tiny faint">
              {revealed ? 'Solution revealed → no credit' : hintsShown ? `${hintsShown} hint${hintsShown > 1 ? 's' : ''} used → reduced credit` : 'Full credit eligible'}
            </span>
          </div>
          <ul>{result.feedback.map((f, i) => <li key={i}>{f}</li>)}</ul>
          {!!result.errorTags.length && (
            <p className="small" style={{ marginTop: 8 }}>
              <b>Likely issue (hypothesis):</b> {result.errorTags.map((t) => ERROR_TAG_LABEL[t]).join(', ')}
            </p>
          )}
          <div className="callout" style={{ marginTop: 10 }}>
            <b>Why:</b> <Markdown text={item.explanation} />
            {item.type === 'short' && (
              <details style={{ marginTop: 8 }}>
                <summary>Model answer</summary>
                <Markdown text={item.modelAnswer} />
              </details>
            )}
          </div>
          {allowRetry && (
            <div className="row" style={{ marginTop: 12 }}>
              {!result.correct && <button className="btn" onClick={retry}><Icon name="refresh" /> Try again</button>}
              {!result.correct && item.type === 'code' && !revealed && (
                <button className="btn ghost" onClick={() => { setRevealed(true); setDraft(`code:${item.id}`, item.solution); retry(); }}>
                  Reveal solution (no credit)
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {!result && attempted && !revealed && item.type !== 'code' && null}
    </section>
  );
}

const TYPE_LABEL: Record<Item['type'], string> = { mcq: 'Multiple choice', multi: 'Select all that apply', order: 'Put in order', match: 'Match pairs', fill: 'Fill the blanks', short: 'Short explanation', code: 'Code', classify: 'Sort into groups' };

function isComplete(item: Item, r: Response): boolean {
  switch (r.type) {
    case 'mcq': return r.optionId !== null;
    case 'multi': return r.optionIds.length > 0;
    case 'order': return true;
    case 'match': return item.type === 'match' && Object.keys(r.mapping).length === item.pairs.length && Object.values(r.mapping).every(Boolean);
    case 'fill': return r.values.every((v) => v.trim());
    case 'short': return r.text.trim().length > 0;
    case 'classify': return item.type === 'classify' && Object.keys(r.mapping).length === item.cards.length;
    default: return true;
  }
}

function summarize(item: Item, r: Response): string {
  switch (r.type) {
    case 'mcq': return item.type === 'mcq' ? item.options.find((o) => o.id === r.optionId)?.text ?? "I don't know" : '';
    case 'multi': return item.type === 'multi' ? item.options.filter((o) => r.optionIds.includes(o.id)).map((o) => o.text).join('; ') : '';
    case 'order': return r.order.map((s, i) => `${i + 1}. ${s}`).join(' ');
    case 'fill': return r.values.join(' | ');
    case 'short': return r.text.slice(0, 400);
    case 'code': return `${r.passed}/${r.total} tests passed`;
    case 'match':
    case 'classify': return Object.entries(r.mapping).map(([a, b]) => `${a} → ${b}`).join('; ');
  }
}

// ───────── Item type renderers (all keyboard accessible)

function Mcq({ item, locked, result, onChange }: { item: Extract<Item, { type: 'mcq' }>; locked: boolean; result: GradeResult | null; onChange: (r: Response) => void }) {
  const opts = useMemo(() => seededShuffle(item.options, item.id), [item]);
  const [sel, setSel] = useState<string | null>(null);
  const choose = (id: string) => {
    if (locked) return;
    setSel(id);
    onChange({ type: 'mcq', optionId: id });
  };
  return (
    <div className="opts" role="radiogroup" aria-label="Options" onKeyDown={(e) => {
      const idx = KEYS.toLowerCase().indexOf(e.key.toLowerCase());
      if (idx >= 0 && idx < opts.length && !e.metaKey && !e.ctrlKey && (e.target as HTMLElement).tagName !== 'TEXTAREA') choose(opts[idx].id);
    }}>
      {opts.map((o, i) => {
        const cls = locked && result ? (o.correct ? 'right' : sel === o.id ? 'wrong' : '') : '';
        return (
          <button key={o.id} role="radio" aria-checked={sel === o.id} className={`opt ${cls}`} onClick={() => choose(o.id)} disabled={locked}>
            <span className="key">{KEYS[i]}</span>
            <span style={{ flex: 1 }}>
              {o.text}
              {locked && sel === o.id && !o.correct && o.feedback && <span className="small" style={{ display: 'block', marginTop: 4, color: 'var(--danger)' }}>{o.feedback}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Multi({ item, locked, onChange }: { item: Extract<Item, { type: 'multi' }>; locked: boolean; onChange: (r: Response) => void }) {
  const opts = useMemo(() => seededShuffle(item.options, item.id), [item]);
  const [sel, setSel] = useState<string[]>([]);
  const toggle = (id: string) => {
    if (locked) return;
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    setSel(next);
    onChange({ type: 'multi', optionIds: next });
  };
  return (
    <div className="opts" role="group" aria-label="Select all that apply">
      {opts.map((o, i) => {
        const cls = locked ? (o.correct ? 'right' : sel.includes(o.id) ? 'wrong' : '') : '';
        return (
          <button key={o.id} role="checkbox" aria-checked={sel.includes(o.id)} aria-pressed={sel.includes(o.id)} className={`opt ${cls}`} onClick={() => toggle(o.id)} disabled={locked}>
            <span className="key">{sel.includes(o.id) ? '✓' : KEYS[i]}</span>
            <span>{o.text}</span>
          </button>
        );
      })}
    </div>
  );
}

function Order({ item, locked, onChange }: { item: Extract<Item, { type: 'order' }>; locked: boolean; onChange: (r: Response) => void }) {
  const [order, setOrder] = useState<string[]>(() => {
    let s = seededShuffle(item.steps, item.id);
    if (s.every((x, i) => x === item.steps[i])) s = [...s.slice(1), s[0]];
    return s;
  });
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  useEffect(() => {
    onChange({ type: 'order', order });
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const n = [...order];
    [n[i], n[j]] = [n[j], n[i]];
    setOrder(n);
  };
  return (
    <ol className="order-list" aria-label="Reorder steps — use the arrow buttons or drag">
      {order.map((s, i) => (
        <li key={s} className={`order-row ${over === i ? 'drag-over' : ''}`} draggable={!locked}
          onDragStart={() => setDrag(i)} onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDragLeave={() => setOver(null)}
          onDrop={() => { if (drag === null) return; const n = [...order]; const [x] = n.splice(drag, 1); n.splice(i, 0, x); setOrder(n); setDrag(null); setOver(null); }}>
          <span className="grip" aria-hidden="true">⋮⋮</span>
          <span className="n">{i + 1}.</span>
          <span style={{ flex: 1 }}>{s}</span>
          {!locked && (
            <span className="row nowrap" style={{ gap: 4 }}>
              <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move "${s}" up`}>▲</button>
              <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move "${s}" down`}>▼</button>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Match({ item, locked, onChange }: { item: Extract<Item, { type: 'match' }>; locked: boolean; onChange: (r: Response) => void }) {
  const rights = useMemo(() => seededShuffle(item.pairs.map((p) => p.right), item.id), [item]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const set = (l: string, r: string) => {
    const m = { ...mapping, [l]: r };
    setMapping(m);
    onChange({ type: 'match', mapping: m });
  };
  return (
    <div className="stack sm">
      {item.pairs.map((p) => (
        <label key={p.left} className="row nowrap" style={{ alignItems: 'center' }}>
          <span style={{ flex: '0 0 38%', fontWeight: 600 }}>{p.left}</span>
          <select className="select" value={mapping[p.left] ?? ''} onChange={(e) => set(p.left, e.target.value)} disabled={locked} aria-label={`Match for ${p.left}`}>
            <option value="">Choose…</option>
            {rights.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}

function Fill({ item, locked, onChange }: { item: Extract<Item, { type: 'fill' }>; locked: boolean; onChange: (r: Response) => void }) {
  const [vals, setVals] = useState<string[]>(item.blanks.map(() => ''));
  const parts = item.template.split(/(\[\[\d+\]\])/);
  return (
    <p className="mono" style={{ lineHeight: 2.4, whiteSpace: 'pre-wrap' }}>
      {parts.map((p, i) => {
        const m = p.match(/\[\[(\d+)\]\]/);
        if (!m) return <span key={i}>{p}</span>;
        const idx = Number(m[1]);
        return (
          <input key={i} className="input blank" value={vals[idx]} disabled={locked} aria-label={`Blank ${idx + 1}`}
            onChange={(e) => { const v = [...vals]; v[idx] = e.target.value; setVals(v); onChange({ type: 'fill', values: v }); }}
            style={{ width: Math.max(120, (vals[idx]?.length ?? 0) * 10 + 40) }} />
        );
      })}
    </p>
  );
}

function Short({ item, locked, onChange }: { item: Extract<Item, { type: 'short' }>; locked: boolean; onChange: (r: Response) => void }) {
  const [t, setT] = useState('');
  return (
    <div className="stack sm">
      <textarea className="textarea" value={t} disabled={locked} aria-label="Your answer" placeholder="Write your answer in your own words…" onChange={(e) => { setT(e.target.value); onChange({ type: 'short', text: e.target.value }); }} />
      <div className="tiny faint">Graded by checking for {item.rubric.length} key ideas (need {item.minConcepts}). Phrasing doesn't matter, but the ideas do.</div>
    </div>
  );
}

function Classify({ item, locked, onChange }: { item: Extract<Item, { type: 'classify' }>; locked: boolean; onChange: (r: Response) => void }) {
  const cards = useMemo(() => seededShuffle(item.cards.map((c) => c.text), item.id), [item]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const place = (card: string, bucket: string) => {
    const m = { ...mapping, [card]: bucket };
    setMapping(m);
    setPicked(null);
    onChange({ type: 'classify', mapping: m });
  };
  const unplaced = cards.filter((c) => !mapping[c]);
  return (
    <div className="stack">
      <div className="tiny faint">Drag cards into groups — or select a card, then choose its group.</div>
      <div className="row" aria-label="Unsorted cards">
        {unplaced.map((c) => (
          <button key={c} className="card-chip" draggable={!locked} onDragStart={(e) => e.dataTransfer.setData('text/plain', c)} aria-pressed={picked === c} onClick={() => setPicked(picked === c ? null : c)} disabled={locked}>{c}</button>
        ))}
        {!unplaced.length && <span className="tiny faint">All cards placed — you can still move them.</span>}
      </div>
      <div className="bucket-grid">
        {item.buckets.map((b) => (
          <div key={b} className={`bucket ${over === b ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(b); }} onDragLeave={() => setOver(null)} onDrop={(e) => { const c = e.dataTransfer.getData('text/plain'); setOver(null); if (c && !locked) place(c, b); }}>
            <button className="btn sm" disabled={!picked || locked} onClick={() => picked && place(picked, b)} aria-label={`Place selected card in ${b}`}>{b}</button>
            {cards.filter((c) => mapping[c] === b).map((c) => (
              <button key={c} className="card-chip" draggable={!locked} onDragStart={(e) => e.dataTransfer.setData('text/plain', c)} aria-pressed={picked === c} onClick={() => setPicked(picked === c ? null : c)} disabled={locked}>{c}</button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CodeArea({ item, draft, setDraft, running, run, locked, onRun, onSubmit }: { item: CodeItem; draft?: string; setDraft: (v: string) => void; running: boolean; run: SandboxRun | null; locked: boolean; onRun: (c: string) => void; onSubmit: (c: string) => void }) {
  const code = draft ?? item.starter;
  return (
    <div className="stack sm">
      <Suspense fallback={<textarea className="textarea code" value={code} onChange={(e) => setDraft(e.target.value)} aria-label="Code editor" style={{ minHeight: 220 }} />}>
        <CodeEditor value={code} onChange={setDraft} label="Code editor" language={item.language} />
      </Suspense>
      <div className="row">
        <button className="btn" onClick={() => onRun(code)} disabled={running}><Icon name="play" /> {running ? (item.language === 'python' ? 'Running (first Python run loads the runtime)…' : 'Running…') : 'Run tests'}</button>
        <button className="btn primary" onClick={() => onSubmit(code)} disabled={running || locked}><Icon name="check" /> Submit</button>
        <button className="btn ghost sm" onClick={() => setDraft(item.starter)} disabled={running}>Reset to starter</button>
        <span className="spacer" />
        <span className="tiny faint">Draft autosaves · {item.tests.length} tests</span>
      </div>
      {run && (
        <div className="card inset" aria-live="polite">
          <div className="row between">
            <b>{run.timedOut ? '⏱ Timed out' : run.compileError ? '⚠ Did not compile' : `${run.passed}/${run.total} tests passed`}</b>
            <span className="row"><TruthLabel kind="executed" /><span className="tiny faint">{run.durationMs} ms</span></span>
          </div>
          {run.compileError && <pre style={{ marginTop: 8, color: 'var(--danger)' }}>{run.compileError}</pre>}
          <div style={{ marginTop: 8 }}>
            {run.results.map((r) => (
              <div className="test-row" key={r.name}>
                <span className={r.passed ? 'pass' : 'fail'}>{r.passed ? '✓' : '✗'}</span>
                <span>{r.name}</span>
                {!r.passed && r.error && <span className="tiny faint mono">— {r.error}</span>}
              </div>
            ))}
          </div>
          {!!run.logs.length && <div className="console" style={{ marginTop: 8 }}>{run.logs.join('\n')}</div>}
        </div>
      )}
    </div>
  );
}

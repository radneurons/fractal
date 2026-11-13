import { lazy, Suspense, useMemo, useState } from 'react';
import { z } from 'zod';
import { ITEMS } from '@/content/items';
import { getSkill } from '@/content/skills';
import { useLearner } from '@/store/learner';
import { complete, providerReady, ProviderError, type CompletionResult } from '@/core/ai/provider';
import { runInSandbox, type SandboxRun } from '@/core/runtime/sandbox';
import { runPython } from '@/core/runtime/pySandbox';
import type { CodeItem } from '@/core/types';
import { CHECKS, PROMPT_TASKS, REVIEW_DIFFS } from './labData';
import ItemView from '@/ui/ItemView';
import { Icon, PageHeader, Seg, Tabs, TruthLabel, useToast } from '@/ui/kit';
import { href, navigate } from '@/ui/router';
import { TerminalSim, AgentSessionSim } from './demos/Terminal';
import { EvalDemo, MultiAgentDemo, RagDemo } from './demos/systems';
import CompareLab from './CompareLab';

const CodeEditor = lazy(() => import('@/ui/CodeEditor'));

type Tab = 'prompt' | 'code' | 'api' | 'terminal' | 'review' | 'eval' | 'compare';
const TABS: { id: Tab; label: string }[] = [
  { id: 'prompt', label: 'Prompt Lab' }, { id: 'code', label: 'Code Lab' }, { id: 'api', label: 'API Lab' }, { id: 'terminal', label: 'Terminal & Agent Session' }, { id: 'review', label: 'Review Lab' }, { id: 'eval', label: 'Eval & Systems Lab' }, { id: 'compare', label: 'AI vs AI Comparison' },
];

export default function Lab({ tab }: { tab?: Tab }) {
  const t: Tab = (TABS.find((x) => x.id === tab)?.id ?? 'prompt') as Tab;
  return (
    <div>
      <PageHeader eyebrow="Practice Lab" title="Hands-on practice" actions={<><a className="btn" href={href('/studio')}><Icon name="studio" /> Agent Lab (Studio)</a><a className="btn" href={href('/arena/injection-defense')}><Icon name="shield" /> Security Lab</a><a className="btn" href={href('/arena/architecture-forge')}><Icon name="layers" /> System Design Lab</a></>}>
        Every output carries a label saying exactly how it was produced: executed in your browser, simulated by authored rules, a pre-written demonstration, or a live model you connected.
      </PageHeader>
      <Tabs label="Lab mode" tabs={TABS} value={t} onChange={(v) => navigate(`/lab/${v}`, { replace: true })} />
      {t === 'prompt' && <PromptLab />}
      {t === 'code' && <CodeLab />}
      {t === 'api' && <ApiLab />}
      {t === 'terminal' && <div className="grid g2"><div className="card"><TerminalSim height={420} /></div><div className="card"><AgentSessionSim /></div></div>}
      {t === 'review' && <ReviewLab />}
      {t === 'compare' && <CompareLab />}
      {t === 'eval' && <div className="stack"><EvalDemo /><RagDemo /><MultiAgentDemo /></div>}
    </div>
  );
}

// ───────── Prompt Lab
function PromptLab() {
  const [taskId, setTaskId] = useState(PROMPT_TASKS[0].id);
  const task = PROMPT_TASKS.find((t) => t.id === taskId)!;
  const draftKey = `prompt:${task.id}`;
  const draft = useLearner((s) => s.drafts[draftKey]);
  const setDraft = useLearner((s) => s.setDraft);
  const provider = useLearner((s) => s.provider);
  const record = useLearner((s) => s.recordEvidence);
  const addVault = useLearner((s) => s.addVault);
  const { toast } = useToast();
  const prompt = draft ?? '';
  const [live, setLive] = useState<CompletionResult | null>(null);
  const [liveErr, setLiveErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<number | null>(null);
  const checks = [...task.required, ...task.bonus].map((id) => ({ ...CHECKS[id], required: task.required.includes(id), ok: CHECKS[id].test(prompt) }));
  const reqOk = checks.filter((c) => c.required && c.ok).length;
  const score = (reqOk / task.required.length) * 0.85 + (checks.filter((c) => !c.required && c.ok).length / Math.max(1, task.bonus.length)) * 0.15;

  const submit = () => {
    record({ skillId: task.skillId, source: 'practice', score, difficulty: 2, hintsUsed: 0, solutionRevealed: false, errorTags: score < 0.7 ? ['context-omission'] : [], gradedBy: 'heuristic', itemId: `prompt-lab:${task.id}` }, `Prompt Lab: ${task.title}`);
    setSubmitted(score);
  };
  const runLive = async () => {
    setBusy(true);
    setLiveErr('');
    try {
      const filled = prompt.replace(/\{\{\w+\}\}/g, task.material);
      setLive(await complete(provider, { system: 'You are a helpful assistant. Follow the user\'s instructions precisely.', messages: [{ role: 'user', content: filled }], maxTokens: 1200 }));
    } catch (e) {
      setLiveErr(e instanceof ProviderError ? e.message : String(e));
    }
    setBusy(false);
  };
  return (
    <div className="lab">
      <aside className="stack">
        <div className="card stack sm">
          <label className="field">Task<select className="select" value={taskId} onChange={(e) => { setTaskId(e.target.value); setLive(null); setSubmitted(null); }}>{PROMPT_TASKS.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
          <div className="eyebrow" style={{ marginTop: 6 }}>Scenario</div>
          <p className="small" style={{ margin: 0 }}>{task.scenario}</p>
          <div className="eyebrow" style={{ marginTop: 6 }}>Material (insert with {'{{variable}}'})</div>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{task.material}</pre>
          <div className="eyebrow" style={{ marginTop: 6 }}>Acceptance criteria</div>
          <ul className="small" style={{ margin: 0, paddingLeft: '1.2em' }}>{task.required.map((r) => <li key={r}>{CHECKS[r].label}</li>)}</ul>
          <div className="tiny faint">Skill: {getSkill(task.skillId).title}</div>
        </div>
      </aside>
      <section className="stack" style={{ minWidth: 0 }}>
        <label className="field">Your prompt
          <textarea className="textarea code" style={{ minHeight: 240 }} value={prompt} placeholder="Write your prompt here…" onChange={(e) => { setDraft(draftKey, e.target.value); setSubmitted(null); }} />
        </label>
        <div className="row">
          <button className="btn primary" onClick={submit} disabled={!prompt.trim()}><Icon name="check" /> Grade structure</button>
          {providerReady(provider) ? <button className="btn" onClick={runLive} disabled={busy || !prompt.trim()}><Icon name="play" /> {busy ? 'Running…' : `Run with ${provider.provider}`}</button> : <a className="btn ghost sm" href={href('/settings')}>Connect a model to run prompts live</a>}
          <button className="btn ghost sm" onClick={() => { addVault({ kind: 'prompt', title: task.title, body: prompt, tags: ['prompt-lab'], skillIds: [task.skillId] }); toast('Saved to Knowledge Vault'); }} disabled={!prompt.trim()}>Save to Vault</button>
        </div>
        {submitted !== null && (
          <div className={`result ${submitted >= 0.7 ? 'ok' : 'partial'} fade-in`}>
            <div className="row between"><h4 style={{ margin: 0 }}>Structure score {Math.round(submitted * 100)}%</h4><TruthLabel kind="heuristic" detail="Deterministic checks for prompt structure. It verifies the ingredients, not output quality — run it live or compare with the demonstrations." /></div>
            <p className="small" style={{ margin: '6px 0 0' }}>Recorded as practice evidence for {getSkill(task.skillId).title}.</p>
          </div>
        )}
        {live && (
          <div className="card stack sm fade-in">
            <div className="row between"><b>Model output</b><TruthLabel kind="live" detail={`${live.provider} · ${live.model}${live.usage ? ` · ${live.usage.input} in / ${live.usage.output} out tokens` : ''}`} /></div>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{live.text}</pre>
            <div className="tiny faint">Judge it against the acceptance criteria yourself — output quality is not auto-graded.</div>
          </div>
        )}
        {liveErr && <div className="callout danger small">{liveErr}</div>}
        <details className="card">
          <summary><b>Compare: weak vs strong prompt</b> <TruthLabel kind="demo" /></summary>
          <div className="grid g2" style={{ marginTop: 10 }}>
            {(['weak', 'strong'] as const).map((k) => (
              <div key={k} className="stack sm">
                <span className={`chip ${k === 'strong' ? 'accent' : 'danger'}`}>{k}</span>
                <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{task[k].prompt}</pre>
                <div className="tiny faint">Example output (pre-authored):</div>
                <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{task[k].output}</pre>
              </div>
            ))}
          </div>
        </details>
      </section>
      <aside className="stack">
        <div className="card stack sm" aria-live="polite">
          <b>Live checklist</b>
          {checks.map((c) => (
            <div key={c.id} className="row nowrap small" style={{ alignItems: 'flex-start' }}>
              <span style={{ color: c.ok ? 'var(--success)' : c.required ? 'var(--danger)' : 'var(--text-3)', width: 16 }}>{c.ok ? '✓' : c.required ? '✗' : '○'}</span>
              <span style={{ flex: 1 }}>{c.label}{c.required ? '' : ' (bonus)'}{!c.ok && <span className="tiny faint" style={{ display: 'block' }}>{c.tip}</span>}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

// ───────── Code Lab
function CodeLab() {
  const preferred = useLearner((s) => s.profile?.language);
  const [lang, setLang] = useState<'all' | 'javascript' | 'python'>(preferred === 'python' ? 'python' : 'all');
  const allCode = ITEMS.filter((i): i is CodeItem => i.type === 'code');
  const codeItems = allCode.filter((i) => lang === 'all' || (i.language ?? 'javascript') === lang);
  const [id, setId] = useState(codeItems[0].id);
  const item = allCode.find((i) => i.id === id)!;
  const subs = useLearner((s) => s.submissions[id] ?? []);
  return (
    <div className="lab" style={{ gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr) minmax(240px, 320px)' }}>
      <aside className="card stack sm" style={{ maxHeight: 640, overflow: 'auto' }}>
        <b>Exercises ({codeItems.length})</b>
        <Seg label="Language" value={lang} onChange={(v) => { setLang(v); const first = allCode.find((i) => v === 'all' || (i.language ?? 'javascript') === v); if (first) setId(first.id); }} options={[{ id: 'all', label: 'All' }, { id: 'javascript', label: 'JavaScript' }, { id: 'python', label: 'Python' }]} />
        {codeItems.map((c) => (
          <button key={c.id} className="opt" aria-pressed={c.id === id} onClick={() => setId(c.id)} style={{ padding: '8px 10px' }}>
            <span style={{ flex: 1 }}><span className="small"><b>{getSkill(c.skillId).title}</b></span><br /><span className="tiny faint">{c.language === 'python' ? 'Python' : 'JavaScript'} · difficulty {c.difficulty}/5</span></span>
          </button>
        ))}
      </aside>
      <section style={{ minWidth: 0 }}><ItemView key={item.id} item={item} source="exercise" /></section>
      <aside className="stack">
        <div className="card stack sm">
          <b>Submission history</b>
          {subs.length ? subs.map((s, i) => <div key={i} className="row between small"><span>{new Date(s.at).toLocaleString()}</span><span className={s.passed === s.total ? 'chip accent' : 'chip'}>{s.passed}/{s.total}</span></div>) : <span className="tiny faint">No submissions yet.</span>}
        </div>
        <Scratchpad />
      </aside>
    </div>
  );
}

const SCRATCH = {
  javascript: '// Free JavaScript scratchpad — runs in the sandbox.\nconst words = "agents use tools in a loop".split(" ");\nconsole.log(words.map(w => w.length));',
  python: '# Free Python scratchpad — runs in Pyodide (WebAssembly) in the sandbox.\nwords = "agents use tools in a loop".split()\nprint([len(w) for w in words])',
};
function Scratchpad() {
  const [lang, setLang] = useState<'javascript' | 'python'>('javascript');
  const [code, setCode] = useState(SCRATCH.javascript);
  const [run, setRun] = useState<SandboxRun | null>(null);
  const [busy, setBusy] = useState(false);
  const exec = async () => {
    setBusy(true);
    setRun(lang === 'python' ? await runPython(code, [{ name: 'run', code: 'True' }]) : await runInSandbox(code, ['__noop'], [{ name: 'run', code: 'return true' }]));
    setBusy(false);
  };
  return (
    <div className="card stack sm">
      <div className="row between"><b>Scratchpad</b><TruthLabel kind="executed" /></div>
      <Seg label="Scratchpad language" value={lang} onChange={(v) => { setLang(v); setCode(SCRATCH[v]); setRun(null); }} options={[{ id: 'javascript', label: 'JavaScript' }, { id: 'python', label: 'Python' }]} />
      <Suspense fallback={<textarea className="textarea code" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Scratchpad code" />}>
        <CodeEditor key={lang} value={code} onChange={setCode} height="160px" label="Scratchpad code" language={lang} />
      </Suspense>
      <button className="btn sm" onClick={exec} disabled={busy}><Icon name="play" /> {busy ? (lang === 'python' ? 'Running (loading Python the first time)…' : 'Running…') : 'Run'}</button>
      {run && <div className="console">{run.compileError ? `Error: ${run.compileError}` : run.timedOut ? `Timed out after ${lang === 'python' ? 5 : 2}s` : run.logs.join('\n') || '(no output)'}</div>}
    </div>
  );
}

// ───────── API Lab
const msgSchema = z.object({
  model: z.string().min(1, 'model is required'),
  max_tokens: z.number().int().positive('max_tokens must be a positive integer'),
  system: z.string().optional(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) })).min(1, 'at least one message'),
}).strict().superRefine((v, ctx) => {
  if (v.messages[0]?.role !== 'user') ctx.addIssue({ code: 'custom', message: 'the first message must have role "user"', path: ['messages', 0, 'role'] });
  v.messages.forEach((m, i) => { if (i > 0 && m.role === v.messages[i - 1].role) ctx.addIssue({ code: 'custom', message: 'roles should alternate user/assistant', path: ['messages', i, 'role'] }); });
});
const SAMPLE_REQ = `{\n  "model": "claude-opus-5-5",\n  "max_tokens": 300,\n  "system": "You classify support tickets. Reply with one label: billing, bug, feature or needs-human.",\n  "messages": [\n    { "role": "user", "content": "I was charged twice this month." }\n  ]\n}`;
const SAMPLE_RES = `{\n  "id": "msg_example",\n  "type": "message",\n  "role": "assistant",\n  "model": "claude-opus-5-5",\n  "content": [ { "type": "text", "text": "billing" } ],\n  "stop_reason": "end_turn",\n  "usage": { "input_tokens": 41, "output_tokens": 3 }\n}`;
function ApiLab() {
  const [raw, setRaw] = useState(SAMPLE_REQ);
  const [showRes, setShowRes] = useState(false);
  const provider = useLearner((s) => s.provider);
  const [live, setLive] = useState<CompletionResult | null>(null);
  const [err, setErr] = useState('');
  const record = useLearner((s) => s.recordEvidence);
  const parsed = useMemo(() => {
    try {
      const j = JSON.parse(raw);
      const r = msgSchema.safeParse(j);
      return r.success ? { ok: true as const, data: r.data } : { ok: false as const, errors: r.error.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`) };
    } catch (e) {
      return { ok: false as const, errors: [`Invalid JSON: ${(e as Error).message}`] };
    }
  }, [raw]);
  const [q, setQ] = useState<string | null>(null);
  return (
    <div className="grid g2">
      <section className="card stack">
        <div className="row between"><b>Build a Messages API request</b><TruthLabel kind="executed" detail="Request validated live with a Zod schema of the Messages API shape (subset)." /></div>
        <Suspense fallback={<textarea className="textarea code" value={raw} onChange={(e) => setRaw(e.target.value)} />}><CodeEditor value={raw} onChange={setRaw} height="260px" label="Request JSON" /></Suspense>
        {parsed.ok ? <div className="callout small">✓ Valid request shape.</div> : <div className="callout danger small">{parsed.errors.map((e) => <div key={e}>✗ {e}</div>)}</div>}
        <div className="row">
          <button className="btn" onClick={() => setShowRes(true)} disabled={!parsed.ok}>Inspect example response</button>
          {providerReady(provider) && provider.provider === 'anthropic' && <button className="btn primary" disabled={!parsed.ok} onClick={async () => { setErr(''); try { if (!parsed.ok) return; setLive(await complete({ ...provider, model: parsed.data.model }, { system: parsed.data.system ?? '', messages: parsed.data.messages, maxTokens: parsed.data.max_tokens })); } catch (e) { setErr(String((e as Error).message)); } }}><Icon name="play" /> Send for real</button>}
        </div>
        {err && <div className="callout danger small">{err}</div>}
        <div className="tiny faint">Try breaking it: remove max_tokens, start with an assistant message, or add an unknown field. In a real app, the official SDK builds this for you — and the key stays on your server.</div>
      </section>
      <section className="card stack">
        {live ? (
          <><div className="row between"><b>Response</b><TruthLabel kind="live" detail={`${live.model}`} /></div><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify({ model: live.model, text: live.text, stop_reason: live.stopReason, usage: live.usage }, null, 2)}</pre></>
        ) : showRes ? (
          <><div className="row between"><b>Example response</b><TruthLabel kind="demo" /></div><pre>{SAMPLE_RES}</pre></>
        ) : <div className="empty">Validate a request, then inspect the response shape.</div>}
        {(showRes || live) && (
          <div className="stack sm">
            <b>Check: the stop_reason is "end_turn". If it were "max_tokens", what should your code do?</b>
            {[['Treat the output as possibly truncated and not parse it as complete', true], ['Display it as the final answer', false], ['Retry the identical request until stop_reason changes', false]].map(([t, ok]) => (
              <button key={t as string} className={`opt ${q ? (ok ? 'right' : q === t ? 'wrong' : '') : ''}`} disabled={!!q} onClick={() => { setQ(t as string); record({ skillId: 'api-basics', source: 'practice', score: ok ? 1 : 0, difficulty: 2, hintsUsed: 0, solutionRevealed: false, errorTags: ok ? [] : ['poor-verification'], gradedBy: 'deterministic', itemId: 'api-lab-stop' }, 'API Lab: stop reason'); }}>{t as string}</button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ───────── Review Lab
function ReviewLab() {
  const [idx, setIdx] = useState(0);
  const d = REVIEW_DIFFS[idx];
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState(false);
  const record = useLearner((s) => s.recordEvidence);
  const submit = () => {
    const tp = d.observations.filter((o) => o.real && marks[o.text]).length;
    const fp = d.observations.filter((o) => !o.real && marks[o.text]).length;
    const fn = d.observations.filter((o) => o.real && !marks[o.text]).length;
    const f1 = tp ? (2 * tp) / (2 * tp + fp + fn) : 0;
    record({ skillId: 'cc-review', source: 'exercise', score: f1, difficulty: 3, hintsUsed: 0, solutionRevealed: false, errorTags: f1 < 0.7 ? ['poor-verification'] : [], gradedBy: 'deterministic', itemId: `review-lab:${d.id}` }, `Review Lab: ${d.title}`);
    setDone(true);
  };
  return (
    <div className="grid g2">
      <section className="card stack">
        <div className="row between"><b>{d.title}</b><select className="select" style={{ width: 'auto' }} value={idx} onChange={(e) => { setIdx(+e.target.value); setMarks({}); setDone(false); }}>{REVIEW_DIFFS.map((x, i) => <option key={x.id} value={i}>{i + 1}. {x.title}</option>)}</select></div>
        <div className="small">Request to the agent: <i>{d.request}</i></div>
        <pre className="small">{d.diff.split('\n').map((l, i) => <div key={i} style={{ color: l.startsWith('+') && !l.startsWith('+++') ? 'var(--success)' : l.startsWith('-') && !l.startsWith('---') ? 'var(--danger)' : undefined }}>{l}</div>)}</pre>
      </section>
      <section className="card stack">
        <b>Which of these are real problems with this AI-generated change?</b>
        {d.observations.map((o) => (
          <button key={o.text} className={`opt ${done ? (o.real ? 'right' : marks[o.text] ? 'wrong' : '') : ''}`} aria-pressed={!!marks[o.text]} disabled={done} onClick={() => setMarks({ ...marks, [o.text]: !marks[o.text] })}>
            <span className="key">{marks[o.text] ? '✓' : ''}</span><span>{o.text}{done && <span className="tiny" style={{ display: 'block', marginTop: 4 }}>{o.real ? 'Real issue — ' : 'Not an issue — '}{o.why}</span>}</span>
          </button>
        ))}
        {!done ? <button className="btn primary" onClick={submit}>Submit review</button> : <button className="btn" onClick={() => { setIdx((idx + 1) % REVIEW_DIFFS.length); setMarks({}); setDone(false); }}>Next diff</button>}
        <div className="tiny faint">Scored by F1 over real issues; recorded as evidence for "Reviewing diffs & Git safety".</div>
      </section>
    </div>
  );
}

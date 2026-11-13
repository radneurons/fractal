import { lazy, Suspense, useState } from 'react';
import { PROJECTS, projectById, type Milestone, type Project } from '@/content/projects';
import { getSkill } from '@/content/skills';
import { useLearner } from '@/store/learner';
import { runInSandbox, type SandboxRun } from '@/core/runtime/sandbox';
import { Icon, PageHeader, Tabs, TruthLabel, useToast } from '@/ui/kit';
import { href } from '@/ui/router';

const CodeEditor = lazy(() => import('@/ui/CodeEditor'));

export default function Projects({ projectId }: { projectId?: string }) {
  const p = projectId ? projectById(projectId) : undefined;
  const [tab, setTab] = useState<'projects' | 'planning'>('projects');
  if (p) return <ProjectView p={p} />;
  return (
    <div>
      <PageHeader eyebrow="Project Workshop" title="Build things that work">Guided projects have executable milestones graded by real tests. Briefs are open-ended with a rubric — there is no single reference implementation to copy.</PageHeader>
      <Tabs label="Workshop" value={tab} onChange={setTab} tabs={[{ id: 'projects', label: 'Projects' }, { id: 'planning', label: 'Planning Lab' }]} />
      {tab === 'projects' ? <ProjectList /> : <PlanningLab />}
    </div>
  );
}

function ProjectList() {
  const progress = useLearner((s) => s.projects);
  return (
    <div className="grid auto">
      {PROJECTS.map((p) => {
        const pr = progress[p.id];
        const done = pr ? p.milestones.filter((m) => pr.milestones[m.id]?.done).length : 0;
        return (
          <a key={p.id} className="card hover" href={href(`/projects/${p.id}`)}>
            <div className="row between"><span className="chip">{p.level}</span>{p.guided ? <span className="chip accent">guided · tests</span> : <span className="chip">brief · rubric</span>}</div>
            <h3 style={{ margin: '8px 0 4px' }}>{p.title}</h3>
            <div className="small muted">{p.scenario.slice(0, 130)}…</div>
            <div className="bar" style={{ marginTop: 12 }}><span style={{ width: `${(done / p.milestones.length) * 100}%` }} /></div>
            <div className="tiny faint" style={{ marginTop: 6 }}>{pr?.completedAt ? '✓ Completed · portfolio artifact' : `${done}/${p.milestones.length} milestones`}</div>
          </a>
        );
      })}
    </div>
  );
}

function ProjectView({ p }: { p: Project }) {
  const pr = useLearner((s) => s.projects[p.id]);
  const setProject = useLearner((s) => s.setProject);
  const record = useLearner((s) => s.recordEvidence);
  const log = useLearner((s) => s.log);
  const { toast } = useToast();
  const [open, setOpen] = useState<string>(p.milestones.find((m) => !pr?.milestones[m.id]?.done)?.id ?? p.milestones[0].id);
  const done = p.milestones.filter((m) => pr?.milestones[m.id]?.done).length;
  const complete = (m: Milestone, score: number) => {
    const prev = useLearner.getState().projects[p.id];
    const ms = { ...(prev?.milestones ?? {}), [m.id]: { done: score >= 0.7 || m.kind !== 'code', at: Date.now(), score } };
    const all = p.milestones.every((k) => ms[k.id]?.done);
    setProject(p.id, (x) => ({ ...x, milestones: ms, completedAt: all ? x.completedAt ?? Date.now() : x.completedAt }));
    if (all && !prev?.completedAt) {
      log({ kind: 'project', title: `Completed project: ${p.title}` });
      toast('Project complete — added to your portfolio');
    }
    record({ skillId: m.skillId, source: m.kind === 'code' ? 'project' : 'self', score, difficulty: p.level === 'beginner' ? 2 : p.level === 'intermediate' ? 3 : 4, hintsUsed: 0, solutionRevealed: false, errorTags: score < 0.7 ? ['incomplete'] : [], gradedBy: m.kind === 'code' ? 'executed' : 'self', itemId: `project:${p.id}:${m.id}` }, `${p.title}: ${m.title}`);
    const idx = p.milestones.indexOf(m);
    if (score >= 0.7 && p.milestones[idx + 1]) setOpen(p.milestones[idx + 1].id);
  };
  return (
    <div className="stack lg">
      <a className="btn ghost sm" href={href('/projects')} style={{ justifySelf: 'start', alignSelf: 'flex-start' }}><Icon name="back" /> Workshop</a>
      <PageHeader eyebrow={`${p.level} · ${p.guided ? 'guided project' : 'project brief'}`} title={p.title}>{p.scenario}</PageHeader>
      <div className="grid g3">
        <div className="card"><div className="card-title">Requirements</div><ul className="small" style={{ margin: 0, paddingLeft: '1.2em' }}>{p.requirements.map((r) => <li key={r}>{r}</li>)}</ul></div>
        <div className="card"><div className="card-title">Constraints</div><ul className="small" style={{ margin: 0, paddingLeft: '1.2em' }}>{p.constraints.map((r) => <li key={r}>{r}</li>)}</ul><div className="card-title" style={{ marginTop: 12 }}>Suggested architecture</div><p className="small muted" style={{ margin: 0 }}>{p.architecture}</p></div>
        <div className="card"><div className="card-title">Rubric</div>{p.rubric.map((r) => <div key={r.criterion} className="row between small" style={{ padding: '3px 0' }}><span>{r.criterion}</span><span className="chip">{r.weight}</span></div>)}<div className="tiny faint" style={{ marginTop: 8 }}>Portfolio artifact: {p.portfolio}</div></div>
      </div>
      <div className="row between"><h3 style={{ margin: 0 }}>Milestones · {done}/{p.milestones.length}</h3>{pr?.completedAt && <span className="chip amber">✓ Completed {new Date(pr.completedAt).toLocaleDateString()}</span>}</div>
      <div className="stack">
        {p.milestones.map((m, i) => {
          const st = pr?.milestones[m.id];
          return (
            <section key={m.id} className="card" style={st?.done ? { borderColor: 'color-mix(in srgb, var(--success) 45%, var(--border))' } : undefined}>
              <button className="row between" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', padding: 0, textAlign: 'left' }} onClick={() => setOpen(open === m.id ? '' : m.id)} aria-expanded={open === m.id}>
                <span className="row nowrap"><span className="chip">{i + 1}</span><b>{m.title}</b><span className="chip">{m.kind}</span></span>
                <span className="tiny faint">{st?.done ? `✓ done${st.score !== undefined && m.kind === 'code' ? ` · ${Math.round(st.score * 100)}%` : ''}` : getSkill(m.skillId).title}</span>
              </button>
              {open === m.id && <div style={{ marginTop: 14 }}><MilestoneBody p={p} m={m} onComplete={(s) => complete(m, s)} /></div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function MilestoneBody({ p, m, onComplete }: { p: Project; m: Milestone; onComplete: (score: number) => void }) {
  const pr = useLearner((s) => s.projects[p.id]);
  const setProject = useLearner((s) => s.setProject);
  const code = pr?.code[m.id] ?? m.starter ?? '';
  const note = pr?.notes[m.id] ?? '';
  const [checks, setChecks] = useState<Record<number, boolean>>({});
  const [run, setRun] = useState<SandboxRun | null>(null);
  const [busy, setBusy] = useState(false);
  if (m.kind === 'code') {
    const exec = async (submit: boolean) => {
      setBusy(true);
      const r = await runInSandbox(code, m.exports!, m.tests!);
      setRun(r);
      setBusy(false);
      if (submit) onComplete(r.passed / r.total);
    };
    return (
      <div className="stack sm">
        <p className="small" style={{ margin: 0 }}>{m.brief}</p>
        <Suspense fallback={<textarea className="textarea code" value={code} onChange={(e) => setProject(p.id, (x) => ({ ...x, code: { ...x.code, [m.id]: e.target.value } }))} />}>
          <CodeEditor value={code} onChange={(v) => setProject(p.id, (x) => ({ ...x, code: { ...x.code, [m.id]: v } }))} height="240px" label={`${m.title} code`} />
        </Suspense>
        <div className="row"><button className="btn" onClick={() => exec(false)} disabled={busy}><Icon name="play" /> Run tests</button><button className="btn primary" onClick={() => exec(true)} disabled={busy}><Icon name="check" /> Submit milestone</button><TruthLabel kind="executed" /><span className="tiny faint">Passes at ≥ 70% of tests · code autosaves</span></div>
        {run && (
          <div className="card inset">
            <b>{run.timedOut ? '⏱ Timed out' : run.compileError ? '⚠ Did not compile' : `${run.passed}/${run.total} tests passed`}</b>
            {run.compileError && <pre style={{ color: 'var(--danger)' }}>{run.compileError}</pre>}
            {run.results.map((r) => <div key={r.name} className="test-row"><span className={r.passed ? 'pass' : 'fail'}>{r.passed ? '✓' : '✗'}</span>{r.name}{!r.passed && <span className="tiny faint mono">— {r.error}</span>}</div>)}
            {!!run.logs.length && <div className="console">{run.logs.join('\n')}</div>}
          </div>
        )}
      </div>
    );
  }
  const all = (m.checklist ?? []).every((_, i) => checks[i]);
  return (
    <div className="stack sm">
      <p className="small" style={{ margin: 0 }}>{m.brief}</p>
      {m.checklist && m.checklist.map((c, i) => <label key={c} className="switch small"><input type="checkbox" checked={!!checks[i]} onChange={(e) => setChecks({ ...checks, [i]: e.target.checked })} /> {c}</label>)}
      <label className="field">{m.prompt ?? 'Your notes / artifact'}<textarea className="textarea" value={note} onChange={(e) => setProject(p.id, (x) => ({ ...x, notes: { ...x.notes, [m.id]: e.target.value } }))} /></label>
      <div className="row"><button className="btn primary" disabled={note.trim().length < 40 || (m.checklist && !all)} onClick={() => onComplete(1)}>Mark milestone complete</button><span className="tiny faint">Self-assessed: recorded with low evidence weight (0.2×) — it shows effort, not demonstrated mastery.</span></div>
    </div>
  );
}

// ───────── Planning Lab
const PLAN_STEPS: { id: string; title: string; prompt: string; check: (t: string) => string | null }[] = [
  { id: 'users', title: 'Users & problem', prompt: 'Who are the users, and what job are they trying to get done?', check: (t) => (t.length < 40 ? 'Describe the users and their problem in a sentence or two.' : null) },
  { id: 'outcomes', title: 'Outcomes', prompt: 'What does success look like? Use measurable outcomes.', check: (t) => (/\d/.test(t) ? null : 'Add a number: a threshold, time, rate or count.') },
  { id: 'scope', title: 'Goals & non-goals', prompt: 'List goals, then explicit non-goals.', check: (t) => (/non-goal|not |won't|out of scope/i.test(t) ? null : 'Name at least one explicit non-goal.') },
  { id: 'risks', title: 'Risks & mitigations', prompt: 'What could go wrong (incl. AI-specific failures), and how will you mitigate it?', check: (t) => (/mitigat|so that|by |prevent|review|limit|confirm/i.test(t) ? null : 'Pair each risk with a mitigation.') },
  { id: 'arch', title: 'Architecture & tools', prompt: 'Components, data flow, and which tools/permissions the agent needs.', check: (t) => (/read|write|permission|scope|tool/i.test(t) ? null : 'State which tools are needed and what permissions they get.') },
  { id: 'milestones', title: 'Milestones', prompt: 'Break the work into 3–5 milestones, each independently testable.', check: (t) => ((t.match(/\n|;|\d\./g) ?? []).length >= 2 ? null : 'List at least three milestones.') },
  { id: 'acceptance', title: 'Acceptance criteria & tests', prompt: 'How will you know each milestone is done? Include tests or eval sets.', check: (t) => (/test|eval|measure|pass/i.test(t) ? null : 'Say how each criterion is tested.') },
  { id: 'cost', title: 'Cost & failure modes', prompt: 'Estimate cost drivers and how the system behaves when the AI is wrong or unavailable.', check: (t) => (/cost|token|budget|\$/i.test(t) && /fail|wrong|fallback|unavailable|human/i.test(t) ? null : 'Cover both cost and failure behaviour.') },
];
function PlanningLab() {
  const drafts = useLearner((s) => s.drafts);
  const setDraft = useLearner((s) => s.setDraft);
  const record = useLearner((s) => s.recordEvidence);
  const addVault = useLearner((s) => s.addVault);
  const { toast } = useToast();
  const [graded, setGraded] = useState(false);
  const val = (id: string) => drafts[`plan:${id}`] ?? '';
  const results = PLAN_STEPS.map((s) => ({ ...s, issue: s.check(val(s.id)) }));
  const ok = results.filter((r) => !r.issue).length;
  const agentsMd = `# AGENTS.md / CLAUDE.md (draft generated from your plan)\n\n## Project\n${val('users').slice(0, 300)}\n\n## Scope\n${val('scope').slice(0, 300)}\n\n## Architecture & tools\n${val('arch').slice(0, 300)}\n\n## How to verify\n${val('acceptance').slice(0, 300)}\n\n## Constraints\n- Ask before any action outside the stated tool permissions.\n- Prefer small, reviewable changes; run tests before finishing.\n`;
  return (
    <div className="stack">
      <div className="callout">Vague request: <b>"Build an AI assistant that can analyse a repository and propose improvements."</b> Turn it into an implementable plan. Checks reward judgement signals (measurable outcomes, non-goals, mitigations) — not length.</div>
      <div className="grid g2">
        {results.map((s, i) => (
          <label key={s.id} className="card field">
            <span>{i + 1}. {s.title}</span>
            <span className="tiny faint" style={{ fontWeight: 400 }}>{s.prompt}</span>
            <textarea className="textarea" value={val(s.id)} onChange={(e) => { setDraft(`plan:${s.id}`, e.target.value); setGraded(false); }} />
            {graded && <span className="tiny" style={{ color: s.issue ? 'var(--warn)' : 'var(--success)', fontWeight: 500 }}>{s.issue ?? '✓ Looks solid'}</span>}
          </label>
        ))}
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => { setGraded(true); record({ skillId: 'pr-requirements', source: 'practice', score: ok / PLAN_STEPS.length, difficulty: 3, hintsUsed: 0, solutionRevealed: false, errorTags: ok < 6 ? ['weak-planning'] : [], gradedBy: 'heuristic', itemId: 'planning-lab' }, 'Planning Lab'); }}>Check my plan</button>
        <button className="btn" onClick={() => { addVault({ kind: 'decision', title: 'Repository assistant — project plan', body: results.map((r) => `### ${r.title}\n${val(r.id)}`).join('\n\n'), tags: ['plan'], skillIds: ['pr-requirements'] }); toast('Plan saved to Vault'); }}>Save plan to Vault</button>
        {graded && <span className="chip">{ok}/{PLAN_STEPS.length} sections pass the checks</span>}
        <TruthLabel kind="heuristic" detail="Simple judgement checks per section; a reviewer or model should still read the plan." />
      </div>
      <details className="card"><summary><b>Generated agent instruction file (editable starting point)</b></summary><pre style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>{agentsMd}</pre></details>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useLearner } from '@/store/learner';
import { useModel } from '@/store/model';
import type { GoalPath, Profile } from '@/core/types';
import { PATHS } from '@/core/engines/planner';
import { DIAGNOSTIC_LENGTH, PROBES, nextProbe, placementSummary, probeItem, type DiagStep } from '@/core/engines/diagnostic';
import { ITEMS } from '@/content/items';
import { getSkill } from '@/content/skills';
import { lessonById } from '@/content/lessons';
import ItemView from '@/ui/ItemView';
import { BrandMark, Icon, StateChip } from '@/ui/kit';
import { navigate, href } from '@/ui/router';

const LEVELS: { id: Profile['level']; title: string; desc: string }[] = [
  { id: 'zero', title: 'Starting from zero', desc: 'New to AI, or just curious. No coding needed to begin.' },
  { id: 'uses-ai', title: 'I already use AI', desc: 'Comfortable with chat assistants; want to go further.' },
  { id: 'developer', title: 'Developer / test my skills', desc: 'I write code and want to build with models and agents.' },
];

export default function Onboarding() {
  const qs = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const initialLevel = (qs.get('level') as Profile['level']) || 'zero';
  const setProfile = useLearner((s) => s.setProfile);
  const setDiagnostic = useLearner((s) => s.setDiagnostic);
  const existing = useLearner((s) => s.profile);
  const [step, setStep] = useState(0);
  const [level, setLevel] = useState<Profile['level']>(existing?.level ?? initialLevel);
  const [path, setPath] = useState<GoalPath>(existing?.path ?? (initialLevel === 'developer' ? 'agent-engineer' : 'power-user'));
  const [minutes, setMinutes] = useState<20 | 40 | 60>(existing?.minutesPerSession ?? 20);
  const [perWeek, setPerWeek] = useState(existing?.sessionsPerWeek ?? 4);
  const [lang, setLang] = useState<Profile['language']>(existing?.language ?? 'javascript');
  const [history, setHistory] = useState<DiagStep[]>([]);
  const [pending, setPending] = useState<DiagStep | null>(null);

  const probeIndex = useMemo(() => nextProbe(level, history), [level, history]);
  const len = DIAGNOSTIC_LENGTH[level];
  const steps = ['Experience', 'Goal', 'Time', 'Skills check', 'Your plan'];

  const finishSetup = () => {
    setProfile({ level, path, minutesPerSession: minutes, sessionsPerWeek: perWeek, language: lang, onboarded: false, diagnosticDone: false });
    setStep(3);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', alignContent: 'start', justifyItems: 'center', padding: '28px 16px 64px' }}>
      <div style={{ width: 'min(860px, 100%)' }} className="stack lg">
        <div className="row between">
          <a className="row" href={href('/')} style={{ textDecoration: 'none', color: 'var(--text)' }}><BrandMark /> <b style={{ fontFamily: 'var(--font-display)' }}>AgentForge</b></a>
          {existing?.onboarded && <a className="btn ghost sm" href={href('/home')}>Skip to Command Center</a>}
        </div>
        <div>
          <div className="progress-steps" aria-hidden="true">{steps.map((s, i) => <span key={s} className={i <= step ? 'on' : ''} />)}</div>
          <div className="tiny faint" style={{ marginTop: 6 }}>Step {step + 1} of {steps.length} · {steps[step]}</div>
        </div>

        {step === 0 && (
          <section className="stack fade-in">
            <h1>Where are you starting from?</h1>
            <p className="muted">This only sets your starting point — the skills check and your later results decide what you see next.</p>
            <div className="opts" role="radiogroup" aria-label="Experience level">
              {LEVELS.map((l) => (
                <button key={l.id} role="radio" aria-checked={level === l.id} className="opt" onClick={() => setLevel(l.id)}>
                  <span className="key">{level === l.id ? '✓' : ''}</span>
                  <span><b>{l.title}</b><br /><span className="small muted">{l.desc}</span></span>
                </button>
              ))}
            </div>
            <div className="row"><button className="btn primary lg" onClick={() => setStep(1)}>Continue <Icon name="arrow" /></button></div>
          </section>
        )}

        {step === 1 && (
          <section className="stack fade-in">
            <h1>What do you want to become?</h1>
            <p className="muted">Pathways share skills — switching later keeps everything you've demonstrated.</p>
            <div className="grid g2">
              {(Object.entries(PATHS) as [GoalPath, (typeof PATHS)[GoalPath]][]).map(([id, p]) => (
                <button key={id} className="opt" role="radio" aria-checked={path === id} onClick={() => setPath(id)} style={{ alignItems: 'flex-start' }}>
                  <span className="key">{p.letter}</span>
                  <span><b>{p.title}</b><br /><span className="small muted">{p.blurb}</span></span>
                </button>
              ))}
            </div>
            <div className="row"><button className="btn ghost" onClick={() => setStep(0)}>Back</button><button className="btn primary lg" onClick={() => setStep(2)}>Continue <Icon name="arrow" /></button></div>
          </section>
        )}

        {step === 2 && (
          <section className="stack fade-in">
            <h1>How much time do you have?</h1>
            <p className="muted">Your plan fits every session into this budget. Missed sessions just roll forward — no penalties.</p>
            <fieldset className="card stack" style={{ border: '1px solid var(--border)' }}>
              <legend className="small muted" style={{ padding: '0 6px' }}>Minutes per session</legend>
              <div className="seg" role="group" aria-label="Minutes per session">{([20, 40, 60] as const).map((m) => <button key={m} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{m} min</button>)}</div>
              <label className="field">Sessions per week: {perWeek}
                <input type="range" min={1} max={7} value={perWeek} onChange={(e) => setPerWeek(Number(e.target.value))} aria-valuetext={`${perWeek} sessions per week`} />
              </label>
              <label className="field">Preferred programming language (for code examples)
                <select className="select" value={lang} onChange={(e) => setLang(e.target.value as Profile['language'])}>
                  <option value="javascript">JavaScript (runs in-browser)</option>
                  <option value="typescript">TypeScript</option>
                  <option value="python">Python (runs in your browser via WebAssembly)</option>
                </select>
              </label>
            </fieldset>
            <div className="row"><button className="btn ghost" onClick={() => setStep(1)}>Back</button><button className="btn primary lg" onClick={finishSetup}>Start the skills check <Icon name="arrow" /></button></div>
          </section>
        )}

        {step === 3 && (
          <section className="stack fade-in">
            <div className="row between">
              <h1 style={{ margin: 0 }}>Quick skills check</h1>
              <span className="chip">{Math.min(history.length + 1, len)} / {len}</span>
            </div>
            <p className="muted">Adaptive: a correct answer moves you to harder material, a miss to easier. "I don't know yet" is a perfectly good answer — it just helps place you. Diagnostic evidence counts, but with lower weight than practice.</p>
            {probeIndex !== null && (
              <ItemView
                key={probeIndex}
                item={probeItem(PROBES[probeIndex], ITEMS)}
                source="diagnostic"
                allowRetry={false}
                hideHints
                label={`Diagnostic question ${history.length + 1}`}
                onGraded={(r) => {
                  const it = probeItem(PROBES[probeIndex], ITEMS);
                  const unknown = r.score === 0 && r.errorTags.length === 1 && r.errorTags[0] === 'incomplete' && r.feedback[0]?.includes("don't know");
                  setPending({ probeIndex, skillId: PROBES[probeIndex], itemId: it.id, correct: unknown ? null : r.correct });
                }}
              />
            )}
            {pending && (
              <div className="row">
                <button className="btn primary" autoFocus onClick={() => { const h = [...history, pending]; setHistory(h); setDiagnostic(h); setPending(null); }}>
                  {history.length + 1 >= len ? 'Finish' : 'Next question'} <Icon name="arrow" />
                </button>
              </div>
            )}
            {probeIndex === null && (
              <div className="row"><button className="btn primary lg" onClick={() => { setProfile({ diagnosticDone: true }); setStep(4); }}>See my results <Icon name="arrow" /></button></div>
            )}
            {probeIndex !== null && history.length > 0 && !pending && (
              <div className="row"><button className="btn ghost sm" onClick={() => { setProfile({ diagnosticDone: true }); setStep(4); }}>Finish early and see results</button></div>
            )}
          </section>
        )}

        {step === 4 && <PlanReveal history={history} />}
      </div>
    </div>
  );
}

function PlanReveal({ history }: { history: DiagStep[] }) {
  const setProfile = useLearner((s) => s.setProfile);
  const profile = useLearner((s) => s.profile)!;
  const { next, est, plan } = useModel();
  const summary = placementSummary(history);
  const first = next.find((b) => b.kind === 'lesson') ?? next[0];
  const go = (to: string) => {
    setProfile({ onboarded: true });
    navigate(to);
  };
  return (
    <section className="stack lg fade-in">
      <div>
        <div className="eyebrow">Your starting point</div>
        <h1>Here's what we found</h1>
        <p className="muted">Based on {history.length} diagnostic answers. These are early estimates with low confidence — practice will sharpen them. Placement band: <b>{summary.band}</b>.</p>
      </div>
      <div className="grid g2">
        <div className="card">
          <div className="card-title">Showed understanding</div>
          {summary.strong.length ? summary.strong.map((s) => <div key={s} className="row between small" style={{ padding: '4px 0' }}><span>{getSkill(s).title}</span><StateChip state={est[s].state} compact /></div>) : <p className="small faint">Nothing yet — that's exactly what the Foundations are for.</p>}
        </div>
        <div className="card">
          <div className="card-title">To develop</div>
          {summary.developing.length ? summary.developing.map((s) => <div key={s} className="row between small" style={{ padding: '4px 0' }}><span>{getSkill(s).title}</span><StateChip state={est[s].state} compact /></div>) : <p className="small faint">No misses — impressive. Your plan starts further along.</p>}
        </div>
      </div>
      <div className="card">
        <div className="card-title">Your first week · {PATHS[profile.path].title} · {profile.minutesPerSession} min/session</div>
        <div className="grid auto-sm">
          {plan.filter((d) => d.blocks.length).slice(0, 4).map((d) => (
            <div key={d.date} className="card inset">
              <div className="tiny faint">{new Date(d.date).toLocaleDateString(undefined, { weekday: 'long' })} · {d.minutes} min</div>
              {d.blocks.slice(0, 3).map((b, i) => <div key={i} className="small" style={{ marginTop: 6 }}>• {b.title}</div>)}
            </div>
          ))}
        </div>
      </div>
      <div className="row">
        {first && <button className="btn primary lg" onClick={() => go(first.route)}>Start: {first.title} <Icon name="arrow" /></button>}
        {lessonById.get('L-ag01') && first?.lessonId !== 'L-ag01' && <button className="btn lg" onClick={() => go('/lesson/L-ag01')}>Or try the signature lesson: Chatbot vs Agent</button>}
        <button className="btn ghost" onClick={() => go('/home')}>Go to Command Center</button>
      </div>
    </section>
  );
}

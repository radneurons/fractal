import { useEffect, useMemo, useRef, useState } from 'react';
import { getSkill } from '@/content/skills';
import { ITEMS, itemsForSkill, getItem } from '@/content/items';
import { lessonsForSkill } from '@/content/lessons';
import { useLearner } from '@/store/learner';
import { useModel } from '@/store/model';
import { recoveryPlan } from '@/core/engines/weakness';
import type { Item } from '@/core/types';
import ItemView from '@/ui/ItemView';
import { Icon, Markdown, MasteryBar, PageHeader, StateChip, fmtRel } from '@/ui/kit';
import { currentPath, href } from '@/ui/router';

export default function SkillSession({ skillId }: { skillId?: string }) {
  const kind = currentPath().split('/')[1] as 'practice' | 'review' | 'recover';
  if (!skillId) return <ReviewQueue />;
  if (kind === 'recover') return <Recover skillId={skillId} />;
  return <Practice skillId={skillId} review={kind === 'review'} />;
}

function nextItemFor(skillId: string, evidence: { itemId?: string; score: number; at: number }[], exclude: string[] = []): Item {
  const pool = itemsForSkill(skillId).filter((i) => !exclude.includes(i.id));
  const last = new Map<string, { score: number; at: number }>();
  for (const e of evidence) if (e.itemId) last.set(e.itemId, e);
  const unseen = pool.filter((i) => !last.has(i.id));
  if (unseen.length) return unseen[0];
  const failed = pool.filter((i) => (last.get(i.id)?.score ?? 1) < 0.7);
  if (failed.length) return failed[0];
  return [...pool].sort((a, b) => (last.get(a.id)?.at ?? 0) - (last.get(b.id)?.at ?? 0))[0] ?? itemsForSkill(skillId)[0];
}

function Practice({ skillId, review }: { skillId: string; review: boolean }) {
  const skill = getSkill(skillId);
  const evidence = useLearner((s) => s.evidence);
  const touch = useLearner((s) => s.touch);
  const { est } = useModel();
  const [done, setDone] = useState<string[]>([]);
  const [showNote, setShowNote] = useState(false);
  const firstEvidence = useRef(evidence);
  const item = useMemo(() => nextItemFor(skillId, firstEvidence.current, done), [skillId, done]);
  const lesson = lessonsForSkill(skillId)[0];
  const [graded, setGraded] = useState(false);
  useEffect(() => {
    touch(skillId);
  }, [skillId]); // eslint-disable-line react-hooks/exhaustive-deps
  const exhausted = done.length >= itemsForSkill(skillId).length;
  const e = est[skillId];
  return (
    <div className="stack lg">
      <PageHeader eyebrow={review ? 'Spaced review · no hints' : 'Practice'} title={skill.title}
        actions={<>{lesson && <a className="btn" href={href(`/lesson/${lesson.id}`)}><Icon name="academy" /> Lesson</a>}{e.state === 'remediation' && <a className="btn danger" href={href(`/recover/${skillId}`)}>Fix this weakness</a>}</>}>
        {skill.summary}
      </PageHeader>
      <div className="grid g-2-1">
        <div className="stack">
          {review && <div className="callout">Retrieval practice: answering from memory (without hints) is what makes knowledge stick. Passing moves the next review further out; missing brings it closer.</div>}
          {exhausted ? (
            <div className="card stack">
              <b>You've attempted every item for this skill in this session.</b>
              <p className="small muted" style={{ margin: 0 }}>Come back after your scheduled review — retrieval after a gap is what builds retention.</p>
              <div className="row"><button className="btn" onClick={() => setDone([])}>Practise again</button><a className="btn primary" href={href('/home')}>Back to Command Center</a></div>
            </div>
          ) : <ItemView key={item.id} item={item} source={review ? 'review' : 'practice'} hideHints={review} onGraded={() => setGraded(true)} />}
          {graded && !exhausted && (
            <div className="row">
              <button className="btn primary" onClick={() => { setDone([...done, item.id]); setGraded(false); }}>Next question <Icon name="arrow" /></button>
              <a className="btn ghost" href={href('/home')}>Done for now</a>
            </div>
          )}
        </div>
        <aside className="stack">
          <div className="card stack sm">
            <div className="row between"><b>Your evidence</b><StateChip state={e.state} compact /></div>
            <MasteryBar e={e} />
            <div className="tiny faint">{e.attempts} attempts · {e.passedItems} distinct items passed{e.nextReview ? ` · review ${fmtRel(e.nextReview)}` : ''}</div>
          </div>
          {!review && (
            <div className="card stack sm">
              <button className="btn sm" onClick={() => setShowNote(!showNote)} aria-expanded={showNote}><Icon name="hint" /> {showNote ? 'Hide' : 'Show'} the key idea</button>
              {showNote && <div className="small fade-in"><Markdown text={skill.remediation} /><div className="tiny faint" style={{ marginTop: 8 }}>Reading the note does not change your mastery estimate — only graded work does.</div></div>}
            </div>
          )}
          {!lesson && <div className="callout small">A full lesson for this skill is planned. The key idea, worked example and practice items here are complete and graded.</div>}
        </aside>
      </div>
    </div>
  );
}

function ReviewQueue() {
  const { due, est } = useModel();
  const practicedNotDue = Object.values(est).filter((e) => ['practiced', 'mastered'].includes(e.state) && !due.includes(e.skillId)).slice(0, 8);
  return (
    <div className="stack lg">
      <PageHeader eyebrow="Spaced repetition" title="Reviews">
        Skills come back for review on a widening schedule (1, 3, 7, 16, 35, 90 days) after each success. "Learned once" becomes "retained" only after a passed review a week or more later.
      </PageHeader>
      <section className="card">
        <div className="card-title">Due now ({due.length})</div>
        {due.length ? (
          <div className="grid auto">{due.map((id) => <a key={id} className="card inset hover" href={href(`/review/${id}`)}><b>{getSkill(id).title}</b><div className="tiny faint">due {fmtRel(est[id].nextReview ?? Date.now())}</div></a>)}</div>
        ) : <p className="muted small">Nothing due. Reviews appear after you succeed on a skill.</p>}
      </section>
      {!!practicedNotDue.length && (
        <section className="card">
          <div className="card-title">Optional extra review</div>
          <div className="grid auto">{practicedNotDue.map((e) => <a key={e.skillId} className="card inset hover" href={href(`/review/${e.skillId}`)}><b>{getSkill(e.skillId).title}</b><div className="tiny faint">next scheduled {e.nextReview ? fmtRel(e.nextReview) : '—'}</div></a>)}</div>
        </section>
      )}
    </div>
  );
}

function Recover({ skillId }: { skillId: string }) {
  const skill = getSkill(skillId);
  const evidence = useLearner((s) => s.evidence);
  const { est, weaknesses } = useModel();
  const [snapshot] = useState(() => ({ ev: evidence, est: est[skillId] }));
  const steps = useMemo(() => recoveryPlan(skill, ITEMS, snapshot.ev, est), [skillId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(0);
  const [gradedStep, setGradedStep] = useState<Record<number, boolean>>({});
  const w = weaknesses.find((x) => x.skillId === skillId);
  const s = steps[i];
  const now = est[skillId];
  return (
    <div className="stack lg">
      <PageHeader eyebrow="Fix this weakness" title={skill.title}>A short, targeted sequence. Your estimate changes only through the new graded evidence it produces.</PageHeader>
      {w && (
        <div className="card stack sm">
          <b>Why this was flagged</b>
          {w.reasons.map((r) => <div key={r} className="small">• {r}</div>)}
          {w.hypotheses.map((h) => <div key={h.text} className="small muted">Hypothesis: {h.text} <span className="tiny faint">({h.evidence})</span></div>)}
        </div>
      )}
      <div className="progress-steps" aria-hidden="true">{steps.map((_, k) => <span key={k} className={k <= i ? 'on' : ''} />)}</div>
      <div className="tiny faint">Step {i + 1} of {steps.length}: {s.title}</div>

      {s.kind === 'explain' && <div className="card prose fade-in"><Markdown text={skill.remediation} /></div>}
      {s.kind === 'example' && <div className="card prose fade-in"><div className="eyebrow">Worked example</div><Markdown text={skill.workedExample} /></div>}
      {(s.kind === 'prereq-check' || s.kind === 'targeted' || s.kind === 'transfer') && s.itemId && (
        <div className="stack">
          {s.kind === 'prereq-check' && <div className="callout violet small">Checking a prerequisite: <b>{getSkill(s.skillId!).title}</b>. If this is the real gap, fixing it first makes everything after easier.</div>}
          {s.kind === 'transfer' && <div className="callout small">A different problem on the same skill — this checks the understanding transfers, not just memory of one question.</div>}
          <ItemView key={s.itemId} item={getItem(s.itemId)} source="remediation" onGraded={() => setGradedStep({ ...gradedStep, [i]: true })} />
        </div>
      )}
      {s.kind === 'schedule' && (
        <div className="grid g2 fade-in">
          <div className="card stack sm"><b>Before</b><StateChip state={snapshot.est.state} /><MasteryBar e={snapshot.est} /></div>
          <div className="card stack sm"><b>Now</b><StateChip state={now.state} /><MasteryBar e={now} /><div className="tiny faint">{now.nextReview ? `Spaced review scheduled ${fmtRel(now.nextReview)}.` : 'Review will be scheduled after your first success.'}</div></div>
        </div>
      )}
      <div className="row">
        <button className="btn ghost" disabled={i === 0} onClick={() => setI(i - 1)}><Icon name="back" /> Back</button>
        {i < steps.length - 1 ? (
          <button className="btn primary" disabled={(['prereq-check', 'targeted', 'transfer'].includes(s.kind) && !gradedStep[i])} onClick={() => setI(i + 1)}>Continue <Icon name="arrow" /></button>
        ) : <a className="btn primary" href={href('/observatory')}>See it in the Observatory</a>}
      </div>
    </div>
  );
}

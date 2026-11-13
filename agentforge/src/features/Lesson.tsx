import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { lessonById } from '@/content/lessons';
import { getSkill } from '@/content/skills';
import { getItem, itemsForSkill } from '@/content/items';
import { schoolById } from '@/content/schools';
import { useLearner } from '@/store/learner';
import { useModel } from '@/store/model';
import type { GradeResult, Item } from '@/core/types';
import ItemView from '@/ui/ItemView';
import { Icon, Markdown, MasteryBar, StateChip, fmtRel } from '@/ui/kit';
import { href, navigate } from '@/ui/router';

const Demo = lazy(() => import('./demos'));

const STEP_NAMES = ['Overview', 'Learn', 'Explore', 'Worked example', 'Guided practice', 'Practice', 'Common mistakes', 'Knowledge check', 'Challenge', 'Summary'];

export default function Lesson({ lessonId }: { lessonId: string }) {
  const lesson = lessonById.get(lessonId);
  const progress = useLearner((s) => s.lessonProgress[lessonId]);
  const setProgress = useLearner((s) => s.setLessonProgress);
  const touch = useLearner((s) => s.touch);
  const log = useLearner((s) => s.log);
  const evidence = useLearner((s) => s.evidence);
  const { est, next } = useModel();
  const [mode, setMode] = useState<'standard' | 'simpler' | 'another'>('standard');
  const [followUp, setFollowUp] = useState<{ item: Item; after: string } | null>(null);
  const slots = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!lesson) return;
    if (!progress) setProgress(lessonId, { step: 0 });
    lesson.skillIds.forEach(touch);
  }, [lessonId]); // eslint-disable-line react-hooks/exhaustive-deps

  const steps = useMemo(() => (lesson ? STEP_NAMES.map((n, i) => ({ n, i })).filter(({ i }) => !(i === 2 && !lesson.demo) && !(i === 8 && !lesson.challenge)) : []), [lesson]);
  if (!lesson) return <div className="empty">Lesson not found. <a href={href('/academy')}>Back to the Academy</a></div>;

  const step = progress?.step ?? 0;
  const seen = progress?.seenItems ?? [];
  const pos = steps.findIndex((s) => s.i === step);
  const go = (i: number) => {
    setFollowUp(null);
    setProgress(lessonId, { step: i });
    window.scrollTo({ top: 0 });
  };
  const nextStep = () => {
    const n = steps[pos + 1];
    if (n) go(n.i);
    if (n?.i === 9 && !progress?.completed) {
      setProgress(lessonId, { completed: true, completedAt: Date.now(), step: 9 });
      log({ kind: 'lesson', title: `Completed lesson: ${lesson.title}`, route: `/lesson/${lesson.id}` });
    }
  };
  const pool = lesson.skillIds.flatMap((s) => itemsForSkill(s));
  const pickItem = (authoredId: string) => {
    if (!seen.includes(authoredId)) return getItem(authoredId);
    const taken = new Set(Object.values(slots.current));
    return pool.find((i) => !seen.includes(i.id) && !taken.has(i.id) && i.id !== followUp?.item.id) ?? getItem(authoredId);
  };
  const markSeen = (id: string) => !seen.includes(id) && setProgress(lessonId, { seenItems: [...seen, id] });

  const onGraded = (item: Item) => (r: GradeResult) => {
    markSeen(item.id);
    if (!r.correct) {
      const taken = new Set(Object.values(slots.current));
      const fresh = (i: Item) => i.id !== item.id && !seen.includes(i.id);
      const alt = pool.find((i) => i.skillId === item.skillId && fresh(i) && !taken.has(i.id) && i.type !== 'code') ?? pool.find((i) => fresh(i) && i.type !== 'code') ?? pool.find(fresh);
      if (alt) setFollowUp({ item: alt, after: item.id });
    }
  };

  const school = schoolById(lesson.schoolId);
  const mainSkill = getSkill(lesson.skillIds[0]);
  const sessionEvidence = evidence.filter((e) => lesson.skillIds.includes(e.skillId) && progress && e.at >= progress.startedAt);

  const renderItem = (id: string, label: string) => {
    // Assign each lesson slot once per visit so an answered item never swaps out from under the learner.
    slots.current[id] ??= pickItem(id).id;
    const it = getItem(slots.current[id]);
    return (
      <div className="stack">
        <ItemView key={it.id} item={it} source="lesson" label={label} onGraded={onGraded(it)} />
        {followUp && followUp.after === it.id && (
          <div className="card stack fade-in" style={{ borderColor: 'var(--violet)' }} aria-live="polite">
            <div className="eyebrow" style={{ color: 'var(--violet)' }}>Targeted follow-up</div>
            <p className="small" style={{ margin: 0 }}>That answer suggests a specific misunderstanding. Here's a compact correction, then a <b>different</b> question on the same skill — your mastery estimate only improves from new evidence.</p>
            <div className="callout violet"><Markdown text={getSkill(followUp.item.skillId).remediation} /></div>
            <ItemView key={followUp.item.id} item={followUp.item} source="remediation" label="Follow-up question" onGraded={() => markSeen(followUp.item.id)} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="lesson-layout">
      <nav className="lesson-steps" aria-label="Lesson steps">
        <a className="btn ghost sm" href={href(`/academy/${lesson.schoolId}`)} style={{ marginBottom: 8, justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left' }}><Icon name="back" /> {school.title}</a>
        {steps.map((s, idx) => (
          <button key={s.i} onClick={() => go(s.i)} aria-current={s.i === step ? 'step' : undefined} className={idx < pos || progress?.completed ? 'done' : ''}>
            <span className="b">{idx < pos || progress?.completed ? '✓' : idx + 1}</span><span className="t">{s.n}</span>
          </button>
        ))}
      </nav>

      <article className="stack lg" style={{ minWidth: 0 }}>
        <header>
          <div className="eyebrow">School {school.num} · {school.title} · {lesson.minutes} min · difficulty {lesson.difficulty}/5</div>
          <h1 style={{ marginBottom: 8 }}>{lesson.title}</h1>
          <div className="row"><StateChip state={est[mainSkill.id].state} /><span className="chip">{STEP_NAMES[step]}</span>{lesson.environment === 'simulated' && <span className="chip violet">Uses simulations</span>}</div>
        </header>

        {step === 0 && (
          <section className="stack">
            <div className="card">
              <div className="eyebrow">Learning objective</div>
              <p style={{ fontSize: '1.1rem', margin: 0 }}>{lesson.objective}</p>
            </div>
            <div className="prose"><p>{lesson.motivation}</p></div>
            <div className="grid g2">
              <div className="card inset">
                <div className="card-title">Prerequisites</div>
                {lesson.prerequisites.length ? lesson.prerequisites.map((p) => (
                  <div key={p} className="row between small" style={{ padding: '4px 0' }}><a href={href(`/practice/${p}`)}>{getSkill(p).title}</a><StateChip state={est[p].state} compact /></div>
                )) : <p className="small faint">None — start here.</p>}
                {lesson.prerequisites.some((p) => !['practiced', 'mastered', 'review-due'].includes(est[p].state)) && <p className="tiny faint" style={{ marginTop: 8 }}>Not required — you can continue. If anything feels unfamiliar, the linked skills have quick practice.</p>}
              </div>
              <div className="card inset">
                <div className="card-title">About this lesson</div>
                <div className="small muted">Version {lesson.version} · last reviewed {lesson.lastReviewed} · status: {lesson.status}</div>
                <div className="small" style={{ marginTop: 8 }}>Sources:</div>
                <ul className="small" style={{ margin: '4px 0 0', paddingLeft: '1.2em' }}>{lesson.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.label}</a></li>)}</ul>
              </div>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="stack">
            <div className="seg" role="group" aria-label="Explanation style">
              <button aria-pressed={mode === 'standard'} onClick={() => setMode('standard')}>Standard</button>
              <button aria-pressed={mode === 'simpler'} onClick={() => setMode('simpler')}>Explain simply</button>
              <button aria-pressed={mode === 'another'} onClick={() => setMode('another')}>Teach it another way</button>
            </div>
            {mode === 'standard' && lesson.sections.map((s) => (
              <div key={s.heading} className="prose"><h3>{s.heading}</h3><Markdown text={s.body} /></div>
            ))}
            {mode !== 'standard' && <div className="card prose fade-in"><span className="chip" style={{ marginBottom: 10 }}>Authored explanation</span><p>{mode === 'simpler' ? lesson.simpler : lesson.anotherWay}</p></div>}
          </section>
        )}

        {step === 2 && lesson.demo && (
          <section className="stack">
            <p className="muted">{lesson.demo.caption}</p>
            <Suspense fallback={<div className="card">Loading interactive demo…</div>}><Demo id={lesson.demo.id} /></Suspense>
          </section>
        )}

        {step === 3 && (
          <section className="card prose">
            <div className="eyebrow">Worked example</div>
            <h3 style={{ marginTop: 0 }}>{lesson.workedExample.title}</h3>
            <Markdown text={lesson.workedExample.body} />
          </section>
        )}

        {step === 4 && <section className="stack"><p className="muted">Guided: hints are available (they reduce credit a little). Get it wrong and you'll get a targeted follow-up.</p>{renderItem(lesson.guided, 'Guided practice')}</section>}
        {step === 5 && <section className="stack"><p className="muted">Independent practice — try without hints first.</p>{lesson.practice.map((id) => <div key={id}>{renderItem(id, 'Practice')}</div>)}</section>}
        {step === 6 && (
          <section className="card">
            <div className="card-title">Common mistakes</div>
            <ul className="stack sm" style={{ paddingLeft: '1.2em', margin: 0 }}>{lesson.mistakes.map((m) => <li key={m}>{m}</li>)}</ul>
          </section>
        )}
        {step === 7 && <section className="stack"><p className="muted">Knowledge check — this is your clearest evidence for this skill.</p>{lesson.check.map((id) => <div key={id}>{renderItem(id, 'Knowledge check')}</div>)}</section>}
        {step === 8 && lesson.challenge && <section className="stack"><p className="muted">Optional advanced challenge. Higher difficulty counts more.</p>{renderItem(lesson.challenge, 'Challenge')}</section>}

        {step === 9 && (
          <section className="stack">
            <div className="card">
              <div className="card-title">Summary</div>
              <ul style={{ margin: 0, paddingLeft: '1.2em' }}>{lesson.summary.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
            <div className="grid g2">
              {lesson.skillIds.map((sid) => (
                <div key={sid} className="card">
                  <div className="card-title">{getSkill(sid).title}<span className="spacer" /><StateChip state={est[sid].state} /></div>
                  <MasteryBar e={est[sid]} />
                  <div className="tiny faint" style={{ marginTop: 8 }}>
                    This session: {sessionEvidence.filter((e) => e.skillId === sid).length} graded attempts, {sessionEvidence.filter((e) => e.skillId === sid && e.score >= 0.7).length} successful.
                    {est[sid].nextReview ? ` Review scheduled ${fmtRel(est[sid].nextReview!)}.` : ''}
                  </div>
                  <a className="btn ghost sm" style={{ marginTop: 8 }} href={href('/observatory')}>Why this score?</a>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="card-title">What's next</div>
              {next.slice(0, 3).map((b, i) => <a key={i} className="row nowrap" href={href(b.route)} style={{ padding: '8px 0', color: 'inherit', textDecoration: 'none', borderBottom: '1px solid var(--border)' }}><Icon name="arrow" size={14} /><span style={{ flex: 1 }}>{b.title}</span><span className="tiny faint">{b.reason}</span></a>)}
              <div className="row" style={{ marginTop: 12 }}>
                {lesson.skillIds[0].startsWith('ag-') && <a className="btn" href={href('/studio/revenue-agent')}><Icon name="studio" /> Open an Agent Studio template</a>}
                <a className="btn" href={href('/projects')}><Icon name="projects" /> Beginner projects</a>
              </div>
            </div>
          </section>
        )}

        <footer className="row between" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <button className="btn ghost" onClick={() => pos > 0 && go(steps[pos - 1].i)} disabled={pos <= 0}><Icon name="back" /> Previous</button>
          {pos < steps.length - 1 ? (
            <button className="btn primary" onClick={nextStep}>Next: {steps[pos + 1].n} <Icon name="arrow" /></button>
          ) : (
            <button className="btn primary" onClick={() => navigate(next[0]?.route ?? '/home')}>Continue learning <Icon name="arrow" /></button>
          )}
        </footer>
      </article>
    </div>
  );
}

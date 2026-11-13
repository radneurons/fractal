import { schoolById } from '@/content/schools';
import { SKILLS, getSkill } from '@/content/skills';
import { lessonsForSkill } from '@/content/lessons';
import { itemsForSkill } from '@/content/items';
import { useModel } from '@/store/model';
import { useLearner } from '@/store/learner';
import { Icon, MasteryBar, PageHeader, StateChip } from '@/ui/kit';
import { href } from '@/ui/router';

export default function School({ schoolId }: { schoolId: string }) {
  const school = schoolById(schoolId);
  const { est } = useModel();
  const progress = useLearner((s) => s.lessonProgress);
  if (!school) return <p>Unknown school.</p>;
  const skills = SKILLS.filter((s) => s.schoolId === schoolId);
  return (
    <div>
      <a className="btn ghost sm" href={href('/academy')}><Icon name="back" /> Academy</a>
      <PageHeader eyebrow={`School ${school.num} · ${school.level}`} title={school.title}>{school.description}</PageHeader>
      {school.id === 's16' && <div className="callout amber" style={{ marginBottom: 16 }}>Frontier electives change quickly. Treat these as concepts and check primary documentation before relying on specific capabilities.</div>}
      <div className="stack">
        {skills.map((s, i) => {
          const lessons = lessonsForSkill(s.id).filter((l) => l.schoolId === schoolId || l.skillIds[0] === s.id);
          const e = est[s.id];
          return (
            <section key={s.id} className="card" aria-labelledby={`sk-${s.id}`}>
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 380px', minWidth: 0 }}>
                  <div className="tiny faint">Skill {i + 1} · difficulty {s.difficulty}/5{s.prereqs.length ? ` · needs ${s.prereqs.map((p) => getSkill(p).title).join(', ')}` : ''}</div>
                  <h3 id={`sk-${s.id}`} style={{ margin: '4px 0 6px' }}>{s.title}</h3>
                  <p className="small muted" style={{ margin: 0 }}>{s.summary}</p>
                </div>
                <div style={{ width: 220 }} className="stack sm">
                  <StateChip state={e.state} />
                  <MasteryBar e={e} />
                </div>
              </div>
              <div className="row" style={{ marginTop: 14 }}>
                {lessons.map((l) => (
                  <a key={l.id} className="btn primary sm" href={href(`/lesson/${l.id}`)}>
                    <Icon name="academy" /> {progress[l.id]?.completed ? 'Revisit' : progress[l.id] ? 'Resume' : 'Lesson'}: {l.title} · {l.minutes} min
                  </a>
                ))}
                {!lessons.length && <span className="chip" title="Full lesson not yet authored. The corrective note, worked example and practice are complete.">Full lesson planned</span>}
                <a className="btn sm" href={href(`/practice/${s.id}`)}><Icon name="lab" /> Practice ({itemsForSkill(s.id).length} items)</a>
                {e.state === 'remediation' && <a className="btn sm danger" href={href(`/recover/${s.id}`)}>Fix this weakness</a>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

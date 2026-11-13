import { SCHOOLS } from '@/content/schools';
import { SKILLS } from '@/content/skills';
import { LESSONS } from '@/content/lessons';
import { useModel } from '@/store/model';
import { PageHeader } from '@/ui/kit';
import { href } from '@/ui/router';

export default function Academy() {
  const { est } = useModel();
  return (
    <div>
      <PageHeader eyebrow="Academy" title="Sixteen schools, zero to architect">
        Every school maps to real skills. Fully authored lessons are marked; other skills still have a corrective note, a worked example and graded practice — nothing is a dead end.
      </PageHeader>
      <div className="grid auto">
        {SCHOOLS.map((s) => {
          const skills = SKILLS.filter((k) => k.schoolId === s.id);
          const lessons = LESSONS.filter((l) => l.schoolId === s.id);
          const practiced = skills.filter((k) => ['practiced', 'mastered', 'review-due'].includes(est[k.id].state)).length;
          const mastered = skills.filter((k) => ['mastered', 'review-due'].includes(est[k.id].state)).length;
          return (
            <a key={s.id} className="card hover" href={href(`/academy/${s.id}`)} style={{ borderTop: `3px solid hsl(${s.hue} 70% 58%)` }}>
              <div className="row between"><span className="eyebrow" style={{ margin: 0 }}>School {s.num}</span><span className="chip">{s.level}</span></div>
              <h3 style={{ margin: '8px 0 4px' }}>{s.title}</h3>
              <div className="small muted" style={{ minHeight: 44 }}>{s.tagline}</div>
              <div className="bar" style={{ marginTop: 12 }} role="img" aria-label={`${practiced} of ${skills.length} skills practiced`}><span style={{ width: `${(practiced / skills.length) * 100}%` }} /></div>
              <div className="row between tiny faint" style={{ marginTop: 6 }}>
                <span>{skills.length} skills · {lessons.length} authored lesson{lessons.length === 1 ? '' : 's'}</span>
                <span>{mastered} mastered</span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

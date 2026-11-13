import { useLearner } from '@/store/learner';
import { useModel } from '@/store/model';
import { PATHS } from '@/core/engines/planner';
import { RANKS } from '@/core/engines/progression';
import { getSkill } from '@/content/skills';
import { SCENARIOS } from '@/content/interviews';
import { PROJECTS } from '@/content/projects';
import { Icon, PageHeader, Ring, StateChip, fmtRel } from '@/ui/kit';
import { href } from '@/ui/router';

const KIND_ICON: Record<string, string> = { review: 'refresh', remediation: 'target', lesson: 'academy', practice: 'lab', project: 'projects', stretch: 'star' };

export default function Home() {
  const profile = useLearner((s) => s.profile);
  const activity = useLearner((s) => s.activity);
  const interviews = useLearner((s) => s.interviews);
  const projects = useLearner((s) => s.projects);
  const lessonProgress = useLearner((s) => s.lessonProgress);
  const evidence = useLearner((s) => s.evidence);
  const m = useModel();

  if (!profile) {
    return (
      <div className="card stack" style={{ maxWidth: 640 }}>
        <h1>Welcome to AgentForge</h1>
        <p className="muted">Set your starting point in under a minute — no account needed. Your progress stays in this browser.</p>
        <div className="row"><a className="btn primary lg" href={href('/onboarding')}>Get started</a><a className="btn" href={href('/academy')}>Browse the Academy first</a></div>
      </div>
    );
  }

  const today = m.plan.find((d) => d.blocks.length);
  const nextRank = m.rank.next;
  const pathProgress = m.path.length ? m.pathPracticed / m.path.length : 0;
  const inProgressLesson = Object.values(lessonProgress).filter((l) => !l.completed).sort((a, b) => b.startedAt - a.startedAt)[0];
  const ivRecent = interviews.slice(0, 5);
  const ivReady = ivRecent.length ? ivRecent.reduce((s, r) => s + r.score, 0) / ivRecent.length : null;
  const activeProjects = PROJECTS.filter((p) => projects[p.id] && !projects[p.id].completedAt);
  const week = Date.now() - 7 * 86_400_000;
  const weekEvidence = evidence.filter((e) => e.at >= week);

  return (
    <div className="stack lg">
      <PageHeader eyebrow={`${PATHS[profile.path].letter} · ${PATHS[profile.path].title}`} title="Command Center"
        actions={<><a className="btn" href={href('/planner')}><Icon name="planner" /> Plan</a><a className="btn" href={href('/universe')}><Icon name="universe" /> Universe</a></>}>
        Everything below is computed from your graded evidence — {evidence.length} attempts so far.
      </PageHeader>

      <div className="grid g-2-1">
        <section className="card" aria-labelledby="next-h" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, var(--surface)), var(--surface))' }}>
          <div className="eyebrow" id="next-h">Recommended next</div>
          {m.next[0] ? (
            <>
              <h2 style={{ marginBottom: 6 }}>{m.next[0].title}</h2>
              <p className="muted">{m.next[0].reason} · ~{m.next[0].minutes} min</p>
              <div className="row">
                <a className="btn primary lg" href={href(m.next[0].route)}><Icon name="play" /> Start</a>
                {inProgressLesson && <a className="btn" href={href(`/lesson/${inProgressLesson.lessonId}`)}>Resume lesson</a>}
              </div>
              <div className="stack sm" style={{ marginTop: 18 }}>
                {m.next.slice(1, 4).map((b, i) => (
                  <a key={i} href={href(b.route)} className="row nowrap" style={{ textDecoration: 'none', color: 'inherit', padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)' }}>
                    <Icon name={KIND_ICON[b.kind]} size={16} />
                    <span style={{ flex: 1 }}>{b.title}</span>
                    <span className="tiny faint">{b.reason}</span>
                  </a>
                ))}
              </div>
            </>
          ) : <p className="muted">Your path is complete — choose a new pathway or an advanced elective.</p>}
        </section>
        <section className="card stack" aria-label="Rank and path">
          <div className="row">
            <Ring value={pathProgress} label={`Path ${Math.round(pathProgress * 100)}% practiced`} />
            <div>
              <div className="eyebrow">Rank</div>
              <h3 style={{ margin: 0 }}>{m.rank.rank.name}</h3>
              <div className="tiny faint">{m.mastered} skills mastered · {m.projectsDone} projects</div>
            </div>
          </div>
          {nextRank && (
            <div className="small muted">
              Next: <b>{nextRank.name}</b> — needs {Math.max(0, nextRank.mastered - m.mastered)} more mastered skill{nextRank.mastered - m.mastered === 1 ? '' : 's'}
              {nextRank.projects > m.projectsDone ? ` and ${nextRank.projects - m.projectsDone} more project${nextRank.projects - m.projectsDone > 1 ? 's' : ''}` : ''}.
            </div>
          )}
          <div className="tiny faint">Rank ladder: {RANKS.map((r) => r.name).join(' → ')}</div>
          <div className="small">Path: {m.pathPracticed}/{m.path.length} skills practiced, {m.pathMastered} mastered.</div>
        </section>
      </div>

      <div className="grid g4">
        <a className="card hover" href={href('/review')}>
          <div className="kpi"><span className="v">{m.due.length}</span><span className="l">Reviews due</span></div>
          <div className="tiny faint">Spaced repetition keeps skills retained</div>
        </a>
        <a className="card hover" href={href('/observatory')}>
          <div className="kpi"><span className="v" style={{ color: m.weaknesses.length ? 'var(--danger)' : undefined }}>{m.weaknesses.length}</span><span className="l">Skills needing attention</span></div>
          <div className="tiny faint">From real errors, not guesses</div>
        </a>
        <a className="card hover" href={href('/interview')}>
          <div className="kpi"><span className="v">{ivReady === null ? '—' : `${Math.round(ivReady * 100)}%`}</span><span className="l">Interview readiness</span></div>
          <div className="tiny faint">{ivReady === null ? 'No interviews yet' : `Avg rubric coverage, last ${ivRecent.length}`} · {SCENARIOS.length} scenarios</div>
        </a>
        <a className="card hover" href={href('/projects')}>
          <div className="kpi"><span className="v">{m.projectsDone}/{PROJECTS.length}</span><span className="l">Portfolio projects</span></div>
          <div className="tiny faint">{activeProjects.length} in progress</div>
        </a>
      </div>

      <div className="grid g2">
        <section className="card">
          <div className="card-title">Today's session {today && <span className="chip">{today.minutes}/{profile.minutesPerSession} min</span>}<span className="spacer" /><a className="btn ghost sm" href={href('/planner')}>Full plan</a></div>
          {today ? today.blocks.map((b, i) => (
            <a key={i} href={href(b.route)} className="row nowrap" style={{ padding: '9px 0', borderBottom: '1px solid var(--border)', color: 'inherit', textDecoration: 'none' }}>
              <Icon name={KIND_ICON[b.kind]} size={16} /><span style={{ flex: 1 }}>{b.title}</span><span className="tiny faint">{b.minutes} min</span>
            </a>
          )) : <p className="muted small">No session planned today. Rest days are part of the plan.</p>}
          <div className="tiny faint" style={{ marginTop: 10 }}>This week: {weekEvidence.length} graded attempts · {weekEvidence.filter((e) => e.score >= 0.7).length} successful.</div>
        </section>
        <section className="card">
          <div className="card-title">Skills requiring attention<span className="spacer" /><a className="btn ghost sm" href={href('/observatory')}>Observatory</a></div>
          {m.weaknesses.length ? m.weaknesses.slice(0, 4).map((w) => (
            <div key={w.skillId} className="row nowrap" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <StateChip state={m.est[w.skillId].state} compact />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="small"><b>{getSkill(w.skillId).title}</b></div>
                <div className="tiny faint" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.reasons[0]}</div>
              </div>
              <a className="btn sm" href={href(`/recover/${w.skillId}`)}>Fix this</a>
            </div>
          )) : <p className="muted small">No weaknesses detected yet. That's either great news or not enough evidence — keep practising.</p>}
        </section>
      </div>

      <section className="card">
        <div className="card-title">Recent activity</div>
        {activity.length ? (
          <div className="table-wrap"><table className="t"><tbody>
            {activity.slice(0, 8).map((a) => <tr key={a.id}><td style={{ width: 110 }} className="tiny faint">{fmtRel(a.at)}</td><td><span className="chip">{a.kind}</span></td><td>{a.title}</td><td className="tiny faint" style={{ textAlign: 'right' }}>{a.xp ? `+${a.xp} XP` : ''}</td></tr>)}
          </tbody></table></div>
        ) : <p className="muted small">Nothing yet. Start the recommended activity above.</p>}
      </section>
    </div>
  );
}

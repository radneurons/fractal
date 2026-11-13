import { useState } from 'react';
import { useLearner } from '@/store/learner';
import { useModel } from '@/store/model';
import { PATHS } from '@/core/engines/planner';
import type { GoalPath } from '@/core/types';
import { getSkill } from '@/content/skills';
import { schoolById } from '@/content/schools';
import { Icon, PageHeader, Seg, StateChip, useToast } from '@/ui/kit';
import { href } from '@/ui/router';

const KIND_ICON: Record<string, string> = { review: 'refresh', remediation: 'target', lesson: 'academy', practice: 'lab', project: 'projects', stretch: 'star' };

export default function Planner() {
  const profile = useLearner((s) => s.profile);
  const setProfile = useLearner((s) => s.setProfile);
  const pinned = useLearner((s) => s.pinned);
  const skipped = useLearner((s) => s.skipped);
  const togglePin = useLearner((s) => s.togglePin);
  const toggleSkip = useLearner((s) => s.toggleSkip);
  const { plan, path, est } = useModel();
  const { toast } = useToast();
  const [stamp, setStamp] = useState(Date.now());
  if (!profile) return <div className="empty">Set up your profile first. <a href={href('/onboarding')}>Start</a></div>;

  return (
    <div className="stack lg">
      <PageHeader eyebrow="Learning Planner" title="Your adaptive roadmap"
        actions={<button className="btn primary" onClick={() => { setStamp(Date.now()); toast('Plan rebuilt from your latest evidence'); }}><Icon name="refresh" /> Rebuild my plan</button>}>
        Built from your goal, time budget, due reviews, weaknesses and prerequisites. Missed days simply roll forward — nothing is lost. Pin skills to prioritise them, or skip ones you don't want yet.
      </PageHeader>
      <section className="card stack">
        <div className="grid g3">
          <label className="field">Goal path<select className="select" value={profile.path} onChange={(e) => setProfile({ path: e.target.value as GoalPath })}>{(Object.keys(PATHS) as GoalPath[]).map((p) => <option key={p} value={p}>{PATHS[p].letter} · {PATHS[p].title}</option>)}</select></label>
          <div className="field">Minutes per session<Seg label="Minutes per session" value={profile.minutesPerSession} onChange={(m) => setProfile({ minutesPerSession: m })} options={[{ id: 20, label: '20' }, { id: 40, label: '40' }, { id: 60, label: '60' }]} /></div>
          <label className="field">Sessions per week: {profile.sessionsPerWeek}<input type="range" min={1} max={7} value={profile.sessionsPerWeek} onChange={(e) => setProfile({ sessionsPerWeek: +e.target.value })} /></label>
        </div>
        <div className="tiny faint">{PATHS[profile.path].blurb} Switching paths keeps every skill you've demonstrated — shared skills count everywhere.</div>
      </section>

      <section>
        <h3>Next 7 days</h3>
        <div className="grid auto-sm" key={stamp}>
          {plan.map((d) => (
            <div key={d.date} className="card stack sm" style={!d.blocks.length ? { opacity: 0.6 } : undefined}>
              <div className="row between"><b>{new Date(d.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</b><span className="tiny faint">{d.minutes} min</span></div>
              {d.blocks.length ? d.blocks.map((b, i) => (
                <a key={i} href={href(b.route)} className="row nowrap small" style={{ color: 'inherit', textDecoration: 'none', alignItems: 'flex-start' }} title={b.reason}>
                  <Icon name={KIND_ICON[b.kind]} size={14} /><span style={{ flex: 1 }}>{b.title}<span className="tiny faint" style={{ display: 'block' }}>{b.kind} · {b.minutes}m</span></span>
                </a>
              )) : <span className="tiny faint">Rest day</span>}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-title">Roadmap · {PATHS[profile.path].title} · {path.length} skills in learnable order</div>
        <ol className="stack sm" style={{ paddingLeft: '1.4em', margin: 0 }}>
          {path.map((id) => {
            const s = getSkill(id);
            return (
              <li key={id} style={{ opacity: skipped.includes(id) ? 0.5 : 1 }}>
                <div className="row nowrap" style={{ alignItems: 'center' }}>
                  <StateChip state={est[id].state} compact />
                  <a href={href(`/practice/${id}`)} style={{ flex: 1 }}>{s.title}</a>
                  <span className="tiny faint desktop-only">{schoolById(s.schoolId).title}</span>
                  <button className="btn ghost sm" aria-pressed={pinned.includes(id)} onClick={() => togglePin(id)}>{pinned.includes(id) ? 'Unpin' : 'Pin'}</button>
                  <button className="btn ghost sm" aria-pressed={skipped.includes(id)} onClick={() => toggleSkip(id)}>{skipped.includes(id) ? 'Unskip' : 'Skip'}</button>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

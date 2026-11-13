import { useEffect, useMemo, useRef, useState } from 'react';
import { createUniverse, webglAvailable, STATE_COLOR } from './universe/scene';
import { SKILLS, getSkill } from '@/content/skills';
import { SCHOOLS, schoolById } from '@/content/schools';
import { lessonsForSkill } from '@/content/lessons';
import { itemsForSkill } from '@/content/items';
import { useLearner } from '@/store/learner';
import { useModel } from '@/store/model';
import { STATE_LABEL, STATE_ICON } from '@/core/engines/competency';
import type { SkillState } from '@/core/types';
import { Icon, MasteryBar, Seg, StateChip } from '@/ui/kit';
import { href } from '@/ui/router';

export default function Universe() {
  const { est, path } = useModel();
  const settings = useLearner((s) => s.settings);
  const setSettings = useLearner((s) => s.setSettings);
  const togglePin = useLearner((s) => s.togglePin);
  const pinned = useLearner((s) => s.pinned);
  const [gl] = useState(() => webglAvailable());
  const view = gl ? settings.universeView : '2d';
  const [selected, setSelected] = useState<string | null>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [filter, setFilter] = useState<'all' | 'path' | 'weak'>('all');
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const api = useRef<ReturnType<typeof createUniverse> | null>(null);

  // Not-yet-reachable skills take a muted tint of their school's hue so clusters stay distinguishable.
  const colors = useMemo(() => Object.fromEntries(SKILLS.map((s) => [s.id, est[s.id].state === 'locked-soft' ? `hsl(${schoolById(s.schoolId).hue} 28% 40%)` : STATE_COLOR[est[s.id].state]])), [est]);

  useEffect(() => {
    if (view !== '3d' || !host.current) return;
    const u = createUniverse(host.current, {
      nodes: SKILLS.map((s) => ({ id: s.id, label: s.title, group: s.schoolId, groupLabel: `${schoolById(s.schoolId).num}. ${schoolById(s.schoolId).title}`, hue: schoolById(s.schoolId).hue, color: colors[s.id], size: 0.6 + s.difficulty * 0.13 })),
      edges: SKILLS.flatMap((s) => s.prereqs.map((p) => ({ from: p, to: s.id }))),
      highlight: path,
      reducedMotion: settings.reducedMotion || settings.focusMode,
      autoRotate: false,
      labels: labels.current,
      onHover: (id, x, y) => setTip(id ? { id, x, y } : null),
      onSelect: (id) => setSelected(id),
    });
    api.current = u;
    return () => {
      u.dispose();
      api.current = null;
    };
  }, [view, settings.reducedMotion, settings.focusMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.current?.setColors(colors);
  }, [colors]);
  useEffect(() => {
    api.current?.focus(selected);
  }, [selected]);

  const shown = SKILLS.filter((s) => filter === 'all' || (filter === 'path' ? path.includes(s.id) : ['remediation', 'review-due'].includes(est[s.id].state)));

  return (
    <div className="universe" style={view === '2d' ? { height: 'auto', minHeight: 0, background: 'none', overflow: 'visible' } : undefined}>
      {view === '3d' && (
        <>
          <div ref={host} style={{ position: 'absolute', inset: 0 }} />
          <div ref={labels} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }} aria-hidden="true" />
          {tip && <div className="uni-tip" style={{ left: tip.x, top: tip.y }}>{getSkill(tip.id).title} · {STATE_LABEL[est[tip.id].state]}</div>}
        </>
      )}
      <div className={view === '3d' ? 'uni-overlay' : ''} style={view === '2d' ? { padding: '24px 28px' } : undefined}>
        <div className={view === '3d' ? 'uni-tools glass' : 'row between'} style={view === '3d' ? { padding: 12, maxWidth: 360 } : { marginBottom: 16 }}>
          <div>
            <div className="eyebrow">Knowledge Universe</div>
            <div className="small muted" style={{ marginBottom: 8 }}>{SKILLS.length} skills across {SCHOOLS.length} schools. Lines are real prerequisites; your path glows teal.</div>
          </div>
          <div className="row">
            {gl ? (
              <Seg label="View" value={view} onChange={(v) => setSettings({ universeView: v })} options={[{ id: '3d', label: '3D' }, { id: '2d', label: 'List / 2D' }]} />
            ) : <span className="chip">WebGL unavailable — showing accessible view</span>}
            {view === '3d' && <button className="btn sm" onClick={() => setSelected(null)}><Icon name="refresh" /> Reset view</button>}
          </div>
        </div>

        {view === '3d' && (
          <div className="uni-legend glass" aria-label="Legend">
            {(Object.keys(STATE_COLOR) as SkillState[]).map((s) => (
              <div key={s} className="row tiny" style={{ gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: s === 'locked-soft' ? 'linear-gradient(135deg, hsl(168 28% 40%), hsl(325 28% 40%))' : STATE_COLOR[s] }} />{STATE_ICON[s]} {STATE_LABEL[s]}</div>
            ))}
            <div className="tiny faint" style={{ marginTop: 6 }}>Drag to orbit · scroll to zoom · click a star</div>
          </div>
        )}

        {view === '2d' && (
          <div className="stack">
            <Seg label="Filter" value={filter} onChange={setFilter} options={[{ id: 'all', label: 'All skills' }, { id: 'path', label: 'My path' }, { id: 'weak', label: 'Needs attention' }]} />
            {SCHOOLS.map((sc) => {
              const list = shown.filter((s) => s.schoolId === sc.id);
              if (!list.length) return null;
              return (
                <section key={sc.id} className="card" aria-labelledby={`sc-${sc.id}`}>
                  <div className="card-title" id={`sc-${sc.id}`}><span style={{ width: 10, height: 10, borderRadius: 3, background: `hsl(${sc.hue} 70% 60%)` }} />{sc.num}. {sc.title}<span className="spacer" /><span className="chip">{sc.level}</span></div>
                  <div className="grid auto">
                    {list.map((s) => (
                      <button key={s.id} className="opt" onClick={() => setSelected(s.id)} aria-pressed={selected === s.id} style={{ flexDirection: 'column', gap: 6 }}>
                        <span className="row between" style={{ width: '100%' }}><b>{s.title}</b><StateChip state={est[s.id].state} compact /></span>
                        <span className="tiny faint">{s.prereqs.length ? `Needs: ${s.prereqs.map((p) => getSkill(p).title).join(', ')}` : 'No prerequisites'}</span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {selected && (
          <SkillPanel id={selected} onClose={() => setSelected(null)} onSelect={setSelected} pinned={pinned.includes(selected)} onPin={() => togglePin(selected)} floating={view === '3d'} />
        )}
      </div>
    </div>
  );
}

function SkillPanel({ id, onClose, onSelect, pinned, onPin, floating }: { id: string; onClose: () => void; onSelect: (id: string) => void; pinned: boolean; onPin: () => void; floating: boolean }) {
  const { est } = useModel();
  const s = getSkill(id);
  const e = est[id];
  const lessons = lessonsForSkill(id);
  const items = itemsForSkill(id);
  const unlocks = SKILLS.filter((x) => x.prereqs.includes(id));
  const body = (
    <div className="stack" style={{ padding: floating ? 18 : 0 }}>
      <div className="row between nowrap">
        <div>
          <div className="eyebrow">{schoolById(s.schoolId).num}. {schoolById(s.schoolId).title} · difficulty {s.difficulty}/5</div>
          <h3 style={{ margin: 0 }}>{s.title}</h3>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close skill details"><Icon name="close" /></button>
      </div>
      <StateChip state={e.state} />
      <p className="small muted" style={{ margin: 0 }}>{s.summary}</p>
      <MasteryBar e={e} />
      <div className="row">
        {lessons[0] ? <a className="btn primary sm" href={href(`/lesson/${lessons[0].id}`)}><Icon name="academy" /> Open lesson</a> : <span className="chip">Lesson planned · practice available</span>}
        <a className="btn sm" href={href(`/practice/${id}`)}><Icon name="lab" /> Practice ({items.length})</a>
        {e.state === 'remediation' && <a className="btn sm danger" href={href(`/recover/${id}`)}>Fix this weakness</a>}
        <button className="btn ghost sm" onClick={onPin} aria-pressed={pinned}><Icon name="pin" /> {pinned ? 'Pinned to plan' : 'Pin to plan'}</button>
      </div>
      <div>
        <div className="tiny faint" style={{ marginBottom: 4 }}>Prerequisites</div>
        <div className="row">{s.prereqs.length ? s.prereqs.map((p) => <button key={p} className="chip" onClick={() => onSelect(p)} style={{ cursor: 'pointer' }}>{getSkill(p).title} · {STATE_ICON[est[p].state]}</button>) : <span className="tiny faint">None — a starting point.</span>}</div>
      </div>
      <div>
        <div className="tiny faint" style={{ marginBottom: 4 }}>Unlocks</div>
        <div className="row">{unlocks.length ? unlocks.map((u) => <button key={u.id} className="chip" onClick={() => onSelect(u.id)} style={{ cursor: 'pointer' }}>{u.title}</button>) : <span className="tiny faint">Frontier skill.</span>}</div>
      </div>
      <div className="tiny faint">{e.attempts} graded attempts · {e.passedItems} distinct items passed{e.nextReview ? ` · next review ${new Date(e.nextReview).toLocaleDateString()}` : ''}</div>
    </div>
  );
  return floating ? <aside className="uni-panel glass fade-in" aria-label="Skill details">{body}</aside> : <aside className="card fade-in" style={{ position: 'sticky', bottom: 16, marginTop: 16 }} aria-label="Skill details">{body}</aside>;
}

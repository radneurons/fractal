import { useMemo, useState } from 'react';
import { SCHOOLS } from '@/content/schools';
import { SKILLS, getSkill } from '@/content/skills';
import { useLearner } from '@/store/learner';
import { useModel } from '@/store/model';
import { evidenceWeight, HALF_LIFE_DAYS, SOURCE_WEIGHT, STATE_LABEL } from '@/core/engines/competency';
import { isRetained } from '@/core/engines/review';
import { ERROR_TAG_LABEL, type ErrorTag, type SkillState } from '@/core/types';
import { Icon, MasteryBar, Modal, PageHeader, Seg, StateChip, fmtRel } from '@/ui/kit';
import { href } from '@/ui/router';

export default function Observatory() {
  const { est, weaknesses, badges, mastered } = useModel();
  const evidence = useLearner((s) => s.evidence);
  const reviews = useLearner((s) => s.reviews);
  const [why, setWhy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'assessed' | 'all' | 'weak'>('assessed');
  const assessed = SKILLS.filter((s) => est[s.id].attempts > 0);
  const practiced = SKILLS.filter((s) => ['practiced', 'mastered', 'review-due'].includes(est[s.id].state)).length;
  const retained = SKILLS.filter((s) => isRetained(reviews[s.id])).length;
  const rows = SKILLS.filter((s) => (filter === 'all' ? true : filter === 'weak' ? ['remediation', 'review-due'].includes(est[s.id].state) : est[s.id].attempts > 0));

  return (
    <div className="stack lg">
      <PageHeader eyebrow="Mastery Observatory" title="What you can demonstrably do">
        Every number here is computed from graded evidence using the documented model below. Where evidence is thin, you'll see "Not enough evidence" rather than a made-up score.
      </PageHeader>
      <div className="grid g4">
        <div className="card kpi"><span className="v">{evidence.length}</span><span className="l">graded attempts</span></div>
        <div className="card kpi"><span className="v">{assessed.length}<span className="faint" style={{ fontSize: '1rem' }}>/{SKILLS.length}</span></span><span className="l">skills assessed</span></div>
        <div className="card kpi"><span className="v">{practiced} · {mastered}</span><span className="l">practiced · mastered</span></div>
        <div className="card kpi" title="Mastered and passed a review ≥ 7 days after first mastery"><span className="v">{retained}</span><span className="l">retained over time</span></div>
      </div>

      <div className="grid g2">
        <section className="card"><div className="card-title">Mastery by school</div><Radar est={est} /></section>
        <section className="card"><div className="card-title">Learning timeline · last 30 days</div><Timeline /><div className="card-title" style={{ marginTop: 18 }}>Error patterns</div><Heatmap /></section>
      </div>

      <section className="card">
        <div className="card-title">Skills needing attention<span className="spacer" /><span className="tiny faint">Causes are hypotheses, shown with the evidence behind them</span></div>
        {weaknesses.length ? (
          <div className="grid auto">
            {weaknesses.map((w) => (
              <div key={w.skillId} className="card inset stack sm">
                <div className="row between"><b>{getSkill(w.skillId).title}</b><StateChip state={est[w.skillId].state} compact /></div>
                {w.reasons.map((r) => <div key={r} className="tiny">{r}</div>)}
                {w.hypotheses.slice(0, 2).map((h) => <div key={h.text} className="tiny muted">• {h.text}</div>)}
                <a className="btn sm danger" href={href(`/recover/${w.skillId}`)}>Fix this weakness</a>
              </div>
            ))}
          </div>
        ) : <p className="small muted">No weaknesses detected from current evidence.</p>}
      </section>

      <section className="card">
        <div className="card-title">Competency matrix<span className="spacer" /><Seg label="Filter" value={filter} onChange={setFilter} options={[{ id: 'assessed', label: 'Assessed' }, { id: 'weak', label: 'Needs attention' }, { id: 'all', label: 'All' }]} /></div>
        {rows.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Skill</th><th>State</th><th style={{ minWidth: 180 }}>Estimate</th><th>Evidence</th><th>Trend</th><th>Next review</th><th /></tr></thead>
            <tbody>{rows.map((s) => {
              const e = est[s.id];
              return (
                <tr key={s.id}>
                  <td><a href={href(`/practice/${s.id}`)}>{s.title}</a><div className="tiny faint">{SCHOOLS.find((x) => x.id === s.schoolId)?.title}</div></td>
                  <td><StateChip state={e.state} compact /></td>
                  <td><MasteryBar e={e} /></td>
                  <td className="small">{e.attempts} attempts · {e.passedItems} items<br /><span className="tiny faint">weight {e.nEff.toFixed(2)}</span></td>
                  <td className="small" style={{ color: e.trend > 0.05 ? 'var(--success)' : e.trend < -0.05 ? 'var(--danger)' : undefined }}>{e.attempts >= 4 ? (e.trend > 0.05 ? '↑ improving' : e.trend < -0.05 ? '↓ slipping' : '→ steady') : '—'}</td>
                  <td className="small">{e.nextReview ? fmtRel(e.nextReview) : '—'}</td>
                  <td><button className="btn ghost sm" onClick={() => setWhy(s.id)}>Why this score?</button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <div className="empty">No evidence yet. Complete a lesson or practice to populate the matrix.</div>}
      </section>

      <section className="card">
        <div className="card-title">Badges · each links to its evidence</div>
        <div className="grid auto-sm">
          {badges.map(({ badge, done, earned }) => (
            <div key={badge.id} className={`badge-tile ${earned ? 'earned' : ''}`}>
              <div className="row between"><b>{badge.name}</b>{earned && <Icon name="star" />}</div>
              <div className="tiny faint">{badge.description}</div>
              <div className="tiny">{done.length}/{badge.need} required skills mastered</div>
              <div className="row" style={{ gap: 4 }}>{badge.skills.map((s) => <a key={s} className={`chip ${done.includes(s) ? 'amber' : ''}`} href={href(`/practice/${s}`)}>{getSkill(s).title}</a>)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card prose" style={{ maxWidth: 'none' }}>
        <h3 style={{ marginTop: 0 }}>How every metric is calculated</h3>
        <ul className="small">
          <li><b>Evidence weight</b> = source weight × difficulty factor (0.6 + 0.2·d) × hint factor (max(0.25, 1 − 0.25·hints)) × recency (½ every {HALF_LIFE_DAYS} days). Revealed solutions weigh 0. Source weights: {Object.entries(SOURCE_WEIGHT).map(([k, v]) => `${k} ${v}`).join(', ')}.</li>
          <li><b>Estimate</b> = (1 + Σ weight·score) ÷ (2 + Σ weight) — a Beta posterior with a weak prior, so a single answer can't produce 100%. The bar shows a 90% interval.</li>
          <li><b>Confidence</b> = 1 − 1/√(1 + Σ weight). Below 0.35 is "insufficient"; under 0.6 total weight we show "Not enough evidence".</li>
          <li><b>Mastered</b> requires estimate ≥ 80%, confidence ≥ 0.5, ≥ 2 distinct items passed and at least one non-diagnostic success. <b>Needs remediation</b>: weight ≥ 1.2 and estimate &lt; 50%.</li>
          <li><b>Retained</b> = mastered and passed a review at least 7 days after first mastery. <b>Rank</b> uses mastered skills and completed projects only. Time spent never counts.</li>
          <li><b>Interview readiness</b> = average rubric coverage of your last 5 interviews. <b>Trend</b> = mean of last 3 scores minus the 3 before (needs ≥ 4 attempts).</li>
        </ul>
      </section>

      <Modal open={!!why} onClose={() => setWhy(null)} title={why ? `Why this score? · ${getSkill(why).title}` : ''} wide>
        {why && <WhyScore skillId={why} />}
      </Modal>
    </div>
  );
}

function WhyScore({ skillId }: { skillId: string }) {
  const { est } = useModel();
  const evidence = useLearner((s) => s.evidence).filter((e) => e.skillId === skillId);
  const e = est[skillId];
  const now = Date.now();
  const sw = evidence.reduce((s, x) => s + evidenceWeight(x, now), 0);
  const sws = evidence.reduce((s, x) => s + evidenceWeight(x, now) * x.score, 0);
  return (
    <div className="stack">
      <div className="row"><StateChip state={e.state} /><span className="chip">{STATE_LABEL[e.state as SkillState]}</span></div>
      <MasteryBar e={e} />
      <div className="callout small mono">estimate = (1 + {sws.toFixed(3)}) ÷ (2 + {sw.toFixed(3)}) = {e.mastery.toFixed(3)} · confidence = 1 − 1/√(1 + {sw.toFixed(3)}) = {e.confidence.toFixed(3)}</div>
      <div className="table-wrap"><table className="t">
        <thead><tr><th>When</th><th>Source</th><th>Item</th><th>Score</th><th>Difficulty</th><th>Hints</th><th>Graded by</th><th>Weight now</th></tr></thead>
        <tbody>{[...evidence].reverse().map((x) => (
          <tr key={x.id}><td className="tiny">{fmtRel(x.at)}</td><td>{x.source}</td><td className="tiny mono">{x.itemId ?? '—'}</td><td>{Math.round(x.score * 100)}%</td><td>{x.difficulty}</td><td>{x.solutionRevealed ? 'revealed' : x.hintsUsed}</td><td>{x.gradedBy}</td><td className="mono">{evidenceWeight(x, now).toFixed(3)}</td></tr>
        ))}</tbody>
      </table></div>
      {!evidence.length && <div className="empty">No evidence yet for this skill.</div>}
    </div>
  );
}

function Radar({ est }: { est: ReturnType<typeof useModel>['est'] }) {
  const data = SCHOOLS.map((s) => {
    const sk = SKILLS.filter((k) => k.schoolId === s.id && est[k.id].sufficient);
    return { s, v: sk.length ? sk.reduce((a, k) => a + est[k.id].mastery, 0) / sk.length : 0, n: sk.length };
  });
  const R = 120, C = 150;
  const pt = (i: number, r: number) => { const a = (i / data.length) * Math.PI * 2 - Math.PI / 2; return [C + Math.cos(a) * r, C + Math.sin(a) * r]; };
  const poly = data.map((d, i) => pt(i, R * d.v).join(',')).join(' ');
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <svg viewBox="0 0 300 300" style={{ width: 'min(100%, 320px)' }} role="img" aria-label="Radar chart of average mastery per school, for schools with enough evidence">
        {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={data.map((_, i) => pt(i, R * f).join(',')).join(' ')} fill="none" stroke="var(--border)" />)}
        {data.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={C} y1={C} x2={x} y2={y} stroke="var(--border)" />; })}
        <polygon points={poly} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={2} />
        {data.map((d, i) => { const [x, y] = pt(i, R + 14); return <text key={i} x={x} y={y} fontSize={9} textAnchor="middle" dominantBaseline="middle" fill={d.n ? 'var(--text-2)' : 'var(--text-3)'}>{d.s.num}</text>; })}
      </svg>
      <div className="stack sm small" style={{ flex: 1, minWidth: 180 }}>
        {data.map((d) => <div key={d.s.id} className="row between"><span>{d.s.num}. {d.s.title}</span><span className="mono tiny">{d.n ? `${Math.round(d.v * 100)}% (${d.n})` : 'no evidence'}</span></div>)}
      </div>
    </div>
  );
}

function Timeline() {
  const evidence = useLearner((s) => s.evidence);
  const days = useMemo(() => Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    const ev = evidence.filter((e) => new Date(e.at).toISOString().slice(0, 10) === d);
    return { d, n: ev.length, ok: ev.filter((e) => e.score >= 0.7).length };
  }), [evidence]);
  const max = Math.max(1, ...days.map((d) => d.n));
  return (
    <div>
      <div className="timeline" role="img" aria-label="Graded attempts per day over the last 30 days">
        {days.map((d) => <div key={d.d} title={`${d.d}: ${d.n} attempts, ${d.ok} successful`} style={{ height: `${(d.n / max) * 100}%`, background: d.n ? `color-mix(in srgb, var(--accent) ${40 + (d.ok / Math.max(1, d.n)) * 60}%, var(--danger))` : 'var(--surface-3)' }} />)}
      </div>
      <div className="row between tiny faint"><span>30 days ago</span><span>today</span></div>
    </div>
  );
}

function Heatmap() {
  const evidence = useLearner((s) => s.evidence);
  const tags = Object.keys(ERROR_TAG_LABEL) as ErrorTag[];
  const grid = SCHOOLS.map((sc) => tags.map((t) => evidence.filter((e) => e.errorTags.includes(t) && SKILLS.find((k) => k.id === e.skillId)?.schoolId === sc.id).length));
  const max = Math.max(1, ...grid.flat());
  const active = SCHOOLS.map((s, i) => ({ s, row: grid[i] })).filter((r) => r.row.some(Boolean));
  if (!active.length) return <p className="small muted">No errors recorded yet.</p>;
  return (
    <div className="table-wrap">
      <table className="t" style={{ fontSize: '.72rem' }}>
        <thead><tr><th /> {tags.map((t) => <th key={t} title={ERROR_TAG_LABEL[t]} style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: 110, padding: 2 }}>{ERROR_TAG_LABEL[t]}</th>)}</tr></thead>
        <tbody>{active.map(({ s, row }) => <tr key={s.id}><td style={{ whiteSpace: 'nowrap' }}>{s.num}. {s.title}</td>{row.map((n, j) => <td key={j} style={{ padding: 2 }}><div className="heat"><div className="cell" style={{ background: n ? `color-mix(in srgb, var(--danger) ${15 + (n / max) * 70}%, transparent)` : 'var(--surface-2)' }} title={`${n} × ${ERROR_TAG_LABEL[tags[j]]}`}>{n || ''}</div></div></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

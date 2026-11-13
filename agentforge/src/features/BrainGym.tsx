import { useState } from 'react';
import { BRAIN_GYM, type Puzzle } from '@/content/games';
import { getSkill } from '@/content/skills';
import { useLearner } from '@/store/learner';
import { seededShuffle } from '@/core/engines/assessment';
import { Markdown, PageHeader } from '@/ui/kit';

export default function BrainGym() {
  const levels = ['beginner', 'intermediate', 'advanced', 'expert'] as const;
  return (
    <div>
      <PageHeader eyebrow="Brain Gym" title="Reasoning challenges">
        Domain puzzles: logic, sequences, trace investigation and trade-offs — all about AI systems. A correct answer counts only toward the specific skill it tests, and you must explain your reasoning.
      </PageHeader>
      <div className="stack lg">
        {levels.map((lv) => (
          <section key={lv}>
            <h3 style={{ textTransform: 'capitalize' }}>{lv}</h3>
            <div className="grid g2">{BRAIN_GYM.filter((p) => p.level === lv).map((p) => <PuzzleCard key={p.id} p={p} />)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}

function PuzzleCard({ p }: { p: Puzzle }) {
  const record = useLearner((s) => s.recordEvidence);
  const [opts] = useState(() => seededShuffle(p.options, p.id));
  const [sel, setSel] = useState<number | null>(null);
  const [why, setWhy] = useState('');
  const [done, setDone] = useState(false);
  const submit = () => {
    const ok = sel !== null && opts[sel].correct;
    record({ skillId: p.skillId, source: 'game', score: ok ? 1 : 0, difficulty: (['beginner', 'intermediate', 'advanced', 'expert'].indexOf(p.level) + 2) as 2 | 3 | 4 | 5, hintsUsed: 0, solutionRevealed: false, errorTags: ok ? [] : ['conceptual'], gradedBy: 'deterministic', itemId: `brain:${p.id}`, note: why.slice(0, 300) }, `Brain Gym: ${p.kind}`);
    setDone(true);
  };
  return (
    <div className="card stack sm">
      <div className="row between"><span className="chip">{p.kind}</span><span className="tiny faint">→ {getSkill(p.skillId).title}</span></div>
      <Markdown text={p.prompt} />
      {opts.map((o, i) => <button key={i} className={`opt ${done ? (o.correct ? 'right' : sel === i ? 'wrong' : '') : ''}`} aria-pressed={sel === i} disabled={done} onClick={() => setSel(i)}>{o.text}{done && (o.correct || sel === i) && <span className="tiny" style={{ display: 'block', marginTop: 4 }}>{o.why}</span>}</button>)}
      {!done && (
        <>
          <textarea className="textarea" style={{ minHeight: 70 }} placeholder="Explain your reasoning (required)…" value={why} onChange={(e) => setWhy(e.target.value)} aria-label="Your reasoning" />
          <button className="btn primary" disabled={sel === null || why.trim().length < 15} onClick={submit}>Submit</button>
        </>
      )}
    </div>
  );
}

import { useState, type ReactNode } from 'react';
import { useLearner } from '@/store/learner';
import { GAMES } from '@/content/games';
import type { Difficulty } from '@/core/types';
import { sfx } from '@/ui/sound';
import { Icon, useToast } from '@/ui/kit';

/** Records a finished level: game stats + evidence for each mapped skill (source "game", lower weight than exercises). */
export function useGameFinish(gameId: string) {
  const recordGame = useLearner((s) => s.recordGame);
  const record = useLearner((s) => s.recordEvidence);
  const sound = useLearner((s) => s.settings.sound);
  const { toast } = useToast();
  const meta = GAMES.find((g) => g.id === gameId)!;
  return (levelId: string, levelIndex: number, score: number, hintsUsed = 0) => {
    const s = Math.max(0, Math.min(100, Math.round(score)));
    recordGame(gameId, levelId, s);
    const difficulty = Math.min(5, 2 + levelIndex) as Difficulty;
    for (const skillId of meta.skills) record({ skillId, source: 'game', score: s / 100, difficulty, hintsUsed, solutionRevealed: false, errorTags: s < 70 ? ['conceptual'] : [], gradedBy: 'deterministic', itemId: `game:${gameId}:${levelId}` }, `${meta.title} · level ${levelIndex + 1}`);
    if (sound) sfx(s >= 70 ? 'level' : 'bad');
    toast(`${meta.title}: ${s} points${s >= 70 ? ' — level cleared' : ''}`);
    return s;
  };
}

export function LevelBar<T extends { id: string; title: string }>({ levels, index, setIndex, gameId }: { levels: T[]; index: number; setIndex: (i: number) => void; gameId: string }) {
  const g = useLearner((s) => s.games[gameId]);
  return (
    <div className="row" role="tablist" aria-label="Levels">
      {levels.map((l, i) => (
        <button key={l.id} role="tab" aria-selected={i === index} className={`btn sm ${i === index ? 'primary' : ''}`} onClick={() => setIndex(i)}>
          {i + 1}{g?.levels[l.id] !== undefined && <span className="tiny" style={{ opacity: 0.8 }}> · {g.levels[l.id]}</span>}
        </button>
      ))}
    </div>
  );
}

export function ScoreCard({ score, children, onReplay, onNext }: { score: number; children?: ReactNode; onReplay: () => void; onNext?: () => void }) {
  return (
    <div className={`result ${score >= 70 ? 'ok' : score >= 40 ? 'partial' : 'no'} fade-in`} tabIndex={-1}>
      <div className="row between"><h4 style={{ margin: 0 }}>{score} / 100 {score >= 70 ? '— cleared' : '— try again'}</h4></div>
      {children}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={onReplay}><Icon name="refresh" /> Replay</button>
        {onNext && <button className="btn primary" onClick={onNext}>Next level <Icon name="arrow" /></button>}
      </div>
    </div>
  );
}

export function useLevel(n: number) {
  const [i, setI] = useState(0);
  const [nonce, setNonce] = useState(0);
  return { i, setI: (x: number) => { setI(x); setNonce((k) => k + 1); }, nonce, replay: () => setNonce((k) => k + 1), next: i < n - 1 ? () => { setI(i + 1); setNonce((k) => k + 1); } : undefined };
}

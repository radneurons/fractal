import type { ComponentType } from 'react';
import { GAMES } from '@/content/games';
import { getSkill } from '@/content/skills';
import { useLearner } from '@/store/learner';
import { AgentRescue, ContextTetris, HallucinationHunter, PromptArchitect, ToolDetective } from './games/setA';
import { ArchitectureForge, DebugAgent, IncidentRoom, InjectionDefense, TokenCommander } from './games/setB';
import { Icon, PageHeader } from '@/ui/kit';
import { href } from '@/ui/router';

const COMPONENTS: Record<string, ComponentType> = {
  'prompt-architect': PromptArchitect, 'agent-rescue': AgentRescue, 'hallucination-hunter': HallucinationHunter, 'context-tetris': ContextTetris, 'tool-detective': ToolDetective,
  'debug-agent': DebugAgent, 'injection-defense': InjectionDefense, 'architecture-forge': ArchitectureForge, 'token-commander': TokenCommander, 'incident-room': IncidentRoom,
};

export default function Arena({ gameId }: { gameId?: string }) {
  const games = useLearner((s) => s.games);
  const game = GAMES.find((g) => g.id === gameId);
  if (game) {
    const C = COMPONENTS[game.id];
    return (
      <div className="stack">
        <a className="btn ghost sm" href={href('/arena')} style={{ justifySelf: 'start', alignSelf: 'flex-start' }}><Icon name="back" /> Arena</a>
        <PageHeader eyebrow="Challenge Arena" title={game.title}>{game.mechanic}</PageHeader>
        <div className="row tiny faint"><span><b>Scoring:</b> {game.scoring}</span><span>· Evidence → {game.skills.map((s) => getSkill(s).title).join(', ')}</span></div>
        <C />
      </div>
    );
  }
  return (
    <div>
      <PageHeader eyebrow="Challenge Arena" title="Learning as an intelligent game">
        Ten games with real mechanics and deterministic scoring. Results count as evidence for the mapped skills — at a lower weight than exercises, so games inform mastery without inflating it.
      </PageHeader>
      <div className="grid auto">
        {GAMES.map((g, i) => (
          <a key={g.id} className="card hover" href={href(`/arena/${g.id}`)}>
            <div className="row between"><span className="eyebrow" style={{ margin: 0 }}>Game {i + 1}</span>{games[g.id] && <span className="chip amber">best {games[g.id].best}</span>}</div>
            <h3 style={{ margin: '8px 0 4px' }}>{g.title}</h3>
            <div className="small muted">{g.tagline}</div>
            <div className="tiny faint" style={{ marginTop: 10 }}>{g.skills.map((s) => getSkill(s).title).join(' · ')}</div>
            <div className="tiny faint">{games[g.id]?.plays ?? 0} plays</div>
          </a>
        ))}
      </div>
      <div className="row" style={{ marginTop: 18 }}><a className="btn" href={href('/brain-gym')}><Icon name="brain" /> Brain Gym puzzles</a></div>
    </div>
  );
}

// Ranks, XP and badges. Rank comes from demonstrated mastery and projects — never from XP. See MASTER_PROMPT §6.7.
import type { Evidence, SkillEstimate } from '../types';
import { PASS } from './assessment';

export const RANKS = [
  { name: 'Explorer', mastered: 0, projects: 0 },
  { name: 'Apprentice', mastered: 3, projects: 0 },
  { name: 'Practitioner', mastered: 8, projects: 0 },
  { name: 'Builder', mastered: 14, projects: 1 },
  { name: 'Engineer', mastered: 22, projects: 2 },
  { name: 'Specialist', mastered: 32, projects: 3 },
  { name: 'Architect', mastered: 45, projects: 5 },
  { name: 'Master', mastered: 60, projects: 7 },
] as const;

export function rankFor(masteredCount: number, projectsDone: number) {
  let idx = 0;
  RANKS.forEach((r, i) => {
    if (masteredCount >= r.mastered && projectsDone >= r.projects) idx = i;
  });
  const next = RANKS[idx + 1];
  return { index: idx, rank: RANKS[idx], next };
}

/** XP for one graded attempt. Halved with hints, zero for revealed solutions, bonus for recovering a weak skill. */
export function xpFor(e: Pick<Evidence, 'score' | 'difficulty' | 'hintsUsed' | 'solutionRevealed'>, recovering: boolean): number {
  if (e.solutionRevealed) return 0;
  const base = Math.round(10 * e.score * e.difficulty);
  const hinted = e.hintsUsed > 0 ? Math.round(base / 2) : base;
  const participation = e.score < PASS ? 1 : 0; // modest reward for an honest attempt
  return Math.round((hinted + participation) * (recovering && e.score >= PASS ? 1.5 : 1));
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  skills: string[];
  need: number; // how many of the skills must be mastered
}

export const BADGES: Badge[] = [
  { id: 'b-prompt', name: 'Prompt Architect', description: 'Mastered core prompt-engineering skills.', skills: ['p-clear', 'p-context', 'p-format', 'p-examples', 'p-verify'], need: 4 },
  { id: 'b-cc', name: 'Claude Code Operator', description: 'Demonstrated safe, effective Claude Code workflows.', skills: ['cc-start', 'cc-instructions', 'cc-review', 'cc-claudemd', 'cc-permissions', 'cc-plan'], need: 4 },
  { id: 'b-cx', name: 'Codex Builder', description: 'Demonstrated Codex workflows and controls.', skills: ['cx-what', 'cx-cli', 'cx-agentsmd', 'cx-approvals'], need: 3 },
  { id: 'b-tools', name: 'Tool Calling Specialist', description: 'Tool definitions, validation and results.', skills: ['t-function-calling', 't-schemas', 't-results'], need: 3 },
  { id: 'b-mcp', name: 'MCP Engineer', description: 'MCP concepts and safe integration.', skills: ['t-mcp', 't-untrusted'], need: 2 },
  { id: 'b-rag', name: 'RAG Builder', description: 'Chunking, retrieval, grounding and retrieval evaluation.', skills: ['r-chunking', 'r-embeddings', 'r-retrieval', 'r-grounding', 'r-eval'], need: 4 },
  { id: 'b-debug', name: 'Agent Debugger', description: 'Agent loops, stopping, recovery and traces.', skills: ['ag-loop', 'ag-stop', 'ag-recovery', 'ev-traces'], need: 3 },
  { id: 'b-eval', name: 'Evaluation Specialist', description: 'Datasets, graders and metrics.', skills: ['ev-why', 'ev-datasets', 'ev-graders', 'ev-metrics'], need: 3 },
  { id: 'b-sec', name: 'Security Defender', description: 'Injection, least privilege, secrets, sandboxing, confirmation.', skills: ['sec-injection', 'sec-least-priv', 'sec-secrets', 'sec-sandbox', 'sec-confirm'], need: 4 },
  { id: 'b-multi', name: 'Multi-Agent Architect', description: 'Workflows, delegation, parallelism, state and termination.', skills: ['ar-workflows', 'ar-delegation', 'ar-parallel', 'ar-state', 'ar-termination'], need: 4 },
];

export function earnedBadges(est: Record<string, SkillEstimate>) {
  return BADGES.map((b) => {
    const done = b.skills.filter((s) => est[s]?.state === 'mastered' || est[s]?.state === 'review-due');
    return { badge: b, done, earned: done.length >= b.need };
  });
}

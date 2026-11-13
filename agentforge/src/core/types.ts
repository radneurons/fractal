// Core domain contracts for AgentForge. Pure types — no runtime code.

export type Level = 'beginner' | 'intermediate' | 'advanced' | 'expert';
export type Difficulty = 1 | 2 | 3 | 4 | 5;

export type ErrorTag =
  | 'conceptual'
  | 'missing-prereq'
  | 'wrong-tool'
  | 'syntax'
  | 'weak-planning'
  | 'context-omission'
  | 'bad-assumption'
  | 'poor-verification'
  | 'incomplete'
  | 'unsafe-action'
  | 'state-mgmt'
  | 'concept-confusion';

export const ERROR_TAG_LABEL: Record<ErrorTag, string> = {
  conceptual: 'Conceptual misunderstanding',
  'missing-prereq': 'Missing prerequisite',
  'wrong-tool': 'Incorrect tool selection',
  syntax: 'Syntax / format error',
  'weak-planning': 'Weak planning',
  'context-omission': 'Context omission',
  'bad-assumption': 'Unsupported assumption',
  'poor-verification': 'Poor verification',
  incomplete: 'Incomplete solution',
  'unsafe-action': 'Unsafe action selection',
  'state-mgmt': 'Incorrect state management',
  'concept-confusion': 'Confusing similar concepts',
};

export interface Source {
  label: string;
  url: string;
}

export interface School {
  id: string;
  num: number;
  title: string;
  tagline: string;
  level: Level;
  hue: number; // used for universe cluster colour
  description: string;
}

export interface Skill {
  id: string;
  schoolId: string;
  title: string;
  summary: string;
  prereqs: string[];
  difficulty: Difficulty;
  /** Compact corrective lesson shown during remediation. */
  remediation: string;
  /** A simpler worked example shown during remediation. */
  workedExample: string;
}

// ---------- Assessment items ----------

export interface ItemBase {
  id: string;
  skillId: string;
  difficulty: Difficulty;
  prompt: string;
  explanation: string;
  hints: string[];
  minutes?: number;
}

export interface Option {
  id: string;
  text: string;
  correct: boolean;
  errorTag?: ErrorTag;
  feedback?: string;
}

export interface McqItem extends ItemBase {
  type: 'mcq';
  options: Option[];
}
export interface MultiItem extends ItemBase {
  type: 'multi';
  options: Option[];
}
export interface OrderItem extends ItemBase {
  type: 'order';
  steps: string[]; // correct order
  errorTag?: ErrorTag;
}
export interface MatchItem extends ItemBase {
  type: 'match';
  pairs: { left: string; right: string }[];
  errorTag?: ErrorTag;
}
export interface FillItem extends ItemBase {
  type: 'fill';
  /** Use [[0]], [[1]] … as blank markers. */
  template: string;
  blanks: { accept: string[] }[];
  errorTag?: ErrorTag;
}
export interface ShortItem extends ItemBase {
  type: 'short';
  rubric: { concept: string; any: string[] }[];
  minConcepts: number;
  modelAnswer: string;
}
export interface CodeTest {
  name: string;
  /** Body of a function receiving the learner's exports object `m`; must `return true` or throw. */
  code: string;
}
export interface CodeItem extends ItemBase {
  type: 'code';
  /** Top-level names the learner's code must define; tests receive them as `m`. */
  exports: string[];
  starter: string;
  tests: CodeTest[];
  solution: string;
  errorTag?: ErrorTag;
}
export interface ClassifyItem extends ItemBase {
  type: 'classify';
  buckets: string[];
  cards: { text: string; bucket: string; errorTag?: ErrorTag }[];
}

export type Item = McqItem | MultiItem | OrderItem | MatchItem | FillItem | ShortItem | CodeItem | ClassifyItem;
export type ItemType = Item['type'];

export type Response =
  | { type: 'mcq'; optionId: string | null }
  | { type: 'multi'; optionIds: string[] }
  | { type: 'order'; order: string[] }
  | { type: 'match'; mapping: Record<string, string> }
  | { type: 'fill'; values: string[] }
  | { type: 'short'; text: string }
  | { type: 'code'; passed: number; total: number; failed: string[] }
  | { type: 'classify'; mapping: Record<string, string> };

export interface GradeResult {
  score: number; // 0..1
  correct: boolean; // score >= PASS
  errorTags: ErrorTag[];
  feedback: string[];
  gradedBy: GradedBy;
}

export type GradedBy = 'deterministic' | 'heuristic' | 'model' | 'self' | 'executed';

// ---------- Lessons ----------

export type ContentStatus = 'current' | 'review-needed' | 'planned' | 'archived';
export type DemoId =
  | 'tokenizer'
  | 'agent-loop'
  | 'context-window'
  | 'rag'
  | 'neural-net'
  | 'llm-pipeline'
  | 'rule-vs-model'
  | 'terminal'
  | 'injection'
  | 'multi-agent'
  | 'eval';

export interface Lesson {
  id: string;
  schoolId: string;
  skillIds: string[];
  title: string;
  minutes: number;
  difficulty: Difficulty;
  status: ContentStatus;
  version: string;
  lastReviewed: string;
  sources: Source[];
  environment: 'browser' | 'simulated' | 'requires-provider';
  objective: string;
  prerequisites: string[]; // skill ids
  motivation: string;
  sections: { heading: string; body: string }[];
  demo?: { id: DemoId; caption: string };
  workedExample: { title: string; body: string };
  guided: string; // item id
  practice: string[]; // item ids
  mistakes: string[];
  check: string[]; // item ids
  challenge?: string; // item id
  summary: string[];
  simpler: string; // "explain simply" authored text
  anotherWay: string; // "teach it another way" authored text
}

// ---------- Evidence & learner model ----------

export type EvidenceSource =
  | 'diagnostic'
  | 'lesson'
  | 'practice'
  | 'exercise'
  | 'game'
  | 'interview'
  | 'project'
  | 'review'
  | 'remediation'
  | 'self';

export interface Evidence {
  id: string;
  skillId: string;
  itemId?: string;
  source: EvidenceSource;
  score: number;
  difficulty: Difficulty;
  hintsUsed: number;
  solutionRevealed: boolean;
  errorTags: ErrorTag[];
  gradedBy: GradedBy;
  at: number;
  note?: string;
}

export type SkillState =
  | 'locked-soft'
  | 'ready'
  | 'in-progress'
  | 'practiced'
  | 'mastered'
  | 'review-due'
  | 'remediation';

export interface SkillEstimate {
  skillId: string;
  mastery: number; // posterior mean 0..1
  nEff: number;
  confidence: number; // 0..1
  confidenceLabel: 'insufficient' | 'low' | 'moderate' | 'high';
  ci: [number, number];
  attempts: number;
  passedItems: number;
  lastSuccess?: number;
  trend: number; // recent minus older, -1..1
  state: SkillState;
  nextReview?: number;
  sufficient: boolean;
}

export type GoalPath = 'power-user' | 'claude-code' | 'codex' | 'app-dev' | 'agent-engineer' | 'architect';

export interface Profile {
  createdAt: number;
  level: 'zero' | 'uses-ai' | 'developer';
  path: GoalPath;
  minutesPerSession: 20 | 40 | 60;
  sessionsPerWeek: number;
  language: 'javascript' | 'typescript' | 'python';
  onboarded: boolean;
  diagnosticDone: boolean;
}

export interface Settings {
  theme: 'dark' | 'light' | 'contrast';
  focusMode: boolean;
  reducedMotion: boolean;
  textScale: number; // 0.9 .. 1.3
  sound: boolean;
  hintPolicy: 'ladder' | 'off';
  universeView: '3d' | '2d';
}

export interface ProviderConfig {
  provider: 'none' | 'anthropic' | 'openai';
  apiKey: string;
  model: string;
  consent: boolean;
}

export interface ReviewState {
  skillId: string;
  stage: number; // index into ladder
  due: number;
  history: { at: number; passed: boolean }[];
  firstMasteredAt?: number;
}

export interface LessonProgress {
  lessonId: string;
  step: number;
  completed: boolean;
  startedAt: number;
  completedAt?: number;
  seenItems: string[];
}

export interface VaultEntry {
  id: string;
  kind: 'note' | 'prompt' | 'snippet' | 'mistake' | 'bookmark' | 'interview' | 'decision';
  title: string;
  body: string;
  tags: string[];
  skillIds: string[];
  createdAt: number;
  updatedAt: number;
  resolved?: boolean;
}

export interface ActivityRecord {
  id: string;
  kind: string;
  title: string;
  at: number;
  route?: string;
  xp?: number;
}

export interface PlanBlock {
  kind: 'review' | 'remediation' | 'lesson' | 'practice' | 'project' | 'stretch';
  title: string;
  skillId?: string;
  lessonId?: string;
  route: string;
  minutes: number;
  reason: string;
}

export interface PlanDay {
  date: string; // yyyy-mm-dd
  blocks: PlanBlock[];
  minutes: number;
}

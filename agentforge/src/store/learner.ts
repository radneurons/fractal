// The single learner model. Every surface reads the same evidence log. Persisted to IndexedDB.
import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import type { ActivityRecord, Evidence, EvidenceSource, GradeResult, Item, LessonProgress, Profile, ProviderConfig, ReviewState, Settings, VaultEntry } from '@/core/types';
import { scheduleAfter } from '@/core/engines/review';
import { estimate } from '@/core/engines/competency';
import { xpFor } from '@/core/engines/progression';
import type { DiagStep } from '@/core/engines/diagnostic';
import type { Graph } from '@/core/runtime/agentRuntime';
import { getSkill } from '@/content/skills';

export const STORE_VERSION = 1;

const memory = new Map<string, string>();
const idbStorage: StateStorage = {
  getItem: async (k) => {
    try {
      return (await idbGet<string>(k)) ?? null;
    } catch {
      return memory.get(k) ?? null;
    }
  },
  setItem: async (k, v) => {
    try {
      await idbSet(k, v);
    } catch {
      memory.set(k, v);
    }
  },
  removeItem: async (k) => {
    try {
      await idbDel(k);
    } catch {
      memory.delete(k);
    }
  },
};

export interface ProjectProgress {
  started: number;
  milestones: Record<string, { done: boolean; at?: number; score?: number }>;
  notes: Record<string, string>;
  code: Record<string, string>;
  reflection?: string;
  completedAt?: number;
}
export interface InterviewRecord {
  id: string;
  scenarioId: string;
  level: string;
  answer: string;
  score: number;
  criteria: { name: string; met: boolean }[];
  gradedBy: 'heuristic' | 'model' | 'self';
  at: number;
  followUp?: { question: string; answer: string; met: boolean };
  durationSec: number;
}
export interface GameRecord {
  plays: number;
  best: number;
  levels: Record<string, number>;
  last?: number;
}
export interface Submission {
  code: string;
  at: number;
  passed: number;
  total: number;
}

export interface ComparisonSide {
  label: string;
  provider: string;
  model: string;
  output: string;
  latencyMs: number;
  usage?: { input: number; output: number };
  error?: string;
  checks: { name: string; ok: boolean }[];
  scores: Record<string, number>;
}
export interface ComparisonRecord {
  id: string;
  at: number;
  taskId: string;
  taskTitle: string;
  prompt: string;
  sides: [ComparisonSide, ComparisonSide];
  notes: string;
}

export interface AttemptInput {
  item: Item;
  result: GradeResult;
  source: EvidenceSource;
  hintsUsed: number;
  revealed: boolean;
  note?: string;
  responseSummary?: string;
}

export interface LearnerState {
  hydrated: boolean;
  version: number;
  profile: Profile | null;
  settings: Settings;
  provider: ProviderConfig;
  secondary: ProviderConfig;
  comparisons: ComparisonRecord[];
  evidence: Evidence[];
  reviews: Record<string, ReviewState>;
  lessonProgress: Record<string, LessonProgress>;
  touched: string[];
  vault: VaultEntry[];
  activity: ActivityRecord[];
  xp: number;
  pinned: string[];
  skipped: string[];
  projects: Record<string, ProjectProgress>;
  interviews: InterviewRecord[];
  games: Record<string, GameRecord>;
  submissions: Record<string, Submission[]>;
  drafts: Record<string, string>;
  studioGraphs: Record<string, Graph>;
  diagnostic: DiagStep[];
  studyDays: string[];
  lastRoute: string;

  setProfile: (p: Partial<Profile>) => void;
  setSettings: (s: Partial<Settings>) => void;
  setProvider: (p: Partial<ProviderConfig>) => void;
  setSecondary: (p: Partial<ProviderConfig>) => void;
  addComparison: (c: ComparisonRecord) => void;
  removeComparison: (id: string) => void;
  recordAttempt: (a: AttemptInput) => { evidence: Evidence; xp: number };
  recordEvidence: (e: Omit<Evidence, 'id' | 'at'> & { at?: number }, title: string) => Evidence;
  touch: (skillId: string) => void;
  setLessonProgress: (id: string, p: Partial<LessonProgress>) => void;
  addVault: (e: Omit<VaultEntry, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateVault: (id: string, p: Partial<VaultEntry>) => void;
  removeVault: (id: string) => void;
  log: (a: Omit<ActivityRecord, 'id' | 'at'>) => void;
  togglePin: (skillId: string) => void;
  toggleSkip: (skillId: string) => void;
  setProject: (id: string, fn: (p: ProjectProgress) => ProjectProgress) => void;
  addInterview: (r: InterviewRecord) => void;
  recordGame: (gameId: string, level: string, score: number) => void;
  addSubmission: (key: string, s: Submission) => void;
  setDraft: (key: string, v: string) => void;
  saveGraph: (id: string, g: Graph) => void;
  setDiagnostic: (d: DiagStep[]) => void;
  setLastRoute: (r: string) => void;
  importAll: (data: Partial<LearnerState>) => void;
  resetAll: () => void;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'dark', focusMode: false, reducedMotion: false, textScale: 1, sound: false, hintPolicy: 'ladder', universeView: '3d' };
export const DEFAULT_PROVIDER: ProviderConfig = { provider: 'none', apiKey: '', model: '', consent: false };

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const today = () => new Date().toISOString().slice(0, 10);

const initial = () => ({
  version: STORE_VERSION,
  profile: null as Profile | null,
  settings: DEFAULT_SETTINGS,
  provider: DEFAULT_PROVIDER,
  secondary: DEFAULT_PROVIDER,
  comparisons: [] as ComparisonRecord[],
  evidence: [] as Evidence[],
  reviews: {} as Record<string, ReviewState>,
  lessonProgress: {} as Record<string, LessonProgress>,
  touched: [] as string[],
  vault: [] as VaultEntry[],
  activity: [] as ActivityRecord[],
  xp: 0,
  pinned: [] as string[],
  skipped: [] as string[],
  projects: {} as Record<string, ProjectProgress>,
  interviews: [] as InterviewRecord[],
  games: {} as Record<string, GameRecord>,
  submissions: {} as Record<string, Submission[]>,
  drafts: {} as Record<string, string>,
  studioGraphs: {} as Record<string, Graph>,
  diagnostic: [] as DiagStep[],
  studyDays: [] as string[],
  lastRoute: '/home',
});

export const useLearner = create<LearnerState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      ...initial(),
      setProfile: (p) => set((s) => ({ profile: { ...(s.profile ?? { createdAt: Date.now(), level: 'zero', path: 'power-user', minutesPerSession: 20, sessionsPerWeek: 4, language: 'javascript', onboarded: false, diagnosticDone: false }), ...p } })),
      setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      setProvider: (p) => set((s) => ({ provider: { ...s.provider, ...p } })),
      setSecondary: (p) => set((s) => ({ secondary: { ...s.secondary, ...p } })),
      addComparison: (c) => set((s) => ({ comparisons: [c, ...s.comparisons].slice(0, 50) })),
      removeComparison: (id) => set((s) => ({ comparisons: s.comparisons.filter((c) => c.id !== id) })),

      recordEvidence: (e, title) => {
        const ev: Evidence = { ...e, id: uid(), at: e.at ?? Date.now() };
        const s = get();
        const prevEst = estimate(ev.skillId, s.evidence, { now: ev.at, touched: true, prereqStates: [] });
        const recovering = prevEst.state === 'remediation';
        const nextEvidence = [...s.evidence, ev];
        const est = estimate(ev.skillId, nextEvidence, { now: ev.at, touched: true, prereqStates: [] });
        const passed = ev.score >= 0.7 && !ev.solutionRevealed;
        const review = scheduleAfter(s.reviews[ev.skillId], ev.skillId, passed, est.state === 'mastered', ev.at);
        const xp = xpFor(ev, recovering);
        set({
          evidence: nextEvidence,
          reviews: { ...s.reviews, [ev.skillId]: review },
          touched: s.touched.includes(ev.skillId) ? s.touched : [...s.touched, ev.skillId],
          xp: s.xp + xp,
          studyDays: s.studyDays.includes(today()) ? s.studyDays : [...s.studyDays, today()],
          activity: [{ id: uid(), kind: ev.source, title: `${passed ? '✓' : '✗'} ${title}`, at: ev.at, xp }, ...s.activity].slice(0, 200),
        });
        return ev;
      },

      recordAttempt: ({ item, result, source, hintsUsed, revealed, note, responseSummary }) => {
        const ev = get().recordEvidence(
          { skillId: item.skillId, itemId: item.id, source, score: revealed ? 0 : result.score, difficulty: item.difficulty, hintsUsed, solutionRevealed: revealed, errorTags: result.errorTags, gradedBy: result.gradedBy, note },
          `${getSkill(item.skillId).title} · ${item.type}`,
        );
        // Mistake journal: every incorrect attempt becomes a reviewable entry.
        if (!result.correct && !revealed) {
          get().addVault({
            kind: 'mistake',
            title: item.prompt.slice(0, 90),
            body: `**Your answer:** ${responseSummary ?? '(see attempt)'}\n\n**What went wrong:** ${result.feedback.join(' ')}\n\n**Correct explanation:** ${item.explanation}`,
            tags: result.errorTags,
            skillIds: [item.skillId],
            resolved: false,
          });
        }
        if (result.correct) {
          // Mark earlier mistakes on this item as resolved — demonstrated improvement.
          set((s) => ({ vault: s.vault.map((v) => (v.kind === 'mistake' && !v.resolved && v.skillIds.includes(item.skillId) && v.title === item.prompt.slice(0, 90) ? { ...v, resolved: true, updatedAt: Date.now() } : v)) }));
        }
        return { evidence: ev, xp: xpFor(ev, false) };
      },

      touch: (skillId) => set((s) => (s.touched.includes(skillId) ? s : { touched: [...s.touched, skillId] })),
      setLessonProgress: (id, p) =>
        set((s) => {
          const base: LessonProgress = s.lessonProgress[id] ?? { lessonId: id, step: 0, completed: false, startedAt: Date.now(), seenItems: [] };
          return { lessonProgress: { ...s.lessonProgress, [id]: { ...base, ...p } } };
        }),
      addVault: (e) => {
        const id = uid();
        set((s) => ({ vault: [{ ...e, id, createdAt: Date.now(), updatedAt: Date.now() }, ...s.vault] }));
        return id;
      },
      updateVault: (id, p) => set((s) => ({ vault: s.vault.map((v) => (v.id === id ? { ...v, ...p, updatedAt: Date.now() } : v)) })),
      removeVault: (id) => set((s) => ({ vault: s.vault.filter((v) => v.id !== id) })),
      log: (a) => set((s) => ({ activity: [{ ...a, id: uid(), at: Date.now() }, ...s.activity].slice(0, 200), studyDays: s.studyDays.includes(today()) ? s.studyDays : [...s.studyDays, today()] })),
      togglePin: (id) => set((s) => ({ pinned: s.pinned.includes(id) ? s.pinned.filter((x) => x !== id) : [...s.pinned, id], skipped: s.skipped.filter((x) => x !== id) })),
      toggleSkip: (id) => set((s) => ({ skipped: s.skipped.includes(id) ? s.skipped.filter((x) => x !== id) : [...s.skipped, id], pinned: s.pinned.filter((x) => x !== id) })),
      setProject: (id, fn) => set((s) => ({ projects: { ...s.projects, [id]: fn(s.projects[id] ?? { started: Date.now(), milestones: {}, notes: {}, code: {} }) } })),
      addInterview: (r) => set((s) => ({ interviews: [r, ...s.interviews].slice(0, 200) })),
      recordGame: (gameId, level, score) =>
        set((s) => {
          const g = s.games[gameId] ?? { plays: 0, best: 0, levels: {} };
          return { games: { ...s.games, [gameId]: { plays: g.plays + 1, best: Math.max(g.best, score), levels: { ...g.levels, [level]: Math.max(g.levels[level] ?? 0, score) }, last: Date.now() } } };
        }),
      addSubmission: (key, sub) => set((s) => ({ submissions: { ...s.submissions, [key]: [sub, ...(s.submissions[key] ?? [])].slice(0, 20) } })),
      setDraft: (key, v) => set((s) => ({ drafts: { ...s.drafts, [key]: v } })),
      saveGraph: (id, g) => set((s) => ({ studioGraphs: { ...s.studioGraphs, [id]: g } })),
      setDiagnostic: (d) => set({ diagnostic: d }),
      setLastRoute: (r) => set({ lastRoute: r }),
      importAll: (data) => set((s) => ({ ...s, ...sanitizeImport(data), provider: s.provider, secondary: s.secondary })),
      resetAll: () => set({ ...initial() }),
    }),
    {
      name: 'agentforge-v1',
      version: STORE_VERSION,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => {
        const { hydrated: _h, ...rest } = s;
        return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function')) as Partial<LearnerState>;
      },
      onRehydrateStorage: () => () => {
        useLearner.setState({ hydrated: true });
      },
    },
  ),
);

function sanitizeImport(d: Partial<LearnerState>): Partial<LearnerState> {
  const keys: (keyof LearnerState)[] = ['profile', 'settings', 'evidence', 'reviews', 'lessonProgress', 'touched', 'vault', 'activity', 'xp', 'pinned', 'skipped', 'projects', 'interviews', 'games', 'submissions', 'drafts', 'studioGraphs', 'diagnostic', 'studyDays', 'comparisons'];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in d) out[k] = (d as Record<string, unknown>)[k];
  if (out.evidence && !Array.isArray(out.evidence)) throw new Error('Invalid export: evidence must be an array');
  return out as Partial<LearnerState>;
}

/** Export everything except credentials. */
export function exportData(): string {
  const s = useLearner.getState();
  const { provider: _p, secondary: _s2, hydrated: _h, ...rest } = s;
  const data = Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function'));
  return JSON.stringify({ app: 'agentforge', exportedAt: new Date().toISOString(), version: STORE_VERSION, data }, null, 2);
}

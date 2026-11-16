// The editable project state shared by the stage, the UI and persistence.
import type {
  Analysis, GlobalSettings, Layer, Lane, ModRoute, Params, PlanSegment, PlanState, Post, SectionLabel, Instance, Aspect, MediaItem,
} from '../types.ts';
import { DEFAULT_POST, DEFAULT_SETTINGS } from '../types.ts';

export interface AppState {
  settings: GlobalSettings;
  plan: PlanState;
  layers: Layer[];
  instances: Record<string, Instance>;
  post: Post;
  routes: ModRoute[];
  lanes: Lane[];
  media: MediaItem[];
  previewRes: 540 | 720 | 1080;
}

export const DEFAULT_MAP: Record<SectionLabel, string> = {
  intro: 'mission', outro: 'mission', verse: 'broadside', chorus: 'elements', drop: 'swarm', breakdown: 'droste', bridge: 'press', speech: 'karaoke',
};

export const planInstance = (effect: string) => `plan:${effect}`;

export function defaultState(): AppState {
  return {
    settings: { ...DEFAULT_SETTINGS, fontOverrides: {} },
    plan: { mode: 'single', effect: 'broadside', transition: 'flash', map: { ...DEFAULT_MAP }, segments: [] },
    layers: [{ id: 'plan', kind: 'plan', instanceId: 'plan', enabled: true, blend: 'normal', opacity: 1, mask: 'none' }],
    instances: {},
    post: { ...DEFAULT_POST },
    routes: [],
    lanes: [],
    media: [],
    previewRes: 720,
  };
}

/** Plan segments for the current mode (custom plans are kept as edited). */
export function buildPlan(plan: PlanState, a: Analysis | null, duration: number): PlanSegment[] {
  if (plan.mode === 'custom' && plan.segments.length) return plan.segments;
  if (plan.mode === 'single' || !a || !a.sections.length) return [{ start: 0, end: duration, effect: plan.effect }];
  const out: PlanSegment[] = [];
  for (const s of a.sections) {
    const effect = plan.map[s.label] ?? plan.effect;
    const last = out[out.length - 1];
    if (last && last.effect === effect) last.end = s.end;
    else out.push({ start: s.start, end: s.end, effect });
  }
  if (out.length) { out[0].start = 0; out[out.length - 1].end = Math.max(duration, out[out.length - 1].end); }
  return out;
}

export function paramsOf(state: AppState, instanceId: string): Params {
  return state.instances[instanceId]?.params ?? {};
}

export function ensureInstance(state: AppState, instanceId: string, effect: string): Instance {
  let i = state.instances[instanceId];
  if (!i || i.effect !== effect) { i = { effect, params: i && i.effect === effect ? i.params : {} }; state.instances[instanceId] = i; }
  return i;
}

/** Output size for an aspect at a given short-side resolution (even numbers). */
export function sizeFor(aspect: Aspect, res: number): { w: number; h: number } {
  const [aw, ah] = aspect.split(':').map(Number);
  let w: number, h: number;
  if (aw >= ah) { h = res; w = (res * aw) / ah; } else { w = res; h = (res * ah) / aw; }
  const even = (x: number) => Math.round(x / 2) * 2;
  return { w: even(w), h: even(h) };
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

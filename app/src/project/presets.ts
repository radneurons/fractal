// Looks (SPEC §12.4): effect instances, layers, materials, post and modulation routes — no audio or lyrics.
import type { Layer, ModRoute, Post, Instance, PlanState } from '../types.ts';
import { DEFAULT_POST } from '../types.ts';
import { type AppState, planInstance } from './state.ts';

export interface Look {
  kind: 'lyric-engine-look'; version: 1; name: string; description?: string;
  effect: string;
  instances: Record<string, Instance>;
  layers: Layer[];
  post: Post;
  routes: ModRoute[];
  plan?: Partial<PlanState>;
  settings?: Partial<AppState['settings']>;
}

export function captureLook(state: AppState, name: string): Look {
  return JSON.parse(JSON.stringify({ kind: 'lyric-engine-look', version: 1, name, effect: state.plan.effect, instances: state.instances, layers: state.layers.filter((l) => l.kind !== 'media'), post: state.post, routes: state.routes, plan: { mode: state.plan.mode, transition: state.plan.transition, map: state.plan.map } }));
}

/** Apply keeps the lyrics and the audio. */
export function applyLook(state: AppState, look: Look): AppState {
  const next: AppState = JSON.parse(JSON.stringify(state));
  next.plan.effect = look.effect;
  next.plan.mode = look.plan?.mode ?? 'single';
  if (look.plan?.transition) next.plan.transition = look.plan.transition;
  if (look.plan?.map) next.plan.map = { ...next.plan.map, ...look.plan.map };
  next.instances = { ...next.instances, ...JSON.parse(JSON.stringify(look.instances)) };
  const media = next.layers.filter((l) => l.kind === 'media');
  next.layers = [...media, ...JSON.parse(JSON.stringify(look.layers))];
  if (!next.layers.some((l) => l.kind === 'plan')) next.layers.unshift({ id: 'plan', kind: 'plan', instanceId: 'plan', enabled: true, blend: 'normal', opacity: 1, mask: 'none' });
  next.post = { ...DEFAULT_POST, ...look.post };
  next.routes = JSON.parse(JSON.stringify(look.routes));
  Object.assign(next.settings, look.settings ?? {});
  return next;
}

const plan = (material?: Layer['material']): Layer => ({ id: 'plan', kind: 'plan', instanceId: 'plan', enabled: true, blend: 'normal', opacity: 1, mask: 'none', material });
const fx = (effect: string, blend: Layer['blend'], opacity: number, extra: Partial<Layer> = {}): Layer => ({ id: `look-${effect}`, kind: 'effect', effect, instanceId: `look:${effect}`, enabled: true, blend, opacity, mask: 'none', ...extra });
const look = (name: string, description: string, effect: string, x: Partial<Look> = {}): Look => ({
  kind: 'lyric-engine-look', version: 1, name, description, effect, instances: { [planInstance(effect)]: { effect, params: {} }, ...(x.instances ?? {}) },
  layers: x.layers ?? [plan()], post: { ...DEFAULT_POST, ...(x.post ?? {}) }, routes: x.routes ?? [], plan: x.plan, settings: x.settings,
});
const route = (label: string, source: ModRoute['source'], instanceId: string, key: string, amount: number, x: Partial<ModRoute> = {}): ModRoute =>
  ({ id: `look_${label}`, label, source, target: { instanceId, key }, amount, curve: 'lin', attackMs: 20, releaseMs: 180, lo: 0, hi: 1, invert: false, enabled: true, ...x });

/** The 12 built-in Looks. */
export const BUILTIN_LOOKS: Look[] = [
  look('Neon Noir', 'NEON with rain, bloom and a teal-orange grade', 'neon', { instances: { 'plan:neon': { effect: 'neon', params: { rain: true, palette: 'Tokyo' } } }, post: { ...DEFAULT_POST, bloom: 0.45, vignette: 0.35, lut: 'teal-orange', lutMix: 0.8, grain: 0.15 }, routes: [route('beat-bloom', 'beatPulse', 'post', 'bloom', 0.2)] }),
  look('Zine', 'RANSOM in zine mode with grain', 'ransom', { instances: { 'plan:ransom': { effect: 'ransom', params: { zine: true, fps: '12' } } }, post: { ...DEFAULT_POST, grain: 0.45, vignette: 0.2 } }),
  look('Cathedral', 'MONOLITH in marble with halation', 'monolith', { instances: { 'plan:monolith': { effect: 'monolith', params: { material: 'marble' } } }, post: { ...DEFAULT_POST, halation: 0.5, bloom: 0.2, vignette: 0.3 } }),
  look('Karaoke Night', 'KARAOKE on the artwork palette', 'karaoke', { instances: { 'plan:karaoke': { effect: 'karaoke', params: { ball: true } } }, settings: { paletteSource: 'artwork' }, post: { ...DEFAULT_POST, vignette: 0.25 } }),
  look('Broadcast', 'BROADSIDE with a SIGNAL overlay at 25 % screen', 'broadside', { layers: [plan(), fx('signal', 'screen', 0.25)], instances: { 'look:signal': { effect: 'signal', params: { display: 'VHS' } } }, post: { ...DEFAULT_POST, chroma: 0.25, grain: 0.2 } }),
  look('Gold Leaf Press', 'PRESS re-skinned in gold leaf', 'press', { layers: [plan({ kind: 'goldleaf', strength: 1, backdrop: 'layout', tint: '#ffd27a' })], post: { ...DEFAULT_POST, vignette: 0.3, lut: 'warm-film', lutMix: 0.6 } }),
  look('Molten', 'ELEMENTS under a lava material', 'elements', { layers: [plan({ kind: 'lava', strength: 0.85, backdrop: 'layout', tint: '#ff7a2a' })], post: { ...DEFAULT_POST, bloom: 0.4, halation: 0.3 }, routes: [route('bass-bloom', 'bass', 'post', 'bloom', 0.25)] }),
  look('Chrome Dreams', 'LIQUID CHROME with holographic foil and bloom', 'chrome', { layers: [plan({ kind: 'holo', strength: 0.55, backdrop: 'layout', tint: '#ffffff' })], post: { ...DEFAULT_POST, bloom: 0.35, chroma: 0.3 } }),
  look('Frosted Poster', 'MISSION POSTER with frost growing on each word', 'mission', { layers: [plan({ kind: 'frost', strength: 0.9, backdrop: 'layout', tint: '#cfeaff' })], post: { ...DEFAULT_POST, lut: 'bleach', lutMix: 0.5, vignette: 0.2 } }),
  look('Star Swarm', 'SWARM with a stardust FIREWORKS layer on choruses', 'swarm', { layers: [plan(), fx('fireworks', 'add', 0.7, { sectionOnly: 'chorus' })], post: { ...DEFAULT_POST, bloom: 0.5 } }),
  look('Ink & Seal', 'SUMI with warm film and a soft vignette', 'sumi', { post: { ...DEFAULT_POST, lut: 'warm-film', lutMix: 0.7, vignette: 0.3, grain: 0.2 } }),
  look('Kaleido Key', 'MANDALA coloured by the song key, tension drives the hue', 'mandala', { instances: { 'plan:mandala': { effect: 'mandala', params: { palette: 'key' } } }, routes: [route('tension-hue', 'tension', 'plan:mandala', 'hueShift', 0.5, { releaseMs: 600 })], post: { ...DEFAULT_POST, bloom: 0.3, chroma: 0.2 } }),
];

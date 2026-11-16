/** Every structure that crosses a boundary (file, bridge, MCP, Claude) is defined here with zod. */
import { z } from 'zod';
import { EASINGS } from './math';

export const Vec3S = z.tuple([z.number(), z.number(), z.number()]);
export const IdS = z.string().min(1).max(64);
export const ColorS = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const EasingS = z.enum(EASINGS);

export const CLIPS = ['idle', 'walk', 'run', 'sprint', 'crouch', 'jump', 'slash', 'thrust', 'block', 'dodge', 'hitReact', 'fall', 'sit', 'point', 'talk'] as const;
export const ClipS = z.string().min(1); // built-in name or custom (mocap) clip id
export const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR', 'upLegL', 'legL', 'footL', 'upLegR', 'legR', 'footR'] as const;
export type Joint = (typeof JOINTS)[number];
export const JointS = z.enum(JOINTS);

export const FacingS = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('path') }),
  z.object({ mode: z.literal('target'), targetId: IdS }),
  z.object({ mode: z.literal('fixed'), yaw: z.number() }),
]);
export const PathKeyS = z.object({
  id: IdS, t: z.number().min(0), pos: Vec3S, clip: ClipS.default('idle'), facing: FacingS.default({ mode: 'path' }),
  ease: EasingS.default('linear'), speed: z.number().positive().default(1),
  hIn: Vec3S.optional(), hOut: Vec3S.optional(), // bezier handles (relative), optional
});
export const PoseKeyS = z.object({ id: IdS, t: z.number().min(0), joint: JointS, rot: Vec3S, ease: EasingS.default('easeInOut') });
export const HELD = ['none', 'sword', 'staff', 'pistol', 'rifle', 'shield', 'lantern'] as const;
export const CharacterS = z.object({
  id: IdS, name: z.string(), idColor: ColorS, height: z.number().min(0.5).max(3).default(1.75), build: z.number().min(0.6).max(1.6).default(1),
  held: z.object({ kind: z.enum(HELD), hand: z.enum(['L', 'R']) }).default({ kind: 'none', hand: 'R' }),
  refImage: z.string().optional(), interp: z.enum(['catmull', 'bezier', 'linear']).default('catmull'),
  keys: z.array(PathKeyS).default([]), poseKeys: z.array(PoseKeyS).default([]),
});

export const CamKeyS = z.object({
  id: IdS, t: z.number().min(0), pos: Vec3S, target: Vec3S, focal: z.number().min(8).max(600).default(35),
  focus: z.number().positive().default(5), fstop: z.number().positive().default(2.8), roll: z.number().default(0), ease: EasingS.default('easeInOut'),
});
export const SHAKES = ['none', 'handheld', 'runAndGun', 'earthquake'] as const;
export const CameraS = z.object({
  id: IdS, name: z.string(), keys: z.array(CamKeyS).min(1), sensorWidth: z.number().positive().default(36),
  /** Look-at override: when set, key targets are ignored and the camera aims at the character (+offset). */
  lookAt: z.object({ characterId: IdS, offset: Vec3S.default([0, 1.4, 0]) }).optional(),
  /** Attach: key positions become offsets from the character, sampled `lag` seconds in the past (follow-cam). */
  attach: z.object({ characterId: IdS, lag: z.number().min(0).default(0) }).optional(),
  shake: z.object({ profile: z.enum(SHAKES), amount: z.number().min(0).max(4).default(1), seed: z.number().int().default(1) }).default({ profile: 'none', amount: 1, seed: 1 }),
});

export const PROP_KINDS = ['box', 'sphere', 'cylinder', 'cone', 'plane', 'tree', 'rock', 'building', 'glb'] as const;
export const PropS = z.object({
  id: IdS, name: z.string(), kind: z.enum(PROP_KINDS), pos: Vec3S, rot: Vec3S.default([0, 0, 0]), scale: Vec3S.default([1, 1, 1]),
  idColor: ColorS, assetId: z.string().optional(),
  /** `building`: closed 2D floorplan (x,z) extruded to walls of `height` with wall thickness 0.2. */
  plan: z.object({ points: z.array(z.tuple([z.number(), z.number()])).min(2), height: z.number().positive().default(3), roof: z.boolean().default(false) }).optional(),
});
export const FX_KINDS = ['dust', 'smoke', 'sparks', 'rain', 'slash'] as const;
export const FxS = z.object({
  id: IdS, name: z.string(), kind: z.enum(FX_KINDS), pos: Vec3S.default([0, 0, 0]), size: Vec3S.default([1, 1, 1]),
  attachTo: IdS.optional(), start: z.number().min(0).default(0), end: z.number().min(0).default(9999), idColor: ColorS, trail: z.number().min(0).default(1.5),
});
export const ScatterS = z.object({ id: IdS, kind: z.enum(['grass', 'rock', 'tree']), seed: z.number().int(), center: Vec3S, radius: z.number().positive(), count: z.number().int().min(1).max(5000) });
export const TerrainS = z.object({ size: z.number().positive().default(240), res: z.number().int().min(2).max(257).default(49), heights: z.array(z.number()).default([]) });

const LightS = z.object({ on: z.boolean().default(true), azimuth: z.number().default(0), elevation: z.number().default(30), intensity: z.number().min(0).default(0.5), color: ColorS.default('#ffffff') });
export const LightingS = z.object({
  timeOfDay: z.number().min(0).max(24).default(17.6), latitude: z.number().min(-90).max(90).default(35), dayOfYear: z.number().int().min(1).max(366).default(172),
  north: z.number().default(0), skyColor: ColorS.default('#8ec5ff'), sunIntensity: z.number().min(0).default(1),
  key: LightS.default({}), fill: LightS.default({ on: false }), rim: LightS.default({ on: false }),
});

export const ASPECTS = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '2.39:1': 2.39, '4:3': 4 / 3 } as const;
export const AspectS = z.enum(['16:9', '9:16', '1:1', '2.39:1', '4:3']);
export const ShotS = z.object({
  id: IdS, name: z.string(), cameraId: IdS, start: z.number().min(0), end: z.number().positive(), notes: z.string().default(''),
  transition: z.object({ kind: z.enum(['cut', 'crossfade']), duration: z.number().min(0).default(0) }).default({ kind: 'cut', duration: 0 }),
  /** J/L cut: audio of this shot starts `audioLead` s before / ends `audioTail` s after the picture cut. */
  audioLead: z.number().default(0), audioTail: z.number().default(0),
  trimIn: z.number().min(0).default(0), trimOut: z.number().min(0).default(0),
  twoStage: z.boolean().default(false), keyframeApproved: z.string().optional(), selectedTakeId: IdS.optional(),
});

export const PromptVersionS = z.object({
  id: IdS, shotId: IdS, provider: z.string(), text: z.string(), parent: IdS.optional(), factsHash: z.string(),
  author: z.enum(['claude', 'user', 'local']), note: z.string().default(''), at: z.number().default(0),
});
export const CritiqueS = z.object({
  staging: z.number().min(0).max(10), character: z.number().min(0).max(10), style: z.number().min(0).max(10), artifacts: z.number().min(0).max(10),
  overall: z.number().min(0).max(10), summary: z.string(),
  issues: z.array(z.object({ kind: z.string(), severity: z.enum(['low', 'medium', 'high']), t: z.number().optional(), note: z.string() })).default([]),
  fixes: z.array(z.object({ kind: z.enum(['prompt', 'control', 'seed', 'restage', 'reference']), description: z.string(), promptEdit: z.string().optional(), controlPass: z.string().optional() })).default([]),
});
export const TakeS = z.object({
  id: IdS, shotId: IdS, providerId: z.string(), promptVersionId: IdS.optional(), prompt: z.string().default(''), seed: z.number().int(),
  status: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']), cost: z.number().default(0), passes: z.array(z.string()).default([]),
  passesHash: z.string().default(''), frames: z.array(z.string()).default([]), videoUrl: z.string().optional(), fps: z.number().default(24),
  width: z.number().default(0), height: z.number().default(0), circled: z.boolean().default(false), notes: z.string().default(''),
  iou: z.number().optional(), critique: CritiqueS.optional(), error: z.string().optional(), at: z.number().default(0), parentTakeId: IdS.optional(),
});

export const StyleBibleS = z.object({
  logline: z.string().default(''), medium: z.string().default(''), era: z.string().default(''), palette: z.array(z.string()).default([]),
  lensHabits: z.string().default(''), lighting: z.string().default(''), references: z.array(z.string()).default([]), negative: z.string().default(''),
});
export const CharacterBibleS = z.object({
  appearance: z.string().default(''), wardrobe: z.string().default(''), weapon: z.string().default(''), silhouette: z.string().default(''), refImages: z.array(z.string()).default([]),
});
export const MarkerS = z.object({ id: IdS, t: z.number().min(0), label: z.string().default(''), kind: z.enum(['marker', 'beat']).default('marker') });
export const AudioS = z.object({ id: IdS, name: z.string(), assetId: z.string(), offset: z.number().default(0), gain: z.number().default(1), peaks: z.array(z.number()).default([]), duration: z.number().default(0) });
export const MemoryS = z.object({ id: IdS, kind: z.enum(['preference', 'decision']), text: z.string(), at: z.number().default(0) });
/** Custom animation clip (mocap): per-frame local joint eulers. */
export const CustomClipS = z.object({ id: IdS, name: z.string(), fps: z.number().positive(), loop: z.boolean().default(false), frames: z.array(z.record(Vec3S)) });

const rec = <T extends z.ZodTypeAny>(s: T) => z.record(s).default({});
export const ProjectS = z.object({
  version: z.literal(1).default(1), id: IdS, name: z.string(), fps: z.number().int().min(1).max(120).default(24), duration: z.number().positive().default(10),
  aspect: AspectS.default('16:9'), seed: z.number().int().default(1), budgetCap: z.number().min(0).default(25),
  characters: rec(CharacterS), cameras: rec(CameraS), props: rec(PropS), fx: rec(FxS), scatter: rec(ScatterS), clips: rec(CustomClipS),
  takes: rec(TakeS), markers: rec(MarkerS), audio: rec(AudioS), memory: rec(MemoryS),
  shots: z.array(ShotS).default([]), terrain: TerrainS.default({}), lighting: LightingS.default({}),
  bibles: z.object({ style: StyleBibleS.default({}), characters: rec(CharacterBibleS) }).default({}),
  prompts: z.object({ versions: rec(PromptVersionS), active: z.record(z.record(IdS)).default({}) }).default({}),
});

export type Project = z.infer<typeof ProjectS>;
export type Character = z.infer<typeof CharacterS>;
export type PathKey = z.infer<typeof PathKeyS>;
export type PoseKey = z.infer<typeof PoseKeyS>;
export type Camera = z.infer<typeof CameraS>;
export type CamKey = z.infer<typeof CamKeyS>;
export type Prop = z.infer<typeof PropS>;
export type Fx = z.infer<typeof FxS>;
export type Scatter = z.infer<typeof ScatterS>;
export type Terrain = z.infer<typeof TerrainS>;
export type Lighting = z.infer<typeof LightingS>;
export type Shot = z.infer<typeof ShotS>;
export type Take = z.infer<typeof TakeS>;
export type Critique = z.infer<typeof CritiqueS>;
export type PromptVersion = z.infer<typeof PromptVersionS>;
export type StyleBible = z.infer<typeof StyleBibleS>;
export type CharacterBible = z.infer<typeof CharacterBibleS>;
export type Marker = z.infer<typeof MarkerS>;
export type AudioTrack = z.infer<typeof AudioS>;
export type MemoryItem = z.infer<typeof MemoryS>;
export type CustomClip = z.infer<typeof CustomClipS>;
export type Facing = z.infer<typeof FacingS>;
export type Aspect = z.infer<typeof AspectS>;

/** Colour-blind-safe ID palette (Okabe–Ito extended); distinct in luminance as well as hue. */
export const ID_PALETTE = ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#999999', '#882255', '#44aa99', '#ddcc77', '#332288', '#117733', '#88ccee', '#aa4499', '#661100'];
export function nextIdColor(p: Project): string {
  const used = new Set<string>([...Object.values(p.characters), ...Object.values(p.props), ...Object.values(p.fx)].map((e) => e.idColor.toLowerCase()));
  for (const c of ID_PALETTE) if (!used.has(c)) return c;
  let n = used.size * 2654435761 >>> 0; let c = '#' + (n & 0xffffff).toString(16).padStart(6, '0');
  while (used.has(c)) { n = (n * 1664525 + 1013904223) >>> 0; c = '#' + (n & 0xffffff).toString(16).padStart(6, '0'); }
  return c;
}
let idCounter = 0;
/** Unique-enough ids for UI-created entities. Demo/fixtures use fixed ids, so determinism is unaffected. */
export function newId(prefix: string): string {
  idCounter++;
  const r = typeof crypto !== 'undefined' && 'getRandomValues' in crypto ? Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(36)).join('') : Math.floor(Math.random() * 1e9).toString(36);
  return `${prefix}_${r}${idCounter.toString(36)}`;
}
export function emptyProject(id = 'project', name = 'Untitled'): Project {
  return ProjectS.parse({ id, name });
}

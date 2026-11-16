/** The op stream: every scene mutation is a typed, serializable Op applied through `applyOp`.
 *  Inverses are derived from immer patches and are themselves Ops (`patch`), so undo, collaboration,
 *  Claude proposals, scripting and the change log all share one mechanism. */
import { z } from 'zod';
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import {
  AudioS, CamKeyS, CameraS, CharacterBibleS, CharacterS, CustomClipS, FxS, IdS, LightingS, MarkerS, MemoryS, PathKeyS, PoseKeyS, ProjectS, PromptVersionS,
  PropS, ScatterS, ShotS, StyleBibleS, TakeS, TerrainS, Vec3S, AspectS, type Project,
} from './schema';

enablePatches();

const COLLS = { characters: CharacterS, cameras: CameraS, props: PropS, fx: FxS, scatter: ScatterS, clips: CustomClipS, takes: TakeS, markers: MarkerS, audio: AudioS, memory: MemoryS } as const;
type Coll = keyof typeof COLLS;
const KeyTargetS = z.object({ kind: z.enum(['character', 'camera']), id: IdS });
const PatchS = z.object({ op: z.enum(['replace', 'remove', 'add']), path: z.array(z.union([z.string(), z.number()])), value: z.unknown().optional() });

const o = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) => z.object({ type: z.literal(type), ...shape });
const baseOps = [
  o('addCharacter', { character: CharacterS }), o('updateCharacter', { id: IdS, patch: CharacterS.partial() }), o('removeCharacter', { id: IdS }),
  o('addCamera', { camera: CameraS }), o('updateCamera', { id: IdS, patch: CameraS.partial() }), o('removeCamera', { id: IdS }),
  o('addProp', { prop: PropS }), o('updateProp', { id: IdS, patch: PropS.partial() }), o('removeProp', { id: IdS }),
  o('addFx', { fx: FxS }), o('updateFx', { id: IdS, patch: FxS.partial() }), o('removeFx', { id: IdS }),
  o('addScatter', { scatter: ScatterS }), o('removeScatter', { id: IdS }),
  o('addClip', { clip: CustomClipS }), o('removeClip', { id: IdS }),
  o('addTake', { take: TakeS }), o('updateTake', { id: IdS, patch: TakeS.partial() }), o('removeTake', { id: IdS }),
  o('addMarker', { marker: MarkerS }), o('removeMarker', { id: IdS }),
  o('addAudio', { audio: AudioS }), o('updateAudio', { id: IdS, patch: AudioS.partial() }), o('removeAudio', { id: IdS }),
  o('addMemory', { memory: MemoryS }), o('removeMemory', { id: IdS }),
  // keyframes
  o('addPathKey', { characterId: IdS, key: PathKeyS }), o('setPathKey', { characterId: IdS, keyId: IdS, patch: PathKeyS.partial() }),
  o('addCameraKey', { cameraId: IdS, key: CamKeyS }), o('setCameraKey', { cameraId: IdS, keyId: IdS, patch: CamKeyS.partial() }),
  o('moveKeyframe', { target: KeyTargetS, keyId: IdS, t: z.number().min(0).optional(), pos: Vec3S.optional() }),
  o('removeKeyframe', { target: KeyTargetS, keyId: IdS }),
  o('addPoseKey', { characterId: IdS, key: PoseKeyS }), o('removePoseKey', { characterId: IdS, keyId: IdS }),
  o('setLens', { cameraId: IdS, focal: z.number().min(8).max(600), keyId: IdS.optional() }),
  /** Scale all keys in [start,end] so the segment ends at newEnd; later keys ripple by the delta. */
  o('retimeSegment', { start: z.number().min(0), end: z.number().positive(), newEnd: z.number().positive(), ripple: z.boolean().default(true) }),
  // shots
  o('addShot', { shot: ShotS, index: z.number().int().min(0).optional() }), o('updateShot', { id: IdS, patch: ShotS.partial() }), o('removeShot', { id: IdS }),
  o('reorderShots', { order: z.array(IdS) }),
  // world
  o('setLighting', { patch: LightingS.partial() }), o('setTerrain', { terrain: TerrainS }),
  o('sculptTerrain', { cells: z.array(z.tuple([z.number().int().min(0), z.number()])) }),
  o('setProject', { patch: z.object({ name: z.string(), fps: z.number().int().min(1).max(120), duration: z.number().positive(), aspect: AspectS, seed: z.number().int(), budgetCap: z.number().min(0) }).partial() }),
  // bibles + prompts
  o('setStyleBible', { patch: StyleBibleS.partial() }), o('setCharacterBible', { characterId: IdS, patch: CharacterBibleS.partial() }),
  o('addPromptVersion', { version: PromptVersionS, activate: z.boolean().default(true) }), o('setActivePrompt', { shotId: IdS, provider: z.string(), versionId: IdS }),
  // generic inverse
  o('patch', { patches: z.array(PatchS) }),
] as const;
type BaseOp = z.infer<(typeof baseOps)[number]>;
export type Op = BaseOp | { type: 'batch'; label: string; ops: Op[] };
const BaseOpS = z.discriminatedUnion('type', baseOps as unknown as [(typeof baseOps)[0], ...(typeof baseOps)[number][]]);
export const OpS: z.ZodType<Op, z.ZodTypeDef, unknown> = z.lazy(() => z.union([BaseOpS, z.object({ type: z.literal('batch'), label: z.string(), ops: z.array(OpS) })])) as z.ZodType<Op, z.ZodTypeDef, unknown>;
export const OP_TYPES = [...baseOps.map((b) => b.shape.type.value), 'batch'] as string[];

export class OpError extends Error { constructor(msg: string, readonly op?: Op) { super(msg); this.name = 'OpError'; } }
const need = <T>(v: T | undefined, what: string): T => { if (v === undefined) throw new OpError(`${what} not found`); return v; };
const sortKeys = (keys: { t: number }[]) => keys.sort((a, b) => a.t - b.t);
const collOf: Record<string, [Coll, string]> = {
  Character: ['characters', 'character'], Camera: ['cameras', 'camera'], Prop: ['props', 'prop'], Fx: ['fx', 'fx'], Scatter: ['scatter', 'scatter'], Clip: ['clips', 'clip'],
  Take: ['takes', 'take'], Marker: ['markers', 'marker'], Audio: ['audio', 'audio'], Memory: ['memory', 'memory'],
};

function mutate(p: Project, op: Op): void {
  const m = /^(add|update|remove)([A-Z]\w+)$/.exec(op.type);
  if (m && collOf[m[2]]) {
    const [coll, field] = collOf[m[2]]; const c = p[coll] as Record<string, unknown>; const a = op as unknown as Record<string, any>;
    if (m[1] === 'add') { const item = a[field]; if (c[item.id]) throw new OpError(`${field} ${item.id} already exists`, op); c[item.id] = item; }
    else if (m[1] === 'update') { Object.assign(need(c[a.id], `${field} ${a.id}`) as object, a.patch); }
    else {
      need(c[a.id], `${field} ${a.id}`); delete c[a.id];
      if (coll === 'cameras') { if (p.shots.some((s) => s.cameraId === a.id)) throw new OpError(`camera ${a.id} is used by a shot`, op); }
      if (coll === 'characters') {
        delete p.bibles.characters[a.id];
        for (const cam of Object.values(p.cameras)) { if (cam.lookAt?.characterId === a.id) delete cam.lookAt; if (cam.attach?.characterId === a.id) delete cam.attach; }
        for (const f of Object.values(p.fx)) if (f.attachTo === a.id) delete f.attachTo;
        for (const ch of Object.values(p.characters)) for (const k of ch.keys) if (k.facing.mode === 'target' && k.facing.targetId === a.id) k.facing = { mode: 'path' };
      }
    }
    return;
  }
  const keysOf = (t: { kind: 'character' | 'camera'; id: string }) => (t.kind === 'character' ? need(p.characters[t.id], `character ${t.id}`).keys : need(p.cameras[t.id], `camera ${t.id}`).keys) as { id: string; t: number; pos: [number, number, number] }[];
  switch (op.type) {
    case 'addPathKey': { const c = need(p.characters[op.characterId], 'character'); if (c.keys.some((k) => k.id === op.key.id)) throw new OpError('duplicate key id', op); c.keys.push(op.key); sortKeys(c.keys); break; }
    case 'setPathKey': { const c = need(p.characters[op.characterId], 'character'); Object.assign(need(c.keys.find((k) => k.id === op.keyId), 'key'), op.patch); sortKeys(c.keys); break; }
    case 'addCameraKey': { const c = need(p.cameras[op.cameraId], 'camera'); if (c.keys.some((k) => k.id === op.key.id)) throw new OpError('duplicate key id', op); c.keys.push(op.key); sortKeys(c.keys); break; }
    case 'setCameraKey': { const c = need(p.cameras[op.cameraId], 'camera'); Object.assign(need(c.keys.find((k) => k.id === op.keyId), 'key'), op.patch); sortKeys(c.keys); break; }
    case 'moveKeyframe': { const ks = keysOf(op.target); const k = need(ks.find((x) => x.id === op.keyId), 'key'); if (op.t !== undefined) k.t = op.t; if (op.pos) k.pos = op.pos; sortKeys(ks); break; }
    case 'removeKeyframe': { const ks = keysOf(op.target); const i = ks.findIndex((x) => x.id === op.keyId); if (i < 0) throw new OpError('key not found', op); if (op.target.kind === 'camera' && ks.length === 1) throw new OpError('a camera needs at least one key', op); ks.splice(i, 1); break; }
    case 'addPoseKey': { const c = need(p.characters[op.characterId], 'character'); c.poseKeys.push(op.key); sortKeys(c.poseKeys); break; }
    case 'removePoseKey': { const c = need(p.characters[op.characterId], 'character'); const i = c.poseKeys.findIndex((k) => k.id === op.keyId); if (i < 0) throw new OpError('pose key not found', op); c.poseKeys.splice(i, 1); break; }
    case 'setLens': { const c = need(p.cameras[op.cameraId], 'camera'); for (const k of c.keys) if (!op.keyId || k.id === op.keyId) k.focal = op.focal; break; }
    case 'retimeSegment': {
      if (op.end <= op.start || op.newEnd <= op.start) throw new OpError('invalid retime range', op);
      const f = (op.newEnd - op.start) / (op.end - op.start), d = op.newEnd - op.end;
      const map = (t: number) => (t < op.start ? t : t <= op.end ? op.start + (t - op.start) * f : op.ripple ? t + d : t);
      for (const c of Object.values(p.characters)) { for (const k of c.keys) k.t = map(k.t); for (const k of c.poseKeys) k.t = map(k.t); sortKeys(c.keys); sortKeys(c.poseKeys); }
      for (const c of Object.values(p.cameras)) { for (const k of c.keys) k.t = map(k.t); sortKeys(c.keys); }
      for (const f2 of Object.values(p.fx)) { f2.start = map(f2.start); if (f2.end < 9999) f2.end = map(f2.end); }
      for (const mk of Object.values(p.markers)) mk.t = map(mk.t);
      for (const s of p.shots) { s.start = map(s.start); s.end = map(s.end); }
      if (op.ripple) p.duration = Math.max(0.1, p.duration + d);
      break;
    }
    case 'addShot': { if (p.shots.some((s) => s.id === op.shot.id)) throw new OpError('shot exists', op); need(p.cameras[op.shot.cameraId], `camera ${op.shot.cameraId}`); if (op.shot.end <= op.shot.start) throw new OpError('shot end must be after start', op); p.shots.splice(op.index ?? p.shots.length, 0, op.shot); break; }
    case 'updateShot': { const s = need(p.shots.find((x) => x.id === op.id), `shot ${op.id}`); Object.assign(s, op.patch); need(p.cameras[s.cameraId], `camera ${s.cameraId}`); if (s.end <= s.start) throw new OpError('shot end must be after start', op); break; }
    case 'removeShot': { const i = p.shots.findIndex((x) => x.id === op.id); if (i < 0) throw new OpError('shot not found', op); p.shots.splice(i, 1); break; }
    case 'reorderShots': { if (op.order.length !== p.shots.length || new Set(op.order).size !== p.shots.length) throw new OpError('order must list every shot once', op); p.shots = op.order.map((id) => need(p.shots.find((s) => s.id === id), `shot ${id}`)); break; }
    case 'setLighting': Object.assign(p.lighting, op.patch); break;
    case 'setTerrain': p.terrain = op.terrain; break;
    case 'sculptTerrain': { const n = p.terrain.res * p.terrain.res; if (p.terrain.heights.length !== n) p.terrain.heights = new Array(n).fill(0); for (const [i, h] of op.cells) if (i < n) p.terrain.heights[i] = h; break; }
    case 'setProject': Object.assign(p, op.patch); break;
    case 'setStyleBible': Object.assign(p.bibles.style, op.patch); break;
    case 'setCharacterBible': { need(p.characters[op.characterId], 'character'); p.bibles.characters[op.characterId] = { ...CharacterBibleS.parse({}), ...p.bibles.characters[op.characterId], ...op.patch }; break; }
    case 'addPromptVersion': { const v = op.version; p.prompts.versions[v.id] = v; if (op.activate) (p.prompts.active[v.shotId] ??= {})[v.provider] = v.id; break; }
    case 'setActivePrompt': { need(p.prompts.versions[op.versionId], 'prompt version'); (p.prompts.active[op.shotId] ??= {})[op.provider] = op.versionId; break; }
    case 'patch': applyPatches(p, op.patches as Patch[]); break;
    case 'batch': for (const sub of op.ops) mutate(p, sub); break;
    default: throw new OpError(`unknown op ${(op as { type: string }).type}`, op);
  }
}

export interface Applied { project: Project; inverse: Op; changed: boolean }
/** Pure reducer. Throws OpError (leaving the input untouched) when the op is invalid. */
export function applyOp(project: Project, op: Op): Applied {
  const [next, , inverse] = produceWithPatches(project, (draft) => { mutate(draft as Project, op); });
  return { project: next, inverse: { type: 'patch', patches: inverse.map((x) => ({ op: x.op, path: x.path, value: x.value })) }, changed: inverse.length > 0 };
}
/** Validate untrusted input (Claude, MCP, collaborators, files) then apply. */
export function applyUntrusted(project: Project, raw: unknown): Applied {
  const parsed = OpS.safeParse(raw);
  if (!parsed.success) throw new OpError('invalid op: ' + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const res = applyOp(project, parsed.data);
  ProjectS.parse(res.project);
  return res;
}
export const batch = (label: string, ops: Op[]): Op => ({ type: 'batch', label, ops });

/** Human-readable one-liner for the change log / history panel. */
export function describeOp(op: Op, p?: Project): string {
  const nm = (id: string) => p?.characters[id]?.name ?? p?.cameras[id]?.name ?? p?.props[id]?.name ?? p?.fx[id]?.name ?? p?.shots.find((s) => s.id === id)?.name ?? id;
  switch (op.type) {
    case 'batch': return op.label || `${op.ops.length} edits`;
    case 'addCharacter': return `Add character ${op.character.name}`;
    case 'addCamera': return `Add camera ${op.camera.name}`;
    case 'addProp': return `Add ${op.prop.kind} ${op.prop.name}`;
    case 'addFx': return `Add ${op.fx.kind} effect`;
    case 'addShot': return `Add shot ${op.shot.name}`;
    case 'addPathKey': return `Add path key for ${nm(op.characterId)} at ${op.key.t.toFixed(2)}s`;
    case 'addCameraKey': return `Add camera key for ${nm(op.cameraId)} at ${op.key.t.toFixed(2)}s`;
    case 'moveKeyframe': return `Move ${nm(op.target.id)} keyframe${op.t !== undefined ? ` to ${op.t.toFixed(2)}s` : ''}`;
    case 'removeKeyframe': return `Remove ${nm(op.target.id)} keyframe`;
    case 'setLens': return `Set ${nm(op.cameraId)} lens to ${op.focal}mm`;
    case 'retimeSegment': return `Retime ${op.start.toFixed(2)}–${op.end.toFixed(2)}s to end at ${op.newEnd.toFixed(2)}s`;
    case 'setLighting': return 'Change lighting';
    case 'sculptTerrain': return 'Sculpt terrain';
    case 'setStyleBible': return 'Edit style bible';
    case 'setCharacterBible': return `Edit ${nm(op.characterId)} bible`;
    case 'addPromptVersion': return `New ${op.version.provider} prompt for ${nm(op.version.shotId)}`;
    case 'addTake': return `New take for ${nm(op.take.shotId)}`;
    case 'patch': return 'Revert';
    default: { const id = (op as { id?: string }).id; return op.type.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, (c) => c.toUpperCase()) + (id ? ` ${nm(id)}` : ''); }
  }
}

/** Linear undo/redo history built on the op stream. Immutable; safe to keep in a store. */
export interface HistoryEntry { label: string; author: string; op: Op; inverse: Op; at: number }
export interface History { past: HistoryEntry[]; future: HistoryEntry[] }
export const emptyHistory = (): History => ({ past: [], future: [] });
export function commit(project: Project, history: History, op: Op, meta: { author?: string; label?: string; at?: number } = {}): { project: Project; history: History; entry: HistoryEntry | null } {
  const res = applyOp(project, op);
  if (!res.changed) return { project, history, entry: null };
  const entry: HistoryEntry = { label: meta.label ?? describeOp(op, project), author: meta.author ?? 'user', op, inverse: res.inverse, at: meta.at ?? 0 };
  return { project: res.project, history: { past: [...history.past, entry].slice(-500), future: [] }, entry };
}
export function undo(project: Project, history: History): { project: Project; history: History; entry?: HistoryEntry } {
  const entry = history.past[history.past.length - 1]; if (!entry) return { project, history };
  return { project: applyOp(project, entry.inverse).project, history: { past: history.past.slice(0, -1), future: [entry, ...history.future] }, entry };
}
export function redo(project: Project, history: History): { project: Project; history: History; entry?: HistoryEntry } {
  const entry = history.future[0]; if (!entry) return { project, history };
  const res = applyOp(project, entry.op);
  return { project: res.project, history: { past: [...history.past, { ...entry, inverse: res.inverse }], future: history.future.slice(1) }, entry };
}

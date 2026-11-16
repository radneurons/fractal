// .lyricengine project files (SPEC §12.3): a zip with project.json, audio.*, lyrics.lrc, media/*, analysis.json.
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { Analysis, Layer, Lyrics, MaterialSettings, BlendMode, Post, ModRoute, Lane, GlobalSettings, PlanState, Instance, MediaItem } from '../types.ts';
import { DEFAULT_POST, DEFAULT_SETTINGS } from '../types.ts';
import { type AppState, defaultState, planInstance, DEFAULT_MAP } from './state.ts';

export const PROJECT_VERSION = 3;

export interface ProjectDoc {
  version: 3;
  name: string;
  created: number;
  modified: number;
  audioName: string;
  lyricsText: string;
  translationText: string;
  lyrics: Lyrics | null;
  state: AppState;
}
export interface ProjectBundle { doc: ProjectDoc; audio: Uint8Array | null; media: Record<string, Uint8Array>; analysis: Analysis | null; lrc: string }

/** Typed arrays → JSON-safe (base64) and back, so analysis.json round-trips exactly. */
export function packAnalysis(a: Analysis): string {
  return JSON.stringify(a, (_k, v) => {
    if (v instanceof Float32Array) {
      const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return { __f32: btoa(s) };
    }
    return typeof v === 'number' && Number.isNaN(v) ? { __nan: 1 } : v;
  });
}
export function unpackAnalysis(json: string): Analysis {
  return JSON.parse(json, (_k, v) => {
    if (v && typeof v === 'object' && typeof v.__f32 === 'string') {
      const bin = atob(v.__f32);
      const b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      return new Float32Array(b.buffer);
    }
    if (v && typeof v === 'object' && v.__nan === 1) return NaN;
    return v;
  });
}

export function packProject(b: ProjectBundle): Uint8Array {
  const files: Record<string, Uint8Array> = { 'project.json': strToU8(JSON.stringify(b.doc)) };
  if (b.audio) files[`audio.${(b.doc.audioName.split('.').pop() || 'bin').toLowerCase()}`] = b.audio;
  if (b.lrc) files['lyrics.lrc'] = strToU8(b.lrc);
  for (const [id, data] of Object.entries(b.media)) files[`media/${id}`] = data;
  if (b.analysis) files['analysis.json'] = strToU8(packAnalysis(b.analysis));
  // audio and media are already compressed: store them, deflate the text
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: /\.(json|lrc)$/.test(k) ? 6 : 0 }] as [Uint8Array, { level: 0 | 6 }]])));
}

export function unpackProject(zip: Uint8Array): ProjectBundle {
  const files = unzipSync(zip);
  const pj = files['project.json'];
  if (!pj) throw new Error('not a .lyricengine file (project.json missing)');
  const raw = JSON.parse(strFromU8(pj));
  const doc = migrateProject(raw);
  const audioKey = Object.keys(files).find((k) => /^audio\./.test(k));
  const media: Record<string, Uint8Array> = {};
  for (const k of Object.keys(files)) if (k.startsWith('media/')) media[k.slice(6)] = files[k];
  return { doc, audio: audioKey ? files[audioKey] : null, media, analysis: files['analysis.json'] ? unpackAnalysis(strFromU8(files['analysis.json'])) : null, lrc: files['lyrics.lrc'] ? strFromU8(files['lyrics.lrc']) : '' };
}

// ---------- migration ----------
interface V2Session {
  settings?: Partial<GlobalSettings>; effect?: string; mode?: 'single' | 'director'; transition?: string; directorMap?: Record<string, string>;
  params?: Record<string, Record<string, number | boolean | string>>;
  hybrid?: { material?: string; strength?: number; backdrop?: 'layout' | 'material'; tint?: string; overlay?: string; blend?: BlendMode; opacity?: number };
  lyricsText?: string; title?: string; artist?: string; name?: string; lyrics?: Lyrics;
}
const V2_MATERIALS: Record<string, MaterialSettings['kind']> = { chrome: 'chrome', 'liquid chrome': 'chrome', fire: 'fire', engraving: 'engraving', neon: 'neon', halftone: 'halftone', stardust: 'stardust' };

/** A v2 session becomes v3 state: hybrid.material → the plan layer's material; hybrid.overlay → a second layer. */
export function migrateV2(v2: V2Session): ProjectDoc {
  const state = defaultState();
  Object.assign(state.settings, v2.settings ?? {});
  if (v2.title) state.settings.title = v2.title;
  if (v2.artist) state.settings.artist = v2.artist;
  state.plan.effect = v2.effect ?? state.plan.effect;
  state.plan.mode = v2.mode ?? 'single';
  if (v2.transition) state.plan.transition = (v2.transition === 'ink wipe' ? 'wipe' : v2.transition) as PlanState['transition'];
  state.plan.map = { ...DEFAULT_MAP, ...(v2.directorMap ?? {}) } as PlanState['map'];
  for (const [effect, params] of Object.entries(v2.params ?? {})) state.instances[planInstance(effect)] = { effect, params: { ...params } };
  const hy = v2.hybrid;
  if (hy?.material && hy.material !== 'none' && V2_MATERIALS[hy.material]) {
    state.layers[0].material = { kind: V2_MATERIALS[hy.material], strength: hy.strength ?? 1, backdrop: hy.backdrop ?? 'layout', tint: hy.tint ?? '#ffffff' };
  }
  if (hy?.overlay && hy.overlay !== 'none') {
    const instanceId = `hybrid:${hy.overlay}`;
    state.layers.push({ id: 'hybrid-overlay', kind: 'effect', effect: hy.overlay, instanceId, enabled: true, blend: hy.blend ?? 'screen', opacity: hy.opacity ?? 0.6, mask: 'none' });
    state.instances[instanceId] = { effect: hy.overlay, params: { ...(v2.params?.[hy.overlay] ?? {}) } };
  }
  const now = Date.now();
  return { version: 3, name: v2.name ?? v2.title ?? 'Migrated session', created: now, modified: now, audioName: 'audio', lyricsText: v2.lyricsText ?? '', translationText: '', lyrics: v2.lyrics ?? null, state };
}

/** Accepts v3 documents (filling new fields) and v2 sessions. */
export function migrateProject(raw: unknown): ProjectDoc {
  const r = raw as Partial<ProjectDoc> & V2Session & { version?: number };
  if (!r || typeof r !== 'object') throw new Error('invalid project');
  if (r.version === undefined || r.version < 3 || !('state' in r)) return migrateV2(r);
  if (r.version > PROJECT_VERSION) throw new Error(`this project was saved by a newer version (${r.version})`);
  const d = r as ProjectDoc;
  const base = defaultState();
  const s = d.state ?? base;
  d.state = {
    ...base, ...s,
    settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}), fontOverrides: { ...(s.settings?.fontOverrides ?? {}) } },
    plan: { ...base.plan, ...(s.plan ?? {}), map: { ...DEFAULT_MAP, ...(s.plan?.map ?? {}) } as PlanState['map'] },
    post: { ...DEFAULT_POST, ...(s.post ?? {}) } as Post,
    layers: (s.layers?.length ? s.layers : base.layers) as Layer[],
    instances: (s.instances ?? {}) as Record<string, Instance>,
    routes: (s.routes ?? []) as ModRoute[], lanes: (s.lanes ?? []) as Lane[], media: (s.media ?? []) as MediaItem[],
  };
  d.translationText ??= '';
  return d;
}

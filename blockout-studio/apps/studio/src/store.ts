import { create } from 'zustand';
import { applyOp, batch, commit, demoProject, describeOp, emptyHistory, redo, undo, OpError, type History, type Op, type Project, type ShotDiff, type ContinuityIssue } from '@blockout/core';
import type { PassName } from '@blockout/render';

export type SelKind = 'character' | 'camera' | 'prop' | 'fx' | 'shot' | 'lighting' | 'project';
export interface Selection { kind: SelKind; id: string; keyId?: string }
export interface LogEntry { at: number; label: string; author: string }
export interface Proposal {
  id: string; title: string; rationale: string; ops: Op[]; source: 'claude' | 'mcp' | 'local' | 'user'; kind: string; status: 'pending' | 'applied' | 'rejected' | 'failed';
  question?: string; diffs?: ShotDiff[]; error?: string; at: number; meta?: Record<string, unknown>;
}
export interface ChatMsg { id: string; role: 'user' | 'claude' | 'system' | 'log'; text: string; at: number; proposalId?: string; issues?: ContinuityIssue[] }
export type Tool = 'translate' | 'rotate' | 'scale';
export type Mode = 'select' | 'path' | 'sculpt' | 'scatter';
export const OVERLAYS = ['thirds', 'golden', 'safe', 'axis', 'eyelines', 'onion', 'trails', 'frusta', 'paths'] as const;
export type Overlay = (typeof OVERLAYS)[number];

export interface Studio {
  project: Project; history: History; changeLog: LogEntry[]; savedAt: number;
  t: number; playing: boolean; playMode: 'scene' | 'cut'; loop: boolean; range: [number, number] | null;
  selection: Selection | null; activeShotId: string | null; focus: 'scene' | 'blockout'; tool: Tool; mode: Mode;
  overlays: Record<Overlay, boolean>; blockoutPass: PassName; theme: 'dark' | 'light'; snap: boolean; rightTab: string;
  proposals: Proposal[]; ghostId: string | null; ghost: Project | null; chat: ChatMsg[]; toast: { text: string; kind: 'info' | 'error' } | null;
  sculpt: { op: 'raise' | 'lower' | 'smooth' | 'flatten'; radius: number; strength: number }; scatterKind: 'grass' | 'rock' | 'tree';
  viewCam: { pos: [number, number, number]; target: [number, number, number]; fov: number } | null; resultOpacity: number; currentTakeId: string | null; compareTakeId: string | null;
  dispatch(op: Op, meta?: { label?: string; author?: string; coalesce?: string }): boolean;
  undo(): void; redo(): void; load(p: Project, log?: LogEntry[]): void;
  setTime(t: number): void; step(frames: number): void; togglePlay(mode?: 'scene' | 'cut'): void; tick(dt: number): void;
  select(s: Selection | null): void; setActiveShot(id: string | null, seek?: boolean): void; set(p: Partial<Studio>): void;
  addProposal(p: Omit<Proposal, 'id' | 'status' | 'at'> & { id?: string }): string; previewProposal(id: string | null): void; applyProposal(id: string, ops?: Op[]): boolean; rejectProposal(id: string): void;
  say(role: ChatMsg['role'], text: string, extra?: Partial<ChatMsg>): void; notify(text: string, kind?: 'info' | 'error'): void;
}
let lastCoalesce = { key: '', at: 0 };
let uid = 0; const nid = (p: string) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;
const snapT = (p: Project, t: number) => Math.round(Math.max(0, Math.min(p.duration, t)) * p.fps) / p.fps;
export const cutDuration = (p: Project) => p.shots.reduce((a, s) => a + (s.end - s.start), 0);
/** Map a position on the cut to (shot, scene time). */
export function cutToScene(p: Project, ct: number): { shotId: string; t: number } | null {
  let acc = 0; for (const s of p.shots) { const d = s.end - s.start; if (ct < acc + d) return { shotId: s.id, t: s.start + (ct - acc) }; acc += d; } return null;
}
export const sceneToCut = (p: Project, shotId: string, t: number) => { let acc = 0; for (const s of p.shots) { if (s.id === shotId) return acc + (t - s.start); acc += s.end - s.start; } return 0; };

export const useStudio = create<Studio>((set, get) => ({
  project: demoProject(), history: emptyHistory(), changeLog: [], savedAt: 0,
  t: 0, playing: false, playMode: 'scene', loop: true, range: null,
  selection: null, activeShotId: 's1', focus: 'scene', tool: 'translate', mode: 'select',
  overlays: { thirds: true, golden: false, safe: false, axis: true, eyelines: false, onion: false, trails: true, frusta: true, paths: true }, blockoutPass: 'clay', theme: 'dark', snap: true, rightTab: 'inspector',
  proposals: [], ghostId: null, ghost: null, chat: [], toast: null,
  sculpt: { op: 'raise', radius: 6, strength: 0.4 }, scatterKind: 'grass', viewCam: null, resultOpacity: 0, currentTakeId: null, compareTakeId: null,
  dispatch(op, meta = {}) {
    try {
      let { project, history } = get(); const now = Date.now();
      const merge = meta.coalesce && meta.coalesce === lastCoalesce.key && now - lastCoalesce.at < 1500 && history.past.length > 0;
      if (merge) { const u = undo(project, history); project = u.project; history = { past: u.history.past, future: [] }; }
      const res = commit(project, history, op, { author: meta.author, label: meta.label ?? describeOp(op, project), at: now });
      lastCoalesce = { key: meta.coalesce ?? '', at: now };
      if (!res.entry) { if (merge) set({ project: res.project, history: res.history }); return false; }
      const log = merge ? get().changeLog.slice(0, -1) : get().changeLog;
      set({ project: res.project, history: res.history, changeLog: [...log, { at: now, label: res.entry.label, author: res.entry.author }].slice(-2000) });
      return true;
    } catch (e) { get().notify(e instanceof OpError ? e.message : String(e), 'error'); return false; }
  },
  undo() { const s = get(), r = undo(s.project, s.history); if (r.entry) set({ project: r.project, history: r.history, changeLog: [...s.changeLog, { at: Date.now(), label: `Undo: ${r.entry.label}`, author: 'user' }] }); },
  redo() { const s = get(), r = redo(s.project, s.history); if (r.entry) set({ project: r.project, history: r.history, changeLog: [...s.changeLog, { at: Date.now(), label: `Redo: ${r.entry.label}`, author: 'user' }] }); },
  load(p, log = []) { set({ project: p, history: emptyHistory(), changeLog: log, t: 0, playing: false, selection: null, activeShotId: p.shots[0]?.id ?? null, proposals: [], ghost: null, ghostId: null, currentTakeId: null, compareTakeId: null }); },
  setTime(t) { const s = get(), p = s.project, tt = snapT(p, t), cur = p.shots.find((x) => x.id === s.activeShotId), inside = cur && tt >= cur.start && tt < cur.end; set({ t: tt, ...(inside ? {} : { activeShotId: p.shots.find((x) => tt >= x.start && tt < x.end)?.id ?? s.activeShotId }) }); },
  step(frames) { const s = get(); set({ t: snapT(s.project, s.t + frames / s.project.fps), playing: false }); },
  togglePlay(mode) {
    const s = get(); if (s.playing && (!mode || mode === s.playMode)) return set({ playing: false });
    const m = mode ?? s.playMode; let t = s.t, shot = s.activeShotId;
    if (m === 'cut') { const cur = s.project.shots.find((x) => x.id === shot) ?? s.project.shots[0]; if (cur) { shot = cur.id; if (t < cur.start || t >= cur.end - 1e-6) t = cur.start; } }
    else { const [a, b] = s.range ?? [0, s.project.duration]; if (t >= b - 1e-6 || t < a) t = a; }
    set({ playing: true, playMode: m, t, activeShotId: shot });
  },
  tick(dt) {
    const s = get(); if (!s.playing) return; const p = s.project; let t = s.t + dt;
    if (s.playMode === 'cut') {
      const i = p.shots.findIndex((x) => x.id === s.activeShotId), cur = p.shots[i]; if (!cur) return set({ playing: false });
      if (t >= cur.end) { const next = p.shots[i + 1] ?? (s.loop ? p.shots[0] : null); if (!next) return set({ playing: false, t: cur.end - 1 / p.fps }); return set({ activeShotId: next.id, t: next.start + (t - cur.end) }); }
      return set({ t });
    }
    const [a, b] = s.range ?? [0, p.duration];
    if (t >= b) { if (!s.loop) return set({ playing: false, t: b }); t = a + ((t - a) % Math.max(1e-3, b - a)); }
    const shot = p.shots.find((x) => t >= x.start && t < x.end && x.id === s.activeShotId) ?? p.shots.find((x) => t >= x.start && t < x.end);
    set({ t, activeShotId: shot?.id ?? s.activeShotId });
  },
  select(sel) { set({ selection: sel }); if (sel?.kind === 'shot') get().setActiveShot(sel.id, true); },
  setActiveShot(id, seek) { const s = get(), shot = s.project.shots.find((x) => x.id === id); set({ activeShotId: id, ...(seek && shot && (s.t < shot.start || s.t >= shot.end) ? { t: shot.start } : {}), currentTakeId: null }); },
  set(p) { set(p); },
  addProposal(p) { const id = p.id ?? nid('prop_'); set({ proposals: [...get().proposals.filter((x) => x.id !== id), { ...p, id, status: 'pending', at: Date.now() }] }); return id; },
  previewProposal(id) {
    const s = get(), pr = id ? s.proposals.find((x) => x.id === id) : null; if (!pr) return set({ ghost: null, ghostId: null });
    try { set({ ghost: applyOp(s.project, batch(pr.title, pr.ops)).project, ghostId: pr.id }); } catch (e) { get().notify(`Cannot preview: ${(e as Error).message}`, 'error'); }
  },
  applyProposal(id, ops) {
    const s = get(), pr = s.proposals.find((x) => x.id === id); if (!pr) return false;
    const label = `${pr.source === 'user' ? '' : 'Claude: '}${pr.title}`;
    const ok = (ops ?? pr.ops).length === 0 || s.dispatch(batch(label, ops ?? pr.ops), { author: pr.source === 'user' ? 'user' : 'claude', label });
    set({ proposals: get().proposals.map((x) => (x.id === id ? { ...x, status: ok ? 'applied' : 'failed', error: ok ? undefined : get().toast?.text } : x)), ghost: null, ghostId: null });
    return ok;
  },
  rejectProposal(id) { set({ proposals: get().proposals.map((x) => (x.id === id ? { ...x, status: 'rejected' } : x)), ...(get().ghostId === id ? { ghost: null, ghostId: null } : {}) }); },
  say(role, text, extra = {}) { set({ chat: [...get().chat, { id: nid('m'), role, text, at: Date.now(), ...extra }].slice(-400) }); },
  notify(text, kind = 'info') { set({ toast: { text, kind } }); setTimeout(() => { if (get().toast?.text === text) set({ toast: null }); }, 4500); },
}));
export const S = () => useStudio.getState();
export const activeShot = (s: Studio) => s.project.shots.find((x) => x.id === s.activeShotId) ?? null;
if (typeof window !== 'undefined') (window as unknown as { __studio: typeof useStudio }).__studio = useStudio;

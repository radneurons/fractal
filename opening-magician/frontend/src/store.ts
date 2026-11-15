import { create } from "zustand";
import { api } from "./api";

export type ViewId = "home" | "play" | "analysis" | "openings" | "training" | "puzzles" | "discovery" | "tournaments" | "books" | "prep" | "gambit"
  | "studies" | "engines" | "chessnut" | "broadcast" | "settings";

export type GraphicsQuality = "performance" | "balanced" | "cinematic" | "ultra";
export type Graphics = { quality: GraphicsQuality; shadows: boolean; antialias: boolean; bloom: boolean; ao: boolean; dof: boolean;
  reflections: boolean; resolution: number; animation: "off" | "reduced" | "full" };

export const QUALITY_PRESETS: Record<GraphicsQuality, Omit<Graphics, "quality">> = {
  performance: { shadows: false, antialias: false, bloom: false, ao: false, dof: false, reflections: false, resolution: 0.75, animation: "reduced" },
  balanced: { shadows: true, antialias: true, bloom: false, ao: false, dof: false, reflections: true, resolution: 1, animation: "full" },
  cinematic: { shadows: true, antialias: true, bloom: true, ao: false, dof: true, reflections: true, resolution: 1.25, animation: "full" },
  ultra: { shadows: true, antialias: true, bloom: true, ao: true, dof: true, reflections: true, resolution: 2, animation: "full" },
};

export type AnnotationPreset = { name: string; arrowColor: string; thickness: number; opacity: number; animate: boolean;
  highlight: number; labels: boolean; tactical: boolean; durationMs: number };

export type Prefs = {
  theme: "library" | "marble" | "observatory" | "arena" | "zen" | "cosmic";
  boardMode: "2d" | "3d";
  pieces2d: string; pieces3d: string;
  graphics: Graphics;
  focus: boolean;                 // focused professional mode: no cinematic chrome
  coordinates: boolean; legalDots: boolean; sound: boolean;
  annotation: AnnotationPreset; annotationPresets: AnnotationPreset[];
  introSeen: boolean;
};

export const DEFAULT_ANNOTATION: AnnotationPreset = { name: "Default", arrowColor: "#2fa37c", thickness: 1, opacity: 0.85, animate: true,
  highlight: 0.5, labels: true, tactical: true, durationMs: 0 };

const DEFAULT: Prefs = {
  theme: "library", boardMode: "2d", pieces2d: "staunton", pieces3d: "staunton",
  graphics: { quality: "balanced", ...QUALITY_PRESETS.balanced }, focus: false, coordinates: true, legalDots: true, sound: false,
  annotation: DEFAULT_ANNOTATION,
  annotationPresets: [DEFAULT_ANNOTATION, { ...DEFAULT_ANNOTATION, name: "Lecture", arrowColor: "#e0a23a", thickness: 1.4, labels: true },
    { ...DEFAULT_ANNOTATION, name: "Subtle", arrowColor: "#5aa7e0", thickness: 0.7, opacity: 0.55, animate: false, highlight: 0.3 }],
  introSeen: false,
};

export type Toast = { id: number; text: string; kind: "info" | "ok" | "err" };
export type Handoff = { fen?: string; moves?: string[]; startFen?: string; pgn?: string; title?: string; openingId?: string; bookId?: string;
  playbackMoves?: string[]; findingId?: string; tournamentId?: string; experimentId?: string; engine?: boolean };

type State = {
  view: ViewId; handoff: Handoff | null;
  prefs: Prefs; meta: any | null; engines: any[]; profiles: any[]; hw: any | null; bridge: boolean;
  toasts: Toast[];
  go: (v: ViewId, handoff?: Handoff | null) => void;
  takeHandoff: () => Handoff | null;
  setPrefs: (p: Partial<Prefs>) => void;
  setGraphics: (g: Partial<Graphics>) => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismiss: (id: number) => void;
  loadMeta: () => Promise<void>;
  loadEngines: () => Promise<void>;
  setHw: (hw: any) => void;
};

let toastId = 1;
const LS = "om.prefs";
function loadLocal(): Prefs {
  try { const p = JSON.parse(localStorage.getItem(LS) || "{}"); return { ...DEFAULT, ...p, graphics: { ...DEFAULT.graphics, ...(p.graphics || {}) }, annotation: { ...DEFAULT_ANNOTATION, ...(p.annotation || {}) } }; }
  catch { return DEFAULT; }
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<State>((set, get) => ({
  view: "home", handoff: null, prefs: loadLocal(), meta: null, engines: [], profiles: [], hw: null, bridge: false, toasts: [],
  go: (view, handoff = null) => set({ view, handoff }),
  takeHandoff: () => { const h = get().handoff; if (h) set({ handoff: null }); return h; },
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    set({ prefs });
    localStorage.setItem(LS, JSON.stringify(prefs));
    // UI preferences are also stored in the project database so backups and other devices get them.
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { api.put("/api/prefs", prefs).catch(() => undefined); }, 800);
  },
  setGraphics: (g) => get().setPrefs({ graphics: { ...get().prefs.graphics, ...g } }),
  toast: (text, kind = "info") => {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-4), { id, text, kind }] });
    setTimeout(() => get().dismiss(id), kind === "err" ? 9000 : 4500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  loadMeta: async () => {
    try {
      const meta = await api.get("/api/meta");
      set({ meta, bridge: true });
      const remote = await api.get("/api/prefs").catch(() => ({}));
      if (remote && Object.keys(remote).length && !localStorage.getItem(LS)) get().setPrefs(remote);
    } catch { set({ bridge: false }); }
  },
  loadEngines: async () => {
    try { const r = await api.get("/api/engines"); set({ engines: r.engines, profiles: r.profiles }); } catch { /* bridge offline */ }
  },
  setHw: (hw) => set({ hw }),
}));

/** Run an async action and surface failures as a toast instead of an unhandled rejection. */
export async function act<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
  try { const r = await fn(); if (ok) useStore.getState().toast(ok, "ok"); return r; }
  catch (e) { useStore.getState().toast((e as Error).message || "Something went wrong", "err"); return undefined; }
}

export const fmtScore = (s: any): string => (s ? s.text ?? "?" : "–");
export const fmtNum = (n: number | null | undefined): string => n == null ? "–" : n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
export const fmtMs = (ms: number | null | undefined): string => {
  if (ms == null) return "∞";
  const t = Math.max(0, ms); const s = Math.floor(t / 1000); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  if (t < 20000) return `${m}:${String(sec).padStart(2, "0")}.${Math.floor((t % 1000) / 100)}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
};
export const ago = (ts: number | null | undefined): string => {
  if (!ts) return "–"; const d = Date.now() / 1000 - ts;
  return d < 60 ? "just now" : d < 3600 ? `${Math.floor(d / 60)} min ago` : d < 86400 ? `${Math.floor(d / 3600)} h ago` : `${Math.floor(d / 86400)} d ago`;
};
export const title = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Automation hooks on window.LE (SPEC §17): used by the e2e scripts, the showcase reel and for scripting.
import type { App } from './app.ts';
import type { MaterialSettings, PlanSegment, TransitionKind, Layer, BlendMode } from './types.ts';
import { allEffects } from './effects/registry.ts';
import { uid } from './project/state.ts';
import { skeletonize } from './render/skeleton.ts';
import { exportVideo, type ExportOptions } from './export/exporter.ts';

export interface Hooks { [k: string]: unknown }

export function installHooks(app: App): Hooks {
  const LE: Hooks = {
    app,
    get ready() { return app.ready; },
    get state() { return app.state; },
    get stage() { return app.stage; },
    get player() { return app.player; },
    get song() { return app.song; },
    effects: () => allEffects().map((e) => ({ id: e.meta.id, name: e.meta.name, kind: e.meta.kind, params: e.meta.params })),
    loadDemo: (name?: string) => app.loadDemo(name),
    /** load audio from a URL (same origin) with optional lyrics text */
    loadUrl: async (url: string, lyricsText?: string, name?: string) => {
      const blob = await fetch(url).then((r) => { if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`); return r.blob(); });
      await app.loadAudio(blob, name ?? url.split('/').pop() ?? 'audio', lyricsText !== undefined ? { lyricsText } : {});
    },
    setEffect: (id: string) => app.setEffect(id),
    setParam: (target: string, key: string, value: number | boolean | string) => app.setParam(target, key, value),
    setSetting: (key: string, value: unknown) => app.setSetting(key as never, value as never),
    setMode: (mode: 'single' | 'director' | 'custom', transition?: TransitionKind) => app.setMode(mode, transition),
    setPlan: (plan: PlanSegment[], transition?: TransitionKind) => app.setPlan(plan, transition),
    /** v2 hybrid options, expressed as layers (§9.1 migration) */
    setHybrid: (h: { material?: Partial<MaterialSettings> | null; overlay?: { effect: string; blend?: BlendMode; opacity?: number } | null }) => {
      const layers: Layer[] = app.state.layers.filter((l) => l.kind === 'plan' || !l.id.startsWith('hybrid'));
      const plan = layers.find((l) => l.kind === 'plan')!;
      if (h.material !== undefined) plan.material = h.material && h.material.kind && h.material.kind !== 'none' ? { kind: h.material.kind, strength: h.material.strength ?? 1, backdrop: h.material.backdrop ?? 'layout', tint: h.material.tint ?? '#ffffff' } : undefined;
      if (h.overlay) layers.push({ id: 'hybrid-overlay', kind: 'effect', effect: h.overlay.effect, instanceId: `hybrid:${h.overlay.effect}`, enabled: true, blend: h.overlay.blend ?? 'screen', opacity: h.overlay.opacity ?? 0.6, mask: 'none' });
      app.setLayers(layers);
    },
    setLayers: (layers: Layer[]) => app.setLayers(layers.map((l) => ({ ...l, id: l.id ?? uid('layer') }))),
    addRoute: (r: Parameters<App['addRoute']>[0]) => app.addRoute(r),
    setLane: (l: Parameters<App['setLane']>[0]) => app.setLane(l),
    setPost: (p: Parameters<App['setPost']>[0]) => app.setPost(p),
    whenReady: () => app.whenReady(),
    renderAt: (t: number) => { app.exporting = true; app.stage.renderAt(t); },
    renderMaskAt: (t: number) => { app.exporting = true; app.stage.renderMaskAt(t); },
    resume: () => { app.exporting = false; },
    applyLyrics: (text: string) => app.applyLyrics(text),
    applyTranslation: (text: string) => app.applyTranslation(text),
    exportLrc: () => app.exportLrc(),
    /** Export a clip and return it as base64 (the e2e scripts write it to disk and probe it). */
    exportClip: async (o: Partial<ExportOptions> = {}) => {
      const r = await exportVideo(app, { format: 'mp4', res: 720, fps: 30, start: 0, end: 2, quality: 12, ...o });
      const buf = new Uint8Array(await r.blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { ...r, blob: undefined, base64: btoa(bin), bytes: buf.length };
    },
    skeleton: (text: string, font: string) => skeletonize(text, font).strokes.map((st) => ({ letter: st.letter, len: Math.round(st.len), n: st.cum.length, a: [Math.round(st.pts[0]), Math.round(st.pts[1])], b: [Math.round(st.pts[st.pts.length - 3]), Math.round(st.pts[st.pts.length - 2])] })),
    errors: [] as string[],
  };
  (window as unknown as { LE: Hooks }).LE = LE;
  window.addEventListener('error', (e) => (LE.errors as string[]).push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => (LE.errors as string[]).push(String(e.reason)));
  return LE;
}

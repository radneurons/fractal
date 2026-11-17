// Entry point: boots the app core, the UI, persistence and the automation hooks on window.LE.
import './style.css';
import './effects/index.ts';
import { App } from './app.ts';
import { installHooks } from './hooks.ts';
import { buildShell } from './ui/shell.ts';
import { lyricsDialog, exportDialog, projectTab, autoDirectDialog, flashBadge, drawHud, ensureGuard, type Services } from './ui/dialogs.ts';
import { toast, h } from './ui/dom.ts';
import { SnapshotHistory } from './project/history.ts';
import { type AppState, defaultState, uid } from './project/state.ts';
import { packProject, unpackProject, migrateProject, type ProjectDoc } from './project/zip.ts';
import { saveProject, loadProject, loadBlob, lastProjectId, requestPersistence, listProjects, type ProjectRecord } from './project/store.ts';
import { download } from './export/exporter.ts';
import { autoDirect } from './director/autodirector.ts';
import { sha256 } from './analysis/client.ts';
import type { Lyrics } from './types.ts';

const root = document.getElementById('app')!;
const canvas = document.createElement('canvas');
canvas.id = 'stage';
const app = new App(canvas);
// SDK hot reload (§15): an edited effects/user/*.ts re-registers itself; re-prepare just that effect
window.addEventListener("le:effect-reloaded", (e) => { void app.stage.reloadEffect((e as CustomEvent<string>).detail); });
const params = new URLSearchParams(location.search);

// ---------- persistence of settings (each access wrapped in try/catch) ----------
const LS = 'lyric-engine-pro:v3';
try {
  const saved = JSON.parse(localStorage.getItem(LS) ?? 'null') as Partial<AppState> | null;
  if (saved && !params.has('fresh') && !navigator.webdriver) {
    const s = migrateProject({ version: 3, state: { ...defaultState(), ...saved } }).state;
    s.settings.flashGuard = true; // turning the guard off is never persisted as the default
    s.settings.title = ''; s.settings.artist = '';
    s.layers = s.layers.filter((l) => l.kind !== 'media'); s.media = [];
    app.replaceState(s);
  } else if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) app.state.settings.reduceMotion = true;
} catch { /* storage unavailable */ }
const persistSettings = () => { try { localStorage.setItem(LS, JSON.stringify(app.state)); } catch { /* quota / private mode */ } };

// ---------- project + history ----------
let projectId = uid('proj');
let projectName = 'Untitled';
let created = Date.now();
type Snap = { state: AppState; lyrics: Lyrics | null; lyricsText: string; translationText: string };
const snapGet = (): Snap => ({ state: app.state, lyrics: app.song?.lyrics ?? null, lyricsText: app.lyricsText, translationText: app.translationText });
const snapSet = (s: Snap) => {
  app.lyricsText = s.lyricsText; app.translationText = s.translationText;
  app.replaceState(s.state);
  if (s.lyrics && app.song) app.commitLyrics(s.lyrics, true);
  api.refresh();
};
const history = new SnapshotHistory<Snap>(snapGet, snapSet);
let saveTimer = 0;
const doc = (): ProjectDoc => ({ version: 3, name: projectName, created, modified: Date.now(), audioName: app.song?.name ?? 'audio', lyricsText: app.lyricsText, translationText: app.translationText, lyrics: app.song?.lyrics ?? null, state: app.state });
async function thumbnail(): Promise<Blob | undefined> {
  const c = document.createElement('canvas'); c.width = 192; c.height = 108;
  c.getContext('2d')!.drawImage(app.stage.canvas as HTMLCanvasElement, 0, 0, 192, 108);
  return new Promise((res) => c.toBlob((b) => res(b ?? undefined), 'image/jpeg', 0.7));
}
let askedPersist = false;
const services: Services = {
  history: history as unknown as SnapshotHistory<unknown>,
  commit(label) { history.commit(label, label.startsWith('Change ') || label.includes('opacity') || label.includes('strength') ? label : undefined); persistSettings(); scheduleSave(); },
  async saveProject() {
    if (!app.song || !app.audioBlob) return;
    if (!askedPersist) { askedPersist = true; void requestPersistence(); }
    const rec: ProjectRecord = { id: projectId, doc: doc(), audioHash: app.audioHash, mediaHashes: {}, duration: app.song.analysis.duration, thumbnail: await thumbnail() };
    await saveProject(rec, app.audioBlob);
  },
  async openProject(id) {
    const rec = await loadProject(id);
    if (!rec) { toast('Project not found.', 'error'); return; }
    const audio = await loadBlob(rec.audioHash);
    if (!audio) { toast('The audio for this project is missing from storage.', 'error'); return; }
    await openDoc(migrateProject(rec.doc), audio, rec.id);
  },
  newProject() { projectId = uid('proj'); projectName = 'Untitled'; created = Date.now(); app.replaceState(defaultState()); history.reset(); api.refresh(); toast('New project. Load audio to begin.'); },
  async exportProjectFile() {
    if (!app.song || !app.audioBlob) { toast('Load a song first.', 'error'); return; }
    const zip = packProject({ doc: doc(), audio: new Uint8Array(await app.audioBlob.arrayBuffer()), media: {}, analysis: app.song.analysis, lrc: app.exportLrc() });
    download(new Blob([zip as BlobPart], { type: 'application/zip' }), `${projectName.replace(/\s+/g, '-') || 'project'}.lyricengine`);
  },
  async importProjectFile(f) {
    try {
      const b = unpackProject(new Uint8Array(await f.arrayBuffer()));
      if (!b.audio) throw new Error('the file has no audio');
      await openDoc(b.doc, new Blob([b.audio as BlobPart]), uid('proj'));
      toast(`Imported “${b.doc.name}”`, 'ok');
    } catch (e) { toast(`Import failed: ${(e as Error).message}`, 'error', 8000); }
  },
  refresh: () => api.refresh(),
  projectName: () => projectName,
  renameProject(n) { projectName = n || 'Untitled'; scheduleSave(); },
};
async function openDoc(d: ProjectDoc, audio: Blob, id: string): Promise<void> {
  projectId = id; projectName = d.name; created = d.created;
  app.replaceState(d.state);
  app.translationText = d.translationText ?? '';
  await app.loadAudio(audio, d.audioName, { lyricsText: d.lyricsText });
  // title/artist and the edited lyrics (moved words, locked roles) come from the project
  app.state.settings.title = d.state.settings.title; app.state.settings.artist = d.state.settings.artist;
  if (d.lyrics && d.lyrics.words.length) app.commitLyrics(d.lyrics, true);
  history.reset();
  api.refresh();
}
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { void services.saveProject().catch(() => { /* storage unavailable */ }); }, 1500);
}

// ---------- shell ----------
const api = buildShell(root, app, canvas, {
  onEdit: (label) => services.commit(label),
  exportDialog: () => exportDialog(app),
  lyricsDialog: () => lyricsDialog(app, services),
  projectTab: (host) => projectTab(app, host, services),
  autoDirect: () => autoDirectDialog(app, services),
  flashBadge: (host) => flashBadge(app, host),
  hud: (host) => drawHud(app, host),
});
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
  const t = e.target as HTMLElement;
  if (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text')) return;
  e.preventDefault();
  const label = e.shiftKey ? history.history.redo() : history.history.undo();
  if (label) toast(`${e.shiftKey ? 'Redo' : 'Undo'}: ${label}`);
});
app.on((what) => {
  if (what === 'song') { history.reset(); projectName = app.state.settings.title || app.song?.name || projectName; scheduleSave(); }
  if (what === 'lyrics' || what === 'param' || what === 'settings' || what === 'post') { persistSettings(); scheduleSave(); }
});

// ---------- adaptive preview (§11.6): step the preview scale down when over budget, back up when under ----------
let over = 0, under = 0, lastTick = performance.now();
app.on((what) => {
  if (what !== 'frame' || app.exporting) return;
  const now = performance.now(), dt = now - lastTick; lastTick = now;
  const st = app.stage;
  const budget = app.state.layers.filter((l) => l.enabled && l.kind !== 'plan').length ? 33 : 16;
  if (!app.player.playing) { over = under = 0; return; }
  if (st.frameMs > budget * 1.15) { over += dt; under = 0; } else if (st.frameMs < budget * 0.55) { under += dt; over = 0; } else { over = Math.max(0, over - dt); under = 0; }
  if (over > 1000 && st.previewScale > 0.5) { st.previewScale = st.previewScale > 0.75 ? 0.75 : 0.5; over = 0; app.schedulePrepare(0); }
  if (under > 3000 && st.previewScale < 1) { st.previewScale = st.previewScale < 0.75 ? 0.75 : 1; under = 0; app.schedulePrepare(0); }
});

// ---------- open recent ----------
void (async () => {
  if (navigator.webdriver) return;
  try {
    const recs = await listProjects();
    const host = document.getElementById('recent');
    if (host && recs.length) {
      const last = (await lastProjectId()) ?? recs[0].id;
      const r = recs.find((x) => x.id === last) ?? recs[0];
      host.append(h('button', { class: 'big', onClick: () => void services.openProject(r.id) }, `Open recent — ${r.doc.name}`));
    }
  } catch { /* no storage */ }
})();

// ---------- automation hooks ----------
const LE = installHooks(app);
Object.assign(LE, {
  undo: () => history.history.undo(), redo: () => history.history.redo(), commit: (label: string) => services.commit(label),
  autoDirect: (seed = 1776, apply = true) => {
    if (!app.song) throw new Error('load a song first');
    const plan = autoDirect(app.song.analysis, app.song.lyrics, seed, { hasTranslation: !!app.translationText });
    if (apply) { app.setPlan(plan.segments, 'auto'); if (plan.layers.length) app.setLayers([...app.state.layers.filter((l) => !l.id.startsWith('auto-')), ...plan.layers]); }
    return plan;
  },
  openProject: (id: string) => services.openProject(id),
  exportProject: async () => { const zip = packProject({ doc: doc(), audio: app.audioBlob ? new Uint8Array(await app.audioBlob.arrayBuffer()) : null, media: {}, analysis: app.song?.analysis ?? null, lrc: app.exportLrc() }); return Array.from(zip); },
  importProject: async (bytes: number[]) => { const b = unpackProject(new Uint8Array(bytes)); if (b.audio) await openDoc(b.doc, new Blob([b.audio as BlobPart]), uid('proj')); return b.doc; },
  /** runs the photosensitivity pre-pass and returns the report */
  flashReport: async (range?: { start: number; end: number; fps?: number }) => {
    if (range) { const { runGuard } = await import('./render/guardrun.ts'); app.exporting = true; const g = await runGuard(app.stage, { ...range, slice: 50 }).done; app.exporting = false; return g && { violations: g.report.violations.length, fixed: g.fixed, verified: g.verified, maxFlashesPerSecond: g.report.maxFlashesPerSecond }; }
    await ensureGuard(app);
    const g = app.stage.guard;
    return g && { violations: g.report.violations.length, fixed: g.fixed, verified: g.verified, maxFlashesPerSecond: g.report.maxFlashesPerSecond };
  },
  hash: (bytes: ArrayBuffer) => sha256(bytes),
});

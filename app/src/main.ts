// Lyric Engine — app shell.
import './style.css';
import type { Analysis, GlobalSettings, Lyrics, Params, Song, Word, ElementKind } from './types';
import { DEFAULT_SETTINGS } from './types';
import { decodeAudio, analyzeInWorker } from './analysis/index';
import { parseAny, buildLyrics, exportLRC, refreshLines } from './lyrics/parse';
import { direct, assignElements } from './director/director';
import { loadFonts } from './render/sdf';
import { Player } from './player';
import { Stage, directorPlan, sizeFor, type PlanSeg, type Transition } from './stage';
import { EFFECTS, effectById } from './effects/registry';
import { defaults } from './effects/types';
import { buildParams, GLOBAL_SPECS } from './ui/params';
import { Timeline, fmtT } from './ui/timeline';
import { tapSync } from './ui/tapsync';
import { exportVideo, recordRealtime, webCodecsAvailable, Cancelled } from './export/exporter';
import { sha256, getCachedAnalysis, putCachedAnalysis, saveSession, loadSession } from './persist';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ───────────────────────── state ─────────────────────────
const LS = 'lyric-engine:v1';
interface Saved { settings: GlobalSettings; params: Record<string, Params>; effect: string; mode: 'single' | 'director'; transition: Transition; byLabel: Record<string, string>; preview: number }
function loadSaved(): Partial<Saved> { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } }
const saved = loadSaved();

const state = {
  settings: { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}), title: '', artist: '' } as GlobalSettings,
  params: Object.fromEntries(EFFECTS.map(f => [f.id, { ...defaults(f.params), ...(saved.params?.[f.id] ?? {}) }])) as Record<string, Params>,
  effect: saved.effect && effectById(saved.effect) ? saved.effect : EFFECTS[0].id,
  mode: (saved.mode ?? 'single') as 'single' | 'director',
  transition: (saved.transition ?? 'flash') as Transition,
  byLabel: (saved.byLabel ?? {}) as Record<string, string>,
  preview: saved.preview ?? 0.6667,
  audio: null as AudioBuffer | null,
  audioName: '',
  audioBytes: null as ArrayBuffer | null,
  analysis: null as Analysis | null,
  lyricsText: '',
  lyrics: null as Lyrics | null,
  song: null as Song | null,
  dirty: true,
  lastT: -1,
  exporting: false
};
function persist() {
  try { localStorage.setItem(LS, JSON.stringify({ settings: { ...state.settings, title: '', artist: '' }, params: state.params, effect: state.effect, mode: state.mode, transition: state.transition, byLabel: state.byLabel, preview: state.preview })); } catch { /* storage unavailable */ }
}

const player = new Player();
const stage = new Stage($<HTMLCanvasElement>('stage'), EFFECTS);
stage.settings = state.settings; stage.params = state.params; stage.transition = state.transition;
const timeline = new Timeline($<HTMLCanvasElement>('overview'), $<HTMLCanvasElement>('timeline'), {
  seek: t => { player.seek(t); state.dirty = true; },
  now: () => player.now(),
  playing: () => player.playing,
  wordsEdited: () => { if (state.lyrics) { refreshLines(state.lyrics); rebuildSong(false); } },
  roleEdited: () => { if (state.lyrics && state.analysis) { direct(state.lyrics, state.analysis); rebuildSong(false); } },
  select: w => showWord(w),
  planEdited: (plan, cycle) => {
    const next = plan.map(p => ({ ...p }));
    if (cycle !== undefined) { const ids = EFFECTS.map(f => f.id); next[cycle].effect = ids[(ids.indexOf(next[cycle].effect) + 1) % ids.length]; }
    // merge neighbours that now share an effect
    const merged: PlanSeg[] = []; for (const p of next) { const l = merged[merged.length - 1]; if (l && l.effect === p.effect) l.end = p.end; else merged.push(p); }
    customPlan = merged; state.mode = 'director'; ($('selMode') as HTMLSelectElement).value = 'director'; replan(); schedulePrepare(0); state.dirty = true;
    toast('Director plan edited on the timeline (choosing a mode resets it).');
  }
});

// ───────────────────────── busy / toast ─────────────────────────
let busyCancel: (() => void) | null = null;
function busy(on: boolean, text = '', p = -1, cancel: (() => void) | null = null) {
  $('busy').classList.toggle('hidden', !on); $('busyText').textContent = text;
  $('busyBar').style.width = p < 0 ? '0' : `${Math.round(p * 100)}%`;
  busyCancel = cancel; ($('busyCancel') as HTMLButtonElement).hidden = !cancel;
}
$('busyCancel').onclick = () => busyCancel?.();
let toastT = 0;
function toast(msg: string, err = false, ms = 3500) {
  const el = $('toast'); el.textContent = msg; el.classList.toggle('err', err); el.classList.remove('hidden');
  clearTimeout(toastT); toastT = window.setTimeout(() => el.classList.add('hidden'), ms);
  if (err) console.error(msg);
}

// ───────────────────────── loading ─────────────────────────
async function loadAudioBytes(bytes: ArrayBuffer, name: string, restored?: Lyrics | null) {
  busy(true, 'Decoding audio…', 0);
  try {
    const keep = bytes.slice(0);
    const hash = await sha256(keep).catch(() => '');
    const buf = await decodeAudio(bytes, player.ctx);
    state.audio = buf; state.audioName = name; state.audioBytes = keep; player.setBuffer(buf);
    busy(true, 'Analysing…', 0);
    const t0 = performance.now();
    const cached = hash ? await getCachedAnalysis(hash) : null;
    state.analysis = cached ?? await analyzeInWorker(buf, (stage, p) => busy(true, `Analysing — ${stage}`, p));
    if (!cached && hash) void putCachedAnalysis(hash, state.analysis);
    console.info(`analysis ${cached ? '(cached) ' : ''}${((performance.now() - t0) / 1000).toFixed(2)} s`);
    player.beats = state.analysis.beats; player.downbeats = state.analysis.downbeats;
    if (!state.settings.title) state.settings.title = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    busy(false);
    if (restored) applyLyrics(state.lyricsText, restored);
    else if (state.lyricsText) applyLyrics(state.lyricsText); else { rebuildSong(true); openLyricsDialog(); }
  } catch (e) {
    busy(false); toast('Could not load audio: ' + (e as Error).message, true);
  }
}

function applyLyrics(text: string, ly?: Lyrics) {
  state.lyricsText = text;
  if (!state.analysis) { toast('Lyrics stored — now load the audio.'); return; }
  state.lyrics = ly ?? parseAny(text, state.analysis);
  const meta = text.match(/^\[ti:(.*)\]/m), ar = text.match(/^\[ar:(.*)\]/m);
  if (meta) state.settings.title = meta[1].trim(); if (ar) state.settings.artist = ar[1].trim();
  direct(state.lyrics, state.analysis);
  rebuildSong(true);
}

function rebuildSong(newSong: boolean) {
  if (!state.audio || !state.analysis) return;
  const lyrics = state.lyrics ?? { words: [], lines: [], source: 'plain' as const };
  state.song = { name: state.audioName, audio: state.audio, analysis: state.analysis, lyrics };
  stage.song = state.song; stage.songStamp++;
  timeline.song = state.song;
  $('empty').classList.toggle('hidden', true);
  replan();
  if (newSong) { buildGlobalPanel(); updateAnalysisInfo(); }
  updateAnalysisInfo();
  schedulePrepare(0);
  scheduleSave();
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if (!state.audioBytes) return;
    void saveSession({ audioName: state.audioName, audio: state.audioBytes, lyricsText: state.lyricsText, lyrics: state.lyrics, title: state.settings.title, artist: state.settings.artist, savedAt: Date.now() });
  }, 1500);
}

async function restoreSession() {
  const s = await loadSession(); if (!s) return;
  state.lyricsText = s.lyricsText; state.settings.title = s.title; state.settings.artist = s.artist;
  await loadAudioBytes(s.audio, s.audioName, s.lyrics);
}

async function loadDemo() {
  busy(true, 'Loading demo…', 0);
  try {
    const [wav, lrc] = await Promise.all([fetch('demo/demo-song.wav').then(r => r.arrayBuffer()), fetch('demo/demo-song.lrc').then(r => r.text())]);
    state.lyricsText = lrc; state.settings.title = 'Demo Song'; state.settings.artist = 'Lyric Engine';
    await loadAudioBytes(wav, 'demo-song.wav');
  } catch (e) { busy(false); toast('Demo failed: ' + (e as Error).message, true); }
}

async function loadFile(f: File) {
  if (/\.(lrc|srt|vtt|txt)$/i.test(f.name) || f.type.startsWith('text/')) { applyLyrics(await f.text()); toast(`Lyrics loaded: ${f.name}`); }
  else await loadAudioBytes(await f.arrayBuffer(), f.name);
}

// ───────────────────────── plan + prepare ─────────────────────────
let customPlan: PlanSeg[] | null = null;
function replan() {
  if (!state.song) return;
  if (customPlan) { stage.plan = customPlan; stage.transition = state.transition; timeline.plan = customPlan; return; }
  const dur = state.song.analysis.duration;
  const plan: PlanSeg[] = state.mode === 'director' ? directorPlan(state.song, state.byLabel, state.effect) : [{ start: 0, end: dur, effect: state.effect }];
  stage.plan = plan; stage.transition = state.transition;
  timeline.plan = plan; timeline.effectNames = Object.fromEntries(EFFECTS.map(f => [f.id, f.name]));
}

let prepTimer = 0, preparing = false, prepAgain = false;
function schedulePrepare(ms = 250) {
  clearTimeout(prepTimer);
  prepTimer = window.setTimeout(async () => {
    if (preparing) { prepAgain = true; return; }
    if (!state.song || state.exporting) return;
    preparing = true; $('songInfo').textContent = 'Preparing…';
    try {
      const [w, h] = sizeFor(state.settings.aspect, state.preview);
      if (stage.width !== w || stage.height !== h) stage.setSize(w, h);
      await stage.prepare(s => { $('songInfo').textContent = s; });
    } catch (e) { toast('Effect failed: ' + (e as Error).message, true, 8000); }
    preparing = false; state.dirty = true; updateSongInfo();
    (window as unknown as { LE: { ready: boolean } }).LE.ready = stage.isReady();
    if (prepAgain) { prepAgain = false; schedulePrepare(0); }
  }, ms);
}

// ───────────────────────── panels ─────────────────────────
function buildEffectList() {
  const root = $('effectList'); root.innerHTML = '';
  for (const f of EFFECTS) {
    const b = document.createElement('button'); b.className = 'fx' + (f.id === state.effect ? ' on' : ''); b.dataset.id = f.id;
    b.innerHTML = `<b></b><span></span>`; b.querySelector('b')!.textContent = f.name.toUpperCase(); b.querySelector('span')!.textContent = f.description.split(/[.—]/)[0];
    b.title = f.description;
    b.onclick = () => setEffect(f.id);
    root.appendChild(b);
  }
}
function setEffect(id: string) {
  if (!effectById(id)) return;
  state.effect = id; persist(); buildEffectList(); buildEffectPanel(); replan(); schedulePrepare(0); buildDirectorPlan();
}
function buildEffectPanel() {
  const f = effectById(state.effect)!;
  $('effectTitle').textContent = f.name + ' settings'; $('effectDesc').textContent = f.description;
  buildParams($('effectParams'), f.params, state.params[f.id], (k, v, live) => {
    state.params[f.id][k] = v; persist();
    if (live) { stage.setLiveParams(f.id, { [k]: v }); state.dirty = true; } else { stage.params = state.params; schedulePrepare(); }
  });
}
$('btnResetParams').onclick = () => { const f = effectById(state.effect)!; state.params[f.id] = defaults(f.params); stage.params = state.params; persist(); buildEffectPanel(); schedulePrepare(0); };

function buildGlobalPanel() {
  buildParams($('globalParams'), GLOBAL_SPECS, state.settings as unknown as Params, (k, v, live) => {
    (state.settings as unknown as Params)[k] = v; persist();
    if (k === 'syncOffsetMs') timeline.syncOffset = Number(v) / 1000;
    if (live) state.dirty = true; else schedulePrepare();
  });
}

const SECTION_LABELS = ['intro', 'verse', 'chorus', 'bridge', 'drop', 'breakdown', 'outro', 'speech'];
function buildDirectorPlan() {
  const root = $('directorPlan'); root.classList.toggle('hidden', state.mode !== 'director'); root.innerHTML = '';
  if (state.mode !== 'director') return;
  const present = state.song ? [...new Set(state.song.analysis.sections.map(s => s.label))] : SECTION_LABELS;
  for (const lab of present) {
    const row = document.createElement('label'); row.className = 'row';
    const span = document.createElement('span'); span.textContent = lab;
    const sel = document.createElement('select');
    for (const f of EFFECTS) { const o = document.createElement('option'); o.value = f.id; o.textContent = f.name; sel.appendChild(o); }
    sel.value = state.byLabel[lab] ?? state.effect;
    sel.onchange = () => { state.byLabel[lab] = sel.value; persist(); replan(); schedulePrepare(0); };
    row.append(span, sel); root.appendChild(row);
  }
}
($('selMode') as HTMLSelectElement).value = state.mode;
$('selMode').onchange = () => { customPlan = null; state.mode = ($('selMode') as HTMLSelectElement).value as 'single' | 'director'; if (state.mode === 'director') autoDirector(); persist(); buildDirectorPlan(); replan(); schedulePrepare(0); };
($('selTransition') as HTMLSelectElement).value = state.transition;
$('selTransition').onchange = () => { state.transition = ($('selTransition') as HTMLSelectElement).value as Transition; stage.transition = state.transition; persist(); state.dirty = true; };

/** Sensible default: verses calm, choruses loud, drops the loudest. */
function autoDirector() {
  const has = (id: string) => !!effectById(id);
  const pick = (...ids: string[]) => ids.find(has) ?? state.effect;
  const d: Record<string, string> = {
    intro: pick('mission', 'broadside', state.effect), verse: pick('broadside', state.effect), chorus: pick('elements', state.effect),
    drop: pick('swarm', 'elements'), breakdown: pick('droste', 'mission', state.effect), bridge: pick('press', 'mission', state.effect),
    outro: pick('mission', state.effect), speech: pick('broadside', state.effect)
  };
  for (const k of Object.keys(d)) if (!state.byLabel[k]) state.byLabel[k] = d[k];
}

function updateAnalysisInfo() {
  const a = state.analysis, ly = state.lyrics; if (!a) return;
  const secs = a.sections.map(s => `${s.label} ${fmtT(s.start, false)}`).join(' · ');
  $('analysisInfo').innerHTML = '';
  const add = (k: string, v: string) => { const d = document.createElement('div'); d.innerHTML = `<b></b> <span></span>`; d.querySelector('b')!.textContent = k; d.querySelector('span')!.textContent = v; $('analysisInfo').appendChild(d); };
  add('Tempo', `${a.bpm.toFixed(1)} BPM (confidence ${(a.bpmConfidence * 100).toFixed(0)}%) · ${a.meter}/4`);
  add('Beats', `${a.beats.length} beats, ${a.downbeats.length} bars, ${a.onsets.length} onsets`);
  add('Sections', secs || '—');
  add('Drops', a.drops.length ? a.drops.map(d => fmtT(d, false)).join(', ') : 'none');
  if (ly) add('Lyrics', `${ly.lines.length} lines, ${ly.words.length} words (${ly.source}) · heroes ${ly.words.filter(w => w.role === 'hero').length}`);
}
function updateSongInfo() {
  const s = state.song; if (!s) return;
  $('songInfo').textContent = `${state.audioName} · ${s.analysis.bpm.toFixed(0)} BPM · ${s.lyrics.words.length} words · ${stage.width}×${stage.height}`;
}

const ELEMENTS: ElementKind[] = ['none', 'light', 'fire', 'water', 'shock', 'wind', 'vortex', 'quake', 'ice', 'smoke'];
function showWord(w: Word | null) {
  const root = $('wordInspector'); root.innerHTML = '';
  if (!w || !state.lyrics) { root.textContent = 'Alt-click a word in the timeline.'; return; }
  const mk = (label: string, el: HTMLElement) => { const r = document.createElement('label'); r.className = 'row'; const s = document.createElement('span'); s.textContent = label; r.append(s, el); root.appendChild(r); };
  const txt = document.createElement('input'); txt.type = 'text'; txt.value = w.display;
  const st = document.createElement('input'); st.type = 'number'; st.step = '0.01'; st.value = w.start.toFixed(2);
  const en = document.createElement('input'); en.type = 'number'; en.step = '0.01'; en.value = w.end.toFixed(2);
  const role = document.createElement('select'); for (const r of ['hero', 'support', 'connective']) { const o = document.createElement('option'); o.value = o.textContent = r; role.appendChild(o); } role.value = w.role;
  const el = document.createElement('select'); for (const r of ELEMENTS) { const o = document.createElement('option'); o.value = o.textContent = r; el.appendChild(o); } el.value = w.element ?? 'none';
  mk('Text', txt); mk('Start', st); mk('End', en); mk('Role', role); mk('Element', el);
  const apply = () => {
    w.display = txt.value; w.start = Number(st.value); w.end = Math.max(w.start + 0.06, Number(en.value));
    if (role.value !== w.role) { w.role = role.value as Word['role']; w.roleLocked = true; }
    if (el.value !== (w.element ?? 'none')) { w.element = el.value as ElementKind; w.elementLocked = true; }
    refreshLines(state.lyrics!); direct(state.lyrics!, state.analysis); rebuildSong(false);
  };
  for (const i of [txt, st, en, role, el]) i.addEventListener('change', apply);
  const info = document.createElement('div'); info.className = 'small'; info.textContent = `stress ${w.stress.toFixed(2)} · ${w.syllables} syl · timing confidence ${(w.confidence * 100).toFixed(0)}%${w.concept ? ' · concept ' + w.concept : ''}`;
  root.appendChild(info);
}

// ───────────────────────── lyrics dialog ─────────────────────────
const dlgLyrics = $<HTMLDialogElement>('dlgLyrics');
function openLyricsDialog() { ($('txtLyrics') as HTMLTextAreaElement).value = state.lyricsText; dlgLyrics.showModal(); }
$('btnEditLyrics').onclick = openLyricsDialog;
dlgLyrics.addEventListener('close', async () => {
  const v = dlgLyrics.returnValue, txt = ($('txtLyrics') as HTMLTextAreaElement).value;
  if (v === 'apply') applyLyrics(txt);
  else if (v === 'lrc' && state.lyrics) void download(new Blob([exportLRC(state.lyrics)], { type: 'text/plain' }), (state.settings.title || 'lyrics') + '.lrc');
  else if (v === 'tap') {
    if (!state.audio) { toast('Load the audio first.', true); return; }
    const raw = await tapSync($<HTMLDialogElement>('dlgTap'), txt, player);
    if (raw) { const ly = buildLyrics(raw, state.analysis, 'tap'); const wordLevel = raw.some(r => r.words?.length); if (wordLevel) ly.words.forEach(w => { w.confidence = 1; }); applyLyrics(txt, ly); toast(wordLevel ? `Tap sync: ${ly.words.length} words timed.` : `Tap sync: ${ly.lines.length} lines timed; words placed by syllables and snapped to onsets.`); }
  }
});

// ───────────────────────── export ─────────────────────────
const dlgExport = $<HTMLDialogElement>('dlgExport');
$('btnExport').onclick = () => {
  if (!state.song) { toast('Load a song first.', true); return; }
  $('exNote').textContent = webCodecsAvailable() ? 'Frame-exact offline render (WebCodecs). Every frame is rendered — this can take longer than real time for heavy effects.' : 'WebCodecs is not available here: the video will be recorded in real time while the song plays.';
  dlgExport.showModal();
};
dlgExport.addEventListener('close', () => { if (dlgExport.returnValue === 'go') void runExport(); });

async function runExport(opts?: Partial<{ res: number; fps: number; start: number; len: number; mbps: number; format: 'mp4' | 'webm' }>, save = true) {
  if (!state.song) return null;
  const res = opts?.res ?? Number(($('exRes') as HTMLSelectElement).value);
  const fps = opts?.fps ?? Number(($('exFps') as HTMLSelectElement).value);
  const format = opts?.format ?? ($('exFmt') as HTMLSelectElement).value as 'mp4' | 'webm';
  const mbps = opts?.mbps ?? Number(($('exQ') as HTMLSelectElement).value);
  const dur = state.song.analysis.duration;
  const full = opts?.start === undefined && ($('exRange') as HTMLSelectElement).value === 'full';
  const start = full ? 0 : opts?.start ?? player.now();
  const end = full ? dur : Math.min(dur, start + (opts?.len ?? Number(($('exLen') as HTMLInputElement).value)));
  const [w, h] = sizeFor(state.settings.aspect, res / 1080);
  player.pause(); state.exporting = true;
  const cancel = { cancelled: false };
  busy(true, 'Preparing export…', 0, () => { cancel.cancelled = true; });
  try {
    stage.setSize(w, h); await stage.prepare();
    const eo = { width: w, height: h, fps, start, end, mbps, format };
    const prog = (p: number, m: string) => busy(true, m, p, () => { cancel.cancelled = true; });
    const r = webCodecsAvailable() ? await exportVideo(stage.canvas, t => stage.render(t), state.audio, eo, prog, cancel) : await recordRealtime(stage.canvas, t => stage.render(t), state.audio!, eo, prog, cancel);
    busy(false);
    const name = `${(state.settings.title || 'lyric-engine').replace(/[^\w-]+/g, '_')}_${state.effect}.${r.ext}`;
    if (save) void download(r.blob, name);
    toast(`Exported ${name} — ${(r.blob.size / 1e6).toFixed(1)} MB, ${r.videoCodec}${r.audioCodec ? ' + ' + r.audioCodec : ' (no audio encoder available)'} in ${r.seconds.toFixed(0)} s`, false, 8000);
    return r;
  } catch (e) {
    busy(false); if (!(e instanceof Cancelled)) toast('Export failed: ' + (e as Error).message, true, 8000); else toast('Export cancelled');
    return null;
  } finally {
    state.exporting = false;
    const [pw, ph] = sizeFor(state.settings.aspect, state.preview); stage.setSize(pw, ph); schedulePrepare(0);
  }
}

/** Save a file. Inside a claude.ai artifact the viewer's `downloads` capability confirms the save; elsewhere a normal download. */
type DownloadsNS = { save(r: { filename: string; data: Blob }): Promise<{ status: string }> };
const hostClaude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
const downloadsP: Promise<DownloadsNS | null> = hostClaude ? hostClaude.use('downloads').then(d => d as DownloadsNS | null).catch(() => null) : Promise.resolve(null);
async function download(b: Blob, name: string) {
  const dl = await downloadsP;
  if (dl) {
    // the host only accepts known extensions: lyrics go out as .txt (still LRC inside)
    const fname = /\.(mp4|webm|txt|json)$/i.test(name) ? name : name + '.txt';
    try { await dl.save({ filename: fname, data: b }); toast(`Saved ${fname}`); }
    catch (e) { const code = (e as { code?: string }).code; if (code !== 'declined') toast(code === 'rate_limited' ? 'Another save is waiting for your answer — try again in a moment.' : `Couldn't save the file (${code ?? 'unavailable'}).`, true); }
    return;
  }
  if (hostClaude) { toast('Saving files is not available in this view.', true); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// ───────────────────────── transport + input ─────────────────────────
$('btnPlay').onclick = () => { player.toggle(); };
$('btnBack').onclick = () => { player.seek(player.now() - 5); state.dirty = true; };
($('selPreview') as HTMLSelectElement).value = String(state.preview);
$('selPreview').onchange = () => { state.preview = Number(($('selPreview') as HTMLSelectElement).value); persist(); schedulePrepare(0); };
$('chkMetro').onchange = () => { player.metronome = ($('chkMetro') as HTMLInputElement).checked; if (player.playing) void player.play(player.now()); };
player.onEnded = () => { state.dirty = true; };
($('inAudio') as HTMLInputElement).onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void loadFile(f); };
($('inLyrics') as HTMLInputElement).onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void loadFile(f); };
$('btnDemo').onclick = () => void loadDemo();
$('btnDemo2').onclick = () => void loadDemo();

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (document.querySelector('dialog[open]') || (e.target as HTMLElement).matches('input, textarea, select')) return;
  const a = state.analysis;
  if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
  else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    e.preventDefault(); const dir = e.code === 'ArrowLeft' ? -1 : 1, t = player.now();
    if (e.shiftKey && a) { const bs = a.beats; const nb = dir > 0 ? bs.find(b => b > t + 0.02) : [...bs].reverse().find(b => b < t - 0.02); player.seek(nb ?? t); }
    else player.seek(t + dir * 5);
    state.dirty = true;
  }
  else if (e.key >= '1' && e.key <= '9') { const f = EFFECTS[Number(e.key) - 1]; if (f) setEffect(f.id); }
});
const wrap = $('stageWrap');
window.addEventListener('dragover', (e: DragEvent) => { e.preventDefault(); $('drop').classList.remove('hidden'); });
window.addEventListener('dragleave', (e: DragEvent) => { if (!e.relatedTarget) $('drop').classList.add('hidden'); });
window.addEventListener('drop', async (e: DragEvent) => {
  e.preventDefault(); $('drop').classList.add('hidden');
  const files = [...(e.dataTransfer?.files ?? [])].sort((a, b) => Number(/\.(lrc|srt|vtt|txt)$/i.test(b.name)) - Number(/\.(lrc|srt|vtt|txt)$/i.test(a.name)));
  for (const f of files) await loadFile(f);
});
void wrap;

// ───────────────────────── loop ─────────────────────────
function frame() {
  const t = player.now();
  if (state.song && !state.exporting && !preparing && stage.isReady() && (player.playing || state.dirty || t !== state.lastT)) {
    try { stage.render(t); } catch (e) { console.error(e); }
    state.dirty = false; state.lastT = t;
  }
  timeline.draw();
  $('clock').textContent = `${fmtT(t)} / ${fmtT(player.duration)}`;
  const a = state.analysis;
  if (a) { const bi = a.beats.findIndex(b => b > t) - 1; const lb = bi >= 0 ? a.beats[bi] : -9; $('beatLamp').style.background = t - lb < 0.1 ? (a.downbeats.some(d => Math.abs(d - lb) < 0.01) ? '#ffd23f' : '#ff5a1f') : '#333'; }
  $('btnPlay').textContent = player.playing ? '❚❚' : '▶';
  requestAnimationFrame(frame);
}

// ───────────────────────── test / automation hooks ─────────────────────────
const LE = {
  ready: false,
  state, stage, player,
  loadDemo,
  setEffect,
  setParam(k: string, v: number | boolean | string) { state.params[state.effect][k] = v; const live = effectById(state.effect)!.params.find(p => p.key === k)?.live; if (live) stage.setLiveParams(state.effect, { [k]: v }); else { stage.params = state.params; schedulePrepare(0); } },
  setSetting(k: string, v: number | boolean | string) { (state.settings as unknown as Params)[k] = v; schedulePrepare(0); },
  /** Custom plan (e.g. a showcase reel): segments of {start, end, effect}. */
  setPlan(plan: PlanSeg[], transition?: Transition) { state.mode = 'director'; if (transition) { state.transition = transition; } stage.transition = state.transition; stage.plan = plan; customPlan = plan; schedulePrepare(0); },
  setMode(m: 'single' | 'director') { state.mode = m; if (m === 'director') autoDirector(); replan(); schedulePrepare(0); },
  async whenReady() { for (let i = 0; i < 600 && (!LE.ready || preparing); i++) await new Promise(r => setTimeout(r, 100)); return LE.ready; },
  renderAt(t: number) { stage.render(t); },
  exportClip: (o: Parameters<typeof runExport>[0]) => runExport(o, false).then(r => r && { size: r.blob.size, codec: r.videoCodec, audio: r.audioCodec, frames: r.frames, url: URL.createObjectURL(r.blob) }),
  applyLyrics,
  assignElements: () => state.lyrics && assignElements(state.lyrics, state.analysis)
};
(window as unknown as { LE: typeof LE }).LE = LE;

// ───────────────────────── boot ─────────────────────────
(async () => {
  buildEffectList(); buildEffectPanel(); buildGlobalPanel(); buildDirectorPlan();
  const [w, h] = sizeFor(state.settings.aspect, state.preview); stage.setSize(w, h);
  try { await loadFonts(); } catch (e) { toast('Fonts failed to load: ' + (e as Error).message, true); }
  requestAnimationFrame(frame);
  if (new URLSearchParams(location.search).has('demo')) void loadDemo();
  else {
    const s = await loadSession();
    if (s && !state.song) {
      const b = document.createElement('button'); b.className = 'btn'; b.id = 'btnRestore';
      b.textContent = `Restore last session — ${s.audioName}`; b.style.marginLeft = '8px';
      b.onclick = () => void restoreSession();
      document.querySelector('.emptyBtns')?.appendChild(b);
    }
  }
})();

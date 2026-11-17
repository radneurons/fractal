// Dialogs and the Project tab: lyrics editor (tap sync, auto-sync, translation, voices), export
// (video, alpha, GIF, batch, sidecars), projects, Looks, history, storyboard, flash badge and the HUD.
import type { App } from '../app.ts';
import type { Aspect } from '../types.ts';
import { h, clear, toast, dialog, confirmBox, fmtTime } from './dom.ts';
import { tapSync } from './tapsync.ts';
import { autoSync, canReachModels, WHISPER_MODELS } from '../align/index.ts';
import { exportVideo, download, recordRealtime, pickVideoCodec } from '../export/exporter.ts';
import { exportGif } from '../export/gif.ts';
import { exportPngZip, alphaSupported, opaqueEffects } from '../export/alpha.ts';
import { BATCH_PRESETS, runBatch, type BatchItem } from '../export/batch.ts';
import { toSrt, toVtt, toAss, toChapters, toLrc } from '../export/captions.ts';
import { sizeFor, uid } from '../project/state.ts';
import type { SnapshotHistory } from '../project/history.ts';
import { BUILTIN_LOOKS, applyLook, captureLook, type Look } from '../project/presets.ts';
import { listProjects, deleteProject, storageInfo, type ProjectRecord } from '../project/store.ts';
import { autoDirect, type AutoPlan } from '../director/autodirector.ts';
import { effectMeta, allEffects } from '../effects/registry.ts';
import { runGuard, guardKey, type GuardRun } from '../render/guardrun.ts';
import { setLineVoice } from '../lyrics/voices.ts';
import { idbGet, idbSet, idbClear } from '../project/idb.ts';

export interface Services {
  history: SnapshotHistory<unknown>;
  commit(label: string): void;
  saveProject(): Promise<void>;
  openProject(id: string): Promise<void>;
  newProject(): void;
  exportProjectFile(): Promise<void>;
  importProjectFile(f: File): Promise<void>;
  refresh(): void;
  projectName(): string;
  renameProject(n: string): void;
}

// ---------- lyrics ----------
export function lyricsDialog(app: App, sv: Services): void {
  const ta = h('textarea', { class: 'lyrics-ta', spellcheck: false, placeholder: 'Paste lyrics: plain text, LRC (with <mm:ss.xx>word tags), SRT or VTT.\nVoices: v1: / v2: or [A] / [B] / [A+B].  Backing vocals: (ooh).  Sections: [Chorus]', value: app.lyricsText });
  const tr = h('textarea', { class: 'lyrics-ta small', spellcheck: false, placeholder: 'Optional translation (same number of lines, or a timed LRC/SRT).', value: app.translationText });
  const status = h('div', { class: 'dim small' });
  const lines = h('div', { class: 'line-list' });
  const drawLines = () => {
    clear(lines);
    const ly = app.song?.lyrics;
    if (!ly) return;
    for (const l of ly.lines) {
      const sel = h('select', { 'aria-label': 'Voice', onChange: () => { setLineVoice(ly, l.idx, sel.value || undefined); app.touchLyrics(); sv.commit('Set voice'); } }, ...[['', '—'], ['A', 'A'], ['B', 'B'], ['all', 'A+B']].map(([v, t]) => h('option', { value: v, selected: (l.voice ?? '') === v }, t)));
      lines.append(h('div', { class: `ll${l.repeatOf !== undefined ? ' rep' : ''}${l.hook ? ' hook' : ''}`, title: `${fmtTime(l.start)} – ${fmtTime(l.end)}${l.repeatOf !== undefined ? ` · repeats line ${l.repeatOf + 1}` : ''}${l.hook ? ' · hook' : ''}`, onClick: () => app.player.seek(Math.max(0, l.start - 0.3)) },
        h('span', { class: 'dim' }, fmtTime(l.start, false)), sel, h('span', {}, l.text), l.translation ? h('span', { class: 'dim' }, ` — ${l.translation}`) : null));
    }
  };
  const apply = () => { app.applyLyrics(ta.value); if (tr.value !== app.translationText) app.applyTranslation(tr.value); sv.commit('Edit lyrics'); drawLines(); status.textContent = `${app.song?.lyrics.words.length ?? 0} words in ${app.song?.lyrics.lines.length ?? 0} lines (${app.song?.lyrics.source}).`; };
  const modelSel = h('select', { 'aria-label': 'Whisper model' }, ...WHISPER_MODELS.map((m, i) => h('option', { value: m.id, selected: i === 2 }, m.label)));
  const lang = h('input', { type: 'text', placeholder: 'language (e.g. es) for multilingual models', size: 12 });
  const syncBtn = h('button', { onClick: async () => {
    const song = app.song;
    if (!song) return;
    if (ta.value !== app.lyricsText) apply();
    if (!song.lyrics.words.length) { toast('Add the lyrics first.', 'error'); return; }
    const ctrl = new AbortController();
    try {
      app.setBusy('Auto-sync: preparing…', 0);
      const ly = JSON.parse(JSON.stringify(song.lyrics));
      const r = await autoSync(song.audio, ly, song.analysis, modelSel.value, lang.value || undefined, (m, p) => app.setBusy(`Auto-sync: ${m}`, p), ctrl.signal);
      app.commitLyrics(ly, true); sv.commit('Auto-sync');
      const pct = Math.round(r.matchRate * 100);
      toast(`Auto-sync matched ${pct} % of the words${r.mode !== 'word' ? ' (phrase timing)' : ''}.${pct < 30 ? ' Try a bigger model, set the language, or use Tap sync.' : ' Dashed chips on the timeline are estimates.'}`, pct < 30 ? 'error' : 'ok', 8000);
      drawLines();
    } catch (e) { toast(`Auto-sync failed: ${(e as Error).message}`, 'error', 8000); }
    finally { app.setBusy(null); }
  } }, 'Auto-sync (Whisper)');
  void canReachModels().then((ok) => { if (!ok) { syncBtn.disabled = true; syncBtn.title = 'This page cannot reach huggingface.co to download the speech model. Run the app locally (npm run dev) to use Auto-sync.'; status.textContent = 'Auto-sync is unavailable here: the speech model host cannot be reached from this page.'; } });
  const d = dialog('Lyrics', h('div', { class: 'col' }, ta,
    h('div', { class: 'row wrap' }, h('button', { class: 'primary', onClick: apply }, 'Apply'),
      h('button', { onClick: () => { if (ta.value !== app.lyricsText) apply(); d.close(); tapSync(app, false, (c) => { if (c) sv.commit('Tap sync'); }); } }, 'Tap sync…'),
      h('button', { onClick: () => { if (ta.value !== app.lyricsText) apply(); d.close(); tapSync(app, true, (c) => { if (c) sv.commit('Tap sync (lines)'); }); } }, 'Tap lines only…'),
      syncBtn, modelSel, lang,
      h('button', { onClick: () => download(new Blob([app.exportLrc()], { type: 'text/plain' }), `${(app.state.settings.title || 'lyrics').replace(/\s+/g, '-')}.lrc`) }, 'Download LRC'),
      h('button', { onClick: () => { drawLines(); toast(`${app.song?.lyrics.lines.filter((l) => l.repeatOf !== undefined).length ?? 0} repeated lines; the hook is highlighted.`); } }, 'Find repeats')),
    status, h('details', {}, h('summary', {}, 'Translation'), tr), h('details', { open: true }, h('summary', {}, 'Lines · voices · timing (hover)'), lines)), { wide: true });
  drawLines();
}

// ---------- export ----------
export function exportDialog(app: App): void {
  const song = app.song;
  if (!song) { toast('Load a song first.', 'error'); return; }
  const a = song.analysis, s = app.state.settings;
  const sel = (label: string, opts: (string | number)[], def: string | number) => { const e = h('select', { 'aria-label': label }, ...opts.map((o) => h('option', { value: o, selected: String(o) === String(def) }, String(o)))); return e; };
  const kind = sel('Output', ['Video', 'Transparent video', 'GIF'], 'Video');
  const format = sel('Format', ['mp4', 'webm'], 'mp4');
  const res = sel('Resolution', [720, 1080, 1440, 2160], 1080);
  const fps = sel('Frame rate', [24, 25, 30, 50, 60], 30);
  const aspect = sel('Aspect', ['16:9', '9:16', '1:1', '4:5', '21:9'], s.aspect);
  const quality = sel('Quality (Mbps)', [6, 12, 20], 12);
  const rangeSel = sel('Range', ['Whole song', '30 s from playhead', '60 s from playhead', 'Current section'], 'Whole song');
  const norm = sel('Loudness', ['off', '-14 LUFS (streaming)', '-16 LUFS (podcast)'], 'off');
  const fadeIn = h('input', { type: 'number', value: 0, min: 0, step: 50, size: 5 }), fadeOut = h('input', { type: 'number', value: 0, min: 0, step: 50, size: 5 });
  const pre = h('input', { type: 'number', value: 0, min: 0, step: 0.5, size: 4 }), post = h('input', { type: 'number', value: 0, min: 0, step: 0.5, size: 4 });
  const side = { srt: false, vtt: false, lrc: false, ass: false, chapters: false, poster: false } as Record<string, boolean>;
  const sideBoxes = Object.keys(side).map((k) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', onChange: (e: Event) => { side[k] = (e.target as HTMLInputElement).checked; } }), k === 'poster' ? ' poster .png' : ` .${k === 'chapters' ? 'txt chapters' : k}`));
  const note = h('div', { class: 'dim small' });
  const prog = h('progress', { max: 1, value: 0, hidden: true });
  const stat = h('div', { class: 'small' });
  const range = (): [number, number] => {
    const t = app.player.time;
    if (rangeSel.value.startsWith('30')) return [t, Math.min(a.duration, t + 30)];
    if (rangeSel.value.startsWith('60')) return [t, Math.min(a.duration, t + 60)];
    if (rangeSel.value.startsWith('Current')) { const sec = a.sections.find((x) => t >= x.start && t < x.end) ?? a.sections[0]; return [sec.start, sec.end]; }
    return [0, a.duration];
  };
  const estimate = async () => {
    const { w, h: hh } = sizeFor(aspect.value as Aspect, Number(res.value));
    const [t0, t1] = range();
    const frames = Math.round((t1 - t0) * Number(fps.value));
    const mb = app.state.post.motionBlur > 0 ? app.state.post.motionBlurSamples : 1;
    const ms = Math.max(4, app.stage.frameMs) * ((w * hh) / (app.stage.w * app.stage.h)) * mb;
    const sizeMb = ((t1 - t0) * (Number(quality.value) + 0.2)) / 8;
    const v = await pickVideoCodec(format.value as 'mp4', w, hh, Number(fps.value), Number(quality.value) * 1e6, kind.value === 'Transparent video');
    const bad = kind.value === 'Transparent video' ? opaqueEffects(app) : [];
    note.textContent = `${w}×${hh}, ${frames} frames${mb > 1 ? ` × ${mb} motion-blur samples` : ''} — about ${Math.ceil((frames * ms) / 1000)} s to render, ~${sizeMb.toFixed(0)} MB.`
      + (kind.value === 'Video' ? (v ? ` Codec ${v.codec}.` : ' This size is not supported by the browser’s encoders; a real-time recording will be made instead.') : '')
      + (kind.value === 'Transparent video' ? ((await alphaSupported(w, hh, Number(fps.value))) ? ' VP9 with alpha in WebM.' : ' No alpha video encoder here: a PNG sequence (zip) will be exported.') : '')
      + (bad.length ? ` These effects cannot draw a transparent background and stay opaque: ${bad.join(', ')}.` : '');
  };
  for (const e of [kind, format, res, fps, aspect, quality, rangeSel]) e.addEventListener('change', () => void estimate());
  let ctrl: AbortController | null = null;
  const go = h('button', { class: 'primary', onClick: async () => {
    const [t0, t1] = range();
    ctrl = new AbortController();
    prog.hidden = false; go.disabled = true;
    const started = performance.now();
    const base = { start: t0, end: t1, quality: Number(quality.value), fadeInMs: Number(fadeIn.value), fadeOutMs: Number(fadeOut.value), preRoll: Number(pre.value), postRoll: Number(post.value),
      normalise: norm.value.startsWith('-14') ? -14 : norm.value.startsWith('-16') ? -16 : null, signal: ctrl.signal,
      motionBlur: app.state.post.motionBlur > 0 ? { samples: app.state.post.motionBlurSamples, shutter: app.state.post.motionBlur } : null };
    const onP = (p: { frame: number; frames: number; eta: number }) => { prog.value = p.frame / p.frames; stat.textContent = `Frame ${p.frame} / ${p.frames} · about ${Math.ceil(p.eta)} s left`; };
    try {
      if (app.state.settings.flashGuard) { stat.textContent = 'Checking flashes…'; await ensureGuard(app, (m, p) => { stat.textContent = `${m}…`; prog.value = p; }); }
      const prevAspect = s.aspect;
      if (kind.value === 'GIF') {
        s.aspect = aspect.value as Aspect;
        const r = await exportGif(app, { start: t0, end: Math.min(t1, t0 + 15), width: Math.min(720, Number(res.value)), dither: true, loop: true, signal: ctrl.signal, onProgress: (p) => { prog.value = p; } });
        s.aspect = prevAspect;
        download(r.blob, `${(s.title || 'lyric-video').replace(/\s+/g, '-')}.gif`);
        toast(`GIF saved: ${r.frames} frames, ${(r.blob.size / 1e6).toFixed(1)} MB`, 'ok');
      } else if (kind.value === 'Transparent video' && !(await alphaSupported(...Object.values(sizeFor(aspect.value as Aspect, Number(res.value))) as [number, number], Number(fps.value)))) {
        s.aspect = aspect.value as Aspect;
        const r = await exportPngZip(app, { res: Number(res.value), fps: Number(fps.value), start: t0, end: t1, signal: ctrl.signal, onProgress: (p) => { prog.value = p; } });
        s.aspect = prevAspect;
        download(r.blob, `${(s.title || 'lyric-video').replace(/\s+/g, '-')}-png-sequence.zip`);
        toast(`PNG sequence saved: ${r.frames} frames`, 'ok');
      } else {
        const alpha = kind.value === 'Transparent video';
        const { w, h: hh } = sizeFor(aspect.value as Aspect, Number(res.value));
        const fmt = alpha ? 'webm' : (format.value as 'mp4');
        if (!(await pickVideoCodec(fmt, w, hh, Number(fps.value), Number(quality.value) * 1e6, alpha))) {
          stat.textContent = 'Recording in real time (no WebCodecs encoder for this size)…';
          const blob = await recordRealtime(app, t0, t1, Number(fps.value), (p) => { prog.value = p; });
          download(blob, `${(s.title || 'lyric-video').replace(/\s+/g, '-')}.webm`);
        } else {
          const r = await exportVideo(app, { ...base, format: fmt, res: Number(res.value), fps: Number(fps.value), aspect: aspect.value as Aspect, alpha, onProgress: onP });
          await saveBlob(r.blob, r.fileName);
          toast(`Saved ${r.fileName}: ${(r.blob.size / 1e6).toFixed(1)} MB, ${r.videoCodec} + ${r.audioCodec}${r.lufs !== undefined && base.normalise !== null ? `, ${r.lufs.toFixed(1)} LUFS` : ''} in ${Math.round((performance.now() - started) / 1000)} s`, 'ok', 9000);
        }
      }
      // sidecars
      const baseName = (s.title || 'lyrics').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
      const off = t0 - Number(pre.value);
      const txt = (name: string, body: string) => download(new Blob([body], { type: 'text/plain' }), name);
      if (side.srt) txt(`${baseName}.srt`, toSrt(song.lyrics, off));
      if (side.vtt) txt(`${baseName}.vtt`, toVtt(song.lyrics, off));
      if (side.lrc) txt(`${baseName}.lrc`, toLrc(song.lyrics, { title: s.title, artist: s.artist }));
      if (side.ass) { const z = sizeFor(aspect.value as Aspect, Number(res.value)); txt(`${baseName}.ass`, toAss(song.lyrics, { title: s.title, width: z.w, height: z.h }, off)); }
      if (side.chapters) txt(`${baseName}-chapters.txt`, toChapters(a.sections));
      if (side.poster) { const ch = a.sections.filter((x) => x.label === 'chorus').sort((x, y) => y.energy - x.energy)[0] ?? a.sections[0]; app.stage.renderAt(ch.start + Math.min(6, (ch.end - ch.start) / 2)); (app.stage.canvas as HTMLCanvasElement).toBlob((b) => b && download(b, `${baseName}-poster.png`)); }
      d.close();
    } catch (e) {
      if ((e as Error).name === 'AbortError') toast('Export cancelled.'); else toast(`Export failed: ${(e as Error).message}`, 'error', 9000);
    } finally { prog.hidden = true; go.disabled = false; stat.textContent = ''; }
  } }, 'Export');
  // batch
  const batch: BatchItem[] = [];
  const batchList = h('div', { class: 'batch' });
  const drawBatch = () => { clear(batchList); for (const it of batch) batchList.append(h('div', { class: 'row small' }, h('span', {}, it.label), h('progress', { max: 1, value: it.progress }), h('span', { class: 'dim' }, it.status + (it.error ? `: ${it.error}` : '')),
    it.status === 'running' ? h('button', { class: 'icon-btn', onClick: () => it.abort?.abort() }, '✕') : it.status === 'done' && it.result ? h('button', { class: 'link', onClick: () => download(it.result!.blob, it.result!.fileName) }, 'save') : null)); };
  const batchRow = h('div', { class: 'row wrap' }, ...BATCH_PRESETS.map((p) => h('button', { class: 'chip', onClick: () => { batch.push({ ...p, id: uid('b'), status: 'queued', progress: 0 }); drawBatch(); } }, `+ ${p.label}`)),
    h('button', { onClick: async () => { const [t0, t1] = range(); await runBatch(app, batch, { start: t0, end: t1, quality: Number(quality.value), normalise: norm.value.startsWith('-14') ? -14 : norm.value.startsWith('-16') ? -16 : null }, drawBatch); for (const it of batch) if (it.status === 'done' && it.result) download(it.result.blob, it.result.fileName); toast('Batch finished.', 'ok'); } }, 'Run queue'));
  const L = (label: string, el: HTMLElement) => h('label', {}, label, el);
  const d = dialog('Export', h('div', { class: 'col' },
    h('div', { class: 'grid2' }, L('Output', kind), L('Format', format), L('Resolution', res), L('Frame rate', fps), L('Aspect', aspect), L('Quality (Mbps)', quality), L('Range', rangeSel), L('Loudness', norm),
      L('Fade in (ms)', fadeIn), L('Fade out (ms)', fadeOut), L('Pre-roll (s)', pre), L('Post-roll (s)', post)),
    h('div', { class: 'row wrap' }, h('span', { class: 'dim' }, 'Sidecars:'), ...sideBoxes),
    note, prog, stat,
    h('div', { class: 'row end' }, h('button', { onClick: () => ctrl?.abort() }, 'Cancel render'), go),
    h('details', {}, h('summary', {}, 'Batch export (several formats in one go)'), batchRow, batchList)), { wide: true, onClose: () => ctrl?.abort() });
  void estimate();
}

/** Streams to disk with showSaveFilePicker when available; otherwise a normal download. */
async function saveBlob(blob: Blob, name: string): Promise<void> {
  const w = window as Window & { showSaveFilePicker?: (o: { suggestedName: string }) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }> };
  if (w.showSaveFilePicker && !navigator.webdriver) {
    try { const hnd = await w.showSaveFilePicker({ suggestedName: name }); const wr = await hnd.createWritable(); await wr.write(blob); await wr.close(); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  download(blob, name);
}

// ---------- flash guard ----------
let guardJob: GuardRun | null = null;
/** Make sure the guard matches the current picture (runs the pre-pass if it is stale). */
export async function ensureGuard(app: App, onProgress?: (msg: string, p: number) => void): Promise<void> {
  const st = app.stage;
  if (!st.song || !app.state.settings.flashGuard) return;
  if (st.guard && st.guard.key === guardKey(st)) return;
  guardJob?.cancel();
  const was = app.exporting;
  app.exporting = true;
  guardJob = runGuard(st, { fps: 30, onProgress });
  try { await guardJob.done; } finally { app.exporting = was; guardJob = null; app.emit('guard'); }
}
export function flashBadge(app: App, host: HTMLElement): void {
  const draw = () => {
    clear(host);
    const g = app.stage.guard;
    if (!app.song) return;
    if (!app.state.settings.flashGuard) { host.append(h('span', { class: 'badge warn', title: 'The photosensitivity guard is off for this session.' }, 'Flash guard off')); return; }
    const fresh = g && g.key === guardKey(app.stage);
    if (!fresh) { host.append(h('button', { class: 'badge', title: 'Check the whole timeline for flashes (WCAG 2.3.1). Export runs this automatically.', onClick: async () => { host.firstChild!.textContent = 'Checking…'; await ensureGuard(app, (m, p) => { (host.firstChild as HTMLElement).textContent = `${m} ${Math.round(p * 100)} %`; }); draw(); } }, 'Check flashes')); return; }
    if (g.fixed.length === 0) host.append(h('span', { class: 'badge ok', title: 'No more than 3 flashes in any second.' }, 'Flash safe ✓'));
    else host.append(h('span', { class: `badge ${g.verified ? 'ok' : 'warn'}`, title: `Attenuated at ${g.fixed.map(([a, b]) => `${fmtTime(a, false)}–${fmtTime(b, false)}`).join(', ')}` }, g.verified ? `Flash safe ✓ (fixed ${g.fixed.length})` : `Flashes remain (${g.report.violations.length})`));
  };
  app.on((w) => { if (w === 'guard' || w === 'song' || w === 'settings' || w === 'plan' || w === 'layers' || w === 'state') draw(); });
  draw();
}

// ---------- HUD ----------
export function drawHud(app: App, host: HTMLElement): void {
  const st = app.stage;
  const rows = Object.entries(st.layerMs).map(([id, ms]) => { const l = app.state.layers.find((x) => x.id === id); return `${l ? (l.kind === 'plan' ? 'plan' : l.effect ?? l.kind) : id}: ${ms.toFixed(1)} ms`; });
  host.textContent = `frame ${st.frameMs.toFixed(1)} ms · ${st.w}×${st.h} · preview scale ${st.previewScale}\n${rows.join('\n')}\nprepare: ${Object.entries(st.prepareMs()).map(([k, v]) => `${k.replace('plan:', '')} ${v.toFixed(0)} ms`).join(', ')}`;
}

// ---------- Auto-Director storyboard ----------
export function autoDirectDialog(app: App, sv: Services): void {
  const song = app.song;
  if (!song) { toast('Load a song first.', 'error'); return; }
  let seed = app.state.settings.seed;
  let variety = app.state.settings.variety ?? 5;
  const plan0 = () => autoDirect(song.analysis, song.lyrics, seed, { variety, hasTranslation: !!app.translationText });
  let plan: AutoPlan = plan0();
  const strip = h('div', { class: 'storyboard' });
  const before = { plan: JSON.parse(JSON.stringify(app.state.plan)), layers: JSON.parse(JSON.stringify(app.state.layers)) };
  let applied = false;
  const preview = async () => {
    app.setPlan(plan.segments, 'auto');
    await app.whenReady();
    clear(strip);
    for (const seg of plan.segments) {
      // the segment's most energetic moment
      let bt = seg.start + 0.5, be = -1;
      for (let t = seg.start + 0.3; t < seg.end - 0.2; t += 0.5) { const e = song.analysis.loud[Math.floor(t * 60)] ?? 0; const hasWord = song.lyrics.words.some((w) => t >= w.start && t < w.end + 0.4); if (e + (hasWord ? 0.5 : 0) > be) { be = e + (hasWord ? 0.5 : 0); bt = t; } }
      app.exporting = true;
      app.stage.renderAt(bt);
      const c = h('canvas', { width: 160, height: Math.round((160 * app.stage.h) / app.stage.w) });
      c.getContext('2d')!.drawImage(app.stage.canvas as HTMLCanvasElement, 0, 0, c.width, c.height);
      app.exporting = false;
      const sec = song.analysis.sections.find((x) => bt >= x.start && bt < x.end);
      strip.append(h('figure', { title: `${fmtTime(seg.start, false)}–${fmtTime(seg.end, false)} · transition in: ${seg.transition}`, onClick: () => app.player.seek(bt) }, c,
        h('figcaption', {}, h('b', {}, effectMeta(seg.effect)?.name ?? seg.effect), h('span', { class: 'dim' }, ` ${sec?.label ?? ''} · ${seg.transition}`))));
    }
  };
  const d = dialog('Auto-Director', h('div', { class: 'col' }, h('p', { class: 'dim' }, 'A full plan from the analysis: effects by section character, repeated sections reuse their effect, drops get the highest-energy pick. Click a thumbnail to jump there.'),
    strip, h('div', { class: 'row end' },
      h('label', { class: 'row', title: 'How many different effects the plan may use. Choruses keep one effect either way.' }, 'Effects ',
        h('input', { type: 'range', min: 2, max: allEffects().length, step: 1, value: String(variety), 'aria-label': 'Number of different effects',
          onInput: (e: Event) => { const el = e.target as HTMLInputElement; variety = Number(el.value); (el.nextSibling as HTMLElement).textContent = `up to ${variety}`; plan = plan0(); void preview(); } }),
        h('span', { class: 'dim' }, `up to ${variety}`)),
      h('button', { onClick: () => { seed = (seed * 7919 + 13) % 9973 + 1; plan = plan0(); void preview(); } }, 'Shuffle'),
      h('button', { onClick: () => d.close() }, 'Cancel'),
      h('button', { class: 'primary', onClick: () => { applied = true; app.state.settings.variety = variety; if (plan.layers.length) app.setLayers([...app.state.layers.filter((l) => !l.id.startsWith('auto-')), ...plan.layers]); sv.commit('Auto-Director'); d.close(); sv.refresh(); } }, 'Apply'))),
  { wide: true, onClose: () => { if (!applied) { app.state.plan = before.plan; app.setLayers(before.layers); app.schedulePrepare(0); sv.refresh(); } } });
  void preview();
}

// ---------- project tab ----------
export function projectTab(app: App, host: HTMLElement, sv: Services): void {
  const name = h('input', { type: 'text', value: sv.projectName(), 'aria-label': 'Project name', onChange: () => sv.renameProject(name.value) });
  const fileIn = h('input', { type: 'file', accept: '.lyricengine,.zip', hidden: true, onChange: () => { const f = fileIn.files?.[0]; if (f) void sv.importProjectFile(f); } });
  const lookIn = h('input', { type: 'file', accept: '.json', hidden: true, onChange: async () => { const f = lookIn.files?.[0]; if (!f) return; try { const l = JSON.parse(await f.text()) as Look; if (l.kind !== 'lyric-engine-look') throw new Error('not a Look file'); app.replaceState(applyLook(app.state, l)); sv.commit(`Apply look ${l.name}`); toast(`Look “${l.name}” applied`, 'ok'); } catch (e) { toast(`Could not read the Look: ${(e as Error).message}`, 'error'); } } });
  const grid = h('div', { class: 'proj-grid' });
  const usage = h('p', { class: 'dim small' });
  const looks = h('div', { class: 'row wrap' });
  const hist = h('div', { class: 'history' });
  const drawLooks = async () => {
    clear(looks);
    const user = (await idbGet<Look[]>('misc', 'looks').catch(() => undefined)) ?? [];
    for (const l of [...BUILTIN_LOOKS, ...user]) looks.append(h('button', { class: 'chip', title: l.description ?? '', onClick: () => { app.replaceState(applyLook(app.state, l)); sv.commit(`Apply look ${l.name}`); sv.refresh(); toast(`Look “${l.name}” applied`, 'ok'); } }, l.name));
  };
  const drawHist = () => {
    clear(hist);
    sv.history.history.list().forEach((s, i) => hist.append(h('button', { class: `hist${s.done ? '' : ' undone'}`, onClick: () => { sv.history.history.goto(i); sv.refresh(); } }, s.label)));
    if (!hist.childNodes.length) hist.append(h('span', { class: 'dim small' }, 'No edits yet.'));
  };
  const drawProjects = async () => {
    clear(grid);
    let recs: ProjectRecord[] = [];
    try { recs = await listProjects(); } catch { grid.append(h('p', { class: 'dim small' }, 'Project storage is unavailable in this browser session.')); return; }
    for (const r of recs) {
      const img = h('img', { alt: '', width: 96, height: 54 });
      if (r.thumbnail) img.src = URL.createObjectURL(r.thumbnail);
      grid.append(h('div', { class: 'proj' }, img, h('div', {}, h('b', {}, r.doc.name), h('div', { class: 'dim small' }, `${fmtTime(r.duration, false)} · ${new Date(r.doc.modified).toLocaleString()}`),
        h('div', { class: 'row' }, h('button', { class: 'link', onClick: () => void sv.openProject(r.id) }, 'Open'),
          h('button', { class: 'link', onClick: async () => { const { saveProject } = await import('../project/store.ts'); const { loadBlob } = await import('../project/store.ts'); const audio = await loadBlob(r.audioHash); await saveProject({ ...r, id: uid('proj'), doc: { ...r.doc, name: `${r.doc.name} copy`, modified: Date.now() } }, audio ?? null); void drawProjects(); } }, 'Duplicate'),
          h('button', { class: 'link', onClick: async () => { if (await confirmBox(`Delete “${r.doc.name}”? This cannot be undone.`, 'Delete')) { await deleteProject(r.id); void drawProjects(); } } }, 'Delete')))));
    }
    if (!recs.length) grid.append(h('p', { class: 'dim small' }, 'No saved projects yet. Projects autosave 1.5 s after any change once a song is loaded.'));
    const si = await storageInfo();
    usage.textContent = si.quota ? `Storage: ${(si.usage / 1e6).toFixed(0)} MB of ${(si.quota / 1e6).toFixed(0)} MB${si.persisted ? ' (persistent)' : ''}` : '';
    if (si.quota && si.usage > si.quota * 0.85) usage.append(' — nearly full. ', h('button', { class: 'link', onClick: async () => { await idbClear('analysis'); toast('Cached analysis deleted.'); void drawProjects(); } }, 'Delete cached analysis'));
  };
  host.append(h('div', {},
    h('div', { class: 'row' }, h('label', {}, 'Name ', name), h('button', { onClick: () => void sv.saveProject().then(() => { toast('Project saved', 'ok'); void drawProjects(); }) }, 'Save'), h('button', { onClick: () => sv.newProject() }, 'New')),
    h('div', { class: 'row wrap' }, h('button', { onClick: () => void sv.exportProjectFile() }, 'Export .lyricengine'), h('button', { onClick: () => fileIn.click() }, 'Import…'), fileIn),
    h('h3', {}, 'Looks'), h('p', { class: 'dim small' }, 'A Look bundles effect settings, layers, materials, post and modulation. Applying keeps your lyrics and audio.'), looks,
    h('div', { class: 'row wrap' }, h('button', { onClick: async () => { const n = prompt('Name this Look', 'My look'); if (!n) return; const l = captureLook(app.state, n); const user = (await idbGet<Look[]>('misc', 'looks').catch(() => undefined)) ?? []; await idbSet('misc', 'looks', [...user.filter((x) => x.name !== n), l]); void drawLooks(); toast('Look saved', 'ok'); } }, 'Save current Look'),
      h('button', { onClick: () => download(new Blob([JSON.stringify(captureLook(app.state, sv.projectName()), null, 1)], { type: 'application/json' }), `${sv.projectName().replace(/\s+/g, '-')}.look.json`) }, 'Share as JSON'), h('button', { onClick: () => lookIn.click() }, 'Load Look…'), lookIn),
    h('h3', {}, 'Projects'), grid, usage,
    h('h3', {}, 'History', h('span', { class: 'dim small' }, '  Ctrl/Cmd+Z · Shift+Z')), hist));
  void drawProjects(); void drawLooks(); drawHist();
  sv.history.history.onChange = drawHist;
}

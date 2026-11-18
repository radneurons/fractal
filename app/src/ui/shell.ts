// The application shell (SPEC §11): top bar, stage, transport, timeline and the tabbed right panel.
import type { App } from '../app.ts';
import type { GlobalSettings, Layer, MaterialKind, ModRoute, ModSource, ParamSpec, Params, ParamValue, SectionLabel, TransitionKind, Word, BlendMode, LayerMask } from '../types.ts';
import { BLEND_MODES, MATERIALS, DEFAULT_POST } from '../types.ts';
import { h, clear, fmtTime, toast, dialog, confirmBox } from './dom.ts';
import { paramPanel } from './params.ts';
import { Timeline } from './timeline.ts';
import { allEffects, effectMeta, effectIds } from '../effects/registry.ts';
import { defaults, range, toggle, select, text } from '../effects/types.ts';
import { planInstance, uid, ensureInstance } from '../project/state.ts';
import { MOD_SOURCES, defaultRoutes } from '../compose/modulation.ts';
import { MATERIAL_LABELS, MATERIAL_TINTS } from '../render/material.ts';
import { BUILTIN_LUTS } from '../render/lut.ts';
import { keyName, chordName } from '../analysis/harmony.ts';
import { pulse } from '../analysis/dsp.ts';

const SETTINGS_SPECS: ParamSpec[] = [
  select('aspect', 'Aspect', 'Frame', '16:9', ['16:9', '9:16', '1:1', '4:5', '21:9'], false),
  range('syncOffsetMs', 'Sync offset (ms)', 'Timing', 0, -500, 500, 1, false, 'Shifts every word'),
  range('anticipationMs', 'Anticipation (ms)', 'Timing', 90, 0, 300, 1, false, 'Pulls entrances earlier'),
  range('minReadMs', 'Minimum read time (ms)', 'Timing', 600, 200, 2000, 10, false),
  range('intensity', 'Master intensity (%)', 'Masters', 100, 0, 200, 1),
  range('cameraEnergy', 'Camera energy (%)', 'Masters', 100, 0, 200, 1),
  range('reactivity', 'Beat reactivity (%)', 'Masters', 100, 0, 200, 1),
  select('caseMode', 'Letter case', 'Type', 'upper', ['upper', 'as-is', 'lower'], false),
  select('paletteSource', 'Palette', 'Type', 'effect', ['effect', 'key', 'artwork'], false, 'Key colour or the artwork palette can replace effect palettes'),
  range('seed', 'Seed', 'Type', 1776, 1, 9999, 1, false),
  text('title', 'Title', 'Title card', ''),
  text('artist', 'Artist', 'Title card', ''),
  toggle('voicePalette', 'Voice colours', 'Lyrics', true, false),
  select('showTranslation', 'Show translation', 'Lyrics', 'off', ['off', 'under', 'alternate'], false),
  toggle('reduceMotion', 'Reduce motion', 'Safety', false, false),
  toggle('flashGuard', 'Photosensitivity guard', 'Safety', true),
  toggle('transparentBackground', 'Transparent background', 'Frame', false, false),
];
const POST_SPECS: ParamSpec[] = [
  range('bloom', 'Bloom', 'Glow', 0, 0, 1), range('halation', 'Halation', 'Glow', 0, 0, 1),
  range('chroma', 'Chromatic aberration', 'Lens', 0, 0, 1), range('distortion', 'Distortion', 'Lens', 0, -1, 1), range('vignette', 'Vignette', 'Lens', 0, 0, 1),
  range('lift', 'Lift', 'Grade', 0, -0.2, 0.2, 0.005), range('gamma', 'Gamma', 'Grade', 1, 0.5, 2), range('gain', 'Gain', 'Grade', 1, 0.5, 1.6),
  range('saturation', 'Saturation', 'Grade', 1, 0, 2), range('temperature', 'Temperature', 'Grade', 0, -1, 1), range('tint', 'Tint', 'Grade', 0, -1, 1),
  select('lut', 'LUT', 'Grade', '', ['', ...BUILTIN_LUTS]), range('lutMix', 'LUT mix', 'Grade', 1, 0, 1),
  range('grain', 'Film grain', 'Film', 0, 0, 1), select('letterbox', 'Letterbox', 'Film', '0', ['0', '1.85', '2.39']),
  range('motionBlur', 'Motion blur shutter (°, export)', 'Film', 0, 0, 360, 1), select('motionBlurSamples', 'Motion blur samples', 'Film', '8', ['4', '8', '16']),
];

export interface ShellApi { timeline: Timeline; refresh(): void; setTab(t: string): void; openLyrics(): void; openExport(): void; commands: { label: string; run(): void }[] }
export interface ShellHooks {
  onEdit(label: string): void;
  exportDialog(): void;
  lyricsDialog(): void;
  projectTab(host: HTMLElement): void;
  autoDirect(): void;
  liveMode(): void;
  flashBadge(host: HTMLElement): void;
  hud(host: HTMLElement): void;
}

export function buildShell(root: HTMLElement, app: App, canvas: HTMLCanvasElement, hooks: ShellHooks): ShellApi {
  const st = () => app.state;
  const timeline = new Timeline(app);
  timeline.onEdit = (l) => hooks.onEdit(l);
  let tab = 'Effect';
  let selectedLayer = 'plan';

  // ---------- top bar ----------
  const audioIn = h('input', { type: 'file', accept: 'audio/*,video/mp4,.mp3,.wav,.m4a,.flac,.ogg', hidden: true, onChange: () => { const f = audioIn.files?.[0]; if (f) void loadAudio(f); audioIn.value = ''; } });
  const lyricsIn = h('input', { type: 'file', accept: '.lrc,.srt,.vtt,.txt,text/plain', hidden: true, onChange: async () => { const f = lyricsIn.files?.[0]; if (f) { app.applyLyrics(await f.text()); hooks.onEdit('Load lyrics'); toast(`Lyrics loaded: ${app.song?.lyrics.words.length ?? 0} words`, 'ok'); } lyricsIn.value = ''; } });
  const loadAudio = async (f: Blob & { name?: string }) => {
    try { await app.loadAudio(f, f.name ?? 'audio'); const n = app.song?.lyrics.words.length ?? 0; toast(n ? `Loaded with ${n} words of embedded lyrics — use Edit lyrics → Auto-sync or Tap sync to time them.` : 'Audio analysed. Add lyrics to begin.', 'ok', 6000); }
    catch (e) { toast(`Could not load audio: ${(e as Error).message}`, 'error'); }
  };
  const demoBtn = h('button', { onClick: () => void app.loadDemo('demo-song').catch((e) => toast(String(e), 'error')) }, 'Demo');
  const top = h('header', { class: 'topbar' },
    h('strong', { class: 'brand' }, 'Lyric Engine', h('span', {}, ' Pro')),
    h('button', { onClick: () => audioIn.click() }, 'Audio'), h('button', { onClick: () => lyricsIn.click() }, 'Lyrics'),
    h('button', { onClick: () => hooks.lyricsDialog() }, 'Edit lyrics'), demoBtn,
    h('button', { title: '3/4 duet with translation', onClick: () => void app.loadDemo('demo-waltz').catch((e) => toast(String(e), 'error')) }, 'Demo waltz'),
    h('span', { class: 'spacer' }),
    h('span', { id: 'flash-badge' }),
    h('button', { title: 'Command palette (Ctrl/Cmd+K)', onClick: () => openPalette() }, '⌘K'),
    h('button', { class: 'primary', onClick: () => hooks.exportDialog() }, 'Export video'), audioIn, lyricsIn);

  // ---------- stage ----------
  const empty = h('div', { class: 'empty' }, h('h1', {}, 'Make the words move with the music.'),
    h('p', {}, 'Drop a song (and its lyrics) here — or try the demo.'),
    h('div', { class: 'row center' }, h('button', { class: 'primary big', onClick: () => demoBtn.click() }, 'Play the demo song'), h('button', { class: 'big', onClick: () => audioIn.click() }, 'Open audio…')),
    h('div', { id: 'recent' }));
  const busy = h('div', { class: 'busy', hidden: true }, h('div', { class: 'busy-box' }, h('div', { class: 'busy-msg' }), h('progress', { max: 1, value: 0 })));
  const hud = h('div', { class: 'hud', hidden: true });
  const stageWrap = h('div', { class: 'stage-wrap' }, canvas, empty, busy, hud);
  for (const ev of ['dragenter', 'dragover']) stageWrap.addEventListener(ev, (e) => { e.preventDefault(); stageWrap.classList.add('drop'); });
  stageWrap.addEventListener('dragleave', () => stageWrap.classList.remove('drop'));
  stageWrap.addEventListener('drop', async (e) => {
    e.preventDefault(); stageWrap.classList.remove('drop');
    const files = Array.from((e as DragEvent).dataTransfer?.files ?? []);
    const audio = files.find((f) => /^audio\//.test(f.type) || /\.(mp3|wav|m4a|flac|ogg|aac)$/i.test(f.name));
    const lyr = files.find((f) => /\.(lrc|srt|vtt|txt)$/i.test(f.name));
    const img = files.find((f) => /^(image|video)\//.test(f.type) && f !== audio);
    if (audio) await loadAudio(audio);
    if (lyr) { app.applyLyrics(await lyr.text()); toast('Lyrics loaded', 'ok'); }
    if (img) { await addMedia(img); }
  });

  // ---------- transport ----------
  const playBtn = h('button', { class: 'play', 'aria-label': 'Play / pause (Space)', onClick: () => app.player.toggle() }, '▶');
  const clock = h('span', { class: 'clock' }, '0:00.00');
  const lamp = h('span', { class: 'lamp', title: 'Beat lamp' });
  const info = h('span', { class: 'dim info' });
  const resSel = h('select', { 'aria-label': 'Preview resolution', onChange: () => { st().previewRes = Number(resSel.value) as 720; app.schedulePrepare(0); } }, ...[540, 720, 1080].map((r) => h('option', { value: r, selected: st().previewRes === r }, `${r}p`)));
  const clickBox = h('input', { type: 'checkbox', onChange: () => { app.player.click = clickBox.checked; } });
  const transport = h('div', { class: 'transport' }, h('button', { 'aria-label': 'Back 5 seconds', onClick: () => app.player.seek(app.player.time - 5) }, '⟲5'), playBtn, clock, lamp, info,
    h('span', { class: 'spacer' }), h('label', { class: 'dim' }, clickBox, ' Click'), resSel);

  // ---------- right panel ----------
  const tabs = ['Effect', 'Layers', 'Modulate', 'Post', 'Project'];
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const tabBody = h('div', { class: 'tab-body' });
  const panel = h('aside', { class: 'panel' }, tabBar, tabBody);
  let tickers: (() => void)[] = [];

  const setParam = (instanceId: string, key: string, v: ParamValue, done: boolean) => { app.setParam(instanceId, key, v); if (done) hooks.onEdit(`Change ${key}`); };
  const liveOf = (instanceId: string, effect: string) => (key: string): number | null => {
    const has = st().routes.some((r) => r.enabled && r.target.instanceId === instanceId && r.target.key === key) || st().lanes.some((l) => l.target.instanceId === instanceId && l.target.key === key);
    if (!has) return null;
    const meta = effectMeta(effect);
    const base = { ...(meta ? defaults(meta.params) : {}), ...(st().instances[instanceId]?.params ?? {}) };
    const m = app.stage.mod.apply(instanceId, base, meta?.params ?? [], st().routes, st().lanes, app.player.time);
    return m && key in m ? Number(m[key]) : null;
  };
  const automate = (instanceId: string) => (key: string) => {
    if (!st().lanes.some((l) => l.target.instanceId === instanceId && l.target.key === key)) {
      const eff = st().instances[instanceId]?.effect ?? instanceId.replace(/^plan:/, '');
      const spec = effectMeta(eff)?.params.find((p) => p.key === key);
      const cur = Number(st().instances[instanceId]?.params[key] ?? spec?.default ?? 0);
      app.setLane({ target: { instanceId, key }, keys: [{ t: 0, v: cur, ease: 'linear' }], snap: 'beat' });
    }
    timeline.lanes.automation = true; timeline.resize();
    toast(`Automation lane added for “${key}” — click in the lane to add keys.`);
  };

  function effectTab(): HTMLElement {
    const cur = st().plan.effect;
    const grid = h('div', { class: 'fx-grid' }, ...allEffects().map((cls, i) => h('button', {
      class: `fx-card${cls.meta.id === cur && st().plan.mode === 'single' ? ' on' : ''}`, title: cls.meta.description,
      onClick: () => { app.setEffect(cls.meta.id); hooks.onEdit('Switch effect'); refresh(); },
    }, h('span', { class: 'fx-key' }, i < 9 ? String(i + 1) : i === 9 ? '0' : `⇧${i - 9}`), h('b', {}, cls.meta.name), h('small', {}, cls.meta.description))));
    const modeSel = h('select', { 'aria-label': 'Mode', onChange: () => { if (modeSel.value === 'auto') { hooks.autoDirect(); modeSel.value = st().plan.mode; return; } app.setMode(modeSel.value as 'single'); hooks.onEdit('Change mode'); refresh(); } },
      ...[['single', 'Single effect'], ['director', 'Director (per section)'], ['custom', 'Custom plan'], ['auto', 'Auto-Director…']].map(([v, l]) => h('option', { value: v, selected: st().plan.mode === v }, l)));
    const trSel = h('select', { 'aria-label': 'Transition', onChange: () => { st().plan.transition = trSel.value as TransitionKind; hooks.onEdit('Change transition'); } },
      ...['auto', 'cut', 'flash', 'wipe', 'dissolve', 'match', 'mask', 'zoom', 'glitch'].map((v) => h('option', { value: v, selected: st().plan.transition === v }, v)));
    const map = h('div', { class: 'director-map', hidden: st().plan.mode !== 'director' }, ...(Object.keys(st().plan.map) as SectionLabel[]).map((lab) => {
      const s = h('select', { 'aria-label': `Effect for ${lab}`, onChange: () => { st().plan.map[lab] = s.value; app.schedulePrepare(0); hooks.onEdit('Edit director map'); } }, ...effectIds().map((id) => h('option', { value: id, selected: st().plan.map[lab] === id }, effectMeta(id)?.name ?? id)));
      return h('label', {}, h('span', {}, lab), s);
    }));
    const settings = paramPanel({
      specs: SETTINGS_SPECS, values: () => st().settings as unknown as Params,
      onChange: (k, v, done) => {
        if (k === 'flashGuard' && v === false) { void confirmBox('Turn the photosensitivity guard off? Rapid flashes can trigger seizures in photosensitive viewers. The guard turns back on next session.', 'Turn off').then((ok) => { if (ok) app.setSetting('flashGuard', false); refresh(); }); return; }
        app.setSetting(k as keyof GlobalSettings, v as never); if (done) hooks.onEdit(`Change ${k}`);
      },
      liveValue: (k) => { const m = app.stage.mod.apply('global', st().settings as unknown as Params, SETTINGS_SPECS.filter((s) => s.group === 'Masters'), st().routes, st().lanes, app.player.time); return m && k in m ? Number(m[k]) : null; },
    });
    const meta = effectMeta(app.stage.effectAt(app.player.time) ?? cur) ?? effectMeta(cur);
    const out = h('div', {}, grid, h('div', { class: 'row' }, h('label', {}, 'Mode ', modeSel), h('label', {}, 'Transition ', trSel)), map);
    if (meta) {
      const inst = planInstance(meta.id);
      const pp = paramPanel({ specs: meta.params, values: () => ({ ...defaults(meta.params), ...(st().instances[inst]?.params ?? {}) }), onChange: (k, v, done) => setParam(inst, k, v, done), liveValue: liveOf(inst, meta.id), onAutomate: automate(inst), onLearn: (k) => midiLearn(inst, k) });
      tickers.push(pp.tick);
      out.append(h('h3', {}, `${meta.name} settings`, h('button', { class: 'link', onClick: () => { ensureInstance(st(), inst, meta.id).params = {}; app.schedulePrepare(0); hooks.onEdit('Reset effect'); refresh(); } }, 'Reset to defaults')),
        h('p', { class: 'dim small' }, meta.description, meta.supportsTransparent ? '' : ' · no transparent background', meta.supportsLive ? ' · live-capable' : ''), pp.el);
    }
    tickers.push(settings.tick);
    out.append(h('h3', {}, 'Global settings'), settings.el, inspector(), readout());
    return out;
  }

  function inspector(): HTMLElement {
    const w: Word | null = timeline.selected;
    if (!w) return h('div', { class: 'inspector' }, h('h3', {}, 'Word inspector'), h('p', { class: 'dim small' }, 'Alt-click a word on the timeline.'));
    const num = (label: string, key: 'start' | 'end') => { const i = h('input', { type: 'number', step: 0.01, value: w[key].toFixed(3), onChange: () => { w[key] = Number(i.value); w.confidence = 1; app.touchLyrics(); hooks.onEdit('Edit word time'); } }); return h('label', {}, label, i); };
    const role = h('select', { onChange: () => { w.role = role.value as Word['role']; w.roleLocked = true; app.touchLyrics(); hooks.onEdit('Change role'); } }, ...['hero', 'support', 'connective'].map((r) => h('option', { value: r, selected: w.role === r }, r)));
    const el = h('select', { onChange: () => { w.element = el.value as Word['element']; w.elementLocked = true; app.touchLyrics(false); hooks.onEdit('Change element'); } }, ...['none', 'light', 'fire', 'water', 'shock', 'wind', 'vortex', 'quake', 'ice', 'smoke'].map((r) => h('option', { value: r, selected: (w.element ?? 'none') === r }, r)));
    return h('div', { class: 'inspector' }, h('h3', {}, 'Word inspector'), h('div', { class: 'word-big' }, w.display),
      h('div', { class: 'row wrap' }, num('Start', 'start'), num('End', 'end'), h('label', {}, 'Role', role), h('label', {}, 'Element', el)),
      h('p', { class: 'dim small' }, `stress ${w.stress.toFixed(2)} · ${w.syllables} syllable${w.syllables > 1 ? 's' : ''} · confidence ${w.confidence.toFixed(2)}${w.concept ? ` · concept ${w.concept}` : ''}${w.pitch ? ` · pitch ${w.pitch.toFixed(1)}` : ''}${w.voice ? ` · voice ${w.voice}` : ''}${w.melisma ? ' · melisma' : ''}${w.vibrato ? ' · vibrato' : ''}`));
  }

  function readout(): HTMLElement {
    const a = app.song?.analysis, ly = app.song?.lyrics;
    if (!a || !ly) return h('div', {});
    return h('details', { class: 'readout' }, h('summary', {}, 'Analysis'),
      h('p', { class: 'small' }, `${a.bpm.toFixed(1)} BPM (confidence ${a.bpmConfidence.toFixed(2)}) · ${a.meter === 6 ? '6/8' : `${a.meter}/4`} · ${a.beats.length} beats · ${a.downbeats.length} bars · ${a.onsets.length} onsets`),
      h('p', { class: 'small' }, `Key ${keyName(a.key)}${a.keyChanges.length ? ' → ' + a.keyChanges.map((k) => `${keyName(k)} @ ${fmtTime(k.t, false)}`).join(', ') : ''} · ${a.lufs.toFixed(1)} LUFS${a.isSpeech ? ' · speech' : ''}`),
      h('p', { class: 'small' }, `Chords: ${a.chords.slice(0, 16).map(chordName).join(' ')}${a.chords.length > 16 ? ' …' : ''}`),
      h('p', { class: 'small' }, `Sections: ${a.sections.map((s) => `${fmtTime(s.start, false)} ${s.label}`).join(' · ')}`),
      h('p', { class: 'small' }, `Drops: ${a.drops.map((d) => fmtTime(d, false)).join(', ') || 'none'}`),
      h('p', { class: 'small' }, `Lyrics: ${ly.words.length} words, ${ly.lines.length} lines, ${ly.words.filter((w) => w.role === 'hero').length} heroes, source ${ly.source}`));
  }

  // ---------- layers ----------
  async function addMedia(f: File): Promise<void> {
    const id = uid('media');
    const kind = f.type.startsWith('video/') ? 'video' : 'image';
    const m = await app.stage.media.add(id, f, kind);
    st().media.push({ id, name: f.name, kind, hash: '' });
    const layers = st().layers.slice();
    layers.splice(0, 0, { id: uid('layer'), kind: 'media', instanceId: id, mediaId: id, enabled: true, blend: 'normal', opacity: 1, mask: 'none', mediaFit: 'cover', mediaMotion: 'kenburns', mediaBlur: 0.3, mediaDim: 0.35 });
    // the plan layer screens over the media so the picture shows through
    const plan = layers.find((l) => l.kind === 'plan'); if (plan) plan.blend = 'normal';
    app.setLayers(layers); hooks.onEdit('Add media layer');
    if (kind === 'video' && !m.preciseSeek) toast('This browser cannot seek that video frame-exactly; the export may drift.', 'error');
    toast(`${f.name} added as a background layer. Tip: turn on “Transparent background” so the effect draws over it.`);
    setTab('Layers');
  }
  function layersTab(): HTMLElement {
    const layers = st().layers;
    const mediaIn = h('input', { type: 'file', accept: 'image/*,video/*', hidden: true, onChange: () => { const f = mediaIn.files?.[0]; if (f) void addMedia(f); } });
    const fxSel = h('select', {}, ...effectIds().map((id) => h('option', { value: id }, effectMeta(id)?.name ?? id)));
    const add = (l: Partial<Layer>) => { if (layers.length >= 5) { toast('Up to 4 extra layers.', 'error'); return; } app.setLayers([...layers, { id: uid('layer'), kind: 'effect', instanceId: uid('inst'), enabled: true, blend: 'screen', opacity: 0.6, mask: 'none', ...l } as Layer]); hooks.onEdit('Add layer'); refresh(); };
    const preset = (name: string, fn: () => void) => h('button', { class: 'chip', onClick: () => { fn(); hooks.onEdit(name); refresh(); } }, name);
    const list = h('div', { class: 'layer-list' });
    [...layers].reverse().forEach((l) => {
      const idx = layers.indexOf(l);
      const name = l.kind === 'plan' ? 'Plan (Director)' : l.kind === 'effect' ? effectMeta(l.effect!)?.name ?? l.effect : l.kind === 'media' ? `Media: ${st().media.find((m) => m.id === l.mediaId)?.name ?? ''}` : 'Solid';
      const upd = (patch: Partial<Layer>, label = 'Edit layer') => { Object.assign(l, patch); app.setLayers(layers.slice()); hooks.onEdit(label); };
      const move = (d: number) => { const j = idx + d; if (j < 0 || j >= layers.length) return; const c = layers.slice(); [c[idx], c[j]] = [c[j], c[idx]]; app.setLayers(c); hooks.onEdit('Reorder layers'); refresh(); };
      const blend = h('select', { 'aria-label': 'Blend', disabled: l.kind === 'plan' && idx === 0, onChange: () => upd({ blend: blend.value as BlendMode }) }, ...BLEND_MODES.map((b) => h('option', { value: b, selected: l.blend === b }, b)));
      const mask = h('select', { 'aria-label': 'Mask', onChange: () => upd({ mask: mask.value as LayerMask }) }, ...(['none', 'inside-words', 'outside-words', 'luma', 'inv-luma'] as LayerMask[]).map((b) => h('option', { value: b, selected: l.mask === b }, b)));
      const op = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: l.opacity, 'aria-label': 'Opacity', onInput: () => { l.opacity = Number(op.value); }, onChange: () => hooks.onEdit('Layer opacity') });
      const mat = h('select', { 'aria-label': 'Material', onChange: () => { const k = mat.value as MaterialKind; upd({ material: k === 'none' ? undefined : { kind: k, strength: l.material?.strength ?? 1, backdrop: l.material?.backdrop ?? 'layout', tint: MATERIAL_TINTS[k] } }, 'Change material'); refresh(); } }, ...MATERIALS.map((m) => h('option', { value: m, selected: (l.material?.kind ?? 'none') === m }, MATERIAL_LABELS[m])));
      const sec = h('select', { 'aria-label': 'Sections', onChange: () => upd({ sectionOnly: sec.value as SectionLabel }) }, h('option', { value: '' }, 'whole song'), ...['intro', 'verse', 'chorus', 'bridge', 'drop', 'breakdown', 'outro'].map((s) => h('option', { value: s, selected: l.sectionOnly === s }, `${s} only`)));
      const row = h('div', { class: `layer${selectedLayer === l.id ? ' sel' : ''}`, onClick: () => { selectedLayer = l.id; } },
        h('div', { class: 'row' }, h('input', { type: 'checkbox', checked: l.enabled, title: 'Enabled', onChange: (e: Event) => upd({ enabled: (e.target as HTMLInputElement).checked }, 'Toggle layer') }),
          h('b', {}, name), h('span', { class: 'spacer' }), h('span', { class: 'dim ms', dataset: { layer: l.id } }, ''),
          h('button', { class: `icon-btn${l.solo ? ' on' : ''}`, title: 'Solo', onClick: () => { upd({ solo: !l.solo }, 'Solo'); refresh(); } }, 'S'),
          h('button', { class: `icon-btn${l.locked ? ' on' : ''}`, title: 'Lock', onClick: () => { upd({ locked: !l.locked }, 'Lock'); refresh(); } }, '🔒'),
          h('button', { class: 'icon-btn', title: 'Up', onClick: () => move(1) }, '↑'), h('button', { class: 'icon-btn', title: 'Down', onClick: () => move(-1) }, '↓'),
          l.kind !== 'plan' && h('button', { class: 'icon-btn', title: 'Delete', onClick: () => { if (l.locked) return; app.setLayers(layers.filter((x) => x !== l)); hooks.onEdit('Delete layer'); refresh(); } }, '✕')),
        h('div', { class: 'row wrap small' }, h('label', {}, 'Blend', blend), h('label', {}, 'Opacity', op), h('label', {}, 'Mask', mask), h('label', {}, 'When', sec),
          (l.kind === 'plan' || l.kind === 'effect') && h('label', {}, 'Material', mat)));
      if (l.material) {
        const m = l.material;
        const strength = h('input', { type: 'range', min: 0, max: 1.5, step: 0.01, value: m.strength, 'aria-label': 'Material strength', onInput: () => { m.strength = Number(strength.value); }, onChange: () => hooks.onEdit('Material strength') });
        const back = h('select', { onChange: () => { m.backdrop = back.value as 'layout'; hooks.onEdit('Material backdrop'); } }, h('option', { value: 'layout', selected: m.backdrop === 'layout' }, "layout's frame"), h('option', { value: 'material', selected: m.backdrop === 'material' }, "material's backdrop"));
        const tint = h('input', { type: 'color', value: m.tint, onInput: () => { m.tint = tint.value; }, onChange: () => hooks.onEdit('Material tint') });
        row.append(h('div', { class: 'row wrap small' }, h('label', {}, 'Strength', strength), h('label', {}, 'Backdrop', back), h('label', {}, 'Tint', tint)));
      }
      if (l.kind === 'media') {
        const blur = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: l.mediaBlur ?? 0, onInput: () => { l.mediaBlur = Number(blur.value); } });
        const dim = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: l.mediaDim ?? 0, onInput: () => { l.mediaDim = Number(dim.value); } });
        const mo = h('select', { onChange: () => upd({ mediaMotion: mo.value as 'hold' }) }, h('option', { value: 'kenburns', selected: l.mediaMotion !== 'hold' }, 'Ken Burns (cut on bars)'), h('option', { value: 'hold', selected: l.mediaMotion === 'hold' }, 'Hold'));
        row.append(h('div', { class: 'row wrap small' }, h('label', {}, 'Blur', blur), h('label', {}, 'Dim', dim), h('label', {}, 'Motion', mo)));
      }
      if (l.kind === 'solid') {
        const c1 = h('input', { type: 'color', value: l.color ?? '#000000', onInput: () => { l.color = c1.value; } });
        const c2 = h('input', { type: 'color', value: l.color2 ?? l.color ?? '#000000', onInput: () => { l.color2 = c2.value; } });
        row.append(h('div', { class: 'row small' }, h('label', {}, 'Colour', c1), h('label', {}, 'Gradient to', c2)));
      }
      if (l.kind === 'effect' && l.effect && selectedLayer === l.id) {
        const meta = effectMeta(l.effect)!;
        const pp = paramPanel({ specs: meta.params, values: () => ({ ...defaults(meta.params), ...(st().instances[l.instanceId]?.params ?? {}) }), onChange: (k, v, done) => setParam(l.instanceId, k, v, done), liveValue: liveOf(l.instanceId, l.effect), onAutomate: automate(l.instanceId) });
        tickers.push(pp.tick);
        row.append(h('details', {}, h('summary', {}, `${meta.name} parameters`), pp.el));
      }
      list.append(row);
    });
    const cur = app.stage.effectAt(app.player.time) ?? st().plan.effect;
    return h('div', {},
      h('p', { class: 'dim small' }, 'Layers composite bottom to top in one GPU context. Each extra effect layer roughly adds its own cost.'),
      list,
      h('div', { class: 'row wrap' }, fxSel, h('button', { onClick: () => add({ kind: 'effect', effect: fxSel.value }) }, '+ Effect layer'), h('button', { onClick: () => mediaIn.click() }, '+ Image / video'), h('button', { onClick: () => add({ kind: 'solid', color: '#000000', blend: 'multiply', opacity: 0.4 }) }, '+ Solid'), mediaIn),
      h('h3', {}, 'Mask presets'),
      h('div', { class: 'row wrap' },
        preset('Video inside the words', () => { const m = st().layers.find((l) => l.kind === 'media'); if (!m) { toast('Add an image or video layer first.'); return; } const ls = st().layers.filter((l) => l !== m); ls.push({ ...m, mask: 'inside-words', blend: 'normal', opacity: 1 }); app.setLayers(ls); }),
        preset('Effect inside the words', () => add({ kind: 'effect', effect: cur === 'elements' ? 'chrome' : 'elements', mask: 'inside-words', blend: 'normal', opacity: 1 })),
        preset('Knock-out', () => add({ kind: 'solid', color: '#000000', mask: 'outside-words', blend: 'normal', opacity: 1 }))),
      h('p', { class: 'dim small' }, effectMeta(cur) ? `Every effect provides a word mask, so materials and masks work on “${effectMeta(cur)!.name}”.` : ''));
  }

  // ---------- modulation ----------
  let learning: { instanceId: string; key: string } | null = null;
  const midiMap = new Map<string, { instanceId: string; key: string }>();
  function midiLearn(instanceId: string, key: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any as { requestMIDIAccess?: () => Promise<{ inputs: Map<string, { onmidimessage: ((e: { data: Uint8Array | null }) => void) | null }> }> };
    if (!nav.requestMIDIAccess) { toast('Web MIDI is not available in this browser.', 'error'); return; }
    learning = { instanceId, key };
    toast(`MIDI learn: move a knob for “${key}”…`);
    void nav.requestMIDIAccess().then((acc) => {
      for (const inp of acc.inputs.values()) inp.onmidimessage = (e) => {
        if (!e.data) return;
        const status = e.data[0], d1 = e.data[1], d2 = e.data[2];
        if ((status & 0xf0) !== 0xb0) return;
        const id = `${status & 0x0f}:${d1}`;
        if (learning) { midiMap.set(id, learning); toast(`Mapped CC ${d1} → ${learning.key}`, 'ok'); learning = null; return; }
        const tgt = midiMap.get(id);
        if (!tgt) return;
        const eff = st().instances[tgt.instanceId]?.effect ?? tgt.instanceId.replace(/^plan:/, '');
        const spec = effectMeta(eff)?.params.find((p) => p.key === tgt.key);
        if (spec) app.setParam(tgt.instanceId, tgt.key, (spec.min ?? 0) + ((spec.max ?? 1) - (spec.min ?? 0)) * (d2 / 127));
      };
    }).catch(() => toast('MIDI access was denied.', 'error'));
  }
  function targetsFor(): { instanceId: string; label: string; specs: ParamSpec[] }[] {
    const out: { instanceId: string; label: string; specs: ParamSpec[] }[] = [];
    const cur = app.stage.effectAt(app.player.time) ?? st().plan.effect;
    const m = effectMeta(cur);
    if (m) out.push({ instanceId: planInstance(cur), label: m.name, specs: m.params.filter((p) => p.type === 'range' && p.live) });
    for (const l of st().layers) if (l.kind === 'effect' && l.effect) { const mm = effectMeta(l.effect)!; out.push({ instanceId: l.instanceId, label: `Layer: ${mm.name}`, specs: mm.params.filter((p) => p.type === 'range' && p.live) }); }
    for (const l of st().layers) if (l.kind !== 'plan') out.push({ instanceId: `layer:${l.id}`, label: `Layer opacity`, specs: [range('opacity', 'Opacity', 'layer', 1, 0, 1)] });
    out.push({ instanceId: 'post', label: 'Post', specs: POST_SPECS.filter((p) => ['bloom', 'grain', 'chroma', 'vignette', 'distortion', 'halation'].includes(p.key)) });
    out.push({ instanceId: 'global', label: 'Masters', specs: SETTINGS_SPECS.filter((s) => s.group === 'Masters') });
    return out;
  }
  let modTarget = 0;
  function modTab(): HTMLElement {
    const targets = targetsFor();
    modTarget = Math.min(modTarget, targets.length - 1);
    const tg = targets[modTarget];
    const tSel = h('select', { 'aria-label': 'Target', onChange: () => { modTarget = Number(tSel.value); refresh(); } }, ...targets.map((t, i) => h('option', { value: i, selected: i === modTarget }, t.label)));
    const mkRoute = (source: ModSource, key: string): ModRoute => ({ id: uid('route'), source, target: { instanceId: tg.instanceId, key }, amount: 0.4, curve: 'lin', attackMs: 20, releaseMs: 160, lo: 0, hi: 1, invert: false, enabled: true, bars: 1, shape: 'sine', hold: 'beat' });
    // the grid: rows = sources, columns = targets of the selected layer
    const table = h('table', { class: 'matrix' });
    table.append(h('tr', {}, h('th', {}, ''), ...tg.specs.map((s) => h('th', { title: s.label }, h('span', {}, s.label)))));
    let group = '';
    for (const src of MOD_SOURCES) {
      if (src.group !== group) { group = src.group; table.append(h('tr', { class: 'grp' }, h('td', { colSpan: tg.specs.length + 1 }, group))); }
      table.append(h('tr', {}, h('th', { class: 'src' }, src.label), ...tg.specs.map((s) => {
        const r = st().routes.find((x) => x.source === src.id && x.target.instanceId === tg.instanceId && x.target.key === s.key);
        return h('td', { class: r ? (r.enabled ? 'on' : 'off') : '', title: `${src.label} → ${s.label}`, tabIndex: 0, role: 'button',
          onClick: () => { if (r) app.removeRoute(r.id); else app.addRoute(mkRoute(src.id, s.key)); hooks.onEdit('Edit route'); refresh(); },
          onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.target as HTMLElement).click(); } } }, r ? (r.amount >= 0 ? '+' : '−') : '');
      })));
    }
    // inspector for the routes of this target
    const insp = h('div', { class: 'routes' });
    for (const r of st().routes.filter((x) => x.target.instanceId === tg.instanceId)) {
      const meter = h('meter', { min: 0, max: 1, value: 0 });
      tickers.push(() => { meter.value = app.stage.mod.source(r, app.player.time); });
      const num = (key: 'amount' | 'attackMs' | 'releaseMs' | 'lo' | 'hi', min: number, max: number, step: number) => { const i = h('input', { type: 'range', min, max, step, value: r[key], 'aria-label': key, onInput: () => { (r[key] as number) = Number(i.value); }, onChange: () => { app.addRoute({ ...r }); hooks.onEdit('Edit route'); } }); return h('label', {}, key, i); };
      const curve = h('select', { onChange: () => { r.curve = curve.value as ModRoute['curve']; } }, ...['lin', 'exp', 'log', 'step', 'smooth'].map((c) => h('option', { value: c, selected: r.curve === c }, c)));
      insp.append(h('div', { class: 'route' }, h('div', { class: 'row' }, h('input', { type: 'checkbox', checked: r.enabled, onChange: (e: Event) => { r.enabled = (e.target as HTMLInputElement).checked; refresh(); } }),
        h('b', {}, `${r.source} → ${r.target.key}`), meter, h('span', { class: 'spacer' }), h('button', { class: 'icon-btn', onClick: () => { app.removeRoute(r.id); hooks.onEdit('Remove route'); refresh(); } }, '✕')),
        h('div', { class: 'row wrap small' }, num('amount', -1, 1, 0.01), num('attackMs', 0, 500, 1), num('releaseMs', 0, 2000, 1), num('lo', 0, 1, 0.01), num('hi', 0, 1, 0.01), h('label', {}, 'curve', curve),
          h('label', {}, h('input', { type: 'checkbox', checked: r.invert, onChange: (e: Event) => { r.invert = (e.target as HTMLInputElement).checked; } }), ' invert'),
          r.source === 'lfo' && h('label', {}, 'bars', h('select', { onChange: (e: Event) => { r.bars = Number((e.target as HTMLSelectElement).value); } }, ...[0.25, 0.5, 1, 2, 4, 8].map((b) => h('option', { value: b, selected: r.bars === b }, b)))),
          r.source === 'lfo' && h('label', {}, 'shape', h('select', { onChange: (e: Event) => { r.shape = (e.target as HTMLSelectElement).value as 'sine'; } }, ...['sine', 'triangle', 'saw', 'square'].map((b) => h('option', { value: b, selected: r.shape === b }, b)))),
          r.source === 'sampleHold' && h('label', {}, 'per', h('select', { onChange: (e: Event) => { r.hold = (e.target as HTMLSelectElement).value as 'beat'; } }, ...['beat', 'bar', 'onset'].map((b) => h('option', { value: b, selected: r.hold === b }, b)))))));
    }
    const sugg = h('div', { class: 'row wrap' }, ...defaultRoutes().map((d) => { const on = st().routes.some((r) => r.id === d.id && r.enabled); return h('button', { class: `chip${on ? ' on' : ''}`, onClick: () => { if (on) app.removeRoute(d.id); else app.addRoute({ ...d, enabled: true }); hooks.onEdit('Toggle suggestion'); refresh(); } }, d.label ?? d.id); }));
    return h('div', {}, h('p', { class: 'dim small' }, 'Route any audio or song feature to any live slider. Click a cell to add a route; smoothing is precomputed, so renders stay deterministic.'),
      h('label', {}, 'Target ', tSel), h('div', { class: 'matrix-wrap' }, table), h('h3', {}, 'Routes'), insp, h('h3', {}, 'Suggestions'), sugg);
  }

  function postTab(): HTMLElement {
    const pp = paramPanel({
      specs: POST_SPECS, values: () => ({ ...st().post, letterbox: String(st().post.letterbox || 0), motionBlurSamples: String(st().post.motionBlurSamples), lut: st().post.lut ?? '' }) as unknown as Params,
      onChange: (k, v, done) => { const num = k === 'letterbox' || k === 'motionBlurSamples' ? Number(v) : v; app.setPost({ [k]: num } as never); if (k === 'lut' && v) void app.stage.post.loadBuiltin(String(v)); if (done) hooks.onEdit(`Post: ${k}`); },
      liveValue: (k) => { const m = app.stage.mod.apply('post', st().post as unknown as Params, POST_SPECS.filter((s) => s.type === 'range'), st().routes, st().lanes, app.player.time); return m && k in m ? Number(m[k]) : null; },
      onAutomate: automate('post'),
    });
    tickers.push(pp.tick);
    const lutIn = h('input', { type: 'file', accept: '.cube', hidden: true, onChange: async () => { const f = lutIn.files?.[0]; if (!f) return; try { app.stage.post.addLut(f.name, await f.text()); app.setPost({ lut: f.name, lutMix: 1 }); toast(`LUT ${f.name} loaded`, 'ok'); } catch (e) { toast(`Bad .cube file: ${(e as Error).message}`, 'error'); } } });
    return h('div', {}, h('p', { class: 'dim small' }, 'Runs after compositing: halation → bloom → lens → grade + LUT → vignette → grain → letterbox. Skipped when everything is neutral.'),
      pp.el, h('div', { class: 'row' }, h('button', { onClick: () => lutIn.click() }, 'Load .cube LUT…'), h('button', { onClick: () => { app.setPost({ ...DEFAULT_POST }); hooks.onEdit('Reset post'); refresh(); } }, 'Reset post'), lutIn));
  }

  function renderTab(): void {
    tickers = [];
    clear(tabBar);
    for (const t of tabs) tabBar.append(h('button', { role: 'tab', 'aria-selected': t === tab, class: t === tab ? 'on' : '', onClick: () => setTab(t) }, t));
    clear(tabBody);
    if (tab === 'Effect') tabBody.append(effectTab());
    else if (tab === 'Layers') tabBody.append(layersTab());
    else if (tab === 'Modulate') tabBody.append(modTab());
    else if (tab === 'Post') tabBody.append(postTab());
    else hooks.projectTab(tabBody);
  }
  function setTab(t: string): void { tab = t; renderTab(); }
  function refresh(): void { renderTab(); timeline.resize(); }

  root.append(top, h('main', { class: 'main' }, h('section', { class: 'center' }, stageWrap, transport, timeline.el), panel));

  // ---------- command palette ----------
  const commands: { label: string; run(): void }[] = [];
  function buildCommands(): { label: string; run(): void }[] {
    const c: { label: string; run(): void }[] = [...commands];
    for (const e of allEffects()) {
      c.push({ label: `Effect: ${e.meta.name}`, run: () => { app.setEffect(e.meta.id); refresh(); } });
      for (const p of e.meta.params) c.push({ label: `${e.meta.name} › ${p.label}`, run: () => { app.setEffect(e.meta.id); setTab('Effect'); setTimeout(() => (tabBody.querySelector(`[aria-label="${p.label}"]`) as HTMLElement | null)?.focus(), 80); } });
    }
    const count = new Map<string, number>();
    for (const s of app.song?.analysis.sections ?? []) { const n = (count.get(s.label) ?? 0) + 1; count.set(s.label, n); c.push({ label: `Go to ${s.label} ${n} (${fmtTime(s.start, false)})`, run: () => app.player.seek(s.start) }); }
    for (const t of tabs) c.push({ label: `Open tab: ${t}`, run: () => setTab(t) });
    c.push({ label: 'Play / pause', run: () => app.player.toggle() }, { label: 'Export video…', run: () => hooks.exportDialog() }, { label: 'Edit lyrics…', run: () => hooks.lyricsDialog() },
      { label: 'Auto-Director…', run: () => hooks.autoDirect() }, { label: 'Live mode (presenter)…', run: () => hooks.liveMode() }, { label: 'Toggle performance HUD', run: () => { hud.hidden = !hud.hidden; } }, { label: 'Toggle large UI (125 %)', run: () => document.documentElement.classList.toggle('large-ui') },
      { label: 'Load demo song', run: () => demoBtn.click() }, { label: 'Load demo waltz', run: () => void app.loadDemo('demo-waltz') });
    return c;
  }
  function fuzzy(q: string, s: string): number {
    q = q.toLowerCase(); s = s.toLowerCase();
    if (!q) return 1;
    if (s.includes(q)) return 100 - s.indexOf(q);
    let i = 0, score = 0, last = -2;
    for (let k = 0; k < s.length && i < q.length; k++) if (s[k] === q[i]) { score += k === last + 1 ? 3 : 1; last = k; i++; }
    return i === q.length ? score : 0;
  }
  function openPalette(): void {
    const all = buildCommands();
    const list = h('div', { class: 'cmd-list', role: 'listbox' });
    let sel = 0, shown: typeof all = [];
    const input = h('input', { type: 'text', placeholder: 'Search actions, effects, parameters, sections…', 'aria-label': 'Command palette', onInput: () => draw(), onKeydown: (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); e.preventDefault(); draw(false); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); e.preventDefault(); draw(false); }
      else if (e.key === 'Enter' && shown[sel]) { const c = shown[sel]; d.close(); c.run(); }
    } });
    const draw = (reset = true) => {
      if (reset) sel = 0;
      shown = all.map((c) => ({ c, s: fuzzy(input.value, c.label) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 40).map((x) => x.c);
      clear(list);
      shown.forEach((c, i) => list.append(h('div', { class: `cmd${i === sel ? ' sel' : ''}`, role: 'option', onClick: () => { d.close(); c.run(); } }, c.label)));
    };
    const d = dialog('Command palette', h('div', { class: 'col' }, input, list));
    draw();
    input.focus();
  }

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    const tgt = e.target as HTMLElement;
    const typing = tgt.tagName === 'INPUT' && (tgt as HTMLInputElement).type !== 'range' && (tgt as HTMLInputElement).type !== 'checkbox' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (typing || document.querySelector('.backdrop')) return;
    if (e.key === ' ') { e.preventDefault(); app.player.toggle(); }
    else if (e.key === '`') { hud.hidden = !hud.hidden; }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && tgt.tagName !== 'INPUT' && tgt !== timeline.el.querySelector('.tl-detail')) {
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      const a = app.song?.analysis;
      const beat = a && a.bpm ? 60 / a.bpm : 0.5;
      app.player.seek(app.player.time + dir * (e.shiftKey ? beat : 5));
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.code.startsWith('Digit')) {
      // 1–9 and 0 select effects 1–10; Shift+1–9 and Shift+0 select 11–20 (later ones: the effect grid)
      const d = Number(e.code.slice(5));
      const idx = e.shiftKey ? (d === 0 ? 19 : 9 + d) : d === 0 ? 9 : d - 1;
      const cls = allEffects()[idx];
      if (cls) { app.setEffect(cls.meta.id); hooks.onEdit('Switch effect'); refresh(); }
    }
  });

  // ---------- reactions ----------
  let lastTabEffect = '';
  app.on((what) => {
    if (what === 'frame') {
      const t = app.player.time;
      clock.textContent = fmtTime(t);
      const a = app.song?.analysis;
      if (a) {
        const db = pulse(a.downbeats, t, 14), b = pulse(a.beats, t, 14);
        lamp.style.background = db > 0.35 ? '#FFD166' : b > 0.35 ? '#FF5A1F' : '#2a2a31';
      }
      timeline.draw();
      for (const f of tickers) f();
      if (!hud.hidden) hooks.hud(hud);
      // the effect panel follows the plan in Director mode
      const cur = app.stage.effectAt(t) ?? '';
      if (tab === 'Effect' && st().plan.mode !== 'single' && cur !== lastTabEffect && !document.activeElement?.closest('.params')) { lastTabEffect = cur; renderTab(); }
      return;
    }
    if (what === 'transport') { playBtn.textContent = app.player.playing ? '❚❚' : '▶'; return; }
    if (what === 'busy') {
      busy.hidden = !app.busy;
      if (app.busy) { (busy.querySelector('.busy-msg') as HTMLElement).textContent = app.busy.msg; (busy.querySelector('progress') as HTMLProgressElement).value = app.busy.p; }
      return;
    }
    if (what === 'song' || what === 'lyrics' || what === 'state' || what === 'prepared' || what === 'plan' || what === 'layers') {
      empty.hidden = !!app.song;
      const a = app.song?.analysis;
      info.textContent = a ? `${a.bpm.toFixed(0)} BPM · ${app.song!.lyrics.words.length} words · ${app.stage.w}×${app.stage.h}` : '';
      if (what !== 'prepared') refresh(); else timeline.resize();
    }
  });
  timeline.onSelect = () => { if (tab === 'Effect') renderTab(); };
  renderTab();
  hooks.flashBadge(top.querySelector('#flash-badge') as HTMLElement);
  return { timeline, refresh, setTab, openLyrics: () => hooks.lyricsDialog(), openExport: () => hooks.exportDialog(), commands };
}

// Live mode presenter view (SPEC §14): source + level meter + latency, follower mode, the live stage, current and
// next lines, a beat lamp, the flash-guard state, the audience window. `?live` opens it; `?live&output` is the
// chrome-free output page. Keys: Space / PageDown / → cue (or tap in word mode), PageUp / ← back, A auto-follow,
// Esc leaves. A MIDI note-on (any) cues as well.
import type { App } from '../app.ts';
import { h, clear, toast } from './dom.ts';
import { LiveRuntime, liveEffects } from '../live/runtime.ts';
import { openInput, listInputs, type LiveInput, type LiveSourceKind } from '../live/input.ts';
import { startTap, type LiveTap } from '../live/worklet.ts';
import { openAudience, liveChannel, type LiveMsg } from '../live/output.ts';
import { lyricsFromText } from '../lyrics/build.ts';
import { direct } from '../director/director.ts';
import type { FollowMode } from '../live/follow.ts';
import type { Lyrics } from '../types.ts';

export interface LiveHandle { close(): void; runtime(): LiveRuntime | null; start(kind: LiveSourceKind): Promise<void>; cue(): void; tap(): void; back(): void; setMode(m: FollowMode): void; setEffect(id: string): void }

function lyricsFor(app: App, text?: string): Lyrics {
  if (text && text.trim()) { const ly = lyricsFromText(text, null); direct(ly, null); return ly; }
  if (app.song) return app.song.lyrics;
  const ly = lyricsFromText('Load a song or paste lyrics\nthen press Space to cue each line', null); direct(ly, null); return ly;
}

export function mountLive(app: App, canvas: HTMLCanvasElement, opts: { output?: boolean } = {}): LiveHandle {
  const output = !!opts.output;
  app.live = true;
  const home = canvas.parentElement, next = canvas.nextSibling;
  let runtime: LiveRuntime | null = null;
  let input: LiveInput | null = null, tap: LiveTap | null = null;
  let lyricsText = app.lyricsText;
  let effect = liveEffects().some((e) => e.id === 'neon') ? 'neon' : liveEffects()[0]?.id ?? 'karaoke';
  let raf = 0, level = 0, mode: FollowMode = 'cue';
  let audience: { close(): void } | null = null;
  let heardRemote = false;
  const bc = liveChannel((m) => { heardRemote = true; document.querySelector('.live-solo')?.remove(); onRemote(m); });

  // ---------- layout ----------
  const meter = h('div', { class: 'live-meter', role: 'meter', 'aria-label': 'Input level', 'aria-valuemin': 0, 'aria-valuemax': 1 }, h('div', { class: 'fill' }));
  const lat = h('span', { class: 'dim small' }, '—');
  const srcSel = h('select', { 'aria-label': 'Live source' },
    h('option', { value: 'mic' }, 'Microphone / line in'), h('option', { value: 'tab' }, 'Browser tab audio'), h('option', { value: 'file', selected: !!app.song }, 'Rehearsal: the loaded song'));
  const devSel = h('select', { 'aria-label': 'Input device' }, h('option', { value: '' }, 'Default device'));
  void listInputs().then((ds) => { for (const d of ds) devSel.append(h('option', { value: d.deviceId }, d.label || 'Input')); });
  const startBtn = h('button', { class: 'primary', onClick: () => { if (input) stop(); else void start(srcSel.value as LiveSourceKind); } }, 'Start');
  const effSel = h('select', { 'aria-label': 'Live effect', onChange: () => { effect = effSel.value; runtime?.setEffect(effect); bc.post(config()); } },
    ...liveEffects().map((e) => h('option', { value: e.id, selected: e.id === effect }, e.name)));
  const modeSel = h('select', { 'aria-label': 'Follow mode', onChange: () => setMode(modeSel.value as FollowMode) },
    h('option', { value: 'cue' }, 'Cue (line by line)'), h('option', { value: 'word' }, 'Word cue (tap each word)'), h('option', { value: 'auto' }, 'Auto-follow (experimental)'));
  const lamp = h('div', { class: 'live-lamp', 'aria-hidden': 'true' });
  const bpmEl = h('span', { class: 'live-bpm' }, '— BPM');
  const guardEl = h('span', { class: 'dim small' }, 'flash guard ok');
  const curEl = h('div', { class: 'live-cur', 'aria-live': 'polite' });
  const nextEl = h('ol', { class: 'live-next' });
  const lyricsBox = h('textarea', { rows: 6, placeholder: 'Paste lyrics (plain text or LRC). Empty = the loaded song.', value: lyricsText }) as HTMLTextAreaElement;
  const stageBox = h('div', { class: 'live-stage' });
  const view = h('div', { class: output ? 'live-view output' : 'live-view', role: 'region', 'aria-label': 'Live mode' },
    output ? null : h('div', { class: 'live-bar' },
      h('strong', {}, 'LIVE'), srcSel, devSel, startBtn, meter, lat, h('span', { class: 'spacer' }),
      h('label', { class: 'small' }, 'Effect ', effSel), h('label', { class: 'small' }, 'Follow ', modeSel),
      h('button', { onClick: () => void openAud(), title: 'Audience window on another screen' }, 'Audience window'),
      h('button', { onClick: () => close(), title: 'Leave live mode (Esc)' }, 'Exit')),
    h('div', { class: 'live-main' }, stageBox,
      output ? null : h('aside', { class: 'live-side' },
        h('div', { class: 'row' }, lamp, bpmEl, h('span', { class: 'spacer' }), guardEl),
        h('div', { class: 'dim small' }, 'Now'), curEl,
        h('div', { class: 'dim small' }, 'Next'), nextEl,
        h('div', { class: 'row' }, h('button', { onClick: () => back() }, '◀ Back'), h('button', { class: 'primary', onClick: () => (mode === 'word' ? tapWord() : cue()) }, 'Cue ▶  (Space)')),
        h('details', {}, h('summary', { class: 'small' }, 'Lyrics'), lyricsBox, h('div', { class: 'row end' }, h('button', { onClick: () => { lyricsText = lyricsBox.value; rebuild(); bc.post(config()); } }, 'Use these lyrics'))),
        h('p', { class: 'dim small' }, 'Space/PageDown/→ cue · PageUp/← back · A auto-follow · Esc exit. Output page for a second screen: ?live&output'))));
  document.body.appendChild(view);
  stageBox.appendChild(canvas);
  if (output) { document.body.classList.add('live-output'); }

  function config(): LiveMsg { return { type: 'config', effect, lyricsText, aspect: app.state.settings.aspect, settings: {} }; }
  function rebuild(): void {
    runtime?.dispose();
    runtime = new LiveRuntime(app.stage, lyricsFor(app, lyricsText), () => app.state.settings, effect);
    runtime.follower.mode = mode;
    renderLines();
  }
  rebuild();

  // ---------- transport ----------
  async function start(kind: LiveSourceKind): Promise<void> {
    try {
      input = await openInput(kind, { deviceId: devSel.value || undefined, buffer: app.song?.audio ?? null, offset: 0 });
      rebuild();
      tap = await startTap(input.ctx, input.node, {
        report: (s, d) => { runtime?.ingest(s, d); bc.post({ type: 'report', state: s, delta: d }); },
        level: (p) => { level = Math.max(p, level * 0.6); },
      });
      input.begin();
      startBtn.textContent = 'Stop';
      lat.textContent = `≈ ${Math.round((input.inputLatency() + 0.042) * 1000)} ms in → analysis (${tap.transport === 'sab' ? 'shared ring' : 'message port'})`;
      toast(`Live: ${input.label}`, 'ok');
    } catch (e) { toast(`Could not start: ${(e as Error).message}`, 'error'); stop(); }
  }
  function stop(): void { tap?.stop(); input?.stop(); tap = null; input = null; startBtn.textContent = 'Start'; lat.textContent = '—'; }

  function now(): number { return runtime?.now() ?? 0; }
  function bpm(): number { return runtime?.state?.bpm ?? 0; }
  function cue(): void { if (!runtime) return; runtime.follower.cue(now(), bpm()); mode = runtime.follower.mode; modeSel.value = mode; bc.post({ type: 'action', action: 'cue', t: now(), bpm: bpm() }); renderLines(); }
  function tapWord(): void { if (!runtime) return; runtime.follower.tap(now()); bc.post({ type: 'action', action: 'tap', t: now(), bpm: bpm() }); renderLines(); }
  function back(): void { if (!runtime) return; runtime.follower.back(); bc.post({ type: 'action', action: 'back', t: now(), bpm: bpm() }); renderLines(); }
  function setMode(m: FollowMode): void { mode = m; modeSel.value = m; if (runtime) runtime.follower.mode = m; bc.post({ type: 'mode', mode: m }); }
  function setEffect(id: string): void { effect = id; effSel.value = id; runtime?.setEffect(id); }

  /** the output page mirrors the presenter */
  function onRemote(m: LiveMsg): void {
    if (m.type === 'hello' && !output) { bc.post(config()); return; }
    if (!output || !runtime) return;
    if (m.type === 'config') { effect = m.effect; lyricsText = m.lyricsText; app.state.settings.aspect = m.aspect as typeof app.state.settings.aspect; rebuild(); }
    else if (m.type === 'report') runtime.ingest(m.state, m.delta);
    else if (m.type === 'mode') { mode = m.mode; runtime.follower.mode = m.mode; }
    else if (m.type === 'action') { const f = runtime.follower; if (m.action === 'cue') f.cue(m.t, m.bpm); else if (m.action === 'tap') f.tap(m.t); else f.back(); }
  }
  if (output) {
    bc.post({ type: 'hello' });
    // no presenter in this browser (e.g. OBS's own browser source): offer to run standalone on the default input
    const solo = h('button', { class: 'live-solo', onClick: () => { solo.remove(); void start('mic'); } }, 'No presenter found — click to listen to the default input. Space cues lines.');
    setTimeout(() => { if (!heardRemote && !input) view.appendChild(solo); }, 1500);
  }

  async function openAud(): Promise<void> {
    audience?.close();
    audience = await openAudience(canvas);
    if (!audience) toast('The browser blocked the audience window. Allow pop-ups for this page.', 'error');
  }

  // ---------- keys + MIDI ----------
  const onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
    if (e.key === ' ' || e.key === 'PageDown' || e.key === 'ArrowRight') { e.preventDefault(); if (mode === 'word') tapWord(); else cue(); }
    else if (e.key === 'PageUp' || e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    else if (e.key === 'a' || e.key === 'A') setMode('auto');
    else if (e.key === 'Escape' && !output) close();
  };
  window.addEventListener('keydown', onKey);
  const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<{ inputs: Map<string, { onmidimessage: ((e: { data: Uint8Array | null }) => void) | null }> }> };
  void nav.requestMIDIAccess?.().then((m) => { for (const inp of m.inputs.values()) inp.onmidimessage = (e) => { const d = e.data; if (d && (d[0] & 0xf0) === 0x90 && d[2] > 0) { if (mode === 'word') tapWord(); else cue(); } }; }).catch(() => {});

  // ---------- presenter panels ----------
  function renderLines(): void {
    if (!runtime || output) return;
    const ly = runtime.follower.ly, st = runtime.follower.state();
    clear(curEl);
    const cur = ly.lines[st.line];
    if (!cur) curEl.append(h('span', { class: 'dim' }, 'Press Space to cue the first line'));
    else for (const w of st.words) curEl.append(h('span', { class: Number.isFinite(w.shownAt) && w.shownAt <= now() + 0.02 ? 'w on' : 'w' }, w.text), ' ');
    clear(nextEl);
    for (let i = st.line + 1; i < Math.min(ly.lines.length, st.line + 4); i++) nextEl.append(h('li', {}, ly.lines[i].text));
  }
  let lastBeat = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    runtime?.frame();
    if (output || !runtime) return;
    (meter.firstChild as HTMLElement).style.width = `${Math.min(100, Math.sqrt(level) * 100)}%`;
    meter.setAttribute('aria-valuenow', level.toFixed(2));
    level *= 0.92;
    const s = runtime.state;
    if (s) {
      bpmEl.textContent = s.bpm ? `${s.bpm.toFixed(1)} BPM` : '— BPM';
      const on = s.beatPhase < 0.18;
      lamp.className = `live-lamp${on ? (s.beatInBar === 0 ? ' down' : ' on') : ''}`;
      if (s.lastBeat !== lastBeat) { lastBeat = s.lastBeat; renderLines(); }
    }
    guardEl.textContent = runtime.attenuation < 1 ? `flash guard: attenuating (${runtime.flashes}/s)` : 'flash guard ok';
    guardEl.className = runtime.attenuation < 1 ? 'small warn' : 'dim small';
  };
  raf = requestAnimationFrame(loop);

  function close(): void {
    cancelAnimationFrame(raf); stop(); audience?.close(); bc.close();
    window.removeEventListener('keydown', onKey);
    runtime?.dispose(); runtime = null;
    if (home) home.insertBefore(canvas, next); view.remove();
    document.body.classList.remove('live-output');
    app.live = false;
    void app.stage.prepare();
  }
  return { close, runtime: () => runtime, start, cue, tap: tapWord, back, setMode, setEffect };
}

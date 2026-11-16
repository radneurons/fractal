// Timeline (SPEC §11, §11.2): overview strip with the plan, detail lane with word chips, and the v3 lanes
// (syllables, voices, pitch, chords, automation). Canvas-drawn; fully keyboard-operable.
import type { App } from '../app.ts';
import type { Lane, SectionLabel, Word } from '../types.ts';
import { h } from './dom.ts';
import { sample, lowerBound, nearest } from '../analysis/dsp.ts';
import { chordName, keyName } from '../analysis/harmony.ts';
import { effectIds, effectMeta } from '../effects/registry.ts';
import { laneValue, snapTime } from '../compose/automation.ts';

const SEC_COL: Record<SectionLabel, string> = { intro: '#3b4a6b', verse: '#2f6f5e', chorus: '#b0562a', bridge: '#6a4c93', drop: '#b3202a', breakdown: '#44566c', outro: '#3b4a6b', speech: '#5a5a66' };
const ROLE_COL = { hero: '#FF5A1F', support: '#D9D9E0', connective: '#4A4A55' } as const;
const VOICE_COL: Record<string, string> = { A: '#4AA8FF', B: '#FF5FA2', all: '#58D68D' };
const EFFECT_COLS = ['#FF5A1F', '#4AA8FF', '#58D68D', '#FFD166', '#C77DFF', '#FF5FA2', '#29E3FF', '#B5763A', '#8FB0D6', '#E0245E', '#7FB7E6', '#C3A36A', '#9B6DD6', '#5FBFA8', '#E77FA3', '#A8C5DA'];

export interface TimelineLanes { syllables: boolean; voices: boolean; pitch: boolean; chords: boolean; automation: boolean }

export class Timeline {
  readonly el: HTMLElement;
  private ov: HTMLCanvasElement; private dt: HTMLCanvasElement;
  private span = 12;            // seconds visible in the detail lane
  private center = 0;
  private follow = true;
  selected: Word | null = null;
  lanes: TimelineLanes = { syllables: false, voices: false, pitch: false, chords: false, automation: true };
  onSelect: ((w: Word | null) => void) | null = null;
  /** called once per finished edit (undo step) */
  onEdit: ((label: string) => void) | null = null;
  private drag: null | { kind: 'word' | 'line' | 'seek' | 'ovseek' | 'plan' | 'key' | 'syl'; id?: number; t0: number; orig: number[]; idx?: number; lane?: Lane; moved: boolean } = null;
  private laneRects: { lane: Lane; y: number; h: number }[] = [];

  constructor(private app: App) {
    this.ov = h('canvas', { class: 'tl-overview', height: 64, 'aria-label': 'Song overview: click to seek, drag plan boundaries', tabIndex: 0 });
    this.dt = h('canvas', { class: 'tl-detail', height: 150, tabIndex: 0, role: 'application', 'aria-label': 'Timeline detail. Left and right arrows select words, Alt plus arrows nudge the selected word by 10 milliseconds, Shift nudges by one onset.' });
    const chk = (key: keyof TimelineLanes, label: string) => {
      const c = h('input', { type: 'checkbox', checked: this.lanes[key], onChange: () => { this.lanes[key] = c.checked; this.resize(); } });
      return h('label', { class: 'lane-toggle' }, c, label);
    };
    this.el = h('div', { class: 'timeline' }, this.ov,
      h('div', { class: 'lane-bar' }, h('span', { class: 'dim' }, 'Lanes'), chk('syllables', 'Syllables'), chk('voices', 'Voices'), chk('pitch', 'Pitch'), chk('chords', 'Chords'), chk('automation', 'Automation'),
        h('span', { class: 'spacer' }), h('span', { class: 'dim hint' }, 'drag words · Shift = line · dbl-click role · Alt-click inspect · wheel zoom')),
      this.dt);
    this.bind();
    new ResizeObserver(() => this.resize()).observe(this.el);
  }

  private get dur(): number { return this.app.song?.analysis.duration ?? 1; }
  private x2t(x: number): number { return this.center - this.span / 2 + (x / this.dt.clientWidth) * this.span; }
  private t2x(t: number): number { return ((t - (this.center - this.span / 2)) / this.span) * this.dt.clientWidth; }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.el.clientWidth;
    let hgt = 118;
    if (this.lanes.pitch) hgt += 46;
    if (this.lanes.chords) hgt += 20;
    if (this.lanes.automation) hgt += 34 * this.app.state.lanes.length;
    for (const [c, hh] of [[this.ov, 64], [this.dt, hgt]] as const) {
      c.style.height = `${hh}px`;
      c.width = Math.max(10, Math.round(w * dpr)); c.height = Math.round(hh * dpr);
    }
    this.draw();
  }

  private wordAtX(x: number, y: number): Word | null {
    const ly = this.app.song?.lyrics;
    if (!ly || y < 52 || y > 110) return null;
    const lane = y < 82 ? 0 : 1;
    const t = this.x2t(x);
    let best: Word | null = null;
    ly.words.forEach((w, i) => { if (i % 2 === lane && t >= w.start - 0.02 && t <= Math.max(w.end, w.start + (14 / this.dt.clientWidth) * this.span)) best = w; });
    return best;
  }

  private bind(): void {
    const app = this.app;
    // ----- overview -----
    const ovT = (e: PointerEvent) => (Math.max(0, Math.min(1, e.offsetX / this.ov.clientWidth))) * this.dur;
    this.ov.addEventListener('pointerdown', (e) => {
      if (!app.song) return;
      this.ov.setPointerCapture(e.pointerId);
      const t = ovT(e);
      const segs = app.stage.segments;
      if (e.offsetY < 16 && segs.length > 1) {
        // drag a plan boundary (snapped to the nearest downbeat, ≥ 1 s from its neighbours)
        let bi = -1, bd = 8 / this.ov.clientWidth * this.dur;
        segs.forEach((s, i) => { if (i > 0 && Math.abs(s.start - t) < bd) { bd = Math.abs(s.start - t); bi = i; } });
        if (bi > 0) { this.drag = { kind: 'plan', idx: bi, t0: t, orig: [segs[bi].start], moved: false }; return; }
      }
      this.drag = { kind: 'ovseek', t0: t, orig: [], moved: false };
      app.player.seek(t); this.follow = true;
    });
    this.ov.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || !app.song) return;
      const t = ovT(e);
      if (d.kind === 'ovseek') app.player.seek(t);
      else if (d.kind === 'plan') {
        const segs = app.stage.segments.map((s) => ({ ...s }));
        const i = d.idx!;
        let nt = nearest(app.song.analysis.downbeats, t);
        if (Number.isNaN(nt)) nt = t;
        nt = Math.max(segs[i - 1].start + 1, Math.min(segs[i].end - 1, nt));
        segs[i].start = nt; segs[i - 1].end = nt;
        d.moved = true;
        app.setPlan(segs);
      }
    });
    this.ov.addEventListener('pointerup', () => { if (this.drag?.kind === 'plan' && this.drag.moved) this.onEdit?.('Move plan boundary'); this.drag = null; });
    this.ov.addEventListener('dblclick', (e) => {
      // double-click a plan segment: cycle its effect; neighbours that end up equal merge
      if (!app.song || e.offsetY > 18) return;
      const t = (e.offsetX / this.ov.clientWidth) * this.dur;
      const segs = app.stage.segments.map((s) => ({ ...s }));
      const i = segs.findIndex((s) => t >= s.start && t < s.end);
      if (i < 0) return;
      const ids = effectIds();
      segs[i].effect = ids[(ids.indexOf(segs[i].effect) + 1) % ids.length];
      const merged = segs.filter((s, k) => { if (k > 0 && segs[k - 1].effect === s.effect) { segs[k - 1].end = s.end; return false; } return true; });
      app.setPlan(merged);
      this.onEdit?.('Change plan effect');
    });
    // ----- detail -----
    this.dt.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const t = this.x2t(e.offsetX);
        this.span = Math.max(2, Math.min(60, this.span * (e.deltaY > 0 ? 1.15 : 0.87)));
        this.center = t + (this.dt.clientWidth / 2 - e.offsetX) / this.dt.clientWidth * this.span;
        this.follow = false;
      } else { this.center += (e.deltaX / this.dt.clientWidth) * this.span; this.follow = false; }
      this.draw();
    }, { passive: false });
    this.dt.addEventListener('pointerdown', (e) => {
      const song = app.song;
      if (!song) return;
      this.dt.setPointerCapture(e.pointerId);
      this.dt.focus();
      const t = this.x2t(e.offsetX);
      // automation lanes
      for (const r of this.laneRects) if (e.offsetY >= r.y && e.offsetY < r.y + r.h) {
        const lane = r.lane;
        const tol = (7 / this.dt.clientWidth) * this.span;
        let ki = lane.keys.findIndex((k) => Math.abs(k.t - t) < tol);
        if (e.button === 2) return;
        if (ki < 0) {
          const spec = this.specOf(lane);
          const v = (spec?.max ?? 1) - ((e.offsetY - r.y) / r.h) * ((spec?.max ?? 1) - (spec?.min ?? 0));
          const kt = e.altKey ? t : snapTime(t, lane.snap, song.analysis.beats, song.analysis.downbeats);
          lane.keys = [...lane.keys, { t: kt, v, ease: 'linear' as const }].sort((a, b) => a.t - b.t);
          ki = lane.keys.findIndex((k) => k.t === kt);
          app.setLane(lane);
        }
        this.drag = { kind: 'key', lane, idx: ki, t0: t, orig: [lane.keys[ki].t, lane.keys[ki].v, r.y, r.h], moved: false };
        return;
      }
      const w = this.wordAtX(e.offsetX, e.offsetY);
      if (w) {
        if (e.altKey) { this.select(w); return; }
        this.select(w);
        const line = song.lyrics.lines[w.line];
        if (e.shiftKey) this.drag = { kind: 'line', id: w.id, t0: t, orig: line.words.flatMap((i) => [song.lyrics.words[i].start, song.lyrics.words[i].end]), moved: false };
        else this.drag = { kind: 'word', id: w.id, t0: t, orig: [w.start, w.end], moved: false };
      } else { this.drag = { kind: 'seek', t0: t, orig: [], moved: false }; app.player.seek(Math.max(0, t)); }
    });
    this.dt.addEventListener('pointermove', (e) => {
      const d = this.drag, song = app.song;
      if (!d || !song) return;
      const t = this.x2t(e.offsetX), dx = t - d.t0;
      const ly = song.lyrics;
      if (d.kind === 'seek') app.player.seek(Math.max(0, t));
      else if (d.kind === 'word') {
        const w = ly.words[d.id!];
        const len = d.orig[1] - d.orig[0];
        w.start = Math.max(0, d.orig[0] + dx); w.end = w.start + len; w.confidence = 1;
        d.moved = true;
      } else if (d.kind === 'line') {
        const line = ly.lines[ly.words[d.id!].line];
        line.words.forEach((wi, k) => { const w = ly.words[wi]; w.start = Math.max(0, d.orig[k * 2] + dx); w.end = d.orig[k * 2 + 1] + dx; w.confidence = 1; });
        d.moved = true;
      } else if (d.kind === 'key' && d.lane) {
        const lane = d.lane, k = lane.keys[d.idx!];
        const spec = this.specOf(lane);
        const kt = e.altKey ? t : snapTime(t, lane.snap, song.analysis.beats, song.analysis.downbeats);
        k.t = Math.max(0, kt);
        k.v = Math.max(spec?.min ?? 0, Math.min(spec?.max ?? 1, (spec?.max ?? 1) - ((e.offsetY - d.orig[2]) / d.orig[3]) * ((spec?.max ?? 1) - (spec?.min ?? 0))));
        d.moved = true;
      }
      this.draw();
    });
    this.dt.addEventListener('pointerup', () => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if ((d.kind === 'word' || d.kind === 'line') && d.moved) { app.touchLyrics(); this.onEdit?.(d.kind === 'word' ? 'Retime word' : 'Retime line'); }
      if (d.kind === 'key' && d.lane) { d.lane.keys.sort((a, b) => a.t - b.t); app.setLane(d.lane); this.onEdit?.('Edit automation'); }
    });
    this.dt.addEventListener('dblclick', (e) => {
      const w = this.wordAtX(e.offsetX, e.offsetY);
      if (!w) return;
      w.role = w.role === 'hero' ? 'support' : w.role === 'support' ? 'connective' : 'hero';
      w.roleLocked = true;
      app.touchLyrics();
      this.onEdit?.('Change role');
    });
    this.dt.addEventListener('contextmenu', (e) => {
      for (const r of this.laneRects) if (e.offsetY >= r.y && e.offsetY < r.y + r.h) {
        e.preventDefault();
        const t = this.x2t(e.offsetX), tol = (7 / this.dt.clientWidth) * this.span;
        const k = r.lane.keys.find((q) => Math.abs(q.t - t) < tol);
        if (!k) return;
        const order = ['linear', 'ease', 'hold', 'bezier'] as const;
        if (e.shiftKey) r.lane.keys = r.lane.keys.filter((q) => q !== k); else k.ease = order[(order.indexOf(k.ease) + 1) % order.length];
        app.setLane(r.lane); this.onEdit?.('Edit automation key');
      }
    });
    this.dt.addEventListener('keydown', (e) => {
      const song = app.song;
      if (!song) return;
      const ws = song.lyrics.words;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); e.stopPropagation();
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      if (e.altKey && this.selected) {
        const w = this.selected;
        let d = dir * 0.01;
        if (e.shiftKey) { const on = song.analysis.onsets; const i = lowerBound(on, w.start + (dir > 0 ? 0.005 : -0.005)); const tgt = dir > 0 ? on[i] : on[i - 1]; if (tgt !== undefined) d = tgt - w.start; }
        w.start = Math.max(0, w.start + d); w.end += d; w.confidence = 1;
        app.touchLyrics(); this.onEdit?.('Nudge word');
      } else {
        const i = this.selected ? this.selected.id + dir : lowerBound(ws.map((w) => w.start), app.player.time);
        const w = ws[Math.max(0, Math.min(ws.length - 1, i))];
        if (w) { this.select(w); this.center = w.start; this.follow = false; }
      }
      this.draw();
    });
  }

  private specOf(lane: Lane) {
    const eff = this.app.state.instances[lane.target.instanceId]?.effect ?? lane.target.instanceId.replace(/^plan:/, '');
    const s = effectMeta(eff)?.params.find((p) => p.key === lane.target.key);
    if (s) return s;
    if (lane.target.instanceId === 'global') return { min: 0, max: 200 };
    return { min: lane.target.key === 'distortion' ? -1 : 0, max: 1 };
  }

  select(w: Word | null): void { this.selected = w; this.onSelect?.(w); this.draw(); }

  draw(): void {
    this.drawOverview();
    this.drawDetail();
  }

  private drawOverview(): void {
    const c = this.ov, g = c.getContext('2d')!;
    const dpr = c.width / Math.max(1, c.clientWidth), W = c.clientWidth, H = 64;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#121216'; g.fillRect(0, 0, W, H);
    const song = this.app.song;
    if (!song) return;
    const a = song.analysis, dur = a.duration, X = (t: number) => (t / dur) * W;
    // plan strip
    const ids = effectIds();
    for (const s of this.app.stage.segments) {
      g.fillStyle = EFFECT_COLS[Math.max(0, ids.indexOf(s.effect)) % EFFECT_COLS.length];
      g.globalAlpha = 0.85; g.fillRect(X(s.start), 0, Math.max(1, X(s.end) - X(s.start) - 1), 14); g.globalAlpha = 1;
      g.fillStyle = '#0d0d0f'; g.font = '600 9px system-ui';
      const name = effectMeta(s.effect)?.name ?? s.effect;
      if (X(s.end) - X(s.start) > g.measureText(name).width + 6) g.fillText(name.toUpperCase(), X(s.start) + 4, 10);
    }
    // sections
    for (const s of a.sections) {
      g.fillStyle = SEC_COL[s.label]; g.globalAlpha = 0.55;
      g.fillRect(X(s.start), 16, Math.max(1, X(s.end) - X(s.start) - 1), H - 16);
      g.globalAlpha = 1; g.fillStyle = '#e9e9ee'; g.font = '10px system-ui';
      if (X(s.end) - X(s.start) > 34) g.fillText(s.label, X(s.start) + 4, 27);
    }
    // waveform
    g.fillStyle = 'rgba(255,255,255,0.75)';
    const nb = a.peakBuckets, mid = 16 + (H - 16) / 2 + 4, amp = (H - 30) / 2;
    for (let x = 0; x < W; x++) {
      const b0 = Math.floor((x / W) * nb), b1 = Math.max(b0 + 1, Math.floor(((x + 1) / W) * nb));
      let mn = 0, mx = 0;
      for (let b = b0; b < b1 && b < nb; b++) { mn = Math.min(mn, a.peaks[b * 2]); mx = Math.max(mx, a.peaks[b * 2 + 1]); }
      g.fillRect(x, mid - mx * amp, 1, Math.max(1, (mx - mn) * amp));
    }
    // word ticks by role, drops
    for (const w of song.lyrics.words) { g.fillStyle = ROLE_COL[w.role]; g.fillRect(X(w.start), H - 7, 1, w.role === 'hero' ? 7 : 4); }
    g.fillStyle = '#ff3b30';
    for (const d of a.drops) g.fillRect(X(d) - 1, 16, 2, H - 16);
    // view window and playhead
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1;
    g.strokeRect(X(this.center - this.span / 2) + 0.5, 16.5, Math.max(2, X(this.span)), H - 17);
    g.fillStyle = '#FFD166'; g.fillRect(X(this.app.player.time) - 0.5, 0, 1.5, H);
  }

  private drawDetail(): void {
    const c = this.dt, g = c.getContext('2d')!;
    const dpr = c.width / Math.max(1, c.clientWidth), W = c.clientWidth, H = c.clientHeight;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0f0f13'; g.fillRect(0, 0, W, H);
    const song = this.app.song;
    this.laneRects = [];
    if (!song) return;
    const a = song.analysis, t = this.app.player.time;
    if (this.follow && !this.drag) {
      if (this.app.player.playing) this.center = t + this.span * 0.2; else if (Math.abs(t - this.center) > this.span * 0.5) this.center = t;
    }
    if (this.app.player.playing && !this.drag) this.follow = true;
    const t0 = this.center - this.span / 2, t1 = t0 + this.span;
    const X = (tt: number) => this.t2x(tt);
    // section bands
    for (const s of a.sections) {
      if (s.end < t0 || s.start > t1) continue;
      g.fillStyle = SEC_COL[s.label]; g.globalAlpha = 0.5;
      g.fillRect(X(s.start), 0, X(s.end) - X(s.start) - 1, 12); g.globalAlpha = 1;
      g.fillStyle = '#e9e9ee'; g.font = '9px system-ui'; g.fillText(`${s.label}`, Math.max(2, X(s.start) + 3), 9);
    }
    // second grid
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.font = '9px system-ui';
    const stepS = this.span > 30 ? 5 : this.span > 12 ? 2 : 1;
    for (let s = Math.ceil(t0 / stepS) * stepS; s < t1; s += stepS) { g.fillRect(X(s), 12, 1, H - 12); g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, X(s) + 2, 22); g.fillStyle = 'rgba(255,255,255,0.06)'; }
    // loudness envelope tinted by bass
    for (let x = 0; x < W; x += 2) {
      const tt = this.x2t(x);
      if (tt < 0 || tt > a.duration) continue;
      const l = sample(a.loud, tt), b = sample(a.bands.bass, tt);
      g.fillStyle = `rgba(${Math.round(90 + 165 * b)},${Math.round(120 + 40 * (1 - b))},${Math.round(200 - 120 * b)},0.55)`;
      g.fillRect(x, 50 - l * 26, 2, l * 26);
    }
    // onsets, beats, drops
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = lowerBound(a.onsets, t0); i < a.onsets.length && a.onsets[i] < t1; i++) g.fillRect(X(a.onsets[i]), 46, 1, 4);
    const dbs = new Set(a.downbeats.map((d) => Math.round(d * 1000)));
    for (let i = lowerBound(a.beats, t0); i < a.beats.length && a.beats[i] < t1; i++) {
      const down = dbs.has(Math.round(a.beats[i] * 1000));
      g.fillStyle = down ? '#FFD166' : 'rgba(255,90,31,0.7)';
      g.fillRect(X(a.beats[i]), down ? 12 : 18, 1, down ? 12 : 6);
    }
    g.fillStyle = '#ff3b30';
    for (const d of a.drops) if (d >= t0 && d <= t1) { g.fillRect(X(d) - 1, 12, 2, 40); g.fillText('DROP', X(d) + 4, 34); }
    // word chips in two alternating lanes
    const ly = song.lyrics;
    g.font = '600 11px system-ui'; g.textBaseline = 'middle';
    ly.words.forEach((w, i) => {
      if (w.end < t0 - 1 || w.start > t1) return;
      const lane = i % 2, y = 54 + lane * 30, x = X(w.start), ww = Math.max(14, X(w.end) - x);
      const col = this.lanes.voices && w.voice ? VOICE_COL[w.voice] ?? '#aaa' : ROLE_COL[w.role];
      g.fillStyle = col; g.globalAlpha = w.backing ? 0.5 : 0.92;
      g.beginPath(); g.roundRect(x, y, ww, 24, 4); g.fill(); g.globalAlpha = 1;
      if (w.confidence < 0.6) { g.setLineDash([3, 3]); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke(); g.setLineDash([]); }
      if (this.selected === w) { g.strokeStyle = '#FFD166'; g.lineWidth = 2; g.stroke(); }
      g.fillStyle = w.role === 'connective' && !(this.lanes.voices && w.voice) ? '#ddd' : '#111';
      g.save(); g.beginPath(); g.rect(x, y, Math.max(ww, 60), 24); g.clip();
      g.fillText(w.display + (w.element && w.element !== 'none' ? ` · ${w.element}` : ''), x + 4, y + 12);
      g.restore();
      if (this.lanes.syllables && w.syllableTimes && w.syllableTimes.length > 1) {
        g.fillStyle = 'rgba(0,0,0,0.55)';
        for (let k = 1; k < w.syllableTimes.length; k++) g.fillRect(X(w.syllableTimes[k].start), y + 2, 1.5, 20);
      }
    });
    g.textBaseline = 'alphabetic';
    let y = 118;
    if (this.lanes.pitch) {
      // f0 curve over the vocal-activity shading
      g.fillStyle = 'rgba(74,168,255,0.14)';
      for (let x = 0; x < W; x += 2) { const v = sample(a.vocal, this.x2t(x)); if (v > 0.5) g.fillRect(x, y, 2, 44); }
      let lo = Infinity, hi = -Infinity;
      const i0 = Math.max(0, Math.floor(t0 * 60)), i1 = Math.min(a.n - 1, Math.ceil(t1 * 60));
      for (let i = i0; i <= i1; i++) { const v = a.f0[i]; if (!Number.isNaN(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
      if (hi > lo) {
        g.fillStyle = '#7fd0ff';
        for (let i = i0; i <= i1; i++) { const v = a.f0[i]; if (!Number.isNaN(v)) g.fillRect(X(i / 60), y + 40 - ((v - lo) / (hi - lo + 1)) * 36, 2, 2); }
      }
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.font = '9px system-ui'; g.fillText('pitch / vocal', 3, y + 9);
      y += 46;
    }
    if (this.lanes.chords) {
      g.font = '10px system-ui';
      for (const ch of a.chords) {
        if (ch.end < t0 || ch.start > t1) continue;
        g.fillStyle = `hsl(${(ch.root * 7 % 12) * 30} 45% ${ch.quality === 'min' ? 28 : 36}%)`;
        g.fillRect(X(ch.start), y, X(ch.end) - X(ch.start) - 1, 18);
        g.fillStyle = '#fff'; g.fillText(chordName(ch), X(ch.start) + 3, y + 13);
      }
      g.fillStyle = '#FFD166';
      for (const k of a.keyChanges) if (k.t >= t0 && k.t <= t1) { g.fillRect(X(k.t), y, 2, 18); g.fillText(keyName(k), X(k.t) + 4, y + 13); }
      y += 20;
    }
    if (this.lanes.automation) {
      for (const lane of this.app.state.lanes) {
        const spec = this.specOf(lane);
        const lo = spec?.min ?? 0, hi = spec?.max ?? 1;
        g.fillStyle = '#16161b'; g.fillRect(0, y, W, 32);
        g.strokeStyle = '#58D68D'; g.lineWidth = 1.5; g.beginPath();
        for (let x = 0; x <= W; x += 3) { const v = laneValue(lane, this.x2t(x)) ?? lo; const yy = y + 30 - ((v - lo) / (hi - lo || 1)) * 28; if (x) g.lineTo(x, yy); else g.moveTo(x, yy); }
        g.stroke();
        g.fillStyle = '#58D68D';
        for (const k of lane.keys) if (k.t >= t0 && k.t <= t1) { const yy = y + 30 - ((k.v - lo) / (hi - lo || 1)) * 28; g.beginPath(); g.arc(X(k.t), yy, 4, 0, 7); g.fill(); }
        g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = '9px system-ui';
        g.fillText(`${lane.target.instanceId.replace(/^plan:/, '')} · ${lane.target.key}  (click: add key · right-click: easing · Shift+right-click: delete)`, 3, y + 9);
        this.laneRects.push({ lane, y, h: 32 });
        y += 34;
      }
    }
    // playhead
    g.fillStyle = '#FFD166'; g.fillRect(X(t) - 0.5, 0, 1.5, H);
  }
}

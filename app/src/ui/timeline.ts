// Overview strip + zoomable detail timeline: waveform, sections, beats, drops, and draggable words.
import type { Song, Word } from '../types';

const SEC_COL: Record<string, string> = { intro: '#3a3550', verse: '#24465a', chorus: '#7a3a1c', bridge: '#4f5a24', drop: '#8a1f2c', breakdown: '#2e2e36', outro: '#3a3550', speech: '#24465a' };
const ROLE_COL = { hero: '#ff7a3d', support: '#bdb9ae', connective: '#5f5d66' };

export interface TimelineHooks {
  seek(t: number): void;
  now(): number;
  playing(): boolean;
  wordsEdited(ids: number[]): void;   // timing changed
  roleEdited(w: Word): void;          // role cycled
  select(w: Word | null): void;
  planEdited?(plan: { start: number; end: number; effect: string }[], cycleIndex?: number): void;
}

export class Timeline {
  song: Song | null = null;
  private view = 10;           // seconds visible in detail
  private v0 = 0;              // detail view start
  private drag: { ids: number[]; orig: number[]; origEnd: number[]; x0: number; moved: boolean } | null = null;
  selected: number | null = null;
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  syncOffset = 0;
  plan: { start: number; end: number; effect: string }[] = [];
  effectNames: Record<string, string> = {};

  constructor(private ov: HTMLCanvasElement, private tl: HTMLCanvasElement, private hooks: TimelineHooks) {
    const seekOv = (e: MouseEvent) => { if (!this.song) return; const r = ov.getBoundingClientRect(); this.hooks.seek((e.clientX - r.left) / r.width * this.song.analysis.duration); };
    ov.addEventListener('dblclick', e => {
      if (!this.song || this.plan.length < 2 || e.offsetY < 44 - 16) return;
      const t = e.offsetX / ov.clientWidth * this.song.analysis.duration; const i = this.plan.findIndex(p => t >= p.start && t < p.end);
      if (i >= 0) this.hooks.planEdited?.(this.plan, i);
    });
    ov.addEventListener('mousedown', e => {
      // drag a Director-plan boundary (bottom strip), snapped to downbeats
      if (this.song && this.plan.length > 1 && e.offsetY >= 44 - 16) {
        const D = this.song.analysis.duration, W = ov.clientWidth;
        const bi = this.plan.findIndex((p, k) => k > 0 && Math.abs(p.start / D * W - e.offsetX) < 6);
        if (bi > 0) {
          const r = ov.getBoundingClientRect(), db = this.song.analysis.downbeats;
          const mv = (ev: MouseEvent) => {
            let t = (ev.clientX - r.left) / W * D;
            if (db.length) t = db.reduce((b, d) => Math.abs(d - t) < Math.abs(b - t) ? d : b, db[0]);
            t = Math.max(this.plan[bi - 1].start + 1, Math.min(this.plan[bi].end - 1, t));
            this.plan[bi - 1].end = t; this.plan[bi].start = t;
          };
          const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); this.hooks.planEdited?.(this.plan); };
          addEventListener('mousemove', mv); addEventListener('mouseup', up); return;
        }
      }
      seekOv(e); const mv = (ev: MouseEvent) => seekOv(ev); const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); }; addEventListener('mousemove', mv); addEventListener('mouseup', up); });
    tl.addEventListener('mousedown', e => this.down(e));
    tl.addEventListener('dblclick', e => this.dbl(e));
    tl.addEventListener('wheel', e => { e.preventDefault(); const tm = this.xToT(e.offsetX); this.view = Math.max(2, Math.min(60, this.view * Math.exp(e.deltaY * 0.0015))); this.v0 = tm - (e.offsetX / tl.clientWidth) * this.view; }, { passive: false });
    new ResizeObserver(() => this.resize()).observe(tl);
    this.resize();
  }

  private resize() {
    for (const c of [this.ov, this.tl]) { const w = c.clientWidth || 600; c.width = Math.round(w * this.dpr); c.height = Math.round(Number(c.getAttribute('height')) * this.dpr); c.style.height = c.getAttribute('height') + 'px'; }
  }
  private xToT(x: number) { return this.v0 + x / this.tl.clientWidth * this.view; }
  private tToX(t: number) { return (t - this.v0) / this.view * this.tl.clientWidth; }

  private wordAt(x: number, y: number): Word | null {
    if (!this.song || y < 92) return null;
    const off = this.syncOffset;
    for (const w of this.song.lyrics.words) {
      const x0 = this.tToX(w.start + off), x1 = Math.max(x0 + 6, this.tToX(w.end + off));
      const ly = this.laneY(w);
      if (x >= x0 && x <= x1 && y >= ly && y <= ly + 24) return w;
    }
    return null;
  }
  private laneY(w: Word) { return 96 + (w.line % 2) * 26; }

  private down(e: MouseEvent) {
    if (!this.song) return;
    const w = this.wordAt(e.offsetX, e.offsetY);
    if (!w) { this.hooks.seek(this.xToT(e.offsetX)); return; }
    if (e.altKey || e.metaKey || e.ctrlKey) { this.selected = w.id; this.hooks.select(w); return; }
    const ly = this.song.lyrics;
    const ids = e.shiftKey ? ly.lines[w.line].words.slice() : [w.id];
    this.drag = { ids, orig: ids.map(i => ly.words[i].start), origEnd: ids.map(i => ly.words[i].end), x0: e.offsetX, moved: false };
    this.selected = w.id; this.hooks.select(w);
    const r = this.tl.getBoundingClientRect();
    const mv = (ev: MouseEvent) => {
      if (!this.drag) return;
      const dt = (ev.clientX - r.left - this.drag.x0) / this.tl.clientWidth * this.view;
      if (Math.abs(ev.clientX - r.left - this.drag.x0) > 2) this.drag.moved = true;
      this.drag.ids.forEach((id, k) => { const wd = ly.words[id]; wd.start = Math.max(0, this.drag!.orig[k] + dt); wd.end = this.drag!.origEnd[k] + dt; wd.confidence = 1; });
    };
    const up = () => {
      removeEventListener('mousemove', mv); removeEventListener('mouseup', up);
      if (this.drag?.moved) this.hooks.wordsEdited(this.drag.ids); else this.hooks.seek(w.start + this.syncOffset - 0.05);
      this.drag = null;
    };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  }

  private dbl(e: MouseEvent) {
    const w = this.wordAt(e.offsetX, e.offsetY); if (!w) return;
    w.role = w.role === 'hero' ? 'support' : w.role === 'support' ? 'connective' : 'hero'; w.roleLocked = true;
    this.hooks.roleEdited(w);
  }

  draw() {
    const song = this.song, now = this.hooks.now();
    // follow the playhead
    if (this.hooks.playing() && !this.drag) { if (now < this.v0 + this.view * 0.1 || now > this.v0 + this.view * 0.7) this.v0 = now - this.view * 0.3; }
    else if (!this.drag && (now < this.v0 || now > this.v0 + this.view)) this.v0 = now - this.view * 0.3;
    this.drawOverview(song, now); this.drawDetail(song, now);
  }

  private drawOverview(song: Song | null, now: number) {
    const c = this.ov.getContext('2d')!, W = this.ov.clientWidth, H = 44; c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#101013'; c.fillRect(0, 0, W, H);
    if (!song) return;
    const a = song.analysis, D = a.duration, x = (t: number) => t / D * W;
    for (const s of a.sections) { c.fillStyle = SEC_COL[s.label] ?? '#333'; c.globalAlpha = 0.55; c.fillRect(x(s.start), 0, x(s.end) - x(s.start), H); }
    c.globalAlpha = 1;
    // waveform
    const nb = a.peakBuckets; c.fillStyle = '#d8d4cc';
    for (let px = 0; px < W; px++) { const b = Math.floor(px / W * nb); const mn = a.peaks[b * 2], mx = a.peaks[b * 2 + 1]; c.fillRect(px, H / 2 - mx * H * 0.45, 1, Math.max(1, (mx - mn) * H * 0.45)); }
    // words
    for (const w of song.lyrics.words) { c.fillStyle = ROLE_COL[w.role]; c.fillRect(x(w.start + this.syncOffset), H - 5, Math.max(1, x(w.end - w.start)), 4); }
    for (const d of a.drops) { c.fillStyle = '#ff2a4a'; c.fillRect(x(d) - 1, 0, 2, H); }
    // effect plan (Director mode): a strip with effect names
    if (this.plan.length > 1) {
      const PC = ['#ff5a1f', '#ffd23f', '#4fb3ff', '#7ee081', '#c792ea', '#ff7aa8', '#9aa0a6', '#f6c177'];
      const ids = [...new Set(this.plan.map(p => p.effect))];
      for (const p of this.plan) {
        const x0 = x(p.start), x1 = x(p.end); c.fillStyle = PC[ids.indexOf(p.effect) % PC.length]; c.fillRect(x0, H - 14, x1 - x0 - 1, 8);
        const nm = (this.effectNames[p.effect] ?? p.effect).toUpperCase(); c.font = 'bold 8px system-ui'; c.fillStyle = '#111';
        if (c.measureText(nm).width < x1 - x0 - 4) c.fillText(nm, x0 + 2, H - 7.2);
      }
    }
    c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(x(this.v0), 0, x(this.view), H);
    c.fillStyle = '#ffd23f'; c.fillRect(x(now) - 1, 0, 2, H);
    c.font = '10px system-ui'; c.fillStyle = 'rgba(255,255,255,.75)';
    for (const s of a.sections) c.fillText(s.label, x(s.start) + 3, 11);
  }

  private drawDetail(song: Song | null, now: number) {
    const c = this.tl.getContext('2d')!, W = this.tl.clientWidth, H = 150; c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#0c0c0e'; c.fillRect(0, 0, W, H);
    if (!song) return;
    const a = song.analysis, t0 = this.v0, t1 = this.v0 + this.view, x = (t: number) => this.tToX(t);
    // sections
    for (const s of a.sections) { if (s.end < t0 || s.start > t1) continue; c.fillStyle = SEC_COL[s.label] ?? '#333'; c.fillRect(x(s.start), 0, x(s.end) - x(s.start), 14); c.fillStyle = '#fff'; c.font = '10px system-ui'; c.fillText(`${s.label}`, Math.max(2, x(s.start) + 3), 10.5); }
    // waveform (envelope at 60 fps)
    c.fillStyle = '#3b3a42';
    for (let px = 0; px < W; px++) { const t = this.xToT(px); if (t < 0 || t > a.duration) continue; const i = Math.min(a.n - 1, Math.round(t * a.fps)); const v = a.loud[i]; const bb = a.bands.bass[i]; c.fillStyle = `rgb(${50 + bb * 90},${48 + v * 40},${60})`; c.fillRect(px, 52 - v * 34, 1, Math.max(1, v * 68)); }
    // onsets
    c.fillStyle = 'rgba(255,255,255,.18)';
    for (const o of a.onsets) { if (o < t0 || o > t1) continue; c.fillRect(x(o), 70, 1, 16); }
    // beats
    const db = new Set(a.downbeats.map(d => Math.round(d * 1000)));
    for (const b of a.beats) { if (b < t0 || b > t1) continue; const isD = db.has(Math.round(b * 1000)); c.fillStyle = isD ? 'rgba(255,210,63,.65)' : 'rgba(255,255,255,.22)'; c.fillRect(x(b), 14, 1, isD ? 78 : 40); }
    for (const d of a.drops) { if (d < t0 || d > t1) continue; c.fillStyle = '#ff2a4a'; c.fillRect(x(d) - 1, 14, 3, H - 14); c.fillText('DROP', x(d) + 4, 26); }
    // words
    c.font = '11px system-ui'; c.textBaseline = 'middle';
    for (const w of song.lyrics.words) {
      const s = w.start + this.syncOffset, e = w.end + this.syncOffset;
      if (e < t0 || s > t1) continue;
      const x0 = x(s), x1 = Math.max(x0 + 6, x(e)), y = this.laneY(w);
      const active = now >= s && now < e;
      c.fillStyle = ROLE_COL[w.role]; c.globalAlpha = active ? 1 : 0.72; c.fillRect(x0, y, x1 - x0 - 1, 24); c.globalAlpha = 1;
      if (w.confidence < 0.6) { c.strokeStyle = 'rgba(255,255,255,.5)'; c.setLineDash([3, 2]); c.strokeRect(x0 + .5, y + .5, x1 - x0 - 2, 23); c.setLineDash([]); }
      if (this.selected === w.id) { c.strokeStyle = '#ffd23f'; c.lineWidth = 2; c.strokeRect(x0, y, x1 - x0 - 1, 24); c.lineWidth = 1; }
      c.save(); c.beginPath(); c.rect(x0, y, x1 - x0 - 2, 24); c.clip();
      c.fillStyle = w.role === 'connective' ? '#ddd' : '#111'; c.fillText(w.display, x0 + 3, y + 12.5); c.restore();
      if (w.element && w.element !== 'none' && w.role === 'hero') { c.fillStyle = '#ffd23f'; c.font = '9px system-ui'; c.fillText(w.element, x0 + 2, y - 4 + (w.line % 2 ? 0 : 0)); c.font = '11px system-ui'; }
    }
    c.textBaseline = 'alphabetic';
    // seconds grid
    c.fillStyle = 'rgba(255,255,255,.35)'; c.font = '9.5px system-ui';
    const step = this.view > 30 ? 5 : this.view > 12 ? 2 : 1;
    for (let s = Math.ceil(t0 / step) * step; s < t1; s += step) { c.fillRect(x(s), H - 6, 1, 6); c.fillText(fmtT(s, false), x(s) + 2, H - 1); }
    c.fillStyle = '#ffd23f'; c.fillRect(x(now) - 1, 0, 2, H);
  }
}

export function fmtT(t: number, cs = true) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return cs ? `${m}:${s.toFixed(2).padStart(5, '0')}` : `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
}

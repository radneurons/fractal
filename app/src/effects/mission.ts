// MISSION POSTER — the song builds an engineering poster (SPEC §8.3).
// Zones per section, blueprint panels for choruses, a rocket riding the transfer guides.
// v3: annotations add key and chords; the rocket's altitude follows the vocal pitch; the countdown shows the meter.
// Reduce motion calms: camera drift, the panel hinge (fades instead), the rocket hop and letter assembly.
import type { Word } from '../types.ts';
import { Canvas2DEffect, type EffectContext, type EffectMeta, range, toggle, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import { layoutLine, maskFill, frameKeys, type LW } from './common.ts';
import { type Ctx2D, setFont, clamp01, lerp, easeOutCubic, easeOutBack, easeOutQuint, smooth, timingOf, subtitle, lineAt, fr, graphemes, textWidth, type TimingOpts } from '../render/textkit.ts';
import { type CamKey, sampleCamera, applyCamera } from '../render/camera.ts';
import { drawIcon } from '../render/icons.ts';
import { conceptById } from '../director/lexicon.ts';
import { hash01, lowerBound, sample } from '../analysis/dsp.ts';
import { keyName, chordName } from '../analysis/harmony.ts';
import { rgba } from '../render/gl.ts';

type Motion = 'conn' | 'register' | 'impulse' | 'glide' | 'impact' | 'hero' | 'assemble' | 'rule' | 'rise' | 'snap' | 'tower' | 'compass';
const MF: Record<Motion, number> = { conn: 7, register: 26, impulse: 14, glide: 28, impact: 16, hero: 22, assemble: 22, rule: 22, rise: 14, snap: 12, tower: 10, compass: 30 };
const PALS: Record<string, { ink: string; paper: string; blue: string; orange: string; brass: string }> = {
  mission: { ink: '#101923', paper: '#F0EBDD', blue: '#23485E', orange: '#D96B35', brass: '#C3A36A' },
  blueprint: { ink: '#EAF2F7', paper: '#1E4257', blue: '#16323F', orange: '#FFB46B', brass: '#9CC3D5' },
  daylight: { ink: '#1B1B1B', paper: '#FAFAF7', blue: '#2F6690', orange: '#E4572E', brass: '#B8A37A' },
  mars: { ink: '#2A120C', paper: '#F3DFD0', blue: '#7A2E1D', orange: '#E2542A', brass: '#C98A5B' },
};
interface Item { k: LW; motion: Motion; land: number; ent: number; row: number; orange: boolean }
interface Zone { idx: number; x: number; y: number; w: number; h: number; t0: number; t1: number; panel: boolean; label: string; items: Item[]; rows: { y: number; x0: number; x1: number; t: number; cap: number }[]; tower?: { w: Word; text: string; cap: number; land: number }; disc?: Item; drop: boolean }

export class Mission extends Canvas2DEffect {
  static meta: EffectMeta = {
    id: 'mission', name: 'Mission Poster', kind: '2d',
    description: 'The song builds an engineering poster: blueprint panels, brass rules, annotations and a paper rocket.',
    affinity: aff(0.45, 0.75, 0.8, 0.7, 0.6, 0.4, 0.7, 0.45),
    supportsTransparent: true, ownsTitle: true,
    params: [
      select('palette', 'Palette', 'Look', 'mission', ['mission', 'blueprint', 'daylight', 'mars'], false),
      select('panels', 'Blueprint panels', 'Look', 'chorus', ['chorus', 'all', 'none'], false),
      toggle('annotations', 'Annotations', 'Look', true),
      range('guides', 'Guides', 'Look', 0.8, 0, 1, 0.01),
      range('heroScale', 'Hero size', 'Type', 1, 0.6, 1.5, 0.01, false),
      range('zoneWidth', 'Zone width', 'Type', 2300, 1500, 3200, 50, false),
      toggle('tower', 'Tower word', 'Type', true, false),
      select('vehicle', 'Vehicle', 'Vehicle', 'rocket', ['rocket', 'concept icon', 'none'], false),
      toggle('launch', 'Launch on drops', 'Vehicle', true),
      toggle('disc', 'Lunar disc', 'Vehicle', true, false),
      range('drift', 'Camera drift', 'Camera', 1, 0, 2, 0.01),
      toggle('pullbacks', 'Zone pull-backs', 'Camera', true, false),
    ],
  };
  readonly meta = Mission.meta;
  private zones: Zone[] = [];
  private keys: CamKey[] = [];
  private tm!: TimingOpts;
  private pal = PALS.mission;
  private poster = { w: 1, h: 1 };
  private icon = 'star';
  private first = 0; private last = 0;

  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    this.tm = timingOf(this.s);
    this.pal = PALS[this.str('palette')] ?? PALS.mission;
    if (this.s.paletteSource === 'artwork' && ctx.artwork) this.pal = { ink: ctx.artwork.darkest, paper: ctx.artwork.lightest, blue: ctx.artwork.dominant, orange: ctx.artwork.vivid1, brass: ctx.artwork.vivid2 };
    const { W, H } = this, ly = this.ly, a = this.a;
    const portrait = H > W;
    const ZW = this.num('zoneWidth') * (portrait ? 0.62 : 1);
    const hs = this.num('heroScale');
    // zones: one per section with lines, split every 8 lines
    const groups: number[][] = [];
    for (const line of ly.lines) {
      const g = groups[groups.length - 1];
      if (!g || ly.lines[g[0]].section !== line.section || g.length >= 8) groups.push([line.idx]); else g.push(line.idx);
    }
    const zones: Zone[] = [];
    const counts = new Map<string, number>();
    for (const w of ly.words) if (w.concept) counts.set(w.concept, (counts.get(w.concept) ?? 0) + 1);
    this.icon = conceptById([...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0])?.icon ?? 'star';
    let discDone = false;
    groups.forEach((g, zi) => {
      const sec = a.sections[ly.lines[g[0]].section];
      const label = sec?.label ?? 'verse';
      const panel = this.str('panels') === 'all' || (this.str('panels') === 'chorus' && (label === 'chorus' || label === 'drop'));
      const z: Zone = { idx: zi, x: 0, y: 0, w: ZW, h: 0, t0: ly.lines[g[0]].start, t1: ly.lines[g[g.length - 1]].end, panel, label, items: [], rows: [], drop: a.drops.some((d) => Math.abs(d - ly.lines[g[0]].start) < 2.5) };
      let y = 150;
      const towerW = this.bool('tower') && g.length >= 3 ? g.flatMap((li) => ly.lines[li].words.map((i) => ly.words[i])).filter((w) => w.role === 'hero' && !w.backing && graphemes(w.text).length >= 6).sort((p, q) => q.text.length - p.text.length)[0] : undefined;
      const innerW = ZW - 220 - (towerW ? 260 : 0);
      for (const li of g) {
        const line = ly.lines[li];
        const stressCap = (w: Word) => (w.role === 'hero' ? (150 + 100 * w.stress) * hs : w.role === 'support' ? 78 + 30 * w.stress : 50);
        const L = layoutLine(ly, line, { maxW: innerW, cap: 100, fonts: { hero: 'barlowSemi', support: 'barlow', conn: 'barlowMed', backing: 'barlowCondIt' }, caseMode: this.s.caseMode, gap: 0.36, lineGap: 0.5, align: 'left' });
        // re-flow with stress-dependent caps: greedy rows by hand
        let x = 110, rowCap = 0, rowStart = z.items.length;
        const flush = () => {
          if (z.items.length === rowStart) return;
          const its = z.items.slice(rowStart);
          y += rowCap;
          for (const it of its) it.k.y = y;
          z.rows.push({ y, x0: 110, x1: Math.max(...its.map((i) => i.k.x + i.k.width)), t: its[0].land, cap: rowCap });
          y += rowCap * 0.42 + 26;
          rowStart = z.items.length; rowCap = 0; x = 110;
        };
        const voiceB = this.s.voicePalette && line.voice === 'B';
        let prevMotion: Motion | null = null;
        for (const k0 of L.words) {
          const w = k0.w;
          if (w === towerW) continue;
          const cap = w.backing ? 44 : stressCap(w);
          const width = textWidth(k0.text, k0.font, cap);
          if (x > 110 && x + width > 110 + innerW) flush();
          const k: LW = { ...k0, x, y: 0, cap, width, row: z.rows.length };
          const c = w.concept;
          let motion: Motion;
          const r = hash01(w.id, this.seed, 3);
          const lastOfSong = w === ly.words[ly.words.length - 1];
          if (w.role === 'connective' || w.backing) motion = 'conn';
          else if (c === 'shock' || c === 'quake') motion = 'impact';
          else if (c === 'light' || c === 'fire' || c === 'flower' || c === 'star') motion = 'rise';
          else if (w.role === 'hero') motion = r < 0.34 ? 'hero' : r < 0.6 ? 'register' : r < 0.82 ? 'assemble' : 'rule';
          else motion = graphemes(k.text).length <= 4 ? 'impulse' : r < 0.5 ? 'glide' : 'snap';
          if (motion === prevMotion && motion !== 'conn') motion = motion === 'glide' ? 'snap' : 'glide';
          if (lastOfSong && w.role !== 'connective') motion = 'snap';
          if (this.s.reduceMotion && (motion === 'assemble' || motion === 'register')) motion = 'rise';
          prevMotion = motion;
          const it: Item = { k, motion, land: w.start - this.tm.anticipation, ent: fr(MF[motion]), row: z.rows.length, orange: c === 'fire' || c === 'heart' || c === 'shock' || voiceB };
          // lunar disc: the first big hero with an O after its first letter
          if (!discDone && this.bool('disc') && w.role === 'hero' && /^.+o/i.test(k.text)) { it.motion = 'compass'; it.ent = fr(MF.compass); z.disc = it; discDone = true; }
          z.items.push(it);
          rowCap = Math.max(rowCap, cap);
          x += width + (w.role === 'connective' ? 22 : 44);
        }
        flush();
        y += 34;
      }
      if (towerW) z.tower = { w: towerW, text: towerW.display.replace(/[^\p{L}\p{N}']/gu, '').toUpperCase(), cap: 150, land: towerW.start - this.tm.anticipation };
      z.h = Math.max(y + 190, towerW ? 150 + textWidth(z.tower!.text, 'barlowSemi', 150) + 240 : 0);
      zones.push(z);
    });
    // the poster's column count (snake order) whose aspect is closest to the frame's
    const GAP = 170;
    let best = { cols: 1, err: Infinity };
    for (let cols = 1; cols <= Math.min(6, zones.length); cols++) {
      const hgt = new Array(cols).fill(0);
      zones.forEach((z, i) => { hgt[Math.floor((i * cols) / zones.length)] += z.h + GAP; });
      const err = Math.abs(Math.log(((cols * (ZW + GAP)) / Math.max(...hgt)) / (W / H)));
      if (err < best.err) best = { cols, err };
    }
    const colH = new Array(best.cols).fill(0);
    zones.forEach((z, i) => { const c = Math.floor((i * best.cols) / zones.length); z.x = c * (ZW + GAP); z.y = colH[c]; colH[c] += z.h + GAP; });
    this.poster = { w: best.cols * (ZW + GAP) - GAP, h: Math.max(...colH, 1) - GAP };
    this.zones = zones;
    // camera: frame each row (minimum width 1500), arriving 0.35 s before its first word
    const frames: Parameters<typeof frameKeys>[0] = [];
    for (const z of zones) {
      z.rows.forEach((r, ri) => {
        // keep the previous row in frame while it is still fresh
        const p = z.rows[ri - 1];
        const withPrev = p && r.t - p.t < 5;
        const top = withPrev ? p.y - p.cap * 1.25 : r.y - r.cap * 1.6;
        const bottom = r.y + r.cap * 0.7;
        frames.push({ t: r.t - 0.35, x: z.x + r.x0 - 60, y: z.y + top, w: Math.max(1500 * (portrait ? 0.6 : 1), Math.max(r.x1, withPrev ? p.x1 : 0) - r.x0 + 240), h: bottom - top, margin: 0.88, move: 0.7 });
      });
      const next = zones[z.idx + 1];
      if (this.bool('pullbacks') && next && next.t0 - z.t1 > 1.4) frames.push({ t: z.t1 + 0.6, x: z.x - 60, y: z.y - 60, w: z.w + 120, h: z.h + 120, margin: 0.92 });
    }
    this.first = ly.words.length ? ly.words[0].start : 0;
    this.last = ly.words.length ? ly.words[ly.words.length - 1].end : 0;
    if (zones.length) {
      const z0 = zones[0], r0 = z0.rows[0];
      if (r0 && this.first > 1.2) frames.unshift({ t: 0, x: z0.x + r0.x0 - 60, y: z0.y + r0.y - r0.cap * 2.2, w: 1500 * (portrait ? 0.6 : 1), h: r0.cap * 3.6, margin: 0.9 });
      frames.push({ t: Math.min(a.duration - 0.2, this.last + 1.8), x: -90, y: -90, w: this.poster.w + 180, h: this.poster.h + 180, margin: 0.95, move: 1.6 });
    }
    this.keys = frameKeys(frames.sort((p, q) => p.t - q.t), W, H);
  }

  protected draw(t: number, g: Ctx2D, mask: boolean): void {
    const { W, H } = this, pal = this.pal, a = this.a;
    const c0 = sampleCamera(this.keys, t);
    const e = this.camEnergy * this.num('drift');
    const cam = { x: c0.x + Math.sin(t * 0.19) * 18 * e + (t - c0.a.t) * 6 * e, y: c0.y + Math.cos(t * 0.15) * 9 * e, zoom: c0.zoom * (1 + 0.008 * e * Math.sin(t * 0.11)), roll: 0 };
    if (!mask && !this.s.transparentBackground) {
      g.fillStyle = pal.paper; g.fillRect(0, 0, W, H);
    }
    g.save();
    applyCamera(g, cam, W, H);
    const guides = mask ? 0 : this.num('guides');
    if (!mask && !this.s.transparentBackground) { // faint paper specks across the world
      g.fillStyle = rgba(pal.ink, 0.07);
      const s0 = Math.floor((cam.x - W / cam.zoom / 2) / 140), s1 = Math.ceil((cam.x + W / cam.zoom / 2) / 140);
      const r0 = Math.floor((cam.y - H / cam.zoom / 2) / 140), r1 = Math.ceil((cam.y + H / cam.zoom / 2) / 140);
      if ((s1 - s0) * (r1 - r0) < 4000) for (let i = s0; i <= s1; i++) for (let j = r0; j <= r1; j++) { const hx = hash01(i, j, 5); if (hx < 0.5) g.fillRect(i * 140 + hx * 220, j * 140 + hash01(i, j, 6) * 110, 3 + hx * 4, 3 + hx * 4); }
    }
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    const viewW = W / cam.zoom, viewH = H / cam.zoom;
    for (const z of this.zones) {
      if (z.t0 - 2 > t) continue;
      if (z.x - cam.x > viewW || cam.x - (z.x + z.w) > viewW || z.y - cam.y > viewH || cam.y - (z.y + z.h) > viewH) continue;
      this.zone(t, g, z, mask, guides);
    }
    if (!mask) {
      this.route(t, g, guides);
      this.vehicle(t, g);
      if (this.bool('annotations')) this.titleBlock(g);
    }
    g.restore();
    if (!mask) {
      this.opening(t, g);
      subtitle(g, this.ly.lines[lineAt(this.ly, t)], t, this.s, W, H, pal.ink);
    }
    void a;
  }

  private zone(t: number, g: Ctx2D, z: Zone, mask: boolean, guides: number): void {
    const pal = this.pal, a = this.a;
    g.save();
    g.translate(z.x, z.y);
    // chorus panel: a projected plane hinging up from 88° to flat over 0.55 s, just before the zone starts
    let ink = pal.ink;
    if (z.panel && !mask) {
      const u = clamp01((t - (z.t0 - 0.75)) / 0.55);
      if (u > 0) {
        const phi = (1 - easeOutCubic(u)) * (88 * Math.PI / 180);
        const rm = this.s.reduceMotion;
        g.save();
        if (rm) g.globalAlpha = u;
        else { // y' = y0 + d·cosφ with a mild perspective squeeze
          const persp = 2600 / (2600 + z.h * Math.sin(phi));
          g.transform(lerp(1, persp, 0.5), 0, 0, Math.max(0.02, Math.cos(phi)), (z.w * (1 - lerp(1, persp, 0.5))) / 2, 0);
        }
        g.fillStyle = pal.blue; g.fillRect(0, 0, z.w, z.h);
        g.strokeStyle = rgba(pal.paper, 0.13); g.lineWidth = 2;
        g.beginPath();
        for (let x = 120; x < z.w; x += 120) { g.moveTo(x, 0); g.lineTo(x, z.h); }
        for (let y = 120; y < z.h; y += 120) { g.moveTo(0, y); g.lineTo(z.w, y); }
        g.stroke();
        g.restore();
      }
      ink = pal.paper;
    }
    if (!mask && guides > 0) {
      // the rail: a "transfer guide" with tick marks every 240
      const ru = clamp01((t - (z.t0 - 0.6)) / 0.8);
      g.strokeStyle = rgba(pal.brass, guides); g.lineWidth = 4;
      g.beginPath(); g.moveTo(60, z.h - 90); g.lineTo(60 + (z.w - 120) * easeOutCubic(ru), z.h - 90); g.stroke();
      g.lineWidth = 3; g.beginPath();
      for (let x = 60; x < 60 + (z.w - 120) * ru; x += 240) { g.moveTo(x, z.h - 90); g.lineTo(x, z.h - 62); }
      g.stroke();
      // a brass hairline under every row extends as the row arrives
      g.lineWidth = 2;
      for (const r of z.rows) { const u = clamp01((t - (r.t - 0.3)) / 0.7); if (u <= 0) continue; g.beginPath(); g.moveTo(r.x0, r.y + r.cap * 0.2); g.lineTo(r.x0 + (r.x1 - r.x0) * easeOutCubic(u), r.y + r.cap * 0.2); g.stroke(); }
      if (this.bool('annotations') && t > z.t0 - 0.8) {
        setFont(g, 'mono', 26);
        g.fillStyle = z.panel ? rgba(pal.paper, 0.85) : rgba(pal.ink, 0.7);
        const f = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
        g.fillText(`${String(z.idx + 1).padStart(2, '0')} · ${z.label.toUpperCase()} · ${f(z.t0)}–${f(z.t1)}`, 110, 82);
        if (z.idx === 0) g.fillText(`${a.bpm.toFixed(0)} BPM · ${a.meter === 6 ? '6/8' : `${a.meter}/4`} · ${a.sections.length} SECTIONS · KEY ${keyName(a.key).toUpperCase()}`, 110, 118);
        else {
          const ch = a.chords.filter((c) => c.end > z.t0 && c.start < z.t1 && c.quality !== 'N').map(chordName).filter((n, i, arr) => arr.indexOf(n) === i).slice(0, 4);
          if (ch.length) g.fillText(ch.join('–'), 110, 118);
        }
        g.fillText('TRANSFER GUIDE', z.w - 360, z.h - 106);
        if (z.drop) { g.fillStyle = pal.orange; g.fillText(`DROP · T+${f(z.t0)}`, z.w - 420, 82); }
      }
    }
    // tower word: stands vertically (reading upward) at the zone's right edge, letter by letter
    if (z.tower) {
      const tw = z.tower;
      const letters = graphemes(tw.text);
      const start = tw.land - fr(3) * letters.length;
      if (t >= start) {
        g.save();
        g.translate(z.w - 150, z.h - 190);
        g.rotate(-Math.PI / 2);
        setFont(g, 'barlowSemi', tw.cap);
        let x = 0;
        if (!mask && guides > 0) { // brass column rules rise beside it
          const len = textWidth(tw.text, 'barlowSemi', tw.cap) * easeOutCubic(clamp01((t - start) / 0.8));
          g.strokeStyle = rgba(pal.brass, guides); g.lineWidth = 3;
          g.beginPath(); g.moveTo(0, 34); g.lineTo(len, 34); g.moveTo(0, -tw.cap - 34); g.lineTo(len, -tw.cap - 34); g.stroke();
        }
        letters.forEach((ch, i) => {
          const u = clamp01((t - start - i * fr(3)) / fr(10));
          const wd = g.measureText(ch).width;
          if (u > 0) { g.globalAlpha = u; g.fillStyle = mask ? maskFill(t - tw.land) : pal.orange; g.fillText(ch, x + (1 - easeOutBack(u)) * -40, 0); }
          x += wd;
        });
        g.restore();
      }
    }
    for (const it of z.items) this.item(t, g, it, ink, mask, z);
    g.restore();
  }

  private item(t: number, g: Ctx2D, it: Item, ink: string, mask: boolean, z: Zone): void {
    const k = it.k, age = t - it.land;
    if (age < -it.ent) return;
    const u = clamp01((age + it.ent) / it.ent);
    const pal = this.pal;
    const col = mask ? maskFill(age) : it.orange ? pal.orange : k.w.role === 'connective' ? rgba(ink, 0.82) : ink;
    setFont(g, k.font, k.cap);
    g.fillStyle = col;
    const x = k.x, y = k.y, cap = k.cap;
    g.save();
    switch (it.motion) {
      case 'conn': g.globalAlpha = u; g.fillText(k.text, x, y + (1 - easeOutCubic(u)) * cap * 0.3); break;
      case 'register': { // letters converge from a doubled echo
        const d = (1 - easeOutCubic(u)) * cap * 0.5;
        if (!mask && u < 1) { g.globalAlpha = 0.35 * u; g.fillText(k.text, x - d, y); g.fillText(k.text, x + d, y); }
        g.globalAlpha = u; g.fillText(k.text, x, y);
        break;
      }
      case 'impulse': g.globalAlpha = clamp01(u * 2); g.fillText(k.text, x - (1 - easeOutBack(u)) * cap * 1.6, y); break;
      case 'glide': g.globalAlpha = clamp01(u * 2); g.fillText(k.text, x + (1 - easeOutQuint(u)) * cap * 3, y); break;
      case 'impact': { // slides in and compresses an orange coil buffer at its left
        const sl = (1 - easeOutCubic(u)) * cap * 2.2;
        if (!mask) {
          const comp = 0.35 + 0.65 * (1 - u) + 0.25 * Math.exp(-Math.max(0, age) * 9) * Math.cos(age * 40);
          // the spring shows while it works, then fades
          g.save();
          g.globalAlpha = clamp01(1 - (age - 0.25) / 0.45);
          g.strokeStyle = pal.orange; g.lineWidth = Math.max(2, cap * 0.018); g.lineJoin = 'round';
          g.beginPath();
          const n = 4, len = cap * 0.5 * comp, x0 = x - cap * 0.14 - len + sl;
          for (let i = 0; i <= n * 2; i++) { const xx = x0 + (len * i) / (n * 2), yy = y - cap * 0.5 + (i % 2 ? -1 : 1) * cap * 0.2; if (i) g.lineTo(xx, yy); else g.moveTo(xx, yy); }
          g.stroke();
          g.restore();
        }
        g.globalAlpha = clamp01(u * 3); g.fillText(k.text, x + sl, y);
        break;
      }
      case 'hero': { // snaps from 0.56 cap right with a −0.04 cap settle
        const s = u < 0.75 ? lerp(0.56, -0.04, easeOutCubic(u / 0.75)) : lerp(-0.04, 0, (u - 0.75) / 0.25);
        g.globalAlpha = clamp01(u * 2.5); g.fillText(k.text, x + s * cap, y);
        break;
      }
      case 'assemble': { // letters fly in from seeded offsets and rotations
        let xx = x;
        graphemes(k.text).forEach((ch, i) => {
          const kk = 1 - easeOutCubic(clamp01(u * 1.25 - i * 0.03)), sd = k.w.id * 17 + i;
          const wd = g.measureText(ch).width;
          g.save(); g.globalAlpha = 1 - kk;
          g.translate(xx + wd / 2 + (hash01(sd, 1) - 0.5) * cap * 3 * kk, y - cap / 2 + (hash01(sd, 2) - 0.5) * cap * 2.4 * kk);
          g.rotate((hash01(sd, 3) - 0.5) * 2.4 * kk);
          g.fillText(ch, -wd / 2, cap / 2); g.restore();
          xx += wd;
        });
        break;
      }
      case 'rule': g.beginPath(); g.rect(x - 4, y - cap * 1.3, (k.width + 8) * easeOutCubic(u), cap * 1.8); g.clip(); g.fillText(k.text, x, y); break;
      case 'rise': g.beginPath(); g.rect(x - 4, y - cap * 1.25, k.width + 8, cap * 1.36); g.clip(); g.fillText(k.text, x, y + (1 - easeOutCubic(u)) * cap * 1.2); break;
      case 'compass': { // each O is drawn with a sweeping clip arc; a pale disc with craters grows in the counter
        let xx = x;
        for (const ch of graphemes(k.text)) {
          const wd = g.measureText(ch).width;
          if (/o/i.test(ch)) {
            g.save(); g.beginPath(); g.moveTo(xx + wd / 2, y - cap / 2); g.arc(xx + wd / 2, y - cap / 2, cap, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * easeOutCubic(u)); g.closePath(); g.clip(); g.fillText(ch, xx, y); g.restore();
            if (!mask) {
              const du = clamp01(age / 0.5 + 0.2);
              if (du > 0) {
                const r = cap * 0.27 * easeOutBack(du);
                g.fillStyle = '#E6E1D3'; g.beginPath(); g.arc(xx + wd / 2, y - cap / 2, r, 0, 7); g.fill();
                g.fillStyle = 'rgba(0,0,0,0.13)'; g.beginPath(); g.arc(xx + wd / 2 - r * 0.3, y - cap / 2 - r * 0.2, r * 0.22, 0, 7); g.arc(xx + wd / 2 + r * 0.35, y - cap / 2 + r * 0.3, r * 0.15, 0, 7); g.fill();
                g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = r * 0.07; g.beginPath(); g.arc(xx + wd / 2 + r * 0.1, y - cap / 2 - r * 0.45, r * 0.2, 0, 7); g.stroke();
                // a brass axis line drops from the disc to the zone's bottom
                const au = clamp01((age - 0.4) / 0.9);
                if (au > 0) { g.strokeStyle = rgba(pal.brass, this.num('guides')); g.lineWidth = 3; g.setLineDash([18, 10]); g.beginPath(); g.moveTo(xx + wd / 2, y - cap / 2 + r); g.lineTo(xx + wd / 2, lerp(y, z.h - 90, easeOutCubic(au))); g.stroke(); g.setLineDash([]); }
                g.fillStyle = col;
              }
            }
          } else { g.save(); g.beginPath(); g.rect(xx - 2, y - cap * 1.25, wd + 4, cap * 1.36); g.clip(); g.fillText(ch, xx, y + (1 - easeOutCubic(u)) * cap * 1.2); g.restore(); }
          xx += wd;
        }
        break;
      }
      default: g.globalAlpha = clamp01(u * 2); g.fillText(k.text, x, y - (1 - easeOutBack(u)) * cap * 0.25);
    }
    g.restore();
    // registration crosshairs and corner marks flash at each hero landing
    if (!mask && k.w.role === 'hero' && age >= 0 && age < 0.5 && this.num('guides') > 0) {
      g.save();
      g.globalAlpha = (1 - age / 0.5) * this.num('guides');
      g.strokeStyle = pal.orange; g.lineWidth = 3;
      const m = 18, x0 = x - m, x1 = x + k.width + m, y0 = y - cap - m, y1 = y + m, c = 30;
      g.beginPath();
      for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) { g.moveTo(cx + sx * c, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + sy * c); }
      g.moveTo(x1 + 30, y - cap / 2); g.lineTo(x1 + 80, y - cap / 2); g.moveTo(x1 + 55, y - cap / 2 - 25); g.lineTo(x1 + 55, y - cap / 2 + 25);
      g.stroke();
      g.restore();
    }
  }

  /** A dashed brass route arcs between zones as the next zone approaches. */
  private route(t: number, g: Ctx2D, guides: number): void {
    if (guides <= 0) return;
    for (let i = 0; i + 1 < this.zones.length; i++) {
      const a = this.zones[i], b = this.zones[i + 1];
      const u = clamp01((t - (b.t0 - 1.6)) / 1.2);
      if (u <= 0) continue;
      const p0 = [a.x + a.w - 60, a.y + a.h - 90], p2 = [b.x + 60, b.y + b.h - 90];
      const p1 = [(p0[0] + p2[0]) / 2, Math.min(p0[1], p2[1]) - 420];
      g.strokeStyle = rgba(this.pal.brass, guides); g.lineWidth = 4; g.setLineDash([26, 16]);
      g.beginPath();
      for (let k = 0; k <= 30 * u; k++) { const s = k / 30; const x = (1 - s) * (1 - s) * p0[0] + 2 * s * (1 - s) * p1[0] + s * s * p2[0], y = (1 - s) * (1 - s) * p0[1] + 2 * s * (1 - s) * p1[1] + s * s * p2[1]; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke(); g.setLineDash([]);
    }
  }

  /** The rocket rides the current zone's rail, hops on downbeats, arcs to the next zone and launches on drops. */
  private vehicle(t: number, g: Ctx2D): void {
    const kind = this.str('vehicle');
    if (kind === 'none' || !this.zones.length) return;
    const a = this.a, pal = this.pal;
    let zi = 0;
    for (let i = 0; i < this.zones.length; i++) if (this.zones[i].t0 - 1.2 <= t) zi = i;
    const z = this.zones[zi], next = this.zones[zi + 1];
    const railY = z.y + z.h - 90;
    let x = z.x + 60 + (z.w - 120) * clamp01((t - z.t0) / Math.max(1, (next ? next.t0 - 1.2 : z.t1 + 1) - z.t0));
    let y = railY, rot = Math.PI / 2, exhaust = 0;
    const rm = this.s.reduceMotion;
    // hop on downbeats
    const di = lowerBound(a.downbeats, t + 1e-6) - 1;
    if (di >= 0 && !rm) { const d = t - a.downbeats[di]; if (d < 0.32) y -= Math.sin((d / 0.32) * Math.PI) * 46 * this.react; }
    // altitude follows the vocal pitch contour (smoothed)
    const f0 = sample(a.f0, t);
    if (!Number.isNaN(f0) && sample(a.vocal, t) > 0.4) y -= clamp01((f0 - 50) / 30) * 70;
    if (next && t > next.t0 - 1.2) { // quadratic arc to the next zone during the last ~1.2 s
      const u = smooth(clamp01((t - (next.t0 - 1.2)) / 1.2));
      const p0 = [z.x + z.w - 60, railY], p2 = [next.x + 60, next.y + next.h - 90], p1 = [(p0[0] + p2[0]) / 2, Math.min(p0[1], p2[1]) - 420];
      x = (1 - u) * (1 - u) * p0[0] + 2 * u * (1 - u) * p1[0] + u * u * p2[0]; y = (1 - u) * (1 - u) * p0[1] + 2 * u * (1 - u) * p1[1] + u * u * p2[1];
      const dx = 2 * (1 - u) * (p1[0] - p0[0]) + 2 * u * (p2[0] - p1[0]), dy = 2 * (1 - u) * (p1[1] - p0[1]) + 2 * u * (p2[1] - p1[1]);
      rot = Math.atan2(dy, dx) + Math.PI / 2; exhaust = Math.sin(u * Math.PI);
    }
    // launch 520 units on drops
    if (this.bool('launch')) for (const d of a.drops) { const dt = t - d; if (dt >= 0 && dt < 1.6) { const u = dt / 1.6; y -= 520 * Math.sin(u * Math.PI) * (1 - 0.3 * u); rot = 0; exhaust = Math.max(exhaust, 1 - u); } }
    // after the last word it departs up and out along an arc
    if (t > this.last + 0.6) { const u = clamp01((t - this.last - 0.6) / 2.4); x += 900 * u * u; y -= 2400 * u * u; rot = 0.5 * u; exhaust = 1; }
    g.save();
    g.translate(x, y);
    if (kind === 'concept icon') { g.fillStyle = pal.orange; g.translate(0, -70); drawIcon(g, this.icon, 70); g.restore(); return; }
    g.rotate(rot - Math.PI / 2 + (rot === Math.PI / 2 ? 0 : 0));
    g.rotate(rot === Math.PI / 2 ? 0 : 0);
    const S = 360 / 360;
    g.scale(S, S);
    g.translate(0, -180);
    if (exhaust > 0.02) { // orange exhaust while transferring
      g.fillStyle = rgba(pal.orange, 0.85 * exhaust);
      g.beginPath(); g.moveTo(-34, 150); g.quadraticCurveTo(0, 150 + 240 * exhaust * (0.8 + 0.2 * Math.sin(t * 50)), 34, 150); g.fill();
    }
    g.fillStyle = pal.ink; g.beginPath(); g.moveTo(-60, 150); g.lineTo(-100, 190); g.lineTo(-52, 60); g.fill(); g.beginPath(); g.moveTo(60, 150); g.lineTo(100, 190); g.lineTo(52, 60); g.fill();
    g.fillStyle = '#FBF8F0'; g.strokeStyle = pal.ink; g.lineWidth = 5;
    g.beginPath(); g.moveTo(-55, 150); g.lineTo(-55, -70); g.quadraticCurveTo(-55, -150, 0, -185); g.quadraticCurveTo(55, -150, 55, -70); g.lineTo(55, 150); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = pal.orange; g.beginPath(); g.moveTo(-50, -92); g.quadraticCurveTo(-46, -150, 0, -180); g.quadraticCurveTo(46, -150, 50, -92); g.closePath(); g.fill();
    g.strokeStyle = pal.ink; g.lineWidth = 4; g.beginPath(); g.moveTo(-55, -88); g.lineTo(55, -88); g.moveTo(-55, 70); g.lineTo(55, 70); g.moveTo(-55, 96); g.lineTo(55, 96); g.stroke();
    g.fillStyle = pal.blue; g.beginPath(); g.arc(0, -20, 24, 0, 7); g.fill(); g.stroke();
    g.fillStyle = pal.ink; g.fillRect(-36, 150, 72, 18);
    g.restore();
  }

  private titleBlock(g: Ctx2D): void {
    const s = this.s, pal = this.pal;
    if (!(s.title || s.artist)) return;
    const x = this.poster.w - 40, y = -40;
    g.save();
    g.textAlign = 'right';
    setFont(g, 'barlowSemi', 60); g.fillStyle = pal.ink; g.fillText((s.title || '').toUpperCase(), x, y - 60);
    setFont(g, 'mono', 28); g.fillStyle = rgba(pal.ink, 0.75); g.fillText((s.artist || '').toUpperCase(), x, y - 16);
    g.fillStyle = pal.brass; g.fillText('LYRIC EXCERPT', x, y - 150);
    g.restore();
  }

  /** Title and a brass countdown where the first row will land; fades as the first word arrives. */
  private opening(t: number, g: Ctx2D): void {
    if (this.first < 1.2 || t > this.first + 0.2) return;
    const { W, H } = this, pal = this.pal, s = this.s;
    const fade = clamp01(t / 0.4) * clamp01((this.first - 0.15 - t) / 0.45);
    if (fade <= 0) return;
    g.save();
    g.globalAlpha = fade;
    const cap = Math.min(W, H) * 0.075, x = W * 0.09, y = H * 0.52;
    setFont(g, 'mono', cap * 0.3);
    g.fillStyle = pal.brass;
    const rem = this.first - t;
    g.fillText(`T−${String(Math.floor(rem / 60)).padStart(2, '0')}:${(rem % 60).toFixed(2).padStart(5, '0')}   ${this.a.meter === 6 ? '6/8' : `${this.a.meter}/4`} · ${this.a.bpm.toFixed(0)} BPM`, x, y - cap * 1.45);
    setFont(g, 'barlowSemi', cap); g.fillStyle = pal.ink;
    g.fillText((s.title || 'UNTITLED').toUpperCase(), x, y, W * 0.84);
    setFont(g, 'barlow', cap * 0.34); g.fillStyle = rgba(pal.ink, 0.75);
    if (s.artist) g.fillText(s.artist.toUpperCase(), x, y + cap * 0.7);
    // a brass rule under the title fills as it counts
    g.fillStyle = rgba(pal.brass, 0.35); g.fillRect(x, y + cap * 0.22, W * 0.5, Math.max(2, H * 0.004));
    g.fillStyle = pal.brass; g.fillRect(x, y + cap * 0.22, W * 0.5 * clamp01(t / Math.max(0.1, this.first)), Math.max(2, H * 0.004));
    g.restore();
  }
}
registerEffect(Mission);

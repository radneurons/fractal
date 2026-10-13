// MISSION POSTER — the song is built as an engineering poster, generalised from "Because They Are Hard".
// Sections become zones on a large poster (choruses are hinged blueprint panels), lines sit on brass
// baselines with stacked connectives, one hero per zone stands as a vertical tower, the first O-word
// carries a lunar disc, monospace annotations come from the analysis, and a vehicle rides the rails
// through the song, launching on drops. The ending pulls back to the whole poster.
import type { ParamSpec, Params, Word } from '../types';
import { type Effect, type EffectContext, type EffectFactory, clamp, lerp, prog, eIO, eOut, eOut5, eIn, eBack, rng, defaults, displayText } from './types';
import { fontCSS, capRatio, type FontKey } from '../render/sdf';
import { drawIcon } from '../render/icons';
import { sample } from '../analysis/dsp';

const PARAMS: ParamSpec[] = [
  { key: 'palette', label: 'Palette', group: 'Look', type: 'select', options: ['mission', 'blueprint', 'daylight', 'mars'], default: 'mission', help: 'Ink/paper/panel colours', live: true },
  { key: 'panels', label: 'Blueprint panels', group: 'Look', type: 'select', options: ['chorus', 'all', 'none'], default: 'chorus', help: 'Which zones sit on hinged blueprint panels', live: false },
  { key: 'annotations', label: 'Annotations', group: 'Look', type: 'toggle', default: true, help: 'Monospace labels: tempo, section timecodes, drops', live: true },
  { key: 'guides', label: 'Construction lines', group: 'Look', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6, help: 'Brass baselines, axes, registration marks', live: true },
  { key: 'heroScale', label: 'Hero size', group: 'Layout', type: 'range', min: 0.6, max: 1.6, step: 0.01, default: 1, help: 'Size of hero words relative to the zone', live: false },
  { key: 'zoneWidth', label: 'Zone width', group: 'Layout', type: 'range', min: 1400, max: 3400, step: 10, default: 2300, help: 'Width of each section zone on the poster', live: false },
  { key: 'tower', label: 'Tower word per zone', group: 'Layout', type: 'toggle', default: true, help: 'The longest hero of a zone stands vertically as a column', live: false },
  { key: 'vehicle', label: 'Vehicle', group: 'Vehicle', type: 'select', options: ['rocket', 'concept icon', 'none'], default: 'rocket', help: 'What rides the rails (concept icon = the song’s most common image)', live: false },
  { key: 'launchOnDrop', label: 'Launch on drops', group: 'Vehicle', type: 'toggle', default: true, help: 'Vehicle fires its engine and leaps at drops', live: true },
  { key: 'moonDisc', label: 'Lunar disc in an O', group: 'Imagery', type: 'toggle', default: true, help: 'The first big O-word gets a moon in its counter', live: false },
  { key: 'camDrift', label: 'Camera drift', group: 'Camera', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, help: 'Slow push along each line', live: false },
  { key: 'pullback', label: 'Zone pull-backs', group: 'Camera', type: 'toggle', default: true, help: 'Pull back to show the finished zone between sections', live: false }
];

interface Pal { ink: string; paper: string; blue: string; orange: string; brass: string; dim: string }
const PALS: Record<string, Pal> = {
  mission: { ink: '#101923', paper: '#F0EBDD', blue: '#23485E', orange: '#D96B35', brass: '#C3A36A', dim: '#7E8A93' },
  blueprint: { ink: '#0E2A47', paper: '#EAF2FA', blue: '#1A4A78', orange: '#FFB03B', brass: '#9CC3E6', dim: '#7FA4C6' },
  daylight: { ink: '#EDE7D9', paper: '#14161A', blue: '#C9D6DC', orange: '#D2492A', brass: '#8C6D3A', dim: '#8A8780' },
  mars: { ink: '#1E0F0C', paper: '#F3E3D3', blue: '#5A2A1E', orange: '#FF7A3D', brass: '#D9A066', dim: '#9A7D72' }
};

const FR = 1 / 60;
type Motion = 'conn' | 'register' | 'impulse' | 'glide' | 'impact' | 'hero' | 'assemble' | 'rule' | 'rise' | 'snap' | 'tower' | 'settle' | 'stop' | 'compass';
const ENTER: Record<Motion, number> = { conn: 7, register: 26, impulse: 14, compass: 26, glide: 28, impact: 16, hero: 22, assemble: 22, rule: 22, rise: 14, snap: 12, tower: 34, settle: 16, stop: 18 };

interface Node { text: string; f: FontKey; cap: number; x: number; y: number; rot: number; w: number; xs: number[]; t: number; start: number; motion: Motion; word: Word; zone: Zone; row: Row; hero: boolean; color: 'paper' | 'orange'; disc?: { i: number; r: number } }
interface Row { x0: number; x1: number; y: number; cap: number; t: number; nodes: Node[] }
interface Zone { idx: number; label: string; x: number; y: number; w: number; h: number; panel: boolean; t0: number; t1: number; rows: Row[]; nodes: Node[]; railY: number; tower?: Node }
interface Key { t: number; cx: number; cy: number; zoom: number }

class MissionEffect implements Effect {
  readonly id = 'mission'; readonly name = 'Mission Poster'; readonly description = 'The song is built as an engineering poster: blueprint panels, brass guides, a vertical tower word, a lunar disc, and a vehicle that rides the rails and launches on drops.';
  readonly params = PARAMS;
  private p: Params = defaults(PARAMS);
  private ctx!: EffectContext;
  private mc = document.createElement('canvas').getContext('2d')!;
  private zones: Zone[] = []; private nodes: Node[] = []; private keys: Key[] = [];
  private world = { w: 1, h: 1 }; private specks: number[][] = []; private vehicleIcon = 'rocket';
  private head = { x: 0, y: 0 }; private hops: number[] = [];

  async prepare(ctx: EffectContext) { this.ctx = ctx; this.p = { ...defaults(PARAMS), ...ctx.params }; this.build(); }
  setParams(p: Params) { this.p = { ...this.p, ...p }; }
  dispose() { /* nothing */ }
  private pal() { return PALS[String(this.p.palette)] ?? PALS.mission; }
  private measure(f: FontKey, cap: number, s: string) { this.mc.font = fontCSS(f, cap / capRatio(f)); return this.mc.measureText(s).width; }
  private xsOf(f: FontKey, cap: number, s: string) { this.mc.font = fontCSS(f, cap / capRatio(f)); const xs: number[] = []; for (let i = 0; i <= s.length; i++) xs.push(this.mc.measureText(s.slice(0, i)).width); return xs; }

  private build() {
    const { song, settings, width: W, height: H } = this.ctx; const ly = song.lyrics, a = song.analysis;
    const off = settings.syncOffsetMs / 1000, R = rng(settings.seed * 13 + 5);
    const up = (s: string) => displayText(s, settings.caseMode === 'lower' ? 'lower' : settings.caseMode === 'as-is' ? 'as-is' : 'upper');
    const portrait = H > W;
    const ZW = Number(this.p.zoneWidth) * (portrait ? .62 : 1), HS = Number(this.p.heroScale);
    const panelMode = String(this.p.panels);
    this.zones = []; this.nodes = []; this.keys = []; this.hops = [];

    // group lines by section → zones
    const bySec = new Map<number, number[]>();
    for (const L of ly.lines) { if (!L.words.length) continue; if (!bySec.has(L.section)) bySec.set(L.section, []); bySec.get(L.section)!.push(L.idx); }
    const secIds = [...bySec.keys()].sort((x, y) => x - y);
    // split very long sections (> 8 lines) into several zones
    const zoneLines: { sec: number; lines: number[] }[] = [];
    for (const s of secIds) { const ls = bySec.get(s)!; for (let i = 0; i < ls.length; i += 8) zoneLines.push({ sec: s, lines: ls.slice(i, i + 8) }); }

    // concept icon for the vehicle
    const cnt = new Map<string, number>(); for (const w of ly.words) if (w.concept) cnt.set(w.concept, (cnt.get(w.concept) ?? 0) + 1);
    const ICON: Record<string, string> = { fire: 'flame', light: 'sun', water: 'drop', shock: 'bolt', wind: 'wing', vortex: 'spiral', quake: 'mountain', ice: 'flake', smoke: 'cloud', heart: 'heart', home: 'house', moon: 'moon', time: 'clock', road: 'road', crown: 'crown', bird: 'bird', eye: 'eye', music: 'note', key: 'key', flower: 'flower', people: 'people', star: 'star' };
    const top = [...cnt.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    this.vehicleIcon = String(this.p.vehicle) === 'concept icon' && top ? ICON[top] ?? 'star' : 'rocket';

    let discDone = !this.p.moonDisc;
    zoneLines.forEach((zl, zi) => {
      const sec = a.sections[zl.sec]; const label = sec?.label ?? 'verse';
      const panel = panelMode === 'all' || (panelMode === 'chorus' && (label === 'chorus' || label === 'drop'));
      const z: Zone = { idx: zi, label, x: 0, y: 0, w: ZW, h: 0, panel, t0: 0, t1: 0, rows: [], nodes: [], railY: 0 };
      // choose a tower word: longest hero (≥ 6 letters) in a zone of ≥ 3 lines
      let towerW: Word | null = null;
      if (this.p.tower && zl.lines.length >= 3) {
        const heroes = zl.lines.flatMap(li => ly.lines[li].words.map(id => ly.words[id])).filter(w => w.role === 'hero' && w.display.replace(/[^\p{L}]/gu, '').length >= 6);
        towerW = heroes.sort((x, y) => y.display.length - x.display.length)[0] ?? null;
      }
      const towerCap = 170 * HS;
      const innerW = ZW - (towerW ? towerCap * 1.5 : 0) - 140;
      let y = 260;
      for (const li of zl.lines) {
        const L = ly.lines[li];
        const ws = L.words.map(id => ly.words[id]).filter(w => w !== towerW);
        // tokens: big words + stacks of connectives (≤ 3, two rows) that sit to the left of the next big word
        let x = 0, rowCap = 0; let row: Row = { x0: 0, x1: 0, y: 0, cap: 0, t: 0, nodes: [] };
        const rows: Row[] = [];
        const pending: Node[] = [];
        const flushRow = () => { if (!row.nodes.length) return; rows.push(row); row = { x0: 0, x1: 0, y: 0, cap: 0, t: 0, nodes: [] }; x = 0; rowCap = 0; };
        for (let i = 0; i < ws.length; i++) {
          const w = ws[i];
          if (w.role === 'connective') {
            // gather the run
            let j = i; const run: Word[] = []; while (j < ws.length && ws[j].role === 'connective' && run.length < 4) run.push(ws[j++]);
            const cap = 50 * HS, gap = cap * .3;
            const rowsTxt = run.length <= 2 ? [run] : [run.slice(0, Math.ceil(run.length / 2)), run.slice(Math.ceil(run.length / 2))];
            const wds = rowsTxt.map(r => r.map(q => this.measure('barlow5', cap, up(q.display))).reduce((s2, v) => s2 + v, 0) + gap * (r.length - 1));
            const bw = Math.max(...wds);
            if (x && x + bw + 30 > innerW) flushRow();
            let k = 0;
            rowsTxt.forEach((r, ri) => {
              let xx = x;
              for (const q of r) {
                const tx = up(q.display); const n = this.mkNode(tx, 'barlow5', cap, xx, (rowsTxt.length - 1 - ri), 'conn', q, z, row, off);
                (n as Node & { stackRow: number }).stackRow = rowsTxt.length - 1 - ri; pending.push(n);
                xx += n.w + gap; k++;
              }
            });
            x += bw + 30; rowCap = Math.max(rowCap, cap); i = j - 1; void k;
            continue;
          }
          const isHero = w.role === 'hero';
          const f: FontKey = isHero ? 'semi' : 'barlow7';
          const cap = (isHero ? (150 + 100 * w.stress) : 78 + 30 * w.stress) * HS;
          const tx = up(w.display);
          let ww = this.measure(f, cap, tx);
          let cap2 = cap; if (ww > innerW) { cap2 = cap * innerW / ww * .98; ww = innerW * .98; }
          if (x && x + ww > innerW) flushRow();
          const motion: Motion = this.pickMotion(w, isHero, i === ws.length - 1, R);
          const n = this.mkNode(tx, f, cap2, x, 0, motion, w, z, row, off); n.hero = isHero;
          if (!discDone && isHero && /O/.test(tx.slice(1)) && cap2 > 180) { const oi = tx.indexOf('O', 1); n.disc = { i: oi, r: 0 }; n.motion = 'compass'; n.start = n.t - ENTER.compass * FR; discDone = true; }
          if (w.concept === 'fire' || w.concept === 'heart' || w.concept === 'shock') n.color = 'orange';
          x += ww + cap2 * .22; rowCap = Math.max(rowCap, cap2);
          row.cap = rowCap;
        }
        flushRow();
        // vertical placement of rows; stacked connectives align to the row baseline
        for (const r of rows) {
          r.cap = Math.max(...r.nodes.map(n => n.cap)); y += r.cap; r.y = y;
          for (const n of r.nodes) {
            const sr = (n as Node & { stackRow?: number }).stackRow;
            n.y = r.y - (sr ? sr * n.cap * 1.35 : 0);
          }
          r.x0 = 0; r.x1 = Math.max(...r.nodes.map(n => n.x + n.w)); r.t = Math.min(...r.nodes.map(n => n.t));
          z.rows.push(r); y += r.cap * .3 + 40;
        }
        void pending;
        y += 40;
      }
      z.h = Math.max(y + 260, towerW ? this.measure('semi', towerCap, up(towerW.display)) + 520 : 0);
      z.railY = z.h - 150;
      if (towerW) {
        const tx = up(towerW.display);
        const n = this.mkNode(tx, 'semi', towerCap, ZW - 40, z.h - 300, 'tower', towerW, z, { x0: 0, x1: 0, y: 0, cap: towerCap, t: 0, nodes: [] }, off);
        n.rot = -Math.PI / 2; n.hero = true; z.tower = n;
        n.row.nodes.push(n); n.row.t = n.t; n.row.y = n.y;
      }
      z.nodes = this.nodes.filter(n => n.zone === z);
      const ts = z.nodes.map(n => n.t); z.t0 = Math.min(...ts); z.t1 = Math.max(...z.nodes.map(n => n.word.end + off));
      this.zones.push(z);
    });

    // place zones on the poster: rows of `cols` zones, snake order
    const n = this.zones.length, G = 320;
    // pick the column count whose poster aspect is closest to the frame's
    let cols = 1, bestErr = 1e9;
    for (let cc = 1; cc <= n; cc++) {
      let hh = 520; for (let r = 0; r * cc < n; r++) hh += Math.max(...this.zones.slice(r * cc, r * cc + cc).map(z => z.h)) + G;
      const ww = 600 + cc * ZW + (cc - 1) * G, err = Math.abs(Math.log((ww / hh) / (W / H)));
      if (err < bestErr) { bestErr = err; cols = cc; }
    }
    let yy = 520;
    for (let r = 0; r * cols < n; r++) {
      const rowZ = this.zones.slice(r * cols, r * cols + cols);
      const hMax = Math.max(...rowZ.map(z => z.h));
      rowZ.forEach((z, k) => { const col = r % 2 ? cols - 1 - k : k; z.x = 300 + col * (ZW + G); z.y = yy; z.railY = hMax - 150; z.h = hMax; });
      yy += hMax + G;
    }
    this.world = { w: 300 * 2 + cols * ZW + (cols - 1) * G, h: yy + 200 };
    // absolute coordinates
    for (const z of this.zones) for (const nd of z.nodes) { nd.x += z.x + 70; nd.y += z.y; }
    for (const z of this.zones) for (const r of z.rows) { r.x0 += z.x + 70; r.x1 += z.x + 70; r.y += z.y; }
    for (const z of this.zones) if (z.tower) { z.tower.x = z.x + ZW - 40; z.tower.y = z.y + z.railY - 60; }
    // lunar disc radius
    for (const nd of this.nodes) if (nd.disc) { const i = nd.disc.i; nd.disc.r = (nd.xs[i + 1] - nd.xs[i]) * .27; }
    // speckles
    const RS = rng(1962); this.specks = Array.from({ length: 1800 }, () => [RS() * this.world.w, RS() * this.world.h, 1 + RS() * 3.2, .025 + RS() * .05]);
    // vehicle hops on downbeats
    this.hops = a.downbeats.slice();
    this.buildCamera();
  }

  private pickMotion(w: Word, hero: boolean, last: boolean, R: () => number): Motion {
    if (!hero) return last && /[,.!?]$/.test(w.display) ? 'stop' : R() < .5 ? 'snap' : R() < .5 ? 'rule' : 'settle';
    const c = w.concept;
    if (c === 'shock' || c === 'quake') return 'impact';
    if (c === 'wind' || c === 'water' || c === 'road') return 'glide';
    if (c === 'light' || c === 'fire' || c === 'flower' || c === 'star') return 'rise';
    if (w.display.length <= 3) return 'impulse';
    const r = R();
    return r < .3 ? 'register' : r < .5 ? 'assemble' : r < .7 ? 'hero' : r < .85 ? 'glide' : 'settle';
  }

  private mkNode(text: string, f: FontKey, cap: number, x: number, y: number, motion: Motion, word: Word, zone: Zone, row: Row, off: number): Node {
    const xs = this.xsOf(f, cap, text);
    const t = word.start + off;
    const n: Node = { text, f, cap, x, y, rot: 0, w: xs[xs.length - 1], xs, t, start: t - ENTER[motion] * FR - this.ctx.settings.anticipationMs / 2000, motion, word, zone, row, hero: false, color: 'paper' };
    row.nodes.push(n); this.nodes.push(n); return n;
  }

  private buildCamera() {
    const { width: W, height: H, song } = this.ctx; const dur = song.analysis.duration;
    const drift = Number(this.p.camDrift) * this.ctx.settings.cameraEnergy / 100;
    const K: Key[] = [];
    const fit = (x0: number, y0: number, x1: number, y1: number, fill = .82): Key => ({ t: 0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, zoom: Math.min(W * fill / Math.max(1, x1 - x0), H * .8 / Math.max(1, y1 - y0)) });
    const all = fit(0, 0, this.world.w, this.world.h, .94);
    const rows = this.zones.flatMap(z => z.rows.map(r => ({ r, z }))).sort((x, y) => x.r.t - y.r.t);
    if (!rows.length) { this.keys = [{ ...all, t: 0 }]; return; }
    const minW = Math.min(1500, this.zones[0].w * .7);
    const rowKey = (r: Row): Key => {
      const x0 = r.x0 - 60, x1 = Math.max(r.x1 + 60, x0 + minW);
      const k = fit(x0, r.y - r.cap * 2.2, x1, r.y + r.cap * 1.1, .86);
      return k;
    };
    K.push({ ...rowKey(rows[0].r), t: 0, zoom: rowKey(rows[0].r).zoom * .85 });
    let prevZ = rows[0].z;
    rows.forEach(({ r, z }, i) => {
      if (z !== prevZ && this.p.pullback) {
        const lastRow = rows[i - 1].r; const tEnd = Math.max(...lastRow.nodes.map(n => n.word.end)) + this.ctx.settings.syncOffsetMs / 1000;
        if (r.t - tEnd > 1.4) { const zk = fit(prevZ.x, prevZ.y, prevZ.x + prevZ.w, prevZ.y + prevZ.h, .9); K.push({ ...zk, t: tEnd + .5 }); K.push({ ...zk, t: Math.max(tEnd + .6, r.t - .7), zoom: zk.zoom * 1.03 }); }
      }
      prevZ = z;
      const k = rowKey(r);
      const t0 = r.t - .35;
      if (K.length && t0 - K[K.length - 1].t < .15) K.pop();
      K.push({ ...k, t: t0 });
      const next = rows[i + 1]?.r.t ?? r.t + 3;
      const hold = Math.max(t0 + .3, next - .5);
      K.push({ ...k, t: hold, zoom: k.zoom * (1 + .05 * drift), cx: k.cx + (r.x1 - r.x0) * .04 * drift });
    });
    const lastT = K[K.length - 1].t;
    if (dur - lastT > 1.5) { K.push({ ...all, t: Math.min(dur - .3, lastT + Math.min(3, (dur - lastT) * .5)) }); K.push({ ...all, t: dur, zoom: all.zoom * 1.02 }); }
    K.sort((x, y) => x.t - y.t);
    this.keys = K.filter((k, i) => i === 0 || k.t > K[i - 1].t + 1e-4);
  }
  private camAt(t: number): Key {
    const K = this.keys; if (t <= K[0].t) return K[0]; if (t >= K[K.length - 1].t) return K[K.length - 1];
    let lo = 0, hi = K.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (K[m].t <= t) lo = m; else hi = m; }
    const a = K[lo], b = K[hi], q = eIO((t - a.t) / Math.max(1e-6, b.t - a.t));
    return { t, cx: lerp(a.cx, b.cx, q), cy: lerp(a.cy, b.cy, q), zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), q)) };
  }

  // ───────────── drawing ─────────────
  private drawWord(c: CanvasRenderingContext2D, n: Node, t: number) {
    if (t < n.start) return;
    const P = this.pal(); const p = prog(t, n.start, n.t), cap = n.cap;
    let dx = 0, dy = 0, alpha = 1;
    let per: ((i: number) => { a?: number; dx?: number; dy?: number; rot?: number; echo?: number; echoA?: number } | null) | null = null;
    let clip: ((c3: CanvasRenderingContext2D) => void) | null = null;
    switch (n.motion) {
      case 'conn': dy = (1 - eOut(p)) * cap * .3; alpha = eOut(p); break;
      case 'register': per = i => { const st = n.start + i * 2 * FR, q = prog(t, st, st + 14 * FR); if (q <= 0) return null; const conv = eIO(prog(t, st + 4 * FR, st + 14 * FR)); return { a: eOut(clamp(q * 2)), echo: (1 - conv) * cap * .1, echoA: .5 * (1 - conv) }; }; break;
      case 'impulse': dx = -(1 - eBack(p, 2.2)) * cap * .55; alpha = clamp(p * 3); break;
      case 'glide': dx = (1 - eOut5(p)) * n.w * 1.25; alpha = clamp(p * 4); break;
      case 'impact': { const tc = n.t - 4 * FR; if (t < tc) { const q = prog(t, n.start, tc); dx = (1 - Math.pow(q, 1.6)) * n.w * 1.05 - 26 * eIn(q); alpha = clamp(q * 5); } else { const q = prog(t, tc, n.t + 4 * FR); dx = -26 * (1 - eOut(q)); } break; }
      case 'hero': { const a0 = n.start, b0 = a0 + 4 * FR, c2 = b0 + 10 * FR; if (t < b0) { alpha = 0; } else if (t < c2) { const q = eOut(prog(t, b0, c2)); dx = lerp(cap * .56, -cap * .04, q); alpha = clamp(q * 2); } else dx = -cap * .04 * (1 - eOut(prog(t, c2, n.t))); break; }
      case 'assemble': per = i => { const st = n.start + i * 2 * FR, q = eOut(prog(t, st, st + 12 * FR)); if (q <= 0) return null; const r = rng(i * 77 + n.text.length * 13); return { a: clamp(q * 2), dx: (r() - .5) * cap * 1.2 * (1 - q), dy: (r() - .4) * cap * 1.4 * (1 - q), rot: (r() - .5) * .5 * (1 - q) }; }; break;
      case 'rule': { const q = eIO(p); clip = c3 => c3.rect(-cap * .2, -cap * 1.3, (n.w + cap * .4) * q, cap * 1.8); break; }
      case 'rise': clip = c3 => c3.rect(-cap, -cap * 1.4, n.w + cap * 2, cap * 1.4 + 2); dy = (1 - eOut(p)) * cap * 1.15; break;
      case 'snap': { const b0 = n.t - 4 * FR; if (t < b0) { dx = cap * .14; dy = -cap * .1; alpha = .55 * eOut(prog(t, n.start, n.start + 4 * FR)); } else { const q = prog(t, b0, n.t); dx = cap * .14 * (1 - eOut(q)); dy = -cap * .1 * (1 - eOut(q)); alpha = lerp(.55, 1, q); } break; }
      case 'tower': per = i => { const st = n.start + i * 3 * FR, q = eOut(prog(t, st, st + 10 * FR)); return q <= 0 ? null : { a: q, dx: -(1 - q) * cap * .5 }; }; break;
      case 'settle': dy = -(1 - eOut(p)) * cap * .45; alpha = clamp(p * 2.5); break;
      case 'stop': dx = (1 - eOut5(p)) * n.w * .9; alpha = clamp(p * 4); break;
      case 'compass': per = i => {
        if (n.text[i] === 'O') { const st = n.start + (i === n.disc!.i ? 2 : 6) * FR, q = eIO(prog(t, st, st + 16 * FR)); return q <= 0 ? null : { a: 1, echo: -q }; }
        const st = n.start + (i === 0 ? 0 : 10) * FR, q = eOut(prog(t, st, st + 14 * FR)); return q <= 0 ? null : { a: 1, dy: (1 - q) * cap * .9, echo: 2 };
      }; break;
    }
    c.save(); c.translate(n.x, n.y); if (n.rot) c.rotate(n.rot); c.translate(dx, dy); c.globalAlpha *= alpha;
    c.fillStyle = n.color === 'orange' ? P.orange : P.paper; c.font = fontCSS(n.f, cap / capRatio(n.f));
    if (clip) { c.beginPath(); clip(c); c.clip(); }
    if (!per) c.fillText(n.text, 0, 0);
    else for (let i = 0; i < n.text.length; i++) {
      const ch = n.text[i]; if (ch === ' ') continue; const r = per(i); if (!r) continue;
      const x0 = n.xs[i], gcx = (n.xs[i] + n.xs[i + 1]) / 2, gcy = -cap / 2;
      if (n.motion === 'compass') {
        c.save();
        if (r.echo !== undefined && r.echo < 0 && -r.echo < 1) { c.beginPath(); c.moveTo(gcx, gcy); c.arc(gcx, gcy, cap, -Math.PI / 2, -Math.PI / 2 - r.echo * Math.PI * 2); c.closePath(); c.clip(); }
        if (r.echo === 2) { c.beginPath(); c.rect(x0 - 40, -cap * 1.2, n.xs[i + 1] - x0 + 80, cap * 1.2 + 2); c.clip(); }
        c.translate(0, r.dy ?? 0); c.fillText(ch, x0, 0); c.restore(); continue;
      }
      if (r.echo) { c.save(); c.globalAlpha *= r.echoA ?? 0; for (const sg of [-1, 1]) c.fillText(ch, x0 + sg * r.echo, -sg * r.echo * .35); c.restore(); }
      c.save(); c.globalAlpha *= r.a ?? 1; c.translate(gcx + (r.dx ?? 0), gcy + (r.dy ?? 0)); if (r.rot) c.rotate(r.rot); c.translate(-gcx, -gcy); c.fillText(ch, x0, 0); c.restore();
    }
    c.restore();
    if (n.disc) this.drawDisc(c, n, t);
    if (n.motion === 'impact') this.drawBuffer(c, n, t);
  }

  private drawDisc(c: CanvasRenderingContext2D, n: Node, t: number) {
    const d = n.disc!, i = d.i, cx = n.x + (n.xs[i] + n.xs[i + 1]) / 2, cy = n.y - n.cap / 2, r = d.r;
    const q = eOut(prog(t, n.t - 8 * FR, n.t + 10 * FR)); if (q <= 0) return;
    c.save(); c.beginPath(); c.arc(cx, cy, r * q, 0, Math.PI * 2); c.fillStyle = '#E6E1D3'; c.fill();
    const mq = prog(t, n.t + 4 * FR, n.t + 16 * FR);
    if (mq > 0) { c.globalAlpha *= mq; c.fillStyle = '#C9C3B4'; c.beginPath(); c.arc(cx - r * .32, cy - r * .22, r * .2, 0, 7); c.fill(); c.beginPath(); c.arc(cx + r * .3, cy + r * .28, r * .13, 0, 7); c.fill(); c.strokeStyle = '#BDB7A8'; c.lineWidth = r * .03; c.beginPath(); c.arc(cx + r * .12, cy - r * .45, r * .09, 0, 7); c.stroke(); }
    c.restore();
    // brass axis line down from the disc
    const g = Number(this.p.guides); if (g <= 0) return;
    const lq = eOut(prog(t, n.t + .2, n.t + 1.2));
    c.save(); c.strokeStyle = this.pal().brass; c.globalAlpha *= .7 * g; c.lineWidth = 3; c.beginPath(); c.moveTo(cx, cy + r + 30); c.lineTo(cx, cy + r + 30 + lq * (n.zone.y + n.zone.h - cy)); c.stroke(); c.restore();
  }
  private drawBuffer(c: CanvasRenderingContext2D, n: Node, t: number) {
    const P = this.pal(); const tc = n.t - 4 * FR; const comp = t < tc ? 26 * eIn(prog(t, n.start, tc)) : 26 * (1 - eOut(prog(t, tc, n.t + 4 * FR)));
    if (t < n.start) return;
    const x = n.x - n.cap * .2, h = n.cap * .8, coils = 7, w = n.cap * .16 - comp * .5;
    c.save(); c.strokeStyle = P.orange; c.lineWidth = 4; c.globalAlpha *= clamp(prog(t, n.start, n.start + .1));
    c.beginPath(); for (let k = 0; k <= coils * 2; k++) { const xx = x - w + (k / (coils * 2)) * w * 2 - comp; const yy = n.y - (k % 2 ? h : n.cap * .1); k ? c.lineTo(xx, yy) : c.moveTo(xx, yy); } c.stroke();
    c.restore();
  }

  private drawPanel(c: CanvasRenderingContext2D, z: Zone, t: number) {
    const P = this.pal(); if (!z.panel || t < z.t0 - 1.2) return;
    const phi = (1 - eIO(prog(t, z.t0 - 1.0, z.t0 - .45))) * 88 * Math.PI / 180;
    const y0 = z.y + 120, x0 = z.x, x1 = z.x + z.w, y1 = z.y + z.h;
    const D = 2600; const proj = (x: number, y: number): [number, number] => { const d = y - y0, Y = y0 + d * Math.cos(phi), Zz = d * Math.sin(phi), f = D / (D + Zz); const cx = (x0 + x1) / 2; return [cx + (x - cx) * f, y0 + (Y - y0) * f]; };
    c.save(); const poly = [proj(x0, y0), proj(x1, y0), proj(x1, y1), proj(x0, y1)];
    c.beginPath(); poly.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); c.closePath(); c.fillStyle = P.blue; c.fill(); c.clip();
    c.strokeStyle = hexA(P.paper, .1); c.lineWidth = 1.6;
    for (let y = y0 + 120; y < y1; y += 120) { const A = proj(x0, y), B = proj(x1, y); c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.stroke(); }
    for (let x = x0 + 120; x < x1; x += 120) { const A = proj(x, y0), B = proj(x, y1); c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.stroke(); }
    c.restore();
    c.save(); c.strokeStyle = P.paper; c.globalAlpha *= .55; c.lineWidth = 3; c.beginPath(); c.moveTo(poly[0][0], poly[0][1]); c.lineTo(poly[1][0], poly[1][1]); c.stroke(); c.restore();
  }

  private drawGuides(c: CanvasRenderingContext2D, z: Zone, t: number) {
    const g = Number(this.p.guides); if (g <= 0) return; const P = this.pal();
    c.save(); c.strokeStyle = P.brass; c.lineWidth = 2.5;
    for (const r of z.rows) {
      const q = eOut(prog(t, r.t - .25, r.t + .6)); if (q <= 0) continue;
      c.globalAlpha = .45 * g; c.beginPath(); c.moveTo(r.x0 - 40, r.y + 22); c.lineTo(lerp(r.x0 - 40, z.x + z.w - (z.tower ? z.tower.cap * 1.6 : 40), q), r.y + 22); c.stroke();
    }
    // rail (transfer guide) along the zone bottom
    const rq = eOut(prog(t, z.t0 - .6, z.t0 + .8));
    if (rq > 0) {
      c.globalAlpha = .5 * g; c.strokeStyle = P.paper; c.lineWidth = 3;
      const ry = z.y + z.railY; c.beginPath(); c.moveTo(z.x, ry); c.lineTo(z.x + z.w * rq, ry); c.stroke();
      for (let x = z.x + 60; x < z.x + z.w * rq; x += 240) { c.beginPath(); c.moveTo(x, ry); c.lineTo(x, ry + 18); c.stroke(); }
    }
    // registration marks at heroes as they land
    c.strokeStyle = P.brass; c.lineWidth = 2;
    for (const n of z.nodes) {
      if (!n.hero || n.rot) continue; const k = prog(t, n.t - .1, n.t + .1) * (1 - prog(t, n.t + .5, n.t + 1.1)); if (k <= 0) continue;
      c.globalAlpha = .9 * g * k; const x = n.x - 34, y = n.y - n.cap - 34, s = 22;
      c.beginPath(); c.moveTo(x - s, y); c.lineTo(x + s, y); c.moveTo(x, y - s); c.lineTo(x, y + s); c.stroke(); c.beginPath(); c.arc(x, y, s * .55, 0, 7); c.stroke();
      const x2 = n.x + n.w + 34, y2 = n.y + 34; c.beginPath(); c.moveTo(x2 - s, y2); c.lineTo(x2, y2); c.lineTo(x2, y2 - s); c.stroke();
    }
    // tower column frame
    if (z.tower) { const n = z.tower, q = eOut(prog(t, n.t - .3, n.t + .5)); if (q > 0) { c.globalAlpha = .5 * g; c.strokeStyle = P.paper; c.lineWidth = 2.5; const top = n.y - n.w - 40; c.beginPath(); c.moveTo(n.x + 26, n.y); c.lineTo(n.x + 26, lerp(n.y, top, q)); c.moveTo(n.x - n.cap - 26, n.y); c.lineTo(n.x - n.cap - 26, lerp(n.y, top, q)); c.stroke(); } }
    c.restore();
  }

  private drawAnno(c: CanvasRenderingContext2D, z: Zone, t: number) {
    if (!this.p.annotations) return; const P = this.pal(), a = this.ctx.song.analysis;
    const q = clamp(prog(t, z.t0 - .8, z.t0 - .2)); if (q <= 0) return;
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    c.save(); c.globalAlpha = q * .75; c.fillStyle = z.panel ? P.paper : P.brass; c.font = fontCSS('mono', 30);
    c.fillText(`${String(z.idx + 1).padStart(2, '0')} · ${z.label.toUpperCase()} · ${fmt(z.t0)}–${fmt(z.t1)}`, z.x + 70, z.y + 90);
    if (z.idx === 0) { c.fillStyle = P.brass; c.fillText(`${a.bpm.toFixed(0)} BPM · ${a.meter}/4 · ${a.sections.length} SECTIONS`, z.x + 70, z.y + 140); }
    c.globalAlpha = q * .5; c.fillStyle = P.paper; c.font = fontCSS('mono', 26); c.fillText('TRANSFER GUIDE', z.x + z.w - 330, z.y + z.railY + 56);
    for (const d of a.drops) if (d >= z.t0 - 1 && d <= z.t1 + 1) { c.globalAlpha = .9 * clamp(prog(t, d - .3, d)); c.fillStyle = P.orange; c.font = fontCSS('mono', 30); c.fillText(`DROP · T+${fmt(d)}`, z.x + 70, z.y + z.railY - 30); }
    c.restore();
  }

  private drawTitle(c: CanvasRenderingContext2D, t: number) {
    const s = this.ctx.settings; if (!s.title && !s.artist) return; const P = this.pal();
    const q = clamp(prog(t, this.keys[this.keys.length - 1].t - 4, this.keys[this.keys.length - 1].t - 3));
    const x = this.world.w - 300 - 1500, y = 200;
    c.save(); c.globalAlpha = Math.max(q, .0); c.fillStyle = P.paper;
    c.font = fontCSS('barlow7', 100); c.fillText(s.title.toUpperCase(), x, y + 100);
    c.font = fontCSS('barlow5', 60); c.fillText(s.artist.toUpperCase(), x, y + 200);
    c.font = fontCSS('mono', 46); c.fillStyle = P.brass; c.fillText('LYRIC EXCERPT', x, y + 290); c.restore();
  }

  /** Where is the vehicle at time t (world coords) and is it thrusting? */
  private vehicle(t: number) {
    const zs = this.zones; if (!zs.length) return null;
    let z = zs[0]; for (const q of zs) if (q.t0 - 1 <= t) z = q;
    const zi = zs.indexOf(z), next = zs[zi + 1];
    const a = this.ctx.song.analysis;
    const span = Math.max(.5, (next ? next.t0 - 1 : a.duration) - (z.t0 - 1));
    const u = clamp((t - (z.t0 - 1)) / span);
    // hop along the rail on downbeats: position moves in steps eased between downbeats
    const xs = z.x + 160, xe = z.x + z.w * .7;
    let x = lerp(xs, xe, u), y = z.y + z.railY, thrust = 0, ang = 0;
    const db = this.hops; let lastD = -9; for (const d of db) { if (d <= t) lastD = d; else break; }
    const hop = Math.exp(-(t - lastD) * 6) * (1 - Math.exp(-(t - lastD) * 40));
    y -= hop * 40 * this.ctx.settings.reactivity / 100;
    // transfer to the next zone during the last second
    if (next && t > next.t0 - 2.2) { const q = eIO(prog(t, next.t0 - 2.2, next.t0 - 1)); const nx = next.x + 160, ny = next.y + next.railY; const mx = (x + nx) / 2, my = Math.min(y, ny) - 900; x = (1 - q) * (1 - q) * x + 2 * (1 - q) * q * mx + q * q * nx; y = (1 - q) * (1 - q) * y + 2 * (1 - q) * q * my + q * q * ny; thrust = Math.sin(q * Math.PI); ang = (nx - x) * .0001 * Math.sin(q * Math.PI); }
    // launch on drops
    if (this.p.launchOnDrop) for (const d of a.drops) { const k = prog(t, d - .1, d + .1) * (1 - prog(t, d + 1.2, d + 2.2)); if (k > 0) { y -= k * 520; thrust = Math.max(thrust, k); } }
    // final departure
    const end = a.duration, lastWord = Math.max(...this.nodes.map(n => n.t));
    if (t > lastWord + 1) { const q = eIn(prog(t, lastWord + 1, end)); x += q * this.world.w * .4; y -= q * this.world.h * .9; ang = q * .9; thrust = Math.max(thrust, prog(t, lastWord + 1, lastWord + 1.3)); }
    return { x, y, thrust, ang };
  }
  private drawVehicle(c: CanvasRenderingContext2D, t: number) {
    if (String(this.p.vehicle) === 'none') return; const v = this.vehicle(t); if (!v) return; const P = this.pal();
    const Hh = 360;
    c.save(); c.translate(v.x, v.y); c.rotate(v.ang);
    if (v.thrust > 0) { const fl = Hh * (.25 + .35 * v.thrust) * (1 + .15 * Math.sin(t * 40)); c.fillStyle = P.orange; c.beginPath(); c.moveTo(-26, 0); c.quadraticCurveTo(0, fl * 1.4, 26, 0); c.fill(); c.fillStyle = P.paper; c.beginPath(); c.moveTo(-12, 0); c.quadraticCurveTo(0, fl * .7, 12, 0); c.fill(); }
    if (this.vehicleIcon === 'rocket') drawRocket(c, P);
    else { c.fillStyle = P.paper; c.translate(0, -Hh * .45); drawIcon(c, this.vehicleIcon, Hh * .42, t); }
    c.restore();
  }

  render(t: number, out: CanvasRenderingContext2D) {
    const { width: W, height: H, song } = this.ctx; const P = this.pal();
    out.save(); out.setTransform(1, 0, 0, 1, 0, 0); out.fillStyle = P.ink; out.fillRect(0, 0, W, H);
    if (!this.nodes.length) { out.restore(); return; }
    const cam = this.camAt(t);
    out.translate(W / 2, H / 2); out.scale(cam.zoom, cam.zoom); out.translate(-cam.cx, -cam.cy);
    const vx0 = cam.cx - W / 2 / cam.zoom, vx1 = cam.cx + W / 2 / cam.zoom, vy0 = cam.cy - H / 2 / cam.zoom, vy1 = cam.cy + H / 2 / cam.zoom;
    // specks
    out.fillStyle = P.paper;
    for (const s of this.specks) { if (s[0] < vx0 || s[0] > vx1 || s[1] < vy0 || s[1] > vy1) continue; out.globalAlpha = s[3]; out.fillRect(s[0], s[1], s[2] * 1.6, s[2] * 1.6); }
    out.globalAlpha = 1;
    const vis = (z: Zone) => !(z.x > vx1 || z.x + z.w < vx0 || z.y > vy1 || z.y + z.h < vy0);
    for (const z of this.zones) if (vis(z)) this.drawPanel(out, z, t);
    // route between zones
    if (Number(this.p.guides) > 0) {
      out.save(); out.strokeStyle = P.brass; out.lineWidth = 2.5; out.setLineDash([18, 14]); out.globalAlpha = .4 * Number(this.p.guides);
      for (let i = 1; i < this.zones.length; i++) { const a0 = this.zones[i - 1], b0 = this.zones[i]; const q = eIO(prog(t, b0.t0 - 2.4, b0.t0 - 1)); if (q <= 0) continue; const ax = a0.x + 160, ay = a0.y + a0.railY, bx = b0.x + 160, by = b0.y + b0.railY; const mx = (ax + bx) / 2, my = Math.min(ay, by) - 900; out.beginPath(); for (let k = 0; k <= 40 * q; k++) { const u = k / 40; out.lineTo((1 - u) * (1 - u) * ax + 2 * (1 - u) * u * mx + u * u * bx, (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * my + u * u * by); } out.stroke(); }
      out.restore();
    }
    for (const z of this.zones) if (vis(z)) { this.drawGuides(out, z, t); this.drawAnno(out, z, t); }
    for (const n of this.nodes) { if (!vis(n.zone)) continue; this.drawWord(out, n, t); }
    this.drawTitle(out, t);
    this.drawVehicle(out, t);
    out.restore();
    const fade = clamp((t - (song.analysis.duration - .6)) / .55);
    if (fade > 0) { out.save(); out.setTransform(1, 0, 0, 1, 0, 0); out.fillStyle = `rgba(0,0,0,${fade})`; out.fillRect(0, 0, W, H); out.restore(); }
    void sample;
  }
}

function drawRocket(c: CanvasRenderingContext2D, P: Pal) {
  const BW = 84, hb = BW / 2, HV = 360, ink = P.ink;
  c.fillStyle = P.paper; c.strokeStyle = ink; c.lineWidth = 2.2; c.lineJoin = 'round';
  // fins
  for (const sg of [-1, 1]) { c.beginPath(); c.moveTo(sg * hb, -150); c.lineTo(sg * (hb + 40), -78); c.lineTo(sg * (hb + 40), -36); c.lineTo(sg * hb, -58); c.closePath(); c.fill(); }
  // nozzle
  c.beginPath(); c.moveTo(-22, -46); c.lineTo(22, -46); c.quadraticCurveTo(26, -18, 38, 0); c.lineTo(-38, 0); c.quadraticCurveTo(-26, -18, -22, -46); c.closePath(); c.fill();
  // body
  c.fillRect(-hb, -266, BW, 220);
  // capsule
  c.beginPath(); c.moveTo(-hb, -266); c.lineTo(hb, -266); c.lineTo(13, -346); c.quadraticCurveTo(0, -HV - 2, -13, -346); c.closePath(); c.fill();
  c.globalAlpha *= .5;
  c.beginPath(); c.moveTo(-hb, -150); c.lineTo(hb, -150); c.moveTo(-hb, -66); c.lineTo(hb, -66); c.moveTo(-hb, -244); c.lineTo(hb, -244); c.moveTo(-hb, -190); c.lineTo(hb, -190); c.moveTo(-hb + 12, -290); c.lineTo(hb - 12, -290); c.stroke();
  c.beginPath(); c.arc(0, -218, 12, 0, 7); c.stroke();
}

function hexA(hex: string, a: number) { const v = parseInt(hex.slice(1), 16); return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`; }

export const MissionFactory: EffectFactory = { id: 'mission', name: 'Mission Poster', description: 'The song is built as an engineering poster — blueprint panels, brass guides, a tower word, a lunar disc, and a vehicle that rides the rails and launches on drops.', params: PARAMS, create: () => new MissionEffect() };

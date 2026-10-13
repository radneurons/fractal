// BROADSIDE — the classic 2010s kinetic-type lock-up, generalised from the "HE HAS" film.
// Every lyric line becomes a justified lock-up (big words, vertical / stacked connectives);
// lines stack into blocks, blocks chain with 90° camera turns, and world changes
// (verse ↔ chorus) dive through the counter of an O into a new world.
import type { ParamSpec, Params, Word, Line } from '../types';
import { type Effect, type EffectContext, type EffectFactory, clamp, lerp, eIO, eOut, eIn, rng, defaults, displayText } from './types';
import { fontCSS, capRatio, type FontKey } from '../render/sdf';
import { drawIcon, flameTongue, person, starPath, heartPath } from '../render/icons';
import { conceptOf } from '../director/lexicon';
import { sample } from '../analysis/dsp';

const PARAMS: ParamSpec[] = [
  { key: 'palette', label: 'Palette', group: 'Look', type: 'select', options: ['classic', 'newsprint', 'neon', 'mono'], default: 'classic', help: 'Night/paper colours and accents', live: true },
  { key: 'worlds', label: 'Worlds', group: 'Look', type: 'select', options: ['alternate', 'night', 'paper'], default: 'alternate', help: 'Alternate: verses at night, choruses on paper', live: false },
  { key: 'accent', label: 'Accent colour amount', group: 'Look', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, help: 'How many hero words take the accent colours', live: false },
  { key: 'portal', label: 'Dive through the O', group: 'Structure', type: 'toggle', default: true, help: 'At world changes the camera dives through a letter’s counter into the next world', live: false },
  { key: 'rotateBlocks', label: '90° block turns', group: 'Structure', type: 'toggle', default: true, help: 'Blocks chain at right angles and the camera rolls to follow', live: false },
  { key: 'linesPerBlock', label: 'Lines per block', group: 'Structure', type: 'range', min: 2, max: 9, step: 1, default: 5, help: 'Lock-up lines before a new block starts', live: false },
  { key: 'maxBig', label: 'Big words per line', group: 'Structure', type: 'range', min: 1, max: 6, step: 1, default: 3, help: 'Lyric lines wrap into several lock-ups beyond this', live: false },
  { key: 'entrances', label: 'Entrances', group: 'Motion', type: 'select', options: ['auto', 'slam', 'slide', 'drop', 'standup'], default: 'auto', help: 'Auto picks per word from the music and meaning', live: false },
  { key: 'pictograms', label: 'Pictogram letters', group: 'Imagery', type: 'toggle', default: true, help: 'Letters become icons (O → seal, A → flame…) for concept words', live: false },
  { key: 'companions', label: 'Silhouettes & props', group: 'Imagery', type: 'toggle', default: true, help: 'Flames, skylines, people, stars, shackles and marching icons', live: false },
  { key: 'echoes', label: 'Echo trails', group: 'Imagery', type: 'toggle', default: true, help: 'Grey 4-frame echoes behind moving silhouettes', live: true },
  { key: 'shake', label: 'Slam shake', group: 'Camera', type: 'range', min: 0, max: 2, step: 0.05, default: 1, help: 'Two-frame camera jolt on slams', live: true },
  { key: 'breathe', label: 'Camera breathing', group: 'Camera', type: 'range', min: 0, max: 2, step: 0.05, default: 1, help: 'Constant slow drift so the camera is never still', live: true },
  { key: 'doubleExposure', label: 'Whip double-exposure', group: 'Camera', type: 'toggle', default: true, help: 'Ghost frame on whip-pans and dives', live: true },
  { key: 'tiltOpen', label: 'Tilted opening', group: 'Camera', type: 'toggle', default: true, help: 'Open on a tilted plane that settles flat', live: true },
  { key: 'pulse', label: 'Beat pulse', group: 'Music', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4, help: 'Background and zoom pulse on the beat', live: true }
];

interface Pal { night: string; vig: string; bone: string; paper: string; ink: string; warm: string; coolN: string; coolP: string; echo: string }
const PALS: Record<string, Pal> = {
  classic: { night: '#1A1918', vig: '#050505', bone: '#EDE7DA', paper: '#F2ECDF', ink: '#15130F', warm: '#B3202A', coolN: '#8FB0D6', coolP: '#1C2C5B', echo: '#77736B' },
  newsprint: { night: '#2A2826', vig: '#121110', bone: '#EFE9DC', paper: '#E9E2D0', ink: '#1B1A17', warm: '#D1401F', coolN: '#9CC0D8', coolP: '#20437A', echo: '#8A847A' },
  neon: { night: '#0A0812', vig: '#020104', bone: '#F2F0FF', paper: '#F5F0FF', ink: '#120A20', warm: '#FF2D75', coolN: '#29E3FF', coolP: '#3A2CFF', echo: '#6C6680' },
  mono: { night: '#111111', vig: '#000000', bone: '#F4F4F4', paper: '#F4F4F4', ink: '#111111', warm: '#F4F4F4', coolN: '#BDBDBD', coolP: '#111111', echo: '#7A7A7A' }
};

const MEAS = 1000, FR = 1 / 60;
type Ent = 'slam' | 'slide' | 'drop' | 'ghost' | 'fly' | 'wipe' | 'knocked' | 'standup' | 'tick';
const DUR: Record<Ent, number> = { slam: 5, slide: 14, drop: 16, ghost: 14, fly: 50, wipe: 30, knocked: 5, standup: 8, tick: 0 };
type Comp = 'flames' | 'skyline' | 'people' | 'waves' | 'stars' | 'shackle' | 'hearts' | 'bolt' | 'march' | 'quake' | 'swash' | 'road';

interface Pict { i: number; icon: string; shape: 'ring' | 'stem' | 'tri' | 'portal' }
interface Tok {
  text: string; t: number; e: Ent; f: FontKey; cap: number; x: number; y: number; rot: number; xs: number[]; w: number;
  line: LLine; block: Block; col: 'warm' | 'cool' | null; pict: Pict | null; comp: Comp | null; icon: string; word: Word | null;
  vbox?: { x0: number; x1: number }; nocam: boolean; camDy: number; camZ: number; seed: number; hero: boolean;
}
interface LLine { top: number; h: number; tilt: number; toks: Tok[]; gapAfter: number }
interface Block { lines: LLine[]; toks: Tok[]; level: number; x: number; y: number; rot: number; h: number; w: number; world: 'night' | 'paper'; idx: number }
interface Level { parent: number; ox: number; oy: number; s: number; r: number; R: number; world: 'night' | 'paper'; tOpen: number; tFull: number; tOut: number; blocks: Block[] }
interface Key { t: number; level: number; cx: number; cy: number; zoom: number; rot: number; ease: 'io' | 'whip' | 'in' | 'out' | 'over' }

const ezs = { io: eIO, over: eIO, whip: (p: number) => p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2, in: eIn, out: eOut };
const bounce1 = (p: number) => p < .72 ? Math.pow(p / .72, 2) : 1 - .1 * Math.sin(Math.PI * (p - .72) / .28);
const eBackOut = (p: number, s = 1.70158) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2);
const WARM = new Set(['fire', 'heart', 'crown', 'quake', 'flower', 'shock']);
const COMP_OF: Record<string, Comp> = { fire: 'flames', home: 'skyline', people: 'people', water: 'waves', light: 'stars', star: 'stars', key: 'shackle', bird: 'shackle', heart: 'hearts', shock: 'bolt', quake: 'quake', road: 'road' };

class BroadsideEffect implements Effect {
  readonly id = 'broadside'; readonly name = 'Broadside'; readonly description = 'Classic kinetic-type lock-ups: justified lines, vertical connectives, slams and whip-pans, pictogram letters, and a dive through the O between worlds.';
  readonly params = PARAMS;
  private p: Params = defaults(PARAMS);
  private ctx!: EffectContext;
  private mc = document.createElement('canvas').getContext('2d')!;
  private toks: Tok[] = []; private blocks: Block[] = []; private levels: Level[] = []; private keys: Key[] = [];
  private slams: number[] = []; private blurWin: [number, number][] = []; private firstT = 0; private lastT = 0;
  private starsFrom = new Map<Tok, number[][]>();

  async prepare(ctx: EffectContext) { this.ctx = ctx; this.p = { ...defaults(PARAMS), ...ctx.params }; this.build(); }
  setParams(p: Params) { this.p = { ...this.p, ...p }; }
  dispose() { /* nothing to free */ }

  // ───────────── layout ─────────────
  private measure(f: FontKey, cap: number, s: string) { this.mc.font = fontCSS(f, cap / capRatio(f)); return this.mc.measureText(s).width; }
  private letterXs(f: FontKey, cap: number, s: string) { this.mc.font = fontCSS(f, cap / capRatio(f)); const xs: number[] = []; for (let i = 0; i <= s.length; i++) xs.push(this.mc.measureText(s.slice(0, i)).width); return xs; }

  private build() {
    const { song, settings } = this.ctx; const ly = song.lyrics, a = song.analysis;
    const off = settings.syncOffsetMs / 1000, R = rng(settings.seed * 7 + 3);
    const caseOf = (s: string) => displayText(s, settings.caseMode === 'lower' ? 'lower' : settings.caseMode === 'as-is' ? 'as-is' : 'upper');
    const portrait = this.ctx.width < this.ctx.height * 1.2;
    const maxBig = portrait ? Math.min(2, Number(this.p.maxBig)) : Number(this.p.maxBig), perBlock = Number(this.p.linesPerBlock), accent = Number(this.p.accent);
    const pictOn = Boolean(this.p.pictograms), compOn = Boolean(this.p.companions), entMode = String(this.p.entrances);
    const worldMode = String(this.p.worlds);
    const worldOf = (L: Line): 'night' | 'paper' => {
      if (worldMode !== 'alternate') return worldMode as 'night' | 'paper';
      const lab = a.sections[L.section]?.label ?? 'verse';
      return lab === 'chorus' || lab === 'drop' ? 'paper' : 'night';
    };
    this.toks = []; this.blocks = []; this.levels = []; this.keys = []; this.slams = []; this.blurWin = []; this.starsFrom.clear();
    if (!ly.lines.length) return;

    // 1) lock-up lines (as item lists) grouped into blocks
    type Item = { k: 'w' | 'v' | 's'; words: Word[]; rows?: Word[][] };
    type Proto = { items: Item[]; L: Line; first: boolean };
    const groups: { protos: Proto[]; world: 'night' | 'paper'; section: number }[] = [];
    let compBudgetT = -9;
    for (const L of ly.lines) {
      const ws = L.words.map(id => ly.words[id]); if (!ws.length) continue;
      const allConn = ws.every(w => w.role === 'connective');
      const items: Item[] = [];
      for (let i = 0; i < ws.length;) {
        if (allConn || ws[i].role !== 'connective') { items.push({ k: 'w', words: [ws[i]] }); i++; continue; }
        let j = i; while (j < ws.length && ws[j].role === 'connective') j++;
        const run = ws.slice(i, j);
        if (run.length === 1 && run[0].display.length <= 6 && R() < .45 && items.length) items.push({ k: 'v', words: run });
        else for (let q = 0; q < run.length; q += 6) {
          const chunk = run.slice(q, q + 6), rows: Word[][] = [];
          const per = chunk.length <= 3 ? 1 : 2;
          for (let r = 0; r < chunk.length; r += per) rows.push(chunk.slice(r, r + per));
          items.push({ k: 's', words: chunk, rows });
        }
        i = j;
      }
      // wrap into lock-ups with at most maxBig big words
      const bigIdx = items.map((it, k) => it.k === 'w' ? k : -1).filter(k => k >= 0);
      const nParts = Math.max(1, Math.ceil(bigIdx.length / maxBig));
      const parts: Item[][] = [];
      if (nParts === 1) parts.push(items);
      else {
        let start = 0;
        for (let pI = 1; pI < nParts; pI++) {
          const cut = bigIdx[Math.round(pI * bigIdx.length / nParts)] ?? items.length;
          let c0 = cut; while (c0 > start + 1 && items[c0 - 1].k !== 'w') c0--;   // keep connectives with the word they lead into
          parts.push(items.slice(start, c0)); start = c0;
        }
        parts.push(items.slice(start));
      }
      const world = worldOf(L);
      let g = groups[groups.length - 1];
      const lastWord = ws[ws.length - 1];
      const prevLine = ly.lines[L.idx - 1];
      const longGap = prevLine && L.start - prevLine.end > 3.5;
      if (!g || g.world !== world || g.section !== L.section && (g.protos.length >= 2 || longGap) || g.protos.length + parts.length > perBlock) {
        g = { protos: [], world, section: L.section }; groups.push(g);
      }
      parts.forEach((items2, k) => g.protos.push({ items: items2.filter(Boolean), L, first: k === 0 }));
      void lastWord;
    }

    // 2) blocks: measure and place tokens in block-local coordinates
    const sampleFlux = (t: number) => sample(a.flux, t), sampleLoud = (t: number) => sample(a.loud, t);
    let prevEnt: Ent = 'tick';
    groups.forEach((g, gi) => {
      const b: Block = { lines: [], toks: [], level: 0, x: 0, y: 0, rot: 0, h: 0, w: MEAS, world: g.world, idx: gi };
      let y = 0, prevH = 0;
      g.protos.forEach((pr, li) => {
        const its = pr.items.filter(it => it.words.length);
        if (!its.length) return;
        const isRefrain = pr.first && li === 0 && (pr.L.repeatOf !== undefined || a.sections[pr.L.section]?.label === 'chorus');
        const fontFor = (w: Word, big: boolean): FontKey => {
          if (!big) return 'mont6';
          if (isRefrain) return 'condItalic';
          const c = w.concept;
          if (c === 'shock' || c === 'quake') return 'stencil';
          if (c === 'heart' || c === 'crown' || c === 'time' || c === 'moon' || c === 'star') return 'caslon';
          if (w.role === 'hero' && w.stress > .85 && R() < .18) return 'caslon';
          return 'mont8';
        };
        const parts = its.map(it => {
          if (it.k === 'w') { const f = fontFor(it.words[0], true); const tx = caseOf(it.words[0].display); return { it, f, tx, wd: this.measure(f, 100, tx) / 100, gapL: .2, vc: 0, rc: 0 }; }
          if (it.k === 'v') { const tx = caseOf(it.words[0].display); const len = this.measure('mont6', 100, tx) / 100; const vc = Math.min(.3, .96 / len); return { it, f: 'mont6' as FontKey, tx, vc, rc: 0, wd: vc * 1.05, gapL: .13 }; }
          const n = it.rows!.length, rc = n === 1 ? .34 : (1 - .22 * (n - 1)) / n;
          const wd = Math.max(...it.rows!.map(r => this.measure('mont6', 100, caseOf(r.map(w => w.display).join(' '))) / 100 * rc));
          return { it, f: 'mont6' as FontKey, tx: '', vc: 0, rc, wd, gapL: .13 };
        });
        let nat = 0; parts.forEach((q, i) => { nat += q.wd + (i ? Math.max(q.gapL, parts[i - 1].gapL) : 0); });
        const S = Math.min(MEAS / nat, MEAS * .42);
        const line: LLine = { top: 0, h: S, tilt: 0, toks: [], gapAfter: 0 };
        const gap = li === 0 ? 0 : .17 * Math.min(prevH, S) + (b.lines[li - 1]?.gapAfter ?? 0) * prevH;
        y += gap; line.top = y;
        let x = 0;
        parts.forEach((q, i) => {
          if (i) x += Math.max(q.gapL, parts[i - 1].gapL) * S;
          const base = y + S;
          if (q.it.k === 'w') {
            const w = q.it.words[0];
            const tk = this.mkTok(q.tx, w.start + off, q.f, S, x, base, 0, line, b, w);
            line.toks.push(tk);
          } else if (q.it.k === 'v') {
            const w = q.it.words[0];
            const tk = this.mkTok(q.tx, w.start + off, 'mont6', q.vc * S, x + q.vc * S, base, -Math.PI / 2, line, b, w);
            tk.vbox = { x0: x, x1: x + q.vc * S }; line.toks.push(tk);
          } else {
            const n = q.it.rows!.length;
            q.it.rows!.forEach((r, j) => {
              const rowBase = n === 1 ? base : y + ((j + 1) * q.rc + j * .22) * S;
              const tk = this.mkTok(caseOf(r.map(w => w.display).join(' ')), r[0].start + off, 'mont6', q.rc * S, x, rowBase, 0, line, b, r[0]);
              tk.nocam = j > 0; line.toks.push(tk);
            });
          }
          x += q.wd * S;
        });
        b.lines.push(line); y += S; prevH = S;
      });
      b.h = y;
      b.toks = b.lines.flatMap(l => l.toks);
      this.blocks.push(b);
    });

    // 3) entrances, fonts, colours, pictograms, companions
    const allBig = this.toks.filter(t => t.rot === 0 && t.f !== 'mont6');
    this.toks.forEach(tk => {
      const w = tk.word!; const big = tk.f !== 'mont6' && tk.rot === 0;
      tk.hero = big && w.role === 'hero';
      if (!big) { tk.e = 'tick'; return; }
      const c = w.concept; const cc = c ? conceptOf(w.text) : undefined;
      const fl = sampleFlux(w.start), loud = sampleLoud(w.start);
      let e: Ent;
      if (tk.f === 'condItalic' && tk.line.toks.find(o => o.f === 'condItalic') === tk) e = 'fly';
      else if (entMode !== 'auto') e = entMode as Ent;
      else if (c === 'shock') e = 'knocked';
      else if (tk.hero && fl > .55) e = 'slam';
      else if (loud < .28 && tk.hero) e = 'ghost';
      else {
        const r = R();
        e = tk.hero ? (r < .4 ? 'slam' : r < .68 ? 'slide' : r < .88 ? 'drop' : 'standup') : (r < .5 ? 'slide' : r < .8 ? 'slam' : 'drop');
        if (e === prevEnt && e !== 'slam' && R() < .6) e = 'slam';
      }
      tk.e = e; prevEnt = e;
      if (e === 'slam' || e === 'knocked') this.slams.push(tk.t);
      // colour
      if (tk.hero && cc && accent > .15) tk.col = WARM.has(cc.id) ? 'warm' : 'cool';
      else if (tk.hero && R() < accent * .35) tk.col = R() < .5 ? 'warm' : 'cool';
      // pictogram letter
      if (pictOn && tk.hero && cc?.icon) {
        const up = tk.text.toUpperCase();
        const want = cc.shape === 'ring' ? /[OQ0]/ : cc.shape === 'stem' ? /[I1]/ : /[AV]/;
        const m = up.slice(1).search(want);           // never the first letter: keeps the word readable
        if (m >= 0) tk.pict = { i: m + 1, icon: cc.icon, shape: cc.shape ?? 'ring' };
      }
      tk.icon = cc?.icon ?? 'star';
      // companion (rate-limited so props stay special)
      if (compOn && tk.hero && cc && tk.t - compBudgetT > 1.6) {
        tk.comp = COMP_OF[cc.id] ?? 'march'; compBudgetT = tk.t;
        if (tk.comp === 'skyline' || tk.comp === 'people' || tk.comp === 'waves' || tk.comp === 'march') tk.line.gapAfter = Math.max(tk.line.gapAfter, .55);
      }
    });
    void allBig;
    // the very last big word of the song: a hand-drawn swash under a wipe
    const lastBig = [...this.toks].reverse().find(t => t.rot === 0 && t.f !== 'mont6');
    if (lastBig) { lastBig.e = (lastBig.word!.end - lastBig.word!.start) > .5 ? 'wipe' : lastBig.e; if (compOn && !lastBig.comp) lastBig.comp = 'swash'; }
    // gaps after lines that have companions underneath: re-flow block y
    for (const b of this.blocks) this.reflow(b);

    // 4) levels & block placement
    const portalOn = Boolean(this.p.portal), rotOn = Boolean(this.p.rotateBlocks);
    const lev0: Level = { parent: -1, ox: 0, oy: 0, s: 1, r: 0, R: 0, world: this.blocks[0].world, tOpen: -1, tFull: -1, tOut: 1e9, blocks: [] };
    this.levels.push(lev0);
    let rotState = 0;
    this.blocks.forEach((b, bi) => {
      const prev = this.blocks[bi - 1];
      if (!prev) { b.level = 0; b.x = 0; b.y = 0; b.rot = 0; lev0.blocks.push(b); return; }
      const portal = portalOn && prev.world !== b.world ? this.findPortal(prev) ?? this.stampPortal(prev) : null;
      if (portal) {
        const { tk, i } = portal;
        const cx = (tk.xs[i] + tk.xs[i + 1]) / 2, cap = tk.cap;
        const [wx, wy] = this.toLevel(prev, tk.x + cx, tk.y - cap / 2);
        tk.pict = { i, icon: '', shape: 'portal' };
        const r = .36 * cap, s = .93 * r / Math.hypot(MEAS / 2, b.h / 2);
        const lv: Level = { parent: prev.level, ox: wx, oy: wy, s, r, R: .56 * cap, world: b.world, tOpen: 0, tFull: 0, tOut: 1e9, blocks: [b] };
        this.levels.push(lv);
        b.level = this.levels.length - 1; b.x = -MEAS / 2; b.y = -b.h / 2; b.rot = 0; rotState = 0;
        return;
      }
      // chain within the same level
      b.level = prev.level; this.levels[b.level].blocks.push(b);
      const bb = this.bbox(prev), gap = 140;
      let nr = 0;
      if (rotOn) { nr = rotState === 0 ? (R() < .5 ? 1 : -1) : 0; }
      rotState = nr;
      b.rot = nr * Math.PI / 2;
      if (nr === 0) { b.x = bb.x0 + (R() - .3) * 160; b.y = bb.y1 + gap; }
      else if (nr === 1) { b.x = bb.x1 + gap + b.h; b.y = bb.y0 + (bb.y1 - bb.y0) * .35; }
      else { b.x = bb.x1 + gap; b.y = bb.y1 + MEAS * .15; }
      if (b.world !== prev.world) this.levels[b.level].world = this.levels[b.level].world; // same level keeps its paint; blocks carry their own world
    });

    // 5) camera
    this.buildCamera();
  }

  private mkTok(text: string, t: number, f: FontKey, cap: number, x: number, y: number, rot: number, line: LLine, block: Block, word: Word | null): Tok {
    const xs = this.letterXs(f, cap, text);
    const tk: Tok = { text, t, e: 'tick', f, cap, x, y, rot, xs, w: xs[xs.length - 1], line, block, col: null, pict: null, comp: null, icon: 'star', word, nocam: false, camDy: 0, camZ: 1, seed: this.toks.length * 17 + 3, hero: false };
    this.toks.push(tk); return tk;
  }

  /** Recompute line tops after gapAfter changes (props under a line need room). */
  private reflow(b: Block) {
    let y = 0, prevH = 0;
    b.lines.forEach((ln, li) => {
      const gap = li === 0 ? 0 : .17 * Math.min(prevH, ln.h) + b.lines[li - 1].gapAfter * prevH;
      const ny = y + gap, dy = ny - ln.top;
      if (dy) { ln.top = ny; for (const tk of ln.toks) tk.y += dy; }
      y = ln.top + ln.h; prevH = ln.h;
    });
    b.h = y + (b.lines[b.lines.length - 1]?.gapAfter ?? 0) * prevH;
  }

  private findPortal(b: Block): { tk: Tok; i: number } | null {
    const cands = b.toks.filter(t => t.rot === 0 && t.f !== 'mont6' && !t.pict).slice(-6).reverse();
    for (const re of [/[O0Q]/, /[DOB]/]) for (const tk of cands) { const m = tk.text.toUpperCase().search(re); if (m >= 0 && tk.text[m] !== ' ') return { tk, i: m }; }
    return null;
  }
  /** No O to dive through: stamp a ring after the block's last big word and dive through that. */
  private stampPortal(b: Block): { tk: Tok; i: number } | null {
    const ln = b.lines[b.lines.length - 1]; if (!ln) return null;
    const last = [...ln.toks].filter(t => t.rot === 0).pop(); if (!last) return null;
    const cap = Math.min(ln.h * .7, MEAS * .2);
    const tk = this.mkTok('O', last.t + .18, 'mont8', cap, Math.max(...ln.toks.map(t => t.vbox ? t.vbox.x1 : t.x + (t.rot ? 0 : t.w))) + cap * .25, ln.top + ln.h, 0, ln, b, null);
    tk.e = 'slam'; tk.hero = true; ln.toks.push(tk); b.toks.push(tk); this.slams.push(tk.t);
    return { tk, i: 0 };
  }

  private toLevel(b: Block, x: number, y: number): [number, number] { const c = Math.cos(b.rot), s = Math.sin(b.rot); return [b.x + x * c - y * s, b.y + x * s + y * c]; }
  private bbox(b: Block) {
    const pts = [[0, 0], [MEAS, 0], [0, b.h], [MEAS, b.h]].map(([x, y]) => this.toLevel(b, x, y));
    return { x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])), y0: Math.min(...pts.map(p => p[1])), y1: Math.max(...pts.map(p => p[1])) };
  }

  // ───────────── camera ─────────────
  private frameFor(tk: Tok, zoomMul = 1): Omit<Key, 't' | 'ease'> {
    const { width: W, height: H } = this.ctx; const b = tk.block, ln = tk.line;
    const xEnd = tk.vbox ? tk.vbox.x1 : tk.x + (tk.rot ? 0 : tk.w);
    const fw = Math.max(xEnd * 1.12, MEAS * .58, tk.rot ? 0 : tk.w * 1.5);
    let cxL = xEnd - fw * .44; cxL = Math.max(cxL, fw * .42 - 20);
    const cyL = ln.top + ln.h * .5 - ln.h * .28 + tk.camDy * ln.h;
    const fh = ln.h * 2.6 * (H > W ? .8 : 1);
    const [cx, cy] = this.toLevel(b, cxL, cyL);
    const zoom = Math.min(W / fw, H / fh) * zoomMul * tk.camZ;
    return { level: b.level, cx, cy, zoom, rot: -b.rot + ln.tilt * Math.PI / 180 };
  }

  private buildCamera() {
    const { width: W, height: H, song } = this.ctx; const dur = song.analysis.duration;
    const K: Key[] = [];
    const camToks = this.toks.filter(t => !t.nocam).sort((x, y) => x.t - y.t);
    if (!camToks.length) { this.keys = [{ t: 0, level: 0, cx: MEAS / 2, cy: 0, zoom: 1, rot: 0, ease: 'io' }]; return; }
    this.firstT = camToks[0].t; this.lastT = camToks[camToks.length - 1].t;
    K.push({ ...this.frameFor(camToks[0], .78), t: 0, ease: 'io' });
    let lastBlock = camToks[0].block;
    for (const tk of camToks) {
      const st = this.frameFor(tk);
      if (tk.block !== lastBlock) {
        const pb = lastBlock, nb = tk.block;
        const lastTok = [...pb.toks].filter(o => !o.nocam).sort((x, y) => x.t - y.t).pop()!;
        const hold = this.frameFor(lastTok);
        const gapStart = lastTok.t + .35;
        if (nb.level !== pb.level && this.levels[nb.level].parent === pb.level) {
          // dive through the O
          const lv = this.levels[nb.level];
          const tFull = Math.max(gapStart + .5, tk.t - .3), tMid = tFull - .3, tHold = Math.max(lastTok.t + .1, tMid - .32);
          K.push({ ...hold, t: tHold, zoom: hold.zoom * 1.05, ease: 'io' });
          K.push({ t: tMid, level: pb.level, cx: lv.ox, cy: lv.oy, zoom: Math.min(W, H) * .39 / lv.R, rot: 0, ease: 'io' });
          K.push({ t: tFull, level: nb.level, cx: 0, cy: 0, zoom: Math.max(W, H) * .66 / lv.r * lv.s, rot: 0, ease: 'in' });
          lv.tOpen = tMid - .45; lv.tFull = tFull;
          this.blurWin.push([tMid + .05, tFull]);
        } else {
          if (tk.t - gapStart > .5) K.push({ ...hold, t: gapStart + Math.min(.6, (tk.t - gapStart) * .4), zoom: hold.zoom * .93, ease: 'io' });
          if (tk.t - .5 > K[K.length - 1].t + .1) { const h2 = K[K.length - 1]; K.push({ ...h2, t: tk.t - .5, zoom: h2.zoom * .985, ease: 'io' }); }   // hold, then whip
          this.blurWin.push([tk.t - .34, tk.t]);
        }
        K.push({ ...st, t: tk.t, ease: 'whip' });
        lastBlock = nb; continue;
      }
      const prevK = K[K.length - 1];
      if (tk.t - prevK.t < .18 && prevK.ease !== 'in') K.pop();
      K.push({ ...st, t: tk.t, ease: 'io' });
    }
    // ending
    const lastB = lastBlock, lv = this.levels[lastB.level];
    const lastTok = camToks[camToks.length - 1];
    const fin = this.frameFor(lastTok);
    const tEnd = dur;
    K.push({ ...fin, t: Math.min(tEnd - .2, lastTok.t + .6), zoom: fin.zoom * 1.04, ease: 'io' });
    if (lv.parent >= 0 && lv.blocks[0] === lastB && tEnd - lastTok.t > 2.2) {
      const t1 = Math.min(tEnd - 1.0, lastTok.t + 1.4);
      K.push({ t: t1, level: lv.parent, cx: lv.ox, cy: lv.oy, zoom: Math.min(W, H) * .4 / lv.R, rot: 0, ease: 'io' });
      K.push({ t: tEnd, level: lv.parent, cx: lv.ox, cy: lv.oy, zoom: Math.min(W, H) * .44 / lv.R, rot: 0, ease: 'io' });
      lv.tOut = t1 - .9;
    } else if (tEnd - lastTok.t > 1.6) {
      const bb = this.bbox(lastB); const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
      const bw = lastB.rot ? bb.y1 - bb.y0 : bb.x1 - bb.x0, bh = lastB.rot ? bb.x1 - bb.x0 : bb.y1 - bb.y0;
      const z = Math.min(W / (bw * 1.12), H / (bh * 1.18));
      const t1 = Math.min(tEnd - .5, lastTok.t + 1.6);
      K.push({ t: t1, level: lastB.level, cx, cy, zoom: z, rot: -lastB.rot, ease: 'io' });
      K.push({ t: tEnd, level: lastB.level, cx, cy, zoom: z * .96, rot: -lastB.rot, ease: 'io' });
    }
    K.sort((x, y) => x.t - y.t);
    // unwrap rotations so the camera takes the short way round
    for (let i = 1; i < K.length; i++) { while (K[i].rot - K[i - 1].rot > Math.PI) K[i].rot -= Math.PI * 2; while (K[i].rot - K[i - 1].rot < -Math.PI) K[i].rot += Math.PI * 2; }
    this.keys = K.filter((k, i) => i === 0 || k.t > K[i - 1].t + 1e-4);
  }

  /** Express key k in the frame of level `to` (adjacent levels only). */
  private inLevel(k: Key, to: number): Key {
    if (k.level === to) return k;
    const lt = this.levels[to], lk = this.levels[k.level];
    if (lt.parent === k.level) return { ...k, level: to, cx: (k.cx - lt.ox) / lt.s, cy: (k.cy - lt.oy) / lt.s, zoom: k.zoom * lt.s };
    if (lk.parent === to) return { ...k, level: to, cx: lk.ox + k.cx * lk.s, cy: lk.oy + k.cy * lk.s, zoom: k.zoom / lk.s };
    return { ...k, level: to };
  }
  private camAt(t: number): Key {
    const K = this.keys;
    if (t <= K[0].t) return K[0];
    if (t >= K[K.length - 1].t) return K[K.length - 1];
    let lo = 0, hi = K.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (K[m].t <= t) lo = m; else hi = m; }
    let a = K[lo], b = K[hi];
    const deeper = this.depth(a.level) >= this.depth(b.level) ? a.level : b.level;
    a = this.inLevel(a, deeper); b = this.inLevel(b, deeper);
    const p = (t - a.t) / Math.max(1e-6, b.t - a.t), q = ezs[b.ease](p);
    return { t, level: deeper, cx: lerp(a.cx, b.cx, q), cy: lerp(a.cy, b.cy, q), zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), q)), rot: lerp(a.rot, b.rot, q), ease: 'io' };
  }
  private depth(l: number) { let d = 0; while (this.levels[l].parent >= 0) { l = this.levels[l].parent; d++; } return d; }

  // ───────────── drawing ─────────────
  private pal(): Pal { return PALS[String(this.p.palette)] ?? PALS.classic; }
  private fg(world: 'night' | 'paper') { const P = this.pal(); return world === 'night' ? P.bone : P.ink; }
  private bg(world: 'night' | 'paper') { const P = this.pal(); return world === 'night' ? P.night : P.paper; }
  private tokColor(tk: Tok) {
    const P = this.pal(), w = tk.block.world;
    if (tk.col === 'warm') return P.warm;
    if (tk.col === 'cool') return w === 'night' ? P.coolN : P.coolP;
    return this.fg(w);
  }
  private tokStart(tk: Tok) { return tk.e === 'standup' ? tk.t - (8 + 3 * (tk.text.length - 1)) * FR : tk.t - DUR[tk.e] * FR - this.ctx.settings.anticipationMs / 1000 * (tk.e === 'tick' ? 1 : .5); }

  private drawPict(c: CanvasRenderingContext2D, tk: Tok, i: number, t: number, fill: string) {
    const x0 = tk.xs[i], x1 = tk.xs[i + 1], cap = tk.cap, mx = (x0 + x1) / 2, pc = tk.pict!;
    c.fillStyle = fill; c.strokeStyle = fill;
    if (pc.shape === 'portal') {
      const R = cap * .56, r = R - cap * .2, cy = -cap * .5;
      c.beginPath(); c.arc(mx, cy, R, 0, Math.PI * 2); c.arc(mx, cy, r, 0, Math.PI * 2, true); c.fill();
    } else if (pc.shape === 'ring') {
      const R = cap * .52, cy = -cap * .5;
      const sp = clamp((t - tk.t) / .45), sx = Math.cos(sp * Math.PI * 2);
      c.save(); c.translate(mx, cy); c.scale(Math.max(.05, Math.abs(sx)), 1);
      c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.arc(0, 0, R * .8, 0, Math.PI * 2, true); c.fill('evenodd');
      if (sx >= 0) drawIcon(c, pc.icon, R * .58, t); else { c.beginPath(); c.arc(0, 0, R * .2, 0, Math.PI * 2); c.fill(); }
      c.restore();
    } else {
      const r = cap * .5;
      c.save(); c.translate(mx, -cap * .5); drawIcon(c, pc.icon, r * (pc.shape === 'stem' ? .95 : 1), t); c.restore();
    }
  }

  private drawLetters(c: CanvasRenderingContext2D, tk: Tok, t: number, fill: string, per: ((i: number) => { dx?: number; dy?: number; rot?: number; sx?: number; sy?: number; al?: number } | null) | null) {
    c.font = fontCSS(tk.f, tk.cap / capRatio(tk.f)); c.fillStyle = fill;
    if (!per && !tk.pict) { c.fillText(tk.text, 0, 0); return; }
    for (let i = 0; i < tk.text.length; i++) {
      const ch = tk.text[i]; if (ch === ' ') continue;
      let dx = 0, dy = 0, rot = 0, sx = 1, sy = 1, al = 1;
      if (per) { const r = per(i); if (!r) continue; ({ dx = 0, dy = 0, rot = 0, sx = 1, sy = 1, al = 1 } = r); }
      const x0 = tk.xs[i], cxl = (tk.xs[i] + tk.xs[i + 1]) / 2;
      c.save(); c.translate(cxl + dx, dy); c.rotate(rot); c.scale(sx, sy); if (al !== 1) c.globalAlpha *= al;
      if (tk.pict && tk.pict.i === i) { c.translate(-cxl, 0); this.drawPict(c, tk, i, t, fill); }
      else c.fillText(ch, x0 - cxl, 0);
      c.restore();
    }
  }

  private drawToken(c: CanvasRenderingContext2D, tk: Tok, t: number, fillOverride?: string) {
    const s0 = this.tokStart(tk); if (t < s0) return;
    const fill = fillOverride ?? this.tokColor(tk), night = tk.block.world === 'night';
    c.save(); c.translate(tk.x, tk.y); if (tk.rot) c.rotate(tk.rot);
    if (night && !fillOverride) { c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 4 * tk.cap / 120; c.shadowOffsetX = 3 * tk.cap / 120; c.shadowOffsetY = 3 * tk.cap / 120; }
    const W = tk.w, cap = tk.cap, p = clamp((t - s0) / Math.max(FR, tk.t - s0));
    let per: Parameters<BroadsideEffect['drawLetters']>[4] = null;
    if (tk.comp === 'waves' && t > tk.t) { const k = clamp(1 - (t - tk.t - 2) / 1.2); per = i => ({ dy: Math.sin(t * 5.2 + i * 1.1) * cap * .06 * k }); }
    if (tk.comp === 'quake' && t > tk.t && t < tk.t + .7) { const k = 1 - (t - tk.t) / .7; per = i => { const R = rng(i * 31 + Math.floor(t * 30)); return { dx: (R() - .5) * cap * .1 * k, dy: (R() - .5) * cap * .1 * k, rot: (R() - .5) * .12 * k }; }; }
    switch (tk.e) {
      case 'slam': case 'knocked': {
        const sc = 1.4 - .4 * eOut(p); c.translate(W / 2, -cap / 2); c.scale(sc, sc); c.translate(-W / 2, cap / 2); c.globalAlpha *= clamp(p * 2.5);
        if (tk.e === 'knocked') { const q = eOut(clamp((t - tk.t) / (4 / 60))); per = i => { const R = rng(i * 97 + 13 + tk.seed); return { dx: (R() - .5) * 10 * cap / 90 * q, dy: (R() - .5) * 10 * cap / 90 * q, rot: (R() - .5) * .17 * q }; }; }
        break;
      }
      case 'slide': {
        const dist = Math.max(W * .9, cap * 3.4);
        if (p < 1 && !fillOverride) for (const [lag, al] of [[.2, .1], [.13, .18], [.06, .3]]) { const pp = clamp(p - lag); c.save(); c.globalAlpha *= al; c.translate((1 - eOut(pp)) * dist, 0); this.drawLetters(c, tk, t, fill, per); c.restore(); }
        c.translate((1 - eOut(p)) * dist, 0); break;
      }
      case 'drop': c.translate(0, -(1 - bounce1(p)) * cap * 1.8); c.globalAlpha *= clamp(p * 3); break;
      case 'ghost': { const sc = lerp(3, 1, eOut(p)); c.translate(W / 2, -cap / 2); c.scale(sc, sc); c.translate(-W / 2, cap / 2); c.globalAlpha *= lerp(.15, 1, eIn(p)); break; }
      case 'standup': per = i => { const st = s0 + 3 * i * FR, q = clamp((t - st) / (8 * FR)); return q <= 0 ? null : { sy: Math.max(.02, eBackOut(q, 2.2)) }; }; break;
      case 'fly': {
        const n = tk.text.length, span = Math.max(10, DUR.fly - 3 * n);
        per = i => {
          const st = s0 + i * 3 * FR, q = eOut(clamp((t - st) / (span * FR))); if (q <= 0) return null;
          const R = rng(i * 131 + 7 + tk.seed), f = { dx: (R() - .5) * 13 * cap, dy: (R() - .5) * 9 * cap - 2 * cap, rot: (R() - .5) * 3, sc: .3 + R() * 2.2 };
          const sc = lerp(f.sc, 1, q); return { dx: f.dx * (1 - q), dy: f.dy * (1 - q), rot: f.rot * (1 - q), sx: sc, sy: sc, al: clamp(q * 2) };
        };
        break;
      }
      case 'wipe': c.beginPath(); c.rect(-cap * .3, -cap * 1.6, (W + cap * .6) * eIO(p), cap * 2.2); c.clip(); break;
      default: break;
    }
    this.drawLetters(c, tk, t, fill, per);
    c.restore();
  }

  // companions (props) — drawn in block-local space
  private withTok(c: CanvasRenderingContext2D, tk: Tok, fn: () => void) { c.save(); c.translate(tk.x, tk.y); if (tk.rot) c.rotate(tk.rot); fn(); c.restore(); }
  private compWindow(tk: Tok): [number, number, boolean, boolean] {   // t0, t1, back?, echo?
    switch (tk.comp) {
      case 'flames': return [tk.t - .05, 1e9, true, false];
      case 'skyline': case 'people': case 'swash': return [tk.t - .3, 1e9, false, false];
      case 'stars': return [tk.t - .45, 1e9, false, false];
      case 'shackle': return [tk.t - .1, tk.t + 1.1, false, true];
      case 'hearts': return [tk.t, tk.t + .7, true, false];
      case 'bolt': return [tk.t - .02, tk.t + .3, true, false];
      case 'march': return [tk.t - .4, tk.t + 2.8, false, true];
      case 'waves': return [tk.t - .2, tk.t + 2.6, false, false];
      case 'road': return [tk.t - .1, 1e9, false, false];
      default: return [0, -1, false, false];
    }
  }
  private drawComp(c: CanvasRenderingContext2D, tk: Tok, t: number, fill: string) {
    const cap = tk.cap, W = tk.w, P = this.pal();
    this.withTok(c, tk, () => {
      c.fillStyle = fill; c.strokeStyle = fill;
      switch (tk.comp) {
        case 'flames': {
          const g = eOut(clamp((t - tk.t) / .15)); const base = -cap * .97; c.fillStyle = P.warm;
          for (let i = 0; i < tk.text.length; i++) {
            if (tk.text[i] === ' ') continue;
            const x0 = tk.xs[i], x1 = tk.xs[i + 1], lw = x1 - x0, cx = (x0 + x1) / 2, R = rng(i * 53 + Math.floor(t * 15) * 7 + tk.seed);
            const h = cap * .62 * g * (.8 + R() * .35);
            flameTongue(c, cx + (R() - .5) * lw * .1, base, lw * .46, h, (R() - .5) * cap * .16);
            flameTongue(c, x0 + lw * .2, base, lw * .26, h * (.42 + R() * .2), -cap * .05);
            flameTongue(c, x1 - lw * .2, base, lw * .26, h * (.38 + R() * .2), cap * .05);
          }
          break;
        }
        case 'skyline': {
          const p = eBackOut(clamp((t - tk.t + .3) / .4), 1.4), hgt = cap * .45, base = cap * .55;
          c.save(); c.translate(0, base); c.scale(1, p); const R = rng(77 + tk.seed); let x = 0;
          c.fillRect(0, -hgt * .05, W, hgt * .05);
          while (x < W - hgt * .3) {
            const steeple = Math.abs(x - W * .55) < hgt * .5, bw = steeple ? hgt * .45 : hgt * (.45 + R() * .45), bh = steeple ? hgt * .55 : hgt * (.35 + R() * .3);
            c.fillRect(x, -bh, bw, bh);
            if (steeple) { c.fillRect(x + bw * .25, -bh - hgt * .35, bw * .5, hgt * .35); c.beginPath(); c.moveTo(x + bw * .25, -bh - hgt * .35); c.lineTo(x + bw * .5, -bh - hgt * 1.05); c.lineTo(x + bw * .75, -bh - hgt * .35); c.fill(); }
            else { c.beginPath(); c.moveTo(x - hgt * .03, -bh); c.lineTo(x + bw / 2, -bh - bw * .45); c.lineTo(x + bw + hgt * .03, -bh); c.fill(); c.fillRect(x + bw * .7, -bh - bw * .4, bw * .1, bw * .3); }
            x += bw + hgt * (.06 + R() * .12);
          }
          c.restore(); break;
        }
        case 'people': {
          const h = cap * .5, ground = cap * .7, n = Math.max(4, Math.min(11, Math.round(W / (cap * .3))));
          for (let i = 0; i < n; i++) { const p = eBackOut(clamp((t - (tk.t + i * .025)) / .2), 1.6); if (p <= 0) continue; c.save(); c.translate(W * (i + .5) / n, ground); c.scale(1, p); person(c, h, [0, 1, 2, 3, 1, 0, 3, 2, 0, 1, 0][i % 11]); c.restore(); }
          c.fillRect(0, ground, W, cap * .02); break;
        }
        case 'waves': {
          const k = clamp((t - tk.t + .2) / .3) * clamp(1 - (t - tk.t - 2) / .6);
          c.lineWidth = cap * .035; c.lineCap = 'round'; c.globalAlpha *= k;
          for (let j = 0; j < 3; j++) { c.beginPath(); for (let x = 0; x <= W; x += W / 60) { const y = cap * (.28 + j * .16) + Math.sin(x / cap * 5 - t * 6 + j * 1.3) * cap * .05; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
          break;
        }
        case 'stars': {
          const ring = tk.pict && tk.pict.shape === 'ring' ? tk.pict : null;
          const n = 13;
          if (!this.starsFrom.has(tk)) { const R = rng(1776 + tk.seed); this.starsFrom.set(tk, Array.from({ length: n }, () => [R() * W, -R() * cap * 2.6 - cap * .4 + R() * cap * 4.2, R() * 6.28])); }
          const from = this.starsFrom.get(tk)!;
          const cx = ring ? (tk.xs[ring.i] + tk.xs[ring.i + 1]) / 2 : W / 2, cy = ring ? -cap / 2 : -cap * 1.25, Rr = ring ? cap * .74 : W * .45, sr = cap * .08;
          for (let k = 0; k < n; k++) {
            const t0 = tk.t - .4 + k * .02, t1 = tk.t + .45 + k * .05, q = eIO(clamp((t - t0) / (t1 - t0)));
            const a = ring ? -Math.PI / 2 + k * Math.PI * 2 / n : Math.PI + (k + .5) / n * Math.PI;
            const tx = cx + Math.cos(a) * Rr, ty = cy + Math.sin(a) * (ring ? Rr : cap * .5);
            const [fx, fy, fr] = from[k]; const mx = (fx + tx) / 2 + (k % 2 ? 1 : -1) * cap, my = Math.min(fy, ty) - cap * 1.2;
            const x = (1 - q) * (1 - q) * fx + 2 * (1 - q) * q * mx + q * q * tx, y = (1 - q) * (1 - q) * fy + 2 * (1 - q) * q * my + q * q * ty;
            const lift = clamp((t - t0) / .12); starPath(c, x, y, sr * lift * lerp(2.6, 1, q), fr * (1 - q)); c.fill();
          }
          break;
        }
        case 'shackle': {
          const sx = tk.xs[0] + (tk.xs[1] - tk.xs[0]) * .2, cy = -cap * .5, rx = cap * .2, ry = cap * .28, lw = cap * .075;
          const a = eOut(clamp((t - tk.t - .15) / .55));
          c.lineWidth = lw;
          c.save(); c.translate(-a * cap * .3, a * a * cap * 2.4); c.rotate(-a * .5);
          for (let k = 0; k < 4; k++) { const lx = sx - rx - cap * (.2 + k * .3); c.lineWidth = lw * .8; c.beginPath(); if (k % 2 === 0) c.ellipse(lx, cy, cap * .17, cap * .085, 0, 0, Math.PI * 2); else { c.moveTo(lx - cap * .14, cy); c.lineTo(lx + cap * .14, cy); } c.stroke(); }
          c.restore();
          for (const sd of [-1, 1]) { c.save(); c.translate(sx + sd * a * cap * 1.4, cy + a * a * cap * 2.2); c.rotate(sd * a * 1.9); c.lineWidth = lw; c.beginPath(); c.ellipse(0, 0, rx, ry, 0, sd < 0 ? Math.PI * .5 : -Math.PI * .5, sd < 0 ? Math.PI * 1.5 : Math.PI * .5); c.stroke(); c.restore(); }
          break;
        }
        case 'hearts': {
          const p = clamp((t - tk.t) / .7); c.globalAlpha *= (1 - p) * .6; c.strokeStyle = P.warm;
          for (const [k, lw] of [[1, .06], [.8, .02]] as const) { c.save(); c.translate(W / 2, -cap / 2); heartPath(c, cap * lerp(.5, 1.6, eOut(p)) * k); c.lineWidth = cap * lw; c.stroke(); c.restore(); }
          break;
        }
        case 'bolt': {
          const p = clamp((t - tk.t + .02) / .3); c.globalAlpha *= (1 - p) * .85; c.fillStyle = P.warm;
          c.save(); c.translate(W / 2, -cap / 2); c.scale(1 + p * .3, 1 + p * .3); drawIcon(c, 'bolt', cap * 1.1); c.restore();
          break;
        }
        case 'march': {
          const h = cap * .55, ground = cap * .78, speed = cap * 4.2, x0 = W + cap - (t - tk.t + .4) * speed;
          for (let i = 0; i < 5; i++) { const x = x0 + i * h * 1.05; if (x < -h || x > W + h * 2) continue; c.save(); c.translate(x, ground - h * .5 - Math.abs(Math.sin((t * 10 + i) * 1.2)) * h * .08); drawIcon(c, tk.icon, h * .5, t); c.restore(); }
          break;
        }
        case 'swash': {
          const p = eIO(clamp((t - tk.t - .1) / .6)); if (p <= 0) break;
          const y0 = cap * .32, pts: number[][] = [];
          const segs = [[[-cap * .05, y0 + cap * .05], [W * .05, y0 + cap * .45], [W * .2, y0 - cap * .05], [W * .12, y0 + cap * .1]], [[W * .12, y0 + cap * .1], [W * .05, y0 + cap * .25], [W * .3, y0 + cap * .32], [W * .55, y0 + cap * .2]], [[W * .55, y0 + cap * .2], [W * .8, y0 + cap * .08], [W, y0 + cap * .05], [W * 1.02, y0 + cap * .18]], [[W * 1.02, y0 + cap * .18], [W * 1.04, y0 + cap * .32], [W * .9, y0 + cap * .3], [W * .94, y0 + cap * .2]]];
          for (const [a0, b0, d0, e0] of segs) for (let i = 0; i <= 30; i++) { const u = i / 30, m = 1 - u; pts.push([m * m * m * a0[0] + 3 * m * m * u * b0[0] + 3 * m * u * u * d0[0] + u * u * u * e0[0], m * m * m * a0[1] + 3 * m * m * u * b0[1] + 3 * m * u * u * d0[1] + u * u * u * e0[1]]); }
          const n = Math.floor(p * (pts.length - 1)); c.strokeStyle = tk.block.world === 'night' ? P.coolN : P.coolP; c.lineCap = 'round';
          for (let i = 1; i <= n; i++) { const u = i / (pts.length - 1); c.lineWidth = cap * (.012 + .03 * Math.pow(Math.sin(Math.PI * u), 1.5)); c.beginPath(); c.moveTo(pts[i - 1][0], pts[i - 1][1]); c.lineTo(pts[i][0], pts[i][1]); c.stroke(); }
          break;
        }
        case 'road': {
          const p = eOut(clamp((t - tk.t) / .5)); c.fillRect(0, cap * .22, W * p, cap * .05);
          for (let x = 0; x < W * p - cap * .2; x += cap * .5) c.fillRect(x + ((t * cap * 2) % (cap * .5)), cap * .36, cap * .25, cap * .03);
          break;
        }
        default: break;
      }
    });
  }

  private drawBlock(c: CanvasRenderingContext2D, b: Block, t: number) {
    c.save(); c.translate(b.x, b.y); c.rotate(b.rot);
    const echo = Boolean(this.p.echoes), P = this.pal();
    const comps = b.toks.filter(tk => tk.comp);
    const pass = (back: boolean) => {
      for (const tk of comps) {
        const [t0, t1, bk, ec] = this.compWindow(tk); if (bk !== back || t < t0 || t > t1) continue;
        const fill = this.tokColor(tk);
        if (ec && echo) for (const [k, al] of [[3, .15], [2, .35], [1, .6]] as const) { const te = t - k * 4 * FR; if (te < t0) continue; c.save(); c.globalAlpha *= al; this.drawComp(c, tk, te, P.echo); c.restore(); }
        this.drawComp(c, tk, t, tk.comp === 'flames' ? P.warm : fill);
      }
    };
    pass(true);
    for (const tk of b.toks) this.drawToken(c, tk, t);
    pass(false);
    c.restore();
  }

  private blockVisible(b: Block, inv: DOMMatrix): boolean {
    // project the screen corners into level space and test against the block bbox
    const { width: W, height: H } = this.ctx; const bb = this.bbox(b);
    const pts = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => inv.transformPoint(new DOMPoint(x, y)));
    const x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x)), y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y));
    const m = MEAS * .6;
    return !(bb.x1 + m < x0 || bb.x0 - m > x1 || bb.y1 + m < y0 || bb.y0 - m > y1);
  }

  private drawLevel(c: CanvasRenderingContext2D, lv: number, t: number) {
    const inv = c.getTransform().inverse();
    for (const b of this.levels[lv].blocks) if (this.blockVisible(b, inv)) this.drawBlock(c, b, t);
  }

  private fillWorld(c: CanvasRenderingContext2D, world: 'night' | 'paper', x: number, y: number, r: number, t: number) {
    c.fillStyle = this.bg(world); c.fillRect(x - r, y - r, r * 2, r * 2);
    void t;
  }

  private content(c: CanvasRenderingContext2D, t: number, alpha: number) {
    const { width: W, height: H, song } = this.ctx; const a = song.analysis;
    const cam = this.camAt(t);
    const breathe = Number(this.p.breathe), shakeK = Number(this.p.shake) * this.ctx.settings.cameraEnergy / 100;
    const pulseK = Number(this.p.pulse) * this.ctx.settings.reactivity / 100;
    const dr = .6 * Math.PI / 180 * Math.sin(t * .7) * breathe;
    let dz = 1 + .015 * Math.sin(t * .9 + 1) * breathe;
    const bi = this.lastBeat(t); if (bi >= 0) dz *= 1 + .012 * pulseK * Math.exp(-(t - a.beats[bi]) * 8);
    let sx = 0, sy = 0;
    for (const st of this.slams) { const d = t - st; if (d >= 0 && d < 2 * FR) { const f = Math.round(d / FR); sx += (f ? -1 : 1) * H * .015 * shakeK; sy += (f ? 1 : -.6) * H * .01 * shakeK; } }
    c.save(); c.globalAlpha = alpha;
    c.translate(W / 2 + sx, H / 2 + sy);
    if (this.p.tiltOpen) { const k = 1 - eIO(clamp((t - (this.firstT - 1.0)) / 2.6)); if (k > 0) { c.rotate(-15 * Math.PI / 180 * k); c.transform(1, 0, -.38 * k, 1 - .3 * k, 0, 0); } }
    c.rotate(cam.rot + dr); c.scale(cam.zoom * dz, cam.zoom * dz); c.translate(-cam.cx, -cam.cy);
    const base = c.getTransform();
    const L = cam.level, lv = this.levels[L];
    const inParentPhase = lv.parent >= 0 && (t < lv.tFull || t >= lv.tOut);
    if (inParentPhase) {
      // parent world around the portal
      const pl = this.levels[lv.parent];
      c.scale(1 / lv.s, 1 / lv.s); c.translate(-lv.ox, -lv.oy);
      this.fillWorld(c, pl.blocks[pl.blocks.length - 1]?.world ?? pl.world, lv.ox, lv.oy, lv.R * 400, t);
      this.drawLevel(c, lv.parent, t);
      c.setTransform(base);
      c.beginPath(); c.arc(0, 0, lv.r / lv.s + .5, 0, Math.PI * 2); c.clip();
      const fillA = clamp((t - lv.tOpen) / .35);
      c.globalAlpha = alpha * fillA; this.fillWorld(c, lv.world, 0, 0, lv.r / lv.s * 1.2, t); c.globalAlpha = alpha;
      this.paperLines(c, base, lv.world, t);
    } else {
      // full-screen world of the block the camera is on
      const nb = this.nearestBlock(L, t);
      c.setTransform(1, 0, 0, 1, 0, 0); this.background(c, nb?.world ?? lv.world, t); c.setTransform(base);
    }
    this.drawLevel(c, L, t);
    // the next world waiting inside its O
    for (let ci = 0; ci < this.levels.length; ci++) {
      const ch = this.levels[ci]; if (ch.parent !== L || t < ch.tOpen - .1) continue;
      c.save(); c.setTransform(base); c.translate(ch.ox, ch.oy); c.scale(ch.s, ch.s);
      c.beginPath(); c.arc(0, 0, ch.r / ch.s + .5, 0, Math.PI * 2); c.clip();
      c.globalAlpha = alpha * clamp((t - ch.tOpen) / .35); this.fillWorld(c, ch.world, 0, 0, ch.r / ch.s * 1.2, t); c.globalAlpha = alpha;
      const b2 = c.getTransform(); this.paperLines(c, b2, ch.world, t);
      this.drawLevel(c, ci, t);
      c.restore();
    }
    c.restore();
  }
  private paperLines(c: CanvasRenderingContext2D, base: DOMMatrix, world: 'night' | 'paper', t: number) {
    if (world !== 'paper') return;
    const { width: W, height: H } = this.ctx;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = 'rgba(21,19,15,.04)';
    for (let y = 0; y < H; y += Math.max(3, Math.round(H / 180))) c.fillRect(0, y, W, 1);
    c.restore(); c.setTransform(base); void t;
  }
  private nearestBlock(level: number, t: number): Block | undefined {
    const bs = this.levels[level].blocks; let best = bs[0];
    for (const b of bs) { const t0 = Math.min(...b.toks.map(x => x.t)); if (t0 - .35 <= t) best = b; }
    return best;
  }
  private lastBeat(t: number) { const B = this.ctx.song.analysis.beats; let lo = 0, hi = B.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (B[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; }

  private background(c: CanvasRenderingContext2D, world: 'night' | 'paper', t: number) {
    const { width: W, height: H } = this.ctx; const P = this.pal();
    if (world === 'night') {
      const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .25, W / 2, H / 2, Math.max(W, H) * .62);
      const bass = sample(this.ctx.song.analysis.bands.bass, t) * Number(this.p.pulse) * this.ctx.settings.reactivity / 100;
      g.addColorStop(0, mixHex(P.night, P.bone, .03 * bass)); g.addColorStop(.55, mixHex(P.night, P.vig, .35)); g.addColorStop(1, P.vig);
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    } else {
      c.fillStyle = P.paper; c.fillRect(0, 0, W, H);
      const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .4, W / 2, H / 2, Math.max(W, H) * .75);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(60,45,20,.10)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(21,19,15,.04)'; for (let y = 0; y < H; y += Math.max(3, Math.round(H / 180))) c.fillRect(0, y, W, 1);
    }
  }

  render(t: number, out: CanvasRenderingContext2D) {
    const { width: W, height: H, song } = this.ctx;
    out.save(); out.setTransform(1, 0, 0, 1, 0, 0); out.globalAlpha = 1;
    out.fillStyle = this.bg(this.blocks[0]?.world ?? 'night'); out.fillRect(0, 0, W, H);
    if (!this.toks.length) { out.restore(); return; }
    const blur = Boolean(this.p.doubleExposure) && this.blurWin.some(([a, b]) => t >= a && t <= b);
    this.content(out, t, 1);
    if (blur) this.content(out, t - 2 * FR, .22);
    const fade = clamp((t - (song.analysis.duration - .6)) / .55);
    if (fade > 0) { out.setTransform(1, 0, 0, 1, 0, 0); out.fillStyle = `rgba(0,0,0,${fade})`; out.fillRect(0, 0, W, H); }
    out.restore();
  }
}

function mixHex(a: string, b: string, k: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export const BroadsideFactory: EffectFactory = { id: 'broadside', name: 'Broadside', description: 'Classic kinetic-type lock-ups — slams, whip-pans, vertical connectives, pictogram letters, and a dive through the O between worlds.', params: PARAMS, create: () => new BroadsideEffect() };

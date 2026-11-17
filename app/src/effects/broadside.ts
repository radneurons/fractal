// BROADSIDE — classic kinetic-type lock-ups (SPEC §8.1).
// Huge justified words, small connectives stacked or turned sideways, slams and whip-pans, and a dive
// through a letter O into a new world. Each world is its own coordinate frame ("level").
// Reduce motion calms: camera shake (off), breathing (off), roll (±3°), whips (≥ 0.8 s), the tilted opening
// and the double exposure (off); letter-flying entrances become slides.
import type { Line, Word } from '../types.ts';
import { Canvas2DEffect, type EffectContext, type EffectMeta, range, toggle, select, aff } from './types.ts';
import { registerEffect } from './registry.ts';
import {
  type Ctx2D, setFont, textWidth, cleanDisplay, graphemes, canSplitLetters, clamp01, lerp, easeOutCubic, easeOutBack, easeOutBounce,
  easeInOutQuad, easeOutQuint, timingOf, wordState, subtitle, fr, lineAt, type TimingOpts,
} from '../render/textkit.ts';
import { type CamKey, buildKeys, sampleCamera } from '../render/camera.ts';
import { drawIcon } from '../render/icons.ts';
import { conceptById } from '../director/lexicon.ts';
import { hash01, sample, pulse } from '../analysis/dsp.ts';
import { keyHue } from '../analysis/harmony.ts';
import { hsl, rgbToHex, rgba, mixHex } from '../render/gl.ts';

type Entrance = 'slam' | 'slide' | 'drop' | 'ghost' | 'standup' | 'fly' | 'wipe' | 'knocked' | 'tick';
const FRAMES: Record<Entrance, number> = { slam: 5, slide: 14, drop: 16, ghost: 14, standup: 8, fly: 50, wipe: 30, knocked: 5, tick: 1 };

interface Item {
  kind: 'big' | 'vert' | 'stack';
  words: Word[];
  text: string;
  rows?: { text: string; words: Word[] }[];
  font: string;
  x: number; w: number; cap: number;      // block-local, baseline at line.y
  entrance: Entrance;
  land: number;                            // seconds (anticipation applied)
  ent: number;                             // entrance length in seconds
  letters?: { ch: string; x: number; w: number }[];
  colour?: string;
  ring?: number;                           // letter index replaced by the portal ring
  ringStem?: boolean;                      // the replaced letter was a D or B: keep its stem
  picto?: { index: number; icon: string; shape: 'ring' | 'stem' | 'tri' };
  prop?: string;
  swash?: boolean;
}
interface LockLine { items: Item[]; y: number; cap: number; line: Line; width: number; start: number; end: number }
interface Block { lines: LockLine[]; h: number; ox: number; oy: number; rot: number; level: number; start: number; end: number; world: 0 | 1; idx: number; bbox: [number, number, number, number] }
interface Level { world: 0 | 1; blocks: Block[]; start: number; ring?: { x: number; y: number; rOut: number; rIn: number; rot: number; s: number; cx: number; cy: number; tFull: number; tShow: number } }

const PALETTES: Record<string, { night: [string, string, string]; paper: [string, string, string]; red: string; coolNight: string; coolPaper: string }> = {
  classic: { night: ['#1A1918', '#050505', '#EDE7DA'], paper: ['#F2ECDF', '#DCD2BE', '#15130F'], red: '#B3202A', coolNight: '#8FB0D6', coolPaper: '#1C2C5B' },
  newsprint: { night: ['#22211F', '#0B0B0A', '#E9E4D8'], paper: ['#E8E3D6', '#CFC8B6', '#1B1A18'], red: '#8C1C13', coolNight: '#B9B4A6', coolPaper: '#3A3935' },
  neon: { night: ['#0B0714', '#000000', '#F4F0FF'], paper: ['#150A2A', '#05020C', '#F4F0FF'], red: '#FF2D75', coolNight: '#29E3FF', coolPaper: '#29E3FF' },
  mono: { night: ['#111111', '#000000', '#F2F2F2'], paper: ['#F2F2F2', '#D8D8D8', '#111111'], red: '#777777', coolNight: '#BBBBBB', coolPaper: '#444444' },
};
const RED_CONCEPTS = new Set(['fire', 'heart', 'crown', 'quake', 'shock']);

export class Broadside extends Canvas2DEffect {
  static meta: EffectMeta = {
    id: 'broadside', name: 'Broadside', kind: '2d',
    description: 'Classic kinetic-type lock-ups: huge justified words, sideways connectives, slams, whip-pans and a dive through the O.',
    affinity: aff(0.8, 0.45, 0.85, 0.75, 0.6, 0.55, 0.55, 0.75),
    supportsTransparent: true,
    params: [
      select('palette', 'Palette', 'Look', 'classic', ['classic', 'newsprint', 'neon', 'mono', 'key'], false),
      select('worlds', 'Worlds', 'Look', 'by section', ['by section', 'night', 'paper'], false),
      range('accent', 'Accent amount', 'Look', 0.7, 0, 1, 0.01, false),
      toggle('dive', 'Dive through the O', 'Layout', true, false),
      toggle('turns', '90° turns', 'Layout', true, false),
      range('linesPerBlock', 'Lines per block', 'Layout', 4, 2, 8, 1, false),
      range('maxBig', 'Big words per line', 'Layout', 3, 1, 5, 1, false),
      select('entrances', 'Entrances', 'Motion', 'auto', ['auto', 'slam', 'slide', 'drop', 'standup'], false),
      toggle('pictograms', 'Pictogram letters', 'Extras', true, false),
      toggle('props', 'Props', 'Extras', true),
      toggle('echo', 'Echo trails', 'Extras', true),
      range('shake', 'Shake', 'Camera', 1, 0, 2, 0.01),
      range('breathing', 'Breathing', 'Camera', 1, 0, 2, 0.01),
      toggle('doubleExposure', 'Double exposure', 'Camera', true),
      toggle('tilt', 'Tilted opening', 'Camera', true),
      range('pulse', 'Beat pulse', 'Camera', 1, 0, 2, 0.01),
    ],
  };
  readonly meta = Broadside.meta;
  private levels: Level[] = [];
  private blocks: Block[] = [];
  private keys: CamKey[] = [];
  private tm!: TimingOpts;
  private pal = PALETTES.classic;
  private impacts: number[] = [];
  private lastEnd = 0;
  private whips: [number, number][] = [];

  // ---------- prepare ----------
  async prepare(ctx: EffectContext): Promise<void> {
    await this.init(ctx);
    this.tm = timingOf(this.s);
    const pname = this.str('palette');
    this.pal = PALETTES[pname] ?? PALETTES.classic;
    if (pname === 'key' || this.s.paletteSource === 'key') {
      const h = keyHue(this.a.key.tonic), minor = this.a.key.mode === 'minor';
      const c = hsl(h, minor ? 0.6 : 0.72, minor ? 0.42 : 0.5);
      this.pal = { ...PALETTES.classic, red: rgbToHex(c[0], c[1], c[2]) };
    } else if (this.s.paletteSource === 'artwork' && ctx.artwork) {
      const a = ctx.artwork;
      this.pal = { night: [mixHex(a.darkest, '#000', 0.3), '#030303', mixHex(a.lightest, '#fff', 0.5)], paper: [mixHex(a.lightest, '#fff', 0.4), mixHex(a.lightest, '#888', 0.3), mixHex(a.darkest, '#000', 0.5)], red: a.vivid1, coolNight: a.vivid2, coolPaper: mixHex(a.vivid2, '#000', 0.4) };
    }
    this.build();
  }

  private worldOf(line: Line): 0 | 1 {
    const w = this.str('worlds');
    if (w === 'night') return 0;
    if (w === 'paper') return 1;
    const lab = this.a.sections[line.section]?.label;
    return lab === 'chorus' || lab === 'drop' ? 1 : 0;
  }

  private fontFor(w: Word, line: Line, hookLine: boolean): string {
    if (hookLine) return 'barlowCondIt';
    const c = w.concept;
    if (c === 'shock' || c === 'quake') return 'stencil';
    if (c === 'heart' || c === 'crown' || c === 'time' || c === 'moon' || c === 'star') return 'caslon';
    if (w.role === 'hero' && w.stress > 0.8 && hash01(w.id, this.seed, 11) < 0.18) return 'caslon';
    void line;
    return 'montserrat';
  }

  private pickEntrance(w: Word, isHero: boolean, prev: Entrance | null, first: boolean, hook: boolean): Entrance {
    const forced = this.str('entrances');
    const split = canSplitLetters(w) && !this.s.reduceMotion;
    if (hook && first && split) return 'fly';
    if (forced !== 'auto') return forced === 'standup' && !split ? 'slam' : (forced as Entrance);
    const a = this.a, t = w.start;
    if (w.concept === 'shock' && split) return 'knocked';
    let e: Entrance;
    const r = hash01(w.id, this.seed, 5);
    if (isHero) {
      if (sample(a.flux, t + 0.02) > 0.55) e = 'slam';
      else if (sample(a.loud, t + 0.05) < 0.28) e = 'ghost';
      else e = r < 0.4 ? 'slam' : r < 0.68 ? 'slide' : r < 0.88 ? 'drop' : 'standup';
    } else e = r < 0.5 ? 'slide' : r < 0.8 ? 'slam' : 'drop';
    if (e === prev) e = e === 'slam' ? 'slide' : e === 'slide' ? 'drop' : 'slam';
    if (e === 'standup' && !split) e = 'slam';
    return e;
  }

  private build(): void {
    const ly = this.ly, s = this.s, seed = this.seed;
    const portrait = this.H > this.W;
    const maxBig = Math.max(1, Math.min(portrait ? 2 : 9, Math.round(this.num('maxBig'))));
    const accentAmt = this.num('accent');
    const antic = this.tm.anticipation;
    const blocks: Block[] = [];
    let prevEnt: Entrance | null = null;
    let cur: Block | null = null;
    let lastProp = -Infinity;
    const lastBigWord = [...ly.words].reverse().find((w) => !w.backing && w.role !== 'connective');
    const hookSeen = new Set<number>();
    for (const line of ly.lines) {
      const ws = line.words.map((i) => ly.words[i]);
      if (!ws.length) continue;
      const world = this.worldOf(line);
      const secLabel = this.a.sections[line.section]?.label;
      const prevLine = ly.lines[line.idx - 1];
      const firstOfChorus = (secLabel === 'chorus' || secLabel === 'drop') && (!prevLine || prevLine.section !== line.section);
      const hookLine = !!(firstOfChorus || (line.hook && !hookSeen.has(line.section)));
      if (line.hook) hookSeen.add(line.section);
      // ----- tokens → items -----
      type Tok = { kind: 'big'; w: Word } | { kind: 'conn'; ws: Word[] };
      const toks: Tok[] = [];
      let hasBig = ws.some((w) => !w.backing && w.role !== 'connective');
      let promote: Word | null = null;
      if (!hasBig) { promote = ws.filter((w) => !w.backing).sort((a, b) => b.text.length - a.text.length)[0] ?? ws[0]; hasBig = true; }
      for (const w of ws) {
        const big = w === promote || (!w.backing && w.role !== 'connective');
        if (big) toks.push({ kind: 'big', w });
        else { const last = toks[toks.length - 1]; if (last && last.kind === 'conn') last.ws.push(w); else toks.push({ kind: 'conn', ws: [w] }); }
      }
      // wrap into lock-ups of ≤ maxBig big words; connectives stay with the word they lead into
      const groups: Tok[][] = [[]];
      let nb = 0;
      for (let i = 0; i < toks.length; i++) {
        const tk = toks[i];
        const nextBig = tk.kind === 'conn' && toks[i + 1]?.kind === 'big';
        if ((tk.kind === 'big' && nb >= maxBig) || (nextBig && nb >= maxBig)) { if (groups[groups.length - 1].length) { groups.push([]); nb = 0; } }
        groups[groups.length - 1].push(tk);
        if (tk.kind === 'big') nb++;
      }
      // a trailing connective-only group joins the previous lock-up
      if (groups.length > 1 && groups[groups.length - 1].every((x) => x.kind === 'conn')) groups[groups.length - 2].push(...groups.pop()!);
      let firstBigOfLine = true;
      for (const grp of groups) {
        if (!grp.length) continue;
        const items: Item[] = [];
        let x = 0;
        const GAP = 20;
        for (const tk of grp) {
          if (tk.kind === 'big') {
            const w = tk.w;
            const font = this.fontFor(w, line, hookLine);
            const text = cleanDisplay(w, s.caseMode);
            const width = textWidth(text, font, 100);
            const isHero = w.role === 'hero';
            const entrance: Entrance = w === lastBigWord ? 'wipe' : this.pickEntrance(w, isHero, prevEnt, firstBigOfLine, hookLine);
            prevEnt = entrance;
            const it: Item = { kind: 'big', words: [w], text, font, x, w: width, cap: 100, entrance, land: w.start - antic, ent: 0 };
            if (w === lastBigWord) it.swash = true;
            const gs = graphemes(text);
            if (canSplitLetters(w) && gs.length <= 24) {
              let acc = '';
              it.letters = gs.map((ch) => { const x0 = textWidth(acc, font, 100); acc += ch; return { ch, x: x0, w: textWidth(acc, font, 100) - x0 }; });
            }
            const n = it.letters?.length ?? 1;
            it.ent = fr(FRAMES[entrance]) + (entrance === 'standup' ? fr(3) * n : entrance === 'fly' ? fr(3) * n * 0.5 : 0);
            // colours: concept heroes take the accent; voice B takes the secondary accent
            const c = conceptById(w.concept);
            const cool = world === 0 ? this.pal.coolNight : this.pal.coolPaper;
            if (s.voicePalette && w.voice === 'B') it.colour = cool;
            else if (isHero && c && hash01(w.id, seed, 21) < accentAmt) it.colour = RED_CONCEPTS.has(c.id) ? this.pal.red : cool;
            // pictogram letter: the first matching letter after the first
            if (this.bool('pictograms') && isHero && c && it.letters) {
              const re = c.shape === 'ring' ? /[O0]/i : c.shape === 'stem' ? /[I1]/i : /[AV]/i;
              const k = it.letters.findIndex((l, i) => i > 0 && re.test(l.ch));
              if (k > 0) it.picto = { index: k, icon: c.icon, shape: c.shape };
            }
            if (isHero && c && w.start - lastProp >= 1.6) { it.prop = c.id; lastProp = w.start; }
            items.push(it);
            x += width + GAP;
            firstBigOfLine = false;
          } else {
            const cs = tk.ws;
            const single = cs.length === 1 && Array.from(cs[0].text).length <= 6 && !cs[0].backing;
            const vertical = (single && hash01(cs[0].id, seed, 7) < 0.45) || cs.every((w) => w.backing);
            if (vertical && cs.length <= 2) {
              const text = cs.map((w) => cleanDisplay(w, s.caseMode)).join(' ');
              let cap = 30;
              const len = textWidth(text, 'montserrat600', cap);
              if (len > 118) cap *= 118 / len;
              items.push({ kind: 'vert', words: cs, text, font: cs[0].backing ? 'barlowCondIt' : 'montserrat600', x, w: cap * 1.5, cap, entrance: 'tick', land: cs[0].start - antic, ent: fr(1) });
              x += cap * 1.5 + GAP * 0.7;
            } else {
              const n = cs.length <= 1 ? 1 : cs.length <= 4 ? 2 : 3;
              const rc = (100 * (1 - 0.22 * (n - 1))) / n;
              const rows: { text: string; words: Word[] }[] = [];
              const per = Math.ceil(cs.length / n);
              for (let r = 0; r < n; r++) { const part = cs.slice(r * per, (r + 1) * per); if (part.length) rows.push({ text: part.map((w) => cleanDisplay(w, s.caseMode)).join(' '), words: part }); }
              const width = Math.max(...rows.map((r) => textWidth(r.text, 'montserrat600', rc)));
              items.push({ kind: 'stack', words: cs, text: '', rows, font: 'montserrat600', x, w: width, cap: rc, entrance: 'tick', land: cs[0].start - antic, ent: fr(1) });
              x += width + GAP;
            }
          }
        }
        const natural = Math.max(1, x - GAP);
        const S = Math.min(420, (100 * 1000) / natural);
        const k = S / 100;
        const voiceB = s.voicePalette && line.voice === 'B' && ly.lines.some((o) => o.voice === 'A');
        for (const it of items) {
          it.x *= k; it.w *= k; it.cap *= k;
          it.letters?.forEach((l) => { l.x *= k; l.w *= k; });
          if (voiceB) it.x += 1000 - natural * k; // voice B hangs from the opposite side of the block
        }
        const first = items[0].words[0], lastW = items[items.length - 1].words;
        const lock: LockLine = { items, y: 0, cap: S, line, width: natural * k, start: first.start, end: lastW[lastW.length - 1].end };
        // ----- blocks: a new block per section, after linesPerBlock lock-ups, or after a gap > 3.5 s -----
        const prevLock = cur?.lines[cur.lines.length - 1];
        const newBlock = !cur || cur.world !== world || (prevLock && prevLock.line.section !== line.section) || cur.lines.length >= Math.round(this.num('linesPerBlock')) || (prevLock && lock.start - prevLock.end > 3.5);
        if (newBlock) { cur = { lines: [], h: 0, ox: 0, oy: 0, rot: 0, level: 0, start: lock.start, end: lock.end, world, idx: blocks.length, bbox: [0, 0, 0, 0] }; blocks.push(cur); }
        const b = cur!;
        const prevCap = prevLock && !newBlock ? prevLock.cap : S;
        const hang = prevLock && !newBlock && prevLock.items.some((i) => i.prop && ['home', 'water', 'people', 'road'].includes(i.prop)) ? 0.3 * prevLock.cap : 0;
        const gap = b.lines.length ? 0.17 * Math.min(prevCap, S) + hang : 0;
        lock.y = b.h + gap + S;
        b.h = lock.y;
        b.lines.push(lock);
        b.end = lock.end;
      }
    }
    // ----- levels: a new level whenever the world changes; chain blocks inside a level -----
    const levels: Level[] = [];
    const dive = this.bool('dive'), turns = this.bool('turns') && !this.s.reduceMotion;
    for (const b of blocks) {
      let L = levels[levels.length - 1];
      if (!L || (L.world !== b.world && dive)) { L = { world: b.world, blocks: [], start: b.start }; levels.push(L); }
      b.level = levels.length - 1;
      const prev = L.blocks[L.blocks.length - 1];
      if (!prev) { b.ox = 0; b.oy = 0; b.rot = 0; }
      else {
        const n = L.blocks.length;
        const rotIdx = turns ? n % 2 : 0;
        const sign = hash01(b.idx, seed, 31) < 0.5 ? 1 : -1;
        const G = 90;
        if (rotIdx === 1) {
          b.rot = (sign * Math.PI) / 2;
          if (sign > 0) { b.ox = prev.bbox[2] + G + b.h; b.oy = prev.bbox[1]; }   // hangs down the right side
          else { b.ox = prev.bbox[2] + G; b.oy = prev.bbox[1] + 1000; }           // reads upward beside it
        } else {
          b.rot = 0;
          const pp = L.blocks[n - 2];
          b.ox = pp ? pp.bbox[0] : prev.bbox[0];
          b.oy = Math.max(prev.bbox[3], pp ? pp.bbox[3] : -Infinity) + G;
        }
      }
      const c = [this.toLevel(b, 0, 0), this.toLevel(b, 1000, 0), this.toLevel(b, 0, b.h), this.toLevel(b, 1000, b.h)];
      b.bbox = [Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))];
      L.blocks.push(b);
    }
    // ----- portals: the ring in the last block of each level -----
    for (let li = 0; li + 1 < levels.length; li++) {
      const P = levels[li].blocks[levels[li].blocks.length - 1], child = levels[li + 1];
      const bigs: { it: Item; ln: LockLine }[] = [];
      for (const ln of P.lines) for (const it of ln.items) if (it.kind === 'big') bigs.push({ it, ln });
      const cand = bigs.slice(-6).reverse();
      let hit: { it: Item; ln: LockLine; k: number } | null = null;
      for (const re of [/[OQ0]/i, /[DB]/i]) {
        for (const c of cand) { const k = c.it.letters?.findIndex((l) => re.test(l.ch)) ?? -1; if (k >= 0 && !c.it.picto) { hit = { ...c, k }; break; } }
        if (hit) break;
      }
      let cx: number, cy: number, cap: number, tShow: number;
      if (hit) {
        const l = hit.it.letters![hit.k];
        hit.it.ring = hit.k;
        hit.it.ringStem = /[DB]/i.test(l.ch);
        cap = hit.it.cap; cx = hit.it.x + l.x + l.w / 2; cy = hit.ln.y - cap / 2; tShow = hit.it.land;
      } else {
        // stamp an O-ring after the block's last word, with a slam
        const ln = P.lines[P.lines.length - 1];
        const lastIt = ln.items[ln.items.length - 1];
        cap = Math.min(ln.cap, 260);
        cx = Math.min(1000 + cap * 0.7, lastIt.x + lastIt.w + cap * 0.75); cy = ln.y - ln.cap / 2;
        tShow = lastIt.land + 0.25;
        ln.items.push({ kind: 'big', words: lastIt.words, text: '', font: 'montserrat', x: cx - cap * 0.56, w: cap * 1.12, cap, entrance: 'slam', land: tShow, ent: fr(5), ring: -1 });
      }
      const rOut = 0.56 * cap, rIn = 0.36 * cap;
      const fb = child.blocks[0];
      const sc = (0.93 * rIn) / Math.hypot(500, fb.h / 2);
      const [wx, wy] = this.toLevel(P, cx, cy);
      const firstWord = fb.lines[0].items[0];
      child.ring = { x: wx, y: wy, rOut, rIn, rot: P.rot, s: sc, cx: 500, cy: fb.h / 2, tFull: Math.max(tShow + 0.9, firstWord.land - firstWord.ent - 0.3), tShow };
    }
    this.levels = levels; this.blocks = blocks;
    this.buildCamera();
  }

  private toLevel(b: Block, x: number, y: number): [number, number] {
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    return [b.ox + x * c - y * s, b.oy + x * s + y * c];
  }

  private buildCamera(): void {
    const { W, H } = this;
    const portrait = H > W;
    const keys: CamKey[] = [];
    this.impacts = []; this.whips = [];
    const rm = this.s.reduceMotion;
    let prevBlock: Block | null = null;
    for (const b of this.blocks) {
      for (const [li, ln] of b.lines.entries()) for (const it of ln.items) {
        if (it.kind !== 'big') continue;
        // the row above stays in frame (whole) while it is fresh, so a smaller new row never crops a big one
        const prevLn = li > 0 ? b.lines[li - 1] : null;
        const keepPrev = !!prevLn && it.land - prevLn.end < 2.5;
        const xEnd = Math.max(it.x + it.w, keepPrev ? prevLn!.width : 0);
        const fw = Math.max(1.12 * xEnd, 580, 1.5 * it.w);
        const yTop = keepPrev ? prevLn!.y - prevLn!.cap * 1.05 : ln.y - ln.cap * 1.3, yBot = ln.y + ln.cap * 0.3;
        const fh = Math.max(2.6 * ln.cap * (portrait ? 0.8 : 1), (yBot - yTop) * 1.3);
        const zoom = Math.min(W / fw, H / fh) * 0.94;
        const x0 = Math.min(0, it.x);
        const [x, y] = this.toLevel(b, x0 + fw / 2 - 0.04 * fw, keepPrev ? (yTop + yBot) / 2 : ln.y - ln.cap * 0.5);
        // after a dive key the camera is still landing: frame this word a beat later instead of being overridden
        const t = Math.max(it.land - 0.1, (keys[keys.length - 1]?.t ?? -Infinity) + 0.3);
        if (prevBlock && prevBlock !== b && b.level === prevBlock.level) {
          // a new block: hold the last word, then whip in the last 0.5 s
          const whip = rm ? 0.8 : 0.5;
          const last = keys[keys.length - 1];
          if (last && t - whip > last.t + 0.05) { keys.push({ ...last, t: t - whip, ease: 'hold' }); this.whips.push([t - whip, t]); }
        }
        // hold the current framing while it is sung; travel only in the last MOVE s before the next word lands
        // (an unbroken ease over a long gap crops the line being sung as the camera drifts toward the next one)
        const prevK = keys[keys.length - 1];
        const MOVE = rm ? 1.0 : 0.7;
        if (prevK && prevK.ease !== 'hold' && t - prevK.t > MOVE + 0.25) keys.push({ ...prevK, t: t - MOVE, ease: 'hold' });
        keys.push({ t, x, y, zoom, roll: b.rot, level: b.level, ease: 'inout' });
        prevBlock = b;
        if ((it.entrance === 'slam' || it.entrance === 'knocked') && it.words[0].role === 'hero') this.impacts.push(it.land);
      }
      // dive keys into the next level
      const child = this.levels[b.level + 1];
      if (child?.ring && this.levels[b.level].blocks[this.levels[b.level].blocks.length - 1] === b) {
        const r = child.ring;
        const last = keys[keys.length - 1];
        const tHold = Math.max(last ? last.t + 0.2 : 0, r.tFull - 1.5);
        if (last) keys.push({ ...last, t: tHold, zoom: last.zoom * 1.05, ease: 'inout' });
        keys.push({ t: r.tFull - 0.3, x: r.x, y: r.y, zoom: (0.39 * Math.min(W, H)) / r.rOut, roll: b.rot, level: b.level, ease: 'inout' });
        keys.push({ t: r.tFull, x: r.cx, y: r.cy, zoom: (0.66 * Math.max(W, H)) / (r.rIn / r.s), roll: 0, level: b.level + 1, ease: 'in' });
        this.whips.push([r.tFull - 0.5, r.tFull + 0.1]);
      }
    }
    // ending: pull back out through the O when the last block is the first of its level; else fit the last block
    const lastB = this.blocks[this.blocks.length - 1];
    if (lastB) {
      this.lastEnd = lastB.end;
      const L = this.levels[lastB.level];
      const tEnd = Math.min(this.a.duration - 0.3, lastB.end + 1.6);
      if (L.ring && L.blocks[0] === lastB && lastB.level > 0) {
        const r = L.ring;
        keys.push({ t: Math.max(tEnd, (keys[keys.length - 1]?.t ?? 0) + 0.5), x: r.cx, y: r.cy, zoom: (0.3 * Math.min(W, H)) / (r.rOut / r.s), roll: 0, level: lastB.level, ease: 'inout' });
      } else {
        const [x, y] = this.toLevel(lastB, 500, lastB.h / 2);
        keys.push({ t: Math.max(tEnd, (keys[keys.length - 1]?.t ?? 0) + 0.5), x, y, zoom: Math.min(W / 1150, H / (lastB.h * 1.25)), roll: lastB.rot, level: lastB.level, ease: 'inout' });
      }
    }
    this.keys = buildKeys(keys);
  }

  // ---------- render ----------
  private camAt(t: number): { level: number; x: number; y: number; zoom: number; roll: number; diving: boolean } {
    const c = sampleCamera(this.keys, t);
    const la = c.a.level ?? 0, lb = c.b.level ?? 0;
    if (la === lb || c.a === c.b) return { level: la, x: c.x, y: c.y, zoom: c.zoom, roll: c.roll, diving: false };
    // keys on adjacent levels: interpolate in the deeper frame, where precision holds at any depth
    const deep = Math.max(la, lb), r = this.levels[deep].ring!;
    const conv = (k: CamKey): CamKey => {
      if ((k.level ?? 0) === deep) return k;
      const dx = (k.x - r.x) / r.s, dy = (k.y - r.y) / r.s;
      const cs = Math.cos(-r.rot), sn = Math.sin(-r.rot);
      return { ...k, x: r.cx + dx * cs - dy * sn, y: r.cy + dx * sn + dy * cs, zoom: k.zoom * r.s, roll: k.roll - r.rot, level: deep };
    };
    const c2 = sampleCamera([conv(c.a), conv(c.b)], t);
    return { level: deep, x: c2.x, y: c2.y, zoom: c2.zoom, roll: c2.roll, diving: true };
  }

  protected draw(t: number, g: Ctx2D, mask: boolean): void {
    const de = !mask && this.bool('doubleExposure') && !this.s.reduceMotion && this.whips.some(([a, b]) => t >= a && t <= b);
    this.scene(t, g, mask, 1);
    if (de) { g.save(); g.globalAlpha = 0.22; this.scene(t - 2 / 60, g, false, 0.22, true); g.restore(); }
    if (!mask) {
      subtitle(g, this.ly.lines[lineAt(this.ly, t)], t, this.s, this.W, this.H, '#fff');
      // fade to black over the last 0.6 s
      const out = clamp01((t - (this.a.duration - 0.6)) / 0.6);
      if (out > 0 && !this.s.transparentBackground) { g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = `rgba(0,0,0,${out})`; g.fillRect(0, 0, this.W, this.H); }
    }
  }

  private worldBg(g: Ctx2D, world: 0 | 1, alpha = 1): void {
    const { W, H } = this;
    const p = world === 0 ? this.pal.night : this.pal.paper;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = alpha;
    const rg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.15, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    rg.addColorStop(0, p[0]); rg.addColorStop(1, p[1]);
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
    if (world === 1) { // paper: 4 %-alpha horizontal scanlines
      g.fillStyle = 'rgba(0,0,0,0.04)';
      const step = Math.max(3, Math.round(H / 240));
      for (let y = 0; y < H; y += step * 2) g.fillRect(0, y, W, step);
    }
    g.restore();
  }

  private scene(t: number, g: Ctx2D, mask: boolean, alphaScale: number, ghost = false): void {
    const { W, H } = this;
    const cam = this.camAt(t);
    const L = this.levels[cam.level];
    if (!L) { if (!mask && !this.s.transparentBackground) this.worldBg(g, 0); return; }
    const rm = this.s.reduceMotion;
    // additive camera layers
    let zoom = cam.zoom, roll = cam.roll, cx = cam.x, cy = cam.y;
    const ce = this.camEnergy;
    if (!rm) {
      const br = this.num('breathing') * ce;
      roll += br * (0.6 * Math.PI / 180) * Math.sin(t * 0.61 + 1.3);
      zoom *= 1 + br * 0.015 * Math.sin(t * 0.43);
    }
    zoom *= 1 + Math.min(rm ? 0.02 : 1, 0.022 * this.num('pulse') * this.react * pulse(this.a.beats, t, 9));
    // 2-frame shake after slams
    let shx = 0, shy = 0;
    if (!rm) for (const ti of this.impacts) {
      const d = t - ti;
      if (d >= 0 && d < 3 / 60) { const k = Math.floor(d * 60); const amp = this.num('shake') * ce * Math.min(W, H) * 0.012 * (1 - k / 3); shx += (hash01(k, Math.round(ti * 1000), 1) - 0.5) * 2 * amp; shy += (hash01(k, Math.round(ti * 1000), 2) - 0.5) * 2 * amp; }
    }
    // opening: a tilted plane (−15° roll + skew) settling over 2.6 s
    let skew = 0;
    const firstLand = this.keys.length ? this.keys[0].t : 0;
    if (this.bool('tilt') && !rm) {
      const u = 1 - easeOutCubic(clamp01((t - (firstLand - 0.6)) / 2.6));
      roll += (15 * Math.PI / 180) * u; skew = -0.22 * u;
    }
    if (rm) roll = Math.round(roll / (Math.PI / 2)) * (Math.PI / 2);
    const transparent = this.s.transparentBackground;
    if (!mask && !ghost && !transparent) this.worldBg(g, cam.diving ? this.levels[cam.level - 1].world : L.world);
    g.save();
    g.translate(W / 2 + shx, H / 2 + shy);
    if (skew) g.transform(1, 0, skew, 1, 0, 0);
    g.rotate(-roll);
    g.scale(zoom, zoom);
    g.translate(-cx, -cy);
    const ring = L.ring;
    if (cam.diving && ring) {
      // the parent world around the ring (inverse child transform), then the child world inside the counter
      g.save();
      g.translate(ring.cx, ring.cy); g.rotate(-ring.rot); g.scale(1 / ring.s, 1 / ring.s); g.translate(-ring.x, -ring.y);
      this.drawLevel(t, g, cam.level - 1, mask, alphaScale, ghost);
      g.restore();
      g.save();
      g.beginPath(); g.arc(ring.cx, ring.cy, ring.rIn / ring.s, 0, Math.PI * 2); g.clip();
      if (!mask && !ghost && !transparent) this.worldBg(g, L.world, clamp01((t - ring.tShow) / 0.35));
      this.drawLevel(t, g, cam.level, mask, alphaScale, ghost);
      g.restore();
    } else {
      this.drawLevel(t, g, cam.level, mask, alphaScale, ghost);
      // a child level waits inside its ring
      const child = this.levels[cam.level + 1];
      if (child?.ring && t >= child.ring.tShow - 0.05) {
        const r = child.ring;
        g.save();
        g.beginPath(); g.arc(r.x, r.y, r.rIn, 0, Math.PI * 2); g.clip();
        if (!mask && !ghost && !transparent) this.worldBg(g, child.world, clamp01((t - r.tShow) / 0.35));
        g.translate(r.x, r.y); g.rotate(r.rot); g.scale(r.s, r.s); g.translate(-r.cx, -r.cy);
        this.drawLevel(t, g, cam.level + 1, mask, alphaScale, ghost);
        g.restore();
      }
    }
    g.restore();
  }

  private drawLevel(t: number, g: Ctx2D, li: number, mask: boolean, alphaScale: number, ghost: boolean): void {
    const L = this.levels[li];
    if (!L) return;
    const ink = mask ? '#fff' : (L.world === 0 ? this.pal.night : this.pal.paper)[2];
    // draw the blocks around the active one
    let active = 0;
    for (let i = 0; i < L.blocks.length; i++) if (L.blocks[i].start - 3 <= t) active = i;
    for (let i = Math.max(0, active - 3); i <= Math.min(L.blocks.length - 1, active + 1); i++) {
      const b = L.blocks[i];
      if (b.start - 4 > t) continue;
      g.save();
      g.translate(b.ox, b.oy); g.rotate(b.rot);
      for (const ln of b.lines) for (const it of ln.items) this.drawItem(t, g, it, ln, L.world, ink, mask, alphaScale, ghost);
      g.restore();
    }
  }

  private drawItem(t: number, g: Ctx2D, it: Item, ln: LockLine, world: 0 | 1, ink: string, mask: boolean, alphaScale: number, ghost: boolean): void {
    const w0 = it.words[0];
    const stt = wordState(w0, t, it.ent, this.tm);
    if (stt.phase === 'before') return;
    const u = stt.enter, age = stt.age;
    const cap = it.cap, y = ln.y;
    const colour = mask ? `rgb(255,${Math.round(clamp01(Math.max(0, age) / 2) * 255)},255)` : it.colour ?? ink;
    const shadow = !mask && world === 0 && !ghost;
    g.save();
    g.globalAlpha = alphaScale;
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    if (it.kind === 'vert') {
      // a small word turned −90°, reading upward
      g.globalAlpha *= clamp01(u);
      setFont(g, it.font, cap);
      g.fillStyle = mask ? colour : rgba(ink, 1);
      g.translate(it.x + cap * 1.15, y);
      g.rotate(-Math.PI / 2);
      g.fillText(it.text, 0, 0);
      g.restore();
      return;
    }
    if (it.kind === 'stack') {
      const rows = it.rows!;
      setFont(g, it.font, cap);
      const pitch = ln.cap / rows.length;
      rows.forEach((r, i) => {
        const ws = wordState(r.words[0], t, fr(1), this.tm);
        if (ws.phase === 'before') return;
        g.fillStyle = mask ? colour : ink;
        g.fillText(r.text, it.x, y - ln.cap + pitch * i + cap + (pitch - cap) * 0.5);
      });
      g.restore();
      return;
    }
    // ----- big word -----
    if (!mask && this.bool('props') && it.prop && !ghost) this.prop(t, g, it, ln, world, ink, age);
    if (shadow) { g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = cap * 0.08; g.shadowOffsetY = cap * 0.035; }
    setFont(g, it.font, cap);
    g.fillStyle = colour;
    const drawWord = (dx = 0, dy = 0, sc = 1, alpha = 1, clipW = -1) => {
      g.save();
      g.globalAlpha *= alpha;
      g.translate(it.x + it.w / 2 + dx, y - cap / 2 + dy);
      g.scale(sc, sc);
      g.translate(-it.w / 2, cap / 2);
      if (clipW >= 0) { g.beginPath(); g.rect(-cap, -cap * 1.4, clipW + cap, cap * 2); g.clip(); }
      this.wordGlyphs(g, it, t, age, colour, world, mask);
      g.restore();
    };
    const e = it.entrance;
    if (e === 'slam' || (e === 'knocked' && !it.letters)) drawWord(0, 0, lerp(1.4, 1, easeOutCubic(u)), clamp01(u / 0.4));
    else if (e === 'slide') {
      const from = Math.max(0.9 * it.w, 3.4 * cap);
      const pos = (uu: number) => from * (1 - easeOutCubic(clamp01(uu)));
      if (u < 1 && !mask && this.bool('echo')) for (const [a, lag] of [[0.1, 0.2], [0.18, 0.13], [0.3, 0.06]] as const) drawWord(pos(u - lag), 0, 1, a);
      drawWord(pos(u), 0, 1, clamp01(u * 3));
    } else if (e === 'drop') drawWord(0, -1.8 * cap * (1 - easeOutBounce(u)), 1, clamp01(u * 4));
    else if (e === 'ghost') drawWord(0, 0, lerp(3, 1, easeOutQuint(u)), lerp(0.15, 1, u * u));
    else if (e === 'wipe') {
      drawWord(0, 0, 1, 1, it.w * easeInOutQuad(u));
      if (it.swash && !mask) { // a hand-drawn swash underneath
        const su = clamp01((age + 0.1) / 0.5);
        g.strokeStyle = this.pal.coolPaper === ink ? this.pal.red : (world === 0 ? this.pal.coolNight : this.pal.coolPaper);
        g.lineWidth = cap * 0.07; g.lineCap = 'round';
        g.beginPath();
        for (let i = 0; i <= 24 * su; i++) { const xx = it.x + (it.w * i) / 24; const yy = y + cap * (0.24 + 0.05 * Math.sin(i * 0.55) - 0.04 * (i / 24)); if (i) g.lineTo(xx, yy); else g.moveTo(xx, yy); }
        g.stroke();
      }
    } else drawWord(0, 0, 1, 1); // letter entrances are handled per glyph
    g.restore();
  }

  /** Draws the letters of a big word at the origin (baseline-left), with per-letter entrances, ring and pictogram. */
  private wordGlyphs(g: Ctx2D, it: Item, t: number, age: number, colour: string, world: 0 | 1, mask: boolean): void {
    const cap = it.cap, e = it.entrance, letters = it.letters;
    const w0 = it.words[0];
    if (it.ring === -1) { this.ringShape(g, it.w / 2, -cap / 2, cap, colour); return; }
    if (!letters || (e !== 'standup' && e !== 'fly' && e !== 'knocked' && it.ring === undefined && !it.picto)) { g.fillText(it.text, 0, 0); return; }
    const n = letters.length;
    const start = w0.start - this.tm.anticipation - it.ent;
    for (let i = 0; i < n; i++) {
      const l = letters[i];
      g.save();
      g.translate(l.x + l.w / 2, 0);
      if (e === 'standup') {
        // letters scale up from the baseline with a back-ease, advancing by syllable time
        const u = clamp01((t - start - i * fr(3)) / fr(8));
        if (u <= 0) { g.restore(); continue; }
        g.scale(1, easeOutBack(u));
      } else if (e === 'fly') {
        const u = clamp01((t - start - i * fr(1.5)) / fr(50));
        if (u <= 0) { g.restore(); continue; }
        const k = 1 - easeOutCubic(u), sd = this.seed + w0.id * 13 + i;
        g.translate((hash01(sd, 1) - 0.5) * cap * 14 * k, (hash01(sd, 2) - 0.5) * cap * 9 * k);
        g.rotate((hash01(sd, 3) - 0.5) * 5 * k);
        const sc = 1 + (hash01(sd, 4) * 2.5) * k;
        g.scale(sc, sc);
        g.globalAlpha *= clamp01(u * 2.5);
      } else if (e === 'knocked') {
        // a slam whose letters get knocked askew 4 frames after impact
        const kk = clamp01((age - fr(4)) / 0.12), sd = this.seed + w0.id * 7 + i;
        g.translate(0, (hash01(sd, 5) - 0.5) * cap * 0.16 * kk);
        g.rotate((hash01(sd, 6) - 0.5) * 0.34 * kk);
      }
      if (it.ring === i) this.ringShape(g, 0, -cap / 2, cap, colour, it.ringStem);
      else if (it.picto && it.picto.index === i) this.pictogram(g, it, l.w, age, colour, world, mask);
      else { g.textAlign = 'center'; g.fillText(l.ch, 0, 0); }
      g.restore();
    }
  }

  private ringShape(g: Ctx2D, x: number, y: number, cap: number, colour: string, stem = false): void {
    g.save();
    g.shadowColor = 'transparent';
    g.fillStyle = colour;
    if (stem) g.fillRect(x - 0.56 * cap, y - 0.5 * cap, 0.2 * cap, cap);
    g.beginPath();
    g.arc(x, y, 0.56 * cap, 0, Math.PI * 2);
    g.arc(x, y, 0.36 * cap, 0, Math.PI * 2, true);
    g.fill('evenodd');
    g.restore();
  }

  private pictogram(g: Ctx2D, it: Item, lw: number, age: number, colour: string, world: 0 | 1, mask: boolean): void {
    const cap = it.cap, p = it.picto!;
    g.save();
    g.translate(0, -cap / 2);
    g.fillStyle = colour;
    if (p.shape === 'ring') {
      // a coin ring that spins once on landing, with the icon cut inside
      const spin = age < 0.6 && age > 0 && !this.s.reduceMotion ? Math.cos(Math.PI * 2 * easeOutCubic(age / 0.6)) : 1;
      g.scale(Math.abs(spin) < 0.08 ? 0.08 : spin, 1);
      const r = Math.min(cap * 0.55, lw * 0.56);
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.arc(0, 0, r * 0.78, 0, Math.PI * 2, true); g.fill('evenodd');
      drawIcon(g, p.icon, r * 0.56);
    } else if (p.shape === 'stem') {
      // a tall, narrow icon standing in for the I
      g.scale(Math.max(0.42, Math.min(0.7, (lw * 1.5) / cap)), 1);
      drawIcon(g, p.icon, cap * 0.5, true);
    } else drawIcon(g, p.icon, Math.min(cap * 0.52, Math.max(lw * 0.62, cap * 0.3)));
    void world; void mask;
    g.restore();
  }

  /** Props for concept heroes, drawn in block space behind the word. */
  private prop(t: number, g: Ctx2D, it: Item, ln: LockLine, world: 0 | 1, ink: string, age: number): void {
    if (age < -0.05) return;
    const cap = it.cap, x = it.x, y = ln.y, w = it.w;
    const red = this.pal.red, cool = world === 0 ? this.pal.coolNight : this.pal.coolPaper;
    const grey = '#77736B';
    const a = clamp01(age / 0.25);
    const echo = this.bool('echo');
    g.save();
    g.shadowColor = 'transparent';
    switch (it.prop) {
      case 'fire': { // flame tongues behind every letter, flickering in 4-frame steps
        const step = Math.floor(t * 15);
        g.fillStyle = red;
        const n = Math.max(3, it.letters?.length ?? 4);
        for (let i = 0; i < n; i++) {
          const fx = x + (w * (i + 0.5)) / n, hgt = cap * (0.5 + 0.55 * hash01(i, step, it.words[0].id)) * a;
          g.beginPath();
          g.moveTo(fx - (w / n) * 0.42, y - cap * 0.75);
          g.quadraticCurveTo(fx - (w / n) * 0.3, y - cap - hgt * 0.5, fx + (hash01(i, step, 3) - 0.5) * cap * 0.2, y - cap - hgt);
          g.quadraticCurveTo(fx + (w / n) * 0.3, y - cap - hgt * 0.45, fx + (w / n) * 0.42, y - cap * 0.75);
          g.fill();
        }
        break;
      }
      case 'water': { // three scrolling wave strokes underneath
        g.strokeStyle = cool; g.lineWidth = cap * 0.035; g.lineCap = 'round';
        for (let r = 0; r < 3; r++) {
          g.globalAlpha *= 1 - r * 0.25;
          g.beginPath();
          for (let i = 0; i <= 40 * a; i++) { const xx = x + (w * i) / 40; const yy = y + cap * (0.16 + r * 0.1) + Math.sin(i * 0.6 + t * 3 + r * 1.3) * cap * 0.035; if (i) g.lineTo(xx, yy); else g.moveTo(xx, yy); }
          g.stroke();
        }
        break;
      }
      case 'light': case 'star': { // 13 stars arc in along quadratic paths into an arc above the word
        g.fillStyle = it.prop === 'star' ? cool : red;
        for (let i = 0; i < 13; i++) {
          const u = easeOutCubic(clamp01((age - i * 0.03) / 0.5));
          if (u <= 0) continue;
          const ang = Math.PI * (1.12 + (0.76 * i) / 12);
          const tx = x + w / 2 + Math.cos(ang) * w * 0.56, ty = y - cap * 0.45 + Math.sin(ang) * cap * 1.25;
          const sx = x + w / 2 + (hash01(i, 1, it.words[0].id) - 0.5) * w * 2.2, sy = y - cap * 3.4;
          const mx = (sx + tx) / 2 + cap, my = (sy + ty) / 2 - cap;
          const px = (1 - u) * (1 - u) * sx + 2 * u * (1 - u) * mx + u * u * tx, py = (1 - u) * (1 - u) * sy + 2 * u * (1 - u) * my + u * u * ty;
          g.save(); g.translate(px, py); g.rotate(u * 4 + i); drawIcon(g, 'star', cap * 0.085); g.restore();
        }
        break;
      }
      case 'heart': { // two heart outlines bloom outward
        g.strokeStyle = red; g.lineWidth = cap * 0.025;
        for (let k = 0; k < 2; k++) {
          const u = clamp01((age - k * 0.18) / 0.9);
          if (u <= 0 || u >= 1) continue;
          g.save(); g.globalAlpha *= 1 - u;
          g.translate(x + w / 2, y - cap * 0.5);
          const r = cap * (0.7 + 1.5 * easeOutCubic(u));
          g.beginPath();
          g.moveTo(0, 0.9 * r);
          g.bezierCurveTo(-1.35 * r, 0, -0.95 * r, -0.95 * r, -0.45 * r, -0.82 * r);
          g.bezierCurveTo(-0.2 * r, -0.76 * r, -0.05 * r, -0.6 * r, 0, -0.42 * r);
          g.bezierCurveTo(0.05 * r, -0.6 * r, 0.2 * r, -0.76 * r, 0.45 * r, -0.82 * r);
          g.bezierCurveTo(0.95 * r, -0.95 * r, 1.35 * r, 0, 0, 0.9 * r);
          g.stroke(); g.restore();
        }
        break;
      }
      case 'shock': { // a big bolt flashes behind the word
        const f = clamp01(1 - age / 0.45) * this.flash(t);
        if (f > 0) { g.globalAlpha *= f; g.fillStyle = red; g.translate(x + w / 2, y - cap * 0.5); drawIcon(g, 'bolt', cap * 1.5); }
        break;
      }
      case 'home': { // a skyline with a steeple rises under the word
        g.fillStyle = rgba(ink, 0.9);
        const n = 9, rise = easeOutBack(clamp01(age / 0.5));
        for (let i = 0; i < n; i++) {
          const bw = w / n, hgt = cap * (0.08 + 0.14 * hash01(i, it.words[0].id, 4)) * rise;
          g.fillRect(x + i * bw + 1, y + cap * 0.46 - hgt, bw - 2, hgt);
          if (i === 3) { g.beginPath(); g.moveTo(x + i * bw + 1, y + cap * 0.46 - hgt); g.lineTo(x + (i + 0.5) * bw, y + cap * 0.46 - hgt - cap * 0.16 * rise); g.lineTo(x + (i + 1) * bw - 1, y + cap * 0.46 - hgt); g.fill(); }
        }
        break;
      }
      case 'people': { // silhouettes popping up
        g.fillStyle = rgba(ink, 0.92);
        const n = 4 + Math.floor(hash01(it.words[0].id, 9) * 8);
        for (let i = 0; i < n; i++) {
          const u = easeOutBack(clamp01((age - i * 0.04) / 0.3));
          if (u <= 0) continue;
          const r = cap * (0.13 + 0.05 * hash01(i, it.words[0].id, 2));
          g.save(); g.translate(x + (w * (i + 0.5)) / n, y + cap * 0.34 + r * (1 - u) * 2); drawIcon(g, 'person', r); g.restore();
        }
        break;
      }
      case 'quake': break; // the letters jitter (handled by the knocked/jitter entrance)
      case 'road': { // a dashed road line extends
        g.strokeStyle = rgba(ink, 0.85); g.lineWidth = cap * 0.03; g.setLineDash([cap * 0.16, cap * 0.1]);
        g.beginPath(); g.moveTo(x, y + cap * 0.2); g.lineTo(x + w * 1.25 * easeOutCubic(clamp01(age / 0.8)), y + cap * 0.2); g.stroke();
        g.setLineDash([]);
        break;
      }
      case 'key': case 'bird': { // a shackle on the first letter snaps open and falls
        const fall = age > 0.25 ? (age - 0.25) : 0;
        const l0 = it.letters?.[0];
        const lx = x + (l0 ? l0.w / 2 : cap * 0.3);
        for (const [lag, al] of echo ? [[0, 1], [4 / 60, 0.6], [8 / 60, 0.35], [12 / 60, 0.15]] as const : [[0, 1]] as const) {
          const ff = Math.max(0, fall - lag);
          g.save(); g.globalAlpha *= al * clamp01(1.2 - ff);
          g.strokeStyle = lag ? grey : cool; g.lineWidth = cap * 0.045;
          g.translate(lx, y - cap * 1.02 + 900 * ff * ff * (cap / 300));
          g.rotate(ff * 2.2);
          g.beginPath(); g.arc(0, 0, cap * 0.14, Math.PI, age > 0.25 ? Math.PI * 1.75 : Math.PI * 2); g.stroke();
          g.restore();
        }
        break;
      }
      default: { // five copies of the concept icon march right-to-left under the word
        const c = conceptById(it.prop);
        if (!c) break;
        for (const [lag, al] of echo ? [[0, 1], [4 / 60, 0.6], [8 / 60, 0.35], [12 / 60, 0.15]] as const : [[0, 1]] as const) {
          const tt = Math.max(0, age - lag);
          g.fillStyle = lag ? grey : RED_CONCEPTS.has(c.id) ? red : cool;
          g.globalAlpha = al * a * clamp01(2.2 - tt * 0.5);
          for (let i = 0; i < 5; i++) {
            const px = x + w * (1.1 - ((tt * 0.35 + i * 0.22) % 1.2));
            if (px < x - cap * 0.2 || px > x + w + cap * 0.2) continue;
            g.save(); g.translate(px, y + cap * 0.3); drawIcon(g, c.icon, cap * 0.13); g.restore();
          }
        }
      }
    }
    g.restore();
  }
}
registerEffect(Broadside);

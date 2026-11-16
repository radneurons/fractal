// The Director (SPEC §6): stress, roles, concepts and elements — plus the v3 additions (voices, hook, pitch).
import type { Analysis, ElementKind, Lyrics, Line, Word, Section, SectionLabel } from '../types.ts';
import { isStopword, isFiller, conceptOf } from './lexicon.ts';
import { sample, nearest, lowerBound } from '../analysis/dsp.ts';
import { labelSections } from '../analysis/structure.ts';
import { lyricMood } from './moodlex.ts';

function rankNormalise(vals: number[]): number[] {
  const idx = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(vals.length).fill(0);
  idx.forEach(([, i], r) => { out[i] = vals.length > 1 ? r / (vals.length - 1) : 1; });
  return out;
}

/** Marks the hook: the most-repeated lyric line inside a chorus (§4A.6). */
export function markHook(ly: Lyrics, a: Analysis | null): void {
  for (const l of ly.lines) l.hook = false;
  const counts = new Map<number, number>();
  for (const l of ly.lines) { const root = l.repeatOf ?? l.idx; counts.set(root, (counts.get(root) ?? 0) + 1); }
  let best = -1, bc = 1;
  for (const [root, c] of counts) {
    if (c < 2) continue;
    const inChorus = ly.lines.some((l) => (l.repeatOf ?? l.idx) === root && (l.hint === 'chorus' || (a && a.sections[l.section]?.label === 'chorus')));
    const score = c + (inChorus ? 100 : 0);
    if (score > bc) { bc = score; best = root; }
  }
  if (best >= 0) for (const l of ly.lines) if ((l.repeatOf ?? l.idx) === best) l.hook = true;
}

export function direct(ly: Lyrics, a: Analysis | null): void {
  // song-wide repetition counts
  const freq = new Map<string, number>();
  for (const w of ly.words) freq.set(w.text, (freq.get(w.text) ?? 0) + 1);
  markHook(ly, a);
  for (const line of ly.lines) {
    const ws = line.words.map((i) => ly.words[i]).filter(Boolean);
    if (!ws.length) continue;
    const lead = ws.filter((w) => !w.backing);
    const durs = lead.map((w) => (w.end - w.start) / Math.max(1, w.syllables));
    const maxDur = Math.max(...durs, 1e-3);
    const pitches = lead.map((w) => w.pitch ?? -Infinity);
    const maxPitch = Math.max(...pitches);
    const raw = lead.map((w, i) => {
      const stop = isStopword(w.text) || isFiller(w.text);
      const c = stop ? undefined : conceptOf(w.text);
      w.concept = c?.id;
      let s = 0.3 * (durs[i] / maxDur)
        + 0.2 * (a ? sample(a.loud, w.start + 0.03) : 0.5)
        + 0.22 * (stop ? 0 : 1)
        + 0.12 * (c ? 1 : 0)
        + 0.06 * (i === lead.length - 1 ? 1 : 0)
        + 0.05 * ((freq.get(w.text) ?? 0) >= 3 && !stop ? 1 : 0)
        + 0.05 * Math.min(1, w.text.length / 8);
      if (line.hook && !stop) s += 0.15;
      if (maxPitch > -Infinity && w.pitch === maxPitch && lead.length > 1) s += 0.08;
      if (w.melisma) s += 0.1;
      return s;
    });
    const ranks = rankNormalise(raw);
    lead.forEach((w, i) => { w.stress = Math.min(1, 0.55 * ranks[i] + 0.45 * Math.min(1, raw[i])); });
    for (const w of ws) if (w.backing) { w.stress = 0.1; w.concept = undefined; }
    // ---- roles ----
    const assign = (w: Word, role: Word['role']) => { if (!w.roleLocked) w.role = role; };
    for (const w of ws) {
      if (w.backing) { assign(w, 'connective'); continue; }
      const short = Array.from(w.text).length <= 2 && !/[぀-ヿ㐀-鿿]/.test(w.text);
      assign(w, isStopword(w.text) || isFiller(w.text) || short ? 'connective' : 'support');
    }
    const order = lead.map((w, i) => i).sort((x, y) => raw[y] - raw[x]);
    let heroes = lead.filter((w) => w.roleLocked && w.role === 'hero').length;
    // every word that names a concept → hero, up to 2 per line, strongest first
    for (const i of order) {
      const w = lead[i];
      if (heroes >= 2) break;
      if (w.concept && w.role !== 'connective' && !w.roleLocked) { w.role = 'hero'; heroes++; }
    }
    if (!heroes) {
      const want = lead.length > 8 ? 2 : 1;
      for (const i of order) {
        const w = lead[i];
        if (heroes >= want) break;
        if (w.roleLocked || w.role === 'connective') continue;
        if (heroes > 0 && raw[i] <= 0.35) break;
        w.role = 'hero'; heroes++;
      }
    }
    // at least one hero per line
    if (!lead.some((w) => w.role === 'hero')) {
      const w = order.map((i) => lead[i]).find((x) => !x.roleLocked) ?? lead[0];
      if (w && !w.roleLocked) w.role = 'hero';
    }
    // duets: each voice gets at least one hero per line it sings
    const voices = new Set(lead.map((w) => w.voice).filter(Boolean));
    if (voices.size > 1) for (const v of voices) {
      const mine = lead.filter((w) => w.voice === v);
      if (mine.length && !mine.some((w) => w.role === 'hero')) {
        const w = mine.filter((x) => !x.roleLocked).sort((x, y) => y.stress - x.stress)[0];
        if (w) w.role = 'hero';
      }
    }
    line.mood = lyricMood(lead.map((w) => w.text));
  }
  assignElements(ly, a);
  blendMood(ly, a);
}

const CYCLE: ElementKind[] = ['light', 'fire', 'water', 'smoke', 'ice', 'wind'];

export function assignElements(ly: Lyrics, a: Analysis | null): void {
  let cyc = 0;
  let lastShock = -Infinity, lastQuake = -Infinity;
  const bar = a && a.downbeats.length > 1 ? (a.downbeats[a.downbeats.length - 1] - a.downbeats[0]) / (a.downbeats.length - 1) : 2;
  for (const w of ly.words) {
    if (w.role !== 'hero') { if (!w.elementLocked) w.element = 'none'; continue; }
    if (w.elementLocked && w.element) {
      if (w.element === 'shock') lastShock = w.start;
      if (w.element === 'quake') lastQuake = w.start;
      continue;
    }
    let el: ElementKind = 'none';
    const c = w.concept ? conceptOf(w.text) : undefined;
    if (c && c.element !== 'none') el = c.element;
    else if (a) {
      const t = w.start + 0.02;
      const loud = sample(a.loud, t), cen = sample(a.centroid, t), flux = sample(a.flux, t);
      const mid = sample(a.bands.mid, t), high = 0.5 * (sample(a.bands.high, t) + sample(a.bands.air, t));
      const db = nearest(a.downbeats, w.start);
      if (a.drops.some((d) => Math.abs(d - w.start) < bar * 0.6)) el = 'quake';
      else if (flux > 0.75 && Math.abs(db - w.start) < 0.09) el = 'shock';
      else if (loud > 0.65 && mid > 0.6) el = 'fire';
      else if (loud < 0.35 && cen > 0.55) el = 'light';
      else if (high > 0.7) el = 'water';
      else if (cen > 0.62) el = 'wind';
      else el = CYCLE[cyc++ % CYCLE.length];
    } else el = CYCLE[cyc++ % CYCLE.length];
    // rate limits
    if (el === 'shock') { if (w.start - lastShock < 4 * bar) el = 'fire'; else lastShock = w.start; }
    if (el === 'quake') { if (w.start - lastQuake < 8 * bar) el = 'smoke'; else lastQuake = w.start; }
    w.element = el;
  }
}

/** mood = 0.5·lyric + 0.5·audio per line (§4A.7) */
function blendMood(ly: Lyrics, a: Analysis | null): void {
  for (const line of ly.lines) {
    const lm = line.mood ?? { valence: 0, arousal: 0.4 };
    if (!a) { line.mood = lm; continue; }
    const mid = 0.5 * (line.start + line.end);
    line.mood = { valence: 0.5 * lm.valence + 0.5 * sample(a.mood.valence, mid), arousal: 0.5 * lm.arousal + 0.5 * sample(a.mood.arousal, mid) };
  }
}

const HINT_OK: SectionLabel[] = ['intro', 'verse', 'chorus', 'bridge', 'outro', 'breakdown', 'drop', 'speech'];

/**
 * Fuse lyric structure into the audio sections (§4A.6 + header hints):
 *  • a lyric block header ("[Chorus]") starts a section: insert a boundary at the nearest downbeat when
 *    the audio analysis has none within two bars;
 *  • sections whose lines carry hints take the majority hint as their label;
 *  • sections sharing ≥ 2 repeated lines share a cluster.
 * Returns new sections (the analysis object is not mutated).
 */
export function fuseLyricStructure(a: Analysis, ly: Lyrics, trustTiming = true): Section[] {
  let secs: Section[] = a.sections.map((s) => ({ ...s }));
  const bar = a.downbeats.length > 1 ? (a.downbeats[a.downbeats.length - 1] - a.downbeats[0]) / (a.downbeats.length - 1) : 2;
  type L = Line & { block?: number };
  const lines = ly.lines as L[];
  const hasBlocks = lines.some((l) => l.block !== undefined && l.hint);
  if (hasBlocks && trustTiming && !a.isSpeech) {
    const cuts: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (i > 0 && lines[i].block === lines[i - 1].block) continue;
      // the downbeat at or just before the block's first word (pickups start before the bar line)
      let t = lines[i].start;
      const k = lowerBound(a.downbeats, t + 0.35 * bar) - 1;
      if (k >= 0 && t - a.downbeats[k] < 1.1 * bar) t = a.downbeats[k];
      if (i > 0 && t < lines[i - 1].end - 0.4 * bar) t = Math.max(lines[i - 1].end, lines[i].start - 0.1);
      cuts.push(t);
    }
    const bounds = secs.map((s) => s.start);
    for (const t of cuts) {
      if (t < 1 || t > a.duration - 1) continue;
      const near = bounds.findIndex((b) => Math.abs(b - t) < 2 * bar);
      if (near >= 0) { if (near > 0) bounds[near] = t; continue; }
      bounds.push(t);
    }
    bounds.sort((x, y) => x - y);
    const uniq = bounds.filter((b, i) => i === 0 || b - bounds[i - 1] > 0.5);
    const energyOf = (s: number, e: number) => {
      let sum = 0, c = 0;
      for (let i = Math.floor(s * 60); i < Math.min(a.loud.length, Math.floor(e * 60)); i++) { sum += a.loud[i]; c++; }
      return c ? sum / c : 0;
    };
    const old = secs;
    secs = uniq.map((s, i) => {
      const e = i + 1 < uniq.length ? uniq[i + 1] : a.duration;
      const o = old.find((x) => s + 0.5 * (e - s) >= x.start && s + 0.5 * (e - s) < x.end) ?? old[old.length - 1];
      return { start: i === 0 ? 0 : s, end: e, label: o.label, energy: energyOf(s, e), cluster: 1000 + i };
    });
  }
  // lines per section
  const inSec = (l: Line) => { const t = l.start + Math.min(0.3, 0.5 * (l.end - l.start)); let k = secs.findIndex((s) => t < s.end); if (k < 0) k = secs.length - 1; return k; };
  const members: Line[][] = secs.map(() => []);
  for (const l of lines) members[inSec(l)].push(l);
  // clusters from repeated lines
  const parent = secs.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let i = 0; i < secs.length; i++) for (let j = i + 1; j < secs.length; j++) {
    const roots = new Set(members[i].map((l) => l.repeatOf ?? l.idx));
    const shared = members[j].filter((l) => roots.has(l.repeatOf ?? l.idx)).length;
    if (shared >= 2 || (hasBlocks && shared >= 1 && shared >= 0.5 * Math.min(members[i].length, members[j].length))) parent[find(i)] = find(j);
  }
  // keep audio clusters for sections without lines
  const ids = new Map<string, number>();
  secs.forEach((s, i) => {
    const key = members[i].length ? `L${find(i)}` : `A${a.sections.find((x) => s.start + 0.5 * (s.end - s.start) < x.end)?.cluster ?? i}:${s.label}`;
    if (!ids.has(key)) ids.set(key, ids.size);
    s.cluster = ids.get(key)!;
  });
  secs = labelSections(secs, a.drops, a.duration);
  // header hints win
  secs.forEach((s, i) => {
    const votes = new Map<SectionLabel, number>();
    for (const l of members[i]) if (l.hint && HINT_OK.includes(l.hint)) votes.set(l.hint, (votes.get(l.hint) ?? 0) + 1);
    let best: SectionLabel | undefined, bc = 0;
    for (const [h, c] of votes) if (c > bc) { bc = c; best = h; }
    if (best && bc >= 0.5 * members[i].length) s.label = best;
    else if (!members[i].length && hasBlocks && trustTiming) {
      // instrumental: intro / outro / break by position and energy
      if (i === 0) s.label = 'intro';
      else if (i === secs.length - 1) s.label = 'outro';
      else if (s.label === 'verse' || s.label === 'chorus') s.label = s.energy > 0.6 ? 'drop' : 'breakdown';
    }
  });
  // merge neighbours that ended up identical and have no lyric block boundary between them
  const merged: Section[] = [];
  secs.forEach((s, i) => {
    const last = merged[merged.length - 1];
    const sameBlock = members[i].length === 0 && i > 0 && members[i - 1].length === 0;
    if (last && last.label === s.label && last.cluster === s.cluster && sameBlock) { last.end = s.end; return; }
    merged.push({ ...s });
  });
  return merged;
}

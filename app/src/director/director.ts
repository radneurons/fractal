// The Director: turns analysis + lyrics into word roles, stress and elements (deterministic).
import type { Analysis, ElementKind, Lyrics } from '../types';
import { sample } from '../analysis/dsp';
import { STOPWORDS, conceptOf } from './lexicon';

export function direct(ly: Lyrics, a: Analysis | null) {
  const { words, lines } = ly;
  const repeated = new Set<string>();
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w.text, (counts.get(w.text) ?? 0) + 1);
  for (const [k, n] of counts) if (n >= 3 && !STOPWORDS.has(k)) repeated.add(k);
  for (const L of lines) {
    const ws = L.words.map(id => words[id]);
    const durs = ws.map(w => w.end - w.start), med = [...durs].sort((x, y) => x - y)[durs.length >> 1] || 0.3;
    const raw = ws.map((w, k) => {
      const stop = STOPWORDS.has(w.text);
      const c = conceptOf(w.text);
      w.concept = c?.id;
      let s = 0;
      s += 0.30 * Math.min(1.5, (w.end - w.start) / med) / 1.5;
      s += 0.20 * (a ? sample(a.loud, w.start + 0.03) : 0.5);
      s += 0.22 * (stop ? 0 : 1);
      s += 0.12 * (c ? 1 : 0);
      s += 0.06 * (k === ws.length - 1 ? 1 : 0);
      s += 0.05 * (repeated.has(w.text) ? 1 : 0);
      s += 0.05 * Math.min(1, w.text.length / 8);
      return s;
    });
    // rank-normalise within the line
    const order = raw.map((v, i) => ({ v, i })).sort((x, y) => y.v - x.v);
    order.forEach((o, r) => { ws[o.i].stress = ws.length > 1 ? 1 - r / (ws.length - 1) : 1; });
    const heroCount = ws.length > 8 ? 2 : 1;
    ws.forEach((w, i) => {
      if (w.roleLocked) return;
      const stop = STOPWORDS.has(w.text) || w.text.length <= 2;
      const rank = order.findIndex(o => o.i === i);
      w.role = stop ? 'connective' : rank < heroCount && raw[i] > 0.35 ? 'hero' : 'support';
    });
    if (!ws.some(w => w.role === 'hero')) { const best = order.find(o => ws[o.i].role !== 'connective') ?? order[0]; if (best) ws[best.i].role = 'hero'; }
  }
  assignElements(ly, a);
}

/** Lexicon first, then audio features; rate-limits loud events. */
export function assignElements(ly: Lyrics, a: Analysis | null) {
  let lastShock = -99, lastQuake = -99;
  const bar = a && a.bpm > 0 ? 240 / a.bpm : 2;
  for (const w of ly.words) {
    if (w.role !== 'hero') { w.element = 'none'; continue; }
    const c = conceptOf(w.text);
    let el: ElementKind = (c?.element as ElementKind) ?? 'none';
    if (el === 'none' && a) {
      const t = w.start;
      const flux = sample(a.flux, t), loud = sample(a.loud, t), cen = sample(a.centroid, t), hi = sample(a.bands.high, t), mid = sample(a.bands.mid, t);
      const onDown = a.downbeats.some(d => Math.abs(d - t) < 0.06);
      const nearDrop = a.drops.some(d => Math.abs(d - t) < bar);
      if (nearDrop) el = 'quake';
      else if (flux > 0.75 && onDown) el = 'shock';
      else if (loud > 0.65 && mid > 0.55) el = 'fire';
      else if (loud < 0.35 && cen > 0.5) el = 'light';
      else if (hi > 0.6) el = 'water';
      else if (cen > 0.6) el = 'wind';
      else el = (['light', 'fire', 'water', 'smoke', 'ice', 'wind'] as ElementKind[])[w.id % 6];
    }
    if (el === 'shock') { if (w.start - lastShock < bar * 4) el = 'fire'; else lastShock = w.start; }
    if (el === 'quake') { if (w.start - lastQuake < bar * 8) el = 'smoke'; else lastQuake = w.start; }
    w.element = el;
  }
}

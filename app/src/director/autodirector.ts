// Auto-Director (SPEC §9.6): builds a full plan — effects, transitions and suggested layers — from the analysis.
import type { Affinity, Analysis, Layer, Lyrics, PlanSegment, Section, TransitionKind } from '../types.ts';
import { allEffects } from '../effects/registry.ts';
import { hash01, sample } from '../analysis/dsp.ts';

export interface SectionFeatures { energy: number; wordsPerSec: number; tempo: number; valence: number; arousal: number; speech: boolean; vocal: number; repeatOf: number; label: Section['label']; vec: Affinity }
export interface AutoPlan { segments: PlanSegment[]; features: SectionFeatures[]; layers: Layer[]; seed: number; score: number }

export function describeSections(a: Analysis, ly: Lyrics): SectionFeatures[] {
  return a.sections.map((s, i) => {
    const dur = Math.max(0.5, s.end - s.start);
    const words = ly.words.filter((w) => !w.backing && w.start >= s.start && w.start < s.end).length;
    const mid = (s.start + s.end) / 2;
    let voc = 0, n = 0;
    for (let k = Math.floor(s.start * 60); k < Math.min(a.n, Math.floor(s.end * 60)); k += 6) { voc += a.vocal[k] > 0.5 ? 1 : 0; n++; }
    const wps = words / dur;
    const valence = sample(a.mood.valence, mid), arousal = sample(a.mood.arousal, mid);
    const speech = a.isSpeech || s.label === 'speech';
    const energy = Math.max(0, Math.min(1, s.energy));
    const repeatOf = a.sections.findIndex((o, k) => k < i && o.cluster === s.cluster);
    const vec: Affinity = {
      energyHigh: energy, energyLow: 1 - energy, speech: speech ? 1 : 0,
      denseLyrics: Math.min(1, wps / 3), sparseLyrics: Math.max(0, 1 - wps / 1.5),
      darkMood: Math.max(0, -valence) + (valence < 0 ? 0.2 : 0), brightMood: Math.max(0, valence) + (valence >= 0 ? 0.2 : 0),
      fastTempo: Math.max(0, Math.min(1, (a.bpm - 80) / 80)),
    };
    return { energy, wordsPerSec: wps, tempo: a.bpm, valence, arousal, speech, vocal: n ? voc / n : 0, repeatOf, label: s.label, vec };
  });
}

function dot(a: Affinity, b: Affinity): number {
  let s = 0, n = 0;
  for (const k of Object.keys(a) as (keyof Affinity)[]) { s += a[k] * b[k]; n += b[k]; }
  return n > 0 ? s / n : 0;
}

/** Transition by the kind of section change. */
export function transitionFor(a: Analysis, i: number): TransitionKind {
  const s = a.sections[i];
  if (!s || i === 0) return 'cut';
  if (s.label === 'drop' || a.drops.some((d) => Math.abs(d - s.start) < 0.6)) return 'flash';
  if (s.label === 'breakdown') return 'dissolve';
  if (s.label === 'bridge') return 'mask';
  if (a.sections.some((o, k) => k < i && o.cluster === s.cluster)) return 'match';
  return 'wipe';
}

export function autoDirect(a: Analysis, ly: Lyrics, seed = 1776, opts: { variety?: number; exclude?: string[]; hasTranslation?: boolean } = {}): AutoPlan {
  const variety = opts.variety ?? 5;
  const effects = allEffects().filter((e) => !(opts.exclude ?? []).includes(e.meta.id));
  const feats = describeSections(a, ly);
  const nS = feats.length, nE = effects.length;
  // score[s][e] = affinity · features + a small seeded jitter, so different seeds give different cuts
  const score = feats.map((f, s) => effects.map((e, k) => {
    if (f.speech && e.meta.affinity.speech < 0.6) return -1e3;
    return dot(e.meta.affinity, f.vec) + (hash01(seed, s * 31 + k, 7) - 0.5) * 0.1 + (a.sections[s].label === 'drop' ? 0.4 * e.meta.affinity.energyHigh : 0);
  }));
  // beam search over sections with the constraints
  interface Node { picks: number[]; score: number; used: Set<number> }
  let beam: Node[] = [{ picks: [], score: 0, used: new Set() }];
  for (let s = 0; s < nS; s++) {
    const next: Node[] = [];
    const rep = feats[s].repeatOf;
    for (const node of beam) {
      for (let e = 0; e < nE; e++) {
        if (score[s][e] < -100) continue;
        // repeated sections reuse their first occurrence's effect (choruses stay recognisable)
        if (rep >= 0 && node.picks[rep] !== e) continue;
        const prev = node.picks[s - 1];
        const long = a.sections[s].end - a.sections[s].start > 45;
        if (prev === e && rep < 0 && !long) continue; // never the same effect twice in a row
        if (!node.used.has(e) && node.used.size >= variety) continue;
        const used = node.used.has(e) ? node.used : new Set(node.used).add(e);
        next.push({ picks: [...node.picks, e], score: node.score + score[s][e] * (a.sections[s].end - a.sections[s].start), used });
      }
    }
    if (!next.length) { // constraints unsatisfiable (very few effects): relax to the best free pick
      for (const node of beam) { let be = 0; for (let e = 1; e < nE; e++) if (score[s][e] > score[s][be]) be = e; next.push({ picks: [...node.picks, be], score: node.score + score[s][be], used: new Set(node.used).add(be) }); }
    }
    next.sort((x, y) => y.score - x.score);
    beam = next.slice(0, 16);
  }
  const best = beam[0];
  const segments: PlanSegment[] = [];
  a.sections.forEach((sec, i) => {
    const effect = effects[best.picks[i]].meta.id;
    const last = segments[segments.length - 1];
    if (last && last.effect === effect) last.end = sec.end;
    else segments.push({ start: i === 0 ? 0 : sec.start, end: sec.end, effect, transition: transitionFor(a, i) });
  });
  if (segments.length) segments[segments.length - 1].end = Math.max(a.duration, segments[segments.length - 1].end);
  // optional layer suggestions
  const layers: Layer[] = [];
  const ids = new Set(effects.map((e) => e.meta.id));
  if (a.drops.length && ids.has('swarm') && !segments.some((s) => s.effect === 'swarm'))
    layers.push({ id: 'auto-swarm', kind: 'effect', effect: 'swarm', instanceId: 'auto:swarm', enabled: true, blend: 'screen', opacity: 0.35, mask: 'none', sectionOnly: 'drop' });
  if (opts.hasTranslation && ids.has('karaoke') && !segments.some((s) => s.effect === 'karaoke'))
    layers.push({ id: 'auto-karaoke', kind: 'effect', effect: 'karaoke', instanceId: 'auto:karaoke', enabled: true, blend: 'normal', opacity: 1, mask: 'none' });
  return { segments, features: feats, layers, seed, score: best.score };
}

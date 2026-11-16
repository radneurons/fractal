/** Edit-aware prompt compiler. Facts -> canonical segments -> dialect text, merged into the existing prompt so that
 *  only segments whose facts changed are rewritten and the user's manual wording survives everywhere else. */
import { SHOT_SIZE_NAMES, shotFacts, type Op, type Project, type PromptVersion, type ShotFacts } from '@blockout/core';
import { SEGMENTS, assemble, getDialect, type Dialect, type Segments } from './dialects';

const list = (a: string[]) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const FX_TEXT: Record<string, (who?: string) => string> = {
  dust: (w) => `a trail of dust kicks up behind ${w ?? 'the movement'}`, smoke: () => 'smoke drifts through the frame', sparks: () => 'sparks scatter from the impact',
  rain: () => 'steady rain falls across the scene', slash: (w) => `a bright slash arc follows ${w ? w + "'s" : 'the'} blade`,
};
/** Deterministic canonical description of one shot, written purely from measured facts and the bibles. */
export function describeShot(p: Project, f: ShotFacts): Segments {
  const style = p.bibles.style, prim = f.subjects.find((s) => s.primary), cam = f.camera, m = cam.motion;
  const sizeName = prim ? SHOT_SIZE_NAMES[prim.sizeStart] : 'wide shot';
  const framing = [`${cap(cam.angle === 'eye-level' ? '' : cam.angle + '-angle ')}${cam.angle === 'eye-level' ? cap(sizeName) : sizeName}${prim ? ` of ${prim.name}` : ''}`,
    prim && prim.sizeEnd !== prim.sizeStart ? `ending as a ${SHOT_SIZE_NAMES[prim.sizeEnd]}` : '', cam.ots ? `framed over ${cam.ots}'s shoulder` : '', cam.dutch ? `dutch tilt of ${Math.abs(cam.rollDeg)}°` : '', `${f.aspect} frame`].filter(Boolean).join(', ').replace(/^\s+/, '');
  const subject = f.subjects.filter((s) => s.visible >= 0.3).map((s) => {
    const b = p.bibles.characters[s.id], desc = b ? [b.appearance, b.wardrobe, b.weapon && s.held !== 'none' ? `carrying a ${b.weapon}` : ''].filter(Boolean).join(', ') : '';
    return `${s.name}${desc ? ` (${desc})` : ''} ${s.screenPos === 'center' ? 'at centre frame' : 'screen-' + s.screenPos}, facing ${s.facing}`;
  }).join('; ');
  const beats = f.subjects.filter((s) => s.visible >= 0.3).flatMap((s) => s.beats.map((b) => ({ ...b, who: s.name }))).sort((a, b) => a.t - b.t || a.who.localeCompare(b.who));
  const action = beats.map((b) => {
    const bits = [`${b.who} ${b.verb}`]; if (b.distance >= 1) bits.push(`${b.distance} m`); if (b.screenDir) bits.push(b.screenDir); if (b.curve && b.curve !== 'straight') bits.push(`on a path that ${b.curve}`); if (b.note) bits.push(b.note);
    return `[${b.t.toFixed(1)}–${b.end.toFixed(1)}s] ${bits.join(' ')}.`;
  }).join(' ');
  const speed = m.speed === 'locked' ? '' : m.speed + ' ', ease = m.easing === 'constant' ? '' : `, ${m.easing.replace('ease-in-out', 'easing in and out').replace('ease-in', 'accelerating').replace('ease-out', 'decelerating to a stop')}`;
  const move = m.type === 'static' ? 'static, locked-off camera' : m.type === 'handheld' ? 'handheld camera with subtle natural shake' : `${speed}${m.type}${m.type === 'tracking' && prim ? ` following ${prim.name}` : ''}${m.type === 'orbit' ? ` of about ${Math.round(Math.abs(m.orbitDeg) / 10) * 10}° around the subjects` : ''}${m.secondary.length ? ' with ' + list(m.secondary) : ''}${ease}`;
  const lens = m.focalFrom !== m.focalTo && Math.abs(Math.log(m.focalTo / m.focalFrom)) > 0.1 ? `${m.focalFrom.toFixed(0)}mm to ${m.focalTo.toFixed(0)}mm` : `${cam.focal}mm ${cam.lens} lens`;
  const camera = `Camera: ${move}; ${lens}, ${cam.dof} depth of field${m.shaky && m.type !== 'handheld' ? `, ${cam.shake === 'handheld' ? 'handheld' : cam.shake === 'runAndGun' ? 'run-and-gun' : 'violent'} shake` : ''}`;
  const lighting = [cap(f.lighting.description), style.lighting].filter(Boolean).join('. ');
  const fx = f.fx.map((x) => `${cap((FX_TEXT[x.kind] ?? (() => x.kind))(x.attachedTo))}${x.from > 0.05 || x.to < f.duration - 0.05 ? ` (${x.from.toFixed(1)}–${x.to.toFixed(1)}s)` : ''}`).join('. ');
  const styleSeg = [style.medium, style.era, style.palette.length ? `palette ${style.palette.join(' ')}` : '', ...style.references].filter(Boolean).join(', ');
  return { framing, subject, action, camera, lighting, fx, style: cap(styleSeg) };
}

export interface Compiled { shotId: string; provider: string; text: string; negative: string; segments: Record<string, string>; factsHash: string; previous?: PromptVersion; changed: string[]; conflicts: string[]; dropped: string[]; unchanged: boolean }
export function activePrompt(p: Project, shotId: string, provider: string): PromptVersion | undefined { const id = p.prompts.active[shotId]?.[provider]; return id ? p.prompts.versions[id] : undefined; }

/** Merge freshly rendered segments into the previous text: replace only segments whose generated text changed. */
export function mergePrompt(prev: PromptVersion | undefined, rendered: Record<string, string>, fresh: string): { text: string; changed: string[]; conflicts: string[] } {
  if (!prev || !prev.segments) return { text: fresh, changed: Object.keys(rendered), conflicts: [] };
  let text = prev.text; const changed: string[] = [], conflicts: string[] = [];
  for (const k of [...SEGMENTS, 'negative']) {
    const old = prev.segments[k], neu = rendered[k]; if (old === neu) continue; changed.push(k);
    if (old && text.includes(old)) text = text.replace(old, neu ?? '').replace(/ {2,}/g, ' ').replace(/\n{2,}/g, '\n').trim();
    else if (!old && neu) text = (text + (text.includes('\n') ? '\n' : ' ') + neu).trim();
    else if (old && neu) conflicts.push(k); // the user rewrote this passage by hand: keep their wording, flag it
  }
  return { text, changed, conflicts };
}
export function compileShot(p: Project, shotId: string, provider: string, opts: { segments?: Segments; facts?: ShotFacts; dialect?: Dialect } = {}): Compiled {
  const shot = p.shots.find((s) => s.id === shotId); if (!shot) throw new Error(`shot ${shotId} not found`);
  const facts = opts.facts ?? shotFacts(p, shot), d = opts.dialect ?? getDialect(provider), seg = opts.segments ?? describeShot(p, facts), a = assemble(seg, d, p.bibles.style.negative), prev = activePrompt(p, shotId, provider);
  const m = mergePrompt(prev, a.rendered, a.text);
  return { shotId, provider, text: m.text, negative: a.negative, segments: a.rendered, factsHash: facts.hash, previous: prev, changed: m.changed, conflicts: m.conflicts, dropped: a.dropped, unchanged: !!prev && prev.text === m.text && prev.factsHash === facts.hash };
}
let seq = 0;
export const promptVersionId = (shotId: string, provider: string, at: number) => `pv_${shotId}_${provider}_${at.toString(36)}${(seq++).toString(36)}`;
/** Ops that record new prompt versions (with lineage) for everything that actually changed. */
export function promptOps(compiled: Compiled[], author: PromptVersion['author'], at: number, noteFor?: (c: Compiled) => string): Op[] {
  return compiled.filter((c) => !c.unchanged).map((c) => ({ type: 'addPromptVersion', activate: true, version: { id: promptVersionId(c.shotId, c.provider, at), shotId: c.shotId, provider: c.provider, text: c.text, parent: c.previous?.id, factsHash: c.factsHash, author, at, segments: c.segments, negative: c.negative || undefined,
    note: noteFor?.(c) ?? (c.previous ? `rewrote ${c.changed.join(', ') || 'nothing'}${c.conflicts.length ? `; kept your wording for ${c.conflicts.join(', ')}` : ''}` : 'first compile') } }));
}
export interface StalePrompt { shotId: string; provider: string; versionId: string }
export function stalePrompts(p: Project): StalePrompt[] {
  const out: StalePrompt[] = [];
  for (const shot of p.shots) { const act = p.prompts.active[shot.id]; if (!act) continue; const h = shotFacts(p, shot).hash; for (const [provider, vid] of Object.entries(act)) if (p.prompts.versions[vid] && p.prompts.versions[vid].factsHash !== h) out.push({ shotId: shot.id, provider, versionId: vid }); }
  return out;
}
/** Lineage of a prompt version, newest first. */
export function lineage(p: Project, versionId: string): PromptVersion[] { const out: PromptVersion[] = []; let v: PromptVersion | undefined = p.prompts.versions[versionId]; while (v && out.length < 200) { out.push(v); v = v.parent ? p.prompts.versions[v.parent] : undefined; } return out; }

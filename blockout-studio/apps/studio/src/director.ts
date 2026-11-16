/** Studio-side orchestration of Claude tasks. Everything that changes the project becomes a proposal. */
import { batch, applyOp, diffShotFacts, newId, runContinuity, shotFacts, type Op, type Project, type ShotFacts, type Camera } from '@blockout/core';
import { compileShot, extractPreferences, promptOps, stalePrompts, type Compiled, type Segments, type TaskImage } from '@blockout/prompting';
import { S } from './store';
import { claude, effectiveBackend } from './gateway';

const fail = (what: string, e: unknown) => { const msg = (e as Error).message; S().say('system', `${what} failed: ${msg}`); S().notify(`${what} failed: ${msg.slice(0, 140)}`, 'error'); };
const via = (r: { backend: string; attempts: number; fallbackReason?: string }) => `${r.backend === 'local' ? 'offline director' : r.backend}${r.attempts > 1 ? ', 1 retry' : ''}${r.fallbackReason ? ` — fell back: ${r.fallbackReason}` : ''}`;
/** Facts at the time each shot's prompts were last compiled: the baseline for "what changed since". */
const baseline = new Map<string, ShotFacts>();
export const changesSince = (p: Project, shotId: string): string[] => { const shot = p.shots.find((s) => s.id === shotId), b = baseline.get(shotId); return shot && b ? diffShotFacts(b, shotFacts(p, shot)) : []; };
export const providersInUse = (p: Project): string[] => { const set = new Set<string>(['canonical']); for (const a of Object.values(p.prompts.active)) for (const k of Object.keys(a)) set.add(k); return [...set]; };

export async function direct(instruction: string): Promise<string | null> {
  const s = S(), text = instruction.trim(); if (!text) return null; s.say('user', text);
  const prefs = extractPreferences(text).filter((t) => !Object.values(s.project.memory).some((m) => m.text.toLowerCase() === t.toLowerCase()));
  if (prefs.length) { s.dispatch(batch('Remember preference', prefs.map((t) => ({ type: 'addMemory' as const, memory: { id: newId('mem'), kind: 'preference' as const, text: t, at: Date.now() } }))), { label: 'Remember preference' }); s.say('system', `Noted as a standing preference: ${prefs.map((p) => `"${p}"`).join(', ')}`); if (prefs.join(' ').length > text.length - 8) return null; }
  try {
    const r = await claude('direct', { instruction: text, t: s.t, selectionId: s.selection?.id, activeShotId: s.activeShotId ?? undefined }, { label: 'Directing' });
    if (r.value.question) { S().say('claude', r.value.question); return null; }
    if (!r.value.ops.length) { S().say('claude', r.value.reply || 'Nothing to change.'); return null; }
    const id = S().addProposal({ title: r.value.title, rationale: r.value.reply, ops: r.value.ops, source: r.backend === 'local' ? 'local' : 'claude', kind: 'direct', meta: { via: via(r) } });
    S().say('claude', r.value.reply, { proposalId: id }); S().previewProposal(id); return id;
  } catch (e) { fail('Direction', e); return null; }
}
export interface PromptChange { shotId: string; provider: string; before: string; after: string; changed: string[]; conflicts: string[]; compiled: Compiled; note: string }
/** Recompile prompts for the given shots across every provider in use. Returns a proposal carrying word-level diffs. */
export async function compilePrompts(shotIds: string[], providers?: string[], forceLocal = false): Promise<string | null> {
  const p = S().project, provs = providers ?? providersInUse(p); if (!shotIds.length) return null;
  try {
    const r = await claude('compilePrompts', { shotIds, changes: shotIds.map((id) => ({ shotId: id, name: p.shots.find((s) => s.id === id)?.name ?? id, changes: changesSince(p, id) })).filter((c) => c.changes.length) }, { label: 'Compiling prompts', forceLocal });
    const changes: PromptChange[] = [];
    for (const sh of r.value.shots) for (const provider of provs) { const c = compileShot(p, sh.shotId, provider, { segments: sh.segments as Segments }); if (!c.unchanged) changes.push({ shotId: sh.shotId, provider, before: c.previous?.text ?? '', after: c.text, changed: c.changed, conflicts: c.conflicts, compiled: c, note: sh.note }); }
    for (const id of shotIds) { const shot = p.shots.find((s) => s.id === id); if (shot) baseline.set(id, shotFacts(p, shot)); }
    if (!changes.length) { S().say('claude', 'Prompts are already up to date for those shots.'); return null; }
    const author = r.backend === 'local' ? 'local' : 'claude', names = [...new Set(changes.map((c) => p.shots.find((s) => s.id === c.shotId)?.name ?? c.shotId))];
    const id = S().addProposal({ title: `Update prompts: ${names.join(', ').slice(0, 60)}`, rationale: `${changes.length} prompt${changes.length > 1 ? 's' : ''} across ${names.length} shot${names.length > 1 ? 's' : ''} (${provs.join(', ')}). Only segments whose facts changed were rewritten.`, ops: promptOps(changes.map((c) => c.compiled), author, Date.now(), (c) => changes.find((x) => x.compiled === c)?.note ?? ''), source: author === 'local' ? 'local' : 'claude', kind: 'prompts', meta: { changes, via: via(r) } });
    S().say('claude', `Prompt update ready for ${names.join(', ')} — review the diff in the Prompt tab.`, { proposalId: id }); return id;
  } catch (e) { fail('Prompt compile', e); return null; }
}
export const recompileStale = () => compilePrompts([...new Set(stalePrompts(S().project).map((s) => s.shotId))]);
export function initBaselines(p: Project) { baseline.clear(); for (const s of p.shots) if (p.prompts.active[s.id]) { try { baseline.set(s.id, shotFacts(p, s)); } catch { /* incomplete shot */ } } }

export async function continuityReview(): Promise<void> {
  const p = S().project, issues = runContinuity(p);
  try {
    const r = await claude('continuity', { issues }, { label: 'Continuity review' }); S().say('claude', r.value.summary, { issues });
    for (const it of r.value.items) if (it.fix?.ops.length) { const id = S().addProposal({ title: it.fix.title, rationale: it.explanation, ops: it.fix.ops, source: r.backend === 'local' ? 'local' : 'claude', kind: 'continuity', meta: { issueId: it.id, via: via(r) } }); S().say('claude', `#${it.priority} ${it.explanation}`, { proposalId: id }); } else S().say('claude', `#${it.priority} ${it.explanation}`);
  } catch (e) { fail('Continuity review', e); }
}
export async function alternates(shotId: string, count = 3): Promise<void> {
  try { const r = await claude('alternates', { shotId, count }, { label: 'Alternate setups' }), shot = S().project.shots.find((s) => s.id === shotId)!;
    const id = S().addProposal({ title: `Alternates for ${shot.name}`, rationale: `${r.value.alternatives.length} setups that stay on the current side of the 180° line. Pick one to swap the shot's camera.`, ops: [], source: r.backend === 'local' ? 'local' : 'claude', kind: 'alternates', meta: { shotId, alternatives: r.value.alternatives, via: via(r) } }); S().say('claude', `Here are ${r.value.alternatives.length} alternate setups for ${shot.name}.`, { proposalId: id });
  } catch (e) { fail('Alternates', e); }
}
export const useAlternate = (shotId: string, cam: Camera): Op[] => { const id = newId('cam'); return [{ type: 'addCamera', camera: { ...cam, id, keys: cam.keys.map((k, i) => ({ ...k, id: `${id}_k${i}` })) } }, { type: 'updateShot', id: shotId, patch: { cameraId: id } }]; };
export async function scriptToBlockout(script: string): Promise<void> {
  S().say('user', `Script → blockout:\n${script.slice(0, 400)}${script.length > 400 ? '…' : ''}`);
  try { const r = await claude('scriptToBlockout', { script }, { label: 'Reading script' }); const id = S().addProposal({ title: r.value.title, rationale: r.value.rationale, ops: r.value.ops, source: r.backend === 'local' ? 'local' : 'claude', kind: 'script', meta: { via: via(r) } }); S().say('claude', r.value.rationale, { proposalId: id }); S().previewProposal(id); } catch (e) { fail('Script → blockout', e); }
}
export async function bibleReview(): Promise<void> {
  try { const r = await claude('bibleReview', {}, { label: 'Reviewing bibles' }), p = S().project; let n = 0;
    for (const a of r.value.amendments) { const ch = p.characters[a.target]; const op: Op | null = a.target === 'style' ? { type: 'setStyleBible', patch: { [a.field]: a.field === 'palette' || a.field === 'references' ? a.value.split(/,\s*/) : a.value } } : ch ? { type: 'setCharacterBible', characterId: ch.id, patch: { [a.field]: a.value } } : null; if (!op) continue; try { applyOp(p, op); } catch { continue; } n++; const id = S().addProposal({ title: `Bible: ${ch?.name ?? 'style'} · ${a.field}`, rationale: `${a.reason}\n→ "${a.value}"`, ops: [op], source: r.backend === 'local' ? 'local' : 'claude', kind: 'bible' }); S().say('claude', `${ch?.name ?? 'Style bible'} · ${a.field}: ${a.reason}`, { proposalId: id }); }
    for (const v of r.value.violations) { n++; if (v.fix?.ops.length) { const id = S().addProposal({ title: v.fix.title, rationale: v.text, ops: v.fix.ops, source: r.backend === 'local' ? 'local' : 'claude', kind: 'memory' }); S().say('claude', `Preference check: ${v.text}`, { proposalId: id }); } else S().say('claude', `Preference check: ${v.text}`); }
    if (!n) S().say('claude', 'Bibles and preferences are consistent with the blockout.');
  } catch (e) { fail('Bible review', e); }
}
export type { TaskImage };
export { effectiveBackend };

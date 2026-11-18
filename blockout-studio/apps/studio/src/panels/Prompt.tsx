import React, { useMemo, useState } from 'react';
import { shotFacts, type PromptVersion } from '@blockout/core';
import { activePrompt, applyHunks, lineage, listDialects, getDialect, wordDiff, compileShot, promptOps } from '@blockout/prompting';
import { S, useStudio, activeShot, type Proposal } from '../store';
import { changesSince, compilePrompts, type PromptChange } from '../director';
import { useGateway, notifyProposalResolved } from '../gateway';

function DiffReview({ proposal, change }: { proposal: Proposal; change: PromptChange }) {
  const parts = useMemo(() => wordDiff(change.before, change.after), [change]), hunks = parts.filter((p) => p.kind === 'hunk'), [rejected, setRejected] = useState<Set<number>>(new Set());
  const accept = () => {
    const s = S(), all = (proposal.meta!.changes as PromptChange[]), acc = new Set(hunks.map((h) => (h.kind === 'hunk' ? h.hunk.id : -1)).filter((id) => !rejected.has(id))), text = applyHunks(parts, acc);
    const ops = promptOps([{ ...change.compiled, text, unchanged: text === change.before }], proposal.source === 'local' ? 'local' : 'claude', Date.now(), () => `${change.note}${rejected.size ? ` (${rejected.size} hunk${rejected.size > 1 ? 's' : ''} rejected by you)` : ''}`);
    if (ops.length) s.dispatch({ type: 'batch', label: `Claude: prompt for ${s.project.shots.find((x) => x.id === change.shotId)?.name} (${change.provider})`, ops }, { author: 'claude' });
    const rest = all.filter((c) => c !== change); // keep the remaining diffs of this proposal reviewable
    s.set({ proposals: s.proposals.map((p) => (p.id === proposal.id ? { ...p, status: rest.length ? 'pending' : 'applied', ops: p.ops.filter((o) => !(o.type === 'addPromptVersion' && o.version.shotId === change.shotId && o.version.provider === change.provider)), meta: { ...p.meta, changes: rest } } : p)) }); if (!rest.length) notifyProposalResolved(proposal.id, 'applied');
  };
  return <div className="rounded border border-claude/60 bg-claude/5 p-2" data-testid="prompt-diff">
    <div className="mb-1 flex items-center gap-1 text-xxs text-dim"><span className="text-claude">✳</span> Proposed rewrite · changed: {change.changed.join(', ') || 'wording'}{change.conflicts.length > 0 && <span className="text-warn"> · kept your wording for {change.conflicts.join(', ')}</span>}</div>
    <p className="whitespace-pre-wrap leading-5">{parts.map((p, i) => p.kind === 'same' ? <span key={i}>{p.text}</span> : <button key={i} type="button" data-testid="hunk" aria-pressed={!rejected.has(p.hunk.id)} title="Click to accept / reject this change" onClick={() => setRejected((r) => { const n = new Set(r); n.has(p.hunk.id) ? n.delete(p.hunk.id) : n.add(p.hunk.id); return n; })} className="mx-0.5 rounded border border-line px-0.5 text-left align-baseline">
      {p.hunk.del && <del className={rejected.has(p.hunk.id) ? 'text-fg no-underline' : 'text-bad'}>{p.hunk.del}</del>}{p.hunk.ins && <ins className={`no-underline ${rejected.has(p.hunk.id) ? 'text-dim line-through' : 'bg-good/20 text-good'}`}>{p.hunk.ins}</ins>}</button>)}</p>
    {change.note && <p className="mt-1 text-xxs text-dim">{change.note}</p>}
    <div className="mt-1.5 flex gap-1"><button className="btn-claude" data-testid="diff-accept" onClick={accept}>Accept {hunks.length - rejected.size}/{hunks.length} changes</button><button className="btn" onClick={() => setRejected(new Set(hunks.map((h) => (h.kind === 'hunk' ? h.hunk.id : -1))))}>Reject all</button></div>
  </div>;
}
export function PromptPanel() {
  const project = useStudio((s) => s.project), shot = useStudio(activeShot), proposals = useStudio((s) => s.proposals), busy = useGateway((g) => g.busy), [provider, setProvider] = useState('canonical'), [hist, setHist] = useState(false);
  const facts = useMemo(() => { try { return shot ? shotFacts(project, shot) : null; } catch { return null; } }, [project, shot]);
  if (!shot || !facts) return <div className="p-3 text-dim">Select a shot to see its prompts.</div>;
  const v = activePrompt(project, shot.id, provider), stale = !!v && v.factsHash !== facts.hash, changes = stale ? changesSince(project, shot.id) : [], d = getDialect(provider);
  const pending = proposals.filter((p) => p.status === 'pending' && p.kind === 'prompts').flatMap((p) => ((p.meta?.changes as PromptChange[]) ?? []).filter((c) => c.shotId === shot.id && c.provider === provider).map((c) => ({ p, c })));
  const staleCount = project.shots.filter((s) => { const a = activePrompt(project, s.id, provider); try { return a && a.factsHash !== shotFacts(project, s).hash; } catch { return false; } }).length;
  const save = (text: string) => { if (!v || text === v.text) return; S().dispatch({ type: 'addPromptVersion', activate: true, version: { ...v, id: `pv_${shot.id}_${provider}_u${Date.now().toString(36)}`, text, parent: v.id, author: 'user', note: 'manual edit', at: Date.now() } }, { label: `Edit ${provider} prompt for ${shot.name}` }); };
  const quick = () => { const c = compileShot(project, shot.id, provider); if (!c.unchanged) S().dispatch({ type: 'batch', label: `Compile ${provider} prompt for ${shot.name}`, ops: promptOps([c], 'local', Date.now()) }); };
  return <div className="flex h-full flex-col overflow-auto p-2" data-testid="prompt-panel">
    <div className="flex items-center gap-1"><span className="truncate font-semibold">{shot.name}</span><span className="flex-1" /><select aria-label="Provider dialect" data-testid="dialect-select" className="inp !w-36" value={provider} onChange={(e) => setProvider(e.target.value)}>{listDialects().map((x) => <option key={x.id} value={x.id}>{x.name}{project.prompts.active[shot.id]?.[x.id] ? ' ●' : ''}</option>)}</select></div>
    <p className="mt-0.5 text-xxs text-dim">{d.layout} · ≤{d.maxChars} chars · controls: {d.controls.join(', ')} · ≤{d.maxDuration}s{d.notes ? ` — ${d.notes}` : ''}{facts.duration > d.maxDuration ? <span className="text-warn"> · this shot is {facts.duration.toFixed(1)}s, longer than the dialect's limit</span> : null}{d.durations ? ` · durations ${d.durations.join('/')}s` : ''}
      {' · '}{d.verified ? <span className="text-good" title={`${d.verified.sources.join('\n')}\n${d.verified.notes}`} data-testid="dialect-verified">limits sourced {d.verified.on}</span> : <span className="text-warn" data-testid="dialect-unverified">limits are estimates</span>}</p>
    <div className="my-1.5 flex flex-wrap gap-1">
      <button className="btn-claude" data-testid="compile-shot" disabled={!!busy} onClick={() => void compilePrompts([shot.id], [...new Set(['canonical', provider])])}>{v ? 'Recompile with Claude' : 'Write with Claude'}</button>
      <button className="btn" data-testid="compile-quick" onClick={quick} title="Deterministic compile from facts, no model">From facts</button>
      <button className="btn" data-testid="compile-all" disabled={!!busy} onClick={() => void compilePrompts(project.shots.map((s) => s.id), [...new Set(['canonical', provider])])}>All shots</button>
      {staleCount > 0 && <button className="btn border-warn text-warn" data-testid="compile-stale" disabled={!!busy} onClick={() => void compilePrompts(project.shots.filter((s) => { const a = activePrompt(project, s.id, provider); return a && a.factsHash !== shotFacts(project, s).hash; }).map((s) => s.id), [...new Set(['canonical', provider])])}>{staleCount} stale → update</button>}
    </div>
    {stale && <div className="mb-1.5 rounded border border-warn/60 bg-warn/10 p-1.5 text-xxs" data-testid="stale-badge"><b className="text-warn">Stale.</b> The staging changed after this prompt was written{changes.length ? ':' : '.'}<ul className="list-disc pl-4">{changes.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
    {pending.map(({ p, c }, i) => <div key={p.id + i} className="mb-1.5"><DiffReview proposal={p} change={c} /></div>)}
    {v ? <PromptText key={v.id} v={v} max={d.maxChars} onSave={save} /> : <p className="rounded border border-dashed border-line p-3 text-dim">No {d.name} prompt yet. “Write with Claude” turns the measured facts below into prose; “From facts” does it without a model.</p>}
    {v?.negative && <p className="mt-1 text-xxs text-dim"><b>Negative:</b> {v.negative}</p>}
    {v && <button className="mt-1 self-start text-xxs text-accent underline" onClick={() => setHist(!hist)}>{hist ? 'Hide' : 'Show'} version history ({lineage(project, v.id).length})</button>}
    {hist && v && <ol className="mt-1 space-y-1 text-xxs" data-testid="prompt-history">{lineage(project, v.id).map((x, i) => <li key={x.id} className="rounded border border-line p-1"><div className="flex gap-1"><b>{i === 0 ? 'current' : `v-${i}`}</b><span className="chip">{x.author}</span><span className="text-dim">{x.at ? new Date(x.at).toLocaleString() : ''}</span><span className="flex-1" />{i > 0 && <button className="text-accent underline" onClick={() => S().dispatch({ type: 'setActivePrompt', shotId: shot.id, provider, versionId: x.id }, { label: 'Restore prompt version' })}>restore</button>}</div><div className="text-dim">{x.note}</div><div className="line-clamp-2">{x.text}</div></li>)}</ol>}
    <details className="mt-2 text-xxs"><summary className="cursor-pointer text-dim">Measured facts Claude writes from</summary><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-bg p-1.5 text-[10px]" data-testid="facts-json">{JSON.stringify({ camera: facts.camera, subjects: facts.subjects.map((s) => ({ name: s.name, size: `${s.sizeStart}→${s.sizeEnd}`, screen: s.screenPos, facing: s.facing, beats: s.beats })), lighting: facts.lighting, fx: facts.fx }, null, 1)}</pre></details>
  </div>;
}
function PromptText({ v, max, onSave }: { v: PromptVersion; max: number; onSave: (t: string) => void }) {
  const [text, setText] = useState(v.text);
  return <><textarea aria-label="Prompt text" data-testid="prompt-text" className="inp min-h-[9rem] flex-1 leading-5" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onSave(text)} onKeyDown={(e) => e.stopPropagation()} />
    <div className="flex justify-between text-xxs text-dim"><span>{v.author === 'user' ? 'edited by you' : v.author === 'claude' ? 'written by Claude' : 'compiled from facts'} · {v.note}</span><span className={text.length > max ? 'text-bad' : ''}>{text.length}/{max}</span></div></>;
}

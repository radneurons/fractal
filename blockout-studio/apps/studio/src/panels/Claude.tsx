import React, { useEffect, useMemo, useRef, useState } from 'react';
import { describeOp, diffProjects, evalCamera, OpS, applyOp, batch, type Camera, type Op } from '@blockout/core';
import { GLPassRenderer, passSize } from '@blockout/render';
import { S, useStudio, activeShot, type Proposal } from '../store';
import { BACKENDS, effectiveBackend, notifyProposalResolved, refreshStatus, rpc, useGateway, type BackendId } from '../gateway';
import { alternates, bibleReview, continuityReview, direct, recompileStale, scriptToBlockout, useAlternate } from '../director';
import { exportRenderer } from '../exporter';

function Thumb({ camera, t }: { camera: Camera; t: number }) {
  const ref = useRef<HTMLCanvasElement>(null), project = useStudio((s) => s.project);
  useEffect(() => { const gl = exportRenderer(), cv = ref.current!, [w, h] = passSize(project, 96); cv.width = w; cv.height = h; if (gl.kind !== 'webgl') return; const g = gl as GLPassRenderer; g.renderAt(project, t, evalCamera(project, camera, t), 'clay', w, h); cv.getContext('2d')!.drawImage(g.output as HTMLCanvasElement, 0, 0); }, [camera, t, project]);
  return <canvas ref={ref} className="w-full rounded border border-line" />;
}
export function ProposalCard({ p }: { p: Proposal }) {
  const ghostId = useStudio((s) => s.ghostId), project = useStudio((s) => s.project), [edit, setEdit] = useState<string | null>(null), [open, setOpen] = useState(false);
  const diffs = useMemo(() => { if (p.status !== 'pending' || !p.ops.length) return []; try { return diffProjects(project, applyOp(project, batch('x', p.ops)).project); } catch { return []; } }, [p, project]);
  const done = p.status !== 'pending', resolve = (ok: boolean, ops?: Op[]) => { if (ok) { if (S().applyProposal(p.id, ops)) notifyProposalResolved(p.id, 'applied'); } else { S().rejectProposal(p.id); notifyProposalResolved(p.id, 'rejected'); } };
  const alts = p.kind === 'alternates' ? (p.meta?.alternatives as { name: string; rationale: string; camera: Camera }[]) : null, shot = alts ? project.shots.find((s) => s.id === p.meta?.shotId) : null;
  return <div className={`my-1 rounded border p-2 ${done ? 'border-line opacity-70' : 'border-claude/70 bg-claude/5'}`} data-testid="proposal-card" data-kind={p.kind} data-status={p.status}>
    <div className="flex items-center gap-1"><span className="font-semibold text-fg">{p.title}</span><span className="flex-1" /><span className={`chip ${p.status === 'applied' ? 'text-good' : p.status === 'failed' ? 'text-bad' : ''}`}>{p.status}</span></div>
    {p.rationale && <p className="mt-0.5 whitespace-pre-wrap text-dim">{p.rationale}</p>}
    {typeof p.meta?.via === 'string' && <p className="text-xxs text-dim">via {p.meta.via}</p>}
    {alts && shot && <div className="mt-1 grid grid-cols-3 gap-1" data-testid="alternates">{alts.map((a) => <div key={a.camera.id} className="rounded border border-line p-1"><Thumb camera={a.camera} t={(shot.start + shot.end) / 2} /><div className="mt-0.5 text-xxs font-semibold">{a.name}</div><div className="text-xxs text-dim">{a.rationale}</div>
      {!done && <button className="btn-claude mt-1 w-full justify-center" onClick={() => resolve(true, useAlternate(shot.id, a.camera))}>Use</button>}</div>)}</div>}
    {p.kind === 'generation' && !done && <p className="mt-1 text-xxs text-warn">Confirm in the Takes tab — generation can cost money.</p>}
    {diffs.length > 0 && <ul className="mt-1 list-disc pl-4 text-xxs text-fg">{diffs.flatMap((d) => d.changes.slice(0, 4).map((c, i) => <li key={d.shotId + i}><b>{d.name}:</b> {c}</li>))}</ul>}
    {p.ops.length > 0 && <button className="mt-1 text-xxs text-accent underline" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} {p.ops.length} op{p.ops.length > 1 ? 's' : ''}</button>}
    {open && <ol className="mt-1 max-h-32 list-decimal overflow-auto pl-5 text-xxs text-dim">{p.ops.map((o, i) => <li key={i}>{describeOp(o, project)}</li>)}</ol>}
    {edit !== null && <textarea aria-label="Edit proposal ops (JSON)" className="inp mt-1 h-40 font-mono text-xxs" value={edit} onChange={(e) => setEdit(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />}
    {p.error && <p className="text-xxs text-bad">{p.error}</p>}
    {!done && !alts && p.kind !== 'generation' && p.kind !== 'prompts' && <div className="mt-1.5 flex gap-1">
      <button className={`btn ${ghostId === p.id ? 'border-claude text-claude' : ''}`} data-testid="proposal-preview" onClick={() => S().previewProposal(ghostId === p.id ? null : p.id)}>{ghostId === p.id ? 'Hide preview' : 'Preview'}</button>
      <button className="btn-claude" data-testid="proposal-apply" onClick={() => { if (edit === null) return resolve(true); try { resolve(true, OpS.array().parse(JSON.parse(edit))); } catch (e) { S().notify(`Edited ops are invalid: ${(e as Error).message.slice(0, 120)}`, 'error'); } }}>Apply</button>
      <button className="btn" onClick={() => setEdit(edit === null ? JSON.stringify(p.ops, null, 1) : null)}>{edit === null ? 'Edit' : 'Cancel edit'}</button>
      <button className="btn" data-testid="proposal-reject" onClick={() => resolve(false)}>Reject</button></div>}
    {!done && p.kind === 'prompts' && <div className="mt-1.5 flex gap-1"><button className="btn-claude" onClick={() => S().set({ rightTab: 'prompt' })}>Review diff</button><button className="btn" onClick={() => resolve(true)}>Accept all</button><button className="btn" onClick={() => resolve(false)}>Reject</button></div>}
    {!done && (alts || p.kind === 'generation') && <div className="mt-1.5"><button className="btn" onClick={() => resolve(false)}>Dismiss</button></div>}
  </div>;
}
export function BackendBadge() {
  const g = useGateway(), eff = effectiveBackend(), label = BACKENDS.find((b) => b.id === eff.id)!.label;
  return <span className={`chip ${eff.fallback ? 'text-warn' : eff.id === 'local' ? '' : 'text-good'}`} data-testid="backend-badge" title={eff.fallback ? `Selected backend unavailable: ${eff.reason}` : g.connected ? 'Bridge connected' : 'Embedded (no bridge)'}>{eff.fallback ? '⚠ ' : '● '}{label}{g.backend === 'anthropic-api' && g.connected ? ` · $${g.apiSpend.toFixed(4)}` : ''}</span>;
}
export function ClaudePanel() {
  const chat = useStudio((s) => s.chat), proposals = useStudio((s) => s.proposals), shot = useStudio(activeShot), g = useGateway(), [text, setText] = useState(''), [script, setScript] = useState<string | null>(null), [key, setKey] = useState(''), end = useRef<HTMLDivElement>(null), [showLog, setShowLog] = useState(false);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat.length, g.progress]);
  const send = () => { const t = text.trim(); if (!t || g.busy) return; setText(''); void direct(t); };
  const st = g.status;
  return <div className="flex h-full flex-col" data-testid="claude-panel">
    <div className="border-b border-line p-2">
      <div className="flex items-center gap-1"><select aria-label="Claude backend" data-testid="backend-select" className="inp" value={g.backend} onChange={(e) => { g.setBackend(e.target.value as BackendId); void refreshStatus(); }}>{BACKENDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select><BackendBadge /></div>
      <p className="mt-1 text-xxs text-dim">{BACKENDS.find((b) => b.id === g.backend)!.hint} {g.connected ? `Bridge connected · secrets in ${st?.secrets ?? '…'}${g.backend === 'claude-code' && st?.backends['claude-code']?.version ? ` · ${st.backends['claude-code'].version}` : ''}.` : 'Bridge not connected — run `pnpm bridge` for Claude; the offline director is used meanwhile.'}</p>
      {g.backend === 'anthropic-api' && g.connected && <div className="mt-1 flex items-center gap-1"><input aria-label="Anthropic API key" type="password" className="inp" placeholder={st?.backends['anthropic-api']?.available ? 'key stored in keychain — paste to replace' : 'sk-ant-… (stored only in the bridge keychain)'} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /><button className="btn" disabled={!key} onClick={async () => { await rpc('secrets.set', { name: 'ANTHROPIC_API_KEY', value: key }); setKey(''); void refreshStatus(); S().notify('Key stored in the bridge keychain.'); }}>Store</button><span className="chip" title="Spend this bridge session">{st?.apiModel} · ${g.apiSpend.toFixed(4)}{g.lastUsage ? ` · last ${g.lastUsage.inputTokens + g.lastUsage.cacheReadTokens}→${g.lastUsage.outputTokens} tok` : ''}</span></div>}
      <div className="mt-1.5 flex flex-wrap gap-1">
        <button className="btn" disabled={!!g.busy} data-testid="act-continuity" onClick={() => void continuityReview()}>Continuity review</button>
        <button className="btn" disabled={!!g.busy || !shot} data-testid="act-alternates" onClick={() => shot && void alternates(shot.id)}>3 alternates for shot</button>
        <button className="btn" disabled={!!g.busy} data-testid="act-stale" onClick={() => void recompileStale()}>Recompile stale prompts</button>
        <button className="btn" disabled={!!g.busy} onClick={() => void bibleReview()}>Review bibles</button>
        <button className="btn" data-testid="act-script" onClick={() => setScript(script === null ? '' : null)}>Script → blockout</button>
      </div>
      {script !== null && <div className="mt-1"><textarea aria-label="Script" data-testid="script-input" className="inp h-28" placeholder={'Paste a scene, a screenplay page or a paragraph.\n\nEXT. FIELD - DUSK\nMARA walks toward JONAH…'} value={script} onChange={(e) => setScript(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /><button className="btn-claude mt-1" data-testid="script-run" disabled={!script.trim() || !!g.busy} onClick={() => { void scriptToBlockout(script); setScript(null); }}>Build blockout proposal</button></div>}
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-2" role="log" aria-label="Claude thread">
      {chat.length === 0 && <p className="text-dim">Direct in plain language — “Have the grey ronin circle him twice, then lunge as the camera cranes up.” Every change arrives as a proposal you can preview, edit, apply or reject. Statements like “I hate dutch angles” are remembered.</p>}
      {chat.filter((m) => showLog || m.role !== 'log').map((m) => { const p = m.proposalId ? proposals.find((x) => x.id === m.proposalId) : null; return <div key={m.id} className={`mb-1.5 ${m.role === 'user' ? 'text-right' : ''}`}>
        {m.role === 'log' ? <div className="text-xxs text-dim">⚙ {m.text}</div> : <div className={`inline-block max-w-full whitespace-pre-wrap rounded px-2 py-1 text-left ${m.role === 'user' ? 'bg-accent/20' : m.role === 'system' ? 'bg-raised text-dim' : 'bg-raised'}`}>{m.role === 'claude' && <span className="mr-1 text-claude">✳</span>}{m.text}</div>}
        {m.issues && m.issues.length > 0 && <ul className="mt-1 text-xxs">{m.issues.slice(0, 8).map((i) => <li key={i.id} className="flex gap-1"><span className={i.severity === 'high' ? 'text-bad' : i.severity === 'medium' ? 'text-warn' : 'text-dim'}>●</span><button className="text-left hover:underline" onClick={() => i.shots[1] && S().select({ kind: 'shot', id: i.shots[1] })}>{i.message}</button></li>)}</ul>}
        {p && <ProposalCard p={p} />}</div>; })}
      {g.busy && <div className="text-xxs text-claude" data-testid="claude-busy">✳ {g.busy}… {g.progress}</div>}
      <div ref={end} />
    </div>
    <div className="border-t border-line p-2"><div className="flex gap-1"><input aria-label="Message Claude" data-testid="claude-input" className="inp" placeholder="Direct the scene…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') send(); }} /><button className="btn-claude" disabled={!!g.busy} onClick={send}>Send</button></div>
      <label className="mt-1 flex items-center gap-1 text-xxs text-dim"><input type="checkbox" checked={showLog} onChange={(e) => setShowLog(e.target.checked)} />show bridge / MCP action log ({chat.filter((m) => m.role === 'log').length})</label></div>
  </div>;
}

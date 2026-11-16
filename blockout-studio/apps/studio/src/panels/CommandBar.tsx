import React, { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { S, useStudio } from '../store';
import { useGateway } from '../gateway';
import { direct } from '../director';
import { BackendBadge, ProposalCard } from './Claude';

const EXAMPLES = ['Have the grey ronin circle him twice, then lunge as the camera cranes up.', 'Set the lens to 85mm', 'Ren walks toward Kenji, then slashes', 'Make it night and add rain', 'Camera orbits as Kenji blocks'];
export function CommandBar({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [text, setText] = useState(''), [pid, setPid] = useState<string | null>(null), [answer, setAnswer] = useState<string | null>(null), g = useGateway(), proposal = useStudio((s) => s.proposals.find((p) => p.id === pid)), ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setPid(null); setAnswer(null); setTimeout(() => ref.current?.focus(), 30); } }, [open]);
  useEffect(() => { if (proposal && proposal.status !== 'pending') onOpenChange(false); }, [proposal?.status]);
  const run = async (t = text) => { if (!t.trim() || g.busy) return; setPid(null); setAnswer(null); const n = S().chat.length, id = await direct(t); if (id) { setPid(id); setText(''); } else { const last = S().chat.slice(n).reverse().find((m) => m.role !== 'user' && m.role !== 'log'); setAnswer(last?.text ?? null); } };
  return <Dialog.Root open={open} onOpenChange={(v) => { if (!v && pid && S().ghostId === pid) S().previewProposal(null); onOpenChange(v); }}>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
      <Dialog.Content className="fixed left-1/2 top-[12%] z-50 w-[min(680px,92vw)] -translate-x-1/2 rounded-lg border border-claude/60 bg-panel p-3 shadow-2xl" data-testid="command-bar" aria-describedby={undefined}>
        <Dialog.Title className="mb-1 flex items-center gap-2 text-xs text-dim"><span className="text-claude">✳</span> Direct with Claude <span className="flex-1" /><BackendBadge /></Dialog.Title>
        <input ref={ref} data-testid="command-input" aria-label="Direction" className="inp !py-2 !text-sm" placeholder="Describe the staging or the camera…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void run(); if (e.key === 'Escape') onOpenChange(false); }} />
        {g.busy && <p className="mt-2 text-xs text-claude">✳ {g.busy}… {g.progress}</p>}
        {answer && <p className="mt-2 whitespace-pre-wrap rounded bg-raised p-2 text-xs" data-testid="command-answer">{answer}</p>}
        {proposal && <><ProposalCard p={proposal} /><p className="text-xxs text-dim">The result is ghosted in the scene (orange paths). Apply to commit as one undoable entry, or tweak with Edit.</p></>}
        {!proposal && !g.busy && !answer && <div className="mt-2 flex flex-wrap gap-1">{EXAMPLES.map((e) => <button key={e} className="chip hover:text-fg" onClick={() => { setText(e); void run(e); }}>{e}</button>)}</div>}
      </Dialog.Content></Dialog.Portal></Dialog.Root>;
}

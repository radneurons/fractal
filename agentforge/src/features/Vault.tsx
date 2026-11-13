import { useMemo, useState } from 'react';
import { useLearner, exportData } from '@/store/learner';
import { useModel } from '@/store/model';
import { SKILLS, getSkill } from '@/content/skills';
import type { VaultEntry } from '@/core/types';
import { Icon, Markdown, Modal, PageHeader, Tabs, fmtRel, useToast } from '@/ui/kit';
import { href } from '@/ui/router';

type Tab = 'all' | VaultEntry['kind'] | 'cards';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'note', label: 'Notes' }, { id: 'mistake', label: 'Mistake journal' }, { id: 'prompt', label: 'Prompts' }, { id: 'snippet', label: 'Snippets' }, { id: 'interview', label: 'Interview answers' }, { id: 'decision', label: 'Decisions & plans' }, { id: 'cards', label: 'Review cards' },
];

function download(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function Vault() {
  const vault = useLearner((s) => s.vault);
  const addVault = useLearner((s) => s.addVault);
  const updateVault = useLearner((s) => s.updateVault);
  const removeVault = useLearner((s) => s.removeVault);
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [edit, setEdit] = useState<VaultEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const tags = useMemo(() => [...new Set(vault.flatMap((v) => v.tags))].sort(), [vault]);
  const list = vault.filter((v) => (tab === 'all' || v.kind === tab) && (!tag || v.tags.includes(tag)) && (!q || `${v.title} ${v.body}`.toLowerCase().includes(q.toLowerCase())));
  const md = () => vault.map((v) => `## ${v.title}\n_${v.kind} · ${new Date(v.createdAt).toLocaleDateString()} · ${v.tags.join(', ')}_\n\n${v.body}\n`).join('\n---\n\n');

  return (
    <div className="stack">
      <PageHeader eyebrow="Knowledge Vault" title="Your notes, prompts and mistakes"
        actions={<><button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" /> New note</button><button className="btn" onClick={() => download('agentforge-vault.md', md(), 'text/markdown')}><Icon name="download" /> Export Markdown</button><button className="btn ghost" onClick={() => download('agentforge-backup.json', exportData())}><Icon name="download" /> Full backup</button></>}>
        Everything you save stays in this browser. Incorrect answers are logged automatically in the Mistake Journal and marked resolved when you later get them right.
      </PageHeader>
      <Tabs label="Vault section" tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'cards' ? <ReviewCards /> : (
        <>
          <div className="row">
            <input className="input" style={{ maxWidth: 360 }} placeholder="Search the vault…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search vault" />
            <select className="select" style={{ width: 'auto' }} value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag"><option value="">All tags</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <span className="tiny faint">{list.length} entries</span>
          </div>
          {tab === 'mistake' && <div className="callout small">The Mistake Journal records the task, your answer, what went wrong and the correct explanation. Revisit the skill to demonstrate improvement — resolved entries show it.</div>}
          {list.length ? (
            <div className="grid auto">
              {list.map((v) => (
                <article key={v.id} className="card stack sm" style={v.kind === 'mistake' && v.resolved ? { opacity: 0.7 } : undefined}>
                  <div className="row between"><span className="chip">{v.kind}{v.kind === 'mistake' ? (v.resolved ? ' · resolved ✓' : ' · open') : ''}</span><span className="tiny faint">{fmtRel(v.updatedAt)}</span></div>
                  <b>{v.title}</b>
                  <div className="small muted" style={{ maxHeight: 120, overflow: 'hidden' }}><Markdown text={v.body.slice(0, 360) + (v.body.length > 360 ? '…' : '')} /></div>
                  <div className="row" style={{ gap: 4 }}>{v.tags.map((t) => <span key={t} className="chip">{t}</span>)}{v.skillIds.map((s) => <a key={s} className="chip violet" href={href(`/practice/${s}`)}>{getSkill(s).title}</a>)}</div>
                  <div className="row">
                    <button className="btn sm" onClick={() => setEdit(v)}>Open</button>
                    {v.kind === 'mistake' && v.skillIds[0] && <a className="btn sm" href={href(`/practice/${v.skillIds[0]}`)}>Retry skill</a>}
                    <button className="btn ghost sm" onClick={() => { removeVault(v.id); toast('Deleted'); }} aria-label={`Delete ${v.title}`}><Icon name="trash" /></button>
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="empty">Nothing here yet.</div>}
        </>
      )}
      <EntryEditor open={creating || !!edit} entry={edit} onClose={() => { setEdit(null); setCreating(false); }}
        onSave={(e) => { if (edit) updateVault(edit.id, e); else addVault({ kind: 'note', skillIds: [], ...e } as Omit<VaultEntry, 'id' | 'createdAt' | 'updatedAt'>); setEdit(null); setCreating(false); toast('Saved'); }} />
    </div>
  );
}

function EntryEditor({ open, entry, onClose, onSave }: { open: boolean; entry: VaultEntry | null; onClose: () => void; onSave: (e: Partial<VaultEntry>) => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [kind, setKind] = useState<VaultEntry['kind']>('note');
  const [skill, setSkill] = useState('');
  const [key, setKey] = useState('');
  const k = entry?.id ?? (open ? 'new' : '');
  if (k !== key) {
    setKey(k);
    setTitle(entry?.title ?? '');
    setBody(entry?.body ?? '');
    setTags(entry?.tags.join(', ') ?? '');
    setKind(entry?.kind ?? 'note');
    setSkill(entry?.skillIds[0] ?? '');
  }
  return (
    <Modal open={open} onClose={onClose} title={entry ? 'Edit entry' : 'New note'} wide>
      <div className="stack">
        <div className="grid g2">
          <label className="field">Title<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="field">Type<select className="select" value={kind} onChange={(e) => setKind(e.target.value as VaultEntry['kind'])}>{['note', 'prompt', 'snippet', 'bookmark', 'decision', 'interview', 'mistake'].map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        <label className="field">Content (Markdown: **bold**, `code`, - lists, ``` blocks)<textarea className="textarea code" style={{ minHeight: 220 }} value={body} onChange={(e) => setBody(e.target.value)} /></label>
        <div className="grid g2">
          <label className="field">Tags (comma separated)<input className="input" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
          <label className="field">Related skill<select className="select" value={skill} onChange={(e) => setSkill(e.target.value)}><option value="">—</option>{SKILLS.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        </div>
        <div className="row"><button className="btn primary" disabled={!title.trim()} onClick={() => onSave({ title, body, kind, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), skillIds: skill ? [skill] : [] })}>Save</button><button className="btn ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </Modal>
  );
}

function ReviewCards() {
  const { est } = useModel();
  const record = useLearner((s) => s.recordEvidence);
  const deck = SKILLS.filter((s) => est[s.id].attempts > 0);
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  if (!deck.length) return <div className="empty">Cards appear for skills you've practised.</div>;
  const s = deck[i % deck.length];
  const rate = (knew: boolean) => {
    record({ skillId: s.id, source: 'self', score: knew ? 1 : 0, difficulty: s.difficulty, hintsUsed: 0, solutionRevealed: false, errorTags: [], gradedBy: 'self', itemId: `card:${s.id}` }, `Review card: ${s.title}`);
    setFlip(false);
    setI(i + 1);
  };
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <div className="tiny faint">Card {(i % deck.length) + 1} of {deck.length} · self-rated recall counts at 0.2× weight — use the Review queue for graded retrieval.</div>
      <button className="card" style={{ minHeight: 220, textAlign: 'left', cursor: 'pointer' }} onClick={() => setFlip(!flip)} aria-label={flip ? 'Show front' : 'Reveal answer'}>
        <div className="eyebrow">{flip ? 'Key idea' : 'Recall'}</div>
        {flip ? <Markdown text={`**${s.summary}**\n\n${s.workedExample}`} /> : <h2>{s.title}: what is the key idea, and an example?</h2>}
      </button>
      {flip ? <div className="row"><button className="btn primary" onClick={() => rate(true)}>I knew it</button><button className="btn" onClick={() => rate(false)}>Not yet</button></div> : <button className="btn" onClick={() => setFlip(true)}>Reveal</button>}
    </div>
  );
}

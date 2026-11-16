import React from 'react';
import { newId } from '@blockout/core';
import { S, useStudio } from '../store';
import { Field, Section, Text } from '../ui';
import { assetUrl, putAsset } from '../persist';
import { bibleReview } from '../director';
import { useGateway } from '../gateway';

async function addImage(onId: (id: string) => void) { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const id = `ref_${Date.now().toString(36)}_${f.name.replace(/[^\w.]/g, '_')}`; await putAsset(id, f); onId(id); }; inp.click(); }
export function BiblesPanel() {
  const p = useStudio((s) => s.project), busy = useGateway((g) => g.busy), st = p.bibles.style, up = (patch: Partial<typeof st>) => S().dispatch({ type: 'setStyleBible', patch });
  return <div className="h-full overflow-auto" data-testid="bibles-panel">
    <div className="flex items-center gap-1 border-b border-line p-2"><span className="text-xxs text-dim">Every compiled prompt pulls from these.</span><span className="flex-1" /><button className="btn-claude" disabled={!!busy} data-testid="bible-review" onClick={() => { S().set({ rightTab: 'claude' }); void bibleReview(); }}>Check for drift</button></div>
    <Section title="Style bible">
      <Field label="Logline" wide><Text area value={st.logline} onChange={(logline) => up({ logline })} /></Field>
      <Field label="Medium" wide><Text label="Medium" value={st.medium} onChange={(medium) => up({ medium })} /></Field>
      <Field label="Era" wide><Text value={st.era} onChange={(era) => up({ era })} /></Field>
      <Field label="Palette" wide><div className="flex flex-wrap items-center gap-1">{st.palette.map((c, i) => <span key={i} className="flex items-center"><input aria-label={`Palette colour ${i + 1}`} type="color" value={/^#[0-9a-f]{6}$/i.test(c) ? c : '#888888'} onChange={(e) => S().dispatch({ type: 'setStyleBible', patch: { palette: st.palette.map((x, j) => (j === i ? e.target.value : x)) } }, { coalesce: 'pal' + i })} /><button aria-label="Remove colour" className="text-dim" onClick={() => up({ palette: st.palette.filter((_, j) => j !== i) })}>✕</button></span>)}<button className="btn" onClick={() => up({ palette: [...st.palette, '#888888'] })}>+</button></div></Field>
      <Field label="Lens habits" wide><Text area value={st.lensHabits} onChange={(lensHabits) => up({ lensHabits })} /></Field>
      <Field label="Lighting" wide><Text area value={st.lighting} onChange={(lighting) => up({ lighting })} /></Field>
      <Field label="References (one per line)" wide><Text area value={st.references.join('\n')} onChange={(v) => up({ references: v.split('\n').map((x) => x.trim()).filter(Boolean) })} /></Field>
      <Field label="Negative" wide><Text area value={st.negative} onChange={(negative) => up({ negative })} /></Field>
    </Section>
    {Object.values(p.characters).map((c) => { const b = p.bibles.characters[c.id] ?? { appearance: '', wardrobe: '', weapon: '', silhouette: '', refImages: [] }, ub = (patch: Partial<typeof b>) => S().dispatch({ type: 'setCharacterBible', characterId: c.id, patch });
      return <Section key={c.id} title={c.name} right={<span className="flex items-center gap-1 text-xxs text-dim"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: c.idColor }} />mask {c.idColor}</span>}>
        <Field label="Appearance" wide><Text area label={`${c.name} appearance`} value={b.appearance} onChange={(appearance) => ub({ appearance })} /></Field>
        <Field label="Wardrobe" wide><Text value={b.wardrobe} onChange={(wardrobe) => ub({ wardrobe })} /></Field>
        <Field label="Weapon / prop" wide><Text value={b.weapon} onChange={(weapon) => ub({ weapon })} /></Field>
        <Field label="Silhouette notes" wide><Text value={b.silhouette} onChange={(silhouette) => ub({ silhouette })} /></Field>
        <div className="mt-1 flex flex-wrap items-center gap-1">{b.refImages.map((id) => <span key={id} className="relative"><img alt={`${c.name} reference`} src={assetUrl(id)} className="h-14 w-14 rounded border border-line object-cover" /><button aria-label="Remove reference" className="absolute right-0 top-0 rounded bg-black/70 px-1 text-xxs text-white" onClick={() => ub({ refImages: b.refImages.filter((x) => x !== id) })}>✕</button></span>)}
          <button className="btn" onClick={() => addImage((id) => ub({ refImages: [...b.refImages, id] }))}>+ Reference image</button></div>
      </Section>; })}
    <Section title="Session memory" right={<button className="btn" onClick={() => { const t = prompt('Preference or decision to remember'); if (t) S().dispatch({ type: 'addMemory', memory: { id: newId('mem'), kind: 'preference', text: t, at: Date.now() } }); }}>+ Add</button>}>
      <p className="mb-1 text-xxs text-dim">Fed into every Claude task. Say things like “I hate dutch angles” in the Claude tab and they land here.</p>
      <ul className="space-y-0.5" data-testid="memory-list">{Object.values(p.memory).map((m) => <li key={m.id} className="flex items-start gap-1"><span className="chip">{m.kind}</span><span className="flex-1">{m.text}</span><button aria-label="Forget" className="text-dim" onClick={() => S().dispatch({ type: 'removeMemory', id: m.id })}>✕</button></li>)}</ul>
    </Section>
  </div>;
}

import React, { useEffect, useState } from 'react';

export function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`flex ${wide ? 'flex-col gap-0.5' : 'items-center gap-2'} py-0.5`}><span className={`lbl ${wide ? '' : 'w-20 shrink-0'}`}>{label}</span><span className="min-w-0 flex-1">{children}</span></label>;
}
/** Number input that commits on blur/Enter (one undo entry per edit) and supports arrow nudging. */
export function Num({ value, onChange, step = 0.1, min, max, label }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; label?: string }) {
  const [txt, setTxt] = useState(String(+value.toFixed(3)));
  useEffect(() => setTxt(String(+value.toFixed(3))), [value]);
  const commit = () => { let v = parseFloat(txt); if (Number.isNaN(v)) return setTxt(String(value)); if (min !== undefined) v = Math.max(min, v); if (max !== undefined) v = Math.min(max, v); if (v !== value) onChange(v); else setTxt(String(+value.toFixed(3))); };
  return <input aria-label={label} className="inp tabular-nums" type="number" step={step} value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); e.stopPropagation(); }} />;
}
export function Text({ value, onChange, area, placeholder, label }: { value: string; onChange: (v: string) => void; area?: boolean; placeholder?: string; label?: string }) {
  const [txt, setTxt] = useState(value); useEffect(() => setTxt(value), [value]);
  const p = { 'aria-label': label, className: 'inp', value: txt, placeholder, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setTxt(e.target.value), onBlur: () => txt !== value && onChange(txt), onKeyDown: (e: React.KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Enter' && !area) (e.target as HTMLElement).blur(); } };
  return area ? <textarea rows={3} {...p} /> : <input {...p} />;
}
export function Sel<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (T | [T, string])[]; onChange: (v: T) => void; label?: string }) {
  return <select aria-label={label} className="inp" value={value} onChange={(e) => onChange(e.target.value as T)}>{options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{l}</option>; })}</select>;
}
export function Vec({ value, onChange, step = 0.1 }: { value: readonly number[]; onChange: (v: [number, number, number]) => void; step?: number }) {
  return <div className="flex gap-1">{[0, 1, 2].map((i) => <Num key={i} label={'xyz'[i]} step={step} value={value[i]} onChange={(v) => { const n = [...value] as [number, number, number]; n[i] = v; onChange(n); }} />)}</div>;
}
export const Section = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <section className="border-b border-line px-2 py-2"><div className="mb-1 flex items-center justify-between"><h3 className="text-xs font-semibold text-fg">{title}</h3>{right}</div>{children}</section>
);
export const Toggle = ({ on, onChange, children, title }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode; title?: string }) => (
  <button type="button" title={title} aria-pressed={on} className={`btn ${on ? 'border-accent text-accent' : 'text-dim'}`} onClick={() => onChange(!on)}>{children}</button>
);
export const fmtTime = (t: number, fps: number) => { const f = Math.round(t * fps), s = Math.floor(f / fps); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(f % fps).padStart(2, '0')}`; };
export function download(name: string, data: BlobPart | Blob | Uint8Array, type = 'application/octet-stream') { const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data as BlobPart], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); }

// Small shared UI atoms.
import { ReactNode, useEffect, useRef, useState } from "react";
import { useStore } from "../store";

export function Panel({ title, hint, actions, children, className = "", tight = false }: { title?: ReactNode; hint?: ReactNode; actions?: ReactNode;
  children?: ReactNode; className?: string; tight?: boolean }) {
  return (
    <section className={`panel ${tight ? "tight" : ""} ${className}`}>
      {(title || actions) && (
        <div className="panel-title"><h3>{title}</h3>{hint && <span className="hint">{hint}</span>}{actions}</div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, help, children, className = "" }: { label: ReactNode; help?: ReactNode; children: ReactNode; className?: string }) {
  return <div className={`field ${className}`}><label>{label}</label>{children}{help && <span className="help">{help}</span>}</div>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, ReactNode][] }) {
  return <div className="tabs" role="tablist">{items.map(([k, l]) => (
    <button key={k} role="tab" aria-selected={k === value} className={`tab ${k === value ? "active" : ""}`} onClick={() => onChange(k)}>{l}</button>))}</div>;
}

export function Check({ checked, onChange, label, help, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; help?: ReactNode; disabled?: boolean }) {
  return <label className="check"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span>{label}{help && <small>{help}</small>}</span></label>;
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <div className="row" style={{ marginBottom: 12 }}><h2 className="grow">{title}</h2><button className="btn sm ghost" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export function Meter({ value, kind = "", title }: { value: number; kind?: string; title?: string }) {
  return <div className={`meter ${kind}`} title={title}><i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div>;
}

export function Num({ value, onChange, min, max, step = 1, style }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; style?: React.CSSProperties }) {
  return <input type="number" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step} style={style}
    onChange={(e) => { const v = parseFloat(e.target.value); onChange(Number.isFinite(v) ? v : 0); }} />;
}

export function Select<T extends string>({ value, onChange, options, style }: { value: T; onChange: (v: T) => void; options: ([T, string] | { group: string; items: [T, string][] })[]; style?: React.CSSProperties }) {
  return <select value={value} style={style} onChange={(e) => onChange(e.target.value as T)}>
    {options.map((o, i) => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option>
      : <optgroup key={i} label={o.group}>{o.items.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>)}
  </select>;
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts); const dismiss = useStore((s) => s.dismiss);
  return <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>{t.text}</div>)}</div>;
}

export type MenuItem = { label: string; onClick: () => void } | "sep";
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.min(x, innerWidth - r.width - 8), y: Math.min(y, innerHeight - r.height - 8) });
    const close = () => onClose();
    addEventListener("mousedown", close); addEventListener("scroll", close, true);
    return () => { removeEventListener("mousedown", close); removeEventListener("scroll", close, true); };
  }, [x, y, onClose]);
  return <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
    {items.map((it, i) => it === "sep" ? <hr key={i} /> : <button key={i} onClick={() => { it.onClick(); onClose(); }}>{it.label}</button>)}</div>;
}

/** Engine picker shared by every view: registered engine + optional saved profile + inline option overrides. */
export function EnginePicker({ value, onChange, label = "Engine", allowNone = false }: { value: any | null; onChange: (v: any | null) => void; label?: string; allowNone?: boolean }) {
  const engines = useStore((s) => s.engines); const profiles = useStore((s) => s.profiles);
  const eid = value?.engine_id || "";
  const mine = profiles.filter((p) => p.engine_id === eid);
  const eng = engines.find((e) => e.id === eid);
  const skill = eng && Object.keys(eng.options || {}).find((k) => k.toLowerCase() === "skill level");
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row nowrap">
        <select value={eid} onChange={(e) => onChange(e.target.value ? { engine_id: e.target.value, options: {}, profile_id: null } : null)}>
          {(allowNone || !eid) && <option value="">{allowNone ? "— none —" : "Choose an engine…"}</option>}
          {engines.map((e) => <option key={e.id} value={e.id}>{e.name}{e.status !== "ok" ? " (unavailable)" : ""}</option>)}
        </select>
        {eid && mine.length > 0 && (
          <select value={value?.profile_id || ""} onChange={(e) => onChange({ ...value, profile_id: e.target.value || null })} style={{ maxWidth: 170 }} title="Saved profile">
            <option value="">no profile</option>{mine.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>)}
        {skill && (
          <input type="number" title="Skill Level override" placeholder="skill" style={{ width: 70 }} min={eng.options[skill].min ?? 0} max={eng.options[skill].max ?? 20}
            value={value?.options?.[skill] ?? ""} onChange={(e) => { const o = { ...(value?.options || {}) }; if (e.target.value === "") delete o[skill]; else o[skill] = parseInt(e.target.value, 10); onChange({ ...value, options: o }); }} />)}
      </div>
    </div>
  );
}

export function BudgetEditor({ value, onChange, label }: { value: any; onChange: (v: any) => void; label: string }) {
  const set = (k: string, v: number) => onChange({ ...value, [k]: v });
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row nowrap" title="Bounded adaptive search: the engine may stop early when stable, and never exceeds the maxima.">
        <Num value={value.min_time} min={0} step={0.05} onChange={(v) => set("min_time", v)} /> <span className="muted nowrap">–</span>
        <Num value={value.max_time} min={0.01} step={0.1} onChange={(v) => set("max_time", v)} /> <span className="muted nowrap">s · depth</span>
        <Num value={value.min_depth} min={1} onChange={(v) => set("min_depth", v)} /> <span className="muted">–</span>
        <Num value={value.max_depth} min={1} onChange={(v) => set("max_depth", v)} />
      </div>
    </div>
  );
}

export const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;

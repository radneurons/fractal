import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SkillEstimate, SkillState } from '@/core/types';
import { STATE_ICON, STATE_LABEL } from '@/core/engines/competency';

// ───────── Icons (hand-drawn line set, 24px grid)
const P: Record<string, ReactNode> = {
  home: <path d="M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10" />,
  universe: <><circle cx="12" cy="12" r="2.2" /><circle cx="5" cy="6" r="1.4" /><circle cx="19" cy="7" r="1.4" /><circle cx="17" cy="18" r="1.4" /><circle cx="6" cy="17" r="1.4" /><path d="M6.2 6.8 10.3 10.6M17.8 7.8l-4 3M16 16.8l-2.6-3.3M7.2 16.2l3.2-2.8" /></>,
  academy: <><path d="M2.5 9 12 4.5 21.5 9 12 13.5Z" /><path d="M6 11v5c2 1.8 10 1.8 12 0v-5M21.5 9v5" /></>,
  planner: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4M7.5 14h3M7.5 17h6" /></>,
  lab: <path d="M9 3v6L4 18a2 2 0 0 0 1.8 3h12.4A2 2 0 0 0 20 18l-5-9V3M8 3h8M6.5 15h11" />,
  studio: <><rect x="3" y="3.5" width="6" height="5" rx="1.2" /><rect x="15" y="3.5" width="6" height="5" rx="1.2" /><rect x="9" y="15.5" width="6" height="5" rx="1.2" /><path d="M6 8.5v3h12v-3M12 11.5v4" /></>,
  arena: <path d="M12 3 4 6v5c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6Zm-3 9 2 2 4-4" />,
  brain: <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3 2 2 0 0 0 3-1.7V5.7A2 2 0 0 0 9 4Zm6 0a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3 2 2 0 0 1-3-1.7" />,
  interview: <><path d="M4 5h16v10H9l-5 4Z" /><path d="M8 9h8M8 12h5" /></>,
  projects: <><path d="M3.5 7.5h17v12h-17Z" /><path d="M8.5 7.5V5h7v2.5M3.5 12.5h17" /></>,
  observatory: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  vault: <><rect x="3.5" y="4" width="17" height="16" rx="2" /><circle cx="12" cy="12" r="3.5" /><path d="M12 8.5V7M15.5 12H17M12 15.5V17M8.5 12H7" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  guide: <><path d="M12 3a7 7 0 0 0-4 12.7V19h8v-3.3A7 7 0 0 0 12 3Z" /><path d="M9.5 21.5h5" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  play: <path d="M7 4.5v15l12-7.5Z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M7 7l10 10M17 7 7 17" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  focus: <><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" /><circle cx="12" cy="12" r="2.5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  bolt: <path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12Z" />,
  flame: <path d="M12 21c4 0 6.5-2.7 6.5-6.3 0-3.7-3-6-4-9.2-2 1.5-3 3.5-3 5.5-1.2-.8-2-2-2.2-3.3C6.6 9.3 5.5 11.8 5.5 14.7 5.5 18.3 8 21 12 21Z" />,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />,
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />,
  upload: <path d="M12 20V9M7 13.5l5-5 5 5M5 4h14" />,
  pin: <path d="M14.5 3.5 20.5 9.5 17 11l-3.5 3.5.5 4-2 2-4-4-4.5 4.5M7.5 12.5l4 4M13 4.5l-1.5 3.5L8 11.5" />,
  hint: <><path d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3Z" /><path d="M9.5 20.5h5" /></>,
  layers: <path d="M12 3 2.5 8 12 13l9.5-5ZM2.5 12.5 12 17.5l9.5-5M2.5 16.5 12 21.5l9.5-5" />,
  cube: <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7ZM3.5 7 12 11.5 20.5 7M12 11.5v10" />,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  shield: <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6Z" />,
  terminal: <><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="m7 9.5 3 2.5-3 2.5M12.5 15H17" /></>,
  code: <path d="m9 7-5 5 5 5M15 7l5 5-5 5" />,
  chat: <path d="M4 5h16v11H10l-4.5 3.5V16H4Z" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
};
export function Icon({ name, size, title }: { name: keyof typeof P | string; size?: number; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {P[name] ?? P.star}
    </svg>
  );
}

export function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <path d="M16 2.5 28 9.5v13L16 29.5 4 22.5v-13Z" fill="none" stroke="url(#bm)" strokeWidth="2" />
      <path d="M16 9v14M10 12.5l6 3.5 6-3.5" fill="none" stroke="url(#bm)" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="2.4" fill="var(--accent)" />
    </svg>
  );
}

// ───────── Truth labels — every output declares how it was produced.
export type Truth = 'executed' | 'simulated' | 'demo' | 'live' | 'heuristic';
const TRUTH_TEXT: Record<Truth, [string, string]> = {
  executed: ['Executed', 'Really ran in this browser (sandboxed).'],
  simulated: ['Simulated', 'Deterministic simulation with authored rules — not a live AI model.'],
  demo: ['Demonstration', 'Pre-authored example output, shown for teaching. Not generated live.'],
  live: ['Live model', 'Real response from the AI provider you configured.'],
  heuristic: ['Heuristic grade', 'Keyword-based rubric check. It can miss good answers phrased differently.'],
};
export function TruthLabel({ kind, detail }: { kind: Truth; detail?: string }) {
  const [label, tip] = TRUTH_TEXT[kind];
  return (
    <span className={`truth ${kind}`} title={detail ?? tip}>
      ● {label}
      <span className="sr-only">: {detail ?? tip}</span>
    </span>
  );
}

export function StateChip({ state, compact }: { state: SkillState; compact?: boolean }) {
  return (
    <span className={`state st-${state}`} title={STATE_LABEL[state]}>
      <span className="ico" aria-hidden="true">{STATE_ICON[state]}</span>
      {compact ? <span className="sr-only">{STATE_LABEL[state]}</span> : STATE_LABEL[state]}
    </span>
  );
}

export function MasteryBar({ e }: { e: SkillEstimate }) {
  if (!e.sufficient) return <span className="tiny faint">Not enough evidence yet</span>;
  return (
    <div title={`Estimate ${(e.mastery * 100).toFixed(0)}% · 90% interval ${(e.ci[0] * 100).toFixed(0)}–${(e.ci[1] * 100).toFixed(0)}% · ${e.confidenceLabel} confidence`}>
      <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(e.mastery * 100)} aria-label="Estimated mastery">
        <div className="ci" style={{ left: `${e.ci[0] * 100}%`, width: `${(e.ci[1] - e.ci[0]) * 100}%` }} />
        <span style={{ width: `${e.mastery * 100}%`, background: e.mastery < 0.5 ? 'var(--danger)' : e.mastery < 0.8 ? 'var(--accent)' : 'var(--accent-2)' }} />
      </div>
      <div className="row between tiny faint" style={{ marginTop: 4 }}>
        <span>{(e.mastery * 100).toFixed(0)}% est.</span>
        <span>{e.confidenceLabel} confidence</span>
      </div>
    </div>
  );
}

export function Ring({ value, label }: { value: number; label?: string }) {
  return (
    <div className="ring" style={{ ['--p' as string]: Math.round(value * 100) }} role="img" aria-label={label ?? `${Math.round(value * 100)}%`}>
      <span>{Math.round(value * 100)}%</span>
    </div>
  );
}

// ───────── Safe mini-markdown (no HTML injection): paragraphs, **bold**, `code`, lists, ``` blocks, line breaks.
function inline(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={`${key}-${i++}`}>{t.slice(1, -1)}</code>);
    else {
      const label = t.slice(1, t.indexOf(']'));
      out.push(<a key={`${key}-${i++}`} href={m[2]} target="_blank" rel="noreferrer noopener">{label}</a>);
    }
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
export function Markdown({ text, className = 'md' }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++}><code>{buf.join('\n')}</code></pre>);
      continue;
    }
    if (/^\s*[-•]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-•]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) items.push(lines[i++].replace(/^\s*([-•]|\d+\.)\s+/, ''));
      const L = ordered ? 'ol' : 'ul';
      blocks.push(<L key={k++}>{items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</L>);
      continue;
    }
    if (/^#{1,4}\s/.test(line)) {
      blocks.push(<h4 key={k++}>{inline(line.replace(/^#+\s/, ''), `h${k}`)}</h4>);
      i++;
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('```') && !/^\s*[-•]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++}>{para.flatMap((p, j) => (j ? [<br key={`br${j}`} />, ...inline(p, `${k}-${j}`)] : inline(p, `${k}-${j}`)))}</p>);
  }
  return <div className={className}>{blocks}</div>;
}

// ───────── Modal with focus trap & Escape
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => el?.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])') ?? [];
    setTimeout(() => (focusables()[0] ?? el)?.focus(), 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const f = [...focusables()];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(920px, 100%)' } : undefined} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ───────── Toasts + polite live region for grading announcements
interface ToastCtx {
  toast: (msg: string) => void;
  announce: (msg: string) => void;
}
const Ctx = createContext<ToastCtx>({ toast: () => {}, announce: () => {} });
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const [live, setLive] = useState('');
  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg }]);
    setLive(msg);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3200);
  }, []);
  const announce = useCallback((msg: string) => setLive(msg), []);
  return (
    <Ctx.Provider value={{ toast, announce }}>
      {children}
      <div className="toast-wrap">{items.map((t) => <div key={t.id} className="toast">{t.msg}</div>)}</div>
      <div className="sr-only" role="status" aria-live="polite">{live}</div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Seg<T extends string | number>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.id)} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="row between" style={{ alignItems: 'flex-end', marginBottom: 22, gap: 16 }}>
      <div style={{ minWidth: 0, flex: '1 1 420px' }}>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 style={{ marginBottom: children ? 6 : 0 }}>{title}</h1>
        {children && <div className="muted" style={{ maxWidth: '75ch' }}>{children}</div>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

export const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const fmtRel = (t: number) => {
  const d = (t - Date.now()) / 86_400_000;
  if (Math.abs(d) < 1) return d >= 0 ? 'today' : 'today';
  const n = Math.round(Math.abs(d));
  return d > 0 ? `in ${n} day${n > 1 ? 's' : ''}` : `${n} day${n > 1 ? 's' : ''} ago`;
};

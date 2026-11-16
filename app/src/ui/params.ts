// Auto-generated parameter panels from ParamSpec[] (SPEC §11): grouped; range sliders show their value,
// reset on double-click, take arrow keys (Shift ×10) and carry ARIA labels; right-click → MIDI learn.
import type { ParamSpec, Params, ParamValue } from '../types.ts';
import { h } from './dom.ts';

export interface ParamPanelOpts {
  specs: ParamSpec[];
  values: () => Params;
  onChange: (key: string, value: ParamValue, done: boolean) => void;
  /** live modulated value for the little ring on a slider (or null) */
  liveValue?: (key: string) => number | null;
  onLearn?: (key: string) => void;
  onAutomate?: (key: string) => void;
  resetLabel?: string;
}

export function fmtValue(spec: ParamSpec, v: number): string {
  const step = spec.step ?? 0.01;
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return v.toFixed(d);
}

export function paramPanel(o: ParamPanelOpts): { el: HTMLElement; refresh(): void; tick(): void } {
  const root = h('div', { class: 'params' });
  const setters: (() => void)[] = [];
  const rings: { key: string; el: HTMLElement; spec: ParamSpec }[] = [];
  const groups = new Map<string, ParamSpec[]>();
  for (const s of o.specs) { if (!groups.has(s.group)) groups.set(s.group, []); groups.get(s.group)!.push(s); }
  for (const [name, specs] of groups) {
    const box = h('fieldset', { class: 'group' }, h('legend', {}, name));
    for (const spec of specs) {
      const id = `p_${spec.key}_${Math.random().toString(36).slice(2, 7)}`;
      const cur = () => o.values()[spec.key] ?? spec.default;
      let input: HTMLElement;
      if (spec.type === 'range') {
        const out = h('output', { class: 'val', for: id });
        const ring = h('span', { class: 'modring', title: 'modulated value' });
        const inp = h('input', {
          id, type: 'range', min: spec.min ?? 0, max: spec.max ?? 1, step: spec.step ?? 0.01, 'aria-label': spec.label,
          onInput: () => { o.onChange(spec.key, Number(inp.value), false); upd(); },
          onChange: () => o.onChange(spec.key, Number(inp.value), true),
          onDblclick: () => { inp.value = String(spec.default); o.onChange(spec.key, Number(spec.default), true); upd(); },
          onKeydown: (e: KeyboardEvent) => {
            if (!e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
            e.preventDefault();
            const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1;
            const v = Math.max(spec.min ?? 0, Math.min(spec.max ?? 1, Number(inp.value) + dir * 10 * (spec.step ?? 0.01)));
            inp.value = String(v); o.onChange(spec.key, v, true); upd();
          },
          onContextmenu: (e: MouseEvent) => {
            if (!o.onLearn && !o.onAutomate) return;
            e.preventDefault();
            const menu = h('div', { class: 'menu', style: { left: `${e.clientX}px`, top: `${e.clientY}px` } },
              o.onLearn && h('button', { onClick: () => { o.onLearn!(spec.key); menu.remove(); } }, 'MIDI learn'),
              o.onAutomate && h('button', { onClick: () => { o.onAutomate!(spec.key); menu.remove(); } }, 'Automate on timeline'),
              h('button', { onClick: () => { inp.value = String(spec.default); o.onChange(spec.key, Number(spec.default), true); upd(); menu.remove(); } }, 'Reset'));
            document.body.appendChild(menu);
            setTimeout(() => document.addEventListener('pointerdown', (ev) => { if (!menu.contains(ev.target as Node)) menu.remove(); }, { once: true }), 0);
          },
        });
        const upd = () => { const v = Number(cur()); inp.value = String(v); out.textContent = fmtValue(spec, v); inp.setAttribute('aria-valuetext', fmtValue(spec, v)); };
        setters.push(upd);
        rings.push({ key: spec.key, el: ring, spec });
        input = h('div', { class: 'slider' }, inp, ring, out);
      } else if (spec.type === 'toggle') {
        const inp = h('input', { id, type: 'checkbox', onChange: () => o.onChange(spec.key, inp.checked, true) });
        setters.push(() => { inp.checked = !!cur(); });
        input = h('label', { class: 'switch' }, inp, h('span', {}));
      } else if (spec.type === 'select') {
        const inp = h('select', { id, onChange: () => o.onChange(spec.key, inp.value, true) }, ...(spec.options ?? []).map((op) => h('option', { value: op }, op)));
        setters.push(() => { inp.value = String(cur()); });
        input = inp;
      } else if (spec.type === 'color') {
        const inp = h('input', { id, type: 'color', onInput: () => o.onChange(spec.key, inp.value, false), onChange: () => o.onChange(spec.key, inp.value, true) });
        setters.push(() => { inp.value = String(cur()); });
        input = inp;
      } else {
        const inp = h('input', { id, type: 'text', onChange: () => o.onChange(spec.key, inp.value, true) });
        setters.push(() => { inp.value = String(cur() ?? ''); });
        input = inp;
      }
      box.appendChild(h('div', { class: `param ${spec.type}`, title: spec.help || (spec.live ? '' : 'Re-prepares the effect') }, h('label', { for: id }, spec.label, !spec.live && h('span', { class: 'nonlive', title: 're-prepares' }, ' ⟳')), input));
    }
    root.appendChild(box);
  }
  const refresh = () => setters.forEach((f) => f());
  refresh();
  /** move the modulation rings (called every frame while a panel is visible) */
  const tick = () => {
    if (!o.liveValue) return;
    for (const r of rings) {
      const v = o.liveValue(r.key);
      if (v === null) { r.el.style.display = 'none'; continue; }
      const lo = r.spec.min ?? 0, hi = r.spec.max ?? 1;
      r.el.style.display = 'block';
      r.el.style.left = `calc(${(100 * (v - lo)) / (hi - lo || 1)}% * 0.72)`;
    }
  };
  return { el: root, refresh, tick };
}

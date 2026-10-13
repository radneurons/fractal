// Auto-generated controls from ParamSpec[].
import type { ParamSpec, Params } from '../types';

export function fmtVal(s: ParamSpec, v: number | boolean | string): string {
  if (typeof v !== 'number') return String(v);
  const st = s.step ?? 1; const d = st >= 1 ? 0 : st >= 0.1 ? 1 : 2;
  return v.toFixed(d);
}

/** Render controls for `specs` into `root`, grouped by `group`. onChange(key, value, live). */
export function buildParams(root: HTMLElement, specs: ParamSpec[], values: Params, onChange: (key: string, v: number | boolean | string, live: boolean) => void) {
  root.innerHTML = '';
  let group = '';
  for (const s of specs) {
    if (s.group !== group) { group = s.group; const h = document.createElement('h4'); h.textContent = group; root.appendChild(h); }
    const v = values[s.key] ?? s.default;
    const wrap = document.createElement('div'); wrap.className = 'param ' + s.type; wrap.title = s.help; wrap.dataset.key = s.key;
    if (s.type === 'range') {
      wrap.innerHTML = `<div class="lbl"><span></span><b></b></div><input type="range">`;
      (wrap.querySelector('.lbl span') as HTMLElement).textContent = s.label;
      const out = wrap.querySelector('b')!; const inp = wrap.querySelector('input')!;
      inp.min = String(s.min ?? 0); inp.max = String(s.max ?? 1); inp.step = String(s.step ?? 0.01); inp.value = String(v);
      out.textContent = fmtVal(s, Number(v));
      inp.addEventListener('input', () => { out.textContent = fmtVal(s, Number(inp.value)); onChange(s.key, Number(inp.value), s.live); });
      inp.addEventListener('dblclick', () => { inp.value = String(s.default); out.textContent = fmtVal(s, Number(s.default)); onChange(s.key, Number(s.default), s.live); });
    } else if (s.type === 'toggle') {
      const lab = document.createElement('label'); lab.textContent = s.label;
      const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = Boolean(v);
      inp.addEventListener('change', () => onChange(s.key, inp.checked, s.live));
      wrap.append(lab, inp); lab.onclick = () => inp.click();
    } else if (s.type === 'select') {
      const lab = document.createElement('span'); lab.textContent = s.label; lab.style.color = 'var(--dim)';
      const sel = document.createElement('select');
      for (const o of s.options ?? []) { const op = document.createElement('option'); op.value = o; op.textContent = o; sel.appendChild(op); }
      sel.value = String(v);
      sel.addEventListener('change', () => onChange(s.key, sel.value, s.live));
      wrap.append(lab, sel);
    } else if (s.type === 'text') {
      const lab = document.createElement('span'); lab.textContent = s.label; lab.style.color = 'var(--dim)';
      const inp = document.createElement('input'); inp.type = 'text'; inp.value = String(v); inp.style.width = '170px';
      inp.addEventListener('input', () => onChange(s.key, inp.value, s.live));
      wrap.append(lab, inp); wrap.classList.add('select');
    } else if (s.type === 'color') {
      const lab = document.createElement('span'); lab.textContent = s.label; lab.style.color = 'var(--dim)';
      const inp = document.createElement('input'); inp.type = 'color'; inp.value = String(v);
      inp.addEventListener('input', () => onChange(s.key, inp.value, s.live));
      wrap.append(lab, inp); wrap.classList.add('select');
    }
    root.appendChild(wrap);
  }
}

/** Global settings expressed as ParamSpecs so they share the same UI. */
export const GLOBAL_SPECS: ParamSpec[] = [
  { key: 'aspect', label: 'Aspect', group: 'Frame', type: 'select', options: ['16:9', '9:16', '1:1'], default: '16:9', help: 'Output frame shape', live: false },
  { key: 'syncOffsetMs', label: 'Sync offset (ms)', group: 'Timing', type: 'range', min: -500, max: 500, step: 5, default: 0, help: 'Shift every word earlier (−) or later (+)', live: false },
  { key: 'anticipationMs', label: 'Anticipation (ms)', group: 'Timing', type: 'range', min: 0, max: 300, step: 5, default: 90, help: 'Entrances start this much before the word so it lands on the sound', live: true },
  { key: 'minReadMs', label: 'Minimum read time (ms)', group: 'Timing', type: 'range', min: 200, max: 1500, step: 10, default: 600, help: 'Shortest time a word stays readable', live: false },
  { key: 'intensity', label: 'Master intensity', group: 'Master', type: 'range', min: 0, max: 150, step: 1, default: 100, help: 'Scales every effect’s energy (%)', live: true },
  { key: 'cameraEnergy', label: 'Master camera energy', group: 'Master', type: 'range', min: 0, max: 150, step: 1, default: 100, help: 'Scales camera motion (%)', live: false },
  { key: 'reactivity', label: 'Master beat reactivity', group: 'Master', type: 'range', min: 0, max: 150, step: 1, default: 100, help: 'Scales how hard visuals hit on the beat (%)', live: true },
  { key: 'caseMode', label: 'Letter case', group: 'Type', type: 'select', options: ['upper', 'as-is', 'lower'], default: 'upper', help: 'Case of displayed lyrics (effects may override per role)', live: false },
  { key: 'seed', label: 'Random seed', group: 'Type', type: 'range', min: 1, max: 9999, step: 1, default: 1776, help: 'Changes layout and decoration choices', live: false },
  { key: 'endCard', label: 'Title card', group: 'Titles', type: 'toggle', default: true, help: 'Show title/artist before the first word', live: true },
  { key: 'title', label: 'Title', group: 'Titles', type: 'text', default: '', help: 'Song title', live: true },
  { key: 'artist', label: 'Artist', group: 'Titles', type: 'text', default: '', help: 'Artist name', live: true }
];

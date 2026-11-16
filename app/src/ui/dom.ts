// Tiny DOM helpers (no framework).
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export function clear(el: Element): void { while (el.firstChild) el.removeChild(el.firstChild); }
export const fmtTime = (t: number, cs = true) => { const m = Math.floor(t / 60), s = t - m * 60; return cs ? `${m}:${s.toFixed(2).padStart(5, '0')}` : `${m}:${String(Math.floor(s)).padStart(2, '0')}`; };

export function toast(msg: string, kind: 'info' | 'error' | 'ok' = 'info', ms = 4200): void {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(host); }
  const t = h('div', { class: `toast ${kind}` }, msg);
  host.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

/** Modal dialog; resolves when closed. Esc closes. Focus is trapped inside. */
export function dialog(title: string, body: HTMLElement, opts: { wide?: boolean; onClose?: () => void } = {}): { close(): void; el: HTMLElement } {
  const prev = document.activeElement as HTMLElement | null;
  const box = h('div', { class: `dialog${opts.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'dialog-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: () => close() }, '✕')), body);
  const back = h('div', { class: 'backdrop', onMouseDown: (e: MouseEvent) => { if (e.target === back) close(); } }, box);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const f = Array.from(box.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((x) => !x.hasAttribute('disabled'));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  function close(): void { back.remove(); document.removeEventListener('keydown', onKey, true); opts.onClose?.(); prev?.focus(); }
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(back);
  (box.querySelector('textarea, input, select, button:not(.icon-btn)') as HTMLElement | null)?.focus();
  return { close, el: box };
}

export function confirmBox(message: string, okLabel = 'OK'): Promise<boolean> {
  return new Promise((res) => {
    let answered = false;
    const d = dialog('Please confirm', h('div', { class: 'col' }, h('p', {}, message),
      h('div', { class: 'row end' }, h('button', { onClick: () => { answered = true; d.close(); res(false); } }, 'Cancel'), h('button', { class: 'primary', onClick: () => { answered = true; d.close(); res(true); } }, okLabel))),
    { onClose: () => { if (!answered) res(false); } });
  });
}

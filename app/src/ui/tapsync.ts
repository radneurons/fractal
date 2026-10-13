// Tap sync: play the song and press Space on every word.
import type { RawLine } from '../lyrics/parse';
import type { Player } from '../player';

export function tapSync(dlg: HTMLDialogElement, text: string, player: Player): Promise<RawLine[] | null> {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\[[^\]]*\]|<[^>]*>/g, '').trim()).filter(Boolean).map(l => l.split(/\s+/));
  const lineBox = dlg.querySelector('#tapLines') as HTMLInputElement | null;
  let lineMode = Boolean(lineBox?.checked);
  const flat: { li: number; wi: number }[] = [];
  const rebuildFlat = () => { flat.length = 0; lines.forEach((ws, li) => ws.forEach((_, wi) => { if (!lineMode || wi === 0) flat.push({ li, wi }); })); };
  rebuildFlat();
  if (lineBox) lineBox.onchange = () => { if (times.length) { lineBox.checked = lineMode; return; } lineMode = lineBox.checked; rebuildFlat(); show(); };
  const times: number[] = [];
  const lineEl = dlg.querySelector('#tapLine') as HTMLElement, nextEl = dlg.querySelector('#tapNext') as HTMLElement;
  const show = () => {
    const k = times.length, cur = flat[Math.min(k, flat.length - 1)];
    const li = k >= flat.length ? lines.length - 1 : cur.li;
    lineEl.innerHTML = '';
    let base = flat.findIndex(f => f.li === li);
    lines[li].forEach((w, wi) => { const s = document.createElement('span'); s.textContent = w + ' '; const idx = lineMode ? base : base + wi; if (idx < k) s.className = 'done'; else if (idx === k) s.className = 'cur'; lineEl.appendChild(s); });
    nextEl.textContent = lines[li + 1]?.join(' ') ?? (k >= flat.length ? 'All words tapped — press Esc or Done.' : '');
  };
  return new Promise(resolve => {
    const finish = (ok: boolean) => {
      removeEventListener('keydown', key, true); player.pause(); dlg.close();
      if (!ok || !times.length) return resolve(null);
      if (lineMode) {
        // one tap per line: each line runs until the next tap; words are spread by syllables later
        const outL: RawLine[] = [];
        times.forEach((t, i) => outL.push({ text: lines[flat[i].li].join(' '), start: t, end: times[i + 1] !== undefined ? times[i + 1] - .05 : t + Math.max(1.5, lines[flat[i].li].length * .45) }));
        return resolve(outL);
      }
      const out: RawLine[] = lines.map(ws => ({ text: ws.join(' ') }));
      flat.forEach((f, i) => {
        const t = times[i]; const L = out[f.li];
        if (t === undefined) return;
        (L.words ??= []).push({ text: lines[f.li][f.wi], start: t });
        if (L.start === undefined) L.start = t;
      });
      // untapped tail lines are dropped; partially-tapped lines are trimmed to the tapped words
      resolve(out.filter(L => L.words && L.words.length).map(L => ({ text: L.words!.map(w => w.text).join(' '), start: L.start, words: L.words })));
    };
    const key = (e: KeyboardEvent) => {
      if (!dlg.open) return;
      if (e.code === 'Space') { e.preventDefault(); if (!player.playing) { void player.play(0); return; } if (times.length < flat.length) times.push(player.now()); show(); }
      else if (e.code === 'Backspace') { e.preventDefault(); times.pop(); show(); }
      else if (e.code === 'Enter') { e.preventDefault(); const k = times.length; if (k < flat.length) { const li = flat[k].li, now = player.now(), last = times[k - 1] ?? now; let r = 0; while (k + r < flat.length && flat[k + r].li === li) r++; for (let j = 0; j < r; j++) times.push(last + (now - last) * (j + 1) / (r + 1)); } show(); }
      else if (e.code === 'Escape') { e.preventDefault(); finish(true); }
    };
    addEventListener('keydown', key, true);
    (dlg.querySelector('#tapStart') as HTMLButtonElement).onclick = () => { times.length = 0; show(); void player.play(0); };
    (dlg.querySelector('#tapDone') as HTMLButtonElement).onclick = () => finish(true);
    show(); dlg.showModal();
  });
}

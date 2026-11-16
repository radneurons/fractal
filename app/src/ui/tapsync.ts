// Tap sync (SPEC §5): Space starts playback, then marks "next word starts now"; Enter spreads the rest of
// the line; Backspace undoes; Esc / Done finishes. Line mode: one tap per line.
import type { App } from '../app.ts';
import type { Lyrics } from '../types.ts';
import { h, dialog } from './dom.ts';
import { syllablePeriod, snapToOnsets } from '../lyrics/build.ts';

export function tapSync(app: App, lineMode: boolean, onDone: (changed: boolean) => void): void {
  const song = app.song;
  if (!song || !song.lyrics.words.length) return;
  const ly: Lyrics = JSON.parse(JSON.stringify(song.lyrics));
  const marks: { kind: 'word' | 'line' | 'spread'; idx: number; prev: [number, number][] }[] = [];
  let wi = 0, li = 0, changed = false;
  const view = h('div', { class: 'tap-view' });
  const period = syllablePeriod(song.analysis);
  const draw = () => {
    view.innerHTML = '';
    const cur = lineMode ? li : ly.words[Math.min(wi, ly.words.length - 1)].line;
    for (let k = Math.max(0, cur - 1); k < Math.min(ly.lines.length, cur + 4); k++) {
      const line = ly.lines[k];
      view.append(h('div', { class: `tap-line${k === cur ? ' cur' : ''}` }, ...line.words.map((i) => h('span', { class: (lineMode ? k < li : i < wi) ? 'done' : (!lineMode && i === wi) ? 'next' : '' }, ly.words[i].display + ' '))));
    }
  };
  const spreadLine = (lineIdx: number, from: number, start: number, until: number) => {
    const ids = ly.lines[lineIdx].words.filter((i) => i >= from);
    const tot = ids.reduce((s, i) => s + ly.words[i].syllables, 0) || 1;
    let step = period;
    if (tot * step > until - start && until > start) step = (until - start) / tot;
    let acc = 0;
    for (const i of ids) { const w = ly.words[i]; w.start = start + acc * step; acc += w.syllables; w.end = start + acc * step; w.confidence = 0.6; }
  };
  const tap = () => {
    const t = app.player.time;
    changed = true;
    if (lineMode) {
      if (li >= ly.lines.length) return;
      const prev = ly.lines[li].words.map((i) => [ly.words[i].start, ly.words[i].end] as [number, number]);
      // the previous line runs until this tap
      if (li > 0) { const pl = ly.lines[li - 1]; const last = ly.words[pl.words[pl.words.length - 1]]; last.end = Math.min(last.end, t); }
      spreadLine(li, ly.lines[li].words[0], t, t + 30);
      ly.words[ly.lines[li].words[0]].confidence = 1;
      marks.push({ kind: 'line', idx: li, prev });
      li++;
    } else {
      if (wi >= ly.words.length) return;
      const w = ly.words[wi];
      marks.push({ kind: 'word', idx: wi, prev: [[w.start, w.end]] });
      if (wi > 0 && ly.words[wi - 1].line === w.line) ly.words[wi - 1].end = t;
      w.start = t; w.end = t + Math.max(0.2, w.syllables * period); w.confidence = 1;
      wi++;
    }
    draw();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (!app.player.playing) { void app.player.play(); return; } tap(); }
    else if (e.key === 'Enter' && !lineMode) {
      e.preventDefault(); e.stopPropagation();
      // spread the rest of the line evenly up to now
      if (wi === 0 || wi >= ly.words.length) return;
      const line = ly.words[wi - 1].line;
      const rest = ly.lines[line].words.filter((i) => i >= wi);
      if (!rest.length) return;
      const prev = rest.map((i) => [ly.words[i].start, ly.words[i].end] as [number, number]);
      const from = ly.words[wi - 1].start, now = app.player.time;
      const all = ly.lines[line].words.filter((i) => i >= wi - 1);
      const tot = all.reduce((s, i) => s + ly.words[i].syllables, 0) || 1;
      let acc = 0;
      for (const i of all) { const w = ly.words[i]; w.start = from + ((now - from) * acc) / tot; acc += w.syllables; w.end = from + ((now - from) * acc) / tot; w.confidence = i === wi - 1 ? 1 : 0.7; }
      marks.push({ kind: 'spread', idx: wi, prev });
      wi = rest[rest.length - 1] + 1; changed = true; draw();
    } else if (e.key === 'Backspace') {
      e.preventDefault(); e.stopPropagation();
      const m = marks.pop();
      if (!m) return;
      if (m.kind === 'word') { ly.words[m.idx].start = m.prev[0][0]; ly.words[m.idx].end = m.prev[0][1]; wi = m.idx; }
      else if (m.kind === 'line') { ly.lines[m.idx].words.forEach((i, k) => { ly.words[i].start = m.prev[k][0]; ly.words[i].end = m.prev[k][1]; }); li = m.idx; }
      else { const line = ly.words[m.idx].line; ly.lines[line].words.filter((i) => i >= m.idx).forEach((i, k) => { ly.words[i].start = m.prev[k][0]; ly.words[i].end = m.prev[k][1]; }); wi = m.idx; }
      const back = lineMode ? ly.words[ly.lines[Math.max(0, li - 1)].words[0]].start : ly.words[Math.max(0, wi - 1)].start;
      app.player.seek(Math.max(0, back - 1.5));
      draw();
    }
  };
  const finish = () => {
    document.removeEventListener('keydown', onKey, true);
    app.player.pause();
    if (changed) {
      if (lineMode) snapToOnsets(ly, song.analysis, 0.95);
      ly.source = 'tap';
      app.commitLyrics(ly, true);
    }
    onDone(changed);
  };
  document.addEventListener('keydown', onKey, true);
  app.player.seek(0);
  const d = dialog(lineMode ? 'Tap sync — lines' : 'Tap sync — words', h('div', { class: 'col' },
    h('p', { class: 'dim' }, lineMode ? 'Space starts playback; then tap Space as each LINE begins. Backspace undoes.' : 'Space starts playback; then tap Space as each WORD begins. Enter spreads the rest of the line up to now. Backspace undoes.'),
    view, h('div', { class: 'row end' }, h('button', { class: 'primary', onClick: () => d.close() }, 'Done'))), { onClose: finish });
  draw();
}

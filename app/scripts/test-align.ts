// Lyrics ↔ speech-recognition alignment, checked against the demo song's ground-truth word times.
import { readFileSync } from 'node:fs';
import { alignLyrics, similarity, type AsrChunk } from '../src/align/align';

let fails = 0;
const check = (name: string, ok: boolean, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails++; };
const truth = JSON.parse(readFileSync('public/demo/demo-song.json', 'utf8')) as { words: { text: string; start: number }[] };
const lrc = readFileSync('public/demo/demo-song.lrc', 'utf8');
const lyricLines = lrc.split('\n').filter(l => /^\[\d/.test(l)).map(l => l.replace(/\[[^\]]*\]|<[^>]*>/g, '').trim());
const T = truth.words.map(w => w.start), DUR = 73;
let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const errs = (lines: { words?: { start: number }[] }[]) => { const got = lines.flatMap(l => l.words!.map(w => w.start)); return got.map((g, i) => Math.abs(g - T[i])); };
const med = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];
const mono = (lines: { words?: { start: number }[] }[]) => { const g = lines.flatMap(l => l.words!.map(w => w.start)); return g.every((t, i) => i === 0 || t > g[i - 1]); };

check('similarity', similarity('fire', 'fire') === 2 && similarity('thunder', 'thunda') > 1 && similarity('rain', 'storm') < 0 && similarity("don't", 'dont') === 2);

// 1. a perfect transcript
{
  const chunks: AsrChunk[] = truth.words.map((w, i) => ({ text: ' ' + w.text, start: w.start, end: T[i + 1] ?? w.start + .3 }));
  const r = alignLyrics(lyricLines, chunks, DUR);
  const e = errs(r.lines);
  check('perfect transcript', r.matched === r.total && Math.max(...e) < 1e-6, `${r.matched}/${r.total} matched, max error ${(Math.max(...e) * 1000).toFixed(1)} ms`);
}
// 2. a realistic transcript: 25 % of words missed, 15 % misheard, ±60 ms jitter, hallucinations in the intro and the breakdown
{
  const chunks: AsrChunk[] = [{ text: ' Thank you for watching', start: 1.0, end: 2.5 }];
  truth.words.forEach((w, i) => {
    if (rnd() < .25) return;
    let t = w.text; if (rnd() < .15) t = t.length > 3 ? t.slice(0, -1) + 'a' : 'uh';
    const j = (rnd() - .5) * .12; chunks.push({ text: ' ' + t, start: w.start + j, end: (T[i + 1] ?? w.start + .3) + j });
  });
  chunks.push({ text: ' oh oh oh yeah', start: 44, end: 46 });
  chunks.sort((a, b) => a.start - b.start);
  const r = alignLyrics(lyricLines, chunks, DUR);
  const e = errs(r.lines);
  check('noisy transcript: median error', med(e) < .08, `${(med(e) * 1000).toFixed(0)} ms, matched ${r.matched}/${r.total}`);
  check('noisy transcript: worst word', Math.max(...e) < 1.0, `${Math.max(...e).toFixed(2)} s`);
  check('noisy transcript: words stay in order', mono(r.lines));
  check('noisy transcript: confidence marks guesses', r.confidence.filter(c => c < .5).length >= r.total - r.matched);
}
// 3. phrase-level timing only (one chunk per lyric line)
{
  const chunks: AsrChunk[] = []; let k = 0;
  lyricLines.forEach(l => { const n = l.split(/\s+/).length; chunks.push({ text: ' ' + l, start: T[k], end: T[k + n - 1] + .4 }); k += n; });
  const r = alignLyrics(lyricLines, chunks, DUR);
  const e = errs(r.lines);
  check('phrase-level timing', med(e) < .25 && mono(r.lines), `median ${(med(e) * 1000).toFixed(0)} ms, max ${Math.max(...e).toFixed(2)} s`);
}
// 4. nothing recognised
{
  const r = alignLyrics(lyricLines, [], DUR);
  const g = r.lines.flatMap(l => l.words!.map(w => w.start));
  check('empty transcript still gives ordered times inside the song', mono(r.lines) && g[0] >= 0 && g[g.length - 1] < DUR, `${g[0].toFixed(2)}…${g[g.length - 1].toFixed(2)}`);
}
// 5. a missed line inside an instrumental gap does not stretch across the gap
{
  const chunks: AsrChunk[] = truth.words.map((w, i) => ({ text: ' ' + w.text, start: w.start, end: T[i + 1] ?? w.start + .3 })).filter(c => !(c.start >= 41 && c.start < 43));   // drop the breakdown line
  const secs = (JSON.parse(readFileSync('public/demo/demo-song.json', 'utf8')) as { sections: { start: number }[] }).sections.map(x => x.start);
  const r = alignLyrics(lyricLines, chunks, DUR, secs);
  const e = errs(r.lines);
  check('missed line in a break starts at the section', Math.max(...e) < 1.5, `max error ${Math.max(...e).toFixed(2)} s`);
}

if (fails) { console.log(`${fails} failure(s)`); process.exit(1); }
console.log('align: all passed');

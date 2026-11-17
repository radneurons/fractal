// SPEC §17 test-align: against the demo's true word times.
import { readFileSync } from 'node:fs';
import { check, done } from './lib/check.ts';
import { readWav } from './lib/node-audio.ts';
import { analyze } from '../src/analysis/index.ts';
import { parseLyrics } from '../src/lyrics/parse.ts';
import { buildLyrics, syllablePeriod } from '../src/lyrics/build.ts';
import { alignToRecognised, phrasesToWords, type RecWord } from '../src/align/align.ts';
import { findDeafSpans, mergeRetry } from '../src/align/align.ts';
import { countSyllables } from '../src/lyrics/syllables.ts';
import { mulberry32 } from '../src/analysis/dsp.ts';

const exp = JSON.parse(readFileSync('public/demo/demo-song.json', 'utf8'));
const a = analyze(readWav('public/demo/demo-song.wav'));
const lrc = readFileSync('public/demo/demo-song.lrc', 'utf8');
const plain = lrc.split('\n').filter((l) => /^\[\d/.test(l)).map((l) => l.replace(/\[[^\]]*\]|<[^>]*>/g, '').trim()).join('\n');
const truth: { text: string; start: number; end: number }[] = exp.words;
const fresh = () => buildLyrics(parseLyrics(plain), a);
const stats = (ly: ReturnType<typeof fresh>) => {
  const errs = ly.words.map((w, i) => Math.abs(w.start - truth[i].start)).sort((x, y) => x - y);
  const ordered = ly.words.every((w, i) => i === 0 || w.start >= ly.words[i - 1].start - 1e-6);
  return { median: errs[errs.length >> 1], worst: errs[errs.length - 1], ordered };
};

{ // perfect transcript
  const ly = fresh();
  const r = alignToRecognised(ly, truth.map((w) => ({ ...w })), a);
  const s = stats(ly);
  check('perfect transcript is exact', s.worst < 0.011 && r.matchRate === 1, `worst ${(s.worst * 1000).toFixed(1)} ms, match ${(r.matchRate * 100).toFixed(0)} %`);
}
{ // 25 % missed, 15 % misheard, ±60 ms jitter + hallucinations
  const rnd = mulberry32(42);
  const rec: RecWord[] = [];
  for (const w of truth) {
    const u = rnd();
    if (u < 0.25) continue;
    const j = (rnd() * 2 - 1) * 0.06;
    rec.push({ text: u < 0.4 ? w.text.split('').reverse().join('') + 'x' : w.text, start: w.start + j, end: w.end + j });
    if (rnd() < 0.06) rec.push({ text: 'music', start: w.end + 0.01, end: w.end + 0.1 });
  }
  for (const t of [2, 4.5, 42.2, 70]) rec.push({ text: 'yeah', start: t, end: t + 0.3 });
  rec.sort((x, y) => x.start - y.start);
  const ly = fresh();
  const r = alignToRecognised(ly, rec, a);
  const s = stats(ly);
  if (s.worst >= 1) ly.words.forEach((w, i) => { if (Math.abs(w.start - truth[i].start) > 0.6) console.log('    off:', w.display, w.start.toFixed(2), 'truth', truth[i].start.toFixed(2), 'conf', w.confidence, 'line', w.line); });
  check('noisy transcript: median < 80 ms, worst < 1 s, ordered', s.median < 0.08 && s.worst < 1 && s.ordered, `median ${(s.median * 1000).toFixed(0)} ms, worst ${(s.worst * 1000).toFixed(0)} ms, match ${(r.matchRate * 100).toFixed(0)} %`);
}
{ // phrase-only timing
  const phrases: { text: string; start: number; end: number }[] = [];
  const lines = plain.split('\n');
  let k = 0;
  for (const l of lines) { const n = l.split(/\s+/).length; phrases.push({ text: l, start: truth[k].start, end: truth[k + n - 1].end }); k += n; }
  const ly = fresh();
  alignToRecognised(ly, phrasesToWords(phrases, countSyllables, syllablePeriod(a)), a, { approx: true });
  const s = stats(ly);
  check('phrase-only timing: median < 250 ms', s.median < 0.25 && s.ordered, `median ${(s.median * 1000).toFixed(0)} ms`);
}
{ // empty transcript
  const ly = fresh();
  alignToRecognised(ly, [], a);
  const s = stats(ly);
  check('empty transcript: ordered, inside the song', s.ordered && ly.words[0].start >= 0 && ly.words[ly.words.length - 1].end <= a.duration + 0.01, `${ly.words[0].start.toFixed(1)} … ${ly.words[ly.words.length - 1].end.toFixed(1)}`);
}
{ // a line missed inside a break: the breakdown lines (40–48 s) are not recognised
  const rec = truth.filter((w) => !(w.start >= 40 && w.start < 48)).map((w) => ({ ...w }));
  const ly = fresh();
  alignToRecognised(ly, rec, a);
  const first = ly.words.findIndex((_, i) => truth[i].start >= 40);
  const off = Math.abs(ly.words[first].start - truth[first].start);
  check('line missed inside a break starts at the section (< 1.5 s off)', off < 1.5, `${ly.words[first].start.toFixed(2)} vs ${truth[first].start.toFixed(2)}`);
}
{
  // a recogniser that went deaf for 60 s of singing (a "[MUSIC]" hallucination) is found and re-merged
  const fps = 60, dur = 120;
  const vocal = new Float32Array(dur * fps).fill(0.9);
  const words = [{ text: 'hello', start: 5, end: 5.4 }, { text: '[MUSIC]', start: 10, end: 70 }, { text: 'again', start: 80, end: 80.5 }, { text: 'end', start: 110, end: 110.4 }];
  const spans = findDeafSpans(words, vocal, fps, dur);
  check('deaf span found where vocals are active and no word was heard', spans.length === 2 && Math.abs(spans[0][0] - 4.4) < 0.01 && Math.abs(spans[0][1] - 81) < 0.01, JSON.stringify(spans));
  const quiet = new Float32Array(dur * fps).fill(0.1);
  check('no deaf span in an instrumental stretch', findDeafSpans(words, quiet, fps, dur).length === 0);
  const merged = mergeRetry(words, [{ text: '♪', start: 20, end: 21 }, { text: 'we', start: 30, end: 30.3 }, { text: 'rise', start: 30.4, end: 30.9 }], spans[0]);
  check('retry merges in order and drops noise', merged.map((w) => w.text).join(' ') === 'we rise end', merged.map((w) => w.text).join(' '));
}
done();

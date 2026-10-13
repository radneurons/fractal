// Lyrics parsing, timing and director checks (no browser needed).
import { detectFormat, parseLRC, parseSRT, parseAny, buildLyrics, countSyllables, exportLRC, refreshLines, parsePlain } from '../src/lyrics/parse';
import { direct } from '../src/director/director';
import { conceptOf } from '../src/director/lexicon';

let fails = 0;
const check = (name: string, ok: boolean, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails++; };

// formats
check('detect lrc', detectFormat('[00:01.00] hello world') === 'lrc');
check('detect srt', detectFormat('1\n00:00:01,000 --> 00:00:02,000\nhello\n') === 'srt');
check('detect vtt', detectFormat('WEBVTT\n\n00:01.000 --> 00:02.000\nhello\n') === 'vtt');
check('detect plain', detectFormat('just some words\nand more') === 'plain');

// enhanced LRC: word tags become word times
const e = parseLRC('[ti:T]\n[00:08.00] <00:08.00>we <00:08.25>were <00:08.50>waiting\n[00:12.00] <00:12.00>counting <00:12.40>embers');
check('enhanced lrc word-level', e.wordLevel && e.lines.length === 2 && e.lines[0].words!.length === 3, JSON.stringify(e.lines[0].words));
const ly = buildLyrics(e.lines, null, 'enhanced-lrc');
check('word starts kept', Math.abs(ly.words[1].start - 8.25) < 1e-6 && Math.abs(ly.words[3].start - 12) < 1e-6);
check('no overlaps in a line', ly.words.every((w, i) => { const n = ly.words[i + 1]; return !n || n.line !== w.line || w.end <= n.start + 1e-9; }));

// plain LRC lines: words distributed by syllables inside the line span
const lr = parseAny('[00:01.00] alpha beta\n[00:05.00] gamma delta epsilon', null);
check('line-timed lrc', lr.lines.length === 2 && lr.words[0].start === 1 && lr.words[2].start === 5, lr.words.map(w => w.start.toFixed(2)).join(' '));
check('monotonic word times', lr.words.every((w, i) => i === 0 || w.start >= lr.words[i - 1].start));

// SRT
const s = parseSRT('1\n00:00:01,500 --> 00:00:03,000\nhello there\n\n2\n00:00:04,000 --> 00:00:05,000\nagain\n');
check('srt lines', s.length === 2 && Math.abs(s[0].start! - 1.5) < 1e-6 && s[1].text === 'again');

// plain text: blank lines are skipped, every line gets a time
const p = buildLyrics(parsePlain('one two\n\nthree four five\n'), null, 'plain');
check('plain skips blanks', p.lines.length === 2 && p.lines.every(L => L.words.length > 0));

// syllables
const syl: [string, number][] = [['fire', 1], ['every', 2], ['beautiful', 3], ['the', 1], ['waiting', 2], ['thunder', 2]];
for (const [w, n] of syl) check(`syllables ${w}`, countSyllables(w) === n, String(countSyllables(w)));

// concepts
check('concept burn → fire', conceptOf('burning')?.id === 'fire');
check('concept thunder → shock', conceptOf('thunder')?.id === 'shock');
check('no concept for "the"', !conceptOf('the'));

// director: concept words become heroes, stopwords connective, ≥ 1 hero per line
const d = buildLyrics(parseLRC('[00:01.00] <00:01.00>set <00:01.25>the <00:01.50>fire <00:01.75>burn <00:02.00>it <00:02.25>bright\n[00:04.00] <00:04.00>la <00:04.30>la <00:04.60>la').lines, null, 'enhanced-lrc');
direct(d, null);
const role = (t: string) => d.words.find(w => w.text === t)?.role;
check('fire is hero', role('fire') === 'hero');
check('the is connective', role('the') === 'connective');
check('every line has a hero', d.lines.every(L => L.words.some(id => d.words[id].role === 'hero')));
check('fire element', d.words.find(w => w.text === 'fire')?.element === 'fire');

// retiming keeps order and spans; LRC export round-trips
d.words[2].start += 0.1; refreshLines(d);
check('refresh line span', Math.abs(d.lines[0].start - d.words[0].start) < 1e-9 && d.lines[0].end >= d.words[5].start);
const back = parseLRC(exportLRC(d));
check('LRC round-trip', back.wordLevel && back.lines.length === d.lines.length && Math.abs(back.lines[0].words![2].start - d.words[2].start) < 0.006);

if (fails) { console.log(`${fails} failure(s)`); process.exit(1); }
console.log('lyrics: all passed');

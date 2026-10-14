// Lyrics parsing, timing and director checks (no browser needed).
import { detectFormat, parseLRC, parseSRT, parseAny, buildLyrics, countSyllables, exportLRC, refreshLines, parsePlain, tokenize, normalize } from '../src/lyrics/parse';
import type { Analysis } from '../src/types';
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


// ── regressions from review ──
const vtt = parseSRT('WEBVTT\n\n00:01.000 --> 00:04.000 align:start\nHello <b>world</b> &amp; you\n\n00:05.500 --> 00:06.000\nagain\n');
check('VTT without hours', vtt.length === 2 && Math.abs(vtt[0].start! - 1) < 1e-9 && vtt[0].text === 'Hello world & you', JSON.stringify(vtt));
const srtEmpty = parseSRT('1\n00:00:01,000 --> 00:00:02,000\n\n2\n00:00:03,000 --> 00:00:04,000\nHello there\n');
check('SRT empty cue does not swallow the next', srtEmpty.length === 1 && srtEmpty[0].text === 'Hello there' && srtEmpty[0].start === 3, JSON.stringify(srtEmpty));
const lead = parseLRC('[00:12.00]Hello <00:12.50>big <00:13.00>world');
check('enhanced LRC keeps text before the first word tag', lead.lines[0].text === 'Hello big world' && lead.lines[0].words![0].start === 12, lead.lines[0].text);
const colon = parseAny('[00:12:34]Hello world\n[100:02.00]late line', null);
check('[mm:ss:xx] stamps and 3-digit minutes', colon.lines.length === 2 && Math.abs(colon.lines[0].start - 12.34) < .02 && Math.abs(colon.lines[1].start - 6002) < .02, colon.lines.map(l => l.start.toFixed(2)).join(' '));
const endStamp = parseLRC('[00:10.00]first line\n[00:11.00]\n[00:20.00]second line');
check('empty LRC stamp ends the previous line', endStamp.lines.length === 2 && endStamp.lines[0].end === 11);
check('CJK splits per character', tokenize('我爱你，世界').join('|') === '我|爱|你，|世|界', tokenize('我爱你，世界').join('|'));
check('kana voicing kept', normalize('が') !== normalize('か'));
check('Latin accents stripped', normalize('Café') === 'cafe');
check('Cyrillic syllables', countSyllables('любовь') === 2, String(countSyllables('любовь')));
const exp = exportLRC({ words: [{ id: 0, text: 'a', display: 'a', line: 0, start: 59.996, end: 60.2, confidence: 1, syllables: 1, stress: .5, role: 'hero' }, { id: 1, text: 'b', display: 'b', line: 1, start: -0.3, end: .1, confidence: 1, syllables: 1, stress: .5, role: 'hero' }], lines: [{ idx: 0, words: [0], start: 59.996, end: 60.2, section: 0, text: 'a' }, { idx: 1, words: [1], start: -0.3, end: .1, section: 0, text: 'b' }], source: 'lrc' });
check('LRC export never writes :60.00 or negative times', !/:60\.00|-/.test(exp) && exp.includes('[01:00.00]') && exp.includes('[00:00.00]'), exp.trim().replace(/\n/g, ' | '));
const fakeA = { duration: 1.5, onsets: [], sections: [{ start: 0, end: 60, label: 'verse', energy: .5, cluster: 0 }], bpm: 0, bpmConfidence: 0, loud: new Float32Array(100), fps: 60 } as unknown as Analysis;
const back2 = buildLyrics(parsePlain('one\ntwo\nthree'), fakeA, 'plain');
check('plain spread never runs backwards', back2.lines.every((L, i) => i === 0 || L.start >= back2.lines[i - 1].start), back2.lines.map(l => l.start.toFixed(2)).join(' '));
const late = buildLyrics(parseLRC('[00:05.00]early\n[01:02.00]late').lines, { ...fakeA, duration: 70, sections: [{ start: 0, end: 30, label: 'verse', energy: .5, cluster: 0 }, { start: 30, end: 60, label: 'chorus', energy: .7, cluster: 1 }] } as unknown as Analysis, 'lrc');
check('lines past the last section stay in it', late.lines[1].section === 1, String(late.lines[1].section));
for (const w of ['start', 'search', 'season', 'single', 'seem', 'sight', 'mistake', 'fellow', 'rocket', 'hotel', 'turnip']) check(`no false concept for "${w}"`, !conceptOf(w), conceptOf(w)?.id ?? '');
const dieL = buildLyrics(parseLRC('[00:01.00] <00:01.00>i <00:01.20>don\'t <00:01.40>wanna <00:01.70>die').lines, null, 'enhanced-lrc'); direct(dieL, null);
check('"die" is not a stopword', dieL.words.find(w => w.text === 'die')?.role !== 'connective');

if (fails) { console.log(`${fails} failure(s)`); process.exit(1); }
console.log('lyrics: all passed');

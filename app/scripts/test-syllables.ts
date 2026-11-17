// SPEC §17 test-syllables: hyphenation samples, syllable tags, DP timing on the waltz, voices, backing, translation.
import { readFileSync } from 'node:fs';
import { check, done } from './lib/check.ts';
import { readWav } from './lib/node-audio.ts';
import { analyze } from '../src/analysis/index.ts';
import { splitSyllables, timeSyllables, syllableCandidates } from '../src/lyrics/syllables.ts';
import { parseLyrics, takeVoiceTag } from '../src/lyrics/parse.ts';
import { buildLyrics, attachTranslation } from '../src/lyrics/build.ts';
import { direct } from '../src/director/director.ts';

const hy: [string, string][] = [['waiting', 'wait|ing'], ['yesterday', 'yes|ter|day'], ['garden', 'gar|den'], ['remember', 're|mem|ber'], ['thunder', 'thun|der'], ['morning', 'morn|ing'], ['beautiful', 'beau|ti|ful']];
const bad = hy.filter(([w, e]) => splitSyllables(w).join('|') !== e).map(([w, e]) => `${w}: ${splitSyllables(w).join('|')} ≠ ${e}`);
check('hyphenation samples', bad.length <= 1, bad.join('; ') || 'all match');
check('pieces cover the whole word, punctuation kept', splitSyllables('Remember,').join('') === 'Remember,');
check('CJK one syllable per character', splitSyllables('世界').length === 2);
// syllable tags inside a word
const p = parseLyrics('[00:12.00]<00:12.30>yes<00:12.55>ter<00:12.80>day <00:13.40>now');
const w0 = p.lines[0].tokens[0];
check('syllable tags parsed', w0.display === 'yesterday' && w0.syl?.length === 3 && w0.syl[1].start === 12.55 && w0.syl[2].text === 'day');
// voices and backing
check('voice tags', takeVoiceTag('v2: hello').voice === 'B' && takeVoiceTag('[A+B] x').voice === 'all' && takeVoiceTag('F: la').voice === 'B' && takeVoiceTag('{Lead} x').voice === 'Lead');
const exp = JSON.parse(readFileSync('public/demo/demo-waltz.json', 'utf8'));
const a = analyze(readWav('public/demo/demo-waltz.wav'));
const ly = buildLyrics(parseLyrics(readFileSync('public/demo/demo-waltz.lrc', 'utf8')), a);
direct(ly, a);
const backing = ly.words.filter((w) => w.backing);
check('backing vocals parsed, connective, not clipped', backing.length === exp.words.filter((w: { backing: boolean }) => w.backing).length && backing.every((w) => w.role === 'connective' && w.end > w.start + 0.1));
const voices = new Set(ly.lines.map((l) => l.voice));
check('voices A, B and both', voices.has('A') && voices.has('B') && voices.has('all'));
const duetOk = ly.lines.filter((l) => l.voice === 'all').every((l) => l.words.some((i) => ly.words[i].role === 'hero'));
check('a hero in every duet line', duetOk);
// tagged syllables are exact; untagged words get DP timing within 60 ms on the waltz's re-articulated words
const tagged = exp.words.filter((w: { tagged: boolean; syllables?: unknown[] }) => w.tagged);
let maxTag = 0;
for (const tw of tagged) { const w = ly.words.find((x) => Math.abs(x.start - tw.start) < 0.02); tw.syllables.forEach((s: { start: number }, i: number) => { maxTag = Math.max(maxTag, Math.abs((w?.syllableTimes?.[i]?.start ?? 99) - s.start)); }); }
check('tagged syllables exact (≤ 10 ms)', maxTag <= 0.0101, `${(maxTag * 1000).toFixed(1)} ms`);
let maxDp = 0, n = 0;
for (const tw of tagged) {
  const syl = tw.syllables as { start: number; end: number; text: string }[];
  const r = timeSyllables(syl.map((s) => s.text), syl[0].start, syl[syl.length - 1].end, syllableCandidates(a, syl[0].start, syl[syl.length - 1].end), false);
  r.forEach((s, i) => { if (i) { maxDp = Math.max(maxDp, Math.abs(s.start - syl[i].start)); n++; } });
}
check('DP syllable boundaries within 60 ms on the waltz', n > 0 && maxDp < 0.06, `${(maxDp * 1000).toFixed(0)} ms over ${n} boundaries`);
// translation by index (plain) and by overlap (timed)
const tr = readFileSync('public/demo/demo-waltz.translation.txt', 'utf8');
const k = attachTranslation(ly, tr);
check('translation matched by index', k === ly.lines.length && ly.lines[0].translation === 'Luz de farol sobre el agua');
const timed = ly.lines.map((l, i) => `[${Math.floor(l.start / 60).toString().padStart(2, '0')}:${(l.start % 60).toFixed(2).padStart(5, '0')}]T${i}`).join('\n');
attachTranslation(ly, timed);
check('translation matched by time overlap', ly.lines.every((l, i) => l.translation === `T${i}`));
done();

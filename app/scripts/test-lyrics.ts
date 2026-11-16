// SPEC §17 test-lyrics: formats, word times, spreading, SRT, syllables, concepts, director, LRC round trip.
import { readFileSync } from 'node:fs';
import { check, done, near } from './lib/check.ts';
import { readWav } from './lib/node-audio.ts';
import { analyze } from '../src/analysis/index.ts';
import { detectFormat, parseLyrics, normaliseWord, splitWords } from '../src/lyrics/parse.ts';
import { buildLyrics, lyricsFromText, toEnhancedLrc, refreshLines, lrcStamp } from '../src/lyrics/build.ts';
import { countSyllables } from '../src/lyrics/syllables.ts';
import { conceptOf, isStopword } from '../src/director/lexicon.ts';
import { direct } from '../src/director/director.ts';
import { lyricMood, MOOD_LEXICON_SIZE } from '../src/director/moodlex.ts';

const exp = JSON.parse(readFileSync('public/demo/demo-song.json', 'utf8'));
const a = analyze(readWav('public/demo/demo-song.wav'));
const lrcText = readFileSync('public/demo/demo-song.lrc', 'utf8');

check('format detection', detectFormat(lrcText) === 'enhanced-lrc' && detectFormat('[00:01.00]hi') === 'lrc'
  && detectFormat('1\n00:00:01,000 --> 00:00:02,000\nhi') === 'srt' && detectFormat('WEBVTT\n\n00:01.000 --> 00:02.000\nhi') === 'vtt' && detectFormat('hello\nworld') === 'plain');
const ly = lyricsFromText(lrcText, a, 'demo');
check('81 words, 15 lines', ly.words.length === 81 && ly.lines.length === 15, `${ly.words.length} words, ${ly.lines.length} lines`);
let maxErr = 0;
ly.words.forEach((w, i) => { maxErr = Math.max(maxErr, Math.abs(w.start - exp.words[i].start)); });
check('enhanced-LRC word times exact (≤ 10 ms)', maxErr <= 0.0101, `max ${(maxErr * 1000).toFixed(1)} ms`);
check('metadata [ti:] / [ar:]', ly.meta?.title === 'Open the Garden Gate' && ly.meta?.artist === 'Lyric Engine Demo');
let overlaps = 0, short = 0;
for (const l of ly.lines) for (let i = 0; i + 1 < l.words.length; i++) if (ly.words[l.words[i]].end > ly.words[l.words[i + 1]].start + 1e-6) overlaps++;
for (const w of ly.words) if (w.end - w.start < 0.0599) short++;
check('no overlaps, min duration 60 ms', overlaps === 0 && short === 0, `${overlaps} overlaps, ${short} short`);
check('line sections', a.sections[ly.lines[0].section].label === 'verse' && a.sections[ly.lines[4].section].label === 'chorus' && a.sections[ly.lines[8].section].label === 'breakdown');
check('repeats marked', ly.lines[12].repeatOf === 6 && ly.lines[13].repeatOf === 7);

// stamps: [mm:ss:xx], 3-digit minutes, several stamps, empty stamp line, offset, BOM/CRLF
const p1 = parseLyrics('﻿[offset:+500]\r\n[00:10:50][00:20.500]hello world\r\n[00:12.00]\r\n[100:00.00]far away\r\n');
check('LRC stamps & repeats', p1.lines.length === 3 && near(p1.lines[0].time!, 10, 1e-6) && near(p1.lines[1].time!, 20, 1e-6) && near(p1.lines[2].time!, 5999.5, 1e-6), p1.lines.map((l) => l.time).join(', '));
check('empty stamp ends previous line', near(p1.lines[0].end ?? -1, 11.5, 1e-6), String(p1.lines[0].end));
// line-timed spreading: one syllable per eighth note at 120 BPM
const lt = buildLyrics(parseLyrics('[00:08.00]waiting for the light\n[00:16.00]again'), a);
const d01 = lt.words[1].start - lt.words[0].start;
check('tempo-aware spreading (2 syllables ≈ 2 eighths)', near(d01, 0.5, 0.09) && lt.words[3].start < 10, `Δ ${d01.toFixed(2)} s, last word at ${lt.words[3].start.toFixed(2)}`);
// SRT / VTT
const srt = buildLyrics(parseLyrics('1\n00:00:08,000 --> 00:00:10,000\n<i>Hello &amp; goodbye</i>\nmy friend\n\n2\n00:00:12,000 --> 00:00:13,000\n\n3\n00:00:14,000 --> 00:00:15,000\nAgain'), a);
check('SRT: multi-line joined, tags stripped, entities decoded, empty cue skipped', srt.lines.length === 2 && srt.lines[0].text === 'Hello & goodbye my friend', JSON.stringify(srt.lines.map((l) => l.text)));
const vtt = buildLyrics(parseLyrics('WEBVTT\n\n00:08.000 --> 00:10.000 line:90%\nHello there\n'), a);
check('VTT: hours optional, cue settings ignored', vtt.lines.length === 1 && near(vtt.lines[0].start, 8, 0.09));
// plain text
const plain = buildLyrics(parseLyrics('[Verse 1]\nwaiting for the light\n\n\n[Chorus – huge]\nopen the gate (ooh)\n'), a);
check('plain: headers are hints, blank lines ignored', plain.lines.length === 2 && plain.lines[0].hint === 'verse' && plain.lines[1].hint === 'chorus');
check('plain: parentheses are backing vocals', plain.words[plain.words.length - 1].backing === true && plain.words[0].backing !== true);
check('plain: ordered inside the song', plain.words.every((w, i) => i === 0 || plain.words[i - 1].backing || w.backing || w.start >= plain.words[i - 1].start) && plain.words[0].start >= 0 && plain.words[plain.words.length - 1].end <= a.duration + 0.5);
// tokens
check('CJK splits per character, punctuation attached', splitWords('我爱你。 世界').join('|') === '我|爱|你。|世|界', splitWords('我爱你。 世界').join('|'));
check('normalisation strips Latin accents only', normaliseWord('Café!') === 'cafe' && normaliseWord('が') === 'が' && normaliseWord('की') === 'की');
const syl: [string, number][] = [['waiting', 2], ['light', 1], ['ember', 2], ['river', 2], ['morning', 2], ['broke', 1], ['garden', 2], ['fire', 1], ['thunder', 2], ['again', 2], ['whisper', 2], ['yesterday', 3], ['beautiful', 3], ['every', 2], ['gate', 1], ['little', 2], ['wanted', 2], ['loved', 1]];
const bad = syl.filter(([w, n]) => countSyllables(w) !== n).map(([w, n]) => `${w}:${countSyllables(w)}≠${n}`);
check('syllable counts', bad.length === 0, bad.join(' '));
check('syllables: Cyrillic vowels, CJK per character', countSyllables('молоко') === 3 && countSyllables('世界') === 2);
// concepts
const cm: [string, string | undefined][] = [['burning', 'fire'], ['star', 'star'], ['start', undefined], ['hotel', undefined], ['hot', 'fire'], ['dancing', 'vortex'], ['cries', undefined], ['stopped', undefined], ['spinning', 'vortex'], ['rivers', 'water'], ['thunder', 'shock'], ['whisper', 'wind'], ['gate', 'quake'], ['morning', 'light'], ['smoke', 'smoke'], ['seed', 'flower']];
const cbad = cm.filter(([w, c]) => conceptOf(w)?.id !== c).map(([w, c]) => `${w}:${conceptOf(w)?.id}≠${c}`);
check('concept matching (real inflections only)', cbad.length === 0, cbad.join(' '));
check('foreign stopwords that are English words stay content', !isStopword('die') && !isStopword('son') && isStopword('the') && isStopword('que'));
// director
direct(ly, a);
const heroes = ly.lines.map((l) => l.words.filter((i) => ly.words[i].role === 'hero').length);
check('a hero in every line, at most 2', heroes.every((h) => h >= 1 && h <= 2), heroes.join(' '));
check('stopwords are connective', ly.words.filter((w) => isStopword(w.text)).every((w) => w.role === 'connective'));
const conceptWords = ly.words.filter((w) => w.concept);
const lineHeroOk = ly.lines.every((l) => { const cs = l.words.map((i) => ly.words[i]).filter((w) => w.concept); return cs.length === 0 || cs.some((w) => w.role === 'hero'); });
check('concept words are heroes', lineHeroOk && conceptWords.length >= 20, `${conceptWords.length} concept words`);
check('heroes carry elements', ly.words.filter((w) => w.role === 'hero').every((w) => w.element && w.element !== 'none'));
const fireW = ly.words.find((w) => w.text === 'fire')!, rainW = ly.words.find((w) => w.text === 'rain')!;
check('lexicon picks the element', fireW.element === 'fire' && rainW.element === 'water', `${fireW.element}, ${rainW.element}`);
check('hook = most repeated chorus line', ly.lines.filter((l) => l.hook).length === 2, ly.lines.filter((l) => l.hook).map((l) => l.text).join(' / '));
// locked roles persist
const w0 = ly.words[2]; w0.role = 'connective'; w0.roleLocked = true; direct(ly, a);
check('role overrides persist', w0.role === 'connective');
// refreshLines after an edit
ly.words[0].start = 7.5; refreshLines(ly, a);
check('refreshLines', near(ly.lines[0].start, 7.5, 1e-9));
ly.words[0].start = 8;
refreshLines(ly, a);
// LRC round trip
const back = lyricsFromText(toEnhancedLrc(ly, { title: 'x' }), a);
let rt = 0;
back.words.forEach((w, i) => { rt = Math.max(rt, Math.abs(w.start - ly.words[i].start)); });
check('LRC round trip (≤ 5 ms)', back.words.length === ly.words.length && rt <= 0.0051, `${(rt * 1000).toFixed(1)} ms`);
check('LRC stamp rounding never gives :60.00', lrcStamp(59.999) === '01:00.00' && lrcStamp(-1) === '00:00.00', lrcStamp(59.999));
// mood lexicon
const m1 = lyricMood(['so', 'happy']), m2 = lyricMood(['not', 'happy']);
check('mood: lexicon size, negation, intensifier', MOOD_LEXICON_SIZE >= 700 && m1.valence > 0.7 && m2.valence < 0, `${MOOD_LEXICON_SIZE} words; ${m1.valence.toFixed(2)} / ${m2.valence.toFixed(2)}`);
done();

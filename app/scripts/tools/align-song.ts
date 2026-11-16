// Align a song's embedded (or given) lyrics to Whisper output and report:
//   node scripts/run.mjs scripts/tools/align-song.ts song.mp3 rec.json out.lrc [lyrics.txt]
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { decodeFile } from '../lib/node-audio.ts';
import { analyze } from '../../src/analysis/index.ts';
import { parseLyrics } from '../../src/lyrics/parse.ts';
import { buildLyrics, toEnhancedLrc } from '../../src/lyrics/build.ts';
import { alignToRecognised } from '../../src/align/align.ts';
import { direct, fuseLyricStructure } from '../../src/director/director.ts';

const [, , audio, recPath, outLrc, lyricsPath] = process.argv;
const tags = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', audio]).stdout.toString();
const t = JSON.parse(tags).format?.tags ?? {};
const lyricKey = Object.keys(t).find((k) => /^(lyrics|unsyncedlyrics|uslt)/i.test(k));
const text = lyricsPath ? readFileSync(lyricsPath, 'utf8') : lyricKey ? t[lyricKey] : '';
if (!text) throw new Error('no lyrics');
const a = analyze(decodeFile(audio));
const parsed = parseLyrics(text);
const ly = buildLyrics(parsed, a);
const rec = JSON.parse(readFileSync(recPath, 'utf8'));
const res = alignToRecognised(ly, rec.words, a);
a.sections = fuseLyricStructure(a, ly);
for (const l of ly.lines) { const tt = l.start + Math.min(0.3, 0.5 * (l.end - l.start)); l.section = Math.max(0, a.sections.findIndex((s) => tt < s.end)); }
direct(ly, a);
const f = (x: number) => `${Math.floor(x / 60)}:${(x % 60).toFixed(2).padStart(5, '0')}`;
console.log(`${t.title ?? audio}: ${ly.words.length} words, ${ly.lines.length} lines; match ${(res.matchRate * 100).toFixed(0)} % (exact ${res.exact}, fuzzy ${res.fuzzy}, estimated ${res.estimated}); ${a.bpm.toFixed(1)} BPM meter ${a.meter}`);
console.log('sections: ' + a.sections.map((s) => `${f(s.start)} ${s.label}`).join(' | '));
// vocal-activity agreement with the aligned words
let tp = 0, fp = 0, fn = 0;
const sung = new Uint8Array(a.n);
for (const w of ly.words) if (w.confidence > 0.7) for (let i = Math.floor(w.start * 60); i < Math.min(a.n, Math.ceil(w.end * 60)); i++) sung[i] = 1;
for (let i = 0; i < a.n; i++) { const p = a.vocal[i] > 0.5; if (sung[i] && p) tp++; else if (!sung[i] && p) fp++; else if (sung[i] && !p) fn++; }
console.log(`vocal activity vs aligned words: precision ${(tp / (tp + fp || 1)).toFixed(2)}, recall ${(tp / (tp + fn || 1)).toFixed(2)}`);
for (const l of ly.lines.slice(0, Number(process.env.LINES ?? 12))) {
  console.log(`  ${f(l.start)} [${a.sections[l.section]?.label}]${l.hook ? '*' : ' '} ` + l.words.map((i) => { const w = ly.words[i]; return (w.role === 'hero' ? w.display.toUpperCase() : w.display) + (w.confidence < 0.5 ? '?' : '') + (w.element && w.element !== 'none' ? `{${w.element}}` : ''); }).join(' '));
}
writeFileSync(outLrc, toEnhancedLrc(ly, { title: t.title, artist: t.artist }));

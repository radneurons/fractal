// Lyric parsing, tokenising, syllable counting and timing (LRC / enhanced LRC / SRT / VTT / plain).
import type { Analysis, Line, Lyrics, Word } from '../types';

export interface RawLine { text: string; start?: number; end?: number; words?: { text: string; start: number }[] }

// [mm:ss.xx], [mm:ss.xxx], [mm:ss:xx] (colon centiseconds), minutes up to 999
const TAG = String.raw`(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?`;
const tagSec = (m: string, s: string, f?: string) => parseInt(m, 10) * 60 + parseInt(s, 10) + (f ? parseInt(f, 10) / 10 ** f.length : 0);

export function detectFormat(txt: string): 'lrc' | 'srt' | 'vtt' | 'plain' {
  const t = txt.replace(/^﻿/, '');
  if (/^\s*WEBVTT/.test(t)) return 'vtt';
  if (/(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{3}\s*-->/.test(t)) return 'srt';
  if (new RegExp(String.raw`^\s*\[${TAG}\]`, 'm').test(t)) return 'lrc';
  return 'plain';
}

export function parseLRC(txt: string): { lines: RawLine[]; wordLevel: boolean } {
  const lines: RawLine[] = []; const ends: number[] = []; let offset = 0, wordLevel = false;
  const lineTag = new RegExp(String.raw`\[${TAG}\]`, 'g'), wordTag = new RegExp(String.raw`<${TAG}>\s*([^<]*)`, 'g'), anyWordTag = new RegExp(String.raw`<${TAG}>`);
  for (const raw of txt.replace(/^﻿/, '').split(/\r?\n/)) {
    const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\]/i); if (off) { offset = parseInt(off[1], 10) / 1000; continue; }
    const tags = [...raw.matchAll(lineTag)];
    if (!tags.length) continue;
    let body = raw.replace(lineTag, '').trim();
    let words: { text: string; start: number }[] | undefined;
    if (anyWordTag.test(body)) {
      wordLevel = true; const ws: { text: string; start: number }[] = [];
      // text before the first word tag starts with the line
      const t0 = tagSec(tags[0][1], tags[0][2], tags[0][3]) - offset;
      tokenize(body.slice(0, body.search(anyWordTag)).trim()).forEach((w, k) => ws.push({ text: w, start: t0 + k * 0.12 }));
      for (const p of body.matchAll(wordTag)) for (const [k, w] of tokenize(p[4].trim()).entries()) ws.push({ text: w, start: tagSec(p[1], p[2], p[3]) - offset + k * 0.12 });
      words = ws; body = ws.map(w => w.text).join(' ');
    }
    if (!body) { for (const tg of tags) ends.push(tagSec(tg[1], tg[2], tg[3]) - offset); continue; }   // an empty stamp marks where a line ends
    for (const tg of tags) lines.push({ text: body, start: tagSec(tg[1], tg[2], tg[3]) - offset, words: words && tags.length === 1 ? words : undefined });
  }
  lines.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  ends.sort((a, b) => a - b);
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1]?.start, stop = ends.find(e => e > lines[i].start! && (next === undefined || e <= next));
    lines[i].end = stop ?? next;
  }
  return { lines, wordLevel };
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
/** SRT and WebVTT cues, block by block: hours optional, cue settings ignored, empty cues skipped. */
export function parseSRT(txt: string): RawLine[] {
  const out: RawLine[] = [];
  const T = String.raw`(?:(\d{1,2}):)?(\d{2}):(\d{2})[,.](\d{3})`;
  const timing = new RegExp(String.raw`^\s*${T}\s*-->\s*${T}`);
  const sec = (h: string | undefined, m: string, s: string, ms: string) => (h ? +h * 3600 : 0) + +m * 60 + +s + +ms / 1000;
  for (const block of txt.replace(/^﻿/, '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const rows = block.split('\n'); const ti = rows.findIndex(r => timing.test(r)); if (ti < 0) continue;
    const m = rows[ti].match(timing)!;
    const text = rows.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').replace(/&(#39|[a-z]+);/gi, (x, e: string) => ENT[e.toLowerCase()] ?? x).replace(/\s+/g, ' ').trim();
    if (text) out.push({ text, start: sec(m[1], m[2], m[3], m[4]), end: sec(m[5], m[6], m[7], m[8]) });
  }
  return out;
}

export function parsePlain(txt: string): RawLine[] {
  return txt.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^\[.*\]$/.test(l)).map(text => ({ text }));
}

const STRIP = /[^\p{L}\p{M}\p{N}'’-]+/gu;
/** Lower-case, strip accents from Latin letters only (keeps kana voicing marks, Devanagari vowel signs…), drop punctuation. */
export function normalize(w: string): string {
  return w.toLowerCase().normalize('NFD').replace(/([a-z])[̀-ͯ]+/g, '$1').normalize('NFC').replace(/[’]/g, "'").replace(STRIP, '');
}
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
/** Split a lyric line into words; scripts written without spaces (Chinese, Japanese) become one token per character. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    if (!CJK.test(tok)) { out.push(tok); continue; }
    for (const ch of tok) { if (/[\p{L}\p{N}]/u.test(ch) || !out.length) out.push(ch); else out[out.length - 1] += ch; }   // punctuation sticks to the previous character
  }
  return out;
}


export function countSyllables(word: string): number {
  const w = normalize(word).replace(/'/g, '');
  if (!w) return 1;
  if (CJK.test(w)) return Math.max(1, [...w].filter(ch => CJK.test(ch)).length);
  if (/[\u0400-\u04ff]/.test(w)) return Math.max(1, (w.match(/[аеёиоуыэюяіїє]/g) ?? []).length);   // Cyrillic vowels
  if (!/[a-z]/.test(w)) return Math.max(1, Math.round([...w].filter(ch => /\p{L}/u.test(ch)).length / 2.5));   // other scripts: rough estimate
  if (/^\d+$/.test(w)) return Math.max(1, w.length);
  if (w.length <= 3) return 1;
  const ex: Record<string, number> = { every: 2, fire: 1, hour: 1, our: 1, being: 2, people: 2, area: 3, idea: 3, real: 1, really: 2, poem: 2, quiet: 2, science: 2, lion: 2, riot: 2, violent: 3, heaven: 2, even: 2, evening: 2, business: 2, different: 3, family: 3, beautiful: 3 };
  if (ex[w]) return ex[w];
  let s = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = s.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Build timed Words/Lines. Lines without times are spread across the vocal part of the track. */
export function buildLyrics(raw: RawLine[], analysis: Analysis | null, source: Lyrics['source']): Lyrics {
  const words: Word[] = []; const lines: Line[] = [];
  const dur = analysis?.duration ?? 60;
  // lines with no timing: spread over [firstOnset, lastOnset] weighted by syllables
  if (raw.some(l => l.start === undefined)) {
    let a0 = analysis?.onsets[0] ?? 1, a1 = analysis ? analysis.onsets[analysis.onsets.length - 1] ?? dur - 1 : dur - 1;
    if (!(a1 > a0 + 1)) { a0 = 0; a1 = Math.max(dur, 1); }   // no usable onsets (silence, very short clip): use the whole file
    const syl = raw.map(l => tokenize(l.text).reduce((s, w) => s + countSyllables(w), 0) + 2);
    const tot = syl.reduce((a, b) => a + b, 0); let acc = 0;
    raw.forEach((l, i) => { l.start = a0 + (a1 - a0) * acc / tot; acc += syl[i]; l.end = a0 + (a1 - a0) * acc / tot; });
  }
  raw.forEach((l) => {
    const toks = tokenize(l.text);
    if (!toks.length) return;
    const li = lines.length;
    const lineStart = l.start!, lineEnd = Math.min(l.end ?? lineStart + 4, lineStart + Math.max(1.2, toks.length * 1.2));
    const ids: number[] = [];
    if (l.words && l.words.length === toks.length) {
      l.words.forEach((w, k) => { ids.push(words.length); words.push(mkWord(words.length, w.text, li, w.start, l.words![k + 1]?.start ?? Math.min(w.start + 0.6, lineEnd), 1)); });
    } else {
      const syl = toks.map(countSyllables), tot = syl.reduce((a, b) => a + b, 0);
      // with a known tempo, sing about one syllable per eighth note (quarter below 100 BPM) rather than stretching to the gap
      let span = Math.max(0.3, lineEnd - lineStart) * 0.92; let acc = 0;
      if (analysis && analysis.bpm > 0 && analysis.bpmConfidence > 0.1) { const step = (analysis.bpm >= 100 ? 0.5 : 1) * 60 / analysis.bpm; span = Math.min(span, Math.max(0.3, step * tot)); }
      toks.forEach((t, k) => { const s = lineStart + span * acc / tot; acc += syl[k]; const e = lineStart + span * acc / tot; ids.push(words.length); words.push(mkWord(words.length, t, li, s, e, analysis ? 0.5 : 0.3)); });
    }
    lines.push({ idx: li, words: ids, start: words[ids[0]]?.start ?? lineStart, end: words[ids[ids.length - 1]]?.end ?? lineEnd, section: 0, text: toks.join(' ') });
  });
  if (analysis) snapToOnsets(words, analysis);
  // section membership and chorus repeats
  lines.forEach(L => {
    // pickups land just before the downbeat: judge membership a little into the line
    if (analysis) { const tm = L.start + Math.min(0.3, (L.end - L.start) / 2); const si = analysis.sections.findIndex(s => tm >= s.start && tm < s.end); L.section = si >= 0 ? si : tm >= (analysis.sections[analysis.sections.length - 1]?.start ?? 0) ? Math.max(0, analysis.sections.length - 1) : 0; }
    const key = normalize(L.text.replace(/\s+/g, ''));
    const prev = lines.find(o => o.idx < L.idx && normalize(o.text.replace(/\s+/g, '')) === key);
    if (prev) L.repeatOf = prev.repeatOf ?? prev.idx;
  });
  return { words, lines, source };
}

function mkWord(id: number, display: string, line: number, start: number, end: number, conf: number): Word {
  return { id, text: normalize(display), display, line, start, end: Math.max(end, start + 0.08), confidence: conf, syllables: countSyllables(display), stress: 0.5, role: 'support' };
}

/** Move estimated word starts onto nearby detected onsets (±80 ms) when timing is approximate. */
export function snapToOnsets(words: Word[], a: Analysis) {
  for (const w of words) {
    if (w.confidence >= 0.95) continue;
    let best = w.start, bd = 0.08;
    for (const o of a.onsets) { const d = Math.abs(o - w.start); if (d < bd) { bd = d; best = o; } if (o > w.start + 0.1) break; }
    if (best !== w.start) { w.start = best; w.confidence = Math.min(0.9, w.confidence + 0.2); }
  }
  for (let i = 0; i < words.length; i++) { const nx = words[i + 1]; if (nx && nx.line === words[i].line && words[i].end > nx.start) words[i].end = nx.start - 0.01; if (words[i].end < words[i].start + 0.06) words[i].end = words[i].start + 0.06; }
}

export function parseAny(txt: string, analysis: Analysis | null): Lyrics {
  const f = detectFormat(txt);
  if (f === 'lrc') { const r = parseLRC(txt); return buildLyrics(r.lines, analysis, r.wordLevel ? 'enhanced-lrc' : 'lrc'); }
  if (f === 'srt' || f === 'vtt') return buildLyrics(parseSRT(txt), analysis, f);
  return buildLyrics(parsePlain(txt), analysis, 'plain');
}

/** Recompute line spans and ordering after manual word edits. */
export function refreshLines(ly: Lyrics) {
  for (const L of ly.lines) {
    const ws = L.words.map(id => ly.words[id]);
    for (let i = 0; i < ws.length; i++) { const nx = ws[i + 1]; if (nx && ws[i].end > nx.start) ws[i].end = Math.max(ws[i].start + 0.06, nx.start - 0.01); if (ws[i].end < ws[i].start + 0.06) ws[i].end = ws[i].start + 0.06; }
    if (ws.length) { L.start = ws[0].start; L.end = ws[ws.length - 1].end; }
  }
}

export function exportLRC(ly: Lyrics): string {
  const fmt = (t: number) => { const cs = Math.max(0, Math.round(t * 100)), m = Math.floor(cs / 6000), s = (cs % 6000) / 100; return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };
  return ly.lines.map(L => `[${fmt(L.start)}]` + L.words.map(id => ` <${fmt(ly.words[id].start)}>${ly.words[id].display}`).join('')).join('\n') + '\n';
}


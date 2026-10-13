// Lyric parsing, tokenising, syllable counting and timing (LRC / enhanced LRC / SRT / VTT / plain).
import type { Analysis, Line, Lyrics, Word } from '../types';

export interface RawLine { text: string; start?: number; end?: number; words?: { text: string; start: number }[] }

const TS = /(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)/;
const tsToSec = (m: string, s: string) => parseInt(m, 10) * 60 + parseFloat(s);

export function detectFormat(txt: string): 'lrc' | 'srt' | 'vtt' | 'plain' {
  if (/^\s*WEBVTT/.test(txt)) return 'vtt';
  if (/\d+\s*\n\s*\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(txt)) return 'srt';
  if (/^\s*\[\d{1,2}:\d{1,2}(\.\d+)?\]/m.test(txt)) return 'lrc';
  return 'plain';
}

export function parseLRC(txt: string): { lines: RawLine[]; wordLevel: boolean } {
  const lines: RawLine[] = []; let offset = 0, wordLevel = false;
  for (const raw of txt.split(/\r?\n/)) {
    const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\]/i); if (off) { offset = parseInt(off[1], 10) / 1000; continue; }
    const tags = [...raw.matchAll(/\[(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)\]/g)];
    if (!tags.length) continue;
    let body = raw.replace(/\[(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)\]/g, '').trim();
    let words: { text: string; start: number }[] | undefined;
    if (/<\d{1,2}:\d{1,2}/.test(body)) {
      wordLevel = true; words = [];
      const parts = [...body.matchAll(/<(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)>\s*([^<]*)/g)];
      for (const p of parts) for (const [k, w] of p[3].trim().split(/\s+/).filter(Boolean).entries()) words.push({ text: w, start: tsToSec(p[1], p[2]) - offset + k * 0.12 });
      body = words.map(w => w.text).join(' ');
    }
    if (!body) continue;
    for (const tg of tags) lines.push({ text: body, start: tsToSec(tg[1], tg[2]) - offset, words: words && tags.length === 1 ? words : undefined });
  }
  lines.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  for (let i = 0; i < lines.length; i++) lines[i].end = lines[i + 1]?.start;
  return { lines, wordLevel };
}

export function parseSRT(txt: string): RawLine[] {
  const out: RawLine[] = [];
  const re = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})[^\n]*\n([\s\S]*?)(?:\n\s*\n|$)/g;
  for (const m of txt.matchAll(re)) {
    const s = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000, e = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;
    const text = m[9].replace(/<[^>]+>/g, '').replace(/\s*\n\s*/g, ' ').trim();
    if (text) out.push({ text, start: s, end: e });
  }
  return out;
}

export function parsePlain(txt: string): RawLine[] {
  return txt.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^\[.*\]$/.test(l)).map(text => ({ text }));
}

const STRIP = /[^\p{L}\p{N}'’-]+/gu;
export function normalize(w: string): string { return w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’]/g, "'").replace(STRIP, ''); }

export function countSyllables(word: string): number {
  const w = normalize(word).replace(/'/g, '');
  if (!w) return 1;
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
    const a0 = analysis?.onsets[0] ?? 1, a1 = analysis ? analysis.onsets[analysis.onsets.length - 1] ?? dur - 1 : dur - 1;
    const syl = raw.map(l => l.text.split(/\s+/).reduce((s, w) => s + countSyllables(w), 0) + 2);
    const tot = syl.reduce((a, b) => a + b, 0); let acc = 0;
    raw.forEach((l, i) => { l.start = a0 + (a1 - a0) * acc / tot; acc += syl[i]; l.end = a0 + (a1 - a0) * acc / tot; });
  }
  raw.forEach((l) => {
    const toks = l.text.split(/\s+/).filter(Boolean);
    if (!toks.length) return;
    const li = lines.length;
    const lineStart = l.start!, lineEnd = Math.min(l.end ?? lineStart + 4, lineStart + Math.max(1.2, toks.length * 0.9));
    const ids: number[] = [];
    if (l.words && l.words.length === toks.length) {
      l.words.forEach((w, k) => { ids.push(words.length); words.push(mkWord(words.length, w.text, li, w.start, l.words![k + 1]?.start ?? Math.min(w.start + 0.6, lineEnd), 1)); });
    } else {
      const syl = toks.map(countSyllables), tot = syl.reduce((a, b) => a + b, 0);
      const span = Math.max(0.3, lineEnd - lineStart) * 0.92; let acc = 0;
      toks.forEach((t, k) => { const s = lineStart + span * acc / tot; acc += syl[k]; const e = lineStart + span * acc / tot; ids.push(words.length); words.push(mkWord(words.length, t, li, s, e, analysis ? 0.5 : 0.3)); });
    }
    lines.push({ idx: li, words: ids, start: words[ids[0]]?.start ?? lineStart, end: words[ids[ids.length - 1]]?.end ?? lineEnd, section: 0, text: toks.join(' ') });
  });
  if (analysis) snapToOnsets(words, analysis);
  // section membership and chorus repeats
  lines.forEach(L => {
    if (analysis) L.section = Math.max(0, analysis.sections.findIndex(s => L.start >= s.start - 0.05 && L.start < s.end));
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
  const fmt = (t: number) => { const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };
  return ly.lines.map(L => `[${fmt(L.start)}]` + L.words.map(id => ` <${fmt(ly.words[id].start)}>${ly.words[id].display}`).join('')).join('\n') + '\n';
}

void TS;

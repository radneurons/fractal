// Lyrics parsing (SPEC §5, §5A.2): LRC (+ word & syllable tags), SRT, VTT and plain text → RawLine[].
import type { SectionLabel } from '../types.ts';

export type LyricsFormat = 'lrc' | 'enhanced-lrc' | 'srt' | 'vtt' | 'plain';

export interface RawToken {
  display: string;
  start?: number;
  end?: number;
  backing?: boolean;
  voice?: string;
  /** per-syllable tags written inside the word */
  syl?: { text: string; start: number }[];
}

export interface RawLine {
  time?: number;
  end?: number;
  tokens: RawToken[];
  voice?: string;
  hint?: SectionLabel;
  block?: number;
  blockTitle?: string;
}

export interface ParsedLyrics {
  format: LyricsFormat;
  lines: RawLine[];
  meta: { title?: string; artist?: string; offsetMs: number };
  /** section headers found in plain text ("[Chorus]"), in order — including ones with no lines */
  blocks: { title: string; hint?: SectionLabel; lines: number }[];
}

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

function toSeconds(m: string, s: string, f?: string): number {
  let frac = 0;
  if (f) frac = parseInt(f, 10) / 10 ** f.length;
  return parseInt(m, 10) * 60 + parseInt(s, 10) + frac;
}

export function detectFormat(text: string): LyricsFormat {
  const t = text.replace(/^﻿/, '');
  if (/^\s*WEBVTT/.test(t)) return 'vtt';
  if (/^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/m.test(t)) return 'srt';
  if (/^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->/m.test(t)) return 'vtt';
  if (/^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/m.test(t)) return /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/.test(t) ? 'enhanced-lrc' : 'lrc';
  return 'plain';
}

const HINTS: [RegExp, SectionLabel][] = [
  [/\b(pre[- ]?chorus|build)\b/i, 'verse'],
  [/\b(chorus|hook|refrain)\b/i, 'chorus'],
  [/\b(intro|opening)\b/i, 'intro'],
  [/\b(outro|ending|coda)\b/i, 'outro'],
  [/\b(bridge|middle ?8)\b/i, 'bridge'],
  [/\b(drop)\b/i, 'drop'],
  [/\b(break(down)?|interlude|instrumental|solo)\b/i, 'breakdown'],
  [/\b(spoken|speech|monologue)\b/i, 'speech'],
  [/\b(verse)\b/i, 'verse'],
];

export function hintFromHeader(header: string): SectionLabel | undefined {
  // only the title before any description ("Verse 1 – gritty and tense …")
  const title = header.split(/[–—:|]| - /)[0];
  for (const [re, lab] of HINTS) if (re.test(title)) return lab;
  for (const [re, lab] of HINTS) if (re.test(header)) return lab;
  return undefined;
}

/** Voice tag at the start of a line or span. Returns the normalised voice and the remaining text. */
export function takeVoiceTag(text: string): { voice?: string; rest: string } {
  const t = text.replace(/^\s+/, '');
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^v(\d)\s*:\s*/i))) return { voice: m[1] === '1' ? 'A' : m[1] === '2' ? 'B' : `V${m[1]}`, rest: t.slice(m[0].length) };
  if ((m = t.match(/^\[(A\+B|B\+A|ALL|BOTH|A|B)\]\s*/i))) {
    const v = m[1].toUpperCase();
    return { voice: v === 'A' || v === 'B' ? v : 'all', rest: t.slice(m[0].length) };
  }
  if ((m = t.match(/^([MFD])\s*:\s+(?=\S)/))) return { voice: m[1] === 'M' ? 'A' : m[1] === 'F' ? 'B' : 'all', rest: t.slice(m[0].length) };
  if ((m = t.match(/^\{([^}]{1,24})\}\s*/))) {
    const v = m[1].trim();
    const n = v.toLowerCase();
    return { voice: n === 'v1' || n === 'a' ? 'A' : n === 'v2' || n === 'b' ? 'B' : n === 'all' || n === 'both' || n === 'duet' ? 'all' : v, rest: t.slice(m[0].length) };
  }
  return { rest: text };
}

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;
const CJK_PUNCT = /[　-〿＀-／：-＠［-｀｛-･]/;

/** Split text into display words: whitespace-separated; CJK runs per character (punctuation joins the previous). */
export function splitWords(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text.split(/\s+/)) {
    if (!chunk) continue;
    if (!CJK.test(chunk)) { out.push(chunk); continue; }
    let cur = '';
    for (const ch of Array.from(chunk)) {
      if (CJK.test(ch)) { if (cur) out.push(cur); cur = ch; }
      else if (CJK_PUNCT.test(ch) || /[.,!?;:、。！？…」』）)\]"']/.test(ch)) { cur += ch; }
      else {
        // Latin run inside a CJK chunk
        if (cur && CJK.test(cur[0])) { out.push(cur); cur = ch; } else cur += ch;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Tokenise plain line text: words, with parenthesised spans marked as backing vocals. */
function tokenise(text: string, into: RawToken[], voice?: string): void {
  let depth = 0;
  for (const w of splitWords(text)) {
    const opens = (w.match(/[(（]/g) ?? []).length, closes = (w.match(/[)）]/g) ?? []).length;
    const backing = depth > 0 || opens > 0;
    depth = Math.max(0, depth + opens - closes);
    if (!/[\p{L}\p{N}]/u.test(w)) {
      // pure punctuation joins the previous token
      if (into.length) into[into.length - 1].display += w;
      continue;
    }
    into.push({ display: w, backing: backing || undefined, voice });
  }
}

function parseLrc(text: string, format: LyricsFormat): ParsedLyrics {
  const lines: RawLine[] = [];
  const meta: ParsedLyrics['meta'] = { offsetMs: 0 };
  let voice: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, '');
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\s*\[(ti|ar|al|by|offset|length|re|ve)\s*:\s*(.*?)\]\s*$/i))) {
      const k = m[1].toLowerCase();
      if (k === 'ti') meta.title = m[2];
      else if (k === 'ar') meta.artist = m[2];
      else if (k === 'offset') meta.offsetMs = parseInt(m[2], 10) || 0;
      continue;
    }
    const stamps: number[] = [];
    let rest = line;
    for (;;) {
      STAMP.lastIndex = 0;
      const sm = STAMP.exec(rest);
      if (!sm || rest.slice(0, sm.index).trim() !== '') break;
      stamps.push(toSeconds(sm[1], sm[2], sm[3]));
      rest = rest.slice(sm.index + sm[0].length);
    }
    if (!stamps.length) continue;
    if (rest.trim() === '') {
      // an empty stamp line ends the previous line
      const t = stamps[0];
      let last: RawLine | undefined;
      for (const l of lines) if (l.time !== undefined && l.time <= t && (!last || l.time >= (last.time ?? 0))) last = l;
      if (last && last.end === undefined) last.end = t;
      continue;
    }
    const vt = takeVoiceTag(rest);
    if (vt.voice) voice = vt.voice;
    rest = vt.rest;
    // word / syllable tags
    const tokens: RawToken[] = [];
    let lineEnd: number | undefined;
    WORD_TAG.lastIndex = 0;
    const parts: { t?: number; text: string }[] = [];
    let lastIdx = 0, pending: number | undefined, tm: RegExpExecArray | null;
    while ((tm = WORD_TAG.exec(rest))) {
      const chunk = rest.slice(lastIdx, tm.index);
      if (chunk !== '' || pending !== undefined) parts.push({ t: pending, text: chunk });
      pending = toSeconds(tm[1], tm[2], tm[3]);
      lastIdx = tm.index + tm[0].length;
    }
    const tail = rest.slice(lastIdx);
    if (tail.trim() !== '' || (pending !== undefined && tail.trim() === '' && false)) parts.push({ t: pending, text: tail });
    else if (pending !== undefined) lineEnd = pending; // trailing tag = end of the last word
    let depth = 0;
    const st: { open: RawToken | null } = { open: null }; // a word still being extended by syllable tags
    for (const part of parts) {
      const startsWithSpace = /^\s/.test(part.text) || part.text === '';
      const endsWithSpace = /\s$/.test(part.text);
      const words = splitWords(part.text);
      if (!words.length) { if (part.t !== undefined && st.open && !st.open.end) st.open.end = part.t; st.open = null; continue; }
      words.forEach((w, i) => {
        const opens = (w.match(/[(（]/g) ?? []).length, closes = (w.match(/[)）]/g) ?? []).length;
        const backing = depth > 0 || opens > 0;
        depth = Math.max(0, depth + opens - closes);
        const t = i === 0 ? part.t : undefined;
        const open = st.open;
        if (i === 0 && open && !startsWithSpace && t !== undefined && !CJK.test(w)) {
          // continuation of the previous word: a per-syllable tag
          if (!open.syl) open.syl = [{ text: open.display, start: open.start! }];
          open.syl.push({ text: w.replace(/[^\p{L}\p{N}'’]+$/u, ''), start: t });
          open.display += w;
          return;
        }
        if (!/[\p{L}\p{N}]/u.test(w)) { if (tokens.length) tokens[tokens.length - 1].display += w; return; }
        const tok: RawToken = { display: w, start: t, backing: backing || undefined, voice };
        tokens.push(tok);
        st.open = t !== undefined ? tok : null;
      });
      if (endsWithSpace) st.open = null;
    }
    for (const tok of tokens) if (tok.syl && tok.syl.length < 2) delete tok.syl;
    for (const t of stamps) {
      lines.push({ time: t, end: lineEnd, tokens: tokens.map((k) => ({ ...k, syl: k.syl?.map((s) => ({ ...s })) })), voice });
    }
    // several stamps repeat the line: shift word tags for the repeats
    if (stamps.length > 1) {
      const base = stamps[0];
      for (let i = 1; i < stamps.length; i++) {
        const l = lines[lines.length - stamps.length + i];
        const d = stamps[i] - base;
        for (const k of l.tokens) { if (k.start !== undefined) k.start += d; if (k.end !== undefined) k.end += d; k.syl?.forEach((s) => { s.start += d; }); }
        if (l.end !== undefined) l.end += d;
      }
    }
  }
  lines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  if (meta.offsetMs) {
    // [offset:+ms] means the lyrics should appear EARLIER by that amount
    const d = -meta.offsetMs / 1000;
    for (const l of lines) {
      if (l.time !== undefined) l.time = Math.max(0, l.time + d);
      if (l.end !== undefined) l.end = Math.max(0, l.end + d);
      for (const k of l.tokens) { if (k.start !== undefined) k.start = Math.max(0, k.start + d); if (k.end !== undefined) k.end += d; k.syl?.forEach((s) => { s.start = Math.max(0, s.start + d); }); }
    }
  }
  return { format, lines, meta, blocks: [] };
}

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>';
    if (k === 'quot') return '"'; if (k === 'apos') return "'"; if (k === 'nbsp') return ' ';
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    return String.fromCodePoint(parseInt(k.slice(1), 10));
  });
}

function parseCues(text: string, format: 'srt' | 'vtt'): ParsedLyrics {
  const lines: RawLine[] = [];
  const blocks = text.replace(/^﻿/, '').replace(/\r/g, '').split(/\n{2,}/);
  const time = (s: string): number => {
    const p = s.trim().replace(',', '.').split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  };
  let voice: string | undefined;
  for (const block of blocks) {
    const rows = block.split('\n');
    const ti = rows.findIndex((r) => r.includes('-->'));
    if (ti < 0) continue;
    const m = rows[ti].match(/((?:\d+:)?\d+:\d+[.,]\d+)\s*-->\s*((?:\d+:)?\d+:\d+[.,]\d+)/);
    if (!m) continue;
    let body = rows.slice(ti + 1).join(' ');
    // VTT voice spans <v Name>
    const vm = body.match(/<v(?:\.[\w.]+)?\s+([^>]+)>/i);
    body = decodeEntities(body.replace(/<[^>]+>/g, '')).replace(/\{\\[^}]*\}/g, '').trim();
    if (!body) continue;
    const vt = takeVoiceTag(body);
    if (vt.voice) voice = vt.voice; else if (vm) voice = vm[1].trim();
    const tokens: RawToken[] = [];
    tokenise(vt.rest, tokens, voice);
    if (tokens.length) lines.push({ time: time(m[1]), end: time(m[2]), tokens, voice });
  }
  return { format, lines, meta: { offsetMs: 0 }, blocks: [] };
}

function parsePlain(text: string): ParsedLyrics {
  const lines: RawLine[] = [];
  const blocks: ParsedLyrics['blocks'] = [];
  let voice: string | undefined, hint: SectionLabel | undefined, block = -1, blockTitle: string | undefined;
  let sawHeader = false, blank = true;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { blank = true; continue; }
    // a whole-line bracketed header that is not a voice tag: "[Chorus]", "[Verse 2 – urgent …]"
    const hm = line.match(/^\[([^\]]+)\]$/) ?? line.match(/^\(((?:intro|verse|chorus|bridge|outro|pre-?chorus|hook|instrumental|interlude|solo)[^)]*)\)$/i);
    if (hm && !/^(A\+B|B\+A|ALL|BOTH|A|B)$/i.test(hm[1].trim())) {
      hint = hintFromHeader(hm[1]);
      blockTitle = hm[1].split(/[–—:|]| - /)[0].trim();
      blocks.push({ title: blockTitle, hint, lines: 0 });
      block = blocks.length - 1;
      sawHeader = true; blank = false;
      continue;
    }
    if (!sawHeader && blank) {
      // stanzas separated by blank lines are blocks too
      blocks.push({ title: '', lines: 0 });
      block = blocks.length - 1;
      blockTitle = undefined; hint = undefined;
    }
    blank = false;
    const vt = takeVoiceTag(line);
    if (vt.voice) voice = vt.voice;
    const tokens: RawToken[] = [];
    tokenise(vt.rest, tokens, voice);
    if (!tokens.length) continue;
    lines.push({ tokens, voice, hint, block: block >= 0 ? block : undefined, blockTitle });
    if (block >= 0) blocks[block].lines++;
  }
  return { format: 'plain', lines, meta: { offsetMs: 0 }, blocks };
}

export function parseLyrics(text: string): ParsedLyrics {
  const format = detectFormat(text);
  if (format === 'lrc' || format === 'enhanced-lrc') {
    const p = parseLrc(text, format);
    // inline voice tags inside enhanced lines were handled per line; plain backing parens too
    return p;
  }
  if (format === 'srt' || format === 'vtt') return parseCues(text, format);
  return parsePlain(text);
}

/** Lowercase, strip punctuation; strip accents from Latin letters only (kana marks & Indic signs survive). */
export function normaliseWord(display: string): string {
  let out = '';
  for (const ch of display.toLowerCase()) {
    if (/[\u0000-ɏḀ-ỿ]/.test(ch)) {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += base;
    } else out += ch;
  }
  return out.replace(/[’‘`]/g, "'").replace(/[^\p{L}\p{N}\p{M}']/gu, '').replace(/^'+|'+$/g, '');
}

export { CJK };

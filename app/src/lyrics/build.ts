// Parsed lines → timed Lyrics (SPEC §5, §5A): spreading, snapping, sections, repeats, syllables, pitch.
import type { Analysis, Line, Lyrics, LyricsSource, Word } from '../types.ts';
import { parseLyrics, normaliseWord, type ParsedLyrics, type RawLine } from './parse.ts';
import { countSyllables, assignSyllables } from './syllables.ts';
import { nearest, lowerBound, clamp, FPS } from '../analysis/dsp.ts';
import { medianPitch, isMelisma, vibratoRate } from '../analysis/pitch.ts';
import { sectionAt } from '../analysis/structure.ts';

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

export interface BuildOptions { source?: LyricsSource }

/** Syllable period for tempo-aware spreading: an eighth note (a quarter below 100 BPM). */
export function syllablePeriod(a: Analysis | null): number {
  if (a && a.bpmConfidence > 0.1 && !a.isSpeech && a.bpm > 30) {
    const beat = 60 / a.bpm;
    return a.bpm < 100 ? beat : beat / 2;
  }
  return 0.28;
}

function makeWord(id: number, display: string, line: number): Word {
  const text = normaliseWord(display);
  return { id, text, display, line, start: 0, end: 0, confidence: 0, syllables: countSyllables(text), stress: 0, role: 'support' };
}

/** Spread a line's words from `start` at one syllable per `period` (compressed to fit `avail`). */
function spreadLine(words: Word[], start: number, avail: number, period: number): void {
  const lead = words.filter((w) => !w.backing);
  const tot = lead.reduce((a, w) => a + w.syllables, 0) || 1;
  let step = period;
  if (tot * step > avail && avail > 0.1) step = avail / tot;
  let acc = 0;
  let lastLead: Word | null = null;
  for (const w of words) {
    if (w.backing) {
      // backing vocals echo right after the lead word they follow
      const base: number = lastLead ? lastLead.end : start;
      w.start = base; w.end = base + Math.max(0.2, w.syllables * step);
      continue;
    }
    w.start = start + acc * step;
    acc += w.syllables;
    w.end = start + acc * step;
    lastLead = w;
  }
}

/** Plain text: spread over the first-to-last onset span by syllables (+2 per line), warped by vocal activity. */
function spreadPlain(lines: Word[][], a: Analysis | null, duration: number): void {
  const t0 = a && a.onsets.length ? a.onsets[0] : 0;
  const t1 = a && a.onsets.length ? a.onsets[a.onsets.length - 1] : duration;
  // weights
  let total = 0;
  for (const l of lines) { total += 2; for (const w of l) if (!w.backing) total += w.syllables; }
  // warp: cumulative vocal activity over [t0, t1] (instrumental passages take no lyric time)
  let warp: ((u: number) => number) | null = null;
  if (a && a.vocal.length) {
    const i0 = Math.floor(t0 * FPS), i1 = Math.min(a.vocal.length - 1, Math.ceil(t1 * FPS));
    const cum = new Float64Array(i1 - i0 + 2);
    for (let i = i0; i <= i1; i++) cum[i - i0 + 1] = cum[i - i0] + Math.max(0.02, a.vocal[i] > 0.35 ? a.vocal[i] : 0.02);
    const tot = cum[cum.length - 1];
    let varies = 0;
    for (let i = i0; i <= i1; i++) if (a.vocal[i] < 0.35) varies++;
    if (tot > 0 && varies > 0.08 * (i1 - i0)) {
      warp = (u: number) => {
        const target = clamp(u, 0, 1) * tot;
        let lo = 0, hi = cum.length - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < target) lo = m + 1; else hi = m; }
        const k = Math.max(1, lo);
        const f = cum[k] > cum[k - 1] ? (target - cum[k - 1]) / (cum[k] - cum[k - 1]) : 0;
        return (i0 + k - 1 + f) / FPS;
      };
    }
  }
  const at = (u: number) => (warp ? warp(u) : t0 + (t1 - t0) * u);
  let acc = 0;
  for (const l of lines) {
    let lastLead: Word | null = null;
    for (const w of l) {
      if (w.backing) { const b: number = lastLead ? lastLead.end : at(acc / total); w.start = b; w.end = b + 0.3; continue; }
      w.start = at(acc / total);
      acc += w.syllables;
      w.end = at(acc / total);
      lastLead = w;
    }
    acc += 2;
  }
}

export function buildLyrics(parsed: ParsedLyrics, a: Analysis | null, opts: BuildOptions = {}): Lyrics {
  const duration = a?.duration ?? 0;
  const words: Word[] = [];
  const lines: Line[] = [];
  const lineWords: Word[][] = [];
  const raws: RawLine[] = parsed.lines.filter((l) => l.tokens.length);
  for (const [li, raw] of raws.entries()) {
    const ws: Word[] = [];
    for (const tok of raw.tokens) {
      const w = makeWord(words.length, tok.display, li);
      if (!w.text) continue;
      if (tok.backing) w.backing = true;
      w.voice = tok.voice ?? raw.voice;
      if (tok.start !== undefined) { w.start = tok.start; w.confidence = 1; }
      if (tok.end !== undefined) w.end = tok.end;
      if (tok.syl && tok.syl.length > 1) {
        w.syllableTimes = tok.syl.map((s) => ({ text: s.text, start: s.start, end: s.start }));
        w.syllablesLocked = true;
        w.syllables = tok.syl.length;
      }
      words.push(w); ws.push(w);
    }
    if (!ws.length) continue;
    lineWords.push(ws);
    lines.push({
      idx: lines.length, words: ws.map((w) => w.id), start: raw.time ?? 0, end: raw.end ?? 0, section: 0,
      text: ws.map((w) => w.display).join(' '), voice: raw.voice, hint: raw.hint,
    });
    (lines[lines.length - 1] as Line & { block?: number }).block = raw.block;
    for (const w of ws) w.line = lines.length - 1;
  }
  const period = syllablePeriod(a);
  const rawByLine = raws.filter((r) => r.tokens.some((t) => normaliseWord(t.display)));
  if (parsed.format === 'plain') {
    spreadPlain(lineWords, a, duration || lineWords.length * 3);
    for (const w of words) w.confidence = 0.2;
  } else {
    for (let li = 0; li < lineWords.length; li++) {
      const ws = lineWords[li], raw = rawByLine[li];
      const lineStart = raw.time ?? 0;
      const nextStart = li + 1 < lineWords.length ? rawByLine[li + 1].time ?? Infinity : duration || Infinity;
      const lineEnd = raw.end ?? nextStart;
      const timed = ws.filter((w) => w.confidence === 1);
      if (!timed.length) {
        spreadLine(ws, lineStart, Math.max(0.2, Math.min(lineEnd, nextStart) - lineStart - 0.05), period);
        ws.forEach((w, i) => { w.confidence = i === 0 ? 0.9 : 0.5; });
      } else if (timed.length < ws.length) {
        // some words carry tags: interpolate the rest between tagged neighbours by syllables
        if (ws[0].confidence !== 1) { ws[0].start = lineStart; ws[0].confidence = 0.9; }
        for (let i = 0; i < ws.length;) {
          if (ws[i].confidence >= 0.9) { i++; continue; }
          let j = i;
          while (j < ws.length && ws[j].confidence < 0.9) j++;
          const t0 = ws[i - 1].start, t1 = j < ws.length ? ws[j].start : Math.min(lineEnd, t0 + (j - i + 1) * period * 2);
          let tot = ws[i - 1].syllables;
          for (let k = i; k < j; k++) tot += ws[k].syllables;
          let acc = ws[i - 1].syllables;
          for (let k = i; k < j; k++) { ws[k].start = t0 + ((t1 - t0) * acc) / tot; acc += ws[k].syllables; ws[k].confidence = 0.5; }
          i = j;
        }
      }
      // ends: the next lead word's start; the last word runs to the line end (capped)
      const lead = ws.filter((w) => !w.backing);
      for (let i = 0; i < lead.length; i++) {
        const w = lead[i];
        if (i + 1 < lead.length) {
          const nx = lead[i + 1].start;
          w.end = w.end > w.start ? Math.min(w.end, Math.max(nx, w.start + 0.06)) : nx;
        } else if (!(w.end > w.start)) {
          const cap = w.start + Math.max(0.35, w.syllables * period * 1.5);
          w.end = Math.min(lineEnd < Infinity ? lineEnd : cap, raw.end !== undefined ? raw.end : cap);
        }
      }
      for (const w of ws) if (w.backing && !(w.end > w.start)) w.end = w.start + Math.max(0.25, w.syllables * period);
    }
  }
  const out: Lyrics = { words, lines, source: opts.source ?? parsed.format, meta: { title: parsed.meta.title, artist: parsed.meta.artist } };
  if (a) snapToOnsets(out, a, 0.95);
  refreshLines(out, a);
  finaliseWords(out, a);
  return out;
}

/** Words below `maxConf` snap to the nearest onset within ±80 ms (order preserved). */
export function snapToOnsets(ly: Lyrics, a: Analysis, maxConf = 0.95, tol = 0.08): void {
  let prev = -Infinity;
  for (const w of ly.words) {
    if (w.backing) continue;
    if (w.confidence < maxConf) {
      const t = nearest(a.onsets, w.start);
      if (!Number.isNaN(t) && Math.abs(t - w.start) <= tol && t > prev + 0.03) {
        const d = t - w.start;
        w.start = t;
        if (w.end - w.start < 0.06) w.end += d;
      }
    }
    prev = w.start;
  }
}

/** Recompute word ends (no overlap, ≥ 60 ms), line spans, sections and repeats after any timing edit. */
export function refreshLines(ly: Lyrics, a: Analysis | null): void {
  const seen = new Map<string, number>();
  for (const line of ly.lines) {
    const ws = line.words.map((i) => ly.words[i]).filter(Boolean);
    const lead = ws.filter((w) => !w.backing);
    const pool = lead.length ? lead : ws;
    for (let i = 0; i < pool.length; i++) {
      const w = pool[i];
      if (i + 1 < pool.length && w.end > pool[i + 1].start) w.end = Math.max(w.start + 0.06, pool[i + 1].start);
      if (w.end - w.start < 0.06) w.end = w.start + 0.06;
    }
    for (const w of ws) if (w.backing && w.end - w.start < 0.06) w.end = w.start + 0.06;
    line.start = Math.min(...pool.map((w) => w.start));
    line.end = Math.max(...ws.map((w) => w.end));
    line.text = ws.map((w) => w.display).join(' ');
    // a line belongs to the section containing start + min(0.3 s, half the line): pickups land before the downbeat
    if (a) line.section = sectionAt(a.sections, line.start + Math.min(0.3, 0.5 * (line.end - line.start)));
    const key = lead.map((w) => w.text).join(' ');
    line.repeatOf = undefined;
    if (key) { if (seen.has(key)) line.repeatOf = seen.get(key); else seen.set(key, line.idx); }
    line.dir = RTL.test(line.text) ? 'rtl' : 'ltr';
    const voices = new Set(lead.map((w) => w.voice).filter(Boolean));
    line.voice = voices.size === 1 ? [...voices][0] : voices.size > 1 ? 'all' : line.voice;
  }
}

/** Per-word pitch, melisma, vibrato and syllable times; per-line pitch range. */
export function finaliseWords(ly: Lyrics, a: Analysis | null): void {
  for (const w of ly.words) {
    if (a) {
      const p = medianPitch(a.f0, w.start, w.end);
      w.pitch = Number.isNaN(p) ? undefined : p;
      w.melisma = w.end - w.start > 0.5 && isMelisma(a.f0, w.start, w.end);
      w.vibrato = w.end - w.start > 0.45 && vibratoRate(a.f0, w.start, w.end) > 0;
    }
    assignSyllables(w, a);
  }
  for (const line of ly.lines) {
    const ps = line.words.map((i) => ly.words[i]?.pitch).filter((p): p is number => p !== undefined);
    line.pitchRange = ps.length ? [Math.min(...ps), Math.max(...ps)] : undefined;
  }
}

export function lyricsFromText(text: string, a: Analysis | null, source?: LyricsSource): Lyrics {
  return buildLyrics(parseLyrics(text), a, { source });
}

// ---------- translation (§5A.3) ----------

/** Attach a translation: timed files match by maximum time overlap, plain files by line index. */
export function attachTranslation(ly: Lyrics, text: string): number {
  for (const l of ly.lines) l.translation = undefined;
  if (!text.trim()) return 0;
  const p = parseLyrics(text);
  const tl = p.lines.filter((l) => l.tokens.length);
  let n = 0;
  if (p.format === 'plain') {
    for (let i = 0; i < Math.min(tl.length, ly.lines.length); i++) { ly.lines[i].translation = tl[i].tokens.map((t) => t.display).join(' '); n++; }
    return n;
  }
  const spans = tl.map((l, i) => ({ s: l.time ?? 0, e: l.end ?? (i + 1 < tl.length ? tl[i + 1].time ?? 0 : (l.time ?? 0) + 4), text: l.tokens.map((t) => t.display).join(' ') }));
  for (const line of ly.lines) {
    let best = 0, bi = -1;
    for (let i = 0; i < spans.length; i++) {
      const o = Math.min(line.end, spans[i].e) - Math.max(line.start, spans[i].s);
      if (o > best) { best = o; bi = i; }
    }
    if (bi >= 0) { line.translation = spans[bi].text; n++; }
  }
  return n;
}

// ---------- LRC export ----------

/** Round to whole centiseconds BEFORE splitting into minutes and seconds (never ":60.00"); clamp at 0. */
export function lrcStamp(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const m = Math.floor(cs / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

export function toEnhancedLrc(ly: Lyrics, meta: { title?: string; artist?: string } = {}, syllables = true): string {
  let out = '';
  if (meta.title) out += `[ti:${meta.title}]\n`;
  if (meta.artist) out += `[ar:${meta.artist}]\n`;
  let lastVoice: string | undefined;
  for (const line of ly.lines) {
    let row = `[${lrcStamp(line.start)}]`;
    if (line.voice && line.voice !== lastVoice) { row += line.voice === 'A' ? 'v1: ' : line.voice === 'B' ? 'v2: ' : line.voice === 'all' ? '[A+B] ' : `{${line.voice}} `; lastVoice = line.voice; }
    const ws = line.words.map((i) => ly.words[i]);
    for (const w of ws) {
      if (syllables && w.syllablesLocked && w.syllableTimes && w.syllableTimes.length > 1) {
        const joined = w.syllableTimes.map((s) => s.text).join('');
        const trail = w.display.startsWith(joined) ? w.display.slice(joined.length) : '';
        row += w.syllableTimes.map((s) => `<${lrcStamp(s.start)}>${s.text}`).join('') + trail + ' ';
      } else row += `<${lrcStamp(w.start)}>${w.display} `;
    }
    const lead = ws.filter((w) => !w.backing);
    row += `<${lrcStamp((lead[lead.length - 1] ?? ws[ws.length - 1]).end)}>`;
    out += row + '\n';
  }
  return out;
}

export function wordAt(ly: Lyrics, t: number): Word | null {
  let best: Word | null = null;
  for (const w of ly.words) if (w.start <= t && (!best || w.start >= best.start)) best = w;
  return best;
}

/** Apply a global sync offset (seconds) to a deep copy of the lyrics. */
export function shiftLyrics(ly: Lyrics, dt: number): Lyrics {
  if (!dt) return ly;
  return {
    ...ly,
    words: ly.words.map((w) => ({ ...w, start: w.start + dt, end: w.end + dt, syllableTimes: w.syllableTimes?.map((s) => ({ ...s, start: s.start + dt, end: s.end + dt })) })),
    lines: ly.lines.map((l) => ({ ...l, start: l.start + dt, end: l.end + dt })),
  };
}

export { lowerBound };

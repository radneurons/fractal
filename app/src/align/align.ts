// Auto-sync alignment (SPEC §5): Needleman–Wunsch between the lyric words and the recognised words.
import type { Analysis, Lyrics, Word } from '../types.ts';
import { normaliseWord } from '../lyrics/parse.ts';
import { snapToOnsets, refreshLines, finaliseWords, vocalWarp } from '../lyrics/build.ts';

export interface RecWord { text: string; start: number; end: number }

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Uint16Array(n + 1), cur = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function stem(w: string): string { return w.replace(/'s$/, '').replace(/(ing|ed|es|s|ly|er|in')$/, ''); }

/** +2 exact, +1.2 at ≥ 70 % similarity, +1 shared stem of ≥ 3 letters, −1 otherwise */
export function matchScore(a: string, b: string): number {
  if (a === b) return 2;
  const sim = 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);
  if (sim >= 0.7) return 1.2;
  const sa = stem(a), sb = stem(b);
  if (sa.length >= 3 && sa === sb) return 1;
  if (sa.length >= 3 && sb.length >= 3 && (a.startsWith(sb) || b.startsWith(sa))) return 1;
  return -1;
}

export interface AlignResult { matchRate: number; exact: number; fuzzy: number; estimated: number }

const SKIP_LYRIC = -0.6, SKIP_REC = -0.4, SKIP_BACKING = -0.15;
const SYL = 0.28;

/** Overwrites word times/confidence in `ly` from the recognised words. */
export function alignToRecognised(ly: Lyrics, recRaw: RecWord[], a: Analysis | null, opts: { approx?: boolean } = {}): AlignResult {
  const W = ly.words;
  const rec = recRaw.map((r) => ({ ...r, text: normaliseWord(r.text) })).filter((r) => r.text);
  // Whisper attaches leading silence to the first word after a pause: a word far longer than it can be
  // sung starts late, not early. Keep its END and pull the start in (then onto a vocal onset if one is near).
  for (const r of rec) {
    const plausible = 0.35 + 0.45 * Math.max(1, Math.round(r.text.length / 3));
    if (r.end - r.start > Math.max(1.5, plausible * 2)) {
      let st = r.end - plausible;
      if (a) {
        const on = a.vocalOnsets.length ? a.vocalOnsets : a.onsets;
        let best = st, bd = 0.45;
        for (const t of on) { if (t < r.start || t > r.end) continue; const d = Math.abs(t - st); if (d < bd) { bd = d; best = t; } }
        st = best;
      }
      r.start = Math.max(r.start, st);
    }
  }
  const n = W.length, m = rec.length;
  // ---- Needleman–Wunsch ----
  const S = new Float64Array((n + 1) * (m + 1));
  const T = new Uint8Array((n + 1) * (m + 1)); // 1 = diag, 2 = skip lyric, 3 = skip rec
  const skipL = (i: number) => (W[i].backing ? SKIP_BACKING : SKIP_LYRIC);
  for (let i = 1; i <= n; i++) { S[i * (m + 1)] = S[(i - 1) * (m + 1)] + skipL(i - 1); T[i * (m + 1)] = 2; }
  for (let j = 1; j <= m; j++) { S[j] = S[j - 1] + SKIP_REC; T[j] = 3; }
  for (let i = 1; i <= n; i++) {
    const wi = W[i - 1].text;
    for (let j = 1; j <= m; j++) {
      const d = S[(i - 1) * (m + 1) + j - 1] + matchScore(wi, rec[j - 1].text);
      const u = S[(i - 1) * (m + 1) + j] + skipL(i - 1);
      const l = S[i * (m + 1) + j - 1] + SKIP_REC;
      const k = i * (m + 1) + j;
      // ties prefer skipping the LATER lyric word, so repeated words ("burn bright, burn bright") anchor early
      if (d > u + 1e-7 && d >= l - 1e-7) { S[k] = d; T[k] = 1; } else if (u >= l) { S[k] = u; T[k] = 2; } else { S[k] = l; T[k] = 3; }
    }
  }
  const anchor = new Int32Array(n).fill(-1);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const t = T[i * (m + 1) + j];
    if (t === 1) { if (matchScore(W[i - 1].text, rec[j - 1].text) > 0) anchor[i - 1] = j - 1; i--; j--; }
    else if (t === 2) i--; else j--;
  }
  // ---- anchors (strictly increasing in time) ----
  let exact = 0, fuzzy = 0, last = -Infinity;
  const fixed = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const j = anchor[i];
    if (j < 0) continue;
    const r = rec[j];
    if (r.start <= last + 0.02) continue;
    const ex = W[i].text === r.text;
    W[i].start = r.start;
    W[i].end = Math.max(r.start + 0.06, Math.min(r.end, r.start + 1.2 + (ex ? 2 : 0)));
    W[i].confidence = opts.approx ? 0.6 : ex ? 0.96 : 0.75;
    if (ex) exact++; else fuzzy++;
    fixed[i] = 1;
    last = r.start;
  }
  // nothing recognised: keep the plain-text spreading the lyrics already have
  if (exact + fuzzy === 0) return { matchRate: 0, exact: 0, fuzzy: 0, estimated: n };
  // ---- fill the gaps between anchors ----
  const dur = a?.duration ?? (rec.length ? rec[rec.length - 1].end + 2 : n * 0.5);
  const sectionStarts = a ? a.sections.map((s) => s.start) : [];
  let estimated = 0;
  for (let i = 0; i < n;) {
    if (fixed[i]) { i++; continue; }
    let j = i;
    while (j < n && !fixed[j]) j++;
    // gap [i, j): between anchor i-1 and anchor j
    const prev: Word | null = i > 0 ? W[i - 1] : null;
    const next: Word | null = j < n ? W[j] : null;
    const g0 = prev ? Math.min(prev.end, prev.start + 1.2) : (rec.length ? Math.max(0, rec[0].start - 0.2) : 0);
    const g1 = next ? next.start : Math.min(dur, g0 + 60);
    const group = W.slice(i, j);
    const leadSyl = group.reduce((s, w) => s + (w.backing ? 0 : w.syllables), 0) || 1;
    const need = leadSyl * SYL;
    const place = (ws: Word[], t0: number, t1: number) => {
      const tot = ws.reduce((s, w) => s + (w.backing ? 0.5 : w.syllables), 0) || 1;
      let acc = 0;
      for (const w of ws) {
        const k = w.backing ? 0.5 : w.syllables;
        w.start = t0 + ((t1 - t0) * acc) / tot; acc += k;
        w.end = t0 + ((t1 - t0) * acc) / tot;
        w.confidence = 0.35; estimated++;
      }
    };
    if (!prev && next) {
      // before the first anchor: lead into it
      place(group, Math.max(0, g1 - need), g1);
    } else if (g1 - g0 <= need * 1.6 + 0.3 || !next) {
      place(group, Math.min(g0, dur - 0.5), next ? g1 : Math.min(dur, g0 + need));
    } else {
      // instrumental break: finish the previous line right after its anchor …
      const lineOfPrev = prev!.line;
      const head = group.filter((w) => w.line === lineOfPrev);
      const tail = group.filter((w) => w.line !== lineOfPrev);
      let t = g0;
      if (head.length) { const hn = head.reduce((s, w) => s + w.syllables, 0) * SYL; place(head, g0, Math.min(g1, g0 + hn)); t = g0 + hn; }
      if (tail.length) {
        const tn = tail.reduce((s, w) => s + (w.backing ? 0 : w.syllables), 0) * SYL;
        const byLine: Word[][] = [];
        for (const w of tail) { const g = byLine[byLine.length - 1]; if (g && g[0].line === w.line) g.push(w); else byLine.push([w]); }
        const end = Math.min(g1, dur);
        if (byLine.length > 1 && end - t > tn * 1.5) {
          // several whole lines were missed: spread them through the gap (following vocal activity when it
          // is informative), each sung at a natural rate
          const warp = vocalWarp(a, t, end);
          const wts = byLine.map((g) => g.reduce((s, w) => s + (w.backing ? 0 : w.syllables), 0) + 2);
          const totW = wts.reduce((s, c) => s + c, 0);
          let acc = 0;
          byLine.forEach((g, k) => {
            const u0 = acc / totW; acc += wts[k];
            const u1 = acc / totW;
            const s0 = warp ? warp(u0) : t + (end - t) * u0, s1 = warp ? warp(u1) : t + (end - t) * u1;
            const nat = g.reduce((s, w) => s + (w.backing ? 0 : w.syllables), 0) * SYL * 1.3;
            place(g, s0, Math.min(s1 - 0.15, s0 + nat));
          });
        } else {
          // … and start the rest at a section start inside the break, else lead into the next anchor
          const sec = sectionStarts.find((s) => s > t + 0.5 && s + tn <= g1 + 0.2);
          if (sec !== undefined && g1 - (sec + tn) < 6) place(tail, sec, Math.min(g1, sec + tn));
          else place(tail, Math.max(t, g1 - tn), g1);
        }
      }
    }
    i = j;
  }
  // only the estimated words snap to onsets
  if (a) { if (opts.approx) snapToOnsets(ly, a, 0.7, 0.16); else snapToOnsets(ly, a, 0.5); }
  // monotone clean-up inside each line
  for (const line of ly.lines) {
    let t = -Infinity;
    for (const wi of line.words) {
      const w = W[wi];
      if (w.backing) continue;
      if (w.start < t) { w.start = t + 0.02; if (w.end < w.start + 0.06) w.end = w.start + 0.06; }
      t = w.start;
    }
  }
  ly.source = 'auto';
  refreshLines(ly, a);
  finaliseWords(ly, a);
  const leadN = W.filter((w) => !w.backing).length || 1;
  return { matchRate: (exact + fuzzy) / leadN, exact, fuzzy, estimated };
}

/** Phrase-level recognition → words, split by syllables (fallback when a model has no word timing). */
export function phrasesToWords(phrases: { text: string; start: number; end: number }[], count: (w: string) => number, period = 0): RecWord[] {
  const out: RecWord[] = [];
  for (const p of phrases) {
    const ws = p.text.split(/\s+/).filter((w) => normaliseWord(w));
    const syl = ws.map((w) => count(normaliseWord(w)));
    const tot = syl.reduce((s, c) => s + c, 0) || 1;
    // with a known tempo, sing one syllable per `period` from the phrase start (if that fits the phrase)
    const step = period > 0 && tot * period <= p.end - p.start ? period : (p.end - p.start) / tot;
    let acc = 0;
    for (let i = 0; i < ws.length; i++) {
      const s = p.start + acc * step; acc += syl[i];
      out.push({ text: ws[i], start: s, end: p.start + acc * step });
    }
  }
  return out;
}

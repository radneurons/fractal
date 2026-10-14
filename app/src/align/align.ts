// Align the user's lyrics to speech-recognition output (word or phrase timestamps).
// Global sequence alignment (Needleman–Wunsch) with fuzzy word similarity, so misheard words,
// missed words and hallucinated words (common on music) don't derail it; then every lyric word
// without a match is placed between its matched neighbours.
import { normalize, tokenize, countSyllables } from '../lyrics/parse';
import type { RawLine } from '../lyrics/parse';

export interface AsrChunk { text: string; start: number; end: number }
export interface AlignResult { lines: RawLine[]; confidence: number[]; matched: number; total: number }

/** Split recogniser chunks (a word, or a whole phrase when only phrase timing is available) into timed words. */
export function asrWords(chunks: AsrChunk[]): { norm: string; start: number; end: number }[] {
  const out: { norm: string; start: number; end: number }[] = [];
  for (const c of chunks) {
    if (!(c.end >= c.start)) continue;
    const toks = tokenize(c.text).map(t => ({ t, n: normalize(t) })).filter(x => x.n);
    if (!toks.length) continue;
    const syl = toks.map(x => countSyllables(x.t)), tot = syl.reduce((a, b) => a + b, 0);
    let acc = 0;
    toks.forEach((x, k) => { const s = c.start + (c.end - c.start) * acc / tot; acc += syl[k]; out.push({ norm: x.n, start: s, end: c.start + (c.end - c.start) * acc / tot }); });
  }
  return out;
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) { cur[0] = i; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); [prev, cur] = [cur, prev]; }
  return prev[n];
}
/** 2 exact, 1.2 close (≥ 70 % similar), 1 shared stem, −1 different. */
export function similarity(a: string, b: string): number {
  const x = a.replace(/'/g, ''), y = b.replace(/'/g, '');
  if (!x || !y) return -1;
  if (x === y) return 2;
  const r = 1 - lev(x, y) / Math.max(x.length, y.length);
  if (r >= .7) return 1.2;
  if (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x))) return 1;
  return -1;
}

/**
 * @param lyricLines the user's lyric lines (plain text)
 * @param chunks recogniser output
 * @param duration audio length (seconds)
 * @param sectionStarts song section boundaries: a missed line inside an instrumental break starts at one
 */
export function alignLyrics(lyricLines: string[], chunks: AsrChunk[], duration: number, sectionStarts: number[] = []): AlignResult {
  const lines = lyricLines.map(l => l.replace(/\[[^\]]*\]|<[^>]*>/g, '').trim()).filter(Boolean).map(l => tokenize(l));
  const L = lines.flatMap((ws, li) => ws.map(w => ({ w, li, norm: normalize(w), syl: countSyllables(w) })));
  const A = asrWords(chunks);
  const n = L.length, m = A.length;
  const GAP_L = -0.6, GAP_A = -0.4;           // skipping a lyric word (missed) costs more than skipping a recognised one (hallucinated)
  // DP over (n+1)×(m+1); 0 = diag, 1 = up (skip lyric), 2 = left (skip asr)
  const W = m + 1, score = new Float32Array((n + 1) * W), dir = new Uint8Array((n + 1) * W);
  for (let i = 1; i <= n; i++) { score[i * W] = i * GAP_L; dir[i * W] = 1; }
  for (let j = 1; j <= m; j++) { score[j] = j * GAP_A; dir[j] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const d = score[(i - 1) * W + j - 1] + similarity(L[i - 1].norm, A[j - 1].norm);
    const u = score[(i - 1) * W + j] + GAP_L, l = score[i * W + j - 1] + GAP_A;
    const k = i * W + j;
    if (d >= u && d >= l) { score[k] = d; dir[k] = 0; } else if (u >= l) { score[k] = u; dir[k] = 1; } else { score[k] = l; dir[k] = 2; }
  }
  // backtrack → lyric index → asr index (only real matches)
  const match = new Int32Array(n).fill(-1), sim = new Float32Array(n);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const k = i * W + j, d = i > 0 && j > 0 ? dir[k] : i > 0 ? 1 : 2;
    if (d === 0) { const s = similarity(L[i - 1].norm, A[j - 1].norm); if (s > 0) { match[i - 1] = j - 1; sim[i - 1] = s; } i--; j--; }
    else if (d === 1) i--; else j--;
  }
  // times: anchors from matches, the rest placed between anchors by syllables
  const start = new Float64Array(n).fill(NaN), conf = new Array<number>(n).fill(.35);
  for (let i = 0; i < n; i++) if (match[i] >= 0) { start[i] = A[match[i]].start; conf[i] = sim[i] >= 2 ? .96 : .75; }
  // keep anchors strictly increasing (drop any that would go backwards)
  let last = -Infinity; for (let i = 0; i < n; i++) if (!isNaN(start[i])) { if (start[i] <= last) { start[i] = NaN; conf[i] = .35; } else last = start[i]; }
  const PACE = .28;                              // seconds per syllable when nothing bounds a run of unmatched words
  for (let i = 0; i < n;) {
    if (!isNaN(start[i])) { i++; continue; }
    let j = i; while (j < n && isNaN(start[j])) j++;
    const prevI = i - 1, nextI = j < n ? j : -1;
    const syl = L.slice(i, j).map(x => x.syl), tot = syl.reduce((a, b) => a + b, 0);
    if (prevI >= 0 && nextI >= 0) {
      // a recognised word's end often runs on into a following break: trust it for at most 1.2 s
      const a0 = Math.max(start[prevI] + .12, Math.min(A[match[prevI]].end, start[prevI] + 1.2)), a1 = start[nextI];
      if (a1 - a0 <= tot * PACE * 1.6) {          // a normal gap: spread the run across it
        let acc = 0; for (let k = i; k < j; k++) { start[k] = a0 + (a1 - a0) * acc / Math.max(1, tot); acc += L[k].syl; }
      } else {                                   // an instrumental break: finish the previous line, lead into the next anchor
        let s0 = i, acc = 0;
        for (; s0 < j && L[s0].li === L[prevI].li; s0++) { start[s0] = a0 + acc * PACE; acc += L[s0].syl; }
        // the remaining words: from a section start inside the break if there is one, else leading into the next anchor
        let need = 0; for (let k = s0; k < j; k++) need += L[k].syl * PACE;
        const sec = sectionStarts.find(t => t > a0 + .2 && t + need < a1 - .1);
        if (sec !== undefined) { let acc2 = 0; for (let k = s0; k < j; k++) { start[k] = sec + acc2 * PACE; acc2 += L[k].syl; } }
        else { let back = 0; for (let k = j - 1; k >= s0; k--) { back += L[k].syl; start[k] = a1 - back * PACE; } }
      }
    } else if (nextI >= 0) {                     // before the first anchor: count back from it
      let acc = tot; for (let k = i; k < j; k++) { start[k] = Math.max(0, start[nextI] - acc * PACE); acc -= syl[k - i]; }
    } else if (prevI >= 0) {                     // after the last anchor
      let acc = 1; for (let k = i; k < j; k++) { start[k] = Math.min(duration - .1, start[prevI] + acc * PACE + .1); acc += syl[k - i]; }
    } else {                                     // nothing recognised: spread over the file
      let acc = 0; for (let k = i; k < j; k++) { start[k] = duration * .05 + duration * .9 * acc / Math.max(1, tot); acc += syl[k - i]; }
    }
    i = j;
  }
  for (let i = 1; i < n; i++) if (start[i] <= start[i - 1]) start[i] = start[i - 1] + .03;   // strictly increasing
  // rebuild timed lines
  const out: RawLine[] = []; let k = 0;
  lines.forEach(ws => { const words = ws.map(w => ({ text: w, start: start[k++] })); out.push({ text: ws.join(' '), start: words[0].start, words }); });
  out.forEach((ln, i) => { ln.end = out[i + 1]?.start; });
  const matched = Array.from(match).filter(x => x >= 0).length;
  return { lines: out, confidence: conf, matched, total: n };
}

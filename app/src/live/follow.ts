// Lyric following (SPEC §14.3). Three modes:
//   cue  — the operator advances line by line (Space, PageDown, a MIDI note, a pedal); the line's words reveal at
//          the expected syllable rate × the live tempo.
//   word — each tap reveals the next word (tap sync, live).
//   auto — experimental: vocal onsets are matched to the expected syllables of the current and next line with an
//          online monotonic alignment (a greedy DTW confined to a 2-line band); the follower advances when the
//          cumulative match reaches 70 %. Any operator press falls back to cue mode.
// The follower hands the effects a small Lyrics view (current line + one line of look-ahead) whose word times are
// the reveal times; `version` changes whenever that view must be laid out again.
import type { Line, Lyrics, Word } from '../types.ts';
import type { FollowState, LiveWord } from './types.ts';

export type FollowMode = 'cue' | 'word' | 'auto';
/** unrevealed words sit this far in the future so effects keep them hidden but can still lay them out */
export const FAR = 1e5;
const MATCH_ADVANCE = 0.7;

export class Follower {
  mode: FollowMode = 'cue';
  line = -1;
  version = 0;
  /** reveal time per original word id (Infinity = not revealed) */
  private reveal = new Map<number, number>();
  private cueAt = -Infinity;
  private heard = 0; // vocal onsets matched in the current line (auto)
  constructor(readonly ly: Lyrics) {}

  private words(li: number): Word[] { const l = this.ly.lines[li]; return l ? l.words.map((i) => this.ly.words[i]).filter((w) => !!w && !w.backing) : []; }
  private syll(w: Word): number { return Math.max(1, w.syllables || 1); }
  get done(): boolean { return this.line >= this.ly.lines.length - 1 && this.words(this.line).every((w) => this.reveal.has(w.id)); }

  /** Operator: next line (cue mode timing). From word/auto modes a press falls back to cue. */
  cue(now: number, bpm: number): void {
    if (this.mode === 'auto') this.mode = 'cue';
    if (this.line >= this.ly.lines.length - 1) return;
    this.line++;
    this.cueAt = now; this.heard = 0;
    // expected syllable rate: an eighth note at the live tempo, clamped to singable rates
    const per = Math.min(0.42, Math.max(0.12, (60 / (bpm > 0 ? bpm : 110)) / 2));
    let t = now;
    for (const w of this.words(this.line)) { this.reveal.set(w.id, t); t += this.syll(w) * per; }
    this.version++;
  }
  /** Operator: previous line (corrections). */
  back(): void {
    if (this.line < 0) return;
    for (const w of this.words(this.line)) this.reveal.delete(w.id);
    this.line--;
    this.version++;
  }
  /** Word cue: each tap is the next word; the first tap after a finished line opens the next line. */
  tap(now: number): void {
    if (this.mode === 'auto') this.mode = 'word';
    let ws = this.words(this.line);
    if (this.line < 0 || ws.every((w) => this.reveal.has(w.id))) {
      if (this.line >= this.ly.lines.length - 1) return;
      this.line++; this.cueAt = now; this.heard = 0; ws = this.words(this.line);
    }
    const next = ws.find((w) => !this.reveal.has(w.id));
    if (next) this.reveal.set(next.id, now);
    this.version++;
  }
  /** Auto-follow: feed vocal onsets (live clock) with the current vocal activity. */
  hear(onsets: number[], vocal: number): void {
    if (this.mode !== 'auto') return;
    for (const t of onsets) {
      if (vocal < 0.3) continue; // not a sung onset
      const gap = t - this.prevOnset; this.prevOnset = t;
      if (this.line < 0) { this.openAuto(t); continue; }
      const ws = this.words(this.line);
      const total = ws.reduce((s, w) => s + this.syll(w), 0);
      // the band moves down one line after a breath once the line is mostly matched, or when it is over-full
      if ((this.heard / Math.max(1, total) >= MATCH_ADVANCE && gap > 0.35) || this.heard >= total) { this.openAuto(t); continue; }
      this.heard++;
      // reveal every word whose first syllable has now been heard (monotonic: never un-reveals)
      let acc = 0;
      for (const w of ws) { if (!this.reveal.has(w.id) && this.heard > acc) { this.reveal.set(w.id, t); this.version++; } acc += this.syll(w); }
    }
  }
  private prevOnset = -Infinity;
  private openAuto(t: number): void {
    if (this.line >= this.ly.lines.length - 1) return;
    this.line++; this.cueAt = t; this.heard = 1; this.prevOnset = t;
    const first = this.words(this.line)[0];
    if (first) this.reveal.set(first.id, t);
    this.version++;
  }
  /** match of the current line so far (auto), 0..1 */
  get match(): number { const ws = this.words(this.line); const total = ws.reduce((s, w) => s + this.syll(w), 0); return total ? Math.min(1, this.heard / total) : 0; }

  /** Current line + one line of look-ahead, re-indexed, with reveal times as word times. */
  view(): Lyrics {
    const words: Word[] = [], lines: Line[] = [];
    for (const [k, li] of [this.line, this.line + 1].entries()) {
      const src = this.ly.lines[li];
      if (!src) continue;
      const ids: number[] = [];
      let farK = 0;
      for (const w of this.words(li)) {
        const r = this.reveal.get(w.id);
        const start = r ?? FAR + (k * 50) + (farK++) * 0.4;
        const dur = Math.max(0.25, Math.min(1.2, w.end - w.start || 0.35));
        const id = words.length;
        words.push({ ...w, id, line: lines.length, start, end: start + dur, syllableTimes: undefined });
        ids.push(id);
      }
      if (!ids.length) continue;
      lines.push({ ...src, idx: lines.length, words: ids, start: words[ids[0]].start, end: words[ids[ids.length - 1]].end, section: 0, repeatOf: undefined });
    }
    return { words, lines, source: this.ly.source, meta: this.ly.meta };
  }

  state(): FollowState {
    const words: LiveWord[] = this.words(this.line).map((w) => ({ id: w.id, text: w.display || w.text, line: this.line, shownAt: this.reveal.get(w.id) ?? Infinity, role: w.role }));
    return { mode: this.mode, line: this.line, next: Math.min(this.line + 1, this.ly.lines.length - 1), words, match: this.mode === 'auto' ? this.match : 1 };
  }
}

// Voices, duets and backing vocals (SPEC §5A.2): helpers shared by effects and the UI.
import type { Lyrics, Line, Word } from '../types.ts';
export { takeVoiceTag } from './parse.ts';

export const VOICE_COLOURS: Record<string, string> = { A: '#4AA8FF', B: '#FF5FA2', all: '#58D68D' };

export function voicesIn(ly: Lyrics): string[] {
  const s = new Set<string>();
  for (const w of ly.words) if (w.voice) s.add(w.voice);
  return [...s].sort();
}

export function isDuet(ly: Lyrics): boolean { return voicesIn(ly).filter((v) => v !== 'all').length > 1; }

/** 0 = voice A / default slot, 1 = voice B slot, 2 = both */
export function voiceSlot(w: Pick<Word, 'voice'> | Pick<Line, 'voice'>): 0 | 1 | 2 {
  return w.voice === 'B' ? 1 : w.voice === 'all' ? 2 : 0;
}

/** Does voice B sing while voice A is singing this line? (layout effects put B on the opposite side) */
export function overlapsOtherVoice(ly: Lyrics, line: Line): boolean {
  if (!line.voice || line.voice === 'all') return false;
  return ly.lines.some((o) => o !== line && o.voice && o.voice !== line.voice && o.voice !== 'all' && o.start < line.end && o.end > line.start);
}

export function setLineVoice(ly: Lyrics, lineIdx: number, voice: string | undefined): void {
  const line = ly.lines[lineIdx];
  if (!line) return;
  line.voice = voice;
  for (const i of line.words) if (!ly.words[i].backing) ly.words[i].voice = voice;
}

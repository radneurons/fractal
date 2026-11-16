// Translation (SPEC §5A.3). No machine translation is built in: a second lyrics file is matched to the lines.
import type { Line } from '../types.ts';
export { attachTranslation } from './build.ts';

/** What to show for a line at time t under the global "Show translation" setting. */
export function translationState(line: Line, t: number, mode: 'off' | 'under' | 'alternate'): { original: boolean; translation: string | null } {
  if (mode === 'off' || !line.translation) return { original: true, translation: null };
  if (mode === 'under') return { original: true, translation: line.translation };
  // alternate: the translation replaces the line for its last 40 %
  const p = (t - line.start) / Math.max(0.2, line.end - line.start);
  return p >= 0.6 ? { original: false, translation: line.translation } : { original: true, translation: null };
}

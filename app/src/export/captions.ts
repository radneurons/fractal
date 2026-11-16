// Caption sidecars (SPEC §13.5): SRT, VTT, LRC, ASS karaoke and a YouTube chapter list.
import type { Lyrics, Section } from '../types.ts';
import { toEnhancedLrc } from '../lyrics/build.ts';

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
function clock(t: number, sep: string, msDigits = 3): string {
  const ms = Math.max(0, Math.round(t * 10 ** msDigits));
  const unit = 10 ** msDigits;
  const s = Math.floor(ms / unit);
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}${sep}${String(ms % unit).padStart(msDigits, '0')}`;
}

export function toSrt(ly: Lyrics, offset = 0): string {
  return ly.lines.map((l, i) => `${i + 1}\n${clock(l.start - offset, ',')} --> ${clock(Math.max(l.end, l.start + 0.3) - offset, ',')}\n${l.text}${l.translation ? '\n' + l.translation : ''}\n`).join('\n');
}
export function toVtt(ly: Lyrics, offset = 0): string {
  return 'WEBVTT\n\n' + ly.lines.map((l) => `${clock(l.start - offset, '.')} --> ${clock(Math.max(l.end, l.start + 0.3) - offset, '.')}\n${l.voice ? `<v ${l.voice}>` : ''}${l.text}\n`).join('\n');
}
export function toLrc(ly: Lyrics, meta: { title?: string; artist?: string }): string { return toEnhancedLrc(ly, meta); }

/** ASS with \k syllable karaoke tags, one style per voice and the translation as a second style. */
export function toAss(ly: Lyrics, meta: { title?: string; width?: number; height?: number } = {}, offset = 0): string {
  const W = meta.width ?? 1920, H = meta.height ?? 1080;
  const ts = (t: number) => { const cs = Math.max(0, Math.round(t * 100)); return `${Math.floor(cs / 360000)}:${pad((cs % 360000) / 6000)}:${pad((cs % 6000) / 100)}.${pad(cs % 100)}`; };
  const style = (name: string, colour: string, size: number, marginV: number) => `Style: ${name},Arial,${size},&H00FFFFFF,${colour},&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,60,60,${marginV},1`;
  let out = `[Script Info]\nTitle: ${meta.title ?? 'Lyrics'}\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n`;
  out += [style('A', '&H00FFA84A', Math.round(H * 0.06), Math.round(H * 0.12)), style('B', '&H00A25FFF', Math.round(H * 0.06), Math.round(H * 0.12)), style('Both', '&H008DD658', Math.round(H * 0.06), Math.round(H * 0.12)), style('Translation', '&H00FFFFFF', Math.round(H * 0.035), Math.round(H * 0.05))].join('\n');
  out += '\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  for (const l of ly.lines) {
    const ws = l.words.map((i) => ly.words[i]).filter((w) => !w.backing);
    if (!ws.length) continue;
    let text = '', cursor = l.start;
    for (const w of ws) {
      const syl = w.syllableTimes && w.syllableTimes.length ? w.syllableTimes : [{ text: w.display, start: w.start, end: w.end }];
      syl.forEach((s, i) => {
        const gap = Math.round((s.start - cursor) * 100);
        if (gap > 0) text += `{\\k${gap}}`;
        const d = Math.max(1, Math.round((s.end - s.start) * 100));
        const joined = syl.map((x) => x.text).join('');
        const trail = i === syl.length - 1 && w.display.startsWith(joined) ? w.display.slice(joined.length) : '';
        text += `{\\k${d}}${syl.length > 1 ? s.text : w.display}${trail}${i === syl.length - 1 ? ' ' : ''}`;
        cursor = s.end;
      });
    }
    const st = l.voice === 'B' ? 'B' : l.voice === 'all' ? 'Both' : 'A';
    out += `Dialogue: 0,${ts(l.start - offset)},${ts(Math.max(l.end, l.start + 0.3) - offset)},${st},,0,0,0,,${text.trim()}\n`;
    if (l.translation) out += `Dialogue: 0,${ts(l.start - offset)},${ts(Math.max(l.end, l.start + 0.3) - offset)},Translation,,0,0,0,,${l.translation}\n`;
  }
  return out;
}

/** YouTube chapter list from sections ("0:00 Intro"), repeated labels numbered. */
export function toChapters(sections: Section[]): string {
  const total = new Map<string, number>(), seen = new Map<string, number>();
  for (const s of sections) total.set(s.label, (total.get(s.label) ?? 0) + 1);
  const lines: string[] = [];
  sections.forEach((s, i) => {
    const n = (seen.get(s.label) ?? 0) + 1;
    seen.set(s.label, n);
    const name = s.label[0].toUpperCase() + s.label.slice(1) + ((total.get(s.label) ?? 0) > 1 ? ` ${n}` : '');
    const t = i === 0 ? 0 : Math.round(s.start);
    lines.push(`${Math.floor(t / 60)}:${pad(t % 60)} ${name}`);
  });
  return lines.join('\n') + '\n';
}

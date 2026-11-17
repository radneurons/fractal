// RISE — the SDK example (docs/EFFECTS.md). Each line is laid out once in prepare; in render every word fades and
// rises into place on its own onset and settles; the current line is centred, the previous one drifts up and fades.
// It is also what `npm run new-effect <name>` copies, so it stays small and plain.
import { defineEffect, range, colour, select, type Kit, type Ctx2D } from '../sdk.ts';

interface Placed { id: number; text: string; x: number; y: number; cap: number; font: string }
interface RLine { start: number; end: number; words: Placed[]; width: number; height: number }
interface State { lines: RLine[]; bg: string; ink: string }

function drawLine(k: Kit, s: State, g: Ctx2D, li: number, t: number, mask: boolean): void {
  const L = s.lines[li];
  if (!L) return;
  const rise = k.H * 0.06 * k.num('rise');
  // after the next line starts, this one drifts up and fades out over 0.6 s
  const next = s.lines[li + 1];
  const out = next ? k.ease.smooth((t - next.start + 0.1) / 0.6) : 0;
  if (out >= 1) return;
  const ox = (k.W - L.width) / 2, oy = (k.H - L.height) / 2 - out * k.H * 0.12;
  for (const p of L.words) {
    const w = k.words[p.id];
    const st = k.wordState(w, t, 0.35);
    if (st.phase === 'before') continue;
    const e = k.ease.outCubic(st.enter);
    const alpha = e * (1 - out);
    if (alpha <= 0.001) continue;
    k.setFont(g, p.font, p.cap);
    g.globalAlpha = mask ? 1 : alpha;
    // the mask is coverage: words at full size where they are, nothing else (R/B coverage, G = age)
    g.fillStyle = mask ? k.maskFill(st.age, alpha) : s.ink;
    g.fillText(p.text, ox + p.x, oy + p.y + (1 - e) * rise);
  }
  g.globalAlpha = 1;
}

export default defineEffect<State>({
  id: 'rise',
  name: 'Rise (SDK example)',
  description: 'Words fade and rise on their onsets. The minimal SDK example — copy it to start a new effect.',
  // low everywhere: the Auto-Director should rarely pick the example over the house effects
  affinity: { energyHigh: 0.25, energyLow: 0.4, speech: 0.45, denseLyrics: 0.35, sparseLyrics: 0.35, darkMood: 0.3, brightMood: 0.3, fastTempo: 0.25 },
  supportsTransparent: true,
  params: [
    select('font', 'Font', 'Type', 'montserrat', ['montserrat', 'oswald', 'caslon', 'bebas'], false),
    range('size', 'Size', 'Type', 1, 0.5, 1.8, 0.01, false),
    range('rise', 'Rise distance', 'Motion', 1, 0, 3, 0.01),
    colour('ink', 'Ink', 'Colours', '#F4F1EA'),
  ],
  prepare(k) {
    const font = k.str('font');
    const cap = Math.min(k.W, k.H) * 0.075 * k.num('size');
    const lines: RLine[] = k.lines.map((line) => {
      const lay = k.layoutLine(line, { maxW: k.W * 0.84, cap, fonts: { hero: font, support: font, conn: font }, heroScale: 1.25, connScale: 0.8, align: 'center' });
      return {
        start: line.start, end: line.end, width: lay.width, height: lay.height,
        words: lay.words.map((p) => ({ id: p.w.id, text: p.text, x: p.x, y: p.y, cap: p.cap, font: p.font })),
      };
    });
    const pal = k.palette({ bg: '#101418', ink: '#F4F1EA' });
    return { lines, bg: pal.bg, ink: k.str('ink') || pal.ink };
  },
  render(k, s, t, g) {
    if (!k.settings.transparentBackground) {
      g.fillStyle = s.bg; g.fillRect(0, 0, k.W, k.H);
      // a soft glow that breathes with the beat (scaled by the flash guard)
      const r = Math.max(k.W, k.H) * (0.45 + 0.04 * k.beatPulse(t) * k.flashAttenuation(t));
      const grd = g.createRadialGradient(k.W / 2, k.H / 2, 0, k.W / 2, k.H / 2, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.07)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, k.W, k.H);
    }
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    const li = k.lineAt(t, 0.4);
    drawLine(k, s, g, li - 1, t, false);
    drawLine(k, s, g, li, t, false);
  },
  renderMask(k, s, t, g) {
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    const li = k.lineAt(t, 0.4);
    drawLine(k, s, g, li - 1, t, true);
    drawLine(k, s, g, li, t, true);
  },
});

// self-accepting module: edits hot-swap the effect without reloading the page
if (import.meta.hot) import.meta.hot.accept();

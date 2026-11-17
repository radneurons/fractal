# Writing effects for Lyric Engine Pro

An effect turns a song (audio analysis + timed lyrics) into frames. The engine calls it with a time `t` and it draws
that instant. Everything else — compositing, transitions, materials, post, the flash guard, export — is the stage's job.

```bash
npm run new-effect tide        # scaffolds app/src/effects/user/tide.ts from the RISE example
npm run dev                    # the effect appears at the end of the effect grid and hot-reloads on save
npx vite build && node scripts/e2e-effect-tide.mjs   # determinism + mask check
```

Files in `app/src/effects/user/*.ts` are discovered at build time (`import.meta.glob`). Nothing is ever loaded from
the network: an effect ships with the build or comes from your own files.

## The contract

```ts
import { defineEffect, range, colour, select } from '../sdk.ts';

export default defineEffect<State>({
  id: 'tide', name: 'Tide', description: 'One sentence the effect picker shows.',
  params: [range('rise', 'Rise distance', 'Motion', 1, 0, 3)],   // live params update without re-prepare
  affinity: { energyHigh: 0.6, sparseLyrics: 0.7 },            // 0..1 per section trait (Auto-Director)
  supportsTransparent: true,                                     // can render on a transparent background
  supportsLive: false,                                           // live mode needs renderLive too
  prepare(k)               { /* lay everything out; return State */ },
  render(k, state, t, g)   { /* draw the frame at t */ },
  renderMask(k, state, t, g) { /* every visible word, white on black, nothing else */ },
  dispose(state)           { /* optional */ },
});
```

| Hook | When | May | Must not |
| --- | --- | --- | --- |
| `prepare(k)` | once per song / size / non-live param change | measure text, build atlases, plan cameras, allocate | depend on the render time |
| `render(k, s, t, g)` | every frame (preview, export, scrubbing in any order) | read `s`, `k`, `t` | mutate `s`, keep anything between calls, block |
| `renderMask(k, s, t, g)` | when a layer mask, material or a transition needs word coverage | draw words where `render` draws them | draw backgrounds, decoration or glow |
| `renderLive(k, s, t, g, live)` | live mode only | read `live` (online features, cued words) | assume precomputed beats exist |

`renderMask` is required: `npm run build` runs `scripts/lint-effects.mjs`, which fails the build when it is missing,
when `Math.random()` appears, or when an effect reads the wall clock.

`kind: 'gl'` gives `render(k, s, t, gl)` with `gl = { scope, target, gl, layer(name) }` instead of a 2D context:
draw into `target` through `scope` (programs, textures and framebuffers in the shared WebGL2 context, freed for you).

### The kit

| Helper | What it gives you |
| --- | --- |
| `k.W, k.H, k.quality` | output size; `'export'` renders must be full quality |
| `k.words, k.lines, k.analysis, k.settings` | lyrics (sync offset applied), analysis (beats, sections, bands at 60 fps, f0, chords…), global settings |
| `k.num/bool/str(key)` | your params |
| `k.wordState(w, t, entrance)` | the word's phase and progress — see below |
| `k.lineAt(t, lead)`, `k.layoutLine(line, opts)` | current line; rows of words measured in cap-height units |
| `k.graphemes`, `k.display(w)`, `k.setFont`, `k.textWidth` | text helpers (case mode, punctuation, fonts by key) |
| `k.camera.keys/at/apply/fit` | hold-then-move camera keys and sampling |
| `k.sdf`, `k.skeleton`, `k.icon`, `k.icons` | SDF glyphs, single-stroke glyph skeletons, 24 vector icons |
| `k.palette(fallback)` | artwork palette, else one from the song's key (hue on the circle of fifths) |
| `k.seed(n)` | a fresh seeded PRNG per purpose — `k.seed(1)` is the same sequence every frame |
| `k.sample(arr, t)`, `k.beatPulse(t)`, `k.downbeatPulse(t)` | read 60 fps arrays; closed-form pulses on beats |
| `k.flashAttenuation(t)` | 0..1; multiply anything flashy by it (photosensitivity guard) |
| `k.maskFill(age, level)` | the mask colour for a word that landed `age` s ago (R/B coverage, G age) |

## Word timing: `wordState`

A word **lands** exactly at its onset minus the global anticipation. Its entrance starts `entrance` seconds earlier.
After its own span it stays **sung** for at least the minimum read time, so a fast word is still readable.

```
            entrance        land = start − anticipation
   before   |<-------->|    |                  end                 end + minRead
 ───────────┼──────────┼────┼───────────────────┼──────────────────────┼──────────── t
            │ entering │ landed (sung 0 → 1)    │ sung (held)          │ after
            enter 0 → 1      syllable / syllableProgress advance         (fade it out)
                         age = 0 at the landing, negative before
```

- `phase`: `before | entering | landed | sung | after`
- `enter`: 0→1 through the entrance, exactly 1 at the landing
- `sung`: 0→1 through the word's own span; `syllable`, `syllableProgress` follow the syllable timing
- `age`: seconds since the landing (use it for settle springs and the mask's G channel)

**Anticipation** (Settings → Timing, default 90 ms) makes words land slightly before they are heard, which reads
as "on time" to the eye. **Minimum read time** (default 600 ms) keeps short words up long enough to be read. Use
`wordState` instead of reading `w.start` yourself and both settings work in your effect for free.

## Do and don't

Do
- lay out in `prepare`, look things up in `render`. A `render` should be arithmetic and drawing.
- derive every random choice from `k.seed(n)` or `k.hash(a, b, c)` — the same seed gives the same video.
- make motion a function of `t` with closed forms (eases, springs evaluated from `age`, `beatPulse`).
- scale strobes, flashes and big brightness jumps by `k.flashAttenuation(t)`.
- honour `k.settings.reduceMotion` (calmer camera, fades instead of flights) and `transparentBackground`.
- keep `renderMask` geometrically identical to `render` for the words.

Don't
- use `Math.random()`, `Date.now()` or `performance.now()` in an effect.
- keep frame-to-frame state (velocities, particle arrays updated per frame, "last t"): scrubbing, export
  and transitions render frames out of order, and the determinism check renders them in reverse.
- block in `render` (no awaits, no image decoding, no `getImageData` on large canvases).
- draw anything but words into the mask.

## Checking an effect

`node scripts/e2e-effect.mjs --effects tide` renders four times, then the same times in reverse order, then again
after a re-prepare. Every frame must be bit-identical, at least two must differ, and the mask must be lit while words
are on screen. `node scripts/e2e-determinism.mjs` runs the same idea over every effect.

## User effects

### Rise (`rise`)

The SDK example: words fade and rise on their onsets; the previous line drifts up and out. `app/src/effects/user/rise.ts`.

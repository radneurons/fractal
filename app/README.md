# Lyric Engine Pro (v3)

Kinetic typography for music and speech, in the browser. Drop in a song and its lyrics (LRC, SRT, VTT or plain text —
or let Whisper transcribe and align them), and the engine analyses the audio, directs the words and renders a lyric
video with one of twenty-one effects, or a whole Auto-Directed plan, exported frame-exactly to MP4/WebM/GIF with
sidecars. Live mode runs the same effects from a microphone for concerts, karaoke and streams.

Vite + TypeScript, no framework, no 3D library; all DSP is hand-written and deterministic. The full brief is
[`docs/SPEC.md`](../docs/SPEC.md); writing effects is documented in [`docs/EFFECTS.md`](../docs/EFFECTS.md).

```bash
cd app
npm install
npm run dev          # http://localhost:5173  (?live = presenter view, ?live&output = output page)
npm test             # Node unit tests (analysis, lyrics, alignment, modulation, project, syllables, flash, online, director, robustness)
npx vite build       # runs the effect lint and the type check first via `npm run build`
```

## What is in the box

| Area | Where | Notes |
| --- | --- | --- |
| Audio analysis | `src/analysis/` (worker, IndexedDB cache) | STFT 2048/256 @ 22.05 kHz, HPSS, Ellis DP beats, downbeats, meter, Foote novelty + repeats → sections, drops, Krumhansl key + key changes, Viterbi chords, pYIN-lite f0, vocal activity, BS.1770 loudness, mood |
| Lyrics | `src/lyrics/` | LRC (enhanced/word), SRT, VTT, plain; voices and backing vocals, syllables (hyphenation + DP timing on vocal onsets), translation by overlap or index, tap sync |
| Auto-sync | `src/align/` | Whisper (transformers.js) transcription + Needleman–Wunsch alignment to the lyric text |
| Director | `src/director/` | roles, stress, concepts and elements (700+ word lexicon); Auto-Director beam search with transitions and a storyboard |
| Effects | `src/effects/` | 21 effects (below) + SDK effects in `src/effects/user/` |
| Compositor | `src/compose/`, `src/render/` | one shared WebGL2 context; layers with blend modes and word masks, 12 materials, modulation matrix, automation lanes, post (bloom, grain, chroma, vignette, distortion, halation, LUTs, letterbox, motion blur) |
| Safety | `src/render/flashguard.ts` | WCAG 2.3.1 general + red flash guard: pre-pass, attenuation, verification; runs on every export and online in live mode |
| Projects | `src/project/` | IndexedDB projects, zip project files, Looks (presets), undo/redo history |
| Export | `src/export/` | WebCodecs MP4 (H.264) / WebM (VP9, alpha), PNG-sequence fallback, GIF, batch presets, loudness normalisation, LRC/SRT/VTT/ASS/chapters sidecars |
| Live | `src/live/`, `src/analysis/online.ts`, `src/ui/live.ts` | mic / tab / rehearsal input → AudioWorklet → worker; online beats/tempo/downbeats; cue / word-cue / auto-follow; presenter view, audience window, `?live&output` |
| SDK | `src/effects/sdk.ts`, `npm run new-effect` | `defineEffect(spec)` with a helper kit; build lint; hot reload |

The twenty-one effects: BROADSIDE, ELEMENTS, MISSION POSTER, SWARM, LIQUID CHROME, DROSTE, PRESS, POP-UP, NEON, SIGNAL,
RANSOM, MANDALA, FIREWORKS, SUMI, MONOLITH, KARAOKE — the spec's sixteen — and five added after it:

- BREAKOUT: a campaign-style title sequence in pure type; giant words punch out of a letterbox window over its fixed
  bars, with colour fields, barcodes and UI chrome, stickers, ink spatter, torn paper and halftone, snapped to the beat.
- EDITORIAL: fashion-lookbook type; words that fill the frame edge to edge, side-turned words, red split panels, a
  paper card on a desk, hard cuts with motion-blur echoes, words so big the frame crops them.
- COLD SNAP: an ice motion-graphics trailer where every line is a different cut (lightning slash, type tunnel,
  shattering block, diagonal wipes, toppling word tower, trampoline drop, 360° roll, barrage, tumbling cubes with a
  reticle, peeling posters, rapid cards, shockwave) and the last line is an identity card.
- FOUNDRY: an old printing works manufactures every word in one continuous shot; letters fall through tubes, strong
  words are cast molten, heavy words (ALWAYS, NEVER, FINE…) arrive as iron slabs, punctuation is machinery (em dash
  barrier, rocking question, rolling full stop, brass comma, caged backing vocals), and each line is inked and stamped
  onto a river of paper.
- ZINE PUNK: a hand-made pop-punk zine on twos; stamped torn-paper words, lotus tile floods, jade discs, brush X's,
  tape, stars, a rotating floral plane, comic hits on the kick drum (BAM!, 叩, 炸…) and a magazine-cover ending.
  Its Chinese sound words use a 6 KB subset of ZCOOL KuaiLe (OFL, `public/fonts/OFL-zcoolkuaile.txt`). Live-capable: NEON, SIGNAL, SWARM, MANDALA, FIREWORKS, KARAOKE.

## Scripts

| Command | What it does |
| --- | --- |
| `npm test [filter]` | bundles each `scripts/test-*.ts` with esbuild and runs it in Node |
| `node scripts/e2e.mjs` | every effect at chosen times, frames + masks, 16:9 / 9:16 / 1:1, contact sheets |
| `node scripts/e2e-determinism.mjs` | t = 31.4 rendered directly, after 10 other times, after a re-prepare and a material toggle: bit-identical |
| `node scripts/e2e-golden.mjs [--update]` | 192 golden frames (lossless WebP), mean 8×8 SSIM ≥ 0.97 |
| `node scripts/e2e-export.mjs` | MP4, alpha WebM / PNG zip, GIF, −14 LUFS, sidecars — all checked with ffprobe/ffmpeg |
| `node scripts/e2e-hybrid.mjs` | every material, the named pairings and overlays, with a contact sheet |
| `node scripts/e2e-flash.mjs` | every effect with flashy settings maxed + a 4 Hz strobe: guard off finds violations, guard on verifies 0, exported MP4 re-measured |
| `node scripts/e2e-live.mjs` | live mode through the real browser audio path (rehearsal source) |
| `node scripts/e2e-perf.mjs [--update]` | median / p95 render ms per effect at 720p against a per-machine baseline |
| `node scripts/e2e-effect.mjs --effects id` | determinism + mask check for one effect (what `new-effect` scaffolds) |
| `node scripts/showcase.mjs` | showcase reel: Auto-Director demo, a 9:16 cut, KARAOKE waltz with translation, all-effects sheet |
| `node scripts/export-clip.mjs --audio x.mp3 --lrc x.lrc --auto 1776 [--variety 16] --end full` | export any song through the app (used for the example videos) |
| `node scripts/tools/flash-check.mjs video.mp4` | independent WCAG flash count of any video file |
| `node scripts/run.mjs scripts/tools/analyze-file.ts song.mp3` | readable analysis report for any file |

The e2e scripts drive headless Chromium with SwiftShader (software WebGL) via Playwright; `npx vite build` first.

## v3 status

Measured on this machine (headless Chromium + SwiftShader for browser tests). ✅ done and verified ·
🟡 done with a stated limitation · ❌ not done.

| Spec | Item | Status | Evidence / note |
| --- | --- | --- | --- |
| §1 | `render(t)` is a pure function of t | ✅ | e2e-determinism: all 16 effects bit-identical (exports rasterise 2D canvases in software; Chrome's accelerated glyph cache otherwise varies a few AA levels with render history) |
| §4 | beats, meter, key, key change, chords, f0, melisma/vibrato, loudness | ✅ | test-analysis, test-analysis3 on both fixtures |
| §4A.2 | vocal activity F1 ≥ 0.85 | 🟡 | 0.847 on demo-song (0.921 waltz). The demo intro is a sustained centred triad pad in the vocal register; without source separation it reads as a held vowel. Reported as a known gap by the test, not hidden |
| §5 | lyrics formats, voices, syllables, translation | ✅ | test-lyrics, test-syllables |
| §5 | Whisper auto-sync + alignment | ✅ | test-align (robustness cases from §17, deaf-span retry). Hardened on the three example songs: anchor-chain consistency (no crushed lines from stray one-word matches), re-transcription of stretches Whisper went deaf to, held notes kept. Word match after retries: 91 % / 74 % / 72 % |
| §6 | Director roles/elements/concepts | ✅ | test-lyrics |
| §8 | 16 effects with masks, transparency, reduce motion | ✅ | e2e, e2e-golden, e2e-hybrid; plus BREAKOUT, EDITORIAL, COLD SNAP, FOUNDRY and ZINE PUNK (beyond the spec), checked the same way |
| §8.12 | MONOLITH depth of field | ✅ | depth in the march target's alpha + mip blur by thin-lens CoC, focus on the sung word (`dof` param) |
| §9 | layers, word masks, materials, modulation, automation, media, artwork palette | ✅ | test-modulation, e2e-hybrid |
| §9.6 | Auto-Director | ✅ | test-director: no repeats in a row, ≤ variety effects (default 5, slider 2–16 in the storyboard, `--variety` in export-clip), choruses share an effect; back-to-back repeats alternate; sections > 45 s are split |
| §9.7 | storyboard | ✅ | Auto-Director dialog (Apply / Shuffle / Cancel) in `ui/dialogs.ts` |
| §10 | post, LUTs, motion blur, flash guard, reduce motion | ✅ | test-flash, e2e-flash |
| §11 | UI, lanes, palette, HUD, a11y, MIDI learn | ✅ | ui-shot; keyboard and ARIA throughout |
| §12 | projects, zip, Looks, undo/redo | ✅ | test-project (zip round trip, v2 migration, 50 random undo/redo) |
| §13 | MP4/WebM/alpha/GIF/batch/sidecars/loudness | 🟡 | e2e-export. Headless Chromium has no VP9-alpha encoder, so the alpha check exercised the PNG-sequence fallback |
| §14 | live mode | 🟡 | test-online (beat F 0.996 / 0.984, tempo ±0.1 %, prediction error 4.6 / 16.4 ms); e2e-live through the real audio path. Microphone, tab audio, the audience window on a second screen and MIDI cueing need real devices and were not exercised here; auto-follow is a greedy online alignment and stays experimental |
| §15 | effect SDK | ✅ | `defineEffect`, RISE example, `npm run new-effect`, build lint (renderMask required), hot reload, docs/EFFECTS.md |
| §16 | demo fixtures | ✅ | `npm run fixtures` (byte-identical regeneration) |
| §17 | tests listed in the spec | ✅ | all scripts above; perf numbers are SwiftShader and only compared with the same machine |

## Example videos

`scripts/export-clip.mjs` renders any song with its aligned LRC through the Auto-Director, e.g.

```bash
node scripts/export-clip.mjs --audio song.mp3 --lrc song.lrc --auto 1776 --end full --res 720 --quality 4 --out out/song.mp4
```

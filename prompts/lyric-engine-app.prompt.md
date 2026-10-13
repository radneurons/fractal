# BUILD PROMPT — "LYRIC ENGINE": an audio-synced kinetic-typography studio

You are a senior graphics and audio engineer working in an empty repository. Build a complete, working, local-first web application.

What the app does:
1. The user uploads a song or a speech, plus its lyrics or transcript.
2. The app analyzes the audio.
3. It aligns every word to the moment it is sung or spoken.
4. It renders that text as one of eight cinematic, audio-reactive typography films.
5. The user can switch between films live, tune every effect with sliders, and export a finished video with the audio muxed in.

Work in milestones (section 19). Every milestone must end with a runnable app, passing tests, and a short CHANGELOG entry. Do not stub features you claim are done. When something is genuinely out of reach (for example, model weights cannot be downloaded), implement the fallback path and say so in the UI and in the changelog.

---

## 1. PRODUCT SUMMARY

**Input**
- An audio file: mp3, wav, m4a/aac, ogg, or flac. Up to 10 minutes.
- Lyrics, in any one of these forms:
  - pasted plain text;
  - an `.lrc` file (line-level, or enhanced word-level `<mm:ss.xx>` tags);
  - an `.srt` or `.vtt` file;
  - a JSON word list;
  - nothing, in which case automatic transcription runs.

**Output**
- A real-time preview at up to 60fps.
- Exported MP4 (H.264 + AAC) or WebM (VP9 + Opus), in:
  - 16:9 at 1920×1080 or 3840×2160;
  - 9:16 at 1080×1920;
  - 1:1 at 1080×1080.
- Frame rate: 24, 30 or 60fps.

**Core promise.** Every word appears on screen in sync with its sung or spoken onset. Each effect treats the lyrics as meaning (which words matter) and the music as structure (beats, bars, sections, drops, loudness), never as random decoration.

**Privacy.** Everything runs in the browser. Audio never leaves the device. The only network use is an optional, user-approved, one-time download of speech-recognition model weights, which are then cached.

**Non-goals for v1**
- Accounts or cloud storage.
- Multi-user collaboration.
- Mobile-first editing. Mobile playback of a saved project is nice-to-have.

**Rights notice.** On upload, show this one-line notice: "Use audio and lyrics you have the rights to use." Never bundle copyrighted songs or lyrics in fixtures or demos. Use the public-domain speech excerpts and synthetic music listed in section 18.

---

## 2. TECH STACK AND CONSTRAINTS

- Vite + TypeScript (strict) + React 18 for the UI. Zustand for app state.
- Rendering: WebGL2. Use three.js (r160 or later) only for the effects that need a real 3D scene (MISSION POSTER camera tilt, POP-UP, LIQUID CHROME environment). Every other effect uses hand-written full-screen and instanced shaders on WebGL2 directly.
- Fonts: bundle only OFL-licensed fonts as files, with their licenses. Use opentype.js for glyph outlines, kerning, and variable-font instances (fontkit if opentype.js cannot interpolate a font's variation axes).
- Workers: run audio analysis, SDF generation, glyph triangulation, alignment, and export encoding off the main thread. Pass data as transferable ArrayBuffers.
- Audio: Web Audio API for decode and playback. All analysis runs on decoded PCM in a worker. Write all DSP yourself (FFT, mel filterbank, chroma, beat tracking) so the results are deterministic and reproducible. A small, well-tested FFT package is acceptable.
- Speech recognition (optional path): `@huggingface/transformers` (transformers.js) with a Whisper model that supports word-level timestamps, in a worker. Use WebGPU when available and fall back to WASM. Download only after the user consents; cache in IndexedDB or the Cache Storage API.
- Export: WebCodecs (`VideoEncoder`, `AudioEncoder`) plus `mp4-muxer` and `webm-muxer`. Fallback: `MediaRecorder` on `canvas.captureStream()` plus the audio graph, in real time, labelled "lower quality".
- Persistence: IndexedDB (via `idb`) for projects, analysis caches keyed by the audio file's SHA-256, and presets.
- Testing: Vitest for units, Playwright for end-to-end, and pixel hashing for determinism.
- No runtime CDN requests. Every asset ships in the build.

---

## 3. ARCHITECTURE

```
src/
  app/            React shell, routes, layout, keyboard shortcuts
  state/          zustand stores: project, transport, ui, settings
  audio/          decode, playback clock, latency compensation, waveform peaks
  analysis/       worker + DSP: stft, features, onsets, tempo, beats, downbeats, sections, drops, vad
  lyrics/         parsers (lrc, srt, vtt, json, plain), tokenizer, syllables, alignment, tap-sync
  asr/            transformers.js whisper worker, ASR→lyrics aligner
  director/       meaning + music → ShotPlan (emphasis, phrasing, section roles, element mapping)
  render/
    core/         gl context, render targets, post chain, camera, rng, easing, color, time
    text/         font service, shaping, glyph cache, SDF/MSDF atlas worker, outline/contour utils, earcut
    icons/        original procedural pictogram library (vector paths) + concept lexicon
    effects/      broadside/ elements/ poster/ chrome/ swarm/ droste/ press/ popup/
    transitions/  effect-to-effect transitions
  export/         offline frame loop, encoders, muxers, progress, cancel
  ui/             panels, sliders (auto-generated from param schemas), waveform/lyrics editor, effect browser
  persistence/    idb stores, project (de)serialization, presets
  tests/          unit, e2e, fixtures, golden-frame hashes
```

**Determinism rule.** Every effect exposes `render(t)`, a pure function of t, the analysis arrays, the lyrics, the parameters, and a seed. Nothing may accumulate across frames:
- no feedback buffers, unless they are replayed deterministically from a cached keyframe;
- no `Math.random`;
- no physics integrated per frame.

Preview, scrubbing, and export all call the same `render(t)`.

---

## 4. DATA MODEL

```ts
type Seconds = number;

interface AudioAsset { id: string; sha256: string; name: string; duration: Seconds; sampleRate: number; channels: number; }

interface Analysis {                       // all frame arrays sampled at 60 Hz (index = round(t*60))
  fps: 60;
  rmsDb: Float32Array;                     // short-term loudness
  loudNorm: Float32Array;                  // 0..1, percentile-normalized (5th→0, 95th→1)
  bands: { sub: Float32Array; bass: Float32Array; lowMid: Float32Array; mid: Float32Array; highMid: Float32Array; high: Float32Array; air: Float32Array }; // each 0..1 normalized
  centroid: Float32Array;                  // 0..1 normalized spectral centroid
  flux: Float32Array;                      // onset strength (spectral flux, half-wave rectified)
  onsets: Seconds[];                       // peak-picked
  bpm: number; bpmConfidence: number;
  beats: Seconds[]; downbeats: Seconds[]; meter: number;   // default 4, user-editable
  sections: { start: Seconds; end: Seconds; label: 'intro'|'verse'|'pre'|'chorus'|'bridge'|'drop'|'breakdown'|'outro'|'speech'; energy: number; repeatOf?: number }[];
  drops: Seconds[];                        // large low-band + loudness rise after a build
  vocalActivity: Float32Array;             // 0..1 (from aligned words if present, else mid-band VAD)
  pitchHz?: Float32Array;                  // optional YIN on vocal band; NaN when unvoiced
}

interface Word {
  id: string; text: string; display: string; lineId: string; index: number;
  start: Seconds; end: Seconds;            // sung/spoken onset and release
  confidence: number;                      // 0..1 (alignment confidence)
  syllables: number;
  stress: number;                          // 0..1 computed by director
  role: 'hero'|'support'|'connective';     // computed by director (user can override)
  concept?: string;                        // lexicon concept (fire, heart, home, …)
  element?: ElementKind;                   // for ELEMENTS effect
  repeatKey?: string;                      // normalized line text for chorus detection
}
interface Line { id: string; words: string[]; start: Seconds; end: Seconds; sectionIndex: number; }
interface Lyrics { words: Word[]; lines: Line[]; source: 'lrc'|'enhanced-lrc'|'srt'|'vtt'|'json'|'plain+asr'|'plain+tap'|'asr'; }

interface ProjectSettings {
  aspect: '16:9'|'9:16'|'1:1'; fps: 24|30|60; seed: number;
  syncOffsetMs: number;          // -400..+400, applied to all word times
  anticipationMs: number;        // 0..300, word entrance begins this much before its onset
  minReadMs: number;             // 250..1500, minimum fully readable hold per hero word
  intensity: number;             // 0..100 global multiplier for effect energy
  cameraEnergy: number;          // 0..100
  textDensity: number;           // 0..100 → words kept on screen
  palette: PaletteId | CustomPalette; fontPair: FontPairId; caseMode: 'as-is'|'upper'|'lower'|'title';
  motionBlur: number; grain: number; vignette: number;   // grain is stationary (world-attached) only
  safeArea: number;              // % inset for platform UI
  endCard: { enabled: boolean; title: string; artist: string; credit: string };
  effectTimeline: EffectClip[];  // which effect plays when (see §11)
}
interface EffectClip { effectId: EffectId; start: Seconds; end: Seconds; params: Record<string, number|boolean|string>; transitionIn: TransitionSpec; }
```

---

## 5. AUDIO ANALYSIS PIPELINE (worker; cached by sha256)

Implement each step yourself, deterministically. Document every constant in code.

1. **Decode** with `decodeAudioData`. Mix to mono (keep stereo for playback and export). Resample to 22,050 Hz for analysis.
2. **STFT**: Hann window 2048, hop 256. Compute a magnitude spectrogram.
3. **Features per hop.** Compute these, then resample every array to exactly 60 Hz with linear interpolation:
   - RMS (dB);
   - 7 band energies, with edges 20–60, 60–250, 250–500, 500–2k, 2k–4k, 4k–8k, and 8k–11k Hz;
   - spectral centroid;
   - log-mel (64 bands);
   - spectral flux on log-mel;
   - chroma (12 bins);
   - 13 MFCCs.
4. **Normalization.** Map each feature to 0..1 using its own 5th and 95th percentiles over the whole track, then clamp. Smooth with a one-pole filter: attack 15 ms, release 120 ms. Keep the raw arrays as well.
5. **Onsets.** Peak-pick the flux with an adaptive threshold: local median over ±0.25 s × 1.4 + δ. Enforce a minimum gap of 50 ms.
6. **Tempo.** Autocorrelate the onset envelope over 60–200 BPM with a log-Gaussian tempo prior centered at 120. Resolve octave errors with a comb-filter score. Report a confidence value.
7. **Beat tracking.** Dynamic-programming beat tracker (Ellis 2007), with tightness 100.
8. **Downbeats.** For each of the `meter` possible phases, score the summed bass energy plus chroma change on candidate downbeats. Pick the best phase. The user can override the meter and nudge the phase in the UI.
9. **Sections.**
   - Build beat-synchronous MFCC and chroma vectors.
   - Compute a self-similarity matrix and a Foote novelty curve with a 16-beat checkerboard kernel.
   - Peak-pick boundaries, snapped to downbeats, at least 8 bars apart.
   - Cluster the segments by mean feature vector to detect repeats (`repeatOf`).
   - Label sections heuristically: the highest-energy repeated cluster is `chorus`. If lyrics exist, repeated lyric lines boost chorus likelihood.
   - Speech files (low tempo confidence plus high vocal activity) are labelled `speech`, with sections at long pauses.
10. **Drops.** Find points where, within one bar, bass energy rises by more than 0.35 and loudness rises by more than 0.25, after at least 4 bars of rising high-band energy or a breakdown.
11. **Vocal activity.** Use aligned words if present. Otherwise use a mid-band (300–3.4 kHz) energy-ratio detector with hysteresis.
12. **Optional pitch.** YIN on a 300–3,400 Hz band-passed signal, at 60 Hz.
13. **Waveform peaks** for the UI: min/max per pixel bucket at several zoom levels.

Performance target: analyze a 4-minute track in under 6 seconds on a mid-range laptop. Show staged progress.

---

## 6. LYRICS: INGESTION, ALIGNMENT, EDITING

**Parsers**
- LRC: line-level and enhanced word-level tags, `[offset:]`, and multiple timestamps per line.
- SRT and VTT.
- JSON `[{text,start,end}]`.
- Plain text, splitting lines on newlines.

**Tokenizer**
- Unicode-aware: keep apostrophes and hyphenated words, and split punctuation into `display` only.
- Normalize for matching: lowercase, strip diacritics, map digits to words.

**Syllable counter**
- English uses a heuristic with an exceptions list. Other languages use vowel-group fallback.

**Timing strategies**, in priority order:
1. **Word-level tags** (enhanced LRC or JSON): use them directly.
2. **Line-level times only** (LRC, SRT):
   - distribute each line's span across its words in proportion to syllable count;
   - snap each word start to the nearest onset within ±80 ms where the vocal-band flux is high.
3. **Plain text with ASR** (after consent):
   - run Whisper with word timestamps;
   - align the user's text to the ASR tokens with Needleman–Wunsch (match +2, mismatch −1, gap −1, plus a fuzzy-equality bonus from normalized Levenshtein ≤ 0.34);
   - matched words get ASR times;
   - unmatched runs are interpolated between anchors by syllable weight;
   - confidence comes from the match score and the ASR probability.
4. **Plain text with tap-sync**:
   - the user presses Space on every word (or Enter per line) while the audio plays, with an optional 0.5× speed;
   - word ends are set as the next word's start minus 40 ms, capped by vocal activity;
   - then snap to onsets as in strategy 2.
5. **ASR only** (no lyrics given): the transcription becomes the lyrics, and the user is prompted to correct it.

**Lyrics editor**
- A waveform with word blocks: drag edges, drag to move, split and merge words, and edit the text.
- Low-confidence words are tinted.
- Role overrides: click a word to cycle hero, support, connective.
- Concept and element overrides from a dropdown.
- Preview loops the selected line.

**Global sync offset** slider (−400 to +400 ms), plus a "nudge" calibration: a click track plays and the user taps along to measure their own latency.

---

## 7. THE DIRECTOR (meaning + music → ShotPlan)

A deterministic module that turns `Analysis` and `Lyrics` into a `ShotPlan` all effects consume. Effects may add effect-specific planning on top.

**Stress score** per word, from 0 to 1. Weighted sum, then rank-normalize within each line:
- duration relative to the line median: 0.30;
- loudness at onset: 0.20;
- pitch peak, if available: 0.10;
- not a stopword: 0.20, using bundled stopword lists for English, Spanish, French, German, Portuguese and Italian;
- lexicon concept hit: 0.10;
- line-final position: 0.05;
- repeated word in the chorus: 0.05.

**Roles**
- The top word, or top two in lines longer than 8 words, becomes `hero` when stress ≥ 0.6.
- Stopwords become `connective`.
- Everything else is `support`.
- User overrides always win.

**Phrasing.** Group words into display phrases. Break at:
- line boundaries;
- gaps of 350 ms or more;
- 7 or more words;
- downbeats, when a phrase already spans a full bar.

**Section roles** drive a per-section look: verse is calm, chorus maximal, bridge reframes, drop is an impact event, outro resolves.

**Concept lexicon** (`render/icons/lexicon.ts`)
- About 120 concepts, each with synonyms and inflections: fire, light, sun, moon, star, heart, love, home, road, sea, rain, storm, wind, earth, sky, money, time, clock, night, day, dream, eyes, hands, gun, war, peace, chain, key, door, crown, king, queen, bird, wing, fly, fall, rise, run, dance, music, voice, phone, car, city, tree, flower, rose, gold, blood, cold, ice, smoke, ghost, and so on.
- Each concept maps to:
  - an original procedural pictogram, drawn as path commands in code (no copied icon sets);
  - a preferred substitution letter shape: ring-like for O, Q, D, C, G or 0; vertical stroke for I, l, 1 or T; triangle for A, V or Δ;
  - an optional semantic color;
  - an ELEMENTS element.

**Shot plan output**
- Per phrase: a layout seed, an entrance family per word, an emphasis accent, the camera intent (hold, hunt, rotate, dive, pull back), and a section transition kind.
- All choices are seeded by `(projectSeed, phraseIndex)`, so they are stable across reloads and change only when the user edits them.

---

## 8. RENDER CORE (shared services)

- **Clock.** Preview time is `audioCtx.currentTime − startOffset − outputLatency − syncOffset`. Export time is `n / fps`. Effects never read wall-clock time.
- **Font service.** Load fonts with opentype.js, shape text with kerning (GPOS pair kerning), and give each glyph a stable per-word identity.
- **Glyph cache** holds:
  - `Path2D` objects;
  - contours split into outer and counter (by signed area and containment) for clipping;
  - earcut triangulations for extrusion;
  - variable-font instances cached at quantized axis steps.
- **SDF and MSDF atlas worker.**
  - Use an exact Euclidean distance transform (Felzenszwalb–Huttenlocher) for SDF, and MSDF for sharp corners in hero sizes.
  - Atlas pages are 4096², single-channel R8 or RGB8 for MSDF.
  - Bake at least 128 px cap height for heroes and 64 px for connectives.
  - Long strings bake at a lower cap height so they never exceed the page width (a real bug we hit earlier: it clips text silently).
- **Spatial word tiles.** For full-screen SDF shaders, precompute per-tile candidate word lists: 32×32 world-unit tiles, 8 slots, overflow counted and reported. This was a 6× speed-up in testing and is mandatory for full-screen word loops.
- **Camera.**
  - 2D: center, zoom, rotation.
  - 3D: position, target, field of view.
  - Keyframes with easing (cubic in-out, back-out). Zoom is log-interpolated.
  - A `follow(target, weight)` blend.
  - Shake is allowed only in an event-limited form: at most once per 4 bars, only on drops or hero impacts.
- **Post chain**, all optional:
  - bloom (threshold plus 5-tap dual filter);
  - selective deterministic motion blur (re-render at t−k/fps for moving elements only, or velocity-based blur for full screen);
  - a stationary grain texture in world space;
  - vignette;
  - an ACES tone map for HDR effects;
  - per-palette LUT.
- **Easing and randomness.** Seeded mulberry32 and hash functions. Every procedural detail is seeded at plan time.
- **Readability guard**, active for every effect, enforced by a debug overlay and tests:
  - while a hero is inside its read window `[start, start + minReadMs]`, its on-screen cap height is at least 4% of the frame height;
  - it is at least 90% inside the safe area;
  - its local contrast is at least 4.5:1 against the background, sampled behind the glyph bounding box;
  - it is not occluded by more than 10%.
  - Effects must expose a hook to satisfy this guard (scale up, reframe, or dim the background), not ignore it.

---

## 9. EFFECT PLUGIN API

```ts
interface ParamSpec { key: string; label: string; group: string; type: 'range'|'toggle'|'select'|'color'; min?: number; max?: number; step?: number; default: number|boolean|string; options?: string[]; help: string; live: boolean /* true = no replan needed */ }

interface EffectContext { gl: WebGL2RenderingContext; size: {w:number;h:number;dpr:number}; fonts: FontService; atlas: AtlasService; icons: IconLibrary; analysis: Analysis; lyrics: Lyrics; plan: ShotPlan; settings: ProjectSettings; rng: (key:string)=>()=>number; }

interface Effect {
  id: EffectId; name: string; thumbnail: string; description: string;
  params: ParamSpec[];
  prepare(ctx: EffectContext, params: Params, range: {start:Seconds; end:Seconds}): Promise<Prepared>; // deterministic layout/world building; may use workers
  render(prepared: Prepared, t: Seconds, out: RenderTarget): void;   // pure function of t
  readability(prepared: Prepared, t: Seconds): ReadabilityReport;    // for the guard + tests
  dispose(prepared: Prepared): void;
}
```

- **Parameter changes.** "live" parameters update uniforms immediately. Non-live parameters trigger a debounced `prepare()` (300 ms) in the background, and the new preparation swaps in once ready, with no blank frames.
- **Sliders** are auto-generated from `ParamSpec`, grouped and with tooltips from `help`. Every effect also gets randomize-seed, reset-group, and reset-all buttons.

---

## 10. THE EIGHT EFFECTS

All effects must:
- work for arbitrary lyrics, from 10 words to 600 words, in any Latin-script language. Non-Latin scripts get a graceful fallback to the bundled Noto font with reduced glyph-level tricks;
- respect the readability guard;
- end, when the end card is enabled, on a resolved composition that reveals the structure of the whole piece.

### 10.1 BROADSIDE: classic 2010s kinetic lock-up

*The editorial "Imagine" style: words lock into justified blocks while a restless camera hunts for the next gap.*

**Layout**
- Each phrase becomes one or more lines, all set to the same measure.
- Size words by role: hero 1.0, support 0.55, connective 0.22 relative cap height.
- Connectives become rotated (90°) vertical pockets or small stacked pairs.
- Compute the line scale so the line meets the measure to within 1 px. Never distort glyphs horizontally.

**Page**
- Successive lines stack downward on one large page.
- Every N lines (param), or on a section change, the next block starts rotated 90°, so finished text becomes a sideways column at the edge.
- Choruses reuse the same block (`repeatKey`): the camera returns to it and re-lights it instead of setting it again.

**Camera**
- Hunt the newest word: center on the current partial line, frame the latest word at about 70% of width, and keep previous lines visible.
- Whip-pans of 12–14 frames, with 3-sample deterministic blur, at block rotations.

**Entrances**, chosen by audio:
- **Slam**: onset flux in the top 15%.
- **Slide**: sustained words longer than 400 ms.
- **Drop**: word lands on a downbeat.
- **Ghost-in**: soft passages, loudness below 0.3.
- **Stand-up**: words whose concept is "rise" or "stand".
- **Tick**: connectives.
- **Echo trail**: 3 gray ghost copies on loud heroes.

**Pictograms.** A hero whose concept has a pictogram replaces one matching-shape letter with the icon, keeping the advance width. At most one substitution per phrase.

**Polarity flips.** At section boundaries the camera dives through the counter of the last hero letter that has one (outline-accurate counter). The counter's fill becomes the new background, switching between dark and light page.

**Ending.** Pull back over the full page. Every block remains, and the shape reads as one designed broadside.

**Params**
- measure;
- line spacing;
- rotate every N lines (0–8);
- connective scale;
- hero accent color;
- pictogram on/off;
- substitution frequency;
- camera hunt tightness;
- whip-pan speed;
- shake on drops on/off;
- polarity flip on/off;
- dark/light start.

**Acceptance**
- Every line is flush within 1 px.
- No horizontal glyph scaling anywhere.
- Each hero passes the readability guard during its read window.
- A chorus line reuses its block.

### 10.2 ELEMENTS: text as material (signed-distance-field shaders)

*Each hero word becomes the physical element it names (or that the music implies), and each element consumes the previous one.*

**Rendering.** Every word lives in a world-space SDF atlas, culled with the spatial tiles. Elements are shader treatments that read distance:
- **LIGHT**: volumetric shafts through the letter counters (radial march, 24–32 samples, dithered).
- **FIRE**: domain-warped fbm flame shaped by an upward-sampled SDF, with an ember rim. The counters must stay dark.
- **ASH**: noise-thresholded burn front climbing from the baseline.
- **WATER**: rain streaks that pool into refractive glass letters, filling bottom-up with beads.
- **SHOCK**: a white flash of at most 4 frames, then a radial pressure-wave displacement of the whole world (compression plus rarefaction band).
- **WIND**: weighted streak smear downwind, plus angled rain.
- **VORTEX**: polar swirl, with the hero set letter-by-letter on a logarithmic spiral.
- **QUAKE**: Voronoi plates translate and rotate, split everything along glowing faults, then lock into a new arrangement.
- **ICE**: crystalline facets from Voronoi, with a frost growth front.
- **SMOKE**: curl-noise dissolve into wisps, evaluated in closed form.

**Element choice**
- **Lexicon first**: fire, burn, flame → FIRE; light, shine, glow, sun → LIGHT; rain, tears, cry, ocean, drown → WATER; and so on.
- **Audio fallback** when no concept matches:
  - a strong transient on a downbeat → SHOCK;
  - sustained loud mid-band → FIRE;
  - quiet with high centroid → LIGHT;
  - high-band (hi-hat) dense → WATER;
  - a rising centroid sweep → WIND or VORTEX;
  - a detected drop → QUAKE.
- **Rate limits**: at most one SHOCK per 4 bars and one QUAKE per section.

**Persistence.** The world is cumulative and the camera travels through it. Each word keeps its post-element state: ash, ember outline, wet glass, split plates. The ending pullback shows the whole record.

**Audio modulation**
- flame flicker amplitude follows mid energy;
- rain density follows the high band;
- vortex strength follows flux;
- wave amplitude follows onset strength;
- ember glow pulses on beats.

**Params**
- element set: enable or disable each element;
- lexicon vs. audio weighting;
- element intensity;
- persistence: how much of past states remains;
- shock frequency limit;
- spark count;
- rain density;
- fault glow;
- palette: soot, paper, flame ramp;
- serif vs. condensed pairing.

**Acceptance**
- FIRE counters stay dark.
- WATER words are readable once filled.
- SHOCK never repeats within 4 bars.
- Seeking anywhere reproduces identical frames.

### 10.3 MISSION POSTER: one world, one journey, one reveal

*The whole song is a single illustrated poster. The camera explores it region by region. A persistent token is assembled over the verses and launched in the final chorus toward the first line's destination word. The final pullback reveals the whole poster.*

**World**
- The first hero word containing a counter (O, D, A, P, Q, R, B, e, o, a) is the destination.
- A pale disc is clipped to that counter's actual outline, with a gap of at least 0.06 cap.
- Sections become regions laid out along a path down the poster.
- The bridge region is a hinged colored panel that unfolds in true perspective from the previous hero's baseline.
- Repeated choruses return to the same region (the "station").

**Token**
- User-chosen: rocket, paper plane, bird, comet, heart or seed. Original vector art in 5 parts.
- The parts appear as quiet shapes in the verse regions and are collected one per verse (or per N bars).
- Later steps:
  - measured by a bracket that spans the token's real bounds (it may print a bar count, which is real data);
  - aligned by registration guides on a beat;
  - latched on the last pre-chorus;
  - released at the final chorus's first downbeat.

**Route**
- One explicit Bézier route from the launch point to the destination counter, parameterized by arc length.
- Orientation follows the route tangent.
- The token scales down uniformly into a small arrival marker.
- The route reveals by path length.

**Ending.** One continuous ascent and withdrawal reveals the full poster: the earlier shapes, the same token, the same disc.

**Params**
- token type;
- route curvature;
- poster aspect;
- region spacing;
- panel color;
- brass route on/off;
- annotation density;
- launch moment (final chorus, or the user picks a section);
- reveal duration.

**Acceptance**
- The token's identity persists: one instance, constant proportions.
- The route endpoint equals the disc edge.
- The final frame shows every region.
- No text is crossed by the token during its read window.

### 10.4 LIQUID CHROME: ferrofluid typography (new)

*Words are pools of liquid metal that rise into letterforms, spike with the bass, and melt into the next word.*

**Rendering**
- 2.5D raymarch of a height field H(x, y) = smoothstep(SDF of the word) × letter height, plus a ferrofluid spike field.
- Spikes: a hexagonal lattice of cones whose height follows the sub and bass envelope, masked to the letter interior and fading at the edges.
- Normals come from H by central differences.
- Shading: a procedural studio environment (soft boxes as analytic rectangles in a gradient sky) with reflection plus a Fresnel term. Thin-film iridescence hue follows vocal pitch, or the centroid when pitch is absent.

**Transitions.** Melt between words by interpolating the two distance fields: SDF_t = mix(SDF_a, SDF_b, ease) with a smooth-min bridge. Kicks launch closed-form droplets: ballistic arcs from a seeded emitter, with metaball merging on landing.

**Camera.** Slow orbit tilt of at most 12°, with a dolly-in on choruses.

**Params**
- spike height;
- spike density;
- bass sensitivity;
- melt duration (in beats);
- metal tint;
- iridescence amount;
- environment brightness;
- droplet count;
- tilt.

**Acceptance**
- The word is readable at the peak of its spikes: spikes are masked to at most 35% of the letter area.
- Melts complete before the next word's read window.

### 10.5 SWARM: conserved particle crowd (new)

*A fixed population of N particles builds every word. Nothing is created or destroyed.*

**Targets**
- Sample each phrase and word layout into exactly N blue-noise targets, weighted to stroke interior.
- Pad with margin positions where unused particles wait, dimmed and still visible.
- Pairing between consecutive layouts:
  - sort both target sets along a Hilbert curve;
  - pair them in order;
  - refine with local swaps to minimize travel.

**Motion.** All motion is closed-form in the vertex shader:
- seeded curved paths;
- departures staggered by x position;
- idle curl-noise wobble;
- a beat "breath": radial pulse proportional to bass on beats;
- an arrival settle.

**Formations.** Change on word onsets, quantized to the nearest 1/8 beat when the quantize option is on. On choruses particles adopt the accent palette. On drops the swarm explodes outward along seeded radial paths and re-forms on the next downbeat.

**Particle looks**: dot, star, petal, tiny human pictogram, or glyph confetti.

**Params**
- N: 10k–80k;
- particle look;
- size;
- trail length (multi-sample, deterministic);
- quantize to beat;
- stagger;
- wobble;
- breath amount;
- explode on drops;
- palette.

**Acceptance**
- `debug.count()` equals N at every t.
- Words read at half resolution: strokes are at least 8 particles thick.

### 10.6 DROSTE: infinite recursion locked to tempo (new)

*The frame contains itself. The camera falls endlessly inward at exactly one recursion level per bar.*

**Rendering**
- One panel design (Art Deco, Brutalist or Neon-free Swiss) with an inner window holding the same panel scaled by k (0.25–0.35) at an off-center anchor.
- Draw levels 0–7 explicitly each frame, with vector type at every level. No feedback buffer.
- Zoom: z = k^(−φ(t)), where φ advances by 1 per bar, so the loop is seamless.

**Content**
- Level n shows the lyrics as they were n bars ago, so past lines recede inward.
- The current phrase sets on the lintel and inside the window.

**Musical behavior**
- **Breakdowns**: φ freezes. Hold perfectly still, and only the hero word changes.
- **Drops**: φ reverses, so the camera rises outward. On the final chorus it exits the recursion into open space.
- **Bridge**: the panel style swaps at a level boundary.

**Params**
- panel style;
- k;
- anchor;
- levels per bar (0.5, 1 or 2);
- reverse on drop;
- freeze on breakdown;
- deco ornament density;
- color scheme.

**Acceptance**
- Frames one level-period apart during cruise are geometrically identical apart from their content offsets.
- A freeze is pixel-static.

### 10.7 PRESS: variable-font engraving (new)

*Loudness becomes ink weight. A hand-engraved page breathes with the music.*

**Type and dynamics**
- Uses a bundled OFL variable font: Fraunces (wght, opsz, SOFT, WONK) or Roboto Flex.
- Smoothed loudness maps to wght, from 100 to 900.
- Centroid maps to width or opsz.
- Stress maps to slant or WONK.
- Interpolate outlines continuously, never by swapping fonts.

**Page**
- Paper texture attached to the page.
- Every tone is engraving hatch: line fields whose spacing encodes tone, with no flat fills.
- Ink spread on kicks: a closed-form dilation of 0.5–2% for 80 ms.

**Layout**
- Lines typeset as justified columns that reflow live as weights change.
- Long held syllables (melisma) stretch along a Bézier path, as type on path, with tangent-rotated glyphs.

**Section changes** are a page turn: a curl drawn as a quadratic surface. Choruses use a red second ink.

**Params**
- weight range;
- loudness smoothing;
- width-from-centroid on/off;
- hatch density;
- paper tone;
- second ink color;
- page-turn style;
- melisma path on/off.

**Acceptance**
- Weight changes continuously, with no glyph swaps.
- The column stays justified at every weight.

### 10.8 POP-UP: paper theater (new)

*A three-dimensional pop-up book. Every downbeat turns or raises a paper layer, and phrases stand up as die-cut cards with real shadows.*

**Scene**
- three.js scene with a book spread on a table, lit by a warm key light and soft fill.
- Shadow maps at 2048, with PCF filtering.
- Each phrase is a layer of 2–4 cut paper planes at different depths.
- Heroes are extruded 3 mm card with a printed face and a white core edge, built from earcut glyph outlines.
- Each card is hinged at the gutter, with fold angle = f(t) on downbeats and an overshoot.

**Pictograms** from the lexicon become cut-out props (trees, houses, moons) that pop up beside the hero.

**Section changes** turn the page with a real hinge rotation. Choruses revisit the same spread.

**Camera** is a gentle dolly: low angle on choruses, top-down on verses.

**Params**
- paper color set;
- layer depth;
- pop overshoot;
- page-turn per section or per N bars;
- props on/off;
- shadow softness;
- camera angle.

**Acceptance**
- Cards never intersect each other.
- Every hero card faces the camera within 25° during its read window.

---

## 11. SWITCHING EFFECTS

- **Effect browser.** A grid of live thumbnails: each effect renders at 320×180 for the current time, staggered so only one updates per frame. Click to switch.
- **Live switching** uses a transition: crossfade (default 0.5 s), dip to color, luma wipe from the next effect's brightest text, or "word handoff". In word handoff, the current hero morphs between distance fields from one effect's layout position to the next effect's.
- **Effect timeline (director mode).** A lane under the waveform with clips per section. "Auto-assign" maps section roles to effects:
  - verse: BROADSIDE;
  - chorus: ELEMENTS;
  - bridge: DROSTE;
  - drop: SWARM;
  - outro: MISSION POSTER reveal.
  The user can drag clip edges (snapped to downbeats) and set per-clip parameters.
- **Preparation.** Each clip's `prepare()` result is cached. Switching or scrubbing never blocks: if a preparation is pending, keep showing the previous effect.

---

## 12. UI / UX

**Layout.** Left: project and inputs. Center: the stage, at the chosen aspect ratio, letterboxed. Right: parameter panel. Bottom: transport plus timeline.

**Bottom timeline**
- waveform;
- beat and bar grid;
- section bands, colored and labelled, editable;
- lyric word blocks;
- effect clip lane;
- playhead;
- zoom and scroll.

**Transport**
- play/pause (Space);
- scrub;
- loop region (I/O keys);
- playback speed: 0.5, 0.75 and 1;
- frame step (,/.);
- jump to previous or next line (←/→);
- jump to previous or next section (Shift + ←/→).

**Right panel**
- global settings (§13);
- effect parameters (auto-generated);
- presets: save, load, import, export JSON;
- A/B compare: hold B to see the saved state.

**Panels**
- **Inputs**: audio drop zone; lyrics paste, file import or tap-sync; ASR consent dialog with model size and expected time; analysis progress.
- **Debug overlay**, toggled with D:
  - word boxes;
  - read windows;
  - readability guard status;
  - fps;
  - GPU time;
  - prepare timings;
  - tile overflow;
  - particle count.
- **Empty state** with a one-click demo project. It uses a public-domain speech excerpt (section 18) and a bundled synthetic music bed generated at build time. Never ship copyrighted audio.

**Accessibility**
- every control is keyboard reachable with labels;
- reduced-motion preview mode;
- color palettes are checked for at least 4.5:1 contrast for text.

---

## 13. GLOBAL SETTINGS (sliders and controls)

| Setting | Range / options | Default | Notes |
|---|---|---|---|
| Sync offset | −400…+400 ms | 0 | applied to all words; calibration tool |
| Anticipation | 0…300 ms | 90 | entrance starts before onset; landing = onset |
| Minimum read | 250…1500 ms | 600 | guard window per hero |
| Intensity | 0…100 | 70 | scales every effect's energy params |
| Camera energy | 0…100 | 60 | scales camera travel and rotation |
| Text density | 0…100 | 60 | how many past words stay legible |
| Beat reactivity | 0…100 | 60 | how strongly bands and onsets modulate visuals |
| Case | as-is / UPPER / lower / Title | per effect | |
| Font pair | 6 bundled OFL pairs | per effect | e.g. Barlow Semi Cond + Barlow; Playfair + Oswald; Fraunces VF; Montserrat + Oswald |
| Palette | 10 presets + custom | per effect | custom palette validated for contrast |
| Motion blur | 0…100 | 30 | deterministic only |
| Grain | 0…100 | 15 | stationary, world-attached |
| Vignette | 0…100 | 25 | |
| Aspect | 16:9 / 9:16 / 1:1 | 16:9 | layouts re-prepare per aspect |
| Safe area | 0…12 % | 5 % | |
| Seed | integer + shuffle | random at project creation | |
| End card | toggle + title/artist/credit | on | |

---

## 14. SYNC AND LATENCY

- Preview clock: `t = ctx.currentTime − startedAt − (ctx.outputLatency || ctx.baseLatency || 0) − syncOffset`.
- Render with `requestAnimationFrame`, but derive t from the audio clock every frame, never from accumulated deltas.
- A word "lands" (is fully readable) at `word.start`. Entrances begin `anticipationMs` earlier. Effects must not land early or late by more than 1 frame. A unit test checks each effect's `landingTime(word)` against `word.start`.
- Scrubbing while paused renders the exact frame. Scrubbing while playing seeks the audio, with a 10 ms fade to avoid clicks.

---

## 15. EXPORT

- An offline deterministic loop for n = 0…N−1:
  1. `render(n / fps)` into an OffscreenCanvas (or the main canvas while the UI is locked);
  2. `new VideoFrame(canvas, {timestamp})`;
  3. `VideoEncoder.encode`, with a keyframe every 2 s;
  4. respect `encodeQueueSize` back-pressure.
- Audio: slice the decoded PCM, encode with `AudioEncoder` (AAC at 192 kbps, or Opus), and align timestamps exactly.
- Mux with `mp4-muxer` or `webm-muxer`, then offer the download. Files over 2 GB use the File System Access API for streaming output where supported.
- Options: resolution, fps, bitrate (auto/custom), range (whole song or loop region), burn-in end card, include audio.
- UI: a progress bar with ETA, cancel, and a frame-accurate preview thumbnail every 2 s.
- Fallback: real-time `MediaRecorder`, clearly labelled.
- Verify after export:
  - decode the first and last frame of the exported file and compare them with `render()` (PSNR above 35 dB);
  - check the audio duration matches the video within 1 frame.

---

## 16. PERFORMANCE BUDGETS

- Preview at 1080p and 60fps on a laptop with an integrated GPU (for example M1 or Iris Xe) for every effect at "Balanced" quality.
- Quality presets: Draft (0.5× resolution, fewer samples), Balanced, High (export).
- Dynamic resolution scaling in preview when frame time exceeds 16 ms. Export is always full quality.
- Full-screen shaders must use spatial tiles and early-outs. Ray marches have fixed step counts per quality preset.
- No per-frame allocations in render loops. Uniform buffers are reused, and textures are uploaded only at prepare time.
- Measure GPU time with `EXT_disjoint_timer_query_webgl2` when available and show it in the debug overlay.

---

## 17. PERSISTENCE

- A project is the audio reference (blob stored in IndexedDB), lyrics, alignment edits, analysis cache key, settings, effect timeline, and presets.
- Export or import a `.lyricengine` file: a zip of JSON plus the audio blob, with the audio optional.
- Autosave every 5 s while dirty, plus undo/redo (Ctrl+Z / Ctrl+Shift+Z) over all edits through a command stack.

---

## 18. TESTING AND QA

**Fixtures** (generated or public domain only)
- Synthetic songs produced at build time by a script:
  - a 120 BPM click plus bass pattern with a known drop at bar 17;
  - a 92 BPM track in 3/4;
  - an ambient track with no beat.
- A matching enhanced LRC with known word times, for example tone bursts standing in for syllables.
- Public-domain speech excerpts provided as text with synthetic timing:
  - Douglass 1852, "For it is not light that is needed, but fire…";
  - Kennedy 1962, "We choose to go to the moon…". Treat this as a text fixture only: timing is synthetic, no historical audio is bundled.
  - the Gettysburg Address.

**Unit tests**
- every lyric format parser;
- tokenizer and syllable counter;
- Needleman–Wunsch aligner (insertions, deletions, fuzzy matches);
- tempo within ±2 BPM on the fixtures;
- beats within ±25 ms;
- downbeat phase correct;
- section boundary within 1 bar;
- drop detection;
- director roles stable under the same seed.

**Determinism.** For each effect, render 12 timestamps in ascending order, then shuffled. FNV hashes of `readPixels` must match.

**Sync.** For each effect, `landingTime(word) === word.start ± 1 frame` for all words in the fixture.

**Readability.** The guard report passes for every hero in every effect on the fixtures. Failures print the word, the time and the reason.

**End-to-end (Playwright)**
1. Load the demo.
2. Switch through all 8 effects.
3. Move a slider and see a change.
4. Export a 5 s 720p clip.
5. Verify the file decodes and its duration matches.

**Visual QA.** A `npm run contact-sheet` script renders a 4×4 contact sheet per effect from the fixture into `qa/`.

---

## 19. MILESTONES (each ends runnable, tested, documented)

1. **Shell.** Vite/TS/React app, audio upload, decode, playback, transport, waveform, IndexedDB project.
2. **Analysis worker.** Features, onsets, tempo, beats, downbeats, sections, drops, cache, and the timeline beat grid and sections UI.
3. **Lyrics.** Parsers, tokenizer, syllables, line→word distribution, onset snapping, tap-sync, and the waveform word editor.
4. **Render core.** Clock, font service, glyph cache, SDF/MSDF atlas worker, spatial tiles, camera, post chain, readability guard, and the debug overlay.
5. **Effect API and sliders,** plus BROADSIDE end to end.
6. **ELEMENTS.**
7. **MISSION POSTER.**
8. **SWARM.**
9. **DROSTE.**
10. **PRESS.**
11. **LIQUID CHROME.**
12. **POP-UP.**
13. **Switching.** Effect browser, transitions, and the director-mode effect timeline with auto-assign.
14. **ASR path.** Consent flow, Whisper worker, aligner, and confidence UI.
15. **Export.** WebCodecs, muxers, verification, and the MediaRecorder fallback.
16. **Polish.** Presets, undo/redo, accessibility, performance pass, contact sheets, README with screenshots, and a licenses page (fonts and libraries).

After each milestone, print:
- what works;
- what is stubbed, with the reason;
- the test results;
- the measured preview fps per effect.

---

## 20. DEFINITION OF DONE

- A user can drop in a song and paste lyrics, and within 30 seconds watch a synced, beautiful preview in any of the 8 effects.
- They can switch effects live and adjust every parameter with sliders.
- They can assign effects per section.
- They can export an MP4 whose words land within one frame of the sung onsets.
- All tests pass.
- No network requests occur except the consented model download.
- The README explains:
  - architecture;
  - how to add a ninth effect using the plugin API, with a 60-line example effect included in the repo;
  - the known limitations, honestly.

# "Lyric Engine Pro" (v3): kinetic typography for music and speech
How to read this file. It is a complete, self-contained build specification. Hand all of it to a capable coding agent.

Everything without a [NEW] tag describes the working v2 app in app/ of this repository: its behaviour and constants are proven.
Everything tagged [NEW] is the v3 extension: more analysis, more effects, a compositor, modulation, post-processing, projects, live mode and an effect SDK. These parts are specified carefully but have not been built yet, so treat their constants as starting points and tune them by looking at rendered frames.
The agent does not need to have seen the films the original effects were derived from.
0. WHAT YOU ARE BUILDING
A browser app (Vite + TypeScript, no framework) where a user:

loads a song or a speech (any audio the browser decodes), its lyrics (LRC with optional word tags, SRT, VTT, or plain text) and, optionally, [NEW] stems, a translation, artwork and a background video;
gets an automatic musical analysis: tempo, beats, downbeats, onsets, bands, sections and drops, plus [NEW] meter, key, chords, vocal activity, vocal pitch and a mood curve. It also gets word-level timing, and [NEW] syllable-level timing;
watches the lyrics performed by one of sixteen typographic visual systems ("effects"). The user can:
switch effects freely and tune each with auto-generated sliders;
let Director mode switch effects per section, or [NEW] let the Auto-Director build the whole plan;
[NEW] stack effects as layers, re-skin words with materials, route any audio feature to any slider (the modulation matrix), draw automation curves, and grade the image;
exports a frame-exact MP4/WebM with the audio. [NEW] Export also covers 4K, transparent video, GIF, batch export for social formats, caption sidecars and loudness normalisation;
[NEW] can also run live from a microphone or line input, for concerts, karaoke nights and speeches.
Ship demo songs (synthesised by a script, original lyrics, no copyrighted audio) so everything can be tried with one click.

Quality bar.

Each effect must look like a finished motion-design piece, not a tech demo.
Text is always readable when it matters; motion is always on the beat.
[NEW] Nothing ships that can trigger photosensitive seizures (§10.3).
1. NON-NEGOTIABLE PRINCIPLES
Determinism. Every effect implements render(t) as a pure function of time t, the analysis, the lyrics, the parameters and a seed. No Math.random() at render time (use a seeded PRNG such as mulberry32), no per-frame accumulation, no physics integration. Scrubbing, preview and export call the same function.
Preparation vs rendering. Each effect has an async prepare() (layout, textures, signed-distance-field atlases, camera keyframes, lookup tables) and a cheap render(t). Parameters are marked live (applied instantly through setParams) or not (the stage re-prepares, debounced ~250 ms).
Sync. A word lands (becomes fully readable / hits its impact) exactly at its onset. Entrances begin before the onset: start = onset − entranceFrames/60 − anticipation. A global sync offset (ms) shifts all word times; a global anticipation (ms) pulls entrances earlier.
Everything is music-driven. Analysis arrays are sampled at 60 fps (sample(arr, t)); beats, downbeats, onsets and drops drive pulses, cuts, camera moves and special events.
No runtime CDN. Fonts are bundled .ttf files (OFL). Optional ML models (Whisper, stems) download only when the user asks, from a pinned source, and are cached.
[NEW] Determinism, extended. These must also be pure functions of t:
Film grain and "boil" jitter are seeded by the frame index round(t·fps), never by a clock.
Modulation smoothing (§9.4) is precomputed into 60 fps arrays at prepare time. No one-pole filter is ever stepped frame by frame at render time.
Phosphor persistence, trails and motion blur re-evaluate render(t − k/fps); they never read back a previous frame.
The one exception is Live mode (§14). It is explicitly non-deterministic, and its effects declare supportsLive.
[NEW] One GPU context. Browsers allow about 16 WebGL contexts per page, and 16 effects × layers would exceed that. All GPU effects render through a shared GLHost (§7.1).
[NEW] Budgets.
Preview: ≤ 16 ms per frame at 720p on a mid-range laptop for any single effect, and ≤ 33 ms for a full layer stack.
If the budget is exceeded, preview lowers its resolution adaptively (§11.6).
Export never lowers quality; it just takes longer.
[NEW] Safety and accessibility are features. They include:
a photosensitivity guard that is on by default;
a Reduce-motion setting;
a contrast check for every text-over-image layout;
keyboard access to every control.
Dependencies (pinned exact versions).
Runtime: mp4-muxer, webm-muxer, @huggingface/transformers (3.8.1; for ASR, lazily imported), and [NEW] fflate (project zip files) and gifenc (GIF export).
Dev: typescript, vite, esbuild, playwright.
Everything else is hand-written.
2. PROJECT LAYOUT
app/
  index.html, vite.config.ts (base './', worker format 'es'), tsconfig.json (strict, ES2022, DOM)
  public/fonts/*.ttf          v2: Playfair Display 900, Oswald 700, Barlow Semi Condensed 800, Barlow 700/500,
                              Barlow Condensed 800 Italic, Montserrat 800/600/300, Allerta Stencil,
                              Libre Caslon Text 700, IBM Plex Mono 500
                              [NEW]: Pacifico (neon script), VT323 (terminal), Bebas Neue, Abril Fatface,
                              Rubik Mono One, Special Elite (collage mix) — all OFL/Apache
  public/demo/                demo-song.{wav,lrc,json}; [NEW] demo-waltz.{wav,lrc,json} (3/4 duet, §16)
  public/luts/                [NEW] 4 small .cube LUTs (17³) made by script: warm film, bleach, teal-orange, mono
  scripts/                    make-fixtures.mjs, make-luts.mjs [NEW], test.mjs, test-*.ts, e2e*.mjs, showcase.mjs, sheet.py
  src/
    types.ts
    analysis/  dsp.ts worker.ts index.ts
               [NEW] hpss.ts vocal.ts pitch.ts harmony.ts meter.ts structure.ts mood.ts loudness.ts online.ts
    lyrics/    parse.ts  [NEW] syllables.ts voices.ts translate.ts
    align/     align.ts whisperWorker.ts index.ts
    director/  lexicon.ts director.ts  [NEW] autodirector.ts moodlex.ts
    render/    sdf.ts gl.ts icons.ts material.ts
               [NEW] glhost.ts skeleton.ts post.ts lut.ts flashguard.ts textkit.ts camera.ts
    effects/   types.ts registry.ts broadside.ts elements.ts mission.ts swarm.ts chrome.ts droste.ts press.ts popup.ts
               [NEW] neon.ts signal.ts sumi.ts monolith.ts mandala.ts ransom.ts fireworks.ts karaoke.ts
               [NEW] user/*.ts  (SDK effects discovered with import.meta.glob, §15)
    compose/   [NEW] layers.ts modulation.ts automation.ts
    project/   [NEW] store.ts history.ts zip.ts presets.ts
    media/     [NEW] background.ts artwork.ts
    live/      [NEW] input.ts worklet.ts follow.ts output.ts
    export/    exporter.ts  [NEW] alpha.ts gif.ts batch.ts captions.ts
    ui/        params.ts timeline.ts tapsync.ts  [NEW] lanes.ts modmatrix.ts storyboard.ts layers.ts projects.ts
    player.ts stage.ts main.ts style.css
3. DATA MODEL (types.ts)
type SectionLabel = 'intro'|'verse'|'chorus'|'bridge'|'drop'|'breakdown'|'outro'|'speech';
interface Section { start; end; label; energy /*0..1*/; cluster /*repeated material shares an id*/ }
interface Analysis {          // every per-frame array is at fps = 60
  fps; n; duration;
  loud; rmsDb; centroid; flux: Float32Array;                       // 0..1
  bands: { sub; bass; lowMid; mid; highMid; high; air: Float32Array };   // 0..1 each
  onsets: number[]; onsetStrength: number[];
  bpm; bpmConfidence; beats: number[]; downbeats: number[]; meter;
  sections: Section[]; drops: number[];
  peaks: Float32Array /*min,max per bucket*/; peakBuckets;
}
type Role = 'hero'|'support'|'connective';
type ElementKind = 'none'|'light'|'fire'|'water'|'shock'|'wind'|'vortex'|'quake'|'ice'|'smoke';
interface Word { id; text /*normalised*/; display; line; start; end; confidence; syllables; stress /*0..1*/;
                 role; roleLocked?; concept?; element?; elementLocked? }
interface Line { idx; words: number[]; start; end; section; text; repeatOf? }
interface Lyrics { words; lines; source: 'lrc'|'enhanced-lrc'|'srt'|'vtt'|'plain'|'tap'|'demo' }
interface Song { name; audio: AudioBuffer; analysis; lyrics }
interface ParamSpec { key; label; group; type: 'range'|'toggle'|'select'|'color'|'text'; min?; max?; step?; options?;
                      default; help; live: boolean }
interface GlobalSettings { aspect: '16:9'|'9:16'|'1:1'; syncOffsetMs; anticipationMs /*90*/; minReadMs /*600*/;
                           intensity; cameraEnergy; reactivity /*master %, 100 = as designed*/;
                           caseMode: 'upper'|'as-is'|'lower'; seed /*1776*/; endCard; title; artist }
interface Effect { id; name; description; params: ParamSpec[];
                   prepare(ctx:{song, settings, params, width, height}): Promise<void>;
                   setParams(p): void; render(t, out: CanvasRenderingContext2D): void; dispose(): void }
Every effect multiplies its own energy/camera/reactivity knobs by the master percentages.

[NEW] v3 additions to the data model:

interface Syllable { text; start; end; vowelStart? }          // per word, from §5A.1
// Word gains:  syllableTimes?: Syllable[]; voice?: string /*'A','B','all',…*/; backing?: boolean; pitch?: number /*mean MIDI*/
// Line gains:  translation?: string; voice?: string; mood?: { valence; arousal }
interface Chord { start; end; root /*0–11, C=0*/; quality: 'maj'|'min'|'dim'|'aug'|'sus'|'N' }
// Analysis gains (all per-frame arrays at 60 fps):
//   harmonic, percussive: Float32Array        energy of the HPSS parts, 0..1
//   vocal: Float32Array                        vocal activity probability 0..1
//   f0: Float32Array (MIDI, NaN = unvoiced);  f0Conf: Float32Array
//   key: { tonic /*0–11*/; mode: 'major'|'minor'; confidence }; keyChanges: {t; tonic; mode}[]
//   chords: Chord[]; meter: 3|4|6 (6 = compound 6/8); tempoCurve: Float32Array (local BPM)
//   repeats: { a; b; len }[]  (repeated passages, seconds);  mood: { valence; arousal: Float32Array }
//   lufs: number (integrated, BS.1770);  stems?: { vocals?; drums?; bass?; other?: AudioBuffer }
type LayerKind = 'plan' | 'effect' | 'media' | 'solid';
interface Layer { id; kind: LayerKind; effect?; instanceId; enabled; blend: BlendMode; opacity;
                  mask: 'none'|'inside-words'|'outside-words'|'luma'|'inv-luma';
                  material?: MaterialSettings; start?; end?; solo?; locked? }
interface ModRoute { id; source: ModSource; target: { instanceId; key }; amount /*-1..1*/;
                     curve: 'lin'|'exp'|'log'|'step'|'smooth'; attackMs; releaseMs; lo; hi; invert }
interface AutoKey { t; v; ease: 'hold'|'linear'|'ease'|'bezier'; c1?; c2? }
interface Lane { target: { instanceId; key }; keys: AutoKey[]; snap: 'none'|'beat'|'bar' }
interface Post { bloom; grain; chroma; vignette; distortion; halation; letterbox /*ratio|0*/;
                 lift; gamma; gain; saturation; temperature; lut?: string; lutMix; motionBlur /*shutter°*/ }
interface Project { id; name; created; modified; audio: Blob; stems?; lyricsText; translationText?;
                    lyrics: Lyrics; layers; instances: Record<string,{effect;params}>; plan; post;
                    routes: ModRoute[]; lanes: Lane[]; settings; media?; thumbnail?: Blob; version: 3 }
// Effect gains (§15): renderMask(t, ctx) is now REQUIRED; affinity: Affinity; supportsLive?: boolean;
//   supportsTransparent: boolean; ownsTitle?: boolean; prepareLive?(ctx); renderLive?(t, ctx, live)
Global settings gain:

aspect adds 4:5 and 21:9;
reduceMotion;
flashGuard (default on);
transparentBackground;
voicePalette;
showTranslation;
fontOverrides (role → user font).
4. AUDIO ANALYSIS (Web Worker, all DSP hand-written, deterministic)
Mono mix → resample to 22 050 Hz → STFT, Hann 2048, hop 256 (~86 frames/s), radix-2 FFT.

Per frame:

RMS; spectral centroid (normalised by Nyquist);
7 bands by RMS of magnitudes in [20,60,250,500,2000,4000,8000,11025] Hz → sub, bass, lowMid, mid, highMid, high, air;
40-band mel filterbank (30–8000 Hz) in log; spectral flux = sum of positive log-mel differences; 13 MFCCs (DCT-II of log-mel);
12-bin chroma (55–5000 Hz, A=440).
Outputs at 60 fps: percentile-normalise (5th→0, 95th→1) and smooth with attack 15 ms / release 120 ms. Align them in time with the onsets: frame i represents (i·HOP + lead)/SR, with lead = WIN/2 for energy-like features and WIN·0.82 for flux. Without this the features run about 80 ms early, and "flux high on a downbeat" never fires.

Onsets. Normalised flux; a local maximum is an onset if it exceeds 1.4 × median(±0.25 s) + 0.07 and is ≥ 50 ms after the previous one. Onset time = (frame·HOP + WIN·0.82)/SR. This correction matters: without it beats land about 34 ms early.

Tempo. Autocorrelate the onset envelope over 40–220 BPM, weighting with a log-Gaussian prior centred on 120 BPM (σ = 0.9 octave); confidence = peak prominence. Start the arg-max at −∞; a fixed fallback lag silently returns 120 BPM for slow material.

Beats. Dynamic-programming beat tracker (Ellis 2007): local score = onset envelope, transition penalty −α·log²(Δ/period), backtrack.

Downbeats. Pick the phase (mod meter = 4) that maximises the per-beat score bass/mean + 0.5·flux/mean + 1.2·harmonicChange/mean, where harmonic change = 1 − cosine between consecutive beat-synchronous chroma vectors. Chords change on bar lines, and without this cue drumless or backbeat-heavy music lands one beat off.

Speech detection.

Pulse clarity = mean flux on the beat grid ÷ mean flux. It is about 10–13 for music with a beat and about 3.5 for speech.
Silence ratio = share of frames ≥ 30 dB below the 95th-percentile level. It is ≤ 0.03 for music and about 0.34 for speech.
If silence > 0.15 and (pulse < 6 or confidence < 0.7), cap the tempo confidence at 0.05. That sends section-finding into speech mode, splitting at pauses.
Sections. Beat-synchronous vectors (12 chroma + 12 MFCC, each block L2-normalised).

Foote novelty with a Gaussian checkerboard kernel (K = clamp(nBeats/16, 4, 8) beats, i.e. at most 2 bars, so 4-bar bridges resolve).
Peaks ≥ 32 beats apart (16 for short tracks), snapped to the nearest downbeat within 2.5 s.
Cluster segments: cosine similarity > 0.975 and energy difference < 0.12. Merge adjacent segments in the same cluster.
Labels:
The most energetic repeated cluster → chorus.
Energy < 0.6 × mean (not first or last) → breakdown.
A quiet first section → intro; a quiet last section → outro.
A one-off section in the second half → bridge.
Low confidence: speech mode, splitting at pauses ≥ 1.2 s, at least 6 s apart. A confident but short clip (< 24 beats) is one section, not speech.
Drops. Bar-to-bar rise with bass > 0.28 and loudness > 0.18, preceded by a build (rising highs over the previous bars) or a breakdown; drops at least 8 s apart.

Waveform. 2000 min/max buckets.

Fixture test (scripts/test-analysis.ts, run with node --experimental-strip-types), on the demo song:

120 BPM, 73 s.
Sections: intro 0, verse 8, chorus 24, breakdown 40, chorus 48, outro 64.
One drop, at 48.
Pass if: tempo within ±1 %, beats and downbeats within ±20 ms, every section boundary found, exactly the one drop, ≥ 95 % of onsets recalled. Analysis takes about 1.5 s.
4A. [NEW] ANALYSIS v3 (same worker, after the v2 pipeline; deterministic; total budget ≤ 4 s for a 4-minute song)
Report progress in stages ("tempo", "harmony", "vocals"…) so the busy overlay can show them.

4A.1 Harmonic/percussive separation (hpss.ts).

Use the existing STFT magnitude |X|.
H = median of |X| along time (17 frames); P = median along frequency (17 bins).
Soft Wiener masks: Mh = H²/(H²+P²), Mp = 1 − Mh.
Per frame, the energy of Mh·|X| and of Mp·|X| gives the harmonic and percussive arrays (normalised like the other features).
Recompute onsets from the percussive part for beat tracking and from the full mix for word snapping. Percussive onsets beat-track much better on dense mixes.
4A.2 Vocal estimate and activity (vocal.ts).

Stereo input. Centre extraction per bin: weight = 1 − |L−R| / (|L|+|R|+ε) raised to the power 4. The vocal spectrum is centre · Mh · band(120 Hz–8 kHz).
Mono input. Skip centre extraction.
User stems. If the user supplies a vocal stem, use it instead and skip all estimation. Any stems the user supplies replace the estimates. Accept 1–4 files and match them by filename (vocals, drums, bass, other), letting the user reassign them.
Vocal activity (vocal, 0..1): a logistic combination of these per-frame features, smoothed with attack 30 ms / release 250 ms. Tune the weights on the fixtures.
vocal-band energy ÷ total energy;
spectral flatness of the vocal spectrum (low = tonal);
the YIN voicing confidence from 4A.3;
the 4 Hz–8 Hz modulation energy of the vocal-band envelope (syllable rate).
What it drives:
the Auto-sync gap filler: words never go where vocal < 0.2 for longer than 1 s;
the "instrumental break" detection used by every effect;
a modulation source.
4A.3 Vocal pitch (pitch.ts).

YIN on the vocal estimate (resynthesised by inverse STFT with the vocal mask; overlap-add, Hann², hop 256): frame 1024, threshold 0.15, parabolic interpolation, range 70–1100 Hz.
Keep the 3 best candidates per frame and run Viterbi over them, with a transition cost ∝ |Δcents|/100 and a voiced/unvoiced switch cost of 2. This is "pYIN-lite".
Output f0 (MIDI, NaN when unvoiced) and f0Conf.
Per word: pitch = median f0 over its span.
Per line: the pitch range, which effects use to place words vertically.
Detect melisma: one word spanning more than 2 distinct semitone plateaus of ≥ 120 ms. Detect vibrato: 4.5–7.5 Hz oscillation of ≥ 30 cents for ≥ 400 ms.
4A.4 Key and chords (harmony.ts).

Key. Sum chroma weighted by harmonic energy and correlate it with the 24 rotated Krumhansl–Kessler profiles. Confidence = best minus second-best correlation.
Key changes. Run the same over a 16-bar sliding window, accept a change only if it persists ≥ 8 bars, and snap it to a downbeat.
Chords.
Use beat-synchronous chroma (median over each beat's frames).
Templates: 12 major, 12 minor and a "no chord" (flat chroma). Add diminished, augmented and sus only if their score beats the triad by 15 %.
Run a Viterbi HMM with self-transition 0.9, uniform elsewhere.
Merge consecutive equal chords.
What it drives:
downbeat scoring (chord changes are already used in v2);
palettes ("key colour": hue = position on the circle of fifths × 30°; minor = 15 % less saturated, 10 % darker);
the MANDALA effect;
the modulation sources chordChange and tension (distance of the chord root from the tonic on the circle of fifths, 0..1).
4A.5 Meter and tempo drift (meter.ts).

Meter. Compare the strength of the downbeat score's periodicity at 3 and 4 beats (autocorrelation of the per-beat score). Call it compound 6/8 when the tempo prior prefers half-time and the beats subdivide in threes (onset energy at the 1/3 and 2/3 beat phases > the 1/2 phase).
Use the meter for downbeat phase selection (mod 3 or 4) and for every "per bar" rule.
Tempo drift. Build a tempogram: autocorrelation over 8 s windows, hop 1 s.
If the local tempo varies by more than 4 % over the song (live recordings), run the beat tracker with a time-varying period from the tempogram's Viterbi path. Store tempoCurve. Otherwise keep the v2 single-tempo tracker (it is more stable).
4A.6 Structure from repetition (structure.ts).

Build a beat-synchronous self-similarity matrix from key-invariant chroma: take the max over the 12 circular shifts, so a modulated last chorus still matches.
Enhance diagonals with a 16-beat diagonal median filter.
Extract stripes ≥ 8 bars long into repeats.
Fuse with the v2 Foote sections:
A segment that repeats ≥ 2× and has the highest energy is the chorus, even if v2's clustering missed it.
Lyric repeats (Line.repeatOf) add evidence. If ≥ 2 lines in a segment repeat lines from another segment, the two segments share a cluster.
The hook is the most-repeated lyric line inside a chorus. Effects may give it special treatment (BROADSIDE's fly entrance, KARAOKE's highlight).
4A.7 Mood (mood.ts, director/moodlex.ts).

Lyric valence/arousal. Use a hand-curated lexicon of about 800 common lyric words, written for this project (not a licensed dataset), each with valence −1..1 and arousal 0..1. Also handle negation ("not happy" flips valence within 3 words), and use intensifiers ("so", "very") ×1.3.
Audio arousal: 0.45·loudness + 0.25·flux + 0.15·tempo factor (bpm/180) + 0.15·brightness.
Audio valence: +0.3 for a major key, −0.3 for minor, + 0.2·(brightness − 0.5), plus the chord-quality share in the section.
Combine: mood = 0.5·lyric + 0.5·audio per line, then interpolate to 60 fps with a 2 s smoothing.
What it drives: palette temperature, camera energy, the Auto-Director (§9.6) and two modulation sources.
4A.8 Loudness (loudness.ts).

BS.1770-4 integrated loudness: K-weighting (shelf + high-pass biquads at 48 kHz), 400 ms blocks with 75 % overlap, absolute gate −70 LUFS, relative gate −10 LU.
Also short-term loudness (3 s) for the export normaliser (§13.4).
4A.9 Optional ML stem separation.

Behind a "High-quality stems" button: a pluggable ONNX source-separation model (4 stems) run in a worker with onnxruntime-web (WebGPU, else WASM).
Its model URL and expected input/output shapes come from a small manifest, so the app does not hard-code one model.
The DSP estimates in 4A.1–4A.2 must make everything work without it. Treat the ML path as an upgrade, with a clear download size and time estimate before it runs.
Cache the stems in the project (§12).
4A.10 Analysis cache. Bump ANALYSIS_VERSION and cache v3 fields under the same audio hash. If the user supplies stems, add their hashes to the key.

5. LYRICS
Formats.
LRC.
Stamps: [mm:ss.xx], [mm:ss.xxx] and [mm:ss:xx], with up to 3-digit minutes. Several stamps on one line repeat it.
Optional enhanced word tags <…>word. Text before the first tag starts with the line.
An empty stamp line ends the previous line.
[offset:±ms], and [ti:]/[ar:] metadata, which fill the title and artist. A BOM and CRLF are tolerated.
SRT and VTT, parsed block by block:
hours optional (VTT mm:ss.ttt); cue settings ignored;
multi-line cues joined; HTML tags stripped and entities decoded; empty cues skipped.
Plain text, one lyric line per line.
Tokens.
Words are split on whitespace. Chinese and Japanese runs split per character, with punctuation attached to the previous character.
Syllables: the English heuristic for Latin text, vowel letters for Cyrillic, one per character for CJK, about letters/2.5 for other scripts.
Normalisation lowercases and strips accents from Latin letters only, so kana voicing marks and Devanagari vowel signs survive.
Plain text is spread over the first-to-last onset span, weighted by syllables (+2 per line). Inside a line, words are distributed by syllable count (heuristic counter with an exception table).
Tempo-aware spreading. When a line has a start but no word times and the tempo is known (confidence > 0.1), sing about one syllable per eighth note (one per quarter below 100 BPM) instead of stretching to the next line. Compress only if the line is shorter than that, then snap to onsets.
Snapping. Words with confidence < 0.95 snap to the nearest onset within ±80 ms. End times are clipped so words in a line don't overlap; minimum duration 60 ms.
Line section. A line belongs to the section containing start + min(0.3 s, half the line). Pickups land just before the downbeat.
Repeats. repeatOf marks lines whose normalised text repeats an earlier one.
Tap sync (dialog):
Space starts playback, then marks "next word starts now".
Enter spreads the rest of the line evenly up to now.
Backspace undoes; Esc or Done finishes.
The result is word-level timing with confidence 1.
Line mode ("Tap lines only"): one tap per line. Each line runs until the next tap; words are placed by tempo-aware spreading and snapped to onsets.
Auto-sync (plain lyrics):
Run Whisper with transformers.js (@huggingface/transformers 3.8.1, pinned) in a worker.
Device: WebGPU when an adapter exists, else WASM. Bundle the ONNX runtime WASM; no CDN.
Models (downloaded once from huggingface.co, cached by the browser): Xenova/whisper-{tiny,base,small}.en for English, Xenova/whisper-{base,small} with a language choice for other languages.
Settings: chunk_length_s: 30, stride_length_s: 5, return_timestamps: 'word'. If a model can't produce word timing, fall back to phrase timing (true) and split phrases into words by syllables.
Input audio: 16 kHz mono via OfflineAudioContext, high-pass 100 Hz and low-pass 7 kHz.
Alignment: Needleman–Wunsch between the lyric words and the recognised words.
Scores: +2 exact, +1.2 at ≥ 70 % Levenshtein similarity, +1 shared stem of ≥ 3 letters, −1 otherwise.
Gaps: −0.6 to skip a lyric word (missed), −0.4 to skip a recognised word (hallucinated, common on instrumentals).
Anchors: matched words take the recognised start. Exact matches get confidence 0.96, fuzzy ones 0.75. Anchors must strictly increase.
Filling gaps between anchors (unmatched words, confidence 0.35):
Spread the words by syllables when the gap fits about 1.6 × 0.28 s per syllable.
Otherwise it's an instrumental break: finish the previous line right after its anchor, and start the rest at a section start inside the break if there is one, else lead them into the next anchor.
Cap a recognised word's end at start + 1.2 s when measuring a gap.
Afterwards snap only the estimated words to onsets. Dashed chips on the timeline mark low confidence.
Toast the match rate; below 30 %, suggest a bigger model, setting the language, or tap sync.
Show the feature disabled with an explanation on the hosted page, which can't reach huggingface.co.
LRC export. Download the current timing as enhanced LRC. Round to whole centiseconds before splitting into minutes and seconds (never :60.00), and clamp at 0.
5A. [NEW] LYRICS v3
5A.1 Syllable timing (syllables.ts).

Split words into syllables.
English: a Liang-pattern hyphenator (e.g. an npm package shipping the en-US TeX patterns; check the pattern licence), with the v2 heuristic counter as a fallback.
Spanish, Italian, German and French: their pattern sets.
CJK: one syllable per character.
Other scripts: the whole word.
Time the syllables inside the word's span.
Candidate boundaries are vocal onsets (from the vocal estimate's flux) and pitch-plateau changes (≥ 80 cents) inside the span.
Pick the K−1 best by dynamic programming. The cost is the deviation from a prior that splits the span in proportion to each syllable's vowel length (long vowels and diphthongs weigh 1.5, closed short syllables 1).
If there are fewer candidates than boundaries, use the prior.
Melismatic words. Give the last syllable the remaining span; the KARAOKE wipe then slows on it naturally.
Enhanced LRC. Accept per-syllable tags written inside a word (<00:12.30>yes<00:12.55>ter<00:12.80>day); they set the syllables exactly.
Export. The timeline can export these as ASS with \k tags (§13.5).
5A.2 Voices, duets and backing vocals (voices.ts).

Voice tags, at the start of a line or of a span:
v1: / v2:;
[A] / [B] / [A+B];
M: / F: / D: (duet);
the Apple-style {agent}.
Each tagged line or span sets voice until the next tag. In the lyrics editor, a voice can also be set per line from a dropdown.
Parentheses mark backing vocals: (ooh), (I said). Those words get backing = true, the connective role (never hero), and may overlap the lead in time.
Separate timing for backing words. They keep their own times, and the parser doesn't clip them against the lead line.
Every effect must handle voices and backing. §8.0 says how.
5A.3 Translation (translate.ts).

A second lyrics file (any supported format) is the translation.
Matching to the original:
Timed translations are matched to the original lines by maximum time overlap.
Plain translations are matched by line index, with blank lines ignored.
The result sets Line.translation.
Display is controlled by the global "Show translation" setting: off, under the line (small, 60 % opacity), or alternate (the translation replaces the line for its last 40 %).
No machine translation is built in.
5A.4 Scripts.

Grapheme clusters. Split letters with Intl.Segmenter (grapheme) everywhere an effect animates letters. Never split a JS string by code unit.
Joining scripts (Arabic, Syriac, N'Ko, Mongolian) and complex Indic shaping. Splitting these into letters breaks the shaping, so letter-level animation falls back to word-level animation. textkit.ts exposes canSplitLetters(word).
RTL (Hebrew, Arabic).
Canvas direction = 'rtl'.
Line layout runs right-to-left: effects get line.dir and must mirror their horizontal reading motions (slides come from the left; the camera pans leftwards).
Vertical CJK. SUMI and KARAOKE support top-to-bottom columns, right-to-left.
5A.5 Lyrics editor upgrades.

Syntax highlighting for tags.
Per-line voice dropdown.
A "Find repeats" button that shows the detected chorus lines.
Hover any line to see its timing.
A word-timing nudge mode: arrow keys move the selected word by 10 ms (Shift: one onset).
6. THE DIRECTOR (roles, stress, concepts, elements)
Stopwords. EN/ES/FR/DE function words plus fillers ("oh, yeah, la, na…").

Stress score per word (then rank-normalised within the line):

weight	feature
0.30	relative duration
0.20	loudness at onset
0.22	content word
0.12	has a concept
0.06	last in line
0.05	repeated ≥ 3× in the song
0.05	length
Roles.

Stopwords and words ≤ 2 letters → connective.
Every word that names a concept → hero, up to 2 per line, strongest first.
Otherwise the top-ranked word (2 for lines > 8 words, needing score > 0.35) → hero.
At least one hero per line. The rest → support.
User overrides persist (roleLocked).
Concept lexicon. A word matches a stem only as a real inflection: +s/es/ed/d/ing/er/ers/y/ly/n/en/'s, a doubled final consonant (stopped), e-drop (dance → dancing) or y → i (cries). So start ≠ star and hotel ≠ hot. Foreign stopwords that are English words (die, son, con, lo, pas) are left out. Each concept carries element, accent colour, icon and letter shape (ring = O-like, stem = I-like, tri = A-like):

fire (burn, flame, ember, ash…) → fire, flame icon, tri
light (shine, glow, sun, dawn, morning, star…) → light, sun, ring
water (rain, tear, ocean, river, storm…) → water, drop, ring
shock (thunder, break, broke, crash, shout…) → shock, bolt, stem
wind (air, breath, fly, whisper, sky…) → wind, wing, tri
vortex (spin, turn, around, world, again, dance…) → vortex, spiral, ring
quake (shake, earth, fall, rise, stone, wall, gate…) → quake, mountain, tri
ice (cold, frozen, snow, still, quiet…) → ice, flake, stem
smoke (ghost, fade, dream, haze, shadow, night…) → smoke, cloud, ring
heart (love, kiss…) → heart icon
home (house, door, window, garden) → house
moon → moon
time (clock, hour, wait, counting) → clock
road (street, drive, run, journey) → road
crown (king, queen, gold) → crown
bird (wing, free, freedom) → bird
eye (see, look, watch) → eye
music (song, sing, voice) → note
key (lock, open, chain, cage) → key
flower (rose, bloom, grow, tree, spring) → flower
people (crowd, together, friends, family…) → people
star (stars, heaven, galaxy) → star
Element assignment (heroes only, user overrides persist):

Lexicon first, then audio:
near a drop → quake
flux > 0.75 on a downbeat → shock
loud and mid-heavy → fire
quiet and bright → light
lots of highs → water
bright → wind
otherwise cycle light/fire/water/smoke/ice/wind
Rate limits: shock at most once per 4 bars (else fire), quake at most once per 8 bars (else smoke).
[NEW] Director v3 additions.

Backing words are always connective.
In duets, each voice gets at least one hero per line it sings.
The hook line's heroes get stress +0.15.
Pitch is a stress cue: the highest note in a line adds +0.08, and a melisma adds +0.1.
The word's pitch and the line's mood are passed to effects.
7. RENDERING FOUNDATIONS
render/sdf.ts:
FONTS map with FontFace loading.
capRatio(font): measured cap height per px; all layout is in cap-height units.
measureCap.
Exact Euclidean distance transform (Felzenszwalb & Huttenlocher) to build SDFs: makeSDF(text, font, capPx, spread=22) for a string, sdfFromAlpha(mask) for a whole rendered line.
Shelf-packing into a 4096-wide R8 atlas.
render/gl.ts: compile (uniform map, attribute 0 = aP), tex, fullscreenTriangle, and GLSL noise (hash, value noise, fbm, fbm3, rot).
render/icons.ts: 24 flat vector pictograms drawn into radius r with the current fill:
flame, sun, star, drop, bolt, wing, spiral, mountain, flake, cloud, heart, house
moon, clock, road, crown, bird, eye, note, key, flower, person, people, seal
Use even-odd holes, never destination-out, so icons composite over anything.
GPU effects render into their own WebGL2 canvas (preserveDrawingBuffer) and drawImage it into the stage. Canvas2D effects draw directly.
[NEW] v3 rendering foundations.

7.1 glhost.ts: one shared WebGL2 context.

One OffscreenCanvas (or hidden canvas) WebGL2 context, created with premultipliedAlpha: true and preserveDrawingBuffer: false.
Each GPU effect gets a GLScope:
its own programs, textures, framebuffers and VAOs, registered so dispose() frees them all;
begin(width, height), which binds the scope's output framebuffer and resets all GL state (blend, depth, scissor, viewport, pixel-store flags, bound units) to a known default;
end(), which returns the output as a texture handle for the compositor.
Compositor. It runs in the same context, so layers never round-trip through Canvas2D unless an effect is Canvas2D.
Canvas2D effects. They draw to their own 2D canvas, which is uploaded once per frame with texImage2D (premultiplied).
Context loss. Listen for webglcontextlost, then rebuild every scope by re-running prepare (show "Restoring graphics…").
Migration. Port the v2 GPU effects (ELEMENTS, SWARM, LIQUID CHROME, POP-UP, PRESS's engraving pass, the material pass) to GLScope; each one's own canvas becomes a framebuffer.
7.2 skeleton.ts: glyph centrelines (used by NEON, SUMI, FIREWORKS and the "trace" entrance).

Rasterise the word at cap 160 px.
Take its SDF (makeSDF).
Find the medial axis: pixels where the distance gradient's divergence is < −0.6, thinned with Zhang–Suen.
Trace 8-connected pixel chains into polylines, splitting at junctions.
Drop spurs shorter than 0.25 cap.
Simplify with Ramer–Douglas–Peucker (ε = 1.2 px), then smooth with 2 Chaikin passes.
Each point keeps its local half-width (the SDF value), so a brush or tube can follow the glyph's weight.
Stroke order: strokes sorted by (top-to-bottom, then left-to-right) of their first point. A stroke runs from its upper or left end. Arc-length tables give each stroke its length.
Cache by font|text|cap in IndexedDB; skeletonising is slow.
7.3 textkit.ts.

A shared layout kit used by all effects and the SDK:
grapheme splitting;
canSplitLetters;
RTL and vertical flow;
justified line fitting;
connective stacking (from BROADSIDE);
wordState(word, t) → { phase: 'before'|'entering'|'landed'|'sung'|'after', enter /*0..1*/, sung /*0..1 within its span*/, syllable /*index*/, syllableProgress }.
Every effect should use wordState instead of re-deriving timing, so anticipation, read time and syllables behave identically everywhere.
7.4 camera.ts.

A 2D/3D camera key system, generalised from BROADSIDE:
keys {t, x, y, zoom, roll, level?, ease};
collapse keys closer than 0.18 s;
whips, breathing and shake as additive layers.
Reduce motion (§10.4) scales shake and breathing to 0, limits roll to ±3°, and lengthens whips to ≥ 0.8 s with ease-in-out.
8. THE SIXTEEN EFFECTS
Each section gives the look, the rules that make it work on any song, and its parameters. "Hero / support / connective" are the roles from §6.

8.0 [NEW] Contract shared by all sixteen effects
renderMask(t, ctx) is required. It draws the same frame with every word white on black, and nothing else: no backgrounds, shadows, props or particles that aren't letters. Grey levels are allowed for partially revealed or faded words. This makes materials (§9.3) and word masks (§9.2) work on every effect.
Canvas2D effects: a maskMode flag and a mask palette.
GPU effects: a uMaskMode uniform that outputs the letter coverage.
Particle effects (SWARM, FIREWORKS) splat the particles that belong to letters.
supportsTransparent. When transparentBackground is on, draw no background, paper, table or sky, but keep the shadows the words cast (for compositing over footage). The effects that can't do this honestly (PRESS's page, DROSTE's panels, MONOLITH's floor) declare false; the export dialog says so.
Voices.
With voicePalette on, each voice gets a colour slot (A = the effect's accent, B = its secondary, all = both as a gradient or alternating letters).
Layout effects put voice B on the opposite side or row when it sings at the same time as voice A.
Backing vocals.
Words are drawn at 0.55× size, 70 % opacity, italic where the effect has an italic face.
They are placed where they never cover a lead hero: a lower stack, an echo, or a side margin.
Syllables. Wherever an effect reveals letters progressively (standup, typing, brush, tubes, wipes), it advances by syllable time, not evenly across the word.
Translation. Effects render line.translation through the shared subtitle(ctx, line, t) helper unless they declare ownsTranslation and place it themselves.
Affinity (for the Auto-Director, §9.6): a small table of 0..1 scores the effect declares for energy-high, energy-low, speech, dense-lyrics (> 3 words/s), sparse-lyrics, dark-mood, bright-mood and fast-tempo.
Reduce motion. Honour settings.reduceMotion. Every effect lists, in a comment at the top, what it calms.
8.0b [NEW] Upgrades to the original eight
effect	v3 upgrades
BROADSIDE	Standup and fly entrances advance per syllable. Voice B's lock-ups hang from the opposite side of the block. Backing vocals become the small vertical connective style. The hook line always gets the fly entrance and Barlow Condensed Italic. Key colour can replace the accent (palette "key").
ELEMENTS	Fire height and spark rate follow the word's pitch (higher notes burn hotter and whiter). Melismas stretch the activity window to the held note. Vibrato makes the water surface oscillate at the vibrato rate.
MISSION POSTER	Annotations add the key and chords (KEY A MIN · A–F–G–E). The rocket's altitude on the rail follows the vocal pitch contour (smoothed 300 ms). The countdown shows the meter.
SWARM	Particle colours can follow chord changes (each chord root takes a hue). The galaxy rotates at one turn per 8 bars in the given meter. Voice B's words form from a second particle population (25 % of N).
LIQUID CHROME	Spike height follows percussive instead of the raw bass when HPSS is available. Vibrato ripples the surface. Gold, rose and oil metals are tinted toward the key colour when palette = key.
DROSTE	Levels per bar follow the detected meter. A key change triggers a style swap at the next level boundary.
PRESS	Ink weight follows vocal loudness (vocal-band energy) instead of the mix when available. The melisma bend uses the real pitch contour: letters ride the f0 curve.
POP-UP	Cards for voice B stand on the facing page. Backing vocals are small flags on sticks. Pages turn on detected repeats as well as sections.
8.1 BROADSIDE — classic kinetic-type lock-ups
The 2010s political-ad / lyric-video style: huge justified words, tiny connectives turned sideways, slams, whip-pans, and a dive through a letter into a new world.

Palette ("classic").

Night world: background #1A1918 with a radial vignette to #050505; text bone #EDE7DA; 35 % drop shadow.
Paper world: #F2ECDF with 4 %-alpha horizontal scanlines and a warm vignette; text ink #15130F.
Accents: warm red #B3202A (fire, heart, crown, quake, shock concepts); cool steel #8FB0D6 on night, navy #1C2C5B on paper.
Other palettes: newsprint, neon (#FF2D75 / #29E3FF), mono.
Worlds. Verses, intros and bridges are night; choruses and drops are paper (or force one world).

Lock-up line. Each lyric line becomes items:

Big words (hero and support), Montserrat 800 by default.
A single connective of ≤ 6 letters becomes a vertical word (rotated −90°, 0.3 of line height) 45 % of the time.
Otherwise runs of connectives become stacks: 1–3 rows of small Montserrat 600 sized so the stack equals the line height (rc = (1 − 0.22(n−1))/n).
Measure natural widths at cap 100. Scale the whole line so it is exactly the measure: S = 1000/naturalWidth, capped at 420 so one-word lines don't explode. The line height is S: single-word lines become enormous, long lines small.
Lines with more than maxBig big words wrap into several lock-ups (2 in portrait). Connectives stay with the word they lead into.
Fonts by meaning.

The first line of a chorus or repeated hook is Barlow Condensed 800 Italic, and its first word does the fly entrance.
shock and quake → Allerta Stencil.
heart, crown, time, moon, star → Libre Caslon 700; 18 % of strongly stressed heroes also take Caslon.
Line spacing. 0.17 × min(prevH, S) plus extra room under lines whose props hang below.

Blocks. Lines stack into blocks: a new block per section, after linesPerBlock lock-ups, or after a gap > 3.5 s.

Block chaining within a world alternates rotation 0 → ±90° → 0:

A +90° block hangs down the right side of the previous one.
A −90° block reads upward beside it.
An upright block sits below.
The camera rolls to keep the active block upright. These rolls are the signature move.
The portal ("dive through the O"). When the world changes:

Find a big O, Q, 0 (then D or B) in the last six big words of the previous block, and replace that letter with a drawn ring (outer radius 0.56 cap, inner 0.36 cap).
If no such letter exists, stamp an O-ring after the block's last word, with a slam.
The next world is a new level whose first block is centred in the counter, scaled s = 0.93·r / hypot(500, h/2).
Levels. Each level has its own frame: parent coordinates = O + s·child.

Camera keys are tagged with their level. Interpolation between keys on adjacent levels happens in the deeper frame, which keeps precision at any depth.
Rendering at camera level L:
draw the parent (inverse transform) only while diving in or pulling out;
clip to the counter circle and fill the child world (fading in 0.35 s);
draw L;
draw any child level inside its ring.
Dive keys:
hold on the portal word ×1.05;
at tFull − 0.3, centre on the ring at zoom = 0.39·min(W,H)/R;
at tFull (≈ next word − 0.3), zoom = 0.66·max(W,H)/r, in child units, ease-in.
Entrances (frames at 60 fps before landing):

slam 5: scale 1.4→1, fade in over the first 40 %, then a 2-frame camera shake.
slide 14: from max(0.9·w, 3.4·cap) right, ease-out, with three 10/18/30 % ghost trails lagging 0.20/0.13/0.06.
drop 16: falls from 1.8 cap with a bounce.
ghost 14: scale 3→1, opacity 0.15→1.
standup 8 + 3/letter: letters scale up from the baseline with a back-ease, staggered 3 frames.
fly 50: letters fly in from seeded positions, rotations and scales, staggered 3 frames.
wipe 30: left-to-right clip reveal.
knocked: a slam whose letters get knocked askew 4 frames after impact.
tick: connectives cut on.
Choosing entrances (auto mode, seeded):

shock words → knocked.
Heroes with flux > 0.55 at onset → slam.
Quiet heroes (loudness < 0.28) → ghost.
Other heroes: slam 40 %, slide 28 %, drop 20 %, standup 12 %.
Supports: slide 50 %, slam 30 %, drop 20 %.
Avoid repeating the previous entrance.
The last big word of the song does a wipe plus a hand-drawn navy swash underneath.
Pictogram letters. For concept heroes, replace the first matching letter after the first:

Ring concepts: an O becomes a coin ring that spins once on landing, with the icon cut inside.
Stem concepts: an I becomes the icon.
Tri concepts: an A or V becomes the icon.
Props (concept heroes only, at most one every 1.6 s, drawn in block space; echo props get grey #77736B ghosts 4, 8 and 12 frames behind at 60/35/15 %):

concept	prop
fire	red flame tongues behind every letter, flickering in 4-frame steps
home	a skyline with a steeple rising under the word
people	4–11 silhouettes (tricorn man, bonnet woman, child, farmer) popping up
water	letters bob in a sine wave, with three scrolling wave strokes underneath
light, star	13 stars arc in along quadratic paths into a ring round the O, or an arc above
key, bird	a shackle on the first letter snaps open and falls (echo)
heart	two heart outlines bloom outward
shock	a big red bolt flashes behind the word
quake	the letters jitter for 0.7 s
road	a dashed road line extends
anything else	five copies of the concept icon march right-to-left under the word (echo)
Camera.

Per word: frame from the block's left edge to the token's end at width max(1.12·xEnd, 580, 1.5·w) and height 2.6 × line height (×0.8 in portrait). Keys closer than 0.18 s collapse.
A new block holds the last word, then whips (ease-in-out-quad) in the last 0.5 s.
Constant breathing: ±0.6° roll and ±1.5 % zoom.
Zoom pulse on beats.
The opening is a tilted plane: −15° roll plus skew, settling over 2.6 s.
Double exposure: the frame from 2 frames earlier at 22 % during whips and dives.
Ending.

If the last block is the first block of its level, pull back out through its O to show the whole last world inside the ring.
Otherwise fit the last block.
Fade to black over the last 0.6 s.
Params:

palette, worlds, accent amount
dive-through-O, 90° turns, lines per block, big words per line
entrances (auto / slam / slide / drop / standup)
pictograms, props, echo trails
shake, breathing, double exposure, tilted opening, beat pulse
8.2 ELEMENTS — words become the element they name (GPU)
Dark, cinematic, smoky.

Hero words (Oswald 700 uppercase) become fire, light, water, thunder, wind, vortex, quake, ice or smoke.

Supports are Oswald at 0.5 × hero size; connectives are Playfair Display 900 at connScale (0.3) × hero size.

Each element plays out and leaves a residue in the world.

Layout. A column per section and a block per line, wrapping at rowWidth (2400; scaled by aspect in portrait). Hero cap is 240 world units.

SDF rendering. Every word is an SDF in a shared R8 atlas, spread 22. The atlas cap is reduced until the atlas fits the GPU limit.

Per-frame data.

Per-word data lives in an RGBA32F data texture (255 words × 5 rows):
rect
atlas UV
style, reveal, scale, cap
element, activity, residue, baseline
seed, time since onset, rise, alpha
A 32-px screen-tile index (two RGBA8 textures, up to 8 words per tile) lets each pixel test only nearby words. Outside a word's bitmap, the SDF lookup returns a true lower bound (spread + distance to the rect), so effects never box-clip.
Activity windows. An element starts 0.6–1.0 s before its onset (fire 0.7, water 1.0, wind or smoke 0.9, shock exactly on the onset). It lasts until the next hero, at least 1.4 s and at most 4 s.

Element looks:

light: cold blue type, plus volumetric god-rays marched (26 steps) from the active light word's SDF.
fire:
domain-warped fbm flames rising out of the letters, through an ember ramp (black → red → orange → yellow → white), with intensity × (1 + 0.35 · mid · reactivity);
additive spark points rising above the word (instanced points, seeded lifetimes);
residue: charred letters with glowing ember rims.
water:
glass letters fill with water from the bottom up, left to right;
refraction of the background through a bevel normal, specular highlight, droplet speckle;
streaked rain across the screen while active, density following the hi-hats.
shock: on the exact onset, an expanding ring displacement wave (radius 2600 units/s, decaying), with a 4-frame white flash if the onset is strong.
wind: the word, and everything else on screen, smears downwind in 7 decaying samples; the word itself is slate-coloured.
vortex: a swirl displacement around the word whose strength reverses as it ends; the word keeps a small permanent twist.
quake: a Voronoi plate field around the word.
The plates shake on impact, then lock with persistent offsets.
The fault lines glow orange.
Up to three nearest quakes stay active.
ice: frost facets (Voronoi) grow from the edges inward, with a cold halo.
smoke: fbm wisps rise from the letters; as residue the word thins away from the top.
Camera.

Frame each line block; if a hero would be < 8.5 % of frame height, frame row by row instead.
Gentle drift.
At section breaks, pull back to show the section's column "as a record" of what the elements left.
Final pull-back to the whole world.
Palettes: soot (#0B0A09 → #171411, paper #EFE6D2), midnight, ember, ash.

Params:

palette, element intensity, persistence of residue
hero size, connective size, line width
meaning picks the element (or the music alone), shock flash, rain density, sparks
beat reactivity, camera energy, section pull-backs
8.3 MISSION POSTER — the song builds an engineering poster
Navy ink #101923, paper #F0EBDD, blueprint blue #23485E, orange #D96B35, brass #C3A36A. Faint paper specks across the world.

Zones. Each section with lines is a zone (split every 8 lines) of width 2300 (×0.62 in portrait).
Choruses sit on a blueprint panel: a blue rectangle with a 120-unit engraved grid.
The panel hinges up from 88° to flat over 0.55 s, just before the zone starts. It is a genuine projected plane: y' = y0 + d·cosφ, z = d·sinφ, perspective 2600/(2600+z).
Choose the poster's column count (snake order) whose aspect ratio is closest to the frame's.
Type.
Heroes: Barlow Semi Condensed 800, cap (150 + 100·stress) × heroScale.
Supports: Barlow 700, cap 78 + 30·stress.
Connectives: Barlow 500 at cap 50, grouped in stacks of ≤ 4 words in 1–2 rows, sitting left of the next big word with the stack's bottom row on the baseline.
Rows wrap at the zone width; fire, heart and shock words are printed orange.
Tower word. In zones with ≥ 3 lines, the longest hero (≥ 6 letters) stands vertically (−90°, reading upward) at the zone's right edge.
It arrives letter by letter (tower motion, 3-frame stagger).
Brass column rules rise beside it.
Lunar disc. The first big hero with an O after its first letter uses the compass motion:
Each O is drawn with a sweeping clip arc; the other letters rise out of a clip.
A pale disc (#E6E1D3) with two craters and a ring crater grows inside the O's counter.
A brass axis line then drops from the disc to the zone's bottom.
Entrances (frames before landing):
conn 7: rise 0.3 cap and fade.
register 26: letters converge from a doubled echo.
impulse 14: back-ease from the left (short words).
glide 28: from the right with ease-out-quint.
impact 16 (shock and quake): slides in and compresses an orange coil buffer at its left.
hero 22: snaps from 0.56 cap right with a −0.04 cap settle.
assemble 22: letters fly in from seeded offsets and rotations.
rule 22: a clip wipe.
rise 14 (light, fire, flower, star): up out of a clip.
snap 12, settle 16, stop 18 (last word ending in punctuation).
Construction graphics (opacity = guides param):
A brass hairline under every row extends as the row arrives.
Each zone's bottom is a rail: a "transfer guide" with tick marks every 240.
Registration crosshairs and corner marks flash at each hero landing.
A dashed brass route arcs between zones as the next zone approaches.
Annotations (IBM Plex Mono):
01 · VERSE · 0:08–0:24 at each zone's top-left.
120 BPM · 4/4 · 6 SECTIONS on the first zone.
DROP · T+0:48 in orange.
TRANSFER GUIDE on the rails.
A title block (title, artist, "LYRIC EXCERPT" in brass) at the poster's top-right.
Vehicle. A paper rocket (nozzle, body with rules and porthole, capsule, fins; 360 tall), or the song's most frequent concept icon.
It rides the current zone's rail over the zone's time, hopping on downbeats.
It flies a quadratic arc to the next zone during the last ~1.2 s, with orange exhaust while transferring.
It launches 520 units on drops.
After the last word it departs up and out along an arc.
Opening. Before the first word, the title (Barlow Semi Condensed) and artist sit where the first row will land.
Above them, a brass monospace countdown T−00:06.40 runs to the first word, with a brass rule under the title that fills as it counts.
It fades out as the first word lands. The effect sets ownsTitle, so the stage skips its generic title card.
Camera.
Frame each row (minimum width 1500), arriving 0.35 s before the row's first word.
Drift push along the row.
Pull back to the whole zone at section gaps > 1.4 s.
End on the whole poster, held while the rocket leaves.
Params:
palette (mission, blueprint, daylight, mars), panels (chorus / all / none), annotations, guides
hero size, zone width, tower word
vehicle (rocket / concept icon / none), launch on drops, lunar disc
camera drift, zone pull-backs
8.4 SWARM — a conserved particle crowd (GPU)
N particles (default 30 000; 5k–80k) build every line. None is created or destroyed.

Formations.
One per lyric line, in Oswald, wrapped to ≤ 3 rows filling about 86 % of width; heroes ×1.25, connectives ×0.7.
A galaxy disc (3 spiral arms) for the intro, for gaps > 5 s, and for the outro.
Formation start = line.start − 0.75 × travel, quantised to the 1/8-beat grid (half-beat in 4/4).
Targets.
Rasterise the line at 900 px wide and collect interior ink pixels (alpha > 200).
(1 − dust) of the particles take random ink samples; each stores its word index and role.
The rest wait as dim dust in a ring around the frame edge.
Pairing.
Sort the previous positions and the new targets along a Hilbert curve (1024 grid) and pair them in order.
Then two passes of adjacent swaps that reduce total squared travel.
Store every formation as an RGBA32F layer (x, y, word index, role) in a TEXTURE_2D_ARRAY, indexed by particle.
Vertex shader (gl_VertexID; all motion closed-form):
Departure is staggered left→right (stagger); travel lasts travel beats.
A seeded sideways bow along the path; a small arrival settle.
Idle wobble.
Beat breath: radial scale ∝ bass × beat pulse.
Trails: multi-sample the same particle at t − k/60.
Drop explosion. Particles burst along seeded radial directions with gravity, peaking 0.35 s after the drop, then re-form by the next downbeat after one beat (≤ 1.1 s).
Colour.
Words already sung are bright; upcoming words are dim at 25 %.
Heroes take the accent colour in choruses.
Looks: soft dot, 4-point star, petal, tiny human pictogram, confetti.
Palettes: ember, ice, gold, mono, neon.
Params:
particle count, look, size, trail samples
travel time in beats, stagger, path curve, wobble
beat breath, quantise to 1/8 beat, explode on drops
palette, waiting dust
8.5 LIQUID CHROME — ferrofluid typography (GPU)
Each line is a pool of liquid metal.

Inputs.
Rasterise every line (Montserrat 800, ≤ 3 rows, 80 % width) at long side 896.
Store SDF (spread 24) in R and the nearest word index in G in an RG8 texture array.
Field.
sd = mix(sdPrev, sdNext, melt) − 40·melt(1−melt): a smooth-min-style bridge that keeps blobs connected while melting.
Melt lasts melt beats and finishes before the line's first word.
Long gaps melt into an elliptical pool.
Height.
A two-scale bevel: 0.55·dome(−sd/7) + 0.45·√(−sd/20).
Unsung words sit at 22 % height and rise to full at their onset.
Ferrofluid spikes.
A hexagonal lattice of cones (cell 20/density raster px), masked to the letter core.
Height ∝ (sub + bass) × sensitivity, only on the active hero or support word.
Droplets. Kicks (strong onsets with bass > 0.5) launch droplets metaballs per kick from seeded emitter points on the letters.
Ballistic arcs (v_y −380…−700 px/s, g = 1400) are merged into the field with smin(k = 9).
They disappear as they land back into the pool.
Shading.
Normals from central differences of the height (×14).
The reflection vector looks up a chrome studio:
a bright sky gradient above a sharp horizon line, a dark floor below;
an overhead softbox and two vertical strip lights.
Bias the reflection so the horizon runs through the middle of the letters, giving the classic chrome band.
Fresnel.
Thin-film iridescence: 0.5 + 0.5·cos(2π(film + [0, .33, .67])), with film = height + 1.5·centroid + Fresnel.
Contact shadow offset below; studio, black or white backdrop.
Camera.
Slow perspective tilt (≤ 12°, rotation about the x axis), dolly 6 % on choruses.
Fade at the end.
Params:
metal (chrome, gold, rose, oil, mercury), iridescence, studio brightness
spike height, spike density, bass sensitivity
melt (beats), droplets per kick, tilt, backdrop
8.6 DROSTE — infinite recursion locked to tempo
The panel contains itself; the camera falls one level per bar, forever.

Geometry.
The inner window is the same panel scaled by k (0.32), anchored right, centre or left.
The map p → w + k·p has fixed point f = w/(1−k).
At recursion phase φ, scale everything about f by k^(−frac φ) and draw levels 0…7 explicitly, each clipped to its parent's window.
The loop is seamless at integer φ. No feedback buffers.
φ(t). A 60 fps cumulative table:
rate = levelsPerBar / bar after the first downbeat;
0 during breakdowns (freeze);
negative for 2 bars after each drop (the camera rises outward).
Content.
Absolute level L shows the lyrics at the time the recursion reaches L (extrapolated for future levels), so upcoming lines approach from inside the window.
Lintel band (top 20 %): the current line, with words revealed as sung.
Field: the current hero word as large as fits beside the window, with a scale pop on arrival and a beat pulse.
The window frame glows on downbeats.
Styles (night and day variants):
Art Deco: navy and gold.
Sunburst rays from the window centre, a stepped double border, a lintel rule with chevrons.
Oswald hero, Caslon lintel, LEVEL n label.
Brutalist: concrete slabs, a black lintel slab with a red tab, grid columns, Montserrat 800, mono lintel, 017/∞ counter.
Swiss: a 12×8 grid, a red bar, Montserrat.
Bridges and breakdowns swap to the next style at a level boundary.
Params: panel style, k, anchor, levels per bar (0.5 / 1 / 2), reverse on drops, freeze in breakdowns, ornament density, colour scheme.
8.7 PRESS — loudness becomes ink weight on an engraved page
Pages. Each section (or every 8 lines) is a page.
The text column is about 70 % of width (84 % in portrait).
Every line is justified at every moment: the word gap is recomputed each frame from the current widths.
Heroes are Playfair 900 (×1.08), others Libre Caslon (×0.95 / 0.86).
Running head (title, letter-spaced) and a rule, page number, a red two-line drop cap with the first two rows indented.
A ❦ fleuron appears after the last line is sung.
Weight.
Average loudness over a smoothing window (0.25 s); w = wMin + (wMax − wMin)·loud^1.3.
Positive weight dilates with a round-joined stroke; negative weight erodes with a destination-out stroke. Continuous, never a font swap.
Kicks add an 80 ms ink spread.
Each word prints with an impression overshoot (+1.5 weight, decaying over 0.18 s).
Width and slant. Spectral centroid → horizontal width 0.9–1.18 (the column re-justifies); stress → slant of heroes.
Melisma. Words held > 1 s bend letter by letter along a sine-arched curve with growing tracking and tangent rotation as the note holds.
Engraving shader.
The Canvas2D page is an ink mask (R = ink, B = second ink) plus a half-resolution blurred copy, used as "depth".
Every inked pixel is horizontal hatch: line period ≈ 4.2 px / density, slightly waved; line width swells from 0.38 to 1.05 toward the stroke core; crisp contour where depth is low.
Paper: fbm tone, pores and fibres, and a vignette.
Chorus pages print in the second ink (default #B52A1E).
Page turn (0.9 s, starting 1.2 s before the new page's first word):
curl:
A fold line travels right→left.
The flap's back shows mirrored paper with a quadratic-surface highlight and 8 % show-through of the old text.
The lifting flap casts a shadow on the old page, and the curl casts one on the new page.
slide: the old page slides off with a shadow edge.
cut.
Params:
lightest and heaviest weight, loudness smoothing, width from brightness
hatch density, paper (cream, white, grey, black), second ink colour
page turn style, melisma curves, drop caps
8.8 POP-UP — a paper theatre (WebGL2, no 3D library)
Scene.
A book spread (2.0 × 1.32) on a procedural table (walnut grain, felt or slate) with a warm key light.
Pages: cream with gutter shading and paper noise.
Hand-written mat4 math: perspective, lookAt, and a model matrix composed as translate · rotZ · rotX · scale with an optional pivot.
Cards.
Each word is a die-cut card: a canvas texture of the word (Montserrat 800 hero / Barlow 700) with a thick white die-cut border and a tab down to the hinge, colour from the paper set.
Hero cards are 0.5 tall, supports 0.34, connectives 0.24; a line's row is scaled to fit 1.86 wide (1.1 in portrait).
Hinged at the bottom edge: the fold angle goes from flat (lying away from the camera) to upright on the word's onset over 0.38 s, with a configurable overshoot and damped wobble.
Hero cards get a second slightly-offset light layer as a 3 mm white core edge.
Consecutive lines alternate between two depth rows; the previous line folds flat when the next arrives, so cards never intersect.
Concept heroes raise a cut-out prop card (the icon with a white outline and a stem) behind and beside them.
Shadows. Planar projection of every card onto the page along the light direction. Alpha comes from the card texture sampled at a mip level (shadow softness), × sin(fold angle).
Page turns. Per section (or every 8 bars), a sheet rotates 180° about the gutter. Old cards fold away first.
Camera.
Pitch is near top-down on verses and low on choruses (smoothly blended).
Gentle yaw sway and dolly.
The target follows the currently standing row.
Params: paper colours (circus, nursery, ink, sunset), table, pop overshoot, layer depth, props, page turn (section / 8 bars / never), shadow softness, camera angle.
8.9 [NEW] NEON — signs that switch on, one word at a time (GPU)
A wet city street at night. Each lyric line is a neon sign on a brick wall; each word lights up as it is sung.

Tubes. Each word's skeleton (§7.2) becomes a glass tube.
Heroes use Pacifico (script); supports and connectives use Montserrat 600.
Tube radius = tube × 0.09 cap. Script tubes take a constant radius; block letters take 0.8× their local half-width, so heavy strokes stay heavy.
Distance field. Render the tube polylines into an SDF texture per sign (EDT over the rasterised round-capped polylines) at prepare time.
Shader layers, by distance d to the centreline:
white-hot core for d < 0.3r;
coloured glass for d < r, with a specular streak on the upper side;
a two-scale glow a·e^(−d/6) + b·e^(−d/40) in the tube colour.
Unlit tubes show as pale grey glass with dark electrodes at their ends.
Ignition.
Heroes fill with light along arc length, like gas striking, over the word's first syllable (≥ 120 ms).
Supports and connectives strike all at once.
Each word first flickers through a seeded 6-step on/off pattern over 0.22 s that ends lit exactly at the onset.
Lit words stay on until the line ends, then dim to 35 % ("still warm").
One seeded tube per song is faulty: it flickers irregularly through breakdowns.
Signs.
Each line is mounted on a black metal raceway (a rounded rectangle 0.25 cap tall behind the baseline) with standoffs.
Thin cables hang between words in catenary curves.
Lines alternate between left- and right-aligned along the wall.
The wall.
Procedural brick: running bond, mortar recesses, fbm grime, a wet sheen.
It is lit by the signs: add the emission blurred through mip levels 3–6 as light, and modulate it with the brick normal (from a height function) so the bricks catch it.
Wall styles: brick, concrete, or black.
The street.
The bottom 28 % of the frame mirrors the scene with ripple distortion.
On every hi-hat onset in choruses, raindrops seed ring ripples that expand and decay over 0.8 s (closed-form rings).
The reflection is blurred along y.
Colour.
By concept: fire → orange-red #FF5A1F, ice/water → cyan #29E3FF, heart → pink #FF2D75, light/star → warm white #FFE7B0.
Otherwise by palette: Vegas, Tokyo, Diner, Mono white, or Key.
Drops. All tubes surge (glow ×2.2 for one beat). A transformer box at the wall's edge throws sparks: a seeded particle burst with gravity.
Camera.
Dollies sideways along the wall from sign to sign, with shallow depth of field: signs other than the active one are blurred using mip levels by their distance.
A slow push on held notes.
Params:
palette, tube thickness, glow, flicker amount, faulty tube;
script heroes, cables, wall, rain, reflection, depth of field, surge on drops.
Live: supported. In live mode, words ignite on the lyric follower's cue (§14).
8.10 [NEW] SIGNAL — a terminal, a CRT and a bad VHS tape
Lyrics are typed into a terminal on an old monitor; drops tear the signal apart.

Text layer (Canvas2D at the CRT's virtual resolution, 960×720 for 4:3).
Font: VT323.
Each line is printed as a log entry, prefixed > , or with a timestamp [00:24.51] (param).
Characters are typed per syllable: a syllable's characters appear evenly across its first 70 %, with seeded jitter ±15 ms.
A block cursor blinks on the beat: on for the first half of each beat.
Old lines scroll up.
Big words. Heroes can be printed as block art:
Rasterise the glyph at 12 rows; each cell takes the character █▓▒░ or a space by its coverage.
The art is printed row by row over the word's first 0.25 s.
System messages in inverse video, generated from the analysis:
BPM LOCK 120.0 (first downbeat), SECTION › CHORUS, KEY A MIN, DROP DETECTED, VOCAL LOST (instrumental breaks), SIGNAL OK (end).
CRT shader:
barrel distortion k = 0.12·curvature;
scanlines (cos² per row, 35 %);
an aperture-grille RGB mask;
bloom (mip glow);
a vignette with edge darkening;
0.5 % brightness flicker seeded per frame index.
Phosphor persistence. Re-render the text layer at t − k/60 for k = 1..5 (it is cheap) and add them with decay e^(−k/2.4). This is deterministic.
VHS mode:
chroma bleed (YIQ chroma shifted 3 px and blurred);
tracking lines rolling upward;
head-switching noise in the bottom 4 %;
a horizontal wobble sin(y·0.03 + t·2)·1.5 px;
an OSD PLAY ▶ and tape counter.
Glitch events (shock words, drops and chord changes in choruses, rate-limited to one per bar), each lasting 2–6 frames, seeded:
Block displacement: 3–9 rectangles shifted sideways.
RGB split: 2–8 px.
Row smear ("pixel sort"): within a band, each pixel takes the brightest pixel up to 40 px to its left, if above a threshold. Do it on a half-resolution copy, in the shader.
Rolling: a vertical-hold slip on drops.
Monitor.
Frame: none (full screen), a beige 1980s monitor bezel drawn procedurally, or a dark studio monitor.
In portrait, the monitor rotates 90° like an arcade cabinet, or the text reflows (param).
Params:
phosphor (green, amber, white, blue), display (clean, CRT, VHS), curvature, scanlines, persistence;
glitch amount, block-art heroes, log style, system messages, monitor frame.
Live: supported.
8.11 [NEW] SUMI — brush calligraphy on rice paper
Each word is written stroke by stroke with an ink brush while it is sung.

Strokes.
Skeleton strokes from §7.2 in stroke order. Fonts: Libre Caslon (the high contrast makes thick and thin brush strokes); system fonts for CJK.
The word is written between its entrance start and end. Stroke durations are proportional to length, with a 25 ms lift between strokes.
Heroes start 0.3 s earlier, so the last stroke lands on the stressed syllable.
Brush model, along each stroke at arc parameter s:
Pressure: p(s) = a quick press with a small hook at the start (first 8 %), a sustain modulated by 1D noise, and a taper at the lift (last 15 %).
Width = 2 × the glyph's local half-width × p × brush.
Ink load falls with distance since the last "dip" (each new word re-dips).
Flying white (飛白): when the load is below 0.35, alpha across the brush width is modulated by 16 bristle lanes of 1D noise, giving dry streaks.
The stroke is a ribbon mesh drawn into an ink-coverage buffer (GPU, additive coverage clamped at 1).
Paper and bleed.
Rice paper: fbm tone plus a fibre texture (thin random curves baked at prepare time).
Wet bleed: where the coverage was laid at time ts, the edge spreads to radius r(t) = r0·(1 − e^(−(t−ts)/0.25)), thresholded against the fibre texture. This is closed form: bleed time comes from a "laid-at" time buffer written alongside the coverage.
Edge darkening: add 0.35·(coverage − blur(coverage)).
Composition.
Latin: one line per sheet, horizontal.
CJK: vertical columns, right to left.
Verses scroll across a long handscroll; each chorus gets a fresh sheet.
Seal. At the end of each section a red seal (a square with the song's initials in Allerta Stencil, rough edges) is pressed onto the corner on a downbeat with a 2-frame squash.
Splashes.
On downbeats in choruses, seeded ink splatter clusters (droplets with tails) land near heroes.
On drops, a big ensō circle is brushed behind the line in one beat.
Camera. Follows the brush tip with a 0.15 s lag and slight zoom on heroes. It pans along the scroll for verses and holds the full sheet as each chorus ends.
Ink colours: black sumi, indigo, vermilion, or gold on black paper.
Params:
ink, brush size, dryness, bleed, paper;
splashes, ensō on drops, seal text, direction (auto, horizontal, vertical).
8.12 [NEW] MONOLITH — words as architecture (GPU raymarching)
Words rise from the ground as huge extruded stone slabs in an empty landscape, lit by a sun that crosses the sky over the length of the song.

Geometry.
3D signed distance: d3(p) = opRound(max(d2(p.xy), |p.z| − depth/2), bevel). Here d2 is the word's 2D SDF from the shared atlas (ELEMENTS' infrastructure: data texture plus screen-tile index, extended to 3D bounding boxes).
The words are oriented upright on an infinite ground plane.
At most 24 words are in the scene; older lines sink back into the ground.
Motion.
Rising: each word rises out of the ground (height offset −h → 0, back-ease) so it is fully up at its onset.
Breathing: the extrusion depth breathes ±6 % with bass.
Sinking: lines sink 1.5 s after they end.
Drops: the camera flies low through a canyon of the line's words, which are placed along both sides of an avenue.
Lighting.
Sun: its direction goes from dawn to noon to dusk across the song's duration.
Shadows: soft, from a raymarch with penumbra k = 8.
Ambient occlusion: 5 samples along the normal.
Atmosphere: sky colour from an analytic gradient; exponential height fog.
Hero words emit a soft light on their onset (a rim glow that decays over 0.6 s).
Materials by section:
concrete with board-form texture (verse);
polished marble with reflections of the sky (chorus);
obsidian with glowing orange seams (drop);
sandstone (bridge).
Shots.
Per line, a seeded shot from {orbit, dolly-in, crane-up, low hero angle, top-down}, cutting on downbeats.
Focal length 35–85 mm equivalent.
Depth of field approximated from a depth buffer and mip blur.
Shots never put the camera inside a slab: check d3 at the camera position and push out.
Performance.
March at half resolution in preview with a depth-aware upscale; 64-step budget, with early exit.
Export renders at full resolution.
No temporal accumulation (it would break determinism).
Params:
materials (by section, concrete, marble, obsidian), extrusion depth, sun path (song, fixed noon, night with moon);
fog, shot style (cinematic, static, orbit), cut on downbeats, AO quality, half-res preview.
Transparent background: not supported.
8.13 [NEW] MANDALA — a kaleidoscope locked to the bar
Symmetry.
Content is drawn into one wedge of angle 2π/n and folded by a shader (angle mod wedge, mirrored on alternate wedges).
n = 2 × beats per bar (8 in 4/4, 6 in 3/4); "auto" doubles it on drops.
Centre medallion.
The current hero is drawn unmirrored and readable in a central disc (Montserrat 800 or Playfair, by the line's mood).
It has a ring border that ticks on beats.
Rings.
Support and connective words are written along circular paths (text on a circle) in rings outside the medallion.
Ring i rotates at ±(i+1) turns per 8 bars, alternating directions.
Rings fade in from the centre as the line is sung.
Ornaments. Each beat, a new ornament ring grows outward from the medallion:
petals, arcs, dot chains, or the line's concept icons repeated around the circle;
its shape is chosen by a seed and the ornament style;
it lives 4 bars, drifting outward and fading.
Colour.
Palette "key" (hue from the circle of fifths, §4A.4), jewel, pastel, or mono.
Chord changes rotate the hue by the root's interval.
Breakdowns: rotation eases to a stop and the ornaments freeze.
Bridges: colours invert.
Drops: a zoom punch (scale 1.25 → 1 over one beat) and doubled symmetry.
Params:
segments (auto, 6, 8, 12, 16), rotation speed, ring density, ornament style (lace, geometric, floral, icons);
palette, medallion font, invert on bridges.
Live: supported.
8.14 [NEW] RANSOM — paper collage in stop motion
Every letter is cut from a different magazine; everything moves "on twos".

Letter swatches, generated per letter at prepare time with a seeded generator:
Font: one of the bundled faces (Bebas Neue, Abril Fatface, Rubik Mono One, Special Elite, Playfair, Oswald, Caslon).
Case and size: random case, ±12 % size.
Paper: newsprint with halftone, glossy colour, kraft, photo-like (a noise gradient with a fake subject blur), or black with white type.
Inversion: 15 % chance.
Rotation: ±8° × chaos.
Cut edge: a jittered polygon around the letter's box, with a white paper fringe on glossy stock and a soft drop shadow.
Stop motion.
All motion is evaluated at floor(t·fr)/fr, where fr is the frame rate param: 12 = on twos, 8 = on threes, 24 = on ones.
Landings stay exact: the pose that contains a word's onset is the landed pose.
Boil: every pose re-jitters positions by ±0.6 px and rotations by ±0.4°, seeded by the pose index.
Entrances:
slap: 1.3× → 1 over 2 poses, with a 1-pose overshoot;
slide-in: from the frame edge in 3 poses;
drop: from above with a 1-pose squash.
Decorations.
Masking tape: on heroes, a strip with torn ends lands on a downbeat.
Staples: on supports in choruses.
Marker doodles: stars, arrows, underlines and circles, drawn on beats around heroes as stroked paths revealed over 2 poses.
Boards.
Background: corkboard, kraft, black construction paper, or a photocopied wall.
Each section gets a new board through a torn-paper wipe: a ragged edge with a paper-fibre fringe.
Zine mode. The whole frame is photocopied: threshold to two tones, toner noise, slight misregistration.
Params:
chaos, frame rate (on ones, twos or threes), paper mix, tape, doodles, background, zine mode.
8.15 [NEW] FIREWORKS — the sky spells the hook
Shells.
Each hero is spelled by a firework. The shell launches from the skyline at onset − flight (flight 1.1–1.5 s, seeded) with a rising spark trail, and bursts exactly on the onset.
Shell types by concept and stress: peony (default), chrysanthemum (trailing stars), willow (fire, light: long gold drooping trails), crossette (shock: stars split in four), strobe (star, light: blinking).
Stars that form letters.
Sample starsPerWord target points from the word's glyph raster (as SWARM does).
Each star flies ballistically with linear drag k from the burst centre p0 to its target, arriving at τa = 0.28 s. Solve the launch velocity in closed form: v0 = (target − p0 − g·(τa/k − (1−e^(−kτa))/k²)) · k / (1 − e^(−kτa)).
Stars hold and glitter for hang seconds (sparkle = a seeded per-star blink), then droop under gravity and fade.
Trails: 4 samples at t − k/60.
Everything else.
Supports and connectives appear as small warm "lantern" text along the horizon, so every line is readable even when only the heroes explode.
Concept colours: fire → gold, water → blue, heart → red, light → white, otherwise the palette.
Scene options:
Harbour: a city skyline over water, with reflections and ripples.
City: the skyline only.
Field: trees, with a crowd silhouette that cheers on drops.
Light.
Each burst lights the sky and the skyline's rim with a flash that decays over 0.5 s.
The total brightness goes through the flash guard (§10.3), which matters here.
Smoke. Each burst leaves a smoke puff (fbm) that drifts with the wind and is lit by later bursts. Each puff is a closed-form function of t − tBurst.
Drops: finale barrage. A dense burst of shells over one bar.
Choruses: ground fountains on kicks.
Params:
stars per word, hang time, gravity, drag, scene, colour mode (concept, palette, gold);
smoke, finale on drops, ground fountains, readability backing.
Live: supported (shells launch on the cue with zero flight time: they burst immediately).
8.16 [NEW] KARAOKE — the clear one
Built for singing along and for accessibility. It is the baseline every lyric video needs.

Layout.
Two lines on screen (current and next) at the bottom or centre (param), alternating top and bottom slots so the eye never jumps.
Three-line mode adds the previous line, dimmed.
Syllable wipe.
Each syllable fills with the sing colour left to right across its exact span (§5A.1), with a soft 2 px edge.
Unsung text is white with an outline and shadow.
Wipe styles: syllable, word (fills at the onset), or line.
Voices. Voice A blue, voice B pink, both green, set by voicePalette. Backing vocals are small, in italics, in parentheses.
Countdown. Before a line that follows a gap of ≥ 4 s, four dots disappear on the beats.
Breaks. Instrumental breaks show a slim progress bar and "♪ instrumental".
Title page. Song, artist and "lyrics by" (text fields).
Bouncing ball (optional). A ball hops from syllable to syllable along parabolas, landing on each syllable start; its hop height is proportional to the gap.
Background. The media layer (§9.5) blurred and dimmed, or an animated gradient from the artwork palette.
Contrast.
The WCAG contrast ratio of the text against the mean background luminance under its box must be ≥ 4.5:1.
If it is not, the background under the text darkens automatically (a soft band) until it passes.
The check is computed at prepare time for static backgrounds and per frame (on a 32×18 downsample) for video.
Translation. Shown as a third, smaller line when on.
Params:
font, size, colours, wipe style, lines shown, position, bouncing ball, countdown, background dim, outline.
Live: supported. This is the karaoke-night mode.
9. STAGE, COMPOSITOR AND DIRECTOR MODE
Stage.
Owns the output canvas at preview resolution (540p / 720p / 1080p, by aspect).
Prepares the effects the current plan needs and disposes the others; WebGL contexts are scarce.
Tracks a prepare key (size, sync offset, case, seed, read time, aspect, non-live params, song stamp) so only stale effects re-prepare.
Plan. A list of {start, end, effect}.
Single mode: one effect for the whole song.
Director mode: one effect per section label, merging neighbours.
Default mapping: intro and outro MISSION POSTER, verse BROADSIDE, chorus ELEMENTS, drop SWARM, breakdown DROSTE, bridge PRESS. All editable in the panel.
Transitions at segment boundaries (section starts are downbeat-aligned):
hard cut;
white flash (0.3 s, quadratic falloff);
ink wipe (a ragged diagonal edge over 0.55 s);
dissolve (0.8 s).
Wipes and dissolves render both effects into offscreen layers.
Editing the plan on the timeline. The overview shows a coloured plan strip with effect names.
Drag a boundary to move it, snapped to the nearest downbeat and kept ≥ 1 s from its neighbours.
Double-click a segment to cycle its effect; neighbours that end up sharing an effect merge.
The edited plan becomes a custom plan until a mode is chosen again.
Automation can set any plan with setPlan(plan, transition); the showcase reel uses all eight effects.
Hybrid effects (v2; superseded by the layer stack in §9.1, which must reproduce it exactly; two independent options, both off by default; applied after the base frame and its transition, before the title card):
Material (a layout effect + a material).
Layout effects (BROADSIDE, MISSION POSTER, DROSTE, POP-UP) implement renderMask(t, ctx): the same frame with every word drawn white on black, and no background, shadows, panels or specks. Each sets a maskMode flag, calls render, then clears it. Pop-Up's mask brightness follows each card's ink, so blank card stock stays dark.
render/material.ts, MaterialPass.apply(frame, mask, out, t, settings, [bass, centroid, beatPulse, loud]): one WebGL2 pass. Height, edges and glow come from the mask's mip levels, so any layout works.
Materials:
liquid chrome: normals from the mask height, studio-environment reflections, Fresnel iridescence shifted by spectral centroid, a soft drop shadow;
fire: flames sampled from the mask at rising offsets (taller with bass) and fbm-modulated through a heat ramp; smouldering letter cores, glowing rims;
engraving: horizontal hatch lines that swell toward each stroke's core, on paper or over the layout;
neon: a white-hot tube along the letter edge and a tinted glow that pulses on the beat and flickers;
halftone: a 45° dot grid, dot size from mask coverage, swelling on the beat;
stardust: jittered twinkling points inside the letters that drift on the beat.
Settings: material, strength (× master intensity), backdrop (the layout's own frame, or the material's backdrop), tint.
Effects without renderMask ignore the material; the panel says so.
Overlay (a second effect on top): the chosen effect renders into an offscreen canvas and is composited with a blend mode (screen, add, multiply, overlay, soft light, normal) and an opacity (default screen, 0.6). It is skipped when it equals the current segment's effect. Rendering costs about two effects per frame, and the panel warns that exports take longer.
The stage prepares the overlay effect with the plan's effects. Both settings are saved with the session.
Title card. If title or artist is set and there is ≥ 1.2 s before the first word: Oswald title plus letter-spaced Montserrat 300 artist over a 35 % dim. Skipped when the current effect declares ownsTitle.
[NEW] Transitions v3 add:
match cut: the incoming effect's first hero lands at the screen position of the outgoing effect's last hero; both are found by bounding the word masks;
mask reveal: the new effect shows through the outgoing words' mask, growing over 0.6 s;
zoom-through: scale into the outgoing frame's brightest letter;
glitch: SIGNAL's block displacement for 4 frames.
Auto picks the transition by the kind of section change (§9.6).
9.1 [NEW] Layer stack (compose/layers.ts)
The v2 "hybrid" options become a general compositor. A project has an ordered list of layers, bottom to top:

The plan layer (always present, bottom): the Director or single-effect plan, as in v2.
Up to 4 more layers, each one of:
effect: any effect, with its own parameter instance, so the same effect can appear twice with different settings;
media: an image or video (§9.5);
solid: a colour or gradient, useful under multiply or as a vignette tint.
Each layer has:
blend: normal, screen, add, multiply, overlay, soft light, difference, colour dodge, or luminosity;
opacity: modulatable (§9.4);
time range: start and end, optionally snapped to sections ("chorus only");
mask: none; inside or outside the words of the layer below (its renderMask); or luma / inverse luma of the layer below;
an optional material (§9.3);
solo, mute and lock.
Compositing happens in the shared GL context (§7.1), with premultiplied-alpha blend formulas written in the shader. Don't depend on globalCompositeOperation, so results match exactly between preview and export.
Masks and materials share one word-mask render per layer per frame.
Cost. Each extra effect layer roughly adds its own cost. The layer panel shows each layer's milliseconds (§11.6).
Migration. v2's hybrid.material becomes the plan layer's material. v2's hybrid.overlay becomes a second layer with the same blend and opacity.
9.2 [NEW] Word masks as a creative tool
Because every effect provides renderMask, the compositor offers mask presets:

"Video inside the words": a media layer masked inside the words.
"Effect inside the words": e.g. ELEMENTS fire visible only inside BROADSIDE's letters.
"Knock-out": a solid layer masked outside the words, which leaves the letters transparent in an alpha export.
9.3 [NEW] Materials v3 (render/material.ts)
Inherited from v2: liquid chrome, fire, engraving, neon, halftone, stardust.
New:
glass: refracts the layer below through the mask's height normal (IOR 1.45), with a thin caustic edge and a Fresnel rim.
gold leaf: crinkled foil (Voronoi cells with random normals), a warm environment and slightly lifted edges.
frost: ice crystals grow inward from the letter edges over 0.8 s after each word's onset. The growth front is the mask distance compared with the time since onset, so it is closed form.
holographic foil: a thin-film rainbow whose phase follows the camera's motion and the centroid, plus a fine diffraction grating texture.
lava: a cooling crust (Voronoi plates) over glowing magma. Crack width follows loudness; plates glow brighter on kicks.
embroidery: satin-stitch strands run perpendicular to the skeleton direction, with thread highlights and a fabric backdrop.
Per-word time. Materials receive the time since onset for each pixel via a second mask channel: G = onsetAge encoded 0..2 s. Effects write it in renderMask, which lets frost and lava animate per word.
9.4 [NEW] Modulation matrix (compose/modulation.ts)
Any live range parameter of any layer, effect instance, material, post-process or global master can be driven by an audio or song feature.

Sources:
Levels: loud, sub, bass, lowMid, mid, highMid, high, air, flux, centroid, harmonic, percussive.
Pulses: beatPulse (e^(−7·(t − lastBeat))), downbeatPulse, onsetPulse.
Phases: barPhase (0..1 saw), songProgress, lineProgress, wordProgress.
Song: sectionEnergy, vocal, pitch (normalised over the song's vocal range), pitchVelocity, chordChange (pulse), tension, valence, arousal.
Generators: lfo (sine, triangle, saw, square; ¼ to 8 bars), sampleHold (seeded random per beat, bar or onset), constant.
A route = source → target with:
amount (−1..1 of the target's range);
a curve (lin, exp, log, step at 4 levels, smoothstep);
attack and release smoothing (ms);
clamps lo / hi;
invert.
Determinism. When a route is created or changed, compute its smoothed source as a 60 fps Float32Array (asymmetric one-pole run once over the whole song). Render time only samples it.
Pulses and LFOs are closed-form and need no array.
Value: final = clamp(base + automation(t) + Σ routes, min, max). Automation replaces base when a lane exists.
UI:
The grid: rows are sources and columns are targets, filtered to the selected layer. Click a cell to add a route.
Inspector: a live meter for the source and a curve preview.
On each slider: a modulated slider shows a small ring that moves with its live value.
Defaults: about 10 default routes come pre-wired but disabled, as a suggestion list ("Bass → Swarm breath", "Vocal → Press weight", "Tension → Mandala hue").
9.5 [NEW] Media layers and artwork (media/)
Images.
Pan and zoom (Ken Burns) between seeded framings, cut on bars, or held.
A slideshow of several images cuts on downbeats or sections.
Video. Frame-exact in export.
For each export frame, set video.currentTime = t − layerStart + inPoint, await seeked (or requestVideoFrameCallback), then draw.
Cache decoded frames in a ring of 8.
Preview plays normally.
Show a warning if the browser cannot seek precisely (variable frame rate).
Artwork palette.
k-means (k = 6) in Lab on a 64×64 downsample of the cover; pick the dominant colour, darkest, lightest and two most saturated.
"Auto palette from artwork" assigns them to every effect's palette slots through a per-effect mapping (paletteSlots: {bg, ink, accent, secondary}).
9.6 [NEW] Auto-Director (director/autodirector.ts)
It builds a full plan (effects, transitions and suggested layers) from the analysis.

Describe each section:
energy; words per second; tempo; mood (valence and arousal);
speech or music; label; vocal coverage; whether it repeats an earlier section (cluster).
Score each effect for each section: the dot product of its affinity (§8.0) with the section's feature vector, plus a small seeded jitter (±0.05) so different seeds give different cuts.
Constraints, solved with a small beam search (width 16) over sections:
never the same effect twice in a row (unless the section is longer than 45 s and is split);
repeated sections reuse their first occurrence's effect (choruses stay recognisable);
drops get the top-scoring high-energy effect;
the number of distinct effects stays ≤ variety (default 5);
speech sections only use effects with speech affinity ≥ 0.6.
Transitions by the kind of change:
into a drop: flash or cut exactly on the downbeat;
into a breakdown: dissolve;
into a bridge: mask reveal;
the same cluster again: match cut;
otherwise: the ink wipe.
Optional layer suggestions: e.g. SWARM at 35 % screen over the drop, NEON material on a chorus, KARAOKE as a translation layer when a translation exists.
The result is shown as a storyboard before it is applied: Apply, Shuffle (new seed) or Cancel.

9.7 [NEW] Storyboard (ui/storyboard.ts)
A strip of thumbnails, one per plan segment, rendered at the segment's most energetic moment at 160×90 in an idle callback, cached by prepare key.
Click a thumbnail to change the effect. Drag between thumbnails to change the transition. Hover to play a 2 s loop of that moment.
10. [NEW] POST-PROCESSING, GRADING AND SAFETY
10.1 Post stack (render/post.ts)
These run after compositing, in this order, all in the shared GL context:

motion blur (export only, §10.2);
halation: red-weighted glow of highlights;
bloom: a dual-filter (Kawase) downsample/upsample chain of 5 levels, with threshold and knee;
lens: distortion (barrel/pincushion) and chromatic aberration growing toward the edges;
colour grade:
lift, gamma, gain, saturation and temperature/tint;
then a 3D LUT: .cube files of 17³–65³, parsed into a TEXTURE_3D RGB16F with trilinear sampling and a mix amount;
four LUTs ship, generated by scripts/make-luts.mjs;
vignette;
film grain: luminance-dependent, seeded by the frame index;
letterbox: bars to 2.39:1 or 1.85:1 inside any aspect.
All amounts are live and modulatable. The whole stack is skipped when every amount is at its neutral value.

10.2 Motion blur by sub-frame accumulation
Because render(t) is pure, export can render S sub-frames across the shutter interval and average them in linear light (16-bit float accumulation target):
samples at t + (i/(S−1) − 0.5)·shutter/360/fps;
S = 4, 8 or 16;
shutter 90°–360° (default 180°).
Export time multiplies by S, and the dialog shows the estimate.
Preview can show a single-frame approximation, or none.
10.3 Photosensitivity guard (render/flashguard.ts; on by default)
It follows the WCAG 2.3.1 / ITU-R BT.1702 idea.

Definition. A flash is a pair of opposing changes in relative luminance of ≥ 10 % of the maximum, where the darker state is < 0.8, over a combined area ≥ 25 % of the frame. A red flash is the same, measured on saturated red.
No more than 3 flashes in any 1 s window.
Deterministic implementation:
Pre-pass. Render the whole timeline at 64×36 at the export fps in an idle background task (export runs it first if it hasn't finished). Measure the relative luminance and red saturation in a 4×4 grid per frame, and count flash pairs in sliding 1 s windows.
Fix. Where a window would hold a 4th flash, write an attenuation curve a(t) (0..1, eased over 3 frames). It scales every "flashy" contribution: the stage's white flash, effect flash events (ELEMENTS shock, FIREWORKS burst light, NEON surge, SIGNAL glitch brightness) and post bloom gain. Effects read ctx.flashAttenuation(t).
Verify. Re-run the pre-pass on the attenuated result; there must be 0 violations.
UI. A badge shows "Flash safe ✓", or the times it fixed. Turning the guard off needs a confirmation and is never persisted as the default.
10.4 Reduce motion
A global setting that also follows prefers-reduced-motion the first time. Effects calm themselves (§8.0), and the stage:

replaces flash transitions with dissolves;
caps zoom pulses at 2 %;
disables camera shake globally.
11. UI
Dark UI: #0D0D0F background, orange #FF5A1F accent, system font.

Top bar: Audio, Lyrics, Edit lyrics, Demo, and Export video (accent).
Centre:
The stage, letterboxed to the aspect.
An empty-state hero: "Make the words move with the music." with a demo button.
Drag-and-drop for audio and lyrics.
A busy overlay with progress and cancel.
Transport:
Play/pause (Space), back 5 s (←/→; Shift jumps a beat).
Clock m:ss.cc.
Beat lamp: yellow on downbeats, orange on beats.
Song info (bpm, words, resolution), preview resolution, click-track toggle (scheduled clicks; high on downbeats).
Timeline:
Overview strip: whole song; sections coloured and labelled; waveform; word ticks by role; drops in red; view window; playhead; click or drag to seek.
Detail lane (2–60 s window, wheel zoom, follows the playhead):
section bands;
loudness envelope tinted by bass;
onset ticks; beat ticks, taller and yellow on downbeats; drop markers; second grid;
word chips in two alternating lanes, coloured by role (hero orange, support light, connective dark), dashed when timing confidence is low, labelled with their element.
Interactions:
Drag a word to retime it; Shift drags the whole line.
Double-click cycles hero → support → connective, locked.
Alt-click selects a word for the inspector.
Click empty space to seek.
Right panel:
Effect grid (cards with name and description; keys 1–8 switch effects; v3 keys in §11.1).
Mode and transition selects; the director plan.
Global settings, generated from a spec list:
aspect; sync offset ±500 ms; anticipation 0–300 ms; minimum read time;
master intensity, camera energy, beat reactivity (%);
letter case; seed; title card; title; artist.
Hybrid panel: material, strength, backdrop, tint; overlay effect, blend, opacity; a note on what is on and whether the current effect supports a material.
Effect settings, auto-generated from the effect's ParamSpec[], grouped. Range sliders show their value and reset on double-click; toggles, selects, colour and text inputs; "Reset to defaults".
Word inspector: text, start, end, role, element, with stress, syllable and confidence info.
Analysis readout: tempo and confidence, beats, bars, onsets, sections with times, drops, lyric stats.
Lyrics dialog: paste or edit; Apply; Tap sync…; Download LRC.
Persistence:
localStorage (each access wrapped in try/catch): settings, per-effect params, current effect, mode, transition, director map, preview resolution.
IndexedDB:
The analysis is cached by the audio's SHA-256, with a version number so stale caches are ignored. The same song loads instantly.
The last session (audio bytes, lyrics text, the edited Lyrics with locked roles and moved words, title, artist) is saved 1.5 s after any change.
The start screen offers Restore last session — {name}.
Responsive: below 900 px the panel stacks under the stage.
11.x [NEW] UI v3 additions
11.1 Layout.
The right panel becomes tabs: Effect, Layers, Modulate, Post, Project.
The effect grid shows 16 cards with animated hover previews, which are cached thumbnails.
Keys 1–9 and 0 select effects 1–10; Shift+1–6 select 11–16.
11.2 Timeline lanes (ui/lanes.ts). Under the detail lane, add collapsible lanes:
Syllables: each word chip splits into syllable ticks you can drag.
Voices: chips are coloured by voice.
Pitch: an f0 curve with the vocal-activity shading.
Chords: chord names in blocks, with key changes marked.
Automation: one lane per automated parameter.
Click to add a key; drag to move it; snap to beat or bar (Alt disables).
Right-click a key to change its easing.
Select several keys with a rubber band and move or scale them in time.
11.3 Layers tab.
Drag to reorder layers; blend, opacity, mask, time range and material per layer; solo, mute and lock.
Each layer's own parameter panel opens inline.
The panel shows the per-layer cost in ms.
11.4 Modulate tab. The matrix and its inspector (§9.4).
11.5 Command palette (Ctrl/Cmd+K). Fuzzy search over every action, effect, parameter ("swarm particle count") and section ("go to chorus 2").
11.6 Performance HUD (toggle with `):
CPU ms per layer (performance.now);
GPU ms (EXT_disjoint_timer_query_webgl2 where available);
the preview scale.
Adaptive preview: if the frame time is over budget for 1 s, step the preview scale down 1 → 0.75 → 0.5; step it back up after 3 s under budget. Export is never affected.
11.7 Undo/redo (Ctrl/Cmd+Z, Shift+Z) for every edit (§12.2). The history panel lists the steps.
11.8 Accessibility.
Every control can be reached by keyboard, with visible focus rings.
Sliders take arrow keys (Shift ×10) and have ARIA labels with their values.
The timeline can be operated with the keyboard: Tab to a word, then arrows to nudge.
The UI meets 4.5:1 contrast.
There is a "Large UI" scale (125 %).
11.9 MIDI. With Web MIDI available, any slider can be MIDI-learned (right-click → Learn, then move a knob). Mappings are saved per project. This is useful in live mode.
12. [NEW] PROJECTS, PRESETS AND HISTORY
12.1 Projects (project/store.ts)
IndexedDB stores, keyed by project id:
projects: metadata;
blobs: audio, stems, media, fonts and thumbnails by SHA-256, so they are de-duplicated across projects;
analysis: as in v2.
Project browser: a grid with thumbnails, name, duration and modified date; rename, duplicate and delete (with confirmation).
Autosave 1.5 s after any change. "Restore last session" from v2 becomes "Open recent".
Storage quota. Call navigator.storage.persist() on first save, and show the usage from navigator.storage.estimate(). Near the quota, offer to delete cached analysis or stems.
12.2 History (project/history.ts)
Every edit is a command {do, undo, label, coalesceKey?}.
Slider drags and timeline drags coalesce into one step while the pointer is down.
Keep 200 steps; history is per project and is not persisted across reloads.
Prepare-key changes caused by undo re-prepare like any other change.
12.3 Project files (project/zip.ts)
.lyricengine = a zip (via fflate) holding:
project.json (versioned);
audio.*, stems/*, media/*, fonts/*;
lyrics.lrc (an enhanced LRC export, so the timing is readable elsewhere);
analysis.json (optional, to skip re-analysis).
Import checks the version and migrates v2 settings: a v2 session with hybrid becomes layers (§9.1).
Round trip: importing an export must give a deep-equal project.
12.4 Presets ("Looks"; project/presets.ts)
A Look bundles:
effect instances and their parameters;
layers, materials and the post stack;
modulation routes;
optionally, a plan template.
Save the current Look with a thumbnail. Apply keeps the lyrics and audio.
Share as a small JSON file; no audio or lyrics are included.
Ship 12 built-in Looks that show the new systems, e.g.:
"Neon Noir": NEON plus rain, bloom, teal-orange LUT;
"Zine": RANSOM in zine mode, grain;
"Cathedral": MONOLITH plus marble, halation;
"Karaoke Night": KARAOKE plus artwork palette;
"Broadcast": BROADSIDE plus SIGNAL overlay at 25 % screen;
"Gold Leaf Press": PRESS plus gold-leaf material.
13. EXPORT
WebCodecs offline render, frame-exact.
Re-prepare the stage at export size: 720p or 1080p, in the chosen aspect.
For each frame i: render(start + i/fps) → new VideoFrame(canvas, {timestamp}) → VideoEncoder. Keyframe every 2 s; back-pressure on encodeQueueSize > 4; yield to the UI every 3 frames with progress and ETA; cancellable.
Codecs. Probe with isConfigSupported:
MP4: H.264 (avc1.640033 → 640028 → 4d0033 → 42e033), then VP9, then AV1, with avc: {format:'avc'}.
WebM: VP9, VP8, AV1.
Audio.
Render the export range to 48 kHz stereo with an OfflineAudioContext.
Encode in 0.1 s AudioData chunks with AudioEncoder: AAC first, then Opus, at 192 kbps.
Mux with mp4-muxer (fastStart: 'in-memory', firstTimestampBehavior: 'offset') or webm-muxer.
Fallback. Without WebCodecs, record in real time: MediaRecorder on canvas.captureStream(fps) plus a MediaStreamDestination of the audio.
Options: resolution, 24/30/60 fps, whole song or N seconds from the playhead, quality (6/12/20 Mbps), format.
On completion: download the file and toast its size and codecs. Headless Chromium has no H.264 or AAC encoder, so expect VP9 + Opus in MP4 there; desktop Chrome uses H.264 + AAC.
13.x [NEW] Export v3
13.1 Formats and sizes.
720p, 1080p, 1440p and 2160p, offered only when VideoEncoder.isConfigSupported accepts the size. Use H.264 level 5.1/5.2 for 4K, falling back to VP9 or AV1.
Frame rates 24, 25, 30, 50, 60.
Aspects 16:9, 9:16, 1:1, 4:5, 21:9.
13.2 Transparent video.
With transparentBackground on, encode VP9 with alpha in WebM (alpha: 'keep'). Probe support first; Chrome has it.
Otherwise fall back to a PNG sequence in a zip, streamed through fflate so memory stays flat.
Effects with supportsTransparent = false are listed with a warning.
13.3 GIF.
gifenc with a global palette quantised from 8 sampled frames, ≤ 15 s, ≤ 720 px wide, 15 fps.
Optional ordered dither.
Optional seamless loop: choose a start and end a whole number of bars apart, and crossfade the last 0.25 s into the first.
13.4 Audio.
Fade in and out (ms).
Loudness normalisation to a target: −14 LUFS (streaming), −16 (podcast) or off. It applies one gain computed from the BS.1770 measurement of the exported range, with a true-peak limiter at −1 dBTP (4× oversampled peak detection plus a 5 ms lookahead gain envelope).
13.5 Sidecars (optional, saved alongside):
.srt and .vtt (line-level);
.lrc (word-level);
.ass (syllable karaoke with \k tags, voice styles, translation as a second style);
chapters.txt (YouTube chapter list from sections: 0:00 Intro, 0:08 Verse 1…, with repeated labels numbered);
a poster frame .png at the most energetic chorus moment.
13.6 Batch export.
Queue several outputs (e.g. 16:9 1080p MP4, 9:16 1080p MP4, 1:1 GIF).
Each re-prepares at its own size and aspect; layouts adapt, never crop.
Progress for the whole queue and per item; cancel per item.
13.7 Range.
Whole song, N seconds from the playhead, a selection on the timeline, or a section.
Optional pre-roll and post-roll in seconds, with the audio included.
13.8 Reliability.
Before a long export, warn about the expected size and time. Use the measured average ms per frame × frames × motion-blur samples.
Keep the screen awake with navigator.wakeLock if available.
Export to a FileSystemWritableFileStream when showSaveFilePicker exists (streaming, no memory spike); otherwise use in-memory muxing.
14. [NEW] LIVE MODE
For concerts, karaoke nights, worship lyrics, speeches and streams. Not deterministic.

14.1 Input (live/input.ts).
Choose the source: microphone or line in (getUserMedia with echo cancellation, noise suppression and AGC off), or a browser tab's audio (getDisplayMedia({audio:true})).
Show a level meter and an input-latency estimate.
14.2 Online analysis (live/worklet.ts, an AudioWorklet feeding a worker through a SharedArrayBuffer ring when cross-origin isolated, else postMessage):
Onsets: STFT 1024/256 at 22.05 kHz; spectral flux with a 2-frame look-ahead (about 35 ms latency); adaptive threshold over the last 1.5 s.
Tempo: onset-envelope autocorrelation over the last 8 s, updated every 0.5 s with the same prior as v2. Hysteresis: change tempo only if the new estimate wins for 2 s.
Beat phase: a phase-locked loop on onsets (gain 0.15), predicting the next beat so effects can anticipate it. Downbeats come from bass-onset strength at each phase (mod 4), re-evaluated every 4 bars.
Features: bands, loudness and centroid streamed at 60 fps into ring buffers; vocal activity from the band and flatness features (no pitch tracking live).
Sections: a novelty curve over the last 16 bars; a big energy rise marks a "drop".
14.3 Lyric following (live/follow.ts). Three modes:
Cue: an operator advances line by line (Space, PageDown, a MIDI note or a foot pedal). Words in the line reveal at the expected syllable rate × the live tempo.
Word cue: each tap is the next word. This is tap sync, live.
Auto-follow (experimental): match vocal onsets to the expected syllables of the current and next line with online DTW (band 2 lines). Advance when the cumulative match is ≥ 70 %. Fall back to Cue as soon as the operator presses anything.
14.4 Effects.
Only effects with supportsLive are offered: NEON, SIGNAL, SWARM, MANDALA, FIREWORKS, KARAOKE.
They implement prepareLive(ctx), which lays out lines on demand when a line is cued, with a 1-line look-ahead.
They also implement renderLive(t, ctx, live), which reads ring-buffer features and beat predictions instead of precomputed arrays.
14.5 Output (live/output.ts).
Presenter view: the operator window shows the controls, the next lines and the beat lamp.
Audience window: opened with window.open. It receives the stage via canvas.captureStream() into a <video>, or renders the same stage itself when BroadcastChannel sync is preferred. Fullscreen it on a projector with the Window Management API where available.
Stream: ?live&output serves a chrome-free page for OBS's browser source.
14.6 Safety. The flash guard runs online. It counts flashes on the 64×36 output in the last second and attenuates the next frames in real time.
15. [NEW] EFFECT SDK
defineEffect(spec) returns a class implementing Effect, with typed helpers:
the textkit (wordState, layouts, grapheme splitting);
camera keys;
glScope (GPU) or a 2D context;
sdfAtlas, skeleton, icons, palette (with key and artwork palettes);
seed(n) (a PRNG per purpose);
sample(arr, t), beatPulse(t), flashAttenuation(t).
spec declares:
id, name, description, params: ParamSpec[];
affinity;
supportsTransparent, supportsLive;
prepare, render, renderMask (required; a lint check fails the build if it's missing), dispose.
Discovery.
src/effects/user/*.ts is found with import.meta.glob and hot-reloads in npm run dev; the stage re-prepares only that effect.
No remote code loading: effects ship with the build or come from the developer's own files.
Template. npm run new-effect <name> scaffolds:
an effect file with a working minimal example (words fade and rise on onsets, with a mask mode);
a test that renders it at 4 times and checks determinism;
an entry in the docs.
Docs. docs/EFFECTS.md explains:
the contract;
wordState phases with a timing diagram;
how anticipation and read time work;
the do's and don'ts: no Math.random, no frame-to-frame state, never block in render.
16. DEMO FIXTURES (scripts/make-fixtures.mjs)
Synthesise a 73 s, 120 BPM WAV:

Sections: intro 0–8 (pad), verse 8–24, chorus 24–40, breakdown 40–48, chorus 48–64 (the drop), outro 64–73.
Instruments: kick on 1 and 3 (every beat in the choruses), snare on 2 and 4, eighth-note hats, bass following a four-chord loop (eighths in the choruses), a pad, a sixteenth-note hi-hat riser through the breakdown (so the drop is preceded by a build), and a pitched lead "vocal" tone on each lyric word.
Lyrics: 81 original words with enhanced LRC timing. Include words that exercise the lexicon: waiting, light, ember, night, river, morning, broke, garden, gate, fire, burn, bright, thunder, shake, sky, storm, rain, rise, turn, again, whisper, smoke.
Expected JSON for tests: bpm, downbeats, section starts, drop, word times.
Chords and key of the demo: one major triad per bar, cycling A – F – G – E, so the tonic is A. Write the chords and the tonic into the expected JSON.
[NEW] Second fixture demo-waltz. A 66 s, 3/4 waltz at 96 BPM in D minor:
Structure: 4-bar intro, verse (voice A), verse (voice B), chorus (A+B, with parenthesised backing vocals), bridge with a key change to F major, chorus, outro.
Two lead "voices": pitched tones with different timbres (formant pairs), plus a sustained melisma word of 1.6 s with 6 Hz vibrato.
Lyrics: original, with voice tags, syllable tags on 4 words, and a matching plain-text translation file (demo-waltz.translation.txt, written for the fixture).
Expected JSON: meter 3, bpm, downbeats, key changes, chords, vocal-activity spans, the melisma word and its pitch plateaus.
17. TESTING
npm test: scripts/test.mjs bundles every scripts/test-*.ts with esbuild and runs it with Node.
test-analysis.ts: the fixture checks in §4.
test-lyrics.ts:
format detection; enhanced-LRC word times; no overlaps; line-timed spreading; SRT;
blank-line handling; syllable counts; concept matching;
director roles and elements (concept words are heroes, stopwords connective, a hero in every line);
refreshLines; LRC round-trip.
test-align.ts, against the demo's true word times:
a perfect transcript (exact);
25 % missed, 15 % misheard, ±60 ms jitter plus hallucinations (median error < 80 ms, worst < 1 s, ordered);
phrase-only timing (median < 250 ms);
an empty transcript (ordered, inside the song);
a line missed inside a break (starts at the section, < 1.5 s off).
test-robustness.ts synthesises two more recordings in memory:
A 92 BPM ballad (8-bar drumless piano intro, soft verse, full chorus, 4-bar half-time bridge, chorus, pad outro). Expect: tempo ±3 %, beats < 30 ms, verse and chorus boundaries within a bar, the first chorus labelled chorus, ≤ 1 drop.
Formant-synthesised speech in phrases with pauses. Expect: speech mode, and > 80 % of word starts found as onsets within 60 ms.
Playwright e2e (scripts/e2e.mjs):
Serve vite preview, load the demo through window.LE.loadDemo().
For each effect: setEffect, wait for whenReady(), then renderAt(t) at chosen times and save stills.
Build contact sheets with sheet.py and inspect them; fail on any console or page error.
Run in 16:9 and 9:16.
Export e2e (e2e-export.mjs): export a 2 s clip and verify it with ffprobe (video and audio streams, duration, frame rate).
Director e2e: render around the section boundaries and take a UI screenshot.
Hybrid e2e (e2e-hybrid.mjs): every material on BROADSIDE, plus fire on MISSION POSTER, engraving on DROSTE, chrome on POP-UP, two overlay pairings and an all-off control; save stills and fail on errors.
Automation hooks on window.LE: ready, state, stage, player, loadDemo, setEffect, setParam, setSetting, setMode, setPlan, setHybrid, whenReady, renderAt, exportClip, applyLyrics.
Showcase reel (scripts/showcase.mjs): the demo song through all eight effects with flash transitions, exported via the app's own exporter.
[NEW] v3 tests.
test-analysis3.ts (on both fixtures):
HPSS percussive onsets: beat F-measure ≥ 0.95;
meter 3 detected on the waltz and 4 on the demo;
key: tonic correct on both, with the waltz's key change to F found within 2 bars;
chords: ≥ 80 % of beats correct;
vocal activity: frame F1 ≥ 0.85;
f0: median error < 30 cents on voiced frames, voicing recall ≥ 0.9;
melisma and vibrato detected on the right word;
BS.1770: within 0.3 LU of a reference value computed by an independent script on the same WAV.
test-syllables.ts:
hyphenation samples;
syllable tags parsed;
DP timing: syllable boundaries within 60 ms on the waltz's tagged words;
voices and backing parsed;
translation matched by overlap and by index.
test-modulation.ts:
precomputed smoothing equals a reference one-pole;
the value at t is independent of the call order (t sampled shuffled);
automation easing endpoints;
clamp behaviour.
test-project.ts:
zip round trip deep-equal;
v2-session → v3 migration (hybrid → layers);
undo/redo of 50 random commands returns to the start state.
Determinism e2e (e2e-determinism.mjs), for every effect, 16:9:
render t = 31.4 three ways: directly, after rendering 10 other random times, and after a re-prepare;
all three must be pixel-identical (compare getImageData hashes);
also after toggling a material and back.
Golden frames (e2e-golden.mjs):
4 times × 3 aspects × 16 effects;
compared with stored PNGs by a perceptual difference (mean SSIM on 8×8 blocks ≥ 0.97);
--update rewrites them after a deliberate change, and the diff images go to out/golden-diff/.
Flash safety (e2e-flash.mjs):
export the demo through a plan containing every effect with flash-prone settings maxed;
the guard's verification pass must report 0 violations;
with the guard off, the test must find violations (proving it measures something).
Export v3:
a 2 s VP9-alpha WebM: ffprobe reports alpha_mode=1, or the PNG zip fallback is valid;
a GIF has the requested frame count;
loudness-normalised audio measures −14 ± 0.5 LUFS;
the ASS sidecar parses.
Live (test-online.ts, Node):
feed both fixtures through the online analyser in 128-sample chunks;
after an 8 s warm-up, beat F-measure ≥ 0.9 and tempo within ±2 %;
mean beat-prediction error < 25 ms.
Performance (e2e-perf.mjs):
record median and 95th-percentile render ms per effect at 720p;
fail only on regressions > 30 % against a stored baseline from the same machine;
headless SwiftShader numbers are not comparable to real GPUs.
Automation hooks add:
setLayers, addRoute, setLane, setPost;
autoDirect(seed);
openProject, exportProject, importProject;
undo, redo;
flashReport();
renderMaskAt(t).
Showcase reel v3: the demo through the Auto-Director with seed 1776, plus a 9:16 cut, a KARAOKE cut of the waltz with translation, and a contact sheet of all 16 effects.
18. BUILD ORDER
Phase A: the proven v2 core (skip it if you are extending this repository's app/).

Scaffold, types, fonts, demo fixture.
Analysis worker plus its test.
Lyrics parsing, the director, the SDF and GL helpers.
App shell: player, stage, slider panel, timeline, tap sync.
The eight v2 effects in the order ELEMENTS, BROADSIDE, MISSION POSTER, SWARM, LIQUID CHROME, DROSTE, PRESS, POP-UP, each followed by stills review.
Export; Director mode; Auto-sync; hybrid.
Phase B: [NEW] foundations.

GLHost, and port every GPU effect to GLScope. Run the determinism e2e on all 8 effects before going on.
renderMask on ELEMENTS, SWARM, LIQUID CHROME and PRESS, so all 8 have it.
The textkit (wordState) and camera.ts; refactor the v2 effects onto them without visual change, checked with golden frames.
Projects, history and zip, including the migration of v2 sessions.
The layer compositor; migrate hybrid to layers; the Layers tab.
Modulation and automation, with their UI.
Phase C: [NEW] analysis and lyrics. Build these in order: HPSS, meter, vocal, pitch, harmony, structure, mood, loudness. For each: 13. write its fixture test first; 14. then the waltz fixture; 15. then syllables, voices and translation, then the timeline lanes.

Phase D: [NEW] the eight new effects. For each, render stills at verse, chorus, breakdown and drop moments in all three aspects, look at them, and fix what reads badly before starting the next.

KARAOKE first: it validates syllables, voices and translation end to end.
SIGNAL.
NEON (it also builds skeleton.ts).
RANSOM.
MANDALA.
FIREWORKS.
SUMI.
MONOLITH (the most expensive; do it last).
Phase E: [NEW] finishing.

Materials v3 and mask presets.
The post stack, LUTs and motion blur.
The flash guard and Reduce motion. Run the flash e2e on every effect; fix effects at their source, not only by attenuation.
Export v3: sizes, alpha, GIF, loudness, sidecars, batch, streaming saves.
The Auto-Director and storyboard.
Looks (presets) and the command palette.
Live mode, last; it reuses everything above.
Accessibility pass, the performance HUD and the docs (README, docs/EFFECTS.md, this prompt's v3 status table).
Throughout.

Keep npm test and the e2e suite green.
Commit after each numbered step.
Never let a new feature change an existing effect's golden frames without a deliberate --update and a sentence in the commit message saying why.

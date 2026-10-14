# Lyric Engine — build progress

Run: `cd app && npm install && npm run dev` (or `npm run build && npx vite preview`), then open the page and press **Demo**.

## Done
- **Audio analysis** (Web Worker): tempo, beats, downbeats, onsets, 7 frequency bands, loudness, spectral flux and centroid, sections (intro/verse/chorus/breakdown/…), drops. Validated on the demo fixture (`npm test`-style script `scripts/test-analysis.ts`).
- **Lyrics**: LRC (line and word-timed `<mm:ss>` tags), SRT, VTT, plain text (auto-placed), **tap sync** (Space per word), LRC export. Words snap to detected onsets.
- **Director**: stress, roles (hero / support / connective), concept lexicon → elements, pictograms and props; user overrides (Alt-click a word in the timeline).
- **App shell**: upload or drag-drop audio and lyrics, demo song, transport with click track, beat lamp, waveform/sections/beats/word timeline (drag words to retime, double-click to cycle role), auto-generated sliders for every effect, global settings (aspect 16:9 / 9:16 / 1:1, sync offset, anticipation, master intensity/camera/reactivity, case, seed, title card), settings persisted.
- **Director mode**: one effect per section label with transitions (cut / flash / ink wipe / dissolve).
- **Export**: frame-exact offline render via WebCodecs → MP4 (H.264/AAC, falls back to VP9/Opus) or WebM; real-time MediaRecorder fallback.
- **Effects**
  - **BROADSIDE** — the “HE HAS” kinetic-type lock-up, generalised.
  - **ELEMENTS** — the Douglass film’s fire / light / water / thunder / wind / vortex / quake / ice / smoke, GPU shader.
  - **MISSION POSTER** — the Moon film’s engineering poster.
  - **SWARM** — conserved particle crowd (Hilbert-paired formations, closed-form motion, drop explosions).
  - **LIQUID CHROME** — ferrofluid metal type (SDF melt, bass spikes, kick droplets, studio reflections, iridescence).
  - **DROSTE** — infinite recursion locked to the bar (freeze in breakdowns, reverse on drops, style swap on bridges).
  - **PRESS** — engraved page; loudness → ink weight, brightness → width, melisma curves, page curl.
  - **POP-UP** — WebGL2 paper theatre with die-cut hinged cards, props, planar shadows and page turns.
- Portrait (9:16) adaptations; Director mode verified.
- **Auto-sync**: Whisper (transformers.js, WebGPU/WASM, in a worker) + fuzzy sequence alignment of the user's lyrics; estimated words flagged.
- **Build prompt reverse-engineered** from this app: `prompts/lyric-engine-app.v2.prompt.md`.

## Ideas for later
- Per-clip editing of the Director plan on the timeline (drag edges, snapped to downbeats).
- IndexedDB projects and analysis caching by audio hash.

## Testing
- `node scripts/e2e.mjs <effect|all> <t1,t2,…> out/e2e` renders stills of the demo (needs `npx vite preview --port 4173`).
- `node scripts/e2e-export.mjs <effect> mp4 <start> <len>` exports a clip through the real exporter.
- `node scripts/e2e-director.mjs` checks Director mode and saves a UI screenshot.

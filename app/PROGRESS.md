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

## In progress / next
- New effects: LIQUID CHROME, SWARM, DROSTE, PRESS, POP-UP.
- End-to-end checks in 9:16 and 1:1.
- Reverse-engineer the build prompt from the finished app.

## Testing
- `node scripts/e2e.mjs <effect|all> <t1,t2,…> out/e2e` renders stills of the demo (needs `npx vite preview --port 4173`).
- `node scripts/e2e-export.mjs <effect> mp4 <start> <len>` exports a clip through the real exporter.

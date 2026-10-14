# Lyric Engine

Upload a song (or a speech) and its lyrics; Lyric Engine finds the beat, the sections and the drops, syncs every word, and performs the lyrics in one of eight kinetic-typography styles. Then it exports the video with the audio.

```bash
cd app
npm install
npm run dev          # open the printed URL, press "Try the demo song"
npm run build        # type-check + production build into dist/
npm test             # analysis + lyrics/director tests
```

Open `/?demo` to load the demo song straight away.

**Hosted version:** the app is also published as a private claude.ai page (no install): https://claude.ai/artifact/6gE9MUiM3F4EmpwvW1GRNZ. There, saving an export or an LRC file asks for your confirmation, and lyrics are saved as `.lrc.txt`. To republish after changes: `npm run artifact` writes `dist-artifact/index.html` and `dist-artifact/files.json`, the page and its supporting files.

## Workflow
1. **Audio**: drag a file onto the page, or use **Audio**. Any format the browser decodes. The analysis is cached per file, so the same song loads instantly next time.
2. **Lyrics**:
   - **Lyrics** (file) or **Edit lyrics** (paste).
   - LRC with `<mm:ss.xx>` word tags is exact. Line-timed LRC, SRT and VTT are spread on the beat. Plain text is auto-placed.
   - Use **Tap sync…** for exact timing: tap Space on every word, or tick *Tap lines only* and tap once per line.
3. **Pick an effect** (cards on the right, or keys 1–8), tune its sliders, or switch **Mode → Director** to change effect per section with a transition.
4. **Fix anything on the timeline**:
   - drag a word to retime it (Shift drags the whole line);
   - double-click to cycle hero / support / connective;
   - Alt-click to edit the word, its role and its element.
5. **Export video**: frame-exact MP4 (H.264/AAC where available) or WebM, 720p/1080p, 24/30/60 fps, the whole song or N seconds from the playhead.

Your last session (audio, lyrics, edits) is kept in the browser; the start screen offers **Restore last session**.

## The effects
| | |
|---|---|
| **Broadside** | Classic 2010s kinetic-type lock-ups: justified lines, vertical connectives, slams and whip-pans, pictogram letters, props, and a dive through the O between worlds. |
| **Elements** | Hero words become fire, light, water, thunder, wind, vortex, quake, ice or smoke, and leave their mark (GPU). |
| **Mission Poster** | The song builds an engineering poster: blueprint panels, brass guides, a tower word, a lunar disc, and a rocket that rides the rails and launches on drops. |
| **Swarm** | A fixed crowd of particles builds every line, flows between formations, breathes with the bass and explodes on drops. |
| **Liquid Chrome** | Ferrofluid type: liquid-metal lines rise word by word, spike with the bass, throw droplets on kicks and melt into the next line. |
| **Droste** | Infinite recursion locked to tempo: the panel contains itself, the camera falls one level per bar, breakdowns freeze and drops reverse. |
| **Press** | An engraved page that breathes: loudness becomes ink weight, brightness becomes width, held notes bend, choruses print in a second ink. |
| **Pop-Up** | A paper theatre: die-cut word cards hinge up on the beat with real shadows, props pop up beside heroes, and sections turn the page. |

## Keys
Space play/pause · ← → ±5 s · Shift+← → previous/next beat · 1–8 effects

## Notes
- Global **Sync offset** fixes lyrics that are early or late. **Anticipation** sets how far ahead entrances start, so words land on the sound.
- **Master intensity / camera energy / beat reactivity** scale every effect at once.
- Headless or older browsers without H.264/AAC encoders export VP9/Opus inside MP4. Without WebCodecs, export records in real time.
- Everything is deterministic: the same song, lyrics, settings and seed always give the same video.

Build notes and progress: [PROGRESS.md](PROGRESS.md). The full build specification, reverse-engineered from this app: [`../prompts/lyric-engine-app.v2.prompt.md`](../prompts/lyric-engine-app.v2.prompt.md).

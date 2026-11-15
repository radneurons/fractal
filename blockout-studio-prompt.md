# Build "Blockout Studio": an AI-directed previs editor for generative video

You are building a production-grade, browser-based 3D previsualization ("blockout") studio. The user stages scenes with simple mannequins, cameras and props. The app renders deterministic control passes from that staging. Claude acts as director, cinematographer, prompt writer and critic. A video model turns the blockout into styled footage. The guiding principle is that **geometry decides staging and timing, Claude decides the words, and the video model decides the look.**

Work in phases (listed at the end). Keep the app runnable after every phase, commit after each one, and don't start a phase until the previous one's acceptance checks pass.

---

## 0. Non-negotiables

- **Stack:** Vite + React 18 + TypeScript (strict), three.js via @react-three/fiber + @react-three/drei, zustand (with immer) for state, Tailwind + Radix primitives for UI, zod for every schema that crosses a boundary, Vitest + Playwright for tests. Use pnpm workspaces:
  - `apps/studio`: the editor
  - `apps/bridge`: local Node companion (Claude and generation gateway)
  - `packages/core`: scene model, ops, interpolation, cinematography math; pure TypeScript, no DOM
  - `packages/render`: offscreen multi-pass renderer
  - `packages/prompting`: prompt compiler, provider dialects, Claude tool schemas
  - `packages/mcp`: MCP server that exposes the studio to Claude
- **Edits as operations:** every scene mutation is a typed, serializable `Op` (for example `moveKeyframe`, `addCharacter`, `setLens`, `retimeSegment`) applied through one reducer. Undo/redo, collaboration, Claude edits, scripting and the change log are all built on this op stream, so nothing mutates state any other way.
- **Determinism:** the same project, shot and seed must produce byte-identical control passes. Rendering is frame-stepped, never tied to wall-clock time.
- **Secrets:** API keys live only in the bridge (an OS keychain via `keytar`, with an encrypted file as fallback). They never reach the browser bundle, localStorage or project files.
- **Performance budget:** 60 fps editing with 20 characters, 10 cameras and 200 props on a mid-range laptop. Offscreen export at 1080p must run at least 4× faster than real time for the clay pass.

---

## 1. Claude integration (the core differentiator)

### 1.1 Three connection modes, in priority order

1. **Claude Code bridge (default, uses the user's own Claude subscription).** `apps/bridge` runs locally and invokes the user's installed, already-logged-in Claude Code CLI in headless mode (`claude -p` with JSON output), passing the task, the relevant scene context and a strict output schema. Validate every response with zod. On a schema failure, retry once with the validation error attached, then surface the failure in the UI. Stream progress to the studio over WebSocket. Never read, copy or proxy Claude Code's credentials; only spawn the CLI. This is a personal, local tool, so don't build multi-user hosting on top of this mode.
2. **MCP server (Claude drives the studio).** `packages/mcp` exposes the studio as an MCP server, so Claude Code or Claude Desktop (signed in with the subscription) can operate it conversationally. It must provide these tools:
   - `get_project_summary`, `get_scene(shotId?)`, `get_shot(shotId)`, `list_takes(shotId)`
   - `propose_ops(ops[], rationale)`: queues edits as a proposal; never applies them directly
   - `render_preview(shotId, frames[], pass)`: returns PNGs so Claude can see the shot
   - `get_take_frames(takeId, frames[])`
   - `set_shot_prompt(shotId, provider, prompt)`, `run_continuity_check()`, `enqueue_generation(shotId, providerId)` (generation always requires confirmation in the UI)

   Also provide MCP resources for the style bible, character bible and change log. Include a one-command setup (`pnpm mcp:install`) that prints the exact config snippet for Claude Code and Claude Desktop.
3. **Anthropic API key (optional fallback).** Uses the official SDK in the bridge, with prompt caching on the stable project context (style bible, character bible, scene schema). Make the model configurable and default to the newest Claude model.

All three modes implement one `ClaudeBackend` interface: `run(task, context, schema) → stream<result>`. The UI shows which backend is active and, in API mode, what it costs.

### 1.2 What Claude does

1. **Edit-aware prompt compiler.** Each edit produces a semantic diff of the scene, for example: "Kenji's path now curves left; camera B changed from 35mm to 85mm; the lunge moved from 3.2s to 2.6s". Claude rewrites **only the affected shots' prompts** and keeps the user's manual wording where it still applies. The prompt panel shows a word-level diff (accept or reject per hunk). Prompts are versioned with lineage, and every take records which prompt version produced it.
2. **Camera language derived from real math.** Classify each camera's motion from its spline before Claude sees it, so Claude writes from facts rather than guesses:
   - movement type: static, pan, tilt, dolly in/out, truck, crane, orbit, handheld, whip
   - speed and easing
   - lens category from focal length
   - shot size from the framed subject's bounding-box height (ECU / CU / MS / WS / EWS)
   - camera angle (low, eye-level, high, overhead, dutch) and subject screen position

   Do the same for character action ("sprints 14 m left-to-right, decelerates, raises weapon at 2.6s"). Claude then turns these structured facts into prose with timestamps.
3. **Provider dialects.** Each video provider plugin declares its own prompt grammar, length limits, supported controls and camera vocabulary. Claude writes one canonical shot description, and the dialect layer adapts it to each provider. Add new dialects as plugins, not code edits.
4. **Natural-language direction.** Command bar (⌘K): "Have the grey ronin circle him twice, then lunge as the camera cranes up." Claude returns `Op[]`. The studio shows a ghosted preview of the result with the paths overlaid, and the user accepts, tweaks or rejects it. Claude can ask one clarifying question when an instruction is ambiguous.
5. **Script → blockout.** Paste a scene, a screenplay page or a paragraph of prose. Claude produces the characters, a rough set, blocking paths, a shot list with coverage (master, singles, inserts) and camera setups, all as a single proposal.
6. **Vision critique and adherence scoring.** After a take renders, send Claude sampled blockout and result frames. Claude scores staging adherence, character consistency (against reference sheets), style-bible adherence and artifacts (warped limbs, flicker, identity drift), then proposes concrete fixes such as a prompt change, a stronger control pass, a different seed or a re-staged moment. Pair this with an automatic numeric score: ID-mask IoU between the blockout and a segmentation of the result (via a pluggable segmentation provider).
7. **Continuity supervisor.** Geometric checks run locally, and Claude explains and prioritizes what they find:
   - 180° rule crossings, screen-direction flips across cuts, eyeline mismatches
   - jump cuts (same subject, similar size, <30° change)
   - prop and costume continuity from the bibles
   - lighting direction changes between shots
   - timing gaps or overlaps in the cut
8. **Living bibles.** Claude maintains a **style bible** (palette, medium, era, lens habits, lighting, references) and a **character bible** (appearance, wardrobe, weapon, silhouette notes and reference images per character, linked to that character's ID-mask colour). Every compiled prompt pulls from both. The user edits the bibles directly, and Claude proposes amendments when it notices drift.
9. **Coverage and alternatives.** "Give me three alternate camera setups for shot 4." Claude proposes cameras that respect the 180° line, and the user previews them as thumbnails side by side.
10. **Session memory.** The project stores Claude's decisions and the user's stated preferences ("I hate dutch angles", "always 2.39:1") and feeds them into future tasks as context.

Every Claude output that changes the project is a **proposal**: diffable, previewable, and atomically undoable as one history entry labelled "Claude: …".

---

## 2. Scene model and editing

- **Characters:** a rigged, CC0 humanoid mannequin with retargetable animation clips (idle, walk, run, sprint, crouch, jump, slash, thrust, block, dodge, hit-react, fall, sit, point, talk). Each character has a name, ID colour, height and build sliders, an optional held prop attached to a hand bone, a reference image, and a bible link.
- **Motion:** Catmull-Rom or Bezier paths with time-stamped keyframes, each carrying a clip, a facing mode (path / target / fixed) and a speed. Clips auto-blend, foot speed auto-matches the path speed, and feet stay planted with simple two-bone IK on uneven terrain.
- **Pose mode:** select a joint, rotate it and keyframe it. Additive layers on top of clips (for example a head turn during a run).
- **Webcam mocap:** MediaPipe Pose in-browser records a performance and retargets it onto the selected character as a new clip, with cleanup (smoothing, foot locking).
- **Phone virtual camera:** pair a phone with a QR code. It streams its gyroscope and accelerometer (DeviceOrientation over WebRTC) to drive a camera for real handheld operation, recorded as keyframes.
- **Cameras:** spline paths with keyframes for position, look-at (point or character with offset), focal length, focus distance, f-stop (shown as a focus-plane gizmo) and roll. Presets: dolly, truck, crane, orbit, push-in, pull-out, whip pan, vertigo (dolly zoom), top-down tracking, follow-cam with lag. Procedural shake has a profile (handheld, run-and-gun, earthquake). Sensor and aspect presets: 16:9, 9:16, 1:1, 2.39:1.
- **Set dressing:** primitives, a heightmap terrain sculptor (raise, lower, smooth, flatten), scatter brush (grass clumps, rocks, trees as low-poly proxies), GLB import, and simple proxy buildings and interiors from a 2D floorplan.
- **Lighting blockout:** sun direction from time of day and latitude, plus key, fill and rim lights and a sky colour. This drives the clay shading and is written into prompts ("low golden-hour sun, camera-left, long shadows").
- **Effects proxies:** volumes for dust trails, smoke, sparks, rain and slash arcs. They render to their own mask pass and are described in prompts.
- **Viewport overlays:** rule of thirds, golden ratio, safe areas, the 180° line between selected characters, eyeline rays, onion skins, motion trails, and frustum "cones" in the scene view.
- **Timeline:** dope sheet with per-property curve editor, a shot strip with cuts and a J/L-cut style overlap, audio tracks with waveforms, beat detection, and keyframe snapping to beats and markers. Range play, loop, and frame-step with `,` and `.`.
- **Collaboration (Phase 6):** Yjs CRDT over the op stream, so two people can block a scene together, with presence cursors in the 3D view.

---

## 3. Render and export

Offscreen, frame-stepped rendering at any resolution, encoded with WebCodecs (H.264 / VP9 / ProRes-like PNG sequence fallback). Passes:

| Pass | Purpose |
|---|---|
| clay | neutral matte with blockout lighting and shadows |
| depth | metric, plus a normalized preview |
| normals | view space |
| id mask | flat colour per entity, palette stored in the manifest |
| pose | OpenPose-style skeleton (body, hands and face points from the rig) |
| canny / lineart | structure guide |
| optical flow | motion vectors (for providers that accept them) |
| fx mask | from the effects proxies |
| camera data | per-frame intrinsics and extrinsics as JSON |

Export a **shot package** (zip) containing the passes, first and last frames, the manifest (prompt per provider, bible excerpts, references keyed by mask colour, seed, fps, duration), and a contact sheet. Whole-project exports: glTF and USD scene, OpenTimelineIO / FCPXML / EDL for the cut, and a storyboard PDF with frames, shot sizes and action notes written by Claude.

---

## 4. Generation pipeline

- **Provider plugins:** each provider plugin declares capabilities (text-to-video, image-to-video, video-to-video, the control passes it accepts, max duration and resolution, reference images), a cost model, and a dialect. Ship a deterministic **mock provider** (it stylizes the clay pass) so everything is testable offline, plus a generic HTTP provider configured by the user.
- **Two-stage generation (optional per shot):** first generate a styled keyframe with an image provider using the clay and depth passes plus character references. The user approves it, then image-to-video runs conditioned on the passes.
- **Queue:** concurrency limits, retries with backoff, cancel, a cost estimate before each run, and a per-project budget cap with a warning at 80%. Each take stores its seed, prompt version, passes, provider and cost.
- **Takes browser:** grid of takes per shot with synced A/B scrubbing, with the blockout overlaid at adjustable opacity. Mark circle takes, add notes, and see Claude's critique score.
- **Assembly:** the selected takes per shot drop into a cut timeline with trims, crossfades and audio, then export the final MP4 plus the interchange formats above.
- **Upscale and fix hooks:** a provider slot for upscaling, frame interpolation and inpainting a region (drawn mask → regenerate only that area).

---

## 5. UX

- Layout: the left side holds a large **Scene** view. The right side stacks **Blockout** (active camera) and **Result** (current take). The bottom holds the timeline. The right sidebar has Inspector, Prompt, Bibles, Takes and Claude tabs. Panels are dockable, and the layout persists.
- Claude tab: a chat thread scoped to the project, with every proposal rendered as an interactive card (preview / apply / edit / reject) and every MCP or bridge action logged.
- Keyboard-first: W/E/R transforms, K keyframe, Space play, C camera-from-view, F frame, Tab toggles scene/blockout focus, ⌘K command bar, ⌘Z/⇧⌘Z undo/redo, number keys switch shots.
- Theming: dark default with a light theme, a colour-blind-safe ID palette, full keyboard navigation and ARIA on panels.
- Autosave to IndexedDB with crash recovery, plus a `.blockout` project file (zip: JSON + assets) for portability. Every save also writes a human-readable change log entry.

---

## 6. Quality

- Unit tests (`packages/core`): spline arc-length sampling, keyframe interpolation and easing, op reducer invertibility (apply → invert → equal), camera motion classification, shot-size classification, 180° and jump-cut detectors.
- Golden-image tests: render fixed frames of the demo project per pass and compare with a tolerance.
- Contract tests: every Claude task's zod schema checked against recorded fixtures. A fake `ClaudeBackend` replays fixtures so CI never calls Claude.
- Playwright E2E: create a character → draw a path → add a camera → export a shot package → run the mock provider → view the take.
- Perf test that asserts the budget in §0.

---

## 7. Demo project (ships with the app)

"Field Duel": two swordsmen on a windswept golden plain at golden hour, with a dust-trail effects proxy. Six shots:

1. top-down tracking of the sprint
2. low-angle hero with a push-in
3. over-the-shoulder standoff
4. orbit during the clash
5. whip pan to the reaction
6. extreme wide shot as one walks away, trail behind

Pre-fill the style bible ("hand-painted anime, saturated sky, cumulus clouds, painterly wheat") and the character bible. The demo must also include one deliberate 180° violation so the continuity checker has something to find.

---

## 8. Phases and acceptance

1. **Core:** monorepo, scene model, op reducer with undo, characters, paths, playback, timeline. Accept when the demo plays and every edit is undoable.
2. **Cameras and shots:** camera splines and presets, Blockout view, shot strip, overlays, cinematography classifiers. Accept when classifier unit tests pass and the demo's 6 shots play as a cut.
3. **Render:** all passes, shot package, golden tests. Accept when export is deterministic and meets the speed budget.
4. **Claude:** `ClaudeBackend` with the Claude Code bridge first, then MCP server, then API key; prompt compiler with edit diffs, camera-language facts, NL direction, script → blockout, proposals UI. Accept when editing a path updates only the affected shot prompts with a reviewable diff, and Claude Code can drive the demo through MCP.
5. **Generation:** provider plugins, mock provider, queue and budget, takes browser, vision critique, continuity supervisor, assembly and exports.
6. **Advanced:** webcam mocap, phone virtual camera, terrain and scatter, effects proxies, Yjs collaboration, region inpaint hooks, storyboard PDF.

After each phase, write a short `docs/phase-N.md` covering what was built, how to run it, what's tested, and the known gaps. Then continue to the next phase.

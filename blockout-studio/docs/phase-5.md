# Phase 5 — Generation

**Built**
- Provider plugins (`packages/pipeline/src/providers.ts`). Each declares a kind, modes, accepted control passes, maximum duration and resolution, a cost model and a prompt dialect.
  - A deterministic **mock** video provider stylizes the clay pass with the style-bible palette and ink edges: same seed, same bytes.
  - Mock **image** (two-stage keyframe), **upscale**, **frame-interpolation** and **region-inpaint** providers fill the fix-up slots.
  - A **generic HTTP provider** is configured as JSON: a templated request body with `{{prompt}}`, `{{seed}}`, `{{firstFrame}}`, `{{pass:depth:0}}`, `{{secret:NAME}}` and so on, plus optional polling. It runs inside the bridge, so keys stay in the keychain and CORS does not apply. Seedance, H3 or any other API is added this way, together with its dialect.
- Queue: concurrency limit, retries with exponential backoff (non-retryable errors fail fast), cancel, a cost estimate before every run (with a confirm step in the UI), and a per-project budget cap that warns at 80% and refuses above 100%.
- Each take records its seed, prompt text, prompt version, passes sent, provider and cost.
- Takes browser:
  - grid per shot; ◎ circle; "Use" adds the take to the cut; notes;
  - A/B compare with a draggable split, synced to the playhead; the blockout overlays the Result view at adjustable opacity;
  - new seed, upscale, interpolate, and inpaint from a mask you paint on the take.
- Two-stage generation per shot: generate keyframes, approve one, and image-to-video receives it.
- Scoring: model-free mask IoU (pluggable `SegmentationProvider`), flicker above the blockout's own motion, and distance from the style palette; these run automatically after every take. **Vision critique** sends paired blockout/result frames plus reference sheets to Claude and gets back scores, issues and concrete fixes; with no vision backend it falls back to a numeric critique.
- Claude's `enqueue_generation` over MCP appears in the Takes tab as a Confirm/Decline card; nothing runs without the user.
- Continuity supervisor: geometric checks plus Claude's explanations and fix proposals (Claude tab), shipped in phase 4.
- Assembly: the cut renders from selected or circled takes (falling back to the blockout) with trims and crossfades to MP4/WebM via WebCodecs, or a PNG zip. Exports: OpenTimelineIO, FCPXML, CMX3600 EDL, USDA (cameras time-sampled), glTF (GLB), and a storyboard PDF whose action notes Claude writes.

**Tested** `pnpm test`:
- mock determinism; upscale, interpolate and inpaint (only the masked region changes);
- budget thresholds; queue concurrency, retry/backoff and cancel;
- the HTTP provider (templating, secrets pulled only from the keychain, polling);
- IoU behaviour and an end-to-end take score;
- OTIO/EDL/FCPXML agreement on a cut with a trim and a crossfade; USDA structure; PDF structure (xref offsets).

`pnpm test:e2e` covers the brief's flow: create a character → draw a path → add a camera → export a shot package → run the mock provider → view the take.

**Follow-up (after phase 6)**
- **Scoring:** a seeded segmenter replaces the saliency heuristic. Eroded blockout masks seed per-entity colour clusters learned from the result frame itself; the background is learned from a ring around each silhouette. The headline IoU is character-weighted, with props reported per entity. Spatially exact mock takes of the demo now score 0.67–0.99 (were ~0.17), and the unit test checks that a 10% drift scores clearly worse.
- **Mock provider:** paints characters in costume tones taken from the ID pass, as a real model would from the bible, so on-mark takes are distinguishable from the ground.
- **HTTP-provider takes:** the bridge downloads the result video (http(s) only, 512 MB cap); the studio decodes it at the project fps into local frames, then scores and critiques it like any other take. E2E-tested against a fake provider server.
- **Audio in the final cut:** tracks are mixed into cut time, following trims, J-cut leads, L-cut tails and edge fades (`mixCutAudio`, unit-tested), and encoded with WebCodecs `AudioEncoder` (AAC where available, otherwise Opus) next to the video. When no audio encoder exists, a WAV goes into a zip with the video. E2E-tested.

**Known gaps**
- The built-in seeded segmenter is model-free. It needs subjects whose colours differ from their surroundings, and it judges where colour regions sit, not identity. For production scoring, connect a real model in Takes → Providers → "connect a model": an HTTP segmenter (e.g. SAM) that runs in the bridge with keychain secrets and receives the frame, the blockout ID mask as a hint, and the palette. It is tested against a stub server. Identity remains the vision critique's job.
- Frame decoding uses the browser's `<video>` element, so the provider's codec must be playable in the studio's browser.

# Phase 3 — Render and export

**Built**
- One scene compiler (`compileFrame`) feeding two backends:
  - `GLPassRenderer` (three.js, offscreen, frame-stepped) — used by the Blockout view and by export.
  - `softRenderer` — a pure-TypeScript z-buffer rasterizer with no DOM or GPU. It is byte-identical on every machine and runs in Node, so golden tests, MCP previews, Claude vision frames and IoU scoring need no browser.
- Passes: `clay`, `depth` (normalized), `depthMetric` (RGB24 millimetres), `normals`, `id`, `pose` (OpenPose body-18 + hands + face points, plus `pose.json`), `canny`, `flow`, `fx`, and `camera.json` (per-frame intrinsics + extrinsics).
- Shot package zip: passes, first/last frame, contact sheet with frame numbers and timecodes, manifest (prompt per provider, bible excerpt, ID palette keyed by mask colour with character descriptions and references, seed, fps, duration, shot facts, content hash).
- WebCodecs encoding (H.264/MP4 → VP9/WebM → PNG sequence). Data passes (`id`, `depthMetric`, `fx`, `flow`) are **always** PNG: a lossy codec would corrupt mask colours and metric values.

**Run** top bar → *Export shot*, or `window.__blockout.exportShotPackage(shot, { height, passes, video })`.

**Tested**
- `pnpm test`: 27 golden images (3 demo frames × 9 passes, software renderer, tolerance-compared), PNG round trip, byte-identical package for identical input, package changes when staging changes, ID pass contains only palette colours.
- `pnpm test:e2e`: WebGL export run twice gives byte-identical zips; encoded-video path; clay speed benchmark; 20 characters / 10 cameras / 200 props editing benchmark.

**Known gaps / honest numbers**
- Determinism is byte-exact for the software renderer everywhere, and for WebGL on the same GPU + driver + browser. Different GPUs rasterize differently, so the manifest records the renderer string; use `soft: true` when cross-machine identity matters.
- **Speed budget.** It is enforced by `e2e/perf-budget.spec.ts` against the production build; see "Performance pass" below.
- No ProRes; the PNG sequence is the lossless option.
- The software renderer has no cast shadows; WebGL clay does.

**Performance pass (after phase 6)**

Profiling the 20-character / 10-camera / 200-prop scene first measured ~365 ms of main-thread time per frame. The fixes:
1. **Shader recompiles every frame.** drei's `<Line>` disposes its material whenever its `points` array changes, so every animated overlay recompiled its shader each frame. It is replaced by `SLine`, which keeps one material and rewrites positions in place.
2. **Context churn.** The Blockout view created a new WebGL context whenever the active camera changed. It now keeps one renderer for its lifetime and draws straight into the visible canvas (no GPU→CPU copy per frame).
3. **Draw calls.** About 820 meshes became about a dozen: GLStage instances character parts and set pieces per mesh kind. Per-instance colour carries the view tint, the exact ID colour, or white for clay; per-instance previous matrices keep optical flow exact.
4. **Repeated work.** Frames are compiled once and shared by every viewer; static props compile once; camera paths are cached; trails use positions only; the encoder waits on `dequeue` events instead of polling.

Measured here (2.3 GHz server vCPU, production build; GPU process pinned to other cores):

| | main-thread CPU per frame | budget | draw calls | triangles |
|---|---|---|---|---|
| Editing 20 / 10 / 200, playing | ~9.5–10.3 ms | 12 ms (60 fps = 16.7 ms) | 83 | ~351k incl. shadow pass |
| 1080p clay export (H.264 + mux) | ~6.1–6.3 ms (≥ 6.7× real time if not GPU-bound) | 8.5 ms (4× = 10.4 ms) | 13 | ~101k |

`e2e/perf-budget.spec.ts` asserts these CPU budgets everywhere. On a hardware GPU it also asserts the wall-clock targets (≥ 55 fps editing, ≥ 4× real-time export). Run `pnpm bench` on your machine for the wall-clock numbers: it opens a browser window on your GPU. This container has no GPU (software raster runs at ~2 fps), so the wall-clock half has not been run here.

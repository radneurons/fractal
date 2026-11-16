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
- Speed budget (≥ 4× real time at 1080p clay; 60 fps editing) is asserted only when a hardware GPU is present. This repo's CI container has software GL (SwiftShader) and measured 0.06× real time and ~6 fps editing; the CPU side (scene compile) measured ~1 ms/frame for the 20/10/200 scene. The budget is therefore **unverified on real hardware**.
- No ProRes; the PNG sequence is the lossless option.
- The software renderer has no cast shadows; WebGL clay does.

# Blockout Studio

A browser-based previs ("blockout") studio for generative video. You stage scenes with mannequins, cameras and props. The studio renders deterministic control passes. Claude directs, writes the prompts and critiques the takes. A video model (Seedance, H3, or anything with an HTTP API) turns the blockout into footage.

> Geometry decides staging and timing. Claude decides the words. The video model decides the look.

## Quick start

```bash
pnpm install
```

```bash
pnpm bridge        # terminal 1: local companion (Claude Code / MCP / API, keychain, HTTP providers, collaboration)
```

```bash
pnpm dev           # terminal 2: the studio at http://localhost:5173 (opens the "Field Duel" demo)
```

For the phone virtual camera on an iPhone, use `pnpm dev:https` instead of `pnpm dev`; iOS only exposes motion sensors to secure pages.

The studio also runs with no bridge at all: the offline director and the mock provider keep every workflow usable, and the UI shows when it has fallen back.

Connect Claude Code or Claude Desktop over MCP:

```bash
pnpm mcp:install   # prints the exact config snippet
```

Measure the performance budget on your own GPU (opens a browser window):

```bash
pnpm bench
```

Keep webcam mocap fully offline (downloads the pose model once):

```bash
pnpm mocap:fetch
```

## Layout

| | |
|---|---|
| `packages/core` | Scene model (zod), the op reducer with undo, rig and IK, interpolation, cinematography classifiers, continuity checks, mocap retargeting, demo project. Pure TS. |
| `packages/render` | One scene compiler → a WebGL pass renderer (three.js) and a pure-TS software rasterizer; PNG codec; shot packages; WebCodecs encoding. |
| `packages/prompting` | Prompt compiler, provider dialects, word diff, the Claude task registry with zod schemas, the `ClaudeBackend` interface, the offline director. |
| `packages/pipeline` | Provider plugins (mock + generic HTTP), queue and budget, adherence scoring, OTIO/FCPXML/EDL/USD, storyboard PDF, audio beats, Yjs op stream. |
| `packages/mcp` | MCP server exposing the studio to Claude. |
| `apps/bridge` | Local Node companion on 127.0.0.1: Claude backends, keychain (keytar, with an encrypted-file fallback), HTTP generation, MCP back end, collaboration and phone relays. |
| `apps/studio` | The editor (Vite + React + R3F + zustand + Tailwind/Radix). |

## Keys

`W/E/R` transform · `P` path mode (Pose/Sculpt/Scatter modes in the scene toolbar) · `K` keyframe · `Space` play (`⇧Space` plays the cut) · `,` `.` frame step · `C` camera from view · `F` frame selection · `Tab` scene/blockout focus · `M` marker · `1–9` shots · `⌘K` direct with Claude · `⌘Z`/`⇧⌘Z` undo/redo · `Del` delete key.

## Tests

```bash
pnpm test          # unit, golden-image, contract (recorded Claude fixtures), MCP-over-stdio, bridge
```

```bash
pnpm test:e2e      # Playwright (includes the performance budget): brief flow, docking, pop-outs, curves, GLB import, offline mocap, collaboration, phone camera, audio + cut mix, HTTP-provider takes, export determinism, performance
```

Per-phase notes, including known gaps and the honest performance numbers: `docs/phase-1.md` … `docs/phase-6.md`.

## Status

Every feature in the original brief is implemented and covered by tests (141 unit, contract and golden tests; 15 Playwright E2E tests, including the brief's own create → path → camera → export → generate → view flow).

What is not certified:
- **Performance budget.** The app's own per-frame CPU cost is measured and enforced on the production build: about 10 ms editing the 20-character / 10-camera / 200-prop scene (budget 12 ms; 60 fps is 16.7 ms) and about 6 ms per 1080p export frame (budget 8.5 ms; 4× real time is 10.4 ms). Those frames take 83 and 13 draw calls. The wall-clock half needs a real GPU: run `pnpm bench` on your machine. This container has none, so that half has not been run here.
- **Provider dialects** carry provenance. Kling, Veo, Seedance and Runway limits are sourced from vendor or vendor-published API references and dated; the Prompt tab shows which ones. H3, Luma and Wan limits are labelled as estimates. All dialects are editable JSON.
- **Determinism across machines:** tick "bit-exact" next to Export shot to render with the pure-TS rasterizer. A test checks that its pass bytes are identical in Chromium and in Node. The default WebGL export is byte-exact on one GPU/driver, and the manifest records which.

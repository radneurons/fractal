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

The studio also runs with no bridge at all: the offline director and the mock provider keep every workflow usable, and the UI shows when it has fallen back.

Connect Claude Code or Claude Desktop over MCP:

```bash
pnpm mcp:install   # prints the exact config snippet
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

`W/E/R` transform · `P` path mode · `K` keyframe · `Space` play (`⇧Space` plays the cut) · `,` `.` frame step · `C` camera from view · `F` frame selection · `Tab` scene/blockout focus · `M` marker · `1–9` shots · `⌘K` direct with Claude · `⌘Z`/`⇧⌘Z` undo/redo · `Del` delete key.

## Tests

```bash
pnpm test          # unit, golden-image, contract (recorded Claude fixtures), MCP-over-stdio, bridge
```

```bash
pnpm test:e2e      # Playwright: brief flow, collaboration, phone camera, audio, export determinism, performance
```

Per-phase notes, including known gaps and the honest performance numbers: `docs/phase-1.md` … `docs/phase-6.md`.

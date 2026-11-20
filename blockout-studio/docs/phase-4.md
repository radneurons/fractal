# Phase 4 — Claude

**Built**
- `ClaudeBackend` interface (`packages/prompting/src/backend.ts`): `run(task, input, project) → AsyncIterable<progress | result>`. Every implementation runs through `runValidated`, which validates with zod, dry-runs any ops against the project, retries **once** with the validator error attached, and then surfaces the failure.
  - **Claude Code bridge** (default, `apps/bridge/src/claude.ts`): spawns the user's installed, logged-in `claude` CLI headless (`-p --output-format stream-json`) in an empty temp directory, streams progress to the studio over WebSocket. It never reads, copies or proxies Claude Code credentials. Verified against a real CLI: the "set the lens on the hero shot to 85mm" task returned a valid `setLens` op in ~5 s.
  - **MCP server** (`packages/mcp`): tools `get_project_summary`, `get_scene`, `get_shot`, `list_takes`, `propose_ops`, `render_preview`, `get_take_frames`, `set_shot_prompt`, `run_continuity_check`, `enqueue_generation`, plus `next_claude_task` / `submit_task_result` so an MCP session can serve as the studio's backend. Resources: style bible, character bible, change log, memory. `pnpm mcp:install` prints the Claude Code and Claude Desktop config.
  - **Anthropic API** (optional): official SDK, key from the bridge keychain, `claude-opus-5-5` by default (`BLOCKOUT_ANTHROPIC_MODEL` to change), adaptive thinking, streaming, prompt caching on the stable context (bibles + op reference + memory), server-side refusal fallback enabled, and per-call cost shown in the Claude tab.
  - **Offline director** (`LocalBackend`): deterministic rule-based implementation of every task; it is the automatic, visibly-labelled fallback when the bridge or CLI is missing.
- Tasks: natural-language direction, script → blockout, prompt compile, vision critique, continuity explanation + fixes, alternate setups, bible/memory review, storyboard notes.
- Edit-aware prompt compiler: measured facts → seven canonical segments → provider dialect (canonical, Seedance, H3, Kling, Veo, Runway, Luma, Wan, mock; more via JSON files in `~/.blockout-studio/dialects/`). On recompile, only segments whose facts changed are replaced; hand-edited passages are kept and reported as conflicts. The Prompt tab shows a word-level diff with per-hunk accept/reject; versions carry lineage and authorship.
- ⌘K command bar with ghost preview (orange paths/frusta); proposals are Preview / Apply / Edit (JSON) / Reject and apply as a single "Claude: …" undo entry. Re-staging a character ripples its later keys instead of interleaving them.
- Session memory: statements like "I hate dutch angles" are stored and fed into every task; the bible review flags violations with a fix. Each accepted Claude proposal is also recorded as a decision (the last 30 are kept). Decisions go into the volatile part of each request, so accepting a proposal does not break the prompt cache.

**Run** `pnpm bridge` (terminal 1), `pnpm dev` (terminal 2). Choose the backend in the Claude tab. For MCP: `pnpm mcp:install` and follow the printed steps.

**Tested** prompt compiler (only affected shots go stale, manual wording survives, hunks accept/reject), every dialect within its limits, dialect plugins, the offline director on the brief's example sentence, script → blockout coverage with no 180° violations, alternates on the same side of the line, continuity fix that removes the demo's violation, contract tests replaying recorded fixtures (including a validate-and-retry), MCP over stdio driving the demo end to end (propose → nothing changes → accept → violation gone), WebSocket progress streaming, MCP hand-off backend, encrypted secret file.

**Known gaps**
- The offline director's grammar is a pattern matcher; it handles the common staging verbs, camera moves, lens/time-of-day/aspect/fx commands and asks when the subject or target is ambiguous, but anything subtler needs a real Claude backend.
- Dialect limits record provenance (`verified: { on, sources, notes }`), and the Prompt tab shows "limits sourced <date>" or "limits are estimates". Primary vendor references checked on 2026-11-18:
  - **Runway:** `promptText` ≤ 1000 UTF-16 chars; gen4.5 2–10 s at 1280:720 or 720:1280; veo3.1 4/6/8 s; seedance2 4–15 s.
  - **BytePlus Seedance:** 2.5 series 4–30 s, 2.0 series 4–15 s, 1.0 pro 2–12 s; ratios incl. 21:9 and adaptive; recommended prompt ≤ 1000 English words; inline `--rs --rt --dur --seed --cf --wm`; no negative-prompt field.
  - **Kling:** prompt and negative_prompt ≤ 2500 chars each.
  - **Veo:** 4/6/8 s; 16:9 and 9:16; negativePrompt.
  - **MiniMax H3:** prompt ≤ 7000 chars; integer 4–15 s; 768P/2K; common ratios or adaptive; ≤ 9 images, 3 videos and 3 audio clips as references.
  - **Luma Ray 2:** ray-2 / ray-flash-2; 540p–4k; duration string (e.g. "5s"); keyframes frame0/frame1; loop; aspect_ratio; no negative field.
  - **Wan:** prompt ≤ 1500 chars on 2.6/2.5 (800 on 2.2/2.1, 5000 on 2.7); negative ≤ 500; 5/10 s (2–15 s on 2.7).
  - Every vendor dialect now has a dated primary source; only the internal `canonical` and `mock` dialects have no vendor limits.
- `fallbacks: "default"` (server-side refusal fallback) is sent in API mode; on platforms that reject it, remove it in `claude.ts`.

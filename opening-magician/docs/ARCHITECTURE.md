# Architecture

## Why a local bridge

A web page cannot start native programs or talk to arbitrary Bluetooth devices. So the application is
split: the **bridge** (Python) owns engines, long-running research, the database and hardware; the
**interface** (React) is served by the bridge and talks to it over REST and one WebSocket. Research
therefore continues when the browser tab is closed.

## Bridge (`backend/om`)

| Module | Responsibility |
|---|---|
| `db.py` | SQLite (WAL, foreign keys), versioned migrations, re-entrant transactions, online backup, restore |
| `events.py` | In-process publish/subscribe; bounded queues so slow consumers never block producers |
| `chessx.py` | Position identity, score model (centipawns and mates never mixed), move classification, motifs, PGN helpers |
| `engines/manager.py` | Engine registry, UCI handshake/option discovery, managed processes, profiles |
| `engines/resources.py` | Leases for processes, threads and hash; priorities; background pause; crash log |
| `engines/search.py` | Bounded adaptive search with recorded stop reasons; ranked candidates; verification; analysis cache |
| `engines/apprentice.py` | The bundled weak UCI engine (also the protocol fixture for tests) |
| `clock.py` | Authoritative, time-injected clock: all time controls, physical-move allowance, robot policies |
| `hardware/codec.py` | Chessnut wire formats (pure functions) |
| `hardware/transport.py`, `sim.py` | Bluetooth link (bleak) and the simulated firmware behind the same interface |
| `hardware/driver.py`, `reconcile.py` | Capability-based device driver; sensor placement → legal move |
| `hardware/robot.py`, `manager.py` | Robot state machine and safety rules; LED guidance; playback |
| `tournament/` | Pairings, game runner, statistics, durable tournament manager |
| `discovery/` | Strategies, ten-stage experiment pipeline, scoring |
| `books/` | Transposition-aware book graph, importers/exporters, versions, proposals |
| `learn/` | Trainer (SM-2, skills, weaknesses, tasks), puzzle lab, studies |
| `prep/` | Preparation: game collections, dossier and prep sheet, leaks, coverage, move orders, structures, events, goal repertoires, drills, endgames (`core.py`); engine-backed checks (`engine.py`); optional online import (`online.py`) |
| `gambit/` | Gambit Lab: material rule, exchange evaluation and compensation (`static.py`); assessment, search and the engine-level ladder (`lab.py`) |
| `play.py` | Human-versus-engine sessions and post-game analysis |
| `jobs.py` | Durable job scheduler with checkpoints and recovery |
| `broadcast.py`, `package.py` | Read-only spectator state; portable project package |
| `api/app.py`, `services.py` | HTTP/WebSocket API and wiring |

### Data model (SQLite)

`engines`, `engine_profiles`, `games`, `analysis`, `books`, `book_versions`, `tournaments`,
`experiments`, `findings`, `puzzles`, `puzzle_attempts`, `studies`, `chapters`, `cards`,
`training_events`, `hw_devices`, `hw_log`, `play_sessions`, `broadcasts`, `jobs`, `links`, `prefs`.

* Positions are identified by placement + side to move + castling rights + *legal* en passant, so
  analysis and book data are shared across transpositions. Anything history-dependent (repetition,
  fifty-move rule) stays with the full game.
* A book version is an immutable compressed snapshot; restoring an old version creates a new one.
* `links` connects findings, games, studies and puzzles — the knowledge graph behind the "Knowledge" panels.
* Cached analysis is reused only for the same engine configuration and at least the requested depth and width.

### Research jobs

`pending → scheduled → running → completed | failed | canceled`, `running → paused`, and at start-up
anything found running becomes `recovery_required` and is resumed from its checkpoint. A job is marked
completed only after its runner returned, i.e. after results were committed.

### Scores and classification

Engine scores are kept as centipawns *or* mate distance, plus win/draw/loss when the engine reports it.
Comparisons use an expected score (0–1); centipawn loss is reported only when both scores are centipawn
scores. Harsh labels (mistake, blunder) need a deep enough and stable search, otherwise they are
downgraded and marked provisional.

## Interface (`frontend/src`)

* `api.ts` — REST helper, one shared WebSocket with topic subscriptions, hooks.
* `store.ts` — preferences (also saved to the project database), navigation, hand-offs between views.
* `chess/Board2D.tsx` — SVG board: drag, click, premove, promotion, drawing, LED overlay.
* `chess/three/` — 3D stage: procedural pieces (`pieces3d.ts`), six environments (`themes3d.ts`),
  renderer, camera, picking and post-processing (`stage.ts`).
* `chess/tree.ts` — client-side move tree and PGN export; `chess/widgets.tsx` — clocks, Clock Designer, move lists.
* `views/` — one file per area.

Legality is never inferred from geometry: chess.js decides in the interface, python-chess in the bridge.
The 3D board renders on demand, so a still position costs almost nothing.

## Security model

* Local mode binds to loopback and trusts loopback callers.
* LAN/server mode requires an admin token for every control endpoint and WebSocket.
* Native executables can be registered only from the machine itself or from allowlisted folders.
* `/api/public/broadcast/<token>` is the only unauthenticated surface. It is read-only and built from an
  explicit whitelist of fields; publishing requires explicit consent per broadcast.

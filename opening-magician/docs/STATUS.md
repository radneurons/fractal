# Status: what was verified, what was not, what is missing

## Verified during development

* **127 automated bridge tests** pass (`backend/tests`): chess rules and draw rules; PGN round-trip with
  variations, comments, NAGs and arrows; Chessnut encodings checked against the manufacturer's own
  decoding example; every clock mode including the physical-move allowance; round-robin, gauntlet,
  knockout and Swiss pairings; statistics; book formats (a Polyglot file written here is read back by
  python-chess' independent reader); versioning; migrations, transaction rollback, project package
  round-trip; real UCI subprocesses including MultiPV, restricted-root ranking, cancellation, a crashing
  engine and a hanging engine; resource budgets and priorities; full tournaments in five formats with
  interruption and recovery; full discovery experiments; reconciliation of hand moves; robot planning,
  execution, stop, recovery, faults and the live-motion lock; play over a simulated physical board;
  API authentication and the read-only spectator surface; the preparation tools (collection import,
  dossier, prep sheet, leak finder and cards, coverage audit, move-order search, structure and endgame
  classification, model games, event-capped review intervals, goal repertoires, drill material, and the
  engine-backed checks: dossier flags, practical scoring, refutation watch, book annotation);
  the Gambit Lab (the material rule on classic gambits, static exchange evaluation, compensation,
  assessment with trap detection on Legal's trap, the correction of a shallow first impression by
  following the line, search, and a ladder in which a one-ply defender takes the queen and is mated).
* **8 interface unit tests** pass (move tree, PGN export, board parsing, clock description).
* **Browser runs** of the built application (headless Chromium, software WebGL): every view opens
  without console errors; a game was played, the Move simulator was driven through Robot Studio, an
  engine panel and ranked candidates ran, a three-engine tournament and a discovery experiment were
  created and completed from the interface, training tasks, a puzzle, the book forge, a study, the
  resource dashboard, theme switching in 3D, the spectator page and a phone-sized layout were exercised.
  The Preparation view was driven through all ten tabs: two game collections imported, a prep sheet built,
  leaks turned into cards and costed by the engine, a coverage audit, a practical score, a move-order
  search, a plan quiz and guess-the-move on a model game, an event saved, a refutation watch run, a
  book annotated and a goal repertoire built, a blindfold recital, a ten-move survival drill and the
  endgame tables — without console errors.

## Not verified — please treat as untested

* **Real Chessnut hardware.** No board was available. The Bluetooth transport (`bleak`) and both device
  profiles follow the published documentation but have never exchanged a byte with a real device.
  Work through [HARDWARE_VALIDATION.md](HARDWARE_VALIDATION.md). Live robotic motion is locked until you do.
* **Gambit Lab with a strong engine.** It was exercised only with the bundled engine, whose "levels" are
  its Skill Level (a depth cap plus noise). With Stockfish the ladder uses `UCI_Elo`; that path follows
  the same code as strength-limited play but was not run. Real opening gambits need a strong engine
  and a generous budget: the bundled engine's verdicts on the King's Gambit and the like mean little.
* **Online game import** (Preparation → "By username"). The Lichess and Chess.com downloads follow the
  sites' public documentation, and username validation is tested, but no request was sent to either
  site during development. Importing from a PGN file is the tested path.
* **Preparation tools on real game collections.** They were exercised with small hand-written and
  generated collections and the bundled engine. Thresholds (what counts as a habit, a leak, an
  only-move, an alert) are reasonable defaults, not tuned on real players' games.
* **Third-party engines.** Only the bundled engine (and fault-injecting variants of it) were run.
  Stockfish and others use the same python-chess UCI code path, but they were not executed in the
  development environment. Expect to tune budgets: the defaults suit a slow engine.
* **Real GPU rendering.** The 3D scenes were checked with a software renderer. Ambient occlusion and
  depth of field in particular were not judged on real hardware; frame rates are unknown.
* **The Electron desktop shell** in `desktop/` and **`run.bat`** were written but not run.
* **macOS and Windows.** Development and tests ran on Linux only.
* **Large data.** Books are stored as one compressed snapshot per version — fine for tens of thousands
  of positions, untested beyond that. Very large PGN files are read into memory.

## Simplifications to know about

* **2D piece sets** share one family of original silhouettes in eight renderings (the Accessibility set
  has its own letter tokens). **3D piece sets**: six share the Staunton geometry with different
  materials; the architectural set has its own shapes. All are procedural, none are scanned or sculpted models.
* **Puzzle themes, tactical overlays and "strategic coherence"** use static heuristics, not engine proofs;
  the interface says so where it matters.
* **Opening content** (141 lines, 16 traps, plans per family) is authored and legality-checked, not a
  full ECO database. Catalogue traps are marked "authored" until an engine verifies them.
* **Strength by Elo** uses the engine's own `UCI_Elo` when it exists; otherwise the mapping to skill level
  or depth is a rough guess and is labelled as such.
* **Gambit Lab**: a sacrifice is recognised by a one-move exchange rule, so deep positional sacrifices
  that leave nothing en prise are not found by the search (you can still assess them as "My line").
  Compensation and "natural-looking move" are board heuristics. Ladder levels are engine strengths,
  not human ratings: a weakened engine goes wrong through shallow or noisy search, not greed or habit.
* **Pawn structures and endgame types** are recognised by rules on pawns and material (thirteen named
  structures, eleven endgame types). Positions that fit none are shown as "Unclassified".
* **Findability** in practical scoring comes from human games when a games book has 20+ games for the
  position; otherwise it is a labelled heuristic (captures, checks, development and retreats), not a
  model of human play.
* **Drawing-weapon / must-win repertoires** use the engine's win/draw/loss output when the engine
  provides `UCI_ShowWDL`; the bundled engine does not, so draw rates are then estimated from the evaluation.
* **Swiss pairing** is Dutch-style with backtracking, not a certified FIDE implementation.
* **Novelty** always means "new to this project's books and research", never a claim about theory.
* **Spectator clocks** tick from the last update and can drift by a fraction of a second.
* **Premoves** exist on the 2D board only.

## Not implemented

* Chess960 and other variants.
* PostgreSQL (SQLite only; `db.py` is the single place that would change).
* Direct YouTube / Twitch API integration and OBS WebSocket scene control — streaming works through an
  OBS browser source, as documented in the Broadcast view.
* Spoken commentary / audio for playback, and sound effects.
* ChessBase CTG, Arena ABK and other proprietary book formats (rejected with conversion guidance).
* Syzygy probing inside the bridge (engines can use tablebases through their own option).
* A Tauri build, installers, auto-update and code signing.
* Multi-user accounts: there is one admin token and anonymous spectators.
* An optional language-model commentary layer; all explanations are deterministic.

## Suggested first hour

1. `./run.sh`, open the app, register a strong engine.
2. Play one game with the *Physical board 10+5* clock on the simulator to see the hand-move allowance and
   the pause-while-relaying behaviour.
3. Run a small discovery experiment with the strong engine as observer.
4. Connect your real board and work through the hardware checklist before unlocking robotic motion.

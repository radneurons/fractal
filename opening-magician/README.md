# Opening Magician

*Discover deeper. Train smarter. Play beyond theory.*

A local-first chess opening research, training and Chessnut hardware platform. A Python bridge
runs native UCI engines, research jobs, the database and Bluetooth boards on your own computer;
a React/Three.js interface gives you 2D and 3D boards on top of it. No cloud service is needed.

```
frontend (React · TypeScript · Three.js)  ⇄  REST + WebSocket  ⇄  bridge (Python · FastAPI · python-chess · SQLite)
                                                                       ├─ native UCI engine processes
                                                                       ├─ durable research jobs
                                                                       └─ Chessnut boards over Bluetooth LE
```

## Start

```bash
./run.sh            # macOS / Linux     (Windows: run.bat)
```

The first run creates a Python environment and builds the interface, then prints the address
(`http://127.0.0.1:8765`). Requirements: Python 3.11+ and Node.js 18+.

A small engine ("Apprentice") is bundled so everything works immediately. It is deliberately
weak. **For serious analysis register a strong engine** such as Stockfish in *Engines* — see
[docs/INSTALL.md](docs/INSTALL.md).

## What is in it

| Area | What you can do |
|---|---|
| **Play** | Games against any registered engine; strength by Elo / skill / depth / time; opening books; take-backs, draw claims, hints (training mode only); game recovery after a restart |
| **Clock Designer** | Unlimited, sudden death, Fischer, Bronstein, simple delay, multi-stage ("40 moves in 90 min…"), hourglass, per-move, correspondence, time odds, loss-on-time or training flags, pause and manual adjustment, saved presets |
| **Human Physical Move Allowance** | Extra time when you move pieces by hand on a non-robotic board: bonus per move, grace before the clock starts, pause while you relay the engine's move (with a cap), one-off setup time |
| **Chessnut** | Air, Air+, Go, Pro (position, battery, LEDs) and Move (plus colour LEDs, piece status, robotic target positions, stop). Built-in simulator for both families |
| **Robot Studio** | Plan → preview → confirm → verified by sensors; persistent STOP; recovery workflow; live motion locked until you complete the hardware checklist |
| **Openings** | 141 catalogued lines with ideas, plans and structures; 16 classic traps; tree explorer (tree, spatial graph, outline, heatmap, engine ranking, research evidence); guided lessons; playback on screen, by LEDs, or by robot |
| **Analysis** | Free move tree with variations, several engines side by side, ranked 2nd…Nth-best candidates, tactical overlays, drawn arrows, PGN/FEN in and out |
| **Discovery Lab** | Twelve strategies for exploring non-top moves; explorer engines generate, a stronger observer verifies; ten inspectable, re-runnable stages; seven separate explained scores per finding |
| **Tournaments** | Round robin, gauntlet, knockout, Swiss, leagues; real clock or no-flag research budgets; standings with tie-breaks, Elo with confidence intervals, reports |
| **Preparation** | Opponent dossier and prep sheet from their games; your own repertoire leaks turned into cards; coverage audit by frequency; human-practical scoring (only-moves, findability); move-order finder; pawn-structure plans, model games and guess-the-move; event calendar with tighter reviews and refutation alerts; drawing-weapon / must-win repertoires; blindfold and out-of-book survival drills; endgames linked to openings |
| **Gambit Lab** | Finds and assesses sacrifices: material given up (including declined recaptures), **risk** against best defence, **sting** (only-moves and tempting moves that lose), static compensation; follows each line to correct shallow first impressions; **engine ladder** that plays the gambit against a range of defender strengths and reports which levels fall for it, with every game |
| **Book Forge** | PGN / Polyglot / EPD / JSON / CSV import and export; transposition-aware graph; immutable versions, diff, restore; merge, filter, split, reweight; research proposals that need your approval |
| **Training** | Spaced repetition, eight skill estimates, weakness correction, fifteen modes, ten mini-games |
| **Puzzles** | Mined from games and research; accepted only when one move is clearly best; difficulty corrected by your results |
| **Studies** | Chapters as full PGN trees with comments, symbols and arrows; conversions to cards, puzzles and playback |
| **Broadcast** | Consented, read-only spectator pages and an OBS browser-source layout |
| **Project package** | One `.omproj` file to move everything to another computer |

## How the research loop fits together

1. An explorer engine ranks the candidate moves in a position (MultiPV, or restricted-root searches when the engine has no MultiPV).
2. A strategy picks which ranks or kinds of move to investigate; viability filters drop the hopeless ones.
3. Two explorer engines play test games from each candidate (bounded search per move, no clock).
4. A stronger observer re-evaluates the candidates, the opponent's replies and the critical moments.
5. Each finding gets seven separate scores, a category and a status — with the reasons.
6. Promising findings become *proposals* for a book. Nothing enters a book until you approve it; approval creates a new book version linked to its evidence.
7. Findings turn into studies, puzzles and training cards, and the updated book can seed the next experiment or tournament.

## Honest status

Read [docs/STATUS.md](docs/STATUS.md) before relying on anything hardware-related. In short:

* The whole application was built and tested against the **bundled engine and the hardware simulator**.
  No real Chessnut board and no third-party engine was available during development.
* Real Bluetooth operation follows the manufacturer's published documentation but is **unverified on
  hardware**. Robotic motion on a real Move is locked until you complete the checklist in Robot Studio.
* A few items of the original brief are not implemented (Chess960, PostgreSQL, direct YouTube/Twitch
  API calls, OBS WebSocket control, spoken commentary). They are listed in STATUS.md.

## Tests

```bash
cd backend && ../.venv/bin/python -m pytest      # 127 tests: rules, Chessnut wire formats, clocks, pairings, engines,
                                                 # tournaments, discovery, hardware safety, books, database, API security,
                                                 # preparation (dossier, leaks, coverage, move orders, structures, …),
                                                 # gambit lab (material rule, assessment, search, engine ladder)
cd frontend && npm test                          # move tree, PGN export, board parsing, clock description
```

## Documentation

* [docs/GAMBITS.md](docs/GAMBITS.md) — the Gambit Lab: how sacrifices are found, scored and tested against engine levels
* [docs/PREPARATION.md](docs/PREPARATION.md) — the ten preparation tools, what each one measures and what it does not
* [docs/INSTALL.md](docs/INSTALL.md) — installation, engines per platform, LAN and server modes, desktop shell
* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit, data model, security model
* [docs/HARDWARE_VALIDATION.md](docs/HARDWARE_VALIDATION.md) — protocol summary and the hardware checklist
* [docs/TOURNAMENTS.md](docs/TOURNAMENTS.md) — pairing methods, tie-breaks, statistics, adjudication
* [docs/STATUS.md](docs/STATUS.md) — what was verified, what was not, what is missing

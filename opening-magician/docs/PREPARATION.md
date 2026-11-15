# Preparation

The **Preparation** view (Research → Preparation) holds ten tools that work on *games* and on your
*repertoire book*. Everything except the optional import by username works offline.

Two kinds of input feed them:

* **Game collections** — an opponent's games or your own, from a PGN file or, optionally, downloaded by
  username from Lichess or Chess.com. Each collection becomes two "games books" (as White, as Black)
  holding how often each move was played and how it scored.
* **A repertoire book** — any book from the Book Forge that holds the moves you intend to play.

The engine and budget at the top of the view are used by every "check with engine" button. Engine
checks run as background jobs with a progress bar and can take minutes with a slow engine.

| # | Tool | What it does | What it does not claim |
|---|---|---|---|
| 1 | **Opponent dossier** | First moves, main lines, habits (same move ≥ 80% of the time), moves they score badly with, moves that score well against them, where they leave the reference book; optional engine check of their most frequent moves. **Prep sheet**: the single most likely game against them, move by move, with your reply and the reason for it | Small samples mislead; counts are always shown. Results reflect their opponents too |
| 2 | **My leaks** | Compares your games with your repertoire: where you played something else (leaks) and where opponents played something your book has no answer to (surprises). One button turns every leak into a spaced-repetition card; the engine can say whether your move or the book move was better | A leak is a deviation, not necessarily a mistake — the engine verdict says which |
| 3 | **Practical score** | For a line: how many *only-moves* each side must find (best move ≥ 8 points better than the second), how findable each move is, and a 0–100% score where 50% means equally demanding | Findability is taken from human games when available, otherwise it is a labelled heuristic |
| 4 | **Coverage audit** | Walks every opponent reply, weighted by how often it is played (reference catalogue or a games book), and lists positions where your repertoire has no move — most frequent first, with transpositions into families you do not otherwise play flagged | Frequencies from the built-in catalogue are authored weights, not database statistics |
| 5 | **Move orders** | Finds other orders of the same moves that reach the same position, and for each: the share of opponents who stay on course, which sidelines it dodges and which it allows instead | Only reorderings of the given moves are searched, and only legal ones |
| 6 | **Structures** | Groups your repertoire by pawn structure with plans for both sides; "guess the plan" quiz; model games from your database with that structure at move 12; solitaire "guess the moves" on the winner's side | Structures are recognised by rules; a different move than the game move is not necessarily worse |
| 7 | **Prep file & alerts** | Events with a date and the decks that matter for them: review intervals shrink as the date approaches (never longer than a quarter of the days left). **Refutation watch** re-evaluates your repertoire moves and flags any whose expected score moved by ≥ 5 points since the baseline | An alert means "the evaluation changed with this engine and budget", not "refuted" |
| 8 | **Draw / must-win** | Builds a new repertoire from an existing one, choosing per position the move with the highest draw rate (drawing weapon) or highest win rate above a soundness floor (must-win), and notes the evidence on each move | Without engine win/draw/loss or game results, the choice falls back to the evaluation and says so |
| 9 | **Drills** | **Blindfold recital**: the board is hidden, opponent moves are announced, you type yours (or play them on a connected Chessnut board). **Out-of-book survival**: the engine leaves the main line at the end of your preparation and you hold the position for ten moves, judged by the evaluation you keep | Survival is judged by the engine you selected at its playing budget |
| 10 | **Endgames** | Which endgame types your openings actually lead to, with your score in each and example positions to practise against an engine | An endgame counts once simplified material has lasted six plies; types are by material only |

## Typical week before a game

1. Import the opponent's games → read the dossier → build the prep sheet for your colour.
2. Run the coverage audit of your repertoire with *their* games book as the source.
3. For the critical line, check its practical score and look for a better move order.
4. Save the event with the decks to review; drill them, then recite the main line blindfold.
5. Run the refutation watch with your strongest engine the evening before.

## API

All routes live under `/api/prep/` (see `backend/om/api/app.py`); engine-backed work is submitted to
`/api/prep/job` and polled at `/api/jobs/{id}`.

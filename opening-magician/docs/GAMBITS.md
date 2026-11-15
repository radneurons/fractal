# Gambit Lab

Research → **Gambit Lab**. It answers three separate questions about a sacrifice and never blends
them into one number:

| Question | Score | Where it comes from |
|---|---|---|
| What does it cost if the opponent defends perfectly? | **Risk** — expected score given up | Engine: evaluation before the offer minus the evaluation after following the best defence found |
| How hard is that defence to find? | **Sting** — only-moves, traps | Engine along the main line: moves that are ≥ 8 points better than the alternative; tempting moves that lose ≥ 15 points |
| Who actually goes wrong? | **Ladder** — per defender level | Games: the gambit played out against each strength of defender |

A fourth panel, **Compensation**, describes *what kind* of play you get (development, the opponent's
king, open lines, activity, centre). It is a board heuristic and says so.

## Three ways in

* **Known gambits** — the catalogued gambits (King's, Evans, Smith-Morra, Benko, Albin, …). The move
  that makes the offer is located by the material rule, not by name.
* **My line** — type the moves up to and including the gambit move. Optionally name a games book to
  see how often human opponents took the bait.
* **Find new** — from a start position, the lab walks the main lines (book moves when a book has
  them, otherwise the engine's choices), lists every move that gives up material, discards those above
  your price limit and fully assesses the best few.

## What counts as a sacrifice

A move gives up material when, after the opponent has taken whatever it leaves en prise (by static
exchange evaluation), you have less than you could fairly have had. "Could have had" is the best
outcome available on that move, but never more than the balance before the opponent's last move. So:

* leaving a pawn or piece en prise counts (King's Gambit 2.f4, Legal's queen offer);
* declining to recapture counts (Danish and Smith-Morra 3.c3);
* declining to *win* something offered does not inflate the count (Falkbeer 2...d5 is one pawn).

Deep positional sacrifices that leave nothing en prise are not found by the search. Assess them
through **My line**.

Each gambit is labelled **true gambit** (the material stays gone in the engine's main line),
**temporary sacrifice** (it comes back by force — a combination) and by price: *sound* (≤ 3 points),
*practical gamble* (≤ 10), *speculative* (≤ 20), *unsound*.

## Why the lab follows the line

Sacrifices are exactly where a search that stops early is wrong. So every search here spends the
whole budget, and after the engine names the defender's best reply the lab plays that line out. If
doing so shows the reply actually loses, it is recorded as a trap ("refuted only by looking further")
and the next reply is followed. Risk is then computed from the best defence found, which keeps
"risk" and "where you stand after best defence" consistent with each other even with a weak engine.

## The engine ladder

Choose a defender engine and a set of levels. The lab suggests levels from what the engine offers:

| Engine has | Levels | Reading |
|---|---|---|
| `UCI_LimitStrength` + `UCI_Elo` | six Elo steps and full strength | the engine's own calibration — approximate, and not human Elo |
| `Skill Level` | six skill steps | engine-specific |
| neither | search depth 1–6 | directly "how many plies of lookahead the defence needs" |

You can add your own levels (depth, Elo, skill, milliseconds, full strength). For each level the
position after the offer is played out for a set number of plies: the analysis engine plays the gambit
at full budget, the defender plays at its level. Later games at a level pick among near-equal moves
for the gambiteer so games differ; a level that repeats the same game is run once.

Per level you get: how often it **fell for it** (your engine rates your position at 70% or better at
the end), **held**, or **punished** it (35% or worse); whether it took the bait; the move it went wrong
with; and every game to open on the analysis board. The verdict reads, for example:
*"Works up to Skill 4; from Skill 8 the defender no longer goes wrong."*

A running assessment, search or ladder can be stopped; a stopped ladder keeps the levels it finished
and says so. **Play it** on any level row starts a game in which you play the gambit yourself against
that exact defender strength.

**What the ladder is not.** Engine levels are not human ratings. A weakened engine goes wrong by
shallow or noisy search; a human goes wrong by greed, habit and time trouble. Treat the ladder as a
measure of how much calculation the defence requires, and use human games (the optional games book,
or the Opponent dossier) for the psychological side.

## From a finding to the board

Every assessed gambit has buttons to analyse the line, play it against an engine, build a
spaced-repetition deck from the main line, replay it on screen / LEDs / robot, send it to the
practical-score tool in Preparation, or add its main line to one of your books as a candidate (with
the risk, sting and ladder verdict in the comment). From the Analysis board, the "send to" menu has
*Assess this line as a gambit*.

## API

`GET /api/gambits`, `GET /api/gambits/catalogue`, `GET /api/gambits/levels?engine_id=`,
`GET|DELETE /api/gambits/{id}`, and `POST /api/gambits/job` with `task` = `assess` | `search` | `ladder`
(poll `/api/jobs/{id}`).

# Tournaments: pairings, scoring, statistics

## Time policies

* **Real chess clock** — wall-clock time is measured around every engine move, increments are applied,
  and an engine whose clock reaches zero loses on time (`Termination "time_forfeit"`).
* **No-flag research** — there is no chess clock. Every move gets a bounded adaptive search
  (minimum/maximum time and depth, optional node limit). Nobody can lose on time and nobody can think
  forever. PGN headers say `no-flag research` so such games are never mistaken for timed games.

## Formats

**Round robin** — Berger (circle) tables. With an odd field one engine sits out each round. "Both
colours" plays each pairing twice; colour-reversed twins always start from the same opening.
`cycles` repeats the event with colours swapped.

**Gauntlet** — one champion against every challenger, alternating colours.

**Knockout** — standard seeded bracket (1 v N, 2 v N−1 …); top seeds receive byes when the field is not
a power of two. Each match is `best_of` games with alternating colours. A level match gets up to
`tiebreak_pairs` extra pairs; if still level, the higher seed advances and the bracket says so.

**Swiss** — a Dutch-style system, not a certified FIDE implementation:

1. Players are ranked by score, then seed.
2. Nobody meets the same opponent twice.
3. Nobody gets a third consecutive game with the same colour, or a colour difference beyond ±2 —
   relaxed only when no legal pairing would otherwise exist (the round is then marked as relaxed).
4. With an odd field the lowest-ranked player without a bye receives a one-point bye.
5. From the top, each player is tried against the top of the lower half of their score group, then the
   rest of the group, then floaters, with full backtracking — so a legal pairing is found whenever one exists.
6. Colours go to the stronger preference; ties to the higher-ranked player.

**League** — divisions play a round robin per season; the top and bottom `promote` engines swap
divisions afterwards. History is kept per season.

## Tie-breaks

Points → direct encounter among the tied → Sonneborn-Berger → Buchholz → number of wins.
Buchholz cut-1 is also reported.

## Statistics

* **Elo difference** from the score, with a 95% interval from the win/draw/loss variance.
* **LOS** (likelihood of superiority) from wins and losses.
* Every pairing and opening with fewer than about 30 games is flagged *small sample*; opening tables use
  Wilson intervals and say "too few games to compare" under 20 games.
* Reports list the largest evaluation swings as "decisive positions" and any games that ended through an
  engine failure.

## Adjudication

Optional, and always recorded in the PGN `Termination` header:

* **Resign** — the losing engine's evaluation is beyond the threshold for N consecutive moves *and* the
  other engine agrees.
* **Draw** — after a minimum number of plies both evaluations stay within a small band for N moves.
* **Maximum plies** — the game is declared drawn.

## Failures and recovery

Every finished game is committed together with its schedule entry. If the bridge stops, the tournament
comes back as "recovery required" and resumes by itself; games that were in flight are replayed, never
duplicated. An engine that crashes or plays an illegal move loses that game (`engine_error`,
`illegal_move`); a game that could not start because an engine failed to launch is retried once.

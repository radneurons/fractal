# Chessnut hardware: protocol and validation checklist

Sources (the only ones used):

* Non-Move boards (Air, Air+, Go, Pro): https://github.com/chessnutech/Chessnut_eBoards
* Chessnut Move: https://github.com/chessnutech/chess_move_api

Everything below is implemented in `backend/om/hardware/codec.py` and covered by
`backend/tests/test_chess_and_codec.py`, including a line-for-line port of the manufacturer's
JavaScript decoding example used as the reference.

## What is implemented

| | Air / Air+ / Go / Pro | Move |
|---|---|---|
| Advertised name | `Chessnut …` | `Chessnut Move` |
| Position service / notify | `1b7e8261-…` / `1b7e8262-…` | same |
| Command service / write / response | `1b7e8271-…` / `1b7e8272-…` / `1b7e8273-…` | same |
| Enable real-time reports | `21 01 00` | `21 01 00` |
| Position report length | 36 bytes | 38 bytes |
| Position payload | bytes 2–33, two squares per byte, h8 first, low nibble first | same |
| Piece codes | `'', q, k, b, p, n, R, P, r, B, N, Q, K` (0–12) | same |
| Battery request / response | `29 01 00` → `2A 02 level reserved` (bit 7 charging, bits 0–6 %) | `41 01 0C` → `41 03 0C charging level` |
| LEDs | `0A 08` + 8 rank bytes, one bit per square | `43 20` + 32 bytes, one nibble per square: 0 off, 1 red, 2 green, 3 blue |
| Piece status | — | `41 01 0B` → `41 89 0B` + 34 × (identity, x, y, battery) |
| Target position | — | `42 21` + 32 position bytes + force flag (0 force, 1 non-force) = 35 bytes |
| Stop | — | `42 21` + zeros |

A board placement is not a game state: side to move, castling rights, en passant, counters and history
are kept by the application and sensor reports are matched against the *legal* moves of that state.

## Where the documentation is ambiguous

These are exposed as explicit, named switches — never guessed silently.

1. **Non-Move LED command length.** The README says "34-byte command" but shows a 10-byte structure
   (`0A 08` + 8 bytes), and `08` is a length byte. The 10-byte form is sent.
2. **Non-Move LED bit order.** "Index from 8 to 1, h to a" is implemented as rank 8 first and bit 0 = h-file.
   Switch: *Chessnut → LED bit order* (`h_lsb` / `a_lsb`).
3. **Move stop command length.** "`42 21` + 34 zeros (35 bytes)" does not add up (2 + 34 = 36).
   Switch: *Robot Studio → Stop command variant* (`len35` default, `len36`).
4. **Motion completion.** No acknowledgement is documented and position reports are disabled while
   moving. "Completed" is therefore an application state reached only when a fresh sensor report
   equals the target. Piece-status polling is used for *stillness* only, because the coordinate frame
   of x/y is not documented.

## Safety rules the software enforces

* Planning sends nothing. A movement needs an explicit confirmation of exactly the previewed plan.
* One target at a time; a new plan is refused while a movement is in progress.
* Targets that the 34-piece set cannot represent (third queen, missing king…) are refused.
* If the board changes by hand after planning, the plan is discarded.
* STOP is always available (status bar and Robot Studio) and is sent immediately.
* Uncertain outcomes (stop mid-motion, disconnect, timeout, mismatch) lead to *recovery required*.
  Nothing is retried automatically.
* Non-force mode is the default: a touched piece halts the motion, as documented.
* On real hardware, live motion is **locked** until the checklist below is confirmed for that device.
* Background research is paused while the robot executes game moves and playback steps.

## Checklist — to be done with real boards

Nothing here was verified on hardware during development.

### Any board
- [ ] The board is found by scanning and identified as the right model.
- [ ] Position reports arrive and have the documented length (36 or 38 bytes). If they are short, the
      Bluetooth MTU is too small (the eBoards README suggests 500).
- [ ] The start position decodes correctly; a1 and h8 are where they should be (square order).
- [ ] Each piece type and colour decodes correctly (piece codes).
- [ ] Battery percentage and charging flag match the board's own indication.
- [ ] Moves made by hand are recognised: quiet move, capture, both castlings, en passant, promotion
      (with a real queen, and with the pawn left on the last rank).
- [ ] A piece held in the air shows as "move in progress", not as an error.
- [ ] Switching the board off is noticed and reported.

### Air / Air+ / Go / Pro
- [ ] The LED test lights exactly the clicked squares. If the mirror image lights up, change *LED bit order*.
- [ ] "All off" switches every LED off.
- [ ] Playing a game: the engine's move is lit, placing it is confirmed, the clock pause works as configured.

### Move
- [ ] Colour LEDs show red, green and blue on the intended squares.
- [ ] Piece status returns 34 entries; note what x and y mean on your unit.
- [ ] A one-piece target (1.e4 from the start position) is executed correctly.
- [ ] **STOP halts motion at once** — try both stop variants with a hand on the power switch; keep the one that works.
- [ ] After STOP, and after a finished motion, position reports resume and match reality.
- [ ] Touching a piece in non-force mode halts the motion.
- [ ] A capture, a castling move and an en-passant capture are reconstructed correctly as target positions.
- [ ] A promotion to queen works with the spare queen; a third queen is refused by the app.
- [ ] How long does a typical move take? Adjust expectations if the app waits too long or too briefly
      (`seconds_per_piece` in `hardware/robot.py`).
- [ ] An opening line plays back move by move, each verified before the next is sent.
- [ ] Only after all of the above: tick the checklist in Robot Studio and unlock live motion.

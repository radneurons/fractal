"""Reconcile raw sensor placements with a legal game.

A board report is only "which piece code sits on which square".  Side to move,
castling rights, en passant and history live in the game (`chess.Board`); this module
decides what a new placement *means* relative to that game — without ever inferring
legality from geometry: candidate moves come from the rules engine and are matched by
their resulting placement.
"""
from __future__ import annotations

from typing import Any

import chess

from .codec import placement_of

Placement = dict[int, str]


def diff(a: Placement, b: Placement) -> dict[str, list[str]]:
    """Squares that differ between expected `a` and observed `b`."""
    missing = [chess.square_name(s) for s in sorted(a) if s not in b]
    extra = [chess.square_name(s) for s in sorted(b) if s not in a]
    wrong = [chess.square_name(s) for s in sorted(a) if s in b and a[s] != b[s]]
    return {"missing": missing, "extra": extra, "wrong": wrong}


def diff_count(a: Placement, b: Placement) -> int:
    d = diff(a, b)
    return len(d["missing"]) + len(d["extra"]) + len(d["wrong"])


def after(board: chess.Board, move: chess.Move) -> Placement:
    b = board.copy(stack=False)
    b.push(move)
    return placement_of(b)


def reconcile(board: chess.Board, observed: Placement, *, auto_queen_on_pawn: bool = False) -> dict[str, Any]:
    """Classify an observed placement against the current game position.

    status:
      in_sync        observed == current position
      move           exactly one legal move produces the observed placement
      promotion_choice  a pawn stands on the last rank: the piece must still be chosen/replaced
      takeback       observed == the position before the last move
      in_progress    consistent with a move being made (piece lifted / capture half done)
      mismatch       anything else — the physical board and the game disagree
    """
    current = placement_of(board)
    if observed == current:
        return {"status": "in_sync"}
    matches = [m for m in board.legal_moves if after(board, m) == observed]
    if len(matches) == 1:
        return {"status": "move", "move": matches[0].uci(), "san": board.san(matches[0])}
    if len(matches) > 1:  # cannot happen in orthodox chess, but never guess
        return {"status": "mismatch", "detail": "ambiguous", "candidates": [m.uci() for m in matches],
                "diff": diff(current, observed)}
    # Pawn pushed to the last rank but not yet replaced by the promoted piece.
    promos = [m for m in board.legal_moves if m.promotion]
    if promos:
        pawn = "P" if board.turn == chess.WHITE else "p"
        for m in promos:
            if m.promotion != chess.QUEEN:
                continue
            exp = after(board, m)
            exp[m.to_square] = pawn
            if exp == observed:
                if auto_queen_on_pawn:
                    return {"status": "move", "move": m.uci(), "san": board.san(m), "assumed_promotion": True}
                options = [x.uci() for x in promos if x.from_square == m.from_square and x.to_square == m.to_square]
                return {"status": "promotion_choice", "from": chess.square_name(m.from_square),
                        "to": chess.square_name(m.to_square), "options": options}
    if board.move_stack:
        prev = board.copy()
        prev.pop()
        if placement_of(prev) == observed:
            return {"status": "takeback"}
    d = diff(current, observed)
    progress = _in_progress(board, current, observed)
    if progress:
        return {"status": "in_progress", "diff": d, **progress}
    return {"status": "mismatch", "diff": d}


def _in_progress(board: chess.Board, current: Placement, observed: Placement) -> dict[str, Any] | None:
    """Is `observed` a plausible intermediate state of some legal move?

    Intermediate states considered: mover lifted; captured piece removed; both; king or rook
    of a castling move in the air; the moved piece already placed while a captured piece or
    castling rook is still to be handled.
    """
    missing = [s for s in current if s not in observed]
    extra = [s for s in observed if s not in current]
    changed = [s for s in current if s in observed and current[s] != observed[s]]
    mover_color = board.turn
    lifted_own = [s for s in missing if current[s].isupper() == (mover_color == chess.WHITE)]
    lifted_opp = [s for s in missing if s not in lifted_own]
    candidates = []
    for m in board.legal_moves:
        exp = after(board, m)
        touched = {s for s in set(current) | set(exp) if current.get(s) != exp.get(s)}
        # every observed deviation must lie on squares this move touches
        deviating = set(missing) | set(extra) | set(changed)
        if not deviating <= touched:
            continue
        # squares that already look like the final position, or still like the start, or empty (in the air)
        ok = True
        for s in touched:
            o = observed.get(s)
            if o is not None and o != current.get(s) and o != exp.get(s):
                ok = False
                break
        if ok:
            candidates.append(m)
    if not candidates:
        return None
    hint = None
    if len(lifted_own) == 1 and not extra:
        hint = {"lifted": chess.square_name(lifted_own[0]),
                "targets": sorted({chess.square_name(m.to_square) for m in candidates if m.from_square == lifted_own[0]})}
    return {"candidates": [m.uci() for m in candidates][:40], "lifted_own": [chess.square_name(s) for s in lifted_own],
            "lifted_opponent": [chess.square_name(s) for s in lifted_opp], "hint": hint}


def setup_instructions(current: Placement, target: Placement) -> list[dict[str, Any]]:
    """Human-readable steps to turn `current` into `target` (guided manual setup)."""
    steps: list[dict[str, Any]] = []
    cur = dict(current)
    sources = {s: p for s, p in cur.items() if target.get(s) != p}
    needs = {s: p for s, p in target.items() if cur.get(s) != p}
    for dst, sym in sorted(needs.items()):
        src = next((s for s, p in sorted(sources.items(), key=lambda kv: chess.square_distance(kv[0], dst)) if p == sym), None)
        if src is not None:
            steps.append({"action": "move", "piece": sym, "from": chess.square_name(src), "to": chess.square_name(dst)})
            del sources[src]
        else:
            steps.append({"action": "add", "piece": sym, "to": chess.square_name(dst)})
    for src, sym in sorted(sources.items()):
        steps.insert(0, {"action": "remove", "piece": sym, "from": chess.square_name(src)})
    return steps

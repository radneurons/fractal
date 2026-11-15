"""Static (engine-free) gambit machinery: what a move gives up, and what it gets back.

Everything here is a rule on the board, not an engine verdict.  It is used to *find* sacrifices cheaply
and to *describe* compensation; whether a gambit is any good is decided by the engine in lab.py.
"""
from __future__ import annotations

from typing import Any

import chess

VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 100}
CENTRE = [chess.D4, chess.E4, chess.D5, chess.E5]


def material(board: chess.Board, color: bool) -> int:
    return sum(VAL[p] * len(board.pieces(p, color)) for p in (chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN))


def balance(board: chess.Board, color: bool) -> int:
    """Material in pawns from `color`'s point of view."""
    return material(board, color) - material(board, not color)


def _captured_value(board: chess.Board, move: chess.Move) -> int:
    if board.is_en_passant(move):
        return 1
    p = board.piece_at(move.to_square)
    v = VAL[p.piece_type] if p else 0
    return v + (VAL[move.promotion] - 1 if move.promotion else 0)


def _least_valuable_capture(board: chess.Board, square: int) -> chess.Move | None:
    best: tuple[int, chess.Move] | None = None
    for a in board.attackers(board.turn, square):
        p = board.piece_at(a)
        promo = chess.QUEEN if p.piece_type == chess.PAWN and chess.square_rank(square) in (0, 7) else None
        mv = chess.Move(a, square, promotion=promo)
        if board.is_legal(mv) and (best is None or VAL[p.piece_type] < best[0]):
            best = (VAL[p.piece_type], mv)
    return best[1] if best else None


def see(board: chess.Board, move: chess.Move) -> int:
    """Static exchange evaluation of a capture, in pawns, for the side making it."""
    gain = _captured_value(board, move)
    b = board.copy(stack=False)
    b.push(move)
    reply = _least_valuable_capture(b, move.to_square)
    if reply is None:
        return gain
    return gain - max(0, see(b, reply))


def best_capture(board: chess.Board) -> tuple[int, chess.Move | None]:
    """The most material the side to move can win at once by an exchange (0 if nothing)."""
    best, best_mv = 0, None
    for mv in board.generate_legal_captures():
        v = see(board, mv)
        if v > best:
            best, best_mv = v, mv
    return best, best_mv


def outcome_after(board: chess.Board, move: chess.Move) -> tuple[int, chess.Move | None]:
    """Material balance for the mover once the opponent has taken whatever the move leaves en prise."""
    color = board.turn
    b = board.copy(stack=False)
    b.push(move)
    if b.is_game_over():
        return balance(b, color), None
    win, taker = best_capture(b)
    return balance(b, color) - win, taker


def _reference(board: chess.Board, best_alt: int) -> int:
    """The material the mover can fairly be said to 'have': the best outcome available now, but not
    more than the balance before the opponent's last move.  So declining to recapture counts as a
    sacrifice (Danish 3.c3), while declining to *win* something offered does not inflate one
    (Falkbeer 2...d5 gives up one pawn, not two)."""
    if not board.move_stack:
        return best_alt
    prev = board.copy()
    prev.pop()
    return min(best_alt, balance(prev, board.turn))


def sacrifices(board: chess.Board, min_pawns: int = 1) -> list[tuple[chess.Move, dict[str, Any]]]:
    """Every legal move that gives up at least `min_pawns` of material, biggest first.

    Pass a board that still has its move stack when possible: the last move decides what counts as
    'declining to recapture'."""
    outcomes = {m: outcome_after(board, m) for m in board.legal_moves}
    if not outcomes:
        return []
    top = max(v for v, _ in outcomes.values())
    ref = _reference(board, top)
    keep = next((k for k, (kv, _) in outcomes.items() if kv == top and board.is_capture(k)), None)      # a recapture that was declined
    out = []
    for m, (v, taker) in outcomes.items():
        if ref - v >= min_pawns:
            b = board.copy(stack=False)
            b.push(m)
            out.append((m, {"pawns": ref - v, "balance_after": v, "accept": taker.uci() if taker else None,
                            "accept_san": b.san(taker) if taker else None, "keeps_material": board.san(keep) if keep is not None and keep != m else None,
                            "declined_recapture": taker is None}))
    out.sort(key=lambda x: (-x[1]["pawns"], x[0].uci()))
    return out


def sacrifice(board: chess.Board, move: chess.Move) -> dict[str, Any]:
    """How much material `move` gives up (0 pawns if none)."""
    hit = next((d for m, d in sacrifices(board, -99) if m == move), None)
    if hit is None:
        raise ValueError("Illegal move")
    return {**hit, "pawns": max(0, hit["pawns"])}


# ----------------------------------------------------------------------------------------- compensation
def _developed(board: chess.Board, color: bool) -> int:
    back = chess.BB_RANK_1 if color else chess.BB_RANK_8
    minors = board.pieces(chess.KNIGHT, color) | board.pieces(chess.BISHOP, color)
    n = sum(1 for s in minors if not chess.BB_SQUARES[s] & back)
    king = board.king(color)
    if king is not None and chess.square_file(king) in (1, 2, 6) and chess.BB_SQUARES[king] & back:
        n += 2                                           # castled (or as good as)
    queen = board.pieces(chess.QUEEN, color)
    if queen and not any(chess.BB_SQUARES[s] & back for s in queen):
        n += 1
    return n


def _king_danger(board: chess.Board, color: bool) -> float:
    """0..1: how exposed `color`'s king is (attackers in its zone, missing pawn shield, open files, still in the centre)."""
    king = board.king(color)
    if king is None:
        return 0.0
    zone = chess.SquareSet(chess.BB_KING_ATTACKS[king]) | chess.SquareSet(chess.BB_SQUARES[king])
    attackers = set()
    for s in zone:
        attackers |= {a for a in board.attackers(not color, s) if board.piece_type_at(a) != chess.PAWN}
    kf, kr = chess.square_file(king), chess.square_rank(king)
    step = 1 if color else -1
    shield = 0
    for f in (kf - 1, kf, kf + 1):
        if 0 <= f <= 7 and 0 <= kr + step <= 7:
            p = board.piece_at(chess.square(f, kr + step))
            shield += bool(p and p.piece_type == chess.PAWN and p.color == color)
    open_files = sum(1 for f in (kf - 1, kf, kf + 1) if 0 <= f <= 7 and not (board.pieces(chess.PAWN, color) & chess.BB_FILES[f]))
    centre = 0.25 if kf in (3, 4) and (board.has_castling_rights(color) or kr == (0 if color else 7)) and board.fullmove_number > 6 else 0.0
    stuck = 0.15 if kf in (3, 4) and not board.has_castling_rights(color) else 0.0
    return max(0.0, min(1.0, 0.16 * len(attackers) + 0.1 * (3 - shield) * (kf not in (3, 4)) + 0.12 * open_files + centre + stuck))


def _mobility(board: chess.Board, color: bool) -> int:
    b = board.copy(stack=False)
    b.turn = color
    b.ep_square = None
    return sum(1 for m in b.pseudo_legal_moves if b.piece_type_at(m.from_square) not in (chess.PAWN, chess.KING))


def _open_lines(board: chess.Board, color: bool) -> int:
    """Rooks and queens on files without their own pawns, and bishops on long open diagonals."""
    n = 0
    own_pawns = board.pieces(chess.PAWN, color)
    for s in board.pieces(chess.ROOK, color) | board.pieces(chess.QUEEN, color):
        n += not (own_pawns & chess.BB_FILES[chess.square_file(s)])
    for s in board.pieces(chess.BISHOP, color):
        n += len(board.attacks(s)) >= 7
    return n


def compensation(board: chess.Board, color: bool) -> dict[str, Any]:
    """What the gambiteer has for the material: four differences (gambiteer minus defender) and a 0..1 summary.

    These are static counts, deliberately simple and each one explained — they describe the *kind* of
    compensation; they do not prove it is enough.
    """
    them = not color
    dev = _developed(board, color) - _developed(board, them)
    king = _king_danger(board, them) - _king_danger(board, color)
    lines = _open_lines(board, color) - _open_lines(board, them)
    mob = _mobility(board, color) - _mobility(board, them)
    centre = sum((1 if board.is_attacked_by(color, s) else 0) - (1 if board.is_attacked_by(them, s) else 0) for s in CENTRE) \
        + sum((1 if (p := board.piece_at(s)) and p.color == color and p.piece_type == chess.PAWN else 0)
              - (1 if (p := board.piece_at(s)) and p.color == them and p.piece_type == chess.PAWN else 0) for s in CENTRE)
    parts = {
        "development": {"value": dev, "text": f"{'+' if dev >= 0 else ''}{dev} in developed pieces (castling counts double)"},
        "king": {"value": round(king, 2), "text": ("the defender's king is the more exposed" if king > 0.1 else
                                                    "your own king is the more exposed" if king < -0.1 else "kings about equally safe")},
        "lines": {"value": lines, "text": f"{'+' if lines >= 0 else ''}{lines} pieces on open files or long diagonals"},
        "mobility": {"value": mob, "text": f"{'+' if mob >= 0 else ''}{mob} piece moves available"},
        "centre": {"value": centre, "text": f"{'+' if centre >= 0 else ''}{centre} in central control"},
    }
    score = 0.5 + 0.07 * dev + 0.35 * king + 0.05 * lines + 0.012 * mob + 0.03 * centre
    kinds = [k for k, lim in (("development", 2), ("king", 0.2), ("lines", 2), ("mobility", 8), ("centre", 3)) if parts[k]["value"] >= lim]
    return {"score": round(max(0.0, min(1.0, score)), 3), "parts": parts, "kinds": kinds,
            "summary": ("Compensation: " + ", ".join({"development": "lead in development", "king": "attack on the king", "lines": "open lines",
                                                      "mobility": "active pieces", "centre": "central control"}[k] for k in kinds))
            if kinds else "No clear static compensation — the gambit lives on concrete tactics, or not at all."}

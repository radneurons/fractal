"""Pawn-structure and endgame classification with authored plans (static pattern recognition on the pawn skeleton)."""
from __future__ import annotations

from typing import Any

import chess


def _pawns(board: chess.Board, color: bool) -> set[str]:
    return {chess.square_name(s) for s in board.pieces(chess.PAWN, color)}


def _files(pawns: set[str]) -> set[str]:
    return {p[0] for p in pawns}


STRUCTURES: dict[str, dict[str, Any]] = {
    "iqp_white": {"name": "Isolated queen's pawn (White)", "white": ["Use the e5 and c5 outposts and attack the king before the endgame", "Push d4-d5 at the right moment to open the position"],
                  "black": ["Blockade d5 with a knight", "Trade minor pieces and aim for an endgame against the weak pawn"]},
    "iqp_black": {"name": "Isolated queen's pawn (Black)", "white": ["Blockade d4 and exchange pieces", "Pile up on the d-pawn with rooks and queen"],
                  "black": ["Keep pieces on and play for activity with ...d4 or kingside pressure", "Use the e4 and c4 outposts"]},
    "carlsbad": {"name": "Carlsbad structure", "white": ["Minority attack: b4-b5 to create a weak pawn on c6", "Or central expansion with f3 and e4"],
                 "black": ["Kingside play with ...Ne4 and ...f5", "Meet b4-b5 with ...c5 or ...a6 and piece activity on the e-file"]},
    "maroczy": {"name": "Maróczy Bind", "white": ["Keep the c4/e4 clamp and stop ...b5 and ...d5", "Use the d5 outpost and extra space"],
                "black": ["Break with ...b5 or ...f5, or prepare ...d5", "Trade pieces to relieve the lack of space"]},
    "hedgehog": {"name": "Hedgehog", "white": ["Maintain the bind and avoid premature attacks", "Probe with a4-a5 or a kingside pawn advance only when fully prepared"],
                 "black": ["Wait behind the pawn row, then strike with ...b5 or ...d5", "Regroup with ...Qb8, ...Re8, ...Bf8"]},
    "hanging_pawns": {"name": "Hanging pawns", "white": ["Advance one of the pawns to gain space or a passed pawn" , "Keep pieces behind the pawns for dynamic play"],
                      "black": ["Force one pawn forward and blockade", "Attack the pawns with rooks on the c- and d-files"]},
    "stonewall": {"name": "Stonewall", "white": ["Use the e5 outpost and exchange the dark-squared bishops", "Open the queenside with c4 and b4"],
                  "black": ["Plant a knight on e4 and attack with ...Qe8-h5", "Solve the bad bishop via ...Bd7-e8-h5 or ...b6"]},
    "french_chain": {"name": "French pawn chain", "white": ["Attack on the kingside where the chain points", "Hold d4, the base of the chain"],
                     "black": ["Undermine with ...c5 and ...f6", "Pressure d4 with ...Qb6 and ...Nc6"]},
    "kid_chain": {"name": "King's Indian chain", "white": ["Queenside expansion with c5 and b4", "Keep the kingside closed as long as possible"],
                  "black": ["...f5-f4 and a pawn storm against the king", "Reroute pieces to the kingside"]},
    "benoni": {"name": "Benoni structure", "white": ["Central break with e4-e5", "Restrain ...b5 with a4 and Nc4"],
               "black": ["Queenside majority: ...a6 and ...b5", "Pressure e4 along the e-file and use the e5 square"]},
    "sicilian_open": {"name": "Open Sicilian", "white": ["Attack before Black's queenside play arrives", "Use the d5 square and the d-file"],
                      "black": ["Minority attack and pressure on the half-open c-file", "Central break ...d5 at the right moment"]},
    "slav_triangle": {"name": "Slav / Caro triangle", "white": ["Space advantage and e4 break", "Pressure on the queenside light squares"],
                      "black": ["Free the position with ...c5 or ...e5", "Activate the light-squared bishop"]},
    "symmetrical_open": {"name": "Open centre (e-pawns exchanged)", "white": ["Fight for the e-file and development lead", "Create a second weakness"],
                         "black": ["Neutralise the initiative by trading on the open file", "Mirror development and equalise"]},
    "other": {"name": "Unclassified structure", "white": ["Improve the worst piece", "Create a pawn lever against the opponent's chain"],
              "black": ["Complete development and challenge the centre", "Trade the opponent's most active piece"]},
}


def classify_structure(board: chess.Board) -> str:
    w, b = _pawns(board, chess.WHITE), _pawns(board, chess.BLACK)
    wf, bf = _files(w), _files(b)
    if {"d4", "e5"} <= w and {"e6", "d5"} <= b:
        return "french_chain"
    if {"d5", "e4"} <= w and {"d6", "e5"} <= b:
        return "kid_chain"
    if "d5" in w and {"c5", "d6"} <= b and "e" not in bf:
        return "benoni"
    if ({"d4", "e3", "f4"} <= w and "c3" in w) or ({"d5", "e6", "f5"} <= b and "c6" in b):
        return "stonewall"
    if {"c4", "e4"} <= w and "d" not in wf and "c" not in bf and "d6" in b:
        return "hedgehog" if {"a6", "b6", "e6"} <= b else "maroczy"
    if "d4" in w and "c" not in wf and "e3" in w and {"c6", "d5"} <= b and "e" not in bf:
        return "carlsbad"
    if "d" in wf and "c" not in wf and "e" not in wf and "d" not in bf:
        return "iqp_white"
    if "d" in bf and "c" not in bf and "e" not in bf and "d" not in wf:
        return "iqp_black"
    for pawns, files, enemy in ((w, wf, bf), (b, bf, wf)):
        if {"c", "d"} <= files and "b" not in files and "e" not in files and "c" not in enemy and "d" not in enemy:
            return "hanging_pawns"
    if "e4" in w and "d" not in wf and "c" not in bf and ("d6" in b or "e6" in b):
        return "sicilian_open"
    if {"c6", "d5"} <= b and "d4" in w:
        return "slav_triangle"
    if "e" not in wf and "e" not in bf and "d" in wf and "d" in bf:
        return "symmetrical_open"
    return "other"


ENDGAMES: dict[str, dict[str, Any]] = {
    "pawn": {"name": "Pawn endgame", "tips": ["Count tempi and know the opposition and key squares", "An outside passed pawn usually decides"]},
    "rook": {"name": "Rook endgame", "tips": ["Activity before material: a passive rook loses", "Know Lucena and Philidor; rooks belong behind passed pawns"]},
    "double_rook": {"name": "Double-rook endgame", "tips": ["Seventh-rank control and king safety still matter", "Trade one pair only when the remaining rook ending is good for you"]},
    "queen": {"name": "Queen endgame", "tips": ["A far-advanced passed pawn outweighs pawn count", "Shelter your king from perpetual check"]},
    "bishops_opposite": {"name": "Opposite-coloured bishops", "tips": ["Pure endings are drawish: aim for two widely separated passed pawns", "With rooks or queens on, the attacker benefits"]},
    "bishops_same": {"name": "Same-coloured bishops", "tips": ["Fix enemy pawns on your bishop's colour", "Create a second weakness to stretch the defence"]},
    "bishop_vs_knight": {"name": "Bishop against knight", "tips": ["Bishop: open the position and play on both wings", "Knight: keep it closed and find a secure outpost"]},
    "knights": {"name": "Knight endgame", "tips": ["Treat it like a pawn ending: an outside passed pawn is close to decisive", "Knights struggle against rook pawns"]},
    "rook_minor": {"name": "Rook and minor piece each", "tips": ["Coordinate rook and minor piece against one weakness", "Decide which pair of pieces to exchange"]},
    "queen_minor": {"name": "Queen and minor piece each", "tips": ["Queen and knight attack well together; queen and bishop prefer open boards", "King safety decides most of these"]},
    "minor_imbalance": {"name": "Other minor-piece endgame", "tips": ["The bishop pair wants open lines and pawns on both wings", "Trade pawns when defending, pieces when ahead"]},
    "other": {"name": "Other simplified position", "tips": ["Activate the king as soon as it is safe", "Convert by creating a passed pawn"]},
}
_VAL = {chess.QUEEN: 9, chess.ROOK: 5, chess.BISHOP: 3, chess.KNIGHT: 3}


def endgame_type(board: chess.Board) -> str | None:
    """Name of the endgame class, or None while the position is still a middlegame."""
    pts = {c: sum(_VAL[t] * len(board.pieces(t, c)) for t in _VAL) for c in (chess.WHITE, chess.BLACK)}
    if max(pts.values()) > 13:
        return None
    q = [len(board.pieces(chess.QUEEN, c)) for c in (True, False)]
    r = [len(board.pieces(chess.ROOK, c)) for c in (True, False)]
    bi = [len(board.pieces(chess.BISHOP, c)) for c in (True, False)]
    n = [len(board.pieces(chess.KNIGHT, c)) for c in (True, False)]
    minors = [bi[0] + n[0], bi[1] + n[1]]
    if sum(q) + sum(r) + sum(minors) == 0:
        return "pawn"
    if sum(q) and not sum(r):
        return "queen" if not sum(minors) else "queen_minor" if q == [1, 1] and minors == [1, 1] else "other"
    if sum(q):
        return "other"
    if sum(r) and not sum(minors):
        return "rook" if r == [1, 1] else "double_rook" if r == [2, 2] else "other"
    if sum(r):
        return "rook_minor" if r == [1, 1] and minors == [1, 1] else "other"
    if bi == [1, 1] and not sum(n):
        ws, bs = next(iter(board.pieces(chess.BISHOP, True))), next(iter(board.pieces(chess.BISHOP, False)))
        same = (chess.square_file(ws) + chess.square_rank(ws)) % 2 == (chess.square_file(bs) + chess.square_rank(bs)) % 2
        return "bishops_same" if same else "bishops_opposite"
    if n == [1, 1] and not sum(bi):
        return "knights"
    if minors == [1, 1]:
        return "bishop_vs_knight"
    return "minor_imbalance"


def naturalness(board: chess.Board, move: chess.Move) -> float:
    """0..1 heuristic: how readily a human finds this move (captures, checks and development are natural;
    quiet retreats and odd pawn moves are not).  Used only when no human game data is available."""
    piece = board.piece_at(move.from_square)
    if piece is None:
        return 0.5
    if board.is_castling(move):
        return 0.9
    if board.is_capture(move):
        return 0.9 if board.is_attacked_by(not board.turn, move.from_square) or board.piece_at(move.to_square) else 0.85
    if board.gives_check(move):
        return 0.8
    back = 0 if piece.color else 7
    fr, tr = chess.square_rank(move.from_square), chess.square_rank(move.to_square)
    forward = (tr - fr) * (1 if piece.color else -1)
    if piece.piece_type in (chess.KNIGHT, chess.BISHOP) and fr == back:
        return 0.8
    if piece.piece_type == chess.PAWN:
        return 0.7 if chess.square_file(move.to_square) in (2, 3, 4, 5) else 0.4
    if tr == back and forward < 0:
        return 0.25
    if forward < 0:
        return 0.35
    if piece.piece_type == chess.KING:
        return 0.3
    if piece.piece_type == chess.QUEEN:
        return 0.45
    return 0.55

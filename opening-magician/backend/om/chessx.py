"""Chess helpers shared by every subsystem: score normalisation, position identity,
move classification and PGN utilities.  python-chess is the single rules authority.
"""
from __future__ import annotations

import io
import math
from dataclasses import dataclass
from typing import Any, Iterable

import chess
import chess.engine
import chess.pgn

START_FEN = chess.STARTING_FEN
PIECE_VALUE = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330, chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 0}


# ---------------------------------------------------------------------------
# Position identity
# ---------------------------------------------------------------------------
def pos_key(board: chess.Board) -> str:
    """Transposition-safe identity: placement, side to move, castling, *legal* en passant.

    Move counters and repetition history are deliberately excluded, so analysis can be
    shared across move orders.  Anything history-sensitive (repetition, 50-move) must
    carry the full game, which games/studies do.
    """
    return board.epd(en_passant="legal")


def board_from(fen: str | None = None, moves: Iterable[str] = ()) -> chess.Board:
    board = chess.Board(fen) if fen else chess.Board()
    for m in moves:
        board.push(parse_move(board, m))
    return board


def parse_move(board: chess.Board, text: str) -> chess.Move:
    """Accept UCI or SAN; always validate legality against the rules engine."""
    text = text.strip()
    try:
        mv = chess.Move.from_uci(text)
        if mv in board.legal_moves:
            return mv
    except ValueError:
        pass
    return board.parse_san(text)  # raises ValueError subclasses on illegal/ambiguous


def san_line(board: chess.Board, moves: Iterable[chess.Move], max_plies: int = 40) -> list[str]:
    b = board.copy(stack=False)
    out = []
    for i, m in enumerate(moves):
        if i >= max_plies or m not in b.legal_moves:
            break
        out.append(b.san(m))
        b.push(m)
    return out


def numbered(board: chess.Board, sans: list[str]) -> str:
    """Render SAN list with move numbers starting from `board`'s move counters."""
    parts, n, white = [], board.fullmove_number, board.turn == chess.WHITE
    for i, s in enumerate(sans):
        if white:
            parts.append(f"{n}.{s}")
        else:
            parts.append(f"{n}...{s}" if i == 0 else s)
            n += 1
        white = not white
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Scores.  Centipawns and mate distances are different quantities and are never mixed:
# ordering uses `order_key`, magnitudes use expected score (0..1).
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Score:
    cp: int | None = None
    mate: int | None = None  # +n: side to move mates in n; -n: gets mated in n
    wdl: tuple[int, int, int] | None = None  # per mille, from the same point of view

    @staticmethod
    def from_pov(ps: chess.engine.PovScore | None, pov: chess.Color, wdl: Any = None) -> "Score":
        if ps is None:
            return Score()
        s = ps.pov(pov)
        w = None
        if wdl is not None:
            try:
                rel = wdl.pov(pov)
                w = (rel.wins, rel.draws, rel.losses)
            except Exception:
                w = None
        return Score(cp=s.score(), mate=s.mate(), wdl=w)

    @staticmethod
    def from_dict(d: dict[str, Any] | None) -> "Score":
        if not d:
            return Score()
        w = d.get("wdl")
        return Score(d.get("cp"), d.get("mate"), tuple(w) if w else None)  # type: ignore[arg-type]

    def to_dict(self) -> dict[str, Any]:
        return {"cp": self.cp, "mate": self.mate, "wdl": list(self.wdl) if self.wdl else None,
                "expected": round(self.expected(), 4), "text": self.text()}

    @property
    def known(self) -> bool:
        return self.cp is not None or self.mate is not None

    @property
    def is_mate(self) -> bool:
        return self.mate is not None

    def expected(self) -> float:
        """Expected game score for the point-of-view side in [0, 1]."""
        if self.mate is not None:
            return 1.0 if self.mate > 0 else 0.0
        if self.wdl:
            w, d, l = self.wdl
            tot = max(1, w + d + l)
            return (w + 0.5 * d) / tot
        if self.cp is None:
            return 0.5
        return 1.0 / (1.0 + math.exp(-0.00368208 * self.cp))

    def order_key(self) -> tuple[int, float]:
        """Total order: quick mates > slow mates > centipawns > being mated late > mated soon."""
        if self.mate is not None:
            return (2, -self.mate) if self.mate > 0 else (0, -self.mate)
        return (1, float(self.cp if self.cp is not None else 0))

    def negate(self) -> "Score":
        return Score(None if self.cp is None else -self.cp, None if self.mate is None else -self.mate,
                     (self.wdl[2], self.wdl[1], self.wdl[0]) if self.wdl else None)

    def text(self) -> str:
        if self.mate is not None:
            return f"#{self.mate}" if self.mate > 0 else f"#-{abs(self.mate)}"
        if self.cp is None:
            return "?"
        return f"{self.cp / 100:+.2f}"


def loss_between(best: Score, cand: Score) -> dict[str, Any]:
    """How much worse `cand` is than `best` (same point of view).

    Returns expected-score loss (always defined) and centipawn loss only when both
    scores are centipawn scores — a mate score has no centipawn equivalent.
    """
    exp_loss = max(0.0, best.expected() - cand.expected())
    cp_loss = None
    if best.cp is not None and cand.cp is not None and not best.is_mate and not cand.is_mate:
        cp_loss = max(0, best.cp - cand.cp)
    return {"expected_loss": round(exp_loss, 4), "cp_loss": cp_loss,
            "mate_involved": best.is_mate or cand.is_mate,
            "walks_into_mate": cand.mate is not None and cand.mate < 0,
            "misses_mate": best.mate is not None and best.mate > 0 and not (cand.mate and cand.mate > 0)}


# ---------------------------------------------------------------------------
# Move classification
# ---------------------------------------------------------------------------
CLASSES = ["best", "excellent", "good", "interesting", "inaccuracy", "mistake", "blunder", "forced", "book",
           "novelty_candidate"]


def classify_move(*, best: Score, played: Score, rank: int | None, legal_count: int, depth: int,
                  in_book: bool = False, book_known_position: bool = False, sacrifice: bool = False,
                  second: Score | None = None, min_depth_for_harsh: int = 12,
                  stable: bool = True) -> dict[str, Any]:
    """Classify from engine evidence.  Harsh labels (mistake/blunder) require a deep
    enough *and* stable search; otherwise the label is downgraded and flagged provisional.
    """
    loss = loss_between(best, played)
    el = loss["expected_loss"]
    provisional = False
    if in_book:
        label = "book"
    elif legal_count == 1:
        label = "forced"
    elif rank == 1 or el <= 0.005:
        # an "only move": everything else loses a lot
        if second is not None and loss_between(best, second)["expected_loss"] >= 0.20 and legal_count > 1:
            label = "forced" if best.expected() < 0.65 else "best"
        else:
            label = "best"
    elif el <= 0.02:
        label = "excellent"
    elif el <= 0.05:
        label = "interesting" if sacrifice else "good"
    elif el <= 0.10:
        label = "inaccuracy"
    elif el <= 0.20:
        label = "mistake"
    else:
        label = "blunder"
    if loss["walks_into_mate"] and not (best.mate is not None and best.mate < 0):
        label = "blunder"
    if label in ("mistake", "blunder") and (depth < min_depth_for_harsh or not stable):
        provisional = True
        label = "inaccuracy" if label == "mistake" else "mistake"
    if book_known_position and not in_book and label in ("best", "excellent", "good", "interesting"):
        novelty = True
    else:
        novelty = False
    return {"label": label, "novelty_candidate": novelty, "provisional": provisional, **loss,
            "evidence": {"depth": depth, "rank": rank, "stable": stable, "best": best.text(), "played": played.text()}}


def is_sacrifice(board: chess.Board, move: chess.Move) -> bool:
    """Cheap static test: the moved piece lands on a square where it can be captured for less."""
    piece = board.piece_at(move.from_square)
    if not piece:
        return False
    gained = PIECE_VALUE[board.piece_at(move.to_square).piece_type] if board.piece_at(move.to_square) else 0
    b = board.copy(stack=False)
    b.push(move)
    attackers = b.attackers(b.turn, move.to_square)
    if not attackers:
        return False
    cheapest = min(PIECE_VALUE[b.piece_at(sq).piece_type] for sq in attackers)  # type: ignore[union-attr]
    defended = bool(b.attackers(not b.turn, move.to_square))
    value = PIECE_VALUE[piece.piece_type]
    return value - gained >= 200 and (not defended or cheapest < value - 100)


# ---------------------------------------------------------------------------
# Tactical motifs (static detection, used for puzzle themes and annotations)
# ---------------------------------------------------------------------------
def motifs_after(board: chess.Board, move: chess.Move) -> list[str]:
    themes: list[str] = []
    mover = board.turn
    piece = board.piece_at(move.from_square)
    b = board.copy(stack=False)
    is_capture = board.is_capture(move)
    b.push(move)
    if b.is_checkmate():
        return ["checkmate"]
    # fork: moved piece attacks 2+ more valuable or undefended pieces (or king + piece)
    if piece:
        targets = []
        for sq in b.attacks(move.to_square):
            t = b.piece_at(sq)
            if t and t.color != mover:
                undefended = not b.attackers(t.color, sq)
                if t.piece_type == chess.KING or PIECE_VALUE[t.piece_type] > PIECE_VALUE[piece.piece_type] or undefended:
                    targets.append(sq)
        if len(targets) >= 2:
            themes.append("fork")
    # discovered attack / check: a different piece now attacks the king or a major piece
    if b.is_check():
        checkers = b.checkers()
        if move.to_square not in checkers:
            themes.append("discovered_attack")
        elif len(checkers) > 1:
            themes.append("double_check")
    # pin / skewer along sliders from the moved piece
    if piece and piece.piece_type in (chess.BISHOP, chess.ROOK, chess.QUEEN):
        for sq in b.attacks(move.to_square):
            t = b.piece_at(sq)
            if not t or t.color == mover:
                continue
            behind = None
            step = _direction(move.to_square, sq)
            cur, prev = sq + step, sq
            while step and 0 <= cur < 64 and chess.square_distance(cur, prev) == 1:
                p = b.piece_at(cur)
                if p:
                    behind = (cur, p)
                    break
                prev, cur = cur, cur + step
            if behind and behind[1].color != mover:
                front_v, back_v = PIECE_VALUE[t.piece_type] or 10_000, PIECE_VALUE[behind[1].piece_type] or 10_000
                if back_v > front_v and t.piece_type != chess.PAWN:
                    themes.append("pin")
                elif front_v > back_v and back_v >= 300:
                    themes.append("skewer")
    if piece and is_sacrifice(board, move):
        themes.append("sacrifice")
    if piece and piece.piece_type == chess.PAWN and not is_capture and chess.square_file(move.to_square) in (2, 3, 4, 5):
        # a pawn advance that attacks an enemy pawn = lever / pawn break
        if any((b.piece_at(sq) and b.piece_at(sq).piece_type == chess.PAWN and b.piece_at(sq).color != mover)  # type: ignore[union-attr]
               for sq in b.attacks(move.to_square)):
            themes.append("pawn_break")
    if move.promotion:
        themes.append("promotion")
    return list(dict.fromkeys(themes))


def _direction(a: int, b: int) -> int:
    fa, ra, fb, rb = chess.square_file(a), chess.square_rank(a), chess.square_file(b), chess.square_rank(b)
    df, dr = (fb > fa) - (fb < fa), (rb > ra) - (rb < ra)
    if fa != fb and ra != rb and abs(fa - fb) != abs(ra - rb):
        return 0
    return dr * 8 + df


def tactical_complexity(board: chess.Board) -> float:
    """0..1 heuristic: share of forcing moves, hanging material and king exposure."""
    legal = list(board.legal_moves)
    if not legal:
        return 0.0
    forcing = sum(1 for m in legal if board.is_capture(m) or board.gives_check(m) or m.promotion)
    hanging = 0
    for sq, p in board.piece_map().items():
        if p.piece_type in (chess.PAWN, chess.KING):
            continue
        att = board.attackers(not p.color, sq)
        if att and (not board.attackers(p.color, sq) or
                    min(PIECE_VALUE[board.piece_at(a).piece_type] for a in att) < PIECE_VALUE[p.piece_type]):  # type: ignore[union-attr]
            hanging += 1
    check = 0.2 if board.is_check() else 0.0
    return max(0.0, min(1.0, 0.55 * forcing / len(legal) * 3 + 0.12 * hanging + check))


def pawn_structure(board: chess.Board) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for color, name in ((chess.WHITE, "white"), (chess.BLACK, "black")):
        pawns = board.pieces(chess.PAWN, color)
        files = [chess.square_file(s) for s in pawns]
        enemy = board.pieces(chess.PAWN, not color)
        isolated, doubled, passed = [], [], []
        for s in pawns:
            f, r = chess.square_file(s), chess.square_rank(s)
            if not any(ff in files for ff in (f - 1, f + 1)):
                isolated.append(chess.square_name(s))
            if files.count(f) > 1:
                doubled.append(chess.square_name(s))
            ahead = [e for e in enemy if abs(chess.square_file(e) - f) <= 1 and
                     (chess.square_rank(e) > r if color == chess.WHITE else chess.square_rank(e) < r)]
            if not ahead:
                passed.append(chess.square_name(s))
        out[name] = {"isolated": isolated, "doubled": doubled, "passed": passed,
                     "islands": _islands(files), "count": len(pawns)}
    return out


def _islands(files: list[int]) -> int:
    fs = sorted(set(files))
    return sum(1 for i, f in enumerate(fs) if i == 0 or f - fs[i - 1] > 1)


# ---------------------------------------------------------------------------
# PGN
# ---------------------------------------------------------------------------
def read_games(text: str, limit: int | None = None) -> list[chess.pgn.Game]:
    out: list[chess.pgn.Game] = []
    handle = io.StringIO(text)
    while True:
        game = chess.pgn.read_game(handle)
        if game is None:
            break
        if game.errors and not list(game.mainline_moves()) and not game.variations:
            # unparseable chunk — keep going, large files often contain junk between games
            continue
        out.append(game)
        if limit and len(out) >= limit:
            break
    return out


def game_to_pgn(game: chess.pgn.Game) -> str:
    return game.accept(chess.pgn.StringExporter(headers=True, variations=True, comments=True, columns=88))


def pgn_from_moves(start_fen: str | None, moves: Iterable[chess.Move], headers: dict[str, str] | None = None,
                   comments: dict[int, str] | None = None) -> str:
    game = chess.pgn.Game()
    board = chess.Board(start_fen) if start_fen and start_fen != START_FEN else chess.Board()
    if start_fen and start_fen != START_FEN:
        game.setup(board)
    for k, v in (headers or {}).items():
        game.headers[k] = str(v)
    node: chess.pgn.GameNode = game
    for i, m in enumerate(moves):
        node = node.add_variation(m)
        if comments and i in comments:
            node.comment = comments[i]
    return game_to_pgn(game)


def game_tree(game: chess.pgn.Game, max_nodes: int = 20000) -> dict[str, Any]:
    """Serialise a PGN (with variations, comments, NAGs, arrows) into a JSON tree."""
    count = 0

    def walk(node: chess.pgn.GameNode) -> dict[str, Any]:
        nonlocal count
        count += 1
        board = node.board()
        d: dict[str, Any] = {"fen": board.fen(), "ply": node.ply(), "comment": node.comment or "",
                             "nags": sorted(node.nags),
                             "arrows": [{"from": chess.square_name(a.tail), "to": chess.square_name(a.head),
                                         "color": a.color} for a in node.arrows()],
                             "children": []}
        if node.move is not None and node.parent is not None:
            d["uci"] = node.move.uci()
            d["san"] = node.parent.board().san(node.move)
        if count < max_nodes:
            d["children"] = [walk(c) for c in node.variations]
        return d

    return {"headers": dict(game.headers), "root": walk(game)}


def result_of(board: chess.Board, claim_draw: bool = True) -> tuple[str, str] | None:
    """(result, termination) once the game is over under FIDE rules, else None."""
    out = board.outcome(claim_draw=claim_draw)
    if out is None:
        return None
    return out.result(), out.termination.name.lower()


def describe_state(board: chess.Board) -> dict[str, Any]:
    return {
        "fen": board.fen(), "turn": "w" if board.turn else "b", "check": board.is_check(),
        "checkmate": board.is_checkmate(), "stalemate": board.is_stalemate(),
        "insufficient": board.is_insufficient_material(),
        "can_claim_threefold": board.can_claim_threefold_repetition(),
        "can_claim_fifty": board.can_claim_fifty_moves(),
        "fivefold": board.is_fivefold_repetition(), "seventyfive": board.is_seventyfive_moves(),
        "halfmove_clock": board.halfmove_clock, "fullmove": board.fullmove_number,
        "legal": [m.uci() for m in board.legal_moves],
    }

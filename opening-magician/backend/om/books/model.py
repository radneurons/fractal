"""Opening book as a transposition-aware position graph, with import/export.

Nodes are positions (identity = placement + side + castling + legal en passant); edges are
legal moves carrying weights, results, evaluations and research status.  Different move
orders reaching the same position share one node.  Full game histories (needed for
repetition / 50-move interpretation) stay with the games and studies they came from.

Formats that really work here: PGN (with variations), EPD, FEN lists, Polyglot .bin
(read + write), the native JSON format, and CSV with the schema in `CSV_FIELDS`.
Proprietary formats (ChessBase CTG, Arena ABK, …) are *not* silently "supported":
`import_any` raises a clear error with the conversion route.
"""
from __future__ import annotations

import csv
import io
import json
import random
import struct
import tempfile
from collections import deque
from pathlib import Path
from typing import Any, Iterable, Iterator

import chess
import chess.pgn
import chess.polyglot

from ..chessx import START_FEN, Score, pos_key, read_games

FORMAT_VERSION = 1
CSV_FIELDS = ["fen", "move", "weight", "games", "wins", "draws", "losses", "eval_cp", "status", "comment"]
STATUSES = ["main", "side", "candidate", "approved", "rejected", "exploration"]
PROFILES = {
    "main": "Main Repertoire — sound, practical play",
    "surprise": "Surprise Repertoire — viable uncommon lines",
    "aggressive": "Aggressive Repertoire — tactical, unbalanced, within viability limits",
    "solid": "Solid Repertoire — robust positions",
    "exploration": "Exploration Book — candidates that still need testing",
    "tournament_research": "Tournament Research Book — drives controlled engine experiments",
    "opponent": "Opponent-Specific Book — focused on one opponent's habits",
}
UNSUPPORTED = {
    ".ctg": "ChessBase CTG is a proprietary binary format. Export the book to PGN (or Polyglot .bin) from ChessBase/Fritz or a converter, then import that file.",
    ".ctb": "ChessBase CTG companion file — see .ctg.", ".cto": "ChessBase CTG companion file — see .ctg.",
    ".abk": "Arena ABK is engine-GUI specific. Convert it to Polyglot .bin or PGN (Arena can export PGN) and import that.",
    ".obk": "Chessmaster/older OBK books must be converted to PGN or Polyglot first.",
    ".cbh": "ChessBase databases are not opening books; export the games as PGN.",
    ".si4": "SCID databases: export the games as PGN from SCID.",
}


class BookError(ValueError):
    pass


def new_move(san: str, **kw: Any) -> dict[str, Any]:
    m = {"san": san, "weight": 1.0, "games": 0, "w": 0, "d": 0, "l": 0, "eval": None, "status": "main", "comment": "",
         "confidence": None, "source": "manual", "priority": 0.0}
    m.update(kw)
    return m


class Book:
    def __init__(self, data: dict[str, Any] | None = None):
        data = data or {}
        self.root_fen: str = data.get("root_fen", START_FEN)
        self.positions: dict[str, dict[str, Any]] = data.get("positions", {})

    # -- serialisation -----------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return {"format": "opening-magician-book", "format_version": FORMAT_VERSION, "root_fen": self.root_fen,
                "positions": self.positions}

    def copy(self) -> "Book":
        return Book(json.loads(json.dumps(self.to_dict())))

    # -- basic graph ops ---------------------------------------------------
    def node(self, board: chess.Board, create: bool = False) -> dict[str, Any] | None:
        key = pos_key(board)
        n = self.positions.get(key)
        if n is None and create:
            n = self.positions[key] = {"fen": board.fen(), "moves": {}}
        return n

    def add_move(self, board: chess.Board, move: chess.Move, *, weight: float = 1.0, result: str | None = None,
                 source: str = "manual", status: str | None = None, comment: str = "", accumulate: bool = True,
                 **extra: Any) -> dict[str, Any]:
        if move not in board.legal_moves:
            raise BookError(f"Illegal move {move.uci()} in {board.fen()}")
        node = self.node(board, create=True)
        assert node is not None
        m = node["moves"].get(move.uci())
        if m is None:
            m = node["moves"][move.uci()] = new_move(board.san(move), weight=0.0 if accumulate else weight, source=source,
                                                      status=status or "main")
        if accumulate:
            m["weight"] = round(m["weight"] + weight, 6)
        else:
            m["weight"] = weight
        if status:
            m["status"] = status
        if comment and comment not in m["comment"]:
            m["comment"] = (m["comment"] + " " + comment).strip()
        if result in ("1-0", "0-1", "1/2-1/2"):
            m["games"] += 1
            mover_white = board.turn == chess.WHITE
            if result == "1/2-1/2":
                m["d"] += 1
            elif (result == "1-0") == mover_white:
                m["w"] += 1
            else:
                m["l"] += 1
        m.update(extra)
        return m

    def moves_at(self, board: chess.Board) -> list[dict[str, Any]]:
        node = self.node(board)
        if not node:
            return []
        out = []
        total = sum(max(0.0, m["weight"]) for m in node["moves"].values()) or 1.0
        for uci, m in node["moves"].items():
            b = board.copy(stack=False)
            mv = chess.Move.from_uci(uci)
            if mv not in b.legal_moves:
                continue
            b.push(mv)
            child = self.positions.get(pos_key(b))
            out.append({"uci": uci, **m, "share": round(max(0.0, m["weight"]) / total, 4),
                        "score": round((m["w"] + 0.5 * m["d"]) / m["games"], 4) if m["games"] else None,
                        "children": len(child["moves"]) if child else 0, "fen_after": b.fen()})
        out.sort(key=lambda m: (-m["weight"], m["san"]))
        return out

    def contains(self, board: chess.Board, move: chess.Move) -> bool:
        node = self.node(board)
        return bool(node and move.uci() in node["moves"])

    def remove_move(self, board: chess.Board, move_uci: str) -> bool:
        node = self.node(board)
        if node and move_uci in node["moves"]:
            del node["moves"][move_uci]
            return True
        return False

    def walk(self, max_ply: int = 60) -> Iterator[tuple[chess.Board, int]]:
        """Breadth-first over reachable positions (each position once)."""
        root = chess.Board(self.root_fen)
        seen = {pos_key(root)}
        queue: deque[tuple[chess.Board, int]] = deque([(root, 0)])
        while queue:
            board, ply = queue.popleft()
            yield board, ply
            if ply >= max_ply:
                continue
            node = self.positions.get(pos_key(board))
            if not node:
                continue
            for uci in node["moves"]:
                mv = chess.Move.from_uci(uci)
                if mv not in board.legal_moves:
                    continue
                b = board.copy(stack=False)
                b.push(mv)
                k = pos_key(b)
                if k not in seen:
                    seen.add(k)
                    queue.append((b, ply + 1))

    def stats(self) -> dict[str, Any]:
        n_moves = sum(len(p["moves"]) for p in self.positions.values())
        depth, reachable, leaves = 0, 0, 0
        status: dict[str, int] = {}
        for board, ply in self.walk(200):
            reachable += 1
            depth = max(depth, ply)
            node = self.positions.get(pos_key(board))
            if not node or not node["moves"]:
                leaves += 1
        for p in self.positions.values():
            for m in p["moves"].values():
                status[m["status"]] = status.get(m["status"], 0) + 1
        games = sum(m["games"] for m in self.positions.get(pos_key(chess.Board(self.root_fen)), {"moves": {}})["moves"].values())
        return {"positions": len(self.positions), "moves": n_moves, "reachable": reachable, "max_ply": depth,
                "leaves": leaves, "by_status": status, "root_games": games,
                "unreachable": max(0, len([p for p in self.positions.values() if p["moves"]]) - (reachable - leaves))}

    def prune_empty(self) -> None:
        self.positions = {k: v for k, v in self.positions.items() if v["moves"] or k == pos_key(chess.Board(self.root_fen))}

    # -- derived operations ------------------------------------------------
    def merge(self, other: "Book", weight_scale: float = 1.0, prefer: str = "sum") -> dict[str, int]:
        added_pos, added_moves, updated = 0, 0, 0
        for key, pos in other.positions.items():
            mine = self.positions.get(key)
            if mine is None:
                mine = self.positions[key] = {"fen": pos["fen"], "moves": {}}
                added_pos += 1
            for uci, m in pos["moves"].items():
                cur = mine["moves"].get(uci)
                if cur is None:
                    mine["moves"][uci] = {**m, "weight": round(m["weight"] * weight_scale, 6)}
                    added_moves += 1
                else:
                    updated += 1
                    if prefer == "sum":
                        cur["weight"] = round(cur["weight"] + m["weight"] * weight_scale, 6)
                    elif prefer == "max":
                        cur["weight"] = max(cur["weight"], m["weight"] * weight_scale)
                    elif prefer == "theirs":
                        cur["weight"] = round(m["weight"] * weight_scale, 6)
                    for k in ("games", "w", "d", "l"):
                        cur[k] += m.get(k, 0)
                    if m.get("comment") and m["comment"] not in cur.get("comment", ""):
                        cur["comment"] = (cur.get("comment", "") + " " + m["comment"]).strip()
                    if cur.get("eval") is None and m.get("eval") is not None:
                        cur["eval"] = m["eval"]
        return {"positions_added": added_pos, "moves_added": added_moves, "moves_updated": updated}

    def filtered(self, *, max_ply: int | None = None, min_weight: float = 0.0, min_games: int = 0,
                 statuses: list[str] | None = None, color: str | None = None, top_n: int | None = None) -> "Book":
        """New book containing only matching moves that stay reachable from the root.
        `color` keeps all opponent replies but only matching moves for that side."""
        out = Book({"root_fen": self.root_fen, "positions": {}})
        root = chess.Board(self.root_fen)
        seen = {pos_key(root)}
        queue: deque[tuple[chess.Board, int]] = deque([(root, 0)])
        while queue:
            board, ply = queue.popleft()
            if max_ply is not None and ply >= max_ply:
                continue
            node = self.positions.get(pos_key(board))
            if not node:
                continue
            mine = color is None or (board.turn == chess.WHITE) == (color == "white")
            items = sorted(node["moves"].items(), key=lambda kv: -kv[1]["weight"])
            kept = 0
            for uci, m in items:
                if mine:
                    if m["weight"] < min_weight or m["games"] < min_games or (statuses and m["status"] not in statuses):
                        continue
                    if top_n is not None and kept >= top_n:
                        continue
                mv = chess.Move.from_uci(uci)
                if mv not in board.legal_moves:
                    continue
                kept += 1
                out.node(board, create=True)["moves"][uci] = dict(m)   # type: ignore[index]
                b = board.copy(stack=False)
                b.push(mv)
                k = pos_key(b)
                if k not in seen:
                    seen.add(k)
                    queue.append((b, ply + 1))
        return out

    def subtree(self, board: chess.Board) -> "Book":
        """Split: the part of the book below `board`, re-rooted there."""
        out = Book({"root_fen": board.fen(), "positions": {}})
        seen = {pos_key(board)}
        queue = deque([board.copy(stack=False)])
        while queue:
            b = queue.popleft()
            node = self.positions.get(pos_key(b))
            if not node:
                continue
            out.positions[pos_key(b)] = {"fen": b.fen(), "moves": {u: dict(m) for u, m in node["moves"].items()}}
            for uci in node["moves"]:
                mv = chess.Move.from_uci(uci)
                if mv in b.legal_moves:
                    c = b.copy(stack=False)
                    c.push(mv)
                    if pos_key(c) not in seen:
                        seen.add(pos_key(c))
                        queue.append(c)
        return out

    def dedupe(self) -> dict[str, int]:
        """Drop illegal/zero-weight entries and normalise SAN; transposed duplicates are already merged by design."""
        removed, fixed = 0, 0
        for key, pos in list(self.positions.items()):
            try:
                board = chess.Board(pos["fen"])
            except ValueError:
                del self.positions[key]
                continue
            for uci in list(pos["moves"]):
                try:
                    mv = chess.Move.from_uci(uci)
                except ValueError:
                    mv = None
                if mv is None or mv not in board.legal_moves or pos["moves"][uci]["weight"] <= 0:
                    del pos["moves"][uci]
                    removed += 1
                    continue
                san = board.san(mv)
                if pos["moves"][uci]["san"] != san:
                    pos["moves"][uci]["san"] = san
                    fixed += 1
        self.prune_empty()
        return {"removed": removed, "san_fixed": fixed}

    def reweight(self, mode: str = "evidence", profile: str = "main", prior_games: int = 20) -> dict[str, Any]:
        """Recompute weights from the evidence stored on each move.

        evidence  — shrunken performance × evaluation × research confidence (never raw win rate)
        frequency — games played
        eval      — engine evaluation only
        uniform   — every listed move equal
        """
        changed = 0
        for pos in self.positions.values():
            for m in pos["moves"].values():
                old = m["weight"]
                if m["status"] == "rejected":
                    new = 0.0
                elif mode == "uniform":
                    new = 1.0
                elif mode == "frequency":
                    new = float(max(1, m["games"]))
                else:
                    ev = Score.from_dict(m["eval"]).expected() if m.get("eval") else 0.5
                    perf = (m["w"] + 0.5 * m["d"] + 0.5 * prior_games) / (m["games"] + prior_games)
                    conf = m["confidence"] if m.get("confidence") is not None else 0.5
                    if mode == "eval":
                        new = ev
                    else:
                        new = (0.55 * ev + 0.45 * perf) * (0.6 + 0.8 * conf)
                        if profile == "surprise":
                            new *= 1.0 / (1.0 + m["games"] / 25.0) + 0.25
                        elif profile == "solid":
                            new *= 0.5 + min(1.0, ev * 1.6) * 0.5
                        elif profile == "aggressive":
                            new *= 1.0 + 0.4 * float(m.get("tactical", 0.0))
                        elif profile in ("exploration", "tournament_research"):
                            new *= 1.0 + float(m.get("priority", 0.0))
                    if m["status"] == "approved":
                        new *= 1.25
                    elif m["status"] in ("candidate", "exploration") and profile == "main":
                        new *= 0.4
                new = round(max(0.0, new), 6)
                if abs(new - old) > 1e-9:
                    m["weight"] = new
                    changed += 1
        return {"changed": changed, "mode": mode, "profile": profile,
                "note": "Weights blend evaluation, Bayesian-shrunk results and research confidence; a high win rate "
                        "from few games cannot dominate."}

    def sample_lines(self, plies: int, count: int, seed: int = 0, start: chess.Board | None = None) -> list[dict[str, Any]]:
        """Weighted random walks from the root — opening suites for tournaments."""
        rng = random.Random(seed)
        out, seen = [], set()
        for _ in range(count * 6):
            if len(out) >= count:
                break
            board = (start or chess.Board(self.root_fen)).copy(stack=False)
            line, sans = [], []
            for _p in range(plies):
                node = self.positions.get(pos_key(board))
                if not node or not node["moves"]:
                    break
                opts = [(u, m) for u, m in node["moves"].items() if m["weight"] > 0 and m["status"] != "rejected"
                        and chess.Move.from_uci(u) in board.legal_moves]
                if not opts:
                    break
                u, m = rng.choices(opts, weights=[m["weight"] for _, m in opts], k=1)[0]
                sans.append(m["san"])
                line.append(u)
                board.push(chess.Move.from_uci(u))
            key = " ".join(line)
            if line and key not in seen:
                seen.add(key)
                out.append({"name": " ".join(sans[:8]) + ("…" if len(sans) > 8 else ""), "moves": line, "fen": None
                            if self.root_fen == START_FEN else self.root_fen})
        return out

    def lines(self, max_ply: int = 40, limit: int = 2000, color: str | None = None) -> list[list[str]]:
        """All root-to-leaf SAN lines (depth-first, cycle-safe) — used by trainers and PGN export."""
        out: list[list[str]] = []
        root = chess.Board(self.root_fen)

        def dfs(board: chess.Board, path: list[str], seen: frozenset[str]) -> None:
            if len(out) >= limit:
                return
            node = self.positions.get(pos_key(board))
            opts = []
            if node and len(path) < max_ply:
                for u, m in sorted(node["moves"].items(), key=lambda kv: -kv[1]["weight"]):
                    mv = chess.Move.from_uci(u)
                    if mv in board.legal_moves and m["status"] != "rejected":
                        opts.append((mv, m))
            if not opts:
                if path:
                    out.append(path)
                return
            for mv, m in opts:
                b = board.copy(stack=False)
                b.push(mv)
                k = pos_key(b)
                if k in seen:
                    out.append(path + [m["san"]])
                    continue
                dfs(b, path + [m["san"]], seen | {k})

        dfs(root, [], frozenset({pos_key(root)}))
        return out


# ---------------------------------------------------------------------------
# Diff
# ---------------------------------------------------------------------------
def diff_books(old: Book, new: Book, sample: int = 40) -> dict[str, Any]:
    added, removed, changed = [], [], []
    for key, pos in new.positions.items():
        o = old.positions.get(key, {"moves": {}})
        for uci, m in pos["moves"].items():
            if uci not in o["moves"]:
                added.append({"fen": pos["fen"], "uci": uci, "san": m["san"], "weight": m["weight"], "status": m["status"]})
            else:
                om = o["moves"][uci]
                if abs(om["weight"] - m["weight"]) > 1e-9 or om["status"] != m["status"]:
                    changed.append({"fen": pos["fen"], "uci": uci, "san": m["san"], "old_weight": om["weight"],
                                    "new_weight": m["weight"], "old_status": om["status"], "new_status": m["status"]})
    for key, pos in old.positions.items():
        n = new.positions.get(key, {"moves": {}})
        for uci, m in pos["moves"].items():
            if uci not in n["moves"]:
                removed.append({"fen": pos["fen"], "uci": uci, "san": m["san"], "weight": m["weight"]})
    return {"added": len(added), "removed": len(removed), "changed": len(changed),
            "added_sample": added[:sample], "removed_sample": removed[:sample], "changed_sample": changed[:sample]}


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------
def import_pgn(text: str, book: Book | None = None, *, max_ply: int = 60, variation_weight: float = 0.5,
               max_games: int | None = None) -> tuple[Book, dict[str, Any]]:
    book = book or Book()
    games = read_games(text, max_games)
    n_moves, skipped = 0, 0
    for game in games:
        result = game.headers.get("Result")
        root = game.board()
        if pos_key(root) != pos_key(chess.Board(book.root_fen)) and not book.positions:
            book.root_fen = root.fen()
        stack: list[tuple[chess.pgn.GameNode, chess.Board, int, float]] = [(game, root, 0, 1.0)]
        while stack:
            node, board, ply, w = stack.pop()
            if ply >= max_ply:
                continue
            for i, child in enumerate(node.variations):
                mv = child.move
                if mv is None or mv not in board.legal_moves:
                    skipped += 1
                    continue
                cw = w if i == 0 else w * variation_weight
                status = "main" if i == 0 and w == 1.0 else "side"
                existing = book.node(board)
                keep_status = existing["moves"][mv.uci()]["status"] if existing and mv.uci() in existing["moves"] else None
                book.add_move(board, mv, weight=cw, result=result if (i == 0 and w == 1.0) else None, source="pgn",
                              status="main" if keep_status == "main" else status, comment=(child.comment or "").strip()[:400])
                n_moves += 1
                b = board.copy(stack=False)
                b.push(mv)
                stack.append((child, b, ply + 1, cw))
    return book, {"games": len(games), "moves_read": n_moves, "skipped_illegal": skipped, **book.stats()}


def import_epd(text: str, book: Book | None = None) -> tuple[Book, dict[str, Any]]:
    """EPD records and plain FEN lists.  `bm` operations become book moves; `c0` becomes a comment."""
    book = book or Book()
    count, with_moves, bad = 0, 0, 0
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            board = chess.Board()
            parts = line.split()
            ops: dict[str, Any] = {}
            if len(parts) >= 6 and parts[4].isdigit() and parts[5].rstrip(";").isdigit():
                board = chess.Board(" ".join(parts[:6]).rstrip(";"))
            else:
                ops = board.set_epd(line)
        except ValueError:
            bad += 1
            continue
        count += 1
        book.node(board, create=True)
        for mv in ops.get("bm", []) or []:
            if mv in board.legal_moves:
                book.add_move(board, mv, weight=1.0, source="epd", comment=str(ops.get("c0", "") or ""))
                with_moves += 1
    return book, {"records": count, "moves_added": with_moves, "unparseable": bad, **book.stats()}


def import_polyglot(data: bytes, book: Book | None = None, *, max_ply: int = 40, max_positions: int = 200_000,
                    root_fen: str = START_FEN) -> tuple[Book, dict[str, Any]]:
    """Polyglot stores only Zobrist keys, so positions are recovered by walking from the root.
    Entries not reachable from `root_fen` within `max_ply` cannot be attributed to a position."""
    if len(data) % 16 != 0 or not data:
        raise BookError("Not a Polyglot book: file size must be a non-zero multiple of 16 bytes")
    book = book or Book({"root_fen": root_fen, "positions": {}})
    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    used = 0
    try:
        with chess.polyglot.open_reader(path) as reader:
            total = len(reader)
            root = chess.Board(root_fen)
            seen = {pos_key(root)}
            queue: deque[tuple[chess.Board, int]] = deque([(root, 0)])
            while queue and len(seen) < max_positions:
                board, ply = queue.popleft()
                if ply >= max_ply:
                    continue
                for entry in reader.find_all(board):
                    mv = entry.move
                    if mv not in board.legal_moves:
                        continue
                    used += 1
                    book.add_move(board, mv, weight=float(max(1, entry.weight)), source="polyglot", accumulate=False,
                                  learn=entry.learn)
                    b = board.copy(stack=False)
                    b.push(mv)
                    k = pos_key(b)
                    if k not in seen:
                        seen.add(k)
                        queue.append((b, ply + 1))
    finally:
        Path(path).unlink(missing_ok=True)
    return book, {"entries_in_file": total, "entries_imported": used, "entries_unreachable": max(0, total - used),
                  "note": "Polyglot entries are keyed by hash only; entries not reachable from the root within the ply limit were not imported.",
                  **book.stats()}


def import_json(text: str) -> tuple[Book, dict[str, Any]]:
    try:
        data = json.loads(text)
    except ValueError as e:
        raise BookError(f"Invalid JSON: {e}")
    if data.get("format") != "opening-magician-book":
        raise BookError("JSON is not an Opening Magician book (missing format marker)")
    book = Book(data)
    fixed = book.dedupe()
    return book, {**fixed, **book.stats()}


def import_csv(text: str, book: Book | None = None) -> tuple[Book, dict[str, Any]]:
    """CSV schema (header required): fen,move[,weight,games,wins,draws,losses,eval_cp,status,comment].
    `move` is UCI or SAN; wins/draws/losses are from the mover's point of view."""
    book = book or Book()
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "fen" not in reader.fieldnames or "move" not in reader.fieldnames:
        raise BookError("CSV must have a header with at least 'fen' and 'move' columns. Schema: " + ",".join(CSV_FIELDS))
    rows, bad = 0, 0
    for row in reader:
        try:
            board = chess.Board(row["fen"])
            mv_text = row["move"].strip()
            try:
                mv = chess.Move.from_uci(mv_text)
                if mv not in board.legal_moves:
                    raise ValueError
            except ValueError:
                mv = board.parse_san(mv_text)
            m = book.add_move(board, mv, weight=float(row.get("weight") or 1), source="csv", accumulate=False,
                              status=(row.get("status") or "main") if (row.get("status") or "main") in STATUSES else "main",
                              comment=row.get("comment") or "")
            m["games"] = int(float(row.get("games") or 0))
            m["w"], m["d"], m["l"] = (int(float(row.get(k) or 0)) for k in ("wins", "draws", "losses"))
            if row.get("eval_cp") not in (None, ""):
                m["eval"] = {"cp": int(float(row["eval_cp"])), "mate": None}
            rows += 1
        except (ValueError, KeyError):
            bad += 1
    return book, {"rows": rows, "rejected_rows": bad, **book.stats()}


def import_any(filename: str, data: bytes, **kw: Any) -> tuple[Book, dict[str, Any], str]:
    ext = Path(filename).suffix.lower()
    if ext in UNSUPPORTED:
        raise BookError(f"{ext} is not supported directly. {UNSUPPORTED[ext]}")
    if ext == ".bin":
        b, s = import_polyglot(data, **{k: v for k, v in kw.items() if k in ("max_ply", "max_positions", "root_fen")})
        return b, s, "polyglot"
    text = data.decode("utf-8-sig", errors="replace")
    if ext == ".json":
        b, s = import_json(text)
        return b, s, "json"
    if ext == ".csv":
        b, s = import_csv(text)
        return b, s, "csv"
    if ext in (".epd", ".fen", ".txt"):
        b, s = import_epd(text)
        return b, s, "epd"
    if ext == ".pgn" or "[Event" in text[:2000] or "1." in text[:400]:
        b, s = import_pgn(text, **{k: v for k, v in kw.items() if k in ("max_ply", "variation_weight", "max_games")})
        return b, s, "pgn"
    raise BookError(f"Unrecognised book format '{ext}'. Supported: .pgn, .bin (Polyglot), .epd/.fen, .json, .csv")


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
def polyglot_move(board: chess.Board, move: chess.Move) -> int:
    to_sq = move.to_square
    if board.is_castling(move):      # Polyglot encodes castling as "king takes own rook"
        rank = chess.square_rank(move.from_square)
        to_sq = chess.square(7 if chess.square_file(move.to_square) > chess.square_file(move.from_square) else 0, rank)
    promo = {None: 0, chess.KNIGHT: 1, chess.BISHOP: 2, chess.ROOK: 3, chess.QUEEN: 4}[move.promotion]
    return (promo << 12) | (chess.square_rank(move.from_square) << 9) | (chess.square_file(move.from_square) << 6) | \
        (chess.square_rank(to_sq) << 3) | chess.square_file(to_sq)


def export_polyglot(book: Book) -> bytes:
    entries: list[tuple[int, int, int, int]] = []
    for pos in book.positions.values():
        if not pos["moves"]:
            continue
        board = chess.Board(pos["fen"])
        key = chess.polyglot.zobrist_hash(board)
        live = [(u, m) for u, m in pos["moves"].items() if m["weight"] > 0 and m["status"] != "rejected"]
        if not live:
            continue
        top = max(m["weight"] for _, m in live)
        for uci, m in live:
            mv = chess.Move.from_uci(uci)
            if mv not in board.legal_moves:
                continue
            w = max(1, min(65535, int(round(m["weight"] / top * 10000))))
            entries.append((key, polyglot_move(board, mv), w, int(m.get("learn", 0)) & 0xFFFFFFFF))
    entries.sort(key=lambda e: (e[0], -e[2]))
    return b"".join(struct.pack(">QHHI", *e) for e in entries)


def export_pgn(book: Book, *, max_ply: int = 40, title: str = "Opening book") -> str:
    """One game whose variations are the book tree (transposed sub-trees are written once)."""
    game = chess.pgn.Game()
    root = chess.Board(book.root_fen)
    if book.root_fen != START_FEN:
        game.setup(root)
    game.headers["Event"] = title
    game.headers["Site"] = "Opening Magician"
    game.headers["Result"] = "*"
    seen = {pos_key(root)}

    def build(node: chess.pgn.GameNode, board: chess.Board, ply: int) -> None:
        if ply >= max_ply:
            return
        pos = book.positions.get(pos_key(board))
        if not pos:
            return
        for uci, m in sorted(pos["moves"].items(), key=lambda kv: -kv[1]["weight"]):
            mv = chess.Move.from_uci(uci)
            if mv not in board.legal_moves or m["status"] == "rejected":
                continue
            child = node.add_variation(mv)
            bits = []
            if m.get("comment"):
                bits.append(m["comment"])
            if m["status"] not in ("main", "side"):
                bits.append(f"[{m['status']}]")
            if m["games"]:
                bits.append(f"+{m['w']} ={m['d']} -{m['l']}")
            child.comment = " ".join(bits)
            b = board.copy(stack=False)
            b.push(mv)
            k = pos_key(b)
            if k in seen:
                child.comment = (child.comment + " (transposes)").strip()
                continue
            seen.add(k)
            build(child, b, ply + 1)

    build(game, root, 0)
    return game.accept(chess.pgn.StringExporter(headers=True, variations=True, comments=True, columns=88))


def export_csv(book: Book) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(CSV_FIELDS)
    for pos in book.positions.values():
        for uci, m in pos["moves"].items():
            ev = m.get("eval") or {}
            w.writerow([pos["fen"], uci, m["weight"], m["games"], m["w"], m["d"], m["l"],
                        ev.get("cp") if ev.get("cp") is not None else "", m["status"], m.get("comment", "")])
    return out.getvalue()


def export_epd(book: Book) -> str:
    lines = []
    for pos in book.positions.values():
        if not pos["moves"]:
            continue
        board = chess.Board(pos["fen"])
        best = sorted(pos["moves"].items(), key=lambda kv: -kv[1]["weight"])
        moves = [chess.Move.from_uci(u) for u, m in best[:3] if m["status"] != "rejected" and chess.Move.from_uci(u) in board.legal_moves]
        if moves:
            lines.append(board.epd(bm=moves))
    return "\n".join(lines) + "\n"


def export_json(book: Book) -> str:
    return json.dumps(book.to_dict(), separators=(",", ":"))

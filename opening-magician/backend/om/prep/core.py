"""Grandmaster preparation tools that need no engine: game collections, opponent dossiers, your own
leaks, repertoire coverage, move-order search, structures, goal repertoires, events and endgames.

Everything here is computed from games and books already in the project database.  Engine-backed
checks live in `engine.py`; optional online imports in `online.py`.
"""
from __future__ import annotations

import random
from collections import Counter, defaultdict
from typing import Any

import chess

from .. import openings
from ..books.model import Book
from ..books.store import BookStore
from ..chessx import Score, game_to_pgn, pos_key, read_games
from ..db import Database, new_id, now
from ..learn.training import Trainer
from .structures import ENDGAMES, STRUCTURES, classify_structure, endgame_type

DAY = 86400.0


class PrepError(ValueError):
    pass


def _score(m: dict[str, Any]) -> float | None:
    return (m["w"] + 0.5 * m["d"]) / m["games"] if m["games"] else None


def _shrunk(m: dict[str, Any], prior: int = 4) -> float:
    """Result score pulled toward 50% so a couple of games cannot look like a pattern."""
    return (m["w"] + 0.5 * m["d"] + 0.5 * prior) / (m["games"] + prior)


def _moves(book: Book, board: chess.Board) -> list[dict[str, Any]]:
    """Moves at a node with shares by *games played* (falling back to weight)."""
    node = book.positions.get(pos_key(board))
    if not node:
        return []
    out = []
    for uci, m in node["moves"].items():
        mv = chess.Move.from_uci(uci)
        if mv in board.legal_moves and m["status"] != "rejected":
            out.append({"uci": uci, **m})
    by_games = sum(m["games"] for m in out)
    total = by_games or sum(max(0.0, m["weight"]) for m in out) or 1.0
    for m in out:
        m["share"] = (m["games"] if by_games else max(0.0, m["weight"])) / total
    out.sort(key=lambda m: -m["share"])
    return out


class Prep:
    def __init__(self, db: Database, books: BookStore, trainer: Trainer):
        self.db, self.books, self.trainer = db, books, trainer
        self._game_class: dict[str, dict[str, Any]] = {}

    # ================================================================== collections (1, 2)
    def import_collection(self, name: str, pgn: str, *, player: str | None = None, kind: str = "opponent", source: str = "pgn",
                          max_ply: int = 30, max_games: int = 3000) -> dict[str, Any]:
        """Store a player's games and build their repertoire as two game books (as White / as Black)."""
        if kind not in ("opponent", "me", "reference"):
            raise PrepError("kind must be opponent, me or reference")
        games = read_games(pgn, max_games)
        if not games:
            raise PrepError("No games found in that PGN")
        names = Counter()
        for g in games:
            names[g.headers.get("White", "?")] += 1
            names[g.headers.get("Black", "?")] += 1
        if not player:
            player = names.most_common(1)[0][0]
        key = player.lower().strip()
        white_book, black_book = Book(), Book()
        cid = new_id("col")
        tally = {"white": [0, 0, 0], "black": [0, 0, 0]}
        dates = []
        stored = 0
        with self.db.tx():
            for g in games:
                h = g.headers
                if g.board().fen() != chess.STARTING_FEN:
                    continue
                side = "white" if h.get("White", "").lower().strip() == key else "black" if h.get("Black", "").lower().strip() == key else None
                if side is None and kind != "reference":
                    continue
                result = h.get("Result", "*")
                moves = list(g.mainline_moves())
                if len(moves) < 2:
                    continue
                target = white_book if side in ("white", None) else black_book
                board = chess.Board()
                for mv in moves[:max_ply]:
                    if mv not in board.legal_moves:
                        break
                    target.add_move(board, mv, weight=1.0, result=result, source="games")
                    board.push(mv)
                if side and result in ("1-0", "0-1", "1/2-1/2"):
                    win = (result == "1-0") == (side == "white")
                    tally[side][0 if result != "1/2-1/2" and win else 1 if result == "1/2-1/2" else 2] += 1
                if h.get("Date", "?")[:4].isdigit():
                    dates.append(h["Date"])
                end = g.end().board()
                op = openings.identify_moves([m.uci() for m in moves[:24]])
                self.db.insert("games", {"id": new_id("game"), "kind": "import", "white": h.get("White"), "black": h.get("Black"),
                                         "result": result, "termination": h.get("Termination", ""), "pgn": game_to_pgn(g),
                                         "start_fen": chess.STARTING_FEN, "opening": op["name"] if op else h.get("Opening"),
                                         "eco": op["eco"] if op else h.get("ECO"), "plies": len(end.move_stack), "tournament_id": None,
                                         "experiment_id": None, "meta": {"collection_id": cid, "player_color": side},
                                         "created_at": now(), "finished_at": now()})
                stored += 1
            if not stored:
                raise PrepError(f"No games by '{player}' were found. Players in this file: " + ", ".join(n for n, _ in names.most_common(6)))
            profile = "opponent" if kind == "opponent" else "games"
            wb = self.books.create(f"{player} — as White", white_book, source=f"games: {name}", profile=profile, target_color="white",
                                   summary=f"Built from {sum(tally['white'])} games")
            bb = self.books.create(f"{player} — as Black", black_book, source=f"games: {name}", profile=profile, target_color="black",
                                   summary=f"Built from {sum(tally['black'])} games")
            stats = {"games": stored, "white": dict(zip(("wins", "draws", "losses"), tally["white"])),
                     "black": dict(zip(("wins", "draws", "losses"), tally["black"])),
                     "from": min(dates) if dates else None, "to": max(dates) if dates else None, "max_ply": max_ply}
            self.db.insert("collections", {"id": cid, "name": name or player, "player": player, "kind": kind, "source": source,
                                           "stats": stats, "white_book_id": wb["id"], "black_book_id": bb["id"], "created_at": now()})
        return self.collection(cid)

    def collections(self) -> list[dict[str, Any]]:
        return self.db.all("collections", order="created_at DESC")

    def collection(self, cid: str) -> dict[str, Any]:
        c = self.db.get("collections", cid)
        if not c:
            raise PrepError("Unknown game collection")
        return c

    def delete_collection(self, cid: str) -> None:
        c = self.collection(cid)
        with self.db.tx():
            self.db.execute("DELETE FROM games WHERE json_extract(meta,'$.collection_id')=?", (cid,))
            for b in (c["white_book_id"], c["black_book_id"]):
                if b:
                    self.books.delete(b)
            self.db.delete("collections", cid)

    def _games(self, cid: str) -> list[dict[str, Any]]:
        return self.db.all("games", "json_extract(meta,'$.collection_id')=?", (cid,), order="created_at")

    # ================================================================== 1 · opponent dossier
    def dossier(self, cid: str, ref_book_id: str | None = None, min_games: int = 3) -> dict[str, Any]:
        c = self.collection(cid)
        ref = self.books.head(ref_book_id) if ref_book_id else openings.reference_book()
        out: dict[str, Any] = {"collection": c, "player": c["player"], "sides": {}}
        for side, bid in (("white", c["white_book_id"]), ("black", c["black_book_id"])):
            book = self.books.head(bid)
            mine = side == "white"
            first, habits, weak, struggles, novelties = [], [], [], [], Counter()
            root = chess.Board()
            if mine:
                first = [{"san": m["san"], "games": m["games"], "share": round(m["share"], 3), "score": _score(m)} for m in _moves(book, root)[:5]]
            else:
                for wm in _moves(book, root)[:4]:
                    b = root.copy(stack=False)
                    b.push_uci(wm["uci"])
                    first.append({"against": wm["san"], "games": wm["games"],
                                  "replies": [{"san": m["san"], "games": m["games"], "share": round(m["share"], 3), "score": _score(m)} for m in _moves(book, b)[:3]]})
            for board, ply in book.walk(24):
                ms = _moves(book, board)
                total = sum(m["games"] for m in ms)
                if total < min_games:
                    continue
                players_turn = (board.turn == chess.WHITE) == mine
                line = self._line_to(book, board)
                known = ref.positions.get(pos_key(board), {}).get("moves", {})
                for m in ms:
                    if m["games"] < min_games:
                        continue
                    sc = _score(m) or 0.0
                    item = {"fen": board.fen(), "line": line, "san": m["san"], "uci": m["uci"], "games": m["games"],
                            "score": round(sc, 3), "share": round(m["share"], 3), "ply": ply}
                    if players_turn:
                        if m["share"] >= 0.8 and total >= 4:
                            habits.append(item)
                        if _shrunk(m) <= 0.40:
                            weak.append({**item, "why": f"scores {m['w']}–{m['d']}–{m['l']} with it"})
                        if known and m["uci"] not in known:
                            novelties[(line, m["san"], board.fen(), m["uci"])] += m["games"]
                    elif _shrunk(m) >= 0.60:      # the opponent's opponents do well with this move
                        struggles.append({**item, "why": f"opponents score {m['w']}–{m['d']}–{m['l']} against them here"})
            out["sides"][side] = {
                "book_id": bid, "games": sum(c["stats"][side].values()), "record": c["stats"][side], "first_moves": first,
                "main_lines": self._main_lines(book, mine), "habits": sorted(habits, key=lambda x: (-x["games"], x["ply"]))[:12],
                "weak_moves": sorted(weak, key=lambda x: (x["score"], -x["games"]))[:10],
                "struggles_against": sorted(struggles, key=lambda x: (-x["score"], -x["games"]))[:10],
                "leaves_theory": [{"line": k[0], "san": k[1], "fen": k[2], "uci": k[3], "games": n} for k, n in novelties.most_common(8)],
            }
        out["engine_flags"] = c["stats"].get("engine_flags", [])
        out["note"] = ("Patterns need at least %d games; scores are from the player's point of view. 'Leaves theory' means a move "
                       "absent from the reference book, not a novelty in chess theory." % min_games)
        return out

    def _line_to(self, book: Book, target: chess.Board) -> str:
        """Shortest SAN path from the root to `target` inside the book."""
        key = pos_key(target)
        root = chess.Board(book.root_fen)
        queue: list[tuple[chess.Board, list[str]]] = [(root, [])]
        seen = {pos_key(root)}
        while queue:
            board, path = queue.pop(0)
            if pos_key(board) == key:
                return _numbered(path)
            if len(path) >= 26:
                continue
            for m in _moves(book, board):
                b = board.copy(stack=False)
                b.push_uci(m["uci"])
                k = pos_key(b)
                if k not in seen:
                    seen.add(k)
                    queue.append((b, path + [m["san"]]))
        return ""

    def _main_lines(self, book: Book, mine_white: bool, limit: int = 6) -> list[dict[str, Any]]:
        out = []

        def walk(board: chess.Board, path: list[str], games: int) -> None:
            ms = _moves(book, board)
            if not ms or len(path) >= 16 or ms[0]["games"] < 2:
                if len(path) >= 4:
                    out.append({"line": _numbered(path), "games": games, "opening": (openings.identify_moves(path) or {}).get("name")})
                return
            players_turn = (board.turn == chess.WHITE) == mine_white
            for m in ms[:1 if players_turn else 2]:
                if m["games"] < 2 and path:
                    continue
                b = board.copy(stack=False)
                b.push_uci(m["uci"])
                walk(b, path + [m["san"]], m["games"])

        walk(chess.Board(), [], 0)
        out.sort(key=lambda x: -x["games"])
        return out[:limit]

    def prep_sheet(self, cid: str, my_color: str, my_book_id: str | None = None, depth: int = 16) -> dict[str, Any]:
        """A one-page plan for a game against this player: follow what they usually do, answer from your
        repertoire, and aim at the moves where their own results are worst."""
        c = self.collection(cid)
        their_side = "black" if my_color == "white" else "white"
        theirs = self.books.head(c[f"{their_side}_book_id"])
        mine = self.books.head(my_book_id) if my_book_id else None
        flags = {(f["fen"], f["uci"]): f for f in c["stats"].get("engine_flags", [])}
        steps: list[dict[str, Any]] = []
        targets: list[str] = []
        board = chess.Board()
        while len(steps) < depth:
            ms = _moves(theirs, board)
            my_turn = (board.turn == chess.WHITE) == (my_color == "white")
            if my_turn:
                pick, why = None, ""
                rep = _moves(mine, board) if mine else []
                if rep:
                    seen = {m["uci"]: m for m in ms}
                    pick = rep[0]
                    hit = seen.get(pick["uci"])
                    why = "your repertoire move" + (f"; they score {round(100 * (1 - (_score(hit) or .5)))}% against it in {hit['games']} game(s)" if hit and hit["games"] else "; they have not faced it in these games")
                elif ms:
                    tested = [m for m in ms if m["games"] >= 2]
                    if tested:
                        pick = max(tested, key=lambda m: _shrunk(m))
                        why = f"scored {pick['w']}–{pick['d']}–{pick['l']} against them in {pick['games']} games (no repertoire move stored here)"
                if not pick:
                    break
                steps.append({"ply": len(steps) + 1, "who": "you", "san": pick["san"], "uci": pick["uci"], "fen": board.fen(), "why": why})
                board.push_uci(pick["uci"])
            else:
                if not ms:
                    steps.append({"ply": len(steps) + 1, "who": "them", "san": None, "fen": board.fen(),
                                  "why": "They have never reached this position in these games — from here you are both on your own."})
                    break
                top = ms[0]
                f = flags.get((board.fen(), top["uci"]))
                note = f"plays this in {top['games']} of {sum(m['games'] for m in ms)} games ({round(top['share'] * 100)}%)"
                if len(ms) > 1 and ms[1]["share"] >= 0.25:
                    note += f"; otherwise {ms[1]['san']} ({round(ms[1]['share'] * 100)}%)"
                if top["games"] >= 3 and _shrunk(top) <= 0.40:
                    note += f" — and scores badly with it ({top['w']}–{top['d']}–{top['l']})"
                    targets.append(f"{_numbered_from(board, top['san'])}: their results are poor ({top['w']}–{top['d']}–{top['l']}).")
                if f:
                    note += f" — the engine dislikes it (loses {round(f['expected_loss'] * 100)} points; better {f['best_san']})"
                    targets.append(f"{_numbered_from(board, top['san'])}: engine prefers {f['best_san']}.")
                steps.append({"ply": len(steps) + 1, "who": "them", "san": top["san"], "uci": top["uci"], "fen": board.fen(), "why": note,
                              "share": round(top["share"], 3), "alternatives": [{"san": m["san"], "share": round(m["share"], 3)} for m in ms[1:4]]})
                board.push_uci(top["uci"])
        sans = [s["san"] for s in steps if s["san"]]
        op = openings.identify(board)
        return {"player": c["player"], "you_play": my_color, "steps": steps, "line": _numbered(sans), "uci": [s["uci"] for s in steps if s.get("uci")],
                "final_fen": board.fen(), "opening": op["name"] if op else None, "targets": targets[:6],
                "summary": f"Against {c['player']} as {my_color.title()}: expect {_numbered(sans[:10])}"
                           + (f" ({op['name']})" if op else "") + (". Aim at: " + " ".join(targets[:3]) if targets else
                                                                    ". No clear weak point shows in these games — play your main repertoire."),
                "used_repertoire": bool(mine), "based_on_games": c["stats"]["games"]}

    # ================================================================== 2 · your own leaks
    def leaks(self, cid: str, book_id: str) -> dict[str, Any]:
        """Where you left your repertoire in your own games, how often, and what happened."""
        c = self.collection(cid)
        book = self.books.head(book_id)
        leak: dict[tuple[str, str], dict[str, Any]] = {}
        surprise: dict[tuple[str, str], dict[str, Any]] = {}
        depth, followed = [], 0
        for g in self._games(cid):
            side = g["meta"].get("player_color")
            if side not in ("white", "black"):
                continue
            parsed = read_games(g["pgn"], 1)
            if not parsed:
                continue
            pts = {"1-0": 1.0, "0-1": 0.0, "1/2-1/2": 0.5}.get(g["result"])
            if pts is not None and side == "black":
                pts = 1 - pts
            board = chess.Board()
            sans: list[str] = []
            ply = 0
            for mv in parsed[0].mainline_moves():
                node = book.positions.get(pos_key(board))
                known = {u: m for u, m in (node or {}).get("moves", {}).items() if m["status"] != "rejected"}
                my_turn = (board.turn == chess.WHITE) == (side == "white")
                if not known:
                    break                                    # the book simply ends here
                san = board.san(mv)
                if mv.uci() not in known:
                    best_u, best_m = max(known.items(), key=lambda kv: kv[1]["weight"])
                    store = leak if my_turn else surprise
                    rec = store.setdefault((pos_key(board), mv.uci()), {
                        "fen": board.fen(), "line": _numbered(sans), "played": san, "played_uci": mv.uci(), "expected": best_m["san"],
                        "expected_uci": best_u, "count": 0, "points": 0.0, "scored": 0, "ply": ply, "color": side,
                        "opening": (openings.identify(board) or {}).get("name")})
                    rec["count"] += 1
                    if pts is not None:
                        rec["points"] += pts
                        rec["scored"] += 1
                    break
                sans.append(san)
                board.push(mv)
                ply += 1
            depth.append(ply)
            followed += 1

        def finish(d: dict[tuple[str, str], dict[str, Any]]) -> list[dict[str, Any]]:
            rows = []
            for r in d.values():
                r["score"] = round(r["points"] / r["scored"], 3) if r["scored"] else None
                r["cost"] = round(r["count"] * (1 - (r["score"] if r["score"] is not None else 0.5)), 2)
                rows.append(r)
            return sorted(rows, key=lambda r: (-r["cost"], r["ply"]))

        costs = c["stats"].get("leak_costs", {})
        leaks = finish(leak)
        for r in leaks:
            r["engine"] = costs.get(f"{r['fen']}|{r['played_uci']}")
        return {"player": c["player"], "games": followed, "leaks": leaks, "surprises": finish(surprise),
                "avg_book_depth": round(sum(depth) / len(depth), 1) if depth else 0,
                "note": "A leak is the first move in a game where you left your own repertoire book. A surprise is an opponent "
                        "move your book has no entry for. Scores are your results in those games — small counts prove little."}

    def leaks_to_cards(self, cid: str, book_id: str, min_count: int = 1) -> dict[str, Any]:
        data = self.leaks(cid, book_id)
        deck = f"leaks:{cid}"
        added = 0
        with self.db.tx():
            for r in data["leaks"]:
                if r["count"] < min_count:
                    continue
                added += self.trainer._add_card(deck, chess.Board(r["fen"]), r["expected_uci"], r["expected"], r["color"], r["opening"],
                                                note=f"You played {r['played']} here in {r['count']} game(s).")
            self.trainer._deck_meta(deck, f"My leaks — {data['player']}", "both", {"collection_id": cid, "book_id": book_id})
        return {"deck": deck, "added": added, "leaks": len(data["leaks"])}

    # ================================================================== 4 · coverage audit
    def coverage(self, book_id: str, color: str, source_book_id: str | None = None, max_ply: int = 20, min_mass: float = 0.002) -> dict[str, Any]:
        """Walk your repertoire against what opponents actually play (weighted by frequency) and report
        the positions where you have no prepared reply, with the share of games that reach them."""
        mine = self.books.head(book_id)
        src = self.books.head(source_book_id) if source_book_id else openings.reference_book()
        holes: dict[str, dict[str, Any]] = {}
        stats = {"covered": 0.0, "hole": 0.0, "nodes": 0}
        families: set[str] = set()

        def walk(board: chess.Board, mass: float, path: list[str]) -> None:
            stats["nodes"] += 1
            if len(path) >= max_ply or mass < min_mass or stats["nodes"] > 40000:
                stats["covered"] += mass
                return
            my_turn = (board.turn == chess.WHITE) == (color == "white")
            if my_turn:
                rep = _moves(mine, board)
                if not rep:
                    if _moves(src, board):                       # theory goes on, but your book has nothing here
                        op = openings.identify(board)
                        h = holes.setdefault(pos_key(board), {"fen": board.fen(), "line": _numbered(path), "mass": 0.0, "ply": len(path),
                                                              "opening": op["name"] if op else None, "last": path[-1] if path else None,
                                                              "transposition": bool(op and op.get("transposed")),
                                                              "common_replies": [m["san"] for m in _moves(src, board)[:3]]})
                        h["mass"] += mass
                        stats["hole"] += mass
                    else:
                        stats["covered"] += mass
                    return
                op = openings.identify(board)
                if op:
                    families.add(op["name"].split(":")[0])
                b = board.copy(stack=False)
                b.push_uci(rep[0]["uci"])
                walk(b, mass, path + [rep[0]["san"]])
            else:
                ms = _moves(src, board)
                if not ms:
                    stats["covered"] += mass
                    return
                for m in ms:
                    b = board.copy(stack=False)
                    b.push_uci(m["uci"])
                    walk(b, mass * m["share"], path + [m["san"]])

        walk(chess.Board(mine.root_fen), 1.0, [])
        rows = sorted(holes.values(), key=lambda h: -h["mass"])
        for h in rows:
            h["mass"] = round(h["mass"], 4)
            fam = (h["opening"] or "").split(":")[0]
            h["outside_repertoire"] = bool(fam and fam not in families)
        total = stats["covered"] + stats["hole"] or 1.0
        return {"coverage": round(stats["covered"] / total, 4), "holes": rows[:60], "hole_count": len(rows),
                "families": sorted(families), "max_ply": max_ply,
                "note": "Frequencies come from the source book (games played, or weights when it has no game counts). "
                        "'Outside repertoire' marks holes that land in an opening family you do not otherwise play — "
                        "the typical result of a move-order transposition."}

    # ================================================================== 5 · move-order finder
    def move_orders(self, moves: list[str], start_fen: str | None = None, freq_book_id: str | None = None, me: str = "white",
                    limit: int = 12) -> dict[str, Any]:
        """All legal orderings of the same moves that reach the same position, ranked by how little
        room they leave the opponent (share of their known alternatives along the way)."""
        start = chess.Board(start_fen) if start_fen else chess.Board()
        board = start.copy()
        canon: list[chess.Move] = []
        from ..chessx import parse_move
        for t in clean_moves(moves):
            mv = parse_move(board, t)
            canon.append(mv)
            board.push(mv)
        if len(canon) < 4:
            raise PrepError("Give a line of at least four plies")
        if len(canon) > 20:
            raise PrepError("Lines longer than 20 plies have too many orderings — shorten the target line")
        target = pos_key(board)
        freq = self.books.head(freq_book_id) if freq_book_id else openings.reference_book()
        side0 = start.turn
        pools = {side0: [m.uci() for m in canon[0::2]], (not side0): [m.uci() for m in canon[1::2]]}
        orders: list[list[str]] = []
        seen_states: set[tuple[str, tuple[str, ...], tuple[str, ...]]] = set()
        budget = [60000]

        def dfs(b: chess.Board, rem: dict[bool, list[str]], path: list[str]) -> None:
            if budget[0] <= 0 or len(orders) >= 400:
                return
            budget[0] -= 1
            if not rem[True] and not rem[False]:
                if pos_key(b) == target:
                    orders.append(path)
                return
            state = (pos_key(b), tuple(sorted(rem[True])), tuple(sorted(rem[False])))
            if state in seen_states and len(path) > 2:
                pass                                              # same remaining work from the same position: still a distinct order
            seen_states.add(state)
            for u in sorted(set(rem[b.turn])):
                mv = chess.Move.from_uci(u)
                if mv not in b.legal_moves:
                    continue
                nb = b.copy(stack=False)
                nb.push(mv)
                nr = {True: list(rem[True]), False: list(rem[False])}
                nr[b.turn].remove(u)
                dfs(nb, nr, path + [u])

        dfs(start.copy(stack=False), pools, [])
        my_white = me == "white"

        def describe(order: list[str]) -> dict[str, Any]:
            b = start.copy(stack=False)
            keep, alts, out_of_book, sans = 1.0, {}, 0, []
            for u in order:
                opp_turn = (b.turn == chess.WHITE) != my_white
                if opp_turn:
                    ms = _moves(freq, b)
                    if ms:
                        hit = next((m for m in ms if m["uci"] == u), None)
                        keep *= hit["share"] if hit else 0.02
                        for m in ms:
                            if m["uci"] != u and m["share"] >= 0.05:
                                alts[m["san"]] = max(alts.get(m["san"], 0), round(m["share"], 3))
                    else:
                        out_of_book += 1
                sans.append(b.san(chess.Move.from_uci(u)))
                b.push_uci(u)
            return {"uci": order, "line": _numbered_from(start, sans), "stays_on_course": round(keep, 4), "opponent_alternatives": alts,
                    "alternative_mass": round(sum(alts.values()), 3), "opponent_out_of_book": out_of_book}

        canon_u = [m.uci() for m in canon]
        base = describe(canon_u)
        rows = []
        for o in orders:
            if o == canon_u:
                continue
            d = describe(o)
            d["dodges"] = sorted(set(base["opponent_alternatives"]) - set(d["opponent_alternatives"]))
            d["allows"] = sorted(set(d["opponent_alternatives"]) - set(base["opponent_alternatives"]))
            rows.append(d)
        rows.sort(key=lambda d: (-d["stays_on_course"], d["alternative_mass"]))
        return {"target_fen": board.fen(), "canonical": base, "orders": rows[:limit], "found": len(rows),
                "search_complete": budget[0] > 0 and len(orders) < 400, "opening": (openings.identify(board) or {}).get("name"),
                "note": "'Stays on course' is the chance, by the frequency book, that the opponent plays exactly the moves of this "
                        "order. 'Dodges' lists their usual sidelines that this order does not allow; 'allows' lists new ones it opens."}

    # ================================================================== 6 · structures and model games
    def structures(self, book_id: str, color: str, max_ply: int = 22) -> dict[str, Any]:
        book = self.books.head(book_id)
        groups: dict[str, dict[str, Any]] = {}
        for sans in book.lines(max_ply=max_ply, limit=600, color=color):
            b = chess.Board(book.root_fen)
            for s in sans:
                b.push_san(s)
            if len(sans) < 8:
                continue
            sid = classify_structure(b)
            g = groups.setdefault(sid, {"id": sid, **STRUCTURES[sid], "lines": [], "count": 0})
            g["count"] += 1
            if len(g["lines"]) < 5:
                g["lines"].append({"line": _numbered(sans), "fen": b.fen(), "opening": (openings.identify(b) or {}).get("name")})
        return {"structures": sorted(groups.values(), key=lambda g: -g["count"]), "all": {k: v["name"] for k, v in STRUCTURES.items()}}

    def _classify_game(self, g: dict[str, Any]) -> dict[str, Any]:
        hit = self._game_class.get(g["id"])
        if hit:
            return hit
        info: dict[str, Any] = {"structure": None, "structure_fen": None, "structure_ply": None, "endgame": None, "endgame_fen": None, "endgame_ply": None}
        parsed = read_games(g["pgn"], 1)
        if parsed:
            board = parsed[0].board()
            run, cand = 0, None
            for i, mv in enumerate(parsed[0].mainline_moves()):
                if mv not in board.legal_moves:
                    break
                board.push(mv)
                if i + 1 == 24:
                    info.update({"structure": classify_structure(board), "structure_fen": board.fen(), "structure_ply": 24})
                if info["endgame"] is None and i >= 20:
                    t = endgame_type(board)
                    if t:
                        if cand is None or cand[0] != t:          # a further trade changed the kind of endgame: start counting again
                            run, cand = 0, (t, board.fen(), i + 1)
                        run += 1
                        if run >= 6:                              # the same material balance lasted: a real endgame, not a passing trade
                            info.update({"endgame": cand[0], "endgame_fen": cand[1], "endgame_ply": cand[2]})
                    else:
                        run, cand = 0, None
        if len(self._game_class) > 20000:
            self._game_class.clear()
        self._game_class[g["id"]] = info
        return info

    def model_games(self, structure: str, limit: int = 12) -> list[dict[str, Any]]:
        """Decisive games from the project database whose position at move 12 shows this structure."""
        if structure not in STRUCTURES:
            raise PrepError("Unknown structure")
        out = []
        for g in self.db.all("games", "plies>=40 AND result IN ('1-0','0-1')", order="plies DESC", limit=4000,
                             cols="id,white,black,result,opening,plies,pgn,kind"):
            info = self._classify_game(g)
            if info["structure"] == structure:
                out.append({"id": g["id"], "white": g["white"], "black": g["black"], "result": g["result"], "opening": g["opening"],
                            "plies": g["plies"], "fen": info["structure_fen"], "ply": info["structure_ply"], "source": g["kind"]})
                if len(out) >= limit:
                    break
        return out

    def plan_task(self, structure: str | None = None, seed: int | None = None) -> dict[str, Any]:
        """'Which plan fits this structure?' on a real position from a model game or the catalogue."""
        rng = random.Random(seed)
        pool = [s for s in STRUCTURES if s != "other"]
        sid = structure if structure in STRUCTURES and structure != "other" else rng.choice(pool)
        games = self.model_games(sid, 8)
        fen, origin = None, "catalogue"
        if games:
            g = rng.choice(games)
            fen, origin = g["fen"], f"{g['white']} – {g['black']}"
        else:
            for op in rng.sample(openings.catalog(), len(openings.catalog())):
                if classify_structure(chess.Board(op["fen"])) == sid:
                    fen, origin = op["fen"], op["name"]
                    break
        if not fen:
            raise PrepError(f"No example position for {STRUCTURES[sid]['name']} yet — import some games")
        side = rng.choice(["white", "black"])
        correct = rng.choice(STRUCTURES[sid][side])
        wrong = [p for k, v in STRUCTURES.items() if k not in (sid, "other") for p in v[side] if p not in STRUCTURES[sid][side]]
        options = rng.sample(wrong, 3) + [correct]
        rng.shuffle(options)
        return self.trainer._store({"kind": "plan", "fen": fen, "options": options, "opening": STRUCTURES[sid]["name"], "origin": origin,
                                    "prompt": f"{STRUCTURES[sid]['name']}: which plan belongs to {side.title()}?"},
                                   {"value": correct, "mode": "plan", "explain": f"{STRUCTURES[sid]['name']} — White: {'; '.join(STRUCTURES[sid]['white'])}. "
                                                                                 f"Black: {'; '.join(STRUCTURES[sid]['black'])}."})

    # ================================================================== 7 · preparation file (events)
    def events(self) -> list[dict[str, Any]]:
        out = []
        t = now()
        for ev in self.db.pref("prep_events", []):
            decks = []
            for d in ev.get("decks", []):
                row = self.db.query("SELECT COUNT(*) n, SUM(CASE WHEN reps>=2 AND due>? THEN 1 ELSE 0 END) ready, "
                                    "SUM(CASE WHEN due<=? THEN 1 ELSE 0 END) due FROM cards WHERE deck=?", (t, t, d))[0]
                decks.append({"deck": d, "cards": row["n"], "ready": row["ready"] or 0, "due": row["due"] or 0})
            days = (ev["date"] - t) / DAY
            total = sum(d["cards"] for d in decks)
            out.append({**ev, "days_left": round(days, 1), "decks_status": decks, "past": days < 0,
                        "readiness": round(sum(d["ready"] for d in decks) / total, 3) if total else None,
                        "interval_cap_days": None if days < 0 else round(max(0.5, days / 4), 1)})
        return sorted(out, key=lambda e: e["date"])

    def save_event(self, name: str, date: float, decks: list[str], event_id: str | None = None) -> list[dict[str, Any]]:
        evs = [e for e in self.db.pref("prep_events", []) if e["id"] != event_id]
        evs.append({"id": event_id or new_id("ev"), "name": name or "Event", "date": float(date), "decks": list(decks)})
        self.db.set_pref("prep_events", evs)
        return self.events()

    def delete_event(self, event_id: str) -> list[dict[str, Any]]:
        self.db.set_pref("prep_events", [e for e in self.db.pref("prep_events", []) if e["id"] != event_id])
        return self.events()

    def alerts(self, book_id: str | None = None) -> list[dict[str, Any]]:
        where, params = ("book_id=?", [book_id]) if book_id else ("", [])
        return self.db.all("watch", where, params, order="alert IS NULL, updated_at DESC", limit=400)

    # ================================================================== 8 · goal repertoires
    def goal_book(self, book_id: str, color: str, goal: str) -> dict[str, Any]:
        """Derive a repertoire for a must-draw or must-win game from the evidence stored on each move
        (engine win/draw/loss when annotated, otherwise game results)."""
        if goal not in ("draw", "win"):
            raise PrepError("goal must be 'draw' or 'win'")
        src = self.books.load(book_id)
        info = self.books.info(book_id)
        out = Book({"root_fen": src.root_fen, "positions": {}})
        used = {"engine_wdl": 0, "results": 0, "evaluation": 0, "fallback": 0, "choices": 0}
        seen = set()

        def profile(m: dict[str, Any]) -> tuple[float | None, float | None, float, str]:
            ev = m.get("eval") or {}
            wdl = ev.get("wdl")
            exp = Score.from_dict(ev).expected() if ev else None
            if wdl:
                t = sum(wdl) or 1
                return wdl[0] / t, wdl[1] / t, exp if exp is not None else (wdl[0] + wdl[1] / 2) / t, "engine_wdl"
            if m["games"] >= 5:
                return m["w"] / m["games"], m["d"] / m["games"], exp if exp is not None else (m["w"] + m["d"] / 2) / m["games"], "results"
            if exp is not None:
                # no draw data: a level evaluation is the best available proxy for drawishness
                return exp - 0.5 if exp > 0.5 else 0.0, 1 - abs(exp - 0.5) * 2, exp, "evaluation"
            return None, None, 0.5, "fallback"

        def walk(board: chess.Board, ply: int) -> None:
            key = pos_key(board)
            if key in seen or ply > 40:
                return
            seen.add(key)
            ms = _moves(src, board)
            if not ms:
                return
            my_turn = (board.turn == chess.WHITE) == (color == "white")
            if my_turn:
                rated = [(m, *profile(m)) for m in ms]
                sound = [r for r in rated if r[3] >= (0.42 if goal == "draw" else 0.45)] or rated
                known = [r for r in sound if r[4] != "fallback"]
                if known:
                    pick = max(known, key=lambda r: (r[2] if goal == "draw" else r[1]) or 0)
                else:
                    pick = max(sound, key=lambda r: r[0]["weight"])
                used[pick[4]] += 1
                used["choices"] += 1
                m = pick[0]
                tag = (f"[{goal}] " + (f"draw {round(100 * pick[2])}% · win {round(100 * pick[1])}%" if pick[1] is not None else "no risk data") + f" ({pick[4].replace('_', ' ')})")
                out.add_move(board, chess.Move.from_uci(m["uci"]), weight=1.0, accumulate=False, source="goal", status="main",
                             comment=tag, **{k: m[k] for k in ("games", "w", "d", "l", "eval") if k in m})
                b = board.copy(stack=False)
                b.push_uci(m["uci"])
                walk(b, ply + 1)
            else:
                for m in ms:
                    out.add_move(board, chess.Move.from_uci(m["uci"]), weight=m["weight"], accumulate=False, source="goal", status=m["status"],
                                 **{k: m[k] for k in ("games", "w", "d", "l", "eval") if k in m})
                    b = board.copy(stack=False)
                    b.push_uci(m["uci"])
                    walk(b, ply + 1)

        walk(chess.Board(src.root_fen), 0)
        label = "Drawing weapon" if goal == "draw" else "Must-win"
        new = self.books.create(f"{info['name']} — {label} ({color})", out, profile="solid" if goal == "draw" else "aggressive", target_color=color,
                                source=f"derived from {info['name']}", summary=f"{label} selection",
                                description=f"{label} repertoire for {color.title()}. Each of your moves is tagged with the evidence used.")
        blind = used["fallback"] / used["choices"] if used["choices"] else 1.0
        return {"book": new, "evidence": used,
                "warning": ("Most choices had no risk data. Run 'Annotate with engine' on the source book first — ideally with an engine "
                            "that reports win/draw/loss.") if blind > 0.5 else None}

    # ================================================================== 9 · drills
    def recital(self, book_id: str | None = None, opening_id: str | None = None, color: str = "white", seed: int | None = None) -> dict[str, Any]:
        """A line to recite blindfold: you supply your side's moves, the opponent's are announced."""
        rng = random.Random(seed)
        if opening_id:
            op = openings.find(opening_id)
            if not op:
                raise PrepError("Unknown opening")
            sans, name, start = op["moves"], op["name"], chess.STARTING_FEN
        else:
            book = self.books.head(book_id) if book_id else openings.reference_book()
            lines = [l for l in book.lines(max_ply=24, limit=400) if len(l) >= 8]
            if not lines:
                raise PrepError("This book has no line of eight plies or more")
            sans, start = rng.choice(lines), book.root_fen
            b = chess.Board(start)
            for s in sans:
                b.push_san(s)
            name = (openings.identify(b) or {}).get("name") or "Repertoire line"
        b = chess.Board(start)
        uci = []
        for s in sans:
            mv = b.parse_san(s)
            uci.append(mv.uci())
            b.push(mv)
        return {"name": name, "start_fen": start, "sans": sans, "uci": uci, "color": color}

    def survival_start(self, book_id: str, color: str, seed: int | None = None) -> dict[str, Any]:
        """A position at the edge of your book with the opponent to move — the drill starts where your preparation ends."""
        rng = random.Random(seed)
        book = self.books.head(book_id)
        lines = [l for l in book.lines(max_ply=30, limit=600) if len(l) >= 6]
        if not lines:
            raise PrepError("This book has no line of six plies or more")
        sans = rng.choice(lines)
        b = chess.Board(book.root_fen)
        uci = []
        for s in sans:
            mv = b.parse_san(s)
            uci.append(mv.uci())
            b.push(mv)
        my_white = color == "white"
        cut = rng.randint(max(4, len(uci) // 2), len(uci))
        while cut > 2 and ((chess.Board(book.root_fen).turn == chess.WHITE) == (cut % 2 == 0)) == my_white:
            cut -= 1                                              # end on your own move so the opponent is to play
        b = chess.Board(book.root_fen)
        for u in uci[:cut]:
            b.push_uci(u)
        return {"moves": uci[:cut], "sans": sans[:cut], "fen": b.fen(), "start_fen": book.root_fen,
                "opening": (openings.identify(b) or {}).get("name"), "color": color}

    # ================================================================== 10 · endgames
    def endgames(self, cid: str | None = None) -> dict[str, Any]:
        """Which endgames each opening leads to in the stored games, and how they went."""
        if cid:
            c = self.collection(cid)
            games = self._games(cid)
        else:
            c = None
            games = self.db.all("games", "plies>=40", order="created_at DESC", limit=3000)
        table: dict[tuple[str, str], dict[str, Any]] = {}
        by_type: dict[str, dict[str, Any]] = {}
        reached = 0
        for g in games:
            info = self._classify_game(g)
            if not info["endgame"]:
                continue
            reached += 1
            side = g["meta"].get("player_color") if c else None
            pts = {"1-0": 1.0, "0-1": 0.0, "1/2-1/2": 0.5}.get(g["result"])
            if pts is not None and side == "black":
                pts = 1 - pts
            op = (g["opening"] or "Unnamed opening").split(":")[0]
            for store, key in ((table, (op, info["endgame"])), (by_type, info["endgame"])):
                r = store.setdefault(key, {"games": 0, "points": 0.0, "scored": 0, "examples": []})  # type: ignore[arg-type]
                r["games"] += 1
                if pts is not None:
                    r["points"] += pts
                    r["scored"] += 1
                if len(r["examples"]) < 4:
                    r["examples"].append({"game_id": g["id"], "fen": info["endgame_fen"], "ply": info["endgame_ply"], "white": g["white"],
                                          "black": g["black"], "result": g["result"], "player_color": side})
        rows = [{"opening": k[0], "type": k[1], "name": ENDGAMES[k[1]]["name"], "games": v["games"],
                 "score": round(v["points"] / v["scored"], 3) if v["scored"] else None, "examples": v["examples"]} for k, v in table.items()]
        types = [{"type": k, **ENDGAMES[k], "games": v["games"], "score": round(v["points"] / v["scored"], 3) if v["scored"] else None,
                  "examples": v["examples"]} for k, v in by_type.items()]
        return {"player": c["player"] if c else None, "games": len(games), "reached_endgame": reached,
                "by_opening": sorted(rows, key=lambda r: (-r["games"], r["opening"])), "by_type": sorted(types, key=lambda r: -r["games"]),
                "note": ("Scores are %s. An endgame counts once the simplified material has lasted six plies." %
                         ("from the player's point of view" if c else "White's score, because no player was selected"))}


def clean_moves(moves: list[str] | str) -> list[str]:
    """Accept '1.e4 e5 2.Nf3', '1. e4 e5' or a list of SAN/UCI tokens; drop move numbers and results."""
    toks = moves.split() if isinstance(moves, str) else [t for m in moves for t in str(m).split()]
    out = []
    for t in toks:
        t = t.split(".")[-1] if "." in t else t
        if t and t not in ("*", "1-0", "0-1", "1/2-1/2") and not t.isdigit():
            out.append(t)
    return out


def _numbered(sans: list[str]) -> str:
    return " ".join((f"{i // 2 + 1}.{s}" if i % 2 == 0 else s) for i, s in enumerate(sans))


def _numbered_from(board: chess.Board, sans: list[str] | str) -> str:
    from ..chessx import numbered
    return numbered(board, [sans] if isinstance(sans, str) else sans)

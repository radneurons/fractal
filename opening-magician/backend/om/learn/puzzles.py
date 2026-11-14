"""Puzzle Generation Lab.

Puzzles are mined from real positions (games, tournaments, discovery experiments, studies,
opening traps) and only accepted when an engine search shows ONE clearly best first move.
Positions where several moves are about equally good are rejected rather than turned into
misleading puzzles; near-equal alternatives that do exist are stored and accepted as correct.
"""
from __future__ import annotations

import asyncio
from typing import Any

import chess

from .. import openings
from ..chessx import Score, loss_between, motifs_after, read_games
from ..db import Database, new_id, now
from ..engines.manager import EngineHandle, EngineManager, EngineSpec
from ..engines.search import Budget, adaptive_search

THEMES = ["checkmate", "mate_in_1", "mate_in_2", "mate_in_3", "mate_in_n", "fork", "pin", "skewer", "discovered_attack",
          "double_check", "deflection", "decoy", "clearance", "zwischenzug", "sacrifice", "defensive_resource",
          "perpetual_check", "opening_trap", "move_order_trick", "pawn_break", "strategic_decision", "endgame_conversion",
          "promotion"]
LEVELS = [(1100, "Beginner"), (1500, "Intermediate"), (1900, "Advanced"), (2300, "Expert"), (9999, "Grandmaster-level calculation")]
MIN_GAP = 0.15          # expected-score gap between best and second best for a puzzle to be unambiguous
ALT_GAP = 0.03          # moves this close to the best are accepted as alternative solutions


def level_for(rating: int) -> str:
    return next(name for limit, name in LEVELS if rating < limit)


def estimate_rating(board: chess.Board, solution: list[str], gap: float, found_depth: int | None, themes: list[str]) -> int:
    """Difficulty from puzzle characteristics; later corrected by real solve results."""
    first = chess.Move.from_uci(solution[0])
    solver_moves = (len(solution) + 1) // 2
    r = 900 + 260 * (solver_moves - 1)
    quiet = not board.is_capture(first) and not board.gives_check(first)
    r += 280 if quiet else 0
    r += 120 if "sacrifice" in themes else 0
    r += 150 if "defensive_resource" in themes else 0
    r += int(max(0, (found_depth or 4) - 4) * 55)       # the deeper an engine needs to look, the harder
    r += int(max(0.0, 0.5 - gap) * 300)                  # small margins are harder to feel
    r -= 200 if "mate_in_1" in themes else 0
    return max(600, min(2800, r))


class PuzzleLab:
    def __init__(self, db: Database, engines: EngineManager):
        self.db, self.engines = db, engines

    # ------------------------------------------------------------------ built-in, authored puzzles
    def seed_builtin(self) -> int:
        """Trap puzzles from the authored catalogue (solution = the documented punishing line)."""
        if self.db.scalar("SELECT COUNT(*) FROM puzzles WHERE json_extract(source,'$.kind')='catalogue_trap'"):
            return 0
        n = 0
        for t in openings.traps():
            board = chess.Board()
            for u in t["uci"][:t["blunder_ply"] + 1]:
                board.push_uci(u)
            solution = t["uci"][t["blunder_ply"] + 1:]
            if not solution:
                continue
            first = chess.Move.from_uci(solution[0])
            themes = ["opening_trap"] + motifs_after(board, first)
            if t["is_mate"]:
                k = (len(solution) + 1) // 2
                themes.append({1: "mate_in_1", 2: "mate_in_2", 3: "mate_in_3"}.get(k, "mate_in_n"))
            rating = estimate_rating(board, solution, 0.5, None, themes)
            self._insert(board.fen(), solution, [], themes, rating, f"{t['name']}: punish {t['blunder_san']}", t["explanation"],
                         {"kind": "catalogue_trap", "trap_id": t["id"], "opening": t["opening"]},
                         {"method": "authored line, legality checked by the rules engine", "engine_verified": False})
            n += 1
        return n

    def _insert(self, fen: str, solution: list[str], alternatives: list[str], themes: list[str], rating: int, title: str,
                explanation: str, source: dict[str, Any], verification: dict[str, Any]) -> str | None:
        if self.db.scalar("SELECT 1 FROM puzzles WHERE fen=?", (fen,)):
            return None
        pid = new_id("pz")
        self.db.insert("puzzles", {"id": pid, "fen": fen, "solution": solution, "alternatives": alternatives,
                                   "themes": list(dict.fromkeys(themes)), "difficulty": level_for(rating), "rating": rating,
                                   "title": title, "explanation": explanation, "source": source, "verification": verification,
                                   "created_at": now()})
        return pid

    # ------------------------------------------------------------------ mining
    async def analyse_position(self, h: EngineHandle, board: chess.Board, budget: Budget, max_solver_moves: int = 3,
                               cancel: asyncio.Event | None = None) -> dict[str, Any] | None:
        """Return a verified puzzle description for `board`, or None when it is not a clean puzzle."""
        if board.is_game_over() or board.legal_moves.count() < 2:
            return None
        res = await adaptive_search(h, board, budget, multipv=3, cancel=cancel)
        lines = res["lines"]
        if len(lines) < 2:
            return None
        best, second = Score.from_dict(lines[0]["score"]), Score.from_dict(lines[1]["score"])
        gap = loss_between(best, second)["expected_loss"]
        winning = best.expected() >= 0.68
        saving = 0.35 <= best.expected() <= 0.65 and second.expected() <= 0.22
        if not (winning or saving):
            return None
        if gap < MIN_GAP:
            # several good moves: only acceptable when the best is a strictly faster forced mate
            if not (best.mate and best.mate > 0 and not (second.mate and second.mate > 0)):
                return None
        found_depth = next((x["depth"] for x in res["history"] if x["move"] == lines[0]["move"]), None)
        alternatives = [l["move"] for l in lines[1:] if loss_between(best, Score.from_dict(l["score"]))["expected_loss"] <= ALT_GAP]
        # extend the solution while the solver's move stays unique
        solution = [lines[0]["move"]]
        b = board.copy(stack=False)
        b.push_uci(lines[0]["move"])
        pv = lines[0]["pv"]
        for i in range(1, max_solver_moves):
            if b.is_game_over() or len(pv) < 2 * i:
                break
            reply = pv[2 * i - 1]
            if chess.Move.from_uci(reply) not in b.legal_moves:
                break
            b2 = b.copy(stack=False)
            b2.push_uci(reply)
            if b2.is_game_over():
                break
            nxt = await adaptive_search(h, b2, budget.scaled(0.6), multipv=2, cancel=cancel)
            if len(nxt["lines"]) < 1:
                break
            s1 = Score.from_dict(nxt["lines"][0]["score"])
            g2 = loss_between(s1, Score.from_dict(nxt["lines"][1]["score"]))["expected_loss"] if len(nxt["lines"]) > 1 else 1.0
            if g2 < MIN_GAP and not (s1.mate and s1.mate > 0):
                break
            solution += [reply, nxt["lines"][0]["move"]]
            b = b2
            b.push_uci(nxt["lines"][0]["move"])
            if not (s1.mate and s1.mate > 0) and i >= 2:
                break
        first = chess.Move.from_uci(solution[0])
        themes = motifs_after(board, first)
        if best.mate and best.mate > 0:
            themes.append({1: "mate_in_1", 2: "mate_in_2", 3: "mate_in_3"}.get(best.mate, "mate_in_n"))
        if saving:
            themes.append("defensive_resource")
        if chess.popcount(board.occupied) <= 12 and "checkmate" not in themes:
            themes.append("endgame_conversion")
        if not themes:
            themes.append("strategic_decision")
        rating = estimate_rating(board, solution, gap, found_depth, themes)
        return {"fen": board.fen(), "solution": solution, "alternatives": alternatives, "themes": themes, "rating": rating,
                "verification": {"engine": h.name, "engine_sig": h.signature, "depth": res["depth"], "gap": round(gap, 3),
                                 "best": best.to_dict(), "second": second.to_dict(), "stop_reason": res["stop_reason"],
                                 "engine_verified": True, "found_at_depth": found_depth}}

    async def mine_pgn(self, pgn: str, engine: EngineSpec, budget: Budget, *, source: dict[str, Any] | None = None,
                       skip_plies: int = 6, max_puzzles: int = 20, cancel: asyncio.Event | None = None,
                       on_progress: Any = None) -> dict[str, Any]:
        """Scan games for positions where the side to move had exactly one clearly best move that was missed
        (or found) in the game."""
        games = read_games(pgn)
        made, scanned, rejected = [], 0, 0
        async with self.engines.session(engine, "research", "Puzzle miner") as h:
            for gi, game in enumerate(games):
                board = game.board()
                for ply, mv in enumerate(game.mainline_moves()):
                    if cancel is not None and cancel.is_set() or len(made) >= max_puzzles:
                        break
                    if ply >= skip_plies and board.legal_moves.count() >= 3:
                        scanned += 1
                        pz = await self.analyse_position(h, board, budget, cancel=cancel)
                        if pz:
                            title = f"{game.headers.get('White', '?')} – {game.headers.get('Black', '?')}, move {board.fullmove_number}"
                            op = openings.identify(board)
                            pid = self._insert(pz["fen"], pz["solution"], pz["alternatives"], pz["themes"], pz["rating"], title,
                                               self.explain(pz), {"kind": "game", **(source or {}), "ply": ply,
                                                                  "played": mv.uci(), "found_in_game": mv.uci() == pz["solution"][0],
                                                                  "opening": op["name"] if op else None}, pz["verification"])
                            if pid:
                                made.append(pid)
                        else:
                            rejected += 1
                    board.push(mv)
                if on_progress:
                    on_progress((gi + 1) / max(1, len(games)))
        return {"created": made, "positions_scanned": scanned, "rejected_ambiguous_or_quiet": rejected, "games": len(games)}

    async def from_position(self, fen: str, engine: EngineSpec, budget: Budget, source: dict[str, Any] | None = None,
                            title: str = "Custom position") -> dict[str, Any]:
        board = chess.Board(fen)
        async with self.engines.session(engine, "interactive", "Puzzle verifier") as h:
            pz = await self.analyse_position(h, board, budget)
        if not pz:
            return {"created": None, "reason": "Not a clean puzzle: no single clearly best move was found at this budget."}
        pid = self._insert(pz["fen"], pz["solution"], pz["alternatives"], pz["themes"], pz["rating"], title, self.explain(pz),
                           {"kind": "position", **(source or {})}, pz["verification"])
        return {"created": pid, "reason": None if pid else "A puzzle for this position already exists", "puzzle": pz}

    def from_trap_finding(self, finding: dict[str, Any]) -> list[str]:
        """Two puzzles from a verified discovery trap: 'find the punishment' and 'avoid the trap'."""
        trap = (finding.get("evidence") or {}).get("trap")
        if not trap:
            return []
        out = []
        b = chess.Board(trap["fen_after_mistake"])
        themes = ["opening_trap"] + list(trap.get("motifs") or [])
        pid = self._insert(b.fen(), [trap["punish"]], [], themes, estimate_rating(b, [trap["punish"]], trap["loss"], None, themes),
                           f"Punish {trap['tempting_san']} ({finding['line_san']})",
                           f"{trap['tempting_san']} looks natural but loses about {trap['loss']:.2f} of expected score; "
                           f"{trap['punish_san']} is the refutation." + ("" if trap["unique_punishment"] else " Other strong moves may exist."),
                           {"kind": "discovery_trap", "finding_id": finding["id"], "variant": "punish"},
                           {"engine_verified": True, "engine": (finding["evidence"].get("verification") or {}).get("engine"),
                            "unique": trap["unique_punishment"]})
        if pid:
            out.append(pid)
            self.db.link("puzzle", pid, "finding", finding["id"], "derived_from")
        return out

    def explain(self, pz: dict[str, Any]) -> str:
        board = chess.Board(pz["fen"])
        mv = chess.Move.from_uci(pz["solution"][0])
        v = pz["verification"]
        names = {"fork": "forks two targets", "pin": "sets up a pin", "skewer": "skewers a piece behind another",
                 "discovered_attack": "unleashes a discovered attack", "sacrifice": "is a sacrifice", "pawn_break": "is a pawn lever",
                 "double_check": "gives double check", "promotion": "promotes", "defensive_resource": "is the only move that holds",
                 "checkmate": "is checkmate"}
        why = [names[t] for t in pz["themes"] if t in names]
        text = f"{board.san(mv)} " + (", ".join(why) if why else "is the only move that keeps the advantage") + "."
        text += f" Engine evidence: best {v['best']['text']} versus {v['second']['text']} for the next move (depth {v['depth']})."
        if pz["alternatives"]:
            text += " Also accepted: " + ", ".join(board.san(chess.Move.from_uci(a)) for a in pz["alternatives"]) + "."
        return text

    # ------------------------------------------------------------------ solving
    def list(self, theme: str | None = None, level: str | None = None, source: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        rows = self.db.all("puzzles", order="created_at DESC", limit=2000)
        out = []
        for r in rows:
            if theme and theme not in r["themes"]:
                continue
            if level and r["difficulty"] != level:
                continue
            if source and r["source"].get("kind") != source:
                continue
            a = self.db.query("SELECT COUNT(*) n, SUM(solved) s FROM puzzle_attempts WHERE puzzle_id=?", (r["id"],))[0]
            out.append({"id": r["id"], "fen": r["fen"], "title": r["title"], "themes": r["themes"], "difficulty": r["difficulty"],
                        "rating": r["rating"], "source": r["source"], "moves": (len(r["solution"]) + 1) // 2,
                        "attempts": a["n"], "solved": a["s"] or 0, "engine_verified": r["verification"].get("engine_verified", False)})
            if len(out) >= limit:
                break
        return out

    def get(self, pid: str, reveal: bool = False) -> dict[str, Any]:
        r = self.db.get("puzzles", pid)
        if not r:
            raise ValueError("Unknown puzzle")
        board = chess.Board(r["fen"])
        out = {k: r[k] for k in ("id", "fen", "title", "themes", "difficulty", "rating", "source", "verification")}
        out["side"] = "white" if board.turn else "black"
        out["length"] = len(r["solution"])
        if reveal:
            out["solution"] = r["solution"]
            out["solution_san"] = self._san(board, r["solution"])
            out["explanation"] = r["explanation"]
        return out

    @staticmethod
    def _san(board: chess.Board, ucis: list[str]) -> list[str]:
        b, out = board.copy(stack=False), []
        for u in ucis:
            mv = chess.Move.from_uci(u)
            if mv not in b.legal_moves:
                break
            out.append(b.san(mv))
            b.push(mv)
        return out

    def check(self, pid: str, index: int, move: str) -> dict[str, Any]:
        """Check the solver's move at solution index `index` (0, 2, 4 …) and return the opponent's reply."""
        r = self.db.get("puzzles", pid)
        if not r:
            raise ValueError("Unknown puzzle")
        board = chess.Board(r["fen"])
        sol = r["solution"]
        for u in sol[:index]:
            board.push_uci(u)
        try:
            mv = board.parse_uci(move)
        except ValueError:
            return {"correct": False, "legal": False}
        ok = mv.uci() == sol[index]
        alt = index == 0 and mv.uci() in r["alternatives"]
        if not ok and not alt:
            # any move that mates is a solution too
            b = board.copy(stack=False)
            b.push(mv)
            if b.is_checkmate():
                return {"correct": True, "legal": True, "done": True, "also_mate": True}
            return {"correct": False, "legal": True, "hint_square": sol[index][:2]}
        if alt:
            return {"correct": True, "legal": True, "done": True, "alternative": True,
                    "message": "An equally good move — accepted. The main line continues differently."}
        done = index + 1 >= len(sol)
        return {"correct": True, "legal": True, "done": done, "reply": None if done else sol[index + 1],
                "next_index": index + 2}

    def record(self, pid: str, solved: bool, time_ms: int | None, hints: int, mistakes: int, solver_rating: int = 1500) -> dict[str, Any]:
        r = self.db.get("puzzles", pid)
        if not r:
            raise ValueError("Unknown puzzle")
        self.db.insert("puzzle_attempts", {"id": new_id("pa"), "puzzle_id": pid, "solved": int(solved), "time_ms": time_ms,
                                           "hints": hints, "mistakes": mistakes, "created_at": now()})
        # observed performance corrects the estimated difficulty (Elo-style, clean solves only count as solves)
        clean = solved and hints == 0 and mistakes == 0
        expected = 1 / (1 + 10 ** ((r["rating"] - solver_rating) / 400))
        new_rating = int(round(r["rating"] + 16 * (expected - (1.0 if clean else 0.0))))
        new_rating = max(500, min(3000, new_rating))
        self.db.update("puzzles", pid, {"rating": new_rating, "difficulty": level_for(new_rating)})
        return {"rating": new_rating, "difficulty": level_for(new_rating), "clean": clean}

    def delete(self, pid: str) -> None:
        self.db.delete("puzzles", pid)

    def stats(self) -> dict[str, Any]:
        rows = self.db.all("puzzles", cols="themes,difficulty")
        themes: dict[str, int] = {}
        levels: dict[str, int] = {}
        for r in rows:
            levels[r["difficulty"]] = levels.get(r["difficulty"], 0) + 1
            for t in r["themes"]:
                themes[t] = themes.get(t, 0) + 1
        a = self.db.query("SELECT COUNT(*) n, SUM(solved) s, AVG(time_ms) t FROM puzzle_attempts")[0]
        return {"total": len(rows), "themes": themes, "levels": levels, "attempts": a["n"], "solved": a["s"] or 0,
                "avg_time_ms": a["t"], "all_themes": THEMES}

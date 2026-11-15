"""Engine-backed preparation jobs: opponent-move checks, leak costs, human-practical scoring,
refutation watch and book annotation.  Each runs as a durable background job."""
from __future__ import annotations

import asyncio
from typing import Any, Callable

import chess

from .. import openings
from ..chessx import Score, loss_between, parse_move, pos_key
from ..db import new_id, now
from ..engines.manager import EngineManager, EngineSpec
from ..engines.search import Budget, evaluate_move, ranked_candidates
from .core import Prep, PrepError, _moves, _numbered, clean_moves
from .structures import naturalness

Progress = Callable[[float], None]
ONLY_MOVE_GAP = 0.08       # expected-score gap between best and second best that makes a move an "only move"


def _spec_with_wdl(engines: EngineManager, spec: EngineSpec) -> EngineSpec:
    """Ask for win/draw/loss output when the engine offers it."""
    row = engines.get(spec.engine_id)
    name = next((k for k in row.get("options", {}) if k.lower() == "uci_showwdl"), None)
    if name and name not in spec.options:
        spec.options[name] = True
    return spec


class PrepEngine:
    def __init__(self, prep: Prep, engines: EngineManager):
        self.prep, self.engines, self.db, self.books = prep, engines, prep.db, prep.books

    # ---- 1 · which of the opponent's habitual moves does the engine dislike?
    async def check_dossier(self, cid: str, engine: EngineSpec, budget: Budget, cancel: asyncio.Event, progress: Progress, top: int = 24) -> dict[str, Any]:
        c = self.prep.collection(cid)
        todo = []
        for side, bid in (("white", c["white_book_id"]), ("black", c["black_book_id"])):
            book = self.books.head(bid)
            for board, ply in book.walk(22):
                if (board.turn == chess.WHITE) != (side == "white") or ply < 2:
                    continue
                for m in _moves(book, board):
                    if m["games"] >= 3:
                        todo.append((m["games"], side, board.copy(stack=False), m))
        todo.sort(key=lambda t: -t[0])
        todo = todo[:top]
        flags = []
        async with self.engines.session(engine, "research", "Dossier check") as h:
            for i, (_, side, board, m) in enumerate(todo):
                if cancel.is_set():
                    break
                ver = await evaluate_move(h, board, chess.Move.from_uci(m["uci"]), budget, multipv=3, cancel=cancel)
                if ver.get("loss") and ver["loss"]["expected_loss"] >= 0.06 and ver["best_move"] != m["uci"]:
                    flags.append({"side": side, "fen": board.fen(), "uci": m["uci"], "san": m["san"], "games": m["games"],
                                  "expected_loss": ver["loss"]["expected_loss"], "best_san": ver["best_san"], "best_uci": ver["best_move"],
                                  "score": ver["score"]["text"], "best_score": ver["best_score"]["text"], "depth": ver["depth"], "engine": ver["engine"]})
                progress((i + 1) / max(1, len(todo)))
        stats = c["stats"]
        stats["engine_flags"] = sorted(flags, key=lambda f: -f["expected_loss"])
        stats["engine_checked"] = {"moves": len(todo), "at": now()}
        self.db.update("collections", cid, {"stats": stats})
        return {"checked": len(todo), "flagged": len(flags)}

    # ---- 2 · what did each of my deviations cost?
    async def leak_costs(self, cid: str, book_id: str, engine: EngineSpec, budget: Budget, cancel: asyncio.Event, progress: Progress, top: int = 30) -> dict[str, Any]:
        data = self.prep.leaks(cid, book_id)
        rows = data["leaks"][:top]
        costs: dict[str, Any] = {}
        async with self.engines.session(engine, "research", "Leak costs") as h:
            for i, r in enumerate(rows):
                if cancel.is_set():
                    break
                board = chess.Board(r["fen"])
                mine = await evaluate_move(h, board, chess.Move.from_uci(r["played_uci"]), budget, multipv=3, cancel=cancel)
                rep = await evaluate_move(h, board, chess.Move.from_uci(r["expected_uci"]), budget, multipv=3, cancel=cancel)
                if mine.get("score") and rep.get("score"):
                    a, b = Score.from_dict(mine["score"]), Score.from_dict(rep["score"])
                    costs[f"{r['fen']}|{r['played_uci']}"] = {"played": a.text(), "repertoire": b.text(), "depth": mine["depth"], "engine": mine["engine"],
                                                              "expected_loss": round(b.expected() - a.expected(), 4),
                                                              "verdict": "your move was worse" if b.expected() - a.expected() >= 0.04 else
                                                              "your move was better — consider updating the repertoire" if a.expected() - b.expected() >= 0.04 else "about equal"}
                progress((i + 1) / max(1, len(rows)))
        c = self.prep.collection(cid)
        stats = c["stats"]
        stats["leak_costs"] = {**stats.get("leak_costs", {}), **costs}
        self.db.update("collections", cid, {"stats": stats})
        return {"evaluated": len(costs)}

    # ---- 3 · human-practical scoring of a line
    async def practical(self, moves: list[str], start_fen: str | None, my_color: str, engine: EngineSpec, budget: Budget,
                        cancel: asyncio.Event, progress: Progress, human_book_id: str | None = None) -> dict[str, Any]:
        board = chess.Board(start_fen) if start_fen else chess.Board()
        human = self.books.head(human_book_id) if human_book_id else None
        line: list[chess.Move] = []
        b = board.copy()
        for t in clean_moves(moves):
            mv = parse_move(b, t)
            line.append(mv)
            b.push(mv)
        if not line:
            raise PrepError("Give a line to score")
        rows = []
        burden = {"white": 0.0, "black": 0.0}
        only = {"white": 0, "black": 0}
        last_exp = None
        async with self.engines.session(_spec_with_wdl(self.engines, engine), "research", "Practical scoring") as h:
            for i, mv in enumerate(line):
                if cancel.is_set():
                    break
                side = "white" if board.turn else "black"
                ranked = await ranked_candidates(h, board, 3, budget, cancel=cancel)
                cands = ranked["candidates"]
                if not cands:
                    break
                best = Score.from_dict(cands[0]["score"])
                gap = loss_between(best, Score.from_dict(cands[1]["score"]))["expected_loss"] if len(cands) > 1 else 1.0
                is_only = gap >= ONLY_MOVE_GAP and board.legal_moves.count() > 1
                best_mv = chess.Move.from_uci(cands[0]["move"])
                nat = naturalness(board, best_mv)
                found, source = nat, "heuristic"
                hm = _moves(human, board) if human else []
                hg = sum(m["games"] for m in hm)
                if hg >= 20:
                    hit = next((m for m in hm if m["uci"] == cands[0]["move"]), None)
                    found, source = (hit["games"] / hg if hit else 0.0), f"{hg} human games"
                played = next((c for c in cands if c["move"] == mv.uci()), None)
                if is_only:
                    only[side] += 1
                    burden[side] += 1 - found
                white = best if board.turn else best.negate()
                last_exp = white.expected()
                rows.append({"ply": i + 1, "side": side, "san": board.san(mv), "fen": board.fen(), "best_san": cands[0]["san"],
                             "is_best": mv.uci() == cands[0]["move"], "played_rank": played["rank"] if played else None,
                             "eval_white": white.text(), "gap": round(gap, 3), "only_move": is_only, "findability": round(found, 2),
                             "findability_source": source, "depth": ranked.get("depth"), "wdl": cands[0]["score"].get("wdl")})
                board.push(mv)
                progress((i + 1) / len(line))
        opp = "black" if my_color == "white" else "white"
        diff = burden[opp] - burden[my_color]
        practical = max(0.0, min(1.0, 0.5 + diff / 4))
        final = last_exp if last_exp is None or my_color == "white" else 1 - last_exp
        verdict = ("easier for you than for the opponent" if diff >= 0.5 else "harder for you than for the opponent" if diff <= -0.5 else "about equally demanding")
        return {"line": _numbered([r["san"] for r in rows]), "rows": rows, "my_color": my_color, "only_moves": only,
                "burden": {k: round(v, 2) for k, v in burden.items()}, "practical_score": round(practical, 3),
                "engine_expected_for_me": None if final is None else round(final, 3), "engine": rows[0] and h.name if rows else None,
                "summary": f"{only[my_color]} only-move(s) for you, {only[opp]} for the opponent — {verdict}. "
                           f"Engine expectation for you at the end: {'–' if final is None else f'{final * 100:.0f}%'}.",
                "note": "An only-move is one whose advantage over the second-best move is at least 8 points of expected score. "
                        "Findability uses human game shares when the chosen games book has 20+ games at the position, otherwise a heuristic."}

    # ---- 7 · refutation watch
    async def watch(self, book_id: str, color: str, engine: EngineSpec, budget: Budget, cancel: asyncio.Event, progress: Progress,
                    max_ply: int = 16, limit: int = 60) -> dict[str, Any]:
        """Re-verify the repertoire moves of a book and raise an alert when an evaluation has moved."""
        book = self.books.head(book_id)
        todo = []
        for board, ply in book.walk(max_ply):
            if (board.turn == chess.WHITE) != (color == "white"):
                continue
            ms = _moves(book, board)
            if ms:
                todo.append((ply, board.copy(stack=False), ms[0]))
        todo.sort(key=lambda t: t[0])
        todo = todo[:limit]
        alerts = 0
        async with self.engines.session(_spec_with_wdl(self.engines, engine), "research", "Refutation watch") as h:
            for i, (ply, board, m) in enumerate(todo):
                if cancel.is_set():
                    break
                ver = await evaluate_move(h, board, chess.Move.from_uci(m["uci"]), budget, multipv=4, cancel=cancel)
                if not ver.get("score"):
                    continue
                snap = {"score": ver["score"], "rank": ver["rank"], "depth": ver["depth"], "engine": ver["engine"], "engine_sig": ver["engine_sig"],
                        "best_san": ver["best_san"], "loss": ver["loss"]["expected_loss"], "at": now()}
                rows = self.db.all("watch", "book_id=? AND epd=? AND move_uci=?", (book_id, pos_key(board), m["uci"]))
                if not rows:
                    self.db.insert("watch", {"id": new_id("w"), "book_id": book_id, "epd": pos_key(board), "fen": board.fen(), "move_uci": m["uci"],
                                             "san": m["san"], "line": self.prep._line_to(book, board), "baseline": snap, "latest": snap,
                                             "history": [snap], "alert": None, "updated_at": now()})
                else:
                    w = rows[0]
                    old = Score.from_dict(w["baseline"]["score"]).expected()
                    new = Score.from_dict(snap["score"]).expected()
                    alert = None
                    if old - new >= 0.05:
                        alert = (f"dropped from {w['baseline']['score']['text']} (depth {w['baseline']['depth']}) to {snap['score']['text']} "
                                 f"(depth {snap['depth']}); the engine now prefers {snap['best_san']}")
                    elif new - old >= 0.05:
                        alert = f"improved from {w['baseline']['score']['text']} to {snap['score']['text']}"
                    elif snap["loss"] >= 0.08 and w["baseline"].get("loss", 0) < 0.08:
                        alert = f"now {round(snap['loss'] * 100)} points worse than {snap['best_san']}"
                    alerts += bool(alert)
                    self.db.update("watch", w["id"], {"latest": snap, "history": (w["history"] + [snap])[-12:], "alert": alert, "updated_at": now()})
                progress((i + 1) / max(1, len(todo)))
        return {"checked": len(todo), "alerts": alerts}

    def rebase_watch(self, watch_id: str) -> None:
        """Accept the latest evaluation as the new baseline (clears the alert)."""
        w = self.db.get("watch", watch_id)
        if w:
            self.db.update("watch", watch_id, {"baseline": w["latest"], "alert": None})

    # ---- 8 · annotate a book with engine evaluations (and win/draw/loss when the engine reports it)
    async def annotate(self, book_id: str, color: str, engine: EngineSpec, budget: Budget, cancel: asyncio.Event, progress: Progress,
                       max_ply: int = 18, limit: int = 150) -> dict[str, Any]:
        book = self.books.load(book_id)
        todo = []
        for board, ply in book.walk(max_ply):
            if (board.turn == chess.WHITE) != (color == "white"):
                continue
            node = book.positions.get(pos_key(board))
            for uci in list((node or {}).get("moves", {})):
                todo.append((ply, board.copy(stack=False), uci))
        todo.sort(key=lambda t: t[0])
        todo = todo[:limit]
        done, with_wdl = 0, 0
        name = ""
        async with self.engines.session(_spec_with_wdl(self.engines, engine), "research", "Book annotation") as h:
            name = h.name
            for i, (ply, board, uci) in enumerate(todo):
                if cancel.is_set():
                    break
                ver = await evaluate_move(h, board, chess.Move.from_uci(uci), budget, multipv=3, cancel=cancel)
                if ver.get("score"):
                    m = book.positions[pos_key(board)]["moves"][uci]
                    m["eval"] = {"cp": ver["score"]["cp"], "mate": ver["score"]["mate"], "wdl": ver["score"].get("wdl"), "depth": ver["depth"], "engine": ver["engine"]}
                    m["confidence"] = round(min(1.0, (ver["depth"] or 0) / 24), 2)
                    done += 1
                    with_wdl += bool(ver["score"].get("wdl"))
                progress((i + 1) / max(1, len(todo)))
        if done:
            self.books.commit(book_id, book, f"Engine annotation of {done} move(s) for {color} by {name}")
        return {"annotated": done, "with_wdl": with_wdl,
                "note": None if with_wdl else "This engine did not report win/draw/loss, so drawishness is estimated from the evaluation."}

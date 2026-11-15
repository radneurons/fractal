"""Gambit Lab: find sacrifices, measure what they cost and what they demand of the defender,
and test them against a ladder of engine strengths.

Three separate questions, three separate answers — never blended into one opaque number:

* **risk**   — what the gambit costs if the opponent defends perfectly (engine, expected score);
* **sting**  — how hard the defence is: only-moves, natural-looking moves that lose, whether taking is itself the mistake;
* **ladder** — which engine strengths actually go wrong against it, game by game.
"""
from __future__ import annotations

import asyncio
import random
from collections import Counter
from typing import Any, Callable

import chess
import chess.engine

from .. import openings
from ..books.store import BookStore
from ..chessx import Score, loss_between, numbered, parse_move, pos_key
from ..db import Database, new_id, now
from ..engines.manager import EngineError, EngineHandle, EngineManager, EngineSpec
from ..engines.search import Budget, adaptive_search, evaluate_move, ranked_candidates
from ..prep.core import _moves, clean_moves
from ..prep.structures import naturalness
from .static import balance, compensation, sacrifice, sacrifices, see

Progress = Callable[[float], None]
ONLY_MOVE_GAP = 0.08          # best move at least this much better than the second (expected score)
TRAP_LOSS = 0.15              # a tempting move that loses at least this much is a trap
WON, LOST = 0.70, 0.35        # gambiteer's expected score at the end of a ladder game
COST_BANDS = [(0.03, "sound", "Sound: costs almost nothing against best play"),
              (0.10, "practical", "Practical gamble: a small objective price for real problems"),
              (0.20, "speculative", "Speculative: a prepared opponent comes out clearly better"),
              (9.99, "unsound", "Unsound: only a surprise weapon")]


class GambitError(ValueError):
    pass


def _at_least(budget: Budget, depth: int) -> Budget:
    """The same budget, but not allowed to stop shallower than `depth`: scores that are compared with
    each other must come from comparable depths, or a deep tactic looks like a blunder."""
    b = Budget.from_dict(budget.to_dict())
    b.min_depth = max(b.min_depth, min(int(depth or 0), b.max_depth))
    return b


def _full(budget: Budget) -> Budget:
    """Sacrifices are exactly the positions where a search that stops early ('the best move looks stable')
    is wrong, so gambit analysis always spends the whole budget."""
    b = Budget.from_dict(budget.to_dict())
    b.adaptive = False
    return b


def level_label(level: dict[str, Any]) -> str:
    mode = level.get("mode", "full")
    return {"elo": f"Elo {level.get('elo')}", "skill": f"Skill {level.get('skill')}", "depth": f"Depth {level.get('depth')}",
            "time": f"{level.get('movetime_ms')} ms"}.get(mode, "Full strength")


def _level_key(level: dict[str, Any]) -> float:
    mode = level.get("mode", "full")
    return {"elo": float(level.get("elo", 0)), "skill": float(level.get("skill", 0)), "depth": float(level.get("depth", 0)),
            "time": float(level.get("movetime_ms", 0))}.get(mode, float("inf"))


class GambitLab:
    def __init__(self, db: Database, engines: EngineManager, books: BookStore,
                 strength_fn: Callable[[EngineSpec, dict[str, Any]], dict[str, Any]]):
        self.db, self.engines, self.books, self.strength_fn = db, engines, books, strength_fn
        self._catalogue: list[dict[str, Any]] | None = None

    # ------------------------------------------------------------------ storage
    def list(self) -> list[dict[str, Any]]:
        rows = self.db.all("gambits", order="updated_at DESC")
        return [self._brief(r) for r in rows]

    def _brief(self, r: dict[str, Any]) -> dict[str, Any]:
        d, rep = r["detail"] or {}, r["report"] or {}
        return {"id": r["id"], "name": r["name"], "color": r["color"], "san": r["san"], "fen": r["fen"], "status": r["status"],
                "line_text": d.get("line_text"), "pawns": (d.get("sacrifice") or {}).get("pawns"), "kind": d.get("kind"),
                "band": d.get("band"), "risk": (d.get("risk") or {}).get("value"), "sting": (d.get("sting") or {}).get("value"),
                "compensation": (d.get("compensation") or {}).get("score"), "value": d.get("value"),
                "ladder": rep.get("verdict"), "falls_up_to": rep.get("falls_up_to"), "updated_at": r["updated_at"]}

    def get(self, gid: str) -> dict[str, Any]:
        r = self.db.get("gambits", gid)
        if not r:
            raise GambitError("Unknown gambit")
        return r

    def delete(self, gid: str) -> None:
        self.db.delete("gambits", gid)

    def _store(self, start_fen: str | None, path: list[chess.Move], board: chess.Board, move: chess.Move, detail: dict[str, Any],
               origin: dict[str, Any]) -> dict[str, Any]:
        after = board.copy(stack=False)
        after.push(move)
        op = openings.identify(_replay(start_fen, path + [move]))
        san = board.san(move)
        name = f"{op['name'] if op else 'Position'} — {numbered(board, [san])}"
        row = {"name": name, "color": "white" if board.turn else "black", "start_fen": start_fen, "fen": board.fen(), "epd": pos_key(board),
               "move_uci": move.uci(), "san": san, "line": [m.uci() for m in path] + [move.uci()], "detail": detail, "config": origin,
               "status": "assessed", "updated_at": now()}
        old = self.db.all("gambits", "epd=? AND move_uci=?", (row["epd"], row["move_uci"]))
        if old:
            self.db.update("gambits", old[0]["id"], row)
            return self.get(old[0]["id"])
        gid = new_id("gam")
        self.db.insert("gambits", {"id": gid, **row, "report": {}, "created_at": now()})
        return self.get(gid)

    # ------------------------------------------------------------------ known gambits
    def catalogue(self) -> list[dict[str, Any]]:
        """Catalogued openings called gambits, with the move that makes the offer located by the material rule."""
        if self._catalogue is None:
            out = []
            for op in openings.catalog():
                if "gambit" not in op["name"].lower():
                    continue
                board, idx, mv = _last_offer(None, op["uci"])
                sac = sacrifice(board, mv)
                if sac["pawns"] >= 1 and idx == len(op["uci"]) - 1:      # the line must end with the offer itself
                    out.append({"opening_id": op["id"], "name": op["name"], "eco": op["eco"], "color": "white" if board.turn else "black",
                                "moves": op["uci"][:idx + 1], "san": board.san(mv), "pawns": sac["pawns"], "idea": op.get("idea"),
                                "line_text": numbered(chess.Board(), op["moves"][:idx + 1]), "fen": board.fen()})
            best: dict[tuple[str, str], dict[str, Any]] = {}
            for g in sorted(out, key=lambda g: len(g["moves"])):      # sub-lines of a gambit by the same side are the same gambit
                if not any(k["color"] == g["color"] and g["moves"][:len(k["moves"])] == k["moves"] for k in best.values()):
                    best[(pos_key(chess.Board(g["fen"])), g["moves"][-1])] = g
            self._catalogue = sorted(best.values(), key=lambda g: g["name"])
        return self._catalogue

    def levels_for(self, engine_id: str) -> dict[str, Any]:
        """A sensible ladder for this engine, using its own strength controls where it has them."""
        row = self.engines.get(engine_id)
        opts = {k.lower(): v for k, v in row.get("options", {}).items()}
        if "uci_elo" in opts and "uci_limitstrength" in opts:
            lo, hi = int(opts["uci_elo"].get("min") or 1320), int(opts["uci_elo"].get("max") or 3190)
            hi = min(hi, 2800)
            steps = [round((lo + (hi - lo) * i / 5) / 50) * 50 for i in range(6)]
            return {"mechanism": "the engine's own UCI_Elo calibration (approximate, and not human Elo)",
                    "levels": [{"mode": "elo", "elo": e} for e in dict.fromkeys(steps)] + [{"mode": "full"}]}
        if "skill level" in opts:
            hi = int(opts["skill level"].get("max") or 20)
            return {"mechanism": "the engine's Skill Level", "levels": [{"mode": "skill", "skill": s} for s in sorted({0, hi // 5, 2 * hi // 5, 3 * hi // 5, 4 * hi // 5, hi})]}
        return {"mechanism": "search depth — this engine has no strength setting, so each level is how many plies it looks ahead",
                "levels": [{"mode": "depth", "depth": d} for d in (1, 2, 3, 4, 5, 6)]}

    # ------------------------------------------------------------------ engine helpers
    async def _score_moves(self, h: EngineHandle, board: chess.Board, moves: list[chess.Move], budget: Budget,
                           cancel: asyncio.Event | None) -> dict[str, dict[str, Any]]:
        """Evaluate specific root moves (one MultiPV search when the engine can, else one search each)."""
        out: dict[str, dict[str, Any]] = {}
        todo = list(moves)
        while todo and not (cancel is not None and cancel.is_set()) and not h.closed:
            res = await adaptive_search(h, board, budget, multipv=len(todo), root_moves=todo, cancel=cancel)
            got = [l for l in res["lines"] if not l.get("no_info") and chess.Move.from_uci(l["move"]) in todo]
            if not got:
                break
            for l in got:
                out[l["move"]] = l
            todo = [m for m in todo if m.uci() not in out]
        return out

    # ------------------------------------------------------------------ assessment
    async def assess(self, h: EngineHandle, board: chess.Board, move: chess.Move, budget: Budget, *, horizon: int = 8,
                     cancel: asyncio.Event | None = None, human_book_id: str | None = None,
                     tick: Callable[[], None] | None = None) -> dict[str, Any]:
        """Everything about one gambit move from `board` (the position before the offer)."""
        tick = tick or (lambda: None)
        budget = _full(budget)
        color = board.turn
        me = "white" if color else "black"
        sac = sacrifice(board, move)
        base_balance = balance(board, color)
        ver = await evaluate_move(h, board, move, budget, multipv=4, cancel=cancel)
        tick()
        if not ver.get("score"):
            raise GambitError("The engine returned no evaluation for this move")
        cost = ver["loss"]["expected_loss"]
        after = board.copy(stack=False)
        after.push(move)
        san = board.san(move)
        d: dict[str, Any] = {"sacrifice": sac, "engine": h.name, "depth": ver["depth"], "budget": budget.to_dict(),
                             "rank": ver["rank"], "rank_exact": ver["rank_exact"], "best_instead": ver["best_san"],
                             "score": ver["score"], "best_score": ver["best_score"], "fen_after": after.fen(),
                             "line_text": numbered(board, [san]), "horizon": horizon}
        d["expected_before"] = round(Score.from_dict(ver["best_score"]).expected(), 3)
        d["expected_after_offer"] = round(Score.from_dict(ver["score"]).expected(), 3)

        # --- the defender's choice: take it or leave it
        rows: list[dict[str, Any]] = []
        traps: list[dict[str, Any]] = []
        accept_mv = shown = None
        replies: list[dict[str, Any]] = []
        scored: dict[str, dict[str, Any]] = {}
        takers: list[chess.Move] = []
        if not after.is_game_over():
            reply_res = await ranked_candidates(h, after, 4, budget, cancel=cancel)
            replies = reply_res["candidates"]
            tick()
            caps = [m for m in after.generate_legal_captures()]
            takers = [m for m in caps if see(after, m) >= 1] or ([m for m in caps if see(after, m) >= 0] if sac["declined_recapture"] else [])
            scored = {c["move"]: c for c in replies}
            greedy = chess.Move.from_uci(sac["accept"]) if sac["accept"] else None      # the capture the offer invites
            missing = [m for m in ([greedy] if greedy else []) + takers if m.uci() not in scored]
            missing = list(dict.fromkeys(missing))[:3]
            if missing and replies:
                extra = await self._score_moves(h, after, missing, _at_least(budget, reply_res.get("depth", 0)), cancel)
                best = Score.from_dict(replies[0]["score"])
                for u, l in extra.items():
                    scored[u] = {**l, "loss": loss_between(best, Score.from_dict(l["score"])), "rank": None}
                tick()
            ranked_takers = sorted((m for m in takers if m.uci() in scored), key=lambda m: scored[m.uci()]["loss"]["expected_loss"])
            best_take = ranked_takers[0] if ranked_takers else None
            shown = greedy if greedy is not None and greedy.uci() in scored else best_take
            # the main line follows the best way of taking; if every capture loses, it follows the engine's best reply
            accept_mv = best_take if best_take is not None and scored[best_take.uci()]["loss"]["expected_loss"] < TRAP_LOSS else None
            decline = next((c for c in replies if chess.Move.from_uci(c["move"]) not in takers), None)
            if replies:
                d["best_reply"] = {"san": replies[0]["san"], "is_accept": chess.Move.from_uci(replies[0]["move"]) in takers,
                                   "line": numbered(after, replies[0]["pv_san"][:8])}
            if shown is not None:
                a = scored[shown.uci()]
                loss = a["loss"]["expected_loss"]
                d["accept"] = {"san": after.san(shown), "uci": shown.uci(), "loss": loss, "is_mistake": loss >= TRAP_LOSS,
                               "text": ("Taking is itself the mistake" if loss >= TRAP_LOSS else
                                        "Taking is the best reply" if a.get("rank") == 1 else
                                        f"Taking is playable (costs the defender {round(loss * 100)} points)")}
                if best_take is not None and best_take != shown:
                    d["accept"]["better_capture"] = after.san(best_take)
            for m in ranked_takers + ([shown] if shown is not None and shown not in ranked_takers else []):
                a = scored[m.uci()]
                if a["loss"]["expected_loss"] >= TRAP_LOSS:
                    traps.append({"ply": 1, "san": after.san(m), "loss": a["loss"]["expected_loss"], "fen": after.fen(),
                                  "why": "accepting the offer" if m == shown else "taking the wrong way",
                                  "punish": a["pv_san"][1] if len(a.get("pv_san") or []) > 1 else None,
                                  "line": numbered(after, (a.get("pv_san") or [])[:7])})
            if decline:
                d["decline"] = {"san": decline["san"], "loss": decline["loss"]["expected_loss"],
                                "line": numbered(after, decline["pv_san"][:6]),
                                "text": ("Declining is the best reply" if decline["rank"] == 1 else
                                         f"Declining costs the defender {round(decline['loss']['expected_loss'] * 100)} points")}
            if human_book_id:
                d["human"] = self._human(human_book_id, after, takers)

        # --- follow the defender's reply with best play by both sides.  If following a line shows that the reply
        #     the engine first liked actually loses, that reply is a trap and the next one is followed instead:
        #     a cheap way of looking deeper exactly where a sacrifice needs it.
        order: list[chess.Move] = []
        for m in ([accept_mv] if accept_mv else []) + [chess.Move.from_uci(c["move"]) for c in replies] + ([shown] if shown is not None else []):
            if m not in order and m.uci() in scored:
                order.append(m)
        walks: list[dict[str, Any]] = []
        for cand in order[:3]:
            if cancel is not None and cancel.is_set():
                break
            claimed = 1 - Score.from_dict(scored[cand.uci()]["score"]).expected()
            w = await self._walk(h, after, cand, color, budget, horizon, cancel, tick)
            w.update({"move": cand, "claimed": claimed})
            walks.append(w)
            if w["last_exp"] - claimed < TRAP_LOSS:
                break                                    # the line confirmed the first impression of this reply
        main = min(walks, key=lambda w: w["last_exp"]) if walks else None
        sans, comp_board, line_board, last_exp = [], None, after, d["expected_after_offer"]
        if main:
            sans, rows, comp_board, line_board, last_exp = main["sans"], main["rows"], main["comp_board"], main["board"], main["last_exp"]
            traps += main["traps"]
            for w in walks:
                san = after.san(w["move"])
                if w is main or w["last_exp"] - main["last_exp"] < TRAP_LOSS or any(t["ply"] == 1 and t["san"] == san for t in traps):
                    continue
                is_bait = shown is not None and w["move"] == shown
                traps.append({"ply": 1, "san": san, "loss": round(w["last_exp"] - main["last_exp"], 3), "fen": after.fen(),
                              "why": ("accepting the offer" if is_bait else "the reply that looks best at first") + ", refuted only by looking further",
                              "punish": w["sans"][1] if len(w["sans"]) > 1 else None, "line": numbered(after, w["sans"][:7])})
                if is_bait and "accept" in d:
                    d["accept"].update({"is_mistake": True, "text": "Taking is itself the mistake — the engine sees it only after following the line"})
            if "accept" in d and shown is not None and main["move"] != shown and main["move"] in takers:
                d["accept"]["better_capture"] = after.san(main["move"])
        first_look = cost
        if main and (main["rows"] or main["board"].is_game_over()):
            cost = max(0.0, d["expected_before"] - last_exp)     # risk and 'where you stand after best defence' always agree
        comp = compensation(comp_board or after, color)
        end_balance = balance(line_board, color)
        d["main_line"] = numbered(after, sans)
        d["main_line_uci_from_offer"] = _uci_of(after, sans)
        d["rows"] = rows
        d["traps"] = sorted(traps, key=lambda t: (t["ply"], -t["loss"]))
        d["expected_best_defence"] = round(last_exp, 3)
        d["material_end"] = end_balance - base_balance
        d["kind"] = ("true gambit" if end_balance - base_balance <= -1 else
                     "temporary sacrifice" if sac["pawns"] >= 1 else "offer")
        d["kind_text"] = {"true gambit": "The material stays gone in the engine's main line — this is paid for with activity.",
                          "temporary sacrifice": "The material comes back by force in the engine's main line — a combination rather than a gambit.",
                          "offer": "No material is actually at stake by the exchange rule; treated as a positional offer."}[d["kind"]]
        d["compensation"] = comp
        def_rows = [r for r in rows if r["side"] == "defender"]
        only_def = [r for r in def_rows if r["only_move"]]
        only_me = [r for r in rows if r["side"] == "gambiteer" and r["only_move"]]
        hard = sum(1 - r["findability"] for r in only_def)
        sting = min(1.0, 0.2 * len(only_def) + 0.25 * hard + 0.28 * len({(t["ply"], t["san"]) for t in traps}))
        d["sting"] = {"value": round(sting, 3), "only_moves_defender": len(only_def), "only_moves_gambiteer": len(only_me), "traps": len(traps),
                      "text": f"In the next {len(rows)} plies the defender must find {len(only_def)} only-move(s); "
                              f"{len(traps)} tempting move(s) lose at least {round(TRAP_LOSS * 100)} points. "
                              f"You must find {len(only_me)} only-move(s) yourself."}
        band = next(b for b in COST_BANDS if cost <= b[0])
        d["band"], d["band_text"] = band[1], band[2]
        d["risk"] = {"value": round(cost, 3), "first_look": round(first_look, 3),
                     "text": f"Against the best defence found this costs {round(cost * 100)} points of expected score: "
                             f"{round(d['expected_before'] * 100)}% before the offer ({ver['best_san']} was the engine's choice), "
                             f"{round(last_exp * 100)}% after following the line."
                             + (f" At first sight the engine put the price at {round(first_look * 100)} points; following the line changed that."
                                if abs(first_look - cost) >= 0.1 else "")}
        d["value"] = round(0.5 * sting + 0.2 * comp["score"] + 0.3 * (1 - min(1.0, cost / 0.2)), 3)
        d["note"] = ("Risk and sting come from one engine at one budget and are evidence, not proof. "
                     "Every search here uses the full budget (no early stopping). "
                     "Compensation and 'natural-looking' are board heuristics. Use the ladder to see who actually goes wrong.")
        return d

    async def _walk(self, h: EngineHandle, after: chess.Board, first: chess.Move, color: bool, budget: Budget, horizon: int,
                    cancel: asyncio.Event | None, tick: Callable[[], None]) -> dict[str, Any]:
        """Play `first` for the defender, then the engine's best move for both sides for `horizon` plies, noting what each must find."""
        board = after.copy(stack=False)
        sans = [board.san(first)]
        board.push(first)
        rows: list[dict[str, Any]] = []
        traps: list[dict[str, Any]] = []
        comp_board = None
        last_exp = (0.0 if board.is_checkmate() else 0.5) if board.is_game_over() else None
        for i in range(horizon):
            if board.is_game_over() or (cancel is not None and cancel.is_set()):
                break
            res = await ranked_candidates(h, board, 3, budget, cancel=cancel)
            ranked = res["candidates"]
            tick()
            if not ranked:
                break
            best = Score.from_dict(ranked[0]["score"])
            best_mv = chess.Move.from_uci(ranked[0]["move"])
            gap = ranked[1]["loss"]["expected_loss"] if len(ranked) > 1 else 1.0
            defender = board.turn != color
            exp_me = best.expected() if board.turn == color else 1 - best.expected()
            last_exp = exp_me
            rows.append({"ply": i + 2, "side": "defender" if defender else "gambiteer", "fen": board.fen(), "best_san": ranked[0]["san"],
                         "gap": round(gap, 3), "only_move": gap >= ONLY_MOVE_GAP and board.legal_moves.count() > 1,
                         "findability": round(naturalness(board, best_mv), 2), "expected_gambiteer": round(exp_me, 3)})
            if defender:
                found = [(chess.Move.from_uci(c["move"]), c, "a natural-looking move") for c in ranked[1:]
                         if c["loss"]["expected_loss"] >= TRAP_LOSS and naturalness(board, chess.Move.from_uci(c["move"])) >= 0.7]
                tempting = self._tempting(board, {c["move"] for c in ranked})
                if tempting:
                    extra = await self._score_moves(h, board, [m for m, _ in tempting], _at_least(budget, res.get("depth", 0)), cancel)
                    tick()
                    for mv, why in tempting:
                        l = extra.get(mv.uci())
                        if l and loss_between(best, Score.from_dict(l["score"]))["expected_loss"] >= TRAP_LOSS:
                            found.append((mv, {**l, "loss": loss_between(best, Score.from_dict(l["score"]))}, why))
                for mv, l, why in found:
                    traps.append({"ply": i + 2, "san": board.san(mv), "loss": l["loss"]["expected_loss"], "fen": board.fen(), "why": why,
                                  "punish": l["pv_san"][1] if len(l["pv_san"]) > 1 else None, "line": numbered(board, l["pv_san"][:7])})
            sans.append(ranked[0]["san"])
            board.push(best_mv)
            if board.is_checkmate():
                last_exp = 0.0 if defender else 1.0
            if comp_board is None and not defender:
                comp_board = board.copy(stack=False)     # after the gambiteer's first follow-up
        return {"sans": sans, "rows": rows, "traps": traps, "comp_board": comp_board, "board": board,
                "last_exp": 0.5 if last_exp is None else last_exp}

    def _tempting(self, board: chess.Board, known: set[str]) -> list[tuple[chess.Move, str]]:
        """Up to two moves a human reaches for that the engine did not list: greedy captures first, then natural moves."""
        out: list[tuple[chess.Move, str]] = []
        for mv in board.generate_legal_captures():
            if mv.uci() not in known and see(board, mv) >= 1:
                out.append((mv, "grabbing more material"))
        rest = sorted((m for m in board.legal_moves if m.uci() not in known and not board.is_capture(m)),
                      key=lambda m: -naturalness(board, m))
        out += [(m, "a natural-looking move") for m in rest[:1] if naturalness(board, m) >= 0.7]
        return out[:2]

    def _human(self, book_id: str, after: chess.Board, takers: list[chess.Move]) -> dict[str, Any] | None:
        ms = _moves(self.books.head(book_id), after)
        games = sum(m["games"] for m in ms)
        if not games:
            return None
        took = sum(m["games"] for m in ms if chess.Move.from_uci(m["uci"]) in takers)
        return {"games": games, "accept_share": round(took / games, 3),
                "replies": [{"san": m["san"], "games": m["games"], "share": round(m["games"] / games, 3)} for m in ms[:4]]}

    # ------------------------------------------------------------------ assess a given line
    async def assess_line(self, moves: list[str] | str, start_fen: str | None, engine: EngineSpec, budget: Budget, cancel: asyncio.Event,
                          progress: Progress, *, horizon: int = 8, human_book_id: str | None = None, opening_id: str | None = None) -> dict[str, Any]:
        if opening_id:
            hit = next((g for g in self.catalogue() if g["opening_id"] == opening_id), None)
            if not hit:
                raise GambitError("That opening is not in the gambit catalogue")
            moves, start_fen = hit["moves"], None
        toks = clean_moves(moves)
        if not toks:
            raise GambitError("Give the moves up to and including the gambit move")
        found = _last_offer(start_fen, toks)
        board, idx, mv = found
        path = list(_replay(start_fen, toks[:idx]).move_stack)
        steps = [0]
        total = horizon * 1.5 + 4

        def tick() -> None:
            steps[0] += 1
            progress(min(0.99, steps[0] / total))
        async with self.engines.session(engine, "research", "Gambit Lab") as h:
            detail = await self.assess(h, board, mv, budget, horizon=horizon, cancel=cancel, human_book_id=human_book_id, tick=tick)
        return self._store(start_fen, path, board, mv, detail, {"origin": "line", "opening_id": opening_id})

    # ------------------------------------------------------------------ search for new gambits
    async def search(self, cfg: dict[str, Any], engine: EngineSpec, budget: Budget, cancel: asyncio.Event, progress: Progress) -> dict[str, Any]:
        """Walk the lines from a start position and collect moves that give up material at an acceptable objective price."""
        start_fen = cfg.get("start_fen") or None
        if cfg.get("opening_id"):
            op = openings.find(cfg["opening_id"])
            if not op:
                raise GambitError("Unknown opening")
            start_moves = op["uci"]
        else:
            start_moves = clean_moves(cfg.get("moves") or [])
        root = _replay(start_fen, start_moves)
        color = chess.WHITE if cfg.get("color", "white") == "white" else chess.BLACK
        max_ply, max_positions = int(cfg.get("max_ply", 8)), max(1, min(60, int(cfg.get("max_positions", 14))))
        min_pawns, max_cost = max(1, int(cfg.get("min_pawns", 1))), float(cfg.get("max_cost", 0.2))
        max_results, horizon = max(1, min(12, int(cfg.get("max_results", 5)))), int(cfg.get("horizon", 8))
        book = self.books.head(cfg["book_id"]) if cfg.get("book_id") else None
        quick = _full(budget.scaled(0.5))
        frontier: list[tuple[chess.Board, list[chess.Move]]] = [(root, list(root.move_stack))]
        seen: set[str] = set()
        raw: list[dict[str, Any]] = []
        stats = {"positions": 0, "sacrifices_seen": 0, "too_costly": 0, "rescued": 0}
        doubtful: list[dict[str, Any]] = []      # too costly at first sight
        base_len = len(root.move_stack)
        async with self.engines.session(engine, "research", "Gambit Lab") as h:
            while frontier and stats["positions"] < max_positions and not cancel.is_set():
                board, path = frontier.pop(0)
                key = pos_key(board)
                if key in seen or board.is_game_over():
                    continue
                seen.add(key)
                stats["positions"] += 1
                mine = board.turn == color
                res = await ranked_candidates(h, board, 4 if mine else 2, quick, cancel=cancel)
                ranked = res["candidates"]
                if not ranked:
                    continue
                best = Score.from_dict(ranked[0]["score"])
                if mine:
                    sacs = sacrifices(board, min_pawns)[:8]
                    stats["sacrifices_seen"] += len(sacs)
                    if sacs:
                        scored = {c["move"]: c for c in ranked}
                        rest = [m for m, _ in sacs if m.uci() not in scored]
                        if rest:
                            scored.update(await self._score_moves(h, board, rest, _at_least(quick, res.get("depth", 0)), cancel))
                        for mv, sac in sacs:
                            l = scored.get(mv.uci())
                            if not l:
                                continue
                            loss = loss_between(best, Score.from_dict(l["score"]))["expected_loss"]
                            (raw if loss <= max_cost else doubtful).append({"board": board, "path": path, "move": mv, "sac": sac, "loss": loss})
                progress(min(0.5, 0.5 * stats["positions"] / max_positions))
                if len(path) - base_len >= max_ply:
                    continue
                nxt = [chess.Move.from_uci(m["uci"]) for m in (_moves(book, board)[:2] if book else [])]
                if not nxt:
                    nxt = [chess.Move.from_uci(c["move"]) for c in ranked[:1 if mine else 2]]
                for mv in nxt:
                    b = board.copy()
                    b.push(mv)
                    frontier.append((b, path + [mv]))
            raw.sort(key=lambda r: (r["loss"], -r["sac"]["pawns"]))
            doubtful.sort(key=lambda r: (r["loss"], -r["sac"]["pawns"]))
            chosen = raw[:max_results]
            second = [] if chosen else doubtful[:2]       # nothing passed at first sight: follow the two cheapest further before giving up
            stats["too_costly"] = len(doubtful) - len(second)
            chosen = chosen + second
            found = []
            for i, r in enumerate(chosen):
                if cancel.is_set():
                    break
                try:
                    detail = await self.assess(h, r["board"], r["move"], budget, horizon=horizon, cancel=cancel, human_book_id=cfg.get("human_book_id"))
                except GambitError:
                    continue
                if detail["risk"]["value"] <= max_cost * 1.25:       # the full budget may disagree with the quick look
                    stats["rescued"] += r in second
                    found.append(self._store(start_fen, r["path"], r["board"], r["move"], detail, {"origin": "search", **{k: cfg.get(k) for k in ("opening_id", "moves", "max_cost")}}))
                else:
                    stats["too_costly"] += 1
                progress(0.5 + 0.5 * (i + 1) / max(1, len(chosen)))
        found.sort(key=lambda g: -(g["detail"].get("value") or 0))
        return {"found": [self._brief(g) for g in found], "ids": [g["id"] for g in found], **stats,
                "note": f"Looked at {stats['positions']} position(s); {stats['sacrifices_seen']} sacrificial move(s) seen, "
                        f"{stats['too_costly']} rejected as costing more than {round(max_cost * 100)} points."
                        + (f" {stats['rescued']} looked too costly at first sight and proved acceptable when the line was followed." if stats["rescued"] else "")}

    # ------------------------------------------------------------------ the ladder
    async def ladder(self, gid: str, gambiteer: EngineSpec, defender: EngineSpec, levels: list[dict[str, Any]], budget: Budget,
                     cancel: asyncio.Event, progress: Progress, *, games_per_level: int = 2, horizon: int = 30,
                     defender_movetime_ms: int | None = None, seed: int | None = None) -> dict[str, Any]:
        """Play the position after the offer against each defender level and record who goes wrong, and how."""
        g = self.get(gid)
        board0 = chess.Board(g["fen"])
        offer = chess.Move.from_uci(g["move_uci"])
        color = board0.turn
        after = board0.copy(stack=False)
        after.push(offer)
        if not levels:
            raise GambitError("Choose at least one defender level")
        levels = sorted(levels, key=_level_key)
        games_per_level = max(1, min(8, int(games_per_level)))
        rng = random.Random(seed)
        takers = {m.uci() for m in after.generate_legal_captures() if see(after, m) >= 1}
        g_limit = chess.engine.Limit(time=budget.max_time, depth=budget.max_depth)
        d_time = (defender_movetime_ms or int(budget.max_time * 1000)) / 1000
        out_levels: list[dict[str, Any]] = []
        total = len(levels) * games_per_level
        done = 0
        async with self.engines.session(gambiteer, "research", "Gambit ladder — gambiteer") as gh:
            for level in levels:
                if cancel.is_set():
                    break
                st = self.strength_fn(defender, level)
                spec = EngineSpec(defender.engine_id, {**defender.options, **st.get("options", {})}, defender.profile_id, defender.label)
                kw: dict[str, Any] = {"time": (st["movetime_ms"] / 1000) if st.get("movetime_ms") else d_time}
                if st.get("depth"):
                    kw["depth"] = st["depth"]
                d_limit = chess.engine.Limit(**kw)
                games: list[dict[str, Any]] = []
                deterministic = False
                try:
                    async with self.engines.session(spec, "research", f"Gambit ladder — {level_label(level)}") as dh:
                        for n in range(games_per_level):
                            if cancel.is_set():
                                break
                            game = await self._ladder_game(gh, dh, after, color, g_limit, d_limit, budget, horizon, takers, vary=n > 0, rng=rng, cancel=cancel)
                            done += 1
                            progress(done / total)
                            if any(x["moves"] == game["moves"] for x in games):
                                deterministic = True                 # the same game again: more repetitions add nothing
                                done += games_per_level - n - 1
                                break
                            games.append(game)
                except EngineError as e:
                    out_levels.append({"level": level, "label": level_label(level), "mechanism": st.get("mechanism"), "error": str(e), "games": 0})
                    continue
                if not games:
                    continue
                n = len(games)
                won, lost = sum(x["outcome"] == "fell" for x in games), sum(x["outcome"] == "punished" for x in games)
                mistakes = Counter(x["mistake"]["san"] for x in games if x.get("mistake"))
                out_levels.append({"level": level, "label": level_label(level), "mechanism": st.get("mechanism"), "approximate": st.get("approximate", False),
                                   "games": n, "fell": won, "held": n - won - lost, "punished": lost, "fell_rate": round(won / n, 3),
                                   "accepted": sum(x["accepted"] for x in games), "avg_final": round(sum(x["final"] for x in games) / n, 3),
                                   "common_mistake": mistakes.most_common(1)[0][0] if mistakes else None, "deterministic": deterministic,
                                   "samples": games})
        report = self._ladder_verdict(out_levels)
        if cancel.is_set():
            report["partial"] = True
            report["verdict"] = "Stopped early — " + report["verdict"][0].lower() + report["verdict"][1:]
        report.update({"levels": out_levels, "gambiteer": gh.name, "defender_engine": self.engines.get(defender.engine_id)["name"],
                       "horizon": horizon, "games_per_level": games_per_level, "budget": budget.to_dict(), "at": now(),
                       "thresholds": {"fell": WON, "punished": LOST},
                       "note": "A defender 'falls for it' when the gambiteer's engine rates its own position at 70% or better by the end of the "
                               f"{horizon}-ply test; the gambit is 'punished' at 35% or worse. Engine levels are not human ratings: a weakened "
                               "engine errs by shallow or noisy search, not by greed or habit. With a depth ladder the result reads directly as "
                               "'how many plies of lookahead the defence needs'."})
        self.db.update("gambits", gid, {"report": report, "status": "tested", "updated_at": now()})
        return report

    async def _ladder_game(self, gh: EngineHandle, dh: EngineHandle, after: chess.Board, color: bool, g_limit: chess.engine.Limit,
                           d_limit: chess.engine.Limit, budget: Budget, horizon: int, takers: set[str], *, vary: bool,
                           rng: random.Random, cancel: asyncio.Event) -> dict[str, Any]:
        board = after.copy(stack=False)
        sans: list[str] = []
        ucis: list[str] = []
        curve: list[dict[str, Any]] = []            # gambiteer's own evaluation each time it moves
        accepted = False
        decided = 0
        g_moves = 0
        while len(ucis) < horizon and not board.is_game_over(claim_draw=True) and not cancel.is_set():
            if board.turn == color:
                exp = None
                mv = None
                if vary and g_moves < 2:                 # later games: pick among near-equal moves so games differ
                    cands = (await ranked_candidates(gh, board, 3, budget, cancel=cancel))["candidates"]
                    ok = [c for c in cands if c["loss"]["expected_loss"] <= 0.04]
                    if ok:
                        pick = rng.choice(ok)
                        mv, exp = chess.Move.from_uci(pick["move"]), Score.from_dict(cands[0]["score"]).expected()
                if mv is None:
                    res = await gh.play(board, g_limit)
                    mv = res["move"]
                    if res["line"] and not res["line"].get("no_info"):
                        exp = Score.from_dict(res["line"]["score"]).expected()
                g_moves += 1
                if exp is not None:
                    curve.append({"ply": len(ucis), "expected": round(exp, 3)})
                    decided = decided + 1 if (exp >= 0.97 or exp <= 0.03) else 0
            else:
                res = await dh.play(board, d_limit)
                mv = res["move"]
                if len(ucis) == 0 and mv.uci() in takers:
                    accepted = True
            sans.append(board.san(mv))
            ucis.append(mv.uci())
            board.push(mv)
            if decided >= 2:
                break
        if board.is_checkmate():
            final = 1.0 if board.turn != color else 0.0
        elif board.is_game_over(claim_draw=True):
            final = 0.5
        elif cancel.is_set():
            final = curve[-1]["expected"] if curve else 0.5
        else:
            res = await adaptive_search(gh, board, budget, cancel=cancel)
            final = curve[-1]["expected"] if curve else 0.5
            if res["lines"] and not res["lines"][0].get("no_info"):
                s = Score.from_dict(res["lines"][0]["score"]).expected()
                final = s if board.turn == color else 1 - s
            curve.append({"ply": len(ucis), "expected": round(final, 3)})
        mistake = None
        for a, b in zip(curve, curve[1:]):
            rise = b["expected"] - a["expected"]
            if rise >= 0.1 and (mistake is None or rise > mistake["swing"]) and a["ply"] < len(sans):
                # the defender's move right after the gambiteer's evaluation at ply a
                idx = a["ply"] + 1
                if idx < len(sans):
                    mistake = {"san": sans[idx], "ply": idx, "swing": round(rise, 3), "fen": _fen_at(after, ucis[:idx])}
        if mistake is None and curve and curve[0]["ply"] > 0 and curve[0]["expected"] >= WON and sans:
            mistake = {"san": sans[0], "ply": 0, "swing": None, "fen": after.fen()}
        return {"moves": numbered(after, sans), "uci": ucis, "accepted": accepted, "final": round(final, 3), "curve": curve,
                "outcome": "fell" if final >= WON else "punished" if final <= LOST else "held", "mistake": mistake,
                "mate": board.is_checkmate(), "plies": len(ucis)}

    @staticmethod
    def _ladder_verdict(levels: list[dict[str, Any]]) -> dict[str, Any]:
        ok = [l for l in levels if l.get("games")]
        if not ok:
            return {"verdict": "No games were completed.", "falls_up_to": None, "holds_from": None, "punished_from": None}
        falls = None
        for l in ok:
            if l["fell_rate"] >= 0.5:
                falls = l["label"]
            else:
                break
        holds = next((l["label"] for i, l in enumerate(ok) if all(x["fell"] == 0 for x in ok[i:])), None)
        punished = next((l["label"] for i, l in enumerate(ok) if all(x["punished"] * 2 >= x["games"] for x in ok[i:])), None)
        parts = []
        if falls:
            parts.append(f"works up to {falls}")
        else:
            parts.append(f"even {ok[0]['label']} did not fall for it")
        if holds:
            parts.append(f"from {holds} the defender no longer goes wrong")
        if punished:
            parts.append(f"from {punished} the gambit is punished")
        if falls and not holds:
            parts.append("no tested level was safe from it")
        text = "; ".join(parts)
        return {"verdict": text[0].upper() + text[1:] + ".", "falls_up_to": falls, "holds_from": holds, "punished_from": punished}


# ---------------------------------------------------------------------------------------------- helpers
def _replay(start_fen: str | None, moves: list[Any]) -> chess.Board:
    board = chess.Board(start_fen) if start_fen else chess.Board()
    for t in moves:
        try:
            board.push(t if isinstance(t, chess.Move) else parse_move(board, t))
        except ValueError:
            raise GambitError(f"'{t}' is not a legal move in this line")
    return board


def _last_offer(start_fen: str | None, moves: list[str]) -> tuple[chess.Board, int, chess.Move]:
    """The gambit move of a line: its last move that gives up material, or simply its last move."""
    board = chess.Board(start_fen) if start_fen else chess.Board()
    hit = None
    last = None
    for i, t in enumerate(moves):
        try:
            mv = parse_move(board, t)
        except ValueError:
            raise GambitError(f"'{t}' is not a legal move in this line")
        if sacrifice(board, mv)["pawns"] >= 1:
            hit = (board.copy(), i, mv)
        last = (board.copy(), i, mv)
        board.push(mv)
    return hit or last  # type: ignore[return-value]


def _uci_of(board: chess.Board, sans: list[str]) -> list[str]:
    b = board.copy(stack=False)
    out = []
    for s in sans:
        mv = b.parse_san(s)
        out.append(mv.uci())
        b.push(mv)
    return out


def _fen_at(board: chess.Board, ucis: list[str]) -> str:
    b = board.copy(stack=False)
    for u in ucis:
        b.push_uci(u)
    return b.fen()

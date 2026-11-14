"""Adaptive, bounded search and ranked candidate selection.

* `adaptive_search` spends more time when candidates are close, rankings are unstable or
  the position is tactical, and less when the answer is forced/resolved/stable.  It is
  never infinite: explicit maxima always apply and the reason for stopping is recorded.
* `ranked_candidates` returns the engine's 1st..Nth candidate with MultiPV, and falls back
  to restricted-root (`searchmoves`) searches when the engine cannot supply enough lines.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import asdict, dataclass
from typing import Any, Callable

import chess
import chess.engine

from ..chessx import Score, loss_between, pos_key, tactical_complexity
from ..db import Database, new_id, now
from .manager import EngineError, EngineHandle, line_from_info


@dataclass
class Budget:
    min_time: float = 0.2
    max_time: float = 5.0
    min_depth: int = 6
    max_depth: int = 40
    max_nodes: int | None = None
    stability_iterations: int = 3      # consecutive completed depths with the same best move
    stability_cp: int = 20             # ...and an evaluation drift no larger than this
    close_margin: float = 0.02         # expected-score gap under which top candidates are "close"
    resolved_expected: float = 0.97    # position considered decided beyond this expected score
    adaptive: bool = True

    @staticmethod
    def from_dict(d: dict[str, Any] | None) -> "Budget":
        b = Budget()
        for k, v in (d or {}).items():
            if hasattr(b, k) and v is not None:
                setattr(b, k, type(getattr(b, k))(v) if getattr(b, k) is not None else v)
        b.max_time = max(b.max_time, b.min_time, 0.01)
        b.max_depth = max(b.max_depth, b.min_depth, 1)
        return b

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def scaled(self, factor: float) -> "Budget":
        b = Budget(**asdict(self))
        b.min_time, b.max_time = self.min_time * factor, self.max_time * factor
        return b


STOP_REASONS = {
    "terminal": "Position is already decided (no legal moves)",
    "single_legal_move": "Only one legal move exists",
    "stable": "Best move and evaluation were stable across consecutive depths",
    "resolved": "Position is clearly resolved",
    "max_time": "Maximum time budget reached",
    "max_depth": "Maximum depth reached",
    "max_nodes": "Node budget reached",
    "engine_finished": "Engine ended the search by itself",
    "cancelled": "Search was cancelled",
    "engine_failed": "Engine failed during the search",
}


async def adaptive_search(handle: EngineHandle, board: chess.Board, budget: Budget, *, multipv: int = 1,
                          root_moves: list[chess.Move] | None = None,
                          on_update: Callable[[list[dict[str, Any]], dict[str, Any]], None] | None = None,
                          cancel: asyncio.Event | None = None) -> dict[str, Any]:
    """Run one bounded search and report lines + the reason it stopped."""
    t0 = time.perf_counter()
    legal = [m for m in board.legal_moves if not root_moves or m in root_moves]
    base = {"fen": board.fen(), "budget": budget.to_dict(), "engine": handle.name, "engine_sig": handle.signature,
            "multipv_requested": multipv}
    if not legal:
        return {**base, "lines": [], "stop_reason": "terminal", "elapsed": 0.0, "depth": 0, "history": []}
    complexity = tactical_complexity(board)
    # Tactical positions get a higher floor before "stable" may end the search.
    min_time = budget.min_time * (1.0 + (1.2 * complexity if budget.adaptive else 0.0))
    min_time = min(min_time, budget.max_time)
    limit = chess.engine.Limit(time=budget.max_time, depth=budget.max_depth, nodes=budget.max_nodes)
    try:
        analysis = await handle.stream(board, limit, multipv=multipv, root_moves=root_moves)
    except EngineError:
        return {**base, "lines": [], "stop_reason": "engine_failed", "elapsed": time.perf_counter() - t0, "depth": 0,
                "history": []}
    handle.busy = True
    reason = "engine_finished"
    history: list[dict[str, Any]] = []     # one entry per completed depth of the principal line
    last_depth = 0
    last_emit = 0.0
    hard_deadline = t0 + budget.max_time * 2 + 10

    def snapshot() -> list[dict[str, Any]]:
        lines = [l for i, inf in enumerate(analysis.multipv) if (l := line_from_info(board, inf, i + 1))]
        lines.sort(key=lambda l: l["multipv"])
        return lines

    try:
        while True:
            try:
                info = await asyncio.wait_for(analysis.get(), 0.25)
            except asyncio.TimeoutError:
                info = None
            except chess.engine.AnalysisComplete:
                break
            now_t = time.perf_counter()
            elapsed = now_t - t0
            if cancel is not None and cancel.is_set():
                reason = "cancelled"
                break
            if now_t > hard_deadline:
                reason = "engine_failed"
                handle.manager.resources.note_crash(handle.name, "search exceeded hard guard; process terminated")
                analysis.stop()
                await handle.close(force=True)
                break
            if info is None:
                continue
            lines = snapshot()
            if not lines:
                continue
            top = lines[0]
            depth = top.get("depth") or 0
            if on_update and now_t - last_emit > 0.12:
                last_emit = now_t
                on_update(lines, {"elapsed": elapsed, "depth": depth})
            if depth > last_depth and info.get("multipv", 1) == 1:
                last_depth = depth
                history.append({"depth": depth, "move": top["move"], "score": top["score"], "t": round(elapsed, 3),
                                "order": [l["move"] for l in lines]})
            if not budget.adaptive:
                continue
            if len(legal) == 1 and depth >= 1:
                reason = "single_legal_move"
                break
            if elapsed < min_time or depth < budget.min_depth:
                continue
            k = budget.stability_iterations
            recent = history[-k:]
            stable = len(recent) >= k and len({h["move"] for h in recent}) == 1 and _drift(recent) <= budget.stability_cp
            top_s = Score.from_dict(top["score"])
            resolved = (top_s.expected() >= budget.resolved_expected or top_s.expected() <= 1 - budget.resolved_expected)
            if resolved and len(recent) >= 2 and recent[-1]["move"] == recent[-2]["move"]:
                reason = "resolved"
                break
            if stable:
                close = False
                if len(lines) > 1:
                    gap = loss_between(top_s, Score.from_dict(lines[1]["score"]))["expected_loss"]
                    close = gap <= budget.close_margin
                order_unstable = len(recent) >= 2 and multipv > 1 and \
                    recent[-1]["order"][:multipv] != recent[-2]["order"][:multipv]
                # Close or reshuffling candidates earn extra time, up to 60% of the maximum.
                if (close or order_unstable) and elapsed < budget.max_time * 0.6:
                    continue
                reason = "stable"
                break
    except chess.engine.EngineTerminatedError as e:
        reason = "engine_failed"
        await handle._crashed(str(e))
    except asyncio.CancelledError:
        analysis.stop()
        handle.busy = False
        raise
    finally:
        handle.busy = False
    lines = snapshot()
    if not handle.closed:
        analysis.stop()
        try:
            await asyncio.wait_for(analysis.wait(), 5)
        except (asyncio.TimeoutError, chess.engine.EngineError):
            await handle.close(force=True)
            if reason not in ("cancelled",):
                reason = "engine_failed"
        lines = snapshot() or lines
    elapsed = time.perf_counter() - t0
    depth = (lines[0].get("depth") or 0) if lines else 0
    if reason == "engine_finished":
        nodes = (lines[0].get("nodes") or 0) if lines else 0
        if budget.max_nodes and nodes >= budget.max_nodes * 0.98:
            reason = "max_nodes"
        elif depth >= budget.max_depth:
            reason = "max_depth"
        elif elapsed >= budget.max_time * 0.9:
            reason = "max_time"
        elif len(legal) == 1:
            reason = "single_legal_move"
    return {**base, "lines": lines, "stop_reason": reason, "stop_detail": STOP_REASONS.get(reason, reason),
            "elapsed": round(elapsed, 3), "depth": depth, "history": history[-40:], "complexity": round(complexity, 3)}


def _drift(recent: list[dict[str, Any]]) -> float:
    scores = [Score.from_dict(h["score"]) for h in recent]
    if any(s.is_mate for s in scores):
        return 0.0 if len({s.mate for s in scores}) == 1 else 10_000.0
    cps = [s.cp or 0 for s in scores]
    return float(max(cps) - min(cps))


# ---------------------------------------------------------------------------
# Ranked candidates
# ---------------------------------------------------------------------------
async def ranked_candidates(handle: EngineHandle, board: chess.Board, n: int, budget: Budget, *,
                            cancel: asyncio.Event | None = None,
                            exclude: set[chess.Move] | None = None) -> dict[str, Any]:
    """Rank up to `n` legal moves by the engine's current evidence.

    1. One MultiPV search for as many lines as the engine supports.
    2. If that yields fewer than `n` candidates (no MultiPV, or MultiPV max too small),
       restricted-root searches over the not-yet-ranked legal moves fill the remaining ranks.
    Ranks are evidence at this depth/budget — not permanent truths — so the ranking
    engine, depth and budget are returned alongside every candidate.
    """
    legal = [m for m in board.legal_moves if not exclude or m not in exclude]
    n = max(1, min(n, len(legal)))
    out: dict[str, Any] = {"fen": board.fen(), "epd": pos_key(board), "legal_count": board.legal_moves.count(),
                           "engine": handle.name, "engine_sig": handle.signature, "requested": n,
                           "budget": budget.to_dict(), "method": "multipv", "candidates": [], "searches": []}
    if not legal:
        out["stop_reason"] = "terminal"
        return out
    first = await adaptive_search(handle, board, budget, multipv=n, root_moves=legal if exclude else None, cancel=cancel)
    out["searches"].append({"stop_reason": first["stop_reason"], "elapsed": first["elapsed"], "depth": first["depth"]})
    out["stop_reason"] = first["stop_reason"]
    lines = list(first["lines"])
    ranked_moves = [chess.Move.from_uci(l["move"]) for l in lines]
    # Fallback: restricted root searches for the ranks MultiPV did not provide.
    if len(lines) < n and first["stop_reason"] not in ("cancelled", "engine_failed"):
        out["method"] = "multipv+restricted_root" if len(lines) > 1 else "restricted_root"
        per = budget.scaled(max(0.25, 1.0 / max(1, n - len(lines))))
        while len(lines) < n:
            remaining = [m for m in legal if m not in ranked_moves]
            if not remaining or (cancel is not None and cancel.is_set()) or handle.closed:
                break
            res = await adaptive_search(handle, board, per, multipv=1, root_moves=remaining, cancel=cancel)
            out["searches"].append({"stop_reason": res["stop_reason"], "elapsed": res["elapsed"], "depth": res["depth"]})
            if not res["lines"]:
                break
            line = dict(res["lines"][0])
            mv = chess.Move.from_uci(line["move"])
            if mv not in remaining:   # engine ignored searchmoves: stop rather than fabricate ranks
                out["method"] += " (engine ignored searchmoves; remaining ranks unavailable)"
                break
            ranked_moves.append(mv)
            lines.append(line)
        # Restricted searches may reach different depths, so re-sort by score evidence.
        lines.sort(key=lambda l: Score.from_dict(l["score"]).order_key(), reverse=True)
    best = Score.from_dict(lines[0]["score"]) if lines else Score()
    for i, l in enumerate(lines):
        s = Score.from_dict(l["score"])
        out["candidates"].append({**l, "rank": i + 1, "loss": loss_between(best, s)})
    out["available"] = len(out["candidates"])
    out["depth"] = min((c.get("depth") or 0) for c in out["candidates"]) if out["candidates"] else 0
    return out


def rank_of(candidates: list[dict[str, Any]], move_uci: str) -> int | None:
    for c in candidates:
        if c["move"] == move_uci:
            return c["rank"]
    return None


async def evaluate_move(handle: EngineHandle, board: chess.Board, move: chess.Move, budget: Budget, *,
                        multipv: int = 5, cancel: asyncio.Event | None = None) -> dict[str, Any]:
    """Independent verification of one move: rank within the verifier's MultiPV, and — if it
    is outside the MultiPV window — its own restricted-root evaluation.
    """
    ranked = await ranked_candidates(handle, board, multipv, budget, cancel=cancel)
    cands = ranked["candidates"]
    best = Score.from_dict(cands[0]["score"]) if cands else Score()
    found = next((c for c in cands if c["move"] == move.uci()), None)
    result: dict[str, Any] = {"engine": handle.name, "engine_sig": handle.signature, "depth": ranked.get("depth", 0),
                              "best_move": cands[0]["move"] if cands else None,
                              "best_san": cands[0]["san"] if cands else None, "best_score": best.to_dict(),
                              "window": len(cands), "stop_reason": ranked.get("stop_reason"), "top": cands[:multipv]}
    if found:
        result.update({"rank": found["rank"], "rank_exact": True, "score": found["score"], "pv_san": found["pv_san"],
                       "loss": found["loss"]})
        return result
    if cancel is not None and cancel.is_set() or handle.closed:
        result.update({"rank": None, "rank_exact": False, "score": None, "loss": None})
        return result
    res = await adaptive_search(handle, board, budget, multipv=1, root_moves=[move], cancel=cancel)
    if res["lines"]:
        s = Score.from_dict(res["lines"][0]["score"])
        result.update({"rank": len(cands) + 1, "rank_exact": False, "score": s.to_dict(),
                       "pv_san": res["lines"][0]["pv_san"], "loss": loss_between(best, s),
                       "depth": min(result["depth"] or 99, res["depth"])})
    else:
        result.update({"rank": None, "rank_exact": False, "score": None, "loss": None})
    return result


# ---------------------------------------------------------------------------
# Analysis cache (deduplication across transpositions)
# ---------------------------------------------------------------------------
class AnalysisCache:
    """Stores finished analyses keyed by position identity + engine signature.

    A cached result is reused only when it is at least as deep and at least as wide
    (MultiPV) as requested and came from the *same* engine configuration; different
    configurations are stored side by side, never merged.
    """

    def __init__(self, db: Database):
        self.db = db
        self.hits = 0
        self.misses = 0

    def lookup(self, board: chess.Board, engine_sig: str, min_depth: int, multipv: int) -> dict[str, Any] | None:
        rows = self.db.all("analysis", "epd=? AND engine_sig=? AND depth>=? AND multipv>=?",
                           (pos_key(board), engine_sig, min_depth, multipv), order="depth DESC", limit=1)
        if rows:
            self.hits += 1
            return rows[0]
        self.misses += 1
        return None

    def store(self, board: chess.Board, result: dict[str, Any], multipv: int) -> str | None:
        lines = result.get("lines") or result.get("candidates") or []
        if not lines or result.get("stop_reason") in ("cancelled", "engine_failed"):
            return None
        top = lines[0]
        row = {"id": new_id("an"), "epd": pos_key(board), "engine_sig": result["engine_sig"], "engine_name": result["engine"],
               "depth": result.get("depth") or top.get("depth") or 0, "seldepth": top.get("seldepth"),
               "nodes": top.get("nodes"), "time_ms": int(result.get("elapsed", 0) * 1000) if "elapsed" in result else top.get("time_ms"),
               "multipv": max(multipv, len(lines)) if len(lines) >= multipv else len(lines), "lines": lines,
               "stop_reason": result.get("stop_reason"), "budget": result.get("budget", {}), "created_at": now()}
        self.db.insert("analysis", row)
        return row["id"]

    def for_position(self, board: chess.Board) -> list[dict[str, Any]]:
        return self.db.all("analysis", "epd=?", (pos_key(board),), order="depth DESC", limit=20)

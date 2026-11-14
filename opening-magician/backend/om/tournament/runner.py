"""Engine-versus-engine game runner.

Two time policies, never mixed up:
  * "clock"  — a real chess clock. Wall time is measured around every move, increments are
               applied, and a side that runs out of time loses on time.
  * "noflag" — research mode: no chess clock at all. Every move gets a bounded adaptive
               search budget (min/max time, depth, nodes), so nobody can lose on time and
               nobody can think forever.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import chess
import chess.engine

from ..chessx import START_FEN, Score, pgn_from_moves, result_of
from ..engines.manager import EngineError, EngineHandle, EngineManager, EngineSpec
from ..engines.search import Budget, adaptive_search

MovePolicy = Callable[[chess.Board, int, EngineHandle, str], Awaitable[dict[str, Any] | None]]

DEFAULT_ADJUDICATION = {"enabled": True, "max_plies": 300, "resign_cp": 900, "resign_moves": 4,
                        "draw_cp": 8, "draw_moves": 12, "draw_after_ply": 70}


@dataclass
class GameSpec:
    white: EngineSpec
    black: EngineSpec
    white_name: str = "White"
    black_name: str = "Black"
    start_fen: str | None = None
    opening_moves: list[str] = field(default_factory=list)   # UCI or SAN, played before engines take over
    opening_name: str = ""
    time: dict[str, Any] = field(default_factory=lambda: {"mode": "noflag", "budget": {"min_time": 0.05, "max_time": 0.5}})
    adjudication: dict[str, Any] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)
    purpose: str = "tournament"


async def play_game(manager: EngineManager, spec: GameSpec, *, on_move: Callable[[dict[str, Any]], None] | None = None,
                    cancel: asyncio.Event | None = None, policy: MovePolicy | None = None) -> dict[str, Any]:
    """Play one game to a rules result, an adjudication, a time forfeit or an engine failure.
    Always returns a complete record (PGN included) for whatever was played."""
    adj = {**DEFAULT_ADJUDICATION, **(spec.adjudication or {})}
    board = chess.Board(spec.start_fen) if spec.start_fen and spec.start_fen != START_FEN else chess.Board()
    start_fen = board.fen()
    moves: list[chess.Move] = []
    evals: list[dict[str, Any]] = []
    comments: dict[int, str] = {}
    book_plies = 0
    for mv in spec.opening_moves:
        try:
            m = board.parse_uci(mv) if (len(mv) in (4, 5) and mv[1].isdigit()) else board.parse_san(mv)
        except ValueError:
            break
        board.push(m)
        moves.append(m)
        book_plies += 1
    mode = spec.time.get("mode", "noflag")
    budget = Budget.from_dict(spec.time.get("budget"))
    clocks = {chess.WHITE: float(spec.time.get("base_ms", 60_000)), chess.BLACK: float(spec.time.get("base_ms", 60_000))}
    inc = float(spec.time.get("inc_ms", 0))
    overhead = float(spec.time.get("overhead_ms", 20))
    result, termination, detail = "*", "unterminated", ""
    resign_run = {chess.WHITE: 0, chess.BLACK: 0}
    draw_run = 0
    last_score: dict[bool, Score | None] = {chess.WHITE: None, chess.BLACK: None}
    names = {chess.WHITE: spec.white_name, chess.BLACK: spec.black_name}
    t_game = time.time()
    handles: dict[bool, EngineHandle] = {}
    game_token = object()
    policy_log: list[dict[str, Any]] = []
    try:
        try:
            opened = await manager.open_many([(spec.white, spec.purpose, spec.white_name), (spec.black, spec.purpose, spec.black_name)])
            handles = {chess.WHITE: opened[0], chess.BLACK: opened[1]}
        except EngineError as e:
            return _record(spec, start_fen, moves, evals, comments, "*", "engine_start_failed", str(e), t_game, book_plies,
                           policy_log, retryable=True)
        for h in handles.values():
            h._game = game_token
        while True:
            over = result_of(board, claim_draw=True)
            if over:
                result, termination = over
                break
            if cancel is not None and cancel.is_set():
                termination, detail = "cancelled", "Game cancelled before completion"
                break
            ply = len(moves)
            if adj["enabled"] and ply >= adj["max_plies"]:
                result, termination, detail = "1/2-1/2", "adjudication_max_plies", f"Drawn by adjudication at ply {ply}"
                break
            side = board.turn
            h = handles[side]
            t0 = time.perf_counter()
            chosen: chess.Move | None = None
            line: dict[str, Any] | None = None
            extra: dict[str, Any] = {}
            try:
                if policy is not None:
                    decision = await policy(board, ply, h, "white" if side else "black")
                    if decision:
                        chosen = decision["move"]
                        line = decision.get("line")
                        extra = {k: v for k, v in decision.items() if k not in ("move", "line")}
                        policy_log.append({"ply": ply, "san": board.san(chosen), **extra})
                if chosen is None:
                    if mode == "clock":
                        limit = chess.engine.Limit(white_clock=max(0.01, clocks[chess.WHITE] / 1000),
                                                   black_clock=max(0.01, clocks[chess.BLACK] / 1000),
                                                   white_inc=inc / 1000, black_inc=inc / 1000)
                        res = await h.play(board, limit, game=game_token)
                        chosen, line = res["move"], res["line"]
                    else:
                        res = await adaptive_search(h, board, budget, multipv=1, cancel=cancel)
                        if res["stop_reason"] == "cancelled":
                            termination, detail = "cancelled", "Game cancelled before completion"
                            break
                        if not res["lines"]:
                            raise EngineError(f"{h.name} produced no move ({res['stop_reason']})")
                        line = res["lines"][0]
                        chosen = chess.Move.from_uci(line["move"])
                        extra = {"stop_reason": res["stop_reason"]}
            except EngineError as e:
                result = "0-1" if side == chess.WHITE else "1-0"
                termination, detail = "engine_error", f"{names[side]}: {e}"
                break
            used_ms = (time.perf_counter() - t0) * 1000
            if chosen not in board.legal_moves:
                result = "0-1" if side == chess.WHITE else "1-0"
                termination, detail = "illegal_move", f"{names[side]} played an illegal move {chosen}"
                break
            if mode == "clock":
                clocks[side] -= max(0.0, used_ms - overhead)
                if clocks[side] <= 0:
                    result = "0-1" if side == chess.WHITE else "1-0"
                    termination, detail = "time_forfeit", f"{names[side]} lost on time"
                    break
                clocks[side] += inc
            score = Score.from_dict(line["score"]) if line else Score()
            white_score = score if side == chess.WHITE else score.negate()
            san = board.san(chosen)
            fen_before = board.fen()
            board.push(chosen)
            moves.append(chosen)
            last_score[side] = score if score.known else None
            ev = {"ply": ply + 1, "san": san, "uci": chosen.uci(), "side": "w" if side else "b",
                  "score": score.to_dict() if score.known else None, "text": white_score.text() if score.known else None,
                  "expected_white": round(white_score.expected(), 4) if score.known else None,
                  "depth": line.get("depth") if line else None, "nodes": line.get("nodes") if line else None,
                  "time_ms": round(used_ms), "fen_before": fen_before, "fen_after": board.fen(), **extra}
            if mode == "clock":
                ev["clock_ms"] = {"white": round(clocks[chess.WHITE]), "black": round(clocks[chess.BLACK])}
            evals.append(ev)
            if score.known:
                comments[len(moves) - 1] = f"{white_score.text()}/{ev['depth'] or 0} {used_ms / 1000:.2f}s"
            if on_move:
                on_move(ev)
            # --- adjudication (both engines must agree) ---
            if adj["enabled"] and score.known:
                mine, theirs = score, last_score[not side]
                losing = (mine.mate is not None and mine.mate < 0) or (mine.cp is not None and mine.cp <= -adj["resign_cp"])
                resign_run[side] = resign_run[side] + 1 if losing else 0
                if resign_run[side] >= adj["resign_moves"] and theirs is not None and \
                        ((theirs.mate is not None and theirs.mate > 0) or (theirs.cp is not None and theirs.cp >= adj["resign_cp"])):
                    result = "0-1" if side == chess.WHITE else "1-0"
                    termination = "adjudication_resign"
                    detail = f"Adjudicated: both engines agreed {names[side]} was lost for {adj['resign_moves']} moves"
                    break
                flat = mine.cp is not None and not mine.is_mate and abs(mine.cp) <= adj["draw_cp"]
                draw_run = draw_run + 1 if (flat and len(moves) >= adj["draw_after_ply"]) else 0
                if draw_run >= adj["draw_moves"] * 2:
                    result, termination = "1/2-1/2", "adjudication_draw"
                    detail = f"Adjudicated draw: evaluation within ±{adj['draw_cp']}cp for {adj['draw_moves']} moves"
                    break
    finally:
        for h in handles.values():
            await h.close()
    return _record(spec, start_fen, moves, evals, comments, result, termination, detail, t_game, book_plies, policy_log)


def _record(spec: GameSpec, start_fen: str, moves: list[chess.Move], evals: list[dict[str, Any]], comments: dict[int, str],
            result: str, termination: str, detail: str, t0: float, book_plies: int, policy_log: list[dict[str, Any]],
            retryable: bool = False) -> dict[str, Any]:
    tc = spec.time
    if tc.get("mode") == "clock":
        tc_text = f"{tc.get('base_ms', 60000) / 1000:g}+{tc.get('inc_ms', 0) / 1000:g}"
    else:
        b = Budget.from_dict(tc.get("budget"))
        tc_text = f"no-flag research: {b.min_time:g}-{b.max_time:g}s/move, depth<={b.max_depth}"
    headers = {"Event": "Opening Magician", "Site": "Local engine room", "Date": time.strftime("%Y.%m.%d", time.localtime(t0)),
               "Round": "-", "White": spec.white_name, "Black": spec.black_name, "Result": result,
               "TimeControl": tc_text, "Termination": termination, **spec.headers}
    if spec.opening_name:
        headers["Opening"] = spec.opening_name
    if detail:
        headers["Annotator"] = "Opening Magician"
    pgn = pgn_from_moves(start_fen, moves, headers, comments)
    return {"result": result, "termination": termination, "detail": detail, "white": spec.white_name,
            "black": spec.black_name, "start_fen": start_fen, "moves": [m.uci() for m in moves], "plies": len(moves),
            "book_plies": book_plies, "evals": evals, "pgn": pgn, "opening": spec.opening_name,
            "duration_s": round(time.time() - t0, 2), "time_control": tc_text, "policy_log": policy_log,
            "retryable": retryable, "finished": result != "*"}

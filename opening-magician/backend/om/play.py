"""Human-versus-engine play with an authoritative clock and optional physical board.

The session owns the rules state; the clock is `om.clock.Clock`; a connected Chessnut
board feeds human moves through sensor reconciliation, and engine replies are either
shown with LEDs for the human to relay (non-robotic boards) or executed by the robot
(Chessnut Move) — with the clock policy the user chose applied explicitly.
"""
from __future__ import annotations

import asyncio
import random
import time
from typing import Any

import chess
from .chessx import parse_move
import chess.engine

from . import openings
from .books.store import BookStore
from .chessx import Score, classify_move, describe_state, is_sacrifice, loss_between, pgn_from_moves, result_of
from .clock import BLACK, WHITE, Clock, other
from .db import Database, new_id, now
from .engines.manager import EngineError, EngineHandle, EngineManager, EngineSpec
from .engines.search import Budget, adaptive_search, ranked_candidates
from .events import EventBus
from .hardware.manager import HardwareError, HardwareManager
from .hardware.robot import RobotSafetyError

ASSISTANCE = {"training": "Training assistance — hints, arrows and evaluations available",
              "independent": "Independent practice — recommendations hidden until after your move",
              "postgame": "Post-game analysis only — nothing during the game"}
MODES = ["normal", "casual", "timed", "opening_practice", "position_practice", "odds", "thematic", "physical", "analysis"]


class PlayError(ValueError):
    pass


def side_name(color: bool) -> str:
    return WHITE if color == chess.WHITE else BLACK


class PlaySession:
    def __init__(self, mgr: "PlayManager", sid: str, config: dict[str, Any]):
        self.mgr, self.id, self.config = mgr, sid, config
        self.board = chess.Board(config["start_fen"]) if config.get("start_fen") else chess.Board()
        self.start_fen = self.board.fen()
        self.human = chess.WHITE if config["color"] == "white" else chess.BLACK
        self.status = "active"
        self.result, self.termination, self.detail = "*", "", ""
        self.evals: list[dict[str, Any]] = []
        self.clock_stamps: list[float | None] = []
        self.handle: EngineHandle | None = None
        self.engine_task: asyncio.Task[None] | None = None
        self.tick_task: asyncio.Task[None] | None = None
        self.thinking = False
        self.pending_sync: str | None = None        # engine move waiting to appear on the physical board
        self.promotion_prompt: dict[str, Any] | None = None
        self.strength_applied: dict[str, Any] = {}
        self.draw_offer: str | None = None
        self.notice = ""
        self.game_id: str | None = None
        self.created_at = now()
        self.lock = asyncio.Lock()
        self.owner = "play:" + sid
        hw = mgr.hw
        self.physical = bool(config["physical"]["use_board"] and hw.device and hw.device.connected)
        self.robot = bool(self.physical and config["physical"]["robot_moves"] and hw.robot is not None)
        self.clock = Clock.create(config["clock"], [side_name(self.human)], self.physical, self.robot)

    # ------------------------------------------------------------------ state
    def topic(self) -> str:
        return f"play:{self.id}"

    def state(self) -> dict[str, Any]:
        t = time.time()
        b = self.board
        last = b.peek().uci() if b.move_stack else None
        sans, tmp = [], chess.Board(self.start_fen)
        for m in b.move_stack:
            sans.append(tmp.san(m))
            tmp.push(m)
        show_eval = self.config["assistance"] == "training" or self.status == "finished"
        return {"id": self.id, "status": self.status, "result": self.result, "termination": self.termination,
                "detail": self.detail, **describe_state(b), "start_fen": self.start_fen,
                "moves": [m.uci() for m in b.move_stack], "sans": sans, "last_move": last,
                "human": side_name(self.human), "engine_name": self.config["engine_name"], "thinking": self.thinking,
                "clock": self.clock.snapshot(t), "opening": openings.identify(b),
                "evals": self.evals if show_eval else [{"ply": e["ply"], "time_ms": e.get("time_ms")} for e in self.evals],
                "assistance": self.config["assistance"], "mode": self.config["mode"], "physical": self.physical,
                "robot": self.robot, "pending_sync": self.pending_sync, "promotion_prompt": self.promotion_prompt,
                "strength": self.strength_applied, "draw_offer": self.draw_offer, "notice": self.notice,
                "game_id": self.game_id, "config": {k: self.config[k] for k in ("mode", "assistance", "clock", "physical", "strength", "sideline")},
                "can_undo": self.config["mode"] in ("casual", "opening_practice", "position_practice", "thematic", "analysis", "physical")
                and self.config["clock"].get("label", "casual") != "official"}

    def emit(self, type_: str = "state") -> None:
        self.mgr.bus.publish(self.topic(), type_, self.state())

    def persist(self) -> None:
        self.mgr.db.upsert("play_sessions", {"id": self.id, "status": self.status, "config": self.config,
                                             "state": {"start_fen": self.start_fen, "moves": [m.uci() for m in self.board.move_stack],
                                                       "clock": self.clock.to_dict(), "evals": self.evals,
                                                       "result": self.result, "termination": self.termination,
                                                       "stamps": self.clock_stamps},
                                             "created_at": self.created_at, "updated_at": now()})

    # ------------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        spec = EngineSpec.from_dict(self.config["engine"])
        self.strength_applied = self.mgr.strength_options(spec, self.config["strength"])
        spec.options.update(self.strength_applied.get("options", {}))
        self.handle = await self.mgr.engines.open(spec, "play", "Opponent · " + self.config["engine_name"])
        for u in self.config.get("opening_moves") or []:
            self.board.push(parse_move(self.board, u))
            self.clock_stamps.append(None)
        t = time.time()
        self.clock.start(side_name(self.board.turn), t)
        if self.physical:
            self.mgr.hw.claim(self.owner, self.board, self._hw_event)
            if not self.mgr.hw.in_sync_with(self.board):
                self.notice = "Set up the position on the board (the clock waits during the setup allowance)."
                if self.robot:
                    asyncio.get_running_loop().create_task(self._robot_setup())
            else:
                self.clock.release("setup", t)
        else:
            self.clock.release("setup", t)
        self.tick_task = asyncio.get_running_loop().create_task(self._ticker())
        self.persist()
        self.emit()
        if self.board.turn != self.human:
            self._engine_go()

    async def _robot_setup(self) -> None:
        try:
            await self.mgr.hw.robot_execute(self.board, "game setup")
            self.clock.release("setup", time.time())
            self.notice = ""
        except (RobotSafetyError, HardwareError) as e:
            self.notice = f"Robot setup not completed: {e}. Set the position by hand."
        self.emit()

    async def _ticker(self) -> None:
        try:
            while self.status == "active":
                await asyncio.sleep(0.25)
                flagged = self.clock.check_flag(time.time())
                if flagged:
                    if self.clock.config["flag_policy"] == "lose":
                        loser_white = flagged == WHITE
                        # FIDE: a flag is only a loss if the opponent could still mate
                        if self.board.has_insufficient_material(chess.BLACK if loser_white else chess.WHITE):
                            await self.finish("1/2-1/2", "time_vs_insufficient_material", f"{flagged} ran out of time but the opponent cannot mate")
                        else:
                            await self.finish("0-1" if loser_white else "1-0", "time_forfeit", f"{flagged.title()} lost on time")
                    else:
                        self.notice = f"{flagged.title()}'s flag fell (training clock: the game continues)."
                        self.emit()
        except asyncio.CancelledError:
            pass

    # ------------------------------------------------------------------ human actions
    async def human_move(self, text: str, source: str = "screen") -> dict[str, Any]:
        async with self.lock:
            if self.status != "active":
                raise PlayError("The game is over")
            if self.board.turn != self.human:
                raise PlayError("It is not your move")
            if self.pending_sync and source != "board":
                # on a physical board the engine's move must be on the board before the human continues
                if self.physical and not self.mgr.hw.in_sync_with(self.board):
                    raise PlayError("Place the engine's move on the board first")
            try:
                mv = parse_move(self.board, text)
            except ValueError:
                raise PlayError(f"Illegal move: {text}")
            self.pending_sync, self.promotion_prompt, self.draw_offer, self.notice = None, None, None, ""
            t = time.time()
            self.clock.release("setup", t)
            self.clock.release("sync", t)
            info = self.clock.press(t)
            self._push(mv, None, info["used_ms"], t)
            if self.physical:
                self.mgr.hw.update_context(self.owner, self.board)
                if source != "board" and not self.mgr.hw.in_sync_with(self.board):
                    self.notice = "Your move was entered on screen — make it on the board too."
            if await self._check_over():
                return self.state()
            self.persist()
            self.emit()
            self._engine_go()
            return self.state()

    def _push(self, mv: chess.Move, line: dict[str, Any] | None, used_ms: float, t: float, extra: dict[str, Any] | None = None) -> None:
        side = self.board.turn
        san = self.board.san(mv)
        fen_before = self.board.fen()
        self.board.push(mv)
        ev: dict[str, Any] = {"ply": len(self.board.move_stack), "san": san, "uci": mv.uci(), "side": "w" if side else "b",
                              "time_ms": round(used_ms), "fen_before": fen_before, "fen_after": self.board.fen(), **(extra or {})}
        if line and line.get("score"):
            s = Score.from_dict(line["score"])
            w = s if side == chess.WHITE else s.negate()
            ev.update({"text": w.text(), "expected_white": round(w.expected(), 4), "depth": line.get("depth"), "score": line["score"]})
        self.evals.append(ev)
        left = self.clock.time_left(side_name(side), t)
        self.clock_stamps.append(None if left is None else left / 1000)

    async def _check_over(self) -> bool:
        over = result_of(self.board, claim_draw=False)
        if self.board.is_fivefold_repetition() or self.board.is_seventyfive_moves():
            over = result_of(self.board, claim_draw=True) or over
        if over:
            await self.finish(over[0], over[1], "")
            return True
        return False

    async def finish(self, result: str, termination: str, detail: str) -> None:
        if self.status == "finished":
            return
        self.status, self.result, self.termination, self.detail = "finished", result, termination, detail
        t = time.time()
        self.clock.stop(t)
        self.thinking = False
        cur = asyncio.current_task()
        for task in (self.engine_task, self.tick_task):
            if task and task is not cur and not task.done():
                task.cancel()
        if self.handle:
            await self.handle.close()
            self.handle = None
        if self.physical:
            await self.mgr.hw.leds_off()
            self.mgr.hw.release(self.owner)
        human_name = "You"
        white, black = (human_name, self.config["engine_name"]) if self.human == chess.WHITE else (self.config["engine_name"], human_name)
        comments = {}
        for i, e in enumerate(self.evals):
            bits = []
            stamp = self.clock_stamps[len(self.clock_stamps) - len(self.evals) + i] if self.clock_stamps else None
            if stamp is not None:
                h, rem = divmod(int(stamp), 3600)
                bits.append(f"[%clk {h}:{rem // 60:02d}:{rem % 60:02d}]")
            if e.get("text") and self.config["assistance"] != "postgame":
                bits.append(f"{e['text']}/{e.get('depth') or 0}")
            if bits:
                comments[len(self.board.move_stack) - len(self.evals) + i] = " ".join(bits)
        op = openings.identify(self.board)
        cl = self.clock.config
        tc = "-" if cl["kind"] == "unlimited" else (cl.get("name") or cl["kind"])
        headers = {"Event": f"Opening Magician — {self.config['mode'].replace('_', ' ')} game", "Site": "Local",
                   "Date": time.strftime("%Y.%m.%d"), "Round": "-", "White": white, "Black": black, "Result": result,
                   "TimeControl": tc, "Termination": termination}
        if op:
            headers["Opening"], headers["ECO"] = op["name"], op["eco"]
        if self.physical:
            headers["Board"] = self.mgr.hw.device.transport.name if self.mgr.hw.device else "physical"
        pgn = pgn_from_moves(self.start_fen, self.board.move_stack, headers, comments)
        self.game_id = new_id("game")
        self.mgr.db.insert("games", {"id": self.game_id, "kind": "play", "white": white, "black": black, "result": result,
                                     "termination": termination, "pgn": pgn, "start_fen": self.start_fen,
                                     "opening": op["name"] if op else None, "eco": op["eco"] if op else None,
                                     "plies": len(self.board.move_stack), "tournament_id": None, "experiment_id": None,
                                     "meta": {"evals": self.evals, "detail": detail, "human": side_name(self.human),
                                              "clock": cl, "flag_events": self.clock.flag_events, "physical": self.physical,
                                              "robot": self.robot, "mode": self.config["mode"]},
                                     "created_at": self.created_at, "finished_at": now()})
        self.persist()
        self.emit("finished")

    async def resign(self) -> None:
        await self.finish("0-1" if self.human == chess.WHITE else "1-0", "resignation", "You resigned")

    async def abort(self) -> None:
        await self.finish("*", "aborted", "Game aborted")

    async def claim_draw(self) -> None:
        if self.board.can_claim_threefold_repetition():
            await self.finish("1/2-1/2", "threefold_repetition", "Draw claimed by repetition")
        elif self.board.can_claim_fifty_moves():
            await self.finish("1/2-1/2", "fifty_moves", "Draw claimed under the fifty-move rule")
        else:
            raise PlayError("No draw can be claimed in this position")

    async def offer_draw(self) -> dict[str, Any]:
        """The engine accepts when its own last evaluation is level and the game is past the opening."""
        mine = [e for e in self.evals if e.get("score") and (e["side"] == "w") != (self.human == chess.WHITE)]
        if len(self.board.move_stack) >= 40 and mine and abs((Score.from_dict(mine[-1]["score"]).cp or 999)) <= 15:
            await self.finish("1/2-1/2", "agreement", "Draw agreed")
            return {"accepted": True}
        self.notice = "Draw offer declined."
        self.emit()
        return {"accepted": False}

    async def undo(self) -> None:
        async with self.lock:
            if not self.state()["can_undo"]:
                raise PlayError("Take-backs are disabled in this mode")
            if self.thinking and self.engine_task:
                self.engine_task.cancel()
                self.thinking = False
            n = 1 if self.board.turn != self.human else 2
            for _ in range(min(n, len(self.board.move_stack))):
                self.board.pop()
                if self.evals:
                    self.evals.pop()
                if self.clock_stamps:
                    self.clock_stamps.pop()
            t = time.time()
            if self.clock.running != side_name(self.board.turn):
                self.clock.running, self.clock.turn_started, self.clock.held_ms = side_name(self.board.turn), t, 0.0
            self.pending_sync = None
            if self.physical:
                self.mgr.hw.update_context(self.owner, self.board)
                self.notice = "Move taken back — restore the position on the board."
            self.persist()
            self.emit()
            if self.board.turn != self.human:
                self._engine_go()

    def pause(self, paused: bool) -> None:
        if self.clock.config["label"] == "official":
            raise PlayError("Official clocks cannot be paused")
        (self.clock.pause if paused else self.clock.resume)(time.time())
        self.emit()

    def adjust_clock(self, side: str, delta_ms: float) -> None:
        self.clock.adjust(side, delta_ms, time.time())
        self.persist()
        self.emit()

    async def hint(self) -> dict[str, Any]:
        if self.config["assistance"] != "training":
            raise PlayError("Hints are only available with Training Assistance")
        if self.board.turn != self.human or not self.handle or self.thinking:
            raise PlayError("Hints are available on your move")
        res = await adaptive_search(self.handle, self.board, Budget(min_time=0.2, max_time=1.5, min_depth=6, max_depth=18), multipv=3)
        self.mgr.trainer_log("play_hint")
        return {"lines": res["lines"], "stop_reason": res["stop_reason"]}

    # ------------------------------------------------------------------ engine side
    def _engine_go(self) -> None:
        if self.status == "active" and (self.engine_task is None or self.engine_task.done()):
            self.engine_task = asyncio.get_running_loop().create_task(self._engine_move())

    async def _engine_move(self) -> None:
        self.thinking = True
        self.emit()
        t0 = time.time()
        mv: chess.Move | None = None
        line: dict[str, Any] | None = None
        extra: dict[str, Any] = {}
        try:
            mv = self._book_move()
            if mv:
                extra["book"] = True
                await asyncio.sleep(0.35)
            else:
                assert self.handle is not None
                side_cfg = self.config.get("sideline") or {}
                if side_cfg.get("enabled") and len(self.board.move_stack) < int(side_cfg.get("until_ply", 16)):
                    ranks = side_cfg.get("ranks") or [2, 3]
                    ranked = await ranked_candidates(self.handle, self.board, max(ranks), Budget(min_time=0.1, max_time=1.0, min_depth=4, max_depth=14))
                    pool = [c for c in ranked["candidates"] if c["rank"] in ranks and c["loss"]["expected_loss"] <= float(side_cfg.get("max_loss", 0.08))]
                    if pool:
                        pick = random.choice(pool)
                        mv, line, extra = chess.Move.from_uci(pick["move"]), pick, {"sideline_rank": pick["rank"]}
                if mv is None:
                    res = await self.handle.play(self.board, self._limit())
                    mv, line = res["move"], res["line"]
        except asyncio.CancelledError:
            self.thinking = False
            raise
        except EngineError as e:
            self.thinking = False
            await self.finish("1-0" if self.human == chess.WHITE else "0-1", "engine_error", str(e))
            return
        async with self.lock:
            if self.status != "active" or self.board.turn == self.human:
                self.thinking = False
                return
            before = self.board.copy(stack=False)
            policy = self.clock.config["robot"]["policy"]
            t = time.time()
            engine_ms = (line or {}).get("time_ms")
            if self.robot and policy == "continue":
                # mechanical execution is charged to the engine: the clock is pressed only when the motion is verified
                self.thinking = False
                self.notice = "Robot is making the move (engine clock keeps running)."
                self._push_pending(mv)
                ok = await self._robot_play(before, mv)
                self._pop_pending()
                t = time.time()
                info = self.clock.press(t)
                self._push(mv, line, info["used_ms"], t, extra)
                if not ok:
                    self.pending_sync = mv.uci()
            else:
                override = engine_ms if (self.robot and policy == "engine_thinking_only" and engine_ms) else None
                info = self.clock.press(t, charged_override_ms=override)
                self._push(mv, line, info["used_ms"], t, extra)
                self.thinking = False
                if self.physical:
                    self.mgr.hw.update_context(self.owner, self.board)
                    if self.robot:
                        self.clock.hold("robot", t)
                        self.notice = "Robot is making the move (clocks paused for mechanical execution)."
                        self.emit()
                        ok = await self._robot_play(before, mv)
                        self.clock.release("robot", time.time())
                        if not ok:
                            self.pending_sync = mv.uci()
                    else:
                        self.pending_sync = mv.uci()
                        p = self.clock.config["physical"]
                        if p["pause_for_sync"] and self.clock.allowance_applies(side_name(self.human)):
                            self.clock.hold("sync", t, cap_ms=p["sync_cap_ms"])
                        try:
                            await self.mgr.hw.guide_move(before, mv)
                        except HardwareError:
                            pass
                        self.notice = f"Play {self.evals[-1]['san']} for the engine on your board."
            if self.physical:
                self.mgr.hw.update_context(self.owner, self.board)
            if not self.pending_sync and self.notice.startswith("Robot"):
                self.notice = ""
            if await self._check_over():
                return
            self.persist()
            self.emit()

    def _push_pending(self, mv: chess.Move) -> None:
        self._pending_ctx = self.board.copy()
        self._pending_ctx.push(mv)
        self.mgr.hw.update_context(self.owner, self._pending_ctx)

    def _pop_pending(self) -> None:
        self._pending_ctx = None

    async def _robot_play(self, before: chess.Board, mv: chess.Move) -> bool:
        target = before.copy(stack=False)
        target.push(mv)
        try:
            state = await self.mgr.hw.robot_execute(target, f"engine move {before.san(mv)}")
            if state == "completed":
                return True
            self.notice = f"Robot did not finish the move (state: {state}). Make it by hand; see Robot Studio."
        except (RobotSafetyError, HardwareError) as e:
            self.notice = f"Robot could not make the move: {e}. Make it by hand."
        return False

    def _book_move(self) -> chess.Move | None:
        bid, plies = self.config.get("book_id"), int(self.config.get("book_plies", 0))
        if not bid or len(self.board.move_stack) >= plies:
            return None
        try:
            moves = [m for m in self.mgr.books.head(bid).moves_at(self.board) if m["weight"] > 0 and m["status"] != "rejected"]
        except Exception:
            return None
        if not moves:
            return None
        pick = random.choices(moves, weights=[m["weight"] for m in moves], k=1)[0]
        return chess.Move.from_uci(pick["uci"])

    def _limit(self) -> chess.engine.Limit:
        st = self.strength_applied
        args = self.clock.engine_limit_args(time.time())
        kw: dict[str, Any] = {}
        if st.get("depth"):
            kw["depth"] = st["depth"]
        if args is None:
            kw["time"] = (st.get("movetime_ms") or 1500) / 1000
            return chess.engine.Limit(**kw)
        if st.get("movetime_ms"):
            # cap the thinking time but never above what the clock allows
            mine = args["white_clock"] if self.board.turn else args["black_clock"]
            kw["time"] = max(0.05, min(st["movetime_ms"] / 1000, mine * 0.5))
            return chess.engine.Limit(**kw)
        return chess.engine.Limit(white_clock=args["white_clock"], black_clock=args["black_clock"], white_inc=args["white_inc"],
                                  black_inc=args["black_inc"], remaining_moves=args.get("remaining_moves"), **kw)

    # ------------------------------------------------------------------ hardware events
    async def _hw_event(self, res: dict[str, Any]) -> None:
        if self.status != "active":
            return
        st = res.get("status")
        if st == "in_sync":
            t = time.time()
            self.clock.release("setup", t)
            if self.pending_sync:
                self.pending_sync = None
                self.clock.release("sync", t)
                self.notice = ""
                await self.mgr.hw.leds_off()
            self.emit()
        elif st == "move" and self.board.turn == self.human and not self.pending_sync and not self.thinking:
            try:
                await self.human_move(res["move"], source="board")
            except PlayError as e:
                self.notice = str(e)
                self.emit()
        elif st == "promotion_choice" and self.board.turn == self.human:
            self.promotion_prompt = res
            self.emit()
        elif st == "takeback":
            self.notice = "The board shows the previous position. Use Take back on screen to undo, or replay the move."
            self.emit()
        elif st == "mismatch":
            self.notice = "Board and game disagree — check the highlighted squares."
            self.emit()
        elif st == "disconnected":
            self.clock.pause(time.time()) if self.clock.config["label"] != "official" else None
            self.notice = "Board disconnected. The clock is paused; reconnect or continue on screen."
            self.emit()


class PlayManager:
    def __init__(self, db: Database, engines: EngineManager, bus: EventBus, hw: HardwareManager, books: BookStore):
        self.db, self.engines, self.bus, self.hw, self.books = db, engines, bus, hw, books
        self.sessions: dict[str, PlaySession] = {}
        self.trainer_log = lambda kind: None

    def strength_options(self, spec: EngineSpec, strength: dict[str, Any]) -> dict[str, Any]:
        """Map the requested strength onto what THIS engine actually supports and say which mechanism was used."""
        row = self.engines.get(spec.engine_id)
        opts = {k.lower(): (k, v) for k, v in row.get("options", {}).items()}
        mode = strength.get("mode", "full")
        out: dict[str, Any] = {"mode": mode, "options": {}, "mechanism": "full strength", "approximate": False}
        if mode == "elo":
            elo = int(strength.get("elo", 1500))
            if "uci_elo" in opts and "uci_limitstrength" in opts:
                name, o = opts["uci_elo"]
                elo = max(int(o.get("min") or elo), min(int(o.get("max") or elo), elo))
                out["options"] = {opts["uci_limitstrength"][0]: True, name: elo}
                out.update({"mechanism": f"UCI_LimitStrength / UCI_Elo {elo} (engine's own calibration)", "approximate": True, "elo": elo})
            elif "skill level" in opts:
                name, o = opts["skill level"]
                lo, hi = int(o.get("min") or 0), int(o.get("max") or 20)
                lvl = max(lo, min(hi, round((elo - 800) / 100)))
                out["options"] = {name: lvl}
                out.update({"mechanism": f"Skill Level {lvl} — this engine has no Elo setting; the mapping from {elo} is a rough guess",
                            "approximate": True})
            else:
                out.update({"depth": max(1, min(12, (elo - 600) // 200)), "approximate": True,
                            "mechanism": "search depth limit — this engine exposes neither UCI_Elo nor Skill Level"})
        elif mode == "skill":
            if "skill level" in opts:
                name, o = opts["skill level"]
                lvl = max(int(o.get("min") or 0), min(int(o.get("max") or 20), int(strength.get("skill", 10))))
                out["options"] = {name: lvl}
                out["mechanism"] = f"Skill Level {lvl}"
            else:
                out.update({"depth": max(1, int(strength.get("skill", 10)) // 2 + 1),
                            "mechanism": "search depth limit (engine has no Skill Level option)", "approximate": True})
        elif mode == "depth":
            out.update({"depth": max(1, int(strength.get("depth", 6))), "mechanism": f"fixed depth {strength.get('depth', 6)}"})
        elif mode == "time":
            out.update({"movetime_ms": max(20, int(strength.get("movetime_ms", 500))),
                        "mechanism": f"{strength.get('movetime_ms', 500)} ms per move"})
        if strength.get("movetime_ms") and mode != "time":
            out["movetime_ms"] = int(strength["movetime_ms"])
        return out

    def normalize(self, cfg: dict[str, Any]) -> dict[str, Any]:
        c = dict(cfg)
        if not c.get("engine"):
            raise PlayError("Choose an engine opponent")
        spec = EngineSpec.from_dict(c["engine"])
        row = self.engines.get(spec.engine_id)
        color = c.get("color", "white")
        if color == "random":
            color = random.choice(["white", "black"])
        if color not in ("white", "black"):
            raise PlayError("color must be white, black or random")
        mode = c.get("mode", "casual")
        if mode not in MODES:
            raise PlayError(f"Unknown mode '{mode}'")
        assistance = c.get("assistance", "independent")
        if assistance not in ASSISTANCE:
            raise PlayError("Unknown assistance setting")
        if c.get("start_fen"):
            try:
                b = chess.Board(c["start_fen"])
            except ValueError as e:
                raise PlayError(f"Invalid FEN: {e}")
            if not b.is_valid():
                raise PlayError("That position is not a legal chess position")
        from .clock import normalize_config
        clock = normalize_config(c.get("clock") or {"kind": "unlimited"})
        c.update({"engine": spec.to_dict(), "engine_name": spec.label or row["name"], "color": color, "mode": mode,
                  "assistance": assistance, "clock": clock, "strength": c.get("strength") or {"mode": "full"},
                  "physical": {"use_board": False, "robot_moves": False, **(c.get("physical") or {})},
                  "sideline": c.get("sideline") or {"enabled": False}, "book_plies": int(c.get("book_plies", 0))})
        return c

    async def create(self, cfg: dict[str, Any]) -> PlaySession:
        c = self.normalize(cfg)
        s = PlaySession(self, new_id("play"), c)
        self.sessions[s.id] = s
        try:
            await s.start()
        except EngineError as e:
            self.sessions.pop(s.id, None)
            raise PlayError(str(e))
        return s

    def get(self, sid: str) -> PlaySession:
        s = self.sessions.get(sid)
        if not s:
            raise PlayError("Unknown or finished session")
        return s

    def active(self) -> list[dict[str, Any]]:
        return [s.state() for s in self.sessions.values() if s.status == "active"]

    def recoverable(self) -> list[dict[str, Any]]:
        """Games that were in progress when the bridge stopped (position, clock and history are intact)."""
        rows = self.db.all("play_sessions", "status='active'", order="updated_at DESC", limit=10)
        return [{"id": r["id"], "moves": len(r["state"]["moves"]), "engine_name": r["config"]["engine_name"],
                 "updated_at": r["updated_at"], "color": r["config"]["color"]} for r in rows if r["id"] not in self.sessions]

    async def recover(self, sid: str) -> PlaySession:
        row = self.db.get("play_sessions", sid)
        if not row or row["status"] != "active":
            raise PlayError("Nothing to recover")
        s = PlaySession(self, sid, row["config"])
        st = row["state"]
        s.created_at = row["created_at"]
        spec = EngineSpec.from_dict(s.config["engine"])
        s.strength_applied = self.strength_options(spec, s.config["strength"])
        spec.options.update(s.strength_applied.get("options", {}))
        s.handle = await self.engines.open(spec, "play", "Opponent · " + s.config["engine_name"])
        s.board = chess.Board(st["start_fen"])
        s.start_fen = st["start_fen"]
        for u in st["moves"]:
            s.board.push_uci(u)
        s.evals, s.clock_stamps = st.get("evals", []), st.get("stamps", [])
        s.clock = Clock.from_dict(st["clock"])
        t = time.time()
        # time that passed while the bridge was down is not charged
        s.clock.holds.clear()
        s.clock.running, s.clock.turn_started, s.clock.held_ms = side_name(s.board.turn), t, 0.0
        s.clock.physical_active, s.clock.robot_active = s.physical, s.robot
        s.notice = "Game recovered after a restart. Clocks resume from the last saved move."
        self.sessions[sid] = s
        if s.physical:
            self.hw.claim(s.owner, s.board, s._hw_event)
        s.tick_task = asyncio.get_running_loop().create_task(s._ticker())
        s.emit()
        if s.board.turn != s.human:
            s._engine_go()
        return s

    async def shutdown(self) -> None:
        for s in self.sessions.values():
            for task in (s.engine_task, s.tick_task):
                if task and not task.done():
                    task.cancel()
            if s.status == "active":
                s.clock.pause(time.time())
                s.persist()


class GameAnalyzer:
    """Post-game analysis: every move classified from MultiPV evidence (never from one shallow number)."""

    def __init__(self, db: Database, engines: EngineManager, books: BookStore):
        self.db, self.engines, self.books = db, engines, books

    async def analyse(self, game_id: str, engine: EngineSpec, budget: Budget, book_id: str | None = None,
                      cancel: asyncio.Event | None = None, on_progress: Any = None) -> dict[str, Any]:
        row = self.db.get("games", game_id)
        if not row:
            raise PlayError("Unknown game")
        from .chessx import read_games
        game = read_games(row["pgn"], 1)[0]
        board = game.board()
        book = self.books.head(book_id) if book_id else openings.reference_book()
        out = []
        moves = list(game.mainline_moves())
        async with self.engines.session(engine, "interactive", "Game analysis") as h:
            for i, mv in enumerate(moves):
                if cancel is not None and cancel.is_set():
                    break
                ranked = await ranked_candidates(h, board, 4, budget, cancel=cancel)
                cands = ranked["candidates"]
                if not cands:
                    break
                best = Score.from_dict(cands[0]["score"])
                hit = next((c for c in cands if c["move"] == mv.uci()), None)
                if hit:
                    played, rank = Score.from_dict(hit["score"]), hit["rank"]
                else:
                    res = await adaptive_search(h, board, budget, multipv=1, root_moves=[mv], cancel=cancel)
                    played = Score.from_dict(res["lines"][0]["score"]) if res["lines"] else Score()
                    rank = None
                stable = ranked.get("stop_reason") in ("stable", "resolved", "max_depth", "single_legal_move")
                in_book = book.contains(board, mv)
                cls = classify_move(best=best, played=played, rank=rank, legal_count=board.legal_moves.count(),
                                    depth=ranked.get("depth") or 0, in_book=in_book, book_known_position=bool(book.node(board)),
                                    sacrifice=is_sacrifice(board, mv), second=Score.from_dict(cands[1]["score"]) if len(cands) > 1 else None,
                                    stable=stable, min_depth_for_harsh=max(3, budget.min_depth))
                white = best if board.turn else best.negate()
                out.append({"ply": i + 1, "san": board.san(mv), "uci": mv.uci(), "fen_before": board.fen(), **cls,
                            "best": cands[0]["move"], "best_san": cands[0]["san"], "best_pv": cands[0]["pv_san"][:8],
                            "eval_white": white.to_dict(), "side": "w" if board.turn else "b"})
                board.push(mv)
                if on_progress:
                    on_progress((i + 1) / len(moves))
        summary: dict[str, dict[str, int]] = {"w": {}, "b": {}}
        acc: dict[str, list[float]] = {"w": [], "b": []}
        for m in out:
            summary[m["side"]][m["label"]] = summary[m["side"]].get(m["label"], 0) + 1
            acc[m["side"]].append(1 - min(1.0, m["expected_loss"] * 4))
        report = {"moves": out, "summary": summary, "engine": self.engines.get(engine.engine_id)["name"], "budget": budget.to_dict(),
                  "accuracy": {k: round(100 * sum(v) / len(v), 1) if v else None for k, v in acc.items()},
                  "note": "Labels marked provisional come from searches too shallow or unstable to justify a harsh verdict."}
        meta = row["meta"]
        meta["analysis"] = report
        self.db.update("games", game_id, {"meta": meta})
        return report

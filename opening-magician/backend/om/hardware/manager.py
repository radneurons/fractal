"""Hardware manager: one active board, its robot controller, LED guidance, the simulator's
"hands" API and physical opening playback.

Consumers (a game, a trainer, a playback) `claim` the board with the chess position they
expect; every sensor report is reconciled against that position and delivered to them.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable

import chess

from ..db import Database, new_id, now
from ..events import EventBus
from . import codec
from .driver import ChessnutDevice, DeviceProfile, UnsupportedOperation, guidance_leds
from .reconcile import diff, reconcile, setup_instructions
from .robot import BUSY, RobotController, RobotSafetyError
from .sim import SimTransport
from .transport import BleakTransport, TransportError, scan as ble_scan

MoveCallback = Callable[[dict[str, Any]], Awaitable[None] | None]


class HardwareError(RuntimeError):
    pass


class HardwareManager:
    def __init__(self, db: Database, bus: EventBus, resources: Any = None):
        self.db, self.bus, self.resources = db, bus, resources
        self.device: ChessnutDevice | None = None
        self.robot: RobotController | None = None
        self.sim: SimTransport | None = None
        self.device_id: str | None = None
        self.owner: str | None = None
        self.context: chess.Board | None = None
        self._on_event: MoveCallback | None = None
        self.last_reconcile: dict[str, Any] | None = None
        self.playback: "Playback | None" = None
        self._bg_paused_by_us = False

    # -- logging / events ----------------------------------------------------
    def _log(self, direction: str, kind: str, payload: bytes | None, note: str) -> None:
        try:
            self.db.execute("INSERT INTO hw_log(ts,device,simulated,direction,kind,payload,note) VALUES(?,?,?,?,?,?,?)",
                            (now(), self.device.transport.name if self.device else "", int(bool(self.device and self.device.simulated)),
                             direction, kind, payload.hex() if payload else None, note))
        except Exception:
            pass

    def _publish(self, type_: str, data: Any = None) -> None:
        self.bus.publish("hw", type_, data)

    def log_tail(self, limit: int = 100) -> list[dict[str, Any]]:
        return self.db.query("SELECT * FROM hw_log ORDER BY id DESC LIMIT ?", (limit,))

    # -- discovery / connection ------------------------------------------------
    async def scan(self, timeout: float = 6.0) -> dict[str, Any]:
        try:
            found = await ble_scan(timeout)
            return {"devices": found, "bluetooth": True, "error": None}
        except TransportError as e:
            return {"devices": [], "bluetooth": False, "error": str(e)}

    def known_devices(self) -> list[dict[str, Any]]:
        return self.db.all("hw_devices", order="last_seen DESC")

    async def connect(self, address: str, name: str = "", model: str | None = None) -> dict[str, Any]:
        model = model or codec.model_from_name(name)
        if model not in codec.CAPS:
            raise HardwareError("Unrecognised Chessnut model. Only verified profiles are driven: "
                                + ", ".join(c.label for c in codec.CAPS.values()))
        await self.disconnect()
        saved = next((d for d in self.known_devices() if d["address"] == address), None)
        profile = DeviceProfile.from_dict(saved["profile"] if saved else None)
        await self._attach(BleakTransport(address, name), codec.CAPS[model], profile)
        self.device_id = saved["id"] if saved else new_id("dev")
        self.db.upsert("hw_devices", {"id": self.device_id, "name": name or address, "address": address, "model": model,
                                      "profile": profile.to_dict(), "last_seen": now(),
                                      "created_at": saved["created_at"] if saved else now()})
        return self.status()

    async def connect_sim(self, model: str = "move", fen: str | None = None, step_time: float = 0.7) -> dict[str, Any]:
        if model not in codec.CAPS:
            raise HardwareError(f"Unknown model {model}")
        await self.disconnect()
        self.sim = SimTransport(model, fen, step_time)
        self.sim.on_sim_state = lambda st: self._publish("sim", st)
        await self._attach(self.sim, codec.CAPS[model], DeviceProfile())
        self.device_id = "sim-" + model
        return self.status()

    async def _attach(self, transport: Any, caps: codec.Capabilities, profile: DeviceProfile) -> None:
        dev = ChessnutDevice(transport, caps, profile, self._log)
        self.device = dev
        dev.on_placement = self._on_placement
        dev.on_battery = lambda b: self._publish("battery", b)
        dev.on_pieces = lambda p: self._publish("pieces", p)
        dev.on_disconnect = self._on_disconnect
        try:
            await dev.connect()
        except TransportError as e:
            self.device = None
            raise HardwareError(str(e))
        self.robot = RobotController(dev, self._publish) if caps.robotic else None
        if self.robot and self.sim is not None and transport is self.sim:
            self.robot.seconds_per_piece = max(0.05, self.sim.step_time * 1.6)
            self.robot.poll_interval = max(0.05, min(1.0, self.sim.step_time))
            self.robot.settle = max(0.02, min(0.6, self.sim.step_time / 2))
        if self.robot:
            self.robot._set("ready" if dev.placement is not None else "connected", "")
        self._publish("status", self.status())

    async def disconnect(self) -> None:
        if self.playback:
            await self.playback.stop()
        if self.device is not None:
            if self.robot and self.robot.state in BUSY:
                try:
                    await self.robot.stop()
                except Exception:
                    pass
            try:
                await self.device.disconnect()
            except Exception:
                pass
        self.device, self.robot, self.sim, self.device_id = None, None, None, None
        self.last_reconcile = None
        self._publish("status", self.status())

    def _on_disconnect(self) -> None:
        if self.robot:
            self.robot.on_disconnect()
        self._publish("status", self.status())
        self._notify({"status": "disconnected"})

    def update_profile(self, **changes: Any) -> dict[str, Any]:
        dev = self._dev()
        for k, v in changes.items():
            if hasattr(dev.profile, k) and v is not None:
                setattr(dev.profile, k, v)
        if self.device_id and not dev.simulated:
            self.db.update("hw_devices", self.device_id, {"profile": dev.profile.to_dict()})
        self._publish("status", self.status())
        return self.status()

    # -- ownership / reconciliation ------------------------------------------------
    def claim(self, owner: str, board: chess.Board, on_event: MoveCallback | None = None) -> None:
        self.owner, self.context, self._on_event = owner, board.copy(), on_event
        self._reconcile_now()

    def update_context(self, owner: str, board: chess.Board) -> None:
        if self.owner == owner:
            self.context = board.copy()
            self._reconcile_now()

    def release(self, owner: str) -> None:
        if self.owner == owner:
            self.owner, self.context, self._on_event = None, None, None
            self.last_reconcile = None

    def _reconcile_now(self) -> dict[str, Any] | None:
        if self.device is None or self.device.placement is None or self.context is None:
            self.last_reconcile = None
            return None
        res = reconcile(self.context, self.device.placement, auto_queen_on_pawn=self.device.profile.auto_queen)
        self.last_reconcile = res
        return res

    def _on_placement(self, placement: dict[int, str]) -> None:
        if self.robot:
            self.robot.on_manual_change(placement)
        res = self._reconcile_now()
        self._publish("position", {"board_fen": codec.placement_fen(placement), "reconcile": res, "owner": self.owner,
                                   "simulated": bool(self.device and self.device.simulated)})
        if res is not None:
            self._notify(res)

    def _notify(self, res: dict[str, Any]) -> None:
        if self._on_event is None:
            return
        try:
            out = self._on_event(res)
            if asyncio.iscoroutine(out):
                asyncio.get_running_loop().create_task(out)
        except RuntimeError:
            pass

    def in_sync_with(self, board: chess.Board) -> bool:
        return self.device is not None and self.device.placement == codec.placement_of(board)

    # -- LEDs ------------------------------------------------------------------------
    def _dev(self) -> ChessnutDevice:
        if self.device is None or not self.device.connected:
            raise HardwareError("No board connected")
        return self.device

    async def guide(self, *, source: list[str] | None = None, dest: list[str] | None = None,
                    danger: list[str] | None = None) -> dict[str, Any]:
        dev = self._dev()
        sq = lambda names: [chess.parse_square(n) for n in names or []]
        try:
            return await dev.set_leds(guidance_leds(dev.caps, source=sq(source), dest=sq(dest), danger=sq(danger)))
        except TransportError as e:
            raise HardwareError(str(e))

    async def guide_move(self, board: chess.Board, move: chess.Move) -> dict[str, Any]:
        danger = []
        if board.is_en_passant(move):
            danger = [chess.square_name(chess.square(chess.square_file(move.to_square), chess.square_rank(move.from_square)))]
        elif board.is_capture(move):
            danger = []  # destination already lit; the captured piece sits on it
        src, dst = [chess.square_name(move.from_square)], [chess.square_name(move.to_square)]
        if board.is_castling(move):
            kingside = chess.square_file(move.to_square) == 6
            rank = chess.square_rank(move.from_square)
            src.append(chess.square_name(chess.square(7 if kingside else 0, rank)))
            dst.append(chess.square_name(chess.square(5 if kingside else 3, rank)))
        return await self.guide(source=src, dest=dst, danger=danger)

    async def leds_off(self) -> None:
        if self.device and self.device.connected:
            try:
                await self.device.leds_off()
            except TransportError:
                pass

    async def set_leds_raw(self, leds: dict[str, str]) -> dict[str, Any]:
        dev = self._dev()
        try:
            return await dev.set_leds({chess.parse_square(k): v for k, v in leds.items()})
        except (TransportError, codec.ProtocolError, KeyError) as e:
            raise HardwareError(str(e))

    async def refresh(self) -> dict[str, Any]:
        dev = self._dev()
        try:
            await dev.request_battery()
            if dev.caps.piece_status and not (self.robot and self.robot.state in BUSY):
                await dev.request_piece_status()
            await dev.fresh_placement(2.0)
        except TransportError as e:
            raise HardwareError(str(e))
        return self.status()

    # -- robot ---------------------------------------------------------------------
    def _robot(self) -> RobotController:
        self._dev()
        if self.robot is None:
            raise HardwareError("The connected board is not robotic. Non-Move boards guide you with LEDs instead.")
        return self.robot

    async def robot_execute(self, target: chess.Board, reason: str, timeout: float | None = None) -> str:
        """Sequence-consented movement with background research paused while motors run."""
        robot = self._robot()
        paused_here = False
        if self.resources is not None and not self.resources.limits.background_paused:
            self.resources.pause_background(True)
            paused_here = True
        try:
            await robot.execute(target, reason, wait=True, timeout=timeout)
            return robot.state
        finally:
            if paused_here:
                self.resources.pause_background(False)

    def manual_setup_steps(self, target: chess.Board) -> list[dict[str, Any]]:
        dev = self._dev()
        return setup_instructions(dev.placement or {}, codec.placement_of(target))

    # -- status ----------------------------------------------------------------------
    def status(self) -> dict[str, Any]:
        return {"connected": bool(self.device and self.device.connected),
                "device": self.device.status() if self.device else None,
                "robot": self.robot.status() if self.robot else None,
                "sim": self.sim.state() if self.sim else None,
                "owner": self.owner, "reconcile": self.last_reconcile,
                "playback": self.playback.status() if self.playback else None,
                "ambiguities": codec.DOC_AMBIGUITIES}


# ---------------------------------------------------------------------------
# Physical opening playback
# ---------------------------------------------------------------------------
class Playback:
    """Replays one selected line.  Modes:
       digital — on-screen only;
       robot   — Chessnut Move rebuilds each position, one verified target at a time;
       guided  — non-robotic boards: LEDs show the move, the learner makes it, sensors confirm.
    Moves are never queued on the device: the next target is sent only after the previous one
    has been verified by the sensors."""

    def __init__(self, hw: HardwareManager, start_fen: str, moves: list[str], *, mode: str = "digital",
                 speed_ms: int = 1500, annotations: dict[int, str] | None = None, title: str = ""):
        self.hw, self.id = hw, new_id("pb")
        self.start = chess.Board(start_fen) if start_fen else chess.Board()
        self.moves: list[chess.Move] = []
        self.sans: list[str] = []
        self.boards: list[chess.Board] = [self.start.copy()]
        b = self.start.copy()
        for u in moves:
            mv = b.parse_uci(u) if len(u) in (4, 5) and u[0] in "abcdefgh" and u[1].isdigit() else b.parse_san(u)
            self.sans.append(b.san(mv))
            b.push(mv)
            self.moves.append(mv)
            self.boards.append(b.copy())
        self.mode, self.speed_ms, self.title = mode, speed_ms, title
        self.annotations = annotations or {}
        self.index = 0                    # number of moves currently shown
        self.state = "idle"               # idle | playing | paused | waiting_board | done | stopped | error
        self.detail = ""
        self.sync = "n/a"
        self._task: asyncio.Task[None] | None = None
        self._wake = asyncio.Event()
        self.owner = "playback:" + self.id
        self.support = self._check_support()

    def _check_support(self) -> dict[str, Any]:
        out: dict[str, Any] = {"digital": True, "robot": False, "guided": False, "reasons": []}
        dev = self.hw.device
        if dev is None or not dev.connected:
            out["reasons"].append("No board connected: digital replay only")
            return out
        out["guided"] = True
        if not dev.caps.robotic:
            out["reasons"].append(f"{dev.caps.label} has no motors: guided LED playback is available")
            return out
        problems = []
        for i, b in enumerate(self.boards):
            p = codec.inventory_check(codec.placement_of(b))
            if p:
                problems.append(f"after move {i}: {p[0]}")
                break
        if problems:
            out["reasons"].append("Line cannot be represented with the physical piece set (" + problems[0] + ")")
        elif not dev.simulated and not dev.profile.robot_verified:
            out["reasons"].append("Live robotic motion is locked until hardware verification is completed")
        else:
            out["robot"] = True
        return out

    def status(self) -> dict[str, Any]:
        b = self.boards[self.index]
        return {"id": self.id, "title": self.title, "state": self.state, "detail": self.detail, "mode": self.mode,
                "index": self.index, "total": len(self.moves), "fen": b.fen(), "sans": self.sans,
                "uci": [m.uci() for m in self.moves], "start_fen": self.start.fen(),
                "last_move": self.moves[self.index - 1].uci() if self.index else None,
                "annotation": self.annotations.get(self.index, ""), "speed_ms": self.speed_ms, "sync": self.sync,
                "support": self.support, "progress": self.index / max(1, len(self.moves))}

    def _emit(self) -> None:
        self.hw._publish("playback", self.status())

    def _set(self, state: str, detail: str = "") -> None:
        self.state, self.detail = state, detail
        self._emit()

    # -- controls ------------------------------------------------------------
    async def play(self) -> None:
        if self.mode != "digital" and not self.support.get(self.mode):
            raise HardwareError("; ".join(self.support["reasons"]) or f"{self.mode} playback is not available")
        if self.state == "playing":
            return
        if self._task and not self._task.done():
            self._task.cancel()
        if self.index >= len(self.moves):
            self.index = 0
        self._set("playing")
        self._task = asyncio.get_running_loop().create_task(self._run())

    async def pause(self) -> None:
        if self.state in ("playing", "waiting_board"):
            if self._task and not self._task.done() and not (self.hw.robot and self.hw.robot.state in BUSY):
                self._task.cancel()
            self._set("paused", "Paused" + (" after the current movement" if self.hw.robot and self.hw.robot.state in BUSY else ""))

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
        if self.mode == "robot" and self.hw.robot and self.hw.robot.state in BUSY:
            await self.hw.robot.stop()
        await self.hw.leds_off()
        self.hw.release(self.owner)
        self._set("stopped")

    async def restart(self) -> None:
        await self.goto(0)
        await self.play()

    async def step(self, delta: int) -> None:
        await self.goto(self.index + delta)

    async def goto(self, index: int) -> None:
        index = max(0, min(len(self.moves), index))
        if self._task and not self._task.done():
            self._task.cancel()
        if self.mode == "robot":
            await self._physical_to(index)
        else:
            self.index = index
            if self.mode == "guided":
                self._guided_sync()
        if self.state not in ("error",):
            self._set("paused" if index < len(self.moves) else "done")

    # -- engine --------------------------------------------------------------
    async def _run(self) -> None:
        try:
            if self.mode == "robot":
                await self._physical_to(self.index)       # make the board show the current position first
            elif self.mode == "guided":
                self.hw.claim(self.owner, self.boards[self.index], self._guided_event)
                if not self.hw.in_sync_with(self.boards[self.index]):
                    self.sync = "setup_needed"
                    self._set("waiting_board", "Set up the starting position on the board")
                    await self._wait_sync(self.index)
                    self._set("playing")
            while self.index < len(self.moves) and self.state == "playing":
                await asyncio.sleep(self.speed_ms / 1000)
                if self.state != "playing":
                    return
                nxt = self.index + 1
                if self.mode == "robot":
                    await self._physical_to(nxt)
                    if self.state != "playing":
                        return
                elif self.mode == "guided":
                    await self.hw.guide_move(self.boards[self.index], self.moves[self.index])
                    self.sync = "waiting_for_move"
                    self._set("waiting_board", f"Play {self.sans[self.index]} on the board")
                    await self._wait_sync(nxt)
                    await self.hw.leds_off()
                    self.index = nxt
                    self.hw.update_context(self.owner, self.boards[nxt])
                    self._set("playing")
                else:
                    self.index = nxt
                    self._emit()
            if self.index >= len(self.moves):
                await self.hw.leds_off()
                self._set("done", "Line complete")
        except asyncio.CancelledError:
            pass
        except (RobotSafetyError, HardwareError, TransportError, UnsupportedOperation) as e:
            self._set("error", str(e))

    async def _physical_to(self, index: int) -> None:
        target = self.boards[index]
        self.sync = "moving"
        self._emit()
        state = await self.hw.robot_execute(target, f"playback {self.title} @ {index}")
        if state != "completed":
            self.sync = "uncertain"
            self._set("error", f"Robot ended in state '{state}'. Playback halted; resolve it in Robot Studio.")
            raise asyncio.CancelledError
        self.index = index
        self.sync = "verified"
        self._emit()

    def _guided_event(self, res: dict[str, Any]) -> None:
        self.sync = res.get("status", "?")
        self._wake.set()
        self._emit()

    def _guided_sync(self) -> None:
        self.hw.claim(self.owner, self.boards[self.index], self._guided_event)

    async def _wait_sync(self, index: int) -> None:
        while not self.hw.in_sync_with(self.boards[index]):
            self._wake.clear()
            await self._wake.wait()
        self.sync = "verified"

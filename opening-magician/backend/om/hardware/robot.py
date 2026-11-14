"""Chessnut Move robotic control — application state machine and safety rules.

Device facts this module is built around (from the manufacturer's Move README):
  * a target position is requested with one 35-byte command;
  * ordinary FEN notifications are DISABLED while the board is moving pieces;
  * no "motion finished" acknowledgement is documented.

So "moving", "verifying" and "completed" are *application* states.  Completion is only
ever declared after a fresh sensor report matches the requested target.  If that cannot
be established the state is `recovery_required` and nothing is retried automatically.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Callable

import chess

from . import codec
from .driver import ChessnutDevice
from .reconcile import diff, diff_count, setup_instructions
from .transport import TransportError

STATES = ["disconnected", "connected", "scanning", "ready", "planning", "awaiting_confirmation", "movement_requested",
          "moving", "verifying", "completed", "stopping", "interrupted", "error", "recovery_required"]
BUSY = {"movement_requested", "moving", "verifying", "stopping"}


class RobotSafetyError(RuntimeError):
    pass


class RobotController:
    def __init__(self, device: ChessnutDevice, publish: Callable[[str, Any], None] | None = None,
                 seconds_per_piece: float = 7.0, poll_interval: float = 1.0, settle: float = 0.6):
        self.device = device
        self._publish = publish or (lambda *_: None)
        self.state = "connected" if device.connected else "disconnected"
        self.detail = ""
        self.seconds_per_piece, self.poll_interval, self.settle = seconds_per_piece, poll_interval, settle
        self.op: dict[str, Any] | None = None
        self.history: list[dict[str, Any]] = []
        self._task: asyncio.Task[None] | None = None
        self._op_seq = 0
        self._lock = asyncio.Lock()
        self._done: asyncio.Event = asyncio.Event()

    # -- state -------------------------------------------------------------
    def _set(self, state: str, detail: str = "") -> None:
        assert state in STATES
        self.state, self.detail = state, detail
        self.history.append({"t": time.time(), "state": state, "detail": detail})
        del self.history[:-100]
        self._publish("robot", self.status())

    def status(self) -> dict[str, Any]:
        op = None
        if self.op:
            op = {k: v for k, v in self.op.items() if k not in ("target", "before")}
            op["target_fen"] = codec.placement_fen(self.op["target"])
            op["before_fen"] = codec.placement_fen(self.op["before"]) if self.op.get("before") is not None else None
        return {"state": self.state, "detail": self.detail, "busy": self.state in BUSY, "operation": op,
                "simulated": self.device.simulated, "supported": self.device.caps.robotic,
                "live_motion_unlocked": self.device.simulated or self.device.profile.robot_verified,
                "telemetry_note": "Motion progress is application-inferred; the device documents no completion acknowledgement.",
                "history": self.history[-12:]}

    # -- scanning ----------------------------------------------------------
    async def scan(self) -> dict[int, str] | None:
        if self.state in BUSY:
            raise RobotSafetyError("Cannot rescan while a movement is in progress")
        self._set("scanning", "Reading the physical position")
        placement = await self.device.fresh_placement(4.0)
        if placement is None and self.device.placement is not None:
            placement = self.device.placement      # no change since the last report is also a valid answer
        if placement is None:
            self._set("error", "The board did not report a position")
            return None
        self._set("ready", "Physical position known")
        return placement

    # -- planning ------------------------------------------------------------
    def plan(self, target: chess.Board | str | dict[int, str], reason: str = "") -> dict[str, Any]:
        """Validate a target and describe what would happen.  Sends nothing."""
        if not self.device.caps.robotic:
            raise RobotSafetyError(f"{self.device.caps.label} cannot move pieces; use guided manual setup instead")
        if self.state in BUSY:
            raise RobotSafetyError("A movement is already in progress; stop it or wait before planning another")
        if self.state == "recovery_required":
            raise RobotSafetyError("Recovery required: resolve the uncertain physical state first")
        if not self.device.connected:
            raise RobotSafetyError("Board is not connected")
        tgt = target if isinstance(target, dict) else codec.placement_of(target)
        self._set("planning", reason)
        problems = codec.inventory_check(tgt)
        before = self.device.placement
        if before is None:
            problems.append("physical position is unknown — scan the board first")
        steps = setup_instructions(before or {}, tgt) if before is not None else []
        self._op_seq += 1
        self.op = {"id": self._op_seq, "target": tgt, "before": dict(before) if before is not None else None,
                   "reason": reason, "steps": steps, "pieces_to_move": len(steps), "problems": problems,
                   "feasible": not problems, "created_at": time.time(), "force": self.device.profile.force_moves,
                   "already_there": before == tgt}
        if problems:
            self._set("ready", "Target rejected: " + "; ".join(problems))
        else:
            self._set("awaiting_confirmation", f"{len(steps)} piece operation(s) planned")
        return self.status()

    def cancel_plan(self) -> None:
        if self.state == "awaiting_confirmation":
            self.op = None
            self._set("ready", "Plan discarded")

    # -- execution -----------------------------------------------------------
    async def confirm(self, op_id: int) -> dict[str, Any]:
        """Explicit go-ahead for exactly the plan that was previewed."""
        async with self._lock:
            if self.state != "awaiting_confirmation" or not self.op or self.op["id"] != op_id:
                raise RobotSafetyError("No matching plan is awaiting confirmation")
            if not self.device.simulated and not self.device.profile.robot_verified:
                raise RobotSafetyError(
                    "Live robotic motion is locked. Complete the hardware verification checklist (stop command "
                    "behaviour) in Robot Studio and unlock it for this device first.")
            if self.device.placement != self.op["before"]:
                self.op = None
                self._set("ready", "The physical position changed after planning; plan again")
                raise RobotSafetyError("The physical position changed after the plan was made")
            if self.op["already_there"]:
                self._set("completed", "Board already shows the target position")
                self._done.set()
                return self.status()
            self._done = asyncio.Event()
            self._set("movement_requested", "Sending target position")
            try:
                cmd = await self.device.send_target(self.op["target"])
            except TransportError as e:
                # The write may or may not have reached the board: physical state is uncertain.
                self._set("recovery_required", f"Target command failed in transit: {e}")
                self._done.set()
                raise RobotSafetyError(str(e))
            self.op.update({"sent_at": time.time(), "command_len": len(cmd),
                            "expected_s": round(max(4.0, self.op["pieces_to_move"] * self.seconds_per_piece), 1)})
            self._set("moving", "Operation pending — board is moving pieces (FEN notifications are off)")
            self._task = asyncio.get_running_loop().create_task(self._supervise(self.op["id"]))
            return self.status()

    async def execute(self, target: chess.Board | str | dict[int, str], reason: str, wait: bool = True,
                      timeout: float | None = None) -> dict[str, Any]:
        """Plan + confirm for an operation the user has already consented to as part of a sequence
        (opening playback, robot-executed game moves).  Same checks, same state machine."""
        self.plan(target, reason)
        if not self.op or not self.op["feasible"]:
            raise RobotSafetyError(self.detail)
        await self.confirm(self.op["id"])
        if wait:
            await self.wait(timeout)
        return self.status()

    async def wait(self, timeout: float | None = None) -> str:
        try:
            await asyncio.wait_for(self._done.wait(), timeout)
        except asyncio.TimeoutError:
            pass
        return self.state

    async def _supervise(self, op_id: int) -> None:
        op = self.op
        assert op is not None
        target = op["target"]
        t0 = time.time()
        timeout = max(20.0, op["expected_s"] * 3)
        last_pieces: list[tuple[int, int]] | None = None
        still = 0
        try:
            while self.op is op and self.state in ("moving", "verifying"):
                report = await self.device.next_report(self.poll_interval)
                elapsed = time.time() - t0
                if self.op is not op or self.state not in ("moving", "verifying"):
                    return
                if report is not None:
                    if report == target:
                        await self._verify(op, target)
                        return
                    op["last_report_diff"] = diff_count(target, report)
                # Telemetry: piece coordinates (documented command).  Only *stillness* is used —
                # the coordinate frame is not documented, so no square mapping is assumed.
                if self.device.caps.piece_status:
                    try:
                        await self.device.request_piece_status()
                    except TransportError:
                        pass
                    if self.device.pieces:
                        coords = [(p["x"], p["y"]) for p in self.device.pieces]
                        still = still + 1 if coords == last_pieces else 0
                        last_pieces = coords
                        op["telemetry"] = {"pieces_reported": len(coords), "still_polls": still}
                op["elapsed_s"] = round(elapsed, 1)
                likely_done = elapsed >= op["expected_s"] or (still >= 2 and elapsed >= self.settle)
                if likely_done:
                    self._set("verifying", "Requesting a fresh sensor report")
                    placement = await self.device.fresh_placement(max(1.5, self.poll_interval * 2))
                    if self.op is not op or self.state not in ("moving", "verifying"):
                        return
                    if placement == target:
                        await self._verify(op, target)
                        return
                    if elapsed >= timeout:
                        d = diff(target, placement) if placement is not None else None
                        op["mismatch"] = d
                        self._set("recovery_required",
                                  "Movement did not reach the target position" if placement is not None
                                  else "No position report after movement — physical state unknown")
                        return
                    self._set("moving", "Still moving (target not yet confirmed by the sensors)")
                else:
                    self._publish("robot", self.status())
        except TransportError as e:
            self._set("recovery_required", f"Connection problem during movement: {e}")
        except asyncio.CancelledError:
            raise
        finally:
            if self.state not in ("moving", "verifying"):
                self._done.set()

    async def _verify(self, op: dict[str, Any], target: dict[int, str]) -> None:
        self._set("verifying", "Target seen — confirming it is stable")
        await asyncio.sleep(self.settle)
        if self.device.placement == target:
            op["completed_at"] = time.time()
            op["duration_s"] = round(op["completed_at"] - op["sent_at"], 2)
            self._set("completed", "Verified by sensor reconciliation"
                      + (" (simulated board)" if self.device.simulated else ""))
        else:
            op["mismatch"] = diff(target, self.device.placement or {})
            self._set("recovery_required", "Position changed during verification")

    # -- stop ----------------------------------------------------------------
    async def stop(self) -> dict[str, Any]:
        """Emergency stop.  Always allowed; sends the documented stop command immediately."""
        if not self.device.caps.robotic:
            raise RobotSafetyError("This board has no motors")
        was_busy = self.state in BUSY
        self._set("stopping", "STOP sent")
        op = self.op
        if self._task and not self._task.done():
            self._task.cancel()
        try:
            await self.device.send_stop()
        except TransportError as e:
            self._set("recovery_required", f"STOP could not be delivered: {e}. Power the board off if pieces are still moving.")
            self._done.set()
            return self.status()
        await asyncio.sleep(self.settle)
        placement = await self.device.fresh_placement(3.0)
        if placement is None:
            placement = self.device.placement if not was_busy else None
        self._set("interrupted", "Movement interrupted by STOP" if was_busy else "STOP sent (no movement was in progress)")
        if not was_busy:
            self._set("ready", "Idle")
        elif placement is None:
            self._set("recovery_required", "No position report after STOP — physical state unknown")
        elif op and placement == op["target"]:
            self._set("ready", "Stopped; board already shows the target")
        elif op and placement == op.get("before"):
            self._set("ready", "Stopped; board still shows the starting position")
        else:
            if op:
                op["mismatch"] = diff(op["target"], placement)
            self._set("recovery_required", "Stopped mid-movement: pieces are between positions")
        self._done.set()
        return self.status()

    # -- recovery --------------------------------------------------------------
    async def recover(self, action: str) -> dict[str, Any]:
        """rescan: re-read the sensors.  accept: adopt whatever is on the board as the known state.
        Neither moves any motor — a new movement always needs a new plan and confirmation."""
        if self.state in BUSY:
            raise RobotSafetyError("Stop the current movement first")
        if action not in ("rescan", "accept"):
            raise RobotSafetyError(f"Unknown recovery action: {action}")
        placement = await self.device.fresh_placement(4.0) or self.device.placement
        if placement is None:
            self._set("recovery_required", "Board still reports no position")
            return self.status()
        op = self.op
        if action == "rescan" and op and placement not in (op["target"], op.get("before")):
            op["mismatch"] = diff(op["target"], placement)
            op["manual_steps"] = setup_instructions(placement, op["target"])
            self._set("recovery_required", "Position still differs from the target; fix by hand or accept the current position")
            return self.status()
        self.op = None
        self._set("ready", "Physical state confirmed" if action == "rescan" else "Current physical position accepted")
        return self.status()

    # -- external events ---------------------------------------------------------
    def on_disconnect(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
        busy = self.state in BUSY
        self._set("disconnected", "Connection lost during movement — recovery required after reconnecting" if busy else "")
        self.needs_recovery_on_connect = busy
        self._done.set()

    def on_connect(self) -> None:
        if getattr(self, "needs_recovery_on_connect", False):
            self._set("recovery_required", "Reconnected after an interrupted movement: verify the board")
        else:
            self._set("connected", "")

    def on_manual_change(self, placement: dict[int, str]) -> None:
        """A sensor report arrived while idle with a plan pending: the plan is stale."""
        if self.state == "awaiting_confirmation" and self.op and placement != self.op["before"]:
            self.op = None
            self._set("ready", "Board changed by hand; previous plan discarded")
        elif self.state == "completed" and self.op and placement != self.op["target"]:
            self._set("ready", "")

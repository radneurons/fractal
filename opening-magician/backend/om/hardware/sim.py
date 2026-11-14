"""Simulated Chessnut firmware.

`SimTransport` is a `Transport`: the driver writes the same documented byte commands to
it that it would write to a real board, and receives notifications of the documented
lengths back.  It exists for development, tests and demos, and everything it does is
flagged `simulated`.  Its behaviour for things the manufacturer does not document
(how long a motion takes, what a stop leaves on the board) is an *assumption of the
simulator*, not a claim about real devices.
"""
from __future__ import annotations

import asyncio
import random
from typing import Any, Callable

import chess

from . import codec
from .transport import Transport, TransportError


class SimTransport(Transport):
    simulated = True

    def __init__(self, model: str = "move", fen: str | None = None, step_time: float = 0.7):
        super().__init__()
        self.caps = codec.CAPS[model]
        self.name = f"{self.caps.label} (SIMULATED)"
        self.address = f"SIM-{model.upper()}"
        self.placement: dict[int, str] = codec.placement_of(chess.Board(fen) if fen else chess.Board())
        self.lifted: dict[int, str] = {}          # pieces currently in the air (not sensed)
        self.realtime = False
        self.battery, self.charging = 87, False
        self.leds: dict[int, int] = {}
        self.step_time = step_time
        self.moving = False
        self.motion_task: asyncio.Task[None] | None = None
        self.motion: dict[str, Any] = {}
        self.fault: str | None = None             # "stall" | "misplace" | None
        self.stop_variant_accepted = ("len35", "len36")
        self.writes: list[bytes] = []
        self.on_sim_state: Callable[[dict[str, Any]], None] | None = None
        self.piece_battery = {i: random.randint(70, 100) for i in range(34)}
        self.tray: dict[str, int] = {}
        self._recount_tray()

    # -- Transport ---------------------------------------------------------
    async def connect(self) -> None:
        await asyncio.sleep(0)
        self.connected = True
        self._emit_state()

    async def disconnect(self) -> None:
        self.connected = False
        self._cancel_motion()
        self._emit_state()

    async def write(self, data: bytes) -> None:
        if not self.connected:
            raise TransportError("Board is not connected")
        data = bytes(data)
        self.writes.append(data)
        del self.writes[:-200]
        await asyncio.sleep(0)
        if data == codec.ENABLE_REALTIME:
            self.realtime = True
            if not self.moving:
                self._report()
        elif self.caps.family == "air":
            self._air(data)
        else:
            self._move(data)

    # -- firmware: non-Move ------------------------------------------------
    def _air(self, data: bytes) -> None:
        if data == codec.AIR_BATTERY_REQ:
            self._respond(codec.build_air_battery(self.battery, self.charging))
        elif data[:2] == codec.AIR_LED_HEAD and len(data) == 10:
            self.leds = {sq: 1 for sq in codec.air_led_decode(data)}
            self._emit_state()
        # anything else is ignored, as an unknown command would be

    # -- firmware: Move ----------------------------------------------------
    def _move(self, data: bytes) -> None:
        if data == codec.MOVE_BATTERY_REQ:
            self._respond(codec.build_move_battery(self.battery, self.charging))
        elif data == codec.MOVE_PIECES_REQ:
            self._respond(codec.build_move_pieces(self._piece_status()))
        elif data[:2] == codec.MOVE_LED_HEAD and len(data) == 34:
            self.leds = codec.move_led_decode(data)
            self._emit_state()
        elif codec.is_move_stop(data):
            self._halt("stop command")
        elif data[:2] == codec.MOVE_TARGET_HEAD and len(data) == 35:
            try:
                target = codec.decode_placement(data[2:34])
            except codec.ProtocolError:
                return
            self._start_motion(target, force=data[34] == codec.FORCE)

    def _start_motion(self, target: dict[int, str], force: bool) -> None:
        self._cancel_motion()
        self.moving = True
        self.motion = {"target": target, "force": force, "steps": self._plan(target), "done": 0, "halted": None}
        self._emit_state()
        self.motion_task = asyncio.get_running_loop().create_task(self._run_motion())

    def _plan(self, target: dict[int, str]) -> list[dict[str, Any]]:
        """Greedy piece routing: remove surplus pieces, relocate same-type pieces, bring in missing ones."""
        cur = dict(self.placement)
        steps: list[dict[str, Any]] = []
        wrong = [sq for sq, s in cur.items() if target.get(sq) != s]
        need = [sq for sq, s in target.items() if cur.get(sq) != s]
        sources = {sq: cur[sq] for sq in wrong}
        relocations = []
        for dst in list(need):
            sym = target[dst]
            cands = [sq for sq, s in sources.items() if s == sym]
            if cands:
                src = min(cands, key=lambda s: chess.square_distance(s, dst))
                del sources[src]
                relocations.append((src, dst, sym))
                need.remove(dst)
        for sq, sym in sources.items():                       # captured / surplus pieces leave first
            steps.append({"kind": "remove", "from": sq, "symbol": sym})
        # order relocations so a destination is free before a piece drives onto it
        pending = list(relocations)
        occupied = {sq for sq in cur if sq not in sources}
        guard = 0
        while pending and guard < 200:
            guard += 1
            for r in list(pending):
                src, dst, sym = r
                if dst not in occupied or dst == src:
                    steps.append({"kind": "move", "from": src, "to": dst, "symbol": sym})
                    occupied.discard(src)
                    occupied.add(dst)
                    pending.remove(r)
                    break
            else:  # cycle: park one piece on the tray side and bring it back
                src, dst, sym = pending.pop(0)
                steps.append({"kind": "remove", "from": src, "symbol": sym})
                occupied.discard(src)
                steps.append({"kind": "add", "to": dst, "symbol": sym, "deferred": True})
        for dst in need:
            steps.append({"kind": "add", "to": dst, "symbol": target[dst]})
        # deferred adds must come after everything else
        steps.sort(key=lambda s: 1 if s.get("deferred") else 0)
        return steps

    async def _run_motion(self) -> None:
        try:
            steps = self.motion["steps"]
            for i, st in enumerate(steps):
                if self.fault == "stall" and i >= max(1, len(steps) // 2):
                    self.motion["halted"] = "simulated motor stall"
                    self.fault = None
                    self.moving = False
                    self._emit_state()
                    return
                if "from" in st:
                    self.lifted[st["from"]] = self.placement.pop(st["from"], st["symbol"])
                self._emit_state()
                dist = chess.square_distance(st.get("from", st.get("to", 0)), st.get("to", st.get("from", 0))) or 3
                await asyncio.sleep(self.step_time * (0.6 + 0.2 * dist))
                if "from" in st:
                    self.lifted.pop(st["from"], None)
                if st["kind"] in ("move", "add"):
                    dst = st["to"]
                    if self.fault == "misplace":
                        self.fault = None
                        alt = next((s for s in chess.SquareSet(chess.BB_KING_ATTACKS[dst]) if s not in self.placement), dst)
                        dst = alt
                    self.placement[dst] = st["symbol"]
                self._recount_tray()
                self.motion["done"] = i + 1
                self._emit_state()
            self.moving = False
            self._emit_state()
            if self.realtime:
                self._report()      # notifications resume once the motion has finished
        except asyncio.CancelledError:
            pass

    def _halt(self, why: str) -> None:
        if not self.moving:
            return
        self._cancel_motion()
        # A piece that was in flight is treated as left between squares: not sensed anywhere.
        self.lifted.clear()
        self.moving = False
        self.motion["halted"] = why
        self._recount_tray()
        self._emit_state()
        if self.realtime:
            self._report()

    def _cancel_motion(self) -> None:
        if self.motion_task and not self.motion_task.done():
            self.motion_task.cancel()
        self.motion_task = None

    def _piece_status(self) -> list[tuple[int, int, int, int]]:
        """34 × (identity, x, y, battery).  Simulator convention: board squares map linearly to
        0..255; pieces not on the board report a parked position on the left/right edge."""
        ident = {v: k for k, v in codec.MOVE_IDENTITY.items()}
        remaining: dict[str, list[int]] = {}
        for sq, sym in sorted({**self.placement, **self.lifted}.items()):
            remaining.setdefault(sym, []).append(sq)
        out = []
        parked = 0
        for i, sym in enumerate(codec.MOVE_PIECE_ORDER):
            sqs = remaining.get(sym) or []
            if sqs:
                sq = sqs.pop(0)
                x = int((chess.square_file(sq) + 0.5) / 8 * 255)
                y = int((chess.square_rank(sq) + 0.5) / 8 * 255)
            else:
                parked += 1
                x, y = (0 if sym.isupper() else 255), min(255, parked * 14)
            out.append((ident[sym], x, y, self.piece_battery[i]))
        return out

    def _recount_tray(self) -> None:
        counts: dict[str, int] = {}
        for s in list(self.placement.values()) + list(self.lifted.values()):
            counts[s] = counts.get(s, 0) + 1
        self.tray = {s: n - counts.get(s, 0) for s, n in codec.MOVE_INVENTORY.items()}

    # -- notifications -----------------------------------------------------
    def _report(self) -> None:
        if self.connected and self.realtime and self.on_fen and not self.moving:
            self.on_fen(codec.build_report(self.placement, self.caps.report_len))

    def _respond(self, data: bytes) -> None:
        if self.connected and self.on_response:
            self.on_response(data)

    def _emit_state(self) -> None:
        if self.on_sim_state:
            self.on_sim_state(self.state())

    def state(self) -> dict[str, Any]:
        return {"simulated": True, "model": self.caps.model, "connected": self.connected,
                "board_fen": codec.placement_fen(self.placement),
                "lifted": {chess.square_name(s): p for s, p in self.lifted.items()},
                "leds": {chess.square_name(s): v for s, v in self.leds.items()},
                "battery": self.battery, "charging": self.charging, "moving": self.moving, "realtime": self.realtime,
                "motion": {"total": len(self.motion.get("steps", [])), "done": self.motion.get("done", 0),
                           "halted": self.motion.get("halted")} if self.motion else None,
                "fault": self.fault, "tray": self.tray}

    # -- "hands" API: what a person (or a test) does to the simulated board ----
    def _touch(self) -> None:
        """Manual interference during a non-force motion halts it (documented flag semantics)."""
        if self.moving and not self.motion.get("force"):
            self._halt("manual interference (non-force)")

    def lift(self, square: int) -> str | None:
        self._touch()
        sym = self.placement.pop(square, None)
        if sym:
            self.lifted[square] = sym
            self._recount_tray()
            self._emit_state()
            self._report()
        return sym

    def place(self, square: int, symbol: str) -> None:
        self._touch()
        for k, v in list(self.lifted.items()):
            if v == symbol:
                del self.lifted[k]
                break
        self.placement[square] = symbol
        self._recount_tray()
        self._emit_state()
        self._report()

    def remove(self, square: int) -> None:
        self._touch()
        self.placement.pop(square, None)
        self.lifted.pop(square, None)
        self._recount_tray()
        self._emit_state()
        self._report()

    def set_position(self, board_or_fen: chess.Board | str) -> None:
        self._touch()
        self.placement = codec.placement_of(board_or_fen)
        self.lifted.clear()
        self._recount_tray()
        self._emit_state()
        self._report()

    def play(self, board: chess.Board, move: chess.Move, complete: bool = True) -> None:
        """Perform a move the way a hand does: capture first, lift, (optionally) put down, rook for castling."""
        piece = board.piece_at(move.from_square)
        if piece is None:
            return
        if board.is_en_passant(move):
            self.remove(chess.square(chess.square_file(move.to_square), chess.square_rank(move.from_square)))
        elif board.is_capture(move):
            self.remove(move.to_square)
        self.lift(move.from_square)
        if not complete:
            return
        sym = chess.Piece(move.promotion, piece.color).symbol() if move.promotion else piece.symbol()
        if move.promotion:
            self.lifted.pop(move.from_square, None)
        self.place(move.to_square, sym)
        if board.is_castling(move):
            kingside = chess.square_file(move.to_square) == 6
            rank = chess.square_rank(move.from_square)
            r_from, r_to = chess.square(7 if kingside else 0, rank), chess.square(5 if kingside else 3, rank)
            rook = self.lift(r_from)
            if rook:
                self.place(r_to, rook)

    def set_battery(self, percent: int, charging: bool = False) -> None:
        self.battery, self.charging = max(0, min(100, percent)), charging
        self._emit_state()

    def drop_connection(self) -> None:
        self.connected = False
        self._cancel_motion()
        self.moving = False
        self._emit_state()
        if self.on_disconnect:
            self.on_disconnect()

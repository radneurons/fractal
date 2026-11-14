"""Capability-based Chessnut device driver.

One class, two verified profiles (non-Move family, Move).  Every write is serialised
through a single lock, logged, and built by `codec` from documented structures only.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import chess

from . import codec
from .transport import Transport, TransportError


@dataclass
class DeviceProfile:
    """Per-device switches for the documented ambiguities + user safety confirmations."""
    led_bit_order: str = "h_lsb"            # non-Move LED bit order inside a rank byte
    stop_variant: str = "len35"             # Move stop command length variant
    force_moves: bool = False               # False = non-force: a touched piece halts auto-move
    robot_verified: bool = False            # user confirmed stop behaviour on *their* hardware
    auto_queen: bool = False                # treat a pawn left on the last rank as a queen
    orientation: str = "white"              # which side sits at ranks 1-2 on the physical board

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)

    @staticmethod
    def from_dict(d: dict[str, Any] | None) -> "DeviceProfile":
        p = DeviceProfile()
        for k, v in (d or {}).items():
            if hasattr(p, k):
                setattr(p, k, v)
        return p


class UnsupportedOperation(RuntimeError):
    pass


class ChessnutDevice:
    def __init__(self, transport: Transport, caps: codec.Capabilities, profile: DeviceProfile | None = None,
                 log: Callable[[str, str, bytes | None, str], None] | None = None):
        self.transport, self.caps = transport, caps
        self.profile = profile or DeviceProfile()
        self._log = log or (lambda *a: None)
        self._write_lock = asyncio.Lock()
        self.placement: dict[int, str] | None = None
        self.last_report_at: float | None = None
        self.report_count = 0
        self.length_warnings = 0
        self.battery: dict[str, Any] | None = None
        self.pieces: list[dict[str, Any]] | None = None
        self.pieces_at: float | None = None
        self.leds: dict[int, int] = {}
        self.on_placement: Callable[[dict[int, str]], None] | None = None
        self.on_battery: Callable[[dict[str, Any]], None] | None = None
        self.on_pieces: Callable[[list[dict[str, Any]]], None] | None = None
        self.on_disconnect: Callable[[], None] | None = None
        self._placement_waiters: list[asyncio.Future[dict[int, str]]] = []
        transport.on_fen = self._handle_fen
        transport.on_response = self._handle_response
        transport.on_disconnect = self._handle_disconnect

    @property
    def simulated(self) -> bool:
        return self.transport.simulated

    @property
    def connected(self) -> bool:
        return self.transport.connected

    # -- lifecycle -----------------------------------------------------------
    async def connect(self) -> None:
        await self.transport.connect()
        self._log("event", "connected", None, self.transport.name)
        await self.enable_realtime()
        try:
            await self.request_battery()
        except TransportError:
            pass

    async def disconnect(self) -> None:
        try:
            if self.connected:
                await self.leds_off()
        except Exception:
            pass
        await self.transport.disconnect()
        self._log("event", "disconnected", None, "")

    # -- outgoing ------------------------------------------------------------
    async def _write(self, kind: str, data: bytes, note: str = "") -> None:
        async with self._write_lock:
            self._log("tx", kind, data, note)
            await self.transport.write(data)

    async def enable_realtime(self) -> None:
        await self._write("enable_realtime", codec.ENABLE_REALTIME)

    async def request_battery(self) -> None:
        await self._write("battery_request", codec.AIR_BATTERY_REQ if self.caps.family == "air" else codec.MOVE_BATTERY_REQ)

    async def request_piece_status(self) -> None:
        if not self.caps.piece_status:
            raise UnsupportedOperation(f"{self.caps.label} does not report piece status")
        await self._write("piece_status_request", codec.MOVE_PIECES_REQ)

    async def set_leds(self, leds: dict[int, str | int]) -> dict[str, Any]:
        """leds: {square: 'red'|'green'|'blue'|1|2|3}.  Monochrome boards light the same squares
        without colour — the returned dict says what was actually possible."""
        if self.caps.led == "rgb":
            cmd = codec.move_led_command(leds)
            self.leds = codec.move_led_decode(cmd)
            await self._write("led", cmd)
            return {"mode": "rgb", "squares": len(self.leds), "colors_shown": True}
        squares = {sq for sq, v in leds.items() if v not in (0, "off")}
        await self._write("led", codec.air_led_command(squares, self.profile.led_bit_order))
        self.leds = {sq: 1 for sq in squares}
        return {"mode": "mono", "squares": len(squares), "colors_shown": False}

    async def leds_off(self) -> None:
        await self.set_leds({})

    async def send_target(self, placement: dict[int, str], force: bool | None = None) -> bytes:
        if not self.caps.robotic:
            raise UnsupportedOperation(f"{self.caps.label} cannot move pieces by itself")
        cmd = codec.move_target_command(placement, self.profile.force_moves if force is None else force)
        await self._write("target_position", cmd, codec.placement_fen(placement))
        return cmd

    async def send_stop(self) -> bytes:
        if not self.caps.robotic:
            raise UnsupportedOperation(f"{self.caps.label} has no motors to stop")
        cmd = codec.move_stop_command(self.profile.stop_variant)
        # Stop bypasses nothing: it uses the same serialised writer so it cannot interleave mid-packet.
        await self._write("stop", cmd, self.profile.stop_variant)
        return cmd

    # -- incoming ------------------------------------------------------------
    def _handle_fen(self, data: bytes) -> None:
        try:
            rep = codec.decode_report(data, self.caps.report_len)
        except codec.ProtocolError as e:
            self._log("rx", "bad_report", data, str(e))
            return
        if not rep["length_ok"]:
            self.length_warnings += 1
            if self.length_warnings <= 3:
                self._log("rx", "report_length_warning", data[:4],
                          f"got {rep['length']} bytes, profile expects {self.caps.report_len}")
        self.report_count += 1
        self.last_report_at = time.time()
        changed = rep["placement"] != self.placement
        self.placement = rep["placement"]
        if changed:
            self._log("rx", "position", None, rep["board_fen"])
        for fut in self._placement_waiters:
            if not fut.done():
                fut.set_result(self.placement)
        self._placement_waiters.clear()
        if changed and self.on_placement:
            self.on_placement(self.placement)

    def _handle_response(self, data: bytes) -> None:
        if self.caps.family == "air":
            bat = codec.parse_air_battery(data)
            if bat:
                self.battery = bat
                self._log("rx", "battery", data, f"{bat['percent']}%")
                if self.on_battery:
                    self.on_battery(bat)
            else:
                self._log("rx", "response", data, "")
            return
        resp = codec.parse_move_response(data)
        if not resp:
            self._log("rx", "response", data, "")
        elif resp["type"] == "battery":
            self.battery = {"percent": resp["percent"], "charging": resp["charging"]}
            self._log("rx", "battery", data, f"{resp['percent']}%")
            if self.on_battery:
                self.on_battery(self.battery)
        elif resp["type"] == "pieces":
            self.pieces, self.pieces_at = resp["pieces"], time.time()
            if self.on_pieces:
                self.on_pieces(self.pieces)
        else:
            self._log("rx", "response", data, "unrecognised")

    def _handle_disconnect(self) -> None:
        self._log("event", "connection_lost", None, "")
        for fut in self._placement_waiters:
            if not fut.done():
                fut.set_exception(TransportError("Board disconnected"))
        self._placement_waiters.clear()
        if self.on_disconnect:
            self.on_disconnect()

    async def next_report(self, timeout: float) -> dict[int, str] | None:
        """Wait for the next position notification (any content)."""
        fut: asyncio.Future[dict[int, str]] = asyncio.get_running_loop().create_future()
        self._placement_waiters.append(fut)
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            if fut in self._placement_waiters:
                self._placement_waiters.remove(fut)
            return None

    async def fresh_placement(self, timeout: float = 3.0) -> dict[int, str] | None:
        """Ask the board to (re)start real-time reports and wait for one."""
        fut: asyncio.Future[dict[int, str]] = asyncio.get_running_loop().create_future()
        self._placement_waiters.append(fut)
        await self.enable_realtime()
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            if fut in self._placement_waiters:
                self._placement_waiters.remove(fut)
            return None

    def status(self) -> dict[str, Any]:
        return {"connected": self.connected, "simulated": self.simulated, "name": self.transport.name,
                "address": self.transport.address, "capabilities": self.caps.to_dict(), "profile": self.profile.to_dict(),
                "board_fen": codec.placement_fen(self.placement) if self.placement is not None else None,
                "battery": self.battery, "reports": self.report_count, "last_report_at": self.last_report_at,
                "length_warnings": self.length_warnings,
                "leds": {chess.square_name(s): v for s, v in self.leds.items()},
                "pieces": self.pieces, "pieces_at": self.pieces_at}


def guidance_leds(caps: codec.Capabilities, *, source: list[int] | None = None, dest: list[int] | None = None,
                  danger: list[int] | None = None) -> dict[int, str]:
    """Translate instructional intent into what the board can show.
    RGB boards: source blue, destination green, danger/capture red.  Mono boards: squares on."""
    leds: dict[int, str] = {}
    for sq in source or []:
        leds[sq] = "blue"
    for sq in dest or []:
        leds[sq] = "green"
    for sq in danger or []:
        leds[sq] = "red"
    return leds

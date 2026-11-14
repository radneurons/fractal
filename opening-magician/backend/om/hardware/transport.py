"""Transports: the real BLE link (bleak) and the abstract interface the simulator shares.

The driver only ever sees `Transport`; whether bytes go to a physical board or to the
simulated firmware is invisible to it — which is what makes the simulator a faithful
test bed for the same code path.
"""
from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from typing import Any, Callable

from . import codec

Callback = Callable[[bytes], None]


class TransportError(RuntimeError):
    pass


class Transport(ABC):
    simulated: bool = False
    name: str = ""
    address: str = ""

    def __init__(self) -> None:
        self.on_fen: Callback | None = None
        self.on_response: Callback | None = None
        self.on_disconnect: Callable[[], None] | None = None
        self.connected = False

    @abstractmethod
    async def connect(self) -> None: ...

    @abstractmethod
    async def disconnect(self) -> None: ...

    @abstractmethod
    async def write(self, data: bytes) -> None:
        """Write to the operation command characteristic."""


class BleakTransport(Transport):
    """Bluetooth LE link to a real Chessnut board."""

    def __init__(self, address: str, name: str = ""):
        super().__init__()
        self.address, self.name = address, name
        self._client: Any = None
        self.mtu: int | None = None

    async def connect(self) -> None:
        try:
            from bleak import BleakClient
        except Exception as e:  # pragma: no cover - import guard
            raise TransportError(f"Bluetooth support (bleak) is unavailable: {e}")

        def _lost(_client: Any) -> None:
            self.connected = False
            if self.on_disconnect:
                self.on_disconnect()

        self._client = BleakClient(self.address, disconnected_callback=_lost)
        try:
            await self._client.connect(timeout=20.0)
        except Exception as e:
            raise TransportError(f"Could not connect to {self.name or self.address}: {e}")
        # The eBoards documentation asks for an MTU of 500 when full FEN packets do not arrive.
        # BlueZ/CoreBluetooth negotiate the MTU themselves; on backends that allow it we request it.
        try:
            backend = getattr(self._client, "_backend", None)
            if backend is not None and hasattr(backend, "_acquire_mtu"):
                await backend._acquire_mtu()
            self.mtu = getattr(self._client, "mtu_size", None)
        except Exception:
            self.mtu = getattr(self._client, "mtu_size", None)
        try:
            await self._client.start_notify(codec.FEN_NOTIFY_CHAR, lambda _c, d: self.on_fen and self.on_fen(bytes(d)))
            await self._client.start_notify(codec.OP_NOTIFY_CHAR, lambda _c, d: self.on_response and self.on_response(bytes(d)))
        except Exception as e:
            await self.disconnect()
            raise TransportError(f"Device does not expose the documented Chessnut characteristics: {e}")
        self.connected = True

    async def disconnect(self) -> None:
        self.connected = False
        if self._client is not None:
            try:
                await self._client.disconnect()
            except Exception:
                pass

    async def write(self, data: bytes) -> None:
        if not self.connected or self._client is None:
            raise TransportError("Board is not connected")
        try:
            await self._client.write_gatt_char(codec.OP_WRITE_CHAR, data, response=False)
        except Exception as e:
            raise TransportError(f"Bluetooth write failed: {e}")


async def scan(timeout: float = 6.0) -> list[dict[str, Any]]:
    """Discover nearby Chessnut boards.  Returns [] (with no error) when Bluetooth is unavailable."""
    try:
        from bleak import BleakScanner
    except Exception as e:
        raise TransportError(f"Bluetooth support (bleak) is unavailable: {e}")
    try:
        found = await BleakScanner.discover(timeout=timeout, return_adv=True)
    except Exception as e:
        raise TransportError(f"Bluetooth scan failed: {e}")
    out = []
    for address, (device, adv) in found.items():
        name = adv.local_name or device.name or ""
        if "chessnut" not in name.lower():
            continue
        model = codec.model_from_name(name)
        out.append({"address": address, "name": name, "rssi": adv.rssi, "model": model,
                    "supported": model is not None,
                    "note": "" if model else "Unrecognised Chessnut model: needs its own verified profile"})
    return sorted(out, key=lambda d: -(d["rssi"] or -999))

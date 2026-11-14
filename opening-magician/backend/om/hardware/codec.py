"""Chessnut BLE wire formats — pure functions, no I/O.

Everything here is taken from the manufacturer's published documentation:

* non-Move boards (Air, Air+, Go, Pro):  https://github.com/chessnutech/Chessnut_eBoards
* Chessnut Move:                         https://github.com/chessnutech/chess_move_api

Nothing undocumented is transmitted.  Where the documentation is ambiguous the
ambiguity is surfaced as an explicit, named profile switch (see `DOC_AMBIGUITIES`)
that must be confirmed on real hardware — it is never silently guessed.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import chess

# --- GATT layout (identical for both device families) -----------------------
FEN_SERVICE = "1b7e8261-2877-41c3-b46e-cf057c562023"
FEN_NOTIFY_CHAR = "1b7e8262-2877-41c3-b46e-cf057c562023"
OP_SERVICE = "1b7e8271-2877-41c3-b46e-cf057c562023"
OP_WRITE_CHAR = "1b7e8272-2877-41c3-b46e-cf057c562023"
OP_NOTIFY_CHAR = "1b7e8273-2877-41c3-b46e-cf057c562023"
RECOMMENDED_MTU = 500  # eBoards doc: raise the MTU if full FEN packets do not arrive

# --- piece codes: index = nibble value ----------------------------------------
PIECE_CODES = ["", "q", "k", "b", "p", "n", "R", "P", "r", "B", "N", "Q", "K"]
CODE_OF = {sym: i for i, sym in enumerate(PIECE_CODES) if sym}

ENABLE_REALTIME = bytes([0x21, 0x01, 0x00])

# non-Move
AIR_REPORT_LEN = 36
AIR_BATTERY_REQ = bytes([0x29, 0x01, 0x00])
AIR_BATTERY_RESP_HEAD = 0x2A
AIR_LED_HEAD = bytes([0x0A, 0x08])

# Move
MOVE_REPORT_LEN = 38
MOVE_TARGET_HEAD = bytes([0x42, 0x21])
MOVE_LED_HEAD = bytes([0x43, 0x20])
MOVE_BATTERY_REQ = bytes([0x41, 0x01, 0x0C])
MOVE_PIECES_REQ = bytes([0x41, 0x01, 0x0B])
MOVE_RESP_HEAD = 0x41
FORCE = 0          # documented: 0 = force moves (override user interaction)
NON_FORCE = 1      # documented: 1 = non-force (a user-moved piece halts auto-move)
LED_OFF, LED_RED, LED_GREEN, LED_BLUE = 0, 1, 2, 3
LED_COLORS = {"off": 0, "red": 1, "green": 2, "blue": 3}

# Physical piece inventory of a Chessnut Move set, in the documented piece-status order.
MOVE_PIECE_ORDER = ["P"] * 8 + ["R", "R", "N", "N", "B", "B", "Q", "Q", "K"] + \
                   ["p"] * 8 + ["r", "r", "n", "n", "b", "b", "q", "q", "k"]
MOVE_INVENTORY = {s: MOVE_PIECE_ORDER.count(s) for s in set(MOVE_PIECE_ORDER)}
MOVE_IDENTITY = {1: "P", 2: "R", 3: "N", 4: "B", 5: "Q", 6: "K", 7: "p", 8: "r", 9: "n", 10: "b", 11: "q", 12: "k"}

DOC_AMBIGUITIES = [
    {"id": "air_led_length", "device": "air",
     "text": "The eBoards README says the LED command is 34 bytes but shows a 10-byte structure "
             "[0x0A, 0x08, 8 row bytes]. The 10-byte structure is used (2 header + 8 bitmask bytes, matching the 0x08 length byte)."},
    {"id": "air_led_bit_order", "device": "air",
     "text": "Each LED row byte is described as 'index from 8 to 1, h to a'. Implemented as rank 8 first and, within a "
             "byte, bit0 = h-file … bit7 = a-file (the same h-first order as the position nibbles). "
             "Profile switch `led_bit_order` = 'h_lsb' (default) or 'a_lsb'."},
    {"id": "move_stop_length", "device": "move",
     "text": "The Move README describes the stop command as [0x42, 0x21, …34 zeros…] and calls it 35 bytes; "
             "2 + 34 = 36. Profile switch `stop_variant` = 'len35' (2 header + 33 zeros, default — the same length as a "
             "target command) or 'len36' (2 header + 34 zeros). Verify on hardware before enabling live motion."},
    {"id": "move_motion_complete", "device": "move",
     "text": "No completion acknowledgement is documented and FEN notifications are disabled during auto-moves. "
             "Completion is therefore inferred by the application from post-movement sensor reconciliation "
             "(and piece-status polling), never reported as a device acknowledgement."},
]


class ProtocolError(ValueError):
    pass


# ---------------------------------------------------------------------------
# Board placement  <->  32 packed bytes
# ---------------------------------------------------------------------------
def _square_for(i: int) -> int:
    """Wire index i (0 = h8, 1 = g8 … 7 = a8, 8 = h7 … 63 = a1) -> python-chess square."""
    row, pos = divmod(i, 8)
    return chess.square(7 - pos, 7 - row)


WIRE_SQUARES = [_square_for(i) for i in range(64)]
WIRE_INDEX = {sq: i for i, sq in enumerate(WIRE_SQUARES)}


def decode_placement(payload: bytes) -> dict[int, str]:
    """32 packed bytes -> {square: piece symbol}.  Low nibble = first square of the pair."""
    if len(payload) != 32:
        raise ProtocolError(f"Position payload must be 32 bytes, got {len(payload)}")
    out: dict[int, str] = {}
    for i in range(64):
        byte = payload[i // 2]
        code = byte & 0x0F if i % 2 == 0 else byte >> 4
        if code >= len(PIECE_CODES):
            raise ProtocolError(f"Invalid piece code {code} at wire index {i}")
        if code:
            out[WIRE_SQUARES[i]] = PIECE_CODES[code]
    return out


def encode_placement(placement: dict[int, str]) -> bytes:
    data = bytearray(32)
    for sq, sym in placement.items():
        i = WIRE_INDEX[sq]
        code = CODE_OF[sym]
        data[i // 2] |= code if i % 2 == 0 else code << 4
    return bytes(data)


def placement_of(board: chess.Board | str) -> dict[int, str]:
    b = chess.Board(board) if isinstance(board, str) and " " in board else board
    if isinstance(b, str):
        bb = chess.Board(None)
        bb.set_board_fen(b)
        b = bb
    return {sq: p.symbol() for sq, p in b.piece_map().items()}


def placement_fen(placement: dict[int, str]) -> str:
    b = chess.Board(None)
    for sq, sym in placement.items():
        b.set_piece_at(sq, chess.Piece.from_symbol(sym))
    return b.board_fen()


def decode_report(data: bytes, expected_len: int | None = None) -> dict[str, Any]:
    """Decode a FEN-characteristic notification (36 bytes non-Move, 38 bytes Move)."""
    if len(data) < 34:
        raise ProtocolError(f"Position report too short: {len(data)} bytes (set the BLE MTU to {RECOMMENDED_MTU})")
    placement = decode_placement(bytes(data[2:34]))
    return {"placement": placement, "board_fen": placement_fen(placement), "length": len(data),
            "length_ok": expected_len is None or len(data) == expected_len, "header": bytes(data[:2]).hex(),
            "trailer": bytes(data[34:]).hex()}


def build_report(placement: dict[int, str], length: int, header: bytes = b"\x01\x24") -> bytes:
    """Simulator-side: build a notification of the documented length."""
    body = header[:2] + encode_placement(placement)
    return body + bytes(length - len(body))


# ---------------------------------------------------------------------------
# LEDs
# ---------------------------------------------------------------------------
def air_led_command(squares: set[int] | list[int], bit_order: str = "h_lsb") -> bytes:
    """[0x0A, 0x08, row8 … row1]; one bit per square (monochrome: on/off only)."""
    rows = bytearray(8)
    for sq in squares:
        f, r = chess.square_file(sq), chess.square_rank(sq)
        bit = (7 - f) if bit_order == "h_lsb" else f
        rows[7 - r] |= 1 << bit
    return AIR_LED_HEAD + bytes(rows)


def air_led_decode(cmd: bytes, bit_order: str = "h_lsb") -> set[int]:
    if len(cmd) != 10 or cmd[:2] != AIR_LED_HEAD:
        raise ProtocolError("Not a non-Move LED command")
    out = set()
    for i in range(8):
        for bit in range(8):
            if cmd[2 + i] >> bit & 1:
                f = (7 - bit) if bit_order == "h_lsb" else bit
                out.add(chess.square(f, 7 - i))
    return out


def move_led_command(colors: dict[int, int | str]) -> bytes:
    """[0x43, 0x20, 32 bytes]; one nibble per square in position order: 0 off, 1 red, 2 green, 3 blue."""
    data = bytearray(32)
    for sq, c in colors.items():
        v = LED_COLORS[c] if isinstance(c, str) else int(c)
        if not 0 <= v <= 3:
            raise ProtocolError(f"Unsupported LED colour value {v}")
        i = WIRE_INDEX[sq]
        data[i // 2] |= v if i % 2 == 0 else v << 4
    return MOVE_LED_HEAD + bytes(data)


def move_led_decode(cmd: bytes) -> dict[int, int]:
    if len(cmd) != 34 or cmd[:2] != MOVE_LED_HEAD:
        raise ProtocolError("Not a Move LED command")
    out = {}
    for i in range(64):
        b = cmd[2 + i // 2]
        v = b & 0x0F if i % 2 == 0 else b >> 4
        if v:
            out[WIRE_SQUARES[i]] = v
    return out


# ---------------------------------------------------------------------------
# Chessnut Move: target position / stop
# ---------------------------------------------------------------------------
def move_target_command(placement: dict[int, str], force: bool = False) -> bytes:
    """35 bytes: [0x42, 0x21, 32 position bytes, forceFlag] (0 = force, 1 = non-force)."""
    return MOVE_TARGET_HEAD + encode_placement(placement) + bytes([FORCE if force else NON_FORCE])


def move_stop_command(variant: str = "len35") -> bytes:
    if variant == "len35":
        return MOVE_TARGET_HEAD + bytes(33)
    if variant == "len36":
        return MOVE_TARGET_HEAD + bytes(34)
    raise ProtocolError(f"Unknown stop variant {variant}")


def is_move_stop(cmd: bytes) -> bool:
    return len(cmd) in (35, 36) and cmd[:2] == MOVE_TARGET_HEAD and not any(cmd[2:])


def inventory_check(placement: dict[int, str], inventory: dict[str, int] | None = None) -> list[str]:
    """Problems that make a target position impossible for the physical piece set."""
    inv = inventory or MOVE_INVENTORY
    problems = []
    counts: dict[str, int] = {}
    for sym in placement.values():
        counts[sym] = counts.get(sym, 0) + 1
    for sym, n in sorted(counts.items()):
        if n > inv.get(sym, 0):
            name = chess.piece_name(chess.Piece.from_symbol(sym).piece_type)
            side = "white" if sym.isupper() else "black"
            problems.append(f"needs {n} {side} {name}s but the set has {inv.get(sym, 0)}")
    for k in ("K", "k"):
        if counts.get(k, 0) != 1:
            problems.append(f"position must contain exactly one {'white' if k == 'K' else 'black'} king")
    return problems


# ---------------------------------------------------------------------------
# Battery / piece status
# ---------------------------------------------------------------------------
def parse_air_battery(resp: bytes) -> dict[str, Any] | None:
    """[0x2A, 0x02, level, reserved]; level bit7 = charging, bits 0..6 = percent."""
    if len(resp) >= 3 and resp[0] == AIR_BATTERY_RESP_HEAD and resp[1] == 0x02:
        return {"percent": min(100, resp[2] & 0x7F), "charging": bool(resp[2] & 0x80)}
    return None


def parse_move_response(resp: bytes) -> dict[str, Any] | None:
    """Responses share the 0x41 head; byte[2] selects battery (0x0C) or piece status (0x0B)."""
    if len(resp) < 3 or resp[0] != MOVE_RESP_HEAD:
        return None
    if resp[2] == 0x0C and len(resp) >= 5:
        return {"type": "battery", "charging": resp[3] == 1, "percent": min(100, resp[4])}
    if resp[2] == 0x0B:
        body = resp[3:]
        pieces = []
        for i in range(min(len(body) // 4, len(MOVE_PIECE_ORDER))):
            ident, x, y, bat = body[i * 4:i * 4 + 4]
            pieces.append({"index": i, "symbol": MOVE_PIECE_ORDER[i], "identity": ident,
                           "identity_symbol": MOVE_IDENTITY.get(ident), "x": x, "y": y, "battery": bat})
        return {"type": "pieces", "pieces": pieces, "complete": len(pieces) == len(MOVE_PIECE_ORDER)}
    return {"type": "unknown", "raw": resp.hex()}


def build_move_battery(percent: int, charging: bool) -> bytes:
    return bytes([0x41, 0x03, 0x0C, 1 if charging else 0, max(0, min(100, percent))])


def build_move_pieces(pieces: list[tuple[int, int, int, int]]) -> bytes:
    body = b"".join(bytes(p) for p in pieces)
    return bytes([0x41, (len(body) + 1) & 0xFF, 0x0B]) + body


def build_air_battery(percent: int, charging: bool) -> bytes:
    return bytes([0x2A, 0x02, (max(0, min(100, percent)) & 0x7F) | (0x80 if charging else 0), 0x00])


@dataclass(frozen=True)
class Capabilities:
    model: str
    family: str                 # "air" | "move"
    report_len: int
    robotic: bool
    led: str                    # "mono" | "rgb"
    piece_status: bool
    label: str

    def to_dict(self) -> dict[str, Any]:
        return {"model": self.model, "family": self.family, "report_len": self.report_len, "robotic": self.robotic,
                "led": self.led, "piece_status": self.piece_status, "label": self.label}


CAPS = {
    "air": Capabilities("air", "air", AIR_REPORT_LEN, False, "mono", False, "Chessnut Air"),
    "air_plus": Capabilities("air_plus", "air", AIR_REPORT_LEN, False, "mono", False, "Chessnut Air+"),
    "go": Capabilities("go", "air", AIR_REPORT_LEN, False, "mono", False, "Chessnut Go"),
    "pro": Capabilities("pro", "air", AIR_REPORT_LEN, False, "mono", False, "Chessnut Pro"),
    "move": Capabilities("move", "move", MOVE_REPORT_LEN, True, "rgb", True, "Chessnut Move"),
}


def model_from_name(name: str) -> str | None:
    """Map an advertised BLE name to a verified profile.  Unknown Chessnut models return None
    (they need their own verified profile before any command is sent)."""
    n = (name or "").lower()
    if "chessnut" not in n:
        return None
    if "move" in n:
        return "move"
    if "air+" in n or "air plus" in n or "airplus" in n:
        return "air_plus"
    if "air" in n:
        return "air"
    if "pro" in n:
        return "pro"
    if "go" in n:
        return "go"
    return None

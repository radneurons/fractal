"""Authoritative chess clock.

Pure, time-injected state machine (every method takes `now`), so it is exactly testable
and survives restarts by serialising to JSON.  Supported: unlimited, sudden death,
Fischer increment, Bronstein delay, simple (US) delay, multi-stage controls with
"N moves in T", hourglass, fixed time per move, correspondence, asymmetric time odds —
plus the physical-board policies:

* Human Physical Move Allowance — optional extra time for a person who has to move
  pieces by hand on a non-robotic board (fixed bonus per move, a grace delay before
  the clock starts, pausing while the opponent's move is being relayed onto the board,
  and a one-off setup allowance).
* Chessnut Move policies — whether mechanical execution time is charged.

These adjustments are casual/training aids; `label` says so and the UI shows it.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

WHITE, BLACK = "white", "black"
SIDES = (WHITE, BLACK)


def other(side: str) -> str:
    return BLACK if side == WHITE else WHITE


def _stage(d: dict[str, Any] | None = None, **kw: Any) -> dict[str, Any]:
    s = {"moves": None, "base_ms": 300_000, "increment_ms": 0, "delay_ms": 0, "delay_type": "none"}
    s.update(d or {})
    s.update(kw)
    if s["delay_type"] not in ("none", "simple", "bronstein"):
        raise ValueError(f"Unknown delay type: {s['delay_type']}")
    for k in ("base_ms", "increment_ms", "delay_ms"):
        s[k] = max(0, int(s[k]))
    s["moves"] = int(s["moves"]) if s["moves"] else None
    if s["delay_ms"] and s["delay_type"] == "none":
        s["delay_type"] = "simple"
    return s


DEFAULT_PHYSICAL = {
    "enabled": False,
    "per_move_allowance_ms": 0,   # bonus added after each of the human's moves
    "start_delay_ms": 0,          # grace before the human's clock starts running each turn
    "pause_for_sync": False,      # human clock waits while the opponent's move is placed on the board
    "sync_cap_ms": 60_000,        # longest pause per move (0 = no cap)
    "setup_allowance_ms": 0,      # one-off time to set up the pieces before move one
    "applies_to": "human",        # "human" | "both"
    "only_without_robot": True,   # skip the allowance when a Chessnut Move executes moves itself
}
DEFAULT_ROBOT = {"policy": "pause_during_motion"}  # continue | pause_during_motion | engine_thinking_only


def normalize_config(cfg: dict[str, Any] | None) -> dict[str, Any]:
    cfg = copy.deepcopy(cfg or {})
    kind = cfg.get("kind", "standard")
    if kind not in ("unlimited", "standard", "hourglass", "per_move", "correspondence"):
        raise ValueError(f"Unknown clock kind: {kind}")
    out: dict[str, Any] = {"kind": kind, "name": cfg.get("name", ""), "flag_policy": cfg.get("flag_policy", "lose"),
                           "label": cfg.get("label", "casual"), "per_move_ms": max(1000, int(cfg.get("per_move_ms", 30_000))),
                           "low_time_ms": int(cfg.get("low_time_ms", 20_000))}
    if out["flag_policy"] not in ("lose", "continue"):
        raise ValueError("flag_policy must be 'lose' or 'continue'")
    stages = cfg.get("stages")
    for side in SIDES:
        raw = cfg.get(side) or stages or [{}]
        st = [_stage(s) for s in raw]
        if not st:
            st = [_stage()]
        st[-1]["moves"] = None if len(st) == 1 and not st[-1]["moves"] else st[-1]["moves"]
        out[side] = st
    out["physical"] = {**DEFAULT_PHYSICAL, **(cfg.get("physical") or {})}
    out["robot"] = {**DEFAULT_ROBOT, **(cfg.get("robot") or {})}
    if out["robot"]["policy"] not in ("continue", "pause_during_motion", "engine_thinking_only"):
        raise ValueError("Unknown robot clock policy")
    if out["physical"]["applies_to"] not in ("human", "both"):
        raise ValueError("physical.applies_to must be 'human' or 'both'")
    return out


@dataclass
class Clock:
    config: dict[str, Any]
    remaining: dict[str, float] = field(default_factory=dict)        # ms
    stage: dict[str, int] = field(default_factory=dict)
    moves_in_stage: dict[str, int] = field(default_factory=dict)
    moves_total: dict[str, int] = field(default_factory=dict)
    running: str | None = None
    turn_started: float | None = None        # epoch seconds
    held_ms: float = 0.0                     # time excluded from the current turn so far
    holds: dict[str, dict[str, Any]] = field(default_factory=dict)   # reason -> {since, cap_ms}
    flagged: dict[str, bool] = field(default_factory=dict)
    flag_events: list[dict[str, Any]] = field(default_factory=list)
    human_sides: list[str] = field(default_factory=list)
    physical_active: bool = False            # a physical board is in use by the human
    robot_active: bool = False               # ...and it is a robotic board executing moves itself
    started: bool = False
    paused: bool = False
    log: list[dict[str, Any]] = field(default_factory=list)

    # ------------------------------------------------------------------
    @staticmethod
    def create(config: dict[str, Any] | None, human_sides: list[str] | None = None, physical_active: bool = False,
               robot_active: bool = False) -> "Clock":
        cfg = normalize_config(config)
        c = Clock(cfg, human_sides=list(human_sides or []), physical_active=physical_active, robot_active=robot_active)
        for s in SIDES:
            c.stage[s], c.moves_in_stage[s], c.moves_total[s], c.flagged[s] = 0, 0, 0, False
            c.remaining[s] = float(cfg["per_move_ms"] if cfg["kind"] in ("per_move", "correspondence") else cfg[s][0]["base_ms"])
        return c

    @property
    def unlimited(self) -> bool:
        return self.config["kind"] == "unlimited"

    def _st(self, side: str) -> dict[str, Any]:
        return self.config[side][min(self.stage[side], len(self.config[side]) - 1)]

    # -- physical allowance ------------------------------------------------
    def allowance_applies(self, side: str) -> bool:
        p = self.config["physical"]
        if not p["enabled"] or not self.physical_active:
            return False
        if p["only_without_robot"] and self.robot_active:
            return False
        return p["applies_to"] == "both" or side in self.human_sides

    def _free_ms(self, side: str) -> float:
        """Time at the start of a turn that is not charged (simple delay + physical grace)."""
        st = self._st(side)
        free = float(st["delay_ms"]) if st["delay_type"] == "simple" else 0.0
        if self.allowance_applies(side):
            free += self.config["physical"]["start_delay_ms"]
        return free

    # -- time accounting ---------------------------------------------------
    def _held_now(self, now: float) -> float:
        """Held time for the current turn including any hold in progress (overlaps counted once)."""
        total = self.held_ms
        if self.holds:
            since = min(h["since"] for h in self.holds.values())
            span = (now - since) * 1000
            caps = [h["cap_ms"] for h in self.holds.values()]
            if all(c for c in caps):
                span = min(span, max(caps))
            total += max(0.0, span)
        return total

    def _used_ms(self, now: float) -> float:
        """Raw thinking time of the running side this turn (holds excluded, delay not yet applied)."""
        if self.running is None or self.turn_started is None:
            return 0.0
        return max(0.0, (now - self.turn_started) * 1000 - self._held_now(now))

    def _charged_ms(self, now: float) -> float:
        if self.running is None:
            return 0.0
        return max(0.0, self._used_ms(now) - self._free_ms(self.running))

    def time_left(self, side: str, now: float) -> float | None:
        if self.unlimited:
            return None
        left = self.remaining[side]
        if side == self.running:
            left -= self._charged_ms(now)
        elif self.config["kind"] == "hourglass" and self.running is not None:
            left += self._charged_ms(now)
        return left

    def delay_left(self, now: float) -> float:
        if self.running is None:
            return 0.0
        return max(0.0, self._free_ms(self.running) - self._used_ms(now))

    # -- controls ----------------------------------------------------------
    def start(self, side: str, now: float) -> None:
        """Start the clock with `side` to move."""
        self.started, self.running, self.turn_started, self.held_ms = True, side, now, 0.0
        self.holds.clear()
        setup = self.config["physical"]["setup_allowance_ms"]
        if setup and self.allowance_applies(self.human_sides[0] if self.human_sides else side):
            self.hold("setup", now, cap_ms=setup)
        self.log.append({"t": now, "event": "start", "side": side})

    def hold(self, reason: str, now: float, cap_ms: float = 0) -> None:
        """Freeze the running clock (pause, board sync, robot motion, setup). Idempotent per reason."""
        if reason in self.holds or not self.started:
            return
        self.holds[reason] = {"since": now, "cap_ms": float(cap_ms or 0)}
        if reason == "pause":
            self.paused = True
        self.log.append({"t": now, "event": "hold", "reason": reason, "cap_ms": cap_ms})

    def release(self, reason: str, now: float) -> None:
        if reason not in self.holds:
            return
        # Bank the held span of the *whole* overlapping hold set up to now, then restart remaining holds.
        self.held_ms = self._held_now(now)
        del self.holds[reason]
        for h in self.holds.values():
            if h["cap_ms"]:
                h["cap_ms"] = max(1.0, h["cap_ms"] - (now - h["since"]) * 1000)
            h["since"] = now
        if reason == "pause":
            self.paused = False
        self.log.append({"t": now, "event": "release", "reason": reason})

    def pause(self, now: float) -> None:
        self.hold("pause", now)

    def resume(self, now: float) -> None:
        self.release("pause", now)

    def adjust(self, side: str, delta_ms: float, now: float, reason: str = "manual") -> None:
        if self.unlimited:
            return
        self.remaining[side] = max(0.0, self.remaining[side] + delta_ms)
        if self.remaining[side] > 0:
            self.flagged[side] = False
        self.log.append({"t": now, "event": "adjust", "side": side, "delta_ms": delta_ms, "reason": reason})

    def check_flag(self, now: float) -> str | None:
        """Returns the side whose time has expired (once), honouring flag_policy."""
        side = self.running
        if side is None or self.unlimited:
            return None
        left = self.time_left(side, now)
        if left is not None and left <= 0 and not self.flagged[side]:
            self.flagged[side] = True
            self.flag_events.append({"side": side, "t": now, "move": self.moves_total[side] + 1})
            self.log.append({"t": now, "event": "flag", "side": side})
            return side
        return None

    def press(self, now: float, charged_override_ms: float | None = None) -> dict[str, Any]:
        """The running side completed a move.  Applies delay/increment/stage rules and starts the opponent.

        `charged_override_ms` lets the caller charge an exact thinking time (e.g. the engine's own
        reported search time under the `engine_thinking_only` robot policy).
        """
        side = self.running
        if side is None:
            raise RuntimeError("Clock is not running")
        opp = other(side)
        kind = self.config["kind"]
        used = self._used_ms(now)
        charged = self._charged_ms(now) if charged_override_ms is None else max(0.0, charged_override_ms - self._free_ms(side))
        info: dict[str, Any] = {"side": side, "used_ms": round(used), "charged_ms": round(charged), "added_ms": 0,
                                "flagged": False, "stage_advanced": False}
        if kind != "unlimited":
            st = self._st(side)
            if kind in ("per_move", "correspondence"):
                if charged >= self.remaining[side]:
                    info["flagged"] = True
                self.remaining[side] = float(self.config["per_move_ms"])
            else:
                self.remaining[side] -= charged
                if self.remaining[side] <= 0:
                    info["flagged"] = True
                    self.remaining[side] = 0.0
                if kind == "hourglass":
                    self.remaining[opp] += charged
                add = 0.0
                if st["increment_ms"]:
                    add += st["increment_ms"]
                if st["delay_type"] == "bronstein":
                    add += min(float(st["delay_ms"]), used)
                if self.allowance_applies(side):
                    add += self.config["physical"]["per_move_allowance_ms"]
                if not info["flagged"] or self.config["flag_policy"] == "continue":
                    self.remaining[side] += add
                    info["added_ms"] = round(add)
            if info["flagged"] and not self.flagged[side]:
                self.flagged[side] = True
                self.flag_events.append({"side": side, "t": now, "move": self.moves_total[side] + 1})
        self.moves_total[side] += 1
        self.moves_in_stage[side] += 1
        if kind in ("standard", "hourglass"):
            st = self._st(side)
            if st["moves"] and self.moves_in_stage[side] >= st["moves"] and self.stage[side] < len(self.config[side]) - 1:
                self.stage[side] += 1
                self.moves_in_stage[side] = 0
                self.remaining[side] += self.config[side][self.stage[side]]["base_ms"]
                info["stage_advanced"] = True
        # hand over
        self.running, self.turn_started, self.held_ms = opp, now, 0.0
        for r in [r for r in self.holds if r != "pause"]:
            del self.holds[r]
        if "pause" in self.holds:
            self.holds["pause"]["since"] = now
        self.log.append({"t": now, "event": "press", **info})
        del self.log[:-400]
        return info

    def stop(self, now: float) -> None:
        if self.running is not None and not self.unlimited:
            self.remaining[self.running] = max(0.0, self.time_left(self.running, now) or 0.0)
        self.running, self.turn_started = None, None
        self.holds.clear()
        self.log.append({"t": now, "event": "stop"})

    def lost_on_time(self) -> str | None:
        if self.config["flag_policy"] != "lose":
            return None
        for s in SIDES:
            if self.flagged[s]:
                return s
        return None

    # -- engine interface ----------------------------------------------------
    def engine_limit_args(self, now: float) -> dict[str, float] | None:
        """wtime/btime/winc/binc (seconds) for a timed engine move; None when unlimited."""
        if self.unlimited:
            return None
        w, b = self.time_left(WHITE, now) or 0.0, self.time_left(BLACK, now) or 0.0
        sw, sb = self._st(WHITE), self._st(BLACK)
        args = {"white_clock": max(0.05, w / 1000), "black_clock": max(0.05, b / 1000),
                "white_inc": sw["increment_ms"] / 1000, "black_inc": sb["increment_ms"] / 1000}
        side = self.running or WHITE
        st = self._st(side)
        if st["moves"]:
            args["remaining_moves"] = max(1, st["moves"] - self.moves_in_stage[side])
        return args

    # -- persistence / UI ------------------------------------------------------
    def snapshot(self, now: float) -> dict[str, Any]:
        def side_view(s: str) -> dict[str, Any]:
            st = self._st(s)
            left = self.time_left(s, now)
            return {"ms": None if left is None else max(0, round(left)), "stage": self.stage[s],
                    "stages": len(self.config[s]), "moves_in_stage": self.moves_in_stage[s],
                    "moves_to_control": (st["moves"] - self.moves_in_stage[s]) if st["moves"] else None,
                    "increment_ms": st["increment_ms"], "delay_ms": st["delay_ms"], "delay_type": st["delay_type"],
                    "flagged": self.flagged[s], "allowance": self.allowance_applies(s),
                    "low": left is not None and left <= self.config["low_time_ms"]}
        return {"kind": self.config["kind"], "name": self.config.get("name", ""), "label": self.config["label"],
                "white": side_view(WHITE), "black": side_view(BLACK), "running": self.running,
                "holds": {k: {"elapsed_ms": round((now - v["since"]) * 1000), "cap_ms": v["cap_ms"]} for k, v in self.holds.items()},
                "frozen": bool(self.holds), "paused": self.paused, "started": self.started,
                "delay_left_ms": round(self.delay_left(now)), "server_time": now,
                "physical": self.config["physical"], "robot": self.config["robot"],
                "physical_active": self.physical_active, "robot_active": self.robot_active,
                "flag_policy": self.config["flag_policy"], "flag_events": self.flag_events[-6:]}

    def to_dict(self) -> dict[str, Any]:
        return {k: copy.deepcopy(getattr(self, k)) for k in (
            "config", "remaining", "stage", "moves_in_stage", "moves_total", "running", "turn_started", "held_ms",
            "holds", "flagged", "flag_events", "human_sides", "physical_active", "robot_active", "started", "paused")}

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Clock":
        c = Clock(d["config"])
        for k, v in d.items():
            setattr(c, k, copy.deepcopy(v))
        return c


def _mk(name: str, base_min: float, inc_s: float = 0, **kw: Any) -> dict[str, Any]:
    return {"name": name, "kind": "standard", "stages": [{"base_ms": int(base_min * 60_000), "increment_ms": int(inc_s * 1000)}], **kw}


PRESETS: list[dict[str, Any]] = [
    {"name": "Unlimited", "kind": "unlimited", "group": "Casual"},
    _mk("Bullet 1+0", 1, group="Bullet"), _mk("Bullet 2+1", 2, 1, group="Bullet"),
    _mk("Blitz 3+0", 3, group="Blitz"), _mk("Blitz 3+2", 3, 2, group="Blitz"), _mk("Blitz 5+0", 5, group="Blitz"),
    _mk("Blitz 5+3", 5, 3, group="Blitz"),
    _mk("Rapid 10+0", 10, group="Rapid"), _mk("Rapid 10+5", 10, 5, group="Rapid"), _mk("Rapid 15+10", 15, 10, group="Rapid"),
    _mk("Rapid 25+10", 25, 10, group="Rapid"),
    _mk("Classical 30+0", 30, group="Classical"), _mk("Classical 60+30", 60, 30, group="Classical"),
    {"name": "FIDE 90/40 + 30 min, 30 s increment", "kind": "standard", "group": "Classical", "label": "official",
     "stages": [{"moves": 40, "base_ms": 90 * 60_000, "increment_ms": 30_000}, {"base_ms": 30 * 60_000, "increment_ms": 30_000}]},
    {"name": "US 40/120, SD/60, 5 s delay", "kind": "standard", "group": "Classical", "label": "official",
     "stages": [{"moves": 40, "base_ms": 120 * 60_000, "delay_ms": 5000, "delay_type": "simple"},
                {"base_ms": 60 * 60_000, "delay_ms": 5000, "delay_type": "simple"}]},
    {"name": "Bronstein 5 min, 3 s delay", "kind": "standard", "group": "Delay",
     "stages": [{"base_ms": 300_000, "delay_ms": 3000, "delay_type": "bronstein"}]},
    {"name": "Simple delay 10 min, 5 s", "kind": "standard", "group": "Delay",
     "stages": [{"base_ms": 600_000, "delay_ms": 5000, "delay_type": "simple"}]},
    {"name": "Hourglass 1 min", "kind": "hourglass", "group": "Variant", "stages": [{"base_ms": 60_000}]},
    {"name": "10 s per move", "kind": "per_move", "group": "Variant", "per_move_ms": 10_000},
    {"name": "Correspondence 1 day/move", "kind": "correspondence", "group": "Variant", "per_move_ms": 86_400_000},
    {"name": "Time odds 5 min vs 1 min", "kind": "standard", "group": "Variant",
     "white": [{"base_ms": 300_000}], "black": [{"base_ms": 60_000}]},
    {"name": "Physical board 10+5 (+8 s hand-move allowance)", "kind": "standard", "group": "Physical board",
     "stages": [{"base_ms": 600_000, "increment_ms": 5000}],
     "physical": {"enabled": True, "per_move_allowance_ms": 8000, "pause_for_sync": True, "sync_cap_ms": 60_000,
                  "setup_allowance_ms": 120_000}},
    {"name": "Physical board blitz 5+3 (pause while relaying)", "kind": "standard", "group": "Physical board",
     "stages": [{"base_ms": 300_000, "increment_ms": 3000}],
     "physical": {"enabled": True, "start_delay_ms": 3000, "pause_for_sync": True, "sync_cap_ms": 30_000}},
    {"name": "Training: no flag 15+10", "kind": "standard", "group": "Training", "flag_policy": "continue",
     "stages": [{"base_ms": 900_000, "increment_ms": 10_000}]},
]

"""Livestream / spectator broadcasting.

A broadcast is a read-only, token-addressed view of ONE consented source (a game against
an engine, a tournament, a playback, or positions pushed from the analysis board).
Public state is built from an explicit whitelist — engine control, hardware control,
private annotations and research data are never part of it.  Video itself is produced by
the user's encoder (e.g. OBS with a Browser Source pointing at the spectator URL).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import secrets
from typing import Any, Callable

from .db import Database, new_id, now
from .events import EventBus

THEMES = ["minimal_grandmaster", "tournament_broadcast", "cinematic_3d", "dark_analytical", "light_editorial", "holographic_observatory"]
DEFAULT_CONFIG = {"theme": "tournament_broadcast", "show_eval": True, "show_pv": False, "show_arrows": True, "show_clock": True,
                  "show_standings": True, "show_opening": True, "show_engine": True, "camera": "broadcast", "transparent": False,
                  "orientation": "white"}


class BroadcastError(ValueError):
    pass


class BroadcastManager:
    def __init__(self, db: Database, bus: EventBus):
        self.db, self.bus = db, bus
        self.sources: dict[str, Callable[[dict[str, Any]], dict[str, Any] | None]] = {}
        self._last: dict[str, str] = {}
        self._task: asyncio.Task[None] | None = None
        self.viewers: dict[str, int] = {}

    def register_source(self, kind: str, fn: Callable[[dict[str, Any]], dict[str, Any] | None]) -> None:
        self.sources[kind] = fn

    def start(self) -> None:
        self._task = asyncio.get_running_loop().create_task(self._pump())

    async def shutdown(self) -> None:
        if self._task:
            self._task.cancel()

    # -- management (admin only) -------------------------------------------
    def create(self, title: str, source: dict[str, Any], config: dict[str, Any] | None = None, consent: bool = False) -> dict[str, Any]:
        if not consent:
            raise BroadcastError("Publishing requires explicit consent: nothing is broadcast by default")
        if source.get("kind") not in self.sources and source.get("kind") != "manual":
            raise BroadcastError(f"Unknown broadcast source '{source.get('kind')}'")
        cfg = {**DEFAULT_CONFIG, **(config or {})}
        if cfg["theme"] not in THEMES:
            raise BroadcastError("Unknown spectator theme")
        row = {"id": new_id("bc"), "token": secrets.token_urlsafe(16), "title": title or "Live board",
               "config": {**cfg, "source": source, "consent_at": now()}, "state": {}, "active": 1, "created_at": now()}
        self.db.insert("broadcasts", row)
        return self.public_admin(row)

    def list(self) -> list[dict[str, Any]]:
        return [self.public_admin(r) for r in self.db.all("broadcasts", order="created_at DESC")]

    def public_admin(self, r: dict[str, Any]) -> dict[str, Any]:
        return {"id": r["id"], "token": r["token"], "title": r["title"], "active": bool(r["active"]), "config": r["config"],
                "created_at": r["created_at"], "viewers": self.viewers.get(r["token"], 0),
                "path": f"/watch/{r['token']}", "obs_path": f"/watch/{r['token']}?obs=1"}

    def update(self, bid: str, *, active: bool | None = None, config: dict[str, Any] | None = None, title: str | None = None,
               source: dict[str, Any] | None = None) -> dict[str, Any]:
        r = self.db.get("broadcasts", bid)
        if not r:
            raise BroadcastError("Unknown broadcast")
        upd: dict[str, Any] = {}
        if active is not None:
            upd["active"] = int(active)
        cfg = dict(r["config"])
        if config:
            if config.get("theme") and config["theme"] not in THEMES:
                raise BroadcastError("Unknown spectator theme")
            cfg.update({k: v for k, v in config.items() if k in DEFAULT_CONFIG})
        if source:
            cfg["source"] = source
        upd["config"] = cfg
        if title:
            upd["title"] = title
        self.db.update("broadcasts", bid, upd)
        self._last.pop(r["token"], None)
        return self.public_admin(self.db.get("broadcasts", bid))  # type: ignore[arg-type]

    def push_manual(self, bid: str, state: dict[str, Any]) -> None:
        r = self.db.get("broadcasts", bid)
        if not r or r["config"]["source"].get("kind") != "manual":
            raise BroadcastError("Not a manual broadcast")
        allowed = {k: state.get(k) for k in ("fen", "sans", "last_move", "white", "black", "result", "eval", "pv", "arrows",
                                             "opening", "clock", "start_fen", "moves")}
        self.db.update("broadcasts", bid, {"state": allowed})

    def delete(self, bid: str) -> None:
        self.db.delete("broadcasts", bid)

    # -- public ----------------------------------------------------------------
    def public_state(self, token: str) -> dict[str, Any] | None:
        r = self.db.get("broadcasts", token, key="token")
        if not r:
            return None
        cfg = r["config"]
        view = {k: cfg[k] for k in DEFAULT_CONFIG}
        if not r["active"]:
            return {"title": r["title"], "live": False, "view": view, "game": None}
        src = cfg["source"]
        raw = dict(r["state"]) if src["kind"] == "manual" else (self.sources[src["kind"]](src) or {})
        game = None
        if raw:
            game = {"fen": raw.get("fen"), "start_fen": raw.get("start_fen"), "moves": raw.get("moves") or [],
                    "sans": raw.get("sans") or [], "last_move": raw.get("last_move"),
                    "white": raw.get("white"), "black": raw.get("black"), "result": raw.get("result"),
                    "status": raw.get("status"),
                    "opening": raw.get("opening") if cfg["show_opening"] else None,
                    "clock": raw.get("clock") if cfg["show_clock"] else None,
                    "eval": raw.get("eval") if cfg["show_eval"] else None,
                    "pv": raw.get("pv") if cfg["show_pv"] else None,
                    "arrows": raw.get("arrows") if cfg["show_arrows"] else None,
                    "engine": raw.get("engine") if cfg["show_engine"] else None,
                    "tournament": raw.get("tournament") if cfg["show_standings"] else
                    ({"name": raw["tournament"]["name"], "round": raw["tournament"].get("round")} if raw.get("tournament") else None)}
        return {"title": r["title"], "live": True, "view": view, "game": game, "server_time": now()}

    async def _pump(self) -> None:
        """Publish a new public state whenever it changes (cheap polling of the consented sources)."""
        while True:
            try:
                for r in self.db.all("broadcasts", "active=1"):
                    st = self.public_state(r["token"])
                    if st is None:
                        continue
                    probe = dict(st)
                    probe.pop("server_time", None)
                    if probe.get("game") and probe["game"].get("clock"):
                        c = dict(probe["game"]["clock"])
                        c.pop("server_time", None)
                        for side in ("white", "black"):
                            if isinstance(c.get(side), dict):
                                c[side] = {k: v for k, v in c[side].items() if k != "ms"}
                        probe = {**probe, "game": {**probe["game"], "clock": c}}
                    h = hashlib.sha1(json.dumps(probe, sort_keys=True, default=str).encode()).hexdigest()
                    if self._last.get(r["token"]) != h:
                        self._last[r["token"]] = h
                        self.bus.publish(f"broadcast:{r['token']}", "state", st)
            except asyncio.CancelledError:
                raise
            except Exception:
                pass
            await asyncio.sleep(0.4)

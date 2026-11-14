"""Native UCI engine management: registry, capability discovery, managed processes.

Engines are real subprocesses driven through python-chess' asyncio UCI implementation
(`uci`/`uciok`, `isready`/`readyok`, `setoption`, `ucinewgame`, `position`, `go`,
`stop`, `bestmove`).  Nothing in this module fabricates search output: every line the
UI shows was parsed from an engine's `info` stream.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import platform
import shutil
import sys
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Callable

import chess
import chess.engine

from ..chessx import Score, san_line
from ..db import Database, new_id, now
from .resources import Lease, ResourceManager

APPRENTICE_PATH = str(Path(__file__).with_name("apprentice.py"))
MANAGED_OPTIONS = {"multipv", "ponder", "uci_chess960", "uci_variant", "uci_analysemode"}
KNOWN_BINARIES = ["stockfish", "lc0", "berserk", "ethereal", "komodo", "dragon", "rubichess", "koivisto", "igel",
                  "obsidian", "caissa", "viridithas", "clover", "alexandria", "seer", "arasan", "crafty", "fruit", "rodent"]


class EngineError(RuntimeError):
    pass


@dataclass
class EngineSpec:
    """What to run: a registered engine plus option overrides (optionally from a saved profile)."""
    engine_id: str
    options: dict[str, Any] = field(default_factory=dict)
    profile_id: str | None = None
    label: str | None = None

    @staticmethod
    def from_dict(d: dict[str, Any] | str) -> "EngineSpec":
        if isinstance(d, str):
            return EngineSpec(d)
        return EngineSpec(d["engine_id"], dict(d.get("options") or {}), d.get("profile_id"), d.get("label"))

    def to_dict(self) -> dict[str, Any]:
        return {"engine_id": self.engine_id, "options": self.options, "profile_id": self.profile_id, "label": self.label}


def _option_to_dict(opt: chess.engine.Option) -> dict[str, Any]:
    return {"name": opt.name, "type": opt.type, "default": opt.default, "min": opt.min, "max": opt.max,
            "var": list(opt.var or [])}


def line_from_info(board: chess.Board, info: chess.engine.InfoDict, index: int = 1) -> dict[str, Any] | None:
    pv = info.get("pv") or []
    if not pv:
        return None
    score = Score.from_pov(info.get("score"), board.turn, info.get("wdl"))
    white = score if board.turn == chess.WHITE else score.negate()
    return {
        "multipv": int(info.get("multipv", index)), "move": pv[0].uci(), "san": board.san(pv[0]) if pv[0] in board.legal_moves else pv[0].uci(),
        "score": score.to_dict(), "score_white": white.to_dict(),
        "depth": info.get("depth"), "seldepth": info.get("seldepth"), "nodes": info.get("nodes"),
        "nps": info.get("nps"), "time_ms": int(info.get("time", 0) * 1000) if info.get("time") is not None else None,
        "hashfull": info.get("hashfull"), "tbhits": info.get("tbhits"),
        "pv": [m.uci() for m in pv], "pv_san": san_line(board, pv, 24),
    }


class EngineHandle:
    """A live, configured engine process holding a resource lease."""

    def __init__(self, manager: "EngineManager", row: dict[str, Any], protocol: chess.engine.UciProtocol,
                 transport: asyncio.SubprocessTransport, lease: Lease, options: dict[str, Any], spec: EngineSpec):
        self.manager, self.row, self.protocol, self.transport = manager, row, protocol, transport
        self.lease, self.options, self.spec = lease, options, spec
        self.name = spec.label or row["name"]
        self.closed = False
        self.busy = False
        self.signature = engine_signature(row, options)

    @property
    def pid(self) -> int | None:
        try:
            return self.transport.get_pid()
        except Exception:
            return None

    def supports(self, option: str) -> bool:
        return any(k.lower() == option.lower() for k in self.protocol.options)

    @property
    def max_multipv(self) -> int:
        for k, o in self.protocol.options.items():
            if k.lower() == "multipv":
                return int(o.max or 1)
        return 1

    async def new_game(self) -> None:
        # python-chess sends ucinewgame when the `game` object changes; nothing else to do.
        self._game = object()

    async def analyse(self, board: chess.Board, limit: chess.engine.Limit, *, multipv: int = 1,
                      root_moves: list[chess.Move] | None = None, timeout: float | None = None,
                      game: object | None = None) -> list[dict[str, Any]]:
        """Blocking analysis with a hard wall-clock guard; returns parsed lines ordered by multipv."""
        if board.is_game_over(claim_draw=False):
            return []
        mpv = max(1, min(multipv, self.max_multipv, board.legal_moves.count() if not root_moves else len(root_moves)))
        guard = timeout or _guard_for(limit)
        try:
            self.busy = True
            infos = await asyncio.wait_for(
                self.protocol.analyse(board, limit, multipv=mpv, root_moves=root_moves, game=game or getattr(self, "_game", None),
                                      info=chess.engine.INFO_ALL), guard)
        except asyncio.TimeoutError:
            await self._kill("unresponsive: exceeded hard time guard")
            raise EngineError(f"{self.name} did not answer within {guard:.0f}s and was terminated")
        except chess.engine.EngineTerminatedError as e:
            await self._crashed(str(e))
            raise EngineError(f"{self.name} terminated unexpectedly: {e}")
        except chess.engine.EngineError as e:
            raise EngineError(f"{self.name} protocol error: {e}")
        finally:
            self.busy = False
        if isinstance(infos, dict):
            infos = [infos]
        lines = [l for i, inf in enumerate(infos) if (l := line_from_info(board, inf, i + 1))]
        lines.sort(key=lambda l: l["multipv"])
        return lines

    async def play(self, board: chess.Board, limit: chess.engine.Limit, *, game: object | None = None,
                   root_moves: list[chess.Move] | None = None, timeout: float | None = None) -> dict[str, Any]:
        guard = timeout or _guard_for(limit)
        try:
            self.busy = True
            res = await asyncio.wait_for(
                self.protocol.play(board, limit, game=game or getattr(self, "_game", None), info=chess.engine.INFO_ALL,
                                   root_moves=root_moves), guard)
        except asyncio.TimeoutError:
            await self._kill("unresponsive during play")
            raise EngineError(f"{self.name} did not move within {guard:.0f}s and was terminated")
        except chess.engine.EngineTerminatedError as e:
            await self._crashed(str(e))
            raise EngineError(f"{self.name} terminated unexpectedly: {e}")
        except chess.engine.EngineError as e:
            raise EngineError(f"{self.name} protocol error: {e}")
        finally:
            self.busy = False
        if res.move is None or res.move not in board.legal_moves:
            raise EngineError(f"{self.name} returned an illegal or empty move: {res.move}")
        line = line_from_info(board, res.info) if res.info else None
        return {"move": res.move, "line": line, "resigned": res.resigned, "draw_offered": res.draw_offered}

    async def stream(self, board: chess.Board, limit: chess.engine.Limit | None = None, *, multipv: int = 1,
                     root_moves: list[chess.Move] | None = None) -> "chess.engine.AnalysisResult":
        mpv = max(1, min(multipv, self.max_multipv, max(1, board.legal_moves.count())))
        try:
            return await self.protocol.analysis(board, limit, multipv=mpv, root_moves=root_moves,
                                                info=chess.engine.INFO_ALL, game=getattr(self, "_game", None))
        except chess.engine.EngineTerminatedError as e:
            await self._crashed(str(e))
            raise EngineError(f"{self.name} terminated unexpectedly: {e}")

    async def _crashed(self, detail: str) -> None:
        self.manager.resources.note_crash(self.name, detail)
        await self.close(force=True)

    async def _kill(self, detail: str) -> None:
        self.manager.resources.note_crash(self.name, detail)
        await self.close(force=True)

    async def close(self, force: bool = False) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            if not force:
                await asyncio.wait_for(self.protocol.quit(), 2.0)
        except Exception:
            pass
        finally:
            try:
                self.transport.kill()
            except Exception:
                pass
            try:
                self.transport.close()
            except Exception:
                pass
            self.manager._handles.discard(self)
            self.manager.resources.release(self.lease)


def _guard_for(limit: chess.engine.Limit) -> float:
    """Hard wall-clock ceiling for a search so a hung engine can never stall a job."""
    if limit.time is not None:
        return limit.time * 2 + 10
    if limit.white_clock is not None or limit.black_clock is not None:
        return max(limit.white_clock or 0, limit.black_clock or 0) + 15
    if limit.depth is not None or limit.nodes is not None:
        return 600.0
    return 3600.0


def engine_signature(row: dict[str, Any], options: dict[str, Any]) -> str:
    """Identity of an analysis source: engine + version + every option that changes search results."""
    relevant = {k: v for k, v in sorted(options.items()) if k.lower() not in ("multipv", "ponder")}
    raw = json.dumps([row.get("name"), row.get("version"), row.get("path"), relevant], sort_keys=True, default=str)
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


class EngineManager:
    def __init__(self, db: Database, resources: ResourceManager | None = None):
        self.db = db
        self.resources = resources or ResourceManager()
        self._handles: set[EngineHandle] = set()
        self._multi_lock = asyncio.Lock()

    # -- registry -----------------------------------------------------------
    def list(self) -> list[dict[str, Any]]:
        return self.db.all("engines", order="kind DESC, name")

    def get(self, engine_id: str) -> dict[str, Any]:
        row = self.db.get("engines", engine_id)
        if not row:
            raise EngineError(f"Unknown engine: {engine_id}")
        return row

    def command(self, row: dict[str, Any]) -> list[str]:
        if row["kind"] == "bundled":
            return [sys.executable, "-u", APPRENTICE_PATH]
        return [row["path"], *row.get("args", [])]

    async def probe(self, command: list[str], timeout: float = 15.0) -> dict[str, Any]:
        """Run the real UCI handshake and read id + option table from the engine itself."""
        if not shutil.which(command[0]) and not os.path.isfile(command[0]):
            raise EngineError(f"Executable not found: {command[0]}")
        try:
            transport, protocol = await asyncio.wait_for(chess.engine.popen_uci(command), timeout)
        except asyncio.TimeoutError:
            raise EngineError("Engine did not complete the UCI handshake (no 'uciok') in time")
        except Exception as e:  # not a UCI engine, missing libs, wrong arch, permissions…
            raise EngineError(f"Could not start engine: {e}")
        try:
            await asyncio.wait_for(protocol.ping(), timeout)
            return {"name": protocol.id.get("name", Path(command[0]).stem), "author": protocol.id.get("author", ""),
                    "options": {k: _option_to_dict(o) for k, o in protocol.options.items()}}
        finally:
            try:
                await asyncio.wait_for(protocol.quit(), 2.0)
            except Exception:
                transport.kill()

    async def register(self, path: str, name: str | None = None, args: list[str] | None = None,
                       defaults: dict[str, Any] | None = None, notes: str = "", kind: str = "native") -> dict[str, Any]:
        path = str(Path(path).expanduser()) if kind == "native" else path
        if kind == "native":
            resolved = shutil.which(path) or path
            if not os.path.isfile(resolved):
                raise EngineError(f"Executable not found: {path}")
            if not os.access(resolved, os.X_OK):
                raise EngineError(f"File is not executable: {resolved}")
            path = os.path.abspath(resolved)      # keep symlinks: launchers (venv shims, wrappers) depend on their own path
        row = {"id": new_id("eng"), "name": name or "", "path": path, "args": args or [], "kind": kind,
               "platform": platform.system(), "arch": platform.machine(), "defaults": defaults or {}, "notes": notes,
               "status": "unverified", "created_at": now(), "options": {}, "version": "", "author": ""}
        info = await self.probe(self.command(row))
        row["options"], row["author"], row["status"], row["verified_at"] = info["options"], info["author"], "ok", now()
        row["name"] = name or info["name"]
        row["version"] = _version_of(info["name"])
        existing = self.db.all("engines", "path=? AND args=? AND kind=?", (path, json.dumps(row["args"], separators=(",", ":")), kind))
        if existing:
            row["id"] = existing[0]["id"]
            row["created_at"] = existing[0]["created_at"]
            row["defaults"] = defaults if defaults is not None else existing[0]["defaults"]
        self.db.upsert("engines", row)
        return row

    async def ensure_bundled(self) -> dict[str, Any]:
        rows = self.db.all("engines", "kind='bundled'")
        if rows and rows[0].get("options"):
            return rows[0]
        return await self.register(APPRENTICE_PATH, name="Apprentice (bundled)", kind="bundled",
                                   notes="Bundled weak Python engine (~club beginner). Real UCI process; "
                                         "use it as an explorer or sparring partner. Install a strong engine for serious analysis.")

    async def reverify(self, engine_id: str) -> dict[str, Any]:
        row = self.get(engine_id)
        try:
            info = await self.probe(self.command(row))
            self.db.update("engines", engine_id, {"options": info["options"], "status": "ok", "verified_at": now(),
                                                  "author": info["author"], "version": _version_of(info["name"])})
        except EngineError as e:
            self.db.update("engines", engine_id, {"status": f"error: {e}"})
            raise
        return self.get(engine_id)

    def detect(self) -> list[dict[str, str]]:
        """Find likely UCI engines already installed on this machine (never downloads anything)."""
        registered = {r["path"] for r in self.list()}
        found = []
        dirs = [Path(p) for p in os.environ.get("PATH", "").split(os.pathsep) if p]
        dirs += [Path("/usr/games"), Path("/usr/local/bin"), Path("/opt/homebrew/bin"), Path.home() / "engines",
                 Path(__file__).resolve().parents[3] / "engines-local"]
        seen = set()
        for d in dirs:
            if not d.is_dir():
                continue
            try:
                entries = list(d.iterdir())
            except OSError:
                continue
            for f in entries:
                low = f.name.lower()
                if any(low.startswith(k) for k in KNOWN_BINARIES) and f.is_file() and os.access(f, os.X_OK):
                    rp = str(f.resolve())
                    if rp not in seen:
                        seen.add(rp)
                        found.append({"path": rp, "name": f.name, "registered": rp in registered})
        return found

    def remove(self, engine_id: str) -> None:
        row = self.get(engine_id)
        if row["kind"] == "bundled":
            raise EngineError("The bundled engine cannot be removed")
        self.db.delete("engines", engine_id)

    # -- profiles -----------------------------------------------------------
    def profiles(self, engine_id: str | None = None) -> list[dict[str, Any]]:
        if engine_id:
            return self.db.all("engine_profiles", "engine_id=?", (engine_id,), order="name")
        return self.db.all("engine_profiles", order="name")

    def save_profile(self, engine_id: str, name: str, purpose: str = "", options: dict[str, Any] | None = None,
                     limits: dict[str, Any] | None = None, profile_id: str | None = None) -> dict[str, Any]:
        self.get(engine_id)
        row = {"id": profile_id or new_id("prof"), "engine_id": engine_id, "name": name, "purpose": purpose,
               "options": options or {}, "limits": limits or {}, "created_at": now()}
        self.db.upsert("engine_profiles", row)
        return row

    def resolve(self, spec: EngineSpec) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        """-> (engine row, effective options, profile limits)."""
        row = self.get(spec.engine_id)
        opts = dict(row.get("defaults") or {})
        limits: dict[str, Any] = {}
        if spec.profile_id:
            prof = self.db.get("engine_profiles", spec.profile_id)
            if prof:
                opts.update(prof["options"])
                limits = prof["limits"]
        opts.update(spec.options)
        return row, opts, limits

    # -- processes ----------------------------------------------------------
    async def open(self, spec: EngineSpec, purpose: str = "research", label: str | None = None) -> EngineHandle:
        row, opts, _ = self.resolve(spec)
        known = {k.lower(): k for k in row.get("options", {})}
        want_threads = int(opts.get("Threads", 1)) if "threads" in known else 1
        want_hash = int(opts.get("Hash", 16)) if "hash" in known else 16
        lease = await self.resources.acquire(label=label or row["name"], purpose=purpose, threads=want_threads, hash_mb=want_hash)
        lease.engine_name = row["name"]
        try:
            transport, protocol = await asyncio.wait_for(chess.engine.popen_uci(self.command(row)), 20)
        except Exception as e:
            self.resources.release(lease)
            self.resources.note_crash(row["name"], f"failed to start: {e}")
            raise EngineError(f"Could not start {row['name']}: {e}")
        lease.pid = transport.get_pid()
        effective: dict[str, Any] = {}
        for k, v in opts.items():
            real = known.get(k.lower())
            if real is None or k.lower() in MANAGED_OPTIONS:
                continue
            if real.lower() == "threads":
                v = lease.threads
            elif real.lower() == "hash":
                v = lease.hash_mb
            effective[real] = v
        if "threads" in known and "Threads" not in effective:
            effective[known["threads"]] = lease.threads
        if "hash" in known and known["hash"] not in effective:
            effective[known["hash"]] = lease.hash_mb
        try:
            if effective:
                await asyncio.wait_for(protocol.configure(effective), 20)
            await asyncio.wait_for(protocol.ping(), 30)
        except Exception as e:
            transport.kill()
            self.resources.release(lease)
            raise EngineError(f"Could not configure {row['name']}: {e}")
        handle = EngineHandle(self, row, protocol, transport, lease, effective, spec)
        self._handles.add(handle)
        return handle

    async def open_many(self, wanted: list[tuple[EngineSpec, str, str | None]]) -> list[EngineHandle]:
        """Open several engines as one unit (a game needs two, an experiment three).
        Multi-engine acquisition is serialised so two half-started games can never deadlock
        each other waiting for the last free slot."""
        handles: list[EngineHandle] = []
        async with self._multi_lock:
            try:
                for spec, purpose, label in wanted:
                    handles.append(await self.open(spec, purpose, label))
            except BaseException:
                for h in handles:
                    await h.close(force=True)
                raise
        return handles

    @asynccontextmanager
    async def session(self, spec: EngineSpec, purpose: str = "research", label: str | None = None) -> AsyncIterator[EngineHandle]:
        handle = await self.open(spec, purpose, label)
        try:
            yield handle
        finally:
            await handle.close()

    async def shutdown(self) -> None:
        for h in list(self._handles):
            await h.close(force=True)

    def active(self) -> list[dict[str, Any]]:
        return [{"name": h.name, "pid": h.pid, "busy": h.busy, "purpose": h.lease.purpose, "options": h.options}
                for h in self._handles]


def _version_of(name: str) -> str:
    parts = name.split()
    for i, p in enumerate(parts):
        if any(ch.isdigit() for ch in p):
            return " ".join(parts[i:])
    return ""


DEFAULT_PROFILES = [
    ("Fast Explorer", "Quick candidate generation", {}, {"min_time": 0.05, "max_time": 0.5, "min_depth": 4, "max_depth": 14}),
    ("Deep Tactical", "Long tactical verification", {}, {"min_time": 1.0, "max_time": 20.0, "min_depth": 16, "max_depth": 40}),
    ("Positional Analyst", "Stable positional evaluation", {}, {"min_time": 0.5, "max_time": 8.0, "min_depth": 14, "max_depth": 32}),
    ("Low-Strength Opponent", "Sparring partner", {"Skill Level": 5}, {"min_time": 0.05, "max_time": 1.0, "min_depth": 1, "max_depth": 8}),
    ("Experimental Candidate Finder", "Wide MultiPV candidate ranking", {}, {"min_time": 0.3, "max_time": 3.0, "min_depth": 8, "max_depth": 20, "multipv": 6}),
    ("Tournament Competitor", "Engine-vs-engine games", {}, {"min_time": 0.05, "max_time": 2.0, "min_depth": 4, "max_depth": 30}),
    ("Strong Independent Verifier", "Independent confirmation", {}, {"min_time": 2.0, "max_time": 30.0, "min_depth": 18, "max_depth": 45}),
]


def seed_profiles(manager: EngineManager, engine_id: str) -> None:
    if manager.profiles(engine_id):
        return
    row = manager.get(engine_id)
    has = {k.lower() for k in row.get("options", {})}
    for name, purpose, options, limits in DEFAULT_PROFILES:
        opts = {k: v for k, v in options.items() if k.lower() in has}
        manager.save_profile(engine_id, name, purpose, opts, limits)

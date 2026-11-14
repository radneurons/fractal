"""Engine resource manager.

Every engine process must hold a lease before it is spawned.  Leases are granted by
priority (hardware > interactive > tournament > research > background) and only while
the global budgets (process count, CPU threads, hash memory) are respected — so four
engines can never each grab every core.
"""
from __future__ import annotations

import asyncio
import itertools
import os
import time
from dataclasses import asdict, dataclass, field
from typing import Any

import psutil

PRIORITY = {"hardware": 0, "interactive": 1, "play": 1, "tournament": 3, "research": 5, "background": 7}


@dataclass
class Limits:
    max_engines: int = field(default_factory=lambda: max(2, (os.cpu_count() or 2)))
    thread_budget: int = field(default_factory=lambda: max(1, (os.cpu_count() or 2) - 1))
    hash_budget_mb: int = field(default_factory=lambda: max(256, int(psutil.virtual_memory().total / 2**20 * 0.4)))
    per_engine_threads: int = field(default_factory=lambda: max(1, (os.cpu_count() or 2) // 2))
    per_engine_hash_mb: int = 1024
    background_paused: bool = False
    daily_research_seconds: int = 0  # 0 = unlimited


@dataclass
class Lease:
    id: int
    label: str
    purpose: str
    priority: int
    threads: int
    hash_mb: int
    granted_at: float = 0.0
    pid: int | None = None
    engine_name: str = ""


class ResourceManager:
    def __init__(self, limits: Limits | None = None):
        self.limits = limits or Limits()
        self._leases: dict[int, Lease] = {}
        self._waiters: list[tuple[int, int, Lease, asyncio.Future[None]]] = []
        self._ids = itertools.count(1)
        self.crashes: list[dict[str, Any]] = []
        self.research_seconds_today = 0.0
        self._day = time.strftime("%Y-%m-%d")

    # -- budgets --------------------------------------------------------
    def clamp(self, threads: int, hash_mb: int) -> tuple[int, int]:
        l = self.limits
        return (max(1, min(threads, l.per_engine_threads, l.thread_budget)),
                max(1, min(hash_mb, l.per_engine_hash_mb, l.hash_budget_mb)))

    def _fits(self, lease: Lease) -> bool:
        l = self.limits
        if lease.priority >= PRIORITY["research"] and l.background_paused:
            return False
        if lease.priority >= PRIORITY["research"] and l.daily_research_seconds and \
                self.research_seconds_today >= l.daily_research_seconds:
            return False
        used_t = sum(x.threads for x in self._leases.values())
        used_h = sum(x.hash_mb for x in self._leases.values())
        # Hardware/interactive work may always start one engine, even over budget.
        if lease.priority <= PRIORITY["interactive"] and len(self._leases) < l.max_engines + 1:
            return used_t + lease.threads <= l.thread_budget + lease.threads
        return (len(self._leases) < l.max_engines and used_t + lease.threads <= l.thread_budget
                and used_h + lease.hash_mb <= l.hash_budget_mb)

    async def acquire(self, *, label: str, purpose: str = "research", threads: int = 1, hash_mb: int = 16) -> Lease:
        threads, hash_mb = self.clamp(threads, hash_mb)
        lease = Lease(next(self._ids), label, purpose, PRIORITY.get(purpose, 5), threads, hash_mb)
        if not self._waiters and self._fits(lease):
            return self._grant(lease)
        fut: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        entry = (lease.priority, lease.id, lease, fut)
        self._waiters.append(entry)
        self._waiters.sort(key=lambda e: (e[0], e[1]))
        self._pump()
        try:
            await fut
        except asyncio.CancelledError:
            if entry in self._waiters:
                self._waiters.remove(entry)
            elif lease.id in self._leases:
                self.release(lease)
            raise
        return lease

    def _grant(self, lease: Lease) -> Lease:
        lease.granted_at = time.time()
        self._leases[lease.id] = lease
        return lease

    def _pump(self) -> None:
        progressed = True
        while progressed and self._waiters:
            progressed = False
            for entry in list(self._waiters):
                _, _, lease, fut = entry
                if fut.cancelled():
                    self._waiters.remove(entry)
                    continue
                if self._fits(lease):
                    self._waiters.remove(entry)
                    self._grant(lease)
                    fut.set_result(None)
                    progressed = True
                    break
                if lease.priority <= PRIORITY["tournament"]:
                    break  # do not let lower-priority work jump a blocked important job

    def release(self, lease: Lease) -> None:
        if self._leases.pop(lease.id, None) is not None:
            if lease.priority >= PRIORITY["research"]:
                self._roll_day()
                self.research_seconds_today += max(0.0, time.time() - lease.granted_at)
        self._pump()

    def _roll_day(self) -> None:
        today = time.strftime("%Y-%m-%d")
        if today != self._day:
            self._day, self.research_seconds_today = today, 0.0

    # -- controls -------------------------------------------------------
    def update_limits(self, **kw: Any) -> Limits:
        for k, v in kw.items():
            if hasattr(self.limits, k) and v is not None:
                setattr(self.limits, k, type(getattr(self.limits, k))(v))
        self._pump()
        return self.limits

    def pause_background(self, paused: bool) -> None:
        self.limits.background_paused = paused
        self._pump()

    def note_crash(self, engine: str, detail: str) -> None:
        self.crashes.append({"engine": engine, "detail": detail[:500], "ts": time.time()})
        del self.crashes[:-50]

    # -- monitoring -----------------------------------------------------
    def snapshot(self) -> dict[str, Any]:
        procs = []
        for l in self._leases.values():
            info: dict[str, Any] = {**asdict(l), "cpu_percent": None, "rss_mb": None}
            if l.pid:
                try:
                    p = psutil.Process(l.pid)
                    info["cpu_percent"] = p.cpu_percent(interval=None)
                    info["rss_mb"] = round(p.memory_info().rss / 2**20, 1)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            procs.append(info)
        vm = psutil.virtual_memory()
        return {
            "limits": asdict(self.limits),
            "active": procs,
            "waiting": [{"label": w[2].label, "purpose": w[2].purpose, "threads": w[2].threads} for w in self._waiters],
            "threads_used": sum(l.threads for l in self._leases.values()),
            "hash_used_mb": sum(l.hash_mb for l in self._leases.values()),
            "system": {"cpu_count": os.cpu_count(), "cpu_percent": psutil.cpu_percent(interval=None),
                       "mem_total_mb": int(vm.total / 2**20), "mem_available_mb": int(vm.available / 2**20),
                       "mem_percent": vm.percent},
            "crashes": self.crashes[-10:],
            "research_seconds_today": round(self.research_seconds_today, 1),
        }

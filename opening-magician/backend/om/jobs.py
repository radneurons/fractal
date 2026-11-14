"""Durable job scheduler for long-running research (tournaments, discovery experiments,
puzzle mining, book improvement).

Jobs are rows in SQLite, so they outlive the browser tab and the process:
  pending -> scheduled -> running -> completed | failed | canceled
                              \\-> paused -> running
  (found "running" at start-up) -> recovery_required -> running (resume from checkpoint)
A job is only marked `completed` after its runner returned, i.e. after its results were
committed.  Runners persist their own progress through `ctx.checkpoint()`.
"""
from __future__ import annotations

import asyncio
import time
import traceback
from typing import Any, Awaitable, Callable

from .db import Database, new_id, now
from .events import EventBus

STATES = ["pending", "scheduled", "running", "paused", "completed", "failed", "canceled", "recovery_required"]


class JobContext:
    def __init__(self, manager: "JobManager", job: dict[str, Any]):
        self.manager, self.job = manager, job
        self.id = job["id"]
        self.cancel = asyncio.Event()
        self.pause_requested = False
        self.started = time.time()

    @property
    def checkpoint_data(self) -> dict[str, Any]:
        return self.job.get("checkpoint") or {}

    def checkpoint(self, data: dict[str, Any], progress: float | None = None) -> None:
        self.job["checkpoint"] = data
        upd: dict[str, Any] = {"checkpoint": data, "updated_at": now()}
        if progress is not None:
            upd["progress"] = max(0.0, min(1.0, progress))
            self.job["progress"] = upd["progress"]
        self.manager.db.update("jobs", self.id, upd)
        self.manager.bus.publish("jobs", "progress", {"id": self.id, "progress": self.job.get("progress", 0), "kind": self.job["kind"],
                                                       "ref_id": self.job.get("ref_id")})

    def should_stop(self) -> bool:
        return self.cancel.is_set() or self.pause_requested

    def budget_exhausted(self) -> bool:
        limit = (self.job.get("budget") or {}).get("max_seconds")
        return bool(limit) and (time.time() - self.started) + (self.checkpoint_data.get("_elapsed", 0)) >= limit


Runner = Callable[[JobContext], Awaitable[Any]]


class JobManager:
    def __init__(self, db: Database, bus: EventBus, max_parallel: int = 2):
        self.db, self.bus, self.max_parallel = db, bus, max_parallel
        self._runners: dict[str, Runner] = {}
        self._active: dict[str, tuple[asyncio.Task[None], JobContext]] = {}
        self._wake = asyncio.Event()
        self._loop_task: asyncio.Task[None] | None = None

    def register(self, kind: str, runner: Runner) -> None:
        self._runners[kind] = runner

    # -- lifecycle -------------------------------------------------------
    def recover(self) -> list[str]:
        """Called at start-up: anything that was mid-flight needs recovery; scheduled work is re-queued."""
        ids = []
        for j in self.db.all("jobs", "status IN ('running','scheduled')"):
            self.db.update("jobs", j["id"], {"status": "recovery_required", "updated_at": now(),
                                             "error": "Interrupted by shutdown; resuming from last checkpoint"})
            ids.append(j["id"])
        return ids

    def start(self) -> None:
        if self._loop_task is None or self._loop_task.done():
            self._loop_task = asyncio.get_running_loop().create_task(self._loop())

    async def shutdown(self) -> None:
        if self._loop_task:
            self._loop_task.cancel()
        for jid, (task, ctx) in list(self._active.items()):
            ctx.pause_requested = True
            ctx.cancel.set()
            task.cancel()
        for jid, (task, _) in list(self._active.items()):
            try:
                await asyncio.wait_for(asyncio.shield(task), 5)
            except BaseException:
                pass
            row = self.db.get("jobs", jid)
            if row and row["status"] == "running":
                self.db.update("jobs", jid, {"status": "recovery_required", "updated_at": now()})

    def submit(self, kind: str, ref_id: str | None = None, payload: dict[str, Any] | None = None, priority: int = 5,
               budget: dict[str, Any] | None = None, run_after: float | None = None) -> dict[str, Any]:
        if kind not in self._runners:
            raise ValueError(f"No runner registered for job kind '{kind}'")
        job = {"id": new_id("job"), "kind": kind, "ref_id": ref_id, "status": "pending", "priority": priority,
               "payload": payload or {}, "checkpoint": {}, "result": None, "error": None, "budget": budget or {},
               "progress": 0.0, "created_at": now(), "updated_at": now(), "run_after": run_after}
        self.db.insert("jobs", job)
        self.bus.publish("jobs", "submitted", self._public(job))
        self._wake.set()
        return job

    def list(self, limit: int = 100) -> list[dict[str, Any]]:
        return [self._public(j) for j in self.db.all("jobs", order="created_at DESC", limit=limit)]

    def get(self, job_id: str) -> dict[str, Any] | None:
        return self.db.get("jobs", job_id)

    def for_ref(self, ref_id: str) -> dict[str, Any] | None:
        rows = self.db.all("jobs", "ref_id=?", (ref_id,), order="created_at DESC", limit=1)
        return rows[0] if rows else None

    def _public(self, j: dict[str, Any]) -> dict[str, Any]:
        return {k: j.get(k) for k in ("id", "kind", "ref_id", "status", "priority", "progress", "error", "created_at",
                                      "updated_at", "budget", "run_after")}

    def pause(self, job_id: str) -> None:
        if job_id in self._active:
            self._active[job_id][1].pause_requested = True
            self.bus.publish("jobs", "pausing", {"id": job_id})
        else:
            row = self.get(job_id)
            if row and row["status"] in ("pending", "scheduled", "recovery_required"):
                self._status(job_id, "paused")

    def resume(self, job_id: str) -> None:
        row = self.get(job_id)
        if row and row["status"] in ("paused", "recovery_required", "failed"):
            self._status(job_id, "pending", error=None)
            self._wake.set()

    def cancel(self, job_id: str) -> None:
        if job_id in self._active:
            self._active[job_id][1].cancel.set()
        else:
            row = self.get(job_id)
            if row and row["status"] not in ("completed", "canceled"):
                self._status(job_id, "canceled")

    def _status(self, job_id: str, status: str, **extra: Any) -> None:
        self.db.update("jobs", job_id, {"status": status, "updated_at": now(), **extra})
        row = self.get(job_id)
        if row:
            self.bus.publish("jobs", "status", self._public(row))

    # -- scheduling loop ---------------------------------------------------
    async def _loop(self) -> None:
        while True:
            try:
                self._dispatch()
            except Exception:
                traceback.print_exc()
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), 2.0)
            except asyncio.TimeoutError:
                pass

    def _dispatch(self) -> None:
        free = self.max_parallel - len(self._active)
        if free <= 0:
            return
        rows = self.db.all("jobs", "status IN ('pending','recovery_required') AND (run_after IS NULL OR run_after<=?)",
                           (now(),), order="priority, created_at", limit=free * 3)
        for job in rows:
            if free <= 0:
                break
            if job["id"] in self._active or job["kind"] not in self._runners:
                continue
            # recovery_required jobs resume automatically unless the payload says otherwise
            if job["status"] == "recovery_required" and job["payload"].get("auto_resume") is False:
                continue
            self._status(job["id"], "scheduled")
            ctx = JobContext(self, job)
            task = asyncio.get_running_loop().create_task(self._run(ctx))
            self._active[job["id"]] = (task, ctx)
            free -= 1

    async def _run(self, ctx: JobContext) -> None:
        jid = ctx.id
        self._status(jid, "running", error=None)
        try:
            result = await self._runners[ctx.job["kind"]](ctx)
            if ctx.cancel.is_set() and not ctx.pause_requested:
                self._status(jid, "canceled")
            elif ctx.pause_requested:
                self._status(jid, "paused")
            else:
                self.db.update("jobs", jid, {"result": result if isinstance(result, (dict, list)) else {"value": result},
                                             "progress": 1.0})
                self._status(jid, "completed")
        except asyncio.CancelledError:
            row = self.get(jid)
            if row and row["status"] == "running":
                self._status(jid, "recovery_required", error="Interrupted")
        except Exception as e:
            traceback.print_exc()
            self._status(jid, "failed", error=f"{type(e).__name__}: {e}"[:1000])
        finally:
            self._active.pop(jid, None)
            self._wake.set()

    async def wait(self, job_id: str, timeout: float = 600.0) -> dict[str, Any]:
        """Test/CLI helper: block until the job reaches a resting state."""
        end = time.time() + timeout
        while time.time() < end:
            row = self.get(job_id)
            if row and row["status"] in ("completed", "failed", "canceled", "paused") and job_id not in self._active:
                return row
            await asyncio.sleep(0.05)
        raise TimeoutError(f"Job {job_id} did not finish in {timeout}s")

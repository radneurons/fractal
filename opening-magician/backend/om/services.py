"""Service container: builds every subsystem once and wires them together."""
from __future__ import annotations

import asyncio
import time
from typing import Any

import chess

from . import openings
from .books.store import BookStore
from .broadcast import BroadcastManager
from .config import Settings
from .db import Database, rotate_backups
from .discovery.experiment import DiscoveryLab
from .engines.manager import EngineError, EngineHandle, EngineManager, EngineSpec, line_from_info, seed_profiles
from .engines.resources import ResourceManager
from .engines.search import Budget, coherent_lines
from .events import EventBus, bus as global_bus
from .hardware.manager import HardwareManager, Playback
from .jobs import JobContext, JobManager
from .learn.puzzles import PuzzleLab
from .learn.studies import StudyManager
from .learn.training import Trainer
from .play import GameAnalyzer, PlayManager
from .prep import Prep, PrepEngine
from .tournament.manager import TournamentManager


class AnalysisHub:
    """Interactive multi-engine analysis: every panel is an independent engine process
    streaming its own `info` lines to its own topic."""

    def __init__(self, engines: EngineManager, bus: EventBus):
        self.engines, self.bus = engines, bus
        self.panels: dict[str, dict[str, Any]] = {}

    async def open(self, panel_id: str, spec: EngineSpec) -> dict[str, Any]:
        await self.close(panel_id)
        handle = await self.engines.open(spec, "interactive", f"Analysis · {panel_id}")
        self.panels[panel_id] = {"handle": handle, "task": None, "spec": spec, "fen": None, "running": False, "last": None}
        return self.status(panel_id)

    def status(self, panel_id: str) -> dict[str, Any]:
        p = self.panels.get(panel_id)
        if not p:
            return {"id": panel_id, "open": False}
        h: EngineHandle = p["handle"]
        return {"id": panel_id, "open": not h.closed, "engine": h.name, "engine_id": h.row["id"], "running": p["running"],
                "options": h.options, "max_multipv": h.max_multipv, "fen": p["fen"], "last": p["last"], "pid": h.pid}

    def list(self) -> list[dict[str, Any]]:
        return [self.status(k) for k in self.panels]

    async def go(self, panel_id: str, fen: str, moves: list[str], multipv: int = 1, max_time: float | None = None,
                 max_depth: int | None = None) -> dict[str, Any]:
        p = self.panels.get(panel_id)
        if not p or p["handle"].closed:
            raise EngineError("Analysis panel is not open")
        await self._stop_task(p)
        board = chess.Board(fen)
        for u in moves:
            board.push_uci(u)
        p["fen"] = board.fen()
        if board.is_game_over(claim_draw=False):
            p["last"] = {"lines": [], "terminal": True}
            self.bus.publish(f"analysis:{panel_id}", "lines", {"fen": board.fen(), "lines": [], "terminal": True, "running": False})
            return self.status(panel_id)
        limit = None
        if max_time or max_depth:
            limit = chess.engine.Limit(time=max_time, depth=max_depth)
        p["task"] = asyncio.get_running_loop().create_task(self._run(panel_id, p, board, multipv, limit))
        return self.status(panel_id)

    async def _run(self, panel_id: str, p: dict[str, Any], board: chess.Board, multipv: int, limit: Any) -> None:
        h: EngineHandle = p["handle"]
        topic = f"analysis:{panel_id}"
        t0 = time.perf_counter()
        hard_end = t0 + 3600          # an "infinite" interactive search still ends after an hour
        try:
            analysis = await h.stream(board, limit, multipv=multipv)
        except EngineError as e:
            self.bus.publish(topic, "error", {"message": str(e)})
            return
        p["running"] = True
        h.busy = True
        last_emit = 0.0
        complete: list[list[dict[str, Any]]] = [[]]
        try:
            while True:
                try:
                    await asyncio.wait_for(analysis.get(), 0.3)
                except asyncio.TimeoutError:
                    if time.perf_counter() > hard_end:
                        break
                    continue
                except chess.engine.AnalysisComplete:
                    break
                now_t = time.perf_counter()
                if now_t - last_emit < 0.1:
                    continue
                last_emit = now_t
                lines = coherent_lines([l for i, inf in enumerate(analysis.multipv) if (l := line_from_info(board, inf, i + 1))], complete)
                if lines:
                    p["last"] = {"fen": board.fen(), "lines": lines, "elapsed": round(now_t - t0, 2)}
                    self.bus.publish(topic, "lines", {**p["last"], "running": True, "engine": h.name})
        except chess.engine.EngineTerminatedError as e:
            self.bus.publish(topic, "error", {"message": f"{h.name} terminated: {e}"})
            await h._crashed(str(e))
        except asyncio.CancelledError:
            pass
        finally:
            p["running"] = False
            h.busy = False
            if not h.closed:
                analysis.stop()
                try:
                    await asyncio.wait_for(analysis.wait(), 3)
                except Exception:
                    await h.close(force=True)
            lines = coherent_lines([l for i, inf in enumerate(analysis.multipv) if (l := line_from_info(board, inf, i + 1))], complete)
            if lines:
                p["last"] = {"fen": board.fen(), "lines": lines, "elapsed": round(time.perf_counter() - t0, 2)}
            self.bus.publish(topic, "lines", {**(p["last"] or {"fen": board.fen(), "lines": []}), "running": False, "engine": h.name})

    async def _stop_task(self, p: dict[str, Any]) -> None:
        task = p.get("task")
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        p["task"] = None

    async def stop(self, panel_id: str) -> None:
        p = self.panels.get(panel_id)
        if p:
            await self._stop_task(p)

    async def close(self, panel_id: str) -> None:
        p = self.panels.pop(panel_id, None)
        if p:
            await self._stop_task(p)
            await p["handle"].close()

    async def shutdown(self) -> None:
        for k in list(self.panels):
            await self.close(k)


class Services:
    def __init__(self, settings: Settings, bus: EventBus | None = None):
        self.settings = settings.ensure()
        self.bus = bus or global_bus
        self.db = Database(self.settings.db_path)
        self.resources = ResourceManager()
        saved = self.db.pref("resource_limits")
        if saved:
            self.resources.update_limits(**{k: v for k, v in saved.items() if k != "background_paused"})
        self.engines = EngineManager(self.db, self.resources)
        self.jobs = JobManager(self.db, self.bus, max_parallel=int(self.db.pref("max_parallel_jobs", 2)))
        self.books = BookStore(self.db)
        self.hw = HardwareManager(self.db, self.bus, self.resources)
        self.tournaments = TournamentManager(self.db, self.engines, self.jobs, self.bus, self._opening_source)
        self.lab = DiscoveryLab(self.db, self.engines, self.jobs, self.bus, self.books)
        self.trainer = Trainer(self.db, self.books)
        self.puzzles = PuzzleLab(self.db, self.engines)
        self.studies = StudyManager(self.db)
        self.play = PlayManager(self.db, self.engines, self.bus, self.hw, self.books)
        self.analyzer = GameAnalyzer(self.db, self.engines, self.books)
        self.analysis = AnalysisHub(self.engines, self.bus)
        self.broadcasts = BroadcastManager(self.db, self.bus)
        self.broadcasts.register_source("play", self._bc_play)
        self.broadcasts.register_source("tournament", self._bc_tournament)
        self.broadcasts.register_source("playback", self._bc_playback)
        self.prep = Prep(self.db, self.books, self.trainer)
        self.prep_engine = PrepEngine(self.prep, self.engines)
        self.jobs.register("prep", self._job_prep)
        self.jobs.register("puzzle_mining", self._job_puzzles)
        self.jobs.register("game_analysis", self._job_game_analysis)
        self.started_at = time.time()
        self._backup_task: asyncio.Task[None] | None = None
        self.recovered_jobs: list[str] = []

    # -- lifecycle ---------------------------------------------------------
    async def start(self) -> None:
        self.bus.bind_loop(asyncio.get_running_loop())
        try:
            row = await self.engines.ensure_bundled()
            seed_profiles(self.engines, row["id"])
        except EngineError as e:  # the app still works for PGN/books/studies without any engine
            print(f"[warn] bundled engine unavailable: {e}")
        if not self.books.list():
            self.books.create("Opening Magician Reference", openings.reference_book(), source="built-in catalogue",
                              description="The authored opening catalogue as a transposition-aware book.", profile="main",
                              summary="Seeded from the built-in catalogue")
            self.books.create("Exploration Book", description="Candidates from discovery research that still need testing.",
                              profile="exploration", source="research")
        self.puzzles.seed_builtin()
        self.recovered_jobs = self.jobs.recover()
        # tournaments/experiments that were running come back as paused-until-resumed by the scheduler
        self.jobs.start()
        self.broadcasts.start()
        self._backup_task = asyncio.get_running_loop().create_task(self._backups())

    async def stop(self) -> None:
        if self._backup_task:
            self._backup_task.cancel()
        await self.play.shutdown()
        await self.broadcasts.shutdown()
        await self.jobs.shutdown()
        await self.analysis.shutdown()
        try:
            await self.hw.disconnect()
        except Exception:
            pass
        await self.engines.shutdown()
        self.db.close()

    async def _backups(self) -> None:
        while True:
            await asyncio.sleep(6 * 3600)
            try:
                rotate_backups(self.db, self.settings.data_dir / "backups")
            except Exception as e:
                print(f"[warn] periodic backup failed: {e}")

    # -- glue ----------------------------------------------------------------
    def _opening_source(self, o: dict[str, Any], count: int) -> list[dict[str, Any]]:
        if o.get("mode") == "book" and o.get("book_id"):
            return self.books.head(o["book_id"]).sample_lines(int(o.get("plies", 8)), max(1, int(o.get("count", min(count, 16)))),
                                                             int(o.get("seed", 1)))
        if o.get("mode") == "catalog":
            ids = set(o.get("ids") or [])
            return [{"name": c["name"], "moves": c["uci"], "fen": None} for c in openings.catalog()
                    if (c["id"] in ids if ids else 4 <= c["plies"] <= 10)][:int(o.get("count", 24))]
        return []

    def _bc_play(self, src: dict[str, Any]) -> dict[str, Any] | None:
        s = self.play.sessions.get(src.get("id", ""))
        if not s:
            return None
        st = s.state()
        last = next((e for e in reversed(s.evals) if e.get("text")), None)
        white, black = ("You", st["engine_name"]) if st["human"] == "white" else (st["engine_name"], "You")
        return {"fen": st["fen"], "start_fen": st["start_fen"], "moves": st["moves"], "sans": st["sans"], "last_move": st["last_move"],
                "white": src.get("white") or white, "black": src.get("black") or black,
                "result": st["result"] if st["status"] == "finished" else None, "status": st["status"],
                "opening": st["opening"], "clock": st["clock"],
                "eval": {"text": last["text"], "expected_white": last["expected_white"], "depth": last.get("depth")} if last else None,
                "engine": st["engine_name"]}

    def _bc_tournament(self, src: dict[str, Any]) -> dict[str, Any] | None:
        tid = src.get("id", "")
        try:
            v = self.tournaments.view(tid)
        except ValueError:
            return None
        live = v["live"]
        g = next((x for x in live if x["key"] == src.get("game")), None) or (live[0] if live else None)
        meta = {"name": v["name"], "format": v["format"], "round": v["state"].get("round"), "status": v["status"],
                "standings": [{"rank": r["rank"], "player": r["player"], "points": r["points"], "games": r["games"]} for r in v["standings"]]}
        if not g:
            return {"tournament": meta, "status": v["status"], "fen": chess.STARTING_FEN, "sans": [], "white": None, "black": None}
        last = g.get("last") or {}
        return {"fen": g["fen"] or chess.STARTING_FEN, "sans": g["moves"], "last_move": last.get("uci"), "white": g["white"],
                "black": g["black"], "status": "active", "opening": {"name": g.get("opening")} if g.get("opening") else None,
                "eval": {"text": last.get("text"), "expected_white": last.get("expected_white"), "depth": last.get("depth")} if last.get("text") else None,
                "clock": {"white": {"ms": last["clock_ms"]["white"]}, "black": {"ms": last["clock_ms"]["black"]}, "running": None} if last.get("clock_ms") else None,
                "tournament": meta}

    def _bc_playback(self, src: dict[str, Any]) -> dict[str, Any] | None:
        pb: Playback | None = self.hw.playback
        if not pb:
            return None
        st = pb.status()
        return {"fen": st["fen"], "start_fen": st["start_fen"], "sans": st["sans"][:st["index"]], "last_move": st["last_move"],
                "white": st["title"], "black": "", "status": st["state"]}

    async def _job_puzzles(self, ctx: JobContext) -> dict[str, Any]:
        p = ctx.job["payload"]
        rows = []
        if p.get("game_ids"):
            rows = [self.db.get("games", g) for g in p["game_ids"]]
        elif p.get("tournament_id"):
            rows = self.db.all("games", "tournament_id=?", (p["tournament_id"],))
        elif p.get("experiment_id"):
            rows = self.db.all("games", "experiment_id=?", (p["experiment_id"],))
        pgn = p.get("pgn") or "\n\n".join(r["pgn"] for r in rows if r)
        res = await self.puzzles.mine_pgn(pgn, EngineSpec.from_dict(p["engine"]), Budget.from_dict(p.get("budget")),
                                          source={k: p[k] for k in ("tournament_id", "experiment_id") if p.get(k)},
                                          max_puzzles=int(p.get("max_puzzles", 20)), cancel=ctx.cancel,
                                          on_progress=lambda f: ctx.checkpoint({}, f))
        return res

    async def _job_prep(self, ctx: JobContext) -> dict[str, Any]:
        """Engine-backed preparation work (dossier check, leak costs, practical scoring, watch, annotation)."""
        p = ctx.job["payload"]
        pe = self.prep_engine
        engine, budget = EngineSpec.from_dict(p["engine"]), Budget.from_dict(p.get("budget"))
        prog = lambda f: ctx.checkpoint({}, f)
        task = p["task"]
        if task == "dossier":
            return await pe.check_dossier(p["collection_id"], engine, budget, ctx.cancel, prog)
        if task == "leak_costs":
            return await pe.leak_costs(p["collection_id"], p["book_id"], engine, budget, ctx.cancel, prog)
        if task == "practical":
            return await pe.practical(p["moves"], p.get("start_fen"), p.get("my_color", "white"), engine, budget, ctx.cancel, prog, p.get("human_book_id"))
        if task == "watch":
            return await pe.watch(p["book_id"], p.get("color", "white"), engine, budget, ctx.cancel, prog, int(p.get("max_ply", 16)), int(p.get("limit", 60)))
        if task == "annotate":
            return await pe.annotate(p["book_id"], p.get("color", "white"), engine, budget, ctx.cancel, prog, int(p.get("max_ply", 18)), int(p.get("limit", 150)))
        raise ValueError(f"Unknown preparation task '{task}'")

    async def _job_game_analysis(self, ctx: JobContext) -> dict[str, Any]:
        p = ctx.job["payload"]
        rep = await self.analyzer.analyse(p["game_id"], EngineSpec.from_dict(p["engine"]), Budget.from_dict(p.get("budget")),
                                          p.get("book_id"), ctx.cancel, lambda f: ctx.checkpoint({}, f))
        return {"moves": len(rep["moves"]), "accuracy": rep["accuracy"]}

    # -- knowledge graph ---------------------------------------------------------
    def knowledge(self, fen: str, move: str | None = None) -> dict[str, Any]:
        """Everything the project knows about a position (and optionally a move from it)."""
        from .chessx import pos_key
        board = chess.Board(fen)
        key = pos_key(board)
        after_key = None
        if move:
            b2 = board.copy(stack=False)
            b2.push_uci(move)
            after_key = pos_key(b2)
        out: dict[str, Any] = {"fen": fen, "epd": key, "opening": openings.identify(board)}
        out["openings_through"] = [{"id": o["id"], "name": o["name"], "eco": o["eco"]} for o in openings.catalog()
                                   if self._passes(o, key)][:12]
        books = []
        for b in self.books.list():
            node = self.books.head(b["id"]).positions.get(key)
            if node and node["moves"]:
                m = node["moves"].get(move) if move else None
                books.append({"book_id": b["id"], "name": b["name"], "profile": b["profile"], "moves": len(node["moves"]),
                              "move": {"status": m["status"], "weight": m["weight"], "games": m["games"]} if m else None})
        out["books"] = books
        where, params = "epd=?", [key]
        if move:
            where += " AND move_uci=?"
            params.append(move)
        finds = self.db.all("findings", where, params, order="updated_at DESC", limit=20)
        out["findings"] = [{"id": f["id"], "san": f["move_san"], "line": f["line_san"], "category": f["category"], "status": f["status"],
                            "experiment_id": f["experiment_id"], "engines": [f["ranking"].get("ranking_engine"), f["ranking"].get("verification_engine")],
                            "themes": f["evidence"].get("motifs", []), "games": len(f["evidence"].get("games", []))} for f in finds]
        out["analysis"] = [{"engine": a["engine_name"], "depth": a["depth"], "multipv": a["multipv"],
                            "best": a["lines"][0]["san"] if a["lines"] else None, "score": a["lines"][0]["score"]["text"] if a["lines"] else None,
                            "created_at": a["created_at"]} for a in self.lab.cache.for_position(board)]
        probe = [k for k in (key, after_key) if k]
        fens = {fen}
        out["puzzles"] = [{"id": p["id"], "title": p["title"], "themes": p["themes"]} for p in self.db.all("puzzles", limit=2000)
                          if p["fen"] in fens or (p["source"].get("finding_id") in {f["id"] for f in finds})][:10]
        out["cards"] = self.db.query("SELECT deck, san, reps, lapses FROM cards WHERE epd=? LIMIT 10", (key,))
        studies = set()
        for f in finds:
            for l in self.db.links_for("finding", f["id"]):
                if l["src_kind"] == "study":
                    studies.add(l["src_id"])
        out["studies"] = [{"id": s["id"], "title": s["title"]} for s in (self.db.get("studies", i) for i in studies) if s]
        approved = [f for f in finds if f["status"] in ("approved", "repertoire_candidate")]
        out["repertoire_status"] = "approved" if any(f["status"] == "approved" for f in finds) else \
            "candidate" if approved else ("in a book" if any(b["move"] for b in books) else "not in any book")
        nxt = []
        for f in finds[:3]:
            if f["category"] == "requires_deeper_investigation":
                nxt.append(f"Verify {f['line_san']} with a larger budget.")
            elif len(f["evidence"].get("games", [])) < 8:
                nxt.append(f"Add test games for {f['line_san']}.")
        if move and not finds:
            nxt.append("No research on this move yet — send it to the Discovery Lab.")
        out["recommended"] = nxt
        _ = probe
        return out

    @staticmethod
    def _passes(op: dict[str, Any], key: str) -> bool:
        from .chessx import pos_key
        b = chess.Board()
        if pos_key(b) == key:
            return op["plies"] <= 2
        for u in op["uci"]:
            b.push_uci(u)
            if pos_key(b) == key:
                return True
        return False

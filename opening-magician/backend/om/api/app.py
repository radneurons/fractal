"""HTTP + WebSocket API of the native bridge.

Security model
  * local mode: bound to loopback; loopback callers are trusted administrators.
  * lan/server mode: every control endpoint requires the admin token (X-OM-Token header
    or ?token=).  Registering native executables is additionally restricted to loopback
    callers or to the configured allowlist directories.
  * /api/public/* (spectator data) is the ONLY unauthenticated surface and is read-only.
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import chess
from ..chessx import parse_move
from fastapi import Body, Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse

from .. import APP_NAME, TAGLINE, __version__, openings
from ..books import model as bookmodel
from ..books.model import Book, BookError
from ..chessx import START_FEN, classify_move, describe_state, game_to_pgn, game_tree, pawn_structure, read_games, tactical_complexity
from ..clock import PRESETS, normalize_config
from ..config import Settings, settings as default_settings
from ..db import rotate_backups
from ..discovery import scoring
from ..discovery.experiment import STAGES, STRATEGIES
from ..engines.manager import EngineError, EngineSpec
from ..engines.search import Budget, STOP_REASONS
from ..hardware import codec
from ..hardware.manager import HardwareError, Playback
from ..hardware.robot import RobotSafetyError, STATES as ROBOT_STATES
from ..hardware.transport import TransportError
from ..learn.puzzles import THEMES as PUZZLE_THEMES
from ..learn.studies import KINDS as STUDY_KINDS
from ..learn.training import DIMENSIONS, MODE_DIMENSION
from ..package import export_package, inspect_package, restore_package
from ..play import ASSISTANCE, MODES as PLAY_MODES
from ..services import Services
from ..tournament.manager import FORMATS
from ..broadcast import THEMES as BROADCAST_THEMES

LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or default_settings
    svc_box: dict[str, Services] = {}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        svc = Services(settings)
        svc_box["svc"] = svc
        app.state.svc = svc
        await svc.start()
        try:
            yield
        finally:
            await svc.stop()

    app = FastAPI(title=APP_NAME, version=__version__, lifespan=lifespan)

    def S() -> Services:
        return svc_box["svc"]

    # ------------------------------------------------------------------ auth
    def is_local(request: Request | WebSocket) -> bool:
        host = request.client.host if request.client else ""
        return host in LOOPBACK

    def admin(request: Request) -> None:
        token = request.headers.get("x-om-token") or request.query_params.get("token") or ""
        if settings.mode == "local" and is_local(request):
            return
        if settings.admin_token and token == settings.admin_token:
            return
        raise HTTPException(401, "Admin token required for this operation")

    A = [Depends(admin)]

    @app.exception_handler(ValueError)
    async def _value_error(_: Request, exc: ValueError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.exception_handler(RuntimeError)
    async def _runtime_error(_: Request, exc: RuntimeError) -> JSONResponse:
        if isinstance(exc, (EngineError, HardwareError, RobotSafetyError, TransportError)):
            return JSONResponse({"detail": str(exc)}, status_code=409)
        return JSONResponse({"detail": f"{type(exc).__name__}: {exc}"}, status_code=500)

    # ------------------------------------------------------------------ meta
    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "app": APP_NAME, "version": __version__}

    @app.get("/api/meta", dependencies=A)
    async def meta() -> dict[str, Any]:
        s = S()
        return {"app": APP_NAME, "tagline": TAGLINE, "version": __version__, "mode": settings.mode,
                "schema_version": s.db.schema_version, "uptime_s": round(time.time() - s.started_at),
                "data_dir": str(settings.data_dir), "strategies": STRATEGIES, "stages": STAGES,
                "categories": scoring.CATEGORIES, "finding_statuses": scoring.STATUSES, "tournament_formats": FORMATS,
                "clock_presets": PRESETS, "book_profiles": bookmodel.PROFILES, "book_statuses": bookmodel.STATUSES,
                "csv_fields": bookmodel.CSV_FIELDS, "unsupported_book_formats": bookmodel.UNSUPPORTED,
                "puzzle_themes": PUZZLE_THEMES, "study_kinds": STUDY_KINDS, "dimensions": DIMENSIONS,
                "mode_dimension": MODE_DIMENSION, "assistance": ASSISTANCE, "play_modes": PLAY_MODES,
                "broadcast_themes": BROADCAST_THEMES, "stop_reasons": STOP_REASONS, "robot_states": ROBOT_STATES,
                "recovered_jobs": s.recovered_jobs, "recoverable_games": s.play.recoverable(),
                "ai_commentary": {"required": False, "note": "All explanations are deterministic and engine-backed; no cloud model is used."}}

    @app.get("/api/prefs", dependencies=A)
    async def prefs_get() -> dict[str, Any]:
        return S().db.pref("ui", {})

    @app.put("/api/prefs", dependencies=A)
    async def prefs_put(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        cur = S().db.pref("ui", {})
        cur.update(body)
        S().db.set_pref("ui", cur)
        return cur

    # ------------------------------------------------------------------ chess utilities
    @app.post("/api/chess/state", dependencies=A)
    async def chess_state(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        board = chess.Board(body.get("fen") or START_FEN)
        sans = []
        for u in body.get("moves") or []:
            mv = parse_move(board, u)
            sans.append(board.san(mv))
            board.push(mv)
        return {**describe_state(board), "sans": sans, "opening": openings.identify(board), "valid": board.is_valid(),
                "status_flags": [str(s) for s in board.status()] if not board.is_valid() else [],
                "pawn_structure": pawn_structure(board), "complexity": round(tactical_complexity(board), 3)}

    @app.post("/api/pgn/parse", dependencies=A)
    async def pgn_parse(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        games = read_games(body.get("pgn", ""), int(body.get("limit", 200)))
        if not games:
            raise ValueError("No games found in the PGN text")
        return {"count": len(games), "games": [{"index": i, "headers": dict(g.headers),
                                                 "plies": sum(1 for _ in g.mainline_moves()),
                                                 "errors": [str(e) for e in g.errors][:3]} for i, g in enumerate(games)],
                "first": game_tree(games[int(body.get("index", 0)) if int(body.get("index", 0)) < len(games) else 0])}

    @app.post("/api/pgn/import-games", dependencies=A)
    async def pgn_import(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Store imported games in the research database (kind 'import')."""
        from ..db import new_id, now
        games = read_games(body.get("pgn", ""))
        ids = []
        with S().db.tx():
            for g in games:
                h = g.headers
                end = g.end().board()
                op = openings.identify(end)
                gid = new_id("game")
                S().db.insert("games", {"id": gid, "kind": "import", "white": h.get("White"), "black": h.get("Black"),
                                        "result": h.get("Result", "*"), "termination": h.get("Termination", ""),
                                        "pgn": game_to_pgn(g), "start_fen": g.board().fen(), "opening": op["name"] if op else h.get("Opening"),
                                        "eco": op["eco"] if op else h.get("ECO"), "plies": len(end.move_stack), "tournament_id": None,
                                        "experiment_id": None, "meta": {"source": body.get("source", "pgn import")},
                                        "created_at": now(), "finished_at": now()})
                ids.append(gid)
        return {"imported": len(ids), "ids": ids}

    @app.get("/api/games", dependencies=A)
    async def games_list(kind: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        where, params = ("kind=?", [kind]) if kind else ("", [])
        return S().db.all("games", where, params, order="created_at DESC", limit=limit,
                          cols="id,kind,white,black,result,termination,opening,eco,plies,tournament_id,experiment_id,created_at")

    @app.get("/api/games/{gid}", dependencies=A)
    async def game_get(gid: str) -> dict[str, Any]:
        g = S().db.get("games", gid)
        if not g:
            raise HTTPException(404, "Unknown game")
        parsed = read_games(g["pgn"], 1)
        return {**g, "tree": game_tree(parsed[0]) if parsed else None, "links": S().db.links_for("game", gid)}

    @app.get("/api/games/{gid}/pgn", dependencies=A)
    async def game_pgn(gid: str) -> PlainTextResponse:
        g = S().db.get("games", gid)
        if not g:
            raise HTTPException(404, "Unknown game")
        return PlainTextResponse(g["pgn"], headers={"Content-Disposition": f'attachment; filename="{gid}.pgn"'})

    @app.post("/api/games/{gid}/analyse", dependencies=A)
    async def game_analyse(gid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        job = S().jobs.submit("game_analysis", gid, {"game_id": gid, "engine": body["engine"], "budget": body.get("budget"),
                                                      "book_id": body.get("book_id")}, priority=2)
        return {"job_id": job["id"]}

    @app.delete("/api/games/{gid}", dependencies=A)
    async def game_delete(gid: str) -> dict[str, Any]:
        S().db.delete("games", gid)
        return {"ok": True}

    @app.get("/api/knowledge", dependencies=A)
    async def knowledge(fen: str, move: str | None = None) -> dict[str, Any]:
        return S().knowledge(fen, move)

    # ------------------------------------------------------------------ openings
    @app.get("/api/openings", dependencies=A)
    async def openings_list(q: str | None = None) -> dict[str, Any]:
        items = openings.search(q) if q else openings.catalog()
        return {"openings": [{k: o[k] for k in ("id", "eco", "name", "moves", "uci", "fen", "plies", "idea", "family", "group")} for o in items],
                "traps": openings.traps(), "families": list(openings.FAMILIES)}

    @app.get("/api/openings/{oid}", dependencies=A)
    async def opening_get(oid: str) -> dict[str, Any]:
        return S().trainer.lesson(oid)

    @app.post("/api/openings/identify", dependencies=A)
    async def opening_identify(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return {"opening": openings.identify_moves(body.get("moves") or [], body.get("start_fen"))}

    # ------------------------------------------------------------------ engines
    @app.get("/api/engines", dependencies=A)
    async def engines_list() -> dict[str, Any]:
        s = S()
        return {"engines": s.engines.list(), "profiles": s.engines.profiles(), "active": s.engines.active(),
                "detected": s.engines.detect()}

    @app.post("/api/engines", dependencies=A)
    async def engines_register(request: Request, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        path = str(body.get("path", "")).strip()
        if not path:
            raise ValueError("Executable path is required")
        if not is_local(request):
            resolved = str(Path(path).expanduser().resolve())
            if not any(resolved.startswith(str(Path(d).resolve()) + os.sep) for d in settings.engine_allowlist):
                raise HTTPException(403, "Remote clients may only register engines from the server's allowlisted directories "
                                         "(OM_ENGINE_ALLOWLIST). Register other engines from the machine itself.")
        row = await S().engines.register(path, body.get("name"), body.get("args") or [], body.get("defaults"), body.get("notes", ""))
        from ..engines.manager import seed_profiles
        seed_profiles(S().engines, row["id"])
        return row

    @app.post("/api/engines/{eid}/verify", dependencies=A)
    async def engines_verify(eid: str) -> dict[str, Any]:
        return await S().engines.reverify(eid)

    @app.patch("/api/engines/{eid}", dependencies=A)
    async def engines_update(eid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        S().engines.get(eid)
        S().db.update("engines", eid, {k: v for k, v in body.items() if k in ("name", "defaults", "notes")})
        return S().engines.get(eid)

    @app.delete("/api/engines/{eid}", dependencies=A)
    async def engines_delete(eid: str) -> dict[str, Any]:
        S().engines.remove(eid)
        return {"ok": True}

    @app.post("/api/engines/{eid}/profiles", dependencies=A)
    async def profile_save(eid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().engines.save_profile(eid, body["name"], body.get("purpose", ""), body.get("options"), body.get("limits"), body.get("id"))

    @app.delete("/api/profiles/{pid}", dependencies=A)
    async def profile_delete(pid: str) -> dict[str, Any]:
        S().db.delete("engine_profiles", pid)
        return {"ok": True}

    @app.get("/api/resources", dependencies=A)
    async def resources() -> dict[str, Any]:
        s = S()
        return {**s.resources.snapshot(), "analysis_panels": s.analysis.list(), "jobs": s.jobs.list(30),
                "cache": {"hits": s.lab.cache.hits, "misses": s.lab.cache.misses,
                          "stored": s.db.scalar("SELECT COUNT(*) FROM analysis")},
                "db": {"path": s.db.path, "size_mb": round(os.path.getsize(s.db.path) / 2**20, 2) if os.path.exists(s.db.path) else 0,
                       "games": s.db.scalar("SELECT COUNT(*) FROM games"), "positions_analysed": s.db.scalar("SELECT COUNT(DISTINCT epd) FROM analysis")},
                "max_parallel_jobs": s.jobs.max_parallel}

    @app.put("/api/resources", dependencies=A)
    async def resources_update(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        s = S()
        if "max_parallel_jobs" in body:
            s.jobs.max_parallel = max(1, int(body.pop("max_parallel_jobs")))
            s.db.set_pref("max_parallel_jobs", s.jobs.max_parallel)
        if "background_paused" in body:
            s.resources.pause_background(bool(body.pop("background_paused")))
        lim = s.resources.update_limits(**body)
        from dataclasses import asdict
        s.db.set_pref("resource_limits", asdict(lim))
        return s.resources.snapshot()

    # ------------------------------------------------------------------ interactive analysis
    @app.post("/api/analysis/{panel}/open", dependencies=A)
    async def analysis_open(panel: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return await S().analysis.open(panel, EngineSpec.from_dict(body["engine"]))

    @app.post("/api/analysis/{panel}/go", dependencies=A)
    async def analysis_go(panel: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return await S().analysis.go(panel, body.get("fen") or START_FEN, body.get("moves") or [], int(body.get("multipv", 1)),
                                     body.get("max_time"), body.get("max_depth"))

    @app.post("/api/analysis/{panel}/stop", dependencies=A)
    async def analysis_stop(panel: str) -> dict[str, Any]:
        await S().analysis.stop(panel)
        return S().analysis.status(panel)

    @app.delete("/api/analysis/{panel}", dependencies=A)
    async def analysis_close(panel: str) -> dict[str, Any]:
        await S().analysis.close(panel)
        return {"ok": True}

    @app.get("/api/analysis", dependencies=A)
    async def analysis_list() -> list[dict[str, Any]]:
        return S().analysis.list()

    @app.post("/api/analysis/ranked", dependencies=A)
    async def analysis_ranked(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Ranked 1st..Nth candidates for one position (MultiPV, restricted-root fallback)."""
        res = await S().lab.quick_rank(EngineSpec.from_dict(body["engine"]), body.get("fen") or START_FEN, int(body.get("n", 5)),
                                       Budget.from_dict(body.get("budget")), body.get("moves"))
        book = S().books.head(body["book_id"]) if body.get("book_id") else None
        board = chess.Board(res["fen"])
        if res["candidates"]:
            from ..chessx import Score, is_sacrifice
            best = Score.from_dict(res["candidates"][0]["score"])
            second = Score.from_dict(res["candidates"][1]["score"]) if len(res["candidates"]) > 1 else None
            for c in res["candidates"]:
                mv = chess.Move.from_uci(c["move"])
                c["classification"] = classify_move(best=best, played=Score.from_dict(c["score"]), rank=c["rank"],
                                                    legal_count=res["legal_count"], depth=c.get("depth") or 0,
                                                    in_book=bool(book and book.contains(board, mv)),
                                                    book_known_position=bool(book and book.node(board)),
                                                    sacrifice=is_sacrifice(board, mv), second=second,
                                                    stable=res.get("stop_reason") in ("stable", "resolved", "max_depth"))
        return res

    # ------------------------------------------------------------------ jobs
    @app.get("/api/jobs", dependencies=A)
    async def jobs_list() -> list[dict[str, Any]]:
        return S().jobs.list()

    @app.get("/api/jobs/{jid}", dependencies=A)
    async def job_get(jid: str) -> dict[str, Any]:
        j = S().jobs.get(jid)
        if not j:
            raise HTTPException(404, "Unknown job")
        return j

    @app.post("/api/jobs/{jid}/{action}", dependencies=A)
    async def job_action(jid: str, action: str) -> dict[str, Any]:
        fn = {"pause": S().jobs.pause, "resume": S().jobs.resume, "cancel": S().jobs.cancel}.get(action)
        if not fn:
            raise HTTPException(400, "Unknown action")
        fn(jid)
        return S().jobs.get(jid) or {}

    # ------------------------------------------------------------------ tournaments
    @app.get("/api/tournaments", dependencies=A)
    async def t_list() -> list[dict[str, Any]]:
        return S().tournaments.list()

    @app.post("/api/tournaments", dependencies=A)
    async def t_create(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        t = S().tournaments.create(body)
        if body.get("start"):
            S().tournaments.start(t["id"])
        return S().tournaments.view(t["id"])

    @app.get("/api/tournaments/{tid}", dependencies=A)
    async def t_view(tid: str) -> dict[str, Any]:
        return S().tournaments.view(tid)

    @app.get("/api/tournaments/{tid}/games", dependencies=A)
    async def t_games(tid: str) -> list[dict[str, Any]]:
        return S().tournaments.games(tid)

    @app.get("/api/tournaments/{tid}/pgn", dependencies=A)
    async def t_pgn(tid: str) -> PlainTextResponse:
        return PlainTextResponse(S().tournaments.pgn(tid), headers={"Content-Disposition": f'attachment; filename="{tid}.pgn"'})

    @app.get("/api/tournaments/{tid}/config", dependencies=A)
    async def t_config(tid: str) -> dict[str, Any]:
        return S().tournaments.get(tid)["config"]

    @app.post("/api/tournaments/{tid}/{action}", dependencies=A)
    async def t_action(tid: str, action: str) -> dict[str, Any]:
        tm = S().tournaments
        if action in ("start", "resume"):
            return tm.start(tid)
        if action == "pause":
            tm.pause(tid)
        elif action == "cancel":
            tm.cancel(tid)
        elif action == "duplicate":
            return tm.view(tm.duplicate(tid)["id"])
        elif action == "to_study":
            t = tm.get(tid)
            sid = S().studies.create(t["name"], f"Games of the {t['format'].replace('_', ' ')} tournament.", "tournament_analysis",
                                     refs={"tournament_id": tid})["id"]
            for g in S().db.all("games", "tournament_id=?", (tid,), order="created_at"):
                S().studies.from_game(g, sid)
            return S().studies.get(sid)
        else:
            raise HTTPException(400, "Unknown action")
        return tm.view(tid)

    @app.delete("/api/tournaments/{tid}", dependencies=A)
    async def t_delete(tid: str) -> dict[str, Any]:
        S().tournaments.delete(tid)
        return {"ok": True}

    # ------------------------------------------------------------------ discovery
    @app.get("/api/experiments", dependencies=A)
    async def e_list() -> list[dict[str, Any]]:
        return S().lab.list()

    @app.post("/api/experiments", dependencies=A)
    async def e_create(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        e = S().lab.create(body)
        if body.get("start_now", True):
            S().lab.start(e["id"])
        return S().lab.view(e["id"])

    @app.post("/api/experiments/preview", dependencies=A)
    async def e_preview(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        cfg = S().lab.normalize(body)
        return {"config": cfg, "seeds": S().lab.seeds(cfg)}

    @app.get("/api/experiments/{eid}", dependencies=A)
    async def e_view(eid: str) -> dict[str, Any]:
        return S().lab.view(eid)

    @app.post("/api/experiments/{eid}/{action}", dependencies=A)
    async def e_action(eid: str, action: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        lab = S().lab
        if action in ("start", "resume"):
            return lab.start(eid)
        if action == "rerun":
            return lab.start(eid, body.get("stage") or STAGES[0])
        if action == "pause":
            lab.pause(eid)
        elif action == "cancel":
            lab.cancel(eid)
        elif action == "to_study":
            sid = None
            for f in lab.findings(experiment_id=eid):
                if f["status"] not in ("rejected", "archived") or body.get("all"):
                    sid = S().studies.from_finding(f, sid)["study_id"]
            if sid is None:
                raise ValueError("No findings to turn into a study yet")
            return S().studies.get(sid)
        elif action == "mine_puzzles":
            job = S().jobs.submit("puzzle_mining", eid, {"experiment_id": eid, "engine": body.get("engine") or lab.get(eid)["config"]["observer"],
                                                          "budget": body.get("budget") or lab.get(eid)["config"]["verify_budget"]}, priority=6)
            return {"job_id": job["id"]}
        else:
            raise HTTPException(400, "Unknown action")
        return lab.view(eid)

    @app.delete("/api/experiments/{eid}", dependencies=A)
    async def e_delete(eid: str) -> dict[str, Any]:
        S().lab.delete(eid)
        return {"ok": True}

    @app.get("/api/findings", dependencies=A)
    async def f_list(status: str | None = None, experiment_id: str | None = None) -> list[dict[str, Any]]:
        return S().lab.findings(experiment_id, status)

    @app.get("/api/findings/{fid}", dependencies=A)
    async def f_get(fid: str) -> dict[str, Any]:
        f = S().db.get("findings", fid)
        if not f:
            raise HTTPException(404, "Unknown finding")
        return {**f, "links": S().db.links_for("finding", fid)}

    @app.patch("/api/findings/{fid}", dependencies=A)
    async def f_update(fid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().lab.set_finding_status(fid, body["status"], body.get("notes"))

    @app.post("/api/findings/{fid}/{action}", dependencies=A)
    async def f_action(fid: str, action: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        s = S()
        f = s.db.get("findings", fid)
        if not f:
            raise HTTPException(404, "Unknown finding")
        if action == "to_study":
            return s.studies.from_finding(f, body.get("study_id"))
        if action == "to_puzzles":
            return {"created": s.puzzles.from_trap_finding(f)}
        if action == "to_cards":
            seed = f["evidence"]["seed"]
            color = "white" if chess.Board(f["fen"]).turn else "black"
            return s.trainer.build_deck_from_line(f"Discovery: {f['line_san']}", seed["start_fen"], seed["moves"] + [f["move_uci"]], color,
                                                  note=f"{f['category'].replace('_', ' ')} — verify before relying on it.")
        if action == "propose":
            book_id = body.get("book_id")
            if not book_id:
                raise ValueError("Choose a target book")
            return {"proposals": s.books.propose_from_findings(book_id, [f])}
        raise HTTPException(400, "Unknown action")

    # ------------------------------------------------------------------ books
    @app.get("/api/books", dependencies=A)
    async def b_list() -> list[dict[str, Any]]:
        return S().books.list()

    @app.post("/api/books", dependencies=A)
    async def b_create(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().books.create(body.get("name") or "New book", description=body.get("description", ""), source=body.get("source", ""),
                                profile=body.get("profile", "main"), target_color=body.get("target_color"))

    @app.post("/api/books/import", dependencies=A)
    async def b_import(file: UploadFile = File(...), name: str = Query(""), profile: str = Query("main"), max_ply: int = Query(40),
                       into: str | None = Query(None)) -> dict[str, Any]:
        data = await file.read()
        book, stats, fmt = bookmodel.import_any(file.filename or "book", data, max_ply=max_ply)
        s = S()
        if into:
            merged = s.books.load(into)
            res = merged.merge(book)
            v = s.books.commit(into, merged, f"Merge import of {file.filename} ({fmt})")
            return {"book": s.books.info(into), "import": stats, "merge": res, "version": v["version"], "format": fmt}
        info = s.books.create(name or Path(file.filename or "Imported book").stem, book, source=f"{fmt}: {file.filename}",
                              profile=profile, summary=f"Imported from {file.filename} ({fmt})")
        return {"book": info, "import": stats, "format": fmt}

    @app.post("/api/books/import-text", dependencies=A)
    async def b_import_text(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        book, stats, fmt = bookmodel.import_any(body.get("filename") or "book.pgn", body.get("text", "").encode(),
                                                max_ply=int(body.get("max_ply", 40)))
        info = S().books.create(body.get("name") or "Imported book", book, source=fmt, profile=body.get("profile", "main"),
                                summary=f"Imported ({fmt})")
        return {"book": info, "import": stats, "format": fmt}

    @app.get("/api/books/{bid}", dependencies=A)
    async def b_get(bid: str) -> dict[str, Any]:
        return S().books.info(bid)

    @app.patch("/api/books/{bid}", dependencies=A)
    async def b_patch(bid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().books.update_meta(bid, **body)

    @app.delete("/api/books/{bid}", dependencies=A)
    async def b_delete(bid: str) -> dict[str, Any]:
        S().books.delete(bid)
        return {"ok": True}

    @app.get("/api/books/{bid}/position", dependencies=A)
    async def b_position(bid: str, fen: str | None = None) -> dict[str, Any]:
        return S().books.position(bid, fen)

    @app.get("/api/books/{bid}/tree", dependencies=A)
    async def b_tree(bid: str, fen: str | None = None, depth: int = 4, max_nodes: int = 500) -> dict[str, Any]:
        return S().books.tree(bid, fen, min(depth, 12), min(max_nodes, 3000))

    @app.post("/api/books/{bid}/move", dependencies=A)
    async def b_move(bid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().books.edit_move(bid, body["fen"], body["move"], action=body.get("action", "set"), weight=body.get("weight"),
                                   status=body.get("status"), comment=body.get("comment"))

    @app.post("/api/books/{bid}/line", dependencies=A)
    async def b_line(bid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().books.add_line(bid, body.get("start_fen"), body["moves"], status=body.get("status", "candidate"),
                                  weight=float(body.get("weight", 1.0)), comment=body.get("comment", ""))

    @app.post("/api/books/{bid}/op", dependencies=A)
    async def b_op(bid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        s = S()
        op = body.get("op")
        if op == "restore":
            return s.books.restore(bid, int(body["version"]))
        if op == "compare":
            return s.books.compare(bid, body.get("version_a"), body.get("other") or bid, body.get("version_b"))
        book = s.books.load(bid)
        info = s.db.get("books", bid) or {}
        if op == "merge":
            res = book.merge(s.books.load(body["other"]), float(body.get("weight_scale", 1.0)), body.get("prefer", "sum"))
            return {**s.books.commit(bid, book, f"Merge with {s.books.info(body['other'])['name']}"), "merge": res}
        if op == "dedupe":
            res = book.dedupe()
            return {**s.books.commit(bid, book, "Deduplicate / clean"), "dedupe": res}
        if op == "reweight":
            res = book.reweight(body.get("mode", "evidence"), info.get("profile", "main"))
            return {**s.books.commit(bid, book, f"Reweight ({res['mode']})"), "reweight": res}
        if op == "filter":
            out = book.filtered(max_ply=body.get("max_ply"), min_weight=float(body.get("min_weight", 0)),
                                min_games=int(body.get("min_games", 0)), statuses=body.get("statuses"), color=body.get("color"),
                                top_n=body.get("top_n"))
            if body.get("as_new"):
                return s.books.create(body.get("name") or info.get("name", "Book") + " (filtered)", out, profile=info.get("profile", "main"),
                                      source=f"filtered from {info.get('name')}", summary="Filtered copy")
            return s.books.commit(bid, out, "Filter")
        if op == "split":
            sub = book.subtree(chess.Board(body["fen"]))
            return s.books.create(body.get("name") or info.get("name", "Book") + " (branch)", sub, profile=info.get("profile", "main"),
                                  source=f"split from {info.get('name')}", summary="Split branch")
        if op == "weak":
            return {"branches": s.books.weak_branches(bid, int(body.get("max_ply", 16)))}
        if op == "propose":
            finds = s.lab.findings(status=None)
            wanted = [f for f in finds if f["status"] in ("promising", "repertoire_candidate", "approved", "rejected")]
            return {"proposals": s.books.propose_from_findings(bid, wanted)}
        if op == "decide":
            return s.books.decide_proposals(bid, body.get("decisions") or {})
        raise HTTPException(400, f"Unknown book operation '{op}'")

    @app.get("/api/books/{bid}/export", dependencies=A)
    async def b_export(bid: str, format: str = "pgn", version: int | None = None, max_ply: int = 40) -> Response:
        s = S()
        book = s.books.load(bid, version)
        name = bookmodel_safe(s.books.info(bid)["name"])
        if format == "bin":
            return Response(bookmodel.export_polyglot(book), media_type="application/octet-stream",
                            headers={"Content-Disposition": f'attachment; filename="{name}.bin"'})
        text, ext = {"pgn": (lambda: bookmodel.export_pgn(book, max_ply=max_ply, title=name), "pgn"),
                     "json": (lambda: bookmodel.export_json(book), "json"), "csv": (lambda: bookmodel.export_csv(book), "csv"),
                     "epd": (lambda: bookmodel.export_epd(book), "epd")}.get(format, (None, None))
        if text is None:
            raise HTTPException(400, "Export formats: pgn, bin (Polyglot), json, csv, epd")
        return PlainTextResponse(text(), headers={"Content-Disposition": f'attachment; filename="{name}.{ext}"'})

    # ------------------------------------------------------------------ training
    @app.get("/api/training/overview", dependencies=A)
    async def tr_overview() -> dict[str, Any]:
        t = S().trainer
        return {"decks": t.decks(), "skills": t.skills(), "progress": t.progress(), "weaknesses": t.weaknesses()}

    @app.post("/api/training/decks", dependencies=A)
    async def tr_deck(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        t = S().trainer
        if body.get("book_id"):
            return t.build_deck_from_book(body["book_id"], body.get("color", "white"), int(body.get("max_ply", 24)), body.get("title"))
        if body.get("opening_id"):
            return t.build_deck_from_opening(body["opening_id"], body.get("color", "white"))
        if body.get("moves"):
            return t.build_deck_from_line(body.get("title", "Custom line"), body.get("start_fen"), body["moves"], body.get("color", "white"))
        raise ValueError("Provide book_id, opening_id or moves")

    @app.delete("/api/training/decks", dependencies=A)
    async def tr_deck_delete(deck: str) -> dict[str, Any]:
        S().trainer.delete_deck(deck)
        return {"ok": True}

    @app.get("/api/training/cards", dependencies=A)
    async def tr_cards(deck: str | None = None, n: int = 10, mode: str = "recall") -> list[dict[str, Any]]:
        return S().trainer.next_cards(deck, n, mode)

    @app.post("/api/training/answer", dependencies=A)
    async def tr_answer(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().trainer.answer(body["card_id"], body["move"], body.get("time_ms"), int(body.get("hints", 0)), body.get("mode", "recall"))

    @app.get("/api/training/hint", dependencies=A)
    async def tr_hint(card_id: str) -> dict[str, Any]:
        return S().trainer.hint(card_id)

    @app.post("/api/training/task", dependencies=A)
    async def tr_task(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().trainer.task(body["kind"], body.get("params"))

    @app.post("/api/training/check", dependencies=A)
    async def tr_check(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().trainer.check(body["task_id"], body.get("response") or {})

    @app.post("/api/training/log", dependencies=A)
    async def tr_log(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Engine-judged modes (survival, deep calculation, engine games) report their verified outcome here."""
        S().trainer.log(body["mode"], bool(body["correct"]), body.get("time_ms"), int(body.get("hints", 0)), detail=body.get("detail"))
        return {"ok": True}

    # ------------------------------------------------------------------ preparation
    @app.get("/api/prep/collections", dependencies=A)
    async def prep_collections() -> list[dict[str, Any]]:
        return S().prep.collections()

    @app.post("/api/prep/collections", dependencies=A)
    async def prep_import(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Import a player's games from pasted PGN, or (optionally, online) by Lichess / Chess.com username."""
        pgn, source = body.get("pgn") or "", "pgn"
        if body.get("site") and body.get("username"):
            from ..prep import online
            pgn = await online.fetch(body["site"], body["username"], int(body.get("max_games", 300)))
            source = f"{body['site']}: {body['username']}"
        return S().prep.import_collection(body.get("name") or body.get("username") or body.get("player") or "Games", pgn,
                                          player=body.get("player") or body.get("username"), kind=body.get("kind", "opponent"), source=source)

    @app.delete("/api/prep/collections/{cid}", dependencies=A)
    async def prep_collection_delete(cid: str) -> dict[str, Any]:
        S().prep.delete_collection(cid)
        return {"ok": True}

    @app.get("/api/prep/dossier/{cid}", dependencies=A)
    async def prep_dossier(cid: str, ref_book_id: str | None = None) -> dict[str, Any]:
        return S().prep.dossier(cid, ref_book_id)

    @app.post("/api/prep/sheet", dependencies=A)
    async def prep_sheet(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().prep.prep_sheet(body["collection_id"], body.get("my_color", "white"), body.get("my_book_id") or None)

    @app.post("/api/prep/leaks", dependencies=A)
    async def prep_leaks(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        if body.get("to_cards"):
            return S().prep.leaks_to_cards(body["collection_id"], body["book_id"], int(body.get("min_count", 1)))
        return S().prep.leaks(body["collection_id"], body["book_id"])

    @app.post("/api/prep/coverage", dependencies=A)
    async def prep_coverage(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().prep.coverage(body["book_id"], body.get("color", "white"), body.get("source_book_id") or None, int(body.get("max_ply", 20)))

    @app.post("/api/prep/move-orders", dependencies=A)
    async def prep_move_orders(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().prep.move_orders(body["moves"], body.get("start_fen"), body.get("freq_book_id") or None, body.get("me", "white"))

    @app.get("/api/prep/structures", dependencies=A)
    async def prep_structures(book_id: str, color: str = "white") -> dict[str, Any]:
        return S().prep.structures(book_id, color)

    @app.get("/api/prep/model-games", dependencies=A)
    async def prep_model_games(structure: str) -> list[dict[str, Any]]:
        return S().prep.model_games(structure)

    @app.post("/api/prep/plan-task", dependencies=A)
    async def prep_plan_task(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        return S().prep.plan_task(body.get("structure"), body.get("seed"))

    @app.get("/api/prep/events", dependencies=A)
    async def prep_events() -> list[dict[str, Any]]:
        return S().prep.events()

    @app.post("/api/prep/events", dependencies=A)
    async def prep_event_save(body: dict[str, Any] = Body(...)) -> list[dict[str, Any]]:
        return S().prep.save_event(body.get("name", ""), float(body["date"]), body.get("decks") or [], body.get("id"))

    @app.delete("/api/prep/events/{eid}", dependencies=A)
    async def prep_event_delete(eid: str) -> list[dict[str, Any]]:
        return S().prep.delete_event(eid)

    @app.get("/api/prep/alerts", dependencies=A)
    async def prep_alerts(book_id: str | None = None) -> list[dict[str, Any]]:
        return S().prep.alerts(book_id)

    @app.post("/api/prep/alerts/{wid}/accept", dependencies=A)
    async def prep_alert_accept(wid: str) -> dict[str, Any]:
        S().prep_engine.rebase_watch(wid)
        return {"ok": True}

    @app.post("/api/prep/goal-book", dependencies=A)
    async def prep_goal_book(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().prep.goal_book(body["book_id"], body.get("color", "white"), body.get("goal", "draw"))

    @app.post("/api/prep/recital", dependencies=A)
    async def prep_recital(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        return S().prep.recital(body.get("book_id") or None, body.get("opening_id") or None, body.get("color", "white"), body.get("seed"))

    @app.post("/api/prep/survival", dependencies=A)
    async def prep_survival(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().prep.survival_start(body["book_id"], body.get("color", "white"), body.get("seed"))

    @app.get("/api/prep/endgames", dependencies=A)
    async def prep_endgames(collection_id: str | None = None) -> dict[str, Any]:
        return S().prep.endgames(collection_id)

    @app.post("/api/prep/job", dependencies=A)
    async def prep_job(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Start an engine-backed preparation task: dossier | leak_costs | practical | watch | annotate."""
        if not body.get("engine"):
            raise ValueError("Choose an engine")
        job = S().jobs.submit("prep", body.get("collection_id") or body.get("book_id"), body, priority=4)
        return {"job_id": job["id"]}

    # ------------------------------------------------------------------ puzzles
    @app.get("/api/puzzles", dependencies=A)
    async def pz_list(theme: str | None = None, level: str | None = None, source: str | None = None) -> dict[str, Any]:
        return {"puzzles": S().puzzles.list(theme, level, source), "stats": S().puzzles.stats()}

    @app.get("/api/puzzles/{pid}", dependencies=A)
    async def pz_get(pid: str, reveal: bool = False) -> dict[str, Any]:
        return S().puzzles.get(pid, reveal)

    @app.post("/api/puzzles/{pid}/check", dependencies=A)
    async def pz_check(pid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().puzzles.check(pid, int(body.get("index", 0)), body["move"])

    @app.post("/api/puzzles/{pid}/record", dependencies=A)
    async def pz_record(pid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        res = S().puzzles.record(pid, bool(body["solved"]), body.get("time_ms"), int(body.get("hints", 0)), int(body.get("mistakes", 0)))
        S().trainer.log("puzzle", bool(body["solved"]) and not body.get("mistakes"), body.get("time_ms"), int(body.get("hints", 0)),
                        detail={"puzzle_id": pid})
        return res

    @app.delete("/api/puzzles/{pid}", dependencies=A)
    async def pz_delete(pid: str) -> dict[str, Any]:
        S().puzzles.delete(pid)
        return {"ok": True}

    @app.post("/api/puzzles/mine", dependencies=A)
    async def pz_mine(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        job = S().jobs.submit("puzzle_mining", body.get("tournament_id") or body.get("experiment_id"), body, priority=6)
        return {"job_id": job["id"]}

    @app.post("/api/puzzles/from-position", dependencies=A)
    async def pz_from_position(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return await S().puzzles.from_position(body["fen"], EngineSpec.from_dict(body["engine"]), Budget.from_dict(body.get("budget")),
                                               title=body.get("title", "Custom position"))

    # ------------------------------------------------------------------ studies
    @app.get("/api/studies", dependencies=A)
    async def st_list() -> list[dict[str, Any]]:
        return S().studies.list()

    @app.post("/api/studies", dependencies=A)
    async def st_create(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        st = S().studies
        if body.get("pgn"):
            return st.import_pgn(body["pgn"], body.get("title"), body.get("kind", "game_review"))
        if body.get("opening_id"):
            return st.from_opening(body["opening_id"])
        if body.get("game_id"):
            g = S().db.get("games", body["game_id"])
            if not g:
                raise HTTPException(404, "Unknown game")
            return st.get(st.from_game(g, body.get("study_id"))["study_id"])
        s = st.create(body.get("title", "Untitled study"), body.get("description", ""), body.get("kind", "opening"), body.get("tags"))
        st.add_chapter(s["id"], "Chapter 1", "")
        return st.get(s["id"])

    @app.get("/api/studies/{sid}", dependencies=A)
    async def st_get(sid: str) -> dict[str, Any]:
        return S().studies.get(sid)

    @app.patch("/api/studies/{sid}", dependencies=A)
    async def st_patch(sid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().studies.update(sid, **body)

    @app.delete("/api/studies/{sid}", dependencies=A)
    async def st_delete(sid: str) -> dict[str, Any]:
        S().studies.delete(sid)
        return {"ok": True}

    @app.get("/api/studies/{sid}/pgn", dependencies=A)
    async def st_pgn(sid: str) -> PlainTextResponse:
        return PlainTextResponse(S().studies.export_pgn(sid), headers={"Content-Disposition": f'attachment; filename="{sid}.pgn"'})

    @app.post("/api/studies/{sid}/chapters", dependencies=A)
    async def ch_add(sid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().studies.add_chapter(sid, body.get("title", "New chapter"), body.get("pgn", ""), body.get("orientation", "white"))

    @app.get("/api/chapters/{cid}", dependencies=A)
    async def ch_get(cid: str) -> dict[str, Any]:
        return S().studies.chapter(cid)

    @app.put("/api/chapters/{cid}", dependencies=A)
    async def ch_put(cid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().studies.set_pgn(cid, body["pgn"], body.get("title"), body.get("orientation"))

    @app.post("/api/chapters/{cid}/edit", dependencies=A)
    async def ch_edit(cid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        b = dict(body)
        return S().studies.edit(cid, b.pop("op"), b.pop("path", []), **b)

    @app.delete("/api/chapters/{cid}", dependencies=A)
    async def ch_delete(cid: str) -> dict[str, Any]:
        S().studies.delete_chapter(cid)
        return {"ok": True}

    @app.post("/api/chapters/{cid}/to", dependencies=A)
    async def ch_to(cid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        s = S()
        seq = s.studies.playback_sequence(cid, body.get("path"))
        target = body.get("target")
        if target == "playback":
            return seq
        if target == "cards":
            return s.trainer.build_deck_from_line(seq["title"], seq["start_fen"], seq["moves"], body.get("color", "white"))
        if target == "puzzles":
            ch = s.db.get("chapters", cid)
            job = s.jobs.submit("puzzle_mining", cid, {"pgn": ch["pgn"], "engine": body["engine"], "budget": body.get("budget")}, priority=6)
            return {"job_id": job["id"]}
        raise HTTPException(400, "target must be playback, cards or puzzles")

    # ------------------------------------------------------------------ play
    @app.post("/api/play", dependencies=A)
    async def play_create(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return (await S().play.create(body)).state()

    @app.get("/api/play", dependencies=A)
    async def play_list() -> dict[str, Any]:
        return {"active": S().play.active(), "recoverable": S().play.recoverable()}

    @app.get("/api/play/{sid}", dependencies=A)
    async def play_get(sid: str) -> dict[str, Any]:
        return S().play.get(sid).state()

    @app.post("/api/play/{sid}/{action}", dependencies=A)
    async def play_action(sid: str, action: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        pm = S().play
        if action == "recover":
            return (await pm.recover(sid)).state()
        s = pm.get(sid)
        if action == "move":
            return await s.human_move(body["move"])
        if action == "resign":
            await s.resign()
        elif action == "abort":
            await s.abort()
        elif action == "claim_draw":
            await s.claim_draw()
        elif action == "offer_draw":
            return {**(await s.offer_draw()), "state": s.state()}
        elif action == "undo":
            await s.undo()
        elif action == "pause":
            s.pause(True)
        elif action == "resume":
            s.pause(False)
        elif action == "adjust_clock":
            s.adjust_clock(body["side"], float(body["delta_ms"]))
        elif action == "hint":
            return await s.hint()
        elif action == "synced":
            await s._hw_event({"status": "in_sync"})
        else:
            raise HTTPException(400, "Unknown action")
        return s.state()

    @app.post("/api/clock/validate", dependencies=A)
    async def clock_validate(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return normalize_config(body)

    @app.get("/api/clock/presets", dependencies=A)
    async def clock_presets() -> dict[str, Any]:
        return {"builtin": PRESETS, "custom": S().db.pref("clock_presets", [])}

    @app.put("/api/clock/presets", dependencies=A)
    async def clock_presets_save(body: list[dict[str, Any]] = Body(...)) -> dict[str, Any]:
        clean = [{**normalize_config(p), "name": p.get("name", "Custom"), "group": "My clocks"} for p in body]
        S().db.set_pref("clock_presets", clean)
        return {"custom": clean}

    # ------------------------------------------------------------------ hardware
    @app.get("/api/hw", dependencies=A)
    async def hw_status() -> dict[str, Any]:
        return {**S().hw.status(), "known": S().hw.known_devices(), "models": {k: c.to_dict() for k, c in codec.CAPS.items()}}

    @app.post("/api/hw/scan", dependencies=A)
    async def hw_scan(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        return await S().hw.scan(float(body.get("timeout", 6)))

    @app.post("/api/hw/connect", dependencies=A)
    async def hw_connect(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        hw = S().hw
        if body.get("simulator"):
            return await hw.connect_sim(body.get("model", "move"), body.get("fen"), float(body.get("step_time", 0.7)))
        return await hw.connect(body["address"], body.get("name", ""), body.get("model"))

    @app.post("/api/hw/disconnect", dependencies=A)
    async def hw_disconnect() -> dict[str, Any]:
        await S().hw.disconnect()
        return S().hw.status()

    @app.post("/api/hw/refresh", dependencies=A)
    async def hw_refresh() -> dict[str, Any]:
        return await S().hw.refresh()

    @app.put("/api/hw/profile", dependencies=A)
    async def hw_profile(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        if body.get("robot_verified") and not body.get("confirm_checklist"):
            raise ValueError("Unlocking live robotic motion requires confirming the hardware verification checklist")
        body.pop("confirm_checklist", None)
        return S().hw.update_profile(**body)

    @app.post("/api/hw/leds", dependencies=A)
    async def hw_leds(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        hw = S().hw
        if body.get("off"):
            await hw.leds_off()
            return {"mode": "off"}
        if body.get("leds") is not None:
            return await hw.set_leds_raw(body["leds"])
        if body.get("fen") and body.get("move"):
            b = chess.Board(body["fen"])
            return await hw.guide_move(b, b.parse_uci(body["move"]))
        return await hw.guide(source=body.get("source"), dest=body.get("dest"), danger=body.get("danger"))

    @app.get("/api/hw/log", dependencies=A)
    async def hw_log(limit: int = 120) -> list[dict[str, Any]]:
        return S().hw.log_tail(limit)

    @app.post("/api/hw/setup-steps", dependencies=A)
    async def hw_setup_steps(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return {"steps": S().hw.manual_setup_steps(chess.Board(body["fen"]))}

    @app.post("/api/hw/robot/{action}", dependencies=A)
    async def hw_robot(action: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        hw = S().hw
        robot = hw._robot()
        if action == "stop":
            return await robot.stop()          # never queued behind anything
        if action == "plan":
            return robot.plan(chess.Board(body["fen"]), body.get("reason", "manual setup"))
        if action == "confirm":
            return await robot.confirm(int(body["op_id"]))
        if action == "cancel":
            robot.cancel_plan()
            return robot.status()
        if action == "scan":
            await robot.scan()
            return robot.status()
        if action == "recover":
            return await robot.recover(body.get("action", "rescan"))
        raise HTTPException(400, "Unknown robot action")

    @app.post("/api/hw/sim/{action}", dependencies=A)
    async def hw_sim(action: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        """The simulator's 'hands': what a person would do to the physical board."""
        sim = S().hw.sim
        if sim is None:
            raise HardwareError("No simulated board is connected")
        if action == "lift":
            sim.lift(chess.parse_square(body["square"]))
        elif action == "place":
            sim.place(chess.parse_square(body["square"]), body["piece"])
        elif action == "remove":
            sim.remove(chess.parse_square(body["square"]))
        elif action == "set":
            sim.set_position(chess.Board(body["fen"]) if " " in body["fen"] else body["fen"])
        elif action == "move":
            b = chess.Board(body["fen"])
            sim.play(b, b.parse_uci(body["move"]), complete=body.get("complete", True))
        elif action == "battery":
            sim.set_battery(int(body.get("percent", 50)), bool(body.get("charging", False)))
        elif action == "fault":
            sim.fault = body.get("kind")
        elif action == "speed":
            sim.step_time = max(0.02, float(body.get("step_time", 0.7)))
        elif action == "drop":
            sim.drop_connection()
        else:
            raise HTTPException(400, "Unknown simulator action")
        return sim.state()

    @app.post("/api/hw/playback", dependencies=A)
    async def pb_create(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        hw = S().hw
        if hw.playback:
            await hw.playback.stop()
        hw.playback = Playback(hw, body.get("start_fen") or START_FEN, body["moves"], mode=body.get("mode", "digital"),
                               speed_ms=int(body.get("speed_ms", 1500)), title=body.get("title", ""),
                               annotations={int(k): v for k, v in (body.get("annotations") or {}).items()})
        if body.get("autoplay"):
            await hw.playback.play()
        return hw.playback.status()

    @app.post("/api/hw/playback/{action}", dependencies=A)
    async def pb_action(action: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        pb = S().hw.playback
        if pb is None:
            raise HardwareError("No playback is loaded")
        if action == "play":
            await pb.play()
        elif action == "pause":
            await pb.pause()
        elif action == "stop":
            await pb.stop()
        elif action == "restart":
            await pb.restart()
        elif action == "next":
            await pb.step(1)
        elif action == "prev":
            await pb.step(-1)
        elif action == "goto":
            await pb.goto(int(body["index"]))
        elif action == "speed":
            pb.speed_ms = max(200, int(body["speed_ms"]))
        elif action == "mode":
            if pb.state in ("playing", "waiting_board"):
                raise HardwareError("Pause playback before changing mode")
            pb.mode = body["mode"]
        else:
            raise HTTPException(400, "Unknown playback action")
        return pb.status()

    # ------------------------------------------------------------------ broadcast (admin)
    @app.get("/api/broadcasts", dependencies=A)
    async def bc_list() -> list[dict[str, Any]]:
        return S().broadcasts.list()

    @app.post("/api/broadcasts", dependencies=A)
    async def bc_create(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().broadcasts.create(body.get("title", ""), body["source"], body.get("config"), bool(body.get("consent")))

    @app.patch("/api/broadcasts/{bid}", dependencies=A)
    async def bc_update(bid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return S().broadcasts.update(bid, active=body.get("active"), config=body.get("config"), title=body.get("title"),
                                     source=body.get("source"))

    @app.post("/api/broadcasts/{bid}/push", dependencies=A)
    async def bc_push(bid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        S().broadcasts.push_manual(bid, body)
        return {"ok": True}

    @app.delete("/api/broadcasts/{bid}", dependencies=A)
    async def bc_delete(bid: str) -> dict[str, Any]:
        S().broadcasts.delete(bid)
        return {"ok": True}

    # ------------------------------------------------------------------ public spectator API (read-only)
    @app.get("/api/public/broadcast/{token}")
    async def public_state(token: str) -> dict[str, Any]:
        st = S().broadcasts.public_state(token)
        if st is None:
            raise HTTPException(404, "No such broadcast")
        return st

    @app.get("/api/public/broadcast/{token}/events")
    async def public_events(token: str, request: Request) -> StreamingResponse:
        bc = S().broadcasts
        if bc.public_state(token) is None:
            raise HTTPException(404, "No such broadcast")
        sub = S().bus.subscribe(f"broadcast:{token}", maxsize=32)

        async def gen():
            bc.viewers[token] = bc.viewers.get(token, 0) + 1
            try:
                yield f"data: {json.dumps(bc.public_state(token), default=str)}\n\n"
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        msg = await asyncio.wait_for(sub.queue.get(), 10)
                        yield f"data: {json.dumps(msg['data'], default=str)}\n\n"
                    except asyncio.TimeoutError:
                        yield ": keep-alive\n\n"
            finally:
                sub.close()
                bc.viewers[token] = max(0, bc.viewers.get(token, 1) - 1)

        return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # ------------------------------------------------------------------ backup / package
    @app.post("/api/backup", dependencies=A)
    async def backup_now() -> dict[str, Any]:
        p = rotate_backups(S().db, settings.data_dir / "backups", keep=14)
        return {"path": str(p), "integrity": S().db.integrity()}

    @app.get("/api/package/export", dependencies=A)
    async def package_export() -> FileResponse:
        dest = settings.data_dir / "exports" / f"opening-magician-{time.strftime('%Y%m%d-%H%M%S')}.omproj"
        export_package(S().db, S().books, dest)
        return FileResponse(dest, filename=dest.name, media_type="application/zip")

    @app.post("/api/package/inspect", dependencies=A)
    async def package_inspect(file: UploadFile = File(...)) -> dict[str, Any]:
        with tempfile.NamedTemporaryFile(suffix=".omproj", delete=False) as tmp:
            tmp.write(await file.read())
        try:
            return inspect_package(Path(tmp.name))
        finally:
            Path(tmp.name).unlink(missing_ok=True)

    @app.post("/api/package/restore", dependencies=A)
    async def package_restore(file: UploadFile = File(...), confirm: bool = Query(False)) -> dict[str, Any]:
        if not confirm:
            raise ValueError("Restoring replaces the current project. Pass confirm=true after reviewing the package.")
        s = S()
        if s.play.active() or any(j["status"] == "running" for j in s.jobs.list()):
            raise ValueError("Stop running games, tournaments and experiments before restoring a project")
        with tempfile.NamedTemporaryFile(suffix=".omproj", delete=False) as tmp:
            tmp.write(await file.read())
        try:
            rotate_backups(s.db, settings.data_dir / "backups", keep=14)
            return restore_package(s.db, s.books, Path(tmp.name))
        finally:
            Path(tmp.name).unlink(missing_ok=True)

    # ------------------------------------------------------------------ websocket
    @app.websocket("/ws")
    async def ws(socket: WebSocket) -> None:
        token = socket.query_params.get("token", "")
        if not ((settings.mode == "local" and is_local(socket)) or (settings.admin_token and token == settings.admin_token)):
            await socket.close(code=4401)
            return
        await socket.accept()
        sub = S().bus.subscribe("jobs", "hw")

        async def pump() -> None:
            while True:
                msg = await sub.queue.get()
                await socket.send_text(json.dumps(msg, default=str))

        task = asyncio.get_running_loop().create_task(pump())
        try:
            while True:
                raw = await socket.receive_text()
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                for t in msg.get("subscribe", []):
                    sub.topics.add(str(t))
                for t in msg.get("unsubscribe", []):
                    sub.topics.discard(str(t))
        except WebSocketDisconnect:
            pass
        finally:
            task.cancel()
            sub.close()

    # ------------------------------------------------------------------ frontend
    dist = settings.frontend_dist

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> Response:
        if path.startswith("api/") or path == "ws":
            raise HTTPException(404)
        if dist.is_dir():
            f = (dist / path).resolve()
            if path and f.is_file() and str(f).startswith(str(dist.resolve())):
                return FileResponse(f)
            index = dist / "index.html"
            if index.is_file():
                return FileResponse(index, headers={"Cache-Control": "no-cache"})
        return PlainTextResponse("Opening Magician bridge is running. Build the frontend (npm run build) or use the Vite dev server.",
                                 status_code=200)

    return app


def bookmodel_safe(name: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in name)[:60] or "book"

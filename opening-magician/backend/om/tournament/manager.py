"""Tournament manager: round robin, gauntlet, knockout, Swiss and persistent leagues.

Every finished game is committed (game row + schedule entry) in one transaction, so a
crash or restart loses at most the games that were in flight; those are simply replayed.
"""
from __future__ import annotations

import asyncio
import random
import time
from typing import Any, Callable

from ..db import Database, new_id, now
from ..engines.manager import EngineManager, EngineSpec
from ..events import EventBus
from ..jobs import JobContext, JobManager
from . import pairings, stats
from .runner import GameSpec, play_game

FORMATS = ["round_robin", "gauntlet", "knockout", "swiss", "league"]
OpeningSource = Callable[[dict[str, Any], int], list[dict[str, Any]]]


class TournamentError(ValueError):
    pass


class TournamentManager:
    def __init__(self, db: Database, engines: EngineManager, jobs: JobManager, bus: EventBus,
                 opening_source: OpeningSource | None = None):
        self.db, self.engines, self.jobs, self.bus = db, engines, jobs, bus
        self.opening_source = opening_source
        self.live: dict[str, dict[str, Any]] = {}      # tournament id -> {game key -> live state}
        jobs.register("tournament", self._job)

    # -- creation ----------------------------------------------------------
    def create(self, config: dict[str, Any]) -> dict[str, Any]:
        cfg = self._normalize(config)
        t = {"id": new_id("trn"), "name": cfg["name"], "format": cfg["format"], "config": cfg, "state": {},
             "status": "pending", "report": None, "created_at": now(), "started_at": None, "finished_at": None}
        t["state"] = self._initial_state(cfg)
        self.db.insert("tournaments", t)
        return t

    def _normalize(self, config: dict[str, Any]) -> dict[str, Any]:
        cfg = dict(config)
        fmt = cfg.get("format", "round_robin")
        if fmt not in FORMATS:
            raise TournamentError(f"Unknown format '{fmt}'")
        players = []
        seen = set()
        for i, p in enumerate(cfg.get("players") or []):
            spec = EngineSpec.from_dict(p["engine"] if "engine" in p else p)
            row = self.engines.get(spec.engine_id)
            name = p.get("name") or spec.label or row["name"]
            base, k = name, 2
            while name in seen:
                name, k = f"{base} #{k}", k + 1
            seen.add(name)
            players.append({"name": name, "engine": spec.to_dict(), "seed": i + 1})
        if len(players) < 2:
            raise TournamentError("A tournament needs at least two engines")
        cfg.update({
            "format": fmt, "players": players, "name": cfg.get("name") or f"{fmt.replace('_', ' ').title()} {time.strftime('%Y-%m-%d %H:%M')}",
            "cycles": max(1, int(cfg.get("cycles", 1))), "reverse_colors": bool(cfg.get("reverse_colors", True)),
            "concurrency": max(1, int(cfg.get("concurrency", 1))), "seed": int(cfg.get("seed", random.randrange(1 << 30))),
            "time": cfg.get("time") or {"mode": "noflag", "budget": {"min_time": 0.05, "max_time": 0.4, "min_depth": 2, "max_depth": 12}},
            "adjudication": cfg.get("adjudication") or {},
            "openings": cfg.get("openings") or {"mode": "start"},
        })
        if cfg["time"].get("mode") not in ("noflag", "clock"):
            raise TournamentError("time.mode must be 'clock' (real clock, time forfeits) or 'noflag' (bounded research budget)")
        names = [p["name"] for p in players]
        if fmt == "gauntlet":
            g = cfg.setdefault("gauntlet", {})
            g["champion"] = g.get("champion") if g.get("champion") in names else names[0]
            g["games_per_opponent"] = max(1, int(g.get("games_per_opponent", 2)))
        if fmt == "knockout":
            k = cfg.setdefault("knockout", {})
            k["best_of"] = max(1, int(k.get("best_of", 2)))
            k["tiebreak_pairs"] = max(0, int(k.get("tiebreak_pairs", 1)))
        if fmt == "swiss":
            s = cfg.setdefault("swiss", {})
            s["rounds"] = max(1, int(s.get("rounds") or pairings.swiss_rounds_recommended(len(players))))
        if fmt == "league":
            lg = cfg.setdefault("league", {})
            divs = lg.get("divisions")
            if not divs:
                size = max(2, int(lg.get("division_size", max(2, (len(names) + 1) // 2))))
                divs = [names[i:i + size] for i in range(0, len(names), size)]
                if len(divs) > 1 and len(divs[-1]) < 2:
                    divs[-2].extend(divs.pop())
            lg["divisions"] = divs
            lg["promote"] = max(0, int(lg.get("promote", 1)))
            lg["seasons"] = max(1, int(lg.get("seasons", 1)))
        return cfg

    def _openings(self, cfg: dict[str, Any], count: int) -> list[dict[str, Any]]:
        o = cfg["openings"]
        mode = o.get("mode", "start")
        if mode == "fen" and o.get("fen"):
            return [{"name": o.get("name", "Custom position"), "fen": o["fen"], "moves": []}]
        if mode == "suite" and o.get("suite"):
            return [{"name": s.get("name", ""), "moves": s.get("moves", []), "fen": s.get("fen")} for s in o["suite"]]
        if mode in ("book", "catalog") and self.opening_source:
            got = self.opening_source(o, count)
            if got:
                return got
        return [{"name": "", "moves": [], "fen": None}]

    def _games_for(self, cfg: dict[str, Any], rounds: list[list[tuple[str, str]]], round_offset: int = 0,
                   tag: dict[str, Any] | None = None, paired: bool | None = None) -> list[dict[str, Any]]:
        total = sum(len(r) for r in rounds)
        paired = cfg["reverse_colors"] if paired is None else paired
        ops = self._openings(cfg, total)
        games = []
        # Colour-reversed twins must start from the same opening so the comparison is fair.
        twin: dict[frozenset[str], list[int]] = {}
        rng = random.Random(cfg["seed"] + round_offset * 7919)
        order = list(range(len(ops)))
        rng.shuffle(order)
        cursor = 0
        for ri, rnd in enumerate(rounds):
            for w, b in rnd:
                key = frozenset((w, b))
                if paired and twin.get(key):
                    oi = twin[key].pop(0)
                else:
                    oi = order[cursor % len(order)]
                    cursor += 1
                    if paired:
                        twin.setdefault(key, []).append(oi)
                games.append({"id": new_id("g"), "round": round_offset + ri + 1, "white": w, "black": b,
                              "opening": ops[oi], "status": "pending", "result": None, "game_id": None,
                              "termination": None, "plies": None, **(tag or {})})
        return games

    def _initial_state(self, cfg: dict[str, Any]) -> dict[str, Any]:
        names = [p["name"] for p in cfg["players"]]
        fmt = cfg["format"]
        state: dict[str, Any] = {"schedule": [], "round": 0, "byes": {}, "attempts": {}}
        if fmt == "round_robin":
            state["schedule"] = self._games_for(cfg, pairings.round_robin(names, cfg["cycles"], cfg["reverse_colors"]))
            state["total_rounds"] = max((g["round"] for g in state["schedule"]), default=0)
        elif fmt == "gauntlet":
            g = cfg["gauntlet"]
            rounds = pairings.gauntlet(g["champion"], [n for n in names if n != g["champion"]], g["games_per_opponent"], cfg["reverse_colors"])
            state["schedule"] = self._games_for(cfg, rounds)
            state["total_rounds"] = len(rounds)
        elif fmt == "swiss":
            state["total_rounds"] = cfg["swiss"]["rounds"]
            state["swiss"] = {"byes": [], "relaxed_rounds": []}
        elif fmt == "knockout":
            state["knockout"] = {"rounds": [], "champion": None}
        elif fmt == "league":
            state["league"] = {"season": 0, "divisions": cfg["league"]["divisions"], "history": []}
        return state

    # -- queries ---------------------------------------------------------------
    def get(self, tid: str) -> dict[str, Any]:
        t = self.db.get("tournaments", tid)
        if not t:
            raise TournamentError(f"Unknown tournament {tid}")
        return t

    def list(self) -> list[dict[str, Any]]:
        rows = self.db.all("tournaments", order="created_at DESC", cols="id,name,format,status,created_at,started_at,finished_at,state,config")
        out = []
        for r in rows:
            sched = r["state"].get("schedule", [])
            out.append({"id": r["id"], "name": r["name"], "format": r["format"], "status": r["status"],
                        "created_at": r["created_at"], "finished_at": r["finished_at"],
                        "players": [p["name"] for p in r["config"]["players"]],
                        "games_total": len(sched), "games_done": sum(1 for g in sched if g["status"] == "done")})
        return out

    def view(self, tid: str) -> dict[str, Any]:
        t = self.get(tid)
        sched = t["state"].get("schedule", [])
        done = [g for g in sched if g["status"] == "done" and g.get("counts", True)]
        names = [p["name"] for p in t["config"]["players"]]
        job = self.jobs.for_ref(tid)
        return {**{k: t[k] for k in ("id", "name", "format", "status", "config", "created_at", "started_at", "finished_at", "report")},
                "state": t["state"], "standings": stats.standings(names, done, t["state"].get("byes")),
                "overview": stats.overview(done), "head_to_head": stats.head_to_head(done),
                "live": list(self.live.get(tid, {}).values()),
                "job": {"id": job["id"], "status": job["status"], "progress": job["progress"], "error": job["error"]} if job else None}

    def games(self, tid: str) -> list[dict[str, Any]]:
        return self.db.all("games", "tournament_id=?", (tid,), order="created_at",
                           cols="id,white,black,result,termination,opening,plies,created_at,meta")

    def pgn(self, tid: str) -> str:
        return "\n\n".join(g["pgn"].strip() for g in self.db.all("games", "tournament_id=?", (tid,), order="created_at")) + "\n"

    # -- controls ----------------------------------------------------------------
    def start(self, tid: str) -> dict[str, Any]:
        t = self.get(tid)
        if t["status"] in ("completed", "canceled"):
            raise TournamentError(f"Tournament is already {t['status']}")
        job = self.jobs.for_ref(tid)
        if job and job["status"] in ("paused", "recovery_required", "failed"):
            self.jobs.resume(job["id"])
        elif not job or job["status"] in ("completed", "canceled"):
            self.jobs.submit("tournament", tid, {"auto_resume": True}, priority=3)
        self.db.update("tournaments", tid, {"status": "running", "started_at": t["started_at"] or now()})
        self.bus.publish(f"tournament:{tid}", "status", {"status": "running"})
        return self.view(tid)

    def pause(self, tid: str) -> None:
        job = self.jobs.for_ref(tid)
        if job:
            self.jobs.pause(job["id"])
        self.db.update("tournaments", tid, {"status": "paused"})
        self.bus.publish(f"tournament:{tid}", "status", {"status": "paused"})

    def cancel(self, tid: str) -> None:
        job = self.jobs.for_ref(tid)
        if job:
            self.jobs.cancel(job["id"])
        self.db.update("tournaments", tid, {"status": "canceled", "finished_at": now()})
        self.bus.publish(f"tournament:{tid}", "status", {"status": "canceled"})

    def duplicate(self, tid: str) -> dict[str, Any]:
        t = self.get(tid)
        cfg = dict(t["config"])
        cfg["name"] = t["name"] + " (copy)"
        cfg["players"] = [{"name": p["name"], "engine": p["engine"]} for p in cfg["players"]]
        cfg.pop("seed", None)
        return self.create(cfg)

    def delete(self, tid: str) -> None:
        self.cancel(tid)
        with self.db.tx():
            self.db.execute("DELETE FROM games WHERE tournament_id=?", (tid,))
            self.db.delete("tournaments", tid)

    # -- job runner ------------------------------------------------------------------
    async def _job(self, ctx: JobContext) -> dict[str, Any]:
        tid = ctx.job["ref_id"]
        t = self.get(tid)
        cfg = t["config"]
        # games that were in flight when the process stopped are replayed
        changed = False
        for g in t["state"].get("schedule", []):
            if g["status"] == "running":
                g["status"], changed = "pending", True
        if changed:
            self.db.update("tournaments", tid, {"state": t["state"]})
        self.live[tid] = {}
        specs = {p["name"]: EngineSpec.from_dict(p["engine"]) for p in cfg["players"]}
        sem = asyncio.Semaphore(cfg["concurrency"])
        try:
            while not ctx.should_stop():
                t = self.get(tid)
                state = t["state"]
                pending = [g for g in state["schedule"] if g["status"] == "pending"]
                if not pending:
                    if not self._advance(tid):
                        break
                    continue
                current_round = min(g["round"] for g in pending)
                batch = [g for g in pending if g["round"] == current_round]
                state["round"] = current_round
                self.db.update("tournaments", tid, {"state": state})
                self.bus.publish(f"tournament:{tid}", "round", {"round": current_round})

                async def one(g: dict[str, Any]) -> None:
                    async with sem:
                        if ctx.should_stop():
                            return
                        await self._play(tid, cfg, specs, g, ctx)

                await asyncio.gather(*(one(g) for g in batch))
                sched = self.get(tid)["state"]["schedule"]
                total = max(1, len(sched) if cfg["format"] in ("round_robin", "gauntlet") else len(sched) + 1)
                ctx.checkpoint({"round": current_round}, sum(1 for g in sched if g["status"] == "done") / total)
        finally:
            self.live.pop(tid, None)
        t = self.get(tid)
        if ctx.cancel.is_set() and not ctx.pause_requested:
            return {"status": "canceled"}
        if ctx.pause_requested:
            self.db.update("tournaments", tid, {"status": "paused"})
            return {"status": "paused"}
        report = self.build_report(tid)
        self.db.update("tournaments", tid, {"status": "completed", "finished_at": now(), "report": report})
        self.bus.publish(f"tournament:{tid}", "status", {"status": "completed"})
        return {"status": "completed", "games": report["overview"]["games"]}

    async def _play(self, tid: str, cfg: dict[str, Any], specs: dict[str, EngineSpec], g: dict[str, Any], ctx: JobContext) -> None:
        self._mark(tid, g["id"], {"status": "running"})
        op = g.get("opening") or {}
        spec = GameSpec(white=specs[g["white"]], black=specs[g["black"]], white_name=g["white"], black_name=g["black"],
                        start_fen=op.get("fen"), opening_moves=list(op.get("moves") or []), opening_name=op.get("name", ""),
                        time=g.get("time") or cfg["time"], adjudication=cfg["adjudication"],
                        headers={"Event": cfg["name"], "Round": str(g["round"])})
        live = {"key": g["id"], "white": g["white"], "black": g["black"], "round": g["round"], "fen": op.get("fen"),
                "opening": op.get("name", ""), "moves": [], "last": None}
        self.live.setdefault(tid, {})[g["id"]] = live

        def on_move(ev: dict[str, Any]) -> None:
            live.update({"fen": ev["fen_after"], "last": ev})
            live["moves"].append(ev["san"])
            self.bus.publish(f"tournament:{tid}", "move", {"key": g["id"], "white": g["white"], "black": g["black"],
                                                            "fen": ev["fen_after"], "san": ev["san"], "uci": ev["uci"],
                                                            "ply": ev["ply"], "text": ev["text"],
                                                            "expected_white": ev["expected_white"], "depth": ev["depth"],
                                                            "clock_ms": ev.get("clock_ms")})

        rec = await play_game(self.engines, spec, on_move=on_move, cancel=ctx.cancel)
        self.live.get(tid, {}).pop(g["id"], None)
        if not rec["finished"]:
            t = self.get(tid)
            attempts = t["state"].setdefault("attempts", {})
            attempts[g["id"]] = attempts.get(g["id"], 0) + 1
            # Retry policy: a game that could not start (engine failed to launch) is retried once;
            # cancelled games simply return to the queue for a later resume.
            give_up = rec["termination"] == "engine_start_failed" and attempts[g["id"]] >= 2
            for x in t["state"]["schedule"]:
                if x["id"] == g["id"]:
                    x["status"] = "error" if give_up else "pending"
                    x["termination"] = rec["termination"]
                    x["detail"] = rec["detail"]
            self.db.update("tournaments", tid, {"state": t["state"]})
            if rec["termination"] == "engine_start_failed" and not give_up:
                await asyncio.sleep(0.5)
            return
        game_id = new_id("game")
        with self.db.tx():
            self.db.insert("games", {"id": game_id, "kind": "tournament", "white": rec["white"], "black": rec["black"],
                                     "result": rec["result"], "termination": rec["termination"], "pgn": rec["pgn"],
                                     "start_fen": rec["start_fen"], "opening": rec["opening"], "eco": None, "plies": rec["plies"],
                                     "tournament_id": tid, "experiment_id": None,
                                     "meta": {"evals": rec["evals"], "detail": rec["detail"], "round": g["round"],
                                              "time_control": rec["time_control"], "duration_s": rec["duration_s"],
                                              "schedule_id": g["id"]},
                                     "created_at": now(), "finished_at": now()})
            self._mark(tid, g["id"], {"status": "done", "result": rec["result"], "game_id": game_id,
                                      "termination": rec["termination"], "plies": rec["plies"], "detail": rec["detail"]})
        self.bus.publish(f"tournament:{tid}", "game", {"key": g["id"], "game_id": game_id, "white": g["white"], "black": g["black"],
                                                        "result": rec["result"], "termination": rec["termination"]})

    def _mark(self, tid: str, gid: str, changes: dict[str, Any]) -> None:
        with self.db.tx():
            t = self.get(tid)
            for g in t["state"]["schedule"]:
                if g["id"] == gid:
                    g.update(changes)
            self.db.update("tournaments", tid, {"state": t["state"]})

    # -- round generation for dynamic formats ----------------------------------------
    def _advance(self, tid: str) -> bool:
        """Create the next round if the format has one.  Returns False when the event is over."""
        t = self.get(tid)
        cfg, state = t["config"], t["state"]
        fmt = cfg["format"]
        names = [p["name"] for p in cfg["players"]]
        sched = state["schedule"]
        new: list[dict[str, Any]] = []
        if fmt in ("round_robin", "gauntlet"):
            return False
        if fmt == "swiss":
            played_rounds = max((g["round"] for g in sched), default=0)
            if played_rounds >= cfg["swiss"]["rounds"]:
                return False
            done = [g for g in sched if g["status"] == "done"]
            table = {r["player"]: r["points"] for r in stats.standings(names, done, state.get("byes"))}
            played = {frozenset((g["white"], g["black"])) for g in sched}
            hist: dict[str, list[str]] = {n: [] for n in names}
            for g in sorted(sched, key=lambda g: g["round"]):
                hist[g["white"]].append("w")
                hist[g["black"]].append("b")
            sw = state["swiss"]
            res = pairings.swiss_round(names, table, played, hist, set(sw["byes"]), {n: i for i, n in enumerate(names)})
            if res["bye"]:
                sw["byes"].append(res["bye"])
                state["byes"][res["bye"]] = state["byes"].get(res["bye"], 0) + 1.0
            if res["relaxed"]:
                sw["relaxed_rounds"].append(played_rounds + 1)
            new = self._games_for(cfg, [res["pairs"]], played_rounds, paired=False)
        elif fmt == "knockout":
            new = self._advance_knockout(cfg, state, names)
        elif fmt == "league":
            new = self._advance_league(cfg, state)
        if not new:
            self.db.update("tournaments", tid, {"state": state})
            return False
        state["schedule"].extend(new)
        self.db.update("tournaments", tid, {"state": state})
        return True

    def _advance_knockout(self, cfg: dict[str, Any], state: dict[str, Any], names: list[str]) -> list[dict[str, Any]]:
        ko = state["knockout"]
        k = cfg["knockout"]
        sched = state["schedule"]
        seed = {n: i for i, n in enumerate(names)}
        next_round = max((g["round"] for g in sched), default=0) + 1

        def mk(match: dict[str, Any], n_games: int, kind: str) -> list[dict[str, Any]]:
            a, b = match["a"], match["b"]
            start = len([g for g in sched if g.get("match") == match["id"]])
            pairs = [[(a, b) if (start + i) % 2 == 0 else (b, a)] for i in range(n_games)]
            out = []
            for i, p in enumerate(pairs):
                out += self._games_for(cfg, [p], next_round - 1, {"match": match["id"], "phase": kind}, paired=True)
            for g in out:
                g["round"] = next_round
            return out

        if not ko["rounds"]:
            slots = pairings.seeded_bracket(names)
            matches = [{"id": new_id("m"), "a": a, "b": b, "winner": (a or b) if (a is None or b is None) else None,
                        "score": {}, "tiebreaks": 0, "bye": a is None or b is None} for a, b in slots]
            ko["rounds"].append({"name": pairings.knockout_round_name(len(matches)), "matches": matches})
            games: list[dict[str, Any]] = []
            for m in matches:
                if not m["bye"]:
                    games += mk(m, k["best_of"], "regular")
            if games:
                return games
        cur = ko["rounds"][-1]
        games = []
        for m in cur["matches"]:
            if m["winner"]:
                continue
            mg = [g for g in sched if g.get("match") == m["id"] and g["status"] == "done"]
            pts = {m["a"]: 0.0, m["b"]: 0.0}
            for g in mg:
                w, b = stats.POINTS[g["result"]]
                pts[g["white"]] += w
                pts[g["black"]] += b
            m["score"] = pts
            if pts[m["a"]] != pts[m["b"]]:
                m["winner"] = m["a"] if pts[m["a"]] > pts[m["b"]] else m["b"]
            elif m["tiebreaks"] < k["tiebreak_pairs"]:
                m["tiebreaks"] += 1
                games += mk(m, 2, "tiebreak")
            else:
                m["winner"] = min((m["a"], m["b"]), key=lambda n: seed[n])
                m["decided_by"] = "higher seed (still level after tie-breaks)"
        if games:
            return games
        winners = [m["winner"] for m in cur["matches"]]
        if len(winners) == 1:
            ko["champion"] = winners[0]
            return []
        matches = [{"id": new_id("m"), "a": winners[i], "b": winners[i + 1], "winner": None, "score": {}, "tiebreaks": 0,
                    "bye": False} for i in range(0, len(winners), 2)]
        ko["rounds"].append({"name": pairings.knockout_round_name(len(matches)), "matches": matches})
        for m in matches:
            games += mk(m, k["best_of"], "regular")
        return games

    def _advance_league(self, cfg: dict[str, Any], state: dict[str, Any]) -> list[dict[str, Any]]:
        lg, conf = state["league"], cfg["league"]
        sched = state["schedule"]
        if lg["season"] > 0:
            # close the season: standings per division, then promotion / relegation
            season_games = [g for g in sched if g.get("season") == lg["season"] and g["status"] == "done"]
            tables = [stats.standings(div, [g for g in season_games if g.get("division") == i])
                      for i, div in enumerate(lg["divisions"])]
            moves = []
            divisions = [[r["player"] for r in tb] for tb in tables]
            k = conf["promote"]
            for i in range(len(divisions) - 1):
                n = min(k, len(divisions[i]) - 1, len(divisions[i + 1]) - 1)
                if n <= 0:
                    continue
                down, up = divisions[i][-n:], divisions[i + 1][:n]
                divisions[i] = divisions[i][:-n] + up
                divisions[i + 1] = down + divisions[i + 1][n:]
                moves.append({"promoted": up, "relegated": down, "between": [i + 1, i + 2]})
            lg["history"].append({"season": lg["season"], "tables": [[{"player": r["player"], "points": r["points"],
                                                                         "rank": r["rank"]} for r in tb] for tb in tables],
                                  "changes": moves})
            lg["divisions"] = divisions
            if lg["season"] >= conf["seasons"]:
                return []
        lg["season"] += 1
        offset = max((g["round"] for g in sched), default=0)
        games: list[dict[str, Any]] = []
        for i, div in enumerate(lg["divisions"]):
            rounds = pairings.round_robin(div, 1, cfg["reverse_colors"])
            games += self._games_for(cfg, rounds, offset, {"division": i, "season": lg["season"]})
        return games

    # -- reporting -----------------------------------------------------------------------
    def build_report(self, tid: str) -> dict[str, Any]:
        t = self.get(tid)
        names = [p["name"] for p in t["config"]["players"]]
        sched = [g for g in t["state"]["schedule"] if g["status"] == "done"]
        rows = self.db.all("games", "tournament_id=?", (tid,), order="created_at")
        swings = []
        for r in rows:
            for s in stats.decisive_positions(r["meta"].get("evals", []))[:2]:
                swings.append({**s, "game_id": r["id"], "white": r["white"], "black": r["black"], "result": r["result"]})
        swings.sort(key=lambda s: -abs(s["swing"]))
        table = stats.standings(names, sched, t["state"].get("byes"))
        errors = [g for g in t["state"]["schedule"] if g["status"] == "error" or g.get("termination") in ("engine_error", "illegal_move")]
        return {"generated_at": now(), "name": t["name"], "format": t["format"],
                "winner": (t["state"].get("knockout") or {}).get("champion") or (table[0]["player"] if table else None),
                "standings": table, "overview": stats.overview(sched), "head_to_head": stats.head_to_head(sched),
                "decisive_positions": swings[:12], "engine_problems": [{"white": g["white"], "black": g["black"],
                                                                         "termination": g.get("termination"), "detail": g.get("detail")} for g in errors],
                "league": (t["state"].get("league") or {}).get("history"),
                "knockout": (t["state"].get("knockout") or {}).get("rounds"),
                "method_notes": [
                    "Tie-break order: points, direct encounter, Sonneborn-Berger, Buchholz, wins.",
                    "Elo figures are performance estimates inside this event with 95% confidence intervals.",
                    "Time policy: " + ("real clock with time forfeits" if t["config"]["time"].get("mode") == "clock"
                                       else "no-flag research budgets (bounded per-move search, no clock forfeits)"),
                ]}

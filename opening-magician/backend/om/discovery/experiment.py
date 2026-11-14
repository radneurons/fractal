"""Opening Discovery Laboratory.

A discovery experiment is a durable, inspectable pipeline:

  1 candidate_selection   seed positions + strategy -> which ranks/moves to look at
  2 initial_analysis      ranked MultiPV evidence from the discovery engine, viability filters
  3 tournament_exploration explorer A vs explorer B play the candidates out (no-flag budgets)
  4 critical_positions    evaluation swings / missed tactics extracted from those games
  5 deep_verification     a stronger observer (and optional validator) re-evaluates everything
  6 candidate_comparison  seven separate scores, category, status
  7 results_review        structured report
  8 book_proposal         pending proposals for an exploration book (nothing auto-approved)
  9 human_approval        waits for the user
 10 follow_up             concrete next experiments

Candidate generation (weak/limited engines) is strictly separated from verification
(stronger engine), and no line is called sound because of a game result alone.
"""
from __future__ import annotations

import asyncio
import random
from typing import Any

import chess

from ..books.store import BookStore
from ..chessx import Score, loss_between, motifs_after, numbered, pos_key, san_line
from ..db import Database, new_id, now
from ..engines.manager import EngineError, EngineHandle, EngineManager, EngineSpec
from ..engines.search import AnalysisCache, Budget, adaptive_search, evaluate_move, ranked_candidates
from ..events import EventBus
from ..jobs import JobContext, JobManager
from ..openings import find as find_opening, identify
from ..tournament.runner import GameSpec, play_game
from ..tournament.stats import wdl_summary
from . import scoring

STAGES = ["candidate_selection", "initial_analysis", "tournament_exploration", "critical_positions", "deep_verification",
          "candidate_comparison", "results_review", "book_proposal", "human_approval", "follow_up"]
STRATEGIES = {
    "second_best": "Second-Best Explorer — investigate the 2nd-ranked candidate",
    "third_best": "Third-Best Explorer — investigate the 3rd-ranked candidate",
    "fourth_best": "Fourth-Best Explorer — investigate the 4th-ranked candidate",
    "fifth_best": "Fifth-Best Explorer — investigate the 5th-ranked candidate",
    "deep_alternative": "Deep Alternative Explorer — 6th-ranked and lower moves",
    "mixed": "Mixed-Rank Exploration — configurable distribution over ranks",
    "novelty": "Novelty Hunter — legal moves missing from the reference book / research DB",
    "surprise": "Surprise Search — uncommon moves with acceptable independent evaluations",
    "trap": "Trap Search — viable moves that create difficult practical decisions",
    "counter_repertoire": "Counter-Repertoire Explorer — alternatives to the book's own main replies",
    "transposition": "Transposition Hunter — other move orders into known positions",
    "anti_preparation": "Anti-Preparation Explorer — viable sidelines that leave the book quickly",
}
FIXED_RANK = {"second_best": 2, "third_best": 3, "fourth_best": 4, "fifth_best": 5}
DEFAULT_FILTERS = {"max_expected_loss": 0.10, "max_cp_loss": 150, "min_expected": 0.25, "exclude_mate_risk": True,
                   "min_complexity": 0.0, "min_novelty": 0.0}


class ExperimentError(ValueError):
    pass


class DiscoveryLab:
    def __init__(self, db: Database, engines: EngineManager, jobs: JobManager, bus: EventBus, books: BookStore):
        self.db, self.engines, self.jobs, self.bus, self.books = db, engines, jobs, bus, books
        self.cache = AnalysisCache(db)
        jobs.register("experiment", self._job)

    # ------------------------------------------------------------------ config
    def normalize(self, cfg: dict[str, Any]) -> dict[str, Any]:
        c = dict(cfg)
        strategy = c.get("strategy", "second_best")
        if strategy not in STRATEGIES:
            raise ExperimentError(f"Unknown strategy '{strategy}'")
        for key in ("explorer_a", "observer"):
            if not c.get(key):
                raise ExperimentError(f"'{key}' engine is required")
        c["explorer_a"] = EngineSpec.from_dict(c["explorer_a"]).to_dict()
        c["explorer_b"] = EngineSpec.from_dict(c.get("explorer_b") or c["explorer_a"]).to_dict()
        c["observer"] = EngineSpec.from_dict(c["observer"]).to_dict()
        c["validator"] = EngineSpec.from_dict(c["validator"]).to_dict() if c.get("validator") else None
        for k in ("explorer_a", "explorer_b", "observer", "validator"):
            if c[k]:
                self.engines.get(c[k]["engine_id"])
        c.update({
            "strategy": strategy, "name": c.get("name") or f"{STRATEGIES[strategy].split(' — ')[0]} experiment",
            "goal": c.get("goal", ""), "color": c.get("color", "both"),
            "ranks": [int(r) for r in (c.get("ranks") or [2, 3, 4, 5]) if int(r) >= 1],
            "rank_weights": c.get("rank_weights") or {},
            "ply_window": [int(x) for x in (c.get("ply_window") or [0, 12])][:2],
            "explore_depth": max(1, int(c.get("explore_depth", 1))),
            "max_candidates": max(1, min(60, int(c.get("max_candidates", 6)))),
            "games_per_candidate": max(0, int(c.get("games_per_candidate", 2))),
            "extra_games": max(0, int(c.get("extra_games", 0))),
            "adaptive_allocation": bool(c.get("adaptive_allocation", True)),
            "filters": {**DEFAULT_FILTERS, **(c.get("filters") or {})},
            "rank_budget": Budget.from_dict(c.get("rank_budget") or {"min_time": 0.2, "max_time": 1.5, "min_depth": 4, "max_depth": 14}).to_dict(),
            "game_budget": Budget.from_dict(c.get("game_budget") or {"min_time": 0.05, "max_time": 0.4, "min_depth": 2, "max_depth": 10}).to_dict(),
            "verify_budget": Budget.from_dict(c.get("verify_budget") or {"min_time": 0.5, "max_time": 4.0, "min_depth": 8, "max_depth": 24}).to_dict(),
            "explorer_policy": c.get("explorer_policy") or {"mode": "best"},
            "adjudication": c.get("adjudication") or {"max_plies": 120},
            "seed": int(c.get("seed", random.randrange(1 << 30))),
            "concurrency": max(1, int(c.get("concurrency", 1))),
            "start": c.get("start") or {},
            "reference_book_id": c.get("reference_book_id"), "export_book_id": c.get("export_book_id"),
            "max_critical": max(0, int(c.get("max_critical", 8))),
        })
        if c["color"] not in ("white", "black", "both"):
            raise ExperimentError("color must be white, black or both")
        self.seeds(c)   # validates the starting material
        return c

    def seeds(self, cfg: dict[str, Any]) -> list[dict[str, Any]]:
        """Starting positions: a FEN, a move list / PGN main line, a catalogued opening, or book positions in a ply range."""
        st = cfg.get("start") or {}
        out: list[dict[str, Any]] = []

        def add(board: chess.Board, label: str) -> None:
            if board.is_game_over():
                return
            out.append({"fen": board.fen(), "start_fen": board.root().fen(), "moves": [m.uci() for m in board.move_stack],
                        "line_san": san_line(board.root(), board.move_stack, 80), "label": label, "ply": len(board.move_stack)})

        if st.get("opening_id"):
            op = find_opening(st["opening_id"])
            if not op:
                raise ExperimentError("Unknown opening")
            b = chess.Board()
            for u in op["uci"]:
                b.push_uci(u)
            add(b, op["name"])
        if st.get("fen"):
            try:
                add(chess.Board(st["fen"]), st.get("label", "Custom position"))
            except ValueError as e:
                raise ExperimentError(f"Invalid FEN: {e}")
        if st.get("moves"):
            b = chess.Board(st["start_fen"]) if st.get("start_fen") else chess.Board()
            toks = st["moves"] if isinstance(st["moves"], list) else str(st["moves"]).replace(".", ". ").split()
            for t in toks:
                if t.rstrip(".").isdigit() or t in ("*", "1-0", "0-1", "1/2-1/2"):
                    continue
                try:
                    b.push(b.parse_uci(t) if (len(t) in (4, 5) and t[1].isdigit()) else b.parse_san(t))
                except ValueError as e:
                    raise ExperimentError(f"Illegal move '{t}' in the starting line: {e}")
            add(b, st.get("label") or (identify(b) or {}).get("name") or "Custom line")
        if st.get("book_id"):
            book = self.books.head(st["book_id"])
            lo, hi = cfg.get("ply_window", [0, 12])
            want = cfg.get("color", "both")
            picked = 0
            for board, ply in book.walk(hi):
                if ply < lo or picked >= int(st.get("max_positions", 12)):
                    continue
                side = "white" if board.turn else "black"
                if want != "both" and side != want:
                    continue
                if book.positions.get(pos_key(board), {}).get("moves"):
                    b = chess.Board(board.fen())
                    add(b, (identify(board) or {}).get("name") or f"Book position (ply {ply})")
                    picked += 1
        if not out:
            add(chess.Board(), "Starting position")
        return out

    # ------------------------------------------------------------------ CRUD
    def create(self, cfg: dict[str, Any]) -> dict[str, Any]:
        c = self.normalize(cfg)
        exp = {"id": new_id("exp"), "name": c["name"], "config": c, "status": "pending", "report": None,
               "stages": {s: {"status": "pending", "summary": "", "output": None, "started_at": None, "finished_at": None}
                          for s in STAGES}, "created_at": now(), "finished_at": None}
        self.db.insert("experiments", exp)
        return exp

    def get(self, eid: str) -> dict[str, Any]:
        e = self.db.get("experiments", eid)
        if not e:
            raise ExperimentError(f"Unknown experiment {eid}")
        return e

    def list(self) -> list[dict[str, Any]]:
        rows = self.db.all("experiments", order="created_at DESC")
        return [{"id": r["id"], "name": r["name"], "status": r["status"], "created_at": r["created_at"],
                 "finished_at": r["finished_at"], "strategy": r["config"]["strategy"],
                 "stages": {k: v["status"] for k, v in r["stages"].items()},
                 "findings": self.db.scalar("SELECT COUNT(*) FROM findings WHERE experiment_id=?", (r["id"],))} for r in rows]

    def view(self, eid: str) -> dict[str, Any]:
        e = self.get(eid)
        job = self.jobs.for_ref(eid)
        return {**e, "findings": self.findings(experiment_id=eid),
                "games": self.db.all("games", "experiment_id=?", (eid,), order="created_at",
                                     cols="id,white,black,result,termination,opening,plies,meta"),
                "job": {"id": job["id"], "status": job["status"], "progress": job["progress"], "error": job["error"]} if job else None,
                "strategies": STRATEGIES}

    def findings(self, experiment_id: str | None = None, status: str | None = None, limit: int = 500) -> list[dict[str, Any]]:
        where, params = [], []
        if experiment_id:
            where.append("experiment_id=?")
            params.append(experiment_id)
        if status:
            where.append("status=?")
            params.append(status)
        return self.db.all("findings", " AND ".join(where), params, order="updated_at DESC", limit=limit)

    def set_finding_status(self, fid: str, status: str, notes: str | None = None) -> dict[str, Any]:
        if status not in scoring.STATUSES:
            raise ExperimentError(f"Unknown status '{status}'")
        upd: dict[str, Any] = {"status": status, "updated_at": now()}
        if notes is not None:
            upd["notes"] = notes
        self.db.update("findings", fid, upd)
        return self.db.get("findings", fid)  # type: ignore[return-value]

    def start(self, eid: str, from_stage: str | None = None) -> dict[str, Any]:
        e = self.get(eid)
        if from_stage:
            if from_stage not in STAGES:
                raise ExperimentError(f"Unknown stage '{from_stage}'")
            i = STAGES.index(from_stage)
            for s in STAGES[i:]:
                e["stages"][s].update({"status": "pending", "output": None, "summary": "", "started_at": None, "finished_at": None})
            self.db.update("experiments", eid, {"stages": e["stages"], "status": "pending", "finished_at": None})
        job = self.jobs.for_ref(eid)
        if job and job["status"] in ("paused", "recovery_required", "failed") and not from_stage:
            self.jobs.resume(job["id"])
        else:
            self.jobs.submit("experiment", eid, {"auto_resume": True}, priority=5)
        self.db.update("experiments", eid, {"status": "running"})
        return self.view(eid)

    def pause(self, eid: str) -> None:
        job = self.jobs.for_ref(eid)
        if job:
            self.jobs.pause(job["id"])

    def cancel(self, eid: str) -> None:
        job = self.jobs.for_ref(eid)
        if job:
            self.jobs.cancel(job["id"])
        self.db.update("experiments", eid, {"status": "canceled"})

    def delete(self, eid: str) -> None:
        self.cancel(eid)
        with self.db.tx():
            self.db.execute("DELETE FROM games WHERE experiment_id=?", (eid,))
            self.db.execute("DELETE FROM findings WHERE experiment_id=?", (eid,))
            self.db.delete("experiments", eid)

    # ------------------------------------------------------------------ pipeline
    def _stage(self, eid: str, name: str, status: str, summary: str = "", output: Any = None) -> None:
        e = self.get(eid)
        st = e["stages"][name]
        st["status"] = status
        if status == "running":
            st["started_at"] = now()
        if status in ("completed", "failed", "skipped", "waiting"):
            st["finished_at"] = now()
        if summary:
            st["summary"] = summary
        if output is not None:
            st["output"] = output
        self.db.update("experiments", eid, {"stages": e["stages"]})
        self.bus.publish(f"experiment:{eid}", "stage", {"stage": name, "status": status, "summary": summary})

    async def _job(self, ctx: JobContext) -> dict[str, Any]:
        eid = ctx.job["ref_id"]
        e = self.get(eid)
        cfg = e["config"]
        self.db.update("experiments", eid, {"status": "running"})
        steps = [self._s1_select, self._s2_analyse, self._s3_games, self._s4_critical, self._s5_verify, self._s6_compare,
                 self._s7_review, self._s8_book, self._s9_approval, self._s10_followup]
        for i, (name, fn) in enumerate(zip(STAGES, steps)):
            if ctx.should_stop():
                break
            cur = self.get(eid)["stages"][name]["status"]
            if cur in ("completed", "skipped", "waiting"):
                continue
            self._stage(eid, name, "running")
            try:
                status, summary, output = await fn(eid, cfg, ctx)
            except EngineError as err:
                self._stage(eid, name, "failed", f"Engine problem: {err}")
                self.db.update("experiments", eid, {"status": "failed"})
                raise
            if ctx.should_stop() and status == "completed" and name in ("tournament_exploration", "deep_verification", "initial_analysis", "critical_positions"):
                # interrupted mid-stage: leave it pending so a resume continues where it stopped
                self._stage(eid, name, "pending", "Interrupted — will continue on resume")
                break
            self._stage(eid, name, status, summary, output)
            ctx.checkpoint({"stage": name}, (i + 1) / len(STAGES))
        if ctx.cancel.is_set() and not ctx.pause_requested:
            self.db.update("experiments", eid, {"status": "canceled"})
            return {"status": "canceled"}
        if ctx.pause_requested:
            self.db.update("experiments", eid, {"status": "paused"})
            return {"status": "paused"}
        self.db.update("experiments", eid, {"status": "completed", "finished_at": now()})
        self.bus.publish(f"experiment:{eid}", "status", {"status": "completed"})
        return {"status": "completed", "findings": len(self.findings(experiment_id=eid))}

    # -- stage 1 --------------------------------------------------------------
    async def _s1_select(self, eid: str, cfg: dict[str, Any], ctx: JobContext) -> tuple[str, str, Any]:
        seeds = self.seeds(cfg)
        want = cfg["color"]
        usable = [s for s in seeds if want == "both" or (chess.Board(s["fen"]).turn == chess.WHITE) == (want == "white")]
        skipped = len(seeds) - len(usable)
        plan = {"seeds": usable, "strategy": cfg["strategy"], "strategy_label": STRATEGIES[cfg["strategy"]],
                "ranks": self._ranks_for(cfg), "ply_window": cfg["ply_window"], "filters": cfg["filters"],
                "scheduler_seed": cfg["seed"], "skipped_wrong_side": skipped}
        if not usable:
            return "failed", f"No seed position has {want} to move — nothing to explore", plan
        return "completed", f"{len(usable)} seed position(s); strategy: {plan['strategy_label']}", plan

    def _ranks_for(self, cfg: dict[str, Any]) -> list[int]:
        s = cfg["strategy"]
        if s in FIXED_RANK:
            return [FIXED_RANK[s]]
        if s == "deep_alternative":
            return [6, 7, 8, 9, 10]
        if s == "mixed":
            return sorted(set(cfg["ranks"]))
        return [2, 3, 4, 5, 6]

    # -- stage 2 --------------------------------------------------------------
    async def _s2_analyse(self, eid: str, cfg: dict[str, Any], ctx: JobContext) -> tuple[str, str, Any]:
        plan = self.get(eid)["stages"]["candidate_selection"]["output"]
        budget = Budget.from_dict(cfg["rank_budget"])
        ranks = plan["ranks"]
        need = max(ranks) if cfg["strategy"] in FIXED_RANK or cfg["strategy"] in ("mixed", "deep_alternative") else 8
        ref = self.books.head(cfg["reference_book_id"]) if cfg.get("reference_book_id") else None
        rng = random.Random(cfg["seed"])
        f = cfg["filters"]
        queue: list[dict[str, Any]] = [{**s, "depth": 1} for s in plan["seeds"]]
        rankings, rejected, created = [], [], 0
        existing = {(x["epd"], x["move_uci"]) for x in self.findings(experiment_id=eid)}
        async with self.engines.session(EngineSpec.from_dict(cfg["explorer_a"]), "research", "Discovery ranker") as h:
            while queue and created < cfg["max_candidates"] and not ctx.should_stop():
                seed = queue.pop(0)
                board = chess.Board(seed["start_fen"])
                for u in seed["moves"]:
                    board.push_uci(u)
                ranked = await ranked_candidates(h, board, min(need, board.legal_moves.count()), budget, cancel=ctx.cancel)
                if ranked.get("stop_reason") in ("cancelled", "engine_failed"):
                    break
                self.cache.store(board, ranked, len(ranked["candidates"]))
                cands = ranked["candidates"]
                rec = {"fen": board.fen(), "label": seed["label"], "depth": ranked.get("depth"), "method": ranked["method"],
                       "available": len(cands), "requested": need, "legal": ranked["legal_count"],
                       "candidates": [{"rank": c["rank"], "san": c["san"], "move": c["move"], "score": c["score"]["text"],
                                       "expected_loss": c["loss"]["expected_loss"]} for c in cands], "missing_ranks": []}
                picks = self._pick(cfg, board, cands, ranks, ref, rng, rec)
                best = Score.from_dict(cands[0]["score"]) if cands else Score()
                for c in picks:
                    if created >= cfg["max_candidates"]:
                        break
                    mv = chess.Move.from_uci(c["move"])
                    verdict = self._viable(board, mv, c, best, f)
                    if verdict:
                        rejected.append({"fen": board.fen(), "san": c["san"], "rank": c["rank"], "reason": verdict})
                        continue
                    if (pos_key(board), c["move"]) in existing:
                        continue
                    existing.add((pos_key(board), c["move"]))
                    self._create_finding(eid, cfg, board, seed, c, ranked, ref)
                    created += 1
                    if seed["depth"] < cfg["explore_depth"] and len(seed["moves"]) + 2 <= cfg["ply_window"][1]:
                        nb = board.copy()
                        nb.push(mv)
                        reply = await adaptive_search(h, nb, budget.scaled(0.5), multipv=1, cancel=ctx.cancel)
                        if reply["lines"]:
                            nb.push_uci(reply["lines"][0]["move"])
                            queue.append({"fen": nb.fen(), "start_fen": seed["start_fen"],
                                          "moves": [m.uci() for m in nb.move_stack] if nb.root().fen() == seed["start_fen"]
                                          else seed["moves"] + [mv.uci(), reply["lines"][0]["move"]],
                                          "line_san": seed["line_san"] + [c["san"], reply["lines"][0]["san"]],
                                          "label": seed["label"], "ply": seed["ply"] + 2, "depth": seed["depth"] + 1})
                rankings.append(rec)
        out = {"rankings": rankings, "rejected": rejected, "created": created,
               "note": "Ranks are evidence at the stated depth and budget; verification may reorder them."}
        if not created:
            return "completed", "No candidate passed the viability filters", out
        return "completed", f"{created} candidate(s) from {len(rankings)} ranked position(s); {len(rejected)} filtered out", out

    def _pick(self, cfg: dict[str, Any], board: chess.Board, cands: list[dict[str, Any]], ranks: list[int], ref: Any,
              rng: random.Random, rec: dict[str, Any]) -> list[dict[str, Any]]:
        s = cfg["strategy"]
        by_rank = {c["rank"]: c for c in cands}
        if s in FIXED_RANK or s == "deep_alternative":
            got = [by_rank[r] for r in ranks if r in by_rank]
            rec["missing_ranks"] = [r for r in ranks if r not in by_rank]
            return got if s in FIXED_RANK else got[:3]
        if s == "mixed":
            avail = [r for r in ranks if r in by_rank]
            rec["missing_ranks"] = [r for r in ranks if r not in by_rank]
            if not avail:
                return []
            w = [float(cfg["rank_weights"].get(str(r), cfg["rank_weights"].get(r, 1.0))) for r in avail]
            k = min(len(avail), 2)
            chosen: list[int] = []
            pool, weights = avail[:], w[:]
            for _ in range(k):
                r = rng.choices(pool, weights=weights, k=1)[0]
                i = pool.index(r)
                pool.pop(i)
                weights.pop(i)
                chosen.append(r)
            rec["sampled_ranks"] = chosen
            return [by_rank[r] for r in sorted(chosen)]
        alts = [c for c in cands if c["rank"] >= 2]
        node = ref.node(board) if ref else None
        book_moves = (node or {}).get("moves", {})
        total = sum(m["weight"] for m in book_moves.values()) or 1.0
        share = lambda c: (book_moves[c["move"]]["weight"] / total) if c["move"] in book_moves else 0.0
        if s == "novelty":
            return [c for c in alts if c["move"] not in book_moves][:3]
        if s == "surprise":
            return sorted([c for c in alts if share(c) < 0.10], key=lambda c: (c["loss"]["expected_loss"], c["rank"]))[:3]
        if s == "counter_repertoire":
            if not book_moves:
                return []
            main = max(book_moves.items(), key=lambda kv: kv[1]["weight"])[0]
            return [c for c in cands if c["move"] != main][:3]
        if s == "transposition":
            out = []
            for c in alts:
                b = board.copy(stack=False)
                b.push_uci(c["move"])
                if c["move"] not in book_moves and ref and ref.positions.get(pos_key(b), {}).get("moves"):
                    out.append(c)
                elif identify(b) and not (node and c["move"] in book_moves) and (identify(b) or {}).get("transposed"):
                    out.append(c)
            return out[:3]
        if s == "anti_preparation":
            def leaves_book(c: dict[str, Any]) -> bool:
                b = board.copy(stack=False)
                b.push_uci(c["move"])
                return not (ref and ref.positions.get(pos_key(b), {}).get("moves"))
            return sorted([c for c in alts if leaves_book(c)], key=lambda c: c["loss"]["expected_loss"])[:3]
        if s == "trap":
            from ..chessx import tactical_complexity

            def cx(c: dict[str, Any]) -> float:
                b = board.copy(stack=False)
                b.push_uci(c["move"])
                return tactical_complexity(b)
            return sorted(alts, key=lambda c: -cx(c))[:3]
        return alts[:2]

    def _viable(self, board: chess.Board, mv: chess.Move, c: dict[str, Any], best: Score, f: dict[str, Any]) -> str | None:
        s = Score.from_dict(c["score"])
        loss = c["loss"]
        if mv not in board.legal_moves:
            return "not a legal move"
        if f["exclude_mate_risk"] and loss["walks_into_mate"]:
            return "allows a forced mate"
        if loss["expected_loss"] > f["max_expected_loss"]:
            return f"expected-score loss {loss['expected_loss']:.3f} exceeds {f['max_expected_loss']}"
        if loss["cp_loss"] is not None and f.get("max_cp_loss") and loss["cp_loss"] > f["max_cp_loss"]:
            return f"{loss['cp_loss']} cp worse than the best move (limit {f['max_cp_loss']})"
        if s.expected() < f["min_expected"]:
            return f"evaluation {s.text()} below the minimum threshold"
        if f.get("min_complexity"):
            from ..chessx import tactical_complexity
            b = board.copy(stack=False)
            b.push(mv)
            if tactical_complexity(b) < f["min_complexity"]:
                return "below the minimum tactical complexity"
        return None

    def _create_finding(self, eid: str, cfg: dict[str, Any], board: chess.Board, seed: dict[str, Any], c: dict[str, Any],
                        ranked: dict[str, Any], ref: Any) -> str:
        mv = chess.Move.from_uci(c["move"])
        node = ref.node(board) if ref else None
        book_moves = (node or {}).get("moves", {})
        total = sum(m["weight"] for m in book_moves.values()) or 1.0
        fid = new_id("find")
        root = chess.Board(seed["start_fen"])
        line = numbered(root, seed["line_san"] + [c["san"]])
        ranking = {"original_rank": c["rank"], "ranking_engine": ranked["engine"], "ranking_engine_sig": ranked["engine_sig"],
                   "ranking_depth": c.get("depth"), "ranking_budget": ranked["budget"], "ranking_method": ranked["method"],
                   "original_score": c["score"], "original_loss": c["loss"], "legal_moves": ranked["legal_count"],
                   "verification_rank": None, "verification_score": None, "rank_stability": None, "evaluation_change": None}
        evidence = {"seed": {"label": seed["label"], "start_fen": seed["start_fen"], "moves": seed["moves"]},
                    "strategy": cfg["strategy"], "pv_san": c["pv_san"], "book": {"reference": bool(ref), "in_book": c["move"] in book_moves,
                                                                             "position_known": bool(book_moves),
                                                                             "share": round(book_moves[c["move"]]["weight"] / total, 4) if c["move"] in book_moves else 0.0},
                    "games": [], "critical": [], "verification": None, "validator": None, "replies": None, "trap": None,
                    "opening": identify(board), "motifs": motifs_after(board, mv)}
        self.db.insert("findings", {"id": fid, "experiment_id": eid, "epd": pos_key(board), "fen": board.fen(),
                                    "move_uci": c["move"], "move_san": c["san"], "line_san": line,
                                    "category": "requires_deeper_investigation", "status": "discovered", "scores": {},
                                    "ranking": ranking, "evidence": evidence, "notes": "", "created_at": now(), "updated_at": now()})
        self.db.link("finding", fid, "experiment", eid, "discovered_in")
        self.bus.publish(f"experiment:{eid}", "finding", {"id": fid, "san": c["san"], "line": line, "rank": c["rank"]})
        return fid

    # -- stage 3 --------------------------------------------------------------
    def _policy(self, cfg: dict[str, Any], candidate_side: bool, root_plies: int):
        pol = cfg["explorer_policy"]
        if pol.get("mode") != "rank":
            return None
        rank = max(2, int(pol.get("rank", 2)))
        until = int(pol.get("until_ply", cfg["ply_window"][1]))
        max_loss = float(pol.get("max_expected_loss", cfg["filters"]["max_expected_loss"]))
        budget = Budget.from_dict(cfg["game_budget"])

        async def policy(board: chess.Board, ply: int, h: EngineHandle, side: str) -> dict[str, Any] | None:
            if (board.turn == chess.WHITE) != candidate_side or ply >= until:
                return None      # alternative moves are forced only for the exploring side inside the opening window
            ranked = await ranked_candidates(h, board, rank, budget)
            cands = ranked["candidates"]
            pick = next((c for c in cands if c["rank"] == rank), None)
            if pick is None or pick["loss"]["expected_loss"] > max_loss or pick["loss"]["walks_into_mate"]:
                return None
            return {"move": chess.Move.from_uci(pick["move"]), "line": pick, "forced_rank": rank}

        return policy

    async def _s3_games(self, eid: str, cfg: dict[str, Any], ctx: JobContext) -> tuple[str, str, Any]:
        finds = [f for f in self.findings(experiment_id=eid) if f["status"] != "rejected"]
        if not finds or cfg["games_per_candidate"] == 0:
            return "skipped", "No test games requested" if finds else "No candidates to test", {"games": 0}
        specs = {"A": EngineSpec.from_dict(cfg["explorer_a"]), "B": EngineSpec.from_dict(cfg["explorer_b"])}
        names = {"A": "Explorer A · " + self.engines.get(specs["A"].engine_id)["name"],
                 "B": "Explorer B · " + self.engines.get(specs["B"].engine_id)["name"]}
        todo: list[tuple[dict[str, Any], int, str]] = []
        for f in finds:
            have = len(f["evidence"]["games"])
            for g in range(have, cfg["games_per_candidate"]):
                todo.append((f, g, "base allocation"))
        sem = asyncio.Semaphore(cfg["concurrency"])
        played = 0

        async def run(f: dict[str, Any], g: int, reason: str) -> None:
            nonlocal played
            async with sem:
                if ctx.should_stop():
                    return
                board = chess.Board(f["fen"])
                cand_white = board.turn == chess.WHITE
                # mirrored pairs: A takes the candidate side in even games, B in odd games
                cand_engine = "A" if g % 2 == 0 else "B"
                other = "B" if cand_engine == "A" else "A"
                white, black = (cand_engine, other) if cand_white else (other, cand_engine)
                seed = f["evidence"]["seed"]
                spec = GameSpec(white=specs[white], black=specs[black], white_name=names[white], black_name=names[black],
                                start_fen=seed["start_fen"], opening_moves=seed["moves"] + [f["move_uci"]],
                                opening_name=f["line_san"], time={"mode": "noflag", "budget": cfg["game_budget"]},
                                adjudication=cfg["adjudication"], purpose="research",
                                headers={"Event": cfg["name"], "Round": str(g + 1)})

                def on_move(ev: dict[str, Any]) -> None:
                    self.bus.publish(f"experiment:{eid}", "move", {"finding": f["id"], "game": g, "fen": ev["fen_after"],
                                                                    "san": ev["san"], "uci": ev["uci"], "text": ev["text"],
                                                                    "white": names[white], "black": names[black], "line": f["line_san"]})

                rec = await play_game(self.engines, spec, on_move=on_move, cancel=ctx.cancel,
                                      policy=self._policy(cfg, cand_white, len(seed["moves"]) + 1))
                if not rec["finished"]:
                    return
                gid = new_id("game")
                summ = scoring.game_summary(rec["evals"], cand_white, rec["result"])
                with self.db.tx():
                    self.db.insert("games", {"id": gid, "kind": "discovery", "white": rec["white"], "black": rec["black"],
                                             "result": rec["result"], "termination": rec["termination"], "pgn": rec["pgn"],
                                             "start_fen": rec["start_fen"], "opening": f["line_san"], "eco": None,
                                             "plies": rec["plies"], "tournament_id": None, "experiment_id": eid,
                                             "meta": {"evals": rec["evals"], "finding_id": f["id"], "candidate_engine": cand_engine,
                                                      "policy_log": rec["policy_log"], "allocation": reason,
                                                      "detail": rec["detail"]}, "created_at": now(), "finished_at": now()})
                    cur = self.db.get("findings", f["id"])
                    cur["evidence"]["games"].append({"game_id": gid, "result": rec["result"], "termination": rec["termination"],
                                                     "candidate_engine": cand_engine, "allocation": reason, **summ})
                    self.db.update("findings", f["id"], {"evidence": cur["evidence"], "status": "tournament_testing",
                                                         "updated_at": now()})
                    self.db.link("finding", f["id"], "game", gid, "tested_in")
                played += 1
                self.bus.publish(f"experiment:{eid}", "game", {"finding": f["id"], "game_id": gid, "result": rec["result"]})

        await asyncio.gather(*(run(*t) for t in todo))
        extra_log = []
        if cfg["adaptive_allocation"] and cfg["extra_games"] and not ctx.should_stop():
            # Spend the extra budget where the outcome is most uncertain among still-plausible candidates.
            scored = []
            for f in self.findings(experiment_id=eid):
                gs = f["evidence"]["games"]
                pts = [g["points"] for g in gs if g.get("points") is not None]
                if not pts or f["ranking"]["original_loss"]["expected_loss"] > cfg["filters"]["max_expected_loss"] * 0.8:
                    continue
                w, d, l = pts.count(1.0), pts.count(0.5), pts.count(0.0)
                s = wdl_summary(w, d, l)
                scored.append(((s["score_high"] - s["score_low"]) * (1 - abs(s["score"] - 0.5)), f, s))
            scored.sort(key=lambda x: -x[0])
            extra: list[tuple[dict[str, Any], int, str]] = []
            budget_left = cfg["extra_games"]
            for unc, f, s in scored:
                if budget_left <= 0:
                    break
                n = min(2, budget_left)
                base = len(f["evidence"]["games"])
                for k in range(n):
                    extra.append((f, base + k, f"adaptive: uncertainty {unc:.2f}"))
                budget_left -= n
                extra_log.append({"line": f["line_san"], "extra_games": n, "uncertainty": round(unc, 3)})
            await asyncio.gather(*(run(*t) for t in extra))
        total = self.db.scalar("SELECT COUNT(*) FROM games WHERE experiment_id=?", (eid,))
        return "completed", f"{played} game(s) played this run ({total} stored)", {"games": total, "played_now": played,
                                                                                   "adaptive_allocation": extra_log,
                                                                                   "scheduler_seed": cfg["seed"],
                                                                                   "time_policy": "no-flag research budgets"}

    # -- stage 4 --------------------------------------------------------------
    async def _s4_critical(self, eid: str, cfg: dict[str, Any], ctx: JobContext) -> tuple[str, str, Any]:
        games = self.db.all("games", "experiment_id=?", (eid,))
        if not games or cfg["max_critical"] == 0:
            return "skipped", "No games to mine", {"positions": 0}
        raw = []
        for g in games:
            evs = g["meta"].get("evals", [])
            for a, b in zip(evs, evs[1:]):
                if a.get("expected_white") is None or b.get("expected_white") is None:
                    continue
                swing = b["expected_white"] - a["expected_white"]
                # the side that just moved (b) lost expected score
                mover_white = b["side"] == "w"
                drop = -swing if mover_white else swing
                if drop >= 0.12:
                    raw.append({"game_id": g["id"], "finding_id": g["meta"].get("finding_id"), "ply": b["ply"],
                                "fen": b["fen_before"], "played": b["uci"], "played_san": b["san"], "drop": round(drop, 3),
                                "mover": "white" if mover_white else "black"})
        raw.sort(key=lambda x: -x["drop"])
        seen, picked = set(), []
        for r in raw:
            k = pos_key(chess.Board(r["fen"]))
            if k not in seen:
                seen.add(k)
                picked.append(r)
            if len(picked) >= cfg["max_critical"]:
                break
        if not picked:
            return "completed", "No large evaluation swings in the test games", {"positions": 0, "items": []}
        budget = Budget.from_dict(cfg["verify_budget"]).scaled(0.5)
        items = []
        async with self.engines.session(EngineSpec.from_dict(cfg["observer"]), "research", "Observer") as h:
            for r in picked:
                if ctx.should_stop():
                    break
                board = chess.Board(r["fen"])
                ver = await evaluate_move(h, board, chess.Move.from_uci(r["played"]), budget, multipv=3, cancel=ctx.cancel)
                if ver.get("loss") is None:
                    continue
                missed = ver["loss"]["expected_loss"] >= 0.12 and ver["best_move"] != r["played"]
                item = {**r, "observer_best": ver["best_san"], "observer_best_uci": ver["best_move"],
                        "observer_loss": ver["loss"]["expected_loss"], "observer_depth": ver["depth"],
                        "kind": "missed_opportunity" if missed else "evaluation_swing_not_confirmed",
                        "motifs": motifs_after(board, chess.Move.from_uci(ver["best_move"])) if ver.get("best_move") else []}
                items.append(item)
                if r["finding_id"]:
                    cur = self.db.get("findings", r["finding_id"])
                    if cur:
                        cur["evidence"]["critical"].append(item)
                        self.db.update("findings", r["finding_id"], {"evidence": cur["evidence"], "updated_at": now()})
        confirmed = sum(1 for i in items if i["kind"] == "missed_opportunity")
        return "completed", f"{len(items)} critical position(s) reviewed by the observer; {confirmed} confirmed mistakes", \
            {"positions": len(items), "items": items}

    # -- stage 5 --------------------------------------------------------------
    async def _s5_verify(self, eid: str, cfg: dict[str, Any], ctx: JobContext) -> tuple[str, str, Any]:
        finds = [f for f in self.findings(experiment_id=eid) if not f["evidence"].get("verification")]
        if not finds:
            return "completed", "Nothing left to verify", {"verified": 0}
        budget = Budget.from_dict(cfg["verify_budget"])
        weak_budget = Budget.from_dict(cfg["game_budget"])
        done = 0
        async with self.engines.session(EngineSpec.from_dict(cfg["observer"]), "research", "Observer") as obs:
            weak = await self.engines.open(EngineSpec.from_dict(cfg["explorer_b"]), "research", "Explorer B (reply probe)")
            val = await self.engines.open(EngineSpec.from_dict(cfg["validator"]), "research", "Validator") if cfg.get("validator") else None
            try:
                for f in finds:
                    if ctx.should_stop():
                        break
                    self.db.update("findings", f["id"], {"status": "under_analysis", "updated_at": now()})
                    board = chess.Board(f["fen"])
                    mv = chess.Move.from_uci(f["move_uci"])
                    window = max(5, f["ranking"]["original_rank"])
                    ver = await evaluate_move(obs, board, mv, budget, multipv=window, cancel=ctx.cancel)
                    if ver.get("loss") is None:
                        continue
                    ev = f["evidence"]
                    ev["verification"] = {k: ver[k] for k in ("engine", "engine_sig", "depth", "rank", "rank_exact", "score", "loss",
                                                              "best_move", "best_san", "best_score", "stop_reason", "window")}
                    ev["verification"]["pv_san"] = ver.get("pv_san", [])
                    ev["verification"]["top"] = [{"rank": t["rank"], "san": t["san"], "score": t["score"]["text"]} for t in ver["top"]]
                    if val is not None:
                        v2 = await evaluate_move(val, board, mv, budget, multipv=window, cancel=ctx.cancel)
                        if v2.get("loss") is not None:
                            ev["validator"] = {k: v2[k] for k in ("engine", "engine_sig", "depth", "rank", "rank_exact", "score", "loss",
                                                                  "best_san", "stop_reason")}
                    # opponent's task after the candidate
                    after = board.copy(stack=False)
                    after.push(mv)
                    if not after.is_game_over():
                        rep = await ranked_candidates(obs, after, 4, budget.scaled(0.6), cancel=ctx.cancel)
                        ev["replies"] = {"depth": rep.get("depth"), "lines": [{"san": c["san"], "move": c["move"], "score": c["score"],
                                                                               "rank": c["rank"]} for c in rep["candidates"]]}
                        ev["trap"] = await self._find_trap(obs, weak, after, rep, weak_budget, budget, ctx)
                    r = f["ranking"]
                    r["verification_rank"] = ver["rank"]
                    r["verification_rank_exact"] = ver["rank_exact"]
                    r["verification_score"] = ver["score"]
                    r["verification_engine"] = ver["engine"]
                    r["verification_depth"] = ver["depth"]
                    r["rank_stability"] = None if ver["rank"] is None else ver["rank"] - r["original_rank"]
                    o, n = Score.from_dict(r["original_score"]), Score.from_dict(ver["score"])
                    r["evaluation_change"] = {"expected": round(n.expected() - o.expected(), 4),
                                              "cp": (n.cp - o.cp) if (n.cp is not None and o.cp is not None) else None,
                                              "from": o.text(), "to": n.text()}
                    self.db.update("findings", f["id"], {"evidence": ev, "ranking": r, "status": "needs_verification",
                                                         "updated_at": now()})
                    done += 1
                    self.bus.publish(f"experiment:{eid}", "verified", {"finding": f["id"], "rank": ver["rank"]})
            finally:
                await weak.close()
                if val is not None:
                    await val.close()
        return "completed", f"{done} candidate(s) independently verified", {"verified": done,
                                                                            "observer": self.engines.get(cfg["observer"]["engine_id"])["name"],
                                                                            "validator": bool(cfg.get("validator"))}

    async def _find_trap(self, obs: EngineHandle, weak: EngineHandle, after: chess.Board, deep: dict[str, Any],
                         weak_budget: Budget, budget: Budget, ctx: JobContext) -> dict[str, Any] | None:
        """A trap exists when a move the *weak* engine likes (its top two replies) is judged a serious
        error by the observer.  The punishment is then verified by the observer as well."""
        shallow = await ranked_candidates(weak, after, 2, weak_budget, cancel=ctx.cancel)
        if not shallow["candidates"] or not deep["candidates"]:
            return None
        deep_best = Score.from_dict(deep["candidates"][0]["score"])
        for c in shallow["candidates"]:
            mv = chess.Move.from_uci(c["move"])
            known = next((d for d in deep["candidates"] if d["move"] == c["move"]), None)
            if known:
                loss = loss_between(deep_best, Score.from_dict(known["score"]))["expected_loss"]
            else:
                res = await adaptive_search(obs, after, budget.scaled(0.5), multipv=1, root_moves=[mv], cancel=ctx.cancel)
                if not res["lines"]:
                    continue
                loss = loss_between(deep_best, Score.from_dict(res["lines"][0]["score"]))["expected_loss"]
            if loss < 0.12:
                continue
            b2 = after.copy(stack=False)
            san = after.san(mv)
            b2.push(mv)
            pun = await adaptive_search(obs, b2, budget.scaled(0.6), multipv=2, cancel=ctx.cancel)
            if not pun["lines"]:
                continue
            p = pun["lines"][0]
            unique = len(pun["lines"]) < 2 or loss_between(Score.from_dict(p["score"]), Score.from_dict(pun["lines"][1]["score"]))["expected_loss"] >= 0.08
            return {"fen": after.fen(), "tempting": c["move"], "tempting_san": san, "weak_rank": c["rank"],
                    "weak_engine": weak.name, "loss": round(loss, 3), "punish": p["move"], "punish_san": p["san"],
                    "punish_pv": p["pv_san"][:8], "punish_score": p["score"], "fen_after_mistake": b2.fen(),
                    "unique_punishment": unique, "depends_on_opponent_error": True,
                    "best_defence": deep["candidates"][0]["san"], "motifs": motifs_after(b2, chess.Move.from_uci(p["move"]))}
        return None

    # -- stage 6 --------------------------------------------------------------
    async def _s6_compare(self, eid: str, cfg: dict[str, Any], ctx: JobContext) -> tuple[str, str, Any]:
        finds = self.findings(experiment_id=eid)
        table = []
        for f in finds:
            scores, cat = self.score_finding(f, cfg)
            self.db.update("findings", f["id"], {"scores": scores, "category": cat["category"],
                                                 "status": cat["status"] if f["status"] != "approved" else "approved",
                                                 "evidence": {**f["evidence"], "category_reasons": cat["reasons"]},
                                                 "updated_at": now()})
            table.append({"id": f["id"], "line": f["line_san"], "category": cat["category"], "status": cat["status"],
                          **{k: v["value"] for k, v in scores.items()}})
        return "completed", f"{len(table)} candidate(s) scored on seven separate dimensions", {"table": table}

    def score_finding(self, f: dict[str, Any], cfg: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        ev, r = f["evidence"], f["ranking"]
        board = chess.Board(f["fen"])
        mv = chess.Move.from_uci(f["move_uci"])
        after = board.copy(stack=False)
        after.push(mv)
        prior = self.db.scalar("SELECT COUNT(*) FROM findings WHERE epd=? AND move_uci=? AND id<>?", (f["epd"], f["move_uci"], f["id"])) or 0
        bk = ev.get("book") or {}
        s: dict[str, Any] = {}
        s["objective_viability"] = scoring.objective_viability(ev.get("verification"), ev.get("validator"), r.get("original_loss"))
        s["practical_difficulty"] = scoring.practical_difficulty(ev.get("replies"), ev.get("trap"))
        s["novelty_in_database"] = scoring.novelty_in_database(bk.get("share"), bool(bk.get("in_book")), bool(bk.get("position_known")),
                                                               int(prior), bool(bk.get("reference")))
        s["tactical_potential"] = scoring.tactical_potential(after, ev.get("games", []), ev.get("trap"))
        s["strategic_coherence"] = scoring.strategic_coherence(board, mv, ev.get("games", []))
        s["research_confidence"] = scoring.research_confidence(ev.get("verification"), ev.get("validator"), len(ev.get("games", [])),
                                                               r.get("original_rank"), int(cfg["verify_budget"]["min_depth"]) + 4)
        s["training_value"] = scoring.training_value(s["objective_viability"]["value"], s["practical_difficulty"]["value"],
                                                     s["tactical_potential"]["value"], ev.get("trap"))
        ident = identify(after)
        transposes = ident["name"] if (ident and ident.get("transposed") and cfg["strategy"] == "transposition") else None
        ver = ev.get("verification")
        was_worse = bool(ver and Score.from_dict(ver["best_score"]).expected() < 0.40)
        cat = scoring.categorize(s, trap=ev.get("trap"), transposes_to=transposes,
                                 is_pawn_break="pawn_break" in (ev.get("motifs") or []), was_worse=was_worse, verification=ver)
        return s, cat

    # -- stage 7 --------------------------------------------------------------
    async def _s7_review(self, eid: str, cfg: dict[str, Any], ctx: JobContext) -> tuple[str, str, Any]:
        report = self.build_report(eid)
        self.db.update("experiments", eid, {"report": report})
        return "completed", f"{len(report['promising'])} promising, {len(report['refuted'])} refuted, " \
                            f"{len(report['uncertain'])} uncertain", {"summary": report["headline"]}

    def build_report(self, eid: str) -> dict[str, Any]:
        e = self.get(eid)
        finds = self.findings(experiment_id=eid)
        g = lambda f, k: (f["scores"].get(k) or {}).get("value", 0)

        def brief(f: dict[str, Any]) -> dict[str, Any]:
            gs = f["evidence"].get("games", [])
            pts = [x["points"] for x in gs if x.get("points") is not None]
            res = wdl_summary(pts.count(1.0), pts.count(0.5), pts.count(0.0)) if pts else None
            return {"id": f["id"], "line": f["line_san"], "san": f["move_san"], "fen": f["fen"], "category": f["category"],
                    "status": f["status"], "original_rank": f["ranking"]["original_rank"],
                    "verification_rank": f["ranking"].get("verification_rank"),
                    "evaluation": (f["ranking"].get("verification_score") or f["ranking"]["original_score"])["text"],
                    "scores": {k: v["value"] for k, v in f["scores"].items()}, "games": res,
                    "reasons": f["evidence"].get("category_reasons", [])}

        promising = sorted([f for f in finds if f["status"] in ("promising", "repertoire_candidate", "approved")],
                           key=lambda f: -(g(f, "objective_viability") * 0.6 + g(f, "research_confidence") * 0.4))
        traps = sorted([f for f in finds if f["evidence"].get("trap")], key=lambda f: -g(f, "training_value"))
        refuted = [f for f in finds if f["category"] == "clearly_refuted"]
        uncertain = [f for f in finds if f["category"] == "requires_deeper_investigation" or f["status"] in ("needs_verification", "revisit_later")]
        next_steps = []
        for f in uncertain[:4]:
            next_steps.append({"action": "verify_deeper", "finding_id": f["id"],
                               "text": f"Verify {f['line_san']} with a larger budget (confidence {g(f, 'research_confidence'):.2f}).",
                               "config_patch": {"start": {"fen": f["fen"]}, "strategy": cfg_rank_strategy(f["ranking"]["original_rank"]),
                                                "verify_budget": {"max_time": e["config"]["verify_budget"]["max_time"] * 3}}})
        for f in promising[:4]:
            n = len(f["evidence"].get("games", []))
            if n < 12:
                next_steps.append({"action": "more_games", "finding_id": f["id"],
                                   "text": f"Play more test games from {f['line_san']} — only {n} so far, far too few for a statistical claim."})
            after = chess.Board(f["fen"])
            after.push_uci(f["move_uci"])
            reps = (f["evidence"].get("replies") or {}).get("lines") or []
            if reps:
                after.push_uci(reps[0]["move"])
                next_steps.append({"action": "explore_deeper", "finding_id": f["id"],
                                   "text": f"Explore alternatives one move deeper after {f['line_san']} {reps[0]['san']}.",
                                   "config_patch": {"start": {"fen": after.fen()}}})
        total_games = self.db.scalar("SELECT COUNT(*) FROM games WHERE experiment_id=?", (eid,)) or 0
        return {
            "generated_at": now(), "name": e["name"], "strategy": STRATEGIES[e["config"]["strategy"]],
            "headline": f"{len(finds)} candidate(s) investigated in {total_games} game(s): {len(promising)} promising, "
                        f"{len(traps)} with a verified trap, {len(refuted)} refuted.",
            "most_promising": [brief(f) for f in promising[:6]], "promising": [f["id"] for f in promising],
            "strongest_verification": [brief(f) for f in sorted(finds, key=lambda f: -g(f, "research_confidence"))[:4]],
            "highest_surprise": [brief(f) for f in sorted(finds, key=lambda f: -(g(f, "practical_difficulty") * g(f, "objective_viability")))[:4]],
            "instructive_traps": [{**brief(f), "trap": f["evidence"]["trap"]} for f in traps[:5]],
            "refuted": [brief(f) for f in refuted], "uncertain": [brief(f) for f in uncertain],
            "next_experiments": next_steps[:8],
            "caveats": ["Rankings and evaluations are evidence at the recorded depths and budgets, not permanent truths.",
                        "A handful of test games cannot establish that a line is sound; verification scores carry more weight than results.",
                        "'Novelty' means new to this research collection and reference book only."],
            "method": {"explorers": [e["config"]["explorer_a"], e["config"]["explorer_b"]], "observer": e["config"]["observer"],
                       "validator": e["config"]["validator"], "seed": e["config"]["seed"], "filters": e["config"]["filters"],
                       "budgets": {k: e["config"][k] for k in ("rank_budget", "game_budget", "verify_budget")}},
        }

    # -- stages 8-10 -----------------------------------------------------------
    async def _s8_book(self, eid: str, cfg: dict[str, Any], ctx: JobContext) -> tuple[str, str, Any]:
        book_id = cfg.get("export_book_id")
        finds = [f for f in self.findings(experiment_id=eid) if f["status"] in ("promising", "repertoire_candidate", "approved", "rejected")]
        if not book_id:
            return "skipped", "No target book selected — findings stay in the research database", {"proposals": 0}
        props = self.books.propose_from_findings(book_id, finds)
        mine = [p for p in props if p["state"] == "pending" and p.get("finding_id") in {f["id"] for f in finds}]
        return "completed", f"{len(mine)} pending proposal(s) for the target book", {"proposals": len(mine), "book_id": book_id}

    async def _s9_approval(self, eid: str, cfg: dict[str, Any], ctx: JobContext) -> tuple[str, str, Any]:
        pending = len([f for f in self.findings(experiment_id=eid) if f["status"] in ("promising", "repertoire_candidate")])
        return "waiting", f"{pending} finding(s) await your review — nothing enters a book without approval", {"pending": pending}

    async def _s10_followup(self, eid: str, cfg: dict[str, Any], ctx: JobContext) -> tuple[str, str, Any]:
        rep = self.get(eid).get("report") or {}
        steps = rep.get("next_experiments", [])
        return "completed", f"{len(steps)} suggested follow-up experiment(s)", {"suggestions": steps}

    # ------------------------------------------------------------------ quick tools
    async def quick_rank(self, engine: EngineSpec, fen: str, n: int, budget: Budget, moves: list[str] | None = None) -> dict[str, Any]:
        """Interactive 'explore alternatives' for one position (Analysis board / tree context menu)."""
        board = chess.Board(fen)
        for u in moves or []:
            board.push_uci(u)
        async with self.engines.session(engine, "interactive", "Ranked candidates") as h:
            res = await ranked_candidates(h, board, n, budget)
        self.cache.store(board, res, len(res["candidates"]))
        return res


def cfg_rank_strategy(rank: int) -> str:
    return {2: "second_best", 3: "third_best", 4: "fourth_best", 5: "fifth_best"}.get(rank, "deep_alternative" if rank >= 6 else "second_best")

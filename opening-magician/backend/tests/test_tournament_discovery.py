"""Tournaments and discovery experiments run for real against UCI subprocesses."""
import asyncio

import chess
import pytest

from conftest import FAST, GAME, fixture_engine
from om import openings
from om.chessx import read_games
from om.discovery.experiment import STAGES, DiscoveryLab
from om.engines.manager import EngineSpec
from om.tournament.manager import TournamentManager
from om.tournament.runner import GameSpec, play_game

NOFLAG = {"mode": "noflag", "budget": GAME}
ADJ = {"max_plies": 24}


def players(engines, n):
    return [{"name": f"E{i}", "engine": {"engine_id": engines.bundled_id, "options": {"Seed": i + 1, "Skill Level": 20 - 4 * i}}} for i in range(n)]


async def run(jobs, ref_id, timeout=240):
    return await jobs.wait(jobs.for_ref(ref_id)["id"], timeout)


async def test_game_runner_produces_a_complete_legal_record(engines):
    spec = GameSpec(EngineSpec(engines.bundled_id), EngineSpec(engines.bundled_id, {"Seed": 3}), "W", "B",
                    opening_moves=["e4", "e5", "Nf3"], opening_name="KP", time=NOFLAG, adjudication={"max_plies": 16})
    seen = []
    rec = await play_game(engines, spec, on_move=seen.append)
    assert rec["finished"] and rec["result"] in ("1-0", "0-1", "1/2-1/2") and rec["book_plies"] == 3
    assert rec["plies"] == 16 and rec["termination"] == "adjudication_max_plies" and len(seen) == 13
    game = read_games(rec["pgn"])[0]
    assert game.headers["Termination"] == "adjudication_max_plies" and "no-flag research" in game.headers["TimeControl"]
    assert len(list(game.mainline_moves())) == 16 and not game.errors          # every stored move is legal
    assert all(e["depth"] is not None and e["stop_reason"] for e in rec["evals"])
    assert engines.resources.snapshot()["active"] == []


async def test_real_clock_forfeits_on_time_but_noflag_mode_never_does(engines):
    slow = EngineSpec(engines.bundled_id)
    timed = GameSpec(slow, slow, "W", "B", time={"mode": "clock", "base_ms": 1, "inc_ms": 0, "overhead_ms": 0}, adjudication=ADJ)
    rec = await play_game(engines, timed)
    assert rec["termination"] == "time_forfeit" and rec["result"] == "0-1" and "lost on time" in rec["detail"]
    free = GameSpec(slow, slow, "W", "B", time=NOFLAG, adjudication={"max_plies": 6})
    rec2 = await play_game(engines, free)
    assert rec2["termination"] != "time_forfeit" and rec2["plies"] == 6


async def test_engine_failures_are_scored_and_recorded(engines):
    crasher = await fixture_engine(engines, "--crash", name="Crasher")
    spec = GameSpec(EngineSpec(crasher["id"]), EngineSpec(engines.bundled_id), "Crasher", "Good", time=NOFLAG, adjudication=ADJ)
    rec = await play_game(engines, spec)
    assert rec["termination"] == "engine_error" and rec["result"] == "0-1" and rec["finished"]
    assert engines.resources.snapshot()["active"] == []


async def test_round_robin_saves_every_game_and_reports(db, engines, jobs, bus):
    tm = TournamentManager(db, engines, jobs, bus)
    t = tm.create({"format": "round_robin", "players": players(engines, 3), "time": NOFLAG, "adjudication": ADJ, "concurrency": 2,
                   "reverse_colors": True, "openings": {"mode": "suite", "suite": [{"name": "Italian", "moves": ["e4", "e5", "Nf3", "Nc6", "Bc4"]},
                                                                                    {"name": "QGD", "moves": ["d4", "d5", "c4", "e6"]}]}})
    assert len(t["state"]["schedule"]) == 6
    by_pair = {}
    for g in t["state"]["schedule"]:
        by_pair.setdefault(frozenset((g["white"], g["black"])), []).append(g)
    for a, b in by_pair.values():                    # colour-reversed twins share the same opening
        assert a["white"] == b["black"] and a["opening"]["name"] == b["opening"]["name"]
    tm.start(t["id"])
    job = await run(jobs, t["id"])
    assert job["status"] == "completed"
    v = tm.view(t["id"])
    assert v["status"] == "completed" and v["overview"]["games"] == 6
    assert db.scalar("SELECT COUNT(*) FROM games WHERE tournament_id=?", (t["id"],)) == 6
    assert sum(r["points"] for r in v["standings"]) == 6 and all(r["games"] == 4 for r in v["standings"])
    rep = v["report"]
    assert rep["winner"] == v["standings"][0]["player"] and rep["method_notes"] and rep["overview"]["limitations"]
    assert all(h["warning"] for h in rep["head_to_head"])                 # 2 games per pairing: flagged as a small sample
    pgn = tm.pgn(t["id"])
    games = read_games(pgn)
    assert len(games) == 6 and {g.headers["Opening"] for g in games} == {"Italian", "QGD"}
    dup = tm.duplicate(t["id"])
    assert dup["status"] == "pending" and dup["config"]["seed"] != t["config"]["seed"]


async def test_tournament_resumes_after_an_interruption_without_losing_games(db, engines, jobs, bus):
    tm = TournamentManager(db, engines, jobs, bus)
    t = tm.create({"format": "round_robin", "players": players(engines, 3), "time": NOFLAG, "adjudication": ADJ, "reverse_colors": False})
    tm.start(t["id"])
    for _ in range(600):                                  # wait for the first saved game, then pause
        if db.scalar("SELECT COUNT(*) FROM games WHERE tournament_id=?", (t["id"],)) >= 1:
            break
        await asyncio.sleep(0.05)
    tm.pause(t["id"])
    job = await run(jobs, t["id"])
    assert job["status"] == "paused"
    saved = db.scalar("SELECT COUNT(*) FROM games WHERE tournament_id=?", (t["id"],))
    assert 1 <= saved < 3
    # simulate a crash that left a game marked as running: it must be replayed, not lost or duplicated
    st = tm.get(t["id"])["state"]
    pending = [g for g in st["schedule"] if g["status"] == "pending"]
    pending[0]["status"] = "running"
    db.update("tournaments", t["id"], {"state": st})
    db.update("jobs", job["id"], {"status": "running"})
    assert jobs.recover() == [job["id"]] and jobs.get(job["id"])["status"] == "recovery_required"
    job = await run(jobs, t["id"])                        # the scheduler resumes recovery_required jobs by itself
    assert job["status"] == "completed"
    assert db.scalar("SELECT COUNT(*) FROM games WHERE tournament_id=?", (t["id"],)) == 3
    assert all(g["status"] == "done" for g in tm.get(t["id"])["state"]["schedule"])


async def test_swiss_knockout_gauntlet_and_league_formats(db, engines, jobs, bus):
    tm = TournamentManager(db, engines, jobs, bus)
    base = {"time": NOFLAG, "adjudication": {"max_plies": 12}, "concurrency": 2}
    sw = tm.create({**base, "format": "swiss", "players": players(engines, 5), "swiss": {"rounds": 2}})
    ko = tm.create({**base, "format": "knockout", "players": players(engines, 3), "knockout": {"best_of": 1, "tiebreak_pairs": 1}})
    ga = tm.create({**base, "format": "gauntlet", "players": players(engines, 3), "gauntlet": {"champion": "E1", "games_per_opponent": 2}})
    lg = tm.create({**base, "format": "league", "players": players(engines, 4), "league": {"division_size": 2, "seasons": 2, "promote": 1},
                    "reverse_colors": False})
    for t in (sw, ko, ga, lg):
        tm.start(t["id"])
    for t in (sw, ko, ga, lg):
        assert (await run(jobs, t["id"], 400))["status"] == "completed", t["format"]
    s = tm.view(sw["id"])
    assert len(s["state"]["schedule"]) == 4 and len(s["state"]["swiss"]["byes"]) == 2 and len(set(s["state"]["swiss"]["byes"])) == 2
    pairs = [frozenset((g["white"], g["black"])) for g in s["state"]["schedule"]]
    assert len(pairs) == len(set(pairs))                                  # no rematches
    assert sum(r["points"] for r in s["standings"]) == 4 + 2              # 4 games + two one-point byes
    k = tm.view(ko["id"])["state"]["knockout"]
    assert k["champion"] and [r["name"] for r in k["rounds"]] == ["Semi-final", "Final"]
    assert any(m["bye"] for m in k["rounds"][0]["matches"]) and all(m["winner"] for r in k["rounds"] for m in r["matches"])
    g = tm.view(ga["id"])
    assert all("E1" in (x["white"], x["black"]) for x in g["state"]["schedule"]) and len(g["state"]["schedule"]) == 4
    l = tm.view(lg["id"])["state"]["league"]
    assert l["season"] == 2 and len(l["history"]) == 2 and l["history"][0]["changes"][0]["promoted"]
    assert sorted(p for d in l["divisions"] for p in d) == ["E0", "E1", "E2", "E3"]
    with pytest.raises(ValueError):
        tm.create({"format": "round_robin", "players": players(engines, 1)})
    with pytest.raises(ValueError):
        tm.create({"format": "round_robin", "players": players(engines, 2), "time": {"mode": "secret-unlimited"}})


# ------------------------------------------------------------------ discovery
def lab_config(engines, **kw):
    base = {"strategy": "mixed", "ranks": [2, 3, 4], "start": {"moves": "e4 e5 Nf3 Nc6"}, "color": "white",
            "explorer_a": {"engine_id": engines.bundled_id, "options": {"Skill Level": 12}},
            "explorer_b": {"engine_id": engines.bundled_id, "options": {"Skill Level": 8, "Seed": 5}},
            "observer": {"engine_id": engines.bundled_id}, "max_candidates": 2, "games_per_candidate": 2,
            "rank_budget": FAST, "game_budget": GAME, "verify_budget": {"min_time": 0.0, "max_time": 0.6, "min_depth": 2, "max_depth": 3},
            "adjudication": {"max_plies": 20}, "seed": 7, "filters": {"max_expected_loss": 0.25, "max_cp_loss": 400}}
    base.update(kw)
    return base


async def test_discovery_experiment_end_to_end(db, engines, jobs, bus, books):
    ref = books.create("Ref", openings.reference_book())
    expl = books.create("Expl", profile="exploration")
    lab = DiscoveryLab(db, engines, jobs, bus, books)
    e = lab.create(lab_config(engines, reference_book_id=ref["id"], export_book_id=expl["id"], extra_games=2))
    lab.start(e["id"])
    assert (await run(jobs, e["id"], 400))["status"] == "completed"
    v = lab.view(e["id"])
    assert v["status"] == "completed"
    assert {k: s["status"] for k, s in v["stages"].items()} == {**{s: "completed" for s in STAGES}, "human_approval": "waiting"}
    assert v["stages"]["candidate_selection"]["output"]["scheduler_seed"] == 7
    ranking_stage = v["stages"]["initial_analysis"]["output"]
    assert ranking_stage["rankings"][0]["candidates"][0]["rank"] == 1 and "Ranks are evidence" in ranking_stage["note"]
    assert len(v["findings"]) == 2
    for f in v["findings"]:
        board = chess.Board(f["fen"])
        assert chess.Move.from_uci(f["move_uci"]) in board.legal_moves                 # lower-ranked moves are legal moves
        r = f["ranking"]
        assert r["original_rank"] in (2, 3, 4) and r["ranking_engine"] and r["ranking_depth"] and r["ranking_budget"]
        assert r["verification_rank"] is not None and r["verification_score"] and r["evaluation_change"] is not None
        assert r["rank_stability"] == r["verification_rank"] - r["original_rank"]
        assert set(f["scores"]) == {"objective_viability", "practical_difficulty", "novelty_in_database", "tactical_potential",
                                    "strategic_coherence", "research_confidence", "training_value"}
        assert all(0 <= s["value"] <= 1 and s["explanation"] for s in f["scores"].values())
        assert len(f["evidence"]["games"]) >= 2 and f["evidence"]["verification"]["engine"] and f["evidence"]["category_reasons"]
        assert {g["candidate_engine"] for g in f["evidence"]["games"][:2]} == {"A", "B"}    # mirrored: both explorers try it
        # traceability: finding -> games in the database
        linked = {l["dst_id"] for l in db.links_for("finding", f["id"]) if l["dst_kind"] == "game"}
        assert linked == {g["game_id"] for g in f["evidence"]["games"]} and all(db.get("games", g) for g in linked)
    rep = v["report"]
    assert rep["caveats"] and rep["method"]["seed"] == 7 and "candidate(s) investigated" in rep["headline"]
    assert books.info(expl["id"])["head_version"] == 1                         # nothing entered the book without approval
    again = lab.start(e["id"], "candidate_comparison")                         # completed stages can be rerun
    assert again["stages"]["deep_verification"]["status"] == "completed" and again["stages"]["candidate_comparison"]["status"] == "pending"
    assert (await run(jobs, e["id"], 200))["status"] == "completed"
    assert len(lab.findings(experiment_id=e["id"])) == 2


async def test_fixed_rank_strategy_and_missing_candidates(db, engines, jobs, bus, books):
    lab = DiscoveryLab(db, engines, jobs, bus, books)
    e = lab.create(lab_config(engines, strategy="third_best", start={"moves": "e4 e5"}, games_per_candidate=0, max_candidates=1))
    lab.start(e["id"])
    await run(jobs, e["id"])
    f = lab.findings(experiment_id=e["id"])
    assert len(f) == 1 and f[0]["ranking"]["original_rank"] == 3 and f[0]["evidence"]["strategy"] == "third_best"
    assert lab.view(e["id"])["stages"]["tournament_exploration"]["status"] == "skipped"
    # only two legal moves: a fifth-best candidate does not exist and none is invented
    e2 = lab.create(lab_config(engines, strategy="fifth_best", start={"fen": "7k/8/8/8/8/8/8/K6R b - - 0 1"}, color="black", games_per_candidate=0))
    lab.start(e2["id"])
    await run(jobs, e2["id"])
    v = lab.view(e2["id"])
    assert v["findings"] == [] and v["stages"]["initial_analysis"]["output"]["rankings"][0]["missing_ranks"] == [5]
    assert v["stages"]["initial_analysis"]["summary"] == "No candidate passed the viability filters"


async def test_novelty_strategy_uses_the_reference_book_and_filters_reject_bad_moves(db, engines, jobs, bus, books):
    ref = books.create("Ref", openings.reference_book())
    lab = DiscoveryLab(db, engines, jobs, bus, books)
    e = lab.create(lab_config(engines, strategy="novelty", start={}, reference_book_id=ref["id"], games_per_candidate=0, max_candidates=2))
    lab.start(e["id"])
    await run(jobs, e["id"])
    book = books.head(ref["id"])
    for f in lab.findings(experiment_id=e["id"]):
        assert not book.contains(chess.Board(f["fen"]), chess.Move.from_uci(f["move_uci"]))
        assert f["evidence"]["book"] == {"reference": True, "in_book": False, "position_known": True, "share": 0.0}
        assert "new to this research collection" in f["scores"]["novelty_in_database"]["explanation"]
    strict = lab.create(lab_config(engines, strategy="deep_alternative", start={}, games_per_candidate=0,
                                   filters={"max_expected_loss": 0.0001, "max_cp_loss": 1}))
    lab.start(strict["id"])
    await run(jobs, strict["id"])
    out = lab.view(strict["id"])["stages"]["initial_analysis"]["output"]
    assert out["created"] == 0 and out["rejected"] and "exceeds" in out["rejected"][0]["reason"] or "worse" in out["rejected"][0]["reason"]
    with pytest.raises(ValueError):
        lab.create(lab_config(engines, strategy="telepathy"))
    with pytest.raises(ValueError):
        lab.create(lab_config(engines, start={"moves": "e4 Ke2"}))

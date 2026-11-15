"""Gambit Lab: the material rule, compensation, assessment, search and the engine-level ladder."""
import asyncio

import chess
import pytest

from om.engines.manager import EngineSpec
from om.engines.search import Budget
from om.gambit import GambitError, GambitLab
from om.gambit.static import balance, compensation, sacrifice, sacrifices, see
from om.play import PlayManager

from conftest import FAST

B = Budget.from_dict(FAST)


def at(line):
    b = chess.Board()
    ms = line.split()
    for m in ms[:-1]:
        b.push_san(m)
    return b, b.parse_san(ms[-1])


@pytest.fixture
def lab(db, engines, books, bus):
    pm = PlayManager(db, engines, bus, None, books)
    return GambitLab(db, engines, books, pm.strength_options)


def test_static_exchange_evaluation():
    b, m = at("e4 d5 exd5")
    assert see(b, m) == 0                                    # pawn takes pawn, queen takes back: an even trade
    b = chess.Board("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1")
    assert see(b, b.parse_san("exd5")) == 1                  # undefended pawn
    b = chess.Board("4k3/2p5/3p4/8/8/8/3R4/4K3 w - - 0 1")
    assert see(b, b.parse_san("Rxd6")) == 1 - 5              # rook takes a defended pawn
    b = chess.Board("3rk3/8/3p4/8/8/8/3R4/3RK3 w - - 0 1")
    assert see(b, b.parse_san("Rxd6")) == 1                  # R takes pawn, RxR, RxR: 1 - (5 - 5)


@pytest.mark.parametrize("line,pawns,accept,declined", [
    ("e4 e5 f4", 1, "exf4", False),                                        # King's Gambit: a pawn left en prise
    ("e4 e5 d4 exd4 c3", 1, None, True),                                   # Danish: declining to recapture is a sacrifice too
    ("e4 c5 d4 cxd4 c3", 1, None, True),                                   # Smith-Morra
    ("e4 e5 f4 d5", 1, "fxe5", False),                                     # Falkbeer: one pawn, not two, although ...exf4 was on offer
    ("d4 Nf6 c4 c5 d5 b5", 1, "cxb5", False),                              # Benko
    ("e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5", 5, "Bxd1", False),                # Legal's queen sacrifice (queen for bishop and pawn by the exchange rule)
    ("e4 e5 Nf3 Nc6", 0, None, True),                                      # ordinary development gives up nothing
])
def test_the_material_rule_recognises_classic_gambits(line, pawns, accept, declined):
    b, m = at(line)
    s = sacrifice(b, m)
    assert (s["pawns"], s["accept_san"], s["declined_recapture"]) == (pawns, accept, declined)


def test_sacrifices_lists_biggest_first_and_only_real_ones():
    b, _ = at("e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5")
    found = sacrifices(b, 1)
    assert found and found[0][1]["pawns"] >= found[-1][1]["pawns"] and any(b.san(m) == "Nxe5" for m, _ in found)
    assert all(d["pawns"] >= 1 for _, d in found)
    assert sacrifices(chess.Board(), 1) == []                # nothing to give up on move one


def test_compensation_describes_development_and_king_exposure():
    # Danish accepted twice: White has two bishops raking the board and a lead in development for two pawns
    b, m = at("e4 e5 d4 exd4 c3 dxc3 Bc4 cxb2 Bxb2")
    b.push(m)
    c = compensation(b, chess.WHITE)
    assert balance(b, chess.WHITE) == -2 and c["parts"]["development"]["value"] >= 2 and "development" in c["kinds"]
    assert c["score"] > 0.5 and c["summary"].startswith("Compensation")
    quiet = compensation(chess.Board(), chess.WHITE)
    assert quiet["score"] == 0.5 and quiet["kinds"] == []


def test_catalogue_locates_the_offer_and_merges_sublines(lab):
    cat = {g["name"]: g for g in lab.catalogue()}
    assert cat["King's Gambit"]["san"] == "f4" and cat["King's Gambit"]["color"] == "white"
    assert cat["Queen's Gambit: Albin Countergambit"]["san"] == "e5" and cat["Queen's Gambit: Albin Countergambit"]["color"] == "black"
    assert cat["Sicilian Defense: Smith-Morra Gambit"]["san"] == "c3"
    assert "Queen's Gambit" in cat and not any(n.startswith("Queen's Gambit Declined") for n in cat)     # same offer, one entry
    assert all(g["pawns"] >= 1 and g["moves"] for g in cat.values())


def test_levels_follow_what_the_engine_offers(lab, engines):
    lv = lab.levels_for(engines.bundled_id)
    modes = {l["mode"] for l in lv["levels"]}
    assert len(lv["levels"]) >= 4 and modes <= {"elo", "skill", "depth", "full"} and lv["mechanism"]


async def test_assess_scores_risk_sting_and_compensation_separately(lab, engines):
    g = await lab.assess_line("1.e4 e5 2.f4", None, EngineSpec(engines.bundled_id), B, asyncio.Event(), lambda f: None, horizon=4)
    d = g["detail"]
    assert g["san"] == "f4" and g["color"] == "white" and g["name"].startswith("King's Gambit") and g["line"] == ["e2e4", "e7e5", "f2f4"]
    assert d["sacrifice"]["pawns"] == 1 and 0 <= d["risk"]["value"] <= 1 and 0 <= d["sting"]["value"] <= 1
    assert d["band"] in ("sound", "practical", "speculative", "unsound") and d["kind"] in ("true gambit", "temporary sacrifice", "offer")
    assert d["accept"]["san"] == "exf4" and d["main_line"].startswith("2...exf4") and len(d["rows"]) <= 4
    assert set(d["compensation"]["parts"]) == {"development", "king", "lines", "mobility", "centre"}
    assert all(r["side"] in ("defender", "gambiteer") for r in d["rows"]) and "evidence, not proof" in d["note"]
    again = await lab.assess_line("e4 e5 f4", None, EngineSpec(engines.bundled_id), B, asyncio.Event(), lambda f: None, horizon=2)
    assert again["id"] == g["id"] and len(lab.list()) == 1                       # same offer is updated, not duplicated
    with pytest.raises(GambitError):
        await lab.assess_line("e4 e5 Ke3", None, EngineSpec(engines.bundled_id), B, asyncio.Event(), lambda f: None)


async def test_a_trap_is_found_when_taking_is_the_mistake(lab, engines):
    # Legal's trap: after Nxe5 the queen is offered; ...Bxd1 allows mate in two
    g = await lab.assess_line("e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5", None, EngineSpec(engines.bundled_id),
                              Budget.from_dict({**FAST, "max_depth": 4, "max_time": 12}), asyncio.Event(), lambda f: None, horizon=2)
    d = g["detail"]
    assert d["sacrifice"]["pawns"] == 5 and d["accept"]["san"] == "Bxd1" and d["accept"]["is_mistake"]
    assert d["accept"]["better_capture"] == "dxe5" and d["main_line"].startswith("5...dxe5")       # best defence takes the knight instead
    trap = next(t for t in d["traps"] if t["san"] == "Bxd1")
    assert trap["why"] == "accepting the offer" and trap["punish"] == "Bxf7+" and trap["line"].startswith("5...Bxd1 6.Bxf7+") and d["sting"]["traps"] >= 1
    assert d["risk"]["value"] <= 0.05 and d["band"] == "sound"


async def test_search_finds_sacrifices_within_the_cost_limit(lab, engines):
    out = await lab.search({"moves": "e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6", "color": "white", "max_ply": 0, "max_positions": 1, "max_cost": 0.1,
                            "max_results": 2, "horizon": 2}, EngineSpec(engines.bundled_id),
                           Budget.from_dict({**FAST, "max_depth": 4, "max_time": 12}), asyncio.Event(), lambda f: None)   # depth-bounded: the time is only a ceiling
    assert out["positions"] == 1 and out["sacrifices_seen"] >= 1
    assert any(g["san"] == "Nxe5" for g in out["found"]) and all(g["risk"] <= 0.125 for g in out["found"])
    assert "rejected" in out["note"]


async def test_ladder_reports_each_level_and_a_verdict(lab, engines):
    g = await lab.assess_line("e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5", None, EngineSpec(engines.bundled_id), B, asyncio.Event(), lambda f: None, horizon=2)
    strong = Budget.from_dict({**FAST, "max_depth": 4, "max_time": 1.5})
    seen = []
    rep = await lab.ladder(g["id"], EngineSpec(engines.bundled_id), EngineSpec(engines.bundled_id), [{"mode": "depth", "depth": 3}, {"mode": "depth", "depth": 1}],
                           strong, asyncio.Event(), seen.append, games_per_level=2, horizon=8, seed=1)
    assert [l["label"] for l in rep["levels"]] == ["Depth 1", "Depth 3"]                 # sorted weakest first
    for l in rep["levels"]:
        assert l["games"] >= 1 and l["fell"] + l["held"] + l["punished"] == l["games"] and "depth" in l["mechanism"]
        assert all(s["outcome"] in ("fell", "held", "punished") and s["moves"] and 0 <= s["final"] <= 1 for s in l["samples"])
    shallow = rep["levels"][0]
    assert shallow["fell"] >= 1 and shallow["accepted"] >= 1                             # one ply of lookahead grabs the queen and gets mated
    assert shallow["samples"][0]["mistake"]["san"] == "Bxd1"
    assert rep["verdict"] and rep["falls_up_to"] in ("Depth 1", "Depth 3") and seen and seen[-1] == 1.0
    stored = lab.get(g["id"])
    assert stored["status"] == "tested" and stored["report"]["verdict"] == rep["verdict"] and lab.list()[0]["ladder"] == rep["verdict"]
    with pytest.raises(GambitError):
        await lab.ladder(g["id"], EngineSpec(engines.bundled_id), EngineSpec(engines.bundled_id), [], B, asyncio.Event(), lambda f: None)


async def test_following_the_line_corrects_a_shallow_first_impression(lab, engines):
    # At depth 2 the engine thinks grabbing the queen is Black's best reply; following that line shows the mate.
    shallow = Budget.from_dict({**FAST, "max_depth": 2, "max_time": 12})
    g = await lab.assess_line("e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5", None, EngineSpec(engines.bundled_id), shallow, asyncio.Event(), lambda f: None, horizon=4)
    d = g["detail"]
    trap = next(t for t in d["traps"] if t["san"] == "Bxd1")
    assert "looking further" in trap["why"] and trap["line"].startswith("5...Bxd1 6.Bxf7+ Ke7 7.Nd5#")
    assert d["accept"]["is_mistake"] and not d["main_line"].startswith("5...Bxd1")
    assert d["risk"]["value"] == pytest.approx(max(0.0, d["expected_before"] - d["expected_best_defence"]), abs=0.002)   # the two always agree
    assert "first_look" in d["risk"]


async def test_a_stopped_ladder_keeps_the_levels_it_finished(lab, engines):
    g = await lab.assess_line("e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5", None, EngineSpec(engines.bundled_id), B, asyncio.Event(), lambda f: None, horizon=2)
    stop = asyncio.Event()
    rep = await lab.ladder(g["id"], EngineSpec(engines.bundled_id), EngineSpec(engines.bundled_id),
                           [{"mode": "depth", "depth": 1}, {"mode": "depth", "depth": 2}, {"mode": "depth", "depth": 3}],
                           Budget.from_dict({**FAST, "max_depth": 4, "max_time": 1.5}), stop, lambda f: stop.set() if f > 0 else None,
                           games_per_level=1, horizon=6, seed=1)
    assert rep["partial"] and rep["verdict"].startswith("Stopped early") and 1 <= len(rep["levels"]) < 3
    assert lab.get(g["id"])["report"]["partial"]


def test_gambit_routes_over_http():
    import time
    from test_learn_play_api import client
    c, _ = client()
    with c:
        cat = c.get("/api/gambits/catalogue").json()
        assert any(g["name"] == "King's Gambit" for g in cat) and c.get("/api/gambits").json() == []
        eid = c.get("/api/engines").json()["engines"][0]["id"]
        assert c.get(f"/api/gambits/levels?engine_id={eid}").json()["levels"]
        assert c.post("/api/gambits/job", json={"task": "nonsense", "engine": {"engine_id": eid}}).status_code == 400
        job = c.post("/api/gambits/job", json={"task": "assess", "moves": "e4 e5 f4", "engine": {"engine_id": eid}, "budget": FAST, "horizon": 2}).json()
        for _ in range(200):
            j = c.get(f"/api/jobs/{job['job_id']}").json()
            if j["status"] in ("completed", "failed", "canceled"):
                break
            time.sleep(0.1)
        assert j["status"] == "completed" and j["result"]["name"].startswith("King's Gambit")
        gid = j["result"]["id"]
        full = c.get(f"/api/gambits/{gid}").json()
        assert full["san"] == "f4" and full["detail"]["sacrifice"]["pawns"] == 1 and c.get("/api/gambits").json()[0]["id"] == gid
        assert c.get("/api/gambits/nope").status_code in (400, 404)
        assert c.delete(f"/api/gambits/{gid}").json()["ok"] and c.get("/api/gambits").json() == []

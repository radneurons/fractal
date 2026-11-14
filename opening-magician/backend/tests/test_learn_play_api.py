import asyncio
import tempfile
import time
from pathlib import Path

import chess
import pytest
from fastapi.testclient import TestClient

from conftest import FAST
from om import openings
from om.api.app import create_app
from om.chessx import read_games
from om.config import Settings
from om.engines.manager import EngineSpec
from om.engines.search import Budget
from om.hardware.manager import HardwareManager
from om.learn.puzzles import PuzzleLab, estimate_rating, level_for
from om.learn.studies import StudyManager
from om.learn.training import Trainer, grade, sm2
from om.play import PlayManager


# ------------------------------------------------------------------ training
def test_sm2_schedule_reflects_evidence():
    assert grade(True, 2000, 0) == 5 and grade(True, 12_000, 0) == 4 and grade(True, 2000, 1) == 3 and grade(False, 2000, 0) == 1
    ease, interval, reps = sm2(2.5, 0, 0, 5)
    assert (interval, reps) == (1.0, 1)
    ease, interval, reps = sm2(ease, interval, reps, 5)
    assert interval == 3.0
    ease, interval, reps = sm2(ease, interval, reps, 5)
    assert interval > 7 and ease > 2.5
    e2, i2, r2 = sm2(ease, interval, reps, 1)                 # a miss resets the card and lowers its ease
    assert (i2, r2) == (0.0, 0) and e2 < ease


def test_trainer_scores_only_from_real_answers(db, books):
    t = Trainer(db, books)
    assert t.skills()["opening_recall"]["value"] is None       # no evidence -> no estimate
    exch = next(o["id"] for o in openings.catalog() if o["name"] == "Ruy Lopez: Exchange Variation")   # white: e4, Nf3, Bb5, Bxc6
    d = t.build_deck_from_opening(exch, "white")
    assert d["added"] == 4 and t.build_deck_from_opening(exch, "white")["added"] == 0
    cards = t.next_cards(d["deck"], 10)
    first = cards[0]
    wrong = t.answer(first["id"], "a2a3", 3000)
    assert not wrong["correct"] and wrong["expected_san"] == "e4" and wrong["interval_days"] == 0
    assert t.answer(first["id"], "Ke2")["legal"] is False
    for _ in range(2):
        t.answer(first["id"], "h2h4", 3000)
    right = t.answer(first["id"], "e2e4", 2500)
    assert right["correct"] and right["quality"] == 5
    sk = t.skills()["opening_recall"]
    assert sk["n"] == 4 and 0 < sk["value"] < 1 and sk["confidence"] < 0.5
    weak = t.weaknesses()
    assert weak and weak[0]["card_id"] == first["id"] and weak[0]["lapses"] == 3
    assert weak[0]["usually_played_san"] == "h4" and weak[0]["plan"]["arrows"][0] == {"from": "e2", "to": "e4", "kind": "best"}
    assert t.progress()["events"] == 4 and t.decks()[0]["n"] == 4


def test_training_tasks_have_real_checks(db, books):
    t = Trainer(db, books)
    tr = t.task("transposition", {"seed": 5})
    correct_name = openings.identify(chess.Board(tr["fen"]))
    assert len(tr["options"]) == 4 and tr["moves"]
    res = t.check(tr["id"], {"value": "definitely wrong"})
    assert not res["correct"] and res["answer"] in tr["options"]
    with pytest.raises(ValueError):
        t.check(tr["id"], {"value": "x"})                       # a task can be answered once
    mo = t.task("move_order", {"seed": 2})
    canon = [m for m in openings.catalog() if m["name"] == mo["name"]][0]["uci"]
    assert not t.check(mo["id"], {"moves": canon})["correct"]   # the main move order is not accepted
    mo2 = t.task("move_order", {"seed": 2})
    alt = t._alt_order(canon, __import__("random").Random(1))
    assert t.check(mo2["id"], {"moves": alt})["correct"]
    trap = t.task("trap", {"trap_id": "trap00", "variant": "punish"})
    assert t.check(trap["id"], {"move": "c4f7"})["correct"]     # Légal: after ...Bxd1 comes Bxf7+!
    avoid = t.task("trap", {"trap_id": "trap02", "variant": "avoid"})
    assert not t.check(avoid["id"], {"move": "f3e5"})["correct"]   # Blackburne Shilling: Nxe5?? is the trap
    lab = t.task("labyrinth", {"seed": 1})
    good = set(openings.reference_book().positions[chess.Board().epd()]["moves"])
    assert {o["uci"] for o in lab["options"]} & good
    assert t.task("pawn_structure", {"seed": 4})["options"] == ["White", "Black"]
    lesson = t.lesson(next(o["id"] for o in openings.catalog() if o["name"] == "Ruy Lopez: Closed Variation"))
    assert lesson["steps"][-1]["title"] == lesson["opening"]["name"] and lesson["steps"][4]["text"]
    assert db.scalar("SELECT COUNT(*) FROM training_events") == 5


# ------------------------------------------------------------------ puzzles
async def test_puzzles_require_one_clearly_best_move(db, engines):
    lab = PuzzleLab(db, engines)
    assert lab.seed_builtin() == 16 and lab.seed_builtin() == 0
    async with engines.session(EngineSpec(engines.bundled_id), "research") as h:
        b = Budget(min_time=0, max_time=1.5, min_depth=3, max_depth=3)
        mate = await lab.analyse_position(h, chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"), b)
        assert mate and mate["solution"] == ["a1a8"] and "mate_in_1" in mate["themes"] and mate["verification"]["engine_verified"]
        quiet = await lab.analyse_position(h, chess.Board(), b)
        assert quiet is None                                    # many reasonable moves: not a puzzle
        two_mates = await lab.analyse_position(h, chess.Board("6k1/8/6K1/8/8/8/8/R6R w - - 0 1"), b)
        assert two_mates is None or two_mates["alternatives"] or two_mates["verification"]["gap"] >= 0.15
    made = await lab.from_position("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", EngineSpec(engines.bundled_id), b)
    pid = made["created"]
    assert pid and lab.get(pid)["side"] == "white" and "solution" not in lab.get(pid)
    assert lab.check(pid, 0, "a1a7") == {"correct": False, "legal": True, "hint_square": "a1"}
    assert lab.check(pid, 0, "a1a8")["done"] is True
    r0 = lab.get(pid)["rating"]
    lab.record(pid, True, 4000, 0, 0)                           # an easy puzzle solved cleanly: (almost) no surprise
    assert lab.get(pid)["rating"] <= r0
    lab.record(pid, False, 9000, 1, 2)                          # failing an "easy" puzzle is strong evidence it is harder
    assert lab.get(pid)["rating"] >= r0 + 10 and lab.stats()["attempts"] == 2
    res = await lab.mine_pgn('[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0', EngineSpec(engines.bundled_id), b, skip_plies=4)
    assert res["positions_scanned"] >= 2 and res["games"] == 1
    assert level_for(900) == "Beginner" and level_for(2500) == "Grandmaster-level calculation"
    assert estimate_rating(chess.Board(), ["g1f3", "g8f6", "b1c3"], 0.2, 10, []) > estimate_rating(chess.Board(), ["g1f3"], 0.5, 4, ["mate_in_1"])


# ------------------------------------------------------------------ studies
def test_study_tree_editing_and_pgn_export(db):
    st = StudyManager(db)
    s = st.create("Ruy", kind="opening")
    ch = st.add_chapter(s["id"], "Main", "1. e4 e5 2. Nf3 Nc6 *")
    r = st.edit(ch["id"], "add_move", [0, 0, 0, 0], move="Bb5")
    assert r["path"] == [0, 0, 0, 0, 0]
    r = st.edit(ch["id"], "add_move", [0, 0, 0, 0], move="Bc4")            # a variation
    assert r["path"] == [0, 0, 0, 0, 1]
    assert st.edit(ch["id"], "add_move", [0, 0, 0, 0], move="f1b5")["path"] == [0, 0, 0, 0, 0]   # existing move is reused
    st.edit(ch["id"], "comment", [0, 0, 0, 0, 1], text="Italian")
    st.edit(ch["id"], "nags", [0, 0, 0, 0, 1], nags=[5])
    st.edit(ch["id"], "shapes", [0, 0, 0, 0, 1], arrows=[{"from": "c4", "to": "f7", "color": "red"}], squares=[{"square": "f7", "color": "red"}])
    st.edit(ch["id"], "comment", [0, 0, 0, 0, 1], text="Italian Game")      # editing text keeps the arrows
    with pytest.raises(ValueError):
        st.edit(ch["id"], "add_move", [0], move="Ke2")
    pgn = st.export_pgn(s["id"])
    g = read_games(pgn)[0]
    var = g.variations[0].variations[0].variations[0].variations[0].variations[1]
    assert var.san() == "Bc4" and "Italian Game" in var.comment and 5 in var.nags and len(var.arrows()) == 2
    st.edit(ch["id"], "promote", [0, 0, 0, 0, 1])
    assert st.chapter(ch["id"])["tree"]["root"]["children"][0]["children"][0]["children"][0]["children"][0]["children"][0]["san"] == "Bc4"
    st.edit(ch["id"], "delete", [0, 0, 0, 0, 1])
    assert len(read_games(st.export_pgn(s["id"]))[0].variations[0].variations[0].variations[0].variations[0].variations) == 1
    seq = st.playback_sequence(ch["id"])
    assert seq["moves"] == ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"] and 5 in seq["annotations"]
    big = st.import_pgn("[White \"A\"]\n[Black \"B\"]\n\n1. d4 d5 *\n\n[White \"C\"]\n[Black \"D\"]\n\n1. c4 *")
    assert len(big["chapters"]) == 2
    op = st.from_opening(next(o["id"] for o in openings.catalog() if o["name"] == "Italian Game"))                                           # Italian Game + its trap chapters
    assert any(c["title"].startswith("Trap:") for c in op["chapters"])


def test_finding_becomes_an_annotated_study(db):
    st = StudyManager(db)
    f = {"id": "f1", "experiment_id": None, "fen": "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
         "move_uci": "b1c3", "move_san": "Nc3", "line_san": "1.e4 e5 2.Nf3 Nc6 3.Nc3", "category": "viable_alternative", "status": "promising",
         "scores": {"objective_viability": {"value": 0.9}},
         "ranking": {"original_rank": 2, "ranking_engine": "Weak", "ranking_depth": 4, "original_score": {"text": "+0.10"},
                     "verification_rank": 3, "verification_rank_exact": True, "verification_engine": "Strong", "verification_depth": 14,
                     "verification_score": {"text": "+0.05"}},
         "evidence": {"seed": {"start_fen": chess.STARTING_FEN, "moves": ["e2e4", "e7e5", "g1f3", "b8c6"]},
                      "verification": {"best_move": "f1b5", "best_score": {"text": "+0.30"}, "pv_san": ["Nc3", "Nf6", "d4"]},
                      "trap": {"tempting": "f8c5", "loss": 0.2, "punish": "f3e5", "punish_pv": ["Nxe5", "Nxe5", "d4"]}}}
    out = st.from_finding(f)
    game = read_games(st.export_pgn(out["study_id"]))[0]
    node = game
    for _ in range(4):
        node = node.variations[0]
    assert [v.san() for v in node.variations] == ["Nc3", "Bb5"]
    cand = node.variations[0]
    assert "ranked #2 by Weak" in cand.comment and "Verifier Strong ranks it #3" in cand.comment
    assert [v.san() for v in cand.variations] == ["Nf6", "Bc5"] and 2 in cand.variations[1].nags
    assert cand.variations[1].variations[0].san() == "Nxe5"
    assert db.links_for("finding", "f1")[0]["src_kind"] == "study"


# ------------------------------------------------------------------ play with a physical (simulated) board
async def wait_for(cond, timeout=15.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        await asyncio.sleep(0.03)
    return False


async def test_physical_board_game_pauses_the_clock_while_relaying(db, engines, bus, books):
    hw = HardwareManager(db, bus)
    await hw.connect_sim("air")
    pm = PlayManager(db, engines, bus, hw, books)
    clock = {"kind": "standard", "stages": [{"base_ms": 60_000}],
             "physical": {"enabled": True, "per_move_allowance_ms": 8000, "pause_for_sync": True, "sync_cap_ms": 30_000}}
    s = await pm.create({"engine": {"engine_id": engines.bundled_id}, "color": "white", "clock": clock, "mode": "physical",
                         "strength": {"mode": "depth", "depth": 1}, "physical": {"use_board": True}})
    assert s.physical and not s.robot and s.clock.allowance_applies("white")
    hw.sim.play(s.board, s.board.parse_san("e4"))                  # the human moves on the board, not on screen
    assert await wait_for(lambda: len(s.board.move_stack) == 2 and not s.thinking)
    st = s.state()
    assert st["sans"][0] == "e4" and st["pending_sync"] == st["moves"][1]
    assert "sync" in st["clock"]["holds"] and st["clock"]["frozen"]            # human clock waits while they relay the engine move
    assert set(hw.sim.state()["leds"]) == {st["moves"][1][:2], st["moves"][1][2:4]}
    assert st["clock"]["white"]["ms"] > 60_000 - 3000 + 8000 - 500             # the 8 s hand-move allowance was added
    with pytest.raises(ValueError, match="Place the engine's move"):
        await s.human_move("d2d4")
    before = chess.Board()
    before.push_uci("e2e4")
    hw.sim.play(before, chess.Move.from_uci(st["moves"][1]))       # relay the engine's move on the physical board
    assert await wait_for(lambda: s.pending_sync is None)
    assert "sync" not in s.clock.holds and hw.sim.state()["leds"] == {}
    await s.resign()
    g = db.get("games", s.game_id)
    assert g["result"] == "0-1" and g["meta"]["physical"] and "[%clk" in g["pgn"] and "SIMULATED" in g["pgn"]
    await hw.disconnect()


async def test_robot_game_executes_engine_moves_and_session_recovers(db, engines, bus, books):
    hw = HardwareManager(db, bus)
    await hw.connect_sim("move", step_time=0.02)
    pm = PlayManager(db, engines, bus, hw, books)
    s = await pm.create({"engine": {"engine_id": engines.bundled_id}, "color": "white", "mode": "physical",
                         "clock": {"kind": "standard", "stages": [{"base_ms": 60_000}], "robot": {"policy": "pause_during_motion"}},
                         "strength": {"mode": "skill", "skill": 4}, "physical": {"use_board": True, "robot_moves": True}})
    assert s.robot and "Skill Level 4" in s.strength_applied["mechanism"]
    hw.sim.play(s.board, s.board.parse_san("d4"))
    assert await wait_for(lambda: len(s.board.move_stack) == 2 and not s.thinking and hw.robot.state == "completed")
    assert hw.in_sync_with(s.board) and s.pending_sync is None                 # the robot made the engine's move
    sid = s.id
    await pm.shutdown()
    await s.handle.close()
    pm2 = PlayManager(db, engines, bus, hw, books)
    assert pm2.recoverable()[0]["id"] == sid
    s2 = await pm2.recover(sid)
    assert [m.uci() for m in s2.board.move_stack] == [m.uci() for m in s.board.move_stack] and s2.status == "active"
    assert abs(s2.clock.remaining["white"] - s.clock.remaining["white"]) < 1
    await s2.abort()
    await hw.disconnect()


async def test_strength_mapping_is_honest_about_the_mechanism(db, engines, bus, books):
    pm = PlayManager(db, engines, bus, HardwareManager(db, bus), books)
    spec = EngineSpec(engines.bundled_id)
    elo = pm.strength_options(spec, {"mode": "elo", "elo": 1400})
    assert elo["approximate"] and "no Elo setting" in elo["mechanism"] and elo["options"] == {"Skill Level": 6}
    assert pm.strength_options(spec, {"mode": "full"})["mechanism"] == "full strength"
    with pytest.raises(ValueError):
        pm.normalize({"engine": {"engine_id": engines.bundled_id}, "start_fen": "8/8/8/8/8/8/8/8 w - - 0 1"})


# ------------------------------------------------------------------ API security
def client(mode="local", **kw):
    st = Settings()
    st.mode, st.data_dir = mode, Path(tempfile.mkdtemp())
    for k, v in kw.items():
        setattr(st, k, v)
    return TestClient(create_app(st)), st


def test_lan_mode_requires_the_admin_token_but_spectators_do_not():
    c, st = client("lan")
    with c:
        assert st.admin_token and c.get("/api/health").status_code == 200
        assert c.get("/api/engines").status_code == 401 and c.post("/api/hw/robot/stop").status_code == 401
        assert c.post("/api/engines", json={"path": "/bin/sh"}).status_code == 401
        h = {"X-OM-Token": st.admin_token}
        eid = c.get("/api/engines", headers=h).json()["engines"][0]["id"]
        s = c.post("/api/play", headers=h, json={"engine": {"engine_id": eid}, "color": "white", "strength": {"mode": "depth", "depth": 1}}).json()
        assert c.post("/api/broadcasts", headers=h, json={"title": "t", "source": {"kind": "play", "id": s["id"]}}).status_code == 400   # no consent
        bc = c.post("/api/broadcasts", headers=h, json={"title": "t", "source": {"kind": "play", "id": s["id"]}, "consent": True,
                                                         "config": {"show_eval": False, "show_pv": False}}).json()
        pub = c.get(f"/api/public/broadcast/{bc['token']}")                   # no token needed: read-only spectator data
        assert pub.status_code == 200
        game = pub.json()["game"]
        assert game["fen"] and game["eval"] is None and game["pv"] is None
        assert set(game) <= {"fen", "start_fen", "moves", "sans", "last_move", "white", "black", "result", "status", "opening", "clock",
                             "eval", "pv", "arrows", "engine", "tournament"}                          # explicit whitelist
        assert c.get("/api/public/broadcast/nope").status_code == 404
        assert c.post(f"/api/public/broadcast/{bc['token']}", json={}).status_code == 405      # nothing public is writable
        c.patch(f"/api/broadcasts/{bc['id']}", headers=h, json={"active": False})
        assert c.get(f"/api/public/broadcast/{bc['token']}").json() == {"title": "t", "live": False, "view": pub.json()["view"], "game": None}
        c.post(f"/api/play/{s['id']}/abort", headers=h)


def test_remote_clients_cannot_register_arbitrary_executables(monkeypatch):
    import om.api.app as appmod
    monkeypatch.setattr(appmod, "LOOPBACK", set())               # make the test client look like another machine
    c, st = client("lan")
    with c:
        h = {"X-OM-Token": st.admin_token}
        r = c.post("/api/engines", headers=h, json={"path": "/bin/sh"})
        assert r.status_code == 403 and "allowlist" in r.json()["detail"]


def test_local_api_core_workflows():
    c, _ = client()
    with c:
        meta = c.get("/api/meta").json()
        assert meta["app"] == "Opening Magician" and meta["ai_commentary"]["required"] is False and len(meta["strategies"]) == 12
        eid = c.get("/api/engines").json()["engines"][0]["id"]
        assert c.post("/api/chess/state", json={"moves": ["e4", "e5", "Ke2"]}).json()["opening"]["name"] == "King's Pawn Game"
        assert c.post("/api/chess/state", json={"moves": ["e4", "Ke2"]}).status_code == 400
        t = c.post("/api/tournaments", json={"format": "round_robin", "players": [{"engine_id": eid}, {"engine_id": eid, "options": {"Seed": 2}}],
                                             "time": {"mode": "noflag", "budget": FAST | {"max_depth": 1}}, "adjudication": {"max_plies": 10},
                                             "reverse_colors": False, "start": True}).json()
        for _ in range(300):
            v = c.get(f"/api/tournaments/{t['id']}").json()
            if v["status"] == "completed":
                break
            time.sleep(0.1)
        assert v["status"] == "completed" and v["overview"]["games"] == 1 and "[Event" in c.get(f"/api/tournaments/{t['id']}/pgn").text
        study = c.post(f"/api/tournaments/{t['id']}/to_study").json()
        assert len(study["chapters"]) == 1
        books = c.get("/api/books").json()
        ref = next(b for b in books if b["name"].endswith("Reference"))
        assert c.get(f"/api/books/{ref['id']}/export?format=bin").content[:0] == b"" and len(c.get(f"/api/books/{ref['id']}/export?format=bin").content) % 16 == 0
        up = c.post("/api/books/import?name=Mine", files={"file": ("x.pgn", b"1. e4 c5 (1... e5) 2. Nf3 *")}).json()
        assert up["format"] == "pgn" and up["import"]["moves"] == 4
        assert c.post("/api/books/import", files={"file": ("x.ctg", b"zz")}).status_code == 400
        tree = c.get(f"/api/books/{up['book']['id']}/tree?depth=3").json()
        assert [n["san"] for n in tree["root"]["children"][0]["children"]] == ["c5", "e5"]
        hw = c.post("/api/hw/connect", json={"simulator": True, "model": "move", "step_time": 0.02}).json()
        assert hw["robot"]["state"] == "ready" and hw["robot"]["simulated"]
        plan = c.post("/api/hw/robot/plan", json={"fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"}).json()
        c.post("/api/hw/robot/confirm", json={"op_id": plan["operation"]["id"]})
        for _ in range(100):
            if c.get("/api/hw").json()["robot"]["state"] == "completed":
                break
            time.sleep(0.05)
        assert c.get("/api/hw").json()["device"]["board_fen"].startswith("rnbqkbnr/pppppppp/8/8/4P3")
        assert c.put("/api/hw/profile", json={"robot_verified": True}).status_code == 400      # checklist confirmation required
        pkg = c.get("/api/package/export")
        assert pkg.status_code == 200 and pkg.content[:2] == b"PK"
        assert c.post("/api/package/restore", files={"file": ("p.omproj", pkg.content)}).status_code == 400   # needs confirm=true

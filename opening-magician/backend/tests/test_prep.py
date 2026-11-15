"""The ten grandmaster-preparation features: dossier, leaks, practical scoring, coverage, move orders,
structures, preparation file and refutation watch, goal repertoires, drills, endgame links."""
import asyncio

import chess
import pytest

from conftest import FAST
from om import openings
from om.books.model import Book, import_pgn
from om.chessx import pos_key
from om.engines.manager import EngineSpec
from om.engines.search import Budget
from om.learn.training import Trainer
from om.prep import Prep, PrepEngine, PrepError
from om.prep import online
from om.prep.structures import classify_structure, endgame_type, naturalness

ITALIAN = "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Na5 6. Bb5+ c6 7. dxc6 bxc6 8. Be2 h6 9. Nf3 e4 10. Ne5 Bd6"
NAJDORF = "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be2 e5 7. Nb3 Be7"
QGD = "1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 h6 7. Bh4 b6"


def game(white, black, result, moves, date="2025.03.01"):
    return f'[Event "t"]\n[Date "{date}"]\n[White "{white}"]\n[Black "{black}"]\n[Result "{result}"]\n\n{moves} {result}\n'


RIVAL_PGN = "\n".join(
    [game("Rival", f"Opp{i}", r, ITALIAN) for i, r in enumerate(["0-1", "0-1", "0-1", "1/2-1/2"])]
    + [game("Rival", f"Sic{i}", "1-0", NAJDORF) for i in range(3)]
    + [game(f"W{i}", "Rival", r, QGD) for i, r in enumerate(["1/2-1/2", "0-1", "1-0"])])


@pytest.fixture
def prep(db, books):
    return Prep(db, books, Trainer(db, books))


def test_collection_import_builds_two_game_books(prep, books, db):
    c = prep.import_collection("Rival 2025", RIVAL_PGN)
    assert c["player"] == "Rival" and c["stats"]["games"] == 10                       # the player is detected as the most frequent name
    assert c["stats"]["white"] == {"wins": 3, "draws": 1, "losses": 3} and c["stats"]["black"] == {"wins": 1, "draws": 1, "losses": 1}
    wb = books.head(c["white_book_id"])
    root = {m["san"]: m for m in wb.moves_at(chess.Board())}
    assert set(root) == {"e4"} and root["e4"]["games"] == 7 and (root["e4"]["w"], root["e4"]["d"], root["e4"]["l"]) == (3, 1, 3)
    assert books.info(c["white_book_id"])["profile"] == "opponent"
    assert db.scalar("SELECT COUNT(*) FROM games WHERE json_extract(meta,'$.collection_id')=?", (c["id"],)) == 10
    with pytest.raises(PrepError, match="Players in this file"):
        prep.import_collection("x", RIVAL_PGN, player="Nobody")
    prep.delete_collection(c["id"])
    assert not prep.collections() and db.scalar("SELECT COUNT(*) FROM games") == 0


def test_dossier_finds_habits_weak_spots_and_theory_exits(prep):
    c = prep.import_collection("Rival", RIVAL_PGN)
    d = prep.dossier(c["id"])
    w = d["sides"]["white"]
    assert w["first_moves"][0] == {"san": "e4", "games": 7, "share": 1.0, "score": 0.5}
    assert any(h["san"] == "e4" and h["share"] == 1.0 for h in w["habits"])
    weak = {x["san"] for x in w["weak_moves"]}
    assert {"Bc4", "Ng5"} <= weak and "e4" not in weak                               # 0.5/4 with the Italian, but 1.e4 itself is fine
    assert any(x["san"] == "Nf6" and "3–1–0" in x["why"] for x in w["struggles_against"])
    assert any(x["san"] == "Be2" and x["games"] == 3 for x in w["leaves_theory"])     # 6.Be2 is not in the reference book
    assert w["main_lines"][0]["games"] >= 3 and "1.e4" in w["main_lines"][0]["line"]
    b = d["sides"]["black"]
    assert b["first_moves"][0]["against"] == "d4" and b["first_moves"][0]["replies"][0]["san"] == "d5"
    assert "not a novelty in chess theory" in d["note"]


def test_prep_sheet_follows_their_habits_and_aims_at_weak_moves(prep, books):
    c = prep.import_collection("Rival", RIVAL_PGN)
    sheet = prep.prep_sheet(c["id"], "black")
    assert sheet["line"].startswith("1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5")              # ...e5 because Rival scores worst against it
    assert sheet["steps"][0]["who"] == "them" and "7 of 7 games (100%)" in sheet["steps"][0]["why"]
    assert "scored 3–1–0 against them" in sheet["steps"][1]["why"] or "3–1–0" in sheet["steps"][1]["why"]
    assert any("3.Bc4" in t for t in sheet["targets"]) and not sheet["used_repertoire"]
    mine = Book()
    b = chess.Board()
    for s in ["e4", "c5"]:
        mine.add_move(b, b.parse_san(s))
        b.push_san(s)
    rep = books.create("My Sicilian", mine, target_color="black")
    sheet2 = prep.prep_sheet(c["id"], "black", rep["id"])
    assert sheet2["line"].startswith("1.e4 c5") and sheet2["used_repertoire"] and "your repertoire move" in sheet2["steps"][1]["why"]
    white = prep.prep_sheet(c["id"], "white")
    assert white["line"].startswith("1.d4 d5 2.c4 e6")


def test_leak_finder_and_cards(prep, books, db):
    rep, _ = import_pgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 *")
    book = books.create("My Ruy", rep, target_color="white")
    me = "\n".join([game("Me", "A", "0-1", "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6"), game("Me", "B", "0-1", "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. d3 Be7"),
                    game("Me", "C", "1-0", "1. e4 e5 2. Nf3 d6 3. d4 exd4 4. Nxd4 Nf6"), game("Me", "D", "1-0", "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7")])
    c = prep.import_collection("My games", me, kind="me")
    out = prep.leaks(c["id"], book["id"])
    assert out["games"] == 4 and len(out["leaks"]) == 1
    leak = out["leaks"][0]
    assert (leak["played"], leak["expected"], leak["count"], leak["score"], leak["line"]) == ("Bc4", "Bb5", 2, 0.0, "1.e4 e5 2.Nf3 Nc6")
    assert out["surprises"][0]["played"] == "d6" and out["surprises"][0]["count"] == 1
    assert out["avg_book_depth"] == round((4 + 4 + 3 + 8) / 4, 1)      # plies followed before leaving the book
    cards = prep.leaks_to_cards(c["id"], book["id"])
    assert cards["added"] == 1
    card = db.all("cards", "deck=?", (cards["deck"],))[0]
    assert card["san"] == "Bb5" and "You played Bc4 here in 2 game(s)" in card["note"]
    assert prep.leaks_to_cards(c["id"], book["id"])["added"] == 0


def test_coverage_audit_reports_holes_by_frequency(prep, books):
    rep, _ = import_pgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 *")
    book = books.create("Narrow", rep, target_color="white")
    out = prep.coverage(book["id"], "white")
    assert 0 < out["coverage"] < 0.6 and out["hole_count"] >= 4
    lines = {h["line"]: h for h in out["holes"]}
    assert "1.e4 c5" in lines and "1.e4 e6" in lines and lines["1.e4 c5"]["opening"] == "Sicilian Defense"
    assert lines["1.e4 c5"]["outside_repertoire"] and lines["1.e4 c5"]["common_replies"]
    assert abs(sum(h["mass"] for h in out["holes"]) + out["coverage"] - 1) < 0.02
    full = books.create("Everything", openings.reference_book(), target_color="white")
    assert prep.coverage(full["id"], "white")["coverage"] == 1.0                      # the reference book covers itself
    assert out["holes"] == sorted(out["holes"], key=lambda h: -h["mass"])


def test_move_order_finder_only_returns_real_transpositions(prep):
    out = prep.move_orders("1.d4 d5 2.c4 e6 3.Nc3 Nf6".split())
    assert out["opening"] == "Queen's Gambit Declined" and out["found"] >= 3 and out["search_complete"]
    canon = out["canonical"]["uci"]
    for o in out["orders"]:
        b = chess.Board()
        for u in o["uci"]:
            b.push_uci(u)                                                             # raises if any move is illegal
        assert b.fen().split(" ")[0] == out["target_fen"].split(" ")[0] and o["uci"] != canon
        assert sorted(o["uci"][0::2]) == sorted(canon[0::2]) and sorted(o["uci"][1::2]) == sorted(canon[1::2])
        assert 0 <= o["stays_on_course"] <= 1
    assert any(o["line"].startswith("1.d4 Nf6") for o in out["orders"])
    assert out["orders"] == sorted(out["orders"], key=lambda d: (-d["stays_on_course"], d["alternative_mass"]))
    with pytest.raises(PrepError):
        prep.move_orders(["e4", "e5"])


def test_structure_and_endgame_classification():
    S = lambda fen: classify_structure(chess.Board(fen))
    assert S("rnbqkb1r/pp3ppp/4pn2/2ppP3/3P4/2P2N2/PP3PPP/RNBQKB1R b KQkq - 0 5") == "french_chain"
    assert S("r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2N2N2/PP2BPPP/R1BQ1RK1 w - - 0 10") == "iqp_white"
    assert S("r1bq1rk1/pp1nbppp/2p2n2/3p2B1/3P4/2NBP3/PPQ2PPP/R3K1NR w KQ - 0 9") == "carlsbad"
    assert S("r1bq1rk1/ppp1npbp/3p2p1/3Pp3/2P1P3/2N2N2/PP2BPPP/R1BQ1RK1 w - - 0 9") == "kid_chain"
    assert S("rnbq1rk1/pp3pbp/3p1np1/2pP4/4P3/2N2N2/PP2BPPP/R1BQK2R b KQ - 0 8") == "benoni"
    assert S(chess.STARTING_FEN) == "other"
    E = lambda fen: endgame_type(chess.Board(fen))
    assert E(chess.STARTING_FEN) is None
    assert E("8/5pk1/6p1/8/8/6P1/5PK1/8 w - - 0 1") == "pawn"
    assert E("8/5pk1/6p1/8/3r4/6P1/5PK1/3R4 w - - 0 1") == "rook"
    assert E("8/5pk1/3b2p1/8/8/4B1P1/5PK1/8 w - - 0 1") == "bishops_same"            # d6 and e3 are both dark squares
    assert E("8/5pk1/4b1p1/8/8/4B1P1/5PK1/8 w - - 0 1") == "bishops_opposite"        # e6 is light, e3 is dark
    assert E("8/5pk1/4n1p1/8/8/3B2P1/5PK1/8 w - - 0 1") == "bishop_vs_knight"
    assert E("3q4/5pk1/6p1/8/8/6P1/5PK1/3Q4 w - - 0 1") == "queen"
    b = chess.Board()
    assert naturalness(b, b.parse_san("Nf3")) > naturalness(b, b.parse_san("a4"))


def test_structures_from_a_book_and_plan_tasks(prep, books, db):
    book = books.create("Ref", openings.reference_book())
    out = prep.structures(book["id"], "white")
    ids = {s["id"] for s in out["structures"]}
    assert {"french_chain", "kid_chain"} <= ids and all(s["lines"] and s["white"] and s["black"] for s in out["structures"])
    task = prep.plan_task("french_chain", seed=3)
    assert len(task["options"]) == 4 and "French pawn chain" in task["prompt"]
    assert classify_structure(chess.Board(task["fen"])) == "french_chain"
    wrong = prep.trainer.check(task["id"], {"value": "nonsense"})
    assert not wrong["correct"] and wrong["answer"] in task["options"]
    assert prep.model_games("french_chain") == []                                      # no long decisive games imported yet
    with pytest.raises(PrepError):
        prep.model_games("nonexistent")


def test_model_games_are_found_among_imported_decisive_games(prep):
    # a closed French that shuffles for 40+ plies keeps its pawn chain: decisive -> model game, drawn -> not
    french = ("1. e4 e6 2. d4 d5 3. e5 c5 4. c3 Nc6 5. Nf3 Qb6 6. Be2 Nge7 7. O-O Nf5 8. Kh1 Be7 9. Kg1 O-O 10. Kh1 Kh8 "
              "11. Kg1 Kg8 12. Kh1 Bd7 13. Kg1 Rac8 14. Kh1 Rfd8 15. Kg1 Be8 16. Kh1 Bf8 17. Kg1 Be7 18. Kh1 Bf8 19. Kg1 Be7 20. Kh1 Bf8 21. Kg1 Be7")
    prep.import_collection("Masters", game("Alpha", "Beta", "1-0", french) + "\n" + game("Gamma", "Delta", "1/2-1/2", french), kind="reference")
    found = prep.model_games("french_chain")
    assert [(g["white"], g["result"]) for g in found] == [("Alpha", "1-0")]
    assert found[0]["ply"] == 24 and classify_structure(chess.Board(found[0]["fen"])) == "french_chain"
    assert prep.plan_task("french_chain", seed=1)["origin"] == "Alpha – Beta"


def test_event_caps_review_intervals_as_the_date_approaches(prep, db):
    t = prep.trainer
    exch = next(o["id"] for o in openings.catalog() if o["name"] == "Ruy Lopez: Exchange Variation")
    deck = t.build_deck_from_opening(exch, "white")["deck"]
    assert t.event_cap(deck) is None
    import time
    evs = prep.save_event("Club championship", time.time() + 8 * 86400, [deck])
    assert evs[0]["days_left"] == pytest.approx(8, abs=0.1) and evs[0]["interval_cap_days"] == 2.0 and evs[0]["decks_status"][0]["cards"] == 4
    assert t.event_cap(deck) == pytest.approx(2.0, abs=0.05)
    card = db.all("cards", "deck=?", (deck,))[0]
    db.update("cards", card["id"], {"reps": 4, "interval_days": 30.0, "ease": 2.6})    # a mature card would normally jump to ~78 days
    res = t.answer(card["id"], card["move_uci"], 2000)
    assert res["correct"] and res["interval_days"] == pytest.approx(2.0, abs=0.05)
    other = t.build_deck_from_opening(exch, "black")["deck"]
    assert t.event_cap(other) is None                                                   # only decks marked for the event are affected
    assert prep.save_event("Past", time.time() - 86400, [deck])[0]["past"] is True
    assert t.event_cap(deck) == pytest.approx(2.0, abs=0.05)                            # past events impose nothing
    assert len(prep.delete_event(evs[0]["id"])) == 1 and t.event_cap(deck) is None


def test_goal_repertoires_choose_by_draw_or_win_evidence(prep, books):
    b = Book()
    root = chess.Board()
    solid = b.add_move(root, root.parse_san("d4"))
    solid.update({"games": 100, "w": 30, "d": 60, "l": 10})
    sharp = b.add_move(root, root.parse_san("e4"))
    sharp.update({"games": 100, "w": 50, "d": 15, "l": 35})
    unsound = b.add_move(root, root.parse_san("g4"))
    unsound.update({"games": 100, "w": 34, "d": 2, "l": 64})                            # wins sometimes, but far below the soundness floor
    after = root.copy()
    after.push_san("d4")
    b.add_move(after, after.parse_san("d5"))
    src = books.create("Mixed", b, target_color="white")
    draw = prep.goal_book(src["id"], "white", "draw")
    win = prep.goal_book(src["id"], "white", "win")
    pick = lambda res: list(books.head(res["book"]["id"]).positions[pos_key(chess.Board())]["moves"].items())
    (du, dm), = pick(draw)
    (wu, wm), = pick(win)
    assert du == "d2d4" and "draw 60%" in dm["comment"] and "(results)" in dm["comment"]
    assert wu == "e2e4" and "win 50%" in wm["comment"]
    assert draw["evidence"]["results"] == 1 and draw["warning"] is None and draw["book"]["profile"] == "solid" and win["book"]["profile"] == "aggressive"
    assert books.head(draw["book"]["id"]).contains(after, after.parse_san("d5"))        # opponent replies are kept
    blind = books.create("No data", openings.reference_book(), target_color="white")
    assert "Annotate with engine" in prep.goal_book(blind["id"], "white", "draw")["warning"]
    with pytest.raises(PrepError):
        prep.goal_book(src["id"], "white", "lose")


def test_drill_material(prep, books):
    book = books.create("Ref", openings.reference_book())
    for color in ("white", "black"):
        s = prep.survival_start(book["id"], color, seed=5)
        b = chess.Board()
        for u in s["moves"]:
            b.push_uci(u)
        assert b.fen() == s["fen"] and len(s["moves"]) >= 3
        assert (b.turn == chess.WHITE) != (color == "white")                           # the opponent is to move: your book has just ended
    r = prep.recital(opening_id=next(o["id"] for o in openings.catalog() if o["name"] == "Ruy Lopez: Marshall Attack"))
    assert r["sans"][:5] == ["e4", "e5", "Nf3", "Nc6", "Bb5"] and len(r["uci"]) == len(r["sans"]) == 22
    assert len(prep.recital(book_id=book["id"], seed=2)["sans"]) >= 8


def test_endgames_are_linked_to_openings(prep):
    rook_ending = ("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 5. d4 exd4 6. Qxd4 Qxd4 7. Nxd4 Bd7 8. Be3 O-O-O 9. Nc3 Bb4 10. O-O-O Bxc3 11. bxc3 Nf6 "
                   "12. f3 Rhe8 13. Bg5 h6 14. Bxf6 gxf6 15. Nf5 Bxf5 16. exf5 Rxd1+ 17. Rxd1 Re5 18. g4 h5 19. h3 hxg4 20. hxg4 Re3 21. Rd3 Re1+ 22. Kd2 Rf1 "
                   "23. Ke2 Rc1 24. Kd2 Rf1 25. Ke2 Rc1")
    c = prep.import_collection("Me", game("Me", "X", "1/2-1/2", rook_ending) + "\n" + game("Me", "Y", "1-0", ITALIAN), kind="me")
    out = prep.endgames(c["id"])
    assert out["games"] == 2 and out["reached_endgame"] == 1
    row = out["by_opening"][0]
    assert (row["opening"], row["type"], row["games"], row["score"]) == ("Ruy Lopez", "rook", 1, 0.5)
    ex = row["examples"][0]
    assert endgame_type(chess.Board(ex["fen"])) == "rook" and ex["ply"] > 30 and ex["player_color"] == "white"
    assert out["by_type"][0]["tips"] and "Lucena" in " ".join(out["by_type"][0]["tips"])
    assert "White's score" in prep.endgames()["note"]


def test_online_import_validates_usernames_without_touching_the_network():
    for bad in ("", "a b", "../../etc", "x" * 60, "name?max=9"):
        with pytest.raises(online.OnlineError):
            online._clean(bad)
    assert online._clean("  Some-Player_1 ") == "Some-Player_1"
    with pytest.raises(online.OnlineError):
        asyncio.run(online.fetch("myspace", "player"))


# ------------------------------------------------------------------ engine-backed tasks
B = Budget.from_dict(FAST)


async def test_practical_scoring_counts_only_moves(prep, engines):
    pe = PrepEngine(prep, engines)
    out = await pe.practical("e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#".split(), None, "white", EngineSpec(engines.bundled_id), B, asyncio.Event(), lambda f: None)
    assert len(out["rows"]) == 7 and out["rows"][6]["only_move"] and out["rows"][6]["best_san"] == "Qxf7#" and out["rows"][6]["is_best"]
    assert out["only_moves"]["white"] >= 1 and 0 <= out["practical_score"] <= 1 and "only-move" in out["summary"]
    assert out["rows"][0]["findability_source"] == "heuristic" and out["engine_expected_for_me"] == 1.0
    ref = prep.books.create("Humans", openings.reference_book())
    root = prep.books.load(ref["id"])
    for m in root.positions[pos_key(chess.Board())]["moves"].values():
        m["games"] = 10
    prep.books.commit(ref["id"], root, "counts")
    out2 = await pe.practical(["e4"], None, "white", EngineSpec(engines.bundled_id), B, asyncio.Event(), lambda f: None, ref["id"])
    assert "human games" in out2["rows"][0]["findability_source"]


async def test_refutation_watch_alerts_when_an_evaluation_moves(prep, engines, books, db):
    rep, _ = import_pgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 *")
    book = books.create("Rep", rep, target_color="white")
    pe = PrepEngine(prep, engines)
    first = await pe.watch(book["id"], "white", EngineSpec(engines.bundled_id), B, asyncio.Event(), lambda f: None)
    assert first == {"checked": 3, "alerts": 0} and len(prep.alerts(book["id"])) == 3
    row = next(w for w in prep.alerts() if w["san"] == "Bb5")
    assert row["line"] == "1.e4 e5 2.Nf3 Nc6" and row["baseline"]["depth"] == 2 and row["alert"] is None
    inflated = {**row["baseline"], "score": {**row["baseline"]["score"], "cp": 400, "text": "+4.00", "expected": 0.81}}
    db.update("watch", row["id"], {"baseline": inflated})                          # pretend an older, shallower search had loved the move
    second = await pe.watch(book["id"], "white", EngineSpec(engines.bundled_id), B, asyncio.Event(), lambda f: None)
    assert second["alerts"] == 1
    flagged = prep.alerts(book["id"])[0]                                           # alerts sort first
    assert flagged["san"] == "Bb5" and flagged["alert"].startswith("dropped from +4.00") and len(flagged["history"]) == 2
    pe.rebase_watch(flagged["id"])
    assert all(w["alert"] is None for w in prep.alerts(book["id"]))


async def test_annotation_dossier_check_and_leak_costs(prep, engines, books):
    pe = PrepEngine(prep, engines)
    spec = EngineSpec(engines.bundled_id)
    rep, _ = import_pgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *")
    book = books.create("Rep", rep, target_color="white")
    res = await pe.annotate(book["id"], "white", spec, B, asyncio.Event(), lambda f: None)
    assert res["annotated"] == 3 and books.info(book["id"])["head_version"] == 2
    e4 = books.head(book["id"]).positions[pos_key(chess.Board())]["moves"]["e2e4"]
    assert e4["eval"]["cp"] is not None and e4["eval"]["depth"] == 2 and "Apprentice" in e4["eval"]["engine"]
    assert "did not report win/draw/loss" in res["note"]
    goal = prep.goal_book(book["id"], "white", "draw")
    assert goal["evidence"]["evaluation"] == 3 and goal["warning"] is None
    c = prep.import_collection("Rival", RIVAL_PGN)
    chk = await pe.check_dossier(c["id"], spec, B, asyncio.Event(), lambda f: None, top=6)
    assert chk["checked"] == 6 and prep.collection(c["id"])["stats"]["engine_checked"]["moves"] == 6
    assert isinstance(prep.dossier(c["id"])["engine_flags"], list)
    me = prep.import_collection("Me", game("Me", "A", "0-1", "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5"), kind="me")
    lc = await pe.leak_costs(me["id"], book["id"], spec, B, asyncio.Event(), lambda f: None)
    assert lc["evaluated"] == 1
    leak = prep.leaks(me["id"], book["id"])["leaks"][0]
    assert leak["engine"]["verdict"] in ("your move was worse", "about equal", "your move was better — consider updating the repertoire")
    assert leak["engine"]["played"] and leak["engine"]["repertoire"]

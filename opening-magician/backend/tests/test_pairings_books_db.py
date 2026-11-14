import io
import itertools

import chess
import chess.polyglot
import pytest

from om import openings
from om.books import model as bm
from om.books.model import Book, BookError
from om.db import SCHEMA_VERSION, Database
from om.package import export_package, inspect_package, restore_package
from om.tournament import pairings, stats

P4 = ["A", "B", "C", "D"]


# ------------------------------------------------------------------ pairings
@pytest.mark.parametrize("n", [3, 4, 5, 6, 8])
def test_round_robin_everyone_meets_once(n):
    ps = [f"E{i}" for i in range(n)]
    rounds = pairings.round_robin(ps)
    games = [g for r in rounds for g in r]
    assert {frozenset(g) for g in games} == {frozenset(c) for c in itertools.combinations(ps, 2)}
    assert len(games) == n * (n - 1) // 2
    for r in rounds:                                   # nobody plays twice in a round
        flat = [p for g in r for p in g]
        assert len(flat) == len(set(flat))
    whites = {p: sum(1 for w, _ in games if w == p) for p in ps}
    assert max(whites.values()) - min(whites.values()) <= 2


def test_double_round_robin_reverses_colours():
    games = [g for r in pairings.round_robin(P4, cycles=1, reverse_colors=True) for g in r]
    assert len(games) == 12
    for a, b in itertools.combinations(P4, 2):
        assert (a, b) in games and (b, a) in games
    two_cycles = [g for r in pairings.round_robin(P4, cycles=2) for g in r]
    assert sorted(two_cycles[:6]) == sorted((b, a) for a, b in two_cycles[6:])


def test_gauntlet_and_knockout_bracket():
    g = [x for r in pairings.gauntlet("A", ["B", "C"], 2, True) for x in r]
    assert g == [("A", "B"), ("A", "C"), ("B", "A"), ("C", "A")]
    assert pairings.seeded_bracket(list("12345678")) == [("1", "8"), ("4", "5"), ("2", "7"), ("3", "6")]
    five = pairings.seeded_bracket(list("12345"))
    assert ("1", None) in five and ("4", "5") in five and sum(1 for a, b in five if b is None) == 3   # top seeds get the byes
    assert pairings.knockout_round_name(1) == "Final"


def test_swiss_avoids_rematches_assigns_byes_and_balances_colours():
    players = ["A", "B", "C", "D", "E"]
    scores = {p: 0.0 for p in players}
    played, hist, byes = set(), {p: [] for p in players}, set()
    for rnd in range(4):
        res = pairings.swiss_round(players, scores, played, hist, byes)
        assert res["bye"] is not None and res["bye"] not in byes          # a new player gets the bye each round
        byes.add(res["bye"])
        scores[res["bye"]] += 1
        assert len(res["pairs"]) == 2
        for w, b in res["pairs"]:
            assert frozenset((w, b)) not in played
            played.add(frozenset((w, b)))
            hist[w].append("w")
            hist[b].append("b")
            scores[w] += 1                                                # white always wins: forces score groups apart
    for p in players:
        h = hist[p]
        assert not any(h[i] == h[i + 1] == h[i + 2] for i in range(len(h) - 2)), (p, h)
    # top scorers meet when they have not played yet
    res = pairings.swiss_round(P4, {"A": 2, "B": 2, "C": 0, "D": 0}, {frozenset("AC"), frozenset("BD")}, {p: [] for p in P4}, set())
    assert frozenset(("A", "B")) in {frozenset(p) for p in res["pairs"]}
    assert pairings.color_pref(["w", "w"]) == -2 and pairings.color_pref(["b"]) == 1


# ------------------------------------------------------------------ statistics
def test_standings_tiebreaks_and_uncertainty():
    games = [{"white": "A", "black": "B", "result": "1-0"}, {"white": "C", "black": "A", "result": "1-0"},
             {"white": "B", "black": "C", "result": "1-0"}, {"white": "A", "black": "D", "result": "1-0"},
             {"white": "D", "black": "B", "result": "0-1"}, {"white": "C", "black": "D", "result": "1/2-1/2"}]
    table = stats.standings(P4, games)
    assert [r["points"] for r in table] == [2.0, 2.0, 1.5, 0.5]
    assert table[0]["player"] == "A"                    # A beat B in the direct encounter
    assert table[0]["sonneborn_berger"] == 2.5 and table[0]["buchholz"] == 4.0
    small = stats.wdl_summary(3, 1, 0)
    assert small["warning"] and "small sample" in small["warning"]
    big = stats.wdl_summary(60, 30, 10)
    assert big["elo_low"] < big["elo"] < big["elo_high"] and big["los"] > 0.99 and big["elo"] > 150
    assert stats.wdl_summary(0, 0, 0)["games"] == 0 and stats.elo_from_score(0.5) == 0
    ov = stats.overview([{**g, "plies": 40, "termination": "checkmate", "opening": "X"} for g in games])
    assert ov["games"] == 6 and ov["openings"][0]["note"] == "too few games to compare" and ov["limitations"]


# ------------------------------------------------------------------ opening books
PGN = """[Event "a"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 (2... Nf6 {Petrov} 3. Nxe5) 3. Bb5 1-0\n
[Event "b"]\n[Result "0-1"]\n\n1. Nf3 Nc6 2. e4 e5 3. Bc4 0-1\n"""


def test_pgn_import_keeps_variations_and_merges_transpositions():
    book, st = bm.import_pgn(PGN)
    assert st["games"] == 2
    b = chess.Board()
    assert {m["san"] for m in book.moves_at(b)} == {"e4", "Nf3"}
    for s in "e4 e5 Nf3 Nc6".split():
        b.push_san(s)
    here = {m["san"]: m for m in book.moves_at(b)}          # reached by two different move orders -> ONE node
    assert set(here) == {"Bb5", "Bc4"} and here["Bb5"]["w"] == 1 and here["Bc4"]["l"] == 1
    b2 = chess.Board()
    for s in "e4 e5 Nf3".split():
        b2.push_san(s)
    side = {m["san"]: m for m in book.moves_at(b2)}
    assert side["Nf6"]["status"] == "side" and side["Nf6"]["comment"] == "Petrov" and side["Nf6"]["weight"] < side["Nc6"]["weight"]
    with pytest.raises(BookError):
        book.add_move(chess.Board(), chess.Move.from_uci("e2e5"))


def test_polyglot_export_is_readable_by_an_independent_reader(tmp_path):
    ref = openings.reference_book()
    data = bm.export_polyglot(ref)
    path = tmp_path / "ref.bin"
    path.write_bytes(data)
    with chess.polyglot.open_reader(path) as reader:        # python-chess' own Polyglot implementation
        root = {e.move.uci() for e in reader.find_all(chess.Board())}
        assert root == set(ref.positions[bm.pos_key(chess.Board())]["moves"])
        b = chess.Board()
        for s in "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6".split():
            b.push_san(s)
        assert "e1g1" in {e.move.uci() for e in reader.find_all(b)}     # castling decoded back from "king takes rook"
    back, st = bm.import_polyglot(data)
    assert st["entries_imported"] == st["entries_in_file"] == ref.stats()["moves"] and st["entries_unreachable"] == 0
    with pytest.raises(BookError):
        bm.import_polyglot(b"12345")


def test_other_formats_roundtrip_and_unsupported_are_refused():
    ref = openings.reference_book()
    n = ref.stats()["moves"]
    assert bm.import_json(bm.export_json(ref))[1]["moves"] == n
    assert bm.import_csv(bm.export_csv(ref))[1]["moves"] == n
    assert bm.import_pgn(bm.export_pgn(ref, max_ply=40))[1]["moves"] == n
    epd_book, st = bm.import_epd(bm.export_epd(ref))
    assert st["records"] > 250 and st["moves_added"] > 300
    fens, st2 = bm.import_epd("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1\nnot a fen\n")
    assert st2["records"] == 1 and st2["unparseable"] == 1
    for ext in (".ctg", ".abk"):
        with pytest.raises(BookError, match="not supported directly"):
            bm.import_any("book" + ext, b"x")
    with pytest.raises(BookError, match="header"):
        bm.import_csv("a,b\n1,2\n")
    _, st3, fmt = bm.import_any("x.csv", b"fen,move,weight\n" + chess.STARTING_FEN.encode() + b",e4,3\n" + chess.STARTING_FEN.encode() + b",e9,1\n")
    assert fmt == "csv" and st3["rows"] == 1 and st3["rejected_rows"] == 1


def test_book_operations():
    ref = openings.reference_book()
    white = ref.filtered(color="white", top_n=1, max_ply=10)
    b = chess.Board()
    assert len(white.moves_at(b)) == 1
    b.push_uci(white.moves_at(b)[0]["uci"])
    assert len(white.moves_at(b)) > 1                        # opponent replies are all kept
    e4 = chess.Board()
    e4.push_san("e4")
    sub = ref.subtree(e4)
    assert sub.root_fen == e4.fen() and 0 < sub.stats()["moves"] < ref.stats()["moves"]
    other = Book()
    other.add_move(chess.Board(), chess.Move.from_uci("a2a3"), weight=5)
    assert ref.copy().merge(other)["moves_added"] == 1
    bad = ref.copy()
    bad.positions[bm.pos_key(chess.Board())]["moves"]["e2e5"] = bm.new_move("??")
    assert bad.dedupe()["removed"] == 1
    lines = ref.sample_lines(6, 4, seed=3)
    assert len(lines) == 4 and lines == ref.sample_lines(6, 4, seed=3)      # seeded = reproducible
    few = Book()
    m = few.add_move(chess.Board(), chess.Move.from_uci("e2e4"))
    m.update({"games": 2, "w": 2})
    n = few.add_move(chess.Board(), chess.Move.from_uci("d2d4"))
    n.update({"games": 200, "w": 110, "d": 60, "l": 30})
    few.reweight("evidence")
    ms = {x["san"]: x["weight"] for x in few.moves_at(chess.Board())}
    assert ms["d4"] > ms["e4"]                               # 2/2 wins must not outrank 200 solid games


def test_book_versioning_is_reversible(books):
    info = books.create("Rep", openings.reference_book())
    bid = info["id"]
    v2 = books.edit_move(bid, chess.STARTING_FEN, "a3", weight=2.0, status="candidate")
    assert v2["version"] == 2 and v2["changes"]["added"] == 1 and v2["changes"]["added_sample"][0]["san"] == "a3"
    v3 = books.edit_move(bid, chess.STARTING_FEN, "e4", action="remove")
    assert v3["changes"]["removed"] == 1
    assert "e2e4" not in books.head(bid).positions[bm.pos_key(chess.Board())]["moves"]
    v4 = books.restore(bid, 1)
    assert v4["version"] == 4 and "e2e4" in books.head(bid).positions[bm.pos_key(chess.Board())]["moves"]
    assert [v["version"] for v in books.info(bid)["versions"]] == [4, 3, 2, 1]      # nothing was deleted
    assert books.compare(bid, 1, bid, 4)["added"] == 0
    assert books.weak_branches(bid)


def test_proposals_need_human_approval(books):
    bid = books.create("Expl", profile="exploration")["id"]
    f = {"id": "f1", "fen": chess.STARTING_FEN, "move_uci": "b2b3", "move_san": "b3", "line_san": "1.b3", "category": "viable_alternative",
         "status": "promising", "scores": {"objective_viability": {"value": 0.8}, "research_confidence": {"value": 0.6}}}
    props = books.propose_from_findings(bid, [f])
    assert len(props) == 1 and props[0]["state"] == "pending" and props[0]["type"] == "add"
    assert books.info(bid)["head_version"] == 1 and not books.head(bid).contains(chess.Board(), chess.Move.from_uci("b2b3"))
    assert len(books.propose_from_findings(bid, [f])) == 1          # no duplicates
    res = books.decide_proposals(bid, {props[0]["id"]: "approve"})
    assert res["applied"] == ["b3"] and res["version"] == 2
    mv = books.head(bid).positions[bm.pos_key(chess.Board())]["moves"]["b2b3"]
    assert mv["status"] == "candidate" and mv["finding_id"] == "f1"
    assert books.info(bid)["versions"][0]["evidence"][0]["finding_id"] == "f1"


# ------------------------------------------------------------------ database
def test_schema_transactions_and_recovery(tmp_path):
    path = tmp_path / "x.sqlite3"
    db = Database(path)
    assert db.schema_version == SCHEMA_VERSION and db.integrity() == "ok"
    assert db.scalar("PRAGMA journal_mode") == "wal" and db.scalar("PRAGMA foreign_keys") == 1
    with pytest.raises(RuntimeError):
        with db.tx():
            db.insert("studies", {"id": "s1", "title": "t", "created_at": 1, "updated_at": 1})
            db.insert("chapters", {"id": "c1", "study_id": "s1", "title": "c", "pgn": "", "updated_at": 1})
            raise RuntimeError("crash mid-transaction")
    assert db.scalar("SELECT COUNT(*) FROM studies") == 0 and db.scalar("SELECT COUNT(*) FROM chapters") == 0
    import sqlite3
    with pytest.raises(sqlite3.IntegrityError):                       # foreign keys are enforced
        db.insert("chapters", {"id": "c2", "study_id": "nope", "title": "c", "pgn": "", "updated_at": 1})
    db.insert("studies", {"id": "s1", "title": "t", "tags": ["a"], "created_at": 1, "updated_at": 1})
    db.set_pref("k", {"a": [1, 2]})
    db.close()
    again = Database(path)                                            # reopen: data and schema version persist
    assert again.get("studies", "s1")["tags"] == ["a"] and again.pref("k") == {"a": [1, 2]} and again.schema_version == SCHEMA_VERSION
    again.close()


def test_migration_from_older_schema(tmp_path):
    import sqlite3
    path = tmp_path / "old.sqlite3"
    from om import db as dbmod
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    for stmt in dbmod._split(dbmod.MIGRATIONS[1]):
        con.execute(stmt)
    con.execute("INSERT INTO schema_meta VALUES('version','1')")
    con.execute("INSERT INTO prefs VALUES('keep','1')")
    con.commit()
    con.close()
    d = Database(path)
    assert d.schema_version == SCHEMA_VERSION and d.pref("keep") == 1
    assert d.scalar("SELECT COUNT(*) FROM play_sessions") == 0        # table added by migration 2
    d.close()


def test_project_package_backup_and_restore(tmp_path, books, db):
    bid = books.create("Mine", openings.reference_book())["id"]
    db.insert("games", {"id": "g1", "kind": "import", "pgn": "1. e4 e5 *", "created_at": 1})
    db.insert("studies", {"id": "s1", "title": "Study", "created_at": 1, "updated_at": 1})
    db.insert("chapters", {"id": "c1", "study_id": "s1", "title": "c", "pgn": "1. d4 *", "updated_at": 1})
    pkg = tmp_path / "p.omproj"
    info = export_package(db, books, pkg)
    assert info["manifest"]["counts"]["books"] == 1 and inspect_package(pkg)["format"] == "opening-magician-project"
    import zipfile
    names = zipfile.ZipFile(pkg).namelist()
    assert "database.sqlite3" in names and any(n.startswith("books/") for n in names) and any(n.startswith("studies/") for n in names)
    assert not any(n.endswith((".exe", ".bin")) for n in names)       # no engine binaries are bundled
    books.delete(bid)
    db.delete("games", "g1")
    assert not books.list()
    res = restore_package(db, books, pkg)
    assert res["restored"] and [b["name"] for b in books.list()] == ["Mine"] and db.get("games", "g1")
    assert books.head(bid).stats()["moves"] == openings.reference_book().stats()["moves"]
    bad = tmp_path / "bad.omproj"
    with zipfile.ZipFile(bad, "w") as z:
        z.writestr("x", "y")
    with pytest.raises(ValueError):
        inspect_package(bad)

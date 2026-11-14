"""Real UCI subprocess tests (the bundled engine and fault-injecting variants of it)."""
import asyncio
import sys
import time

import chess
import chess.engine
import pytest

from conftest import FAST, fixture_engine
from om.engines.manager import EngineError, EngineSpec
from om.engines.resources import Limits, ResourceManager
from om.engines.search import AnalysisCache, Budget, adaptive_search, evaluate_move, ranked_candidates

B = Budget.from_dict(FAST)


async def test_handshake_discovers_identity_and_options(engines):
    row = engines.get(engines.bundled_id)
    assert row["status"] == "ok" and "Apprentice" in row["name"] and row["version"] == "1.0"
    assert {"MultiPV", "Skill Level", "Hash"} <= set(row["options"])
    assert row["options"]["MultiPV"]["type"] == "spin" and row["options"]["MultiPV"]["max"] == 64
    with pytest.raises(EngineError, match="not found"):
        await engines.register("/nonexistent/engine")
    with pytest.raises(EngineError):                                  # a real program that does not speak UCI
        await engines.probe([sys.executable, "-c", "print('hello')"], timeout=5)
    with pytest.raises(EngineError):
        engines.remove(engines.bundled_id)


async def test_multipv_lines_are_parsed_and_ordered(engines):
    async with engines.session(EngineSpec(engines.bundled_id), "interactive") as h:
        b = chess.Board()
        lines = await h.analyse(b, chess.engine.Limit(depth=2), multipv=4)
        assert [l["multipv"] for l in lines] == [1, 2, 3, 4]
        assert len({l["move"] for l in lines}) == 4
        for l in lines:
            assert chess.Move.from_uci(l["move"]) in b.legal_moves and l["depth"] == 2 and l["nodes"] > 0 and l["pv_san"]
            assert l["score"]["cp"] is not None and "expected" in l["score"]
        keys = [(l["score"]["cp"]) for l in lines]
        assert keys == sorted(keys, reverse=True)
        mate = await h.analyse(chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"), chess.engine.Limit(depth=2))
        assert mate[0]["score"]["mate"] == 1 and mate[0]["score"]["cp"] is None and mate[0]["san"] == "Ra8#"
        assert h.pid and engines.resources.snapshot()["active"][0]["pid"] == h.pid
    assert engines.resources.snapshot()["active"] == []                # lease released, process gone


async def test_ranked_candidates_are_legal_and_carry_their_evidence(engines):
    async with engines.session(EngineSpec(engines.bundled_id), "research") as h:
        b = chess.Board()
        b.push_san("e4")
        r = await ranked_candidates(h, b, 6, B)
        assert r["method"] == "multipv" and [c["rank"] for c in r["candidates"]] == [1, 2, 3, 4, 5, 6]
        assert all(chess.Move.from_uci(c["move"]) in b.legal_moves for c in r["candidates"])
        assert r["candidates"][0]["loss"]["expected_loss"] == 0 and r["engine_sig"] and r["budget"]["max_depth"] == 2
        assert all(c["loss"]["expected_loss"] >= 0 for c in r["candidates"])
        # fewer legal moves than requested: no fabricated ranks
        few = chess.Board("7k/8/8/8/8/8/8/K6R b - - 0 1")
        r2 = await ranked_candidates(h, few, 5, B)
        assert r2["available"] == few.legal_moves.count() < 5
        assert (await ranked_candidates(h, chess.Board("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"), 3, B))["stop_reason"] == "terminal"


async def test_restricted_root_fallback_when_engine_has_no_multipv(engines):
    row = await fixture_engine(engines, "--no-multipv", name="NoMultiPV")
    assert "MultiPV" not in row["options"]
    async with engines.session(EngineSpec(row["id"]), "research") as h:
        assert h.max_multipv == 1
        b = chess.Board()
        r = await ranked_candidates(h, b, 4, B)
        assert r["method"] == "restricted_root" and len(r["candidates"]) == 4 and len(r["searches"]) == 4
        assert len({c["move"] for c in r["candidates"]}) == 4
        scores = [c["score"]["cp"] for c in r["candidates"]]
        assert scores == sorted(scores, reverse=True)
    async with engines.session(EngineSpec(engines.bundled_id), "research") as ref:
        full = await ranked_candidates(ref, chess.Board(), 4, B)
    assert {c["move"] for c in r["candidates"]} == {c["move"] for c in full["candidates"]}   # same top-4 either way


async def test_engine_that_ignores_searchmoves_does_not_get_fake_ranks(engines):
    row = await fixture_engine(engines, "--no-multipv", "--ignore-searchmoves", name="Stubborn")
    async with engines.session(EngineSpec(row["id"]), "research") as h:
        r = await ranked_candidates(h, chess.Board(), 3, B)
        assert len(r["candidates"]) == 1 and "ignored searchmoves" in r["method"]


async def test_shallow_and_deep_rankings_are_both_recorded(engines):
    async with engines.session(EngineSpec(engines.bundled_id), "research") as h:
        b = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3")
        shallow = await ranked_candidates(h, b, 5, Budget(min_time=0, max_time=1, min_depth=1, max_depth=1))
        deep = await ranked_candidates(h, b, 5, Budget(min_time=0, max_time=3, min_depth=3, max_depth=3))
        assert shallow["depth"] == 1 and deep["depth"] == 3
        mv = chess.Move.from_uci(shallow["candidates"][3]["move"])
        ver = await evaluate_move(h, b, mv, Budget(min_time=0, max_time=3, min_depth=3, max_depth=3), multipv=3)
        assert ver["rank"] is not None and ver["score"] is not None and ver["loss"]["expected_loss"] >= 0
        if not ver["rank_exact"]:
            assert ver["rank"] == 4                  # outside the verifier's window: reported as "at least 4th"


async def test_adaptive_search_stop_reasons(engines):
    async with engines.session(EngineSpec(engines.bundled_id), "research") as h:
        one = await adaptive_search(h, chess.Board("k7/8/1K6/8/8/8/8/7R b - - 0 1"), Budget(min_time=0.05, max_time=5, min_depth=2, max_depth=30))
        assert one["stop_reason"] == "single_legal_move" and one["elapsed"] < 3 and one["lines"][0]["san"] == "Kb8"
        deep = await adaptive_search(h, chess.Board(), Budget(min_time=0, max_time=5, min_depth=1, max_depth=2, adaptive=False))
        assert deep["stop_reason"] == "max_depth" and deep["depth"] == 2
        timed = await adaptive_search(h, chess.Board(), Budget(min_time=0.2, max_time=0.4, min_depth=30, max_depth=40))
        assert timed["stop_reason"] == "max_time" and 0.2 < timed["elapsed"] < 3
        won = await adaptive_search(h, chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"), Budget(min_time=0.0, max_time=5, min_depth=1, max_depth=30))
        assert won["stop_reason"] in ("resolved", "stable") and won["lines"][0]["score"]["mate"] == 1 and won["elapsed"] < 4
        term = await adaptive_search(h, chess.Board("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"), B)
        assert term["stop_reason"] == "terminal" and term["lines"] == []
        assert all(k in ("depth", "move", "score", "t", "order") for k in deep["history"][0])


async def test_search_cancellation(engines):
    async with engines.session(EngineSpec(engines.bundled_id), "research") as h:
        cancel = asyncio.Event()
        asyncio.get_running_loop().call_later(0.3, cancel.set)
        t0 = time.perf_counter()
        r = await adaptive_search(h, chess.Board(), Budget(min_time=20, max_time=30, min_depth=40, max_depth=60), cancel=cancel)
        assert r["stop_reason"] == "cancelled" and time.perf_counter() - t0 < 5
        again = await h.analyse(chess.Board(), chess.engine.Limit(depth=1))     # engine is still usable afterwards
        assert again and not h.closed


async def test_crashing_engine_is_reported_and_cleaned_up(engines):
    row = await fixture_engine(engines, "--crash", name="Crasher")
    h = await engines.open(EngineSpec(row["id"]), "research")
    with pytest.raises(EngineError, match="terminated"):
        await h.analyse(chess.Board(), chess.engine.Limit(depth=2))
    assert h.closed and engines.resources.snapshot()["active"] == []
    assert any("Crasher" in c["engine"] for c in engines.resources.crashes)
    h2 = await engines.open(EngineSpec(row["id"]), "research")
    r = await adaptive_search(h2, chess.Board(), B)
    assert r["stop_reason"] == "engine_failed" and r["lines"] == []
    await h2.close()


async def test_unresponsive_engine_is_terminated_by_the_time_guard(engines):
    row = await fixture_engine(engines, "--hang", name="Hanger")
    h = await engines.open(EngineSpec(row["id"]), "research")
    t0 = time.perf_counter()
    with pytest.raises(EngineError, match="terminated"):
        await h.analyse(chess.Board(), chess.engine.Limit(time=0.1), timeout=1.0)
    assert time.perf_counter() - t0 < 5 and h.closed and engines.resources.snapshot()["active"] == []


async def test_independent_engines_run_side_by_side(engines):
    specs = [EngineSpec(engines.bundled_id, {"Skill Level": 20}), EngineSpec(engines.bundled_id, {"Skill Level": 3, "Seed": 9}),
             EngineSpec(engines.bundled_id, {"Seed": 4})]
    hs = await engines.open_many([(s, "interactive", f"E{i}") for i, s in enumerate(specs)])
    try:
        assert len({h.pid for h in hs}) == 3 and len({h.signature for h in hs}) == 3
        boards = [chess.Board(), chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"), chess.Board("8/8/8/4k3/8/8/4P3/4K3 w - - 0 1")]
        res = await asyncio.gather(*(h.analyse(b, chess.engine.Limit(depth=2)) for h, b in zip(hs, boards)))
        for b, lines in zip(boards, res):
            assert chess.Move.from_uci(lines[0]["move"]) in b.legal_moves
        assert hs[1].options["Skill Level"] == 3
    finally:
        for h in hs:
            await h.close()


async def test_resource_manager_enforces_budgets_and_priorities():
    rm = ResourceManager(Limits(max_engines=2, thread_budget=4, hash_budget_mb=64, per_engine_threads=2, per_engine_hash_mb=32))
    assert rm.clamp(64, 4096) == (2, 32)                       # one engine can never take every thread
    a = await rm.acquire(label="a", purpose="tournament", threads=8, hash_mb=999)
    b = await rm.acquire(label="b", purpose="tournament", threads=2, hash_mb=32)
    assert a.threads == 2 and a.hash_mb == 32 and rm.snapshot()["threads_used"] == 4
    order: list[str] = []

    async def want(label, purpose):
        lease = await rm.acquire(label=label, purpose=purpose)
        order.append(label)
        return lease

    bg = asyncio.create_task(want("background", "background"))
    tr = asyncio.create_task(want("tournament", "tournament"))
    await asyncio.sleep(0.05)
    assert not bg.done() and not tr.done() and len(rm.snapshot()["waiting"]) == 2
    inter = await rm.acquire(label="interactive", purpose="interactive")     # interactive work is never starved
    assert inter.priority == 1
    rm.release(inter)
    rm.release(a)
    await asyncio.sleep(0.05)
    assert order == ["tournament"]                                  # higher priority first, although it queued later
    rm.pause_background(True)
    rm.release(b)
    await asyncio.sleep(0.05)
    assert not bg.done()                                            # paused background research does not start
    rm.pause_background(False)
    await asyncio.sleep(0.05)
    assert bg.done() and order == ["tournament", "background"]


async def test_analysis_cache_deduplicates_by_position_and_engine(engines, db):
    cache = AnalysisCache(db)
    async with engines.session(EngineSpec(engines.bundled_id), "research") as h:
        a, b = chess.Board(), chess.Board()
        for u in ("g1f3", "d7d5", "d2d4"):
            a.push_uci(u)
        for u in ("d2d4", "d7d5", "g1f3"):
            b.push_uci(u)
        r = await ranked_candidates(h, a, 3, B)
        assert cache.store(a, r, 3)
        hit = cache.lookup(b, h.signature, 2, 3)                     # transposition: same position, different move order
        assert hit and hit["lines"][0]["move"] == r["candidates"][0]["move"]
        assert cache.lookup(b, h.signature, 9, 3) is None            # deeper request is not satisfied by a shallow result
        assert cache.lookup(b, "another-engine-config", 1, 1) is None    # other configurations are never merged
        assert cache.hits == 1 and cache.misses == 2

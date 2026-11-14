"""Tournament statistics with honest uncertainty.

Elo differences come with 95% confidence intervals from the trinomial (win/draw/loss)
variance; every summary carries sample-size warnings so a handful of games is never
presented as proof that an engine or an opening line is superior.
"""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Any

POINTS = {"1-0": (1.0, 0.0), "0-1": (0.0, 1.0), "1/2-1/2": (0.5, 0.5)}


def elo_from_score(p: float) -> float | None:
    if p <= 0.0 or p >= 1.0:
        return None
    return -400.0 * math.log10(1.0 / p - 1.0)


def wdl_summary(w: int, d: int, l: int) -> dict[str, Any]:
    """Score, Elo difference, 95% CI and likelihood of superiority for one side of a match."""
    n = w + d + l
    if n == 0:
        return {"games": 0, "score": None, "elo": None, "elo_low": None, "elo_high": None, "los": None,
                "draw_rate": None, "warning": "no games"}
    p = (w + 0.5 * d) / n
    var = (w * (1 - p) ** 2 + d * (0.5 - p) ** 2 + l * (0 - p) ** 2) / n
    se = math.sqrt(var / n) if n > 1 else 0.5
    lo, hi = max(0.0, p - 1.96 * se), min(1.0, p + 1.96 * se)
    los = 0.5 * (1 + math.erf((w - l) / math.sqrt(2 * (w + l)))) if (w + l) > 0 else 0.5
    warning = None
    if n < 30:
        warning = f"small sample ({n} games): differences are not statistically meaningful"
    elif lo < 0.5 < hi:
        warning = "the 95% interval includes equality"
    return {"games": n, "wins": w, "draws": d, "losses": l, "score": round(p, 4),
            "score_low": round(lo, 4), "score_high": round(hi, 4),
            "elo": _r(elo_from_score(p)), "elo_low": _r(elo_from_score(lo)), "elo_high": _r(elo_from_score(hi)),
            "los": round(los, 4), "draw_rate": round(d / n, 4), "warning": warning}


def _r(x: float | None) -> float | None:
    return None if x is None else round(x, 1)


def wilson(successes: float, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = successes / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0.0, centre - half), min(1.0, centre + half))


def standings(players: list[str], games: list[dict[str, Any]], byes: dict[str, float] | None = None) -> list[dict[str, Any]]:
    """games: [{white, black, result}].  Returns ranked rows with tie-breaks
    (points, direct encounter, Sonneborn-Berger, Buchholz, Buchholz cut-1, wins)."""
    rows: dict[str, dict[str, Any]] = {p: {"player": p, "points": 0.0, "games": 0, "wins": 0, "draws": 0, "losses": 0,
                                           "white_games": 0, "white_points": 0.0, "black_games": 0, "black_points": 0.0,
                                           "opponents": [], "results": [], "byes": 0} for p in players}
    for g in games:
        res = POINTS.get(g.get("result") or "")
        if res is None or g["white"] not in rows or g["black"] not in rows:
            continue
        for me, opp, pts, color in ((g["white"], g["black"], res[0], "white"), (g["black"], g["white"], res[1], "black")):
            r = rows[me]
            r["points"] += pts
            r["games"] += 1
            r["wins" if pts == 1 else "draws" if pts == 0.5 else "losses"] += 1
            r[f"{color}_games"] += 1
            r[f"{color}_points"] += pts
            r["opponents"].append(opp)
            r["results"].append((opp, pts))
    for p, pts in (byes or {}).items():
        if p in rows:
            rows[p]["points"] += pts
            rows[p]["byes"] += 1
    for r in rows.values():
        opp_scores = sorted(rows[o]["points"] for o in r["opponents"])
        r["buchholz"] = round(sum(opp_scores), 2)
        r["buchholz_cut1"] = round(sum(opp_scores[1:]), 2) if len(opp_scores) > 1 else round(sum(opp_scores), 2)
        r["sonneborn_berger"] = round(sum(rows[o]["points"] * pts for o, pts in r["results"]), 2)
        r["score_pct"] = round(r["points"] / r["games"], 4) if r["games"] else None
        perf = wdl_summary(r["wins"], r["draws"], r["losses"])
        r["performance_elo"], r["elo_low"], r["elo_high"] = perf["elo"], perf["elo_low"], perf["elo_high"]
    ordered = sorted(rows.values(), key=lambda r: (-r["points"], -r["sonneborn_berger"], -r["buchholz"], -r["wins"], r["player"]))
    # direct encounter inside tied groups
    i = 0
    while i < len(ordered):
        j = i
        while j + 1 < len(ordered) and ordered[j + 1]["points"] == ordered[i]["points"]:
            j += 1
        if j > i:
            group = {r["player"] for r in ordered[i:j + 1]}
            for r in ordered[i:j + 1]:
                r["direct"] = sum(pts for o, pts in r["results"] if o in group)
            ordered[i:j + 1] = sorted(ordered[i:j + 1], key=lambda r: (-r["direct"], -r["sonneborn_berger"], -r["buchholz"],
                                                                         -r["wins"], r["player"]))
        i = j + 1
    for rank, r in enumerate(ordered, 1):
        r["rank"] = rank
        r.pop("results", None)
        r.setdefault("direct", None)
    return ordered


def head_to_head(games: list[dict[str, Any]]) -> list[dict[str, Any]]:
    table: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0, 0])
    for g in games:
        res = g.get("result")
        if res not in POINTS:
            continue
        a, b = sorted((g["white"], g["black"]))
        a_white = g["white"] == a
        a_pts = POINTS[res][0 if a_white else 1]
        table[(a, b)][0 if a_pts == 1 else 1 if a_pts == 0.5 else 2] += 1
    return [{"a": a, "b": b, **wdl_summary(w, d, l)} for (a, b), (w, d, l) in sorted(table.items())]


def overview(games: list[dict[str, Any]]) -> dict[str, Any]:
    done = [g for g in games if g.get("result") in POINTS]
    n = len(done)
    ww = sum(1 for g in done if g["result"] == "1-0")
    bw = sum(1 for g in done if g["result"] == "0-1")
    dr = n - ww - bw
    plies = [g.get("plies") or 0 for g in done]
    term: dict[str, int] = defaultdict(int)
    openings: dict[str, dict[str, Any]] = {}
    for g in done:
        term[g.get("termination") or "unknown"] += 1
        op = g.get("opening")
        name = (op.get("name") if isinstance(op, dict) else op) or "Start position"
        o = openings.setdefault(name, {"opening": name, "games": 0, "white_wins": 0, "draws": 0, "black_wins": 0})
        o["games"] += 1
        o["white_wins" if g["result"] == "1-0" else "black_wins" if g["result"] == "0-1" else "draws"] += 1
    for o in openings.values():
        lo, hi = wilson(o["white_wins"] + 0.5 * o["draws"], o["games"])
        o["white_score"] = round((o["white_wins"] + 0.5 * o["draws"]) / o["games"], 3)
        o["white_score_ci"] = [round(lo, 3), round(hi, 3)]
        o["note"] = "too few games to compare" if o["games"] < 20 else None
    white = wdl_summary(ww, dr, bw)
    return {"games": n, "white_wins": ww, "draws": dr, "black_wins": bw,
            "draw_rate": round(dr / n, 4) if n else None,
            "white_score": white["score"], "white_advantage_elo": white["elo"],
            "white_advantage_ci": [white["elo_low"], white["elo_high"]],
            "avg_plies": round(sum(plies) / n, 1) if n else None,
            "avg_moves": round(sum(plies) / n / 2, 1) if n else None,
            "shortest_plies": min(plies) if plies else None, "longest_plies": max(plies) if plies else None,
            "terminations": dict(term), "openings": sorted(openings.values(), key=lambda o: -o["games"]),
            "limitations": _limits(n)}


def _limits(n: int) -> list[str]:
    out = []
    if n < 30:
        out.append(f"Only {n} decisive-or-drawn games: treat every ranking as provisional.")
    out.append("Results reflect these engines at these time budgets on this machine; they are not general truths about the openings.")
    return out


def decisive_positions(evals: list[dict[str, Any]], threshold: float = 0.15) -> list[dict[str, Any]]:
    """Largest swings of expected score (white's point of view) between consecutive plies."""
    out = []
    prev = None
    for e in evals:
        cur = e.get("expected_white")
        if cur is None:
            continue
        if prev is not None and abs(cur - prev["expected_white"]) >= threshold:
            out.append({"ply": e["ply"], "san": e.get("san"), "fen_before": prev.get("fen_after"),
                        "swing": round(cur - prev["expected_white"], 3), "before": prev.get("text"), "after": e.get("text")})
        prev = e
    return sorted(out, key=lambda x: -abs(x["swing"]))[:8]

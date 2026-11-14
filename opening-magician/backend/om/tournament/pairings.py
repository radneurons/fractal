"""Pairing systems: round robin (Berger tables), gauntlet, seeded knockout, Swiss.

Swiss method implemented here (documented in docs/TOURNAMENTS.md):
  1. Rank players by score, then by seed.
  2. A player may not meet the same opponent twice, and may not get a third consecutive
     game with the same colour nor a colour difference beyond ±2 (relaxed only when no
     legal pairing exists otherwise).
  3. With an odd field the lowest-ranked player who has not yet had a bye receives a
     one-point bye.
  4. Pairing proceeds from the top: the highest unpaired player is tried against opponents
     in "top half vs bottom half of the score group" order, then nearest floaters, with
     full backtracking — so a legal pairing is found whenever one exists.
  5. Colours: the player with the stronger colour preference gets it; ties go to the
     higher-ranked player alternating from their last colour.
It is a Dutch-style system, not a certified FIDE (C.04.3) implementation.
"""
from __future__ import annotations

import random
from typing import Any

Pair = tuple[str, str]  # (white, black)


# ---------------------------------------------------------------------------
# Round robin
# ---------------------------------------------------------------------------
def round_robin(players: list[str], cycles: int = 1, reverse_colors: bool = False) -> list[list[Pair]]:
    """Berger/circle schedule.  `cycles` repeats the whole event with colours flipped each cycle;
    `reverse_colors` additionally plays every pairing twice (once per colour) inside a cycle."""
    ps = list(players)
    if len(ps) < 2:
        return []
    bye = None
    if len(ps) % 2:
        ps.append("__bye__")
        bye = "__bye__"
    n = len(ps)
    base: list[list[Pair]] = []
    order = ps[:]
    for r in range(n - 1):
        rnd = []
        for i in range(n // 2):
            a, b = order[i], order[n - 1 - i]
            if bye in (a, b):
                continue
            # alternate colours by round; first board alternates so nobody gets a long run
            if i == 0:
                pair = (a, b) if r % 2 == 0 else (b, a)
            else:
                pair = (a, b) if (r + i) % 2 == 0 else (b, a)
            rnd.append(pair)
        base.append(rnd)
        order = [order[0]] + [order[-1]] + order[1:-1]
    rounds: list[list[Pair]] = []
    for c in range(max(1, cycles)):
        for rnd in base:
            first = [(w, b) if c % 2 == 0 else (b, w) for w, b in rnd]
            rounds.append(first)
            if reverse_colors:
                rounds.append([(b, w) for w, b in first])
    return rounds


def gauntlet(champion: str, challengers: list[str], games_per_opponent: int = 2, reverse_colors: bool = True) -> list[list[Pair]]:
    rounds: list[list[Pair]] = []
    for g in range(max(1, games_per_opponent)):
        rnd = []
        for opp in challengers:
            white_first = g % 2 == 0 or not reverse_colors
            rnd.append((champion, opp) if white_first else (opp, champion))
        rounds.append(rnd)
    return rounds


# ---------------------------------------------------------------------------
# Knockout
# ---------------------------------------------------------------------------
def seeded_bracket(players: list[str]) -> list[tuple[str | None, str | None]]:
    """First-round slots for seeds 1..n (byes go to the top seeds when n is not a power of two)."""
    n = len(players)
    size = 1
    while size < n:
        size *= 2
    order = [1]
    while len(order) < size:
        m = len(order) * 2 + 1
        order = [x for s in order for x in (s, m - s)]
    seeded = [players[s - 1] if s <= n else None for s in order]
    return [(seeded[i], seeded[i + 1]) for i in range(0, size, 2)]


def knockout_round_name(matches: int) -> str:
    return {1: "Final", 2: "Semi-final", 4: "Quarter-final"}.get(matches, f"Round of {matches * 2}")


# ---------------------------------------------------------------------------
# Swiss
# ---------------------------------------------------------------------------
def color_pref(history: list[str]) -> int:
    """>0 wants white, <0 wants black.  Magnitude 2 = absolute (would be 3 in a row or diff>2)."""
    if not history:
        return 0
    diff = history.count("w") - history.count("b")
    if len(history) >= 2 and history[-1] == history[-2]:
        return -2 if history[-1] == "w" else 2
    if abs(diff) >= 2:
        return -2 if diff > 0 else 2
    if diff:
        return -1 if diff > 0 else 1
    return -1 if history[-1] == "w" else 1


def assign_colors(a: str, b: str, hist: dict[str, list[str]], rank: dict[str, int]) -> Pair:
    pa, pb = color_pref(hist.get(a, [])), color_pref(hist.get(b, []))
    if pa == pb == 0:
        hi = a if rank[a] < rank[b] else b
        return (hi, b if hi == a else a) if rank[hi] % 2 == 0 else (b if hi == a else a, hi)
    if abs(pa) > abs(pb) or (abs(pa) == abs(pb) and pa != 0 and rank[a] < rank[b]) or pb == 0:
        return (a, b) if pa > 0 else (b, a)
    return (b, a) if pb > 0 else (a, b)


def _compatible(a: str, b: str, played: set[frozenset[str]], hist: dict[str, list[str]], strict: bool) -> bool:
    if frozenset((a, b)) in played:
        return False
    if strict:
        pa, pb = color_pref(hist.get(a, [])), color_pref(hist.get(b, []))
        if abs(pa) == 2 and pa == pb:
            return False
    return True


def swiss_round(players: list[str], scores: dict[str, float], played: set[frozenset[str]],
                hist: dict[str, list[str]], byes: set[str], seeds: dict[str, int] | None = None) -> dict[str, Any]:
    """One Swiss round -> {"pairs": [(white, black)], "bye": player|None, "relaxed_colors": bool}."""
    seeds = seeds or {p: i for i, p in enumerate(players)}
    ranked = sorted(players, key=lambda p: (-scores.get(p, 0.0), seeds[p]))
    rank = {p: i for i, p in enumerate(ranked)}
    bye = None
    pool = ranked[:]
    if len(pool) % 2:
        for p in reversed(pool):
            if p not in byes:
                bye = p
                break
        if bye is None:
            bye = pool[-1]
        pool.remove(bye)

    def order_for(p: str, rest: list[str]) -> list[str]:
        same = [q for q in rest if scores.get(q, 0) == scores.get(p, 0)]
        others = [q for q in rest if q not in same]
        group = [p] + same
        half = len(group) // 2
        # p is top of its group: ideal opponent is the first of the bottom half, then the rest of S2, then S1
        s2, s1 = same[max(0, half - 1):], same[:max(0, half - 1)]
        return s2 + list(reversed(s1)) + others

    def solve(rest: list[str], strict: bool) -> list[tuple[str, str]] | None:
        if not rest:
            return []
        p, tail = rest[0], rest[1:]
        for q in order_for(p, tail):
            if not _compatible(p, q, played, hist, strict):
                continue
            sub = solve([x for x in tail if x != q], strict)
            if sub is not None:
                return [(p, q)] + sub
        return None

    relaxed = False
    raw = solve(pool, True)
    if raw is None:
        raw, relaxed = solve(pool, False), True
    if raw is None:   # every remaining pairing is a rematch: allow rematches as the last resort
        raw, relaxed = [(pool[i], pool[i + 1]) for i in range(0, len(pool), 2)], True
    pairs = [assign_colors(a, b, hist, rank) for a, b in raw]
    return {"pairs": pairs, "bye": bye, "relaxed": relaxed}


def swiss_rounds_recommended(n: int) -> int:
    r = 0
    while (1 << r) < n:
        r += 1
    return max(1, r)


# ---------------------------------------------------------------------------
# Opening allocation
# ---------------------------------------------------------------------------
def allocate_openings(n_games: int, n_openings: int, paired: bool, seed: int) -> list[int]:
    """Opening index per game.  With `paired`, consecutive games (colour-reversed pairs) share an opening."""
    if n_openings <= 0:
        return [-1] * n_games
    rng = random.Random(seed)
    order = list(range(n_openings))
    rng.shuffle(order)
    out = []
    k = 0
    for g in range(n_games):
        if paired:
            out.append(order[(g // 2) % n_openings])
        else:
            out.append(order[k % n_openings])
            k += 1
    return out

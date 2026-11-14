"""The Opening Research Scientist: separate, explained scores for a candidate move.

Seven independent dimensions, each returned as {value 0..1, explanation, inputs}.  They
are never collapsed into one opaque percentage; the category and status are derived by
explicit rules that are returned alongside (`reasons`).
"""
from __future__ import annotations

import statistics
from typing import Any

import chess

from ..chessx import Score, pawn_structure, tactical_complexity

CATEGORIES = ["viable_alternative", "interesting_novelty_candidate", "tactical_trap_candidate", "strong_defensive_resource",
              "move_order_trick", "strategic_pawn_break_idea", "practical_surprise_weapon", "dubious_but_instructive",
              "clearly_refuted", "requires_deeper_investigation"]
STATUSES = ["discovered", "under_analysis", "needs_verification", "tournament_testing", "promising", "repertoire_candidate",
            "approved", "rejected", "archived", "revisit_later"]


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _s(value: float, explanation: str, **inputs: Any) -> dict[str, Any]:
    return {"value": round(clamp(value), 3), "explanation": explanation, "inputs": inputs}


def objective_viability(verification: dict[str, Any] | None, validator: dict[str, Any] | None,
                        original_loss: dict[str, Any] | None) -> dict[str, Any]:
    if not verification or verification.get("loss") is None:
        ol = (original_loss or {}).get("expected_loss")
        if ol is None:
            return _s(0.0, "No evaluation available yet.")
        return _s(clamp(1 - ol / 0.20) * 0.6, "Only the discovery engine has judged this move; capped at 0.6 until an "
                                               "independent verifier confirms it.", discovery_loss=ol)
    loss = verification["loss"]
    v = clamp(1 - loss["expected_loss"] / 0.20)
    note = f"Verifier ({verification['engine']}, depth {verification.get('depth')}): expected-score loss {loss['expected_loss']:.3f} vs its best move"
    if loss.get("cp_loss") is not None:
        note += f" ({loss['cp_loss']} cp)"
    if loss.get("walks_into_mate"):
        return _s(0.0, note + ". The move allows a forced mate.", **loss)
    if loss.get("misses_mate"):
        v = min(v, 0.35)
        note += "; it gives up a forced mate"
    agreement = None
    if validator and validator.get("loss") is not None:
        v2 = clamp(1 - validator["loss"]["expected_loss"] / 0.20)
        agreement = round(1 - abs(v - v2), 3)
        note += f". Validator ({validator['engine']}) loss {validator['loss']['expected_loss']:.3f}"
        v = min(v, (v + v2) / 2) if abs(v - v2) > 0.25 else (v + v2) / 2
    return _s(v, note + ".", verifier_loss=loss["expected_loss"], cp_loss=loss.get("cp_loss"), validator_agreement=agreement)


def practical_difficulty(replies: dict[str, Any] | None, trap: dict[str, Any] | None) -> dict[str, Any]:
    """How hard is the opponent's task right after the candidate?"""
    if not replies or not replies.get("lines"):
        return _s(0.0, "Opponent replies were not analysed.")
    lines = replies["lines"]
    best = Score.from_dict(lines[0]["score"])
    acceptable = sum(1 for l in lines if best.expected() - Score.from_dict(l["score"]).expected() <= 0.03)
    gap = (best.expected() - Score.from_dict(lines[1]["score"]).expected()) if len(lines) > 1 else 0.3
    v = 0.55 * clamp(1 - (acceptable - 1) / 3) + 0.25 * clamp(gap / 0.15)
    text = f"{acceptable} of the top {len(lines)} replies keep the balance; best-to-second gap {gap:.3f}"
    if trap:
        v += 0.3
        text += f"; the natural-looking {trap['tempting_san']} loses {trap['loss']:.2f} expected score"
    return _s(v, text + ".", acceptable_replies=acceptable, window=len(lines), gap=round(gap, 3), trap=bool(trap))


def novelty_in_database(book_share: float | None, in_book: bool, book_known: bool, prior_findings: int,
                        has_reference: bool) -> dict[str, Any]:
    if not has_reference:
        v = clamp(1 - prior_findings / 3)
        return _s(v * 0.7, "No reference book was selected, so novelty is measured only against this research collection "
                           f"({prior_findings} earlier finding(s) on this move). Capped at 0.7.", prior_findings=prior_findings)
    if in_book:
        v = clamp(1 - (book_share or 0) * 4) * 0.6
        text = f"Present in the reference book with a {100 * (book_share or 0):.0f}% share at this position."
    elif book_known:
        v = 1.0
        text = "The position is in the reference book but this move is not: new to this research collection."
    else:
        v = 0.75
        text = "The position itself is outside the reference book, so the book says nothing about this move."
    v *= clamp(1 - prior_findings / 5, 0.4, 1.0)
    return _s(v, text + " This is novelty relative to the imported data only — not a claim about chess theory.",
              in_book=in_book, book_share=book_share, prior_findings=prior_findings)


def tactical_potential(board_after: chess.Board, games: list[dict[str, Any]], trap: dict[str, Any] | None) -> dict[str, Any]:
    cx = tactical_complexity(board_after)
    swings = sum(g.get("swings", 0) for g in games)
    per_game = swings / len(games) if games else 0.0
    v = 0.5 * cx + 0.3 * clamp(per_game / 3) + (0.2 if trap else 0.0)
    return _s(v, f"Static tactical complexity {cx:.2f}; {per_game:.1f} large evaluation swings per test game"
              + ("; a concrete trap was verified" if trap else "") + ".", complexity=round(cx, 3), swings_per_game=round(per_game, 2))


def strategic_coherence(board_before: chess.Board, move: chess.Move, games: list[dict[str, Any]]) -> dict[str, Any]:
    """Heuristic: do test games stay stable after the move, and does it avoid self-inflicted structural damage?"""
    after = board_before.copy(stack=False)
    after.push(move)
    side = "white" if board_before.turn else "black"
    ps_b, ps_a = pawn_structure(board_before)[side], pawn_structure(after)[side]
    damage = (len(ps_a["isolated"]) - len(ps_b["isolated"])) + (len(ps_a["doubled"]) - len(ps_b["doubled"])) / 2
    drifts = [g["eval_stdev"] for g in games if g.get("eval_stdev") is not None]
    stability = clamp(1 - (statistics.mean(drifts) if drifts else 0.12) / 0.25)
    piece = board_before.piece_at(move.from_square)
    develops = bool(piece and piece.piece_type in (chess.KNIGHT, chess.BISHOP) and
                    chess.square_rank(move.from_square) in (0, 7)) or board_before.is_castling(move)
    central = chess.square_file(move.to_square) in (2, 3, 4, 5) and chess.square_rank(move.to_square) in (2, 3, 4, 5)
    v = 0.5 * stability + 0.2 * clamp(1 - damage / 2) + 0.15 * develops + 0.15 * central
    return _s(v, f"Evaluation stability in test games {stability:.2f}; structural change {damage:+.1f}; "
              f"{'develops a piece' if develops else 'no development'}; {'central' if central else 'non-central'} move. "
              "Heuristic estimate, not an engine verdict.", stability=round(stability, 3), structure_damage=damage)


def research_confidence(verification: dict[str, Any] | None, validator: dict[str, Any] | None, n_games: int,
                        original_rank: int | None, budget_depth: int) -> dict[str, Any]:
    parts, text = [], []
    if verification and verification.get("depth"):
        d = clamp(verification["depth"] / max(8, budget_depth))
        parts.append(0.35 * d)
        text.append(f"verifier depth {verification['depth']}")
        if verification.get("stop_reason") in ("stable", "resolved"):
            parts.append(0.1)
            text.append("search ended stable")
    else:
        text.append("not independently verified")
    if validator and validator.get("loss") is not None and verification and verification.get("loss") is not None:
        diff = abs(validator["loss"]["expected_loss"] - verification["loss"]["expected_loss"])
        parts.append(0.2 * clamp(1 - diff / 0.1))
        text.append(f"validator differs by {diff:.3f}")
    g = n_games / (n_games + 8)
    parts.append(0.2 * g)
    text.append(f"{n_games} test game(s)")
    if verification and verification.get("rank") and original_rank:
        shift = abs(verification["rank"] - original_rank)
        parts.append(0.15 * clamp(1 - shift / 4))
        text.append(f"rank moved {original_rank}->{verification['rank']}" + ("" if verification.get("rank_exact") else "+"))
    return _s(sum(parts), "Evidence: " + ", ".join(text) + ".", games=n_games)


def training_value(viability: float, difficulty: float, tactical: float, trap: dict[str, Any] | None) -> dict[str, Any]:
    v = viability * (0.45 + 0.25 * difficulty + 0.3 * tactical)
    if trap and viability < 0.5:
        v = max(v, 0.45)     # refuted traps are still worth knowing how to punish
    return _s(v, "Higher when the line is sound enough to play and contains ideas worth remembering "
                 "(only-moves, tactics, a verified trap).", viability=viability, difficulty=difficulty, tactical=tactical)


def categorize(scores: dict[str, dict[str, Any]], *, trap: dict[str, Any] | None, transposes_to: str | None,
               is_pawn_break: bool, was_worse: bool, verification: dict[str, Any] | None) -> dict[str, Any]:
    g = lambda k: scores[k]["value"]
    via, conf, nov, diff = g("objective_viability"), g("research_confidence"), g("novelty_in_database"), g("practical_difficulty")
    reasons: list[str] = []
    if verification is None or verification.get("loss") is None:
        cat = "requires_deeper_investigation"
        reasons.append("no independent verification yet")
    elif via < 0.25:
        cat = "clearly_refuted"
        reasons.append(f"viability {via:.2f} < 0.25 after independent analysis")
    elif trap and via >= 0.5:
        cat = "tactical_trap_candidate"
        reasons.append("verified trap and the setup move stays objectively acceptable (sound practical trap)")
    elif trap:
        cat = "dubious_but_instructive"
        reasons.append("contains a trap but the setup move carries measurable objective risk (speculative trap)")
    elif via < 0.5:
        cat = "dubious_but_instructive"
        reasons.append(f"viability {via:.2f} between 0.25 and 0.5")
    elif conf < 0.35:
        cat = "requires_deeper_investigation"
        reasons.append(f"research confidence {conf:.2f} < 0.35")
    elif transposes_to:
        cat = "move_order_trick"
        reasons.append(f"reaches a known position by another move order ({transposes_to})")
    elif was_worse and via >= 0.7:
        cat = "strong_defensive_resource"
        reasons.append("holds a position the verifier already judged difficult")
    elif via >= 0.7 and diff >= 0.6:
        cat = "practical_surprise_weapon"
        reasons.append("sound and leaves the opponent few good replies")
    elif via >= 0.7 and nov >= 0.7:
        cat = "interesting_novelty_candidate"
        reasons.append("sound and absent from the reference data (new to this research collection)")
    elif is_pawn_break:
        cat = "strategic_pawn_break_idea"
        reasons.append("a pawn lever that survives verification")
    else:
        cat = "viable_alternative"
        reasons.append(f"viability {via:.2f} with no special feature")
    if cat == "clearly_refuted":
        status = "rejected"
    elif cat == "requires_deeper_investigation":
        status = "needs_verification" if (verification is None or verification.get("loss") is None) else "revisit_later"
    elif via >= 0.75 and conf >= 0.65:
        status = "repertoire_candidate"
    elif via >= 0.6 and conf >= 0.45:
        status = "promising"
    elif cat == "dubious_but_instructive":
        status = "archived"
    else:
        status = "needs_verification"
    return {"category": cat, "status": status, "reasons": reasons}


def game_summary(evals: list[dict[str, Any]], candidate_side_white: bool, result: str) -> dict[str, Any]:
    """Compress one test game into the features scoring needs."""
    xs = [e["expected_white"] for e in evals if e.get("expected_white") is not None]
    swings = sum(1 for a, b in zip(xs, xs[1:]) if abs(b - a) >= 0.15)
    early = xs[:16]
    pts = {"1-0": 1.0, "0-1": 0.0, "1/2-1/2": 0.5}.get(result)
    if pts is not None and not candidate_side_white:
        pts = 1 - pts
    return {"swings": swings, "eval_stdev": round(statistics.pstdev(early), 4) if len(early) >= 4 else None,
            "points": pts, "plies": len(evals)}

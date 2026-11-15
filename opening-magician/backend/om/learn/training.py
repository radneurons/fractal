"""Opening Training Academy: spaced repetition, skill model, weakness detection and the
task generators behind the training modes and mini-games.

Scores come only from recorded learner evidence (correct / incorrect / time / hints);
finishing a lesson never moves a mastery estimate by itself.
"""
from __future__ import annotations

import json as _json
import math
import random
import time
from typing import Any

import chess
from ..chessx import parse_move

from .. import openings
from ..books.store import BookStore
from ..chessx import pawn_structure, pos_key
from ..db import Database, new_id, now

DIMENSIONS = {
    "opening_recall": "Opening recall",
    "move_order": "Move-order understanding",
    "tactical_awareness": "Tactical awareness",
    "strategic_understanding": "Strategic understanding",
    "transposition_recognition": "Transposition recognition",
    "punish_inaccuracies": "Punishing inaccuracies",
    "survive_unfamiliar": "Surviving unfamiliar lines",
    "opening_transition": "End-of-opening transition",
}
MODE_DIMENSION = {
    "guided": "opening_recall", "recall": "opening_recall", "repertoire": "opening_recall", "random_branch": "opening_recall",
    "blitz": "opening_recall", "labyrinth": "opening_recall", "physical": "opening_recall",
    "move_order": "move_order", "move_order_master": "move_order",
    "transposition": "transposition_recognition",
    "survival": "survive_unfamiliar", "repertoire_defender": "survive_unfamiliar",
    "trap_recognition": "tactical_awareness", "trap_hunter": "tactical_awareness", "tactical_ambush": "tactical_awareness",
    "puzzle": "tactical_awareness", "deep_calculation": "tactical_awareness",
    "punish": "punish_inaccuracies", "find_refutation": "punish_inaccuracies",
    "plan": "strategic_understanding", "pawn_structure": "strategic_understanding", "best_move_detective": "strategic_understanding",
    "engine_prediction": "strategic_understanding", "fifth_move": "strategic_understanding", "novelty_investigator": "strategic_understanding",
    "play_from_position": "opening_transition",
}
DAY = 86400.0


def grade(correct: bool, time_ms: int | None, hints: int) -> int:
    """SM-2 quality 0..5 from what actually happened."""
    if not correct:
        return 1 if hints == 0 else 0
    if hints > 0:
        return 3
    if time_ms is not None and time_ms > 20_000:
        return 3
    if time_ms is not None and time_ms > 8_000:
        return 4
    return 5


def sm2(ease: float, interval: float, reps: int, q: int) -> tuple[float, float, int]:
    if q < 3:
        return max(1.3, ease - 0.2), 0.0, 0          # relearn today
    ease = max(1.3, ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    if reps == 0:
        interval = 1.0
    elif reps == 1:
        interval = 3.0
    else:
        interval = max(1.0, interval * ease)
    return ease, interval, reps + 1


class Trainer:
    def __init__(self, db: Database, books: BookStore):
        self.db, self.books = db, books
        self._tasks: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------------ decks
    def decks(self) -> list[dict[str, Any]]:
        rows = self.db.query("SELECT deck, COUNT(*) n, SUM(CASE WHEN due<=? THEN 1 ELSE 0 END) due, "
                             "SUM(CASE WHEN reps=0 THEN 1 ELSE 0 END) fresh, AVG(ease) ease, SUM(lapses) lapses "
                             "FROM cards GROUP BY deck", (now(),))
        meta = self.db.pref("decks", {})
        return [{**r, "title": meta.get(r["deck"], {}).get("title", r["deck"]), "color": meta.get(r["deck"], {}).get("color"),
                 "source": meta.get(r["deck"], {}).get("source")} for r in rows]

    def build_deck_from_book(self, book_id: str, color: str, max_ply: int = 24, title: str | None = None) -> dict[str, Any]:
        book = self.books.head(book_id)
        info = self.db.get("books", book_id) or {}
        deck = f"book:{book_id}:{color}"
        added = 0
        with self.db.tx():
            for board, ply in book.walk(max_ply):
                if (board.turn == chess.WHITE) != (color == "white"):
                    continue
                moves = [m for m in book.moves_at(board) if m["status"] != "rejected" and m["weight"] > 0]
                if not moves:
                    continue
                top = moves[0]
                name = (openings.identify(board) or {}).get("name")
                added += self._add_card(deck, board, top["uci"], top["san"], color, name,
                                        note=top.get("comment", ""), alternatives=[m["uci"] for m in moves[1:4] if m["share"] >= 0.15])
        self._deck_meta(deck, title or f"{info.get('name', 'Book')} — {color}", color, {"book_id": book_id})
        return {"deck": deck, "added": added}

    def build_deck_from_opening(self, opening_id: str, color: str) -> dict[str, Any]:
        op = openings.find(opening_id)
        if not op:
            raise ValueError("Unknown opening")
        deck = f"opening:{opening_id}:{color}"
        board = chess.Board()
        added = 0
        with self.db.tx():
            for u, san in zip(op["uci"], op["moves"]):
                if (board.turn == chess.WHITE) == (color == "white"):
                    added += self._add_card(deck, board, u, san, color, op["name"], note=op["idea"])
                board.push_uci(u)
        self._deck_meta(deck, f"{op['name']} — {color}", color, {"opening_id": opening_id})
        return {"deck": deck, "added": added}

    def build_deck_from_line(self, title: str, start_fen: str | None, moves: list[str], color: str, note: str = "") -> dict[str, Any]:
        deck = "line:" + new_id()
        board = chess.Board(start_fen) if start_fen else chess.Board()
        added = 0
        with self.db.tx():
            for t in moves:
                mv = parse_move(board, t)
                if (board.turn == chess.WHITE) == (color == "white"):
                    added += self._add_card(deck, board, mv.uci(), board.san(mv), color, title, note=note)
                board.push(mv)
        self._deck_meta(deck, title, color, {"line": True})
        return {"deck": deck, "added": added}

    def _deck_meta(self, deck: str, title: str, color: str, source: dict[str, Any]) -> None:
        meta = self.db.pref("decks", {})
        meta[deck] = {"title": title, "color": color, "source": source}
        self.db.set_pref("decks", meta)

    def _add_card(self, deck: str, board: chess.Board, uci: str, san: str, color: str, opening: str | None, note: str = "",
                  alternatives: list[str] | None = None) -> int:
        if self.db.scalar("SELECT 1 FROM cards WHERE deck=? AND epd=? AND move_uci=?", (deck, pos_key(board), uci)):
            return 0
        line = [m.uci() for m in board.move_stack]
        self.db.insert("cards", {"id": new_id("card"), "deck": deck, "epd": pos_key(board), "fen": board.fen(), "move_uci": uci,
                                 "san": san, "line": {"moves": line, "alternatives": alternatives or []}, "color": color,
                                 "opening": opening, "kind": "recall", "note": note, "ease": 2.5, "interval_days": 0.0,
                                 "due": now(), "reps": 0, "lapses": 0, "last_result": None, "created_at": now()})
        return 1

    def delete_deck(self, deck: str) -> None:
        self.db.execute("DELETE FROM cards WHERE deck=?", (deck,))
        meta = self.db.pref("decks", {})
        meta.pop(deck, None)
        self.db.set_pref("decks", meta)

    # ------------------------------------------------------------------ sessions
    def next_cards(self, deck: str | None, n: int = 10, mode: str = "recall", new_limit: int = 6) -> list[dict[str, Any]]:
        where, params = "due<=?", [now()]
        if deck:
            where += " AND deck=?"
            params.append(deck)
        due = self.db.all("cards", where + " AND reps>0", params, order="due", limit=n)
        fresh = self.db.all("cards", where + " AND reps=0", params, order="created_at", limit=max(0, min(new_limit, n - len(due))))
        cards = due + fresh
        if mode in ("random_branch", "blitz"):
            random.shuffle(cards)
        if len(cards) < n and mode in ("blitz", "random_branch", "repertoire"):
            # nothing due: practise ahead from the weakest cards (does not shorten their schedule on success)
            extra = self.db.all("cards", "deck=?" if deck else "", [deck] if deck else [], order="ease, lapses DESC", limit=n - len(cards))
            cards += [c for c in extra if c["id"] not in {x["id"] for x in cards}]
        return [self._public(c) for c in cards[:n]]

    def _public(self, c: dict[str, Any]) -> dict[str, Any]:
        return {"id": c["id"], "deck": c["deck"], "fen": c["fen"], "color": c["color"], "opening": c["opening"],
                "reps": c["reps"], "lapses": c["lapses"], "due": c["due"], "interval_days": c["interval_days"],
                "history": c["line"].get("moves", []), "is_new": c["reps"] == 0}

    def answer(self, card_id: str, move: str, time_ms: int | None = None, hints: int = 0, mode: str = "recall") -> dict[str, Any]:
        c = self.db.get("cards", card_id)
        if not c:
            raise ValueError("Unknown card")
        board = chess.Board(c["fen"])
        gave_up = move in ("0000", "", "skip")          # "I don't know" / blitz timeout: a recorded miss, not an illegal move
        mv = None
        if not gave_up:
            try:
                mv = parse_move(board, move)
            except ValueError:
                return {"correct": False, "legal": False, "message": "That is not a legal move here."}
        alts = c["line"].get("alternatives", [])
        correct = mv is not None and mv.uci() == c["move_uci"]
        also = mv is not None and mv.uci() in alts
        q = grade(correct or also, time_ms, hints)
        early = c["due"] > now() + 60          # practising ahead of schedule
        if early and (correct or also):
            ease, interval, reps = c["ease"], c["interval_days"], c["reps"]
        else:
            ease, interval, reps = sm2(c["ease"], c["interval_days"], c["reps"], q)
        lapses = c["lapses"] + (0 if (correct or also) else 1)
        due = now() + (interval * DAY if interval else 600)
        self.db.update("cards", card_id, {"ease": ease, "interval_days": interval, "reps": reps, "lapses": lapses, "due": due,
                                          "last_result": "correct" if correct else "alternative" if also else "wrong"})
        self.log(mode, correct or also, time_ms, hints, card_id=card_id,
                 detail={"played": mv.uci() if mv else None, "expected": c["move_uci"], "opening": c["opening"], "epd": c["epd"]})
        return {"correct": correct, "alternative": also, "legal": True, "expected": c["move_uci"], "expected_san": c["san"],
                "played_san": board.san(mv) if mv else None, "note": c["note"], "quality": q, "next_due": due, "interval_days": round(interval, 2),
                "message": "Correct." if correct else ("Also in your repertoire here." if also else
                                                       f"Your repertoire move is {c['san']}.")}

    def hint(self, card_id: str) -> dict[str, Any]:
        """First hint: which piece moves (the client counts it, and the answer is graded lower)."""
        c = self.db.get("cards", card_id)
        if not c:
            raise ValueError("Unknown card")
        return {"from": c["move_uci"][:2], "note": c["note"]}

    def log(self, mode: str, correct: bool, time_ms: int | None, hints: int, card_id: str | None = None,
            detail: dict[str, Any] | None = None, dimension: str | None = None) -> None:
        self.db.insert("training_events", {"id": new_id("te"), "card_id": card_id, "mode": mode,
                                           "dimension": dimension or MODE_DIMENSION.get(mode, "opening_recall"),
                                           "correct": int(correct), "time_ms": time_ms, "hints": hints, "detail": detail or {},
                                           "created_at": now()})

    # ------------------------------------------------------------------ skills & weaknesses
    def skills(self) -> dict[str, Any]:
        out = {}
        for dim, label in DIMENSIONS.items():
            rows = self.db.all("training_events", "dimension=?", (dim,), order="created_at DESC", limit=60)
            if not rows:
                out[dim] = {"label": label, "value": None, "n": 0, "confidence": 0.0, "trend": None}
                continue
            # exponentially weighted accuracy, hints count as half credit, most recent first
            num = den = 0.0
            for i, r in enumerate(rows):
                w = 0.94 ** i
                credit = (1.0 if r["correct"] else 0.0) * (0.5 if r["hints"] else 1.0)
                num += w * credit
                den += w
            recent = [r["correct"] for r in rows[:10]]
            older = [r["correct"] for r in rows[10:30]]
            trend = (sum(recent) / len(recent) - sum(older) / len(older)) if older else None
            out[dim] = {"label": label, "value": round(num / den, 3), "n": len(rows),
                        "confidence": round(1 - math.exp(-len(rows) / 15), 3), "trend": None if trend is None else round(trend, 3)}
        return out

    def progress(self) -> dict[str, Any]:
        total = self.db.scalar("SELECT COUNT(*) FROM cards") or 0
        learned = self.db.scalar("SELECT COUNT(*) FROM cards WHERE reps>=2 AND interval_days>=3") or 0
        due = self.db.scalar("SELECT COUNT(*) FROM cards WHERE due<=?", (now(),)) or 0
        day0 = now() - 14 * DAY
        days = self.db.query("SELECT CAST((created_at-?)/86400 AS INTEGER) d, COUNT(*) n, SUM(correct) c "
                             "FROM training_events WHERE created_at>=? GROUP BY d ORDER BY d", (day0, day0))
        by_mode = self.db.query("SELECT mode, COUNT(*) n, SUM(correct) c, AVG(time_ms) t FROM training_events GROUP BY mode")
        streak = 0
        seen = {r["d"] for r in days}
        for d in range(14, -1, -1):
            if d in seen:
                streak += 1
            elif d != 14:
                break
        return {"cards": total, "mature": learned, "due": due, "daily": days, "by_mode": by_mode, "streak_days": streak,
                "events": self.db.scalar("SELECT COUNT(*) FROM training_events") or 0}

    def weaknesses(self, limit: int = 12) -> list[dict[str, Any]]:
        """Cards the learner keeps missing, with a concrete correction plan for each."""
        rows = self.db.query(
            "SELECT c.*, (SELECT COUNT(*) FROM training_events e WHERE e.card_id=c.id) attempts, "
            "(SELECT SUM(correct) FROM training_events e WHERE e.card_id=c.id) hits FROM cards c "
            "WHERE c.lapses>=2 OR (c.reps=0 AND c.last_result='wrong') ORDER BY c.lapses DESC, c.ease LIMIT ?", (limit * 2,))
        out = []
        for r in rows:
            attempts, hits = r["attempts"] or 0, r["hits"] or 0
            if attempts >= 3 and hits / attempts > 0.7 and r["lapses"] < 3:
                continue
            board = chess.Board(r["fen"])
            mv = chess.Move.from_uci(r["move_uci"])
            op = next((o for o in openings.catalog() if o["name"] == r["opening"]), None)
            fam = openings.family_of(r["opening"] or "")
            side = "white" if board.turn else "black"
            wrong = self.db.query("SELECT detail FROM training_events WHERE card_id=? AND correct=0 ORDER BY created_at DESC LIMIT 5", (r["id"],))
            played = [(_json.loads(w["detail"]) or {}).get("played") for w in wrong]
            confused = max(set(played), key=played.count) if played else None
            similar = self.db.all("cards", "deck=? AND opening=? AND id<>?", (r["deck"], r["opening"], r["id"]), limit=1)
            out.append({
                "card_id": r["id"], "deck": r["deck"], "fen": r["fen"], "opening": r["opening"], "move": r["move_uci"],
                "san": r["san"], "lapses": r["lapses"], "attempts": attempts, "accuracy": round(hits / attempts, 2) if attempts else None,
                "usually_played": confused, "usually_played_san": board.san(chess.Move.from_uci(confused)) if confused and chess.Move.from_uci(confused) in board.legal_moves else None,
                "plan": {
                    "identify": f"You have missed {r['san']} {r['lapses']} time(s) in {r['opening'] or 'this line'}.",
                    "explain": (op["idea"] if op else fam["structure"]) + (" " + r["note"] if r["note"] and (not op or r["note"] != op["idea"]) else ""),
                    "key_squares": fam["squares"], "plans": fam[side],
                    "arrows": [{"from": chess.square_name(mv.from_square), "to": chess.square_name(mv.to_square), "kind": "best"}]
                              + ([{"from": confused[:2], "to": confused[2:4], "kind": "mistake"}] if confused else []),
                    "guided_exercise": {"card_id": r["id"], "hints": True},
                    "similar_position": self._public(similar[0]) if similar else None,
                    "review": "Scheduled again in 10 minutes, then tomorrow if you get it right.",
                }})
            if len(out) >= limit:
                break
        return out

    # ------------------------------------------------------------------ task generators (quizzes / mini-games)
    def _store(self, task: dict[str, Any], answer: dict[str, Any]) -> dict[str, Any]:
        task["id"] = new_id("task")
        self._tasks[task["id"]] = {"task": task, "answer": answer, "t": time.time()}
        if len(self._tasks) > 500:
            for k in sorted(self._tasks, key=lambda k: self._tasks[k]["t"])[:200]:
                del self._tasks[k]
        return task

    def task(self, kind: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        p = params or {}
        rng = random.Random(p.get("seed"))
        fn = getattr(self, "_task_" + kind, None)
        if fn is None:
            raise ValueError(f"Unknown task kind '{kind}'")
        return fn(p, rng)

    def _task_transposition(self, p: dict[str, Any], rng: random.Random) -> dict[str, Any]:
        """Reach a catalogued position by a shuffled-but-legal move order and ask what it is."""
        cat = [o for o in openings.catalog() if 6 <= o["plies"] <= 14]
        for _ in range(40):
            op = rng.choice(cat)
            order = self._alt_order(op["uci"], rng)
            if order:
                board = chess.Board()
                sans = []
                for u in order:
                    sans.append(board.san(chess.Move.from_uci(u)))
                    board.push_uci(u)
                wrong = rng.sample([o["name"] for o in cat if o["family"] != op["family"]], 3)
                options = wrong + [op["name"]]
                rng.shuffle(options)
                return self._store({"kind": "transposition", "fen": board.fen(), "moves": sans, "options": options,
                                    "prompt": "This position arose from an unusual move order. Which opening is it?"},
                                   {"value": op["name"], "explain": f"It is the {op['name']} ({op['eco']}): normally reached by "
                                                                    f"{' '.join(op['moves'])}.", "mode": "transposition"})
        raise ValueError("Could not build a transposition task")

    @staticmethod
    def _alt_order(uci: list[str], rng: random.Random) -> list[str] | None:
        """A different legal ordering of the same moves that reaches the same position."""
        target = chess.Board()
        for u in uci:
            target.push_uci(u)
        key = pos_key(target)
        white, black = uci[0::2], uci[1::2]
        for _ in range(30):
            w, b = white[:], black[:]
            rng.shuffle(w)
            rng.shuffle(b)
            order = [x for pair in zip(w, b) for x in pair] + (w[len(b):] if len(w) > len(b) else [])
            if order == uci:
                continue
            board = chess.Board()
            ok = True
            for u in order:
                mv = chess.Move.from_uci(u)
                if mv not in board.legal_moves:
                    ok = False
                    break
                board.push(mv)
            if ok and pos_key(board) == key:
                return order
        return None

    def _task_move_order(self, p: dict[str, Any], rng: random.Random) -> dict[str, Any]:
        cat = [o for o in openings.catalog() if 6 <= o["plies"] <= 12 and self._alt_order(o["uci"], random.Random(1))]
        if p.get("opening_id"):
            cat = [o for o in cat if o["id"] == p["opening_id"]] or cat
        op = rng.choice(cat)
        return self._store({"kind": "move_order", "target_fen": op["fen"], "start_fen": chess.STARTING_FEN, "name": op["name"],
                            "canonical": op["moves"], "max_plies": op["plies"],
                            "prompt": f"Reach the {op['name']} position using a move order different from the main one."},
                           {"epd": op["epd"], "canonical": op["uci"], "mode": "move_order",
                            "explain": "Different move orders can avoid or invite specific sidelines — knowing them is part of opening preparation."})

    def _task_plan(self, p: dict[str, Any], rng: random.Random) -> dict[str, Any]:
        fams = list(openings.FAMILIES.items())
        name, fam = rng.choice(fams)
        side = rng.choice(["white", "black"])
        correct = rng.choice(fam[side])
        pool = [pl for n, f in fams if n != name for pl in f[side] if pl not in fam[side]]
        options = rng.sample(pool, 3) + [correct]
        rng.shuffle(options)
        op = next((o for o in openings.catalog() if o["family"] == name), None)
        return self._store({"kind": "plan", "fen": op["fen"] if op else chess.STARTING_FEN, "options": options, "opening": name,
                            "key_squares": fam["squares"], "prompt": f"Which plan belongs to {side.title()} in the {name}?"},
                           {"value": correct, "explain": f"{name}: {fam['structure']}", "mode": "plan"})

    def _task_pawn_structure(self, p: dict[str, Any], rng: random.Random) -> dict[str, Any]:
        cat = [o for o in openings.catalog() if o["plies"] >= 8]
        for _ in range(60):
            op = rng.choice(cat)
            board = chess.Board(op["fen"])
            ps = pawn_structure(board)
            facts = []
            for side in ("white", "black"):
                if ps[side]["isolated"]:
                    facts.append(("Which side has an isolated pawn?", side.title(), ps[side]["isolated"]))
                if ps[side]["doubled"]:
                    facts.append(("Which side has doubled pawns?", side.title(), ps[side]["doubled"]))
            if ps["white"]["islands"] != ps["black"]["islands"]:
                more = "White" if ps["white"]["islands"] > ps["black"]["islands"] else "Black"
                facts.append(("Which side has more pawn islands?", more, []))
            facts = [f for f in facts if not (f[0].startswith("Which side has an isolated") and ps["white"]["isolated"] and ps["black"]["isolated"])
                     and not (f[0].startswith("Which side has doubled") and ps["white"]["doubled"] and ps["black"]["doubled"])]
            if facts:
                q, ans, squares = rng.choice(facts)
                return self._store({"kind": "pawn_structure", "fen": op["fen"], "opening": op["name"], "prompt": q,
                                    "options": ["White", "Black"]},
                                   {"value": ans, "squares": squares, "mode": "pawn_structure",
                                    "explain": f"{op['name']}: {op['structure']}"})
        raise ValueError("Could not build a pawn-structure task")

    def _task_trap(self, p: dict[str, Any], rng: random.Random) -> dict[str, Any]:
        """variant 'avoid': you are the victim before the mistake.  variant 'punish': find the refutation."""
        traps = openings.traps()
        t = next((x for x in traps if x["id"] == p.get("trap_id")), None) or rng.choice(traps)
        variant = p.get("variant", rng.choice(["avoid", "punish"]))
        if variant == "avoid":
            return self._store({"kind": "trap", "variant": "avoid", "fen": t["fen_before_blunder"], "name": t["name"],
                                "history": t["moves"][:t["blunder_ply"]], "side": t["victim"],
                                "prompt": f"{t['victim'].title()} to move. One natural move loses at once — choose a move that avoids the trap."},
                               {"blunder": t["uci"][t["blunder_ply"]], "blunder_san": t["blunder_san"], "explain": t["explanation"],
                                "mode": "trap_recognition", "line": t["moves"]})
        board = chess.Board()
        for u in t["uci"][:t["blunder_ply"] + 1]:
            board.push_uci(u)
        return self._store({"kind": "trap", "variant": "punish", "fen": board.fen(), "name": t["name"],
                            "history": t["moves"][:t["blunder_ply"] + 1], "side": t["side"],
                            "prompt": f"Your opponent just played {t['blunder_san']}. Punish it."},
                           {"move": t["uci"][t["blunder_ply"] + 1], "san": t["moves"][t["blunder_ply"] + 1],
                            "explain": t["explanation"], "mode": "punish", "line": t["moves"]})

    def _task_labyrinth(self, p: dict[str, Any], rng: random.Random) -> dict[str, Any]:
        """One room of the Opening Labyrinth: pick the book move among decoys at a node of the chosen book/reference."""
        book = self.books.head(p["book_id"]) if p.get("book_id") else openings.reference_book()
        board = chess.Board(p["fen"]) if p.get("fen") else chess.Board(book.root_fen)
        moves = [m for m in book.moves_at(board) if m["status"] != "rejected"]
        if not moves:
            return {"kind": "labyrinth", "exit": True, "fen": board.fen(), "opening": (openings.identify(board) or {}).get("name")}
        good = {m["uci"] for m in moves}
        decoys = [mv for mv in board.legal_moves if mv.uci() not in good]
        rng.shuffle(decoys)
        correct = moves[0] if p.get("main_only") else rng.choice(moves[:3])
        options = [{"uci": correct["uci"], "san": correct["san"]}] + [{"uci": d.uci(), "san": board.san(d)} for d in decoys[:3]]
        rng.shuffle(options)
        return self._store({"kind": "labyrinth", "fen": board.fen(), "options": options, "exit": False,
                            "opening": (openings.identify(board) or {}).get("name"),
                            "prompt": "Which door stays inside the book?"},
                           {"good": sorted(good), "mode": "labyrinth",
                            "explain": "Book moves here: " + ", ".join(m["san"] for m in moves[:5])})

    def check(self, task_id: str, response: dict[str, Any]) -> dict[str, Any]:
        entry = self._tasks.get(task_id)
        if not entry:
            raise ValueError("Task expired — request a new one")
        task, ans = entry["task"], entry["answer"]
        kind = task["kind"]
        correct, extra = False, {}
        if kind in ("transposition", "plan", "pawn_structure"):
            correct = response.get("value") == ans["value"]
            extra = {"answer": ans["value"], "squares": ans.get("squares")}
        elif kind == "move_order":
            board = chess.Board()
            played = []
            try:
                for u in response.get("moves", []):
                    board.push_uci(u)
                    played.append(u)
            except ValueError:
                return {"correct": False, "message": "Illegal move in your sequence."}
            reached = pos_key(board) == ans["epd"]
            correct = reached and played != ans["canonical"]
            extra = {"reached": reached, "same_as_main": played == ans["canonical"]}
        elif kind == "trap":
            board = chess.Board(task["fen"])
            try:
                mv = board.parse_uci(response.get("move", ""))
            except ValueError:
                return {"correct": False, "message": "Illegal move."}
            if task["variant"] == "avoid":
                correct = mv.uci() != ans["blunder"]
                extra = {"trap_move": ans["blunder_san"], "line": ans["line"],
                         "note": "Any move other than the trap move is accepted here; analyse it with an engine to compare alternatives."}
            else:
                correct = mv.uci() == ans["move"]
                extra = {"answer": ans["move"], "answer_san": ans["san"], "line": ans["line"]}
        elif kind == "labyrinth":
            correct = response.get("move") in ans["good"]
            extra = {"good": ans["good"]}
        self.log(ans.get("mode", kind), correct, response.get("time_ms"), int(response.get("hints", 0)),
                 detail={"task": kind, "opening": task.get("opening") or task.get("name")})
        del self._tasks[task_id]
        return {"correct": correct, "explain": ans.get("explain", ""), **extra}

    def lesson(self, opening_id: str) -> dict[str, Any]:
        """Guided opening lesson: every move with its explanation, key squares and plans (authored content)."""
        op = openings.find(opening_id)
        if not op:
            raise ValueError("Unknown opening")
        board = chess.Board()
        steps = []
        related = [o for o in openings.catalog() if o["plies"] < op["plies"] and o["uci"] == op["uci"][:o["plies"]]]
        notes = {o["plies"]: o for o in related}
        notes[op["plies"]] = op
        for i, u in enumerate(op["uci"]):
            mv = chess.Move.from_uci(u)
            san = board.san(mv)
            board.push(mv)
            n = notes.get(i + 1)
            steps.append({"ply": i + 1, "uci": u, "san": san, "fen": board.fen(),
                          "title": n["name"] if n else None, "text": n["idea"] if n else "",
                          "arrows": [{"from": u[:2], "to": u[2:4], "kind": "best"}]})
        children = [o for o in openings.catalog() if o["plies"] > op["plies"] and o["uci"][:op["plies"]] == op["uci"]]
        return {"opening": op, "steps": steps, "continuations": [{"id": c["id"], "name": c["name"], "eco": c["eco"],
                                                                  "next": c["moves"][op["plies"]:op["plies"] + 4]} for c in children[:12]],
                "traps": [t for t in openings.traps() if t["opening"].split(":")[0] == op["name"].split(":")[0]]}

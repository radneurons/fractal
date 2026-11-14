"""Book persistence: every change is a new immutable version, so any improvement can be
inspected, compared and reversed.  Also hosts the evidence-driven improvement cycle
(weak-branch detection -> proposals -> human approval -> new version).
"""
from __future__ import annotations

from typing import Any

import chess

from ..chessx import Score, pos_key
from ..db import Database, new_id, now, pack, unpack
from .model import PROFILES, Book, BookError, diff_books


class BookStore:
    def __init__(self, db: Database):
        self.db = db
        self._cache: dict[tuple[str, int], Book] = {}

    # -- CRUD ----------------------------------------------------------------
    def create(self, name: str, book: Book | None = None, *, description: str = "", source: str = "", profile: str = "main",
               target_color: str | None = None, summary: str = "Initial version", meta: dict[str, Any] | None = None) -> dict[str, Any]:
        if profile not in PROFILES:
            raise BookError(f"Unknown book profile '{profile}'")
        row = {"id": new_id("book"), "name": name, "description": description, "source": source, "profile": profile,
               "target_color": target_color, "meta": meta or {}, "head_version": 0, "created_at": now(), "updated_at": now()}
        with self.db.tx():
            self.db.insert("books", row)
            self.commit(row["id"], book or Book(), summary)
        return self.info(row["id"])

    def list(self) -> list[dict[str, Any]]:
        out = []
        for b in self.db.all("books", order="updated_at DESC"):
            v = self.db.all("book_versions", "book_id=? AND version=?", (b["id"], b["head_version"]), cols="stats,created_at,summary")
            out.append({**b, "stats": v[0]["stats"] if v else {}, "head_summary": v[0]["summary"] if v else ""})
        return out

    def info(self, book_id: str) -> dict[str, Any]:
        b = self.db.get("books", book_id)
        if not b:
            raise BookError(f"Unknown book {book_id}")
        versions = self.db.all("book_versions", "book_id=?", (book_id,), order="version DESC",
                               cols="id,version,parent_version,summary,stats,changes,evidence,created_at")
        return {**b, "versions": versions, "stats": versions[0]["stats"] if versions else {},
                "profile_label": PROFILES.get(b["profile"], b["profile"]),
                "proposals": self.db.pref(f"book_proposals:{book_id}", [])}

    def update_meta(self, book_id: str, **changes: Any) -> dict[str, Any]:
        allowed = {k: v for k, v in changes.items() if k in ("name", "description", "source", "profile", "target_color", "meta")
                   and v is not None}
        if "profile" in allowed and allowed["profile"] not in PROFILES:
            raise BookError("Unknown book profile")
        if allowed:
            self.db.update("books", book_id, {**allowed, "updated_at": now()})
        return self.info(book_id)

    def delete(self, book_id: str) -> None:
        self.db.delete("books", book_id)
        self._cache = {k: v for k, v in self._cache.items() if k[0] != book_id}

    # -- versions --------------------------------------------------------------
    def load(self, book_id: str, version: int | None = None) -> Book:
        b = self.db.get("books", book_id)
        if not b:
            raise BookError(f"Unknown book {book_id}")
        v = b["head_version"] if version is None else version
        key = (book_id, v)
        if key not in self._cache:
            rows = self.db.query("SELECT data FROM book_versions WHERE book_id=? AND version=?", (book_id, v))
            if not rows:
                raise BookError(f"Book {book_id} has no version {v}")
            self._cache[key] = Book(unpack(rows[0]["data"]))
            if len(self._cache) > 24:
                self._cache.pop(next(iter(self._cache)))
        return self._cache[key].copy()

    def head(self, book_id: str) -> Book:
        """Read-only access to the head (do not mutate the returned object)."""
        b = self.db.get("books", book_id)
        if not b:
            raise BookError(f"Unknown book {book_id}")
        key = (book_id, b["head_version"])
        if key not in self._cache:
            self.load(book_id)
        return self._cache[key]

    def commit(self, book_id: str, book: Book, summary: str, evidence: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        """Save `book` as the next version.  Atomic: version row + head pointer move together."""
        with self.db.tx():
            b = self.db.get("books", book_id)
            if not b:
                raise BookError(f"Unknown book {book_id}")
            parent = b["head_version"]
            changes: dict[str, Any] = {}
            if parent > 0:
                changes = diff_books(self.load(book_id, parent), book)
            version = parent + 1
            row = {"id": new_id("bv"), "book_id": book_id, "version": version, "parent_version": parent or None,
                   "summary": summary, "data": pack(book.to_dict()), "stats": book.stats(), "changes": changes,
                   "evidence": evidence or [], "created_at": now()}
            self.db.insert("book_versions", row)
            self.db.update("books", book_id, {"head_version": version, "updated_at": now()})
        self._cache[(book_id, version)] = book.copy()
        return {"version": version, "summary": summary, "changes": changes, "stats": row["stats"]}

    def restore(self, book_id: str, version: int) -> dict[str, Any]:
        """Reversible restore: the old content becomes a *new* head version; nothing is deleted."""
        old = self.load(book_id, version)
        return self.commit(book_id, old, f"Restore version {version}")

    def compare(self, book_a: str, version_a: int | None, book_b: str, version_b: int | None) -> dict[str, Any]:
        return diff_books(self.load(book_a, version_a), self.load(book_b, version_b), sample=200)

    # -- browsing ----------------------------------------------------------------
    def position(self, book_id: str, fen: str | None) -> dict[str, Any]:
        book = self.head(book_id)
        board = chess.Board(fen) if fen else chess.Board(book.root_fen)
        return {"fen": board.fen(), "epd": pos_key(board), "moves": book.moves_at(board), "in_book": book.node(board) is not None}

    def tree(self, book_id: str, fen: str | None = None, depth: int = 4, max_nodes: int = 600) -> dict[str, Any]:
        """Nested tree for the explorer, with transposition markers."""
        book = self.head(book_id)
        root = chess.Board(fen) if fen else chess.Board(book.root_fen)
        seen: dict[str, str] = {}
        count = 0

        def build(board: chess.Board, d: int, path: str) -> dict[str, Any]:
            nonlocal count
            key = pos_key(board)
            node: dict[str, Any] = {"id": path or "root", "fen": board.fen(), "children": [], "transposition_of": None}
            if key in seen and path:
                node["transposition_of"] = seen[key]
                return node
            seen[key] = path or "root"
            if d <= 0:
                node["truncated"] = bool(book.positions.get(key, {}).get("moves"))
                return node
            for m in book.moves_at(board):
                if count >= max_nodes:
                    node["truncated"] = True
                    break
                count += 1
                b = board.copy(stack=False)
                b.push(chess.Move.from_uci(m["uci"]))
                child = build(b, d - 1, (path + " " if path else "") + m["uci"])
                child.update({"uci": m["uci"], "san": m["san"], "weight": m["weight"], "share": m["share"],
                              "games": m["games"], "score": m["score"], "status": m["status"], "eval": m["eval"],
                              "comment": m.get("comment", ""), "confidence": m.get("confidence")})
                node["children"].append(child)
            return node

        return {"root": build(root, depth, ""), "nodes": count}

    # -- editing (each edit = a version) ----------------------------------------
    def edit_move(self, book_id: str, fen: str, move: str, *, action: str = "set", weight: float | None = None,
                  status: str | None = None, comment: str | None = None, evidence: list[dict[str, Any]] | None = None,
                  summary: str | None = None) -> dict[str, Any]:
        book = self.load(book_id)
        board = chess.Board(fen)
        try:
            mv = chess.Move.from_uci(move)
            if mv not in board.legal_moves:
                raise ValueError
        except ValueError:
            mv = board.parse_san(move)
        san = board.san(mv)
        if action == "remove":
            if not book.remove_move(board, mv.uci()):
                raise BookError("Move is not in the book")
            return self.commit(book_id, book, summary or f"Remove {san}", evidence)
        m = book.add_move(board, mv, weight=weight if weight is not None else 1.0, accumulate=False if weight is not None else True,
                          status=status, source="manual") if not book.contains(board, mv) else book.node(board)["moves"][mv.uci()]  # type: ignore[index]
        if weight is not None:
            m["weight"] = float(weight)
        if status:
            m["status"] = status
        if comment is not None:
            m["comment"] = comment
        return self.commit(book_id, book, summary or f"Edit {san}", evidence)

    def add_line(self, book_id: str, start_fen: str | None, moves: list[str], *, status: str = "candidate",
                 weight: float = 1.0, comment: str = "", evidence: list[dict[str, Any]] | None = None,
                 summary: str | None = None, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        book = self.load(book_id)
        board = chess.Board(start_fen) if start_fen else chess.Board(book.root_fen)
        sans = []
        for i, text in enumerate(moves):
            try:
                mv = chess.Move.from_uci(text)
                if mv not in board.legal_moves:
                    raise ValueError
            except ValueError:
                mv = board.parse_san(text)
            sans.append(board.san(mv))
            last = i == len(moves) - 1
            if not book.contains(board, mv):
                book.add_move(board, mv, weight=weight, source="research", status=status, accumulate=False,
                              comment=comment if last else "", **((extra or {}) if last else {}))
            elif last:
                m = book.node(board)["moves"][mv.uci()]  # type: ignore[index]
                m["status"] = status
                m.update(extra or {})
                if comment:
                    m["comment"] = comment
            board.push(mv)
        return self.commit(book_id, book, summary or f"Add line {' '.join(sans)}", evidence)

    # -- improvement cycle ----------------------------------------------------------
    def weak_branches(self, book_id: str, max_ply: int = 16, limit: int = 40) -> list[dict[str, Any]]:
        """Positions that deserve research: single-reply nodes, thinly tested moves, poor evals, unexplored leaves."""
        book = self.head(book_id)
        info = self.db.get("books", book_id) or {}
        target = info.get("target_color")
        out = []
        for board, ply in book.walk(max_ply):
            node = book.positions.get(pos_key(board))
            side = "white" if board.turn else "black"
            ours = target is None or side == target
            reasons = []
            if not node or not node["moves"]:
                if ply and ply < max_ply:
                    reasons.append("leaf: no continuation stored")
            else:
                ms = node["moves"]
                if ours and len(ms) == 1:
                    reasons.append("single repertoire move: no alternative prepared")
                thin = [m["san"] for m in ms.values() if 0 < m["games"] < 6]
                if thin:
                    reasons.append("thin evidence for " + ", ".join(thin[:3]))
                untested = [m["san"] for m in ms.values() if m["games"] == 0 and m.get("eval") is None]
                if untested and len(untested) == len(ms):
                    reasons.append("never evaluated or tested")
                bad = [m["san"] for m in ms.values() if m.get("eval") and Score.from_dict(m["eval"]).expected() < 0.40]
                if bad and ours:
                    reasons.append("poor stored evaluation for " + ", ".join(bad[:3]))
                if not ours and len(ms) < 2:
                    reasons.append("only one opponent reply covered")
            if reasons:
                out.append({"fen": board.fen(), "ply": ply, "side": side, "reasons": reasons,
                            "priority": round((3.0 if ours else 1.5) / (1 + ply / 6) * len(reasons), 3)})
        out.sort(key=lambda x: -x["priority"])
        return out[:limit]

    def propose_from_findings(self, book_id: str, findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Turn research findings into *pending* proposals.  Nothing changes until a human approves."""
        book = self.head(book_id)
        info = self.db.get("books", book_id) or {}
        proposals = list(self.db.pref(f"book_proposals:{book_id}", []))
        known = {(p["fen"], p["move"]) for p in proposals}
        for f in findings:
            board = chess.Board(f["fen"])
            mv = chess.Move.from_uci(f["move_uci"])
            if (f["fen"], f["move_uci"]) in known or mv not in board.legal_moves:
                continue
            scores = f.get("scores") or {}
            viability = (scores.get("objective_viability") or {}).get("value", 0)
            confidence = (scores.get("research_confidence") or {}).get("value", 0)
            exists = book.contains(board, mv)
            if f["category"] == "clearly_refuted" or f["status"] == "rejected":
                if not exists:
                    continue
                kind, reason = "reject", "Independent verification refuted this move"
            elif exists:
                kind, reason = "reweight", "Research evidence available for an existing book move"
            else:
                kind, reason = "add", f"{f['category'].replace('_', ' ')} from discovery research"
            proposals.append({"id": new_id("prop"), "type": kind, "fen": f["fen"], "move": f["move_uci"], "san": f["move_san"],
                              "line_san": f.get("line_san", ""), "reason": reason, "finding_id": f["id"],
                              "category": f["category"], "viability": viability, "confidence": confidence,
                              "target_status": "rejected" if kind == "reject" else ("approved" if f["status"] == "approved" else "candidate"),
                              "suits_profile": _suits(info.get("profile", "main"), f), "created_at": now(), "state": "pending"})
        self.db.set_pref(f"book_proposals:{book_id}", proposals)
        return proposals

    def decide_proposals(self, book_id: str, decisions: dict[str, str]) -> dict[str, Any]:
        """decisions: {proposal_id: 'approve' | 'reject'}.  Approved ones become ONE new version with evidence links."""
        proposals = list(self.db.pref(f"book_proposals:{book_id}", []))
        book = self.load(book_id)
        applied, evidence = [], []
        for p in proposals:
            d = decisions.get(p["id"])
            if p["state"] != "pending" or d not in ("approve", "reject"):
                continue
            p["state"] = "approved" if d == "approve" else "declined"
            p["decided_at"] = now()
            if d != "approve":
                continue
            board = chess.Board(p["fen"])
            mv = chess.Move.from_uci(p["move"])
            extra = {"confidence": p.get("confidence"), "finding_id": p.get("finding_id")}
            if p["type"] == "reject":
                node = book.node(board)
                if node and p["move"] in node["moves"]:
                    node["moves"][p["move"]].update({"status": "rejected", "weight": 0.0})
            elif book.contains(board, mv):
                book.node(board)["moves"][p["move"]].update({"status": p["target_status"], **extra})  # type: ignore[index]
            else:
                book.add_move(board, mv, weight=max(0.2, float(p.get("viability") or 0.5)), source="research",
                              status=p["target_status"], accumulate=False, comment=p["reason"], **extra)
            applied.append(p["san"])
            evidence.append({"proposal": p["id"], "finding_id": p.get("finding_id"), "type": p["type"], "san": p["san"],
                             "fen": p["fen"]})
        result: dict[str, Any] = {"applied": applied, "version": None}
        with self.db.tx():
            if applied:
                result.update(self.commit(book_id, book, "Research-backed update: " + ", ".join(applied[:6])
                                          + ("…" if len(applied) > 6 else ""), evidence))
            self.db.set_pref(f"book_proposals:{book_id}", proposals)
        return result


def _suits(profile: str, finding: dict[str, Any]) -> str:
    s = finding.get("scores") or {}
    g = lambda k: (s.get(k) or {}).get("value", 0) or 0
    if profile == "surprise":
        return "good fit" if g("novelty_in_database") >= 0.6 and g("objective_viability") >= 0.5 else "weak fit"
    if profile == "aggressive":
        return "good fit" if g("tactical_potential") >= 0.5 and g("objective_viability") >= 0.45 else "weak fit"
    if profile in ("solid", "main"):
        return "good fit" if g("objective_viability") >= 0.7 and g("research_confidence") >= 0.5 else "needs more evidence"
    return "candidate"

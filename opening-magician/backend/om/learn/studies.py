"""Professional study system: studies -> chapters, each chapter a full PGN game tree with
variations, comments, NAGs, arrows ([%cal]) and highlighted squares ([%csl]).

All editing goes through python-chess game nodes, so anything saved here re-exports as
standard PGN that other chess software reads.
"""
from __future__ import annotations

import io
from typing import Any

import chess
from ..chessx import parse_move
import chess.pgn
import chess.svg

from .. import openings
from ..chessx import game_to_pgn, game_tree, numbered, read_games
from ..db import Database, new_id, now

KINDS = ["opening", "tactical", "engine_research", "tournament_analysis", "game_review", "move_order", "physical_lesson",
         "trap_collection", "repertoire"]
NAG_SYMBOLS = {1: "!", 2: "?", 3: "!!", 4: "??", 5: "!?", 6: "?!", 10: "=", 13: "∞", 14: "⩲", 15: "⩱", 16: "±", 17: "∓",
               18: "+−", 19: "−+", 22: "⨀", 146: "N"}


class StudyError(ValueError):
    pass


def _load(pgn: str) -> chess.pgn.Game:
    game = chess.pgn.read_game(io.StringIO(pgn)) if pgn.strip() else None
    return game or chess.pgn.Game()


def _node_at(game: chess.pgn.Game, path: list[int]) -> chess.pgn.GameNode:
    node: chess.pgn.GameNode = game
    for i in path:
        if i < 0 or i >= len(node.variations):
            raise StudyError("Invalid path in study tree")
        node = node.variations[i]
    return node


class StudyManager:
    def __init__(self, db: Database):
        self.db = db

    # ------------------------------------------------------------------ studies
    def create(self, title: str, description: str = "", kind: str = "opening", tags: list[str] | None = None,
               refs: dict[str, Any] | None = None) -> dict[str, Any]:
        if kind not in KINDS:
            raise StudyError(f"Unknown study type '{kind}'")
        row = {"id": new_id("study"), "title": title or "Untitled study", "description": description, "kind": kind,
               "tags": tags or [], "refs": refs or {}, "created_at": now(), "updated_at": now()}
        self.db.insert("studies", row)
        return row

    def list(self) -> list[dict[str, Any]]:
        out = []
        for s in self.db.all("studies", order="updated_at DESC"):
            s["chapters"] = self.db.scalar("SELECT COUNT(*) FROM chapters WHERE study_id=?", (s["id"],))
            out.append(s)
        return out

    def get(self, sid: str) -> dict[str, Any]:
        s = self.db.get("studies", sid)
        if not s:
            raise StudyError("Unknown study")
        s["chapters"] = self.db.all("chapters", "study_id=?", (sid,), order="position, updated_at",
                                    cols="id,title,orientation,position,meta,updated_at")
        s["links"] = self.db.links_for("study", sid)
        return s

    def update(self, sid: str, **changes: Any) -> dict[str, Any]:
        allowed = {k: v for k, v in changes.items() if k in ("title", "description", "kind", "tags", "refs") and v is not None}
        if "kind" in allowed and allowed["kind"] not in KINDS:
            raise StudyError("Unknown study type")
        self.db.update("studies", sid, {**allowed, "updated_at": now()})
        return self.get(sid)

    def delete(self, sid: str) -> None:
        self.db.delete("studies", sid)

    # ------------------------------------------------------------------ chapters
    def add_chapter(self, sid: str, title: str, pgn: str = "", orientation: str = "white", meta: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.db.get("studies", sid):
            raise StudyError("Unknown study")
        game = _load(pgn)
        if title:
            game.headers["Event"] = title
        pos = (self.db.scalar("SELECT COALESCE(MAX(position),-1) FROM chapters WHERE study_id=?", (sid,)) or 0) + 1
        row = {"id": new_id("ch"), "study_id": sid, "title": title or game.headers.get("Event", "Chapter"),
               "pgn": game_to_pgn(game), "orientation": orientation, "position": pos, "meta": meta or {}, "updated_at": now()}
        self.db.insert("chapters", row)
        self.db.update("studies", sid, {"updated_at": now()})
        return self.chapter(row["id"])

    def chapter(self, cid: str) -> dict[str, Any]:
        c = self.db.get("chapters", cid)
        if not c:
            raise StudyError("Unknown chapter")
        game = _load(c["pgn"])
        board = game.board()
        end = game.end().board()
        return {**c, "tree": game_tree(game), "opening": openings.identify(end), "start_fen": board.fen(),
                "nag_symbols": NAG_SYMBOLS}

    def delete_chapter(self, cid: str) -> None:
        self.db.delete("chapters", cid)

    def set_pgn(self, cid: str, pgn: str, title: str | None = None, orientation: str | None = None) -> dict[str, Any]:
        game = _load(pgn)
        upd: dict[str, Any] = {"pgn": game_to_pgn(game), "updated_at": now()}
        if title is not None:
            upd["title"] = title
        if orientation is not None:
            upd["orientation"] = orientation
        self.db.update("chapters", cid, upd)
        return self.chapter(cid)

    def edit(self, cid: str, op: str, path: list[int], **kw: Any) -> dict[str, Any]:
        """Tree operations.  `path` = child indices from the root.
        add_move(move) · delete · promote · make_main · comment(text) · nags(list) · shapes(arrows, squares)"""
        c = self.db.get("chapters", cid)
        if not c:
            raise StudyError("Unknown chapter")
        game = _load(c["pgn"])
        node = _node_at(game, path)
        new_path = list(path)
        if op == "add_move":
            board = node.board()
            text = kw["move"]
            try:
                mv = parse_move(board, text)
            except ValueError:
                raise StudyError(f"Illegal move {text}")
            for i, child in enumerate(node.variations):
                if child.move == mv:
                    new_path = path + [i]
                    break
            else:
                node.add_variation(mv)
                new_path = path + [len(node.variations) - 1]
        elif op == "delete":
            if node.parent is None:
                raise StudyError("Cannot delete the root")
            node.parent.remove_variation(node)
            new_path = path[:-1]
        elif op == "promote":
            if node.parent is not None:
                node.parent.promote(node)
                idx = node.parent.variations.index(node)
                new_path = path[:-1] + [idx]
        elif op == "make_main":
            cur = node
            while cur.parent is not None:
                cur.parent.promote_to_main(cur)
                cur = cur.parent
            new_path = [0] * len(path)
        elif op == "comment":
            node.comment = _keep_shapes(node, kw.get("text", ""))
        elif op == "nags":
            node.nags = {int(n) for n in kw.get("nags", [])}
        elif op == "shapes":
            node.set_arrows([chess.svg.Arrow(chess.parse_square(a["from"]), chess.parse_square(a["to"]), color=a.get("color", "green"))
                             for a in kw.get("arrows", [])] +
                            [chess.svg.Arrow(chess.parse_square(s["square"]), chess.parse_square(s["square"]), color=s.get("color", "green"))
                             for s in kw.get("squares", [])])
        else:
            raise StudyError(f"Unknown edit operation '{op}'")
        self.db.update("chapters", cid, {"pgn": game_to_pgn(game), "updated_at": now()})
        self.db.update("studies", c["study_id"], {"updated_at": now()})
        return {**self.chapter(cid), "path": new_path}

    # ------------------------------------------------------------------ conversions
    def import_pgn(self, pgn: str, title: str | None = None, kind: str = "game_review", sid: str | None = None) -> dict[str, Any]:
        games = read_games(pgn)
        if not games:
            raise StudyError("No games found in the PGN")
        if sid is None:
            first = games[0].headers
            sid = self.create(title or (first.get("Event") if first.get("Event", "?") != "?" else None) or
                              f"{first.get('White', '?')} – {first.get('Black', '?')}", kind=kind)["id"]
        for i, g in enumerate(games):
            h = g.headers
            name = f"{h.get('White', '?')} – {h.get('Black', '?')}" if h.get("White", "?") != "?" else h.get("Event", f"Chapter {i + 1}")
            self.add_chapter(sid, name if len(games) > 1 or name != "?" else f"Chapter {i + 1}", game_to_pgn(g))
        return self.get(sid)

    def from_game(self, game_row: dict[str, Any], sid: str | None = None, kind: str = "game_review") -> dict[str, Any]:
        title = f"{game_row.get('white')} – {game_row.get('black')}"
        if sid is None:
            sid = self.create(title, kind=kind, refs={"game_id": game_row["id"]})["id"]
        ch = self.add_chapter(sid, title, game_row["pgn"], meta={"game_id": game_row["id"]})
        self.db.link("study", sid, "game", game_row["id"], "contains")
        return {"study_id": sid, "chapter_id": ch["id"]}

    def from_finding(self, f: dict[str, Any], sid: str | None = None) -> dict[str, Any]:
        """Discovery -> annotated study chapter (line, verifier PV, replies and trap as variations)."""
        ev = f["evidence"]
        seed = ev["seed"]
        board = chess.Board(seed["start_fen"])
        game = chess.pgn.Game()
        if seed["start_fen"] != chess.STARTING_FEN:
            game.setup(board)
        game.headers["Event"] = f"Discovery: {f['line_san']}"
        game.headers["Site"] = "Opening Magician Discovery Lab"
        node: chess.pgn.GameNode = game
        for u in seed["moves"]:
            node = node.add_variation(chess.Move.from_uci(u))
        cand = node.add_variation(chess.Move.from_uci(f["move_uci"]))
        r = f["ranking"]
        sc = f.get("scores") or {}
        bits = [f"Candidate ranked #{r['original_rank']} by {r['ranking_engine']} at depth {r.get('ranking_depth')}"
                f" ({r['original_score']['text']})."]
        if r.get("verification_rank"):
            bits.append(f"Verifier {r.get('verification_engine')} ranks it #{r['verification_rank']}"
                        f"{'' if r.get('verification_rank_exact') else '+'} at depth {r.get('verification_depth')} "
                        f"({r['verification_score']['text']}).")
        bits.append(f"Category: {f['category'].replace('_', ' ')}; status: {f['status'].replace('_', ' ')}.")
        for k in ("objective_viability", "practical_difficulty", "research_confidence"):
            if k in sc:
                bits.append(f"{k.replace('_', ' ').title()} {sc[k]['value']:.2f}.")
        cand.comment = " ".join(bits)
        cand.nags.add(5)
        ver = ev.get("verification") or {}
        if ver.get("best_move") and ver["best_move"] != f["move_uci"]:
            alt = node.add_variation(chess.Move.from_uci(ver["best_move"]))
            alt.comment = f"The verifier's first choice ({ver['best_score']['text']})."
        # verifier's expected continuation
        line = cand
        b = cand.board()
        for san in (ver.get("pv_san") or [])[1:9]:
            try:
                mv = b.parse_san(san)
            except ValueError:
                break
            line = line.add_variation(mv)
            b.push(mv)
        trap = ev.get("trap")
        if trap:
            t = cand.add_variation(chess.Move.from_uci(trap["tempting"]))
            t.nags.add(2)
            t.comment = f"The tempting move. It loses about {trap['loss']:.2f} expected score."
            p = t.add_variation(chess.Move.from_uci(trap["punish"]))
            p.nags.add(1)
            pb = p.board()
            cur = p
            for san in (trap.get("punish_pv") or [])[1:7]:
                try:
                    mv = pb.parse_san(san)
                except ValueError:
                    break
                cur = cur.add_variation(mv)
                pb.push(mv)
        if sid is None:
            sid = self.create(f"Discovery: {f['line_san']}", kind="engine_research",
                              description="Generated from a Discovery Lab finding. Evaluations are evidence at the stated depths.",
                              refs={"finding_id": f["id"], "experiment_id": f.get("experiment_id")})["id"]
        orientation = "white" if chess.Board(f["fen"]).turn else "black"
        ch = self.add_chapter(sid, f["line_san"], game_to_pgn(game), orientation, meta={"finding_id": f["id"]})
        self.db.link("study", sid, "finding", f["id"], "explains")
        return {"study_id": sid, "chapter_id": ch["id"]}

    def from_opening(self, opening_id: str) -> dict[str, Any]:
        op = openings.find(opening_id)
        if not op:
            raise StudyError("Unknown opening")
        sid = self.create(op["name"], op["idea"], "opening", [op["eco"], op["family"]], {"opening_id": opening_id})["id"]
        game = chess.pgn.Game()
        game.headers["Event"] = op["name"]
        game.headers["ECO"] = op["eco"]
        node: chess.pgn.GameNode = game
        for u in op["uci"]:
            node = node.add_variation(chess.Move.from_uci(u))
        node.comment = op["idea"] + " Plans for White: " + "; ".join(op["plans"]["white"]) + ". Plans for Black: " + \
            "; ".join(op["plans"]["black"]) + "."
        for child in [o for o in openings.catalog() if o["plies"] > op["plies"] and o["uci"][:op["plies"]] == op["uci"]][:10]:
            cur = node
            for u in child["uci"][op["plies"]:]:
                mv = chess.Move.from_uci(u)
                nxt = next((v for v in cur.variations if v.move == mv), None)
                cur = nxt or cur.add_variation(mv)
            if not cur.comment:
                cur.comment = f"{child['name']}: {child['idea']}"
        self.add_chapter(sid, op["name"], game_to_pgn(game))
        for t in [t for t in openings.traps() if t["opening"].split(":")[0] == op["name"].split(":")[0]]:
            g = chess.pgn.Game()
            g.headers["Event"] = t["name"]
            n: chess.pgn.GameNode = g
            for i, u in enumerate(t["uci"]):
                n = n.add_variation(chess.Move.from_uci(u))
                if i == t["blunder_ply"]:
                    n.nags.add(4)
                    n.comment = t["explanation"]
            self.add_chapter(sid, "Trap: " + t["name"], game_to_pgn(g), "white" if t["side"] == "white" else "black")
        return self.get(sid)

    def export_pgn(self, sid: str) -> str:
        s = self.db.get("studies", sid)
        if not s:
            raise StudyError("Unknown study")
        out = []
        for c in self.db.all("chapters", "study_id=?", (sid,), order="position, updated_at"):
            game = _load(c["pgn"])
            game.headers["Event"] = f"{s['title']}: {c['title']}"
            if game.headers.get("Site", "?") == "?":
                game.headers["Site"] = "Opening Magician"
            out.append(game_to_pgn(game).strip())
        return "\n\n".join(out) + "\n"

    def playback_sequence(self, cid: str, path: list[int] | None = None) -> dict[str, Any]:
        """Study chapter -> Chessnut playback sequence (the line ending at `path`, or the main line)."""
        c = self.db.get("chapters", cid)
        if not c:
            raise StudyError("Unknown chapter")
        game = _load(c["pgn"])
        nodes: list[chess.pgn.GameNode] = []
        if path:
            node: chess.pgn.GameNode = game
            for i in path:
                node = node.variations[i]
                nodes.append(node)
        else:
            nodes = list(game.mainline())
        ann = {i + 1: n.comment for i, n in enumerate(nodes) if n.comment}
        return {"title": c["title"], "start_fen": game.board().fen(), "moves": [n.move.uci() for n in nodes if n.move],
                "annotations": ann}

    def line_text(self, cid: str) -> str:
        c = self.db.get("chapters", cid)
        game = _load(c["pgn"]) if c else chess.pgn.Game()
        b = game.board()
        sans = []
        for mv in game.mainline_moves():
            sans.append(b.san(mv))
            b.push(mv)
        return numbered(game.board(), sans)


def _keep_shapes(node: chess.pgn.GameNode, text: str) -> str:
    """Replace the human comment text while preserving [%cal]/[%csl] annotations."""
    arrows = node.arrows()
    node.comment = text
    if arrows:
        node.set_arrows(arrows)
    return node.comment

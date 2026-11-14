#!/usr/bin/env python3
"""Apprentice — the small UCI engine bundled with Opening Magician.

It is a genuine UCI engine process (stdin/stdout, MultiPV, searchmoves, stop, clocks),
written in pure Python on top of python-chess.  It is intentionally *weak*
(roughly club-beginner strength): its job is to be the out-of-the-box "explorer"
engine, an opponent for learners, and a deterministic protocol fixture for the
test-suite.  Serious analysis should use a strong native engine such as Stockfish.

Run:  python apprentice.py
"""
from __future__ import annotations

import queue
import random
import sys
import threading
import time

import chess

NAME = "Apprentice 1.0"
INF = 10_000_000
MATE = 1_000_000

VAL = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 333, chess.ROOK: 510, chess.QUEEN: 950, chess.KING: 0}

# Piece-square tables from White's point of view, a1 = index 0.
PST = {
    chess.PAWN: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, -20, -20, 10, 10, 5, 5, -5, -10, 0, 0, -10, -5, 5, 0, 0, 0, 22, 22, 0,
                 0, 0, 5, 5, 10, 27, 27, 10, 5, 5, 10, 10, 20, 30, 30, 20, 10, 10, 50, 50, 50, 50, 50, 50, 50, 50, 0, 0,
                 0, 0, 0, 0, 0, 0],
    chess.KNIGHT: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 5, 5, 0, -20, -40, -30, 5, 10, 15, 15, 10, 5,
                   -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 10, 15, 15, 10, 0, -30,
                   -40, -20, 0, 0, 0, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    chess.BISHOP: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 5, 0, 0, 0, 0, 5, -10, -10, 10, 10, 10, 10, 10, 10, -10,
                   -10, 0, 10, 10, 10, 10, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 0,
                   0, 0, 0, 0, 0, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    chess.ROOK: [0, 0, 0, 5, 5, 0, 0, 0, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
                 -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 5, 10, 10, 10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0,
                 0],
    chess.QUEEN: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 5, 0, 0, 0, 0, -10, -10, 5, 5, 5, 5, 5, 0, -10, 0, 0, 5,
                  5, 5, 5, 0, -5, -5, 0, 5, 5, 5, 5, 0, -5, -10, 0, 5, 5, 5, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20,
                  -10, -10, -5, -5, -10, -10, -20],
    chess.KING: [20, 30, 10, 0, 0, 10, 30, 20, 20, 20, 0, 0, 0, 0, 20, 20, -10, -20, -20, -20, -20, -20, -20, -10, -20,
                 -30, -30, -40, -40, -30, -30, -20, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50,
                 -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30],
}
KING_END = [-50, -30, -30, -30, -30, -30, -30, -50, -30, -30, 0, 0, 0, 0, -30, -30, -30, -10, 20, 30, 30, 20, -10, -30,
            -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30,
            -30, -20, -10, 0, 0, -10, -20, -30, -50, -40, -30, -20, -20, -30, -40, -50]


class Stop(Exception):
    pass


class Searcher:
    def __init__(self) -> None:
        self.nodes = 0
        self.seldepth = 0
        self.stop_flag = threading.Event()
        self.deadline: float | None = None
        self.node_limit: int | None = None
        self.tt: dict[object, tuple[int, int, int, chess.Move | None]] = {}
        self.killers: dict[int, list[chess.Move]] = {}
        self.noise = 0
        self.rng = random.Random(1)

    # -- evaluation -------------------------------------------------------
    def evaluate(self, b: chess.Board) -> int:
        score = 0
        endgame = len(b.pieces(chess.QUEEN, True)) + len(b.pieces(chess.QUEEN, False)) == 0 or \
            chess.popcount(b.occupied) <= 12
        for sq, p in b.piece_map().items():
            idx = sq if p.color else chess.square_mirror(sq)
            table = KING_END if (p.piece_type == chess.KING and endgame) else PST[p.piece_type]
            v = VAL[p.piece_type] + table[idx]
            score += v if p.color else -v
        if len(b.pieces(chess.BISHOP, True)) >= 2:
            score += 30
        if len(b.pieces(chess.BISHOP, False)) >= 2:
            score -= 30
        if self.noise:
            score += self.rng.randint(-self.noise, self.noise)
        return score if b.turn else -score

    # -- helpers ----------------------------------------------------------
    def check_time(self) -> None:
        if self.stop_flag.is_set():
            raise Stop
        if self.node_limit is not None and self.nodes >= self.node_limit:
            raise Stop
        if self.deadline is not None and (self.nodes & 255) == 0 and time.perf_counter() >= self.deadline:
            raise Stop

    def order(self, b: chess.Board, moves, tt_move, ply: int):
        killers = self.killers.get(ply, ())

        def key(m: chess.Move) -> int:
            if m == tt_move:
                return 1_000_000
            s = 0
            victim = b.piece_type_at(m.to_square)
            if victim:
                s += 10_000 + 10 * VAL[victim] - VAL[b.piece_type_at(m.from_square) or chess.PAWN]
            elif b.is_en_passant(m):
                s += 10_500
            if m.promotion:
                s += 9_000 + VAL[m.promotion]
            if m in killers:
                s += 5_000
            return s

        return sorted(moves, key=key, reverse=True)

    def quiesce(self, b: chess.Board, alpha: int, beta: int, ply: int) -> int:
        self.nodes += 1
        self.check_time()
        self.seldepth = max(self.seldepth, ply)
        if b.is_check():
            moves = list(b.legal_moves)
            if not moves:
                return -MATE + ply
            stand = -INF
        else:
            stand = self.evaluate(b)
            if stand >= beta:
                return stand
            alpha = max(alpha, stand)
            moves = [m for m in b.generate_legal_captures()] + [m for m in b.legal_moves if m.promotion and not b.is_capture(m)]
            if ply > 40:
                return stand
        best = stand
        for m in self.order(b, moves, None, ply):
            b.push(m)
            v = -self.quiesce(b, -beta, -alpha, ply + 1)
            b.pop()
            if v > best:
                best = v
                if v > alpha:
                    alpha = v
                    if alpha >= beta:
                        break
        return best

    def negamax(self, b: chess.Board, depth: int, alpha: int, beta: int, ply: int) -> int:
        if ply and (b.is_repetition(2) or b.halfmove_clock >= 100 or b.is_insufficient_material()):
            return 0
        if depth <= 0:
            return self.quiesce(b, alpha, beta, ply)
        self.nodes += 1
        self.check_time()
        key = b._transposition_key()
        hit = self.tt.get(key)
        tt_move = None
        if hit:
            tdepth, tflag, tval, tt_move = hit
            if tdepth >= depth and ply:
                if tflag == 0 or (tflag == 1 and tval >= beta) or (tflag == 2 and tval <= alpha):
                    return tval
        moves = list(b.legal_moves)
        if not moves:
            return -MATE + ply if b.is_check() else 0
        if b.is_check():
            depth += 1
        best, best_move, a0 = -INF, None, alpha
        for m in self.order(b, moves, tt_move, ply):
            b.push(m)
            v = -self.negamax(b, depth - 1, -beta, -alpha, ply + 1)
            b.pop()
            if v > best:
                best, best_move = v, m
                if v > alpha:
                    alpha = v
                    if alpha >= beta:
                        if not b.is_capture(m):
                            ks = self.killers.setdefault(ply, [])
                            if m not in ks:
                                ks.insert(0, m)
                                del ks[2:]
                        break
        flag = 0 if a0 < best < beta else (1 if best >= beta else 2)
        if len(self.tt) > 400_000:
            self.tt.clear()
        self.tt[key] = (depth, flag, best, best_move)
        return best

    def pv_from(self, b: chess.Board, first: chess.Move, maxlen: int) -> list[chess.Move]:
        pv, bb = [first], b.copy(stack=False)
        bb.push(first)
        seen = set()
        while len(pv) < maxlen:
            hit = self.tt.get(bb._transposition_key())
            if not hit or hit[3] is None or hit[3] not in bb.legal_moves:
                break
            k = bb._transposition_key()
            if k in seen:
                break
            seen.add(k)
            pv.append(hit[3])
            bb.push(hit[3])
        return pv


def fmt_score(v: int) -> str:
    if abs(v) >= MATE - 1000:
        plies = MATE - abs(v)
        n = (plies + 1) // 2
        return f"mate {n if v > 0 else -n}"
    return f"cp {v}"


class Engine:
    def __init__(self) -> None:
        self.board = chess.Board()
        self.opts = {"MultiPV": 1, "Skill Level": 20, "Hash": 16, "Move Overhead": 30, "Seed": 1}
        self.search = Searcher()
        self.thread: threading.Thread | None = None
        self.out_lock = threading.Lock()

    def send(self, line: str) -> None:
        with self.out_lock:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()

    # -- command handling ---------------------------------------------------
    def loop(self) -> None:
        for raw in sys.stdin:
            line = raw.strip()
            if not line:
                continue
            cmd, _, rest = line.partition(" ")
            if cmd == "uci":
                self.send(f"id name {NAME}")
                self.send("id author Opening Magician")
                self.send("option name MultiPV type spin default 1 min 1 max 64")
                self.send("option name Skill Level type spin default 20 min 0 max 20")
                self.send("option name Hash type spin default 16 min 1 max 1024")
                self.send("option name Move Overhead type spin default 30 min 0 max 5000")
                self.send("option name Seed type spin default 1 min 0 max 1000000")
                self.send("uciok")
            elif cmd == "isready":
                self.send("readyok")
            elif cmd == "setoption":
                self.setoption(rest)
            elif cmd == "ucinewgame":
                self.stop()
                self.search.tt.clear()
                self.search.killers.clear()
            elif cmd == "position":
                self.stop()
                self.position(rest)
            elif cmd == "go":
                self.stop()
                self.go(rest)
            elif cmd == "stop":
                self.stop()
            elif cmd == "quit":
                self.stop()
                return

    def setoption(self, rest: str) -> None:
        toks = rest.split()
        if "name" not in toks:
            return
        ni = toks.index("name")
        vi = toks.index("value") if "value" in toks else len(toks)
        name = " ".join(toks[ni + 1:vi])
        value = " ".join(toks[vi + 1:])
        for k in self.opts:
            if k.lower() == name.lower():
                try:
                    self.opts[k] = int(value)
                except ValueError:
                    pass

    def position(self, rest: str) -> None:
        toks = rest.split()
        if not toks:
            return
        if toks[0] == "startpos":
            board, i = chess.Board(), 1
        elif toks[0] == "fen":
            j = toks.index("moves") if "moves" in toks else len(toks)
            board, i = chess.Board(" ".join(toks[1:j])), j
        else:
            return
        if i < len(toks) and toks[i] == "moves":
            for u in toks[i + 1:]:
                board.push_uci(u)
        self.board = board

    def stop(self) -> None:
        if self.thread and self.thread.is_alive():
            self.search.stop_flag.set()
            self.thread.join()
        self.thread = None

    def go(self, rest: str) -> None:
        toks = rest.split()
        params: dict[str, int] = {}
        searchmoves: list[str] = []
        infinite = False
        i = 0
        while i < len(toks):
            t = toks[i]
            if t in ("depth", "movetime", "nodes", "wtime", "btime", "winc", "binc", "movestogo", "mate") and i + 1 < len(toks):
                params[t] = int(toks[i + 1])
                i += 2
            elif t == "infinite":
                infinite = True
                i += 1
            elif t == "searchmoves":
                i += 1
                while i < len(toks) and len(toks[i]) in (4, 5) and toks[i][0] in "abcdefgh":
                    searchmoves.append(toks[i])
                    i += 1
            else:
                i += 1
        self.search.stop_flag.clear()
        self.thread = threading.Thread(target=self.think, args=(self.board.copy(), params, searchmoves, infinite), daemon=True)
        self.thread.start()

    # -- search driver ------------------------------------------------------
    def think(self, board: chess.Board, params: dict[str, int], searchmoves: list[str], infinite: bool) -> None:
        s = self.search
        skill = max(0, min(20, self.opts["Skill Level"]))
        s.rng = random.Random(self.opts["Seed"] * 7919 + len(board.move_stack) + chess.popcount(board.occupied))
        s.noise = 0 if skill >= 20 else (20 - skill) * 6
        s.nodes, s.seldepth = 0, 0
        # A fresh table per search keeps results independent of what was searched before
        # (deterministic rankings matter more here than raw speed).
        s.tt.clear()
        s.killers.clear()
        s.node_limit = params.get("nodes")
        start = time.perf_counter()
        s.deadline = None
        max_depth = params.get("depth", 64)
        if skill < 20:
            max_depth = min(max_depth, 1 + skill // 4)
        if "movetime" in params:
            s.deadline = start + max(0.001, (params["movetime"] - min(self.opts["Move Overhead"], params["movetime"] // 2)) / 1000)
        elif ("wtime" in params or "btime" in params) and not infinite:
            mine = params.get("wtime" if board.turn else "btime", 1000)
            inc = params.get("winc" if board.turn else "binc", 0)
            mtg = params.get("movestogo", 30)
            budget = mine / max(mtg, 2) + inc * 0.8 - self.opts["Move Overhead"]
            budget = max(10, min(budget, mine * 0.5))
            s.deadline = start + budget / 1000
        elif not infinite and "depth" not in params and "nodes" not in params:
            s.deadline = start + 1.0

        legal = list(board.legal_moves)
        roots = [m for m in legal if not searchmoves or m.uci() in searchmoves]
        if not roots:
            self.send("bestmove 0000")
            return
        multipv = max(1, min(self.opts["MultiPV"], len(roots)))
        if skill < 20:
            multipv = max(multipv, min(4, len(roots)))
        lines: list[tuple[int, chess.Move, list[chess.Move]]] = []
        order = list(roots)
        try:
            for depth in range(1, max_depth + 1):
                current: list[tuple[int, chess.Move, list[chess.Move]]] = []
                excluded: list[chess.Move] = []
                for pv_i in range(multipv):
                    best_v, best_m, alpha = -INF, None, -INF
                    cand = [m for m in order if m not in excluded]
                    for m in cand:
                        board.push(m)
                        v = -s.negamax(board, depth - 1, -INF, -alpha if alpha > -INF else INF, 1)
                        board.pop()
                        if v > best_v:
                            best_v, best_m = v, m
                            alpha = max(alpha, v)
                    assert best_m is not None
                    excluded.append(best_m)
                    pv = s.pv_from(board, best_m, depth)
                    current.append((best_v, best_m, pv))
                    el = max(1, int((time.perf_counter() - start) * 1000))
                    self.send(f"info depth {depth} seldepth {max(depth, s.seldepth)} multipv {pv_i + 1} "
                              f"score {fmt_score(best_v)} nodes {s.nodes} nps {s.nodes * 1000 // el} time {el} "
                              f"pv {' '.join(x.uci() for x in pv)}")
                lines = current
                # search the previous best lines first next iteration
                order = [m for _, m, _ in current] + [m for m in order if m not in excluded]
                if len(roots) == 1 and not infinite and "depth" not in params:
                    break
                if abs(lines[0][0]) >= MATE - 1000 and depth >= 2 and not infinite:
                    break
                if s.deadline is not None and time.perf_counter() - start > (s.deadline - start) * 0.6:
                    break
        except Stop:
            pass
        if not lines:
            lines = [(0, roots[0], [roots[0]])]
        choice = lines[0]
        if skill < 20 and len(lines) > 1:
            # weaker levels sometimes prefer a nearby alternative (never a move >  margin worse)
            margin = (20 - skill) * 12
            pool = [l for l in lines if lines[0][0] - l[0] <= margin]
            weights = [max(1.0, margin - (lines[0][0] - l[0]) + 1) for l in pool]
            choice = s.rng.choices(pool, weights=weights, k=1)[0]
        if infinite:
            # UCI: in infinite mode never emit bestmove before "stop".
            while not s.stop_flag.is_set():
                time.sleep(0.005)
        ponder = f" ponder {choice[2][1].uci()}" if len(choice[2]) > 1 else ""
        self.send(f"bestmove {choice[1].uci()}{ponder}")


def main() -> None:
    Engine().loop()


if __name__ == "__main__":
    main()

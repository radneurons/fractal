// Client-side move tree (variations) built on chess.js — used by the analysis board and study editor.
import { Chess } from "chess.js";
import { useMemo, useReducer } from "react";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type TNode = { id: number; parent: TNode | null; uci: string | null; san: string | null; fen: string; children: TNode[]; comment: string;
  nags: number[]; arrows: { from: string; to: string; color: string }[] };

let nextId = 1;
const mk = (parent: TNode | null, fen: string, uci: string | null = null, san: string | null = null): TNode =>
  ({ id: nextId++, parent, uci, san, fen, children: [], comment: "", nags: [], arrows: [] });

export function tryMove(fen: string, uci: string): { san: string; fen: string; uci: string } | null {
  try {
    const c = new Chess(fen);
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return m ? { san: m.san, fen: c.fen(), uci: m.from + m.to + (m.promotion || "") } : null;
  } catch { return null; }
}
export function sanToUci(fen: string, san: string): string | null {
  try { const c = new Chess(fen); const m = c.move(san); return m ? m.from + m.to + (m.promotion || "") : null; } catch { return null; }
}

export class GameTree {
  root: TNode; current: TNode;
  constructor(fen: string = START_FEN) { this.root = mk(null, fen); this.current = this.root; }

  static fromMoves(startFen: string | null | undefined, ucis: string[]): GameTree {
    const t = new GameTree(startFen || START_FEN);
    for (const u of ucis) if (!t.play(u)) break;
    return t;
  }
  /** Build from the bridge's parsed PGN tree (keeps variations, comments, NAGs, arrows). */
  static fromServer(root: any): GameTree {
    const t = new GameTree(root.fen);
    const walk = (src: any, dst: TNode) => {
      dst.comment = (src.comment || "").replace(/\[%[^\]]*\]/g, "").trim();
      dst.nags = src.nags || []; dst.arrows = src.arrows || [];
      for (const ch of src.children || []) { const n = mk(dst, ch.fen, ch.uci, ch.san); dst.children.push(n); walk(ch, n); }
    };
    walk(root, t.root);
    t.current = t.root;
    return t;
  }

  play(uci: string): TNode | null {
    const existing = this.current.children.find((c) => c.uci === uci || (c.uci && c.uci.slice(0, 4) === uci && uci.length === 4 && c.uci.length === 4));
    if (existing) { this.current = existing; return existing; }
    const r = tryMove(this.current.fen, uci);
    if (!r) return null;
    const n = mk(this.current, r.fen, r.uci, r.san);
    this.current.children.push(n);
    this.current = n;
    return n;
  }
  playSan(san: string): TNode | null { const u = sanToUci(this.current.fen, san); return u ? this.play(u) : null; }
  back() { if (this.current.parent) this.current = this.current.parent; }
  forward() { if (this.current.children[0]) this.current = this.current.children[0]; }
  start() { this.current = this.root; }
  end() { while (this.current.children[0]) this.current = this.current.children[0]; }
  goto(n: TNode) { this.current = n; }
  remove(n: TNode) {
    if (!n.parent) return;
    n.parent.children = n.parent.children.filter((c) => c !== n);
    let c: TNode | null = this.current;
    while (c) { if (c === n) { this.current = n.parent; break; } c = c.parent; }
  }
  promote(n: TNode) { const p = n.parent; if (!p) return; const i = p.children.indexOf(n); if (i > 0) { p.children.splice(i, 1); p.children.splice(i - 1, 0, n); } }
  /** Nodes from the root to `n` (excluding the root). */
  path(n: TNode = this.current): TNode[] { const out: TNode[] = []; let c: TNode | null = n; while (c && c.parent) { out.unshift(c); c = c.parent; } return out; }
  /** Child-index path, as the study API expects. */
  indexPath(n: TNode = this.current): number[] { return this.path(n).map((x) => x.parent!.children.indexOf(x)); }
  moves(n: TNode = this.current): string[] { return this.path(n).map((x) => x.uci!); }
  sans(n: TNode = this.current): string[] { return this.path(n).map((x) => x.san!); }
  mainline(): TNode[] { const out: TNode[] = []; let c = this.root; while (c.children[0]) { c = c.children[0]; out.push(c); } return out; }
  ply(n: TNode = this.current): number { return this.path(n).length; }

  toPgn(headers: Record<string, string> = {}): string {
    const h = { Event: "Analysis", Site: "Opening Magician", Result: "*", ...headers };
    if (this.root.fen !== START_FEN) { (h as any).SetUp = "1"; (h as any).FEN = this.root.fen; }
    const head = Object.entries(h).map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`).join("\n");
    const startNo = parseInt(this.root.fen.split(" ")[5] || "1", 10);
    const startWhite = this.root.fen.split(" ")[1] !== "b";
    const out: string[] = [];
    const write = (node: TNode, ply: number, forceNum: boolean) => {
      // node = position before; write its children
      const [main, ...vars] = node.children;
      if (!main) return;
      const white = (ply % 2 === 0) === startWhite;
      const no = startNo + Math.floor((ply + (startWhite ? 0 : 1)) / 2);
      const tok = (n: TNode, force: boolean) => {
        let s = white ? `${no}. ` : force ? `${no}... ` : "";
        s += n.san + n.nags.map((g) => ` $${g}`).join("");
        const shapes = n.arrows.length ? `[%cal ${n.arrows.map((a) => `${(a.color[0] || "g").toUpperCase()}${a.from}${a.to}`).join(",")}] ` : "";
        if (n.comment || shapes) s += ` {${shapes}${n.comment}}`;
        return s;
      };
      out.push(tok(main, forceNum));
      for (const v of vars) { out.push("("); out.push(tok(v, true)); write(v, ply + 1, false); out.push(")"); }
      write(main, ply + 1, vars.length > 0 || !!main.comment);
    };
    write(this.root, 0, true);
    return `${head}\n\n${out.join(" ").replace(/\( /g, "(").replace(/ \)/g, ")")} ${h.Result}\n`;
  }
}

/** React binding: mutate the tree through `apply`, which triggers a re-render. */
export function useTree(initial?: () => GameTree) {
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  const holder = useMemo(() => ({ tree: initial ? initial() : new GameTree() }), []); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    tree: holder.tree, version,
    apply: (fn: (t: GameTree) => void) => { fn(holder.tree); bump(); },
    replace: (t: GameTree) => { holder.tree = t; bump(); },
  };
}

// ---- static board insight used by tactical overlays (client-side, instant) ----
export function boardInsight(fen: string) {
  const c = new Chess(fen);
  const turn = c.turn();
  const files = "abcdefgh";
  const all: string[] = [];
  for (const f of files) for (let r = 1; r <= 8; r++) all.push(f + r);
  const attackedBy = (sq: string, color: "w" | "b") => c.isAttacked(sq as any, color);
  const val: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  const hanging: string[] = [], attacked: string[] = [], defended: string[] = [];
  const them = turn === "w" ? "b" : "w";
  let kingSq = "";
  for (const sq of all) {
    const p = c.get(sq as any);
    if (!p) continue;
    if (p.type === "k" && p.color === turn) kingSq = sq;
    const enemy = p.color === "w" ? "b" : "w";
    const att = attackedBy(sq, enemy), def = attackedBy(sq, p.color);
    if (att && p.color === turn) attacked.push(sq);
    if (def && p.color === turn && p.type !== "k") defended.push(sq);
    if (att && !def && p.type !== "k") hanging.push(sq);
  }
  const kingZone: string[] = [];
  if (kingSq) {
    const kf = files.indexOf(kingSq[0]), kr = parseInt(kingSq[1], 10);
    for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
      const f = kf + df, r = kr + dr;
      if (f < 0 || f > 7 || r < 1 || r > 8 || (!df && !dr)) continue;
      const sq = files[f] + r;
      if (attackedBy(sq, them)) kingZone.push(sq);
    }
  }
  // outposts: squares in the enemy half protected by our pawn that no enemy pawn can ever attack
  const outposts: string[] = [];
  const pawnsOf = (col: "w" | "b") => all.filter((s) => { const p = c.get(s as any); return p && p.type === "p" && p.color === col; });
  const mine = pawnsOf(turn), theirs = pawnsOf(them);
  for (const sq of all) {
    const f = files.indexOf(sq[0]), r = parseInt(sq[1], 10);
    const inEnemyHalf = turn === "w" ? r >= 4 && r <= 6 : r <= 5 && r >= 3;
    if (!inEnemyHalf) continue;
    const guard = mine.some((p) => Math.abs(files.indexOf(p[0]) - f) === 1 && parseInt(p[1], 10) === (turn === "w" ? r - 1 : r + 1));
    if (!guard) continue;
    const canBeHit = theirs.some((p) => Math.abs(files.indexOf(p[0]) - f) === 1 && (turn === "w" ? parseInt(p[1], 10) > r : parseInt(p[1], 10) < r));
    if (!canBeHit) outposts.push(sq);
  }
  return { hanging, attacked, defended, kingZone, outposts, turn, inCheck: c.inCheck(), kingSq, legalCount: c.moves().length };
}

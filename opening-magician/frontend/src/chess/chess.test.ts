import { describe, expect, it } from "vitest";
import { parsePlacement } from "./Board2D";
import { boardInsight, GameTree, sanToUci, START_FEN, tryMove } from "./tree";
import { describeClock } from "./widgets";

describe("board placement", () => {
  it("parses a FEN into squares", () => {
    const p = parsePlacement(START_FEN);
    expect(Object.keys(p)).toHaveLength(32);
    expect(p.e1).toBe("K"); expect(p.d8).toBe("q"); expect(p.a2).toBe("P"); expect(p.e4).toBeUndefined();
    expect(parsePlacement("8/8/8/3k4/8/8/8/R3K3 w Q - 0 1")).toEqual({ d5: "k", a1: "R", e1: "K" });
  });
});

describe("move legality comes from the rules library", () => {
  it("accepts legal and rejects illegal moves", () => {
    expect(tryMove(START_FEN, "e2e4")?.san).toBe("e4");
    expect(tryMove(START_FEN, "e2e5")).toBeNull();
    expect(tryMove(START_FEN, "e1g1")).toBeNull();
    expect(sanToUci(START_FEN, "Nf3")).toBe("g1f3");
  });
  it("handles castling, en passant and promotion", () => {
    expect(tryMove("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1g1")?.san).toBe("O-O");
    expect(tryMove("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", "e5d6")?.fen.startsWith("4k3/8/3P4/8")).toBe(true);
    expect(tryMove("8/P7/8/8/8/8/k7/7K w - - 0 1", "a7a8n")?.san).toBe("a8=N");
  });
});

describe("game tree", () => {
  it("keeps variations and reuses existing moves", () => {
    const t = GameTree.fromMoves(null, ["e2e4", "e7e5", "g1f3"]);
    expect(t.sans()).toEqual(["e4", "e5", "Nf3"]);
    t.back(); t.play("f1c4");
    expect(t.current.parent!.children.map((c) => c.san)).toEqual(["Nf3", "Bc4"]);
    expect(t.indexPath()).toEqual([0, 0, 1]);
    t.back(); t.play("g1f3");
    expect(t.current.parent!.children).toHaveLength(2);          // not duplicated
    expect(t.play("a1a8")).toBeNull();
  });
  it("exports PGN with variations, comments and a start position", () => {
    const t = GameTree.fromMoves(null, ["e2e4", "e7e5"]);
    t.current.comment = "Open game";
    t.back(); t.play("c7c5");
    const pgn = t.toPgn({ White: "A" });
    expect(pgn).toContain('[White "A"]');
    expect(pgn).toContain("1. e4 e5 {Open game} (1... c5)");
    const custom = new GameTree("8/P7/8/8/8/8/k7/7K w - - 0 1");
    custom.play("a7a8q");
    expect(custom.toPgn()).toContain('[FEN "8/P7/8/8/8/8/k7/7K w - - 0 1"]');
    expect(custom.toPgn()).toContain("1. a8=Q+");
  });
  it("rebuilds from the bridge's tree format", () => {
    const t = GameTree.fromServer({ fen: START_FEN, comment: "", children: [{ fen: tryMove(START_FEN, "d2d4")!.fen, uci: "d2d4", san: "d4", comment: "Queen's pawn [%cal Gd2d4]",
      nags: [1], arrows: [{ from: "d2", to: "d4", color: "green" }], children: [] }] });
    expect(t.root.children[0].comment).toBe("Queen's pawn");
    expect(t.root.children[0].nags).toEqual([1]);
  });
});

describe("tactical overlays", () => {
  it("finds hanging pieces and check", () => {
    const i = boardInsight("4k3/8/8/8/4r2R/8/8/4K3 w - - 0 1");   // the rooks attack each other; neither is defended
    expect(i.inCheck).toBe(true); expect(i.hanging).toContain("e4");
  });
});

describe("clock description", () => {
  it("describes increments, stages and the hand-move allowance", () => {
    expect(describeClock({ kind: "unlimited" })).toBe("No clock");
    expect(describeClock({ kind: "standard", stages: [{ base_ms: 600000, increment_ms: 5000, delay_ms: 0, delay_type: "none" }] })).toBe("10 min +5s");
    const txt = describeClock({ kind: "standard", stages: [{ moves: 40, base_ms: 5400000, increment_ms: 30000, delay_ms: 0, delay_type: "none" }, { base_ms: 1800000, increment_ms: 30000, delay_ms: 0, delay_type: "none" }],
      physical: { enabled: true, per_move_allowance_ms: 8000, start_delay_ms: 0, pause_for_sync: true, setup_allowance_ms: 0 } });
    expect(txt).toContain("40 moves in 90 min +30s, then 30 min +30s");
    expect(txt).toContain("+8s per hand move"); expect(txt).toContain("pause while relaying");
  });
});

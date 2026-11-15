// React wrapper around the 3D stage.  Same contract as Board2D: positions in, legal moves out.
import { Chess } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { BoardProps, DRAW_COLORS, parsePlacement, Shapes } from "./Board2D";
import { Piece2D, PieceDefs, PieceType } from "./pieces2d";
import { CameraPreset, Stage } from "./three/stage";
import type { ThemeId } from "./three/themes3d";

export function webglAvailable(): boolean {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

export default function Board3D(props: BoardProps & { camera?: CameraPreset; themeOverride?: ThemeId; onReady?: (s: Stage) => void }) {
  const { fen, orientation = "white", movable = "none", onMove, lastMove, arrows = [], squares = {}, drawable, userShapes, onUserShapes, leds, editor } = props;
  const prefs = useStore((s) => s.prefs);
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [aaKey, setAaKey] = useState(0);
  const down = useRef<{ sq: string | null; x: number; y: number; dragging: boolean; button: number } | null>(null);
  const theme = props.themeOverride || prefs.theme;

  const placement = useMemo(() => parsePlacement(fen), [fen]);
  const game = useMemo(() => { try { return new Chess(fen); } catch { return null; } }, [fen]);
  const turn = game?.turn() === "b" ? "black" : "white";
  const canMove = !!onMove && !editor && (movable === "both" || movable === turn);
  const dests = useMemo(() => {
    const m = new Map<string, { to: string; promo: boolean; capture: boolean }[]>();
    if (!game || !canMove) return m;
    for (const mv of game.moves({ verbose: true })) {
      const l = m.get(mv.from) || [];
      if (!l.some((x) => x.to === mv.to)) l.push({ to: mv.to, promo: !!mv.promotion, capture: !!mv.captured });
      m.set(mv.from, l);
    }
    return m;
  }, [game, canMove]);
  const checkSq = useMemo(() => {
    if (!game?.inCheck()) return null;
    const k = game.turn() === "w" ? "K" : "k";
    return Object.keys(placement).find((s) => placement[s] === k) || null;
  }, [game, placement]);

  // create / destroy the stage
  useEffect(() => {
    if (!host.current) return;
    if (!webglAvailable()) { setFailed(true); return; }
    let s: Stage;
    try { s = new Stage(host.current, prefs.graphics); } catch { setFailed(true); return; }
    stage.current = s;
    s.setTheme(theme as ThemeId);
    s.setPieceSet(prefs.pieces3d);
    s.setGraphics(prefs.graphics);
    s.setOrientation(orientation, true);
    s.setPosition(placement, false);
    if (props.camera) s.setCamera(props.camera, props.camera !== "intro");
    props.onReady?.(s);
    return () => { s.dispose(); stage.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aaKey]);

  useEffect(() => { stage.current?.setTheme(theme as ThemeId); }, [theme]);
  useEffect(() => { stage.current?.setPieceSet(prefs.pieces3d); }, [prefs.pieces3d]);
  useEffect(() => { if (stage.current?.setGraphics(prefs.graphics)) setAaKey((k) => k + 1); }, [prefs.graphics]);
  useEffect(() => { stage.current?.setOrientation(orientation); }, [orientation]);
  useEffect(() => { if (props.camera) stage.current?.setCamera(props.camera); }, [props.camera]);
  useEffect(() => { stage.current?.setPosition(placement); setSel(null); }, [placement]);
  useEffect(() => {
    stage.current?.setOverlays({
      lastMove, selected: sel, check: checkSq, dests: sel && prefs.legalDots ? (dests.get(sel) || []).map((d) => ({ to: d.to, capture: d.capture || !!placement[d.to] })) : [],
      squares: { ...squares, ...(userShapes?.squares || {}) }, arrows: [...arrows, ...(userShapes?.arrows || [])], leds,
      thickness: prefs.annotation.thickness, opacity: prefs.annotation.opacity,
    });
  }, [lastMove, sel, checkSq, dests, squares, arrows, userShapes, leds, placement, prefs.annotation, prefs.legalDots, aaKey]);

  const mine = (sq: string) => { const p = placement[sq]; if (!p) return false; return movable === "both" || movable === (p === p.toUpperCase() ? "white" : "black"); };
  const attempt = (from: string, to: string): boolean => {
    const d = dests.get(from)?.find((x) => x.to === to);
    if (!d) return false;
    setSel(null);
    if (d.promo) setPromo({ from, to }); else onMove?.(from + to);
    return true;
  };

  const onDown = (e: React.PointerEvent) => {
    const s = stage.current; if (!s) return;
    if (promo) { setPromo(null); return; }
    const { sq } = s.pick(e.clientX, e.clientY);
    down.current = { sq, x: e.clientX, y: e.clientY, dragging: false, button: e.button };
    if (e.button === 2 || !sq) return;
    if (editor) return;
    if (canMove && mine(sq) && dests.has(sq)) { s.controls.enabled = false; }
  };
  const onMoveP = (e: React.PointerEvent) => {
    const s = stage.current, d = down.current; if (!s || !d || d.button !== 0 || !d.sq) return;
    if (!d.dragging && canMove && mine(d.sq) && dests.has(d.sq) && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 7) { d.dragging = true; setSel(d.sq); s.beginDrag(d.sq); }
    if (d.dragging) s.dragTo(e.clientX, e.clientY);
  };
  const onUp = (e: React.PointerEvent) => {
    const s = stage.current, d = down.current; down.current = null;
    if (!s || !d) return;
    s.controls.enabled = true;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y) > 7;
    if (d.button === 2) {
      if (!drawable || !onUserShapes || !d.sq) return;
      const to = s.squareUnder(e.clientX, e.clientY); if (!to) return;
      const color = e.shiftKey ? DRAW_COLORS.red : e.altKey ? DRAW_COLORS.blue : e.ctrlKey ? DRAW_COLORS.yellow : prefs.annotation.arrowColor;
      const cur: Shapes = userShapes || { arrows: [], squares: {} };
      if (to === d.sq) { const q = { ...cur.squares }; if (q[to] === color) delete q[to]; else q[to] = color; onUserShapes({ arrows: cur.arrows, squares: q }); }
      else { const i = cur.arrows.findIndex((a) => a.from === d.sq && a.to === to); onUserShapes({ arrows: i >= 0 ? cur.arrows.filter((_, k) => k !== i) : [...cur.arrows, { from: d.sq, to, color }], squares: cur.squares }); }
      return;
    }
    if (d.dragging) {
      const to = s.squareUnder(e.clientX, e.clientY);
      const ok = !!to && to !== d.sq && attempt(d.sq!, to);
      s.endDrag(!ok);
      if (!ok) setSel(to === d.sq ? d.sq : null);
      return;
    }
    if (moved) return;                                  // it was a camera orbit
    const sq = d.sq;
    if (!sq) { setSel(null); return; }
    if (editor) { editor.onSquare(sq); return; }
    if (sel && sel !== sq && attempt(sel, sq)) return;
    if (canMove && mine(sq) && dests.has(sq)) setSel(sel === sq ? null : sq);
    else { setSel(null); if (userShapes && (userShapes.arrows.length || Object.keys(userShapes.squares).length)) onUserShapes?.({ arrows: [], squares: {} }); }
  };
  const onDouble = (e: React.MouseEvent) => {
    if (!props.inspect) return;
    const s = stage.current; if (!s) return;
    const { sq } = s.pick(e.clientX, e.clientY);
    s.inspect(sq && placement[sq] ? sq : null);
  };

  if (failed) return <div className="board3d" style={{ display: "grid", placeItems: "center", padding: 20, textAlign: "center" }}>
    <div><b>3D is unavailable</b><p className="muted">This device or browser did not provide WebGL. Switch to the 2D board in Settings.</p></div></div>;

  return (
    <div className="board3d" ref={host} onPointerDown={onDown} onPointerMove={onMoveP} onPointerUp={onUp} onDoubleClick={onDouble}
      onContextMenu={(e) => e.preventDefault()} role="application" aria-label="3D chess board">
      {promo && (
        <div className="promo" style={{ left: "50%", top: "50%", transform: "translate(-50%,-50%)", flexDirection: "row", width: "44%" }}>
          {(["q", "n", "r", "b"] as PieceType[]).map((t) => (
            <button key={t} style={{ flex: 1 }} aria-label={`Promote to ${t}`} onPointerDown={(e) => { e.stopPropagation(); const mv = promo.from + promo.to + t; setPromo(null); onMove?.(mv); }}>
              <svg viewBox="0 0 100 100"><PieceDefs /><Piece2D type={t} color={fen.split(" ")[1] !== "b" ? "w" : "b"} set={prefs.pieces2d} /></svg>
            </button>))}
        </div>)}
    </div>
  );
}

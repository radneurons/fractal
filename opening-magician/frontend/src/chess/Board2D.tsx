// Interactive 2D board.  Legality always comes from chess.js (never from drag geometry).
import { Chess } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { Piece2D, PieceColor, PieceDefs, PieceType } from "./pieces2d";

export type Arrow = { from: string; to: string; color?: string; width?: number; opacity?: number; label?: string; dashed?: boolean };
export type Shapes = { arrows: Arrow[]; squares: Record<string, string> };
export type BoardProps = {
  fen: string;
  orientation?: "white" | "black";
  movable?: "white" | "black" | "both" | "none";
  onMove?: (uci: string) => void;
  lastMove?: string | null;
  arrows?: Arrow[];
  squares?: Record<string, string>;
  drawable?: boolean;
  userShapes?: Shapes;
  onUserShapes?: (s: Shapes) => void;
  premove?: boolean;
  leds?: Record<string, number | string>;
  editor?: { onSquare: (sq: string) => void };
  ghosts?: Record<string, string>;
  coords?: boolean;
  mode?: "2d" | "3d";
  inspect?: boolean;
};

const FILES = "abcdefgh";
export const DRAW_COLORS = { green: "#2fa37c", red: "#d2584f", blue: "#5aa7e0", yellow: "#e0a23a" };
const LED_COLORS: Record<string, string> = { "1": "#ff4b3e", "2": "#35e06f", "3": "#4aa3ff", red: "#ff4b3e", green: "#35e06f", blue: "#4aa3ff" };

export function parsePlacement(fen: string): Record<string, string> {
  const out: Record<string, string> = {};
  const rows = fen.split(" ")[0].split("/");
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r] || "") {
      if (ch >= "1" && ch <= "8") f += parseInt(ch, 10);
      else { out[FILES[f] + (8 - r)] = ch; f++; }
    }
  }
  return out;
}

/** Keep piece identities stable between positions so pieces slide instead of teleporting. */
function useStablePieces(placement: Record<string, string>) {
  const prev = useRef<{ id: number; sq: string; p: string }[]>([]);
  const counter = useRef(1);
  return useMemo(() => {
    const old = [...prev.current];
    const next: { id: number; sq: string; p: string }[] = [];
    const need = Object.entries(placement);
    const used = new Set<number>();
    const pending: [string, string][] = [];
    for (const [sq, p] of need) {                         // pieces that did not move
      const i = old.findIndex((o, k) => !used.has(k) && o.sq === sq && o.p === p);
      if (i >= 0) { used.add(i); next.push({ ...old[i] }); } else pending.push([sq, p]);
    }
    const dist = (a: string, b: string) => Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) + Math.abs(+a[1] - +b[1]);
    for (const [sq, p] of pending) {                      // moved pieces: nearest free one of the same kind (or a pawn that promoted)
      let best = -1, bd = 99;
      old.forEach((o, k) => {
        if (used.has(k)) return;
        const same = o.p === p || (o.p.toLowerCase() === "p" && (o.p === o.p.toUpperCase()) === (p === p.toUpperCase()) && (sq[1] === "8" || sq[1] === "1"));
        if (same && dist(o.sq, sq) < bd) { bd = dist(o.sq, sq); best = k; }
      });
      if (best >= 0) { used.add(best); next.push({ id: old[best].id, sq, p }); } else next.push({ id: counter.current++, sq, p });
    }
    prev.current = next;
    return next;
  }, [placement]);
}

export default function Board2D(props: BoardProps) {
  const { fen, orientation = "white", movable = "none", onMove, lastMove, arrows = [], squares = {}, drawable, userShapes, onUserShapes,
    premove, leds, editor, ghosts } = props;
  const prefs = useStore((s) => s.prefs);
  const coords = props.coords ?? prefs.coordinates;
  const ref = useRef<HTMLDivElement>(null);
  const placement = useMemo(() => parsePlacement(fen), [fen]);
  const pieces = useStablePieces(placement);
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ sq: string; x: number; y: number; moved: boolean } | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [pre, setPre] = useState<{ from: string; to: string } | null>(null);
  const [draw, setDraw] = useState<{ from: string; to: string; color: string } | null>(null);

  const game = useMemo(() => { try { return new Chess(fen); } catch { return null; } }, [fen]);
  const turn = game?.turn() === "b" ? "black" : "white";
  const canMoveNow = !!onMove && !editor && (movable === "both" || movable === turn);
  const dests = useMemo(() => {
    const m = new Map<string, { to: string; promo: boolean; capture: boolean }[]>();
    if (!game || !canMoveNow) return m;
    for (const mv of game.moves({ verbose: true })) {
      const list = m.get(mv.from) || [];
      if (!list.some((x) => x.to === mv.to)) list.push({ to: mv.to, promo: !!mv.promotion, capture: !!mv.captured });
      m.set(mv.from, list);
    }
    return m;
  }, [game, canMoveNow]);
  const checkSq = useMemo(() => {
    if (!game || !game.inCheck()) return null;
    const k = game.turn() === "w" ? "K" : "k";
    return Object.keys(placement).find((s) => placement[s] === k) || null;
  }, [game, placement]);

  // a stored premove fires as soon as it becomes legal on our turn
  useEffect(() => {
    if (pre && canMoveNow) {
      const ok = dests.get(pre.from)?.find((d) => d.to === pre.to);
      setPre(null);
      if (ok) (ok.promo ? setPromo(pre) : onMove?.(pre.from + pre.to));
    }
  }, [canMoveNow, fen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSel(null); setDrag(null); }, [fen]);

  const xy = (sq: string): [number, number] => {
    const f = FILES.indexOf(sq[0]), r = parseInt(sq[1], 10) - 1;
    return orientation === "white" ? [f * 100, (7 - r) * 100] : [(7 - f) * 100, r * 100];
  };
  const sqAt = (cx: number, cy: number): { sq: string | null; x: number; y: number } => {
    const b = ref.current!.getBoundingClientRect();
    const x = ((cx - b.left) / b.width) * 800, y = ((cy - b.top) / b.height) * 800;
    if (x < 0 || y < 0 || x >= 800 || y >= 800) return { sq: null, x, y };
    const fx = Math.floor(x / 100), fy = Math.floor(y / 100);
    const f = orientation === "white" ? fx : 7 - fx, r = orientation === "white" ? 7 - fy : fy;
    return { sq: FILES[f] + (r + 1), x, y };
  };
  const mine = (sq: string) => {
    const p = placement[sq];
    if (!p) return false;
    const col = p === p.toUpperCase() ? "white" : "black";
    return movable === "both" ? true : movable === col;
  };

  const attempt = (from: string, to: string) => {
    if (from === to) return;
    if (canMoveNow) {
      const d = dests.get(from)?.find((x) => x.to === to);
      if (!d) { setSel(mine(to) && placement[to] && dests.has(to) ? to : null); return; }
      setSel(null);
      if (d.promo) setPromo({ from, to }); else onMove?.(from + to);
    } else if (premove && onMove && mine(from)) { setPre({ from, to }); setSel(null); }
  };

  const onDown = (e: React.PointerEvent) => {
    const { sq, x, y } = sqAt(e.clientX, e.clientY);
    if (!sq) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 2) {
      if (drawable && onUserShapes) {
        const color = e.shiftKey ? DRAW_COLORS.red : e.altKey ? DRAW_COLORS.blue : e.ctrlKey ? DRAW_COLORS.yellow : (prefs.annotation.arrowColor || DRAW_COLORS.green);
        setDraw({ from: sq, to: sq, color });
      }
      return;
    }
    if (promo) { setPromo(null); return; }
    if (editor) { editor.onSquare(sq); return; }
    if (userShapes && (userShapes.arrows.length || Object.keys(userShapes.squares).length) && !placement[sq] && !sel) onUserShapes?.({ arrows: [], squares: {} });
    if (pre) setPre(null);
    if (sel && sel !== sq && (!placement[sq] || !mine(sq) || !(canMoveNow ? dests.has(sq) : true) || dests.get(sel)?.some((d) => d.to === sq))) {
      attempt(sel, sq);
      return;
    }
    if (placement[sq] && mine(sq) && (onMove || premove)) { setSel(sq); setDrag({ sq, x, y, moved: false }); } else setSel(null);
  };
  const onMoveP = (e: React.PointerEvent) => {
    if (draw) { const { sq } = sqAt(e.clientX, e.clientY); if (sq && sq !== draw.to) setDraw({ ...draw, to: sq }); return; }
    if (!drag) return;
    const { x, y } = sqAt(e.clientX, e.clientY);
    setDrag({ ...drag, x, y, moved: drag.moved || Math.hypot(x - drag.x, y - drag.y) > 12 });
  };
  const onUp = (e: React.PointerEvent) => {
    if (draw) {
      const cur: Shapes = userShapes || { arrows: [], squares: {} };
      if (draw.from === draw.to) {
        const sqs = { ...cur.squares };
        if (sqs[draw.from] === draw.color) delete sqs[draw.from]; else sqs[draw.from] = draw.color;
        onUserShapes?.({ arrows: cur.arrows, squares: sqs });
      } else {
        const exists = cur.arrows.findIndex((a) => a.from === draw.from && a.to === draw.to);
        const arr = exists >= 0 ? cur.arrows.filter((_, i) => i !== exists) : [...cur.arrows, { from: draw.from, to: draw.to, color: draw.color }];
        onUserShapes?.({ arrows: arr, squares: cur.squares });
      }
      setDraw(null);
      return;
    }
    if (!drag) return;
    const { sq } = sqAt(e.clientX, e.clientY);
    const d = drag;
    setDrag(null);
    if (d.moved && sq) attempt(d.sq, sq);
  };

  const selDests = sel ? dests.get(sel) || [] : [];
  const an = prefs.annotation;
  const allArrows: Arrow[] = [...arrows, ...(userShapes?.arrows || []), ...(draw && draw.from !== draw.to ? [draw as Arrow] : [])];
  const allSquares = { ...squares, ...(userShapes?.squares || {}), ...(draw && draw.from === draw.to ? { [draw.from]: draw.color } : {}) };
  const noAnim = prefs.graphics.animation === "off";

  return (
    <div className={`board2d ${noAnim ? "noanim" : ""}`} ref={ref} onPointerDown={onDown} onPointerMove={onMoveP} onPointerUp={onUp}
      onContextMenu={(e) => e.preventDefault()} role="application" aria-label="Chess board">
      <svg viewBox="0 0 800 800">
        <PieceDefs />
        <defs>
          {allArrows.map((a, i) => (
            <marker key={i} id={`ah-${i}`} viewBox="0 0 10 10" refX="6.5" refY="5" markerWidth="3.4" markerHeight="3.4" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill={a.color || an.arrowColor} />
            </marker>))}
        </defs>
        {Array.from({ length: 64 }, (_, i) => {
          const fx = i % 8, fy = Math.floor(i / 8);
          const light = (fx + fy) % 2 === 0;
          return <rect key={i} x={fx * 100} y={fy * 100} width="100" height="100" fill={light ? "var(--sq-light)" : "var(--sq-dark)"} />;
        })}
        {lastMove && [lastMove.slice(0, 2), lastMove.slice(2, 4)].map((s) => { const [x, y] = xy(s); return <rect key={"lm" + s} x={x} y={y} width="100" height="100" fill="#e9d34a" opacity="0.38" />; })}
        {pre && [pre.from, pre.to].map((s) => { const [x, y] = xy(s); return <rect key={"pm" + s} x={x} y={y} width="100" height="100" fill="#5aa7e0" opacity="0.45" />; })}
        {checkSq && (() => { const [x, y] = xy(checkSq); return <circle cx={x + 50} cy={y + 50} r="48" fill="url(#om-check)" />; })()}
        <defs><radialGradient id="om-check"><stop offset="0" stopColor="#ff3b2f" stopOpacity="0.95" /><stop offset="0.6" stopColor="#ff3b2f" stopOpacity="0.45" /><stop offset="1" stopColor="#ff3b2f" stopOpacity="0" /></radialGradient></defs>
        {Object.entries(allSquares).map(([s, c]) => { const [x, y] = xy(s); return <rect key={"hs" + s} x={x + 3} y={y + 3} width="94" height="94" rx="6" fill={c} opacity={an.highlight} stroke={c} strokeWidth="4" />; })}
        {sel && (() => { const [x, y] = xy(sel); return <rect x={x} y={y} width="100" height="100" fill="#2fa37c" opacity="0.42" />; })()}
        {coords && FILES.split("").map((f, i) => {
          const x = (orientation === "white" ? i : 7 - i) * 100;
          return <text key={f} x={x + 91} y={793} fontSize="15" textAnchor="end" fontWeight="600" fill={(i % 2 === 0) === (orientation === "white") ? "var(--sq-light)" : "var(--sq-dark)"} style={{ pointerEvents: "none" }}>{f}</text>;
        })}
        {coords && Array.from({ length: 8 }, (_, r) => {
          const y = (orientation === "white" ? 7 - r : r) * 100;
          return <text key={r} x={5} y={y + 17} fontSize="15" fontWeight="600" fill={(r % 2 === 0) === (orientation === "white") ? "var(--sq-light)" : "var(--sq-dark)"} style={{ pointerEvents: "none" }}>{r + 1}</text>;
        })}
        {pieces.map(({ id, sq, p }) => {
          const [x, y] = xy(sq);
          const dragging = drag && drag.sq === sq && drag.moved;
          const tx = dragging ? drag.x - 50 : x, ty = dragging ? drag.y - 50 : y;
          return (
            <g key={id} className={`piece ${dragging ? "drag" : ""}`} style={{ transform: `translate(${tx}px, ${ty}px)`, opacity: ghosts && ghosts[sq] ? 0.35 : 1 }}>
              <Piece2D type={p.toLowerCase() as PieceType} color={(p === p.toUpperCase() ? "w" : "b") as PieceColor} set={prefs.pieces2d} />
            </g>);
        })}
        {ghosts && Object.entries(ghosts).filter(([s]) => !placement[s]).map(([s, p]) => { const [x, y] = xy(s); return (
          <g key={"gh" + s} style={{ transform: `translate(${x}px, ${y - 14}px)`, opacity: 0.45 }}><Piece2D type={p.toLowerCase() as PieceType} color={(p === p.toUpperCase() ? "w" : "b") as PieceColor} set={prefs.pieces2d} /></g>); })}
        {prefs.legalDots && selDests.map((d) => { const [x, y] = xy(d.to); return d.capture || placement[d.to]
          ? <circle key={"d" + d.to} cx={x + 50} cy={y + 50} r="44" fill="none" stroke="#14110e" strokeOpacity="0.32" strokeWidth="9" style={{ pointerEvents: "none" }} />
          : <circle key={"d" + d.to} cx={x + 50} cy={y + 50} r="15" fill="#14110e" opacity="0.3" style={{ pointerEvents: "none" }} />; })}
        {allArrows.map((a, i) => {
          const [x1, y1] = xy(a.from), [x2, y2] = xy(a.to);
          const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
          const sx = x1 + 50 + (dx / len) * 22, sy = y1 + 50 + (dy / len) * 22, ex = x2 + 50 - (dx / len) * 30, ey = y2 + 50 - (dy / len) * 30;
          const w = 15 * (a.width ?? 1) * an.thickness;
          return (
            <g key={i} style={{ pointerEvents: "none" }} opacity={a.opacity ?? an.opacity}>
              <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={a.color || an.arrowColor} strokeWidth={w} strokeLinecap="round" markerEnd={`url(#ah-${i})`}
                strokeDasharray={a.dashed ? "18 14" : undefined}>
                {an.animate && prefs.graphics.animation === "full" && <animate attributeName="opacity" values="0.55;1;0.55" dur="2.6s" repeatCount="indefinite" />}
              </line>
              {a.label && an.labels && (<g transform={`translate(${(sx + ex) / 2}, ${(sy + ey) / 2})`}>
                <rect x="-26" y="-13" width="52" height="26" rx="7" fill="#14110e" opacity="0.86" /><text y="6" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff">{a.label}</text></g>)}
            </g>);
        })}
        {leds && Object.entries(leds).map(([s, v]) => { const [x, y] = xy(s); const c = LED_COLORS[String(v)] || "#fff3c4"; return (
          <g key={"led" + s} style={{ pointerEvents: "none" }}>
            <rect x={x + 2} y={y + 2} width="96" height="96" rx="5" fill="none" stroke={c} strokeWidth="6" opacity="0.95" />
            {[[8, 8], [92, 8], [8, 92], [92, 92]].map(([dx, dy], k) => <circle key={k} cx={x + dx} cy={y + dy} r="6" fill={c}><animate attributeName="opacity" values="1;0.45;1" dur="1.2s" repeatCount="indefinite" /></circle>)}
          </g>); })}
      </svg>
      {promo && (() => {
        const [x, y] = xy(promo.to);
        const white = fen.split(" ")[1] !== "b";
        const top = y < 400;
        return (
          <div className="promo" style={{ left: `${x / 8}%`, top: top ? `${y / 8}%` : undefined, bottom: top ? undefined : `${(700 - y) / 8}%`, width: "12.5%" }}>
            {(["q", "n", "r", "b"] as PieceType[]).map((t) => (
              <button key={t} aria-label={`Promote to ${t}`} onPointerDown={(e) => { e.stopPropagation(); const mv = promo.from + promo.to + t; setPromo(null); onMove?.(mv); }}>
                <svg viewBox="0 0 100 100"><PieceDefs /><Piece2D type={t} color={white ? "w" : "b"} set={prefs.pieces2d} /></svg>
              </button>))}
          </div>);
      })()}
    </div>
  );
}

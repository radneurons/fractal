// The board every view uses: picks 2D or 3D from preferences, adds flip / view / camera tools.
import { lazy, Suspense, useState } from "react";
import { useStore } from "../store";
import Board2D, { BoardProps } from "./Board2D";
import type { CameraPreset } from "./three/stage";

const Board3D = lazy(() => import("./Board3D"));

export type { Arrow, BoardProps, Shapes } from "./Board2D";

export default function Board(props: BoardProps & { tools?: boolean; onFlip?: () => void; maxWidth?: number | string }) {
  const prefs = useStore((s) => s.prefs); const setPrefs = useStore((s) => s.setPrefs);
  const mode = props.mode || prefs.boardMode;
  const [cam, setCam] = useState<CameraPreset>("player");
  const tools = props.tools ?? true;
  return (
    <div className="board-wrap" style={{ maxWidth: props.maxWidth }}>
      {mode === "3d"
        ? <Suspense fallback={<div className="board3d" style={{ display: "grid", placeItems: "center" }}><span className="muted">Loading 3D…</span></div>}>
            <Board3D {...props} camera={cam} inspect />
          </Suspense>
        : <Board2D {...props} />}
      {tools && (
        <div className="board-tools" onPointerDown={(e) => e.stopPropagation()}>
          {props.onFlip && <button className="btn xs" title="Flip board (F)" onClick={props.onFlip}>⇅</button>}
          {!props.mode && <button className="btn xs" title="Switch 2D / 3D" onClick={() => setPrefs({ boardMode: mode === "3d" ? "2d" : "3d" })}>{mode === "3d" ? "2D" : "3D"}</button>}
          {mode === "3d" && (["player", "top", "broadcast", "cinematic"] as CameraPreset[]).map((c) => (
            <button key={c} className={`btn xs ${cam === c ? "on" : ""}`} title={`${c} camera`} onClick={() => setCam(c)}>{c[0].toUpperCase()}</button>))}
        </div>)}
    </div>
  );
}

/** Small static board for lists, previews and live tournament tiles. */
export function MiniBoard({ fen, lastMove, size = 150, orientation = "white" }: { fen: string; lastMove?: string | null; size?: number; orientation?: "white" | "black" }) {
  return <div style={{ width: size }}><div className="board-wrap"><Board2D fen={fen} lastMove={lastMove} orientation={orientation} coords={false} /></div></div>;
}

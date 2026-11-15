import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "../api";
import { useStore, ViewId } from "../store";
import { START_FEN } from "../chess/tree";
import { webglAvailable } from "../chess/Board3D";
import Board2D from "../chess/Board2D";

const Board3D = lazy(() => import("../chess/Board3D"));

const JOURNEYS: [ViewId, string, string][] = [
  ["play", "Play Chess", "Face a native engine with your own clock — on screen or on your Chessnut board."],
  ["openings", "Train an Opening", "Open the tree, follow a guided lesson, then drill it until it sticks."],
  ["discovery", "Discover New Moves", "Let explorer engines try the 2nd–5th best ideas and a strong verifier judge them."],
  ["tournaments", "Engine Tournaments", "Round robin, Swiss, knockout, gauntlet and leagues with honest statistics."],
  ["chessnut", "Connect Chessnut", "Air, Air+, Go, Pro and the robotic Move — or the built-in simulator."],
];
// A short Ruy Lopez plays itself on the table while you choose.
const DEMO = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6", "e1g1", "f8e7", "f1e1", "b7b5", "a4b3", "d7d6", "c2c3", "e8g8"];

export default function Home() {
  const { go, prefs, setPrefs, meta, engines, hw, bridge } = useStore();
  const [fen, setFen] = useState(START_FEN);
  const [last, setLast] = useState<string | null>(null);
  const [due, setDue] = useState<number | null>(null);
  const intro = !prefs.introSeen && prefs.graphics.animation === "full";
  const can3d = webglAvailable() && prefs.graphics.quality !== "performance";

  useEffect(() => {
    let cancelled = false; let i = 0;
    let board = START_FEN;
    const step = async () => {
      if (cancelled) return;
      const { tryMove } = await import("../chess/tree");
      if (i >= DEMO.length) { i = 0; board = START_FEN; setFen(board); setLast(null); return; }
      const r = tryMove(board, DEMO[i]);
      if (r) { board = r.fen; setFen(board); setLast(DEMO[i]); }
      i++;
    };
    const first = setTimeout(() => { const id = setInterval(step, 2600); (step as any).id = id; }, intro ? 6200 : 1800);
    return () => { cancelled = true; clearTimeout(first); clearInterval((step as any).id); };
  }, [intro]);
  useEffect(() => { const t = setTimeout(() => { if (!prefs.introSeen) setPrefs({ introSeen: true }); }, 7000); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (bridge) api.get("/api/training/overview").then((r) => setDue(r.progress.due)).catch(() => undefined); }, [bridge]);

  return (
    <div className="home">
      <div className="scene">
        {can3d
          ? <Suspense fallback={null}><Board3D fen={fen} lastMove={last} camera={intro ? "intro" : "cinematic"} /></Suspense>
          : <div style={{ display: "grid", placeItems: "center", height: "100%", opacity: 0.5 }}><div style={{ width: "min(62vh, 80vw)" }}><div className="board-wrap"><Board2D fen={fen} lastMove={last} /></div></div></div>}
      </div>
      <div className="veil" />
      <div className="hero">
        <h1 className="fade-in">OPENING MAGICIAN</h1>
        <p className="fade-in d1">Every move is a possibility.</p>
        <div className="tl fade-in d2">{meta?.tagline || "Discover deeper. Train smarter. Play beyond theory."}</div>
      </div>
      <div className={`journeys fade-in ${intro ? "d3" : "d1"}`}>
        {JOURNEYS.map(([id, t, d]) => <button key={id} className="journey" onClick={() => go(id)}><b>{t}</b><span>{d}</span></button>)}
      </div>
      <div style={{ position: "absolute", left: 16, top: 14 }} className="row fade-in d2">
        <span className={`pill ${bridge ? "good" : "bad"}`}>{bridge ? "bridge ready" : "bridge offline — start it with: python -m om"}</span>
        {bridge && <span className="pill">{engines.length} engine(s)</span>}
        {hw?.connected && <span className={`pill ${hw.device.simulated ? "sim" : "good"}`}>{hw.device.name}</span>}
        {due != null && due > 0 && <button className="pill brass" style={{ cursor: "pointer" }} onClick={() => go("training")}>{due} card(s) due</button>}
        {meta?.recoverable_games?.length > 0 && <button className="pill warn" style={{ cursor: "pointer" }} onClick={() => go("play")}>unfinished game to resume</button>}
      </div>
    </div>
  );
}

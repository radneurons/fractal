// Spectator page (/watch/<token>): read-only, uses only the public broadcast endpoints. `?obs=1` gives a clean OBS layout.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Board2D from "../chess/Board2D";
import { fmtMs } from "../store";

const Board3D = lazy(() => import("../chess/Board3D"));
const THEME: Record<string, { app: string; bg: string; three?: boolean; scene?: string; light?: boolean }> = {
  minimal_grandmaster: { app: "library", bg: "#0e0c0a" }, tournament_broadcast: { app: "arena", bg: "linear-gradient(160deg,#0b1020,#05060a)" },
  cinematic_3d: { app: "library", bg: "#050403", three: true, scene: "library" }, dark_analytical: { app: "observatory", bg: "#060b12" },
  light_editorial: { app: "marble", bg: "#f3f0ea", light: true }, holographic_observatory: { app: "observatory", bg: "#02060b", three: true, scene: "observatory" },
};

export default function Watch() {
  const token = location.pathname.split("/")[2] || "";
  const params = new URLSearchParams(location.search);
  const obs = params.get("obs") === "1";
  const [st, setSt] = useState<any>(null);
  const [gone, setGone] = useState(false);
  const [, tick] = useState(0);
  const got = useRef(Date.now());
  useEffect(() => {
    let es: EventSource | null = null; let closed = false;
    const open = () => {
      es = new EventSource(`/api/public/broadcast/${token}/events`);
      es.onmessage = (e) => { try { setSt(JSON.parse(e.data)); got.current = Date.now(); } catch { /* ignore */ } };
      es.onerror = () => { es?.close(); if (!closed) fetch(`/api/public/broadcast/${token}`).then((r) => { if (r.status === 404) setGone(true); else setTimeout(open, 2500); }).catch(() => setTimeout(open, 4000)); };
    };
    open();
    const id = setInterval(() => tick((x) => x + 1), 250);
    return () => { closed = true; es?.close(); clearInterval(id); };
  }, [token]);
  const view = st?.view || {};
  const th = THEME[view.theme] || THEME.tournament_broadcast;
  const transparent = view.transparent || params.get("transparent") === "1";
  useEffect(() => { document.documentElement.dataset.theme = th.app; document.body.classList.toggle("transparent", !!transparent); document.body.style.overflow = "auto"; }, [th.app, transparent]);
  if (gone) return <div className="watch"><div className="empty">This broadcast does not exist.</div></div>;
  if (!st) return <div className="watch"><span className="muted">Connecting…</span></div>;
  const g = st.game;
  const ink = th.light ? "#1b1a17" : undefined;
  const clock = (side: "white" | "black") => {
    const c = g?.clock?.[side]; if (!c || c.ms == null) return null;
    const running = g.clock.running === side && !g.clock.frozen;
    const ms = running ? Math.max(0, c.ms - (Date.now() - got.current)) : c.ms;
    return <span className={`clock ${running ? "run" : ""}`} style={{ fontSize: 26, minWidth: 120, padding: "3px 10px" }}>{fmtMs(ms)}</span>;
  };
  const ev = g?.eval;
  const exp = ev?.expected_white ?? 0.5;
  const sans: string[] = g?.sans || [];
  const fen = g?.fen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const nameRow = (side: "white" | "black") => (
    <div className="row nowrap" style={{ padding: "6px 2px" }}><span style={{ width: 14, height: 14, borderRadius: 3, background: side === "white" ? "#f2ede2" : "#17140f", border: "1px solid #888" }} />
      <b style={{ fontSize: 19, fontFamily: "var(--serif)", color: ink }}>{g?.[side] || (side === "white" ? "White" : "Black")}</b><span className="grow" />{clock(side)}</div>);
  return (
    <div className={`watch ${transparent ? "transparent" : ""}`} style={{ background: transparent ? "transparent" : th.bg, color: ink, minHeight: "100%" }}>
      <div style={{ display: "grid", gridTemplateColumns: obs ? "minmax(0, 86vh) 330px" : "minmax(0, min(78vh, 720px)) minmax(260px, 340px)", gap: 22, alignItems: "start", width: "100%", justifyContent: "center" }}>
        <div>
          {nameRow(view.orientation === "black" ? "white" : "black")}
          <div className="row nowrap" style={{ alignItems: "stretch", gap: 8 }}>
            {ev && <div className="evalbar" style={{ width: 16 }}><i style={{ height: `${Math.max(3, Math.min(97, exp * 100))}%` }} /></div>}
            <div className="grow"><div className="board-wrap">
              {th.three ? <Suspense fallback={<Board2D fen={fen} />}><Board3D fen={fen} lastMove={g?.last_move} orientation={view.orientation} arrows={g?.arrows || []} themeOverride={th.scene as any} camera="broadcast" /></Suspense>
                : <Board2D fen={fen} lastMove={g?.last_move} orientation={view.orientation} arrows={g?.arrows || []} />}
            </div></div>
          </div>
          {nameRow(view.orientation === "black" ? "black" : "white")}
        </div>
        <div className="col" style={{ gap: 12 }}>
          <div><div style={{ fontFamily: "var(--serif)", fontSize: 24, color: th.light ? "#1b1a17" : "var(--brass-2)" }}>{st.title}</div>
            {!st.live && <span className="pill">broadcast paused</span>}{g?.result && <span className="pill good" style={{ marginLeft: 6 }}>{g.result}</span>}
            {g?.opening?.name && <div className="muted">{g.opening.eco ? g.opening.eco + " · " : ""}{g.opening.name}</div>}</div>
          {ev && <div className="panel tight"><div className="label">Evaluation</div><b className="mono" style={{ fontSize: 22 }}>{ev.text}</b>{ev.depth ? <span className="muted"> · depth {ev.depth}</span> : null}{g.engine && <div className="muted">{g.engine}</div>}
            {g.pv && <div className="mono" style={{ marginTop: 4 }}>{Array.isArray(g.pv) ? g.pv.join(" ") : g.pv}</div>}</div>}
          {g && <div className="panel tight"><div className="label">Moves</div><div className="moves" style={{ maxHeight: obs ? 300 : 240 }}>
            {sans.map((s, i) => <span key={i}>{i % 2 === 0 && <span className="num">{i / 2 + 1}.</span>}<span className={`mv ${i === sans.length - 1 ? "cur" : ""}`}>{s}</span> </span>)}{!sans.length && <span className="muted">Waiting for the first move…</span>}</div></div>}
          {g?.tournament && <div className="panel tight"><div className="label">{g.tournament.name}{g.tournament.round ? ` · round ${g.tournament.round}` : ""}</div>
            {g.tournament.standings && <table className="t"><tbody>{g.tournament.standings.slice(0, 8).map((r: any) => <tr key={r.player}><td>{r.rank}</td><td>{r.player}</td><td className="right"><b>{r.points}</b>/{r.games}</td></tr>)}</tbody></table>}</div>}
          {!g && <div className="empty">Nothing is on the board yet.</div>}
          {!obs && <div className="muted" style={{ fontSize: 11.5 }}>Opening Magician · read-only spectator view</div>}
        </div>
      </div>
    </div>
  );
}

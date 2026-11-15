import { lazy, Suspense, useEffect, useState } from "react";
import { api, live, useLive } from "./api";
import { act, useStore, ViewId } from "./store";
import { Icon, Toasts } from "./ui/ui";

const views: Record<ViewId, React.LazyExoticComponent<() => JSX.Element>> = {
  home: lazy(() => import("./views/Home")), play: lazy(() => import("./views/Play")), analysis: lazy(() => import("./views/Analysis")),
  openings: lazy(() => import("./views/Openings")), training: lazy(() => import("./views/Training")), puzzles: lazy(() => import("./views/Puzzles")),
  discovery: lazy(() => import("./views/Discovery")), prep: lazy(() => import("./views/Prep")), tournaments: lazy(() => import("./views/Tournaments")), books: lazy(() => import("./views/Books")),
  studies: lazy(() => import("./views/Studies")), engines: lazy(() => import("./views/Engines")), chessnut: lazy(() => import("./views/Chessnut")),
  broadcast: lazy(() => import("./views/Broadcast")), settings: lazy(() => import("./views/Settings")),
};
const Watch = lazy(() => import("./views/Watch"));

const NAV: { group: string; items: [ViewId, string, string][] }[] = [
  { group: "Play & learn", items: [
    ["home", "Home", "M3 11l9-8 9 8M5 10v10h14V10"], ["play", "Play", "M8 5v14l11-7z"],
    ["openings", "Openings", "M12 6c-3-2-6-2-8-1v13c2-1 5-1 8 1 3-2 6-2 8-1V5c-2-1-5-1-8 1zM12 6v13"],
    ["training", "Training", "M12 3l9 5-9 5-9-5zM6 11v5c3 3 9 3 12 0v-5"], ["puzzles", "Puzzles", "M10 3h4v3a2 2 0 104 0h3v6h-3a2 2 0 100 4h3v5H3v-5h3a2 2 0 100-4H3V6h7z"],
    ["studies", "Studies", "M5 4h11l3 3v13H5zM9 9h6M9 13h6M9 17h3"]] },
  { group: "Research", items: [
    ["analysis", "Analysis", "M4 19V5M4 19h16M8 15l3-4 3 2 4-6"], ["prep", "Preparation", "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7zM9 12l2 2 4-4"], ["discovery", "Discovery Lab", "M10 3v6L5 19a1 1 0 001 2h12a1 1 0 001-2l-5-10V3M9 3h6M8 14h8"],
    ["tournaments", "Tournaments", "M7 4h10v4a5 5 0 01-10 0zM7 6H4a3 3 0 003 4M17 6h3a3 3 0 01-3 4M12 13v4M8 20h8"],
    ["books", "Book Forge", "M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19V5M9 8h6"]] },
  { group: "System", items: [
    ["engines", "Engines", "M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M7 7h10v10H7z"],
    ["chessnut", "Chessnut", "M4 4h16v16H4zM4 12h16M12 4v16"], ["broadcast", "Broadcast", "M12 12m-2 0a2 2 0 104 0 2 2 0 10-4 0M7 7a7 7 0 000 10M17 7a7 7 0 010 10M4 4a11 11 0 000 16M20 4a11 11 0 010 16"],
    ["settings", "Settings", "M12 9a3 3 0 100 6 3 3 0 000-6zM19 12l2-1-2-4-2 1-2-1V5h-4v2l-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4-2-1z"]] },
];

export default function App() {
  const { view, go, prefs, loadMeta, loadEngines, bridge, engines, hw, setHw } = useStore();
  const [jobs, setJobs] = useState<any[]>([]);
  const [wsOk, setWsOk] = useState(false);
  const watch = location.pathname.startsWith("/watch/");

  useEffect(() => { document.documentElement.dataset.theme = prefs.theme; }, [prefs.theme]);
  useEffect(() => {
    if (watch) return;
    loadMeta(); loadEngines();
    live.onStatus = setWsOk;
    const poll = async () => {
      try { setHw(await api.get("/api/hw")); setJobs(await api.get("/api/jobs")); if (!useStore.getState().bridge) { loadMeta(); loadEngines(); } }
      catch { useStore.setState({ bridge: false }); }
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, [watch]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive(watch ? null : "hw", (m) => {
    if (m.type === "status") setHw({ ...(useStore.getState().hw || {}), ...m.data });
    else if (m.type === "robot") setHw({ ...(useStore.getState().hw || {}), robot: m.data });
    else if (m.type === "sim") setHw({ ...(useStore.getState().hw || {}), sim: m.data });
  });
  useLive(watch ? null : "jobs", () => { api.get("/api/jobs").then(setJobs).catch(() => undefined); });

  if (watch) return <Suspense fallback={null}><Watch /></Suspense>;

  const View = views[view];
  const robot = hw?.robot;
  const running = jobs.filter((j) => j.status === "running" || j.status === "scheduled");
  return (
    <div className={`app ${prefs.focus ? "focus" : ""}`}>
      <nav className="nav" aria-label="Main">
        <div className="brand" onClick={() => go("home")}>
          <div className="name">{prefs.focus ? "OM" : <>Opening <span>Magician</span></>}</div>
          <div className="tag">Discover deeper. Train smarter.</div>
        </div>
        <div className="nav-list">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items.map(([id, label, d]) => (
                <button key={id} className={`nav-item ${view === id ? "active" : ""}`} onClick={() => go(id)} title={label} aria-current={view === id}>
                  <Icon d={d} /><span>{label}</span>
                  {id === "discovery" && running.some((j) => j.kind === "experiment") && <i className="pill brass">live</i>}
                  {id === "tournaments" && running.some((j) => j.kind === "tournament") && <i className="pill brass">live</i>}
                  {id === "chessnut" && hw?.connected && <i className={`pill ${hw.device?.simulated ? "sim" : "good"}`}>{hw.device?.simulated ? "SIM" : "on"}</i>}
                </button>))}
            </div>))}
        </div>
      </nav>
      <main className="main">
        {!bridge && view !== "home" && view !== "settings" ? (
          <div className="view"><div className="empty" style={{ marginTop: 60 }}>
            <h2>The local bridge is not running</h2>
            <p style={{ marginTop: 8 }}>Native engines, research and Chessnut boards are driven by the bridge on this computer.</p>
            <p><code>cd opening-magician/backend &amp;&amp; python -m om</code></p>
          </div></div>
        ) : <Suspense fallback={<div className="view muted">Loading…</div>}><View /></Suspense>}
      </main>
      <footer className="statusbar">
        <span><i className={`dot ${bridge ? "ok" : "bad"}`} />{bridge ? "Bridge connected" : "Bridge offline"}{bridge && !wsOk ? " (live updates reconnecting)" : ""}</span>
        <span>{engines.filter((e) => e.status === "ok").length} engine(s)</span>
        <span><i className={`dot ${hw?.connected ? (hw.device?.simulated ? "warn" : "ok") : ""}`} />
          {hw?.connected ? `${hw.device.name}${hw.device.battery ? ` · ${hw.device.battery.percent}%` : ""}` : "No board"}</span>
        {running.length > 0 && <span className="brass">{running.length} research job(s) running</span>}
        {robot && <span>Robot: {robot.state.replace(/_/g, " ")}</span>}
        <span className="grow" />
        <button className={`stop-btn ${robot?.busy ? "live" : ""}`} disabled={!robot} title={robot ? "Send the stop command to the Chessnut Move immediately" : "No robotic board connected"}
          onClick={() => act(async () => setHw({ ...(useStore.getState().hw || {}), robot: await api.post("/api/hw/robot/stop") }), "STOP sent")}>STOP MOVEMENT</button>
      </footer>
      <Toasts />
    </div>
  );
}

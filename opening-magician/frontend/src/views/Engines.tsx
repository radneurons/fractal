// Engine Command Center: registry, option discovery, profiles and the resource manager / performance dashboard.
import { useEffect, useState } from "react";
import { api, useApi } from "../api";
import { act, ago, fmtNum, title, useStore } from "../store";
import { Check, Field, Meter, Modal, Num, Panel, Tabs } from "../ui/ui";

export default function Engines() {
  const { engines, profiles, loadEngines, toast } = useStore();
  const [tab, setTab] = useState<"engines" | "profiles" | "resources">("engines");
  const [path, setPath] = useState(""); const [name, setName] = useState(""); const [args, setArgs] = useState("");
  const [detected, setDetected] = useState<any[]>([]);
  const [open, setOpen] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const res = useApi<any>(tab === "resources" ? "/api/resources" : null, { interval: 1500 });
  useEffect(() => { api.get("/api/engines").then((r) => setDetected(r.detected)).catch(() => undefined); }, [engines.length]);
  const register = async (p: string, n?: string) => {
    setBusy(true);
    const r = await act(() => api.post("/api/engines", { path: p, name: n || undefined, args: args.trim() ? args.trim().split(/\s+/) : [] }));
    setBusy(false);
    if (r) { toast(`${r.name} registered — ${Object.keys(r.options).length} options discovered`, "ok"); setPath(""); setName(""); setArgs(""); loadEngines(); }
  };
  return (
    <div className="view">
      <div className="view-head"><div><h1>Engine Command Center</h1><div className="sub">Native UCI engines run as real processes on this computer. Nothing is downloaded for you — register the executables you have the right to use.</div></div></div>
      <Tabs value={tab} onChange={setTab} items={[["engines", `Engines (${engines.length})`], ["profiles", `Profiles (${profiles.length})`], ["resources", "Resources & performance"]]} />
      {tab === "engines" && (
        <div className="col gap-lg">
          <Panel title="Register an engine">
            <div className="grid" style={{ gridTemplateColumns: "2fr 1fr 1fr auto", alignItems: "end" }}>
              <Field label="Path to the UCI executable" help="For example /usr/local/bin/stockfish or C:\\Engines\\stockfish.exe"><input type="text" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/engine" /></Field>
              <Field label="Display name (optional)"><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Arguments (optional)"><input type="text" value={args} onChange={(e) => setArgs(e.target.value)} /></Field>
              <button className="btn primary" disabled={!path.trim() || busy} onClick={() => register(path.trim(), name.trim())}>{busy ? "Handshaking…" : "Register"}</button>
            </div>
            {detected.filter((d) => !d.registered).length > 0 && <div style={{ marginTop: 10 }}><div className="label">Found on this computer</div>
              {detected.filter((d) => !d.registered).map((d) => <div key={d.path} className="row"><b>{d.name}</b><span className="mono muted grow">{d.path}</span><button className="btn xs" onClick={() => register(d.path)}>Register</button></div>)}</div>}
            <p className="help" style={{ marginTop: 8 }}>Registration runs the real handshake (<span className="mono">uci → uciok → isready → readyok</span>) and reads the engine's own name and option table. Whether an engine works depends on its build, platform and licence. Other devices on the network may only register engines from the server's allowlisted folders.</p>
          </Panel>
          <Panel title="Registered engines">
            <table className="t"><thead><tr><th>Engine</th><th>Version</th><th>Platform</th><th>Options</th><th>Status</th><th>Verified</th><th /></tr></thead><tbody>{engines.map((e) => (
              <tr key={e.id}><td><b>{e.name}</b>{e.kind === "bundled" && <span className="pill" style={{ marginLeft: 6 }}>bundled</span>}<div className="mono muted" style={{ fontSize: 11.5 }}>{e.kind === "bundled" ? "weak built-in engine — install a strong one for serious analysis" : e.path}</div></td>
                <td>{e.version || "–"}</td><td className="muted">{e.platform} {e.arch}</td><td>{Object.keys(e.options || {}).length}</td>
                <td><span className={`pill ${e.status === "ok" ? "good" : "bad"}`} title={e.status}>{e.status === "ok" ? "ready" : "unavailable"}</span></td><td className="muted">{ago(e.verified_at)}</td>
                <td className="right nowrap"><button className="btn xs" onClick={() => setOpen(e)}>Options</button>{" "}
                  <button className="btn xs" onClick={() => act(async () => { await api.post(`/api/engines/${e.id}/verify`); loadEngines(); }, "Handshake OK")}>Verify</button>{" "}
                  {e.kind !== "bundled" && <button className="btn xs ghost" onClick={() => confirm(`Remove ${e.name}?`) && act(async () => { await api.del(`/api/engines/${e.id}`); loadEngines(); })}>Remove</button>}</td></tr>))}</tbody></table>
            {engines.some((e) => e.status !== "ok") && <div className="note warn" style={{ marginTop: 8 }}>Unavailable engines keep their profiles and research. Fix the path (or re-register on this computer after restoring a project) and press Verify.</div>}
          </Panel>
        </div>)}
      {tab === "profiles" && <Profiles />}
      {tab === "resources" && res.data && <Resources r={res.data} reload={res.reload} />}
      {open && <Options engine={open} onClose={() => { setOpen(null); loadEngines(); }} />}
    </div>
  );
}

function Options({ engine, onClose }: { engine: any; onClose: () => void }) {
  const [vals, setVals] = useState<Record<string, any>>(engine.defaults || {});
  const opts = Object.values(engine.options || {}) as any[];
  const set = (k: string, v: any) => setVals((x) => { const n = { ...x }; if (v === "" || v === undefined) delete n[k]; else n[k] = v; return n; });
  return (
    <Modal title={`${engine.name} — options`} onClose={onClose} wide>
      <p className="help">These are the options the engine itself reported. Values you set here become this engine's defaults; profiles and individual jobs can override them. Threads and Hash are additionally capped by the resource manager.</p>
      <div className="scroll" style={{ maxHeight: "56vh" }}><table className="t"><thead><tr><th>Option</th><th>Type</th><th>Engine default</th><th>Range</th><th>Your default</th></tr></thead><tbody>{opts.map((o) => (
        <tr key={o.name}><td><b>{o.name}</b></td><td className="muted">{o.type}</td><td className="mono">{String(o.default ?? "")}</td><td className="muted">{o.min != null ? `${o.min} … ${o.max}` : o.var?.length ? o.var.join(", ") : ""}</td>
          <td>{o.type === "check" ? <select value={vals[o.name] === undefined ? "" : String(vals[o.name])} onChange={(e) => set(o.name, e.target.value === "" ? undefined : e.target.value === "true")}><option value="">engine default</option><option value="true">on</option><option value="false">off</option></select>
            : o.type === "spin" ? <input type="number" min={o.min} max={o.max} value={vals[o.name] ?? ""} placeholder="default" onChange={(e) => set(o.name, e.target.value === "" ? "" : parseInt(e.target.value, 10))} />
            : o.type === "combo" ? <select value={vals[o.name] ?? ""} onChange={(e) => set(o.name, e.target.value)}><option value="">engine default</option>{o.var.map((v: string) => <option key={v}>{v}</option>)}</select>
            : o.type === "button" ? <span className="muted">action</span> : <input type="text" value={vals[o.name] ?? ""} placeholder={o.name.toLowerCase().includes("syzygy") ? "path to tablebases" : o.name.toLowerCase().includes("file") || o.name.toLowerCase().includes("nnue") ? "path to file" : "default"} onChange={(e) => set(o.name, e.target.value)} />}</td></tr>))}</tbody></table></div>
      <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}><button className="btn primary" onClick={() => act(async () => { await api.patch(`/api/engines/${engine.id}`, { defaults: vals }); onClose(); }, "Defaults saved")}>Save defaults</button></div>
    </Modal>
  );
}

function Profiles() {
  const { engines, profiles, loadEngines } = useStore();
  const [edit, setEdit] = useState<any | null>(null);
  const blank = () => ({ engine_id: engines[0]?.id, name: "", purpose: "", options: {}, limits: { min_time: 0.3, max_time: 3, min_depth: 8, max_depth: 24 } });
  return (
    <div className="col gap-lg">
      <Panel title="Saved profiles" hint="an engine + options + search limits, under a name" actions={<button className="btn sm primary" onClick={() => setEdit(blank())}>New profile</button>}>
        <table className="t"><thead><tr><th>Profile</th><th>Engine</th><th>Purpose</th><th>Options</th><th>Limits</th><th /></tr></thead><tbody>{profiles.map((p) => (
          <tr key={p.id}><td><b>{p.name}</b></td><td>{engines.find((e) => e.id === p.engine_id)?.name}</td><td className="muted">{p.purpose}</td><td className="mono">{Object.entries(p.options).map(([k, v]) => `${k}=${v}`).join(" ") || "–"}</td>
            <td className="mono muted">{p.limits.min_time ?? "?"}–{p.limits.max_time ?? "?"}s · d{p.limits.min_depth ?? "?"}–{p.limits.max_depth ?? "?"}{p.limits.multipv ? ` · ${p.limits.multipv} lines` : ""}</td>
            <td className="right nowrap"><button className="btn xs" onClick={() => setEdit(p)}>Edit</button>{" "}<button className="btn xs ghost" onClick={() => act(async () => { await api.del(`/api/profiles/${p.id}`); loadEngines(); })}>Delete</button></td></tr>))}</tbody></table>
      </Panel>
      {edit && (
        <Modal title={edit.id ? "Edit profile" : "New profile"} onClose={() => setEdit(null)}>
          <div className="col">
            <div className="grid g2"><Field label="Name"><input type="text" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Engine"><select value={edit.engine_id} onChange={(e) => setEdit({ ...edit, engine_id: e.target.value })}>{engines.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field></div>
            <Field label="Purpose"><input type="text" value={edit.purpose} onChange={(e) => setEdit({ ...edit, purpose: e.target.value })} placeholder="e.g. Strong independent verifier" /></Field>
            <Field label="Option overrides" help="One per line: Name=value  (for example Threads=4, Hash=512, Skill Level=6)"><textarea rows={4} value={Object.entries(edit.options).map(([k, v]) => `${k}=${v}`).join("\n")}
              onChange={(e) => setEdit({ ...edit, options: Object.fromEntries(e.target.value.split("\n").map((l) => l.split("=")).filter((x) => x.length === 2 && x[0].trim()).map(([k, v]) => [k.trim(), /^-?\d+$/.test(v.trim()) ? parseInt(v, 10) : v.trim() === "true" ? true : v.trim() === "false" ? false : v.trim()])) })} /></Field>
            <div className="grid g4">{(["min_time", "max_time", "min_depth", "max_depth"] as const).map((k) => <Field key={k} label={title(k)}><Num value={edit.limits[k] ?? 0} min={0} step={k.includes("time") ? 0.1 : 1} onChange={(v) => setEdit({ ...edit, limits: { ...edit.limits, [k]: v } })} /></Field>)}</div>
            <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn primary" disabled={!edit.name.trim()} onClick={() => act(async () => { await api.post(`/api/engines/${edit.engine_id}/profiles`, edit); setEdit(null); loadEngines(); }, "Profile saved")}>Save</button></div>
          </div>
        </Modal>)}
    </div>
  );
}

function Resources({ r, reload }: { r: any; reload: () => void }) {
  const L = r.limits;
  const put = (body: any) => act(async () => { await api.put("/api/resources", body); reload(); });
  return (
    <div className="grid g2">
      <Panel title="Budgets" hint="no engine may take every core">
        <div className="grid g2">
          <Field label="Maximum engines at once"><Num value={L.max_engines} min={1} onChange={(v) => put({ max_engines: v })} /></Field>
          <Field label={`Total thread budget (of ${r.system.cpu_count})`}><Num value={L.thread_budget} min={1} onChange={(v) => put({ thread_budget: v })} /></Field>
          <Field label="Threads per engine (cap)"><Num value={L.per_engine_threads} min={1} onChange={(v) => put({ per_engine_threads: v })} /></Field>
          <Field label="Total hash budget (MB)"><Num value={L.hash_budget_mb} min={16} step={64} onChange={(v) => put({ hash_budget_mb: v })} /></Field>
          <Field label="Hash per engine (cap, MB)"><Num value={L.per_engine_hash_mb} min={1} step={64} onChange={(v) => put({ per_engine_hash_mb: v })} /></Field>
          <Field label="Research jobs in parallel"><Num value={r.max_parallel_jobs} min={1} onChange={(v) => put({ max_parallel_jobs: v })} /></Field>
          <Field label="Daily research budget (minutes, 0 = unlimited)"><Num value={Math.round(L.daily_research_seconds / 60)} min={0} step={10} onChange={(v) => put({ daily_research_seconds: v * 60 })} /></Field>
          <Check checked={L.background_paused} onChange={(v) => put({ background_paused: v })} label="Pause background research" help="Interactive analysis, games and hardware keep working. Paused automatically while the robot moves." />
        </div>
        <p className="help" style={{ marginTop: 8 }}>Priority: hardware › interactive analysis and play › tournaments › research › background. Research engine time used today: {(r.research_seconds_today / 60).toFixed(1)} min.</p>
      </Panel>
      <Panel title="System">
        <div className="col">
          <div><div className="row nowrap"><span className="grow">CPU</span><b className="mono">{r.system.cpu_percent.toFixed(0)}%</b></div><Meter value={r.system.cpu_percent / 100} kind={r.system.cpu_percent > 90 ? "bad" : ""} /></div>
          <div><div className="row nowrap"><span className="grow">Memory</span><b className="mono">{r.system.mem_percent.toFixed(0)}% · {fmtNum(r.system.mem_available_mb)} MB free</b></div><Meter value={r.system.mem_percent / 100} kind={r.system.mem_percent > 90 ? "bad" : ""} /></div>
          <div><div className="row nowrap"><span className="grow">Engine threads leased</span><b className="mono">{r.threads_used} / {L.thread_budget}</b></div><Meter value={r.threads_used / L.thread_budget} kind="brass" /></div>
          <div><div className="row nowrap"><span className="grow">Hash leased</span><b className="mono">{r.hash_used_mb} / {L.hash_budget_mb} MB</b></div><Meter value={r.hash_used_mb / L.hash_budget_mb} kind="brass" /></div>
        </div>
        <div className="grid g3" style={{ marginTop: 12 }}>
          <div className="kpi"><b>{r.db.games}</b><span>Games stored</span></div><div className="kpi"><b>{r.db.positions_analysed}</b><span>Positions analysed</span></div><div className="kpi"><b>{r.db.size_mb} MB</b><span>Database</span></div></div>
        <p className="help">Analysis cache: {r.cache.stored} stored results, {r.cache.hits} reused, {r.cache.misses} computed. Results are shared across transpositions but never across different engine configurations.</p>
      </Panel>
      <Panel title={`Active engine processes (${r.active.length})`}>
        <table className="t"><thead><tr><th>Engine</th><th>Purpose</th><th>Threads</th><th>Hash</th><th>CPU</th><th>RAM</th><th>PID</th></tr></thead><tbody>{r.active.map((a: any) => (
          <tr key={a.id}><td>{a.label}</td><td><span className="pill">{a.purpose}</span></td><td>{a.threads}</td><td>{a.hash_mb} MB</td><td>{a.cpu_percent != null ? a.cpu_percent.toFixed(0) + "%" : "–"}</td><td>{a.rss_mb != null ? a.rss_mb + " MB" : "–"}</td><td className="mono muted">{a.pid}</td></tr>))}</tbody></table>
        {!r.active.length && <span className="muted">No engine is running.</span>}
        {r.waiting.length > 0 && <p className="help">Waiting for a slot: {r.waiting.map((w: any) => `${w.label} (${w.purpose})`).join(", ")}</p>}
        {r.crashes.length > 0 && <><div className="label" style={{ marginTop: 10 }}>Recent engine problems</div>{r.crashes.map((c: any, i: number) => <div key={i} className="note bad" style={{ marginTop: 4 }}><b>{c.engine}</b> — {c.detail} <span className="muted">({ago(c.ts)})</span></div>)}</>}
      </Panel>
      <Panel title="Research jobs" hint="survive a closed tab and a restart">
        <table className="t"><thead><tr><th>Job</th><th>Status</th><th>Progress</th><th>Updated</th><th /></tr></thead><tbody>{r.jobs.map((j: any) => (
          <tr key={j.id}><td>{title(j.kind)}</td><td><span className={`pill ${j.status === "completed" ? "good" : j.status === "failed" ? "bad" : j.status === "running" ? "brass" : ""}`} title={j.error || ""}>{title(j.status)}</span></td>
            <td style={{ width: 110 }}><Meter value={j.progress || 0} /></td><td className="muted">{ago(j.updated_at)}</td>
            <td className="right nowrap">{["running", "scheduled", "pending"].includes(j.status) && <><button className="btn xs" onClick={() => act(async () => { await api.post(`/api/jobs/${j.id}/pause`); reload(); })}>Pause</button>{" "}<button className="btn xs ghost" onClick={() => act(async () => { await api.post(`/api/jobs/${j.id}/cancel`); reload(); })}>Cancel</button></>}
              {["paused", "failed", "recovery_required"].includes(j.status) && <button className="btn xs" onClick={() => act(async () => { await api.post(`/api/jobs/${j.id}/resume`); reload(); })}>Resume</button>}</td></tr>))}</tbody></table>
      </Panel>
    </div>
  );
}

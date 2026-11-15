// Tournament Center: create, watch live, standings with uncertainty, statistics and reports.
import { useEffect, useState } from "react";
import { api, saveText, useApi, useLive } from "../api";
import { MiniBoard } from "../chess/Board";
import { act, ago, title, useStore } from "../store";
import { BudgetEditor, Check, EnginePicker, Field, Num, Panel, Select, Tabs } from "../ui/ui";

const FORMAT_HELP: Record<string, string> = {
  round_robin: "Every engine plays every other engine.", gauntlet: "One engine plays all the others.",
  knockout: "Seeded bracket with best-of matches and tie-breaks.", swiss: "Score-group pairings, no rematches, colour balancing, byes.",
  league: "Persistent divisions with promotion and relegation." };

export default function Tournaments() {
  const { engines, takeHandoff } = useStore();
  const list = useApi<any[]>("/api/tournaments", { interval: 5000 });
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [handoff, setHandoff] = useState<any>(null);
  useEffect(() => { const h = takeHandoff(); if (h) { setHandoff(h); setCreating(true); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!sel && !creating && list.data?.length) setSel(list.data[0].id); }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="view">
      <div className="view-head"><div><h1>Tournament Center</h1><div className="sub">Engine events with real pairings, durable results and statistics that admit their uncertainty.</div></div>
        <span className="spacer" /><button className="btn primary" onClick={() => { setCreating(true); setSel(null); }}>New tournament</button></div>
      <div className="side-list">
        <Panel title="Events" tight>
          {(list.data || []).map((t) => (
            <div key={t.id} className={`tree-node ${sel === t.id && !creating ? "sel" : ""}`} style={{ whiteSpace: "normal", padding: "6px 8px" }} onClick={() => { setSel(t.id); setCreating(false); }}>
              <div className="grow"><b>{t.name}</b><div className="muted" style={{ fontSize: 12 }}>{title(t.format)} · {t.players.length} engines · {t.games_done}/{t.games_total || "?"} games</div></div>
              <span className={`pill ${t.status === "completed" ? "good" : t.status === "running" ? "brass" : ""}`}>{t.status}</span></div>))}
          {!list.data?.length && <div className="muted" style={{ padding: 8 }}>No tournaments yet.</div>}
        </Panel>
        {creating ? <Create engines={engines} handoff={handoff} onCreated={(id) => { setCreating(false); setSel(id); list.reload(); }} />
          : sel ? <Dashboard key={sel} id={sel} onGone={() => { setSel(null); list.reload(); }} onDup={(id) => { setSel(id); list.reload(); }} />
          : <div className="empty">Create a tournament to compare engines or test an opening.</div>}
      </div>
    </div>
  );
}

function Create({ engines, handoff, onCreated }: { engines: any[]; handoff: any; onCreated: (id: string) => void }) {
  const books = useApi<any[]>("/api/books");
  const [cfg, setCfg] = useState<any>({ name: handoff?.title ? `${handoff.title} test` : "", format: "round_robin", players: [] as any[], cycles: 1, reverse_colors: true, concurrency: 1,
    time: { mode: "noflag", budget: { min_time: 0.05, max_time: 0.5, min_depth: 2, max_depth: 14 }, base_ms: 60000, inc_ms: 600 },
    openings: handoff?.moves?.length ? { mode: "suite", suite: [{ name: handoff.title || "Selected line", moves: handoff.moves }] } : handoff?.fen ? { mode: "fen", fen: handoff.fen } : { mode: "start" },
    adjudication: { enabled: true, max_plies: 300, resign_cp: 900, resign_moves: 4, draw_cp: 8, draw_moves: 12, draw_after_ply: 70 },
    gauntlet: { games_per_opponent: 2 }, knockout: { best_of: 2, tiebreak_pairs: 1 }, swiss: { rounds: 0 }, league: { division_size: 2, promote: 1, seasons: 2 } });
  const [add, setAdd] = useState<any>(null);
  const set = (p: any) => setCfg((c: any) => ({ ...c, ...p }));
  useEffect(() => { if (engines.length && !add) setAdd({ engine_id: engines[0].id, options: {}, profile_id: null }); }, [engines]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (p: any) => p.name || engines.find((e) => e.id === p.engine.engine_id)?.name || "?";
  const games = (() => { const n = cfg.players.length; if (cfg.format === "round_robin") return (n * (n - 1) / 2) * cfg.cycles * (cfg.reverse_colors ? 2 : 1); if (cfg.format === "gauntlet") return (n - 1) * cfg.gauntlet.games_per_opponent; return null; })();
  return (
    <div className="col gap-lg">
      <Panel title="Format">
        <div className="grid auto-fit">{Object.entries(FORMAT_HELP).map(([k, v]) => (
          <button key={k} className="card" style={cfg.format === k ? { borderColor: "var(--brass)", background: "color-mix(in srgb, var(--brass) 12%, var(--panel))" } : undefined} onClick={() => set({ format: k })}><b>{title(k)}</b><small>{v}</small></button>))}</div>
        <div className="grid g4" style={{ marginTop: 12 }}>
          <Field label="Name"><input type="text" value={cfg.name} placeholder="optional" onChange={(e) => set({ name: e.target.value })} /></Field>
          {cfg.format === "round_robin" && <Field label="Cycles"><Num value={cfg.cycles} min={1} max={20} onChange={(v) => set({ cycles: v })} /></Field>}
          {cfg.format === "gauntlet" && <Field label="Games per opponent"><Num value={cfg.gauntlet.games_per_opponent} min={1} onChange={(v) => set({ gauntlet: { ...cfg.gauntlet, games_per_opponent: v } })} /></Field>}
          {cfg.format === "gauntlet" && <Field label="Champion"><select value={cfg.gauntlet.champion || ""} onChange={(e) => set({ gauntlet: { ...cfg.gauntlet, champion: e.target.value } })}>{cfg.players.map((p: any, i: number) => <option key={i} value={name(p)}>{name(p)}</option>)}</select></Field>}
          {cfg.format === "knockout" && <><Field label="Games per match"><Num value={cfg.knockout.best_of} min={1} onChange={(v) => set({ knockout: { ...cfg.knockout, best_of: v } })} /></Field>
            <Field label="Tie-break pairs" help="Then the higher seed advances."><Num value={cfg.knockout.tiebreak_pairs} min={0} onChange={(v) => set({ knockout: { ...cfg.knockout, tiebreak_pairs: v } })} /></Field></>}
          {cfg.format === "swiss" && <Field label="Rounds" help="0 = recommended for the field size."><Num value={cfg.swiss.rounds} min={0} onChange={(v) => set({ swiss: { rounds: v } })} /></Field>}
          {cfg.format === "league" && <><Field label="Engines per division"><Num value={cfg.league.division_size} min={2} onChange={(v) => set({ league: { ...cfg.league, division_size: v } })} /></Field>
            <Field label="Promoted / relegated"><Num value={cfg.league.promote} min={0} onChange={(v) => set({ league: { ...cfg.league, promote: v } })} /></Field>
            <Field label="Seasons"><Num value={cfg.league.seasons} min={1} onChange={(v) => set({ league: { ...cfg.league, seasons: v } })} /></Field></>}
          <Field label="Games in parallel" help="Limited by the engine resource budget."><Num value={cfg.concurrency} min={1} max={16} onChange={(v) => set({ concurrency: v })} /></Field>
        </div>
        {cfg.format !== "knockout" && cfg.format !== "swiss" && <div style={{ marginTop: 8 }}><Check checked={cfg.reverse_colors} onChange={(v) => set({ reverse_colors: v })} label="Play every pairing with both colours" help="Colour-reversed games start from the same opening." /></div>}
      </Panel>
      <Panel title={`Engines (${cfg.players.length})`} hint={games != null ? `${games} games` : "seed order = list order"}>
        {cfg.players.map((p: any, i: number) => (
          <div key={i} className="row" style={{ padding: "3px 0" }}><span className="pill">{i + 1}</span>
            <input type="text" value={p.name || ""} placeholder={name(p)} style={{ maxWidth: 240 }} onChange={(e) => set({ players: cfg.players.map((x: any, k: number) => (k === i ? { ...x, name: e.target.value } : x)) })} />
            <span className="muted mono grow">{Object.entries(p.engine.options || {}).map(([k, v]) => `${k}=${v}`).join(" ")}</span>
            <button className="btn xs ghost" onClick={() => set({ players: cfg.players.filter((_: any, k: number) => k !== i) })}>✕</button></div>))}
        <div className="row nowrap" style={{ alignItems: "flex-end", marginTop: 8 }}><div className="grow"><EnginePicker value={add} onChange={setAdd} label="Add an engine (the same engine may enter with different settings)" /></div>
          <button className="btn" disabled={!add} onClick={() => set({ players: [...cfg.players, { name: "", engine: add }] })}>Add</button></div>
      </Panel>
      <Panel title="Time policy">
        <div className="grid g2">
          <label className="check"><input type="radio" checked={cfg.time.mode === "noflag"} onChange={() => set({ time: { ...cfg.time, mode: "noflag" } })} /><span><b>No-flag research</b>
            <small>No chess clock. Every move gets a bounded adaptive search budget, so nobody loses on time and nobody thinks forever.</small></span></label>
          <label className="check"><input type="radio" checked={cfg.time.mode === "clock"} onChange={() => set({ time: { ...cfg.time, mode: "clock" } })} /><span><b>Real chess clock</b>
            <small>Wall time is measured for every move; an engine that runs out of time loses on time.</small></span></label>
        </div>
        <div style={{ marginTop: 10 }}>{cfg.time.mode === "noflag" ? <BudgetEditor label="Per-move budget" value={cfg.time.budget} onChange={(budget) => set({ time: { ...cfg.time, budget } })} />
          : <div className="grid g3"><Field label="Base time (seconds)"><Num value={cfg.time.base_ms / 1000} min={0.5} step={5} onChange={(v) => set({ time: { ...cfg.time, base_ms: v * 1000 } })} /></Field>
              <Field label="Increment (seconds)"><Num value={cfg.time.inc_ms / 1000} min={0} step={0.1} onChange={(v) => set({ time: { ...cfg.time, inc_ms: v * 1000 } })} /></Field></div>}</div>
      </Panel>
      <Panel title="Openings and adjudication">
        <div className="grid g3">
          <Field label="Starting positions"><Select value={cfg.openings.mode} onChange={(mode) => set({ openings: { ...cfg.openings, mode } })}
            options={[["start", "Standard start position"], ["catalog", "Suite from the opening catalogue"], ["book", "Lines sampled from a book"], ["suite", "My own lines"], ["fen", "One position (FEN)"]]} /></Field>
          {cfg.openings.mode === "book" && <><Field label="Book"><select value={cfg.openings.book_id || ""} onChange={(e) => set({ openings: { ...cfg.openings, book_id: e.target.value } })}><option value="">choose…</option>{(books.data || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
            <Field label="Plies / lines"><div className="row nowrap"><Num value={cfg.openings.plies || 8} min={1} onChange={(v) => set({ openings: { ...cfg.openings, plies: v } })} /><Num value={cfg.openings.count || 12} min={1} onChange={(v) => set({ openings: { ...cfg.openings, count: v } })} /></div></Field></>}
          {cfg.openings.mode === "catalog" && <Field label="Number of openings"><Num value={cfg.openings.count || 24} min={1} max={140} onChange={(v) => set({ openings: { ...cfg.openings, count: v } })} /></Field>}
          {cfg.openings.mode === "fen" && <Field label="FEN" className="grow"><input type="text" value={cfg.openings.fen || ""} onChange={(e) => set({ openings: { ...cfg.openings, fen: e.target.value } })} /></Field>}
        </div>
        {cfg.openings.mode === "suite" && <Field label="One line per row: name | moves" help="Example: Italian | e4 e5 Nf3 Nc6 Bc4">
          <textarea rows={3} value={(cfg.openings.suite || []).map((s: any) => `${s.name} | ${s.moves.join(" ")}`).join("\n")}
            onChange={(e) => set({ openings: { ...cfg.openings, suite: e.target.value.split("\n").filter((l) => l.trim()).map((l) => { const [n, m] = l.includes("|") ? l.split("|") : ["", l]; return { name: n.trim(), moves: (m || "").trim().split(/\s+/).filter(Boolean) }; }) } })} /></Field>}
        <div className="grid g4" style={{ marginTop: 10 }}>
          <Check checked={cfg.adjudication.enabled} onChange={(v) => set({ adjudication: { ...cfg.adjudication, enabled: v } })} label="Adjudicate" help="Both engines must agree; the reason is recorded in the PGN." />
          <Field label="Max plies"><Num value={cfg.adjudication.max_plies} min={10} onChange={(v) => set({ adjudication: { ...cfg.adjudication, max_plies: v } })} /></Field>
          <Field label="Resign at (cp)"><Num value={cfg.adjudication.resign_cp} min={200} step={50} onChange={(v) => set({ adjudication: { ...cfg.adjudication, resign_cp: v } })} /></Field>
          <Field label="Draw within (cp)"><Num value={cfg.adjudication.draw_cp} min={0} onChange={(v) => set({ adjudication: { ...cfg.adjudication, draw_cp: v } })} /></Field>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <label className="btn sm">Import configuration…<input type="file" accept=".json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const j = JSON.parse(await f.text()); setCfg({ ...cfg, ...j, players: (j.players || []).map((p: any) => ({ name: p.name, engine: p.engine })) }); } catch { useStore.getState().toast("Not a valid configuration file", "err"); } }} /></label>
          <span className="grow" />
          <button className="btn" disabled={cfg.players.length < 2} onClick={async () => { const r = await act(() => api.post("/api/tournaments", cfg), "Tournament saved"); if (r) onCreated(r.id); }}>Save</button>
          <button className="btn primary big" disabled={cfg.players.length < 2} onClick={async () => { const r = await act(() => api.post("/api/tournaments", { ...cfg, start: true }), "Tournament started"); if (r) onCreated(r.id); }}>Create and start</button>
        </div>
      </Panel>
    </div>
  );
}

function Dashboard({ id, onGone, onDup }: { id: string; onGone: () => void; onDup: (id: string) => void }) {
  const { go, engines, toast } = useStore();
  const t = useApi<any>(`/api/tournaments/${id}`, { interval: 3000 });
  const [tab, setTab] = useState<"standings" | "games" | "stats" | "report">("standings");
  const [live, setLive] = useState<Record<string, any>>({});
  useLive(`tournament:${id}`, (m) => {
    if (m.type === "move") setLive((l) => ({ ...l, [m.data.key]: m.data }));
    else if (m.type === "game") { setLive((l) => { const n = { ...l }; delete n[m.data.key]; return n; }); t.reload(); }
    else t.reload();
  });
  const v = t.data;
  if (!v) return <div className="muted">{t.error || "Loading…"}</div>;
  const run = (action: string) => act(async () => { const r = await api.post(`/api/tournaments/${id}/${action}`); t.reload(); return r; });
  const sched: any[] = v.state.schedule || [];
  const done = sched.filter((g) => g.status === "done").length;
  const names: string[] = v.config.players.map((p: any) => p.name);
  const cell = (a: string, b: string) => sched.filter((g) => g.status === "done" && ((g.white === a && g.black === b) || (g.white === b && g.black === a)))
    .map((g) => (g.result === "1/2-1/2" ? "½" : (g.result === "1-0") === (g.white === a) ? "1" : "0")).join("");
  const liveGames = Object.values(live);
  return (
    <div className="col gap-lg">
      <Panel title={v.name} hint={`${title(v.format)} · ${v.config.time.mode === "clock" ? "real clock" : "no-flag research budgets"} · round ${v.state.round || 0}${v.state.total_rounds ? "/" + v.state.total_rounds : ""}`}
        actions={<div className="row">
          {v.status === "running" ? <button className="btn sm" onClick={() => run("pause")}>Pause</button> : v.status !== "completed" && v.status !== "canceled" && <button className="btn sm primary" onClick={() => run("start")}>{v.status === "pending" ? "Start" : "Resume"}</button>}
          {v.status === "running" && <button className="btn sm danger" onClick={() => run("cancel")}>Cancel</button>}
          <button className="btn sm" onClick={async () => { const r = await run("duplicate"); if (r) onDup(r.id); }}>Duplicate</button>
          <button className="btn sm" onClick={() => api.download(`/api/tournaments/${id}/pgn`, `${v.name}.pgn`)}>PGN</button>
          <button className="btn sm" onClick={async () => saveText(JSON.stringify(await api.get(`/api/tournaments/${id}/config`), null, 2), `${v.name}-config.json`)}>Export config</button>
          <button className="btn sm ghost" onClick={() => confirm("Delete this tournament and its games?") && act(async () => { await api.del(`/api/tournaments/${id}`); onGone(); })}>Delete</button></div>}>
        <div className="meter brass"><i style={{ width: `${sched.length ? (done / sched.length) * 100 : 0}%` }} /></div>
        <div className="row" style={{ marginTop: 6 }}><span className="muted">{done}/{sched.length} games · {v.overview.white_wins}–{v.overview.draws}–{v.overview.black_wins} (W–D–B)</span>
          {v.job?.error && <span className="pill bad">{v.job.error}</span>}{v.job?.status === "recovery_required" && <span className="pill warn">resuming after a restart</span>}</div>
        {(liveGames.length > 0 || v.live.length > 0) && <div className="row" style={{ marginTop: 12, alignItems: "flex-start" }}>
          {(liveGames.length ? liveGames : v.live).slice(0, 4).map((g: any) => (
            <div key={g.key} style={{ width: 172 }}><MiniBoard fen={g.fen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"} lastMove={g.uci || g.last?.uci} size={172} />
              <div style={{ fontSize: 12, marginTop: 4 }}><b>{g.white}</b> – <b>{g.black}</b><div className="mono muted">{g.san || g.last?.san || "…"} {g.text || g.last?.text || ""}</div></div></div>))}
          <button className="btn sm" onClick={() => go("broadcast", { tournamentId: id, title: v.name })}>Broadcast this event</button></div>}
      </Panel>
      <Tabs value={tab} onChange={setTab} items={[["standings", "Standings"], ["games", "Games"], ["stats", "Statistics"], ["report", "Report"]]} />
      {tab === "standings" && <>
        <Panel title="Standings" hint="tie-breaks: direct encounter, Sonneborn-Berger, Buchholz, wins">
          <div className="scroll"><table className="t"><thead><tr><th>#</th><th>Engine</th><th>Pts</th><th>G</th><th>+</th><th>=</th><th>−</th><th>SB</th><th>Buchholz</th><th>Performance (95% CI)</th>{names.map((n, i) => <th key={n} title={n}>{i + 1}</th>)}</tr></thead>
            <tbody>{v.standings.map((r: any) => (
              <tr key={r.player}><td>{r.rank}</td><td><b>{r.player}</b>{r.byes ? <span className="pill" style={{ marginLeft: 6 }}>{r.byes} bye</span> : null}</td><td><b>{r.points}</b></td><td>{r.games}</td><td>{r.wins}</td><td>{r.draws}</td><td>{r.losses}</td>
                <td>{r.sonneborn_berger}</td><td>{r.buchholz}</td><td className="mono">{r.performance_elo != null ? `${r.performance_elo > 0 ? "+" : ""}${r.performance_elo} [${r.elo_low ?? "−∞"}, ${r.elo_high ?? "+∞"}]` : "–"}</td>
                {names.map((n) => <td key={n} className="mono center">{n === r.player ? "×" : cell(r.player, n)}</td>)}</tr>))}</tbody></table></div>
          {v.overview.limitations.map((l: string) => <div key={l} className="help">• {l}</div>)}
        </Panel>
        {v.state.knockout?.rounds?.length > 0 && <Panel title="Bracket" hint={v.state.knockout.champion ? `Champion: ${v.state.knockout.champion}` : ""}>
          <div className="row" style={{ alignItems: "flex-start" }}>{v.state.knockout.rounds.map((r: any) => (
            <div key={r.name} className="col" style={{ minWidth: 200 }}><div className="label">{r.name}</div>{r.matches.map((m: any) => (
              <div key={m.id} className="panel tight"><div className={m.winner === m.a ? "brass" : ""}>{m.a || "bye"} <b className="mono">{m.score?.[m.a] ?? ""}</b></div>
                <div className={m.winner === m.b ? "brass" : ""}>{m.b || "bye"} <b className="mono">{m.score?.[m.b] ?? ""}</b></div>{m.decided_by && <div className="help">{m.decided_by}</div>}</div>))}</div>))}</div></Panel>}
        {v.state.league && <Panel title={`League · season ${v.state.league.season}`}>
          <div className="row" style={{ alignItems: "flex-start" }}>{v.state.league.divisions.map((d: string[], i: number) => <div key={i} className="panel tight" style={{ minWidth: 180 }}><div className="label">Division {i + 1}</div>{d.map((p) => <div key={p}>{p}</div>)}</div>)}</div>
          {v.state.league.history.map((h: any) => h.changes.map((c: any, k: number) => <div key={h.season + "-" + k} className="help">Season {h.season}: promoted {c.promoted.join(", ")} · relegated {c.relegated.join(", ")}</div>))}</Panel>}
      </>}
      {tab === "games" && <Panel title="Schedule and results">
        <div className="scroll" style={{ maxHeight: "56vh" }}><table className="t"><thead><tr><th>Rd</th><th>White</th><th>Black</th><th>Result</th><th>End</th><th>Opening</th><th>Plies</th><th /></tr></thead>
          <tbody>{sched.map((g) => <tr key={g.id}><td>{g.round}</td><td>{g.white}</td><td>{g.black}</td><td className="mono">{g.result || (g.status === "running" ? "playing…" : g.status === "error" ? "failed" : "–")}</td>
            <td className="muted" title={g.detail}>{title(g.termination || "")}</td><td className="muted">{g.opening?.name || "start"}</td><td>{g.plies ?? ""}</td>
            <td className="right">{g.game_id && <button className="btn xs" onClick={async () => { const full = await act(() => api.get(`/api/games/${g.game_id}`)); if (full) go("analysis", { pgn: full.pgn }); }}>Open</button>}</td></tr>)}</tbody></table></div></Panel>}
      {tab === "stats" && <div className="grid g2">
        <Panel title="Overview"><div className="grid g3">
          <div className="kpi"><b>{v.overview.draw_rate != null ? (v.overview.draw_rate * 100).toFixed(0) + "%" : "–"}</b><span>Draw rate</span></div>
          <div className="kpi"><b>{v.overview.avg_moves ?? "–"}</b><span>Average moves</span></div>
          <div className="kpi"><b>{v.overview.white_score != null ? (v.overview.white_score * 100).toFixed(0) + "%" : "–"}</b><span>White score</span></div></div>
          <p className="help" style={{ marginTop: 8 }}>White's advantage: {v.overview.white_advantage_elo ?? "–"} Elo, 95% interval [{v.overview.white_advantage_ci?.[0] ?? "–"}, {v.overview.white_advantage_ci?.[1] ?? "–"}]. Shortest game {v.overview.shortest_plies ?? "–"} plies, longest {v.overview.longest_plies ?? "–"}.</p>
          <div className="label">How games ended</div>{Object.entries(v.overview.terminations).map(([k, n]) => <div key={k} className="row"><span className="grow">{title(k)}</span><b>{String(n)}</b></div>)}</Panel>
        <Panel title="Head to head" hint="score of the first-named engine">
          <table className="t"><thead><tr><th>Pairing</th><th>+ = −</th><th>Elo diff (95% CI)</th><th>LOS</th></tr></thead><tbody>{v.head_to_head.map((h: any) => (
            <tr key={h.a + h.b} title={h.warning || ""}><td>{h.a} – {h.b}</td><td className="mono">{h.wins} {h.draws} {h.losses}</td><td className="mono">{h.elo ?? "–"} [{h.elo_low ?? "−∞"}, {h.elo_high ?? "+∞"}]</td>
              <td>{(h.los * 100).toFixed(0)}%{h.warning && <span className="pill warn" style={{ marginLeft: 6 }}>{h.games < 30 ? "small sample" : "inconclusive"}</span>}</td></tr>))}</tbody></table></Panel>
        <Panel title="Openings" className="g2span"><table className="t"><thead><tr><th>Opening</th><th>Games</th><th>1-0</th><th>½</th><th>0-1</th><th>White score (95% CI)</th></tr></thead><tbody>{v.overview.openings.map((o: any) => (
          <tr key={o.opening}><td>{o.opening}</td><td>{o.games}</td><td>{o.white_wins}</td><td>{o.draws}</td><td>{o.black_wins}</td><td className="mono">{(o.white_score * 100).toFixed(0)}% [{(o.white_score_ci[0] * 100).toFixed(0)}–{(o.white_score_ci[1] * 100).toFixed(0)}]{o.note && <span className="muted"> · {o.note}</span>}</td></tr>))}</tbody></table></Panel>
        <Panel title="Colour performance"><table className="t"><thead><tr><th>Engine</th><th>As White</th><th>As Black</th></tr></thead><tbody>{v.standings.map((r: any) => (
          <tr key={r.player}><td>{r.player}</td><td>{r.white_points}/{r.white_games}</td><td>{r.black_points}/{r.black_games}</td></tr>))}</tbody></table></Panel>
      </div>}
      {tab === "report" && (v.report ? <div className="col gap-lg">
        <Panel title={`Winner: ${v.report.winner || "–"}`} actions={<div className="row">
          <button className="btn sm" onClick={async () => { const s = await run("to_study"); if (s) { toast("Study created", "ok"); go("studies"); } }}>Save as a study</button>
          <button className="btn sm" onClick={() => act(() => api.post("/api/puzzles/mine", { tournament_id: id, engine: { engine_id: engines[0]?.id }, budget: { min_time: 0.2, max_time: 1.5, min_depth: 6, max_depth: 16 } }), "Puzzle mining queued")}>Mine puzzles</button></div>}>
          {v.report.method_notes.map((n: string) => <div key={n} className="help">• {n}</div>)}
          {v.report.engine_problems.length > 0 && <div className="note bad" style={{ marginTop: 8 }}>{v.report.engine_problems.length} game(s) ended through an engine failure: {v.report.engine_problems.map((p: any) => p.detail).filter(Boolean).slice(0, 2).join("; ")}</div>}</Panel>
        <Panel title="Decisive positions" hint="largest evaluation swings">{v.report.decisive_positions.map((d: any, i: number) => (
          <div key={i} className="row" style={{ padding: "3px 0" }}><span className="mono">{d.white} – {d.black}</span><span className="muted">ply {d.ply}: {d.san}</span><span className="mono">{d.before} → {d.after}</span><span className="grow" />
            {d.fen_before && <button className="btn xs" onClick={() => go("analysis", { fen: d.fen_before })}>Analyse</button>}</div>))}
          {!v.report.decisive_positions.length && <span className="muted">No large swings were recorded.</span>}</Panel>
      </div> : <div className="empty">The report is generated when the tournament finishes{v.status === "running" ? ` — ${sched.length - done} game(s) to go.` : "."}<br /><span className="muted">Created {ago(v.created_at)}</span></div>)}
    </div>
  );
}

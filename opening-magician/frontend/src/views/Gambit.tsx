// Gambit Lab: find sacrifices, see what they cost and what they demand of the defender,
// then test them against a ladder of engine strengths to learn who actually falls for them.
import { useEffect, useRef, useState } from "react";
import { api, useApi } from "../api";
import { MiniBoard } from "../chess/Board";
import { GameTree } from "../chess/tree";
import { EvalGraph } from "../chess/widgets";
import { act, useStore } from "../store";
import { BudgetEditor, EnginePicker, Field, Meter, Num, Panel, Select, Tabs } from "../ui/ui";

const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const BAND: Record<string, string> = { sound: "good", practical: "brass", speculative: "warn", unsound: "bad" };
const levelLabel = (l: any) => l.mode === "elo" ? `Elo ${l.elo}` : l.mode === "skill" ? `Skill ${l.skill}` : l.mode === "depth" ? `Depth ${l.depth}` : l.mode === "time" ? `${l.movetime_ms} ms` : "Full strength";
const sameLevel = (a: any, b: any) => levelLabel(a) === levelLabel(b);

function useJob() {
  const [state, setState] = useState<{ busy: boolean; progress: number; result: any }>({ busy: false, progress: 0, result: null });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = async (body: any): Promise<any> => {
    setState({ busy: true, progress: 0, result: null });
    try {
      const { job_id } = await api.post("/api/gambits/job", body);
      for (;;) {
        await new Promise((r) => setTimeout(r, 700));
        if (!alive.current) return null;
        const j = await api.get(`/api/jobs/${job_id}`);
        if (j.status === "completed") { setState({ busy: false, progress: 1, result: j.result }); return j.result; }
        if (["failed", "canceled", "cancelled"].includes(j.status)) throw new Error(j.error || `Job ${j.status}`);
        setState((s) => ({ ...s, progress: j.progress || 0 }));
      }
    } catch (e) { setState({ busy: false, progress: 0, result: null }); useStore.getState().toast((e as Error).message, "err"); return null; }
  };
  return { ...state, run };
}
const JobBar = ({ job, label = "Engine working…" }: { job: { busy: boolean; progress: number }; label?: string }) =>
  job.busy ? <div className="row nowrap" style={{ marginTop: 8 }}><span className="muted nowrap">{label}</span><div className="grow"><Meter value={job.progress} kind="brass" /></div><span className="muted">{pct(job.progress)}</span></div> : null;

export default function Gambit() {
  const { engines, takeHandoff } = useStore();
  const list = useApi<any[]>("/api/gambits");
  const [sel, setSel] = useState("");
  const [engine, setEngine] = useState<any>(null);
  const [budget, setBudget] = useState({ min_time: 0.3, max_time: 2.5, min_depth: 8, max_depth: 22 });
  const [source, setSource] = useState<"known" | "line" | "search">("known");
  const [line, setLine] = useState("1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.b4");
  useEffect(() => { if (engines.length && !engine) setEngine({ engine_id: (engines.find((e) => e.kind === "native") || engines[0]).id, options: {}, profile_id: null }); }, [engines]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const h = takeHandoff(); if (h?.moves?.length) { setLine(GameTree.fromMoves(h.startFen, h.moves).sans().join(" ")); setSource("line"); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!sel && list.data?.length) setSel(list.data[0].id); }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (id?: string) => { list.reload(); if (id) setSel(id); };
  return (
    <div className="view">
      <div className="view-head"><div><h1>Gambit Lab</h1><div className="sub">Give something up on purpose. See what it costs against perfect defence, how hard that defence is to find — and which strength of opponent actually falls for it.</div></div>
        <span className="spacer" />
        <div style={{ width: 400 }}><EnginePicker value={engine} onChange={setEngine} label="Analysis engine (plays the gambit)" /></div>
        <div style={{ width: 330 }}><BudgetEditor label="Budget per position" value={budget} onChange={setBudget} /></div>
      </div>
      <div className="side-list wide">
        <div className="col">
          <Panel tight>
            <Tabs value={source} onChange={setSource} items={[["known", "Known gambits"], ["line", "My line"], ["search", "Find new"]]} />
            {source === "known" && <Known engine={engine} budget={budget} onDone={done} />}
            {source === "line" && <OwnLine line={line} setLine={setLine} engine={engine} budget={budget} onDone={done} />}
            {source === "search" && <Search line={line} setLine={setLine} engine={engine} budget={budget} onDone={done} />}
          </Panel>
          <Panel title="Assessed gambits" hint={list.data?.length ? "best practical value first" : undefined} tight>
            {[...(list.data || [])].sort((a, b) => (b.value || 0) - (a.value || 0)).map((g) => (
              <div key={g.id} className={`tree-node ${sel === g.id ? "sel" : ""}`} style={{ whiteSpace: "normal", padding: "7px 8px", alignItems: "flex-start" }} onClick={() => setSel(g.id)}>
                <div className="grow"><b>{g.name}</b>
                  <div className="row" style={{ gap: 4, marginTop: 3 }}><span className={`pill ${BAND[g.band] || ""}`}>{g.band || "–"}</span><span className="pill">−{g.pawns}</span>
                    <span className="muted" style={{ fontSize: 12 }}>risk {pct(g.risk)} · sting {pct(g.sting)}</span></div>
                  {g.ladder && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{g.ladder}</div>}</div>
                <button className="btn xs ghost" title="Delete" onClick={(e) => { e.stopPropagation(); act(async () => { await api.del(`/api/gambits/${g.id}`); if (sel === g.id) setSel(""); list.reload(); }); }}>✕</button></div>))}
            {!list.data?.length && <div className="muted" style={{ padding: 6 }}>Nothing yet. Assess a known gambit, your own line, or let the engine look for sacrifices.</div>}
          </Panel>
        </div>
        {sel ? <Detail key={sel} id={sel} engine={engine} budget={budget} onChanged={() => list.reload()} />
          : <div className="empty">A gambit is judged three ways here, and the three are never blended: <b>risk</b> (the price against best play), <b>sting</b> (how hard the defence is) and the <b>ladder</b> (who really goes wrong).</div>}
      </div>
    </div>
  );
}
type Src = { engine: any; budget: any; onDone: (id?: string) => void };

function Known({ engine, budget, onDone }: Src) {
  const cat = useApi<any[]>("/api/gambits/catalogue");
  const job = useJob(); const [busyId, setBusyId] = useState("");
  return (
    <div style={{ marginTop: 8 }}>
      <div className="scroll" style={{ maxHeight: 290 }}>
        {(cat.data || []).map((g) => (
          <div key={g.opening_id} className="row nowrap" style={{ padding: "4px 2px", fontSize: 13 }} title={g.idea}>
            <div className="grow"><b>{g.name}</b><div className="mono muted" style={{ fontSize: 12 }}>{g.line_text} · {g.color}</div></div>
            <button className="btn xs" disabled={!engine || job.busy} onClick={async () => { setBusyId(g.opening_id); const r = await job.run({ task: "assess", opening_id: g.opening_id, engine, budget }); if (r) onDone(r.id); }}>{job.busy && busyId === g.opening_id ? "…" : "Assess"}</button></div>))}
      </div>
      <JobBar job={job} />
      <div className="help" style={{ marginTop: 6 }}>From the built-in opening catalogue. The move that makes the offer is located by a material rule, not by name.</div>
    </div>
  );
}

function OwnLine({ line, setLine, engine, budget, onDone }: Src & { line: string; setLine: (s: string) => void }) {
  const books = useApi<any[]>("/api/books"); const [human, setHuman] = useState("");
  const job = useJob();
  return (
    <div className="col" style={{ marginTop: 8 }}>
      <Field label="Moves up to and including the gambit move"><input type="text" value={line} onChange={(e) => setLine(e.target.value)} /></Field>
      <Field label="Human games (optional)" help="A games book shows how often real opponents take the bait.">
        <select value={human} onChange={(e) => setHuman(e.target.value)}><option value="">none</option>{(books.data || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <button className="btn primary" disabled={!engine || job.busy || !line.trim()} onClick={async () => { const r = await job.run({ task: "assess", moves: line, engine, budget, human_book_id: human || undefined }); if (r) onDone(r.id); }}>Assess this gambit</button>
      <JobBar job={job} />
    </div>
  );
}

function Search({ line, setLine, engine, budget, onDone }: Src & { line: string; setLine: (s: string) => void }) {
  const [cfg, setCfg] = useState({ color: "white", max_ply: 6, max_positions: 12, max_cost: 15, min_pawns: 1, max_results: 4 });
  const set = (p: any) => setCfg({ ...cfg, ...p });
  const job = useJob();
  return (
    <div className="col" style={{ marginTop: 8 }}>
      <Field label="Start from" help="Leave empty to start from the initial position."><input type="text" value={line} onChange={(e) => setLine(e.target.value)} /></Field>
      <div className="grid g2">
        <Field label="Who sacrifices"><Select value={cfg.color} onChange={(v) => set({ color: v })} options={[["white", "White"], ["black", "Black"]]} /></Field>
        <Field label="Look ahead (plies)"><Num value={cfg.max_ply} min={0} max={20} onChange={(v) => set({ max_ply: v })} /></Field>
        <Field label="Positions to examine"><Num value={cfg.max_positions} min={1} max={60} onChange={(v) => set({ max_positions: v })} /></Field>
        <Field label="Highest price (points)" help="Expected score you may lose against best play."><Num value={cfg.max_cost} min={0} max={50} onChange={(v) => set({ max_cost: v })} /></Field>
        <Field label="At least (pawns)"><Num value={cfg.min_pawns} min={1} max={9} onChange={(v) => set({ min_pawns: v })} /></Field>
        <Field label="Keep the best"><Num value={cfg.max_results} min={1} max={12} onChange={(v) => set({ max_results: v })} /></Field>
      </div>
      <button className="btn primary" disabled={!engine || job.busy} onClick={async () => {
        const r = await job.run({ task: "search", engine, budget, config: { ...cfg, max_cost: cfg.max_cost / 100, moves: line } });
        if (r) { useStore.getState().toast(r.found.length ? `${r.found.length} gambit(s) found` : "No sacrifice within that price", r.found.length ? "ok" : "info"); onDone(r.ids[0]); }
      }}>Search for sacrifices</button>
      <JobBar job={job} />
      {job.result && <div className="help">{job.result.note}</div>}
      <div className="help">The engine only finds what it can see: use a strong engine and a generous budget for real discoveries.</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- one gambit
function Detail({ id, engine, budget, onChanged }: { id: string; engine: any; budget: any; onChanged: () => void }) {
  const { go } = useStore();
  const g = useApi<any>(`/api/gambits/${id}`);
  if (!g.data) return <div className="muted">{g.error || "Loading…"}</div>;
  const d = g.data.detail, startFen = g.data.start_fen || undefined;
  const full = [...g.data.line, ...(d.main_line_uci_from_offer || [])];
  return (
    <div className="col gap-lg">
      <Panel title={g.data.name} hint={<span><span className="pill">{g.data.color} sacrifices</span> <span className={`pill ${BAND[d.band] || ""}`}>{d.band}</span> <span className="pill">{d.kind}</span></span>}>
        <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
          <MiniBoard fen={d.fen_after} size={230} orientation={g.data.color} />
          <div className="col grow">
            <div style={{ fontSize: 15 }}><b>{d.band_text}.</b> {d.kind_text}</div>
            <div className="mono">{GameTree.fromMoves(startFen, g.data.line).sans().map((s: string, i: number) => (i % 2 === 0 ? `${i / 2 + 1}.${s}` : s)).join(" ")}</div>
            <div className="muted">Gives up {d.sacrifice.pawns === 1 ? "a pawn" : `${d.sacrifice.pawns} points of material (pawn = 1)`}{d.sacrifice.declined_recapture ? " by not recapturing" : d.sacrifice.accept_san ? ` (${d.sacrifice.accept_san} takes it)` : ""}
              {d.sacrifice.keeps_material ? `; ${d.sacrifice.keeps_material} would have kept the material` : ""}. Engine's own choice here: <b className="mono">{d.best_instead}</b>{d.rank ? ` — the gambit move ranks #${d.rank}${d.rank_exact ? "" : "+"}` : ""}.</div>
            <div className="row">
              <button className="btn sm" onClick={() => go("analysis", { moves: full, startFen })}>Analyse</button>
              <button className="btn sm" onClick={() => go("play", { moves: g.data.line, startFen })}>Play it against an engine</button>
              <button className="btn sm" onClick={() => act(() => api.post("/api/training/decks", { title: g.data.name, moves: full, start_fen: startFen, color: g.data.color }), "Training deck built")}>Drill the main line</button>
              <button className="btn sm" onClick={() => go("openings", { playbackMoves: full, startFen, title: g.data.name })}>Replay / send to board</button>
              <button className="btn sm" onClick={() => go("prep", { moves: full, startFen })}>Practical score</button>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid g3">
        <Panel title="Risk" hint="price against best play">
          <div className="kpi"><b>{pct(d.risk.value)}</b><span>expected score given up</span></div>
          <Meter value={Math.min(1, d.risk.value / 0.3)} kind={d.risk.value > 0.1 ? "bad" : ""} />
          <p className="help" style={{ marginTop: 6 }}>{d.risk.text}</p>
        </Panel>
        <Panel title="Sting" hint="how hard the defence is">
          <div className="kpi"><b>{pct(d.sting.value)}</b><span>{d.sting.only_moves_defender} only-move(s) · {d.sting.traps} trap(s)</span></div>
          <Meter value={d.sting.value} kind="brass" />
          <p className="help" style={{ marginTop: 6 }}>{d.sting.text}</p>
        </Panel>
        <Panel title="Compensation" hint="what you get for it (board heuristic)">
          <div className="kpi"><b>{pct(d.compensation.score)}</b><span>50% = nothing to show</span></div>
          <Meter value={d.compensation.score} />
          <p className="help" style={{ marginTop: 6 }}>{d.compensation.summary}</p>
          {Object.entries(d.compensation.parts).map(([k, p]: any) => <div key={k} className="help">• {p.text}</div>)}
        </Panel>
      </div>

      <div className="grid g2">
        <Panel title="The defender's choice">
          {d.accept ? <div className={`note ${d.accept.is_mistake ? "good" : ""}`}><b className="mono">{d.accept.san}</b> — {d.accept.text}.{d.accept.better_capture && <> The right capture is <b className="mono">{d.accept.better_capture}</b>.</>}</div>
            : <div className="note">Nothing can be taken at once: the material is already gone and the question is whether the defender can keep it.</div>}
          {d.decline && <div className="note" style={{ marginTop: 6 }}><b className="mono">{d.decline.san}</b> — {d.decline.text}. <span className="mono muted">{d.decline.line}</span></div>}
          {d.best_reply && <p className="help" style={{ marginTop: 8 }}>What a prepared opponent plays: <span className="mono">{d.best_reply.line}</span></p>}
          {d.human && <p style={{ marginTop: 8 }}>In {d.human.games} human games, <b>{pct(d.human.accept_share)}</b> took the bait. <span className="muted">{d.human.replies.map((r: any) => `${r.san} ${pct(r.share)}`).join(" · ")}</span></p>}
        </Panel>
        <Panel title="Traps" hint={`tempting moves that lose ≥ 15 points`}>
          {d.traps.length ? d.traps.map((t: any, i: number) => (
            <div key={i} className="row nowrap" style={{ padding: "3px 0", fontSize: 13 }}>
              <div className="grow"><b className="mono">{t.san}</b> <span className="muted">({t.why})</span> loses {Math.round(t.loss * 100)} points{t.punish && <> to <b className="mono">{t.punish}</b></>}
                {t.line && <div className="mono muted" style={{ fontSize: 12 }}>{t.line}</div>}</div>
              <button className="btn xs" onClick={() => go("analysis", { fen: t.fen })}>Look</button></div>))
            : <span className="muted">No tempting move in this line was found to lose outright. The gambit works by pressure, not by a single trick.</span>}
        </Panel>
      </div>

      <Panel title="Main line with best defence" hint={`you stand at ${pct(d.expected_best_defence)} at the end · material ${d.material_end >= 0 ? "+" : ""}${d.material_end}`}>
        <div className="mono" style={{ marginBottom: 6 }}>{d.main_line}</div>
        {d.rows.length > 0 && <table className="t"><thead><tr><th>Ply</th><th>To move</th><th>Best</th><th>Gap to 2nd</th><th>Only move?</th><th>Easy to find?</th><th>Your chances</th><th /></tr></thead>
          <tbody>{d.rows.map((r: any) => <tr key={r.ply}><td>{r.ply}</td><td className={r.side === "defender" ? "" : "muted"}>{r.side}</td><td className="mono"><b>{r.best_san}</b></td><td>{Math.round(r.gap * 100)} pts</td>
            <td>{r.only_move ? <span className={`pill ${r.side === "defender" ? "good" : "warn"}`}>only move</span> : ""}</td><td><div style={{ width: 60 }}><Meter value={r.findability} /></div></td><td>{pct(r.expected_gambiteer)}</td>
            <td className="right"><button className="btn xs" onClick={() => go("analysis", { fen: r.fen })}>Look</button></td></tr>)}</tbody></table>}
        <p className="help" style={{ marginTop: 6 }}>{d.note} Engine: {d.engine}, depth {d.depth}.</p>
      </Panel>

      <Ladder gambit={g.data} engine={engine} budget={budget} onDone={() => { g.reload(); onChanged(); }} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- the ladder
function Ladder({ gambit, engine, budget, onDone }: { gambit: any; engine: any; budget: any; onDone: () => void }) {
  const { go } = useStore();
  const [defender, setDefender] = useState<any>(null);
  const [levels, setLevels] = useState<any[]>([]); const [mech, setMech] = useState("");
  const [games, setGames] = useState(2); const [horizon, setHorizon] = useState(30);
  const [custom, setCustom] = useState({ mode: "depth", value: 3 });
  const [open, setOpen] = useState<string | null>(null);
  const job = useJob();
  useEffect(() => { if (engine && !defender) setDefender(engine); }, [engine]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (defender?.engine_id) api.get(`/api/gambits/levels?engine_id=${defender.engine_id}`).then((r) => { setLevels(r.levels); setMech(r.mechanism); }).catch(() => undefined); }, [defender?.engine_id]);
  const rep = gambit.report?.levels ? gambit.report : null;
  const startFen = gambit.start_fen || undefined;
  const addCustom = () => { const l = custom.mode === "full" ? { mode: "full" } : { mode: custom.mode, [custom.mode === "time" ? "movetime_ms" : custom.mode]: custom.value }; if (!levels.some((x) => sameLevel(x, l))) setLevels([...levels, l]); };
  return (
    <Panel title="Who falls for it? — the engine ladder" hint="the gambit is played out against each defender strength">
      <div className="grid ladder-setup">
        <div className="col">
          <EnginePicker value={defender} onChange={setDefender} label="Defender engine" />
          <div className="grid g2"><Field label="Games per level"><Num value={games} min={1} max={8} onChange={setGames} /></Field><Field label="Plies per game"><Num value={horizon} min={6} max={80} step={2} onChange={setHorizon} /></Field></div>
        </div>
        <div className="col">
          <div className="label">Defender levels <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>— {mech}</span></div>
          <div className="row">{levels.map((l, i) => <button key={i} className="btn sm on" title="Remove this level" onClick={() => setLevels(levels.filter((_, k) => k !== i))}>{levelLabel(l)} ✕</button>)}
            {!levels.length && <span className="muted">No levels chosen.</span>}</div>
          <div className="row nowrap"><Select value={custom.mode} onChange={(v) => setCustom({ mode: v, value: v === "elo" ? 1500 : v === "time" ? 200 : v === "skill" ? 5 : 3 })} style={{ width: 150 }}
            options={[["depth", "Search depth"], ["elo", "Elo (if supported)"], ["skill", "Skill level"], ["time", "Milliseconds"], ["full", "Full strength"]]} />
            {custom.mode !== "full" && <Num value={custom.value} min={1} style={{ width: 90 }} onChange={(v) => setCustom({ ...custom, value: v })} />}
            <button className="btn sm" onClick={addCustom}>Add level</button>
            <span className="spacer" />
            <button className="btn primary" disabled={!engine || !defender || !levels.length || job.busy} onClick={async () => {
              const r = await job.run({ task: "ladder", gambit_id: gambit.id, engine, defender, levels, budget, games_per_level: games, horizon }); if (r) onDone();
            }}>{rep ? "Run the ladder again" : "Run the ladder"}</button></div>
        </div>
      </div>
      <JobBar job={job} label="Playing the games…" />
      {rep && <div style={{ marginTop: 14 }}>
        <div className="note good" style={{ fontSize: 15 }}><b>{rep.verdict}</b></div>
        <table className="t" style={{ marginTop: 8 }}><thead><tr><th>Defender</th><th>Fell for it</th><th /><th>Held</th><th>Punished it</th><th>Took the bait</th><th>Your chances at the end</th><th>Typical mistake</th><th /></tr></thead>
          <tbody>{rep.levels.map((l: any) => l.error ? <tr key={l.label}><td><b>{l.label}</b></td><td colSpan={8} className="bad-t">{l.error}</td></tr> : [
            <tr key={l.label}><td title={l.mechanism}><b>{l.label}</b>{l.approximate && <span className="muted"> ≈</span>}</td>
              <td style={{ width: 130 }}><Meter value={l.fell_rate} kind={l.fell_rate >= 0.5 ? "" : "bad"} /></td><td className="nowrap"><b>{l.fell}</b> / {l.games}</td>
              <td>{l.held}</td><td className={l.punished ? "bad-t" : ""}>{l.punished}</td><td>{l.accepted} / {l.games}</td><td>{pct(l.avg_final)}</td>
              <td className="mono">{l.common_mistake || "–"}</td>
              <td className="right"><button className="btn xs" onClick={() => setOpen(open === l.label ? null : l.label)}>{open === l.label ? "Hide" : "Games"}</button></td></tr>,
            open === l.label && <tr key={l.label + "g"}><td colSpan={9} style={{ background: "var(--panel-2)" }}>
              {l.deterministic && <div className="help">This level plays the same moves every time, so repeated games were skipped.</div>}
              {l.samples.map((s: any, i: number) => (
                <div key={i} className="row nowrap" style={{ alignItems: "flex-start", padding: "6px 0", gap: 12 }}>
                  <span className={`pill ${s.outcome === "fell" ? "good" : s.outcome === "punished" ? "bad" : ""}`}>{s.outcome === "fell" ? "fell for it" : s.outcome}</span>
                  <div className="grow"><div className="mono" style={{ fontSize: 12.5 }}>{s.moves}{s.mate ? " (mate)" : ""}</div>
                    {s.mistake && <div className="help">Went wrong with <b className="mono">{s.mistake.san}</b>{s.mistake.swing != null ? ` (your chances +${Math.round(s.mistake.swing * 100)} points)` : ""}.
                      {" "}<a onClick={() => go("analysis", { fen: s.mistake.fen })} style={{ cursor: "pointer", color: "var(--brass-2)" }}>Look at the position</a></div>}
                    {s.curve.length > 1 && <div style={{ maxWidth: 420 }}><EvalGraph points={s.curve.map((c: any) => c.expected)} height={36} /></div>}</div>
                  <span className="nowrap muted">ends at {pct(s.final)}</span>
                  <button className="btn xs" onClick={() => go("analysis", { moves: [...gambit.line, ...s.uci], startFen })}>Open</button></div>))}
            </td></tr>])}</tbody></table>
        <p className="help" style={{ marginTop: 8 }}>{rep.note} Gambit played by {rep.gambiteer}; defender {rep.defender_engine}.</p>
      </div>}
      {!rep && !job.busy && <p className="help" style={{ marginTop: 10 }}>Each level plays the position after the offer against the analysis engine at full budget. You get, per level: how often it fell for the gambit, whether it took the bait, the move it went wrong with, and every game to replay.</p>}
    </Panel>
  );
}
